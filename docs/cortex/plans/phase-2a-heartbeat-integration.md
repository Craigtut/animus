# Phase 2A: Heartbeat Integration

> **Scope:** Wire cortex into the Animus heartbeat pipeline. Implement the 5-phase mind loop (GATHER, THOUGHT, AGENTIC LOOP, REFLECT, EXECUTE). This is the critical milestone where Animus actually switches from the Claude SDK to cortex.

## Dependencies

- Phase 1C complete (tools exist)
- Phase 1D complete (provider manager, system prompt work)
- Phase 0 complete (backend prep done)

## Tasks

### 2A.1: CortexAgent Creation in Backend

**Modify:** `packages/backend/src/heartbeat/agent-subsystem.ts`

Replace `AgentManager` creation with `CortexAgent` creation:

- Instantiate `ProviderManager`
- Read `cortex_provider`, `cortex_model`, `utility_model` from `system_settings`
- Resolve models via `providerManager.resolveModel()`
- Build `getApiKey` callback using `CortexCredentialService` (or direct env var lookup for Phase 2A)
- Create `CortexAgent` with config: model, utilityModel, workingDirectory (`ANIMUS_DATA_DIR/workspace/`), tools (from tool registry), slots, budget guards
- Wire event listeners: `onLoopComplete` (checkpoint), `onError` (log + EventBus), `onCompaction` (observational memory + re-seed)

**Optionally keep** `AgentManager` for sub-agent compatibility during migration.

### 2A.2: Tool Registration

**Modify:** `packages/backend/src/heartbeat/mind-session.ts` (or equivalent new file)

Register tools with the CortexAgent:

**Built-in cortex tools:** Bash, Read, Write, Edit, Glob, Grep, WebFetch (from Phase 1C)

**Animus tools** (converted from existing MCP tool registry to direct `AgentTool` objects):
- `send_message`, `update_progress`, `read_memory`, `lookup_contacts`, `send_proactive_message`, `send_media`, `run_with_credentials`, `list_vault_entries`, `manage_vault_entry`, `transcribe_audio`, `generate_speech`, `send_voice_reply`
- Each tool handler in `packages/backend/src/tools/handlers/` stays as-is; only the wrapper changes from MCP protocol to direct `AgentTool.execute()` call
- Use `zodToTypebox()` from Phase 1A to convert Zod parameter schemas

**Permission gate:** Wire `beforeToolCall` hook to existing `resolveToolGate()` from `tool-gate.ts`.

### 2A.3: Context Slot Configuration

**Modify:** `packages/backend/src/heartbeat/mind-session.ts` (or new file)

Set up the 9 context slots in the order defined in `mind-migration.md`:

```typescript
const cm = cortexAgent.getContextManager();
// Slots 0-8 (see mind-migration.md for full table)
cm.setSlot('credentials', buildCredentialContext(...));
cm.setSlot('contacts', buildContactsContext(...));
cm.setSlot('core-self', buildCoreSelfContext(...));
cm.setSlot('working-memory', buildWorkingMemoryContext(...));
cm.setSlot('thought-observations', buildThoughtObservationContext(...));
cm.setSlot('experience-observations', buildExperienceObservationContext(...));
cm.setSlot('message-observations', buildMessageObservationContext(...));
cm.setSlot('goals', buildGoalContext(...));
cm.setSlot('tasks', buildTaskContext(...));
```

The `build*Context()` functions use the existing context builder building blocks from Phase 0 refactors.

Add slot update logic in GATHER phase: check EventBus signals (`plugin:changed`, `persona:updated`, `contact:updated`, etc.) and only update dirty slots.

### 2A.4: System Prompt Construction

