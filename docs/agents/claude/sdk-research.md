# Claude Agent SDK Research

> **Package**: `@anthropic-ai/claude-agent-sdk`
> **Status**: Production-ready
> **Languages**: TypeScript, Python

## Overview

The Claude Agent SDK (formerly Claude Code SDK) provides programmatic access to build AI agents that autonomously read files, run commands, search the web, and edit code. It offers the same tools, agent loop, and context management that powers Claude Code.

## Installation

```bash
npm install @anthropic-ai/claude-agent-sdk
```

## Core API

### The `query()` Function

Primary entry point - creates an async generator that streams messages as they arrive.

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Find and fix the bug in auth.py",
  options: {
    allowedTools: ["Read", "Edit", "Bash"],
    permissionMode: "acceptEdits"
  }
})) {
  if ("result" in message) console.log(message.result);
}
```

### Query Object Interface

```typescript
interface Query extends AsyncGenerator<SDKMessage, void> {
  interrupt(): Promise<void>;
  rewindFiles(userMessageUuid: string): Promise<void>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  setModel(model?: string): Promise<void>;
  setMaxThinkingTokens(maxThinkingTokens: number | null): Promise<void>;
  supportedCommands(): Promise<SlashCommand[]>;
  supportedModels(): Promise<ModelInfo[]>;
  mcpServerStatus(): Promise<McpServerStatus[]>;
  accountInfo(): Promise<AccountInfo>;
}
```

## Architecture: SDK Uses Claude Code Under the Hood

The Claude Agent SDK spawns the Claude Code CLI as a subprocess and communicates via JSON-lines over stdin/stdout. This is a crucial architectural detail that affects authentication:

```
┌──────────────────┐       stdin/stdout        ┌──────────────────┐
│  Your App        │  ◄──── JSON-lines ────►   │  Claude Code CLI │
│  (SDK query())   │                           │  (subprocess)    │
└──────────────────┘                           └──────────────────┘
```

The SDK can either:
1. Use a bundled Claude Code binary (default)
2. Use a custom Claude Code executable via `pathToClaudeCodeExecutable` option

### Bundled CLI vs Native Binary

The SDK bundles a `cli.js` at the package root. This is the agent execution engine only: it handles queries, tools, streaming, and MCP. It does NOT have auth subcommands (`auth login`, `auth logout`, `auth status`). Those commands are exclusive to the separately-installed native Claude Code binary (typically at `~/.local/bin/claude` or `/usr/local/bin/claude`).

This distinction matters for the Animus backend: agent execution uses the SDK-bundled `cli.js`, while auth flows need the native binary. See [sdk-cli-architecture.md](../sdk-cli-architecture.md) for the full resolution strategy.

## Authentication Methods

### 1. API Key Authentication

```bash
export ANTHROPIC_API_KEY=your-api-key
```

### 2. Subscription Authentication (via Authenticated Claude Code)

Since the SDK uses Claude Code under the hood, **subscription auth IS supported** when Claude Code is already authenticated.

**Option A: Long-Lived Token (Recommended for Subscription Users)**

Claude Code supports **long-lived tokens valid for 1 year** for subscription users (Pro/Max plans):

```bash
# Generate long-lived token
claude setup-token
```

This stores credentials in two locations:
- `~/.claude/.credentials` - JSON file with token data
- macOS Keychain - Under service name "Claude Code-credentials"

The credentials structure:
```json
{
  "accessToken": "your-token",
  "refreshToken": "your-token",
  "expiresAt": 1798761600,  // Unix timestamp, 1 year from creation
  "scopes": ["user:inference"],
  "subscriptionType": "max"
}
```

**Option B: OAuth Token Environment Variable**

For programmatic use, set the token as an environment variable:

```bash
export CLAUDE_CODE_OAUTH_TOKEN=your-oauth-token
```

**Option C: Pre-Authenticated Claude Code**

If Claude Code is already logged in (via `claude` CLI), the SDK will use those credentials when pointing to the local installation:

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Your task...",
  options: {
    pathToClaudeCodeExecutable: "/usr/local/bin/claude"  // Uses existing auth
  }
})) {}
```

**How to Authenticate Claude Code:**

```bash
# Interactive login (opens browser)
claude

# Or use an existing API key
export ANTHROPIC_API_KEY=your-key

# Generate long-lived token for programmatic use (valid 1 year)
claude setup-token
```

### Token Lifetimes

| Token Type | Duration | Use Case |
|------------|----------|----------|
| API Key | Indefinite | Direct API access |
| Long-lived subscription token | 1 year | Subscription users (Pro/Max) |
| OAuth access token | 8-12 hours | Short-term, requires refresh |

### 3. Third-Party Providers

