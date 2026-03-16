# Pi Agent Core Migration Overview

> **STATUS: RESEARCH** - Not yet implemented.

Animus is migrating from the `@animus-labs/agents` abstraction layer (Claude Agent SDK, Codex, OpenCode adapters) to `@mariozechner/pi-agent-core` as the primary agentic loop for the heartbeat system.

## Why This Migration

The primary motivation is **dynamic context control**. The current system sets the system prompt once at session creation and has no mechanism to reshape context between ticks without tearing down the session entirely. Pi Agent Core's `transformContext` hook fires before every LLM call, enabling per-tick context injection, slot-based message management, and ephemeral context that never persists in the message history.

Additional benefits:

- **`replaceMessages()`**: Direct mutation of the in-memory message array for persistent context slot updates between ticks.
- **Multi-provider via pi-ai**: One integration unlocks 20+ providers (Anthropic, OpenAI, Google, Groq, Cerebras, Bedrock, Ollama, etc.) with cross-provider model switching mid-session.
- **In-process library**: Tools can be direct function calls rather than MCP protocol over stdio. Full stack traces and debuggability.
- **Steering and follow-up**: Mid-execution redirection via `agent.steer()` with graceful tool skipping, and post-completion follow-ups via `agent.followUp()`.

## Two Parallel Changes

This migration involves two separate concerns:

### 1. Cortex: A New Agent Package

`@animus-labs/cortex` is a standalone package wrapping pi-agent-core into a production-grade agent. It adds MCP tool support, permissions, budget guards, compaction, skills, and event logging. Session persistence is the consumer's responsibility; cortex provides lifecycle hooks and serialization helpers. It is general-purpose and does not contain mind-specific logic.

See: **`cortex-architecture.md`**

### 2. Mind: Pipeline Restructure

The heartbeat's mind loop is restructured from a 3-phase pipeline (GATHER → MIND QUERY → EXECUTE) to a 5-phase pipeline (GATHER → THOUGHT → AGENTIC LOOP → REFLECT → EXECUTE). Cognitive tools (`record_thought`, `record_cognitive_state`) are replaced with programmatic direct pi-ai calls that guarantee structured data capture.

See: **`mind-migration.md`**

## Migration Phases

### Phase 0: Prep Refactors

Preparatory refactors that can land on the current system before Cortex exists, reducing migration risk.

- **Split `buildShortTermMemorySection()`** in context-builder.ts into three separate builders: thought observations, experience observations, and message observations. Decoupling these lets the new pipeline place each stream independently.
- **Strip the `(current)` marker from contacts context**. Move active contact identification to the trigger/contact ephemeral section instead of embedding it in the static contacts block.
- **Extract tick-interval magnitude table from `buildEnergyGuidance()`** so the dynamic table can be placed in ephemeral context separately from the static energy guidance text.
- **Gut warm/cold session references across the codebase**: remove `determineSessionState()`, the `SESSION_AWARENESS` system prompt section, and warm/cold UI indicators in the frontend. Replace session invalidation flags with targeted update mechanisms.
- **Add `conversation_history TEXT` column to `heartbeat_state`** (new migration). This stores serialized Cortex conversation history for crash recovery. Deprecate the existing `session_state` column (was `'cold'`/`'warm'`).

### Phase 1: Foundation

Build the `@animus-labs/cortex` package:

- `CortexAgent` class wrapping pi-agent-core `Agent`
- `ContextManager` with slot-based message management
- Zod -> TypeBox schema conversion for tool definitions
- Budget guards (turn count, cost; defaults to unlimited)
- Event bridge for logging (maps to existing `AgentEventType` enum, drops `thinking_start`/`thinking_end`, each phase gets its own event session scope)
- Lifecycle hooks for consumer-owned persistence (`getConversationHistory()`, `restoreConversationHistory()`, `onLoopComplete`)
- MCP client adapter for connecting to MCP servers (both Animus tools and plugins) via stdio and HTTP transports
- Built-in tools (Bash, Read, Write, Edit, Glob, Grep, WebFetch, SubAgent) as native `AgentTool` registrations with permission integration
- Pi-ai model exposure for direct LLM calls (used by THOUGHT/REFLECT phases)
- System prompt rebuild capability (`rebuildSystemPrompt` method)

### Phase 2: Integration

Wire cortex into the heartbeat pipeline:

- Backend creates a `CortexAgent`, configures with Animus tools and context slots
- Implement the 5-phase pipeline (THOUGHT, AGENTIC LOOP, REFLECT). THOUGHT and REFLECT use Cortex's exposed pi-ai model for direct calls rather than agentic tool loops.
- Implement `beforeToolCall` permission gate using existing `resolveToolGate()`
- Crash recovery (deserialize on startup)
- Implement system prompt rebuild triggers (`persona:updated`, `plugin:changed`, settings changes)
- Wire built-in tool permissions (all eight: Bash, Read, Write, Edit, Glob, Grep, WebFetch, SubAgent) into `permission-seeder.ts`
- Frontend auth/provider configuration updates for pi-ai
- Remove warm/cold session logic from heartbeat pipeline (if not done in Phase 0)

### Phase 3: Plugin Tools

Cortex already has MCP client support from Phase 1. Phase 3 focuses on dynamic plugin lifecycle management:

- Plugin install/remove triggers dynamic tool registration/deregistration on the Cortex agent
- Plugin tool permission changes trigger `beforeToolCall` hook updates
- System prompt rebuild when plugin list changes (installed plugins and tools section)

### Phase 4: Sub-Agent Migration

Migrate sub-agents from Claude SDK to cortex-based agents:

- Cortex sub-agent instances with restricted tool sets
- Integration with existing `AgentOrchestrator` lifecycle
- Steering support via `agent.steer()` for `update_agent` decisions (replaces `session.injectMessage()`)
- Result delivery via heartbeat triggers
- Sub-agents on the agents package continue to use the existing MCP infrastructure (`animus-mcp-server` + `mcp-bridge`). Cortex sub-agents would use the same MCP client approach as the mind.

### Phase 5: Compaction

Implement the full compaction strategy:

- Token tracking and threshold management
- Conversation history summarization
- Adaptive thresholds based on user interaction recency

## What Stays the Same

- **Context Builder**: Building blocks (persona compilation, emotional state, contact context) remain in the backend.
- **Decision registry**: `registerDecisionHandler()` pattern unchanged.
- **Approval interceptor**: Two-tick approval dance unchanged. Only the hook integration point changes.
- **Database schema**: All seven databases remain as-is. Only the `conversation_history` column addition in Phase 0.
- **Frontend**: Minimal frontend changes. Auth/provider config and warm/cold UI removal are needed, but the heartbeat API surface is unchanged.
- **Plugin/Channel system**: Plugins and channels continue to work.
- **MCP infrastructure**: `animus-mcp-server.ts` and `mcp-bridge.ts` stay for sub-agent compatibility during the migration period.
- **AgentEventType enum**: Preserved via mapping, not replacement. Cortex events map to the existing enum values.

## What Gets Deprecated (Not Removed)

The `@animus-labs/agents` package is NOT removed. It continues to serve:

- Sub-agent orchestration (Phase 4 migrates this, but the package remains as fallback)
- Claude/Codex auth flows (API router endpoints)
- Model listing (provider.ts router)

Over time, as sub-agents migrate to cortex, usage of the agents package decreases.

Additionally, these specific items are deprecated:

- `heartbeat_state.session_state` column (`'cold'`/`'warm'` values)
- `heartbeat_state.session_warm_since` column
- `SESSION_AWARENESS` system prompt section
- `COGNITIVE_PROCEDURE` system prompt section
- `determineSessionState()` function
- `thinking_start`/`thinking_end` event types (Claude SDK-specific, not mapped in Cortex)

## Open Questions

1. **Compaction strategy details**: When to trigger, how to summarize, cost of summarization calls.
2. ~~**Custom message types**: Should we use pi-agent-core's custom message types (via declaration merging) for context injections? Or keep them as standard user messages with XML tags?~~ **Resolved**: Standard user messages with XML tags.
3. **Sub-agent provider selection**: When sub-agents migrate to cortex, should they inherit the mind's provider or be configurable per-task?
4. **Model selection per tick** (future): Pi supports runtime model switching via `setModel()`. A future expansion could allow different models for idle vs message ticks, or per-phase model selection. For now, all phases use the same configured model.
5. **Built-in tool permissions UI**: How should built-in tool permissions (Bash, Read, Write, Edit, Glob, Grep, WebFetch, SubAgent) be exposed in the frontend settings UI? Separate section or merged with existing tool permissions?
6. **MCP client connection lifecycle**: Should MCP client connections to plugin servers be persistent (kept alive between ticks) or reconnected per-tick? Persistent is more efficient but requires connection health monitoring.
