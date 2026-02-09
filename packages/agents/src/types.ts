/**
 * Type definitions for the agent abstraction layer.
 *
 * These types define the unified interface that all agent SDK adapters
 * must implement, regardless of the underlying provider.
 */

import type { AgentProvider, AgentEventType } from '@animus/shared';

// ============================================================================
// Permission Configuration
// ============================================================================

/**
 * Unified permission configuration for controlling agent behavior.
 *
 * Maps to provider-specific permission models:
 * - Claude: permissionMode, allowedTools, disallowedTools
 * - Codex: approval policy, sandbox mode
 * - OpenCode: mode, tool permissions
 */
export interface PermissionConfig {
  /**
   * Execution mode determines what CAN execute.
   * - plan: Read-only analysis mode
   * - build: Full development mode (default)
   */
  executionMode: 'plan' | 'build';

  /**
   * Approval level determines when to ask user.
   * - strict: Maximum safety, approve all modifications
   * - normal: Balanced, approve writes/bash/edits (default)
   * - trusted: Auto-approve edits
   * - none: No prompts (CI/CD mode)
   */
  approvalLevel: 'strict' | 'normal' | 'trusted' | 'none';

  /**
   * Tool-specific permission overrides.
   * Keys are tool names, values are permission levels.
   */
  toolPermissions?: Record<string, 'allow' | 'ask' | 'deny'>;
}

// ============================================================================
// Hook System
// ============================================================================

/**
 * Pre-tool-use hook event data.
 */
export interface PreToolUseEvent {
  sessionId: string;
  toolName: string;
  toolInput: unknown;
  toolCallId: string;
}

/**
 * Post-tool-use hook event data.
 */
export interface PostToolUseEvent {
  sessionId: string;
  toolName: string;
  toolInput: unknown;
  toolCallId: string;
  toolOutput: unknown;
  durationMs: number;
}

/**
 * Tool error hook event data.
 */
export interface ToolErrorEvent {
  sessionId: string;
  toolName: string;
  toolInput: unknown;
  toolCallId: string;
  error: string;
  isRetryable: boolean;
}

/**
 * Session start hook event data.
 */
export interface SessionStartEvent {
  sessionId: string;
  provider: AgentProvider;
  model: string;
  config: AgentSessionConfig;
}

/**
 * Session end hook event data.
 */
export interface SessionEndEvent {
  sessionId: string;
  reason: 'completed' | 'error' | 'cancelled' | 'timeout';
  totalDurationMs: number;
}

/**
 * Subagent start hook event data.
 */
export interface SubagentStartEvent {
  sessionId: string;
  parentSessionId: string;
  subagentName: string;
  prompt: string;
}

/**
 * Subagent end hook event data.
 */
export interface SubagentEndEvent {
  sessionId: string;
  parentSessionId: string;
  subagentName: string;
  result: string;
  durationMs: number;
}

/**
 * Result from a hook callback.
 */
export interface HookResult {
  /**
   * Whether to allow the operation (Claude only).
   * If false, the tool call will be blocked.
   */
  allow?: boolean;

  /**
   * Modified input for the tool (Claude only).
   * If provided, the tool will be called with this input instead.
   */
  modifiedInput?: unknown;
}

/**
 * Unified hooks interface for agent lifecycle events.
 *
 * Note on capabilities:
 * - Claude: Full support for blocking and modifying in onPreToolUse
 * - Codex: Observe-only, cannot block or modify (logs warning if attempted)
 * - OpenCode: Can modify in onPreToolUse, cannot block
 */
export interface UnifiedHooks {
  /**
   * Called before a tool is executed.
   * Return { allow: false } to block (Claude only).
   * Return { modifiedInput: ... } to modify input (Claude, OpenCode).
   */
  onPreToolUse?: (event: PreToolUseEvent) => Promise<HookResult | void>;

  /**
   * Called after a tool executes successfully.
   */
  onPostToolUse?: (event: PostToolUseEvent) => Promise<void>;

  /**
   * Called when a tool execution fails.
   */
  onToolError?: (event: ToolErrorEvent) => Promise<void>;

  /**
   * Called when a session starts.
   */
  onSessionStart?: (event: SessionStartEvent) => Promise<void>;

  /**
   * Called when a session ends.
   */
  onSessionEnd?: (event: SessionEndEvent) => Promise<void>;

