# Agent Abstraction Layer Architecture

## Executive Summary

This document outlines the architectural approach for building a unified abstraction layer over three agent SDKs:
- **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`)
- **OpenAI Codex SDK** (`@openai/codex-sdk`)
- **OpenCode SDK** (`@opencode-ai/sdk`)

## SDK Comparison Matrix

| Feature | Claude Agent SDK | Codex SDK | OpenCode SDK |
|---------|------------------|-----------|--------------|
| **Architecture** | Async generator | CLI subprocess (Rust) | Client/Server (REST) |
| **Streaming** | Yield messages | Event iterator | SSE subscription |
| **Session Model** | ID-based resume | Thread-based | Server-side sessions |
| **Entry Point** | `query()` function | `Codex.startThread()` | `client.session.prompt()` |
| **Cancel/Abort** | AbortController | ❌ Not supported | `session.abort()` |
| **Providers** | Anthropic only | OpenAI only | 75+ providers |
| **Auth: API Key** | ✅ | ✅ | ✅ (per-provider) |
| **Auth: Subscription** | ✅ Via OAuth token | ✅ OAuth supported | N/A |
| **Hooks/Lifecycle** | PreToolUse, PostToolUse, etc. | Approval policies | Plugin hooks |
| **Permission Modes** | default/acceptEdits/bypass/plan | untrusted/on-failure/on-request/never | Tool-level permissions |
| **Built-in Tools** | Read, Write, Edit, Bash, etc. | Similar | read, write, edit, bash, etc. |
| **MCP Support** | ✅ Native | ✅ stdio-based | ✅ Via config |
| **Subagents** | ✅ Via Task tool | ⚠️ Via MCP + Agents SDK | ✅ Via @mentions |
| **Token Tracking** | ✅ In result message | ✅ In turn.completed | ✅ Via API |
| **Cost Tracking** | ✅ total_cost_usd | ❌ Must calculate | ❌ Must calculate |

## Critical Concerns & Gotchas

### 1. Authentication Options

**Claude Agent SDK**: Supports both API keys and subscription auth. The SDK spawns Claude Code CLI as a subprocess, so if Claude Code is authenticated (via `CLAUDE_CODE_OAUTH_TOKEN` or pre-existing login), subscription usage works.

**Codex SDK**: Supports both API keys and ChatGPT OAuth. Users can authenticate via their subscription.

**OpenCode SDK**: Per-provider auth configuration. Each provider requires its own API key.

**Recommendation**:
- Design auth as provider-specific configuration
- Claude: API key OR subscription via `CLAUDE_CODE_OAUTH_TOKEN`
- Codex: API key OR ChatGPT OAuth
- OpenCode: Per-provider API keys

**Implementation Notes**:
- Claude subscription auth supports **long-lived tokens (1 year)** via `claude setup-token`, stored at `~/.claude/.credentials`
- Claude can also use `CLAUDE_CODE_OAUTH_TOKEN` environment variable or a pre-authenticated Claude Code installation
- Codex subscription auth uses OAuth flow or pre-authenticated CLI at `~/.codex/auth.json`
- For OpenCode, each provider (Anthropic, OpenAI, etc.) needs separate API key configuration

### 2. Fundamentally Different Streaming Models

**Claude**: Async generator that yields messages continuously
```typescript
for await (const message of query({ prompt })) { }
```

**Codex**: Event iterator from `runStreamed()`
```typescript
for await (const event of events) { }
```

**OpenCode**: SSE subscription separate from prompts
```typescript
const stream = await client.event.subscribe();
for await (const event of stream) { }
```

**Recommendation**: Define a unified event emitter interface:
```typescript
interface IAgentSession {
  onEvent(handler: (event: AgentEvent) => void): void;
  prompt(input: string): Promise<AgentResponse>;
}
```

Adapters translate native events to our normalized `AgentEvent` type.

### 3. Session Management Differences

| SDK | Session ID Source | Persistence | Resume |
|-----|-------------------|-------------|--------|
| Claude | `system.init` message | Optional | `resume: sessionId` |
| Codex | Thread object | ~/.codex/sessions | `resumeThread(id)` |
| OpenCode | Server response | Server-side | Session ID in API |

**Recommendation**: Abstract session lifecycle:
```typescript
interface IAgentSession {
  readonly id: string;
  readonly isActive: boolean;
  end(): Promise<void>;
}

