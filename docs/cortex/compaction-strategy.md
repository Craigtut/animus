# Cortex Compaction Strategy

**STATUS**: Research / Proposal
**Date**: 2026-03-14
**Related docs**: [context-manager.md](./context-manager.md), [mind-migration.md](./mind-migration.md), [cortex-architecture.md](./cortex-architecture.md), [context-compaction-survey.md](./research/context-compaction-survey.md), [openclaw-context-compaction.md](./research/openclaw-context-compaction.md)

---

## Problem Statement

Cortex manages a persistent agent session that accumulates conversation history across heartbeat ticks. Each tick appends a user message (gathered context) and receives an assistant response (thoughts, tool calls, replies, reflections). Without intervention, this history grows until it exceeds the model's context window, causing either degraded performance ("context rot") or hard failures.

The current system has no compaction mechanism. There is no way to manage context growth, which means long-running sessions eventually degrade or fail. The goal is to keep the context window healthy and focused as it grows, preserving the rich context the agent has built up while shedding what is no longer needed.

Additionally, Animus has a domain-specific compaction system (observational memory) that compresses thoughts, experiences, and messages into narrative summaries stored in database-backed slots. This system is already a form of compaction, but it operates independently of the conversation history. The two systems need to be coordinated.

---

## Design Principles

1. **Cortex is general-purpose; the backend is domain-specific.** Cortex handles conversation history compaction (summarizing old turns). The backend handles observational memory compaction (compressing thoughts/experiences/messages into structured summaries). Cortex provides the hooks; the backend decides what domain-specific work to do.

2. **Layered compression, not a single strategy.** Following the Claude Code pattern: cheap operations first (clearing old tool results), then summarization only when needed. Each layer buys time before the next kicks in.

3. **Slots are sacred.** Context slots (persona, contacts, core-self, working-memory, observations, goals, tasks) are never touched by compaction. They are managed independently by the backend and rebuilt from database sources on startup.

4. **Ephemeral context is always fresh.** Ephemeral context is injected per-call via `transformContext` and never persists in history. It is never a compaction target.

5. **Compaction is autonomous with event notifications.** Cortex triggers compaction internally whenever thresholds are crossed. It emits `onBeforeCompaction` and `onPostCompaction` events so consumers can coordinate domain-specific work (e.g., observational memory processing, message re-seeding). The consumer never triggers compaction; it only reacts to it.

6. **Prefix cache preservation.** Compaction should minimize cache invalidation. Slots at the top of the message array are stable; compaction operates on conversation history below the slot region.

---

## Architecture Overview

```
Message Array Layout (from context-manager.md):

SLOT REGION (0..N-1)           -- Persistent, named, managed by ContextManager
  |
CONVERSATION HISTORY (N..M)    -- Grows with each tick, COMPACTION TARGET
  |
PREFIX CACHE BOUNDARY          -- Providers cache the longest unchanged prefix
  |
EPHEMERAL CONTEXT (appended)   -- Per-call via transformContext, never stored
  |
USER PROMPT                    -- Current tick input
```

Compaction operates exclusively on the **CONVERSATION HISTORY** region. Everything above (slots) and below (ephemeral, current prompt) is untouched.

---

## Three-Layer Compaction

### Layer 1: Tool Result Trimming ("Microcompaction")

**What**: Progressively reduce the footprint of old tool results in conversation history. Tool results (file reads, grep outputs, bash outputs, web fetches, MCP tool responses) are typically the largest individual items and dominate context usage.

