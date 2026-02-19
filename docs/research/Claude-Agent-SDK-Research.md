# Claude Agent SDK Comprehensive Research

> **Note**: The Claude Code SDK has been renamed to the **Claude Agent SDK**. The npm package is `@anthropic-ai/claude-agent-sdk`.

## Table of Contents

1. [Overview](#overview)
2. [Installation](#installation)
3. [Authentication Methods](#authentication-methods)
4. [Core APIs & Architecture](#core-apis--architecture)
5. [Session Management](#session-management)
6. [Streaming & Events](#streaming--events)
7. [Lifecycle Hooks](#lifecycle-hooks)
8. [Tool System](#tool-system)
9. [Token Usage & Cost Tracking](#token-usage--cost-tracking)
10. [Configuration Options](#configuration-options)
11. [V2 Preview Interface](#v2-preview-interface)

---

## Overview

The Claude Agent SDK enables you to build AI agents that autonomously read files, run commands, search the web, edit code, and more. It provides the same tools, agent loop, and context management that power Claude Code, programmable in Python and TypeScript.

### Key Features

- **Built-in Tools**: Read files, run commands, and search codebases out of the box
- **Hooks System**: Run custom code at key points in the agent lifecycle
- **Subagents**: Spawn specialized agents to handle focused subtasks
- **MCP Integration**: Connect to external systems via Model Context Protocol
- **Session Management**: Maintain context across multiple exchanges
- **Permission Controls**: Control exactly which tools your agent can use

---

## Installation

### TypeScript

```bash
npm install @anthropic-ai/claude-agent-sdk
```

### Python

```bash
# Using pip
pip install claude-agent-sdk

# Using uv (recommended)
uv add claude-agent-sdk
```

---

## Authentication Methods

### 1. API Key Authentication (Recommended for SDK)

The Claude Agent SDK is designed to use API keys for authentication.

```bash
# Set environment variable
export ANTHROPIC_API_KEY=your-api-key

# Or create .env file
ANTHROPIC_API_KEY=your-api-key
```

### 2. Third-Party Provider Authentication

The SDK supports authentication via third-party API providers:

| Provider | Environment Variable | Setup Guide |
|----------|---------------------|-------------|
| Amazon Bedrock | `CLAUDE_CODE_USE_BEDROCK=1` | Configure AWS credentials |
| Google Vertex AI | `CLAUDE_CODE_USE_VERTEX=1` | Configure Google Cloud credentials |
| Microsoft Azure | `CLAUDE_CODE_USE_FOUNDRY=1` | Configure Azure credentials |

### 3. Claude Code CLI Subscription Authentication

The Claude Code CLI (not the SDK) supports subscription-based authentication:

```bash
# Authenticate via CLI
claude
/login  # Sign in to your Anthropic account
```

**Important Distinction**:
- **Claude Agent SDK** -> Use **API keys**
- **Claude Code CLI** -> Can use either **API keys** or **subscription auth**

> **Note**: Anthropic does not allow third-party developers to offer claude.ai login or rate limits for their products unless previously approved. Use API key authentication for SDK-based applications.

---

## Core APIs & Architecture

### The `query()` Function

The primary function for interacting with Claude. Creates an async generator that streams messages as they arrive.

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

function query({
  prompt,
  options
}: {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
}): Query
```

### Basic Usage Example

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Find and fix the bug in auth.py",
  options: {
    allowedTools: ["Read", "Edit", "Bash"],
    permissionMode: "acceptEdits"
  }
})) {
  if (message.type === "assistant" && message.message?.content) {
    for (const block of message.message.content) {
      if ("text" in block) {
        console.log(block.text);
      }
    }
  }
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

---

## Session Management

### Getting the Session ID

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

let sessionId: string | undefined;

const response = query({
  prompt: "Help me build a web application",
  options: { model: "claude-sonnet-4-5" }
});

for await (const message of response) {
  if (message.type === 'system' && message.subtype === 'init') {
    sessionId = message.session_id;
    console.log(`Session started with ID: ${sessionId}`);
  }
}
```

### Resuming Sessions

```typescript
// Resume a previous session using its ID
const response = query({
  prompt: "Continue implementing the authentication system",
  options: {
    resume: "session-xyz",
    model: "claude-sonnet-4-5",
    allowedTools: ["Read", "Edit", "Write", "Glob", "Grep", "Bash"]
  }
});

for await (const message of response) {
  console.log(message);
}
```

### Session Forking

Create a new session branch from an existing state:

```typescript
// Fork the session to try a different approach
const forkedResponse = query({
  prompt: "Now let's redesign this as a GraphQL API instead",
  options: {
    resume: sessionId,
    forkSession: true,  // Creates a new session ID
    model: "claude-sonnet-4-5"
  }
});
```

| Behavior | `forkSession: false` (default) | `forkSession: true` |
|----------|-------------------------------|---------------------|
| **Session ID** | Same as original | New session ID generated |
| **History** | Appends to original session | Creates new branch from resume point |
| **Original Session** | Modified | Preserved unchanged |

### Session Cancellation

```typescript
const abortController = new AbortController();

const response = query({
  prompt: "Long running task...",
  options: {
    abortController
  }
});

// Cancel the operation
abortController.abort();
```

---

## Streaming & Events

### Enable Streaming Output

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "List the files in my project",
  options: {
    includePartialMessages: true,  // Enable streaming
    allowedTools: ["Bash", "Read"],
  }
})) {
  if (message.type === "stream_event") {
    const event = message.event;
    if (event.type === "content_block_delta") {
      if (event.delta.type === "text_delta") {
        process.stdout.write(event.delta.text);
      }
    }
  }
}
```

### Message Types

```typescript
type SDKMessage =
  | SDKAssistantMessage      // Assistant response
  | SDKUserMessage           // User input
  | SDKUserMessageReplay     // Replayed user message
  | SDKResultMessage         // Final result
  | SDKSystemMessage         // System initialization
  | SDKPartialAssistantMessage  // Streaming partial (when includePartialMessages: true)
  | SDKCompactBoundaryMessage;  // Conversation compaction boundary
```

### Streaming Event Types

| Event Type | Description |
|:-----------|:------------|
| `message_start` | Start of a new message |
| `content_block_start` | Start of a new content block (text or tool use) |
| `content_block_delta` | Incremental update to content |
| `content_block_stop` | End of a content block |
| `message_delta` | Message-level updates (stop reason, usage) |
| `message_stop` | End of the message |

### Message Flow with Streaming

```
StreamEvent (message_start)
StreamEvent (content_block_start) - text block
StreamEvent (content_block_delta) - text chunks...
StreamEvent (content_block_stop)
StreamEvent (content_block_start) - tool_use block
StreamEvent (content_block_delta) - tool input chunks...
StreamEvent (content_block_stop)
StreamEvent (message_delta)
StreamEvent (message_stop)
AssistantMessage - complete message with all content
... tool executes ...
... more streaming events for next turn ...
ResultMessage - final result
```

### Stream Tool Calls Example

```typescript
let currentTool: string | null = null;
let toolInput = "";

for await (const message of query({
  prompt: "Read the README.md file",
  options: {
    includePartialMessages: true,
    allowedTools: ["Read", "Bash"],
  }
})) {
  if (message.type === "stream_event") {
    const event = message.event;

    if (event.type === "content_block_start") {
      if (event.content_block.type === "tool_use") {
        currentTool = event.content_block.name;
        toolInput = "";
        console.log(`Starting tool: ${currentTool}`);
      }
    } else if (event.type === "content_block_delta") {
      if (event.delta.type === "input_json_delta") {
        const chunk = event.delta.partial_json;
        toolInput += chunk;
      }
    } else if (event.type === "content_block_stop") {
      if (currentTool) {
        console.log(`Tool ${currentTool} called with: ${toolInput}`);
        currentTool = null;
      }
    }
  }
}
```

---

## Lifecycle Hooks

### Available Hook Events

| Event | Description |
|-------|-------------|
| `PreToolUse` | Before tool execution - can block |
| `PostToolUse` | After tool success |
| `PostToolUseFailure` | After tool failure |
| `Notification` | When Claude needs attention |
| `UserPromptSubmit` | When user submits a prompt |
| `SessionStart` | When session begins or resumes |
| `SessionEnd` | When session terminates |
| `Stop` | When Claude finishes responding |
| `SubagentStart` | When a subagent is spawned |
| `SubagentStop` | When a subagent finishes |
| `PreCompact` | Before context compaction |
| `PermissionRequest` | When permission dialog appears |

### Hook Configuration

```typescript
import { query, HookCallback } from "@anthropic-ai/claude-agent-sdk";
import { appendFileSync } from "fs";

const logFileChange: HookCallback = async (input) => {
  const filePath = (input as any).tool_input?.file_path ?? "unknown";
  appendFileSync("./audit.log", `${new Date().toISOString()}: modified ${filePath}\n`);
  return {};
};

for await (const message of query({
  prompt: "Refactor utils.py to improve readability",
  options: {
    permissionMode: "acceptEdits",
    hooks: {
      PostToolUse: [{ matcher: "Edit|Write", hooks: [logFileChange] }]
    }
  }
})) {
  if ("result" in message) console.log(message.result);
}
```

### Hook Input Types

```typescript
// PreToolUse
type PreToolUseHookInput = BaseHookInput & {
  hook_event_name: 'PreToolUse';
  tool_name: string;
  tool_input: unknown;
}

// PostToolUse
type PostToolUseHookInput = BaseHookInput & {
  hook_event_name: 'PostToolUse';
  tool_name: string;
  tool_input: unknown;
  tool_response: unknown;
}

// SessionStart
type SessionStartHookInput = BaseHookInput & {
  hook_event_name: 'SessionStart';
  source: 'startup' | 'resume' | 'clear' | 'compact';
}

// SessionEnd
type SessionEndHookInput = BaseHookInput & {
  hook_event_name: 'SessionEnd';
  reason: ExitReason;
}
```

### Hook Output (Decision Control)

```typescript
type SyncHookJSONOutput = {
  continue?: boolean;
  suppressOutput?: boolean;
  stopReason?: string;
  decision?: 'approve' | 'block';
  systemMessage?: string;
  reason?: string;
  hookSpecificOutput?:
    | {
        hookEventName: 'PreToolUse';
        permissionDecision?: 'allow' | 'deny' | 'ask';
        permissionDecisionReason?: string;
        updatedInput?: Record<string, unknown>;
      }
    | {
        hookEventName: 'UserPromptSubmit';
        additionalContext?: string;
      }
    | {
        hookEventName: 'SessionStart';
        additionalContext?: string;
      }
    | {
        hookEventName: 'PostToolUse';
        additionalContext?: string;
      };
}
```

---

## Tool System

### Built-in Tools

| Tool | Description |
|------|-------------|
| **Read** | Read any file in the working directory |
| **Write** | Create new files |
| **Edit** | Make precise edits to existing files |
| **Bash** | Run terminal commands, scripts, git operations |
| **Glob** | Find files by pattern |
| **Grep** | Search file contents with regex |
| **WebSearch** | Search the web for current information |
| **WebFetch** | Fetch and parse web page content |
| **Task** | Launch subagents for complex tasks |
| **AskUserQuestion** | Ask clarifying questions |
| **NotebookEdit** | Edit Jupyter notebook cells |
| **TodoWrite** | Create and manage task lists |

### Tool Input/Output Types

#### Edit Tool

```typescript
interface FileEditInput {
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

interface EditOutput {
  message: string;
  replacements: number;
  file_path: string;
}
```

#### Bash Tool

```typescript
interface BashInput {
  command: string;
  timeout?: number;
  description?: string;
  run_in_background?: boolean;
}

interface BashOutput {
  output: string;
  exitCode: number;
  killed?: boolean;
  shellId?: string;
}
```

#### Read Tool

```typescript
interface FileReadInput {
  file_path: string;
  offset?: number;
  limit?: number;
}
```

### Custom Tools via MCP

```typescript
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

// Define a custom tool
const myTool = tool(
  "greet",
  "Greets a user by name",
  { name: z.string() },
  async ({ name }) => ({
    content: [{ type: "text", text: `Hello, ${name}!` }]
  })
);

// Create MCP server with the tool
const mcpServer = createSdkMcpServer({
  name: "my-tools",
  version: "1.0.0",
  tools: [myTool]
});

// Use in query
for await (const message of query({
  prompt: "Greet John",
  options: {
    mcpServers: {
      "my-tools": mcpServer
    }
  }
})) {
  console.log(message);
}
```

### MCP Server Configuration

```typescript
// Stdio server
type McpStdioServerConfig = {
  type?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

// SSE server
type McpSSEServerConfig = {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
}

// HTTP server
type McpHttpServerConfig = {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}
```

---

## Token Usage & Cost Tracking

### Usage Structure

The final `result` message contains cumulative usage data:

```typescript
type SDKResultMessage = {
  type: 'result';
  subtype: 'success';
  uuid: UUID;
  session_id: string;
  duration_ms: number;
  duration_api_ms: number;
  is_error: boolean;
  num_turns: number;
  result: string;
  total_cost_usd: number;
  usage: NonNullableUsage;
  modelUsage: { [modelName: string]: ModelUsage };
  permission_denials: SDKPermissionDenial[];
  structured_output?: unknown;
}
```

### ModelUsage Type

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

### Cost Tracking Implementation

```typescript
class CostTracker {
  private processedMessageIds = new Set<string>();
  private stepUsages: Array<any> = [];

  async trackConversation(prompt: string) {
    const result = await query({
      prompt,
      options: {
        onMessage: (message) => {
          this.processMessage(message);
        }
      }
    });

    return {
      result,
      stepUsages: this.stepUsages,
      totalCost: result.usage?.total_cost_usd || 0
    };
  }

  private processMessage(message: any) {
    if (message.type !== 'assistant' || !message.usage) return;
    if (this.processedMessageIds.has(message.id)) return;

    this.processedMessageIds.add(message.id);
    this.stepUsages.push({
      messageId: message.id,
      timestamp: new Date().toISOString(),
      usage: message.usage,
      costUSD: this.calculateCost(message.usage)
    });
  }

  private calculateCost(usage: any): number {
    const inputCost = usage.input_tokens * 0.00003;
    const outputCost = usage.output_tokens * 0.00015;
    const cacheReadCost = (usage.cache_read_input_tokens || 0) * 0.0000075;
    return inputCost + outputCost + cacheReadCost;
  }
}
```

### Key Usage Rules

1. **Same ID = Same Usage**: All messages with the same `id` report identical usage
2. **Charge Once Per Step**: Only charge once per unique message ID
3. **Result Message is Authoritative**: The `total_cost_usd` field is accurate for billing
4. **Per-Model Breakdown**: Use `modelUsage` for multi-model scenarios

---

## Configuration Options

### Full Options Interface

```typescript
type Options = {
  // Cancellation
  abortController?: AbortController;

  // Directory access
  additionalDirectories?: string[];
  cwd?: string;

  // Agents
  agents?: Record<string, AgentDefinition>;

  // Permissions
  allowDangerouslySkipPermissions?: boolean;
  allowedTools?: string[];
  disallowedTools?: string[];
  canUseTool?: CanUseTool;
  permissionMode?: PermissionMode;

  // Beta features
  betas?: SdkBeta[];

  // Session
  continue?: boolean;
  resume?: string;
  forkSession?: boolean;
  resumeSessionAt?: string;

  // Environment
  env?: Dict<string>;
  executable?: 'bun' | 'deno' | 'node';
  executableArgs?: string[];

  // Model configuration
  model?: string;
  fallbackModel?: string;
  maxThinkingTokens?: number;
  maxTurns?: number;
  maxBudgetUsd?: number;

  // Streaming
  includePartialMessages?: boolean;

  // Hooks
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;

  // MCP
  mcpServers?: Record<string, McpServerConfig>;
  strictMcpConfig?: boolean;

  // System prompt
  systemPrompt?: string | { type: 'preset'; preset: 'claude_code'; append?: string };

  // Tools
  tools?: string[] | { type: 'preset'; preset: 'claude_code' };

  // Output
  outputFormat?: { type: 'json_schema'; schema: JSONSchema };

  // Settings
  settingSources?: SettingSource[];

  // Plugins
  plugins?: SdkPluginConfig[];

  // Sandbox
  sandbox?: SandboxSettings;

  // File checkpointing
  enableFileCheckpointing?: boolean;

  // Output callbacks
  stderr?: (data: string) => void;
}
```

### Permission Modes

```typescript
type PermissionMode =
  | 'default'           // Standard permission behavior
  | 'acceptEdits'       // Auto-accept file edits
  | 'bypassPermissions' // Bypass all permission checks
  | 'plan'              // Planning mode - no execution
```

### Setting Sources

```typescript
type SettingSource = 'user' | 'project' | 'local';

// 'user' = ~/.claude/settings.json
// 'project' = .claude/settings.json
// 'local' = .claude/settings.local.json (gitignored)
```

### Sandbox Settings

```typescript
type SandboxSettings = {
  enabled?: boolean;
  autoAllowBashIfSandboxed?: boolean;
  excludedCommands?: string[];
  allowUnsandboxedCommands?: boolean;
  network?: NetworkSandboxSettings;
  ignoreViolations?: SandboxIgnoreViolations;
  enableWeakerNestedSandbox?: boolean;
}
```

---

## V2 Preview Interface

> **Warning**: The V2 interface is an unstable preview. APIs may change.

### Key Differences from V1

- Removes async generators and yield coordination
- Separates sending and streaming into distinct steps
- Each turn is a separate `send()`/`stream()` cycle

### One-Shot Prompt

```typescript
import { unstable_v2_prompt } from '@anthropic-ai/claude-agent-sdk';

const result = await unstable_v2_prompt('What is 2 + 2?', {
  model: 'claude-sonnet-4-5-20250929'
});
console.log(result.result);
```

### Session-Based Conversations

```typescript
import { unstable_v2_createSession } from '@anthropic-ai/claude-agent-sdk';

await using session = unstable_v2_createSession({
  model: 'claude-sonnet-4-5-20250929'
});

await session.send('Hello!');
for await (const msg of session.stream()) {
  if (msg.type === 'assistant') {
    const text = msg.message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');
    console.log(text);
  }
}
```

### Multi-Turn Conversation

```typescript
import { unstable_v2_createSession } from '@anthropic-ai/claude-agent-sdk';

await using session = unstable_v2_createSession({
  model: 'claude-sonnet-4-5-20250929'
});

// Turn 1
await session.send('What is 5 + 3?');
for await (const msg of session.stream()) {
  // Process response...
}

// Turn 2 - Claude remembers context
await session.send('Multiply that by 2');
for await (const msg of session.stream()) {
  // Process response...
}
```

### Session Resume (V2)

```typescript
import {
  unstable_v2_createSession,
  unstable_v2_resumeSession,
} from '@anthropic-ai/claude-agent-sdk';

// Create and use session
const session = unstable_v2_createSession({ model: 'claude-sonnet-4-5-20250929' });
await session.send('Remember this number: 42');

let sessionId: string | undefined;
for await (const msg of session.stream()) {
  sessionId = msg.session_id;
}
session.close();

// Later: resume
await using resumedSession = unstable_v2_resumeSession(sessionId!, {
  model: 'claude-sonnet-4-5-20250929'
});

await resumedSession.send('What number did I ask you to remember?');
for await (const msg of resumedSession.stream()) {
  // Claude remembers: 42
}
```

### V2 API Reference

```typescript
// Create new session
function unstable_v2_createSession(options: { model: string }): Session;

// Resume existing session
function unstable_v2_resumeSession(sessionId: string, options: { model: string }): Session;

// One-shot prompt
function unstable_v2_prompt(prompt: string, options: { model: string }): Promise<Result>;

// Session interface
interface Session {
  send(message: string): Promise<void>;
  stream(): AsyncGenerator<SDKMessage>;
  close(): void;
}
```

---

## Subagents

### Defining Custom Agents

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Use the code-reviewer agent to review this codebase",
  options: {
    allowedTools: ["Read", "Glob", "Grep", "Task"],
    agents: {
      "code-reviewer": {
        description: "Expert code reviewer for quality and security reviews.",
        prompt: "Analyze code quality and suggest improvements.",
        tools: ["Read", "Glob", "Grep"]
      }
    }
  }
})) {
  if ("result" in message) console.log(message.result);
}
```

### AgentDefinition Type

```typescript
type AgentDefinition = {
  description: string;  // When to use this agent
  tools?: string[];     // Allowed tools (inherits all if omitted)
  prompt: string;       // Agent's system prompt
  model?: 'sonnet' | 'opus' | 'haiku' | 'inherit';  // Model override
}
```

---

## References

- [Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- [TypeScript SDK Reference](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [Python SDK Reference](https://platform.claude.com/docs/en/agent-sdk/python)
- [TypeScript V2 Preview](https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview)
- [Session Management](https://platform.claude.com/docs/en/agent-sdk/sessions)
- [Streaming Output](https://platform.claude.com/docs/en/agent-sdk/streaming-output)
- [Cost Tracking](https://platform.claude.com/docs/en/agent-sdk/cost-tracking)
- [Hooks Guide](https://code.claude.com/docs/en/hooks-guide)
- [npm: @anthropic-ai/claude-agent-sdk](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)
- [GitHub: anthropics/claude-code](https://github.com/anthropics/claude-code)
- [GitHub: anthropics/claude-agent-sdk-typescript](https://github.com/anthropics/claude-agent-sdk-typescript)