interface IAgentAdapter {
  createSession(config): Promise<IAgentSession>;
  resumeSession(sessionId: string): Promise<IAgentSession>;
  listModels(): Promise<ModelInfo[]>;  // { id, name }
}
```

### 4. Cancellation Support

| SDK | Cancellation |
|-----|-------------|
| Claude | ✅ AbortController |
| Codex | ❌ Not supported |
| OpenCode | ✅ session.abort() |

**Concern**: Codex cannot cancel running operations. This is a [known limitation](https://github.com/openai/codex/issues/5494).

**Recommendation**:
- Interface supports `cancel()` method
- Codex adapter throws `UnsupportedOperationError` or waits for natural completion
- Document this limitation clearly

### 5. Hook/Lifecycle Event Mapping

**Claude hooks** (most comprehensive):
- PreToolUse, PostToolUse, PostToolUseFailure
- SessionStart, SessionEnd
- UserPromptSubmit
- SubagentStart, SubagentStop
- Notification, Stop

**Codex**: Uses approval policies instead of hooks

**OpenCode plugins**: Event-based hooks via plugin system

**Recommendation**: Define core lifecycle events that all adapters must emit:
```typescript
type AgentEventType =
  | 'session_start'
  | 'session_end'
  | 'input_received'
  | 'thinking_start'
  | 'thinking_end'
  | 'tool_call_start'
  | 'tool_call_end'
  | 'tool_error'
  | 'response_start'
  | 'response_chunk'
  | 'response_end';
```

Map provider-specific events to these normalized types.

### 6. Tool System Differences

**Claude**: Built-in tools + MCP servers
**Codex**: Built-in tools + MCP (stdio-based)
**OpenCode**: Built-in tools + plugins

All three have similar core tools (read, write, edit, bash, search), but different:
- Tool input/output schemas
- Error handling
- Permission models

**Recommendation**: Don't try to unify tool definitions. Instead:
- Let each provider use its native tools
- Normalize tool call events for logging
- Expose `allowedTools` configuration that maps to provider-specific names

### 7. Token Usage & Cost Tracking

| SDK | Input Tokens | Output Tokens | Cache Tokens | Cost |
|-----|--------------|---------------|--------------|------|
| Claude | ✅ | ✅ | ✅ | ✅ Direct |
| Codex | ✅ | ✅ | ❌ | ❌ Calculate |
| OpenCode | ✅ | ✅ | Varies | ❌ Calculate |

**Recommendation**:
```typescript
interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

interface AgentCost {
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
}
```

Adapters calculate costs based on known pricing when not provided directly.

### 8. Error Handling Patterns

Each SDK has different error types and retry semantics:

**Claude**: Errors in result message, `subtype: 'error_*'`
**Codex**: `turn.failed` events
**OpenCode**: HTTP errors, session errors

**Recommendation**:
```typescript
interface AgentError {
  code: string;
  message: string;
  recoverable: boolean;
  provider: AgentProvider;
  originalError?: unknown;
}
```

## Event Normalization Mapping

Complete mapping from SDK-specific events to unified `AgentEventType`:

| Unified Event | Claude SDK | Codex SDK | OpenCode SDK |
|---------------|------------|-----------|--------------|
| `session_start` | `system` message (subtype: init) | `thread.started` event | `session.created` event |
| `session_end` | `result` message | `turn.completed` or `turn.failed` | `session.idle` or `session.error` |
| `input_received` | `user` message | `turn.started` event | (implicit with prompt call) |
| `thinking_start` | `content_block_start` (type: thinking) | `item/reasoning/delta` (first) | `message.part.updated` (type: reasoning) |
| `thinking_end` | `content_block_stop` (thinking block) | `item/reasoning/delta` (complete) | `message.part.updated` (reasoning complete) |
| `tool_call_start` | `content_block_start` (type: tool_use) | `item.started` (command/tool) | `tool.execute.before` event |
| `tool_call_end` | `content_block_stop` + tool result | `item.completed` | `tool.execute.after` event |
| `tool_error` | `PostToolUseFailure` hook | `item.completed` (with error) | `tool.execute.after` (with error) |
| `response_start` | `message_start` or `content_block_start` (text) | `item.started` (agentMessage) | `message.updated` (first) |
| `response_chunk` | `content_block_delta` (text_delta) | `item/agentMessage/delta` | `message.part.updated` (type: text) |
| `response_end` | `message_stop` or `assistant` message | `turn.completed` | `session.idle` |

**Notes:**
- Claude requires `includePartialMessages: true` for streaming events
- Claude requires `maxThinkingTokens` option for thinking events
- Codex thinking comes via `item/reasoning/delta` events
- OpenCode SSE subscription must be active before prompt

## Unified Error Type

```typescript
interface AgentError {
  code: string;                    // e.g., 'MAX_TURNS_EXCEEDED', 'EXECUTION_FAILED'
  message: string;                 // Human-readable message
  category: AgentErrorCategory;    // Classification
  severity: 'recoverable' | 'fatal' | 'retry';
  provider: AgentProvider;
  sessionId?: string;
  timestamp: string;               // ISO 8601
  details?: {
    originalError?: unknown;
    toolName?: string;
    toolInput?: unknown;
    retryAfterMs?: number;
    suggestedAction?: string;
  };
}

