> **STATUS: RESEARCH** - The Pi adapter is not yet implemented. This is exploratory research.

# Pi SDK Research

> **Packages**: `@mariozechner/pi-ai` (LLM abstraction) + `@mariozechner/pi-agent-core` (agent framework)
> **Status**: Production-ready (v0.53.0)
> **Language**: TypeScript

## Overview

Pi-mono is a TypeScript monorepo by Mario Zechner (creator of libGDX) with 13K+ GitHub stars, MIT licensed. It follows a strict three-layer architecture:

- **Foundation**: `@mariozechner/pi-ai` (unified LLM API) + `@mariozechner/pi-tui` (terminal UI)
- **Core**: `@mariozechner/pi-agent-core` (stateful agent loop)
- **Applications**: `@mariozechner/pi-coding-agent` (CLI tool), plus Slack bot, web UI, GPU pod manager

The philosophy is radical minimalism: 4 tools (read/write/edit/bash), <1000 token system prompt, no sub-agents, no MCP. "Adapt pi to your workflows, not the other way around."

Unlike Claude/Codex/OpenCode which are opinionated CLI-first tools with SDK wrappers, Pi provides a composable library architecture where the LLM client and agent loop are separate, embeddable packages with no subprocess or server dependencies.

## Installation

```bash
npm install @mariozechner/pi-ai @mariozechner/pi-agent-core
```

**Requires**: Node.js >= 20

## Architecture: Two Composable Packages

Pi splits the problem into two independent layers:

```
┌─────────────────────────┐
│  Your App (Animus)      │
│                         │
│  ┌───────────────────┐  │
│  │ pi-agent-core     │  │   Stateful agent loop, tool execution,
│  │ (Agent class)     │  │   steering, follow-ups, events
│  │                   │  │
│  │  ┌─────────────┐  │  │
│  │  │ pi-ai       │  │  │   Multi-provider LLM streaming,
│  │  │ (stream/    │  │  │   cost tracking, context handoffs
│  │  │  complete)  │  │  │
│  │  └─────────────┘  │  │
│  └───────────────────┘  │
└─────────────────────────┘
```

**Key difference from other SDKs**: No subprocess, no server process, no CLI binary. Both packages are pure TypeScript libraries that run in-process. This gives Animus direct control over the agent lifecycle without IPC or process management overhead.

## `@mariozechner/pi-ai` — The LLM Abstraction Layer

### Multi-Provider Coverage

Pi-ai normalizes around 4 wire protocols to cover 20+ providers via 9 API backends:

| API Backend | Providers Covered | SDK Used |
|---|---|---|
| `anthropic-messages` | Anthropic, GitHub Copilot (Claude) | `@anthropic-ai/sdk` |
| `openai-responses` | OpenAI Responses API, Copilot (GPT) | `openai` v6.10.0 |
| `openai-completions` | OpenAI, xAI, Groq, Cerebras, Mistral, OpenRouter, Ollama, vLLM, LM Studio, HuggingFace, etc. | `openai` |
| `openai-codex-responses` | OpenAI Codex | Custom SSE/WebSocket |
| `azure-openai-responses` | Azure OpenAI | `openai` (Azure variant) |
| `bedrock-converse-stream` | Amazon Bedrock | `@aws-sdk/client-bedrock-runtime` |
| `google-generative-ai` | Google Gemini | `@google/genai` |
| `google-vertex` | Google Vertex AI | `@google/genai` (Vertex mode) |
| `google-gemini-cli` | Cloud Code Assist, Antigravity | Custom SSE |

### Core API Surface

```typescript
// Model discovery
getModel(provider, modelName)
getProviders()
getModels(provider)
calculateCost(usage)

// Streaming (returns AssistantMessageEventStream)
stream(model, context, options?)
streamSimple(model, context, options?)

// Non-streaming (returns Promise<AssistantMessage>)
complete(model, context, options?)
completeSimple(model, context, options?)

// Context is a plain object:
interface Context {
  systemPrompt?: string;
  messages: Message[];
  tools?: Tool[];
}
```

### Streaming Events

Pi-ai provides 12 granular streaming event types, all carrying a `partial` field with the accumulating `AssistantMessage`:

