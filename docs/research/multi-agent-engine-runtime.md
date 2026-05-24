# Multi-Agent Engine Runtime

**STATUS**: RESEARCH, not implemented
**Created**: 2026-05-24
**Problem**: Animus currently assumes one resident entity per application instance, but future desktop, Docker, npm, and terminal use cases may need one app host to manage multiple isolated entities.

## Summary

Animus is currently designed as a single-user, single-entity application. That design is coherent with the product vision: one keeper, one resident life, one continuous history. The current codebase reflects that stance deeply. The backend owns one heartbeat runtime, one Cortex mind, one persona, one memory system, one channel manager, one plugin manager, one contacts database, one settings database, and one frontend state model.

If Animus needs to support multiple resident entities in one Mac app, Docker container, npm-installed runtime, or terminal UI, the clean direction is not to make every table multi-tenant with `agent_id`. The cleaner direction is to make the existing single-agent engine instantiable.

The target shape is:

```text
App host
  Agent registry
  Package registry
  Shared app services
  AgentRuntime(agent-a)
  AgentRuntime(agent-b)
  AgentRuntime(agent-c)
```

Each `AgentRuntime` should own the same things the current application owns globally today: databases, heartbeat queue, Cortex mind, memory, goals, tasks, contacts, channels, plugins, credentials, permissions, saves, and live subscriptions.

This preserves the current core idea that an entity grows through its own accumulated history. Each entity gets its own database set and lived context, rather than sharing a large multi-agent database.

## Product Framing

The existing product principle says "one being, one keeper." Multi-agent support should not turn Animus into a multi-user platform or a stateless agent host. The product frame should remain single-user and local:

```text
One keeper, multiple resident entities.
```

That is a product decision, not only an engineering one. It would require updating the product language from "exactly one entity per instance" to "each resident entity is singular, persistent, and kept by one person." The relationship remains local, self-hosted, and non-multi-tenant.

## Current Architectural Constraint

The current engine is not packaged as an object that can be constructed multiple times. It is distributed across process-level singletons and module globals.

Major examples:

- `packages/backend/src/heartbeat/index.ts` owns a module-level `HeartbeatContext` and `TickQueue`.
- `packages/backend/src/index.ts` constructs one `MemorySubsystem`, one `GoalSubsystem`, one `AgentSubsystem`, and one `TaskSubsystem`.
- `packages/backend/src/db/index.ts` opens one global handle for each SQLite database.
- Core tables such as `heartbeat_state`, `personality_settings`, `system_settings`, and `core_self` are singleton rows.
- `packages/backend/src/heartbeat/cortex-mind.ts` owns one `CortexAgent`, one `ProviderManager`, and one active thread session.
- `packages/backend/src/channels/channel-manager.ts` and `packages/backend/src/plugins/plugin-manager.ts` are singleton managers.
- Frontend routes, subscriptions, and Zustand stores assume one global entity state.

This means adding a UI selector alone would only switch presentation. It would not isolate runtime state, memories, contact permissions, tools, credentials, plugin behavior, or channel delivery.

## Preferred Model: Isolated Agent Runtimes

The core abstraction should become an `AgentRuntime`.

```ts
interface AgentRuntimeOptions {
  agentId: string;
  dataDir: string;
  appEventBus: AppEventBus;
  packageRegistry: PackageRegistry;
}

class AgentRuntime {
  readonly agentId: string;
  readonly databases: AgentDatabases;
  readonly heartbeat: HeartbeatRuntime;
  readonly memory: MemorySubsystem;
  readonly goals: GoalSubsystem;
  readonly tasks: TaskSubsystem;
  readonly cortexMind: CortexMindState;
  readonly channels: AgentChannelManager;
  readonly plugins: AgentPluginManager;

  start(): Promise<void>;
  stop(): Promise<void>;
  healthCheck(): Promise<RuntimeHealth>;
}
```

