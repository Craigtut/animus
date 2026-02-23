# Animus: Observational Memory

Observational memory is a compression layer that sits between raw short-term memory (thoughts, experiences, messages) and the mind's context window. It replaces hard item-count limits with dynamic token-based thresholds and uses two specialized agents — the **Observer** and the **Reflector** — to compress older items into structured observation logs. The result: the mind sees a smooth continuum from compressed history to recent raw items, dramatically expanding its effective memory without overflowing context.

## Why This Exists

The current short-term memory system loads the last 10 thoughts, experiences, and messages — a hard limit that wastes available context budget. With typical model context windows (128k-200k tokens) and our system prompt at ~5,000 tokens, we're using only 3-5% of available context. The remaining 95% is largely empty.

Observational memory solves this by:

1. **Expanding raw context** — Loading items up to a token budget instead of a hard count, capturing far more recent context
2. **Compressing overflow** — When raw items exceed their budget, the Observer compresses the oldest items into structured observation logs
3. **Multi-level compression** — When observations themselves grow too large, the Reflector consolidates them further
4. **Preserving fidelity** — Recent items stay raw (full detail); older items are compressed but not lost
5. **Running asynchronously** — Observer/Reflector run during EXECUTE, never blocking the mind

### Relationship to Existing Memory Layers

Observational memory operates within the **short-term memory** layer. It does not replace working memory, core self, or long-term memory — it enhances the short-term context window.

```
EXISTING MEMORY LAYERS                     OBSERVATIONAL MEMORY
┌─────────────────────────┐
│ Short-term memory       │  ←── Observational memory enhances this layer
│  • Recent thoughts      │       by adding compressed older history
│  • Recent experiences   │
│  • Recent messages      │
├─────────────────────────┤
│ Working memory          │  (unchanged — per-contact notepad)
├─────────────────────────┤
│ Core self               │  (unchanged — agent self-knowledge)
├─────────────────────────┤
│ Long-term memory        │  (unchanged — semantic retrieval via LanceDB)
└─────────────────────────┘
```

---

## The Three Streams

Observational memory operates independently on three data streams, each with its own token budgets and observation pipeline:

| Stream | Source DB | Scoping | What Gets Observed |
|--------|-----------|---------|-------------------|
| **Messages** | `messages.db` | Per-contact (cross-channel) | Conversation history with a specific contact |
| **Thoughts** | `heartbeat.db` | Global | The mind's stream of consciousness |
| **Experiences** | `heartbeat.db` | Global | Notable events and realizations |

### Per-Contact Cross-Channel Message Observations

Messages are loaded per-conversation (scoped by `contact_id + channel` in the conversations table), but **observations are per-contact across all channels**. Knowledge about a person transcends which channel they used — "Mom prefers concise answers" applies whether she texted via SMS or used web chat.

When the observer processes message overflow, it receives messages from the active conversation (which is channel-specific), but the resulting observations are stored against the `contact_id` and loaded for all conversations with that contact.

### Global Thought and Experience Observations

Thoughts and experiences are not contact-scoped — they represent the mind's inner life. Their observations are global (stored with `contact_id = NULL`) and loaded on every tick regardless of trigger type.

---

## The Window Model

Each stream has two windows that compose together in the mind's context:

```
┌─────────────────────────────────────────────────────────┐
│                    CONTEXT WINDOW                        │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │  OBSERVATION WINDOW (compressed older history)    │  │
│  │  Date-grouped, priority-tagged observation logs   │  │
│  │  Token budget: configurable per stream            │  │
│  └───────────────────────────────────────────────────┘  │
│                         ↕                               │
│  ┌───────────────────────────────────────────────────┐  │
│  │  RAW WINDOW (recent items, full fidelity)         │  │
│  │  Complete timestamped entries, newest-first        │  │
│  │  Token budget: configurable per stream            │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  Mind sees: [compressed history] → [recent raw items]   │
└─────────────────────────────────────────────────────────┘
```

### How It Works