| Provider | Environment Variable |
|----------|---------------------|
| Amazon Bedrock | `CLAUDE_CODE_USE_BEDROCK=1` |
| Google Vertex AI | `CLAUDE_CODE_USE_VERTEX=1` |
| Microsoft Azure | `CLAUDE_CODE_USE_FOUNDRY=1` |

### Authentication Priority

The SDK checks for credentials in this order:
1. `CLAUDE_CODE_OAUTH_TOKEN` - OAuth token for subscription
2. `ANTHROPIC_API_KEY` - Direct API key
3. Third-party provider environment variables
4. Credentials stored by Claude Code CLI at `~/.claude/.credentials` (includes long-lived tokens)

## Message Types

```typescript
type SDKMessage =
  | SDKAssistantMessage      // Assistant response
  | SDKUserMessage           // User input
  | SDKResultMessage         // Final result with usage/cost
  | SDKSystemMessage         // System initialization (session_id here)
  | SDKPartialAssistantMessage  // Streaming partial
  | SDKCompactBoundaryMessage;  // Context compaction marker
```

### Result Message (Final)

```typescript
type SDKResultMessage = {
  type: 'result';
  subtype: 'success' | 'error_max_turns' | 'error_during_execution' | 'error_max_budget_usd';
  session_id: string;
  duration_ms: number;
  num_turns: number;
  result: string;
  total_cost_usd: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  modelUsage: { [modelName: string]: ModelUsage };
}
```

## Session Management

### Getting Session ID

```typescript
let sessionId: string | undefined;

for await (const message of query({ prompt: "Hello", options })) {
  if (message.type === 'system' && message.subtype === 'init') {
    sessionId = message.session_id;
  }
}
```

### Resuming Sessions

```typescript
const response = query({
  prompt: "Continue...",
  options: { resume: sessionId }
});
```

### Forking Sessions

```typescript
const response = query({
  prompt: "Try different approach",
  options: { resume: sessionId, forkSession: true }
});
```

## Streaming Events

Enable with `includePartialMessages: true`:

```typescript
for await (const message of query({
  prompt: "Task...",
  options: { includePartialMessages: true }
})) {
  if (message.type === "stream_event") {
    const event = message.event;
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      process.stdout.write(event.delta.text);
    }
  }
}
```

### Event Flow

```
message_start → content_block_start → content_block_delta... → content_block_stop → message_stop
```

## Lifecycle Hooks

### Available Events

| Event | Description |
|-------|-------------|
| `PreToolUse` | Before tool execution - can block/modify |
| `PostToolUse` | After tool success |
| `PostToolUseFailure` | After tool failure |
| `SessionStart` | Session begins/resumes |
| `SessionEnd` | Session terminates |
| `UserPromptSubmit` | User submits prompt |
| `SubagentStart` | Subagent spawned |
| `SubagentStop` | Subagent finished |

### Hook Configuration

```typescript
import { query, HookCallback } from "@anthropic-ai/claude-agent-sdk";

const auditHook: HookCallback = async (input) => {
  console.log(`Tool: ${input.tool_name}, Input: ${JSON.stringify(input.tool_input)}`);
  return {};
};

for await (const message of query({
  prompt: "Task...",
  options: {
    hooks: {
      PreToolUse: [{ matcher: "Edit|Write", hooks: [auditHook] }]
    }
  }
})) {}
```

### Hook Output (Decision Control)

```typescript
type HookOutput = {
  continue?: boolean;
  decision?: 'approve' | 'block';
  systemMessage?: string;
  hookSpecificOutput?: {
    hookEventName: 'PreToolUse';
    permissionDecision?: 'allow' | 'deny' | 'ask';
    updatedInput?: Record<string, unknown>;
  };
}
```

## Built-in Tools

| Tool | Description |
|------|-------------|
| `Read` | Read files |
| `Write` | Create files |
| `Edit` | Edit existing files |
| `Bash` | Run commands |
| `Glob` | Find files by pattern |
| `Grep` | Search file contents |
| `WebSearch` | Search the web |
| `WebFetch` | Fetch web content |
| `Task` | Spawn subagents |
| `AskUserQuestion` | Clarifying questions |
| `NotebookEdit` | Edit Jupyter notebooks |

### Tool Input/Output Types

```typescript
// Edit tool
interface FileEditInput {
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

// Bash tool
interface BashInput {
  command: string;
  timeout?: number;
  run_in_background?: boolean;
}
```

## Custom Tools via MCP

Claude Agent SDK has native MCP support via the `mcpServers` option:

```typescript
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const greetTool = tool(
  "greet",
  "Greets a user",
  { name: z.string() },
  async ({ name }) => ({
    content: [{ type: "text", text: `Hello, ${name}!` }]
  })
);

const mcpServer = createSdkMcpServer({
  name: "my-tools",
  tools: [greetTool]
});

for await (const message of query({
  prompt: "Greet John",
  options: { mcpServers: { "my-tools": mcpServer } }
})) {}
```