This is intentionally close to the current engine. The point is to move ownership boundaries, not to redesign the heartbeat, memory, goals, or Cortex pipeline from scratch.

## Data Layout

The likely data layout is a small app-level directory plus per-agent directories.

```text
$ANIMUS_DATA_DIR/
  app.db
  vault.json
  jwt.key
  logs/
  models/
  voices/
  packages/
    plugins/
    channels/
    .cache/
  agents/
    <agentId>/
      agent.json
      databases/
        system.db
        persona.db
        heartbeat.db
        memory.db
        messages.db
        contacts.db
        sessions.db
        agent_logs.db
        lancedb/
      media/
      saves/
      workspace/
```

The app-level database should contain only host-level state:

- Agent registry
- Installed package registry
- Shared model/package cache metadata
- App-level telemetry preferences
- Crash or host diagnostics metadata

The agent-level `system.db` should contain state that currently lives in global system settings but is actually entity-owned:

- AI provider and model settings
- Heartbeat interval and runtime settings
- Channel configuration
- Plugin configuration
- Tool permissions
- Credentials and credential references
- Debug context and log category preferences, if they affect the entity runtime

This lets existing singleton tables remain singleton inside a given agent's database set. For example, `core_self WHERE id = 1` remains correct because it means "the core self for this agent runtime."

## Scoping Map

Most current concepts should become per-agent.

| Area | Scope | Notes |
|------|-------|-------|
| Persona | Per agent | Defines the resident entity. |
| Heartbeat | Per agent | Each entity needs its own tick queue, emotion state, energy, thoughts, and experiences. |
| Cortex mind | Per agent | Each entity needs its own agent session, provider settings, tool context, and compaction state. |
| Memory | Per agent | Working memory, core self, long-term memory, and LanceDB vectors belong to the entity. |
| Messages | Per agent | Conversation history is part of the entity's lived history. |
| Contacts | Per agent | Different entities may know different people or have different permissions for the same person. |
| Goals | Per agent | Goals and seeds are emergent from a particular entity. |
| Tasks | Per agent | Scheduled and deferred work belongs to the entity that created it. |
| Channels | Per agent | Installed packages may be global, but enabled channels and channel configs should be per agent. |
| Plugins | Per agent | Installed packages may be global, but enabled state, config, credentials, permissions, and context should be per agent. |
| Tool permissions | Per agent | Trust and allowed actions are entity-specific. |
| Credentials | Per agent | Passwords, provider keys, OAuth tokens, and plugin/channel secrets should be isolated unless explicitly shared. |
| Saves | Per agent | A save should export one entity and its lived state by default. |
| Usage | Per agent first | Aggregate usage can be added later by summing agent-local usage. |
| Telemetry | App-level | Product telemetry describes the app install, not the private entity state. |
| Package installation | App-level install, per-agent enablement | Avoid duplicating package files, but do not share runtime config by default. |
| Model cache | App-level | Downloaded model artifacts can be shared safely. |

## Channels

Channels are strongly agent-scoped at runtime.

Installed channel packages can remain app-level because they are just code and manifests. Channel instances should be per-agent:

```text
Global:
  discord channel package installed
  sms channel package installed
  web channel package built in

Agent A:
  web enabled
  discord enabled with config A
  contact list A

Agent B:
  web enabled
  sms enabled with config B
  contact list B
```

Incoming delivery must resolve the target agent before it enters a heartbeat queue. That routing can happen through explicit channel instance identity, such as a Discord bot token tied to one agent, a phone number tied to one agent, or a web conversation selected in the UI.

Avoid a model where one global channel router receives a message and broadcasts it to every runtime. Message delivery is part of the entity's lived history and should have one owner unless a future feature explicitly supports shared rooms.

## Plugins

Plugins have two distinct layers:

```text
Installed package:
  global app-level code and manifest

Plugin instance:
  per-agent enabled state
  per-agent config
  per-agent credentials
  per-agent tool permissions
  per-agent context sources
  per-agent hooks and decision types
```

This matters because plugin behavior changes an entity's cognition. A plugin that adds context, tools, decisions, or hooks becomes part of how that entity thinks and acts. Sharing config across all entities by default would make separate entities less separate.

Some plugins may eventually support shared app-level configuration, but that should be explicit in the plugin manifest. The default should be per-agent configuration.

## Saves And Restores

The default save unit should be one agent.

An agent save should include:

- Agent metadata
- Agent databases
- Agent media
- Agent workspace assets if needed
- References to required package names and versions
- Optional package configuration snapshots

An agent save should not include:

- Other agents
- App-level telemetry state
- Global package cache blobs unless needed for portability
- Host JWT/session secrets

Whole-instance backup can exist later, but it should be a separate operation. The product action "save this agent" should not silently export the whole multi-agent host.

## Frontend And CLI Model

The frontend should treat current agent selection as a primary app state value.

```text
currentAgentId
  presence
  conversations
  mind
  persona
  people
  goals
  memory
  channel settings
  plugin settings
  provider settings
  saves
```

Most routes should become scoped either by URL or by selected global state:

```text
/agents/:agentId
/agents/:agentId/mind
/agents/:agentId/people
/agents/:agentId/persona
/agents/:agentId/settings
```

A terminal UI can use the same boundary:

```bash
animus agents list
animus talk <agentId>
animus run <agentId>
animus save <agentId>
animus restore ./some-agent.animus
```

The desktop app may eventually keep multiple runtimes active at the same time. A CLI or npm consumer may choose one runtime at startup and only boot that one. The engine boundary should support both.

## Implementation Strategy

This should be staged. Full multi-agent support is too large to land as one change.

### Stage 1: Agent Registry With One Active Runtime

Add an app-level agent registry and migrate the current install into a default agent record.

At this stage, the app still runs exactly one agent. The visible product behavior should barely change.

Expected work:

- Add `app.db` or an app-level registry table.
- Add `data/agents/<agentId>/` layout.
- Add migration that moves or maps existing databases into the default agent directory.
- Add API methods for listing agents and reading the active agent.
- Keep current routes and stores mostly unchanged.

### Stage 2: Runtime-Scoped Databases

Replace global DB getters with runtime-owned database handles.

Expected work:

- Introduce `AgentDatabases`.
- Change stores and services to receive runtime DB handles through service instances.
- Keep singleton rows inside each agent database.
- Avoid adding `agent_id` columns unless the table is intentionally app-global.

This is the most important mechanical extraction. Once DB access is runtime-scoped, later stages become much easier.

### Stage 3: Runtime-Scoped Heartbeat And Cortex Mind

Move heartbeat state out of module globals and into an `AgentRuntime`.

Expected work:

- Replace the module-level `HeartbeatContext` with a runtime-owned object.
- Replace the module-level `TickQueue` with a per-runtime queue.
- Move `MemorySubsystem`, `GoalSubsystem`, `AgentSubsystem`, and `TaskSubsystem` ownership into the runtime.
- Make Cortex provider/model settings resolve from the agent's `system.db`.
- Route scheduled tasks and sub-agent completions back to the owning runtime.

### Stage 4: Per-Agent Channels, Plugins, Credentials, And Permissions

Keep package installation global, but make runtime behavior per-agent.

Expected work:

- Split package install registry from package enablement/configuration.
- Make channel instances agent-owned.
- Make plugin manager instances agent-owned, or make one global package manager produce per-agent plugin runtimes.
- Move credentials and permission checks under the agent runtime.
- Make incoming message routing choose a target agent before queueing a tick.

### Stage 5: Scoped API, Subscriptions, And UI

Expose agent identity through the transport layer.

Expected work:

- Add `agentId` to tRPC inputs for agent-owned routers.
- Add `agentId` to subscription payloads.
- Key TanStack Query and Zustand state by `agentId`.
- Add UI for switching agents.
- Make presence, mind, people, persona, conversations, and most settings render from the selected agent.

### Stage 6: Concurrent Runtime Hosting

Allow multiple active runtimes in one process.

Expected work:

- Add `AgentRuntimeManager`.
- Start, stop, pause, and health-check runtimes independently.
- Add resource controls for concurrent ticks.
- Add app-level usage aggregation.
- Add shutdown ordering and crash recovery per runtime.

## Migration Considerations

Existing installs should become one default agent.

Possible migration:

```text
Before:
  data/databases/*.db
  data/media/
  data/saves/

After:
  data/app.db
  data/agents/default/databases/*.db
  data/agents/default/media/
  data/agents/default/saves/
```

The migration must preserve existing save archives and restore behavior. It may need a compatibility path so older `.animus` saves import as single-agent saves.

## Architectural Risks

### Shared Singletons Will Leak State

The biggest risk is accidentally leaving a global singleton in place while introducing multiple runtimes. Anything with module-level mutable state must be audited.

High-risk areas:

- Event bus
- Heartbeat context
- Tick queue
- Cortex mind state
- Plugin manager
- Channel manager
- Task scheduler
- Deferred queue
- Credential service
- Tool permission resolver
- Frontend stores

### Cross-Agent Credentials Are Dangerous By Default

Credentials should not be shared unless the keeper explicitly chooses to share them. A plugin configured for one entity may grant powers that should not belong to another.

### Contacts Must Not Be Accidentally Global

Contacts are part of an entity's social world. Making contacts global would cause surprising permission leaks, such as one entity being able to message someone only another entity should know.

### Agent Logs And Usage Need Clear Ownership

Per-agent usage is useful for understanding the cost of one entity's life. Aggregate usage is useful for app-level reporting. Store enough metadata to support both, but start with per-agent ownership.

### Product Language Needs A Decision

The current docs say exactly one entity per instance. Multi-agent support changes that. The updated principle should preserve the core belief that each entity is singular, resident, and continuously becoming.

## Near-Term Guidance

Do not implement full multi-agent support opportunistically. It is a deep architecture project.

Do avoid making the future harder:

- Do not add new module-level state for agent-owned concepts.
- Do not put new agent-owned settings in app-global settings without a clear reason.
- Prefer constructors and dependency injection for new subsystems.
- Keep stores stateless and pass DB handles explicitly.
- Separate package installation from per-agent package configuration.
- Keep save/restore concepts centered on one entity.
- When adding frontend state for entity-owned data, make the future `agentId` key obvious.

The best near-term architectural preparation is to make the single-agent engine look more like an object, even while only one object exists.

## Open Questions

- Should the app host keep all agent runtimes alive, or only the selected one?
- Should an agent be allowed to share a channel instance with another agent?
- Should credentials ever be shareable across agents, and how explicit should that consent be?
- Should package manifests declare whether config is global-capable, agent-only, or both?
- Should the primary contact be recreated per agent during migration, or referenced from an app-level identity profile?
- Should whole-instance backup exist alongside per-agent saves?
- How should background ticks be scheduled when many agents are sleeping, active, or rate-limited?
- How much aggregate usage reporting is needed in the first multi-agent release?

## Recommendation

Do not build full multi-agent support immediately unless it becomes a near-term product requirement. The change touches persistence, runtime composition, event routing, settings, credentials, channels, plugins, save/restore, and frontend state.

The correct preparatory work is to extract the current engine into an instantiable runtime boundary:

```text
single global engine today
  -> one AgentRuntime instance
  -> many AgentRuntime instances
```

That direction keeps each entity's history, personality, memory, contacts, and channels isolated. It also supports future desktop, Docker, npm, and terminal UI hosts without turning the core Animus engine into a multi-tenant table design.
