# OpenAI Codex SDK Research

> **STATUS: REFERENCE** - See [sdk-comparison.md](../sdk-comparison.md) for overview. This document contains detailed provider-specific research.

> **Package**: `@openai/codex-sdk`
> **Status**: Production-ready
> **Languages**: TypeScript (primary), Python, Rust core

## Overview

The OpenAI Codex SDK provides programmatic control over local Codex agents. The TypeScript SDK wraps a bundled codex binary, spawning the CLI and exchanging JSONL events over stdin/stdout. This is fundamentally different from Claude's approach.

### Bundled Binary Architecture

The Codex SDK bundles complete native binaries for each platform under `vendor/{targetTriple}/codex/codex`. Unlike Claude's SDK (which bundles only the agent execution engine), Codex bundles the full CLI including ALL subcommands: `login`, `logout`, `login status`, and the agent runtime. The SDK's internal `findCodexPath()` resolves the correct binary based on platform and architecture.

Platform target triples: `aarch64-apple-darwin`, `x86_64-apple-darwin`, `aarch64-unknown-linux-musl`, `x86_64-unknown-linux-musl`, `aarch64-pc-windows-msvc`, `x86_64-pc-windows-msvc`.

This means no separate CLI installation is needed for Codex: the SDK package provides everything. See [sdk-cli-architecture.md](../sdk-cli-architecture.md) for how the Animus backend resolves these paths.

## Installation

```bash
npm install @openai/codex-sdk
```

**Requires**: Node.js 18+

## Core API

### Thread-Based Model

Codex uses a thread-based conversation model, different from Claude's query-based approach.

```typescript
import { Codex } from "@openai/codex-sdk";

const codex = new Codex();
const thread = codex.startThread();
const turn = await thread.run("Diagnose the test failure and propose a fix");

console.log(turn.finalResponse);
console.log(turn.items);
```

### Continuing Conversations

```typescript
// Same thread - continues conversation
const nextTurn = await thread.run("Now implement the fix");
```

### Thread Configuration

```typescript
const thread = codex.startThread({
  workingDirectory: "/path/to/project",
  skipGitRepoCheck: true,  // Default requires git repo
});
```

## Authentication Methods

### 1. ChatGPT Account (OAuth)

Codex supports authentication via ChatGPT Plus/Pro/Team/Enterprise accounts:

```bash
codex  # Opens browser for OAuth login
```

- Opens browser window for login flow
- Returns access token to CLI
- Cached at `~/.codex/auth.json`
- Supports headless environments via device code flow

### 2. API Key

```bash
export OPENAI_API_KEY=your-api-key
```

### OAuth Details

```
Authorization: https://auth.openai.com/oauth/authorize
Token: https://auth.openai.com/oauth/token
Flow: OAuth 2.0 with PKCE
```

### ✅ Subscription Auth Support

OpenAI Codex supports using subscription auth for third-party integrations. Users can authenticate via their ChatGPT account.

### SDK Automatic Credential Discovery

**Important for adapter implementation**: The SDK spawns the CLI as a subprocess, and the CLI automatically discovers credentials. No special configuration needed:

```typescript
import { Codex } from "@openai/codex-sdk";

// SDK automatically uses credentials from ~/.codex/auth.json
const codex = new Codex();
const thread = codex.startThread();
```

**Credential lookup order:**
1. `~/.codex/auth.json` - Cached OAuth token (takes precedence)
2. `OPENAI_API_KEY` environment variable - API key fallback
3. `apiKey` constructor option - Programmatic override

**For Animus**: Our adapter doesn't need custom auth logic. Just instantiate `new Codex()` and the subprocess handles credential discovery automatically. Users must run `codex` CLI once to authenticate if using subscription.

## Streaming Events

Use `runStreamed()` for real-time progress:

```typescript
const { events } = await thread.runStreamed("Diagnose the test failure");

for await (const event of events) {
  switch (event.type) {
    case "item.completed":
      console.log("item", event.item);
      break;
    case "turn.completed":
      console.log("usage", event.usage);
      break;
  }
}
```

### Event Types

| Event | Description |
|-------|-------------|
| `thread.started` | Thread initialized |
| `turn.started` | Turn begins |
| `item.started` | Work unit begins |
| `item.completed` | Work unit completes |
| `item/agentMessage/delta` | Streaming text |
| `turn.completed` | Turn ends with usage |
| `turn.failed` | Turn error |
| `error` | General error |

### Item Types

- Agent messages
- Reasoning blocks
- Command executions
- File changes
- MCP tool calls
- Web searches
- Plan updates

## Session Management

### Session Persistence

Threads are persisted to `~/.codex/sessions`. You can resume:

```typescript
const threadId = process.env.CODEX_THREAD_ID!;
const thread = codex.resumeThread(threadId);
await thread.run("Continue where you left off");
```

### ~~No Abort/Cancel~~ (Resolved via App Server Protocol)

The Codex TypeScript SDK's per-turn API does not provide cancel/abort. However, the **App Server Protocol** provides `turn/interrupt` for real cancellation.