| Event Type | Description |
|---|---|
| `text_start` | Text block begins |
| `text_delta` | Incremental text content |
| `text_end` | Text block complete |
| `thinking_start` | Reasoning block begins |
| `thinking_delta` | Incremental reasoning content |
| `thinking_end` | Reasoning block complete |
| `toolcall_start` | Tool call begins (name, ID) |
| `toolcall_delta` | Incremental tool call arguments |
| `toolcall_end` | Tool call complete with parsed args |
| `done` | Stream finished |
| `error` | Stream error |

The `AssistantMessageEventStream` is a push-pull async iterable with a built-in result promise, providing clean completion semantics.

### Key Features of pi-ai

1. **Cross-provider context handoffs** -- Switch models mid-conversation. Handles thinking block signatures, tool call ID normalization (Anthropic max 64 chars alphanumeric, Mistral exactly 9, OpenAI 450+), orphaned tool call cleanup
2. **TypeBox + AJV tool definitions** with partial JSON streaming via `partial-json` library
3. **5-level reasoning normalization** (minimal/low/medium/high/xhigh) mapped per-provider (Anthropic adaptive vs budget, OpenAI effort, Google thinkingLevel vs thinkingBudget)
4. **Auto-generated model catalog** -- 300+ models with pricing from models.dev/OpenRouter/Vercel
5. **Cost & token tracking** on every response -- per-category breakdown (input/output/cacheRead/cacheWrite + costs)
6. **Context overflow detection** -- 13+ regex patterns for provider-specific errors + silent overflow detection
7. **Prompt caching** -- 3 retention levels (none/short/long)
8. **OAuth** for 5 providers (Anthropic, Copilot, Google, Antigravity, Codex)
9. **Abort support** throughout via AbortSignal
10. **Image/vision support** -- base64 encoding with capability-aware filtering

### What pi-ai Does NOT Have

- No MCP -- zero references in entire repo
- No context compaction -- detects overflow but does not manage the window
- No agent loop -- streams tool calls to the caller, the caller executes them
- No pre-request token counting -- counts come post-hoc from API responses
- No structured output / JSON mode
- No Zod -- TypeBox only for tool schemas
- No middleware/interceptor pattern

### Dependencies

Runtime: `@anthropic-ai/sdk`, `openai`, `@google/genai`, `@aws-sdk/client-bedrock-runtime`, `@mistralai/mistralai`, `@sinclair/typebox`, `ajv`, `partial-json`, `proxy-agent`, `undici`, `zod-to-json-schema`

## `@mariozechner/pi-agent-core` — The Agent Framework

A deliberately minimal stateful agent framework in 5 source files. Single dependency: `pi-ai`.

### Architecture

**Two-layer message model**: Internal `AgentMessage[]` (can include custom types) converted to `Message[]` at the LLM boundary via `convertToLlm()`. Custom messages carry app metadata without polluting LLM context.

**Nested loop**: Outer loop handles follow-up messages, inner loop handles streaming + tool execution + steering interrupts.

### The Agent Class

```typescript
const agent = new Agent({
  initialState: { systemPrompt, model, thinkingLevel, tools, messages },
  convertToLlm: (messages) => messages.filter(...),  // required
  transformContext: async (messages, signal) => reshapedMessages, // optional
  getApiKey: async (provider) => refreshToken(),  // optional
  steeringMode: "one-at-a-time",  // or "all"
  followUpMode: "one-at-a-time",
  streamFn: customStream,  // optional
  sessionId: "session-123",
  thinkingBudgets: { minimal: 128, low: 512, medium: 1024, high: 2048 },
});
```

### Key Features of pi-agent-core

1. **Stateful Agent class** with system prompt, model, tools, messages, streaming state
2. **Sequential tool execution** with streaming progress callbacks via `update` callback
3. **Steering messages** -- `agent.steer(message)` interrupts mid-execution, skips remaining tools, injects new context
4. **Follow-up messages** -- `agent.followUp(message)` queued for post-completion processing
5. **10 event types** across 4 scopes (agent, turn, message, tool):

| Event | Scope | Description |
|---|---|---|
| `agent_start` | Agent | Agent begins processing |
| `agent_end` | Agent | Agent finishes all work |
| `turn_start` | Turn | New LLM turn begins |
| `turn_end` | Turn | LLM turn completes |
| `message_start` | Message | LLM message streaming begins |
| `message_update` | Message | Incremental streaming content |
| `message_end` | Message | LLM message streaming complete |
| `tool_execution_start` | Tool | Tool begins executing |
| `tool_execution_update` | Tool | Tool progress update |
| `tool_execution_end` | Tool | Tool execution complete |

