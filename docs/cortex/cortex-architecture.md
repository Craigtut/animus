# Cortex Architecture

> **STATUS: RESEARCH** - Not yet implemented.

`@animus-labs/cortex` is a standalone package that wraps `@mariozechner/pi-agent-core` into a production-grade agent. It adds the capabilities pi-agent-core deliberately omits: MCP tool support, tool permissions, budget guards, context compaction, skill system, and event logging. Session persistence is the consumer's responsibility; cortex provides lifecycle hooks and serialization helpers.

It does NOT contain application-specific logic (thoughts, emotions, decisions, persona). Those are concerns of the consumer (e.g., the Animus heartbeat system). Think of it as: pi-agent-core provides the bare agentic loop; cortex provides everything needed to wire that loop into real applications.

## Package Structure

```
packages/cortex/
  src/
    index.ts                    # Public API
    cortex-agent.ts             # Wraps pi-agent-core Agent with production concerns
    context-manager.ts          # Slot-based context management
    mcp-client.ts               # Unified MCP client (connects to all tool sources)
    built-in-tools.ts           # Native AgentTool registrations (Bash, Read, Write)
    tool-permission-gate.ts     # Permission system (off/ask/always_allow)
    compaction.ts               # Context compaction strategy
    budget-guard.ts             # Turn count, cost, and wall-clock limits
    event-bridge.ts             # Pi events -> normalized events for logging
    schema-converter.ts         # Zod -> JSON Schema -> TypeBox conversion
    types.ts                    # Package-specific types
  package.json
```

## Why a Separate Package

- The existing `@animus-labs/agents` package abstracts SDK differences behind `IAgentAdapter`/`IAgentSession`. Pi Agent Core does not fit this abstraction: its value is direct control over the loop, not conforming to a normalized interface.
- A standalone package can be reused across future Animus Labs projects.
- The existing `@animus-labs/agents` package remains available for sub-agent orchestration where subprocess-based SDKs may still be useful.

## Context Management

### Always-Warm Session

There is no cold/warm/active state machine. A single `Agent` instance persists for the lifetime of the process. The system prompt is set once and rarely changes. Context is managed through two complementary mechanisms:

1. **`replaceMessages()`**: Updates persistent context slots in `agent.state.messages`. Used for content that changes infrequently. Consumers define how many slots exist and what they contain.
2. **`transformContext` hook**: Injects ephemeral per-call context that should NOT persist in `agent.state.messages`. Ephemeral content should be placed at the end of the message array to avoid invalidating the prefix cache.

### The ContextManager

The `ContextManager` manages the content an agent sees through two mechanisms: persistent **slots** (named content blocks at the start of the message array) and **ephemeral context** (per-call content injected via `transformContext`, never stored).

See **`context-manager.md`** for the full design: message array layout, slot API, ephemeral context API, composability with other `transformContext` hooks, and prefix caching implications.

### Session Persistence

Pi-agent-core is in-memory only. `agent.state` is JSON-serializable. Cortex does NOT own persistence to disk. Instead, it provides lifecycle hooks and serialization helpers that the consumer uses to implement their own storage:

