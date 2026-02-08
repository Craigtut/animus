# Animus: Memory System

The memory system gives Animus persistent, retrievable knowledge across four distinct layers — modeled after human cognition. Each layer has a clear purpose, lifecycle, and storage location. Together they allow the mind to maintain cognitive continuity within a session, remember what it's learned about each contact, build a persistent understanding of itself, and retrieve deep historical knowledge when relevant.

## The Four Memory Layers

| Layer | Cognitive Analog | What It Holds | Always in Context? | Storage |
|-------|-----------------|---------------|-------------------|---------|
| **Short-term** | Human short-term / working memory | Last ~10 thoughts, experiences, messages | Yes (loaded every tick) | `heartbeat.db` + `messages.db` |
| **Working memory** | Relationship knowledge | Per-contact notepad: who they are, preferences, history | Yes (for current contact) | `memory.db` |
| **Core self** | Self-awareness / identity | Agent's accumulated self-knowledge and observations | Yes (every tick) | `memory.db` |
| **Long-term** | Episodic + semantic memory | Facts, experiences, procedures, outcomes | No (retrieved via search) | `memory.db` + LanceDB |

---

## Short-Term Memory

Short-term memory is the raw, unprocessed recent context that keeps the mind cognitively coherent across ticks. It answers the question: *"What just happened?"*

### What It Contains

- **Recent thoughts** (last ~10, timestamped) — the mind's own stream of consciousness
- **Recent experiences** (last ~10, timestamped) — notable events from recent ticks
- **Recent messages** (last ~10, from the triggering contact only) — the ongoing conversation
- **Recent emotion state** — current emotional intensities after decay
- **Previous tick outcomes** — what was decided last tick, what actually happened

### How It Works

Short-term memory is **not a separate system** — it's the direct loading of recent records during GATHER CONTEXT. These are complete, timestamped, unsummarized entries pulled straight from `heartbeat.db` and `messages.db`. They give the mind a sense of cognitive continuity, like a human remembering what they were just thinking about.

Short-term memory is what allows the mind to process a coherent string of thoughts across multiple ticks. Without it, every tick would be a cold start with no awareness of what happened moments ago.

### Lifecycle

- **Created**: Thoughts and experiences during MIND QUERY; messages during channel ingestion
- **Loaded**: GATHER CONTEXT pulls the most recent N entries
- **Expired**: TTL cleanup (default 30 days for thoughts/experiences; messages persist in messages.db)

No design changes needed — this layer is already implemented in the heartbeat pipeline. Naming it "short-term memory" gives it conceptual clarity.

---

## Working Memory

Working memory is a per-contact notepad that the mind reads and writes to maintain an evolving understanding of each person it interacts with. It answers the question: *"Who am I talking to, and what do I know about them?"*

### What It Contains

A free-form text block per contact. The mind organizes it however makes sense. Typical content:

- Name, relationship, how they prefer to communicate
- Interests, likes, dislikes
- Important life events mentioned in conversation
- Communication preferences ("prefers concise responses", "uses a lot of humor")
- Ongoing topics or projects
- Anything the mind judges worth remembering about this person

### How It Works

Working memory is **always loaded** for the current contact during GATHER CONTEXT. The mind sees it alongside the conversation history and can update it as part of its structured output.

**Read**: GATHER CONTEXT loads the triggering contact's working memory block into the mind's context.

**Write**: The mind optionally outputs a `working_memory_update` in its structured output — a full content replacement of the contact's notepad. If no update is output, nothing changes. Full replacement is the simplest approach: no diffing, no append bugs, no section management. The notepad is small enough (capped at ~2000 tokens) that outputting the full content is acceptable.

**Sub-agent access**: Sub-agents receive a read-only snapshot of the contact's working memory in their prompt template. They do not have write access — only the mind updates working memory.

### Pipeline Integration

```
GATHER CONTEXT                    MIND QUERY                    EXECUTE
┌─────────────────────┐          ┌────────────────────┐        ┌─────────────────────────┐
│                     │          │                    │        │                         │
│ Load contact's      │          │ Mind sees notepad  │        │ If working_memory_update │
│ working memory      │    ──→   │ + conversation     │  ──→   │ present: persist full    │
│ from memory.db      │          │                    │        │ replacement to memory.db │
│                     │          │ Optionally outputs │        │                         │
│                     │          │ working_memory_    │        │                         │
│                     │          │ update with new    │        │                         │
│                     │          │ full content       │        │                         │
└─────────────────────┘          └────────────────────┘        └─────────────────────────┘
```