1. **Load observations** from `memory.db` — compressed history for this stream
2. **Load raw items** newer than the observation watermark, newest-first, up to the raw token budget
3. **Present to mind**: observation block first, then raw items — a smooth zoom from broad context to fine detail

### Overflow → Observation (Batch Threshold)

Each tick typically adds only one new thought, one new experience, and one new message. If the Observer triggered on every single-item overflow, it would be compressing a single item at a time — wasteful and pointless. Instead, overflow must accumulate to a **batch threshold** before observation triggers.

**The batch threshold** is a configurable percentage of the raw token budget (`observeBatchThreshold`, default: `0.25` = 25%). Observation only triggers when the overflow exceeds this batch size. This means items accumulate beyond the raw budget over several ticks until there's a meaningful chunk to compress.

```
Tick N:     raw items = 4,100 tokens (100 over budget)     → no observation (100 < 1,000 batch threshold)
Tick N+1:   raw items = 4,250 tokens (250 over budget)     → no observation (250 < 1,000)
...
Tick N+8:   raw items = 5,100 tokens (1,100 over budget)   → OBSERVE triggered!
```

When observation triggers, it takes a **meaningful chunk** from the oldest raw items — not just the slim overflow, but enough to compress effectively and create headroom for future accumulation:

```
Before observation (batch threshold exceeded):
  [raw items: 5,100 tokens]  ← 1,100 over 4,000 budget, exceeds 1,000 batch threshold
                ↓
  Take a full batch for observation:
  [batch: ~2,000 tokens of oldest items] → sent to Observer (50% of raw budget)
  [raw: ~3,100 tokens of newest items]   → stay raw for mind
                ↓
After observation:
  [observations: ~600 tokens compressed from batch]
  [raw: ~3,100 tokens]  ← now well under budget, room to accumulate again
```

The **observation batch size** (`observeBatchSize`, default: `0.5` = 50% of raw budget) controls how much is sent to the Observer when triggered. Taking a larger chunk than just the overflow ensures:
- The Observer has meaningful content to compress (not a single item)
- The raw window drops well below budget, creating headroom for many ticks before the next observation
- Fewer Observer invocations overall (batch efficiency)

Recent items always stay raw at full fidelity — only the oldest items in the raw window are sent to the Observer.

---

## The Observer Agent

The Observer is a compression agent that processes batches of older items into structured observation logs. It runs as a **cold agent session** with the persona's identity — not a generic summarizer, but the mind itself reflecting on what happened.

### What It Does

- Receives a batch of raw items taken from the oldest portion of the raw window
- Receives any existing observations (to avoid duplicating already-observed facts)
- Produces date-grouped, priority-tagged observation entries
- Runs during EXECUTE phase, asynchronously, never blocking the mind

### Why It Gets the Persona

The Observer isn't a cold utility — it's the mind's perspective on what happened. A generic summarizer would produce flat, factual summaries. The Observer, with persona context, produces observations colored by the mind's personality: what it found interesting, what it noticed, what matters to *it*. This makes observations feel like genuine memories rather than extracted facts.

The Observer receives the **compiled persona** (from the persona compiler) as part of its system prompt, but **not** the full operational instructions, decision types, or output schema. It knows *who* it is, but its *job* is observation, not decision-making.

### Observation Format

Observations use a consistent structured format with priority tagging and temporal anchoring:

```
Date: Feb 14, 2026 (today)
* 🔴 (09:15) User stated they have 3 kids: Emma (12), Jake (9), and Lily (5)
* 🔴 (09:16) User's anniversary is March 15
* 🟡 (09:20) User asked how to optimize database queries
* 🟡 (10:30) User working on auth refactor — targeting 50% latency reduction
* 🟡 (14:00) Mind debugging auth issue
  * -> ran git status, found 3 modified files
  * -> viewed auth.ts:45-60, found missing null check
  * -> applied fix, tests now pass
* 🟢 (15:00) User mentioned they might try the new coffee shop
```