- **`getConversationHistory()`**: Returns the conversation history (everything between slots and ephemeral) as a JSON-serializable array. After compaction, this returns the compacted version. The consumer snapshots this to their storage.
- **`restoreConversationHistory(messages)`**: Injects saved conversation history after the slot region on startup.
- **`onLoopComplete` event**: Fires when the full agentic loop finishes (maps to pi-agent-core's `agent_end` event, not `turn_end`). A single loop may contain many internal turns (tool calls, follow-ups, steering). The consumer listens to this to trigger checkpoints. One snapshot per loop, not per turn.

This design means cortex has zero storage dependencies. The consumer decides where to persist (SQLite, filesystem, Redis, nowhere) and when to checkpoint beyond the basic lifecycle events. See `mind-migration.md` for how the Animus backend implements this with SQLite.

## Capabilities (Gap Fills)

These are capabilities pi-agent-core deliberately omits that cortex implements.

### MCP Tool Support

Pi-agent-core has no MCP support. Tools are direct `AgentTool` objects with `execute()` functions.

Cortex acts as a **unified MCP client**, connecting to all tool sources through standard MCP protocol. It uses the MCP SDK `Client` class with the appropriate transport for each server:

- **Animus core tools**: Cortex spawns the existing `animus-mcp-server.ts` subprocess via stdio transport. On connection, it calls `tools/list` to discover available tools, then wraps each as an `AgentTool` object. On `execute()`, the client calls `tools/call` on the MCP server and returns the result. The existing MCP infrastructure (`animus-mcp-server.ts`, `mcp-bridge.ts`) stays intact; sub-agents running on the agents package also use it.
- **Plugin tools**: Cortex connects to each plugin's MCP server via its configured transport (stdio for stdio-based plugins, HTTP for HTTP-based plugins). Discovery works the same way: `tools/list` on connection, wrap as `AgentTool` objects.
- **Dynamic lifecycle**: Tools are added and removed as plugins install or uninstall, without tearing down the agent session. On plugin install, Cortex opens a new MCP client connection and registers the discovered tools. On uninstall, it closes the connection and removes those tools.
- **Dynamic discovery**: On each MCP client connection, Cortex calls `tools/list` to discover the server's available tools. This means tool inventories are always derived from the server, not hardcoded.

Built-in tools (Bash, Read, Write, Edit, Glob, Grep, WebFetch, SubAgent) are NOT delivered via MCP. They are native in-process `AgentTool` registrations. See the Built-in Tools section below.

### Built-in Tools

Eight tools are native `AgentTool` registrations defined directly in Cortex (`built-in-tools.ts`). These run in-process with no MCP overhead.

- **Bash**: Execute shell commands and return output.
- **Read**: Read file contents from the filesystem.
- **Write**: Write content to a file.
- **Edit**: Make targeted edits to existing files (string replacement).
- **Glob**: Search for files by name patterns.
- **Grep**: Search file contents with regex patterns.
- **WebFetch**: Fetch content from URLs.
- **SubAgent**: Spawn a sub-agent for delegated work.

Each built-in tool has its own permission entry in the `tool_permissions` table (system.db). Permissions are enforced through the same `beforeToolCall` hook used for MCP tools. The consumer (backend) configures which built-in tools are enabled when creating the agent, passing a list of enabled tool names at construction time. Built-in tool schemas use TypeBox directly since they are defined within Cortex, not converted from Zod. SubAgent is a special case: it delegates work to a child Cortex agent, integrating with the existing `AgentOrchestrator` lifecycle.

### Schema Conversion (Zod -> TypeBox)

Pi-agent-core uses TypeBox + AJV for tool parameter schemas. Cortex provides a conversion utility:

```typescript
// Zod -> JSON Schema (via zod-to-json-schema) -> TypeBox Type.Unsafe()
function zodToTypebox(zodSchema: z.ZodType): TSchema {
  const jsonSchema = zodToJsonSchema(zodSchema);
  return Type.Unsafe(jsonSchema);
}
```

One-way conversion at the tool registration boundary. Consumer code continues using Zod. Built-in tools (Bash, Read, Write) use TypeBox directly since they are defined within Cortex, not converted from Zod.

### Tool Permission Gate

Pi-agent-core has no permission system. Cortex implements permissions via the `beforeToolCall` hook:

- Accepts a permission resolver function from the consumer
- For `off` mode tools: blocks execution
- For `always_allow` mode tools: allows execution
- For `ask` mode tools: delegates to the consumer's approval flow

The consumer provides the resolver; cortex provides the hook integration.

### Budget Guards

Pi-agent-core has no limits on turns or cost.

Cortex provides optional, configurable guards. All default to unlimited (no enforcement):

- **Max turns**: Count LLM turns via `turn_end` events. Default: `Infinity`. On breach, force-stop the loop.
- **Max cost**: Track via `AssistantMessage.cost.total`. Default: `Infinity`. On breach, force-stop the loop.

These are safety rails for runaway loops, not user-facing budget enforcement. Application-level budgeting (weekly/monthly spend limits, user-configurable caps) is the consumer's responsibility.

### Context Compaction

Pi-agent-core has no compaction. Only the `transformContext` hook.

Cortex implements compaction in `transformContext`:

- **Token tracking**: Running `sessionTokenCount` from per-turn `AssistantMessage.usage`. Compare against `model.contextWindow`.
- **Trigger**: When token count exceeds a configurable threshold, compact the conversation history.
- **Strategy**: Consumer-configurable. Default: summarize old conversation turns via a separate LLM call. Preserve context slots untouched.
- **Adaptive threshold**: Optionally flex the threshold based on consumer-provided signals (e.g., user interaction recency).

Cortex emits an `onCompaction` event when compaction occurs, allowing the consumer to coordinate related work (e.g., triggering observational memory processing).

Full compaction strategy design is deferred.

### Skill System

Pi-agent-core has no concept of skills. Skills are handled at the application layer in `pi-coding-agent`, not in the library.

Cortex implements a full skill system with three core capabilities:

- **Progressive disclosure**: Only skill names and descriptions are in context at startup (~100 tokens per skill). Full skill content loads on demand via a `load_skill` AgentTool.
- **Ephemeral injection**: Loaded skill content lives in the ephemeral context region (via a skillBuffer read by `transformContext`), not in conversation history. It persists for the duration of the current agentic loop, then disappears on the next tick.
- **Dynamic context injection**: Skills can contain preprocessor markers (shell commands, in-process JavaScript scripts, variable substitution) that execute at load time, replacing markers with live runtime data before the agent sees the content.

The skill registry is config-driven: the consumer provides paths to SKILL.md files from any source (plugins, user directories, built-ins). Cortex does not scan directories. Skills are added/removed dynamically as plugins install/uninstall.

See **`skill-system.md`** for the full design: SKILL.md format, SkillRegistry, load_skill tool, ephemeral injection, preprocessor system, consumer API, and future sub-agent skill execution.

### Working Tags (Response Delivery)

When an agent runs multi-turn agentic loops, it generates intermediate text (reasoning, analysis, planning) mixed with user-facing text (acknowledgments, progress updates, final answers). Working tags let the agent wrap internal content in `<working>` XML tags. Text outside these tags is direct communication for the user. Both stay in conversation history; the difference is only in delivery.

This feature is enabled by default and configurable via `CortexAgentConfig.workingTags.enabled`. When enabled, Cortex appends a "Response Delivery" section to its operational rules in the system prompt.

At the streaming level, Cortex passes raw text through with zero buffering. At turn completion, Cortex parses the complete text into a structured `AgentTextOutput` object with `userFacing`, `working`, and `raw` properties. The consumer decides per-channel what to deliver (e.g., SMS sends `userFacing` only; the frontend renders everything with working content dimmed).

See **`working-tags.md`** for the full design: tag rules, system prompt guidance, event model, parsing utilities, consumer integration, and multi-layer response delivery framework.

### Model Tiers

Cortex uses two model tiers: a **primary model** for all consumer-facing work (agentic loop, direct LLM calls like THOUGHT/REFLECT) and a **utility model** for internal operations the user never sees (WebFetch summarization, safety classifier, compaction).

See **`model-tiers.md`** for the full design: tier definitions, provider default mapping, same-provider constraint, configuration API, and frontend implications.

### System Prompt Management

Cortex assembles a system prompt from two layers: a **cortex default** (operational foundation: rules, tool guidance, safety, environment info) and a **consumer layer** (domain-specific content like persona, instructions, etc.). The cortex default is always present; the consumer appends after it.

See **`system-prompt.md`** for the full design: all seven default sections, how the consumer appends, platform-aware tool guidance, and caching implications.

Cortex provides a `rebuildSystemPrompt(newPrompt: string)` method for when the prompt needs to change:

- **Triggers for rebuild**: Consumer-detected (e.g., persona changes, plugin install/remove, settings changes).
- **Non-destructive**: Rebuilding does NOT tear down the session or lose conversation history.
- **Cortex default is stable**: The default sections almost never change (platform/shell/tools don't change at runtime). Rebuilds are driven by consumer content changes.

### Event Bridge

Pi-agent-core emits 10 events across 4 scopes. Cortex normalizes these into a consumer-facing event stream for logging and monitoring.

**Pi-agent-core events:**

| Scope | Event | Description |
|-------|-------|-------------|
| Agent | `agent_start` | Agent begins processing a prompt |
| Agent | `agent_end` | Agent finishes all work (including follow-ups) |
| Turn | `turn_start` | New LLM turn begins |
| Turn | `turn_end` | LLM turn completes (response + tool execution) |
| Message | `message_start` | LLM response streaming begins |
| Message | `message_update` | Incremental streaming content (text deltas, tool call deltas) |
| Message | `message_end` | LLM response streaming complete |
| Tool | `tool_execution_start` | Tool begins executing |
| Tool | `tool_execution_update` | Tool progress update (mid-execution) |
| Tool | `tool_execution_end` | Tool execution complete (with result or error) |

**Mapping to existing Animus events** (`AgentEventType` in `@animus-labs/shared`):

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
| `tool_execution_update` | *(none)* | New; tool progress, can be added or omitted |
| `tool_execution_end` | `tool_call_end` | Direct mapping |

**Additional notes:**

- Each pipeline phase (THOUGHT, AGENTIC LOOP, REFLECT) creates its own event session/scope for traceability. This allows log consumers to correlate events to a specific phase of the tick.
- `thinking_start`/`thinking_end` are dropped. These were Claude SDK-specific events not present in pi-agent-core.
- `turn_start` is available as a new event type (mapped from pi-agent-core's `turn_start` event).
- The event bridge uses the same `AgentLogStoreAdapter` pattern as the current system.
- Backend continues emitting its own pipeline events (`tick_input`, `tick_output`, `execute_*`) directly, independent of the event bridge. These are Animus pipeline events that the backend logs during GATHER/EXECUTE, not pi-agent-core events.

### Error Handling

Pi-agent-core and pi-ai surface all errors as plain `Error` objects with string messages. There are no error codes, no structured error types, and no HTTP status code preservation. The error information available at each layer:

- **LLM errors**: `AssistantMessage` with `stopReason: "error"` and `errorMessage: string`. The original provider SDK error message is preserved but HTTP status codes are not.
- **Tool execution errors**: Caught and converted to `ToolResultMessage` with `isError: true` and the error message as content. These do not crash the loop; the agent sees the error and can retry or adjust.
- **Agent-level errors**: Caught by the `Agent` class, stored in `agent.state.error: string`, an error message appended to conversation, `agent_end` event emitted.
- **Context overflow**: Pi-ai provides `isContextOverflow(message, contextWindow?)` which checks 14+ provider-specific regex patterns against error messages. This is the only structured error detection pi-ai offers.

Cortex exposes these as-is. Robust error classification (rate limit detection, auth failure detection, retry-with-backoff) would require either upstream changes to pi-ai or regex matching against provider-specific error strings, which is fragile. For now, cortex surfaces the raw error information and lets the consumer decide how to handle it.

The `isContextOverflow()` utility from pi-ai is used by the compaction system to detect when compaction should have been triggered sooner (reactive compaction fallback).

### Token Tracking

Pi-agent-core has no pre-request token counting. Pi-ai reports `Usage` (inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalTokens, per-category costs) on every response. `model.contextWindow` provides the limit.

Cortex tracks tokens through two complementary mechanisms:

- **Post-hoc tracking**: Running `sessionTokenCount` from per-turn `AssistantMessage.usage`. Updated after every LLM call.
- **Heuristic estimation**: A built-in `estimateTokens(text)` function (word-count * 1.3 multiplier) for estimating context size before the first LLM call and between calls. This is critical for compaction: if the heuristic estimate of the current message array is approaching `model.contextWindow`, cortex can trigger compaction proactively rather than waiting for the next post-hoc usage report.

The heuristic is a duplicate of the same utility in `@animus-labs/shared` (4 lines), kept inline to avoid a dependency.

## References

- [pi-agent-core source](https://github.com/badlogic/pi-mono/tree/main/packages/agent)
- [pi-ai source](https://github.com/badlogic/pi-mono/tree/main/packages/ai)
- [pi.dev](https://pi.dev)
- Pi Agent Core context architecture diagram: `App.pen` (frame: "pi-agent-core Context Architecture")
- Pi SDK research: `docs/agents/pi/research/sdk-research.md`