**When**: Before every LLM call, inside the `transformContext` hook. Runs as an in-memory pre-pass before token counting. The conversation history on disk / in the session transcript is **never modified** by microcompaction (following OpenClaw's pattern). Only the context sent to the model is affected.

**Critical insight**: The agent's own text responses (assistant messages where it reasons about, synthesizes, and discusses tool results) are **never touched** by microcompaction. Only tool_result content blocks are candidates. This means that research findings, analysis, and conclusions the agent has already articulated in its own words survive regardless of what happens to the raw tool output. 

**How** (three tiers, applied per tool result based on age and size):

**Tier 1: Insertion-time cap** (always active)
Large tool results are truncated at insertion time before entering conversation history. Results exceeding `maxResultTokens` (default: 50,000 tokens) are truncated to head + tail with a marker in between. This prevents a single enormous result from destabilizing the context. This tier has zero cache impact since it runs at insertion, not in `transformContext`.

**Tier 2: Semantic bookends** (soft trim, threshold-triggered)
When total context usage crosses `softTrimThreshold` (default: 40% of context window), a batch re-evaluation fires. All tool results outside the recency window are assigned tiers based on their distance from the current turn:

- **Recent window** (last N turns): Full, untouched
- **Bookend window** (next N turns beyond recent): Reduced to first `bookendSize` chars + last `bookendSize` chars, joined by a token count note
- **Old window** (beyond bookend window): Replaced with placeholder

```
[First 2,000 chars of original result]

... [~8,500 tokens trimmed] ...

[Last 2,000 chars of original result]
```

**Tier 3: Placeholder replacement** (hard clear)
The oldest tool results (beyond the bookend window) are replaced with a one-line placeholder preserving only the tool name and a brief preview:

```
[Tool result trimmed — web_search: "context compaction techniques 2026" — see assistant response below for findings]
```

### Threshold-Triggered Batch Processing

Microcompaction does NOT modify history on every LLM call. It checks the threshold on every `transformContext` call but only **acts** at discrete threshold crossings. Between crossings, the previously computed trim state is replayed identically, preserving prefix cache.

**Thresholds**: Derived from the two config values: `softTrimThreshold` (default: 0.40), a midpoint at `(softTrimThreshold + hardClearThreshold) / 2` (default: 0.50), and `hardClearThreshold` (default: 0.60). At each crossing, a full re-evaluation pass assigns tiers to all tool results based on their distance from the current turn. The tier boundaries naturally advance as more turns accumulate.

```
Tick 1-9:   Context < 40%. All tool results full. Cache builds.

Tick 10:    Context crosses 40%. Batch re-evaluation fires.
            Oldest results → placeholder. Middle → bookends. Recent → full.
            Cache invalidated once, then rebuilds.

Tick 11-17: Content stable. Cache rebuilds on trimmed history.

Tick 18:    Context crosses 50%. Batch re-evaluation fires.
            Tier boundaries advance. More results bookended/placeholdered.
            Cache invalidated once, then rebuilds.

Tick 19-24: Content stable. Cache rebuilds.

Tick 25:    Context crosses 60%. Batch re-evaluation fires.
            Most old results are now placeholders.
            Cache invalidated once, then rebuilds.

Tick 26-33: Content stable. Cache rebuilds.

Tick 34:    Context crosses 70%. Layer 2 (full summarization) fires.
```

Between threshold crossings, the entire trimmed conversation is identical on every call. The provider caches all of it. Cache invalidation happens once per threshold crossing, then rebuilds immediately.

**Recency window**: The most recent `microcompaction.preserveRecentTurns` assistant turns (default: 5) are fully protected from all trimming at every re-evaluation. Only tool results older than this window are candidates. Note: this is a separate config from `compaction.preserveRecentTurns` (default: 6), which controls how many turns are kept as the preserved tail during Layer 2 summarization. The microcompaction recency window is typically slightly smaller since it only protects tool results, while the compaction preserved tail protects entire turns including user messages.

**Tool-type-aware retention**: Different tool types have different retention value based on whether their output is reproducible:

| Category | Examples | Retention | Rationale |
|----------|----------|-----------|-----------|
| Re-readable | File reads, directory listings | Shorter (standard window) | Agent can re-read the file if needed |
| Non-reproducible | Web searches, web fetches, API calls, Bash commands | Longer (2x standard window) | Cannot be re-fetched; page may change, costs an API call, or may have side effects |
| Ephemeral | Sub-agent results, task output | Shorter (standard window) | Stale quickly, re-runnable |
| Computational | Math, code execution results | Standard window | Small, but non-reproducible without re-running |

The consumer (backend) can register tool categories when configuring Cortex. Unregistered tools default to standard retention.

**Cost**: Zero LLM calls. Pure string operations.

**Configuration**:
```typescript
interface MicrocompactionConfig {
  maxResultTokens: number;             // default: 50_000 (insertion-time cap)
  softTrimThreshold: number;           // default: 0.40 (40% of context window)
  hardClearThreshold: number;          // default: 0.60 (60% of context window)
  bookendSize: number;                 // default: 2_000 (chars kept at each end)
  preserveRecentTurns: number;         // default: 5
  extendedRetentionMultiplier: number; // default: 2 (for non-reproducible tools)
  toolCategories?: Record<string, 'rereadable' | 'non-reproducible' | 'ephemeral' | 'computational'>;
  persistResult?: PersistResultFn;     // optional callback for disk persistence of cleared results
  maxAggregateTurnTokens?: number;     // default: 150_000 (per-message aggregate cap)
}
```

**Rationale**: This graduated approach avoids the "cliff edge" of aggressive clearing. The key findings from industry research:

- **JetBrains (NeurIPS 2025)**: Simple observation masking matches LLM summarization at zero cost for SE agents, reducing cost ~50% without performance degradation. But the masking should be graduated, not all-or-nothing.
- **OpenClaw**: Uses semantic bookends (first/last 1,500 chars) as soft-trim before hard-clearing. In-memory only; disk transcript stays intact. This preserves the most structurally useful parts of tool output.
- **Claude Code**: Only clears tool results, never assistant text. The agent's own synthesis is the natural "distillation" that survives clearing.
- **LangChain Deep Agents**: Prioritizes offloading over lossy summarization. Three-tier graduated strategy.

### Layer 2: Conversation Summarization ("Compaction")

**What**: Summarize older conversation history into a structured summary while preserving a small tail of recent turns. The preserved tail keeps recent tool call/result pairs intact (which only exist in conversation history, not in any database). The backend then re-seeds the gap between observation watermarks and the preserved tail with messages from `messages.db`.

**When**: When estimated token usage exceeds `compactionThreshold` (default: 70% of context window) after Layer 1 has run.

**How**:

1. **Threshold check**: After microcompaction, estimate total context size (slots + cleared history + ephemeral estimate). If `estimatedTokens > model.contextWindow * compactionThreshold`, trigger compaction.

2. **Partition history**: Split conversation history into two regions:
   - **Compaction target**: All turns except the most recent `preserveRecentTurns` (default: 6 turns, roughly the last 1-2 ticks worth of exchanges including tool call/result pairs)
   - **Preserved tail**: The most recent turns, kept verbatim. This is the only mechanism that preserves recent tool call/result pairs, which do not exist in `messages.db` or any other database.

3. **Pre-compaction event**: Emit `onBeforeCompaction` with the compaction target. This is the backend's signal to:
   - Trigger observational memory processing for any unprocessed raw items (synchronous, awaited)
   - Flush any other critical state to disk/database

4. **Generate summary**: Make a direct `pi-ai` call (not through the agent loop) with the compaction target and the summarization prompt. Uses the same model as the main agent session. The compaction target is sourced from the **original session transcript** (not the in-memory microcompacted version), so the summarizer has access to full tool result content for high-quality compression. The summarization response is not added to the agent's conversation history.

5. **Replace history**: Replace the compaction target in the agent's conversation history with a single `user`-role message containing the tagged summary. The new conversation history becomes: `[summary message] + [preserved tail]`.

6. **Post-compaction event**: Emit `onPostCompaction` with metadata (tokens before, tokens after, summary content, oldest preserved turn timestamp). The backend uses this to:
   - Re-seed messages from `messages.db` that fall in the gap between the observation watermark and the preserved tail's oldest timestamp
   - Update any internal state that depends on conversation history

7. **Update token tracking**: Reset `sessionTokenCount` based on the new history size.

**Why a preserved tail**: Tool call/result pairs only exist in conversation history. `messages.db` stores user-facing messages and agent replies, not tool calls. Without a preserved tail, the agent would lose all recent tool context after compaction, retaining only the summary's prose description. The preserved tail keeps the last 1-2 ticks of full-fidelity context including structured tool data.

**Summary tagging**: The compaction summary is wrapped in a clear marker so the agent knows it's reading a summary, not a real conversation turn. If multiple compactions occur, each is identifiable:

```xml
<compaction-summary generated="2026-03-15T10:30:00Z" turns-summarized="24">
...summary content...
</compaction-summary>
```

**Summarization prompt**: The default prompt is general-purpose (Cortex may be used outside of Animus). It follows Claude Code's proven pattern: require an `<analysis>` scratchpad first (stripped from the final output), then a structured `<summary>` with explicit sections. Consumers can override via `customPrompt`.

The prompt requires 11 sections:
1. **Primary Request and Intent** - All user requests, preserved verbatim
2. **Key Technical Concepts** - Technologies and frameworks discussed
3. **Files and Code Sections** - Specific files with paths, snippets, and why each matters
4. **Tool Call Outcomes** - What tools were called, what they returned, errors encountered
5. **Errors and Fixes** - Every error and its resolution, including user corrections
6. **All User Messages** - ALL non-tool-result user messages listed (critical for preserving intent)
7. **Problem Solving** - Problems solved and ongoing troubleshooting
8. **Pending Tasks** - Explicitly requested but not yet completed
9. **Current Work** - Exactly what was being worked on right before compaction (most important section)
10. **Key Decisions (Cumulative)** - Carried forward across compactions to prevent progressive loss
11. **Optional Next Step** - Only if directly aligned with the user's most recent request

**Output parsing**: The model produces `<analysis>` (private reasoning scratchpad) then `<summary>` (the actual summary). The analysis is stripped; only the summary content is kept and wrapped in the `<compaction-summary>` tag.

**Animus-specific override**: The Animus backend can provide a `customPrompt` via config that narrows the focus (e.g., skip "All User Messages" since message-observations already cover them).

**Configuration**:
```typescript
interface CompactionConfig {
  threshold: number;                   // default: 0.70 (70% of context window)
  preserveRecentTurns: number;         // default: 6 (last ~1-2 ticks, includes tool calls)
  customPrompt?: string;              // optional: replace default summarization prompt
}
```

**Rationale**: Claude Code's pattern of structured summarization with post-compaction rehydration is the most battle-tested approach. Factory.ai's evaluation across 36,000+ messages confirmed that domain-structured summarization outperforms generic compression. The 70% threshold is earlier than Claude Code's ~75-83% and Codex's 95%, deliberately trading some context capacity for quality preservation (models degrade before hitting the limit).

### Layer 3: Emergency Truncation ("Failsafe")

**What**: If compaction itself fails or the context is still too large after compaction, drop the oldest conversation turns.

**When**: After a compaction attempt, if `estimatedTokens > model.contextWindow * 0.90` (90% of window). Also triggers reactively if the API returns a context overflow error (detected via pi-ai's `isContextOverflow()` utility).

**How**:
- Remove the oldest conversation turns (post-slot region) one at a time
- Preserve structural integrity: if a turn contains a tool call, also remove its corresponding tool result (and vice versa)
- Log a warning for each removed turn
- Continue until estimated tokens drop below the 90% threshold

**Cost**: Zero LLM calls. Lossy but deterministic.

**Rationale**: This is a safety net, not a primary strategy. Codex uses the same pattern (`remove_first_item()` with structural pair preservation). It should rarely fire if Layers 1 and 2 are configured correctly.

---

## Compaction Lifecycle Events

Cortex exposes these events for backend coordination:

```typescript
interface CompactionEvents {
  // Fired before compaction starts. Awaited.
  // Backend should flush observational memory and any critical state.
  onBeforeCompaction: (target: CompactionTarget) => Promise<void>;

  // Fired after compaction completes.
  // Backend should re-seed messages and update internal state.
  onPostCompaction: (result: CompactionResult) => void;

  // Fired if compaction fails (LLM error, timeout, etc.)
  onCompactionError: (error: Error) => void;

  // Fired when Layer 2 failed and Layer 3 (emergency truncation) was used as fallback.
  // Context quality is degraded but the session continues.
  onCompactionDegraded: (info: { layer2Failures: number; turnsDropped: number }) => void;

  // Fired when all compaction layers have failed.
  // Consumer should take recovery action (e.g., pause heartbeat, abort session).
  onCompactionExhausted: (info: { error: Error; layer2Failures: number }) => void;
}

interface CompactionTarget {
  turnsToCompact: number;          // how many turns will be summarized
  estimatedTokens: number;         // estimated tokens in the compaction target
}

interface CompactionResult {
  tokensBefore: number;
  tokensAfter: number;
  turnsCompacted: number;
  turnsPreserved: number;
  summaryTokens: number;
  oldestPreservedTimestamp: string | null; // ISO timestamp of oldest turn in preserved tail (null if no timestamp found)
  oldestPreservedIndex: number;            // index of oldest preserved turn for reliable fallback
  summary: string;                         // the generated summary content
}
```

---

## Integration with Observational Memory

The observational memory system is a domain-specific compaction layer that operates independently of conversation history compaction, but the two must be coordinated.

### Current Flow (Pre-Cortex)

```
GATHER:   Load observation watermarks -> fetch raw items since watermark
          -> budget raw items by token count -> inject into context

EXECUTE:  Fire-and-forget processAllStreams()
          -> Observer compresses overflow into date-grouped summaries
          -> Reflector compresses summaries if they exceed budget
          -> Watermark advances
```

### Coordinated Flow (With Cortex)

```
GATHER:   Same as current. Observations loaded into slots, raw items
          appended after observations. All via ContextManager.setSlot().

TICK:     Cortex runs the 5-phase pipeline (THOUGHT -> LOOP -> REFLECT).
          Conversation history grows.

BEFORE COMPACTION (Layer 2 triggers):
          Cortex emits onBeforeCompaction.
          Backend handler:
            1. Runs processAllStreams() synchronously (not fire-and-forget)
            2. Awaits completion so watermarks advance
            3. Updates observation slots via ContextManager.setSlot()
          This ensures raw items that are about to be lost from conversation
          history have been compressed into observation summaries first.

POST-COMPACTION:
          Cortex emits onPostCompaction.
          Backend handler:
            1. Queries messages.db for post-watermark messages
            2. Formats as conversation turns
            3. Injects after the compaction summary via Cortex API
          This re-seeds the conversation with recent message history.

EXECUTE:  Observational memory processing runs as usual (fire-and-forget)
          for any new items generated during this tick.
```

### Why Observational Memory Stays in the Backend

Thoughts, experiences, and messages are domain concepts unique to Animus. They have their own database schemas, watermark tracking, token budgets, and compression agents (Observer/Reflector). Cortex has no knowledge of these concepts and should not need to.

The `onBeforeCompaction` / `onPostCompaction` event contract is the clean boundary:
- Cortex says "I'm about to compact" and "I just compacted"
- The backend does whatever domain-specific work is needed
- Cortex doesn't care what that work is

This also means other consumers of Cortex (non-Animus applications) can implement their own pre/post compaction hooks without any Animus-specific logic leaking into the shared package.

---

## Token Tracking

Cortex tracks tokens through two complementary mechanisms:

### Post-Hoc Tracking
After every LLM call, read `AssistantMessage.usage` to get the actual token count. This is authoritative but only available after the call completes. Cortex auto-wires this internally: the EventBridge intercepts `turn_end` events from pi-agent-core, extracts usage data, and updates the compaction manager's token count. No consumer wiring is needed.

```typescript
sessionTokenCount = response.usage.input_tokens;
```

Note: this is an assignment, not an addition. `usage.input_tokens` reflects the total input size for that call, not a delta.

### Heuristic Estimation
Between LLM calls, estimate context size for proactive compaction decisions:

```typescript
function estimateTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).length * 1.3);
}
```

Used for:
- Deciding whether to trigger Layer 1/2 before the next call
- Estimating the compaction target size
- Estimating post-compaction size to verify compaction was effective

### Token Budget Awareness

Cortex needs to know the model's context window size. This comes from pi-ai's model metadata:

```typescript
const contextWindow = model.contextWindow;  // e.g., 200_000
const compactionThreshold = contextWindow * config.compaction.threshold;
```

---

## Compaction Is Autonomous

Cortex is a standalone package with no knowledge of the backend's pipeline, ticks, or phases. It is always an agentic loop. Compaction runs entirely within Cortex's `transformContext` hook, which fires before every LLM call in the loop.

### All Layers Fire in `transformContext`

Every LLM call in the agentic loop triggers `transformContext`. Inside that hook, compaction checks thresholds and acts:

```
Every LLM call in the agentic loop:
  transformContext fires:
    1. Tier 1 insertion-time cap (mutates agent.state.messages)
    2. Ephemeral context injection
    3. Sanitize messages
    4. Layer 1: Microcompaction (in-memory, threshold-triggered at 40/50/60%)
    5. Layer 2: Summarization (if tokens > 70%, modifies agent.state.messages)
    6. Layer 3: Emergency truncation (if tokens > 90%)
    7. Return final context to model
```

- **Layer 2 runs mid-loop.** The hook is async, so the summarization LLM call happens inline. When Layer 2 fires, it modifies `agent.state.messages` (the persistent transcript), emits `onBeforeCompaction` (awaited) and `onPostCompaction` events, then rebuilds the context from the updated messages. The agentic loop continues seamlessly from the compacted state.
- **Layer 3 runs unconditionally at 90%.** No phase check. If context exceeds 90% of the context window, emergency truncation fires regardless of what else has happened.
- **There is no `setPipelinePhase` or external trigger.** Cortex has no concept of pipeline phases. Compaction is self-contained.

### Events Are Notifications, Not Triggers

When Layer 2 fires (whether mid-loop or at any other point), Cortex emits:
- `onBeforeCompaction` (awaited): The consumer can flush state (e.g., Animus flushes observational memory)
- `onPostCompaction`: The consumer can re-seed messages or update internal state

These events flow UP from Cortex to the consumer. The consumer never triggers compaction; it only reacts to it.

### Relationship to the 5-Phase Pipeline (Animus-Specific)

The Animus backend runs a 5-phase pipeline (THOUGHT, AGENTIC LOOP, REFLECT, EXECUTE). Of these, only the AGENTIC LOOP goes through Cortex (via `agent.prompt()`). THOUGHT and REFLECT are direct pi-ai calls that bypass the agent entirely and do not add to conversation history. EXECUTE is backend logic (database writes, decision execution). Cortex is unaware of any of this.

Compaction fires during the AGENTIC LOOP because that is when `transformContext` runs. If the loop generates enough context to cross thresholds, compaction fires automatically. After the loop completes and the backend runs EXECUTE, there is nothing for Cortex to do: it already compacted during the loop if needed.

---

## Progressive Loss Mitigation

Every compaction system suffers from "summarizing summaries" degradation. After 3+ compactions, early context is effectively gone. Mitigation strategies:

### 1. Slots as Durable Memory
The slot system is the primary defense against progressive loss. Information that matters long-term should be in slots (core-self, working-memory, observation summaries), not in conversation history. Slots are never compacted.

### 2. Observational Memory as Pre-Compaction Safety Net
The `onBeforeCompaction` hook ensures that domain-specific context (thoughts, experiences, messages) is compressed into observation summaries before it is lost from conversation history. These summaries live in slots and survive indefinitely.

### 3. Cumulative Summary Section
Following the Codex community proposal (Issue #14347), the summarization prompt includes a "Key Decisions" section that is explicitly instructed to be preserved across compactions. Each compaction carries forward the previous summary's key decisions, appending new ones. This creates a rolling log of important decisions that compounds rather than decays.

### 4. External State as Ground Truth
File system state, database records, and git history are the authoritative record of what happened. Compaction summaries are a convenience for the agent's reasoning, not the source of truth. The backend can always reconstruct context from databases (which is exactly what the slot system does).

### 5. Infinite Sessions
There is no compaction limit. Sessions can run indefinitely, compacting as many times as needed. Each compaction re-compresses the previous summary alongside new turns into a single fresh summary. The Key Decisions section accumulates across compactions to preserve important decisions. Natural quality degradation of older content is acceptable: the slot system (observations, working memory, core self) captures durable long-term context independently of the conversation summary.

---

## Configuration Summary

```typescript
interface CortexCompactionConfig {
  microcompaction: {
    maxResultTokens: number;             // default: 50_000 (insertion-time cap)
    softTrimThreshold: number;           // default: 0.40 (40% of context window)
    hardClearThreshold: number;          // default: 0.60 (60% of context window)
    bookendSize: number;                 // default: 2_000 (chars per end)
    preserveRecentTurns: number;         // default: 5
    extendedRetentionMultiplier: number; // default: 2 (for non-reproducible tools)
    toolCategories?: Record<string, 'rereadable' | 'non-reproducible' | 'ephemeral' | 'computational'>;
    persistResult?: PersistResultFn;     // optional: persist cleared results to disk
    maxAggregateTurnTokens?: number;     // default: 150_000 (per-message aggregate cap)
  };
  compaction: {
    threshold: number;                   // default: 0.70 (70% of context window)
    preserveRecentTurns: number;         // default: 6 (last ~1-2 ticks, includes tool calls)
    customPrompt?: string;              // optional: custom summarization prompt
    maxRetries?: number;                // default: 3 (Layer 2 retry attempts)
    retryDelayMs?: number;              // default: 2000 (delay between retries)
  };
  failsafe: {
    threshold: number;                   // default: 0.90
  };
  adaptive: {
    enabled: boolean;                    // default: false
    minThreshold: number;               // default: 0.50 (lowest Layer 2 can drop to)
    idleMinutes: number;                // default: 30 (minutes of inactivity before lowering)
  };
}
```

**Adaptive threshold** (optional): When enabled, lowers the Layer 2 compaction threshold during idle periods. After `idleMinutes` of no user interaction, the threshold gradually drops from the configured 70% toward `minThreshold` (default: 50%). This proactively compacts during autonomous interval ticks when the user isn't actively engaged, keeping context lean for when they return. Disabled by default.

Compaction is always active. There are no `enabled` toggles. The summarization model is always the same model used by the main agent session. Microcompaction operates in-memory only; the session transcript on disk is never modified.

---

## Observability

All compaction activity is logged and surfaced:

- **Agent logs**: Each compaction event is logged to `agent_logs.db` with before/after token counts, summary content, and timing
- **Frontend**: The tick timeline shows compaction events as distinct entries with expandable summary content
- **Metrics**: Token usage breakdown (slots, history, ephemeral, cleared tool results) available via the context manifest pattern already used by the context builder

---

## Implementation Sequence

This should be implemented as part of **Phase 5: Compaction** in the pi-agent-core migration plan:

1. **Token tracking**: Add `estimateTokens()` utility and post-hoc token tracking to `ContextManager`
2. **Layer 1 (Microcompaction)**: Implement tool result clearing in `transformContext`
3. **Layer 2 (Compaction)**: Implement summarization pipeline with event hooks
4. **Layer 3 (Failsafe)**: Implement emergency truncation
5. **Backend integration**: Wire `onBeforeCompaction` / `onPostCompaction` handlers in the heartbeat pipeline for observational memory coordination and message re-seeding
6. **Observability**: Add compaction events to agent logs and frontend tick timeline

---

## Resolved Decisions

### Uniform Microcompaction (All Providers)

Microcompaction runs at threshold crossings (40%, 50%, 60%) for all providers, regardless of caching discount. This keeps the system simple and uniform rather than branching behavior based on provider capabilities.

**Cost analysis** (modeled on a 200K context window, 34-tick session):

```
                    90% cache    50% cache    No cache
                    (Anthropic)  (OpenAI)     (other)
                    ─────────    ─────────    ────────
No microcompaction:  707K eff.    1,250K       2,983K
With microcompaction: 841K eff.   1,020K       2,450K

Difference:          +19%         -18%         -18%
```

With strong caching (90% discount), microcompaction is ~19% more expensive due to cache invalidation at threshold crossings. With weaker or no caching, microcompaction is ~18% cheaper. The decision to use microcompaction uniformly trades a modest cost increase on Anthropic for simplicity, consistency, and the benefit of delaying full compaction (Layer 2) by ~12 additional ticks across all providers.

### Preserved Tail + Gap Re-Seeding

Layer 2 compaction preserves the most recent `preserveRecentTurns` (default: 6) turns verbatim. This is necessary because tool call/result pairs only exist in conversation history; `messages.db` stores user-facing messages and agent replies but not tool calls. Without a preserved tail, the agent would lose all structured tool context after compaction.

The backend's `onPostCompaction` handler re-seeds the **gap** between the observation watermark and the preserved tail. The `CompactionResult` includes `oldestPreservedTimestamp`, which the backend uses to query only messages from `messages.db` where `createdAt > observation.lastRawTimestamp AND createdAt < oldestPreservedTimestamp`. This prevents duplication: re-seeded messages cover the gap, the preserved tail covers recent context, and there is no overlap.

**Responsibility split:**
- **Cortex**: Preserves recent turns (the only source of tool call/result pairs)
- **Backend**: Fills the gap between observation watermark and preserved tail with messages from `messages.db`

### Summarization Model

Compaction should use the same model as the main session. The conversation history summary is the only record of what happened during agentic loops (tool calls, decisions, reasoning chains). Quality matters significantly here, unlike observational memory compression where the Observer/Reflector use Haiku because they are compressing simple timestamped items into date-grouped summaries. Conversation history is structurally complex (interleaved tool calls, multi-turn reasoning) and a lower-tier model would lose critical details. This aligns with Claude Code's approach of using the same model for summarization.

### Sub-Agent Compaction

Sub-agents are full Cortex instances and inherit the parent's compaction config. Compaction is not optional for any Cortex instance; it is a core feature baked into the system. There is no `enabled: false` toggle. Sub-agents may run longer than expected (complex research tasks, multi-step workflows), and without compaction they would hit the same context overflow problems as the mind.

### Message Re-Seeding Granularity

Message re-seeding after compaction follows the same watermark pattern used by the observational memory system. The observational memory stores a `lastRawTimestamp` watermark in `memory.db` that tracks the newest message that has been compressed into an observation summary. Messages newer than this watermark are "post-watermark" items that exist as full messages in context, not yet compressed.

This is entirely a backend operation, not a Cortex concern. Cortex has no knowledge of `messages.db`, contacts, watermarks, or observational memory. It emits the `onPostCompaction` event; the backend's handler does the re-seeding.

After compaction, the backend's `onPostCompaction` handler re-seeds the gap:
1. Queries `messages.db` for the active contact's messages where `createdAt > observation.lastRawTimestamp AND createdAt < oldestPreservedTimestamp` (the gap between the observation watermark and the preserved tail)
2. These are the messages that have NOT been compressed into observation summaries and are NOT already in the preserved tail
3. Formats them as conversation turns and injects between the compaction summary and the preserved tail via Cortex's API
4. Applies the same `rawTokens` budget (default: 4,000 tokens for messages) to cap the re-seeded amount

This is the natural boundary: if a message has already been compressed into an observation summary (which lives in a slot and survives compaction), it does not need to be re-seeded. Only messages newer than the watermark need full representation in conversation history.

```
After compaction + re-seeding, conversation history looks like:

<compaction-summary generated="..." turns-summarized="18">
  ...structured summary of tool history, reasoning, user instructions...
</compaction-summary>

[Re-seeded message from messages.db]   -- in the gap: after watermark, before tail
[Re-seeded message from messages.db]   -- (only if gap exists)
...                                     -- up to rawTokens budget (4K default)
[Preserved tail turn 1]                -- recent user message (tick prompt)
[Preserved tail turn 2]                -- recent assistant response + tool calls
[Preserved tail turn 3]                -- recent tool results
...                                     -- last ~6 turns, full fidelity
[Current tick prompt]                   -- ephemeral, not stored
```

Three layers of coverage, no duplication:
- **Observation slots** provide compressed coverage of everything older than the watermark
- **Re-seeded messages** fill the gap between the watermark and the preserved tail
- **Preserved tail** provides full-fidelity recent context including tool call/result pairs
- **Summary** carries tool history, reasoning, and user instructions from the compacted region

---

## Circuit Breaker

If Layer 2 (LLM summarization) fails, Cortex retries up to `maxRetries` times (default 3) with a configurable delay (`retryDelayMs`, default 2000ms) between attempts. This all happens mid-loop inside `applyInTransformContext`.

**Failure cascade:**

1. Layer 2 fails once: retry after delay.
2. Layer 2 fails `maxRetries` times: fall through to Layer 3 (emergency truncation).
3. Layer 3 succeeds: emit `onCompactionDegraded` with `{ layer2Failures, turnsDropped }`. The session continues but context quality is degraded.
4. Layer 3 also fails (or tokens remain over budget): emit `onCompactionExhausted` with `{ error, layer2Failures }`. The consumer should take recovery action (e.g., pause heartbeat, abort session).

A successful Layer 2 compaction resets the consecutive failure counter.

**Configuration** (in `CompactionConfig`):
- `maxRetries`: number (default 3)
- `retryDelayMs`: number (default 2000)

**Events** (registered via `CortexAgent.onCompactionDegraded()` / `onCompactionExhausted()`):
- `onCompactionDegraded`: Layer 2 failed, Layer 3 was used as fallback
- `onCompactionExhausted`: all compaction layers failed

---

## Disk Persistence for Cleared Tool Results

When microcompaction clears or replaces a non-reproducible or computational tool result (at the `placeholder` or `clear` threshold), the original content can optionally be persisted to disk via a consumer-provided callback.

**Motivation:** Non-reproducible results (WebFetch, Bash) cannot be re-fetched. Once cleared from the model's view, the content is lost. Disk persistence lets the agent Read the content back if it needs to reference it during the current session. The persisted files also survive Layer 2 compaction, which replaces the source transcript entirely.

**Configuration** (in `MicrocompactionConfig`):
- `persistResult`: `PersistResultFn` callback (optional). The consumer implements the I/O and returns the file path.

**Behavior:**
- When `persistResult` is set and a `placeholder` or `clear` action is applied to a non-reproducible or computational result, the callback is invoked with the full original content.
- The replacement text includes the file path: `[Tool result persisted -- {toolName}: "{preview}" -- use Read on {path} for full content]`
- Rereadable results (Read, Glob, Grep) are NOT persisted since the agent can re-invoke the tool.
- If the callback throws, standard placeholder/clear text is used as fallback.

---

## Aggregate Per-Turn Token Budget

In addition to the per-result insertion cap (`maxResultTokens`, default 50K), an aggregate cap limits the total tokens across all tool results in a single message.

**Motivation:** A single agentic loop turn with many parallel tool calls (e.g., 10 file reads at 50K each = 500K) can overwhelm context before microcompaction evaluates.

**Configuration** (in `MicrocompactionConfig`):
- `maxAggregateTurnTokens`: number (default 150,000)

**Behavior:**
- After individual per-result caps are applied, the aggregate token count for all tool results in the message is computed.
- If the aggregate exceeds `maxAggregateTurnTokens`, the largest results are bookended (head + tail) until the total is under budget.
- If `persistResult` is configured, full content is persisted to disk before bookending, and the bookended text includes a reference to the persisted file.