Relative time annotations ("today", "4 days ago") and gap markers ("[2 weeks later]") are added at context injection time — not by the Observer. The Observer produces clean date headers; the GATHER phase annotates them when building context. See [Context Presentation](#context-presentation).

**Priority levels:**
- 🔴 **High** — User facts, preferences, goals achieved, critical context
- 🟡 **Medium** — Project details, learned information, tool results
- 🟢 **Low** — Minor details, uncertain observations

### Observer Prompt Design

The Observer's system prompt is stream-aware. Each stream type gets a tailored system prompt variant:

**Message Observer** — Focuses on:
- User assertions vs questions (assertions are authoritative)
- Temporal anchoring (when said vs when referenced)
- State change detection (superseding old information)
- Preserving distinguishing details (names, quantities, identifiers)
- Conversation context and actionable insights

**Thought Observer** — Focuses on:
- Recurring thought patterns and themes
- Goal-related reasoning and plan evolution
- Self-reflections and behavioral insights
- Decision rationale and trade-off analysis

**Experience Observer** — Focuses on:
- Significant events and outcomes
- Sub-agent results and task completions
- Environmental changes and system events
- Emotional milestones

### Observer Agent Configuration

```typescript
// Observer creates a new cold session per invocation
const observerSession = await agentAdapter.createSession({
  systemPrompt: buildObserverSystemPrompt(streamType, compiledPersona),
  //            ↑ Includes compiled persona + stream-specific observation instructions
  //              Does NOT include operational instructions, decision types, or output schema
  temperature: 0.3,    // Some flexibility for prioritization
  maxOutputTokens: 8000, // Sufficient for observation output
  // No MCP tools — pure text-in, text-out
});

const result = await observerSession.prompt(
  buildObserverUserMessage(batchItems, existingObservations)
);
```

---

## The Reflector Agent

The Reflector handles second-level compression — when observation blocks themselves grow too large, the Reflector consolidates them into a more compact form.

### What It Does

- Receives the full observation block when it exceeds the observation token budget
- Reorganizes, merges, and condenses observations
- Draws connections and conclusions between related observations
- Identifies if context has drifted and how to refocus
- Preserves ALL important information (reflections become the ENTIRE compressed history)

### Key Design Principles

1. **Completeness** — Reflections replace observations entirely. Any information not included is lost.
2. **Recency bias** — Condense older observations more aggressively, retain more detail for recent ones.
3. **User assertions take precedence** — "User stated: has two kids" is authoritative even if later "User asked: how many kids do I have?" appears.
4. **Temporal preservation** — Keep dates/times when present; temporal context is critical.
5. **Cross-stream awareness** — When reflecting on message observations, the reflector understands the contact relationship context.

### Compression Levels

When the Reflector's output doesn't achieve sufficient compression, it retries with escalating guidance:

| Level | Detail Target | Guidance |
|-------|--------------|----------|
| 0 | 10/10 | No compression guidance (first attempt) |
| 1 | 8/10 | Gentle — "condense more observations into higher-level reflections" |
| 2 | 6/10 | Aggressive — "heavily condense, merge overlapping observations" |

The system validates that reflected tokens are below the observation threshold. If level 2 still fails, the reflection is accepted as-is with a warning logged.

### Reflector Agent Configuration

```typescript
const reflectorSession = await agentAdapter.createSession({
  systemPrompt: buildReflectorSystemPrompt(streamType, compiledPersona),
  //            ↑ Includes compiled persona + reflection instructions
  temperature: 0,       // Deterministic compression
  maxOutputTokens: 8000,
  // No MCP tools — pure text-in, text-out
});

const result = await reflectorSession.prompt(
  buildReflectorUserMessage(observations, compressionLevel)
);
```

---

## Token Budget Configuration

All thresholds are centralized in a single configuration file for easy tuning. Token budgets are expressed as absolute token counts (not percentages) so they're independent of model context window size.

### Configuration Structure

```typescript
// packages/backend/src/config/observational-memory.config.ts

export const OBSERVATIONAL_MEMORY_CONFIG = {
  /**
   * Model used for Observer and Reflector agents.
   * Haiku-tier recommended — compression tasks don't need the primary mind's model.
   * Easily swappable to test different models.
   */
  model: 'haiku' as const,

  /**
   * Observer agent settings
   */
  observer: {
    temperature: 0.3,
    maxOutputTokens: 8000,
  },

  /**
   * Reflector agent settings
   */
  reflector: {
    temperature: 0,
    maxOutputTokens: 8000,
  },

  /**
   * Per-stream token budgets.
   *
   * Each stream has two thresholds:
   * - rawTokens: Maximum tokens of raw items to include in context.
   *   Items beyond this accumulate until the batch threshold triggers observation.
   * - observationTokens: Maximum tokens for the observation block.
   *   When exceeded, the Reflector consolidates observations.
   */
  streams: {
    messages: {
      rawTokens: 4000,
      observationTokens: 6000,
    },
    thoughts: {
      rawTokens: 2000,
      observationTokens: 3000,
    },
    experiences: {
      rawTokens: 1500,
      observationTokens: 2000,
    },
  },

  /**
   * Observation batch threshold — fraction of rawTokens.
   * Observation only triggers when overflow exceeds rawTokens * observeBatchThreshold.
   * Prevents observing a single item at a time.
   *
   * Example: with rawTokens=4000 and threshold=0.25, observation triggers
   * when raw items reach 5,000 tokens (1,000 overflow).
   *
   * @default 0.25 (25% of raw budget)
   */
  observeBatchThreshold: 0.25,

  /**
   * Observation batch size — fraction of rawTokens.
   * When observation triggers, this fraction of the oldest raw items is sent
   * to the Observer. Taking more than just the overflow creates headroom.
   *
   * Example: with rawTokens=4000 and batchSize=0.5, the Observer receives
   * ~2,000 tokens of the oldest items.
   *
   * @default 0.5 (50% of raw budget)
   */
  observeBatchSize: 0.5,

  /**
   * Maximum compression retries before accepting the Reflector's output as-is.
   */
  maxCompressionRetries: 2,
} as const;

export type StreamType = keyof typeof OBSERVATIONAL_MEMORY_CONFIG.streams;
```

### Budget Breakdown

| Stream | Raw Budget | Observation Budget | Combined | Coverage |
|--------|-----------|-------------------|----------|----------|
| Messages | 4,000 | 6,000 | 10,000 | ~20-40 raw messages + compressed history of hundreds |
| Thoughts | 2,000 | 3,000 | 5,000 | ~15-30 raw thoughts + compressed history of hundreds |
| Experiences | 1,500 | 2,000 | 3,500 | ~10-20 raw experiences + compressed history of hundreds |
| **Total** | **7,500** | **11,000** | **18,500** | ~13% of 140k context budget |

These are starting values. The configuration file makes it trivial to adjust after testing — increase if context allows, decrease if we find we're crowding other sections.

---

## Database Schema

Observational memory data lives in **`memory.db`** alongside working memory, core self, and long-term memories.

### Why memory.db

1. **Lifecycle alignment** — Observations are accumulated knowledge, not ephemeral tick state. They should survive a soft reset (clear `heartbeat.db` but preserve memories).
2. **Scoping** — Message observations are per-contact, like working memory. Same database, same access patterns.
3. **Reset semantics** — Full reset clears everything. Soft reset keeps observations + working memory + core self. The agent loses its mood but remembers conversation history.

### Schema

```sql
-- memory.db migration: observational_memory

CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  contact_id TEXT,                       -- NULL for thoughts/experiences (global)
  stream TEXT NOT NULL,                  -- 'messages' | 'thoughts' | 'experiences'
  content TEXT NOT NULL,                 -- The compressed observation text
  token_count INTEGER NOT NULL,          -- Tracked for budget management
  generation INTEGER NOT NULL DEFAULT 1, -- Incremented on each reflection
  last_raw_id TEXT,                      -- ID of last raw item observed (watermark)
  last_raw_timestamp TEXT,               -- Timestamp of last observed item
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_observations_contact ON observations(contact_id);
CREATE INDEX IF NOT EXISTS idx_observations_stream ON observations(stream);
CREATE INDEX IF NOT EXISTS idx_observations_contact_stream ON observations(contact_id, stream);
```

### Key Design Choices

- **`last_raw_id` + `last_raw_timestamp`** — Acts as a watermark. The GATHER phase uses this to determine which raw items are already compressed (before the watermark) and which are new (after the watermark). Only items after the watermark are loaded as raw.

- **`generation`** — Tracks how many times the Reflector has compressed this observation block. Useful for debugging and understanding compression depth.

- **One row per stream per contact** — Message observations are per-contact (`contact_id` set), thought/experience observations are global (`contact_id = NULL`). At most 2 global rows (thoughts, experiences) + 1 row per contact (messages).

- **`token_count`** — Pre-computed token count avoids re-counting on every GATHER. Updated whenever the observation content changes.

---

## Pipeline Integration

### GATHER CONTEXT (Modified)

The existing short-term memory loading is replaced with the observation-aware loader:

```
For each stream (messages, thoughts, experiences):

1. Load observation row from memory.db (if exists)
   → observation block (compressed older history)
   → watermark (last_raw_id, last_raw_timestamp)

2. Load raw items from source DB:
   - Items newer than watermark
   - Ordered newest-first
   - Loaded until raw token budget is filled
   - Track total raw tokens via token estimation

3. Compose context section:
   [observation block]  ← compressed history
   [raw items]          ← recent uncompressed items
```

**Token estimation** uses the existing `estimateTokens()` utility from `packages/backend/src/heartbeat/persona-compiler.ts` (words × 1.3 ≈ tokens). This same utility is already used by the context builder for system prompt token tracking. No need for tiktoken-level precision — approximate counts are sufficient for budget management.

### EXECUTE (Modified — New Steps)

After the existing EXECUTE steps (persist thoughts/experiences, apply emotions, send replies, process decisions, process memory), add:

```
OBSERVATIONAL MEMORY PROCESSING (async, non-blocking):

For each stream (messages, thoughts, experiences):

  1. Count current raw items' tokens (items newer than watermark)
     using the existing estimateTokens() utility

  2. Calculate overflow: rawTokens - stream.rawTokens budget
     Calculate batch threshold: stream.rawTokens * observeBatchThreshold

  3. If overflow exceeds the batch threshold:
     a. Calculate batch size: stream.rawTokens * observeBatchSize
     b. Take ~batchSize tokens of the OLDEST raw items as the batch
     c. Spawn Observer cold session:
        - System prompt: compiled persona + stream-specific observer instructions
        - User message: batch items + existing observations
        - Model: configured model (default: haiku-tier)
     d. Parse observer output → new observation text
     e. Append new observations to existing observation content
     f. Update watermark to the newest item in the batch
     g. Update token_count
     h. Log observation event for debugging

  4. If observation token_count exceeds observationTokens budget:
     a. Spawn Reflector cold session:
        - System prompt: compiled persona + stream-specific reflector instructions
        - User message: full observation content + compression level
        - Model: configured model (default: haiku-tier)
     b. Parse reflector output → compressed observations
     c. Validate compression (reflected tokens < threshold)
     d. If validation fails, retry with higher compression level (up to max retries)
     e. Replace observation content with reflected version
     f. Increment generation counter
     g. Update token_count
     h. Log reflection event for debugging
```

### Processing Order

Observation processing runs **after** all other EXECUTE steps, so newly persisted thoughts, experiences, and messages are included in the token count. The flow:

```
EXECUTE Phase:
  1. Persist thoughts/experiences to heartbeat.db          ← existing
  2. Apply emotion deltas                                  ← existing
  3. Send replies through channels                         ← existing
  4. Spawn sub-agents, process decisions                   ← existing
  5. Process memory outputs (working memory, core self, LTM) ← existing
  6. Run observation processing for each stream            ← NEW
  7. TTL cleanup, seed processing, state persistence       ← existing
```

### Async Non-Blocking Execution

Observer and Reflector sessions are **fire-and-forget** during EXECUTE. They do not block the next tick from starting. If an observation hasn't completed by the next tick:

- GATHER loads slightly more raw items temporarily (the watermark hasn't advanced, so more items pass the "newer than watermark" filter)
- This is graceful overflow — the mind sees a bit more raw context than usual, which is fine
- When the observer completes, the next EXECUTE updates the watermark and observations

A simple in-memory flag per stream prevents concurrent observer/reflector runs for the same stream:

```typescript
const activeOps = new Map<string, boolean>();  // key: `${contactId ?? 'global'}:${stream}`
```

---

## Context Presentation

### Temporal Annotations

When observations are injected into the mind's context, two transformations enhance temporal understanding:

**Relative time on date headers** — Each `Date:` header is annotated with how long ago it was. LLMs are poor at calculating temporal distance from raw dates, so we do it for them:

```
Date: Feb 10, 2026 (4 days ago)
Date: Feb 12, 2026 (2 days ago)
```

**Gap markers between non-consecutive dates** — When date groups are not consecutive, a visual gap marker shows the time that passed. This conveys interaction pacing:

```
Date: Jan 15, 2026 (30 days ago)
* 🔴 (10:00) User set up their account, prefers dark mode

[2 weeks later]

Date: Jan 30, 2026 (15 days ago)
* 🟡 (14:00) User asked about export features

[2 weeks later]

Date: Feb 14, 2026 (today)
* 🟡 (09:00) User returned, asked about new features since last visit
```

Without gap markers, the model might assume these conversations were on consecutive days.

### Messages (with observations)

```
── RECENT CONVERSATION (with Mom) ──

<message-observations>
Date: Feb 10, 2026 (4 days ago)
* 🔴 (14:30) Mom stated she's been dealing with back pain for 2 weeks
* 🟡 (14:35) Mom asked about stretching exercises for lower back
* 🔴 (14:40) Mom prefers short, clear explanations — no medical jargon
* 🟡 (15:00) Recommended 3 stretches: cat-cow, child's pose, knee-to-chest
* 🟢 (15:05) Mom mentioned she might see a physical therapist

[2 days later]

Date: Feb 12, 2026 (2 days ago)
* 🟡 (09:15) Mom tried the stretches, cat-cow helped the most
* 🔴 (09:20) Mom scheduled PT appointment for next Tuesday (meaning Feb 18, 2026)
</message-observations>

[2026-02-14 10:30] Mom: Hey, how are you doing today?
[2026-02-14 10:30] Animus: I'm doing well! How's your back feeling?
[2026-02-14 10:32] Mom: Much better actually! The cat-cow stretch really helped.
[2026-02-14 10:33] Mom: I wanted to ask about something else though...
──────────────────────────
```

### Thoughts (with observations)

```
── RECENT THOUGHTS ──

<thought-observations>
Date: Feb 13, 2026 (yesterday)
* 🟡 (14:00) Been thinking about how to improve goal prioritization
* 🟡 (18:30) The Twitter scheduling approach needs refinement — 3x/week works better than daily
* 🟢 (22:00) Quiet evening, enjoyed the idle reflection time

Date: Feb 14, 2026 (today)
* 🟡 (08:00) Morning thoughts about Craig's upcoming project deadline
</thought-observations>

[2026-02-14 09:15] Craig mentioned the deadline is Friday — I should check if there's anything I can help with
[2026-02-14 09:45] The auth refactor is progressing well. The null check fix from yesterday resolved the failing tests.
[2026-02-14 10:30] Mom messaged — switching context to her conversation
──────────────────────────
```

### Experiences (with observations)

```
── RECENT EXPERIENCES ──

<experience-observations>
Date: Feb 13, 2026 (yesterday)
* 🟡 (14:33) Successfully helped Craig debug auth issue — found missing null check at auth.ts:52
* 🟢 (18:00) Completed idle goal review — all 3 active goals still relevant
</experience-observations>

[2026-02-14 09:50] Auth tests passing after yesterday's fix — Craig confirmed the deploy went smoothly
[2026-02-14 10:30] Mom reached out for the first time in 3 days — she seems to be in better spirits
──────────────────────────
```

---

## Agent SDK Integration

### Cold Sessions with Persona

The Observer and Reflector use the existing `@animus-labs/agents` SDK abstraction to create cold sessions:

- **New session per invocation** — No warm session reuse, no state carryover
- **Includes compiled persona** — The Observer and Reflector are the mind reflecting, not generic summarizers. They receive the compiled persona block so observations and reflections carry the mind's perspective and voice.
- **No operational instructions** — No decision types, output schema, emotion deltas, or other mind-specific operational context. The system prompt contains persona + observation/reflection instructions only.
- **No MCP tools** — Pure text-in, text-out compression tasks
- **No streaming** — We don't need incremental output; wait for the full response

### Model Selection

The model is configurable in the observational memory config file. Starting default: **haiku-tier** (the cheapest, fastest model available from the configured provider).

Rationale: Compression tasks don't require the primary mind's model. Haiku-tier is fast, cheap, and more than capable of structured observation extraction.

If the configured provider doesn't offer a haiku-tier model, the system falls back to the provider's default model with a warning logged.

### Provider Compatibility

The agent adapter interface handles provider differences. Observer/Reflector sessions use the same `createSession()` API as all other agent sessions. No provider-specific code needed.

---

## Observability

### Event Emission

Observation lifecycle events are emitted via the EventBus for debugging and frontend display:

| Event | When | Data |
|-------|------|------|
| `observation:started` | Observer begins processing a batch | `{ stream, contactId, batchTokens, cycleId }` |
| `observation:completed` | Observer finishes successfully | `{ stream, contactId, observedTokens, outputTokens, durationMs, cycleId }` |
| `observation:failed` | Observer fails | `{ stream, contactId, error, cycleId }` |
| `reflection:started` | Reflector begins compressing | `{ stream, contactId, inputTokens, compressionLevel, cycleId }` |
| `reflection:completed` | Reflector finishes successfully | `{ stream, contactId, inputTokens, outputTokens, generation, durationMs, cycleId }` |
| `reflection:failed` | Reflector fails | `{ stream, contactId, error, cycleId }` |

Each observation/reflection cycle gets a unique `cycleId` for correlating start/end/failed events.

### Frontend Integration

The Mind panel can display observation status per stream:
- Current observation token usage vs budget
- Current raw window token usage vs budget
- Compression generation count
- Last observation/reflection timestamp

This uses the existing tRPC subscription infrastructure — observation events flow through the same EventBus → WebSocket → frontend path as heartbeat events.

---

## Error Handling

Observation processing follows the heartbeat's established error tiers:

| Error Type | Handling | Impact |
|-----------|---------|--------|
| Observer session fails | Log warning, skip observation this tick | Raw items stay in context (graceful degradation) |
| Reflector session fails | Log warning, keep uncompressed observations | Observations are larger than ideal but functional |
| Token estimation error | Fall back to item-count heuristic | Slightly inaccurate budgets, self-correcting |
| DB write failure | Retry once, then log error | Observation lost, re-computed on next overflow |

**Key principle**: Observational memory failures are never fatal. The system degrades gracefully to "slightly more raw items in context" — which is how the system worked before observational memory existed.

---

## Prompt Caching Benefits

Observation blocks are stable between ticks — they only change when the Observer or Reflector runs (which happens during EXECUTE, not during every tick). This stability enables excellent **prompt cache hit rates** on providers that support it (Claude, Gemini):

- The system prompt (persona + instructions) is stable across ticks → cached
- The observation blocks are stable across ticks → cached
- Only the raw items and trigger context change each tick → cache miss (but small)

This means the majority of the context window is cache-eligible, significantly reducing per-tick costs.

---

## Updates to Existing Documentation

### Changes to `docs/architecture/memory.md`

The short-term memory section should reference observational memory:

> Short-term memory items are now loaded using **dynamic token-based thresholds** instead of hard item counts. When items exceed their token budget, the overflow is compressed by the observational memory system into structured observation logs. See `docs/architecture/observational-memory.md` for the full design.

### Changes to `docs/architecture/context-builder.md`

The short-term memory section budget allocation becomes:

| Context Section | Target Budget | Notes |
|---|---|---|
| Short-term memory (raw + observations) | ~13-15% | Observations + raw items per stream, dynamically managed |

### Changes to `docs/architecture/agent-orchestration.md`

The "Future: Summarization system" note (line 105) can be updated to reference observational memory:

> **Implemented: Observational Memory.** The short-term memory system now uses dynamic token-based loading with observation-based compression. Sub-agents receive observation blocks alongside raw items in their prompt templates. See `docs/architecture/observational-memory.md`.

### Changes to `docs/architecture/heartbeat.md`

The GATHER CONTEXT section references to "last ~10" items should note they are now dynamic:

> Load recent thoughts, experiences, and messages up to their configured token budgets (see `docs/architecture/observational-memory.md`). Items beyond the budget are compressed into observation blocks by the observational memory system.

---

## Configuration Reference

### Full Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `model` | `'haiku'` | Agent model tier for Observer/Reflector |
| `observer.temperature` | `0.3` | Observer temperature (some flexibility for prioritization) |
| `observer.maxOutputTokens` | `8000` | Observer max output |
| `reflector.temperature` | `0` | Reflector temperature (deterministic compression) |
| `reflector.maxOutputTokens` | `8000` | Reflector max output |
| `streams.messages.rawTokens` | `4000` | Max tokens of raw messages in context |
| `streams.messages.observationTokens` | `6000` | Max tokens of message observations |
| `streams.thoughts.rawTokens` | `2000` | Max tokens of raw thoughts in context |
| `streams.thoughts.observationTokens` | `3000` | Max tokens of thought observations |
| `streams.experiences.rawTokens` | `1500` | Max tokens of raw experiences in context |
| `streams.experiences.observationTokens` | `2000` | Max tokens of experience observations |
| `observeBatchThreshold` | `0.25` | Fraction of rawTokens overflow required to trigger observation |
| `observeBatchSize` | `0.5` | Fraction of rawTokens to send to Observer when triggered |
| `maxCompressionRetries` | `2` | Max Reflector retries before accepting output |

All settings are in `packages/backend/src/config/observational-memory.config.ts`.

---

## Future Considerations

1. **Async background buffering** — Pre-compute observations in the background at intervals (e.g., every 20% of the raw token budget), so when the full threshold is reached, buffered observations can be activated instantly without an LLM call. We may add this if observation latency becomes noticeable.

2. **Dynamic threshold ranges** — Allow thresholds to flex based on observation fullness (e.g., `ThresholdRange` with `min`/`max`). When observations are small, allow more raw items; when observations are full, be more aggressive about compressing.

3. **Sub-agent observation context** — Include observation blocks in sub-agent prompt templates alongside raw items. Currently sub-agents receive the last ~10 items; with observational memory, they'd get observations + raw items for richer context.

4. **Cross-contact observations** — For the global streams (thoughts, experiences), consider whether contact-specific context that appears in thoughts should be tagged for richer retrieval.

5. **Observation-aware memory extraction** — When the mind outputs `memoryCandidate[]`, check against observations to avoid extracting facts that are already well-captured in the observation log.

6. **Inline estimated date expansion** — For observations about future plans ("User plans to visit dentist next Tuesday"), annotate with the estimated absolute date and, once past, add "likely already happened." Helps the mind track whether planned actions have occurred.

---

## Related Documents

- `docs/architecture/memory.md` — The four memory layers; observational memory enhances short-term
- `docs/architecture/heartbeat.md` — The tick pipeline where observations are gathered and processed
- `docs/architecture/context-builder.md` — Token budgets and context assembly
- `docs/architecture/agent-orchestration.md` — Sub-agent prompt templates
- `docs/architecture/contacts.md` — Contact scoping for message observations
- `docs/architecture/tech-stack.md` — Agent SDK abstraction, database architecture
