# Observational Memory — Implementation Plan

**Architecture Doc**: `docs/architecture/observational-memory.md`
**Status**: Planning
**Team Structure**: Tech Lead + 3 specialized agents

---

## Team Composition

| Role | Agent Type | Owns |
|------|-----------|------|
| **Tech Lead** | (coordinator) | Task assignment, code review, integration decisions |
| **Foundation** | `shared-foundation` | Types, schemas, DB migration, observation store, config types, EventBus events |
| **Heartbeat** | `backend-builder` | GATHER/EXECUTE integration, context builder changes, heartbeat pipeline modifications |
| **Memory** | `feature-systems` | Observer agent, Reflector agent, observation processor, temporal utilities |

---

## Work Breakdown — 4 Phases

### Phase 1: Foundation (no dependencies)

All three agents can start Phase 1 work in parallel.

#### Task 1.1 — Observation Schemas & Types [Foundation]

**Create** `packages/shared/src/schemas/observational-memory.ts`:
- `observationSchema` — Zod schema matching the `observations` table
  - `id: uuidSchema`
  - `contactId: uuidSchema.nullable()` (NULL for thoughts/experiences)
  - `stream: z.enum(['messages', 'thoughts', 'experiences'])`
  - `content: z.string()` (compressed observation text)
  - `tokenCount: z.number().int().nonneg()`
  - `generation: z.number().int().min(1).default(1)`
  - `lastRawId: z.string().nullable()` (watermark)
  - `lastRawTimestamp: timestampSchema.nullable()`
  - `createdAt: timestampSchema`
  - `updatedAt: timestampSchema`
- `streamTypeSchema` — `z.enum(['messages', 'thoughts', 'experiences'])`
- `observationEventSchema` — For EventBus events (see Task 1.4)

**Create** `packages/shared/src/types/observational-memory.ts`:
- Types derived from schemas via `z.infer<>`
- `Observation`, `StreamType`, `ObservationEvent`

**Modify** `packages/shared/src/schemas/index.ts` — re-export new schemas
**Modify** `packages/shared/src/types/index.ts` — re-export new types

#### Task 1.2 — Database Migration [Foundation]

**Create** `packages/backend/src/db/migrations/memory/002_observational_memory.sql`:
```sql
CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  contact_id TEXT,
  stream TEXT NOT NULL,
  content TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  generation INTEGER NOT NULL DEFAULT 1,
  last_raw_id TEXT,
  last_raw_timestamp TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_observations_contact ON observations(contact_id);
CREATE INDEX IF NOT EXISTS idx_observations_stream ON observations(stream);
CREATE INDEX IF NOT EXISTS idx_observations_contact_stream ON observations(contact_id, stream);
```

#### Task 1.3 — Observation Store Functions [Foundation]

**Modify** `packages/backend/src/db/stores/memory-store.ts` — add observation CRUD:

```typescript
// Read observation for a stream (global or per-contact)
getObservation(db, stream, contactId?): Observation | null

// Upsert observation content, token count, watermark
upsertObservation(db, data: {
  stream, contactId?, content, tokenCount, lastRawId?, lastRawTimestamp?
}): Observation

// Update just the content + token count (for reflection)
updateObservationContent(db, id, content, tokenCount, generation): void

// Delete observations (for reset)
deleteObservations(db, contactId?): number

// Get all observations for a contact (messages stream)
getContactObservations(db, contactId): Observation[]

// Get global observations (thoughts + experiences streams)
getGlobalObservations(db): Observation[]
```

Follow existing store patterns: `snakeToCamel()` for reads, SQL parameterized queries, UUID generation via `generateUUID()`.

#### Task 1.4 — Extract Token Estimation to Shared [Foundation]

`estimateTokens()` currently lives in `packages/backend/src/heartbeat/persona-compiler.ts` (line 382). It's a general-purpose utility needed by the observation processor, context builder, and persona compiler. Extract it to the shared package.

**Create** `packages/shared/src/token-utils.ts`:
```typescript
/**
 * Estimate token count for a string using word-count heuristic.
 * Approximate but sufficient for budget management — no need for tiktoken precision.
 */
export function estimateTokens(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * 1.3);
}
```

**Modify** `packages/shared/src/index.ts` — export `estimateTokens`

**Modify** `packages/backend/src/heartbeat/persona-compiler.ts` — replace local `estimateTokens` with import from `@animus-labs/shared`:
```typescript
import { estimateTokens } from '@animus-labs/shared';
```
Remove the local function definition (lines 382-385). Keep all existing call sites unchanged — they'll use the imported version.

