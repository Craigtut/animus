# Architecture Refactor Plan

> Generated from the full codebase architecture review (6 parallel agent analyses).
> Each sprint is designed to be independently shippable with passing tests.

---

## Sprint 1: Decompose `heartbeat/index.ts` (2,313 → ~600 lines)

The heartbeat index.ts is the single largest file in the codebase. It works correctly but concentrates too many concerns. This sprint extracts well-defined modules without changing any behavior.

### 1A: Extract `gather-context.ts`

**What moves:**
- `GatherResult` interface (lines 168-196)
- `gatherContext()` function (lines 198-468)

**New file:** `packages/backend/src/heartbeat/gather-context.ts`

**Interface:**
```typescript
export interface GatherResult {
  trigger: TriggerContext;
  contact: Contact | null;
  emotions: EmotionState[];
  recentThoughts: ...;
  recentExperiences: ...;
  recentMessages: ...;
  previousDecisions: ...;
  tickIntervalMs: number;
  sessionState: 'cold' | 'warm';
  memoryContext: MemoryContext | null;
  goalContext: GoalContext | null;
  spawnBudgetNote: string | null;
  contacts: Array<{ contact: Contact; channels: ContactChannel[] }>;
  energyLevel: number | null;
  energyBand: EnergyBand | null;
  circadianBaseline: number | null;
  wakeUpContext: WakeUpContext | null;
  energySystemEnabled: boolean;
  pluginDecisionDescriptions: string;
  pluginContextSources: string;
  credentialManifest: string;
  deferredTasks: Task[];
  thoughtContext: StreamContext;
  experienceContext: StreamContext;
  messageContext: StreamContext | null;
}

export async function gatherContext(
  trigger: TriggerContext,
  deps: GatherDeps,
): Promise<GatherResult>;
```

**Dependencies to pass in (GatherDeps):**
```typescript
export interface GatherDeps {
  tickQueue: TickQueue;
  memoryManager: MemoryManager | null;
  seedManager: SeedManager | null;
  goalManager: GoalManager | null;
  agentOrchestrator: AgentOrchestrator | null;
  sessionInvalidated: boolean;
  /** Callback to clear the invalidation flag after reading it */
  clearSessionInvalidation: () => void;
  sessionWarmthMs: number;
  currentState: HeartbeatState;
}
```

**Lines removed from index.ts:** ~300 lines
**Testing:** Unit test with mocked DB getters and managers. Verify GatherResult shape for each trigger type.

---

### 1B: Extract `mind-session.ts`

**What moves:**
- `createChunkChannel()` utility (lines 81-126)
- `getOrCreateMindSession()` (lines 583-700)
- `buildMindToolContext()` (lines 531-578)
- Session state variables and their management

**New file:** `packages/backend/src/heartbeat/mind-session.ts`

**Interface:**
```typescript
export interface MindSessionState {
  session: IAgentSession | null;
  sessionId: string | null;
  logSessionId: (() => string | null) | null;
  warmSince: number | null;
  mcpServer: { serverConfig: Record<string, unknown>; allowedTools: string[] } | null;
  toolContext: MutableToolContext;
  invalidated: boolean;
}

export function createMindSessionState(): MindSessionState;

export async function getOrCreateMindSession(
  state: MindSessionState,
  sessionState: 'cold' | 'warm',
  systemPrompt: string | null,
  agentManager: AgentManager,
  agentLogStoreAdapter: AgentLogStore | null,
): Promise<IAgentSession>;

export function buildMindToolContext(
  gathered: GatherResult,
): ToolHandlerContext;

export function createChunkChannel(): {
  push: (chunk: string) => void;
  end: () => void;
  iterable: AsyncIterable<string>;
};

export function resetMindSession(state: MindSessionState): Promise<void>;
```

**Lines removed from index.ts:** ~220 lines
**Key benefit:** Module-level session state (`mindSession`, `mindSessionId`, `mindMcpServer`, etc.) is now encapsulated in a `MindSessionState` object, making it testable and explicit.

---

### 1C: Extract `mind-parsing.ts`

**What moves:**
- `extractJson()` (lines 478-499)
- `safeMindOutput()` (lines 504-525)
- JSON parsing + retry logic (extracted from mindQuery lines 999-1068)
- Zod validation + lenient fallback logic

**New file:** `packages/backend/src/heartbeat/mind-parsing.ts`

