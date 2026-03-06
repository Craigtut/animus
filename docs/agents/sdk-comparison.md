# Agent SDK Comparison

> **Purpose**: Practical comparison of the three agent SDKs supported by the Animus abstraction layer.
> For unified interface design, see [architecture-overview.md](./architecture-overview.md).
> For deep dives into each provider, see the individual research docs linked below.

## Provider Overview

| | Claude Agent SDK | Codex SDK | OpenCode SDK |
|---|---|---|---|
| **Package** | `@anthropic-ai/claude-agent-sdk` | `@openai/codex-sdk` | `@opencode-ai/sdk` |
| **Provider** | Anthropic (Claude models) | OpenAI (GPT/Codex models) | 75+ providers (multi-model) |
| **Source** | Proprietary | Proprietary | Open source |
| **Role in Animus** | **Default / Primary** | Alternative | Alternative |
| **Maturity** | Production | Production | Production |

Claude Agent SDK is the default provider for Animus. It has the most comprehensive feature set and is the first adapter implemented. Codex and OpenCode serve as alternatives for users who prefer different model providers or need specific capabilities.

## Architecture Comparison

| Aspect | Claude | Codex | OpenCode |
|--------|--------|-------|----------|
| **Architecture** | Async generator (subprocess) | Long-lived JSON-RPC process (App Server) | Client-server (REST + SSE) |
| **Entry point** | `query()` function | `thread/start` + `turn/start` | `client.session.prompt()` |
| **Streaming model** | Yield messages from async generator | JSON-RPC notifications over stdio | SSE subscription (separate from prompts) |
| **Process model** | Spawns CLI subprocess per query | Persistent `codex app-server` process | Separate server process (auto-started or pre-existing) |
| **Session concept** | ID-based, resume via options | Thread-based, resume via method | Server-side sessions, resume via API |

## Authentication

| Method | Claude | Codex | OpenCode |
|--------|--------|-------|----------|
| **API key** | `ANTHROPIC_API_KEY` env var | `OPENAI_API_KEY` env var | Per-provider env vars |
| **Subscription/OAuth** | Yes, via `CLAUDE_CODE_OAUTH_TOKEN` or pre-authenticated CLI | Yes, via ChatGPT OAuth (device code flow) | N/A |
| **Third-party cloud** | Bedrock, Vertex AI, Azure Foundry | N/A | N/A (provider handles this) |
| **Credential storage** | `~/.claude/.credentials` | `~/.codex/auth.json` | `~/.local/share/opencode/auth.json` |
| **Long-lived tokens** | Yes (1 year via `claude setup-token`) | Yes (refresh token rotation) | N/A |

**Key notes:**
- Claude and Codex both support subscription auth, meaning users can leverage existing accounts without separate API keys.
- For Animus, the Codex adapter handles OAuth via a device code flow proxied through the web UI. See [codex/oauth.md](./codex/oauth.md) for the full design.
- OpenCode requires separate API keys for each underlying provider (Anthropic, OpenAI, Google, etc.).

## Session Management

| Feature | Claude | Codex | OpenCode |
|---------|--------|-------|----------|
| **Create** | Implicit (via `query()`) | `thread/start` | `client.session.create()` |
| **Resume** | `resume: sessionId` option | `thread/resume` | Session ID in API calls |
| **Fork** | `forkSession: true` option | `thread/fork` | `client.session.fork()` |
| **Cancel** | `AbortController.abort()` | `turn/interrupt` | `controller.abort()` |
| **Mid-turn injection** | Via `AsyncIterable` prompt | `turn/steer` (cancel-and-recreate) | N/A |
| **Context compaction** | Automatic | Automatic | Automatic (configurable) |
| **Persistence** | Optional | `~/.codex/sessions` | Server-side |

All three providers support session resume and cancellation. Mid-turn injection (steering the agent while it is working) is only available in Claude and Codex.

## Streaming & Events