type AgentErrorCategory =
  | 'authentication'      // Bad key, expired token
  | 'authorization'       // Permission denied
  | 'rate_limit'          // Rate limited
  | 'execution'           // Tool/code failed
  | 'resource_exhausted'  // Max turns, budget, context
  | 'timeout'             // Operation timed out
  | 'network'             // Connection error
  | 'server_error'        // 5xx errors
  | 'not_found'           // Resource missing
  | 'invalid_input'       // Bad input
  | 'unsupported'         // Feature not supported
  | 'cancelled'           // User cancelled
  | 'unknown';
```

**Error Mapping by Provider:**

| Scenario | Claude | Codex | OpenCode |
|----------|--------|-------|----------|
| Max turns | `error_max_turns` → resource_exhausted | N/A | N/A |
| Budget exceeded | `error_max_budget_usd` → resource_exhausted | N/A | N/A |
| Execution failed | `error_during_execution` → execution | `turn.failed` → execution | `session.error` → execution |
| Auth failed | Native error → authentication | Native error → authentication | HTTP 401 → authentication |
| Rate limited | Native error → rate_limit | `turn.failed` → rate_limit | HTTP 429 → rate_limit |
| Cancel unsupported | N/A | Always → unsupported | N/A |

## Proposed Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Animus Heartbeat                        │
│              (Uses @animus/agents unified API)               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    @animus/agents                            │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              AgentManager (Factory)                     ││
│  │  - getAdapter(provider): IAgentAdapter                  ││
│  │  - isConfigured(provider): boolean                      ││
│  └─────────────────────────────────────────────────────────┘│
│                              │                               │
│  ┌──────────────┬────────────┴─────────────┬──────────────┐ │
│  ▼              ▼                          ▼              │ │
│ ┌────────────┐ ┌────────────────┐ ┌─────────────────────┐ │ │
│ │  Claude    │ │     Codex      │ │      OpenCode       │ │ │
│ │  Adapter   │ │    Adapter     │ │      Adapter        │ │ │
│ │            │ │                │ │                     │ │ │
│ │ Uses SDK   │ │ Uses SDK or    │ │ Uses SDK client     │ │ │
│ │ directly   │ │ CLI passthrough│ │ to server           │ │ │
│ └────────────┘ └────────────────┘ └─────────────────────┘ │ │
└─────────────────────────────────────────────────────────────┘
         │                  │                    │
         ▼                  ▼                    ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐
│ Claude SDK   │  │  Codex SDK   │  │   OpenCode Server    │
│              │  │  + CLI       │  │                      │
└──────────────┘  └──────────────┘  └──────────────────────┘
```

## Interface Definitions

Based on research, our existing types in `/packages/agents/src/types.ts` are largely correct. Key additions:

### Authentication Configuration

```typescript
interface AuthConfig {
  provider: AgentProvider;
  type: 'api_key' | 'oauth' | 'subscription';
  apiKey?: string;
  // For Codex OAuth
  oauthToken?: string;
  // For OpenCode multi-provider
  providerAuth?: Record<string, { apiKey: string }>;
}
```

### Enhanced Session Configuration

```typescript
interface AgentSessionConfig {
  provider: AgentProvider;
  model?: string;
  systemPrompt?: string;
  cwd?: string;
  allowedTools?: string[];
  maxTokens?: number;
  timeoutMs?: number;

  // New additions from research
  permissionMode?: 'default' | 'acceptEdits' | 'bypass' | 'plan';
  resumeSessionId?: string;
  enableStreaming?: boolean;
}
```

## Implementation Phases

### Phase 1: Core Interfaces & Claude Adapter
1. Finalize interface definitions
2. Implement Claude adapter (best-documented SDK)
3. Build comprehensive test suite
4. Verify all event types emit correctly