**Interface:**
```typescript
export function extractJson(raw: string): string;

export function safeMindOutput(gathered: GatherResult): MindOutput;

export interface ParseResult {
  output: MindOutput;
  /** Whether a retry prompt was needed */
  retried: boolean;
}

export async function parseMindOutput(
  rawJson: string,
  session: IAgentSession,
  gathered: GatherResult,
): Promise<ParseResult>;
```

**Lines removed from index.ts:** ~100 lines

---

### 1D: Extract `decision-executor.ts`

**What moves:**
- Agent decision dispatch (lines 1362-1394)
- Plugin decision dispatch (lines 1396-1430)
- `handleGoalTaskDecisions()` (lines 1575-1776)
- Permission checking for restricted decision types (lines 1318-1338)

**New file:** `packages/backend/src/heartbeat/decision-executor.ts`

**Interface:**
```typescript
export interface DecisionExecutorDeps {
  agentOrchestrator: AgentOrchestrator | null;
  compiledPersona: CompiledPersona | null;
  seedManager: SeedManager | null;
  goalManager: GoalManager | null;
}

/**
 * Execute all decisions from a mind output.
 * Called AFTER the DB transaction that logs decisions.
 */
export async function executeDecisions(
  decisions: MindOutput['decisions'],
  tickNumber: number,
  gathered: GatherResult,
  deps: DecisionExecutorDeps,
): Promise<void>;

/**
 * Log all decisions in a transaction (audit trail).
 * Returns the decisions that passed permission checks.
 */
export function logDecisionsInTransaction(
  hbDb: Database,
  decisions: MindOutput['decisions'],
  tickNumber: number,
  contact: Contact | null,
): void;
```

**Lines removed from index.ts:** ~450 lines
**Key benefit:** The giant if-else chains for agent/plugin/goal decisions become a focused module. Each decision category is a clear section. Future decision types are easy to add.

---

### 1E: Extract `execute-output.ts`

**What moves:**
- `executeOutput()` function (lines 1125-1564) — but now significantly thinner because decision execution, memory processing, and observational memory are delegated

**New file:** `packages/backend/src/heartbeat/execute-output.ts`

**Interface:**
```typescript
export async function executeOutput(
  output: MindOutput,
  tickNumber: number,
  gathered: GatherResult,
  deps: ExecuteOutputDeps,
  options?: {
    replySentEarly?: boolean;
    earlyReplyContent?: string;
    logSessionId?: string | null;
  },
): Promise<void>;
```

With delegation pattern:
```typescript
// Inside executeOutput — now a clean coordinator (~150 lines):
await sendReply(output.reply, gathered, replySentEarly, earlyReplyContent);
persistToDb(hbDb, output, tickNumber, gathered, settings);  // DB transaction
await executeDecisions(output.decisions, tickNumber, gathered, deps);
await processMemory(output, gathered, deps);
await processObservationalMemory(gathered, deps);
cleanup(hbDb, tickNumber, settings);
```

**Lines removed from index.ts:** ~440 lines (replaced by import + call)

---

### 1F: Slim down `index.ts` to orchestration spine

**What remains in index.ts (~600 lines):**
- Module state initialization (`HeartbeatContext` — see below)
- `initializeHeartbeat()` — system bootstrap
- `startHeartbeat()` / `stopHeartbeat()` — lifecycle
- `executeTick()` — the 3-stage pipeline coordinator (just the calls, not the implementations)
- `determineSessionState()` — session warmth logic
- `buildPersonaConfig()` — persona helper
- Public API: `handleIncomingMessage`, `handleAgentComplete`, `handleScheduledTask`, `triggerTick`, `getHeartbeatStatus`, etc.

**HeartbeatContext class** (replaces module-level state):
```typescript
class HeartbeatContext {
  agentManager: AgentManager | null = null;
  agentLogStoreAdapter: AgentLogStore | null = null;
  agentOrchestrator: AgentOrchestrator | null = null;
  compiledPersona: CompiledPersona | null = null;
  memoryManager: MemoryManager | null = null;
  vectorStore: VectorStore | null = null;
  seedManager: SeedManager | null = null;
  goalManager: GoalManager | null = null;
  embeddingProvider: LocalEmbeddingProvider | null = null;
  mindSessionState: MindSessionState;

  constructor() {
    this.mindSessionState = createMindSessionState();
  }
}

let ctx: HeartbeatContext;
```

**Benefits:**
- All dependencies visible in one place
- Testable: inject mock context
- Resettable: `ctx = new HeartbeatContext()`
- `executeTick()` becomes a clean 3-call coordinator (~50 lines of logic)

---

### Sprint 1 Summary