**For Animus**: Our adapter will pass through MCP configuration directly to the SDK, allowing users to add custom MCP servers to expand agent capabilities.

## Configuration Options

### Key Options

```typescript
type Options = {
  // Core
  prompt: string;
  model?: string;
  systemPrompt?: string;
  cwd?: string;

  // Session
  resume?: string;          // Session ID to resume
  forkSession?: boolean;    // Fork instead of continue

  // Permissions
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
  allowedTools?: string[];
  disallowedTools?: string[];
  canUseTool?: CanUseTool;  // Custom permission function

  // Limits
  maxTurns?: number;
  maxBudgetUsd?: number;
  maxThinkingTokens?: number;

  // Streaming
  includePartialMessages?: boolean;

  // Hooks
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;

  // MCP
  mcpServers?: Record<string, McpServerConfig>;

  // Agents
  agents?: Record<string, AgentDefinition>;

  // Cancellation
  abortController?: AbortController;
}
```

### Permission Modes

| Mode | Behavior |
|------|----------|
| `default` | Requires canUseTool callback |
| `acceptEdits` | Auto-accept file edits |
| `bypassPermissions` | No prompts (CI/CD) |
| `plan` | Read-only analysis |

### Unified Permission Model Mapping

Our unified permission model maps to Claude as follows:

| Unified Config | Claude SDK |
|----------------|------------|
| `executionMode: 'plan'` | `permissionMode: 'plan'` |
| `executionMode: 'build'` + `approvalLevel: 'strict'` | `permissionMode: 'default'` + restrictive `canUseTool` |
| `executionMode: 'build'` + `approvalLevel: 'normal'` | `permissionMode: 'default'` |
| `executionMode: 'build'` + `approvalLevel: 'trusted'` | `permissionMode: 'acceptEdits'` |
| `executionMode: 'build'` + `approvalLevel: 'none'` | `permissionMode: 'bypassPermissions'` |
| `toolPermissions: { bash: 'deny' }` | `disallowedTools: ['Bash']` |

**Claude has full permission support** - all unified permission options map cleanly.

## Token Usage & Cost Tracking

Token usage is available in the final `result` message:

```typescript
for await (const message of query({ prompt: "..." })) {
  if (message.type === 'result') {
    console.log(`Cost: $${message.total_cost_usd}`);
    console.log(`Input tokens: ${message.usage.input_tokens}`);
    console.log(`Output tokens: ${message.usage.output_tokens}`);
    console.log(`Cache read: ${message.usage.cache_read_input_tokens || 0}`);
  }
}
```

### Per-Model Breakdown

```typescript
type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  webSearchRequests: number;
  costUSD: number;
  contextWindow: number;
}
```

## Subagents

```typescript
for await (const message of query({
  prompt: "Use the code-reviewer agent to review this",
  options: {
    allowedTools: ["Read", "Glob", "Grep", "Task"],
    agents: {
      "code-reviewer": {
        description: "Expert code reviewer",
        prompt: "Analyze code quality and suggest improvements.",
        tools: ["Read", "Glob", "Grep"]
      }
    }
  }
})) {}
```

## Unified Hook Model Mapping

Claude has **full hook support** - all unified hooks map directly:

| Unified Hook | Claude SDK Hook | Capabilities |
|--------------|-----------------|--------------|
| `onPreToolUse` | `PreToolUse` | ✅ Can block, ✅ Can modify input |
| `onPostToolUse` | `PostToolUse` | ✅ Full |
| `onToolError` | `PostToolUseFailure` | ✅ Full |
| `onSessionStart` | `SessionStart` | ✅ Full |
| `onSessionEnd` | `SessionEnd` | ✅ Full |
| `onSubagentStart` | `SubagentStart` | ✅ Full |
| `onSubagentEnd` | `SubagentStop` | ✅ Full |

**Claude is the reference implementation** for our hook system. It supports:
- Blocking execution in `onPreToolUse` (return `{ allow: false }`)
- Modifying tool input in `onPreToolUse` (return `{ modifiedInput: {...} }`)
- Regex-based tool matchers for filtering which tools trigger hooks

## Key Concerns for Abstraction Layer

1. **Subscription auth requires pre-authenticated Claude Code** - Users need `CLAUDE_CODE_OAUTH_TOKEN` or a pre-authenticated Claude Code installation
2. **Async generator-based streaming** - Different from other SDKs (thread-based or client/server)
3. **Session management via resume/fork** - Unique session model with UUIDs
4. **Rich hook system** - Most comprehensive of the three SDKs (reference implementation)
5. **Built-in tool execution** - Tools run automatically within the subprocess
6. **MCP server support** - For custom tools
7. **Subprocess architecture** - SDK spawns CLI as child process, which affects process lifecycle management

## References

- [Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- [TypeScript SDK Reference](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [npm Package](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)
- [GitHub Issues](https://github.com/anthropics/claude-code/issues)
