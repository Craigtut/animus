# @animus/agents

A unified abstraction layer over multiple agent SDKs for the Animus project.

## Overview

This package provides a consistent interface for creating agent sessions, streaming events, managing permissions, and handling lifecycle across three agent providers:

| Provider | SDK | Status |
|----------|-----|--------|
| Claude | `@anthropic-ai/claude-agent-sdk` | Full support |
| Codex | `@openai/codex-sdk` | Full support (no cancel) |
| OpenCode | `@opencode-ai/sdk` | Full support |

## Installation

```bash
npm install @animus/agents
```

### Peer Dependencies

Install the SDK(s) for your chosen provider(s):

```bash
# For Claude (default)
npm install @anthropic-ai/claude-agent-sdk

# For Codex
npm install @openai/codex-sdk

# For OpenCode
npm install @opencode-ai/sdk
```

## Quick Start

```typescript
import { createAgentManager } from '@animus/agents';

// Create the manager (auto-registers all adapters)
const manager = createAgentManager();

// Check if a provider is configured
if (manager.isConfigured('claude')) {
  // Create a session
  const session = await manager.createSession({
    provider: 'claude',
    systemPrompt: 'You are a helpful assistant.',
  });

  // Listen for events
  session.onEvent((event) => {
    console.log(`[${event.type}]`, event.data);
  });

  // Send a prompt
  const response = await session.prompt('Hello!');
  console.log(response.content);

  // Clean up
  await session.end();
}
```

## Configuration

### Environment Variables

Each provider requires its own credentials:

```bash
# Claude
ANTHROPIC_API_KEY=sk-ant-...
# Or use Claude Code OAuth (auto-detected from ~/.claude/.credentials)

# Codex
OPENAI_API_KEY=sk-...
# Or use Codex auth (auto-detected from ~/.codex/auth.json)

# OpenCode
# Requires at least one provider key (ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY)
```

### Session Configuration

```typescript
interface AgentSessionConfig {
  // Required
  provider: 'claude' | 'codex' | 'opencode';

  // Common options
  model?: string;
  systemPrompt?: string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  permissions?: PermissionConfig;
  mcpServers?: Record<string, McpServerConfig>;
  hooks?: UnifiedHooks;

  // Claude-specific
  maxTurns?: number;
  maxBudgetUsd?: number;
  maxThinkingTokens?: number;
  resume?: string;        // Resume session by ID
  forkSession?: string;   // Fork from session ID

  // Codex-specific
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;

  // OpenCode-specific
  hostname?: string;      // Default: '127.0.0.1'
  port?: number;          // Default: 4096
}
```

### Permission Configuration

```typescript
interface PermissionConfig {
  executionMode: 'plan' | 'build';  // Default: 'build'
  approvalLevel: 'strict' | 'normal' | 'trusted' | 'none';  // Default: 'normal'
  toolPermissions?: Record<string, 'allow' | 'ask' | 'deny'>;
}
```

Permission mapping to providers:

| Unified | Claude | Codex | OpenCode |
|---------|--------|-------|----------|
| plan mode | `permissionMode: 'plan'` | `approvalPolicy: 'untrusted'` | N/A |
| strict | `permissionMode: 'default'` | `approvalPolicy: 'untrusted'` | Per-tool deny |
| normal | `permissionMode: 'default'` | `approvalPolicy: 'on-request'` | Default |
| trusted | `permissionMode: 'acceptEdits'` | `approvalPolicy: 'on-failure'` | Per-tool allow |
| none | `permissionMode: 'bypassPermissions'` | `approvalPolicy: 'never'` | All allow |

## API Reference

### AgentManager

```typescript
class AgentManager {
  // Check if provider credentials are configured
  isConfigured(provider: AgentProvider): boolean;

  // Get provider capabilities
  getCapabilities(provider: AgentProvider): AdapterCapabilities;

  // List registered/configured providers
  getRegisteredProviders(): AgentProvider[];
  getConfiguredProviders(): AgentProvider[];

  // Session management
  createSession(config: AgentSessionConfig): Promise<IAgentSession>;
  resumeSession(sessionId: string): Promise<IAgentSession>;
  getSession(sessionId: string): IAgentSession | undefined;

  // Counts
  getActiveSessionCount(): number;
  getActiveSessionCountByProvider(provider: AgentProvider): number;

  // Cleanup
  cleanup(): Promise<void>;
}
```

### IAgentSession

```typescript
interface IAgentSession {
  readonly id: string;        // Format: "{provider}:{nativeId}"
  readonly provider: AgentProvider;
  readonly isActive: boolean;

  // Event handling
  onEvent(handler: AgentEventHandler): void;
  registerHooks(hooks: UnifiedHooks): void;

  // Prompting
  prompt(input: string, options?: PromptOptions): Promise<AgentResponse>;
  promptStreaming(input: string, onChunk: (chunk: string) => void): Promise<AgentResponse>;

  // Control
  cancel(): Promise<void>;
  end(): Promise<void>;

  // Usage
  getUsage(): SessionUsage;
  getCost(): AgentCost | null;
}
```

### AgentResponse