6. **Custom message types** via TypeScript declaration merging -- extend `CustomAgentMessages` interface
7. **`transformContext` hook** -- async function called before every LLM call, receives full context (system prompt + messages + tools + thinking level), can reshape everything
8. **Proxy mode** for browser-to-backend routing via SSE
9. **Dynamic API key resolution** for expiring tokens
10. **Runtime model switching** across any provider via `setModel()`
11. **Abort/cancellation** via AbortController
12. **Custom `convertToLlm`** bridges custom message types to LLM format at the boundary

### What pi-agent-core Does NOT Have

- No MCP support -- deliberately rejected ("no MCP support" in coding-agent README)
- No sub-agents / orchestration -- each Agent is independent, no hierarchy
- No built-in context compaction (just the transformContext hook)
- No persistence / memory -- in-memory only (Context is JSON-serializable)
- No structured output -- no JSON mode or response schema enforcement
- No retry logic at agent level
- No hooks / middleware / plugins (beyond transformContext)
- No permission system
- No parallel tool execution -- always sequential

### The transformContext Hook (Critical for Animus)

```typescript
transformContext?: (context: AgentContext) => AgentContext | Promise<AgentContext>;

interface AgentContext {
  systemPrompt: string;
  model: Model;
  messages: Message[];
  tools: AgentTool[];
  thinkingLevel: ThinkingLevel;
}
```

Called before EVERY LLM call. This enables:
- Re-compile system prompt every tick (not just on cold starts)
- Prune stale messages from prior ticks
- Inject fresh memory/emotional state into context
- Apply dynamic token budgets
- Context summarization/compaction

This is fundamentally different from other SDKs where the system prompt is set once at session creation. For Animus, this means the heartbeat can dynamically reshape the mind's context on every call without session teardown.

## Authentication

### API Key Authentication

Pi-ai uses standard provider API keys. Each provider expects its own environment variable or programmatic key:

```bash
export ANTHROPIC_API_KEY=your-key
export OPENAI_API_KEY=your-key
export GOOGLE_API_KEY=your-key
```

### Dynamic Key Resolution

The Agent class supports async API key resolution via `getApiKey`:

```typescript
const agent = new Agent({
  getApiKey: async (provider) => {
    // Fetch from vault, refresh token, etc.
    return getKeyFromVault(provider);
  },
  // ...
});
```

**For Animus**: This maps cleanly to our credential system. The adapter can resolve keys from the encrypted credential store at runtime, and handle token refresh for OAuth providers transparently.

### OAuth Support

Pi-ai provides OAuth flows for 5 providers:
- Anthropic
- GitHub Copilot
- Google
- Antigravity
- OpenAI Codex

## Session Management

Pi does not have built-in session persistence. The Agent class maintains state in-memory, and the Context object is JSON-serializable for external persistence.

### Creating an Agent Session

```typescript
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";

const model = getModel("anthropic", "claude-sonnet-4-20250514");

const agent = new Agent({
  initialState: {
    systemPrompt: "You are a helpful assistant.",
    model,
    thinkingLevel: "medium",
    tools: myTools,
    messages: [],
  },
  convertToLlm: (messages) => messages,
});
```

### Resuming Sessions

Since context is JSON-serializable, sessions can be resumed by replaying state:

```typescript
// Save
const savedState = JSON.stringify(agent.state);

// Restore
const restoredAgent = new Agent({
  initialState: JSON.parse(savedState),
  convertToLlm: (messages) => messages,
});
```

**For Animus**: The adapter must handle persistence externally. The heartbeat system already persists agent state to SQLite, so this maps naturally to our crash recovery pipeline.

## Streaming

### Direct pi-ai Streaming

```typescript
import { stream } from "@mariozechner/pi-ai";

const eventStream = stream(model, {
  systemPrompt: "...",
  messages: [...],
  tools: [...],
});

for await (const event of eventStream) {
  switch (event.type) {
    case "text_delta":
      process.stdout.write(event.delta);
      break;
    case "toolcall_end":
      console.log("Tool:", event.name, event.args);
      break;
    case "done":
      console.log("Usage:", event.partial.usage);
      break;
  }
}

// Or await the final result directly:
const result = await eventStream.result;
```

### Agent-Level Streaming

```typescript
const result = await agent.run(userMessage, {
  update: (event) => {
    switch (event.type) {
      case "message_update":
        // Streaming LLM content
        break;
      case "tool_execution_update":
        // Tool progress
        break;
    }
  },
  signal: abortController.signal,
});
```

