# OpenCode SDK Research

> **Package**: `@opencode-ai/sdk`
> **Status**: Production-ready
> **Language**: TypeScript/JavaScript

## Overview

OpenCode SDK provides a type-safe client for interacting with the OpenCode server. Unlike Claude and Codex which are primarily CLI tools with SDK wrappers, OpenCode is a client/server architecture where the SDK communicates with a running OpenCode server process.

**Key Difference**: OpenCode supports 75+ LLM providers through the AI SDK, meaning it's a provider-agnostic agent platform.

## Installation

```bash
npm install @opencode-ai/sdk
```

## Architecture

OpenCode uses a **client/server architecture**:

1. Server runs separately (started via `opencode serve` or programmatically)
2. SDK client connects to server via HTTP
3. Real-time updates via Server-Sent Events (SSE)

This is fundamentally different from Claude/Codex which spawn subprocesses.

## Core API

### Starting Server + Client (Recommended)

Use `createOpencode()` to automatically start the server and get a connected client:

```typescript
import { createOpencode } from "@opencode-ai/sdk";

const { client } = await createOpencode({
  hostname: "127.0.0.1",
  port: 4096,
  timeout: 5000,  // Server startup timeout
  signal: abortController.signal,
  config: { /* config overrides */ }
});
```

**For Animus**: Our adapter will use `createOpencode()` to auto-start the server, handling lifecycle management transparently.

### Client-Only Connection

Connect to an already-running server (useful for debugging or shared server scenarios):

```typescript
import { createOpencodeClient } from "@opencode-ai/sdk";

const client = createOpencodeClient({
  baseUrl: "http://localhost:4096"
});
```

## Session Management

### Creating Sessions

```typescript
const session = await client.session.create({
  body: { title: "My session" }
});
```

### Session Operations

| Method | Purpose |
|--------|---------|
| `session.create()` | New session |
| `session.list()` | All sessions |
| `session.get({ path })` | Get specific |
| `session.delete({ path })` | Delete |
| `session.abort({ path })` | Stop running |
| `session.children({ path })` | Child sessions |
| `session.messages({ path })` | All messages |
| `session.revert({ path, body })` | Undo message |
| `session.unrevert({ path })` | Restore reverted |

### Sending Messages (Prompts)

```typescript
const result = await client.session.prompt({
  path: { id: session.id },
  body: {
    model: {
      providerID: "anthropic",
      modelID: "claude-3-5-sonnet-20241022"
    },
    parts: [{ type: "text", text: "Hello!" }]
  }
});
```

### Context Injection (No AI Response)

```typescript
await client.session.prompt({
  path: { id: session.id },
  body: {
    noReply: true,  // Inject context without triggering response
    parts: [{ type: "text", text: "System context here..." }]
  }
});
```

## Event Streaming (SSE)

OpenCode uses Server-Sent Events for real-time updates:

```typescript
const events = await client.event.subscribe();

for await (const event of events.stream) {
  console.log("Event:", event.type, event.properties);
}
```

### Message Parts

Messages are composed of parts:

- `text` - Text content
- `tool` - Tool calls
- `result` - Tool results
- `file` - File references
- `reasoning` - Chain of thought
- `snapshot` - State snapshots

## Multi-Provider Support

OpenCode supports 75+ providers. Configure auth per-provider:

```typescript
await client.auth.set({
  path: { id: "anthropic" },
  body: { type: "api", key: "your-api-key" }
});
```

### Supported Providers (Partial)

- Anthropic (Claude)
- OpenAI
- Google (Gemini)
- LMStudio (local)
- Ollama (local)
- AWS Bedrock
- Azure OpenAI
- And many more...

### Model Selection

```json
{
  "model": "anthropic/claude-sonnet-4-5-20250514"
}
```

Format: `provider_id/model_id`

## File Operations

```typescript
// Search text in files
const textResults = await client.find.text({
  query: { pattern: "function.*opencode" }
});

// Find files by pattern
const files = await client.find.files({
  query: { query: "*.ts", type: "file", limit: 20 }
});

// Read file content
const content = await client.file.read({
  query: { path: "src/index.ts" }
});

// Get file status
const status = await client.file.status();
```

## Built-in Tools