Build the consumer system prompt (the mind's identity and instructions) and pass to cortex:

Consumer prompt includes:
- Persona (compiled text)
- Inner Life (PREAMBLE)
- Emotion Guidance
- Energy Guidance (static band descriptions)
- Decisions Reference
- Memory Instructions
- Goal Guidance
- Installed Plugins & Tools

Cortex appends its operational sections (System Rules, Tool Usage, Executing with Care, Environment).

Wire system prompt rebuild triggers:
- `persona:updated` EventBus event
- `plugin:changed` EventBus event
- Settings changes affecting agent behavior

### 2A.5: The 5-Phase Pipeline

**Modify:** `packages/backend/src/heartbeat/index.ts`

Replace `mindQuery()` with the 5-phase pipeline:

**Phase 1: GATHER** — Same as current `gatherContext()`. Populate slots, set ephemeral context.

**Phase 2: THOUGHT** — Direct pi-ai call via `cortexAgent.getModel()` + pi-ai `complete()`. NOT through `agent.prompt()`. Response is NOT added to `agent.state.messages`.

System prompt (THOUGHT-specific, own cache prefix): Thought Instructions (FIRST, for cache divergence) + Persona + Inner Life PREAMBLE. Excludes: Emotion Guidance, Energy Guidance, Decisions Reference, Memory Instructions, Goal Guidance, Installed Plugins & Tools.

Slots included: contacts, core-self, working-memory, thought-observations, experience-observations, message-observations, goals, tasks. Excluded: credentials.

Context includes: conversation history + ephemeral context (same as agentic loop).

See `mind-migration.md` "THOUGHT Context" section for the full slot inclusion table.

- Parse structured output (thought content, importance)
- Persist thought to heartbeat.db
- Inject thought into ephemeral context for agentic loop
- On failure: log warning, continue with null thought

**Phase 3: AGENTIC LOOP** — `cortexAgent.prompt(tickPrompt)`
- Tick prompt built from `buildTriggerSection()` (the trigger context IS the user message)
- Reply text streams via event bridge `response_chunk` events
- Reply delivery via `ChannelRouter.sendOutbound()` at `turn_end` events
- Mid-tick message injection via `agent.steer()` (replaces `session.injectMessage()`)
- On failure: check if any turns completed; if yes, use partial results; if no, use safe fallback

**Phase 4: REFLECT** — Direct pi-ai call via `cortexAgent.getModel()` + pi-ai `complete()`. NOT through `agent.prompt()`. Response is NOT added to `agent.state.messages`.

System prompt (REFLECT-specific, own cache prefix): Reflect Instructions (FIRST, for cache divergence) + Persona + Inner Life PREAMBLE + Emotion Guidance + Energy Guidance + Decisions Reference + Memory Instructions + Goal Guidance. Excludes: Installed Plugins & Tools.

Slots included: contacts, core-self, working-memory, thought-observations, experience-observations, message-observations, goals, tasks. Excluded: credentials.

Conversation history INCLUDES the agentic loop's turns (this is critical: REFLECT needs to see what happened).

See `mind-migration.md` "REFLECT Context" section for the full slot inclusion table.

- Parse structured output (experience, emotion deltas, energy delta, memory candidates, working memory update, core self update)
- On failure: retry up to 3 times with exponential backoff (1s, 2s, 4s); if all fail, skip reflection

**Phase 5: EXECUTE** — Same as current `executeOutput()`. Receives combined output from THOUGHT + AGENTIC LOOP + REFLECT. No changes to execute logic.

### 2A.6: Session Persistence

Wire the persistence mechanism from `mind-migration.md`:

- `onLoopComplete`: snapshot `cortexAgent.getConversationHistory()` to `heartbeat_state.conversation_history`
- Startup: restore from checkpoint via `cortexAgent.restoreConversationHistory()`; if no checkpoint, re-seed from `messages.db` post-watermark items
- Crash recovery: last checkpoint used

### 2A.7: Permission Seeder Update

**Modify:** `packages/backend/src/tools/permission-seeder.ts`

Add entries for cortex built-in tools (Bash, Read, Write, Edit, Glob, Grep, WebFetch) alongside existing MCP tool permissions. Use appropriate risk tiers:
- Bash: `acts` (ask by default)
- Read: `safe` (always_allow by default)
- Write: `acts` (ask by default)
- Edit: `acts` (ask by default)
- Glob: `safe` (always_allow by default)
- Grep: `safe` (always_allow by default)
- WebFetch: `communicates` (always_allow by default)

### 2A.8: Streaming and Reply Delivery

Replace the phase-gated streaming mechanism:

**Current:** `pre-thought` -> `replying` phase gate in `cognitive-tools.ts`. Text only streams after `record_thought` tool call.

**New:** Text streams immediately when the agentic loop starts (Phase 3). No phase gate. Reply text accumulated from `response_chunk` events. Delivered at `turn_end` via `ChannelRouter.sendOutbound()`.

Working tags (if enabled): `AgentTextOutput.userFacing` is delivered; `working` content is for logs/frontend only.

### 2A.9: Mid-Tick Message Injection

Replace `session.injectMessage()` with `agent.steer()`:

- During THOUGHT phase: queue in `pendingInjections[]`
- During AGENTIC LOOP: call `agent.steer()` directly
- During REFLECT/EXECUTE: let TickQueue debounce trigger a new tick

### 2A.10: Remove Cognitive Tools

**Modify:** `packages/backend/src/heartbeat/cognitive-tools.ts`

Remove or restructure:
- Remove `handleRecordThought()` and `handleRecordCognitiveState()` tool handlers
- Remove the `snapshotBox` singleton and phase tracking (`pre-thought` -> `replying`)
- Keep `CognitiveSnapshot` type and `snapshotToMindOutput()` conversion (now populated from THOUGHT + REFLECT outputs instead of tool calls)

**Modify:** `packages/backend/src/tools/servers/mcp-bridge.ts`
- Remove cognitive endpoints (`POST /cognitive/thought`, `POST /cognitive/state`)

## Completion Criteria

- Animus heartbeat runs on CortexAgent instead of Claude/Codex SDK sessions
- 5-phase pipeline works: GATHER -> THOUGHT -> AGENTIC LOOP -> REFLECT -> EXECUTE
- All Animus tools (send_message, read_memory, etc.) are registered as direct `AgentTool` objects
- All cortex built-in tools (Bash, Read, Write, etc.) are registered
- Context slots populated correctly from database state
- Ephemeral context injected correctly per tick
- Reply streaming works without phase gate
- Mid-tick message injection works via `agent.steer()`
- Session persistence checkpoints conversation history after each tick
- Startup/restart restores from checkpoint
- Permission gate works for all tools (built-in + Animus + plugin)
- Cognitive tools replaced by programmatic THOUGHT/REFLECT phases

### 2A.11: Error Classification and Rate Limit Backoff

**Reference:** `error-recovery.md`

Wire the error classifier (built in Phase 1A) into the heartbeat pipeline:

- `cortexAgent.onError()`: Route classified errors to EventBus `system:error` for auth, rate_limit, server_error categories (expanding beyond the current auth-only handling)
- Rate limit backoff: Track `consecutiveRateLimits` in the heartbeat pipeline. On `rate_limit` error, delay next tick via `tickQueue.delayNext()`. Exponential backoff: 30s, 60s, 120s, 240s (max 5 min). Reset on successful tick.
- Auth errors: Emit `system:error` with `category: 'authentication'` (existing path, now via cortex classifier instead of `AgentError` instanceof check)

### 2A.12: Startup Slot Restoration

On startup/restart, rebuild all 9 context slots from their database sources BEFORE restoring conversation history. Slots are never deserialized from the checkpoint; they are always rebuilt fresh:

```typescript
cm.setSlot('credentials', buildCredentialContext(credentialStore));
cm.setSlot('contacts', buildContactsContext(contactStore));
// ... all 9 slots from their source databases
```

Then restore conversation history from checkpoint (or re-seed from messages.db if no checkpoint).

### 2A.13: Windows Tauri Graceful Shutdown

**Reference:** `cross-platform-considerations.md` (Windows Tauri Graceful Shutdown)

On Windows, Tauri's `child.kill()` calls `TerminateProcess` (instant kill, no signal). `destroy()` never runs.

**Modify:** `packages/tauri/src/main.rs`

Add IPC-based shutdown for Windows:
1. Send a shutdown IPC message to the sidecar
2. Wait up to 5 seconds for the sidecar to exit
3. Fall back to `child.kill()` if it doesn't exit

The sidecar's IPC handler calls `stopHeartbeat()` -> `destroy()` upon receiving the shutdown message.

This mirrors the Unix SIGTERM pattern already working on macOS/Linux.

## Files Modified

| File | Change |
|------|--------|
| `heartbeat/agent-subsystem.ts` | Create CortexAgent instead of AgentManager |
| `heartbeat/index.ts` | 5-phase pipeline, persistence, mid-tick injection, error classification, rate limit backoff |
| `heartbeat/mind-session.ts` | CortexAgent creation, tool registration, slot config |
| `heartbeat/gather-context.ts` | Remove `determineSessionState()`, remove `sessionState` parameter |
| `heartbeat/cognitive-tools.ts` | Remove tool handlers, keep types/conversion |
| `heartbeat/context-builder.ts` | Remove COGNITIVE_PROCEDURE (if not done in Phase 0), remove `buildMindContext()` sessionState parameter |
| `tools/servers/mcp-bridge.ts` | Remove cognitive endpoints |
| `tools/permission-seeder.ts` | Add built-in tool permission entries |
| `packages/tauri/src/main.rs` | Windows IPC-based graceful shutdown (2A.13) |