| File | Action | Lines |
|------|--------|-------|
| `heartbeat/index.ts` | Slim to ~600 lines (from 2,313) | -1,713 |
| `heartbeat/gather-context.ts` | New | ~300 |
| `heartbeat/mind-session.ts` | New | ~220 |
| `heartbeat/mind-parsing.ts` | New | ~100 |
| `heartbeat/decision-executor.ts` | New | ~450 |
| `heartbeat/execute-output.ts` | New | ~200 |

**Net:** Same total lines, but 6 focused files instead of 1 monolith. Each file has a single responsibility and a clear interface.

**Testing strategy:**
- Each extracted module gets its own test file
- `index.ts` integration test verifies the 3-stage pipeline still works end-to-end
- Existing `pipeline.test.ts` must continue passing with zero behavioral changes

**Risk mitigation:** This is a pure refactor — no behavior changes. Every function signature stays the same externally. The public API of the heartbeat module (`initializeHeartbeat`, `startHeartbeat`, `handleIncomingMessage`, etc.) is unchanged.

---

## Sprint 2: Service Layer Between API and Stores

Currently, tRPC routers call stores directly. This sprint adds a thin service layer for the three domains with the most business logic scattered in routers.

### 2A: Create `ContactService`

**New file:** `packages/backend/src/services/contact-service.ts`

**What moves from routers/stores into the service:**
- Contact creation with channel linking (from `contacts.ts` router)
- Contact listing with last-message enrichment (from `contacts.ts` router)
- Contact deletion with cascade cleanup across DBs
- Permission tier validation
- Contact channel resolution (used by both API and heartbeat)

**Interface:**
```typescript
export class ContactService {
  constructor(private deps: {
    sysDb: () => Database;
    msgDb: () => Database;
    memDb: () => Database;
    eventBus: IEventBus;
  }) {}

  listContacts(options?: { search?: string }): ContactWithLastMessage[];
  getContact(id: string): ContactDetail;
  createContact(data: CreateContactInput): Contact;
  updateContact(id: string, data: UpdateContactInput): Contact;
  deleteContact(id: string): void;  // Cascades across DBs
  addChannel(contactId: string, channel: AddChannelInput): ContactChannel;
  removeChannel(channelId: string): void;
  getContactNotes(contactId: string): string | null;
  updateContactNotes(contactId: string, notes: string): void;
}
```

**Router changes:** `contacts.ts` router becomes thin — validates input, calls service, returns result.

---

### 2B: Create `TaskService`

**New file:** `packages/backend/src/services/task-service.ts`

**What moves:**
- Task creation with scheduler registration (from `tasks.ts` router + heartbeat decision handler)
- Task status transitions with side effects (pause cascades to goals, cancel unregisters from scheduler)
- Task run management
- Deferred task queue management

**Interface:**
```typescript
export class TaskService {
  constructor(private deps: {
    hbDb: () => Database;
    eventBus: IEventBus;
    getTaskScheduler: () => TaskScheduler;
    getTaskRunner: () => TaskRunner;
    getDeferredQueue: () => DeferredTaskQueue;
  }) {}

  createTask(data: CreateTaskInput): Task;
  updateTask(id: string, data: UpdateTaskInput): Task;
  startTask(id: string): Task;
  completeTask(id: string, result?: string): Task;
  cancelTask(id: string): Task;
  skipTask(id: string): Task;
  pauseByGoalId(goalId: string): void;
  cancelByGoalId(goalId: string): void;
  listTasks(filters?: TaskFilters): Task[];
  getTask(id: string): Task;
  getTaskRuns(taskId: string): TaskRun[];
}
```

**Consumers:**
- `tasks.ts` router — API calls
- `decision-executor.ts` — mind decisions that create/update tasks
- Both use the same service, eliminating duplicate logic

---

### 2C: Create `MessageService`

**New file:** `packages/backend/src/services/message-service.ts`

**What moves:**
- Message listing with pagination
- Conversation management (get/create conversations)
- Message search across conversations

**Interface:**
```typescript
export class MessageService {
  constructor(private deps: {
    msgDb: () => Database;
    eventBus: IEventBus;
  }) {}

  getConversations(contactId?: string): Conversation[];
  getMessages(conversationId: string, options?: PaginationInput): Message[];
  getRecentMessages(conversationId: string, limit?: number): Message[];
  searchMessages(query: string, contactId?: string): Message[];
}
```

**Note:** Message *creation* stays in `ChannelRouter.sendOutbound()` and `ChannelRouter.handleIncoming()` — those are the authoritative write paths. The service only handles reads and queries.

---

### 2D: Wire services into routers

