# Cortex Integration Patterns

> **Note:** This document describes how Animus specifically integrates with the Cortex agent framework. For Cortex framework documentation, see the [cortex-mono](https://github.com/Craigtut/cortex-mono) repository.

## MCP Tool Integration

### animus-mcp-server

The existing `animus-mcp-server.ts` is spawned by Cortex as a stdio subprocess. This is the same server used by the Claude SDK, repurposed as an MCP client target.

**Configuration:**

```typescript
mcpClientManager.connect('animus', {
  transport: 'stdio',
  command: 'node',
  args: ['packages/backend/src/tools/animus-mcp-server.ts'],
  env: {
    BRIDGE_PORT: bridgePort,
    TOOL_SET: 'mind',
    TASK_ID: 'mind',
  },
});
```

- `BRIDGE_PORT` points to the mcp-bridge HTTP server
- `TOOL_SET=mind` selects the mind tool set (the MIND_TOOL_NAMES)
- `TASK_ID=mind` registers this instance in the bridge's `contextRegistry`

Tool discovery returns the mind tools. Each is wrapped as an AgentTool and registered on the pi-agent-core Agent.

### MIND_TOOL_NAMES Inventory

The mind tool set exposes these tools via the animus-mcp-server:

| Tool | Purpose |
|------|---------|
| `send_message` | Send a message to a user through a channel |
| `update_progress` | Send progress updates during long-running tasks |
| `read_memory` | Search and retrieve memories |
| `lookup_contacts` | Look up contact information |
| `send_proactive_message` | Send unsolicited messages to users |
| `send_media` | Send media (images, audio, etc.) through channels |
| `run_with_credentials` | Execute operations using vault credentials |
| `list_vault_entries` | List available credential vault entries |
| `manage_vault_entry` | Create, update, or delete vault entries |
| `transcribe_audio` | Transcribe audio to text via STT engine |
| `generate_speech` | Generate speech audio from text via TTS engine |
| `send_voice_reply` | Send a voice reply through the voice channel |

### mcp-bridge

The MCP bridge (`mcp-bridge.ts`) is a shared singleton HTTP server within the backend process. Multiple consumers route tool calls through it:

```
Mind (Cortex)
  -> MCP client (stdio) -> animus-mcp-server subprocess -> HTTP bridge -> tool handler

Sub-Agent (agents package)
  -> SDK MCP (stdio) -> animus-mcp-server subprocess -> HTTP bridge -> tool handler
```

Each consumer gets its own `animus-mcp-server` subprocess instance. The bridge's `contextRegistry` distinguishes them by `taskId` (`'mind'` for the main mind loop, UUIDs for sub-agents). Tool permissions are checked at the bridge level for both paths.

### Why Keep MCP for Animus Tools

Given that pi-agent-core supports direct in-process tools, Animus routes its core tools through MCP rather than calling handlers directly for three reasons:

1. **Single source of truth**: Sub-agents on the `@animus-labs/agents` package use the same `animus-mcp-server`. Maintaining it ensures one definition for tool schemas and handlers.
2. **Consistency**: All tool sources (Animus core + plugins) use the same integration pattern. No special-casing.
3. **Shared bridge**: The `mcp-bridge` HTTP server stays alive and handles tool execution for both the mind (via Cortex MCP client) and sub-agents (via SDK MCP integration).

### Shared Infrastructure with Sub-Agents

Both the mind (via Cortex) and sub-agents (via the agents package) share the same MCP infrastructure. Sub-agents running on the `@animus-labs/agents` package use the same `animus-mcp-server` and `mcp-bridge` HTTP server. The bridge's `contextRegistry` distinguishes them by `taskId`. Cortex sub-agents (once migrated) would use the same MCP client approach as the mind.

## Observational Memory Compaction

The observational memory system is a domain-specific compaction layer that operates independently of Cortex's conversation history compaction, but the two must be coordinated.

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

### The Three-Stream Observer/Reflector Pattern

The `processAllStreams()` function runs the three observational memory streams (messages, thoughts, experiences). Each stream has its own Observer agent that compresses overflow into date-grouped summaries, and a Reflector agent that compresses summaries if they exceed their token budget.

### Why Observational Memory Stays in the Backend

Thoughts, experiences, and messages are domain concepts unique to Animus. They have their own database schemas, watermark tracking, token budgets, and compression agents (Observer/Reflector). Cortex has no knowledge of these concepts and should not need to.

The `onBeforeCompaction` / `onPostCompaction` event contract is the clean boundary:
- Cortex says "I'm about to compact" and "I just compacted"
- The backend does whatever domain-specific work is needed
- Cortex doesn't care what that work is

## Error Routing

When Cortex classifies an error via its error classifier, it emits the classified error through its `onError` event. The Animus backend routes these errors to the frontend via the event bus:

```typescript
cortexAgent.onError((error) => {
  log.error(`Agent error [${error.category}]:`, error.originalMessage);

  if (error.category === 'authentication') {
    eventBus.emit('system:error', {
      category: 'authentication',
      message: error.originalMessage,
      recoverable: false,
      suggestedAction: error.suggestedAction,
    });
  }

  if (error.category === 'rate_limit') {
    eventBus.emit('system:error', {
      category: 'rate_limit',
      message: error.originalMessage,
      recoverable: true,
      suggestedAction: error.suggestedAction,
    });
    tickQueue.delayNext(backoffMs);  // exponential backoff
  }

  if (error.category === 'server_error') {
    eventBus.emit('system:error', {
      category: 'server_error',
      message: error.originalMessage,
      recoverable: true,
      suggestedAction: error.suggestedAction,
    });
  }
});
```

This is a significant expansion from the current system, which only surfaces `authentication` errors to the UI and silently drops everything else. The frontend receives these errors via the `onSystemError` tRPC subscription and renders them as `SystemErrorCard` components in the conversation view.

### Rate Limit Backoff (Backend-Owned)

When a `rate_limit` error is classified, the backend delays the next tick using an exponential backoff strategy:

1. First rate limit: Delay next tick by 30 seconds
2. Consecutive rate limits: Exponential backoff (30s, 60s, 120s, 240s, max 5 minutes)
3. Successful tick after backoff: Reset the backoff counter to zero

The backoff state lives in the backend, not Cortex, since Cortex has no concept of ticks.

## Model Tier Configuration

### Settings Page

The Animus frontend settings UI exposes both model tier selections under the existing provider/model configuration:

- **Primary Model**: The main model selector (already exists as "Default Model" in current UI)
- **Utility Model**: A secondary model selector, defaulting to "Recommended" (which maps to `'default'`). The dropdown shows available models from the same provider, sorted by cost (cheapest first). "Recommended" is the first option and pre-selected.

### UI Behavior

- When the user changes the primary model's provider (e.g., switches from Anthropic to OpenAI), the utility model resets to "Recommended" for the new provider.
- The utility model dropdown only shows models from the same provider as the primary model.
- A brief description explains what the utility model is used for: "A smaller model used for internal operations like web page summarization and safety checks. Does not affect the quality of the agent's main responses."

### Backend Storage

Both models are stored in `system_settings`:
- `defaultModel`: Primary model ID (already exists)
- `utilityModel`: Utility model ID, or `'default'` for provider mapping. New setting.

On startup, the backend resolves `'default'` to the actual model ID using the provider mapping, then passes both models to the `CortexAgent` constructor.

## Sub-Agent Orchestration

### AgentOrchestrator Wrapping SubAgentManager

The Cortex SubAgent tool provides the **spawning and execution mechanism**. The Animus `AgentOrchestrator` provides **lifecycle management** on top:

| Concern | Cortex SubAgent | Animus AgentOrchestrator |
|---------|----------------|-------------------------|
| Spawn a sub-agent | Yes | Calls cortex to spawn |
| Run to completion | Yes | Monitors via lifecycle hooks |
| Cancel/steer | Yes | Triggers cancel/steer via decisions |
| Track in database | No | Writes to `agent_tasks` in heartbeat.db |
| Deliver results | Returns to parent | Delivers via `agent_complete` heartbeat trigger |
| Timeout management | Budget guards | Additional timeout via `setTimeout` |
| Concurrency limits | Enforces max concurrent | May impose its own lower limits |

The orchestrator is consumer-level logic. Cortex provides the substrate.

### Decision Routing

The Animus mind makes decisions that map to Cortex sub-agent operations:

- **`update_agent` decision**: The mind sends new information to a running sub-agent. Routed to `agent.steer()` on the sub-agent's Cortex instance, which interrupts the current tool execution, injects the new context, and triggers a new LLM turn.
- **`cancel_agent` decision**: The mind cancels a running sub-agent. Routed to `agent.abort()` on the sub-agent, which kills running tool processes and returns a `cancelled` status.

### Lifecycle Hooks

Cortex emits lifecycle events that the `AgentOrchestrator` hooks into without Cortex knowing about the orchestrator:

- **`onSubAgentSpawned(taskId, instructions)`**: Orchestrator inserts a row in `agent_tasks` table
- **`onSubAgentCompleted(taskId, result, status, usage)`**: Orchestrator delivers results via `agent_complete` heartbeat trigger, updates task status
- **`onSubAgentFailed(taskId, error)`**: Orchestrator handles the failure, updates task status

## Backend Integration: stopHeartbeat()

The backend's `stopHeartbeat()` calls `destroy()` on the Cortex agent for ordered cleanup:

```typescript
export async function stopHeartbeat(options): Promise<void> {
  tickQueue.stopInterval();
  tickQueue.clear();              // prevent new ticks during shutdown
  await cortexAgent?.destroy();   // ordered cleanup
  cortexAgent = null;
}
```

The `TickQueue.clear()` call happens before `destroy()` to prevent a race where a new tick starts while shutdown is in progress.

## Event Bridge Mapping

Pi-agent-core events map to the existing `AgentEventType` enum in `@animus-labs/shared`:

| Pi Event | Animus Event | Notes |
|----------|-------------|-------|
| `agent_start` | `session_start` | Direct mapping |
| `agent_end` | `session_end` | Direct mapping |
| `turn_start` | *(none)* | New; can be added or omitted |
| `turn_end` | `turn_end` | Direct mapping |
| `message_start` | `response_start` | Direct mapping |
| `message_update` | `response_chunk` | Direct mapping |
| `message_end` | `response_end` | Direct mapping |
| `tool_execution_start` | `tool_call_start` | Direct mapping |
| `tool_execution_update` | *(none)* | New; tool progress |
| `tool_execution_end` | `tool_call_end` | Direct mapping |

Each pipeline phase (THOUGHT, AGENTIC LOOP, REFLECT) creates its own event session scope for traceability. The backend's `CortexLogBridge` listens to these events and persists them to `agent_logs.db`. The backend also emits its own pipeline events (`tick_input`, `tick_output`, `execute_*`) independently of the event bridge.