```typescript
interface AgentResponse {
  content: string;
  finishReason: 'complete' | 'cancelled' | 'error' | 'max_turns' | 'max_tokens' | 'timeout';
  usage: SessionUsage;
  cost: AgentCost | null;
  durationMs: number;
  model: string;
}
```

## Event Types

The unified event system normalizes provider-specific events:

| Event Type | Description |
|------------|-------------|
| `session_start` | Session initialized |
| `session_end` | Session completed |
| `prompt_start` | User prompt received |
| `response_start` | Agent response beginning |
| `response_chunk` | Streaming text chunk |
| `response_end` | Agent response complete |
| `thinking_start` | Thinking/reasoning started |
| `thinking_chunk` | Thinking text chunk |
| `thinking_end` | Thinking complete |
| `tool_call_start` | Tool invocation starting |
| `tool_call_end` | Tool invocation complete |
| `error` | Error occurred |

```typescript
session.onEvent((event) => {
  switch (event.type) {
    case 'response_chunk':
      process.stdout.write(event.data.text);
      break;
    case 'tool_call_start':
      console.log(`Calling tool: ${event.data.toolName}`);
      break;
    case 'error':
      console.error(`Error: ${event.data.message}`);
      break;
  }
});
```

## Hook System

Register hooks to intercept and modify agent behavior:

```typescript
session.registerHooks({
  // Called before tool execution
  onPreToolUse: async (event) => {
    console.log(`Tool: ${event.toolName}, Input:`, event.input);

    // Claude only: block or modify
    return {
      allow: true,  // Set false to block (Claude only)
      modifiedInput: event.input,  // Modify input (Claude only)
    };
  },

  // Called after tool execution
  onPostToolUse: async (event) => {
    console.log(`Result:`, event.output);
  },

  // Called on tool error
  onToolError: async (event) => {
    console.error(`Tool ${event.toolName} failed:`, event.error);
  },

  // Session lifecycle
  onSessionStart: async (event) => { /* ... */ },
  onSessionEnd: async (event) => { /* ... */ },

  // Subagent events (Claude, OpenCode)
  onSubagentStart: async (event) => { /* ... */ },
  onSubagentEnd: async (event) => { /* ... */ },
});
```

**Note**: Blocking (`allow: false`) and input modification are only supported on Claude. Other providers will log a warning and continue.

## Provider Capabilities

```typescript
import { getCapabilities, hasCapability } from '@animus/agents';

const caps = getCapabilities('claude');
// {
//   canCancel: true,
//   canBlockInPreToolUse: true,
//   canModifyToolInput: true,
//   supportsSubagents: true,
//   supportsThinking: true,
//   supportsVision: true,
//   supportsStreaming: true,
//   supportsResume: true,
//   supportsFork: true,
//   maxConcurrentSessions: null,
//   supportedModels: ['claude-sonnet-4-5-20250514', ...]
// }

if (hasCapability('codex', 'canCancel')) {
  await session.cancel();  // Safe to call
}
```

| Capability | Claude | Codex | OpenCode |
|------------|--------|-------|----------|
| canCancel | Yes | **No** | Yes |
| canBlockInPreToolUse | Yes | No | No |
| canModifyToolInput | Yes | No | Yes |
| supportsSubagents | Yes | No | Yes |
| supportsThinking | Yes | Yes | Yes |
| supportsFork | Yes | No | No |
| supportsResume | Yes | Yes | Yes |

## Error Handling

```typescript
import { AgentError } from '@animus/agents';

try {
  const session = await manager.createSession({ provider: 'claude' });
} catch (error) {
  if (error instanceof AgentError) {
    console.error(`[${error.code}] ${error.message}`);
    console.error(`Category: ${error.category}`);
    console.error(`Severity: ${error.severity}`);
    console.error(`Provider: ${error.provider}`);

    if (error.severity === 'retry') {
      // Can retry this operation
    }
  }
}
```

Error categories:
- `authentication` - Missing or invalid credentials
- `authorization` - Permission denied
- `rate_limit` - Rate limited by provider
- `execution` - Runtime error during execution
- `resource_exhausted` - Context window or budget exceeded
- `timeout` - Operation timed out
- `network` - Network connectivity issue
- `server_error` - Provider server error
- `not_found` - Session or resource not found
- `invalid_input` - Invalid configuration or input
- `unsupported` - Feature not supported
- `cancelled` - Operation cancelled
- `unknown` - Unclassified error

## Utilities

```typescript
import {
  createSessionId,
  parseSessionId,
  withRetry,
} from '@animus/agents';

// Session ID utilities
const id = createSessionId('claude', 'abc123');  // 'claude:abc123'
const { provider, nativeId } = parseSessionId(id);

// Retry with exponential backoff
const result = await withRetry(
  () => session.prompt('Hello'),
  {
    maxAttempts: 3,
    initialDelayMs: 1000,
    maxDelayMs: 10000,
    backoffFactor: 2,
    shouldRetry: (error) => error.severity === 'retry',
  }
);
```

## Testing

```bash
# Run unit tests
npm test

# Run with coverage
npm run test:coverage

# Integration tests (requires API keys)
ANTHROPIC_API_KEY=... npm run test:integration
```

## License

MIT