### Phase 2: Codex Adapter
1. Implement thread-based session management
2. Map Codex events to normalized events
3. Handle no-cancel limitation
4. Test OAuth flow if pursuing subscription auth

### Phase 3: OpenCode Adapter
1. Implement client/server connection
2. SSE subscription to event stream
3. Multi-provider auth configuration
4. Test with multiple underlying providers

### Phase 4: Testing & Documentation
1. Integration tests across all adapters
2. Performance benchmarks
3. Documentation for each provider's quirks
4. Example usage patterns

## Testing Strategy

Each adapter needs tests for:

1. **Connection/Auth**: Valid credentials, invalid credentials, missing credentials
2. **Session Lifecycle**: Create, resume, end, cancel
3. **Streaming**: Event emission order, content accumulation
4. **Tool Calls**: Start/end events, error handling
5. **Token Tracking**: Usage accumulation, cost calculation
6. **Error Handling**: Network errors, API errors, timeouts

Mock the underlying SDKs for unit tests; use real SDKs (with test API keys) for integration tests.

## Design Decisions

### 1. OpenCode Server Management
**Decision: Auto-start the server.**

Use `createOpencode()` to automatically start the OpenCode server when creating a session. The adapter should handle:
- Server startup with configurable timeout
- Health checks before proceeding
- Graceful shutdown when session ends
- Port conflict detection and resolution

### 2. Codex Authentication
**Decision: No special handling needed.**

The Codex SDK spawns the CLI as a subprocess, and the CLI automatically discovers credentials from `~/.codex/auth.json`. If the user has already authenticated via `codex` CLI (ChatGPT OAuth), the SDK uses those credentials automatically. No configuration required.

Prerequisites to document for users:
- Run `codex` CLI once to authenticate (opens browser for OAuth)
- Or set `OPENAI_API_KEY` environment variable for API key auth
- OAuth takes precedence if both are available

### 3. MCP Tool Passthrough
**Decision: Expose MCP configuration.**

Users should be able to expand agent capabilities in any direction by adding custom MCP servers. The abstraction layer should:
- Accept MCP server configuration in session options
- Pass through to underlying SDK unchanged
- Support both built-in Animus MCP tools and user-defined servers
- Allow runtime MCP server addition where supported

```typescript
interface AgentSessionConfig {
  // ... other options
  mcpServers?: Record<string, McpServerConfig>;
}
```

### 4. Subagent Support
**Decision: Unified API with graceful fallback.**

Provide a unified subagent API, but gracefully handle providers that don't support native subagents:
- **Claude**: Use native Task tool for subagents
- **OpenCode**: Use native @mentions for subagents
- **Codex**: Return error/warning that subagents aren't supported natively

The adapter should:
- Emit subagent events where supported
- Return clear error messages for unsupported operations
- Not show phantom event logs for non-existent subagent activity

### 5. Context Window Management
**Decision: Expose usage metrics, let SDKs handle compaction.**

All three SDKs handle context window auto-compaction internally. We should NOT try to manage this ourselves. Instead:
- Expose total context window size for current model
- Expose tokens used so far
- Let users monitor remaining capacity
- Trust SDK auto-compaction behavior

```typescript
interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextWindowSize: number;      // Total capacity
  contextWindowUsed: number;      // Current usage
  contextWindowRemaining: number; // Calculated
  // ... cost fields
}
```

### 6. Codex Cancel/Abort Limitation
**Decision: No-op with warning.**

Codex SDK does not support cancel/abort operations. When `session.cancel()` is called on a Codex session:
- Log a warning that cancel is not supported for this provider
- Do not return anything / no-op
- Let the operation complete naturally in the background
- Document this limitation clearly for consumers

### 7. Unified Permission Model
**Decision: Two-tier permission model with tool overrides.**

Based on research into all three SDKs, we'll use a unified model:

```typescript
interface PermissionConfig {
  // Tier 1: Execution Mode (what CAN execute)
  executionMode: 'plan' | 'build';

  // Tier 2: Approval Level (when to ask user)
  approvalLevel: 'strict' | 'normal' | 'trusted' | 'none';

  // Tier 3: Tool-specific overrides
  toolPermissions?: Record<string, 'allow' | 'ask' | 'deny'>;
}
```

**Execution Modes:**
| Mode | Description | Blocked Tools |
|------|-------------|---------------|
| `plan` | Read-only analysis | Write, Edit, Bash, patch |
| `build` | Full development | None (subject to approval) |

