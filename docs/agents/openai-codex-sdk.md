# OpenAI Codex SDK Research Document

> Comprehensive research on the OpenAI Codex SDK - an agentic coding SDK that powers terminal-based and IDE-integrated AI coding assistants.

## Table of Contents

1. [Overview](#overview)
2. [Installation & Setup](#installation--setup)
3. [SDK Architecture & Core APIs](#sdk-architecture--core-apis)
4. [Authentication Methods](#authentication-methods)
5. [Session Management](#session-management)
6. [Streaming & Events](#streaming--events)
7. [Tool System](#tool-system)
8. [Sandbox & Security](#sandbox--security)
9. [Token Usage & Cost Tracking](#token-usage--cost-tracking)
10. [Configuration Options](#configuration-options)
11. [Complete Code Examples](#complete-code-examples)
12. [Limitations & Known Issues](#limitations--known-issues)
13. [Sources](#sources)

---

## Overview

The OpenAI Codex SDK (`@openai/codex-sdk`) is a TypeScript library that provides programmatic control over the Codex agent. The SDK wraps the bundled `codex` binary and spawns the CLI while exchanging JSONL events over stdin/stdout.

**Key capabilities:**
- Create agents that perform complex engineering tasks
- Build Codex into internal tools and workflows
- Integrate Codex within applications
- Control Codex as part of CI/CD pipelines
- Produce JSON responses conforming to specified schemas
- React to intermediate progress via streaming events

**Package Information:**
- **npm package**: `@openai/codex-sdk`
- **Latest version**: 0.87.0 (as of January 2026)
- **Node.js requirement**: 18+
- **GitHub**: https://github.com/openai/codex

---

## Installation & Setup

### Basic Installation

```bash
npm install @openai/codex-sdk
```

### Environment Setup

Set your OpenAI API key:

```bash
export OPENAI_API_KEY="your-api-key-here"
```

Or configure programmatically:

```typescript
import { Codex } from "@openai/codex-sdk";

const codex = new Codex({
  apiKey: process.env.OPENAI_API_KEY,
  baseUrl: "https://api.openai.com/v1" // Optional custom endpoint
});
```

---

## SDK Architecture & Core APIs

### Main Classes

#### `Codex` Class

The main entry point for the SDK.

```typescript
import { Codex } from "@openai/codex-sdk";

const codex = new Codex();
```

**Constructor Options:**
- `apiKey`: API key for authentication
- `baseUrl`: Custom API endpoint URL
- `env`: Environment variables to pass to the CLI process

#### `Thread` Class

Represents a conversation thread with the Codex agent.

```typescript
const thread = codex.startThread({
  workingDirectory: "/path/to/project",
  skipGitRepoCheck: true,  // By default, requires Git repo
  model: "gpt-5.2-codex",  // Optional model override
  sandboxMode: "workspace-write"  // read-only | workspace-write | danger-full-access
});
```

**startThread Options:**
| Option | Type | Description |
|--------|------|-------------|
| `workingDirectory` | `string` | Sets the working directory for the agent |
| `skipGitRepoCheck` | `boolean` | Skip requirement for Git repository |
| `model` | `string` | Model to use (default: gpt-5.2-codex) |
| `sandboxMode` | `string` | Sandbox permission level |
| `config` | `object` | Additional CLI configuration overrides |

#### `Turn` Class

Returned from `run()` calls, contains results of a single turn.

```typescript
interface Turn {
  finalResponse: string;  // The assistant's last agent_message
  items: ThreadItem[];    // All completed thread items from this turn
  usage: Usage;           // Token consumption for this turn
}
```

### Core Methods

#### `thread.run(prompt)`

Execute a prompt and wait for completion.

```typescript
const turn = await thread.run("Diagnose the test failure and propose a fix");
console.log(turn.finalResponse);  // Final text response
console.log(turn.items);          // All items (commands, file changes, etc.)
console.log(turn.usage);          // Token usage statistics
```

#### `thread.runStreamed(prompt)`

Execute a prompt with real-time streaming events.

```typescript
const { events } = await thread.runStreamed("Fix the CI failures");

for await (const event of events) {
  switch (event.type) {
    case "item.completed":
      console.log("Item completed:", event.item);
      break;
    case "turn.completed":
      console.log("Turn completed, usage:", event.usage);
      break;
  }
}
```

#### Structured Output

Request JSON responses conforming to a schema:

```typescript
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const ReviewSchema = z.object({
  issues: z.array(z.object({
    file: z.string(),
    line: z.number(),
    severity: z.enum(["error", "warning", "info"]),
    message: z.string()
  })),
  summary: z.string()
});

const turn = await thread.run("Review the code changes", {
  outputSchema: zodToJsonSchema(ReviewSchema)
});

const review = JSON.parse(turn.finalResponse);
```

#### Structured Input (Images)

Provide text and images as input:

```typescript
const turn = await thread.run([
  { type: "text", text: "Describe what you see in this screenshot" },
  { type: "image", path: "/path/to/screenshot.png" }
]);
```

---

## Authentication Methods

### Method 1: API Key (Recommended for SDK)

```typescript
// Via environment variable
export OPENAI_API_KEY="sk-..."

// Or programmatically
const codex = new Codex({
  apiKey: "sk-..."
});
```

### Method 2: ChatGPT Subscription (OAuth)

For CLI usage, Codex supports browser-based OAuth with your ChatGPT account:

1. **Browser OAuth Flow**: Opens a browser window for login
2. **Token Caching**: Credentials cached at `~/.codex/auth.json`
3. **Shared Credentials**: CLI and IDE extension share cached login

**OAuth Endpoints:**
- Authorization: `https://auth.openai.com/oauth/authorize`
- Token: `https://auth.openai.com/oauth/token`

**ChatGPT Plan Benefits:**
| Plan | Benefit |
|------|---------|
| Free/Go | Limited trial access |
| Plus | 2x rate limits |
| Pro | Enhanced rate limits |
| Business/Enterprise | Full access |

### Headless Authentication

For CI/CD or remote environments where browser login isn't possible:

```bash
# Use API key instead
export OPENAI_API_KEY="sk-..."
codex --api-key "$OPENAI_API_KEY"
```

### Third-Party OAuth Plugin

For tools like OpenCode that need ChatGPT subscription auth:
- Plugin: [opencode-openai-codex-auth](https://github.com/numman-ali/opencode-openai-codex-auth)
- Uses official PKCE OAuth 2.0 flow

---

## Session Management

### Creating and Managing Threads

```typescript
import { Codex } from "@openai/codex-sdk";

const codex = new Codex();

// Start a new thread
const thread = codex.startThread({
  workingDirectory: "/my/project"
});

// First turn
const turn1 = await thread.run("What files are in this project?");

// Continue conversation (multi-turn)
const turn2 = await thread.run("Now analyze the main.ts file");

// Continue on same thread instance
const turn3 = await thread.run("Refactor the function we just discussed");
```

### Resuming Previous Sessions

Threads are persisted to `~/.codex/sessions/`:

```typescript
// Resume a past thread by providing thread ID
const thread = codex.resumeThread("thread-id-here");
const turn = await thread.run("Continue where we left off");
```

### Context Management

For long conversations:
- **Compaction**: Use `/compact` command to generate compressed context
- **History**: Transcripts stored locally for session resumption
- **Plan History**: Approvals and plans persist across resumes

### Session Timeout (with Agents SDK)

When using Codex as an MCP server:

```typescript
client_session_timeout_seconds = 360000  // 100 hours
```

### Cancellation (Limited Support)

**Current Limitation**: The TypeScript SDK does not yet provide a native `abort()` or `cancel()` method for active `thread.run()` calls. This is an open feature request ([Issue #5494](https://github.com/openai/codex/issues/5494)).

**App Server Alternative**: The Codex App Server provides a `turn/interrupt` endpoint:

```typescript
// POST to /turn/interrupt to cancel in-flight turn
// Returns success with status "interrupted"
```

---

## Streaming & Events

### Event Types

The SDK emits these event types via `runStreamed()`:

| Event Type | Description |
|------------|-------------|
| `thread.started` | Thread initialization complete |
| `turn.started` | New turn begins |
| `turn.completed` | Turn finished successfully |
| `turn.failed` | Turn failed with error |
| `item.started` | New item beginning |
| `item.updated` | Item progress update |
| `item.completed` | Item finished |
| `error` | Error occurred |

### Item Types

Items represent actions taken by the agent:

| Item Type | Description | Key Fields |
|-----------|-------------|------------|
| `AgentMessageItem` | Text response from agent | `message` |
| `CommandExecutionItem` | Shell command executed | `command`, `exit_code`, `aggregated_output` |
| `FileChangeItem` | File modifications | `changes` (array of paths/kinds) |
| `McpToolCallItem` | MCP tool invocation | `tool_name`, `input`, `output` |
| `ReasoningItem` | Chain of thought | `reasoning` |
| `WebSearchItem` | Web search performed | `query`, `results` |
| `TodoListItem` | Agent's internal plan | `items` |

### Full Streaming Example

```typescript
import { Codex } from "@openai/codex-sdk";

async function streamCodex() {
  const codex = new Codex();
  const thread = codex.startThread({ workingDirectory: "/my/project" });

  const { events } = await thread.runStreamed("Fix the failing tests");

  for await (const event of events) {
    switch (event.type) {
      case "thread.started":
        console.log("Thread started");
        break;

      case "turn.started":
        console.log("Turn started");
        break;

      case "item.started":
        console.log(`Item started: ${event.item.type}`);
        break;

      case "item.completed":
        const item = event.item;
        switch (item.type) {
          case "agent_message":
            console.log("Agent:", item.message);
            break;
          case "command_execution":
            console.log(`Command: ${item.command}`);
            console.log(`Exit code: ${item.exit_code}`);
            console.log(`Output: ${item.aggregated_output}`);
            break;
          case "file_change":
            for (const change of item.changes) {
              console.log(`File ${change.kind}: ${change.path}`);
            }
            break;
          case "mcp_tool_call":
            console.log(`MCP Tool: ${item.tool_name}`);
            break;
        }
        break;

      case "turn.completed":
        console.log("Turn completed");
        console.log("Usage:", event.usage);
        break;

      case "turn.failed":
        console.error("Turn failed:", event.error);
        break;

      case "error":
        console.error("Error:", event.message);
        break;
    }
  }
}
```

### JSON Event Stream Format

The underlying CLI emits JSONL:

```json
{"type": "item.started", "item": {"type": "command_execution", "id": "..."}}
{"type": "item.completed", "item": {"type": "command_execution", "id": "...", "command": "npm test", "exit_code": 0}}
{"type": "item.started", "item": {"type": "agent_message", "id": "..."}}
{"type": "item.completed", "item": {"type": "agent_message", "id": "...", "message": "Tests are now passing."}}
{"type": "turn.completed", "usage": {"input_tokens": 1000, "output_tokens": 50}}
```

---

## Tool System

### Built-in Capabilities

Codex has native abilities for:
- **File Operations**: Read, write, create, delete files
- **Command Execution**: Run shell commands
- **Web Search**: Optional, opt-in feature

### MCP (Model Context Protocol) Integration

Codex supports MCP servers for extended tool capabilities:

**Server Types:**
1. **STDIO Servers**: Local process started by command
2. **Streamable HTTP Servers**: Remote servers accessed via URL

**Configuration in `~/.codex/config.toml`:**

```toml
[mcp_servers.context7]
type = "stdio"
command = "npx"
args = ["-y", "@context7/mcp-server"]

[mcp_servers.playwright]
type = "stdio"
command = "npx"
args = ["-y", "@playwright/mcp-server"]

[mcp_servers.figma]
type = "http"
url = "https://figma-mcp.example.com/v1"
```

### Common MCP Servers

| Server | Purpose |
|--------|---------|
| Context7 | Up-to-date developer documentation |
| Figma | Access design files |
| Playwright | Browser automation |
| Chrome DevTools | Control Chrome browser |
| Sentry | Access error logs |

### Running Codex as MCP Server

Codex itself can be an MCP server:

```bash
codex --mcp-server
```

**Exposed Tools:**
- `codex()`: Start a new conversation
- `codex-reply()`: Continue an existing conversation

**Integration with Agents SDK:**

```python
from agents_sdk import Agent, MCPClient

mcp_client = MCPClient(
    command="codex --mcp-server",
    client_session_timeout_seconds=360000
)

agent = Agent(
    name="CodeAgent",
    tools=[mcp_client.get_tool("codex")]
)
```

---

## Sandbox & Security

### Sandbox Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| `read-only` | Read files only, no writes or commands | Safe exploration |
| `workspace-write` | Write to workspace and /tmp only | Default for most tasks |
| `danger-full-access` | Full system access | CI/CD, trusted automation |

### OS-Level Sandboxing

- **macOS**: Seatbelt
- **Linux**: seccomp/Landlock

### Default Restrictions

- **No network access** by default
- **Writes limited** to current workspace and temp directories
- **Approval prompts** for leaving sandbox boundaries

### Approval Policies

```toml
# In ~/.codex/config.toml
approval_policy = "on-request"  # Default
sandbox_mode = "workspace-write"
```

**Policy Options:**
| Policy | Behavior |
|--------|----------|
| `untrusted` | Only known-safe read commands auto-run |
| `on-failure` | Auto-run in sandbox, prompt on failure |
| `on-request` | Model decides when to ask (default) |
| `never` | Never prompt (use with caution) |

### CLI Flags

```bash
# Full autonomy mode
codex --full-auto  # Alias for --sandbox workspace-write --ask-for-approval on-request

# Disable all approval prompts (risky)
codex --ask-for-approval never
# or
codex -a never
```

### Security Advisory

A sandbox bypass vulnerability was patched in v0.39.0. Always use the latest version.

---

## Token Usage & Cost Tracking

### Usage Structure

Token usage is reported in the `turn.completed` event and `Turn` object:

```typescript
interface Usage {
  input_tokens: number;   // Tokens sent to API
  output_tokens: number;  // Tokens generated
  total_tokens: number;   // Sum of input + output
}
```

### Accessing Usage Data

```typescript
// Non-streaming
const turn = await thread.run("Analyze this code");
console.log("Input tokens:", turn.usage.input_tokens);
console.log("Output tokens:", turn.usage.output_tokens);
console.log("Total tokens:", turn.usage.total_tokens);

// Streaming
const { events } = await thread.runStreamed("Fix the bug");
for await (const event of events) {
  if (event.type === "turn.completed") {
    console.log("Usage:", event.usage);
  }
}
```

### Pricing (as of 2026)

| Model | Input (per 1M) | Output (per 1M) | Context |
|-------|----------------|-----------------|---------|
| gpt-5.2-codex | $1.75 | ~$10.00 | 400K |
| gpt-5.1-codex | $1.25 | $10.00 | 400K |
| codex-mini-latest | $1.50 | $6.00 | - |

**Prompt Caching**: 75% discount on cached prompts.

### Cost Calculation Example

```typescript
const PRICING = {
  "gpt-5.2-codex": { input: 1.75 / 1_000_000, output: 10 / 1_000_000 }
};

function calculateCost(usage: Usage, model: string): number {
  const prices = PRICING[model];
  return (usage.input_tokens * prices.input) +
         (usage.output_tokens * prices.output);
}

const turn = await thread.run("Generate a test suite");
const cost = calculateCost(turn.usage, "gpt-5.2-codex");
console.log(`Cost: $${cost.toFixed(4)}`);
```

---

## Configuration Options

### Configuration Hierarchy

1. CLI flags (highest priority)
2. Project config (`.codex/config.toml` in project root)
3. User config (`~/.codex/config.toml`)
4. System defaults (lowest priority)

### Sample Configuration

```toml
# ~/.codex/config.toml

# Model Configuration
model = "gpt-5.2-codex"
provider = "openai"

# Security
sandbox_mode = "workspace-write"
approval_policy = "on-request"

# Custom Instructions
model_instructions_file = "AGENTS.md"

# Additional writable directories
writable_roots = ["/tmp", "/var/cache/myapp"]

# MCP Servers
[mcp_servers.docs]
type = "stdio"
command = "npx"
args = ["-y", "@context7/mcp-server"]

[mcp_servers.browser]
type = "stdio"
command = "npx"
args = ["-y", "@playwright/mcp-server"]
```

### SDK Configuration Override

Pass configuration via the `config` option:

```typescript
const thread = codex.startThread({
  workingDirectory: "/my/project",
  config: {
    model: "gpt-5.1-codex",
    sandbox_mode: "workspace-write",
    approval_policy: "never"
  }
});
```

The SDK flattens the config object into dotted paths and serializes as TOML literals.

### Available Models

| Model | Description |
|-------|-------------|
| `gpt-5.2-codex` | Latest, best for long tasks (default) |
| `gpt-5.1-codex` | Previous generation |
| `gpt-5.1-codex-max` | Extended capabilities |
| `gpt-5-codex` | Original GPT-5 Codex |
| `codex-mini-latest` | Smaller, faster, cheaper |

---

## Complete Code Examples

### Basic Usage

```typescript
import { Codex } from "@openai/codex-sdk";

async function main() {
  const codex = new Codex();
  const thread = codex.startThread();

  const turn = await thread.run("List all TypeScript files in this project");
  console.log(turn.finalResponse);
}

main().catch(console.error);
```

### Multi-Turn Conversation

```typescript
import { Codex } from "@openai/codex-sdk";

async function analyzeProject() {
  const codex = new Codex();
  const thread = codex.startThread({
    workingDirectory: "/path/to/project"
  });

  // First turn: understand the project
  const turn1 = await thread.run("Analyze this project structure");
  console.log("Analysis:", turn1.finalResponse);

  // Second turn: find issues
  const turn2 = await thread.run("Find potential bugs in the main module");
  console.log("Issues found:", turn2.finalResponse);

  // Third turn: fix issues
  const turn3 = await thread.run("Fix the issues you found");
  console.log("Fixes applied:", turn3.finalResponse);

  // Report total usage
  const totalTokens = turn1.usage.total_tokens +
                      turn2.usage.total_tokens +
                      turn3.usage.total_tokens;
  console.log("Total tokens used:", totalTokens);
}

analyzeProject().catch(console.error);
```

### Streaming with Full Event Handling

```typescript
import { Codex } from "@openai/codex-sdk";

interface EventStats {
  commands: number;
  fileChanges: number;
  messages: number;
}

async function streamWithStats() {
  const codex = new Codex();
  const thread = codex.startThread({
    workingDirectory: "/path/to/project",
    skipGitRepoCheck: true
  });

  const stats: EventStats = { commands: 0, fileChanges: 0, messages: 0 };
  const { events } = await thread.runStreamed("Refactor the utils module");

  for await (const event of events) {
    if (event.type === "item.completed") {
      switch (event.item.type) {
        case "command_execution":
          stats.commands++;
          console.log(`[CMD] ${event.item.command} (exit: ${event.item.exit_code})`);
          break;
        case "file_change":
          stats.fileChanges += event.item.changes.length;
          for (const change of event.item.changes) {
            console.log(`[FILE] ${change.kind}: ${change.path}`);
          }
          break;
        case "agent_message":
          stats.messages++;
          console.log(`[MSG] ${event.item.message}`);
          break;
      }
    } else if (event.type === "turn.completed") {
      console.log("\n--- Turn Complete ---");
      console.log("Commands run:", stats.commands);
      console.log("Files changed:", stats.fileChanges);
      console.log("Messages:", stats.messages);
      console.log("Tokens:", event.usage);
    }
  }
}

streamWithStats().catch(console.error);
```

### Structured Output with Zod

```typescript
import { Codex } from "@openai/codex-sdk";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const CodeReviewSchema = z.object({
  summary: z.string(),
  score: z.number().min(0).max(100),
  issues: z.array(z.object({
    severity: z.enum(["critical", "major", "minor", "suggestion"]),
    file: z.string(),
    line: z.number().optional(),
    description: z.string(),
    recommendation: z.string()
  })),
  strengths: z.array(z.string()),
  recommendations: z.array(z.string())
});

type CodeReview = z.infer<typeof CodeReviewSchema>;

async function reviewCode() {
  const codex = new Codex();
  const thread = codex.startThread({
    workingDirectory: "/path/to/project"
  });

  const turn = await thread.run(
    "Review the code quality of the src/utils.ts file",
    { outputSchema: zodToJsonSchema(CodeReviewSchema) }
  );

  const review: CodeReview = JSON.parse(turn.finalResponse);

  console.log(`Code Review Score: ${review.score}/100`);
  console.log(`Summary: ${review.summary}`);
  console.log(`\nIssues (${review.issues.length}):`);
  for (const issue of review.issues) {
    console.log(`  [${issue.severity}] ${issue.file}:${issue.line || "?"}`);
    console.log(`    ${issue.description}`);
  }
}

reviewCode().catch(console.error);
```

### Custom Configuration and Error Handling

```typescript
import { Codex } from "@openai/codex-sdk";

async function robustCodex() {
  const codex = new Codex({
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"
  });

  const thread = codex.startThread({
    workingDirectory: "/path/to/project",
    skipGitRepoCheck: false,
    config: {
      model: "gpt-5.2-codex",
      sandbox_mode: "workspace-write",
      approval_policy: "never"
    }
  });

  try {
    const { events } = await thread.runStreamed("Run tests and fix failures");

    for await (const event of events) {
      if (event.type === "turn.failed") {
        console.error("Turn failed:", event.error);
        // Implement retry logic or fallback
        break;
      }

      if (event.type === "error") {
        console.error("Stream error:", event.message);
        continue;
      }

      if (event.type === "item.completed" && event.item.type === "command_execution") {
        if (event.item.exit_code !== 0) {
          console.warn(`Command failed: ${event.item.command}`);
        }
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error("SDK Error:", error.message);
    }
    throw error;
  }
}

robustCodex().catch(console.error);
```

---

## Limitations & Known Issues

### Current SDK Limitations

1. **No Abort/Cancel Method**: Cannot programmatically cancel an active `thread.run()` call ([Issue #5494](https://github.com/openai/codex/issues/5494))

2. **Limited File Diff Data**: `FileChangeItem` only provides path and kind (add/delete/update), not detailed diffs ([Issue #5850](https://github.com/openai/codex/issues/5850))

3. **Git Repository Requirement**: By default requires working directory to be a Git repo (use `skipGitRepoCheck: true` to bypass)

4. **No Native Cleanup Method**: No explicit `dispose()` or `close()` method documented for TypeScript SDK

5. **Browser Required for OAuth**: ChatGPT subscription auth requires browser for OAuth flow (problematic for headless environments)

### Workarounds

**For abort/cancel:**
- Use App Server's `/turn/interrupt` endpoint
- Implement timeout wrapper around `run()` calls

**For file diffs:**
- Use Git commands after changes: `git diff HEAD`
- Monitor filesystem independently

**For headless OAuth:**
- Use API key authentication instead
- Pre-authenticate and copy `~/.codex/auth.json`

---

## Sources

### Official Documentation
- [Codex SDK Documentation](https://developers.openai.com/codex/sdk/)
- [Codex CLI Reference](https://developers.openai.com/codex/cli/reference/)
- [Codex Authentication](https://developers.openai.com/codex/auth/)
- [Codex Security](https://developers.openai.com/codex/security/)
- [Codex Configuration Reference](https://developers.openai.com/codex/config-reference/)
- [Codex MCP Integration](https://developers.openai.com/codex/mcp/)
- [Codex Pricing](https://developers.openai.com/codex/pricing/)
- [Codex Models](https://developers.openai.com/codex/models/)

### GitHub
- [OpenAI Codex Repository](https://github.com/openai/codex)
- [TypeScript SDK README](https://github.com/openai/codex/blob/main/sdk/typescript/README.md)
- [TypeScript SDK Directory](https://github.com/openai/codex/tree/main/sdk/typescript)
- [Codex Releases](https://github.com/openai/codex/releases)

### npm
- [@openai/codex-sdk Package](https://www.npmjs.com/package/@openai/codex-sdk)
- [@openai/codex Package](https://www.npmjs.com/package/@openai/codex)

### Guides & Cookbooks
- [Using Codex with Agents SDK](https://developers.openai.com/codex/guides/agents-sdk/)
- [Build Code Review with Codex SDK](https://cookbook.openai.com/examples/codex/build_code_review_with_codex_sdk)
- [Building Consistent Workflows](https://cookbook.openai.com/examples/codex/codex_mcp_agents_sdk/building_consistent_workflows_codex_cli_agents_sdk)

### OpenAI Platform
- [GPT-5.2-Codex Model](https://platform.openai.com/docs/models/gpt-5.2-codex)
- [GPT-5.1-Codex Model](https://platform.openai.com/docs/models/gpt-5.1-codex)
- [Structured Outputs Guide](https://platform.openai.com/docs/guides/structured-outputs)

### Community Resources
- [Promptfoo Codex SDK Provider](https://www.promptfoo.dev/docs/providers/openai-codex-sdk/)
- [OpenCode Codex Auth Plugin](https://github.com/numman-ali/opencode-openai-codex-auth)

---

*Document generated: February 2026*
*Based on @openai/codex-sdk v0.87.0*