| Event Category | Claude | Codex | OpenCode |
|---------------|--------|-------|----------|
| **Enable streaming** | `includePartialMessages: true` | `runStreamed()` or App Server notifications | `client.event.subscribe()` (SSE) |
| **Text deltas** | `content_block_delta` (text_delta) | `item/agentMessage/delta` | `message.part.updated` |
| **Tool start** | `content_block_start` (tool_use) | `item/started` | `tool.execute.before` |
| **Tool end** | `content_block_stop` + result | `item/completed` | `tool.execute.after` |
| **Thinking/reasoning** | `content_block_start` (thinking) | `item/reasoning/textDelta` | `message.part.updated` (reasoning) |
| **Session end** | `result` message | `turn/completed` | `session.idle` |
| **Error** | `result` with error subtype | `turn/completed` (failed) or `error` | `session.error` |

See the Event Normalization Mapping table in [architecture-overview.md](./architecture-overview.md) for how these map to unified `AgentEventType` values.

## Tool System

| Aspect | Claude | Codex | OpenCode |
|--------|--------|-------|----------|
| **Built-in tools** | Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch, Task, NotebookEdit, others | Similar core set (read, write, edit, bash, grep, glob) | read, write, edit, bash, grep, glob, list, lsp, patch, webfetch, others |
| **Custom tools** | MCP servers (stdio, SSE, HTTP) + inline `tool()` helper | MCP servers (stdio-based) | Plugin-based TypeScript tools + MCP |
| **Subagents** | Native Task tool | Not native (requires MCP + Agents SDK) | Via @mentions |
| **LSP integration** | No | No | Yes (built-in) |
| **Unique tools** | WebSearch, AskUserQuestion | Structured output schemas | LSP (definitions, references, hover), patch |

**Custom tool definition approaches differ significantly.** Claude uses MCP servers with a `tool()` helper for inline definitions. OpenCode uses a plugin system with TypeScript files in `.opencode/tools/`. Codex relies on MCP servers for extension.

The Animus abstraction layer does not unify tool definitions. Each provider uses its native tools, and the abstraction normalizes tool call events for logging. MCP server configuration is passed through to the underlying SDK.

## Permission & Approval Models

| Aspect | Claude | Codex | OpenCode |
|--------|--------|-------|----------|
| **Permission modes** | default, acceptEdits, bypassPermissions, plan | Approval policies + sandbox modes | Per-tool permissions |
| **Pre-execution blocking** | Yes (can block AND modify input) | Yes (can block via approval, cannot modify) | Yes (via plugin hooks) |
| **Sandbox** | No built-in sandbox | read-only, workspace-write, full | No built-in sandbox |
| **Approval policies** | N/A | untrusted, on-failure, on-request, never | N/A |

See the Unified Permission Model in [architecture-overview.md](./architecture-overview.md) for how these map to the two-tier `executionMode` + `approvalLevel` model.

## Token Usage & Cost Tracking

| Aspect | Claude | Codex | OpenCode |
|--------|--------|-------|----------|
| **Input tokens** | Yes | Yes | Yes (via API) |
| **Output tokens** | Yes | Yes | Yes (via API) |
| **Cache tokens** | Yes (read + creation) | No | Varies by provider |
| **Direct cost** | Yes (`total_cost_usd` in result) | No (must calculate) | No (must calculate) |
| **Per-model breakdown** | Yes (`modelUsage` map) | N/A (single model) | N/A |
| **Where reported** | `result` message (cumulative) | `turn.completed` event | No built-in SDK tracking |

Claude provides the most complete cost tracking out of the box. For Codex and OpenCode, the Animus adapter calculates costs based on known model pricing. Third-party tools exist for OpenCode cost tracking (OpenCode Monitor, TokenScope, OCSight, Tokscale).

## Hooks & Lifecycle Events