**Approval Levels:**
| Level | Description | Auto-Approved | Requires Approval |
|-------|-------------|---------------|-------------------|
| `strict` | Maximum safety | Read-only tools | All modifications |
| `normal` | Balanced (default) | Read + safe operations | Writes, bash, edits |
| `trusted` | Auto-approve edits | Read + write + edit + bash | Nothing |
| `none` | No prompts (CI/CD) | Everything | Nothing |

**Mapping to SDKs:**

| Unified | Claude | Codex | OpenCode |
|---------|--------|-------|----------|
| plan | `permissionMode: 'plan'` | `sandbox: 'read-only'` | `mode: 'plan'` |
| build + strict | `permissionMode: 'default'` | `approval: 'untrusted'` | tools: `ask` |
| build + normal | `permissionMode: 'default'` | `approval: 'on-request'` | tools: `ask` |
| build + trusted | `permissionMode: 'acceptEdits'` | `approval: 'on-failure'` | tools: `allow` |
| build + none | `permissionMode: 'bypassPermissions'` | `approval: 'never'` | tools: `allow` |

### 8. Unified Hook System
**Decision: Event emitter pattern with graceful degradation.**

Based on research, hook capabilities vary significantly:

| Capability | Claude | Codex | OpenCode |
|------------|--------|-------|----------|
| Pre-execution hooks | ✅ Can block/modify | ❌ Not available | ✅ Cannot block |
| Post-execution hooks | ✅ Full | ✅ Via events | ✅ Full |
| Session lifecycle | ✅ Full | ✅ Via events | ✅ Full |
| Subagent hooks | ✅ Full | ❌ No subagents | ✅ Full |

**Unified Hook Interface:**

```typescript
interface UnifiedHooks {
  // Pre-execution (Claude only can block/modify)
  onPreToolUse?: (event: PreToolUseEvent) => Promise<HookResult>;

  // Post-execution (all providers)
  onPostToolUse?: (event: PostToolUseEvent) => Promise<void>;
  onToolError?: (event: ToolErrorEvent) => Promise<void>;

  // Session lifecycle (all providers)
  onSessionStart?: (event: SessionStartEvent) => Promise<void>;
  onSessionEnd?: (event: SessionEndEvent) => Promise<void>;

  // Subagent lifecycle (Claude, OpenCode only)
  onSubagentStart?: (event: SubagentStartEvent) => Promise<void>;
  onSubagentEnd?: (event: SubagentEndEvent) => Promise<void>;
}

interface HookResult {
  allow?: boolean;           // Claude only: can block
  modifiedInput?: unknown;   // Claude only: can modify
}
```

**Provider Behavior:**

| Hook | Claude | Codex | OpenCode |
|------|--------|-------|----------|
| onPreToolUse | Full (block/modify) | Emits event only | Can block (throw) + modify args |
| onPostToolUse | Full | Full (via event stream) | Full |
| onToolError | Full | Full (via event stream) | Full |
| onSessionStart | Full | Full | Full |
| onSessionEnd | Full | Full | Full |
| onSubagentStart | Full | Warning + no-op | Full |
| onSubagentEnd | Full | Warning + no-op | Full |

**Implementation Strategy:**
- Use Node.js EventEmitter pattern internally
- Claude: Pass hooks directly to SDK, emit normalized events
- Codex: Listen to event stream, emit normalized events (no blocking capability)
- OpenCode: Create plugin wrapper that translates to unified events

**Documentation Requirements:**
- Clearly document that `onPreToolUse` can only block/modify on Claude
- Clearly document that subagent hooks only work on Claude and OpenCode
- Provide `adapter.capabilities` property to query what's supported

### 9. Session ID Strategy
**Decision: Pass-through with provider prefix.**

We will NOT maintain a mapping or generate our own IDs. Instead:
- Session IDs are `{provider}:{native_id}` format
- Example: `claude:abc-123-def`, `codex:thread_xyz`, `opencode:session_456`
- For `resumeSession(id)`, parse the prefix to route to correct adapter
- Native ID is extracted and passed to SDK's resume function

```typescript
interface IAgentSession {
  readonly id: string;  // Format: "{provider}:{native_id}"
  // ...
}

// Resume logic
function resumeSession(id: string): Promise<IAgentSession> {
  const [provider, nativeId] = id.split(':');
  const adapter = getAdapter(provider);
  return adapter.resumeSession(nativeId);
}
```

**Rationale**: Avoids persistent storage, IDs are deterministic, easy to debug.

### 10. Model Registry Structure
**Decision: JSON config file with capability metadata.**