| Tool | Description |
|------|-------------|
| `read` | Read files |
| `write` | Create files |
| `edit` | Edit files |
| `grep` | Search contents |
| `glob` | Find by pattern |
| `bash` | Run commands |
| `list` | List directory |
| `patch` | Apply patches |
| `webfetch` | Fetch URLs |
| `lsp` | Language server |

Tools use ripgrep internally and respect `.gitignore` by default.

## Agent System

### Agent Types

1. **Primary Agents**: Main assistants (e.g., Build, Plan)
2. **Subagents**: Specialized, invoked via `@mention`
3. **System Agents**: Hidden (compaction, titling)

### Agent Configuration

**JSON format** (opencode.json):

```json
{
  "agent": {
    "review": {
      "description": "Reviews code for quality",
      "mode": "subagent",
      "model": "anthropic/claude-sonnet-4-5",
      "temperature": 0.1,
      "tools": { "write": false, "edit": false }
    }
  }
}
```

**Markdown format** (.opencode/agents/review.md):

```yaml
---
description: Reviews code for quality
mode: subagent
temperature: 0.1
tools:
  write: false
  edit: false
permission:
  bash: deny
---
Your system prompt instructions here.
```

### Agent Options

| Option | Purpose |
|--------|---------|
| `description` | Agent overview (required) |
| `mode` | primary, subagent, or all |
| `model` | Model override |
| `temperature` | Randomness (0.0-1.0) |
| `steps` | Max iterations |
| `tools` | Tool access |
| `permission` | ask/allow/deny rules |
| `hidden` | Hide from `@` menu |

## Modes (Plan vs Build)

### Build Mode (Default)

Full tool access for development.

### Plan Mode

Read-only analysis mode. Disables:
- `write` - File creation
- `edit` - File modification (except `.opencode/plans/*.md`)
- `patch` - Patch application
- `bash` - Command execution

Switch modes with Tab key.

### Unified Permission Model Mapping

Our unified permission model maps to OpenCode as follows:

| Unified Config | OpenCode SDK |
|----------------|--------------|
| `executionMode: 'plan'` | `mode: 'plan'` |
| `executionMode: 'build'` + `approvalLevel: 'strict'` | `mode: 'build'` + all tools set to `ask` |
| `executionMode: 'build'` + `approvalLevel: 'normal'` | `mode: 'build'` + modification tools set to `ask` |
| `executionMode: 'build'` + `approvalLevel: 'trusted'` | `mode: 'build'` + all tools set to `allow` |
| `executionMode: 'build'` + `approvalLevel: 'none'` | `mode: 'build'` + all tools set to `allow` |
| `toolPermissions: { bash: 'deny' }` | `permission: { bash: 'deny' }` |

**OpenCode has full tool-level permission support** - the `toolPermissions` overrides map directly to OpenCode's per-tool permission system.

## Plugin System

OpenCode supports plugins with hooks:

```typescript
import { type Plugin, tool } from "@opencode-ai/plugin";

export const MyPlugin: Plugin = async (ctx) => {
  return {
    tool: {
      mytool: tool({
        description: "Custom tool",
        args: { foo: tool.schema.string() },
        async execute(args, context) {
          return `Hello ${args.foo}`;
        }
      })
    }
  };
};
```

### Hook Events

- `command.executed`
- `file.edited`, `file.watcher.updated`
- `message.part.updated`, `message.updated`
- `permission.asked`, `permission.replied`
- `session.created`, `session.idle`, `session.error`
- `tool.execute.before`, `tool.execute.after`
- `shell.env`
- `tui.prompt.append`, `tui.toast.show`

### Unified Hook Model Mapping

OpenCode has **good hook support** via the plugin system, but cannot block execution:

| Unified Hook | OpenCode Plugin Hook | Capabilities |
|--------------|---------------------|--------------|
| `onPreToolUse` | `tool.execute.before` | ⚠️ Can emit, **cannot block**, can modify args |
| `onPostToolUse` | `tool.execute.after` | ✅ Full |
| `onToolError` | `session.error` | ✅ Full |
| `onSessionStart` | `session.created` | ✅ Full |
| `onSessionEnd` | `session.idle` | ✅ Full |
| `onSubagentStart` | Via message events | ✅ Full (via @mentions) |
| `onSubagentEnd` | Via message events | ✅ Full |