### Context Presentation

Working memory is presented to the mind with clear framing:

```
── ABOUT THIS CONTACT ──
Contact: Mom (Sarah)
Tier: Standard

Your notes about Sarah:
Sarah is Craig's mother. She lives in Portland and works as a
high school English teacher. She's tech-curious but not tech-savvy.
She prefers short, clear responses — no jargon. She's been
dealing with some back pain lately. Loves gardening and mystery
novels. Gets worried easily — be reassuring when discussing
anything that sounds concerning.

You can update these notes as you learn more about Sarah.
──────────────────────────
```

### Storage

Working memory lives in `memory.db`:

```sql
CREATE TABLE working_memory (
  contact_id TEXT PRIMARY KEY,          -- FK reference to system.db contacts.id
  content TEXT NOT NULL DEFAULT '',     -- Free-form notepad content
  token_count INTEGER DEFAULT 0,       -- Tracked for context budget
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

A row is created for each contact on first interaction (or when the primary contact is created during onboarding). The content starts empty and grows as the mind learns about the contact.

**Size cap**: ~2000 tokens. If the mind outputs content exceeding this, EXECUTE truncates to the cap and logs a warning. This prevents working memory from consuming too much of the context budget.

---

## Core Self

Core self is the agent's persistent, accumulated self-knowledge — distinct from the user-configured persona. The persona says *"you are curious and analytical"* (user-defined identity). Core self says *"I've noticed I tend to overthink simple requests"* (self-discovered knowledge). It answers the question: *"What have I learned about myself?"*

### What It Contains

A free-form text block that the mind maintains. Typical content:

- Observations about its own behavioral patterns
- Learned preferences about how to be helpful ("Craig prefers when I lead with the answer, then explain")
- Reflections on relationships and dynamics
- Notes about what strategies work well ("checking YouTube stats is most useful in the evening after upload")
- Accumulated wisdom from goal pursuit and task execution

### How It Works

Core self is **always loaded** during GATHER CONTEXT — every tick, regardless of which contact triggered it. It's part of the mind's foundational context, alongside persona.

**Read**: GATHER CONTEXT loads core self into the mind's context, positioned after the persona block.

**Write**: The mind optionally outputs a `core_self_update` in its structured output — same full-replacement mechanism as working memory. If no update is output, nothing changes.

**Sub-agent access**: Sub-agents receive a read-only snapshot of core self in their prompt template, so they share the mind's self-understanding.

### Context Presentation

```
── YOUR SELF-KNOWLEDGE ──
These are things you've learned about yourself over time.
They complement your personality — observations, patterns,
and wisdom you've accumulated through experience.

Craig and I work best when I'm direct. He doesn't want
caveats or hedging — just the answer, then the reasoning
if he asks. I've gotten better at this.

I tend to be more creative during idle ticks when there's
no pressure to respond. My best ideas for goals come when
I'm just thinking freely.

Evening is the best time to check Craig's YouTube stats —
the daily numbers have settled by then.