## Tool System

### Tool Definitions (TypeBox)

Pi uses TypeBox (not Zod) for tool schema definitions:

```typescript
import { Type } from "@sinclair/typebox";

const readTool = {
  name: "read",
  description: "Read a file",
  parameters: Type.Object({
    path: Type.String({ description: "File path to read" }),
  }),
  execute: async (args: { path: string }, update: (msg: string) => void) => {
    const content = await fs.readFile(args.path, "utf-8");
    return content;
  },
};
```

**For Animus**: Our MCP tools use Zod schemas. The adapter must convert Zod schemas to TypeBox at the boundary. Pi-ai already depends on `zod-to-json-schema`, so conversion through JSON Schema is a viable path: Zod -> JSON Schema -> TypeBox.

### Built-in Tools (pi-coding-agent)

The coding agent ships with 4 tools:

| Tool | Description |
|------|-------------|
| `read` | Read files |
| `write` | Write/create files |
| `edit` | Edit existing files |
| `bash` | Run shell commands |

**Note**: These tools belong to `pi-coding-agent`, not `pi-agent-core`. The agent framework itself is tool-agnostic -- you bring your own tools.

### Sequential Execution

Pi executes tools sequentially (never in parallel). When the LLM requests multiple tool calls in a single message, they run one at a time with progress callbacks between each.

## Steering and Follow-Up Messages

### Steering (Mid-Execution Interrupt)

```typescript
// While agent is running, inject a steering message:
agent.steer({
  role: "user",
  content: "Stop what you're doing and focus on the auth bug instead.",
});
```

Steering interrupts the current execution:
- Skips remaining tool calls in the current turn
- Injects the steering message into context
- Triggers a new LLM turn with the updated context

**For Animus**: This maps to our `update_agent` decision type. When the mind wants to redirect a running sub-agent, the adapter calls `agent.steer()`.

### Follow-Up Messages

```typescript
// Queue a message for after the current execution completes:
agent.followUp({
  role: "user",
  content: "Now run the tests to verify your changes.",
});
```

Follow-ups are queued and processed after the current agent run completes, triggering additional turns.

## Cost & Token Tracking

Pi-ai provides detailed per-category cost tracking on every response:

```typescript
interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

interface AssistantMessage {
  content: ContentPart[];
  usage: Usage;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  model: Model;
  stopReason: string;
}
```

**For Animus**: Cost tracking is first-class in Pi, more granular than Claude or Codex. The adapter can log per-category costs directly to `agent_logs.db`.

## Reasoning / Thinking Support

Pi normalizes reasoning across providers with 5 levels:

| Pi Level | Anthropic | OpenAI | Google |
|---|---|---|---|
| `minimal` | Budget (minimal tokens) | `low` effort | `none` thinkingLevel |
| `low` | Budget (low tokens) | `low` effort | `low` thinkingBudget |
| `medium` | Adaptive (medium) | `medium` effort | `medium` thinkingBudget |
| `high` | Adaptive (high) | `high` effort | `high` thinkingBudget |
| `xhigh` | Adaptive (max) | `high` effort | Max thinkingBudget |

Thinking budgets are configurable per-level:

```typescript
const agent = new Agent({
  thinkingBudgets: {
    minimal: 128,
    low: 512,
    medium: 1024,
    high: 2048,
  },
  // ...
});
```

## Cross-Provider Context Handoffs

A unique feature of Pi: switch providers mid-conversation without losing context.

```typescript
// Start with Claude
agent.state.model = getModel("anthropic", "claude-sonnet-4-20250514");
await agent.run("Analyze this codebase");

// Switch to GPT for a different task
agent.state.model = getModel("openai", "gpt-4o");
await agent.run("Now write tests for what you found");
```

Pi handles the hard problems behind the scenes:
- **Thinking block signatures**: Strips/normalizes provider-specific thinking markers
- **Tool call ID formats**: Anthropic (max 64 chars, alphanumeric), Mistral (exactly 9 chars), OpenAI (450+ chars) -- all normalized
- **Orphaned tool calls**: Cleans up tool calls with missing results when switching providers
- **Errored messages**: Strips provider-specific error formatting

**For Animus**: This enables the mind to use different models for different ticks without session teardown. The heartbeat could use a fast model for idle ticks and a powerful model for message-triggered ticks.