For each router that gains a service:
1. Instantiate service (lazily, singleton pattern matching existing `getEventBus()` pattern)
2. Replace direct store calls with service method calls
3. Remove any inline business logic (enrichment, cascade, side effects)
4. Router procedures become: validate input → call service → return result

**Example before/after:**
```typescript
// BEFORE (in contacts.ts router):
list: protectedProcedure.query(({ ctx }) => {
  const sysDb = getSystemDb();
  const msgDb = getMessagesDb();
  const contacts = systemStore.listContacts(sysDb);
  return contacts.map(c => {
    const channels = systemStore.getContactChannelsByContactId(sysDb, c.id);
    const lastMsg = messageStore.getLastMessageForContact(msgDb, c.id);
    return { ...c, channels, lastMessage: lastMsg };
  });
});

// AFTER:
list: protectedProcedure.query(({ ctx }) => {
  return getContactService().listContacts();
});
```

---

### Sprint 2 Summary

| File | Action |
|------|--------|
| `services/contact-service.ts` | New (~200 lines) |
| `services/task-service.ts` | New (~200 lines) |
| `services/message-service.ts` | New (~100 lines) |
| `api/routers/contacts.ts` | Simplify (call service) |
| `api/routers/tasks.ts` | Simplify (call service) |
| `api/routers/messages.ts` | Simplify (call service) |
| `heartbeat/decision-executor.ts` | Use TaskService for goal/task decisions |

**Testing strategy:**
- Each service gets its own test file with in-memory SQLite
- Router tests verify thin passthrough behavior
- Integration test: API call → service → store → DB roundtrip

---

## Sprint 3: Type-Safe EventBus Emit Calls

**Discovery:** The `IEventBus` interface is already type-safe — `emit<K extends keyof AnimusEventMap>(event: K, payload: AnimusEventMap[K])` enforces correct payloads at compile time.

**The actual problem:** Several call sites bypass the type safety by casting to raw `EventEmitter`:
```typescript
// Found in heartbeat/index.ts:
(eventBus as import('events').EventEmitter).emit('task:created', task);
(eventBus as import('events').EventEmitter).emit('task:updated', updated);
```

These casts defeat the generic constraints. A typo in the event name or wrong payload shape would not be caught.

### 3A: Remove all `EventEmitter` casts

**Scope:** Search the entire codebase for:
- `as import('events').EventEmitter` — cast patterns
- `as EventEmitter` — shorter cast patterns
- Any `.emit(` calls that don't go through the typed `IEventBus`

**Fix:** Replace each cast with a direct call through the typed interface:
```typescript
// BEFORE:
(eventBus as import('events').EventEmitter).emit('task:created', task);

// AFTER:
eventBus.emit('task:created', task);
```

**Why the casts exist:** Likely because the developer wasn't sure the event name was in `AnimusEventMap` at the time. If any event names are missing from the map, add them.

### 3B: Audit all event names

- Grep for all `.emit(` calls across the codebase
- Verify every event name exists in `AnimusEventMap` (in `packages/shared/src/event-bus.ts`)
- Add any missing event types to the map
- Ensure payload shapes match

### 3C: Add lint rule (optional)

Consider adding an ESLint rule or TypeScript strict check that prevents casting `IEventBus` to `EventEmitter`. This prevents future regressions.

**Estimated effort:** 1-2 hours. This is mostly a find-and-replace operation.

---

## Sprint 4: Minor Cleanups

### 4A: Move `EncryptionService` interface to shared

**Current state:** `EncryptionService` lives entirely in `packages/backend/src/services/credential-service.ts` (or `lib/encryption-service.ts`).

**Change:**
1. Create `packages/shared/src/encryption-service.ts`:
```typescript
export interface IEncryptionService {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
  isConfigured(): boolean;
}
```
2. Export from `packages/shared/src/index.ts`
3. Have backend implementation `implements IEncryptionService`
4. Update any consumers to import the interface from `@animus/shared`

**Files changed:**
- `packages/shared/src/encryption-service.ts` — New (interface only)
- `packages/shared/src/index.ts` — Add export
- `packages/backend/src/lib/encryption-service.ts` or `services/credential-service.ts` — Add `implements IEncryptionService`

---

### 4B: Eliminate `any` types in frontend

**Known locations (from agent review):**
- `PeoplePage.tsx` — contact filtering uses `any`
- `ContactDetail` — contact data typed as `any`
- Heartbeat `index.ts` line 321: `(agentTask as any).contactId`
- Heartbeat `index.ts` line 1046-1061: lenient parse block uses `as any` extensively