Verify no other files have local token estimation duplicates.

#### Task 1.5 — EventBus Event Types [Foundation]

**Modify** `packages/shared/src/event-bus.ts` — add to `AnimusEventMap`:

```typescript
'observation:started': { stream: StreamType; contactId: string | null; batchTokens: number; cycleId: string }
'observation:completed': { stream: StreamType; contactId: string | null; observedTokens: number; outputTokens: number; durationMs: number; cycleId: string }
'observation:failed': { stream: StreamType; contactId: string | null; error: string; cycleId: string }
'reflection:started': { stream: StreamType; contactId: string | null; inputTokens: number; compressionLevel: number; cycleId: string }
'reflection:completed': { stream: StreamType; contactId: string | null; inputTokens: number; outputTokens: number; generation: number; durationMs: number; cycleId: string }
'reflection:failed': { stream: StreamType; contactId: string | null; error: string; cycleId: string }
```

#### Task 1.6 — Observation Config [Memory]

**Create** `packages/backend/src/config/observational-memory.config.ts`:
- Export `OBSERVATIONAL_MEMORY_CONFIG` as defined in the architecture doc
- Export `StreamType` type alias
- All values as described: model, observer/reflector settings, per-stream token budgets, batch thresholds

#### Task 1.7 — Temporal Annotation Utilities [Memory]

**Create** `packages/backend/src/memory/observational-memory/temporal.ts`:

```typescript
// Add relative time annotations to date headers
// "Date: Feb 10, 2026" → "Date: Feb 10, 2026 (4 days ago)"
annotateRelativeTime(observations: string, currentDate?: Date): string

// Insert gap markers between non-consecutive date groups
// "[2 weeks later]" between dates that aren't consecutive
insertGapMarkers(observations: string): string

// Combined: apply both transformations
annotateObservations(observations: string, currentDate?: Date): string

// Helper: format relative time string
formatRelativeTime(date: Date, now: Date): string
// Returns: "today", "yesterday", "X days ago", "X weeks ago", "X months ago"

// Helper: format gap between two dates
formatGap(earlier: Date, later: Date): string | null
// Returns: null (consecutive), "[X days later]", "[X weeks later]", "[X months later]"

// Helper: parse date from observation header
parseDateHeader(line: string): Date | null
// Parses "Date: Feb 10, 2026" format
```

Unit tests: various date scenarios, gap calculations, edge cases (same day, year boundaries).

---

### Phase 2: Observer & Reflector Agents (depends on Phase 1)

#### Task 2.1 — Observer Agent [Memory]

**Create** `packages/backend/src/memory/observational-memory/observer.ts`:

```typescript
// Build the observer system prompt for a given stream type
buildObserverSystemPrompt(streamType: StreamType, compiledPersona: string): string

// Build the user message with batch items + existing observations
buildObserverUserMessage(batchItems: string[], existingObservations: string | null): string

// Parse observer output into structured observation text
parseObserverOutput(rawOutput: string): { observations: string }

// Run a full observer cycle: create session → prompt → parse
runObserver(params: {
  agentManager: AgentManager;
  streamType: StreamType;
  compiledPersona: string;
  batchItems: string[];
  existingObservations: string | null;
  config: typeof OBSERVATIONAL_MEMORY_CONFIG;
}): Promise<{ observations: string; tokenCount: number; usage: SessionUsage }>
```

**System prompt design per stream** (from architecture doc):
- **Message Observer**: User assertions vs questions, temporal anchoring, state change detection, detail preservation
- **Thought Observer**: Recurring patterns, goal-related reasoning, self-reflections, decision rationale
- **Experience Observer**: Significant events, sub-agent results, environmental changes, emotional milestones

**All observers receive**: compiled persona (from persona-compiler) + stream-specific instructions. No operational instructions, no MCP tools, no output schema.

**Session creation pattern**:
```typescript
const session = await agentManager.createSession({
  provider: resolveProvider(),  // From configured providers
  systemPrompt: buildObserverSystemPrompt(streamType, compiledPersona),
  // No MCP servers, no tools, no output format
});

const response = await session.prompt(userMessage);
await session.end();  // Cold session — end immediately
```

Model selection: Use `config.model` to pick the cheapest available model from the configured provider. Start with haiku-tier.

#### Task 2.2 — Reflector Agent [Memory]

**Create** `packages/backend/src/memory/observational-memory/reflector.ts`:

```typescript
// Build reflector system prompt
buildReflectorSystemPrompt(streamType: StreamType, compiledPersona: string): string

// Build reflector user message with observations + compression level
buildReflectorUserMessage(observations: string, compressionLevel: 0 | 1 | 2): string

// Parse reflector output
parseReflectorOutput(rawOutput: string): { observations: string }

// Validate compression achieved target
validateCompression(reflectedTokens: number, targetThreshold: number): boolean

// Run full reflector cycle with retry logic
runReflector(params: {
  agentManager: AgentManager;
  streamType: StreamType;
  compiledPersona: string;
  observations: string;
  targetThreshold: number;
  config: typeof OBSERVATIONAL_MEMORY_CONFIG;
}): Promise<{ observations: string; tokenCount: number; generation: number; usage: SessionUsage }>
```

**Compression levels** (from architecture doc):
- Level 0: No guidance (first attempt)
- Level 1: 8/10 detail — "condense more, retain recent detail"
- Level 2: 6/10 detail — "heavily condense, merge overlapping"

**Retry flow**: Try level 0 → if tokens still exceed threshold → retry level 1 → if still exceeds → retry level 2 → if still exceeds → accept as-is with warning log.

**Reflector receives**: The full observer extraction instructions embedded in its prompt (so it understands how observations were created), plus compiled persona.

---

### Phase 3: Observation Processor (depends on Phase 2)

#### Task 3.1 — Observation Processor [Memory]

**Create** `packages/backend/src/memory/observational-memory/index.ts`:

The main orchestrator. This is the central module that the heartbeat calls.

```typescript
export interface ObservationProcessorDeps {
  agentManager: AgentManager;
  memoryDb: Database.Database;
  compiledPersona: string;
  eventBus: IEventBus;
}

// Check thresholds and run observation/reflection for a single stream
processStream(params: {
  deps: ObservationProcessorDeps;
  stream: StreamType;
  contactId: string | null;
  rawItems: Array<{ id: string; content: string; createdAt: string }>;
  config: typeof OBSERVATIONAL_MEMORY_CONFIG;
}): Promise<void>

// Process all three streams (called from EXECUTE)
processAllStreams(params: {
  deps: ObservationProcessorDeps;
  thoughts: Thought[];
  experiences: Experience[];
  messages: Message[];
  contactId: string | null;
  config: typeof OBSERVATIONAL_MEMORY_CONFIG;
}): Promise<void>

// Load observations + raw items for GATHER (replaces hard 10-item limit)
loadStreamContext(params: {
  stream: StreamType;
  contactId: string | null;
  memoryDb: Database.Database;
  sourceDb: Database.Database;
  rawTokenBudget: number;
}): { observations: Observation | null; rawItems: any[]; rawTokenCount: number }
```

**Concurrency protection**:
```typescript
const activeOps = new Map<string, boolean>();
// Key: `${contactId ?? 'global'}:${stream}`
// Prevents concurrent observer/reflector for same stream
```

**Threshold logic** (from architecture doc):
1. Count raw items tokens via `estimateTokens()`
2. Calculate overflow: `rawTokens - streamConfig.rawTokens`
3. Calculate batch threshold: `streamConfig.rawTokens * config.observeBatchThreshold`
4. If overflow > batch threshold → trigger observer
5. Take `streamConfig.rawTokens * config.observeBatchSize` of oldest items as batch
6. After observation, check if observation token count > `streamConfig.observationTokens` → trigger reflector

**Error handling**: All observation failures logged but never thrown. System degrades to "slightly more raw items" — exactly how it worked before observational memory existed.

#### Task 3.2 — Barrel Export & Tests [Memory]

**Create** `packages/backend/src/memory/observational-memory/` directory structure:
```
observational-memory/
  index.ts          — Main processor (Task 3.1)
  observer.ts       — Observer agent (Task 2.1)
  reflector.ts      — Reflector agent (Task 2.2)
  temporal.ts       — Temporal utilities (Task 1.6)
```

Tests:
- `observer.test.ts` — Prompt building, output parsing, mock session
- `reflector.test.ts` — Compression levels, validation, retry logic
- `temporal.test.ts` — Relative time, gap markers, date parsing
- `index.test.ts` — Threshold logic, batch sizing, concurrency protection

---

### Phase 4: Heartbeat Integration (depends on Phase 3)

#### Task 4.1 — GATHER Integration [Heartbeat]

**Modify** `packages/backend/src/heartbeat/index.ts` — `gatherContext()` (lines 260-278):

**Current code** (to be replaced):
```typescript
const recentThoughts = heartbeatStore.getRecentThoughts(hbDb, 10);
const recentExperiences = heartbeatStore.getRecentExperiences(hbDb, 10);
// ... later ...
recentMessages = messageStore.getRecentMessages(msgDb, conv.id, 10);
```