**For Animus**: The adapter now uses the App Server Protocol. When `session.cancel()` is called:
- Sends `turn/interrupt` to the app-server process
- The server cancels the current operation
- Emits `turn/completed` with `status: "interrupted"`
- Clean, immediate cancellation

## Approval Modes

Codex has a sophisticated approval system:

### Approval Policy Options

| Mode | Behavior |
|------|----------|
| `untrusted` | Only known-safe read-only commands auto-run |
| `on-failure` | Auto-run in sandbox; prompt on failure |
| `on-request` | Model decides when to ask (default) |
| `never` | Never prompt (dangerous) |

### Configuration

```toml
# config.toml
approval_policy = "on-request"
sandbox_mode = "workspace-write"
```

### CLI Flags

```bash
codex --ask-for-approval never  # or -a never
codex --full-auto  # Alias for sandbox workspace-write + on-request
```

### Unified Permission Model Mapping

Our unified permission model maps to Codex as follows:

| Unified Config | Codex SDK |
|----------------|-----------|
| `executionMode: 'plan'` | `sandbox: 'read-only'` + `approval: 'untrusted'` |
| `executionMode: 'build'` + `approvalLevel: 'strict'` | `sandbox: 'workspace-write'` + `approval: 'untrusted'` |
| `executionMode: 'build'` + `approvalLevel: 'normal'` | `sandbox: 'workspace-write'` + `approval: 'on-request'` |
| `executionMode: 'build'` + `approvalLevel: 'trusted'` | `sandbox: 'workspace-write'` + `approval: 'on-failure'` |
| `executionMode: 'build'` + `approvalLevel: 'none'` | `sandbox: 'full'` + `approval: 'never'` |

**Note**: Codex uses orthogonal sandbox modes + approval policies, so our adapter combines both.
Tool-level `toolPermissions` overrides are **not directly supported** - Codex uses command-class-based restrictions instead.

## Structured Output

```typescript
const schema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    status: { type: "string", enum: ["ok", "action_required"] },
  },
  required: ["summary", "status"],
  additionalProperties: false,
} as const;

const turn = await thread.run("Summarize status", { outputSchema: schema });
```

### With Zod

```typescript
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const schema = z.object({
  summary: z.string(),
  status: z.enum(["ok", "action_required"]),
});

const turn = await thread.run("Summarize", {
  outputSchema: zodToJsonSchema(schema, { target: "openAi" }),
});
```

## Image Input

```typescript
const turn = await thread.run([
  { type: "text", text: "Describe these screenshots" },
  { type: "local_image", path: "./ui.png" },
  { type: "local_image", path: "./diagram.jpg" },
]);
```

## Configuration

### Codex Client Options

```typescript
const codex = new Codex({
  env: {
    PATH: "/usr/local/bin",
    // SDK injects OPENAI_BASE_URL and CODEX_API_KEY automatically
  },
  config: {
    show_raw_agent_reasoning: true,
    sandbox_workspace_write: { network_access: true },
  },
});
```

## Token Usage & Pricing

Token usage is in `turn.completed` events:

```typescript
case "turn.completed":
  console.log("usage", event.usage);
  // { input_tokens, output_tokens, ... }
  break;
```

### Pricing

| Model | Input | Output |
|-------|-------|--------|
| codex-mini-latest | $1.50/1M | $6.00/1M |
| GPT-5-Codex | $1.25/1M | $10.00/1M |

75% prompt caching discount available.

## App Server Protocol

> **Status**: This is now the primary transport used by the Animus Codex adapter. See [app-server-protocol.md](./app-server-protocol.md) for the full reference.

The App Server Protocol (`codex app-server`) provides a long-lived JSON-RPC 2.0 process over stdio. This is the same protocol powering the VS Code extension and CLI TUI. It replaces the SDK's per-turn `codex exec` approach in the Animus adapter.

### Why App Server over SDK

The SDK wraps `codex exec`, spawning a disposable process per turn with write-once stdin. This makes mid-turn injection and cancellation impossible. The App Server maintains a persistent bidirectional channel.

| Capability | SDK (`codex exec`) | App Server |
|------------|-------------------|------------|
| Cancel | Not possible | `turn/interrupt` |
| Mid-turn injection | Not possible | `turn/steer` |
| Tool approval | Policy-only | Interactive request/response |
| Session forking | Not available | `thread/fork` |
| Process lifecycle | Disposable per turn | Long-lived, shared |

### Key Methods

- `initialize` / `initialized`: Protocol handshake
- `thread/start`, `thread/resume`, `thread/fork`: Thread lifecycle
- `turn/start`: Begin a turn with user input
- `turn/steer`: Mid-turn message injection (cancel-and-recreate at Responses API level)
- `turn/interrupt`: Cancel active turn
- `item/requestApproval` / `item/approvalResponse`: Tool execution approval flow

### Under the Hood: turn/steer

Steering works via cancel-and-recreate at the Responses API level:
1. Cancel the current response
2. Preserve all context (conversation history, tool results)
3. Append the steer message as a new user turn
4. Create a new response