**Fix:** Replace each with proper type assertions or narrowing. For the lenient parse block, create a typed helper:
```typescript
function lenientParseMindOutput(parsed: unknown): MindOutput {
  // Type-safe extraction with defaults
}
```

**Scope:** ~10-15 `any` replacements across frontend and heartbeat.

---

### 4C: Extract `Conversation` and `MessageInput` from `PresencePage.tsx`

**Current state:** `PresencePage.tsx` is ~790 lines with several nested function components.

**Extract to:**
- `packages/frontend/src/components/presence/Conversation.tsx` — Message list rendering
- `packages/frontend/src/components/presence/MessageInput.tsx` — Input bar with send logic
- `packages/frontend/src/components/presence/ThoughtStream.tsx` — Live thought display

**PresencePage.tsx** becomes a layout coordinator (~200 lines) that composes these components.

---

### 4D: Fix media download path to absolute

**File:** `packages/backend/src/channels/channel-manager.ts` (around line 423)

**Current:**
```typescript
const localPath = path.join('data', 'media', `${id}.${ext}`);
```

**Fix:**
```typescript
const localPath = path.join(PROJECT_ROOT, 'data', 'media', `${id}.${ext}`);
```

---

### 4E: Add skill name collision detection in plugin system

**File:** `packages/backend/src/services/plugin-manager.ts`

**Current behavior:** If two plugins define the same skill name, the second symlink silently overwrites the first.

**Fix:** In `deploySkills()`, before creating symlinks:
1. Track all skill names across all enabled plugins
2. If a collision is found, log an error and skip the conflicting skill
3. Emit a warning event that the UI can surface

```typescript
// In deploySkills():
const skillRegistry = new Map<string, string>(); // skillName → pluginName
for (const [pluginName, skills] of Object.entries(pluginSkills)) {
  for (const skill of skills) {
    if (skillRegistry.has(skill.name)) {
      log.error(`Skill "${skill.name}" from plugin "${pluginName}" conflicts with plugin "${skillRegistry.get(skill.name)}". Skipping.`);
      continue;
    }
    skillRegistry.set(skill.name, pluginName);
    // ... create symlink
  }
}
```

---

### Sprint 4 Summary

| Task | Files | Effort |
|------|-------|--------|
| 4A: EncryptionService interface | shared + backend | ~30 min |
| 4B: Eliminate `any` types | frontend + heartbeat | ~1-2 hours |
| 4C: Extract PresencePage components | frontend | ~1-2 hours |
| 4D: Fix media path | channel-manager.ts | ~5 min |
| 4E: Skill collision detection | plugin-manager.ts | ~30 min |

---

## Execution Order & Dependencies

```
Sprint 1 (Heartbeat Decomposition)
  ├── 1A: gather-context.ts        (independent)
  ├── 1B: mind-session.ts          (independent)
  ├── 1C: mind-parsing.ts          (independent)
  ├── 1D: decision-executor.ts     (independent)
  ├── 1E: execute-output.ts        (depends on 1D)
  └── 1F: Slim index.ts            (depends on 1A-1E)

Sprint 2 (Service Layer)           — can start after Sprint 1
  ├── 2A: ContactService           (independent)
  ├── 2B: TaskService              (independent, benefits from 1D)
  ├── 2C: MessageService           (independent)
  └── 2D: Wire into routers        (depends on 2A-2C)

Sprint 3 (EventBus Type Safety)    — can run in parallel with Sprint 2
  ├── 3A: Remove casts             (independent)
  ├── 3B: Audit event names        (independent)
  └── 3C: Lint rule (optional)     (depends on 3A-3B)

Sprint 4 (Minor Cleanups)          — can run in parallel with Sprint 2-3
  ├── 4A: EncryptionService        (independent)
  ├── 4B: Eliminate any types      (independent)
  ├── 4C: Extract Presence         (independent)
  ├── 4D: Fix media path           (independent)
  └── 4E: Skill collision          (independent)
```

**Parallelization note:** Sprints 2, 3, and 4 are independent of each other and can run concurrently after Sprint 1 completes. Within each sprint, the independent tasks marked above can be parallelized across agents.

---

## Validation Criteria

After all sprints:

1. `npm run typecheck` passes with zero errors
2. `npm run test:run` passes with zero failures
3. `npm run lint` passes
4. `npm run build` succeeds
5. Manual smoke test: start backend + frontend, verify heartbeat ticks, send a message, verify reply

**No behavioral changes.** This is a pure structural refactor. Every user-facing feature works identically before and after.