| Hook | Claude | Codex | OpenCode |
|------|--------|-------|----------|
| **Pre-tool execution** | PreToolUse (block + modify) | Approval request/response (block only) | Plugin hook (can block + modify) |
| **Post-tool execution** | PostToolUse | `item/completed` notification | `tool.execute.after` |
| **Tool failure** | PostToolUseFailure | `turn/completed` (failed) | `tool.execute.after` (with error) |
| **Session start** | SessionStart hook | `thread.started` | `session.created` |
| **Session end** | SessionEnd hook | `turn/completed` | `session.idle` |
| **Subagent start** | SubagentStart | N/A (no native subagents) | Supported |
| **Subagent end** | SubagentStop | N/A | Supported |
| **User prompt submit** | UserPromptSubmit | N/A | `tui.prompt.append` |
| **Context compaction** | PreCompact | N/A | `session.compacted` |

Claude has the richest hook system with 12+ hook events. Codex provides hook-like behavior through the approval flow and notification events. OpenCode uses a plugin system with 22+ lifecycle hooks.

## Subagent Support

| Aspect | Claude | Codex | OpenCode |
|--------|--------|-------|----------|
| **Native support** | Yes (Task tool) | No | Yes (via @mentions) |
| **Agent definition** | `agents` option with description, prompt, tools, model | N/A | JSON config or Markdown files |
| **Model override** | Per-agent (sonnet, opus, haiku, inherit) | N/A | Per-agent |
| **Workaround** | N/A | MCP server + OpenAI Agents SDK | N/A |

For Animus, the heartbeat mind system uses its own orchestration layer for sub-agents rather than relying on SDK-native subagent mechanisms. See `docs/architecture/agent-orchestration.md`.

## Trade-offs & When to Use Each

### Claude Agent SDK (Default)

**Strengths:**
- Most comprehensive feature set (hooks, subagents, cost tracking, session forking)
- Best streaming granularity with per-content-block events
- Built-in cost tracking with `total_cost_usd`
- Rich permission system with input modification in pre-hooks
- V2 preview API with cleaner session-based interface

**Limitations:**
- Anthropic models only
- No built-in sandbox mode
- Requires Anthropic API key or authenticated Claude Code installation

**Best for:** Primary Animus usage, complex multi-turn workflows, scenarios requiring detailed cost tracking or pre-execution hook modification.

### Codex SDK

**Strengths:**
- ChatGPT subscription auth (no separate API key needed)
- Built-in sandbox modes (read-only, workspace-write, full)
- App Server Protocol enables mid-turn steering and cancellation
- Structured output with JSON schemas
- Image input support

**Limitations:**
- OpenAI models only
- No native subagent support
- Pre-execution hooks cannot modify tool input (accept/decline only)
- Cost must be calculated manually
- Requires bundled native binary (~100MB+ per platform)

**Best for:** Users with ChatGPT subscriptions, sandboxed execution environments, structured output requirements.

### OpenCode SDK

**Strengths:**
- Provider-agnostic (75+ LLM providers including local models)
- Open source (full source code access)
- Self-hosted server with REST API
- LSP integration for code intelligence
- Extensive plugin system
- Multiple client options (TUI, web, SDK)

**Limitations:**
- No built-in token/cost tracking in SDK (requires third-party tools)
- Requires running a separate server process
- No session forking
- Less mature than Claude or Codex for Animus integration

**Best for:** Users needing provider flexibility, local/private model support, self-hosted deployments, or full source code access.

## Deep Dive References

| Provider | Research Document |
|----------|-------------------|
| Claude Agent SDK | [docs/research/Claude-Agent-SDK-Research.md](../research/Claude-Agent-SDK-Research.md) |
| Codex SDK | [docs/agents/codex/sdk-research.md](./codex/sdk-research.md) |
| Codex App Server Protocol | [docs/agents/codex/app-server-protocol.md](./codex/app-server-protocol.md) |
| Codex OAuth | [docs/agents/codex/oauth.md](./codex/oauth.md) |
| OpenCode SDK | [docs/research/opencode-sdk-research.md](../research/opencode-sdk-research.md) |
| Unified Architecture | [docs/agents/architecture-overview.md](./architecture-overview.md) |
