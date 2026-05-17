# Mind Migration to Cortex

> **STATUS: IMPLEMENTED** - The 5-phase pipeline is live. Session threading (per-contact+channel) added in the Cortex upgrade sprint (2026-04). See `upgrade-plan.md` for architectural decisions.
>
> **Note:** This is an Animus-specific integration doc. Cortex framework documentation (architecture, tools, compaction, skills, providers) lives in the [cortex-mono](https://github.com/Craigtut/cortex-mono) repository.

This document describes the implemented Cortex mind pipeline: the heartbeat's persistent CortexAgent session, the 5-phase tick flow, context slot configuration, and backend integration points.

## Pipeline Restructure

### Current: 3-Phase Pipeline

```
GATHER → MIND QUERY (agentic loop) → EXECUTE
```

Today, `record_thought` and `record_cognitive_state` are MCP tools the agent is instructed to call during the agentic loop: thought first, reply in the middle, cognitive state last. A phase gate (`pre-thought` → `replying`) controls when streamed text reaches the user. This works but has fragility:

- If the agent skips `record_thought`, no reply text streams and the snapshot is empty.
- If the agent skips `record_cognitive_state`, emotions, decisions, and memory candidates are lost.
- The agentic loop mixes cognitive bookkeeping with actual tool use and reasoning.
- Structured data capture depends on the agent following behavioral instructions in the system prompt.

### New: 5-Phase Pipeline

```
GATHER → THOUGHT → AGENTIC LOOP → REFLECT → EXECUTE
```

**Phase 1: GATHER** — Same as today. Assemble all context from databases, channels, and external sources.

**Phase 2: THOUGHT** — A direct `pi-ai` call (`complete()` or `stream()`), NOT through `agent.prompt()`. This is a direct migration of the existing `record_thought` tool: same prompt logic, same schema, same output structure, just invoked programmatically. The existing tool handler (`handleRecordThought` in `cognitive-tools.ts`) and its system prompt guidance define exactly what this phase produces:

- Thought content (stream of consciousness, under 40 words)
- Thought importance (0.0-1.0)

The THOUGHT response is NOT added to `agent.state.messages`. It is processed externally (the thought is persisted to the database and injected into the agentic loop's ephemeral context).

**Phase 3: AGENTIC LOOP** — The `CortexAgent` runs with its full tool set via `agent.prompt(tickPrompt)`. The thought from Phase 2 is available in ephemeral context. The agent focuses purely on reasoning, tool use, decision-making, and replying. No cognitive tools are registered; no bookkeeping is expected from the agent. Reply text can stream immediately (no phase gate needed since the thought was already captured). When working tags are enabled (the default), the agent uses `<working>` tags to separate internal reasoning from user-facing communication. See `docs/cortex/working-tags.md` in the cortex-mono repository for the full design.

**Phase 4: REFLECT** — A direct `pi-ai` call after the agentic loop finishes. This is a direct migration of the existing `record_cognitive_state` tool: same prompt logic, same schema (`recordCognitiveStateSchema`), same output structure, just invoked programmatically. The existing tool handler (`handleRecordCognitiveState` in `cognitive-tools.ts`) defines exactly what this phase produces:

- Experience narration (third-person past tense, under 72 words)
- Emotion deltas (per-emotion with reasoning, 12 emotions, delta range -0.3 to 0.3)
- Energy delta (with reasoning, range -0.1 to 0.1)
- Memory candidates (content, type, importance, optional contact/keywords)
- Working memory update (string or null)
- Core self update (string or null)

The REFLECT call constructs its context from the agent's current state (which now includes the agentic loop's conversation turns), giving it full visibility into what happened during the tick.

The REFLECT response is NOT added to `agent.state.messages`. It is processed externally (emotions, memories, decisions are persisted in the EXECUTE phase).

**Phase 5: EXECUTE** — Same as today. Processes the combined output from THOUGHT + AGENTIC LOOP + REFLECT: persists thoughts, experiences, emotions, energy, decisions, memories. Executes decisions (spawn agents, goal operations, task scheduling).

### Benefits

- **Guaranteed structure**: Thought and reflection always happen, always return valid structured data. No dependency on the agent following behavioral instructions.
- **Cleaner agentic loop**: The cortex agent focuses on what it does best. No cognitive bookkeeping mixed in.
- **No phase gate**: The `pre-thought` → `replying` phase gate is eliminated. Reply streaming can begin as soon as the agentic loop starts.
- **Simpler agentic system prompt**: The cognitive procedure instructions (`COGNITIVE_PROCEDURE` in `context-builder.ts`) are removed. The agent no longer needs to know about `record_thought` or `record_cognitive_state`.

### Phase Failure Handling

Each of the three LLM phases (THOUGHT, AGENTIC LOOP, REFLECT) can fail independently. The pipeline should be resilient: a failure in one phase should not necessarily abort subsequent phases if they can still produce value.

**Design principle:** Continue forward unless there is truly nothing to work with. Err on the side of running REFLECT, since losing emotion/memory/energy updates degrades the agent's inner life over time.

#### THOUGHT Failure

If the THOUGHT pi-ai call fails (API error, timeout, rate limit):

- **Do not retry.** THOUGHT sits on the critical path before the agentic loop. Retrying introduces latency before the user sees a first reply.
- **Continue to AGENTIC LOOP.** The thought is a framing input, not a hard dependency. The agentic loop can operate without it; the agent just has slightly less context about its own cognitive state.
- **Inject a null thought into ephemeral context.** The agentic loop's ephemeral section normally contains the thought. If THOUGHT failed, inject a brief note like "Thought generation was skipped this tick" so the agent does not hallucinate a thought it never had.
- **Log the failure** as a `thought_failed` event in agent_logs.db. Surface via `system:warning` (not `system:error`, since the tick continues).
- **EXECUTE receives null thought.** No thought is persisted to heartbeat.db for this tick.

#### AGENTIC LOOP Failure

The agentic loop can fail at different points, and the failure's impact depends on how far the loop progressed:

- **Early failure (no turns completed):** The agent never responded. `agent.state.messages` contains no new turns from this tick. This is the worst case: no reply, no tool calls, no reasoning.
- **Partial failure (some turns completed):** The agent completed one or more turns (potentially including tool calls and partial replies sent to the user via per-turn early sending), then the loop errored on a subsequent turn. Conversation history contains the completed turns.
- **Late failure (most work done, error on final tool call):** Most work is complete. The reply may have been fully sent already via per-turn delivery.

**Signal for deciding whether to REFLECT:** Inspect `agent.state.messages` for new assistant turns added during this tick. If there are any new assistant messages (even partial ones), the REFLECT phase has meaningful content to reflect on. If there are zero new assistant turns, REFLECT has nothing to work with.

```typescript
const newTurnsFromLoop = countNewAssistantTurns(agent.state.messages, loopStartIndex);

if (newTurnsFromLoop === 0 && thoughtFailed) {
  // Both THOUGHT and AGENTIC LOOP produced nothing. Skip REFLECT.
  log.warn('Skipping REFLECT: no content from THOUGHT or AGENTIC LOOP');
  return safeMindOutput(triggerInfo);
}

// At least one phase produced content. Run REFLECT.
```

**Reply handling on partial failure:** If per-turn early sending already delivered text to the user, those messages are in `messages.db` regardless of the loop failure. The user received them. EXECUTE should not re-send. The `replySentEarly` flag (or equivalent) tracks this.

**Do not retry the agentic loop.** The loop may have had side effects (tool calls, messages sent, files modified). Retrying could cause duplicate actions.

#### REFLECT Failure

If the REFLECT pi-ai call fails:

- **Retry up to 3 times with exponential backoff** (1s, 2s, 4s). REFLECT is the last LLM call in the tick, so retry latency does not block user-facing output. The data it produces (emotions, energy, memories, experience narration) is valuable for the agent's long-term inner life.
- **If all retries fail:** The tick loses emotion deltas, energy deltas, memory candidates, experience narration, working memory updates, and core self updates for this tick. This is acceptable for a single tick but would degrade the agent if it happened consistently.
- **Log the failure** as a `reflect_failed` event. Surface via `system:warning`.
- **EXECUTE receives null reflection.** No emotion/energy/memory updates are applied. Thoughts from THOUGHT (if it succeeded) are still persisted. Reply from AGENTIC LOOP (if it succeeded) is still sent.

#### Summary Table

| Phase | On Failure | Retry? | Continue Pipeline? | What's Lost |
|-------|-----------|--------|-------------------|-------------|
| THOUGHT | Log warning, inject null thought | No (latency-sensitive) | Yes, always | Thought text for UI and ephemeral framing |
| AGENTIC LOOP | Log error, check for turns | No (side effects) | REFLECT if any turns exist | Reply (if early failure), tool results |
| REFLECT | Retry 3x with backoff | Yes (not user-facing) | EXECUTE with null reflection if all retries fail | Emotions, energy, memories, experience |

#### The `safeMindOutput()` Equivalent

The current `safeMindOutput()` produces a minimal `MindOutput` when the entire mind query fails. In the 5-phase pipeline, this becomes more granular:

- **All phases failed (THOUGHT + AGENTIC LOOP with 0 turns):** Return a minimal `MindOutput` with a fallback thought ("I experienced difficulty this tick") and no reply, emotions, or memories.
- **THOUGHT failed, AGENTIC LOOP succeeded:** `MindOutput` has null thought but full agentic output. If REFLECT also succeeded, full inner life updates.
- **THOUGHT succeeded, AGENTIC LOOP failed with 0 turns:** `MindOutput` has the thought but no reply. REFLECT is skipped. Thought is still persisted.
- **Everything succeeded except REFLECT:** `MindOutput` has thought and reply but null reflection. No emotion/memory/energy updates.

### Prefix Caching Across Phases

Each phase has its own tailored system prompt and maintains its own independent cache. Anthropic and OpenAI both support multiple concurrent cached prefixes per API key with no stated limit. Each cache entry has a 5-minute TTL that refreshes on use, which aligns with the default tick interval.

```
THOUGHT:        [thought-system-prompt + slots + history + ephemeral + thought-prompt]
                 → own cache, refreshed every tick

AGENTIC LOOP:   [full-system-prompt + slots + history + ephemeral + tick-prompt]
                 → own cache, refreshed every tick

REFLECT:        [reflect-system-prompt + slots + history+loop-turns + reflect-prompt]
                 → own cache, refreshed every tick
```

### THOUGHT Context

The THOUGHT phase uses a stripped-down system prompt and a subset of slots. It needs enough context to produce a relevant thought but does not need tool/decision/goal guidance.

**System prompt** (THOUGHT-specific, own cache). Starts with the thought generation instructions (migrated from the `record_thought` tool description) to ensure prefix divergence from the other phases:

| Section | Included | Notes |
|---------|:--------:|-------|
| Thought Instructions | Yes | **First in prompt.** Migrated from `record_thought` tool description. Frames what to produce (stream of consciousness, under 40 words, importance 0-1). Ensures unique prefix for own cache. |
| Persona | Yes | Identity grounds the thought |
| Inner Life (PREAMBLE) | Yes | Frames how to think |
| Emotion Guidance | No | Not producing emotion deltas |
| Energy Guidance | No | Not producing energy deltas |
| Decisions Reference | No | Not making decisions |
| Memory Instructions | No | Not producing memory candidates |
| Goal Guidance | No | Not advancing goals |
| Installed Plugins & Tools | No | Not using tools |

**Slots**:

| Slot | Included | Notes |
|------|:--------:|-------|
| credentials | No | Not using tools |
| contacts | Yes | Thoughts may reference people |
| core-self | Yes | Self-knowledge informs thought |
| working-memory | Yes | Per-contact context informs thought |
| thought-observations | Yes | Compressed thought history informs thought |
| experience-observations | Yes | Compressed experience history informs thought |
| message-observations | Yes | Compressed message history informs thought |
| goals | Yes | Goals may be on the agent's mind |
| tasks | Yes | Pending tasks may be on the agent's mind |

**Ephemeral context**: Same as agentic loop (date/time, active contact, emotional state, energy state, recent thoughts, recent experiences, retrieved memories, external history, previous tick outcomes, etc.). The thought needs full situational awareness.

**User message**: The thought generation prompt (migrated from `record_thought` tool description + structured output schema).

### REFLECT Context

The REFLECT phase needs the full picture of what happened during the tick to produce accurate emotion deltas, experience narration, and memory candidates.

**System prompt** (REFLECT-specific, own cache). Starts with the cognitive state instructions (migrated from the `record_cognitive_state` tool description) to ensure prefix divergence from the other phases:

| Section | Included | Notes |
|---------|:--------:|-------|
| Reflect Instructions | Yes | **First in prompt.** Migrated from `record_cognitive_state` tool description. Frames what to produce (experience narration, emotion deltas, energy delta, memory candidates, working memory/core self updates). Ensures unique prefix for own cache. |
| Persona | Yes | Identity grounds the reflection |
| Inner Life (PREAMBLE) | Yes | Frames inner life experience |
| Emotion Guidance | Yes | Producing emotion deltas |
| Energy Guidance | Yes | Producing energy delta |
| Decisions Reference | Yes | Reviewing decisions made during the loop |
| Memory Instructions | Yes | Producing memory candidates, working memory/core self updates |
| Goal Guidance | Yes | Assessing goal progress |
| Installed Plugins & Tools | No | Not using tools |

**Slots**:

| Slot | Included | Notes |
|------|:--------:|-------|
| credentials | No | Not using tools |
| contacts | Yes | Context for experience narration |
| core-self | Yes | Self-knowledge informs reflection |
| working-memory | Yes | Per-contact context informs reflection |
| thought-observations | Yes | Historical thought context for reflection |
| experience-observations | Yes | Historical experience context for reflection |
| message-observations | Yes | Historical message context for reflection |
| goals | Yes | Goal progress assessment |
| tasks | Yes | Task progress assessment |

**Ephemeral context**: Same as agentic loop. The reflection needs the same situational awareness.

**Conversation history**: Includes the agentic loop's turns (tool calls, responses, decisions). This is critical: REFLECT needs to see what actually happened during the loop to produce accurate emotion deltas and experience narration.

**User message**: The cognitive state generation prompt (migrated from `record_cognitive_state` tool description + structured output schema).

## System Prompt

The system prompt is set once and rarely changes. It contains identity, behavioral instructions, and reference material. The following sections from the current context builder stay in the system prompt:

| Section | Current Source | Notes |
|---------|--------------|-------|
| Persona | `compiledPersona.compiledText` | Identity, personality dimensions, traits, values, backstory |
| Inner Life | `PREAMBLE` | Existence frame, agency framing |
| Emotion Guidance | `EMOTION_GUIDANCE` | 12 emotions, delta mechanics, magnitude guidance |
| Energy Guidance | `buildEnergyGuidance()` | Energy delta mechanics. Magnitude calibration moves to ephemeral context (changes during sleep transitions). |
| Decisions Reference | `buildDecisionRef()` | All decision types with parameter signatures |
| Memory Instructions | `MEMORY_INSTRUCTIONS` | Working memory, core self, long-term candidate guidance |
| Goal Guidance | `GOAL_GUIDANCE` | Seed planting, goal proposal, active goal advancement |
| Installed Plugins & Tools | Currently in user message as plugin context | Move to system prompt. Installed plugins, available tools, channel configs. Changes trigger system prompt rebuild. |

**Removed from system prompt**: `COGNITIVE_PROCEDURE` (replaced by programmatic THOUGHT/REFLECT phases), `SESSION_AWARENESS` (no longer relevant with always-warm sessions).

**Moved to ephemeral**: Date & Time (`buildDateTimeAwareness`) changes every tick and should not be in the system prompt.

## Context Slot Configuration

See `docs/cortex/context-manager.md` in the cortex-mono repository for how the slot mechanism works. Slots are ordered by stability: slot 0 rarely changes, later slots change more often. All content is sourced from the current context builder sections.

| Slot | Name | Content | Source | Update Trigger |
|------|------|---------|--------|---------------|
| 0 | `credentials` | Available credential refs for `run_with_credentials` | `credentialManifest` | On credential add/remove |
| 1 | `contacts` | All contacts with channels, permission tiers, notes, reachability. Does NOT include a `(current)` marker; the active contact is in ephemeral context. | `buildContactsSection()` | On contact add/edit/remove |
| 2 | `core-self` | Agent's accumulated self-knowledge | `buildCoreSelfSection()` | When agent updates core self (rare) |
| 3 | `working-memory` | Per-contact notepad | `buildWorkingMemorySection()` | When agent or user edits working memory |
| 4 | `thought-observations` | Compressed observation summaries from the thought stream | `annotateObservations()` thought stream | When thought observer/reflector runs |
| 5 | `experience-observations` | Compressed observation summaries from the experience stream | `annotateObservations()` experience stream | When experience observer/reflector runs |
| 6 | `message-observations` | Compressed observation summaries from the message stream (per-contact) | `annotateObservations()` message stream | When message observer/reflector runs |
| 7 | `goals` | Active goals with salience, proposed goals, current plans | `goalContext`, `proposedGoalsContext` | On goal/plan state change |
| 8 | `tasks` | Deferred tasks awaiting attention, planning prompts | `deferredTasks`, `planningPromptsContext` | On task create/complete/cancel |

Below the slots, conversation history grows organically through the agentic loop (user messages, assistant responses, tool_use/tool_result pairs).

## Ephemeral Context

Injected via `transformContext` at the end of the message array every LLM call. Never stored in `agent.state.messages`. Everything here changes every tick or is specific to the current trigger.

The trigger context (`buildTriggerSection()`) is NOT ephemeral. It is the actual user message passed to `agent.prompt()`. It becomes part of conversation history on the next turn. For message triggers, this is the user's actual message. For interval/task/agent triggers, it describes what happened. All of these should be traceable in conversation history.

| Section | Content | Source |
|---------|---------|--------|
| **Date & Time** | Current date/time in persona's timezone | `buildDateTimeAwareness()` |
| **Active Contact** | Who you're talking to (name, tier, notes, local time). Only on message triggers. | `buildContactSection()` |
| **Reply Guidance** | Channel-specific reply style guidance (web, Discord, SMS, etc.) | `getReplyGuidance()` |
| **Channel Capabilities** | Available rich features (reactions, voice messages) | `buildChannelCapabilities()` |
| **Contact Presence** | Real-time online/offline/activity status | `buildContactPresence()` |
| **Emotional State** | Current emotion intensities after decay | `formatEmotionalState()` |
| **Energy State** | Current energy level, band, circadian baseline | `formatEnergyContext()` |
| **Recent Thoughts** | Raw thoughts since observation watermark | `recentThoughts` from GATHER |
| **Recent Experiences** | Raw experiences since observation watermark | `recentExperiences` from GATHER |
| **Retrieved Memories** | Long-term memories from semantic search relevant to current context | `longTermMemories` from LanceDB retrieval |
| **External History** | Recent messages from external channels (Discord servers, Slack channels) | `buildExternalHistorySection()` |
| **Previous Tick Outcomes** | Decisions from the last tick and their results | `buildPreviousDecisionsSection()` |
| **Graduating Seeds** | One-time prompt when a seed graduates to goal proposal | `graduatingSeedsContext` |
| **Delivery Failures** | Outbound messages that failed after retries | `buildDeliveryFailuresSection()` |
| **Trust Ramp** | Suggestion to upgrade tool permission tiers | `trustRampContext` |
| **Spawn Budget** | Warning when sub-agent spawn budget is low | `spawnBudgetNote` |
| **Plugin Context Sources** | Dynamic context injected by plugins each tick | `pluginContextSources` from plugin manager |
| **Tick-Interval Energy Magnitude** | Energy delta magnitude calibration based on `tickIntervalMs` | `buildEnergyGuidance()` magnitude section. Moves from system prompt to ephemeral because the interval changes during sleep transitions. |
| **First Tick Kickstart** | Story opening prompt on the very first tick | `buildFirstTickKickstart()` (one-time) |

### Note on Messages and Conversation History

Recent messages do NOT go in ephemeral context. During normal operation, user messages from channels flow through the agentic loop as actual conversation turns. They are naturally part of the conversation history that pi-agent-core manages. Observation-compressed older messages live in the observations slot.

On compaction, Cortex's observational memory compresses older turns into its own
`_observations` slot and trims raw conversation history internally. Animus does
not re-seed Cortex conversation history from `messages.db`. Durable
cross-channel message awareness comes from Animus's own `message-observations`
slot and working memory, while exact historical recall is available through
Cortex's `recall` tool backed by Animus message embeddings.

Recent thoughts and experiences are different: they are internal cognitive artifacts that never appear as conversation turns, so they belong in ephemeral context.

## Compaction Coordination

> **Full Cortex framework details** live in the cortex-mono repository:
> `docs/cortex/observational-memory-architecture.md`,
> `docs/cortex/compaction-strategy.md`, and
> `docs/cortex/tool-result-persistence.md`.

Cortex and Animus now run two separate observation systems:

- **Cortex observational memory** compresses per-thread agent conversation
  history inside a single `(contact_id, channel)` session. It owns the
  framework-managed `_observations` slot, raw-turn trimming, reflection cycles,
  and the optional `recall` tool.
- **Animus observational memory** compresses domain streams: per-contact
  cross-channel messages, global thoughts, and global experiences. These
  summaries are stored in `memory.db.observations` and loaded into the
  `message-observations`, `thought-observations`, and `experience-observations`
  slots.

The two systems are intentionally independent. Cortex observes the live agentic
loop transcript; Animus observes durable domain records. Animus no longer
listens to Cortex compaction to synchronously process its own observers, and it
does not inject database messages back into Cortex conversation history.

Animus still listens to Cortex observation events for cleanup: when Cortex
compresses turns that referenced persisted oversized tool-result files, Animus
deletes dereferenced files from `data/tool-results/` if no remaining history or
observation text still references them.

## Session Persistence

Cortex does not own persistence (see `cortex-architecture.md`). It provides lifecycle hooks and serialization helpers; the backend owns storage. The mind implements persistence as follows:

### Per-Thread Checkpointing (After Each Tick)

The backend listens to the cortex agent's `onLoopComplete` event. For ticks with
an active contact and channel, it snapshots both conversation history and
Cortex observational memory state to `sessions.db`:

```typescript
agent.onLoopComplete(() => {
  if (!activeSession) return; // inner-life ticks are not persisted
  const history = agent.getConversationHistory();
  const observationalState = agent.getObservationalMemoryState();
  upsertSession(sessionsDb, contactId, channel, {
    conversationHistory: JSON.stringify(history),
    cortexObservationalState: JSON.stringify(observationalState),
  });
});
```

Session rows are keyed by `(contact_id, channel)`. Inner-life ticks (timer,
scheduled task, or agent-complete ticks without an originating thread) start
with empty Cortex history and are not written back.

The legacy `heartbeat_state.conversation_history` column was removed from the
current schema by the legacy-session cleanup migration. `sessions.db` is the
only active persistence location for Cortex conversation history.

### Startup / Restart

On process startup, the backend reconstructs the agent:

1. Create a new `CortexAgent` with the standard config (tools, context manager, hooks).
2. **Restore context slots**: Populate slots 0-8 from their source databases (credentials, contacts, core self, working memory, thought-observations, experience-observations, message-observations, goals, tasks). These are always rebuilt from source, never deserialized.
3. **Restore conversation history for the active thread**: At tick start,
   `loadSessionForTick()` loads the `(contact_id, channel)` row from
   `sessions.db`, parses `conversation_history`, and calls
   `agent.restoreConversationHistory(messages)`.
4. **Restore Cortex observational state**: If the session row has
   `cortex_observational_state`, parse it and call
   `agent.restoreObservationalMemoryState(state)`.
5. **Ephemeral tick context**: Not restored. Rebuilt fresh on the first tick via `transformContext`.

### Crash Recovery

If the process crashes mid-tick (before `onLoopComplete` fires), the last checkpoint is used. This means the conversation history from the in-progress tick is lost, but all prior ticks are preserved. This is acceptable since the tick will be re-triggered on restart.

### What Is NOT Persisted Here

- **User-facing messages** are written to `messages.db` during EXECUTE, independent of session state. These survive regardless of session persistence.
- **Slot content** is not serialized. Slots are rebuilt from their database sources on every startup.
- **Ephemeral tick context** is not serialized. Rebuilt each tick.
- **Tool call/result pairs** from the prior session are included in the conversation history snapshot. On restart they are restored. If the snapshot is lost (crash before first checkpoint), they are lost, which is acceptable.

## What Changes in the Backend

| Component | Current | After |
|-----------|---------|-------|
| `heartbeat/index.ts` | `mindQuery()` runs one agent session covering thought + reply + state | Pipeline splits into `thought()` → `agenticLoop()` → `reflect()` with explicit data flow between phases |
| `heartbeat/cortex-mind.ts` | Cortex mind implementation | Creates `CortexAgent` from `@animus-labs/cortex`, configures with mind-specific tools and context slots |
| `heartbeat/cognitive-tools.ts` | MCP tool handlers, phase gate, snapshotBox singleton | **Removed or restructured**. THOUGHT and REFLECT are direct pi-ai calls, not tool handlers |
| `heartbeat/gather-context.ts` | `determineSessionState()` manages cold/warm transitions | Removed. Session warmth logic eliminated; the session is always warm. |
| `heartbeat/context-builder.ts` | `COGNITIVE_PROCEDURE` instructions in system prompt | Instructions removed. System prompt is simpler |
| `tools/servers/mcp-bridge.ts` | HTTP bridge for tool routing | **Retained**. Cortex connects as an MCP client. Cognitive endpoints (`/cognitive/thought`, `/cognitive/state`) are removed. |
| `tools/servers/animus-mcp-server.ts` | Stdio subprocess for MCP protocol | **Retained**. Cortex spawns it as an MCP client target. |
| `tools/registry.ts` | Tool registry with MCP-oriented execution | Retained as the Animus core tool handler layer. Cortex receives Animus core tools as direct `CortexTool` objects that delegate to this registry. |
| `tools/permission-seeder.ts` | Seeds Animus/plugin tool permission entries | Seeds Animus core, plugin MCP, and Cortex tool permission entries |
| `tools/tool-gate.ts` | Permission gate (unchanged logic) | Same logic, integrated through Cortex's `resolvePermission` callback |
| `heartbeat/agent-orchestrator.ts` | Sub-agent orchestration | Delegates to Cortex `SubAgentManager` |
| `heartbeat/agent-subsystem.ts` | Mind subsystem lifecycle | Creates and manages `CortexAgent` |
| Streaming | Phase-gated: text only streams after `record_thought` tool call | Direct: text streams as soon as the agentic loop starts. No phase gate. Phase gate module (`cognitive-tools.ts` phase variable) eliminated. Raw text chunks stream with zero latency; at each turn boundary, Cortex emits a structured `AgentTextOutput` with `userFacing`, `working`, and `raw` properties. |
| Mid-tick message injection | `session.injectMessage()` pushes new messages into the active session | Phase-aware queueing with `agent.steer()`. See Mid-Tick Message Handling below. |

## Mid-Tick Message Handling

When a message arrives from the same contact while a tick is already running, the behavior depends on which phase is active. The `message:received` event handler checks the current phase and routes accordingly.

### During THOUGHT Phase

The THOUGHT phase is a direct pi-ai call (not the agentic loop). `agent.steer()` is not available here. The message is **queued** in a `pendingInjections` array. When the AGENTIC LOOP starts, all queued messages are injected immediately via `agent.steer()` before the agent's first turn begins. This means the agent sees the additional messages right away and can react to them.

```typescript
const pendingInjections: IncomingMessage[] = [];

eventBus.on('message:received', (msg) => {
  if (msg.contactId !== currentContactId) return;

  if (currentPhase === 'thought') {
    pendingInjections.push(msg);
  } else if (currentPhase === 'agentic-loop') {
    agent.steer(formatInjection(msg));
  } else if (currentPhase === 'reflect' || currentPhase === 'execute') {
    // Too late for this tick. Let the tick queue handle it naturally.
    // The message debounce in TickQueue will create a new tick for it.
  }
});

// At the start of the agentic loop, flush queued messages
if (pendingInjections.length > 0) {
  const combined = pendingInjections.map(formatInjection).join('\n\n');
  agent.steer(combined);
  pendingInjections.length = 0;
}
```

### During AGENTIC LOOP Phase

This is the active phase. `agent.steer()` injects the message directly into the running loop, just like `session.injectMessage()` does today. The agent sees the new message as part of its ongoing conversation and can respond naturally.

### During REFLECT or EXECUTE Phase

The agentic loop has already completed. The agent has already replied. Injecting now would be pointless since REFLECT is a structured-output call (not conversational) and EXECUTE is database writes. The message is **not queued or injected**. Instead, the normal `TickQueue` debounce mechanism handles it: the message will trigger a new tick after the current tick completes. This is functionally equivalent to a message arriving between ticks.

### Semantic Difference: `steer()` vs `injectMessage()`

The current `session.injectMessage()` appends to an `AsyncIterable` stream that the model sees as a new user turn. `agent.steer()` in pi-agent-core interrupts the current tool execution and injects a new user message, then triggers a new LLM turn. The semantic effect is similar for the "additional message received" use case: the agent sees the new content and incorporates it. The key difference is that `steer()` may cause the agent to abandon in-progress tool work, while `injectMessage()` was a gentler append. In practice, both result in the agent seeing and responding to the new message.

## What Stays the Same

- **Context Builder building blocks**: Persona compilation, emotional state, contact context, etc. remain in the backend. They populate context slots.
- **`CognitiveSnapshot` type** (or equivalent) still captures the combined output of THOUGHT + REFLECT.
- **`executeOutput()`**: Still receives `MindOutput` and processes thoughts, emotions, decisions, memories.
- **Schemas**: Thought content, experience narration, emotion deltas, decisions, memory candidates stay the same.
- **Decision registry**: `registerDecisionHandler()` pattern unchanged.
- **Approval interceptor**: Two-tick approval dance unchanged. Only the hook integration point changes.
- **Database schema**: The active Cortex session model uses `sessions.db` as the eighth database. Legacy `heartbeat_state.conversation_history`, `session_state`, `session_warm_since`, and `mind_session_id` columns have been removed from the current heartbeat schema.
- **Plugin/Channel system**: Plugins and channels continue to work.

## Frontend Changes

The migration affects several frontend concerns:

- **Auth/provider configuration**: Cortex uses provider-specific OAuth, API key, and custom endpoint flows through `cortex-provider.ts`.
- **Model selection**: Cortex provides provider and model listing through `ProviderManager`.
- **Warm/cold session UI removal**: Any UI that displays or references warm/cold session state needs to be updated. The `heartbeat_state.sessionState` field shown in the Mind page should be removed or replaced with connection status.
- **Provider switching**: pi-ai supports runtime model switching via `setModel()`, which could enable a more fluid provider selection UX.

## Warm/Cold Removal Scope

The warm/cold session state machine is completely removed. The `CortexAgent` is always warm; there is no concept of session temperature.

### Backend Changes

- `determineSessionState()` in `gather-context.ts` is removed.
- `sessionState` parameter removed from `buildMindContext()`.
- `getOrCreateMindSession()` simplified to always reuse the existing session.
- `sessionWarmSince` column becomes unused.
- `SESSION_AWARENESS` system prompt section removed.

### Database Changes

- `heartbeat_state.session_state` (`'cold'`/`'warm'` string) column removed.
- `heartbeat_state.session_warm_since` column removed.
- `heartbeat_state.mind_session_id` column removed.
- `heartbeat_state.conversation_history` column removed. Per-thread history now lives in `sessions.db`.

### Frontend Changes

- Any display of warm/cold state removed from the Mind page and status indicators.

### Session Invalidation Replacement

Instead of forcing cold sessions when configuration changes, changes trigger targeted updates: slot updates, tool re-registration, or system prompt rebuild. The session itself is never torn down and recreated.

## Event Bridge

The existing `AgentEventType` enum in `@animus-labs/shared` is preserved. Cortex's event bridge maps pi-agent-core's 10 events into the existing types:

| Pi Event | Animus Event | Notes |
|----------|-------------|-------|
| `agent_start` | `session_start` | Direct mapping |
| `agent_end` | `session_end` | Direct mapping |
| `turn_start` | `turn_start` | Optionally added as a new event type |
| `turn_end` | `turn_end` | Direct mapping. Emits `AgentTextOutput` (parsed working tags) alongside the event. |
| `message_start` | `response_start` | Direct mapping |
| `message_update` | `response_chunk` | Direct mapping. Raw text, no tag processing. |
| `message_end` | `response_end` | Direct mapping |
| `tool_execution_start` | `tool_call_start` | Direct mapping |
| `tool_execution_update` | *(dropped or new)* | Tool progress; can be added or omitted |
| `tool_execution_end` | `tool_call_end` | Direct mapping |

`thinking_start`/`thinking_end` are not active Cortex events. Pi-agent-core does not distinguish thinking from response content in that way.

Each pipeline phase (THOUGHT, AGENTIC LOOP, REFLECT) creates its own log session scope for traceability. The backend continues emitting pipeline events (`tick_input`, `tick_output`, `execute_*`) directly, outside the event bridge.

The event bridge feeds into the same `AgentLogStoreAdapter` and EventBus path, preserving the `onAgentEvent` tRPC subscription for real-time frontend updates.

## Built-in Tools

Cortex tools are native in-process registrations (not MCP tools). They run with no MCP overhead: Bash, Read, Write, Edit, UndoEdit, Glob, Grep, WebFetch, TaskOutput, SubAgent, ToolSearch, `load_skill`, and `recall` when configured.

- Each has its own permission entry in `tool_permissions` (system.db).
- The permission seeder registers Cortex tool permissions alongside Animus core and plugin MCP tool permissions.
- These replace the previous provider-specific built-in tool paths and are permission-gated through Cortex `resolvePermission`.

## System Prompt Rebuild

The system prompt is set once at process start, but certain events require a rebuild.

**Triggers**:
- Persona changes (`persona:updated`)
- Plugin install/remove (`plugin:changed`)
- Settings changes affecting agent behavior

**Rebuild process**:
1. The consumer detects the change via EventBus.
2. Recomputes the application's new base prompt content.
3. Calls `cortexAgent.setBasePrompt(newPrompt)` on the Cortex agent.

Conversation history is preserved across rebuilds; only the system prompt changes. Context slots are unaffected by system prompt rebuilds.