Define structure now, populate later:

```typescript
interface ModelRegistry {
  [provider: string]: {
    [modelId: string]: ModelInfo;
  };
}

interface ModelInfo {
  id: string;                    // e.g., "claude-sonnet-4-5-20250514"
  displayName: string;           // e.g., "Claude Sonnet 4.5"
  contextWindow: number;         // e.g., 200000
  maxOutputTokens: number;       // e.g., 64000
  supportsVision: boolean;
  supportsThinking: boolean;     // Extended thinking mode
  inputPricePerMToken: number;   // USD per million tokens
  outputPricePerMToken: number;
  cachePricePerMToken?: number;
  deprecated?: boolean;
  deprecationDate?: string;
}

// Example registry entry
{
  "claude": {
    "claude-sonnet-4-5-20250514": {
      "id": "claude-sonnet-4-5-20250514",
      "displayName": "Claude Sonnet 4.5",
      "contextWindow": 200000,
      "maxOutputTokens": 64000,
      "supportsVision": true,
      "supportsThinking": true,
      "inputPricePerMToken": 3.00,
      "outputPricePerMToken": 15.00,
      "cachePricePerMToken": 0.30
    }
  }
}
```

**Location**: `/packages/agents/src/models.json` (to be populated)

**Runtime discovery**: Each adapter exposes `listModels(): Promise<ModelInfo[]>` (returning `{ id, name }`). Currently returns the hardcoded `capabilities.supportedModels` list for all providers. Claude adapter also captures the actual model in use from the SDK's init message (`resolvedModel`), so session events and responses report the real model instead of "unknown" when `config.model` is not explicitly set.

### 11. Adapter Capabilities Interface
**Decision: Runtime-queryable capabilities object.**

```typescript
interface AdapterCapabilities {
  // Cancellation
  canCancel: boolean;

  // Hook capabilities
  canBlockInPreToolUse: boolean;
  canModifyToolInput: boolean;

  // Features
  supportsSubagents: boolean;
  supportsThinking: boolean;
  supportsVision: boolean;
  supportsStreaming: boolean;

  // Session management
  supportsResume: boolean;
  supportsFork: boolean;

  // Limits
  maxConcurrentSessions: number | null;  // null = unlimited

  // Model info
  supportedModels: string[];  // From registry
}

// Per-provider capabilities
const CLAUDE_CAPABILITIES: AdapterCapabilities = {
  canCancel: true,
  canBlockInPreToolUse: true,
  canModifyToolInput: true,
  supportsSubagents: true,
  supportsThinking: true,
  supportsVision: true,
  supportsStreaming: true,
  supportsResume: true,
  supportsFork: true,
  maxConcurrentSessions: null,
  supportedModels: ['claude-sonnet-4-5-20250514', 'claude-opus-4-5-20251101', ...]
};

const CODEX_CAPABILITIES: AdapterCapabilities = {
  canCancel: false,  // Critical limitation
  canBlockInPreToolUse: false,
  canModifyToolInput: false,
  supportsSubagents: false,
  supportsThinking: true,  // Via reasoning items
  supportsVision: true,
  supportsStreaming: true,
  supportsResume: true,
  supportsFork: false,
  maxConcurrentSessions: null,
  supportedModels: ['codex-mini-latest', 'gpt-5-codex', ...]
};

const OPENCODE_CAPABILITIES: AdapterCapabilities = {
  canCancel: true,
  canBlockInPreToolUse: false,
  canModifyToolInput: true,  // Via plugin
  supportsSubagents: true,   // Via @mentions
  supportsThinking: true,    // Via reasoning parts
  supportsVision: true,
  supportsStreaming: true,
  supportsResume: true,
  supportsFork: false,
  maxConcurrentSessions: null,
  supportedModels: [...]  // Dynamic based on provider config
};
```

### 12. Process Lifecycle & Cleanup
**Decision: Register cleanup handlers, document best practices.**

```typescript
class AgentManager {
  private activeSessions: Map<string, IAgentSession> = new Map();

  constructor() {
    // Register cleanup on process exit
    process.on('beforeExit', () => this.cleanup());
    process.on('SIGINT', () => this.cleanup());
    process.on('SIGTERM', () => this.cleanup());
    process.on('uncaughtException', (err) => {
      console.error('Uncaught exception, cleaning up:', err);
      this.cleanup();
      process.exit(1);
    });
  }

  private async cleanup(): Promise<void> {
    // End all active sessions gracefully
    const endPromises = Array.from(this.activeSessions.values())
      .map(session => session.end().catch(err =>
        console.warn(`Failed to end session ${session.id}:`, err)
      ));
    await Promise.allSettled(endPromises);

    // OpenCode: Server cleanup handled by createOpencode() signal
    // Claude/Codex: Subprocesses terminate with parent
  }
}
```