This gives the appearance of injecting a message mid-stream while maintaining conversation coherence.

### Notification Types

| Notification | Description |
|-------------|-------------|
| `turn/started` | Turn began |
| `turn/completed` | Turn finished (completed/interrupted/failed) |
| `item/started` | Work item started (command, MCP tool, file change, reasoning) |
| `item/completed` | Work item completed |
| `item/agentMessage/delta` | Streaming agent text |
| `item/reasoning/textDelta` | Streaming reasoning text |
| `thread/tokenUsage/updated` | Token usage stats |
| `item/requestApproval` | Tool needs approval |
| `error` | Error notification |

### Binary Requirement

The `@openai/codex-sdk` package is still required for the bundled `codex` binary. The SDK's JavaScript API is no longer used by the adapter; only the binary at `vendor/{triple}/codex/codex` is needed to run `codex app-server`.

## Sandbox Modes

| Mode | Description |
|------|-------------|
| `read-only` | No file writes |
| `workspace-write` | Write to workspace only |
| `full` | Full system access |

```bash
codex --sandbox workspace-write
```

## Subagent Support

**Codex SDK does NOT have a built-in Task tool** for spawning subagents like Claude does. However, multi-agent orchestration is possible through alternative mechanisms:

### 1. MCP Server + OpenAI Agents SDK

Run Codex as an MCP server and orchestrate with the separate OpenAI Agents SDK:

```bash
codex mcp-server
```

Then use the Agents SDK to coordinate multiple Codex instances with tools:
- `codex` - Initiates a new Codex session
- `codex-reply` - Continues an existing session

### 2. AGENTS.md Configuration

Define specialized agent behaviors through `AGENTS.md` files:

```markdown
# Code Reviewer Agent

You are a specialized code reviewer. Focus on:
- Security vulnerabilities
- Performance issues
- Code style violations
```

Files are loaded hierarchically: global → project → directory-level.

### 3. Gated Handoff Pattern

OpenAI's recommended pattern uses a "Project Manager" agent that:
- Creates planning documents (REQUIREMENTS.md, AGENT_TASKS.md)
- Coordinates handoffs to specialized agents
- Verifies artifacts before advancing

**For our abstraction layer**: Native subagent support would require integrating the OpenAI Agents SDK separately, or implementing our own orchestration layer.

## Unified Hook Model Mapping

With the App Server Protocol, Codex now supports pre-execution blocking via the approval request/response flow:

| Unified Hook | Codex Support | How It Works |
|--------------|---------------|--------------|
| `onPreToolUse` | ✅ Can block | Via approval request/response flow (accept/decline) |
| `onPostToolUse` | ✅ Full | Listen to `item/completed` notification |
| `onToolError` | ✅ Full | Listen to `turn/completed` with `status: "failed"` |
| `onSessionStart` | ✅ Full | Emitted on thread start |
| `onSessionEnd` | ✅ Full | Emitted on session end |
| `onSubagentStart` | ❌ N/A | Codex doesn't support native subagents |
| `onSubagentEnd` | ❌ N/A | Codex doesn't support native subagents |

**Remaining Limitation**: While `onPreToolUse` can now block execution (by declining the approval), it cannot modify tool input. The approval flow is accept/decline only; there is no mechanism to change the command or arguments before execution.

**Implementation**: Adapter listens to App Server notification events and processes approval requests using the `canUseTool` callback and `onPreToolUse` hook.

## Key Concerns for Abstraction Layer

For the full cross-SDK comparison and unified permission model mapping, see [sdk-comparison.md](../sdk-comparison.md) and [architecture-overview.md](../architecture-overview.md).

Codex-specific concerns:
1. **App Server Protocol** is the primary transport (not the per-turn SDK API). See [app-server-protocol.md](./app-server-protocol.md).
2. **Pre-execution hooks can block** (via approval) but cannot modify input, only accept/decline.
3. **No native subagents**: Requires MCP + Agents SDK for multi-agent orchestration.
4. **Mid-turn injection**: Supported via `turn/steer` (cancel-and-recreate at Responses API level).

## References

- [Codex SDK Documentation](https://developers.openai.com/codex/sdk/)
- [GitHub: openai/codex](https://github.com/openai/codex)
- [TypeScript SDK README](https://github.com/openai/codex/blob/main/sdk/typescript/README.md)
- [npm: @openai/codex-sdk](https://www.npmjs.com/package/@openai/codex-sdk)
- [Authentication Docs](https://developers.openai.com/codex/auth/)
- [Approval Policies](https://developers.openai.com/codex/cli/reference/)
- [Use Codex with the Agents SDK](https://developers.openai.com/codex/guides/agents-sdk/)
- [Custom Instructions with AGENTS.md](https://developers.openai.com/codex/guides/agents-md/)
- [Building Workflows with Codex CLI & Agents SDK](https://cookbook.openai.com/examples/codex/codex_mcp_agents_sdk/building_consistent_workflows_codex_cli_agents_sdk)