**New code**:
```typescript
import { loadStreamContext } from '../memory/observational-memory/index.js';
import { OBSERVATIONAL_MEMORY_CONFIG } from '../config/observational-memory.config.js';

// Load thoughts with observation context
const thoughtContext = loadStreamContext({
  stream: 'thoughts',
  contactId: null,  // Global
  memoryDb: getMemoryDb(),
  sourceDb: hbDb,
  rawTokenBudget: OBSERVATIONAL_MEMORY_CONFIG.streams.thoughts.rawTokens,
});

// Load experiences with observation context
const experienceContext = loadStreamContext({
  stream: 'experiences',
  contactId: null,  // Global
  memoryDb: getMemoryDb(),
  sourceDb: hbDb,
  rawTokenBudget: OBSERVATIONAL_MEMORY_CONFIG.streams.experiences.rawTokens,
});

// Load messages with observation context (per-contact)
let messageContext = null;
if (conv) {
  messageContext = loadStreamContext({
    stream: 'messages',
    contactId: trigger.contactId,
    memoryDb: getMemoryDb(),
    sourceDb: msgDb,
    rawTokenBudget: OBSERVATIONAL_MEMORY_CONFIG.streams.messages.rawTokens,
  });
}
```

**Update `GatherResult` interface** to include observation data:
```typescript
interface GatherResult {
  // ... existing fields ...
  // Replace:
  //   recentThoughts: Thought[];
  //   recentExperiences: Experience[];
  //   recentMessages: Message[];
  // With:
  thoughtContext: StreamContext;
  experienceContext: StreamContext;
  messageContext: StreamContext | null;
}

interface StreamContext {
  observations: Observation | null;
  rawItems: Array<{ id: string; content: string; createdAt: string; importance?: number }>;
  rawTokenCount: number;
}
```

#### Task 4.2 — Context Builder Integration [Heartbeat]

**Modify** `packages/backend/src/heartbeat/context-builder.ts`:

Replace `buildShortTermMemorySection()` (around line 819-829) with observation-aware version:

```typescript
function buildShortTermMemorySection(params: {
  thoughtContext: StreamContext;
  experienceContext: StreamContext;
  messageContext: StreamContext | null;
  contactName: string | null;
}): string
```

**New format** (from architecture doc):
```
── RECENT THOUGHTS ──

<thought-observations>
{annotated observations with relative time + gap markers}
</thought-observations>

[timestamp] thought content here
[timestamp] another thought
──────────────────────────

── RECENT EXPERIENCES ──
{same pattern}

── RECENT CONVERSATION (with ContactName) ──
{same pattern — observations then raw messages}
```

Apply `annotateObservations()` from temporal utilities when injecting observation blocks.

#### Task 4.3 — EXECUTE Integration [Heartbeat]

**Modify** `packages/backend/src/heartbeat/index.ts` — `executeOutput()` (around line 1002-1043):

Add observation processing **after** memory updates (step 9 in EXECUTE), **before** cleanup:

```typescript
// Step 10: Observational memory processing (async, non-blocking)
try {
  // Fire-and-forget — don't await, don't block next tick
  processAllStreams({
    deps: {
      agentManager,
      memoryDb: getMemoryDb(),
      compiledPersona: compiledPersona?.compiledText ?? '',
      eventBus,
    },
    thoughts: [/* newly persisted thought from this tick */],
    experiences: [/* newly persisted experience from this tick */],
    messages: gathered.messageContext?.rawItems ?? [],
    contactId: gathered.contact?.id ?? null,
    config: OBSERVATIONAL_MEMORY_CONFIG,
  }).catch(err => {
    log.warn('Observation processing failed (non-fatal):', err);
  });
} catch (err) {
  log.warn('Observation processing setup failed (non-fatal):', err);
}
```

**Key**: This is fire-and-forget. The `processAllStreams` promise is not awaited. It runs concurrently with cleanup steps and doesn't block the next tick.

#### Task 4.4 — Integration Tests [Heartbeat]

- Test that GATHER loads observations + raw items correctly
- Test that context builder formats observation sections properly
- Test that EXECUTE triggers observation processing without blocking
- Test graceful degradation when observation processing fails

---

## Dependency Graph