**OpenCode-specific**: Pass `AbortController.signal` to `createOpencode()` so server terminates when signal fires.

### 13. Timeout Handling
**Decision: Per-prompt timeout with configurable default.**

```typescript
interface AgentSessionConfig {
  // ... existing fields
  timeoutMs?: number;  // Default: 300000 (5 minutes)
}

interface PromptOptions {
  timeoutMs?: number;  // Override session default
}
```

**Implementation:**
- Use `AbortController` with `setTimeout` for Claude
- For Codex: Timeout triggers warning log only (can't cancel)
- For OpenCode: Call `session.abort()` on timeout

```typescript
async prompt(input: string, options?: PromptOptions): Promise<AgentResponse> {
  const timeout = options?.timeoutMs ?? this.config.timeoutMs ?? 300000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    return await this.executePrompt(input, controller.signal);
  } finally {
    clearTimeout(timer);
  }
}
```

### 14. Concurrent Sessions
**Decision: Fully supported, independent state.**

Based on user requirements:
- Multiple sessions on same provider: ✅ Supported
- Multiple sessions across providers: ✅ Supported
- State is independent between sessions
- No shared state management needed

**Implementation:**
- Each `createSession()` returns independent `IAgentSession`
- AgentManager tracks active sessions for cleanup only
- No session-to-session communication

**OpenCode consideration**: One server instance can handle multiple sessions. Adapter will reuse server connection if already running.

```typescript
class OpenCodeAdapter {
  private serverClient: OpencodeClient | null = null;

  async createSession(config: AgentSessionConfig): Promise<IAgentSession> {
    // Reuse existing server connection
    if (!this.serverClient) {
      const { client } = await createOpencode({ ... });
      this.serverClient = client;
    }

    // Create new session on shared server
    const session = await this.serverClient.session.create({ ... });
    return new OpenCodeSession(this.serverClient, session, config);
  }
}
```

### 15. MCP Server Lifecycle
**Decision: Pass-through configuration, consumer manages lifecycle.**

MCP servers are external processes. Our adapter:
- Accepts MCP config and passes to underlying SDK
- Does NOT start/stop MCP servers
- Documents that MCP servers must be running before session creation
- Logs warning if MCP tool call fails (server not available)

```typescript
interface AgentSessionConfig {
  mcpServers?: Record<string, McpServerConfig>;
}

interface McpServerConfig {
  // Passed directly to SDK
  command?: string;      // For stdio-based (Claude, Codex)
  args?: string[];
  url?: string;          // For HTTP-based
  env?: Record<string, string>;
}
```

**Rationale**: MCP server lifecycle is complex (some are long-running, some spawn per-request). Consumer knows their MCP topology better than we do.

### 16. Configuration Schema (Zod)
**Decision: Strict Zod schemas with provider-specific extensions.**

```typescript
import { z } from 'zod';

// Base config shared by all providers
const BaseSessionConfigSchema = z.object({
  provider: z.enum(['claude', 'codex', 'opencode']),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  cwd: z.string().optional(),
  timeoutMs: z.number().positive().optional(),

  // Unified permission model
  permissions: z.object({
    executionMode: z.enum(['plan', 'build']).default('build'),
    approvalLevel: z.enum(['strict', 'normal', 'trusted', 'none']).default('normal'),
    toolPermissions: z.record(z.enum(['allow', 'ask', 'deny'])).optional(),
  }).optional(),

  // MCP
  mcpServers: z.record(McpServerConfigSchema).optional(),

  // Hooks
  hooks: UnifiedHooksSchema.optional(),
});

// Provider-specific extensions
const ClaudeConfigSchema = BaseSessionConfigSchema.extend({
  provider: z.literal('claude'),
  maxTurns: z.number().positive().optional(),
  maxBudgetUsd: z.number().positive().optional(),
  maxThinkingTokens: z.number().positive().optional(),
  resume: z.string().optional(),
  forkSession: z.boolean().optional(),
});

const CodexConfigSchema = BaseSessionConfigSchema.extend({
  provider: z.literal('codex'),
  workingDirectory: z.string().optional(),
  skipGitRepoCheck: z.boolean().optional(),
});

const OpenCodeConfigSchema = BaseSessionConfigSchema.extend({
  provider: z.literal('opencode'),
  hostname: z.string().optional(),
  port: z.number().optional(),
});

// Discriminated union
const AgentSessionConfigSchema = z.discriminatedUnion('provider', [
  ClaudeConfigSchema,
  CodexConfigSchema,
  OpenCodeConfigSchema,
]);
```

### 17. Logging Strategy
**Decision: Injectable logger with structured output.**

```typescript
interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

// Default console logger
const defaultLogger: Logger = {
  debug: (msg, ctx) => console.debug(`[agents:debug] ${msg}`, ctx ?? ''),
  info: (msg, ctx) => console.info(`[agents:info] ${msg}`, ctx ?? ''),
  warn: (msg, ctx) => console.warn(`[agents:warn] ${msg}`, ctx ?? ''),
  error: (msg, ctx) => console.error(`[agents:error] ${msg}`, ctx ?? ''),
};

// Allow injection
interface AgentManagerConfig {
  logger?: Logger;
}

const manager = new AgentManager({ logger: customLogger });
```

**Log levels:**
- `debug`: Event details, SDK internals (disabled by default)
- `info`: Session lifecycle, major operations
- `warn`: Unsupported operations, degraded functionality
- `error`: Failures, exceptions

### 18. Initialization Sequence
**Decision: Documented order with fail-fast validation.**

```typescript
async createSession(config: AgentSessionConfig): Promise<IAgentSession> {
  // 1. Validate config with Zod
  const validated = AgentSessionConfigSchema.parse(config);

  // 2. Check credentials exist
  const adapter = this.getAdapter(validated.provider);
  if (!adapter.isConfigured()) {
    throw new AgentError({
      code: 'MISSING_CREDENTIALS',
      category: 'authentication',
      severity: 'fatal',
      message: `${validated.provider} credentials not configured`,
    });
  }

  // 3. Validate model (if specified)
  if (validated.model && !adapter.capabilities.supportedModels.includes(validated.model)) {
    throw new AgentError({
      code: 'INVALID_MODEL',
      category: 'invalid_input',
      severity: 'fatal',
      message: `Model ${validated.model} not supported by ${validated.provider}`,
    });
  }

  // 4. Start server (OpenCode only)
  // Handled internally by adapter

  // 5. Create session
  const session = await adapter.createSession(validated);

  // 6. Register hooks (if provided)
  if (validated.hooks) {
    session.registerHooks(validated.hooks);
  }

  // 7. Track for cleanup
  this.activeSessions.set(session.id, session);

  return session;
}
```

### 19. Retry Strategy
**Decision: Consumer responsibility, provide utilities.**

We will NOT auto-retry internally. Instead, provide helper utilities:

```typescript
// Utility for consumers
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
  } = {}
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 1000, maxDelayMs = 30000 } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof AgentError && error.severity !== 'retry') {
        throw error;  // Don't retry fatal errors
      }
      if (attempt === maxRetries) {
        throw error;
      }

      const delay = Math.min(
        baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000,
        maxDelayMs
      );
      await sleep(delay);
    }
  }
  throw new Error('Unreachable');
}
```

### 20. Testing Strategy
**Decision: Mock SDKs for unit tests, real SDKs for integration.**

```typescript
// Unit tests: Mock the SDK
const mockClaudeQuery = vi.fn().mockImplementation(async function* () {
  yield { type: 'system', subtype: 'init', session_id: 'test-session' };
  yield { type: 'assistant', message: { content: [...] } };
  yield { type: 'result', subtype: 'success', ... };
});

// Integration tests: Use real SDKs
// Prerequisites documented:
// - ANTHROPIC_API_KEY or authenticated Claude Code
// - Codex CLI authenticated (codex command run once)
// - OpenCode server running or auto-startable

describe('ClaudeAdapter (integration)', () => {
  it.skipIf(!process.env.ANTHROPIC_API_KEY)('creates real session', async () => {
    // Real SDK test
  });
});
```

## Conclusion

Building a unified abstraction layer is feasible but requires careful handling of fundamental architectural differences. The key is to:

1. **Accept differences** rather than force uniformity
2. **Normalize at the event level** for consistent logging
3. **Expose provider-specific features** through optional configuration
4. **Document limitations** clearly (e.g., Codex cancel)
5. **Test extensively** with real SDK behavior

The existing type definitions in `@animus/agents` are a solid foundation. Implementation should start with Claude (most mature SDK), then adapt patterns for Codex and OpenCode.