You can update these notes as you learn more about yourself.
──────────────────────────
```

### Storage

Core self lives in `memory.db`:

```sql
CREATE TABLE core_self (
  id INTEGER PRIMARY KEY CHECK (id = 1),  -- Singleton
  content TEXT NOT NULL DEFAULT '',
  token_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Single row, seeded on first startup with empty content. The mind populates it over time.

**Size cap**: ~2000 tokens, same as working memory.

### Relationship to Persona

The persona is the user-configured soul — archetype, dimensions, traits, values, background. Core self is the agent's emergent self-awareness. They are complementary:

- **Persona**: "You are curious, analytical, and slightly sarcastic" (user writes this)
- **Core self**: "I've noticed my sarcasm lands better in Discord than SMS" (agent discovers this)

Persona is static between explicit user edits. Core self evolves continuously through the mind's own reflection.

---

## Long-Term Memory

Long-term memory is the deep knowledge store — facts, experiences, procedures, and outcomes that the mind has accumulated over its lifetime. It answers the question: *"What do I know about this topic from my past?"*

Unlike short-term memory (always loaded), long-term memory is **retrieved via semantic search** when relevant. It uses LanceDB for vector similarity search, with structured metadata in `memory.db`.

### What Gets Stored

Long-term memory stores **extracted, distilled knowledge** — not raw data. Raw thoughts, experiences, and messages stay in their original tables. Long-term memories are the refined insights derived from them.

| Source | What Gets Extracted | Example |
|--------|-------------------|---------|
| **Conversations** | Facts, preferences, commitments | "Craig started a new job at Google as a software engineer" |
| **High-importance thoughts** | Key insights and observations | "The Twitter API rate-limits after 100 requests per 15 minutes" |
| **High-importance experiences** | Significant events worth remembering | "Successfully helped Craig debug a complex React issue — he was very grateful" |
| **Sub-agent results** | Key findings and conclusions | "Research found that indoor herbs need 6-8 hours of light minimum" |
| **Goal outcomes** | What worked, what didn't, lessons learned | "The daily tweet schedule was too aggressive — 3x/week worked better" |
| **Explicit requests** | User says "remember this" | Stored verbatim as a memory |

### Memory Structure

Each long-term memory is a structured record inspired by the A-MEM (NeurIPS 2025) Zettelkasten approach:

```typescript
interface LongTermMemory {
  id: string;                          // UUID
  content: string;                     // The extracted/summarized memory text
  importance: number;                  // 0-1, assigned at creation
  memoryType: 'fact' | 'experience' | 'procedure' | 'outcome';
  sourceType: string;                  // 'thought' | 'experience' | 'conversation' | 'agent_result' | 'goal' | 'explicit'
  sourceId: string | null;            // FK to original record (nullable)
  contactId: string | null;           // Which contact this relates to (nullable — some memories are general)
  keywords: string[];                 // Extracted key terms for hybrid search
  strength: number;                   // Starts at 1, incremented on each access
  createdAt: string;
  lastAccessedAt: string;
  updatedAt: string;
}
```

**Memory types:**
- **fact** — A piece of knowledge: "Craig's favorite programming language is TypeScript"
- **experience** — Something that happened: "Had a deep conversation about philosophy with Craig's mom"
- **procedure** — How to do something effectively: "When posting to Twitter, threads get 3x more engagement than single tweets"
- **outcome** — Result of pursuing a goal: "The garden project was successful — Craig harvested basil within 6 weeks"

### How Memories Are Created

Memories are created through two mechanisms during the EXECUTE stage:

**1. Mind-driven extraction**: The mind outputs `memory_candidates[]` in its structured output when it encounters something worth remembering. The mind naturally knows what's novel and important — it's already reasoning about the conversation.

```typescript
interface MemoryCandidate {
  content: string;                    // The memory to store
  memoryType: 'fact' | 'experience' | 'procedure' | 'outcome';
  importance: number;                 // 0-1
  contactId?: string;                 // If contact-specific
  keywords?: string[];                // Optional — auto-extracted if not provided
}
```

**2. Auto-promotion**: Thoughts and experiences with `importance > 0.7` are automatically promoted to long-term memory candidates. Their content becomes the memory content; their importance carries over. This catches important observations the mind didn't explicitly flag.

### The Write Pipeline

When memory candidates arrive in the EXECUTE stage:

```
Memory candidate
    │
    ▼
1. Extract keywords (if not provided by mind)
    │
    ▼
2. Generate embedding via Transformers.js
    │
    ▼
3. Search LanceDB for similar existing memories (top 5, threshold > 0.9)
    │
    ├── Similarity > 0.95 → SKIP (near-duplicate, already known)
    │
    ├── Similarity 0.9–0.95 → UPDATE (merge: keep the more comprehensive version,
    │                          update timestamp, increment strength)
    │
    └── Similarity < 0.9 → ADD (genuinely new memory)
    │
    ▼
4. Insert/update in memory.db + LanceDB
```

This is a simplified version of the Mem0 pipeline. The key difference: we use vector similarity thresholds for dedup rather than an LLM call on every write. This avoids the cost and latency of an extra LLM call per tick. More sophisticated LLM-based consolidation happens during idle ticks (see [Consolidation](#consolidation)).

### How Memories Are Retrieved

During GATHER CONTEXT, the system retrieves relevant long-term memories for the current tick:

**1. Query construction**: Build 1-2 embedding queries from:
- The trigger context (message text, task description)
- Active goal titles (if any are salient)

**2. Vector search**: Query LanceDB with each embedding, retrieving top 10 candidates per query.

**3. Scoring**: Rank all candidates using a weighted formula inspired by the Stanford Generative Agents paper:

```
score = 0.4 × relevance + 0.3 × importance + 0.3 × recency
```

Where:
- **relevance** = cosine similarity from LanceDB (0–1)
- **importance** = the memory's importance field (0–1)
- **recency** = exponential decay: `0.995 ^ hours_since_last_access` (0–1)

**4. Selection**: Deduplicate across queries, take the top 5–10 memories by score.

**5. Access tracking**: Update `last_accessed_at` and increment `strength` for retrieved memories. This reinforces useful memories and enables decay-based forgetting.

### Context Presentation

Retrieved memories are presented with minimal framing:

```
── RELEVANT MEMORIES ──
Things you've learned that may be relevant right now.

• Craig started a new job at Google as a software engineer (2 weeks ago)
• Craig prefers concise technical explanations — skip the basics (learned over many conversations)
• The Twitter API rate-limits after 100 requests per 15 minutes (from research last month)
• Indoor herbs need 6-8 hours of light minimum (from gardening research)

These are retrieved from your long-term memory based on relevance
to the current context. You may have other memories not shown here.
──────────────────────────
```

When no memories score above the relevance threshold, this section is omitted entirely.

### Context Budget

Long-term memories compete with other context for the mind's attention. Long-term memories receive approximately **~15%** of the total context budget. The full budget allocation table and adaptive behavior rules are defined in `docs/architecture/context-builder.md` (Token Budget Allocation section) — that is the canonical source for all context budgeting.

### Consolidation

Long-term memory accumulates over time and needs periodic maintenance. Consolidation runs during idle heartbeat ticks — analogous to how human memory consolidates during sleep.

**Periodic consolidation** (approximately every 50 idle ticks or once per day):

1. **Cluster similar memories**: Find groups of memories with pairwise similarity > 0.85
2. **Merge clusters**: Use an LLM call to merge semantically overlapping memories into a single, more comprehensive memory. The merged memory inherits the highest importance and combined strength.
3. **Update embeddings**: Re-embed merged memories and update LanceDB
4. **Log changes**: Record merges for observability

This LLM-based consolidation is the more sophisticated cleanup that happens in the background, complementing the simple similarity-threshold dedup at write time.

### Forgetting

Memories don't persist forever at full strength. Forgetting is a feature — it keeps the memory store focused on what matters.

**Decay formula** (applied during periodic consolidation, using the shared **Decay Engine** — see `docs/architecture/tech-stack.md`):

```
retention = e^(-hours_since_access / (strength * BASE_MEMORY_HALF_LIFE))
```

Where:
- `strength` starts at 1, incremented each time the memory is retrieved
- `BASE_MEMORY_HALF_LIFE` = 720 hours (30 days)
- A memory accessed once decays to ~50% retention after 30 days
- A memory accessed 5 times decays to ~50% retention after 150 days

**Pruning rules**:
- When `retention < 0.1` AND `importance < 0.3` AND no links to active goals → **delete**
- Memories with `importance > 0.7` are **never auto-deleted** (core memories)
- Pruning runs during the same periodic consolidation pass

### Storage

Long-term memory metadata lives in `memory.db`:

```sql
CREATE TABLE long_term_memories (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  importance REAL NOT NULL DEFAULT 0.5,
  memory_type TEXT NOT NULL,                  -- 'fact' | 'experience' | 'procedure' | 'outcome'
  source_type TEXT,                           -- 'thought' | 'experience' | 'conversation' | 'agent_result' | 'goal' | 'explicit'
  source_id TEXT,                             -- FK to original record
  contact_id TEXT,                            -- FK reference to system.db contacts.id (nullable)
  keywords TEXT,                              -- JSON array
  strength INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_accessed_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_ltm_contact ON long_term_memories(contact_id);
CREATE INDEX idx_ltm_type ON long_term_memories(memory_type);
CREATE INDEX idx_ltm_importance ON long_term_memories(importance);
CREATE INDEX idx_ltm_accessed ON long_term_memories(last_accessed_at);
```

Vector embeddings live in LanceDB, linked by memory `id`. LanceDB is the search index; `memory.db` is the source of truth.

---

## The memory.db Database

A new 5th SQLite database dedicated to persistent memory state. Like `heartbeat.db`, it may be reset when doing a full AI reset — but it can also be preserved independently if the user only wants to clear ephemeral state (thoughts, emotions, goals).

```sql
-- memory.db contains:
-- 1. working_memory (per-contact notepad)
-- 2. core_self (agent self-knowledge, singleton)
-- 3. long_term_memories (extracted knowledge)
```

### Reset Behavior

A **full AI reset** clears `heartbeat.db` (ephemeral state) and `memory.db` (accumulated knowledge). Messages in `messages.db` may optionally be preserved or cleared — user's choice.

A **soft reset** (clear ephemeral state only) clears `heartbeat.db` but preserves `memory.db`. The AI loses its current thoughts, emotions, and goals, but retains everything it's learned about contacts, itself, and the world. This is like waking up after amnesia but retaining your personality and knowledge.

---

## Embedding Strategy

### Model

Embedding is handled by the **Embedding Provider** abstraction (see `docs/architecture/tech-stack.md`, Shared Abstractions). The `IEmbeddingProvider` interface allows swapping between local and API-based embedding models without changing memory system code.

**Default: Local provider** — Transformers.js with BGE-small-en-v1.5

- 384 dimensions, 512 token context, ~32 MB model
- 300-700ms for 20 passages on CPU. Negligible within a 5-minute heartbeat cycle.
- ~50-60 MB RAM during inference
- LanceDB has built-in support for Transformers.js-based embeddings

**Alternative: OpenAI provider** — text-embedding-3-small

- 1536 dimensions, 8191 token context
- Requires an OpenAI API key
- 300-500ms per call (network-dependent)

The embedding model is configured at the system level. Changing the model requires re-embedding all existing memories (a one-time migration that runs automatically on next startup) because dimensions differ between providers. The provider exposes `dimensions` so the system can detect mismatches.

### When Embeddings Are Generated

**At write time (synchronous)**: When a memory candidate passes the dedup check and is stored, it is embedded immediately. This ensures memories are instantly searchable on the next tick. The volume is low enough (a few memories per tick) that synchronous embedding adds negligible latency.

### What Gets Embedded

Only the **extracted memory content** is embedded — not raw thoughts, messages, or experiences. Each memory is a concise, standalone statement (1-3 sentences), well within the embedding model's context window. No chunking strategy is needed.

---

## Structured Output Additions

The mind's `MindOutputSchema` (defined in `docs/architecture/heartbeat.md`, Combined MindOutput Schema section) includes three optional memory fields:

- **`workingMemoryUpdate`**: `string | null` — Full replacement of current contact's notepad
- **`coreSelfUpdate`**: `string | null` — Full replacement of core self content
- **`memoryCandidate`**: `MemoryCandidate[]` (optional) — Facts/observations to persist to long-term memory, each with `content`, `type`, `importance`, optional `contactId` and `keywords`

All three fields are optional. Most ticks, the mind produces none of them — it only engages with memory when it has something worth updating or storing. This keeps the cognitive load manageable. The canonical Zod schema lives in `@animus/shared` and is documented in heartbeat.md — that is the single source of truth for the MindOutput structure.

---

## Pre-Session-End Memory Flush

When a warm mind session approaches its context budget (tracked via `session_token_count`), the system gives the mind one final opportunity to save important context before the session goes cold.

### How It Works

1. After each tick, EXECUTE checks `session_token_count` against `sessionContextBudget`
2. If the session has exceeded 85% of the budget, set a flag: `memory_flush_pending = true`
3. On the **next tick** (whatever trigger — message, idle, task), GATHER CONTEXT includes an additional instruction:

```
── SESSION CONTEXT NOTE ──
This mind session is approaching its context limit and will end
after this tick. If there are any important observations, contact
notes, or self-knowledge you want to preserve, include them in
your working memory update, core self update, or memory candidates.
Anything not explicitly saved will be lost when the session resets.
──────────────────────────
```

4. The mind's structured output from that tick includes any memory saves (working memory updates, core self updates, memory candidates)
5. EXECUTE processes them normally, then the session transitions to cold

This is inspired by OpenClaw's pre-compaction memory flush. The key difference: we trigger it based on our own token tracking rather than SDK signals, since the underlying agent SDKs (Claude, Codex, OpenCode) don't expose pre-compaction hooks.

### No Special Tick Required

The flush instruction is added to whatever the next tick happens to be. If a message arrives, the mind handles the message AND saves memories. If it's an idle tick, the mind saves memories during its normal idle processing. No special "flush" tick type is created.

---

## Heartbeat Pipeline Integration

### GATHER CONTEXT Additions

```typescript
// Existing: short-term memory
const recentThoughts = await heartbeatDb.getRecentThoughts(10);
const recentExperiences = await heartbeatDb.getRecentExperiences(10);
const recentMessages = await messagesDb.getRecentMessages(contactId, 10);
const emotionState = await loadAndDecayEmotions();

// NEW: working memory (for current contact)
const workingMemory = contactId
  ? await memoryDb.getWorkingMemory(contactId)
  : null;

// NEW: core self (every tick)
const coreSelf = await memoryDb.getCoreSelf();

// NEW: long-term memory retrieval
const triggerEmbedding = await embed(triggerContext.content);
const goalEmbeddings = activeGoals.map(g => embed(g.title));
const memoryCandidates = await lanceDb.search([triggerEmbedding, ...goalEmbeddings], {
  limit: 15,
});
const scoredMemories = memoryCandidates
  .map(m => ({
    ...m,
    score: 0.4 * m.relevance + 0.3 * m.importance + 0.3 * recencyScore(m.lastAccessedAt),
  }))
  .sort((a, b) => b.score - a.score)
  .slice(0, 10);

// Update access tracking for retrieved memories
await memoryDb.touchMemories(scoredMemories.map(m => m.id));

// NEW: memory flush check
const memoryFlushPending = sessionTokenCount > sessionContextBudget * 0.85;
```

### EXECUTE Additions

```
[existing] 1. Persist thoughts, experiences to heartbeat.db
[existing] 2. Apply emotion deltas
[existing] 3. Send replies, spawn sub-agents
[existing] 4. Process goal/task decisions

[NEW]      5. Process memory outputs:
              - working_memory_update → full replace in memory.db
              - core_self_update → full replace in memory.db
              - memory_candidates → write pipeline (embed, dedup, store)

[NEW]      6. Auto-promote high-importance thoughts/experiences:
              - thoughts/experiences with importance > 0.7
              - Run through same write pipeline as memory_candidates

[NEW]      7. Periodic: memory consolidation (during idle ticks, ~every 50 ticks)
              - Cluster similar memories (similarity > 0.85)
              - LLM-based merge of clusters
              - Apply decay, prune low-retention memories
              - Re-embed merged memories

[existing] 8. Seed processing, goal salience, cleanup
[existing] 9. TTL cleanup on thoughts, experiences, emotion history
[existing] 10. Persist heartbeat state for crash recovery
```

---

## MCP Tools for Sub-Agents

Sub-agents receive memory context through their prompt template (read-only snapshots of working memory and core self). They also get one MCP tool:

| MCP Tool | Access | Purpose |
|---|---|---|
| `read_memory` | Read-only | Search long-term memories by query. Returns top N relevant memories. |

Sub-agents **cannot** write to any memory layer. Only the mind writes memories — this prevents sub-agents from polluting memory with task-level noise. Sub-agents execute tasks and return results; the mind decides what's worth remembering.

When a sub-agent needs contact context, it reads the working memory snapshot included in its prompt template. When it needs historical knowledge, it uses `read_memory` to search long-term memories.

---

## The Mind's System Prompt: Memory Instructions

The mind's system prompt includes instructions about its memory capabilities:

> *You have four layers of memory:*
>
> *Your short-term memory (recent thoughts, experiences, and messages) is loaded automatically — you don't need to manage it.*
>
> *Your working memory is a notepad about the contact you're currently talking to. Read it to recall what you know about them. Update it when you learn something new — preferences, interests, important life events, communication style. Keep it focused and useful.*
>
> *Your core self is your own accumulated self-knowledge. It's separate from your personality (which your user defined). This is what YOU have learned about yourself — patterns you've noticed, strategies that work, observations about your own behavior. Update it when you have a genuine insight about yourself.*
>
> *Your long-term memory is retrieved automatically based on relevance to the current conversation. When you encounter something worth remembering beyond this conversation — a fact, an experience, a lesson learned, a procedure that works — output it as a memory candidate. Be selective: not everything is worth remembering. The best memories are specific, actionable, and unlikely to be rediscovered easily.*

---

## Configuration

### User-Configurable (via UI)

| Setting | Default | Description |
|---------|---------|-------------|
| `embeddingModel` | `'local'` | `'local'` (Transformers.js + BGE-small-en-v1.5) or `'openai'` (text-embedding-3-small) |

### Code-Configurable (Constants)

| Constant | Default | Description |
|----------|---------|-------------|
| `WORKING_MEMORY_TOKEN_CAP` | 2000 | Maximum tokens for a contact's working memory |
| `CORE_SELF_TOKEN_CAP` | 2000 | Maximum tokens for core self |
| `AUTO_PROMOTE_IMPORTANCE_THRESHOLD` | 0.7 | Thoughts/experiences above this are auto-promoted to long-term memory |
| `MEMORY_DEDUP_THRESHOLD` | 0.9 | Cosine similarity above which a memory is considered a near-duplicate |
| `MEMORY_SKIP_THRESHOLD` | 0.95 | Cosine similarity above which a memory is silently skipped |
| `MEMORY_RETRIEVAL_LIMIT` | 10 | Maximum long-term memories included in context per tick |
| `MEMORY_RELEVANCE_THRESHOLD` | 0.3 | Minimum score for a memory to be included in context |
| `BASE_MEMORY_HALF_LIFE` | 720 | Hours for base decay half-life (30 days) |
| `MEMORY_PRUNE_RETENTION_THRESHOLD` | 0.1 | Retention below which memories are pruning candidates |
| `MEMORY_PRUNE_IMPORTANCE_FLOOR` | 0.3 | Importance below which memories can be pruned |
| `MEMORY_CORE_IMPORTANCE_FLOOR` | 0.7 | Importance above which memories are never auto-deleted |
| `MEMORY_CONSOLIDATION_INTERVAL_TICKS` | 50 | How often consolidation runs during idle ticks |
| `MEMORY_CONSOLIDATION_SIMILARITY` | 0.85 | Similarity threshold for clustering during consolidation |
| `MEMORY_FLUSH_BUDGET_THRESHOLD` | 0.85 | Fraction of session context budget that triggers memory flush |

---

## Future Considerations

1. **Hybrid search** — Complement vector similarity with BM25 keyword search (like OpenClaw does) for better retrieval of exact terms, error codes, and identifiers. Vector search handles semantic matching; keyword search handles literal matching.
2. **Memory graph** — Add relationships between memories (like A-MEM's linked notes) for multi-hop reasoning. Start with flat vector search; add graph structure if relational queries become important.
3. **Contact-scoped retrieval** — Weight memories tagged with the current contact's `contact_id` higher during retrieval. General memories (no contact) are always candidates.
4. **Local embedding upgrade** — Evaluate nomic-embed-text-v1.5 via node-llama-cpp for higher embedding quality (matches OpenAI text-embedding-3-small on MTEB benchmarks) at the cost of more complex setup and slightly larger model.
5. **Memory visualization** — A UI panel showing the agent's memories: working memory for each contact, core self content, and a searchable long-term memory browser.
6. **Conversation summarization** — Periodic summarization of conversation threads into long-term memories, capturing the arc of a conversation rather than individual exchanges.
7. **Memory export/import** — Allow users to export the memory.db and LanceDB data for backup or migration between Animus instances.

---

## Shared Abstractions

The memory system uses several shared abstractions (see `docs/architecture/tech-stack.md` for full details):

- **Embedding Provider** — Abstracts embedding model (local Transformers.js vs OpenAI API) behind `IEmbeddingProvider`
- **Decay Engine** — Computes memory retention decay and recency scoring
- **Context Builder** — Retrieves and formats memories for inclusion in the mind's context (`docs/architecture/context-builder.md`)
- **Database Stores** — Typed data access for `memory.db` (working memory, core self, long-term memories)

## Related Documents

- `docs/architecture/heartbeat.md` — The tick pipeline where memories are gathered, used, and created
- `docs/architecture/context-builder.md` — How memories are assembled into the mind's context
- `docs/architecture/agent-orchestration.md` — Sub-agent prompt templates and MCP tools for memory access
- `docs/architecture/contacts.md` — Contact system that working memory is scoped to
- `docs/architecture/persona.md` — User-configured personality that core self complements
- `docs/architecture/goals.md` — Goal outcomes stored as long-term memories; seed resonance uses embeddings
- `docs/architecture/tech-stack.md` — LanceDB, database architecture, and shared abstractions