## Unified Permission Model Mapping

Pi has no built-in permission system. All permission control must be implemented in the tool execution layer.

| Unified Config | Pi Adapter Implementation |
|---|---|
| `executionMode: 'plan'` | Filter tools to read-only set (remove write/edit/bash) |
| `executionMode: 'build'` + `approvalLevel: 'strict'` | Wrap all tool `execute` functions with approval callback |
| `executionMode: 'build'` + `approvalLevel: 'normal'` | Wrap modification tools with approval callback |
| `executionMode: 'build'` + `approvalLevel: 'trusted'` | No wrapping, all tools auto-approved |
| `executionMode: 'build'` + `approvalLevel: 'none'` | No wrapping, all tools auto-approved |
| `toolPermissions: { bash: 'deny' }` | Remove tool from tools array before passing to Agent |

**Note**: Since Pi has no native permission system, the adapter must implement permissions entirely at the tool-wrapping layer. This is more work than Claude/Codex/OpenCode but gives full control.

## Unified Hook Model Mapping

Pi has **minimal hook support** -- only the `update` callback during `agent.run()`:

| Unified Hook | Pi Support | How It Works |
|---|---|---|
| `onPreToolUse` | ⚠️ Emit only | Listen to `tool_execution_start` event, **cannot block or modify** |
| `onPostToolUse` | ✅ Full | Listen to `tool_execution_end` event |
| `onToolError` | ⚠️ Partial | Errors surface in tool execution results |
| `onSessionStart` | ✅ Full | Listen to `agent_start` event |
| `onSessionEnd` | ✅ Full | Listen to `agent_end` event |
| `onSubagentStart` | N/A | Pi has no sub-agent system |
| `onSubagentEnd` | N/A | Pi has no sub-agent system |

**Blocking**: Pi does NOT support blocking tool execution via hooks. To block tools, the adapter must wrap the tool's `execute` function with a permission check that throws before execution. This is a workaround but achieves the same result.

**Implementation**: The adapter wraps each tool's `execute` function:

```typescript
function wrapToolWithHooks(tool, hooks) {
  const originalExecute = tool.execute;
  return {
    ...tool,
    execute: async (args, update) => {
      // Pre-tool hook (can block by throwing)
      const decision = await hooks.onPreToolUse?.(tool.name, args);
      if (decision?.allow === false) {
        throw new Error(`Tool ${tool.name} blocked by permission hook`);
      }
      // Execute
      const result = await originalExecute(args, update);
      // Post-tool hook
      await hooks.onPostToolUse?.(tool.name, args, result);
      return result;
    },
  };
}
```

## Comparison to Existing Animus SDKs

| Capability | Claude Agent SDK | Codex SDK | OpenCode SDK | Pi (ai + agent) |
|---|---|---|---|---|
| Architecture | Subprocess (CLI) | Subprocess (CLI) | Client/Server | In-process library |
| Provider support | Anthropic only | OpenAI only | 75+ (AI SDK) | 20+ (9 API backends) |
| Entry point | `query()` | `startThread()` | `client.session.prompt()` | `new Agent()` + `agent.run()` |
| MCP support | Native | Config-based | Config-based | None |
| Sub-agents | Built-in (Task tool) | None (needs Agents SDK) | @mentions | None |
| Context compaction | Built-in | Built-in | Auto (configurable) | Hook only (transformContext) |
| Streaming | Async generator | Events iterator | SSE subscription | Async iterable + result promise |
| Tool schemas | Zod | JSON Schema | Zod | TypeBox |
| Structured output | Yes | Yes (outputSchema) | No | No |
| Token pre-counting | Yes | Unknown | Unknown | No (post-hoc only) |
| Cost tracking | Basic (result message) | Basic (turn.completed) | Basic | Excellent (per-category breakdown) |
| Cross-provider handoff | N/A | N/A | N/A | Yes (automatic normalization) |
| Cancel/abort | AbortController | Not supported | session.abort() | AbortController |
| Session resume | resume: sessionId | resumeThread(id) | Server-side | Via context replay (manual) |
| Thinking/reasoning | Native | Via config | Via config | Normalized 5-level |
| Context transformation | No (system prompt set once) | No | No | Yes (transformContext hook) |
| Mid-execution steering | Via injectMessage (stdin) | No | No | Yes (steer/followUp) |
| Runtime model switching | No | No | No | Yes (setModel, cross-provider) |
| Pre-execution hook blocking | Yes (PreToolUse) | No | Can throw to block | Via tool wrapping (adapter) |
| Permission system | Native (4 modes) | Native (sandbox + approval) | Native (per-tool) | None (adapter implements) |

