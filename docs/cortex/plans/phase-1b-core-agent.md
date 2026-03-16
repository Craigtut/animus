# Phase 1B: Core Agent

> **Scope:** Implement `CortexAgent`, `ContextManager`, event bridge, budget guards, and lifecycle management. After this phase, the core agent is runnable (but has no tools yet).

## Dependencies

- Phase 1A complete (types, utilities exist)

## Tasks

### 1B.1: ContextManager (`context-manager.ts`)

**Reference:** `context-manager.md`

Implement the `ContextManager` class:

```typescript
class ContextManager {
  constructor(agent: Agent, config: ContextManagerConfig);
  setSlot(name: string, content: string): void;
  getSlot(name: string): string | null;
  setEphemeral(content: string | null): void;
  getTransformContextHook(): (context: AgentContext) => AgentContext;
}
```

Key implementation details:
- Slots occupy positions `0` through `slotCount - 1` in `agent.state.messages`
- `setSlot()` directly updates the message at the corresponding position
- `setEphemeral()` stores content; the hook appends it at the end of the messages array (after conversation history) inside `transformContext`
- The hook is composable: consumer can chain it with other `transformContext` logic

**Tests:**
- Create ContextManager with 3 slots, verify positions in agent.state.messages
- setSlot updates the correct position
- getSlot reads back correctly
- setEphemeral content appears in transformContext output
- Ephemeral content appears AFTER conversation history
- Multiple setSlot calls on the same slot overwrite correctly
- Slot ordering matches definition order

### 1B.2: Event Bridge (`event-bridge.ts`)

**Reference:** `cortex-architecture.md` (Event Bridge section)

Map pi-agent-core's 10 events to the existing Animus `AgentEventType` enum:

| Pi Event | Mapped Event |
|----------|-------------|
| `agent_start` | `session_start` |
| `agent_end` | `session_end` |
| `turn_start` | `turn_start` (new) |
| `turn_end` | `turn_end` |
| `message_start` | `response_start` |
| `message_update` | `response_chunk` |
| `message_end` | `response_end` |
| `tool_execution_start` | `tool_call_start` |
| `tool_execution_update` | *(dropped or new)* |
| `tool_execution_end` | `tool_call_end` |

Implementation:
- Subscribe to pi-agent-core Agent events via `agent.subscribe()`
- Store the unsubscribe function for cleanup in `destroy()`
- Emit normalized events to consumer callbacks
- At `turn_end`: parse working tags from turn text, emit `AgentTextOutput`

**Tests:**
- Each pi-agent-core event maps to the correct Animus event type
- turn_end includes AgentTextOutput with parsed working tags
- Unsubscribe cleans up all listeners

### 1B.3: Budget Guard (`budget-guard.ts`)

**Reference:** `cortex-architecture.md` (Budget Guards section)

Monitor turn count and cost during the agentic loop:

- Track turns via `turn_end` events from the event bridge
- Track cost via `AssistantMessage.usage.cost.total` (available in pi-ai responses)
- On breach: call `agent.abort()`
- Defaults: `maxTurns: Infinity`, `maxCost: Infinity` (no enforcement unless configured)

**Tests:**
- Turn count tracking increments on each turn_end
- Cost tracking accumulates from usage data
- Abort called when maxTurns exceeded
- Abort called when maxCost exceeded
- No abort when limits are Infinity
- Counters reset between loops (per `agent_start`)

### 1B.4: System Prompt Assembly

**Reference:** `system-prompt.md`

Implement `buildSystemPrompt(consumerPrompt: string): string` as a method on CortexAgent.

Appends cortex operational sections after the consumer's content:
1. Response Delivery (conditional on `workingTags.enabled`)
2. System Rules
3. Taking Action
4. Tool Usage
5. Executing with Care
6. Environment (platform, shell, working directory)

Platform detection: `process.platform`, `process.arch`, `os.version()`, shell from `$SHELL` or PowerShell discovery.

**Tests:**
- Consumer prompt appears before cortex sections
- workingTags.enabled=true includes Response Delivery section
- workingTags.enabled=false omits it
- Environment section contains correct platform
- rebuildSystemPrompt preserves conversation history

### 1B.5: CortexAgent (`cortex-agent.ts`)

**Reference:** `cortex-architecture.md` (full doc), lifecycle section

The main orchestrator class. Composes all other modules.

