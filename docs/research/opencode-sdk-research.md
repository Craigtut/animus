# OpenCode SDK Research Report

> **STATUS: REFERENCE** - See [sdk-comparison.md](../agents/sdk-comparison.md) for overview. This document contains detailed provider-specific research.

## Executive Summary

OpenCode is an **open-source AI coding agent** built for the terminal, providing intelligent coding assistance through a client-server architecture. The OpenCode SDK (`@opencode-ai/sdk`) is a type-safe JavaScript/TypeScript client for interacting with the OpenCode server. It enables programmatic control of the OpenCode agent for building custom workflows and integrations.

**Key Characteristics:**
- **Open source** - Full source code available on GitHub
- **Provider agnostic** - Works with Claude, OpenAI, Google, local models, and 75+ providers
- **Client-server architecture** - Headless server with multiple client options (TUI, web, SDK)
- **Plugin system** - Extensible via hooks and custom tools
- **Self-hosted** - Run your own instance

---

## 1. SDK Architecture & Core APIs

### Package Information

| Attribute | Value |
|-----------|-------|
| Package Name | `@opencode-ai/sdk` |
| Latest Version | 1.1.23 (as of research date) |
| Weekly Downloads | ~127,000 |
| Repository | [github.com/sst/opencode-sdk-js](https://github.com/sst/opencode-sdk-js) |
| Documentation | [opencode.ai/docs/sdk](https://opencode.ai/docs/sdk/) |

### Installation

```bash
npm install @opencode-ai/sdk
```

### Creating a Client Instance

**Option 1: Start Server and Create Client**

This starts the OpenCode server and returns a connected client:

```typescript
import { createOpencode } from "@opencode-ai/sdk"

const { client } = await createOpencode({
  hostname: "127.0.0.1",  // default
  port: 4096,             // default
  timeout: 5000,          // ms, default
  signal: abortController.signal,  // optional AbortSignal
  config: {
    model: "anthropic/claude-3-5-sonnet-20241022"
  }
})
```

**Option 2: Connect to Existing Server**

Connect to an already-running OpenCode server:

```typescript
import { createOpencodeClient } from "@opencode-ai/sdk"

const client = createOpencodeClient({
  baseUrl: "http://localhost:4096"
})
```

### Core API Methods

#### Session Management

```typescript
// Create a new session
const session = await client.session.create()

// List all sessions
const sessions = await client.session.list()

// Get specific session
const session = await client.session.get({ path: { id: sessionId } })

// Update session properties
await client.session.update({
  path: { id: sessionId },
  body: { title: "New Title" }
})

// Delete session
await client.session.delete({ path: { id: sessionId } })
```

#### Sending Prompts

```typescript
// Send a prompt and receive AI response
const result = await client.session.prompt({
  path: { id: session.id },
  body: {
    model: {
      providerID: "anthropic",
      modelID: "claude-3-5-sonnet-20241022"
    },
    parts: [
      { type: "text", text: "Explain this codebase" }
    ]
  }
})

// Inject context without AI response (useful for system context)
await client.session.prompt({
  path: { id: session.id },
  body: {
    noReply: true,
    parts: [{ type: "text", text: "Important context to remember..." }]
  }
})

// Execute a command in session context
await client.session.command({
  path: { id: session.id },
  body: { command: "/init" }
})
```

#### File Operations

```typescript
// Search text patterns in files (uses ripgrep)
const results = await client.find.text({
  query: { pattern: "function.*opencode" }
})

// Find files by pattern
const files = await client.find.files({
  query: { query: "*.ts", type: "file" }
})

// Find workspace symbols
const symbols = await client.find.symbols({
  query: { query: "Session" }
})

// Read file contents
const content = await client.file.read({
  query: { path: "src/index.ts" }
})

// Check file status
const status = await client.file.status()
```

### Supported AI Providers

OpenCode supports **75+ LLM providers** through the AI SDK and Models.dev:

**Major Providers:**
- Anthropic (Claude 4 Sonnet, Claude Opus 4.5, Claude 3.5/3.7)
- OpenAI (GPT-5.2, GPT-5.1 Codex, GPT-4.1, O1/O3)
- Google (Gemini 2.5/3 Pro, Gemini Flash)
- Amazon Bedrock
- Azure OpenAI
- GitHub Copilot
- GitLab Duo

**Additional Providers:**
- Groq, Ollama, OpenRouter, Together AI, xAI
- Deep Infra, Hugging Face, LM Studio
- llama.cpp (local models)
- 302.AI, and many more

---

## 2. Lifecycle Hooks & Events

### Server-Sent Events (SSE) Streaming

OpenCode uses SSE for real-time event streaming:

```typescript
// Subscribe to all events
const events = await client.event.subscribe()

for await (const event of events.stream) {
  console.log("Event type:", event.type)
  console.log("Properties:", event.properties)

  // Handle specific event types
  switch (event.type) {
    case "session.updated":
      // Session state changed
      break
    case "message.part.updated":
      // New content streamed
      break
    case "tool.execute.after":
      // Tool completed
      break
  }
}

// Cancel stream
events.stream.controller.abort()
```

### Available Event Types

OpenCode emits events across multiple categories:

#### Session Events
| Event | Description |
|-------|-------------|
| `session.created` | New session started |
| `session.updated` | Session state changed |
| `session.deleted` | Session removed |
| `session.error` | Error occurred in session |
| `session.idle` | Session completed processing |
| `session.compacted` | Context was compacted |
| `session.diff` | Changes detected |
| `session.status` | Status update |

#### Message Events
| Event | Description |
|-------|-------------|
| `message.updated` | Message content changed |
| `message.removed` | Message deleted |
| `message.part.updated` | Streaming content update |
| `message.part.removed` | Part of message removed |

#### Tool Events
| Event | Description |
|-------|-------------|
| `tool.execute.before` | Tool about to execute |
| `tool.execute.after` | Tool completed execution |

#### Other Events
| Event | Description |
|-------|-------------|
| `file.edited` | File was modified |
| `file.watcher.updated` | File system change detected |
| `permission.asked` | Permission requested |
| `permission.replied` | Permission response |
| `server.connected` | Server connection established |
| `lsp.client.diagnostics` | LSP diagnostics received |
| `command.executed` | Command completed |

### Plugin Hook System

OpenCode provides 22+ lifecycle hooks through its plugin system:

```typescript
import { type Plugin, tool } from "@opencode-ai/plugin"

export const MyPlugin: Plugin = async ({ project, client, $, directory }) => {
  return {
    // Hook into tool execution
    "tool.execute.before": async (event) => {
      console.log("Tool starting:", event.tool)
      // Can modify or block tool execution
      return event // Return modified event or undefined to proceed
    },

    "tool.execute.after": async (event) => {
      console.log("Tool completed:", event.tool, event.result)
    },

    // Session lifecycle
    "session.created": async (event) => {
      console.log("New session:", event.sessionId)
    },

    "session.idle": async (event) => {
      // Good place to send notifications
    },

    // Intercept chat messages before processing
    "tui.prompt.append": async (event) => {
      // Modify prompts before they're sent
      return event
    }
  }
}
```

---

## 3. Authentication Methods

### API Key Authentication

```typescript
// Set API key for a provider
await client.auth.set({
  path: { id: "anthropic" },  // Provider ID
  body: {
    type: "api",
    key: "sk-ant-..."
  }
})

// Credentials stored in ~/.local/share/opencode/auth.json
```

### Environment Variables

Providers automatically read standard environment variables:

```bash
# Anthropic
export ANTHROPIC_API_KEY=sk-ant-...

# OpenAI
export OPENAI_API_KEY=sk-...

# Google
export GOOGLE_API_KEY=...

# Azure OpenAI
export AZURE_OPENAI_API_KEY=...
```

### Server Authentication

For the OpenCode server itself:

```bash
# HTTP Basic Auth for server protection
export OPENCODE_SERVER_USERNAME=opencode  # default
export OPENCODE_SERVER_PASSWORD=your-secret-password
```

### OAuth Integration

OpenCode supports OAuth for provider authentication through the `/connect` command and the OpenCode Zen service at `opencode.ai/auth`.

---

## 4. Tool System

### Built-in Tools (13 Total)

| Tool | Purpose |
|------|---------|
| `bash` | Execute shell commands in project environment |
| `read` | Read file contents from codebase |
| `write` | Create new files or overwrite existing ones |
| `edit` | Modify existing files using exact string replacements |
| `patch` | Apply patch files to the codebase |
| `grep` | Search file contents using regular expressions |
| `glob` | Find files by pattern matching |
| `list` | List files and directories in a path |
| `lsp` | Code intelligence (definitions, references, hover) |
| `skill` | Load and return SKILL.md file content |
| `todowrite` | Manage todo lists during coding sessions |
| `todoread` | Read existing todo lists |
| `webfetch` | Fetch and read web pages |
| `question` | Ask the user questions during execution |

### Tool Configuration

```json
// opencode.json
{
  "tools": {
    "bash": true,
    "write": true,
    "edit": true,
    "lsp": true
  },
  "permission": {
    "bash": "ask",      // Always ask for permission
    "write": "allow",   // Auto-allow
    "edit": "allow",
    "mymcp_*": "ask"    // Wildcards for MCP servers
  }
}
```

### Creating Custom Tools

Custom tools are TypeScript/JavaScript files in `.opencode/tools/` or `~/.config/opencode/tools/`:

```typescript
// .opencode/tools/database.ts
import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "Execute a database query",
  args: {
    query: tool.schema.string().describe("SQL query to execute"),
    limit: tool.schema.number().optional().describe("Max results")
  },
  async execute(args, context) {
    // context contains: agent, sessionID, messageID, directory, worktree

    const result = await runQuery(args.query, args.limit)
    return JSON.stringify(result)
  }
})
```

**Multiple Tools Per File:**

```typescript
// .opencode/tools/math.ts
import { tool } from "@opencode-ai/plugin"

export const add = tool({
  description: "Add two numbers",
  args: {
    a: tool.schema.number(),
    b: tool.schema.number()
  },
  execute: async ({ a, b }) => String(a + b)
})

export const multiply = tool({
  description: "Multiply two numbers",
  args: {
    a: tool.schema.number(),
    b: tool.schema.number()
  },
  execute: async ({ a, b }) => String(a * b)
})

// Creates tools: math_add, math_multiply
```

**Cross-Language Tools:**

```typescript
import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "Run Python analysis script",
  args: {
    data: tool.schema.string()
  },
  async execute({ data }) {
    const script = "./scripts/analyze.py"
    const result = await Bun.$`python3 ${script} ${data}`.text()
    return result
  }
})
```

### Tool Execution Context

```typescript
interface ToolContext {
  agent: string       // Agent identifier
  sessionID: string   // Current session
  messageID: string   // Message that invoked tool
  directory: string   // Working directory
  worktree: string    // Git worktree root
}
```

---

## 5. Token Usage & Cost Tracking

### Current State

OpenCode does **not have built-in token usage tracking** in the SDK. However, the community has developed several tools:

### Third-Party Solutions

**1. OpenCode Monitor** ([ocmonitor.vercel.app](https://ocmonitor.vercel.app/))
- Real-time usage analytics
- Token tracking across models
- Cost insights

**2. TokenScope** ([github.com/ramtinJ95/opencode-tokenscope](https://github.com/ramtinJ95/opencode-tokenscope))
- Comprehensive token analysis
- Accurate cost estimates
- Visual insights

**3. OCSight** ([github.com/heyhuynhgiabuu/ocsight](https://github.com/heyhuynhgiabuu/ocsight))
- Provider breakdowns
- Daily activity tracking
- Spending alerts

**4. Tokscale** ([github.com/junhoyeo/tokscale](https://github.com/junhoyeo/tokscale))
- Multi-platform tracking (OpenCode, Claude Code, Codex, etc.)
- Input/output/cache token breakdown
- Global leaderboard

### Enterprise Solutions

For enterprise-scale management, an AI gateway like [Portkey](https://portkey.ai/blog/opencode-token-usage-costs-and-access-control/) provides:
- Centralized usage tracking
- Budget enforcement
- Rate limiting
- Access control
- Monthly spending limits per member

### Implementing Custom Tracking

You can build tracking via the event system:

```typescript
const events = await client.event.subscribe()

let sessionTokens = {
  input: 0,
  output: 0
}

for await (const event of events.stream) {
  if (event.type === "message.part.updated") {
    // Track token usage from message metadata
    // Implementation depends on event structure
  }
}
```

---

## 6. Session Management

### Session Lifecycle

```typescript
// Create session
const session = await client.session.create()

// Session object structure
interface Session {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  // ... additional properties
}

// List all sessions
const sessions = await client.session.list()

// Get session with messages
const sessionWithMessages = await client.session.get({
  path: { id: session.id }
})
```

### Multi-Turn Conversations

Sessions maintain conversation context automatically:

```typescript
const session = await client.session.create()

// First turn
await client.session.prompt({
  path: { id: session.id },
  body: {
    parts: [{ type: "text", text: "What is TypeScript?" }]
  }
})

// Second turn - context is preserved
await client.session.prompt({
  path: { id: session.id },
  body: {
    parts: [{ type: "text", text: "Show me an example" }]
  }
})
```

### Context Compaction

OpenCode automatically compacts context when approaching limits:

```json
// opencode.json
{
  "compaction": "auto"  // or "prune"
}
```

When at 95% of context limit, OpenCode:
1. Summarizes the conversation
2. Creates a new session with summary
3. Continues seamlessly

### Cancellation and Timeouts

```typescript
// Using AbortController for cancellation
const controller = new AbortController()

const { client } = await createOpencode({
  signal: controller.signal,
  timeout: 30000  // 30 second timeout
})

// Cancel operations
controller.abort()
```

**Important Caveats:**
- Cancelled operations lose their context (the interrupted response is not added to conversation)
- Queued messages during an abort are silently rejected
- Use the Go SDK's `option.WithRequestTimeout()` for per-retry timeouts

### Session Forking

```typescript
// Fork a session to create a branch
const forkedSession = await client.session.fork({
  path: { id: originalSession.id }
})
```

---

## 7. Configuration Options

### Full Configuration Schema

```json
// opencode.json
{
  "$schema": "https://opencode.ai/config.json",

  // Model Selection
  "model": "anthropic/claude-sonnet-4-5",
  "small_model": "anthropic/claude-haiku-3-5",  // For lightweight tasks

  // Provider Configuration
  "provider": {
    "anthropic": {
      "timeout": 60000,
      "thinking": {
        "budgetTokens": 10000
      }
    },
    "openai": {
      "reasoningEffort": "medium"
    }
  },
  "disabled_providers": ["groq"],
  "enabled_providers": ["anthropic", "openai"],

  // Agent Configuration
  "agent": {
    "build": {
      "model": "anthropic/claude-sonnet-4-5",
      "temperature": 0.0,
      "steps": 50
    },
    "plan": {
      "model": "anthropic/claude-haiku-3-5",
      "temperature": 0.3
    }
  },
  "default_agent": "build",

  // Tools & Permissions
  "tools": {
    "bash": true,
    "lsp": true
  },
  "permission": {
    "bash": "ask",
    "edit": "allow"
  },

  // Server Settings
  "server": {
    "port": 4096,
    "hostname": "127.0.0.1",
    "cors": "*"
  },

  // UI Settings
  "theme": "catppuccin",
  "tui": {
    "scroll_speed": 3,
    "diff_style": "unified"
  },

  // Advanced
  "compaction": "auto",
  "autoupdate": "notify",
  "keybinds": {},
  "mcp": {},
  "plugin": ["opencode-helicone-session"],
  "instructions": [".opencode/rules.md"],
  "share": "manual"
}
```

### Configuration Locations (Precedence Order)

1. **Remote config** - `.well-known/opencode` (organizational defaults)
2. **Global config** - `~/.config/opencode/opencode.json`
3. **Custom config** - `OPENCODE_CONFIG` environment variable
4. **Project config** - `opencode.json` in project root
5. **`.opencode` directories** - agents, commands, plugins
6. **Inline config** - `OPENCODE_CONFIG_CONTENT` environment variable

### Variable Substitution

```json
{
  "provider": {
    "openai": {
      "apiKey": "{env:OPENAI_API_KEY}"
    }
  },
  "agent": {
    "custom": {
      "prompt": "{file:./prompts/custom.txt}"
    }
  }
}
```

### Model Variants

```json
{
  "provider": {
    "anthropic": {
      "models": {
        "claude-sonnet-4-5": {
          "variants": {
            "high": { "thinking": { "budgetTokens": 20000 } },
            "max": { "thinking": { "budgetTokens": 50000 } }
          }
        }
      }
    }
  }
}
```

---

## 8. Agent System

### Agent Types

**Primary Agents** - Main assistants for direct interaction:
- `build` - Default, full tool access
- `plan` - Restricted, analysis only

**Subagents** - Specialized assistants invoked by primary agents:
- `general` - Full access
- `explore` - Read-only

### Creating Custom Agents

**Via JSON:**

```json
// opencode.json
{
  "agent": {
    "review": {
      "mode": "primary",
      "description": "Code review specialist",
      "model": "anthropic/claude-sonnet-4-5",
      "prompt": "{file:.opencode/agents/review-prompt.txt}",
      "temperature": 0.2,
      "tools": {
        "read": true,
        "grep": true,
        "glob": true,
        "bash": false,
        "write": false
      },
      "steps": 30
    }
  }
}
```

**Via Markdown:**

```markdown
<!-- .opencode/agents/review.md -->
---
mode: primary
description: Code review specialist
model: anthropic/claude-sonnet-4-5
temperature: 0.2
tools:
  read: true
  grep: true
  glob: true
  bash: false
  write: false
---

You are an expert code reviewer. Analyze code for:
- Bugs and potential issues
- Performance problems
- Security vulnerabilities
- Style inconsistencies

Provide detailed, actionable feedback.
```

### System Prompts (AGENTS.md)

Create an `AGENTS.md` file for project-specific instructions:

```markdown
# Project Instructions

This is a TypeScript monorepo using:
- pnpm for package management
- Vitest for testing
- ESLint + Prettier for formatting

## Coding Standards
- Use strict TypeScript
- Prefer functional programming
- Write tests for all new features

## Architecture
- `/packages/core` - Core library
- `/packages/cli` - CLI application
- `/apps/web` - Web application
```

AGENTS.md locations:
- Project root: `./AGENTS.md`
- Multiple locations supported

---

## 9. Server API Reference

### Starting the Server

```bash
opencode serve --port 4096 --hostname 127.0.0.1 --cors "*"
```

### OpenAPI Specification

The server exposes an OpenAPI 3.1 spec at `/doc`:
```
http://localhost:4096/doc
```

### Key API Endpoints

#### Health & System
```
GET  /global/health     # Server status and version
GET  /global/event      # SSE event stream
```

#### Configuration
```
GET   /config           # Get configuration
PATCH /config           # Update configuration
GET   /provider         # List providers
```

#### Sessions
```
POST   /session                    # Create session
GET    /session                    # List sessions
GET    /session/:id                # Get session
DELETE /session/:id                # Delete session
POST   /session/:id/message        # Send message (sync)
POST   /session/:id/prompt_async   # Send message (async)
GET    /session/:id/message        # Get session messages
```

#### Files & Search
```
GET  /find?pattern=<pat>   # Text search
GET  /find/file?query=<q>  # File search
GET  /file/content?path=<p> # Read file
GET  /file/status          # File status
```

#### Integrations
```
GET  /lsp        # LSP server status
GET  /formatter  # Formatter status
GET  /mcp        # MCP server status
POST /mcp        # Add MCP server dynamically
```

---

## 10. Complete Code Example

### Building an Integration

```typescript
import { createOpencode, createOpencodeClient } from "@opencode-ai/sdk"
import type { Session, Message } from "@opencode-ai/sdk"

class OpenCodeAgent {
  private client: ReturnType<typeof createOpencodeClient>
  private session: Session | null = null

  async initialize() {
    const { client } = await createOpencode({
      port: 4096,
      config: {
        model: "anthropic/claude-sonnet-4-5"
      }
    })
    this.client = client

    // Set up event listener
    this.startEventListener()

    return this
  }

  private async startEventListener() {
    const events = await this.client.event.subscribe()

    for await (const event of events.stream) {
      this.handleEvent(event)
    }
  }

  private handleEvent(event: { type: string; properties: unknown }) {
    switch (event.type) {
      case "message.part.updated":
        console.log("Streaming:", event.properties)
        break
      case "tool.execute.before":
        console.log("Tool starting:", event.properties)
        break
      case "tool.execute.after":
        console.log("Tool completed:", event.properties)
        break
      case "session.idle":
        console.log("Session idle")
        break
    }
  }

  async createSession(): Promise<Session> {
    const session = await this.client.session.create()
    this.session = session
    return session
  }

  async prompt(text: string): Promise<void> {
    if (!this.session) {
      await this.createSession()
    }

    await this.client.session.prompt({
      path: { id: this.session!.id },
      body: {
        parts: [{ type: "text", text }]
      }
    })
  }

  async searchCode(pattern: string): Promise<unknown> {
    return this.client.find.text({
      query: { pattern }
    })
  }

  async readFile(path: string): Promise<string> {
    const result = await this.client.file.read({
      query: { path }
    })
    return result.content
  }

  async cleanup() {
    if (this.session) {
      await this.client.session.delete({
        path: { id: this.session.id }
      })
    }
  }
}

// Usage
async function main() {
  const agent = await new OpenCodeAgent().initialize()

  await agent.createSession()
  await agent.prompt("Analyze the architecture of this codebase")

  // Keep running to receive events
}

main().catch(console.error)
```

---

## 11. Sources

- [OpenCode SDK Documentation](https://opencode.ai/docs/sdk/)
- [OpenCode Server Documentation](https://opencode.ai/docs/server/)
- [OpenCode Providers Documentation](https://opencode.ai/docs/providers/)
- [OpenCode Tools Documentation](https://opencode.ai/docs/tools/)
- [OpenCode Custom Tools](https://opencode.ai/docs/custom-tools/)
- [OpenCode Plugins Documentation](https://opencode.ai/docs/plugins/)
- [OpenCode Agents Documentation](https://opencode.ai/docs/agents/)
- [OpenCode Modes Documentation](https://opencode.ai/docs/modes/)
- [OpenCode Configuration](https://opencode.ai/docs/config/)
- [OpenCode Models Documentation](https://opencode.ai/docs/models/)
- [OpenCode Main Documentation](https://opencode.ai/docs/)
- [@opencode-ai/sdk on npm](https://www.npmjs.com/package/@opencode-ai/sdk)
- [OpenCode GitHub Repository](https://github.com/opencode-ai/opencode)
- [OpenCode JS SDK Repository](https://github.com/sst/opencode-sdk-js)
- [Vercel AI SDK Community Provider for OpenCode](https://github.com/ben-vargas/ai-sdk-provider-opencode-sdk)
- [OpenCode Token Usage Article - Portkey](https://portkey.ai/blog/opencode-token-usage-costs-and-access-control/)
- [TokenScope Plugin](https://github.com/ramtinJ95/opencode-tokenscope)

---

## 12. Key Considerations for Animus Integration

1. **Server Dependency** - OpenCode requires running a server, unlike Claude Code which is CLI-integrated
2. **Token Tracking** - Must implement custom tracking via events or third-party tools
3. **Provider Flexibility** - Can configure any of 75+ providers through OpenCode's config
4. **Plugin System** - Can extend functionality through plugins and custom tools

For IAgentAdapter interface mapping and event normalization details, see [architecture-overview.md](../agents/architecture-overview.md).

---

*Research completed: February 2026*