## Design Quality Assessment

### Strengths

1. **Cross-provider message portability** -- The transform-messages.ts module handles thinking block signatures, tool call ID normalization, orphaned call cleanup, errored message stripping across providers. Production-hardened with edge cases covered.
2. **Cost tracking as first-class** -- Every `AssistantMessage` includes detailed per-category cost breakdown computed from model pricing. More granular than any other SDK.
3. **Reasoning normalization** -- 5-level abstraction hides Anthropic adaptive/budget, OpenAI effort, Google thinkingLevel differences behind a single enum.
4. **EventStream design** -- Push-pull async iterable with built-in result promise. Clean completion semantics without callback hell.
5. **Minimal agent footprint** -- 5 files, 1 dependency. Embeddable in any TypeScript project without process management overhead.
6. **transformContext** -- Genuinely powerful hook for context lifecycle management. No other SDK offers this level of dynamic context control.
7. **In-process execution** -- No subprocess spawning, no server management, no IPC. Direct library calls with full stack trace visibility.
8. **Model switching** -- Cross-provider model switching mid-conversation is unique and enables cost/quality optimization per-task.

### Weaknesses

1. **Global mutable provider registry** -- Singleton pattern for provider configuration. Cannot have two different configurations for the same provider in one process. Acceptable for single-user Animus.
2. **Sequential tool execution** -- No parallel tool execution. Slower for multi-tool turns but guarantees correctness.
3. **TypeBox not Zod** -- Animus uses Zod throughout. Requires schema conversion at the adapter boundary.
4. **No pre-request token counting** -- Context budget enforcement requires heuristics or external counting.
5. **Limited error typing** -- Plain Error objects, no error taxonomy or structured error data. The adapter must implement its own error classification.
6. **No persistence** -- Context must be externally persisted. Not a problem for Animus (we have SQLite), but adds adapter complexity.
7. **No MCP** -- Deliberate design choice. Animus MCP tools must be converted to Pi tool format at the adapter boundary.
8. **No permission system** -- All permission logic falls on the adapter. More implementation work than other SDKs.

## Key Concerns for Abstraction Layer

1. **In-process library** -- Different from all other adapters (no subprocess or server). Simpler lifecycle management but must handle pi-ai's global state carefully.
2. **TypeBox/Zod conversion** -- MCP tools use Zod schemas. Must convert at adapter boundary via JSON Schema intermediate format.
3. **No MCP** -- Our MCP tools must be wrapped as Pi-native tools. The adapter registers each MCP tool as a Pi tool with a wrapper `execute` function that calls the MCP handler.
4. **No built-in permissions** -- Adapter must implement permission checks via tool wrapping (filter tools for plan mode, wrap execute for approval mode).
5. **transformContext is the primary extension point** -- Context builder integration, memory injection, emotional state, and token budgets all flow through this hook.
6. **No sub-agents** -- Animus uses custom orchestration anyway, so this is not a limitation. Each sub-agent is an independent Agent instance managed by our orchestration layer.
7. **Sequential tool execution** -- Cannot be changed. Acceptable since Animus does not require parallel tool execution.
8. **Steering maps to update_agent** -- The mind's `update_agent` decision can call `agent.steer()` to redirect running sub-agents mid-execution.
9. **Session persistence is manual** -- The adapter must serialize/deserialize Agent state to SQLite for crash recovery.
10. **Cost tracking advantage** -- Pi's granular cost data can feed directly into `agent_logs.db` with more detail than other adapters provide.

## References

- [GitHub: pi-mono](https://github.com/badlogic/pi-mono)
- [pi-ai source](https://github.com/badlogic/pi-mono/tree/main/packages/ai)
- [pi-agent-core source](https://github.com/badlogic/pi-mono/tree/main/packages/agent)
- [npm: @mariozechner/pi-ai](https://www.npmjs.com/package/@mariozechner/pi-ai)
- [npm: @mariozechner/pi-agent-core](https://www.npmjs.com/package/@mariozechner/pi-agent-core)
- [Author blog post: pi coding agent](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/)
- [Armin Ronacher on Pi](https://lucumr.pocoo.org/2026/1/31/pi/)