```typescript
class CortexAgent {
  constructor(config: CortexAgentConfig);

  // Prompt
  async prompt(input: string): Promise<AgentResponse>;

  // Context
  getContextManager(): ContextManager;

  // System prompt
  buildSystemPrompt(consumerPrompt: string): string;
  rebuildSystemPrompt(newConsumerPrompt: string): void;

  // Persistence (consumer-owned storage)
  getConversationHistory(): AgentMessage[];
  restoreConversationHistory(messages: AgentMessage[]): void;

  // Model access
  getModel(): Model;
  getUtilityModel(): Model;
  async utilityComplete(context: Context): Promise<AssistantMessage>;

  // Lifecycle
  async abort(): Promise<void>;
  async destroy(timeoutMs?: number): Promise<void>;  // default: 8000ms
  get isRunning(): boolean;
  get state(): CortexLifecycleState;

  // Events
  onLoopComplete(handler: () => void): void;
  onError(handler: (error: ClassifiedError) => void): void;
  onCompaction(handler: () => void): void;
  onSubAgentSpawned(handler: (taskId: string, instructions: string) => void): void;
  onSubAgentCompleted(handler: (taskId: string, result: string, status: string, usage: unknown) => void): void;
  onSubAgentFailed(handler: (taskId: string, error: string) => void): void;
}
```

Implementation sequence within this task:
1. Constructor: create pi-agent-core `Agent`, set up `ContextManager`, wire `transformContext` hook (composing: ephemeral injection -> compaction stub -> skill buffer stub), wire event bridge, set up budget guard, validate same-provider constraint for utility model, store all event unsubscribe functions for cleanup
2. `prompt()`: reset session-scoped state (ReadRegistry, CwdTracker, WebFetch rate counter), call `agent.run()` (or `agent.prompt()`), catch errors and classify via `classifyError()` from Phase 1A (pass `wasAborted: agent.abortController?.signal.aborted`), emit `onError` for classified errors, transition lifecycle `CREATED -> ACTIVE` on first prompt
3. Model tier resolution: resolve utility model from `UTILITY_MODEL_DEFAULTS` map; validate same-provider constraint at construction (throw if violated)
4. Persistence methods: `getConversationHistory()` slices messages after slot region (positions `slotCount` through end); `restoreConversationHistory()` splices messages after slot region
5. Lifecycle: `abort()` calls `agent.abort()` + `waitForIdle()`, returns to ACTIVE state; `destroy()` does ordered cleanup (abort, wait for idle, emit onLoopComplete for final checkpoint, close MCP connections (stub in 1B, wired in Phase 3), cancel sub-agents (stub in 1B, wired in Phase 4), clear skill buffer (stub), unsubscribe all event listeners, reset agent, mark DESTROYED)
6. System prompt: `buildSystemPrompt()` composes consumer + cortex operational sections
7. `onLoopComplete` maps to pi-agent-core's `agent_end` event (NOT `turn_end`). `onTurnComplete` maps to `turn_end` and includes `AgentTextOutput` parsed via `parseWorkingTags()` from Phase 1A
8. Tool permission gate: wire `beforeToolCall` hook on pi-agent-core Agent. Accept a `resolvePermission` callback in config that the consumer provides. Default: allow all.

**Stubs for later phases:** `destroy()` steps for MCP client cleanup (Phase 3), sub-agent cancellation (Phase 4), and compaction in `transformContext` (Phase 5) are no-ops in Phase 1B. The code paths exist but do nothing until those phases are implemented.

**Tests:**
- Constructor creates Agent with correct config
- prompt() runs the agent and returns response
- Error classification fires onError callback
- abort() stops a running loop
- destroy() cleans up all resources, rejects subsequent prompt() calls
- getConversationHistory() returns correct slice (excludes slots)
- restoreConversationHistory() injects messages at correct position
- Utility model resolves from defaults map
- rebuildSystemPrompt() updates system prompt without losing conversation

## Completion Criteria

- CortexAgent can be constructed, prompted, and destroyed
- ContextManager manages slots and ephemeral content correctly
- Events flow from pi-agent-core through the event bridge to consumer callbacks
- Budget guards abort the loop on breach
- System prompt assembles correctly from consumer + cortex sections
- All lifecycle states work (created -> active -> destroyed)
- Full unit test coverage for all five modules

## Files Created

| File | Purpose |
|------|---------|
| `packages/cortex/src/context-manager.ts` | Slot + ephemeral context management |
| `packages/cortex/src/event-bridge.ts` | Pi event normalization |
| `packages/cortex/src/budget-guard.ts` | Turn/cost enforcement |
| `packages/cortex/src/cortex-agent.ts` | Main agent class |
| `packages/cortex/tests/unit/context-manager.test.ts` | Tests |
| `packages/cortex/tests/unit/event-bridge.test.ts` | Tests |
| `packages/cortex/tests/unit/budget-guard.test.ts` | Tests |
| `packages/cortex/tests/unit/cortex-agent.test.ts` | Tests |