```
Phase 1 (parallel):
  [1.1 Schemas/Types]  [1.2 Migration]  [1.3 Store]  [1.4 EventBus]  [1.5 Config]  [1.6 Temporal]
         │                    │              │              │               │              │
         └────────────────────┴──────────────┴──────────────┘               │              │
                              │                                             │              │
Phase 2 (depends on 1.1-1.4):│                                             │              │
  [2.1 Observer Agent] ───────┤                                             │              │
  [2.2 Reflector Agent] ──────┤                                             │              │
                              │                                             │              │
Phase 3 (depends on Phase 2): │                                             │              │
  [3.1 Observation Processor] ┼─────────────────────────────────────────────┘──────────────┘
  [3.2 Tests]                 │
                              │
Phase 4 (depends on Phase 3):
  [4.1 GATHER Integration]
  [4.2 Context Builder Integration]
  [4.3 EXECUTE Integration]
  [4.4 Integration Tests]
```

---

## Files Created

| File | Owner | Phase |
|------|-------|-------|
| `packages/shared/src/schemas/observational-memory.ts` | Foundation | 1 |
| `packages/shared/src/types/observational-memory.ts` | Foundation | 1 |
| `packages/shared/src/token-utils.ts` | Foundation | 1 |
| `packages/backend/src/db/migrations/memory/002_observational_memory.sql` | Foundation | 1 |
| `packages/backend/src/config/observational-memory.config.ts` | Memory | 1 |
| `packages/backend/src/memory/observational-memory/temporal.ts` | Memory | 1 |
| `packages/backend/src/memory/observational-memory/observer.ts` | Memory | 2 |
| `packages/backend/src/memory/observational-memory/reflector.ts` | Memory | 2 |
| `packages/backend/src/memory/observational-memory/index.ts` | Memory | 3 |

## Files Modified

| File | Owner | Phase | Changes |
|------|-------|-------|---------|
| `packages/shared/src/schemas/index.ts` | Foundation | 1 | Re-export observation schemas |
| `packages/shared/src/types/index.ts` | Foundation | 1 | Re-export observation types |
| `packages/shared/src/index.ts` | Foundation | 1 | Export `estimateTokens` |
| `packages/shared/src/event-bus.ts` | Foundation | 1 | Add 6 observation/reflection events |
| `packages/backend/src/db/stores/memory-store.ts` | Foundation | 1 | Add observation CRUD functions |
| `packages/backend/src/heartbeat/persona-compiler.ts` | Foundation | 1 | Replace local `estimateTokens` with import from `@animus-labs/shared` |
| `packages/backend/src/heartbeat/index.ts` | Heartbeat | 4 | GATHER + EXECUTE integration |
| `packages/backend/src/heartbeat/context-builder.ts` | Heartbeat | 4 | Observation context sections |

---

## Key Implementation Decisions

1. **`estimateTokens()` in shared** — Extracted from `persona-compiler.ts` to `@animus-labs/shared` as a general-purpose utility. All consumers (persona compiler, observation processor, context builder) import from the same place.

2. **`loadStreamContext()` queries** — For thoughts/experiences, query `getRecentThoughts`/`getRecentExperiences` without a hard limit, then filter by token budget. For messages, similar approach with `getRecentMessages`. Items newer than the observation watermark (`last_raw_timestamp`) are loaded.

3. **Observer model selection** — The config specifies `model: 'haiku'`. The processor resolves this to the cheapest model from the configured provider (e.g., Claude haiku, GPT-4o-mini, etc.). If the provider doesn't have a haiku tier, fall back to the provider's default with a warning.

4. **Compiled persona caching** — The heartbeat already caches `compiledPersona` at module level (heartbeat/index.ts line 127). The observation processor receives it as a dependency parameter — no re-compilation needed.

5. **Fire-and-forget execution** — `processAllStreams()` is called without `await` in EXECUTE. The `activeOps` map prevents concurrent runs. If a previous observation is still running when the next tick fires, it's skipped for that stream.

6. **One observation row per stream per scope** — At most 2 global rows (thoughts + experiences) and 1 row per contact (messages). The `upsertObservation` store function handles insert-or-update.

7. **Watermark-based loading** — Raw items are loaded where `created_at > observation.last_raw_timestamp`. If no observation exists, all items up to the token budget are loaded (equivalent to the current behavior but token-limited instead of count-limited).

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Observer produces garbage output | Parse defensively; on parse failure, log warning and skip observation |
| Reflector doesn't compress enough | Retry up to 2 levels; accept as-is on final failure |
| Token estimation inaccuracy | `words × 1.3` is approximate; budgets are soft limits, overflow is graceful |
| Agent session creation fails | Catch error, log warning, skip observation — system degrades to pre-observation behavior |
| Concurrent ticks race on observations | `activeOps` map prevents concurrent observer/reflector per stream |
| DB migration failure | Migration is additive (new table only) — no risk to existing data |