**Implementation**: The adapter creates a plugin wrapper that listens to OpenCode's plugin hooks and emits normalized events to user's callbacks.

**Limitation**: Unlike Claude, OpenCode's `tool.execute.before` hook **cannot block execution**. If a user's `onPreToolUse` hook returns `{ allow: false }`, the adapter will log a warning but execution will proceed.

**Note**: Plugins are file-based in OpenCode, so the adapter must either:
1. Generate a temporary plugin file, or
2. Use the SDK's internal hook mechanism if available

## Configuration

### Configuration Precedence

1. Remote config (`.well-known/opencode`)
2. Global (`~/.config/opencode/opencode.json`)
3. Custom (`OPENCODE_CONFIG` env)
4. Project (`opencode.json`)
5. `.opencode` directories
6. Inline (`OPENCODE_CONFIG_CONTENT`)

### Key Settings

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-sonnet-4-5",
  "small_model": "anthropic/claude-3-5-haiku",
  "theme": "dark",
  "autoupdate": "notify",
  "compaction": "auto",
  "share": "manual"
}
```

### Variable Substitution

- `{env:VARIABLE_NAME}` - Environment variables
- `{file:path/to/file}` - File contents

## TUI Control

Control the terminal UI programmatically:

```typescript
await client.tui.showToast({
  body: { message: "Done!", variant: "success" }
});

await client.tui.appendPrompt({ body: { text: "..." } });
await client.tui.submitPrompt();
await client.tui.clearPrompt();
await client.tui.openSessions();
await client.tui.openModels();
```

## Health & Info

```typescript
const health = await client.global.health();
console.log(health.data.version);

const project = await client.project.current();
const pathInfo = await client.path.get();
const config = await client.config.get();
const providers = await client.config.providers();
```

## Session Cancellation Behavior

**Note**: When sessions are cancelled/aborted:
- Previous context may be lost
- Queued messages are silently rejected
- Interrupted assistant messages are not added to conversation

This is an important consideration for our abstraction layer.

## Key Concerns for Abstraction Layer

1. **Client/server architecture** - Different from CLI wrappers (adapter will auto-start server via `createOpencode()`)
2. **Multi-provider support** - Can use any provider via `providerID/modelID` format
3. **SSE streaming** - Different streaming mechanism (must subscribe separately from prompts)
4. **Plugin-based hooks** - Cannot block execution, but can observe and modify args (see mapping above)
5. **Agent/Mode system** - Plan mode maps to unified `executionMode: 'plan'`
6. **Session persistence** - Server-side, not file-based
7. **No single "query" function** - More REST-like API
8. **Full permission support** - Tool-level permissions map directly to unified model

## Comparison to Claude/Codex

| Aspect | Claude Agent SDK | Codex SDK | OpenCode SDK |
|--------|------------------|-----------|--------------|
| Architecture | Async generator (spawns CLI) | CLI subprocess | Client/Server |
| Entry point | `query()` | `startThread()` | `client.session.prompt()` |
| Streaming | Generator yield | Events iterator | SSE subscription |
| Providers | Anthropic only | OpenAI only | 75+ providers |
| Auth | API key or OAuth token | API key or OAuth (auto-discovered) | Per-provider |
| Cancel/Abort | ✅ AbortController | ❌ Not supported | ✅ session.abort() |
| Pre-execution hooks | ✅ Can block/modify | ❌ Observe only | ⚠️ Can modify, can't block |
| Subagents | ✅ Task tool | ❌ Native (needs Agents SDK) | ✅ @mentions |
| Plan mode | ✅ `permissionMode: 'plan'` | ⚠️ Via sandbox | ✅ Native plan mode |

## References

- [OpenCode SDK Documentation](https://opencode.ai/docs/sdk/)
- [OpenCode Agents](https://opencode.ai/docs/agents/)
- [OpenCode Modes](https://opencode.ai/docs/modes/)
- [OpenCode Config](https://opencode.ai/docs/config/)
- [GitHub: opencode-ai/opencode](https://github.com/opencode-ai/opencode)
- [npm: @opencode-ai/sdk](https://www.npmjs.com/package/@opencode-ai/sdk)