  /**
   * Called when a subagent starts (Claude, OpenCode only).
   */
  onSubagentStart?: (event: SubagentStartEvent) => Promise<void>;

  /**
   * Called when a subagent ends (Claude, OpenCode only).
   */
  onSubagentEnd?: (event: SubagentEndEvent) => Promise<void>;
}

// ============================================================================
// MCP Configuration
// ============================================================================

/**
 * MCP server configuration.
 */
export interface McpServerConfig {
  /** Command to start stdio-based MCP server */
  command?: string;

  /** Arguments to pass to command */
  args?: string[];

  /** URL for HTTP-based MCP server */
  url?: string;

  /** Environment variables for the server */
  env?: Record<string, string>;
}

// ============================================================================
// Session Configuration
// ============================================================================

/**
 * Base configuration for creating an agent session.
 */
export interface AgentSessionConfig {
  /** Which SDK provider to use */
  provider: AgentProvider;

  /** Model identifier (provider-specific) */
  model?: string;

  /** System prompt to initialize the agent with */
  systemPrompt?: string;

  /** Working directory for file operations */
  cwd?: string;

  /** Environment variables to pass to the agent */
  env?: Record<string, string>;

  /** Timeout in milliseconds (default: 300000 = 5 minutes) */
  timeoutMs?: number;

  /** Unified permission configuration */
  permissions?: PermissionConfig;

  /** MCP server configurations */
  mcpServers?: Record<string, McpServerConfig>;

  /** Lifecycle hooks */
  hooks?: UnifiedHooks;

  // Provider-specific options (see typed config interfaces)

  // Claude-specific
  maxTurns?: number;
  maxBudgetUsd?: number;
  maxThinkingTokens?: number;
  resume?: string;
  forkSession?: boolean;
  allowedTools?: string[];
  disallowedTools?: string[];
  includePartialMessages?: boolean;

  // Codex-specific
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;

  // OpenCode-specific
  hostname?: string;
  port?: number;
}

/**
 * Options for a single prompt call.
 */
export interface PromptOptions {
  /** Override session timeout for this prompt */
  timeoutMs?: number;
}

// ============================================================================
// Events
// ============================================================================

/**
 * Normalized event emitted by any agent provider.
 */
export interface AgentEvent {
  /** Unique event ID */
  id: string;

  /** Session this event belongs to */
  sessionId: string;

  /** Normalized event type */
  type: AgentEventType;

  /** Event timestamp */
  timestamp: string;

  /** Event-specific payload */
  data: AgentEventData;
}

/**
 * Union of all possible event data payloads.
 */
export type AgentEventData =
  | SessionStartData
  | SessionEndData
  | InputReceivedData
  | ThinkingStartData
  | ThinkingEndData
  | ToolCallStartData
  | ToolCallEndData
  | ToolErrorData
  | ResponseStartData
  | ResponseChunkData
  | ResponseEndData
  | ErrorData;

export interface SessionStartData {
  provider: AgentProvider;
  model: string;
  config: Partial<AgentSessionConfig>;
}

export interface SessionEndData {
  reason: 'completed' | 'error' | 'cancelled' | 'timeout';
  totalDurationMs: number;
}

export interface InputReceivedData {
  content: string;
  type: 'text' | 'image' | 'file';
}

export interface ThinkingStartData {
  /** Empty - just signals thinking began */
}

export interface ThinkingEndData {
  thinkingDurationMs: number;
  /** Raw thinking content if available (model-dependent) */
  content?: string;
}

export interface ToolCallStartData {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolCallId: string;
}

export interface ToolCallEndData {
  toolCallId: string;
  toolName: string;
  output: unknown;
  durationMs: number;
}

export interface ToolErrorData {
  toolCallId: string;
  toolName: string;
  error: string;
  isRetryable: boolean;
}

export interface ResponseStartData {
  /** Empty - just signals response generation began */
}

export interface ResponseChunkData {
  content: string;
  /** Running total of content so far */
  accumulated: string;
}

export interface ResponseEndData {
  content: string;
  finishReason: 'complete' | 'max_tokens' | 'tool_use' | 'error';
}

export interface ErrorData {
  code: string;
  message: string;
  recoverable: boolean;
  details?: Record<string, unknown>;
}

// ============================================================================
// Usage & Cost Tracking
// ============================================================================

/**
 * Token usage statistics for a session.
 */
export interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;

  /** Total context window capacity for the model */
  contextWindowSize?: number;

  /** Current context usage */
  contextWindowUsed?: number;

  /** Remaining context capacity (calculated) */
  contextWindowRemaining?: number;
}

/**
 * Cost information for a session.
 */
export interface AgentCost {
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
  model: string;
  provider: AgentProvider;
}

/**
 * Result of an agent prompt.
 */
export interface AgentResponse {
  /** The agent's response content */
  content: string;

  /** How the response ended */
  finishReason: 'complete' | 'max_tokens' | 'tool_use' | 'error';

  /** Token usage for this response */
  usage: SessionUsage;

  /** Cost information (if calculable) */
  cost?: AgentCost;

  /** Duration of the prompt in milliseconds */
  durationMs: number;

  /** Model used for this response */
  model: string;
}

// ============================================================================
// Adapter Capabilities
// ============================================================================

/**
 * Capabilities supported by an adapter.
 *
 * Use this to query what features are available before using them,
 * avoiding runtime errors for unsupported operations.
 */
export interface AdapterCapabilities {
  /** Can cancel running operations */
  canCancel: boolean;

  /** Pre-tool-use hooks can block execution */
  canBlockInPreToolUse: boolean;

  /** Pre-tool-use hooks can modify input */
  canModifyToolInput: boolean;

  /** Supports spawning subagents */
  supportsSubagents: boolean;

  /** Supports extended thinking mode */
  supportsThinking: boolean;

  /** Supports vision/image inputs */
  supportsVision: boolean;

  /** Supports streaming responses */
  supportsStreaming: boolean;

  /** Can resume previous sessions */
  supportsResume: boolean;

  /** Can fork existing sessions (Claude only) */
  supportsFork: boolean;

  /** Maximum concurrent sessions (null = unlimited) */
  maxConcurrentSessions: number | null;

  /** List of supported model IDs */
  supportedModels: string[];
}

// ============================================================================
// Handler Types
// ============================================================================

/**
 * Handler for streaming agent events.
 */
export type AgentEventHandler = (event: AgentEvent) => void | Promise<void>;

// ============================================================================
// Adapter Interface
// ============================================================================

/**
 * Interface that all agent adapters must implement.
 */
export interface IAgentAdapter {
  /** Provider this adapter handles */
  readonly provider: AgentProvider;

  /** Capabilities supported by this adapter */
  readonly capabilities: AdapterCapabilities;

  /** Check if the adapter is properly configured (API keys, etc.) */
  isConfigured(): boolean;

  /** Create a new session */
  createSession(config: AgentSessionConfig): Promise<IAgentSession>;

  /** Resume an existing session by ID */
  resumeSession(sessionId: string): Promise<IAgentSession>;
}

// ============================================================================
// Session Interface
// ============================================================================

/**
 * Interface for an active agent session.
 */
export interface IAgentSession {
  /**
   * Unique session identifier (format: "{provider}:{nativeId}").
   *
   * **Lifecycle note**: Session IDs may be "pending" immediately after
   * `createSession()` returns, using a temporary UUID. The stable native ID
   * is assigned by the provider SDK during the first prompt interaction
   * (e.g., Claude's `system.init` message). After the first prompt, the ID
   * stabilizes and remains constant for the session's lifetime.
   *
   * Consumers should be aware that:
   * - Events emitted before the first prompt use the pending ID
   * - The ID returned by `createSession()` may differ from the ID after first prompt
   * - Crash recovery requires the stable (post-first-prompt) ID
   */
  readonly id: string;

  /** Provider this session is using */
  readonly provider: AgentProvider;

  /** Whether the session is still active */
  readonly isActive: boolean;

  /** Register an event handler */
  onEvent(handler: AgentEventHandler): void;

  /** Register lifecycle hooks */
  registerHooks(hooks: UnifiedHooks): void;

  /** Send a prompt and get a response */
  prompt(input: string, options?: PromptOptions): Promise<AgentResponse>;

  /** Send a prompt with streaming response */
  promptStreaming(
    input: string,
    onChunk: (chunk: string) => void,
    options?: PromptOptions,
  ): Promise<AgentResponse>;

  /** Cancel the current operation */
  cancel(): Promise<void>;

  /** End the session */
  end(): Promise<void>;

  /** Get accumulated usage for this session */
  getUsage(): SessionUsage;

  /** Get accumulated cost for this session */
  getCost(): AgentCost | null;
}
