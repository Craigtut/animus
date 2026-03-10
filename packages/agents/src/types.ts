/**
 * Type definitions for the agent abstraction layer.
 *
 * These types define the unified interface that all agent SDK adapters
 * must implement, regardless of the underlying provider.
 */

import type { AgentProvider, AgentEventType } from '@animus-labs/shared';

// ============================================================================
// Credential Store Interface
// ============================================================================

/**
 * Interface for credential persistence.
 * Implemented by the backend to provide DB-backed storage.
 * Auth providers operate against this interface without any DB dependency.
 */
export interface ICredentialStore {
  saveCredential(provider: string, type: string, data: string, metadata?: Record<string, unknown>): void;
  getCredential(provider: string, type: string): { data: string; metadata?: Record<string, unknown> } | null;
  deleteCredential(provider: string, type?: string): boolean;
  getCredentialMetadata(provider: string): Array<{ credentialType: string; metadata?: Record<string, unknown> }>;
}

// ============================================================================
// Auth Provider Interface
// ============================================================================

/**
 * Status update emitted during an authentication flow.
 */
export interface AuthFlowStatusUpdate {
  status: 'pending' | 'success' | 'error' | 'expired' | 'cancelled';
  message?: string;
  /** Device code for device-code flows */
  userCode?: string;
  /** Verification URL for device-code flows */
  verificationUrl?: string;
  /** Time until expiration in seconds */
  expiresIn?: number;
}

/**
 * Auth status for a provider.
 */
export interface ProviderAuthStatus {
  provider: 'claude' | 'codex';
  configured: boolean;
  cliInstalled: boolean;
  methods: ProviderAuthMethod[];
}

export interface ProviderAuthMethod {
  method: 'api_key' | 'oauth_token' | 'codex_oauth' | 'cli';
  available: boolean;
  source: 'database' | 'environment' | 'filesystem';
  detail?: string;
}

/**
 * Interface for provider-specific authentication.
 * Each adapter can optionally implement this to own its auth lifecycle.
 */
export interface IAuthProvider {
  readonly provider: AgentProvider;
  detectAuth(store: ICredentialStore): Promise<ProviderAuthStatus>;
  initiateAuth(store: ICredentialStore, method: 'cli' | 'oauth'): Promise<{ sessionId: string; status?: 'success' | 'error'; message?: string; userCode?: string; verificationUrl?: string; expiresIn?: number }>;
  subscribeToAuthStatus(sessionId: string, cb: (s: AuthFlowStatusUpdate) => void): () => void;
  getAuthFlowStatus(sessionId: string): AuthFlowStatusUpdate | null;
  cancelAuthFlow(sessionId: string): boolean;
  logout(store: ICredentialStore): Promise<boolean>;
  /** Prepare environment variables for a session (e.g., refresh tokens, write auth files) */
  prepareSessionEnv?(store: ICredentialStore, sessionDir: string): Promise<Record<string, string>>;
  /** Validate a credential against the provider's API */
  validateCredential?(key: string, type: string): Promise<{ valid: boolean; message: string }>;
}

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
  config: Record<string, unknown>;
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
 * Preset system prompt configuration.
 *
 * Uses the Claude Code default system prompt as a base and appends custom
 * instructions. This preserves all built-in agentic capabilities (Skill tool,
 * tool loop, etc.) while adding domain-specific behavior.
 */
export interface SystemPromptPreset {
  type: 'preset';
  preset: 'claude_code';
  /** Custom instructions appended after the default Claude Code prompt */
  append?: string;
}

/**
 * Base configuration for creating an agent session.
 */
export interface AgentSessionConfig {
  /** Which SDK provider to use */
  provider: AgentProvider;

  /** Model identifier (provider-specific) */
  model?: string;

  /** System prompt to initialize the agent with.
   *  Pass a string to replace the default prompt entirely, or use the preset
   *  format to preserve the default Claude Code prompt while appending custom
   *  instructions. */
  systemPrompt?: string | SystemPromptPreset;

  /** Working directory for file operations */
  cwd?: string;

  /** Environment variables to pass to the agent */
  env?: Record<string, string>;

  /** Timeout in milliseconds (default: 300000 = 5 minutes) */
  timeoutMs?: number;

  /** Sampling temperature (0-2). Lower = more deterministic. Provider support varies. */
  temperature?: number;

  /** Maximum output tokens for the response. Provider support varies. */
  maxOutputTokens?: number;

  /** Unified permission configuration */
  permissions?: PermissionConfig;

  /**
   * MCP server configurations.
   *
   * Values can be our McpServerConfig (stdio/HTTP) or opaque SDK-specific
   * objects (e.g., Claude SDK's in-process McpSdkServerConfigWithInstance
   * returned by createSdkMcpServer()).
   */
  mcpServers?: Record<string, McpServerConfig | Record<string, unknown>>;

  /** Lifecycle hooks */
  hooks?: UnifiedHooks;

  /**
   * Programmatic permission handler for controlling tool usage.
   * Called before each tool execution to determine if it should be allowed.
   * Works for ALL tool types including external MCP tools.
   * Claude-specific: maps to the SDK's canUseTool callback.
   */
  canUseTool?: (
    toolName: string,
    input: Record<string, unknown>,
  ) => Promise<
    | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
    | { behavior: 'deny'; message?: string }
  >;

  /**
   * Unified reasoning effort level.
   * Controls how much the model thinks before responding.
   * Maps to Claude's `effort` option and Codex's `model_reasoning_effort`.
   * Values: 'low', 'medium', 'high', 'max' (max is Claude-only, mapped to high for Codex).
   */
  reasoningEffort?: 'low' | 'medium' | 'high' | 'max';

  // Provider-specific options (see typed config interfaces)

  // Claude-specific
  maxTurns?: number;
  maxBudgetUsd?: number;
  resume?: string;
  forkSession?: boolean;
  allowedTools?: string[];
  disallowedTools?: string[];
  includePartialMessages?: boolean;
  outputFormat?: {
    type: 'json_schema';
    schema: Record<string, unknown>;
  };
  /**
   * Which filesystem settings the SDK should load.
   * - 'user': ~/.claude settings
   * - 'project': .claude/ in cwd (CLAUDE.md, skills, agents)
   * - 'local': .claude.local settings
   *
   * Defaults to empty (no filesystem discovery). Pass ['project'] only
   * for sessions that need Claude Code project context (e.g., code-working
   * sub-agents). The mind session should NOT load project settings — its
   * context is fully built by the context builder.
   */
  settingSources?: Array<'user' | 'project' | 'local'>;
  /**
   * Load Claude SDK plugins for skill discovery.
   * Used to expose Animus plugin skills to the Claude SDK without needing
   * settingSources: ['project'] (which also loads CLAUDE.md).
   */
  plugins?: Array<{ type: 'local'; path: string }>;

  // Codex-specific
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;

  // OpenCode-specific
  hostname?: string;
  port?: number;

  /**
   * Enable verbose logging for debugging session lifecycle.
   * When true, logs detailed SDK message flow, time-to-first-message,
   * periodic "still waiting" heartbeats, and elevated stderr output.
   */
  verbose?: boolean;
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
  | TurnEndData
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

export interface TurnEndData {
  /** Zero-based index of this turn within the prompt */
  turnIndex: number;
  /** The text content produced in this turn */
  text: string;
  /** Whether this turn contained tool_use blocks */
  hasToolCalls: boolean;
  /** Whether this turn contained thinking blocks */
  hasThinking: boolean;
  /** Tool names used in this turn (if any) */
  toolNames: string[];
}

export interface ErrorData {
  code: string;
  message: string;
  recoverable: boolean;
  details?: Record<string, unknown>;
}

// ============================================================================
// Model Discovery
// ============================================================================

/**
 * Information about an available model.
 */
export interface ModelInfo {
  /** Model identifier (e.g. "claude-opus-4-6", "codex-mini-latest") */
  id: string;
  /** Human-readable model name */
  name: string;
  /** Whether this model is recommended for general use */
  recommended?: boolean;
  /** Whether this is the default model for the provider */
  isDefault?: boolean;
  /** ISO date string from API (e.g. model creation date) */
  createdAt?: string;
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
 * Metadata passed alongside each streaming chunk.
 *
 * Consumers can use the optional second argument to `onChunk` to route
 * streamed text by turn, or ignore it for simple streaming.
 */
export interface StreamChunkMeta {
  /** Which turn (zero-based) this chunk belongs to */
  turnIndex: number;
}

/**
 * Complete record of a single agent turn within a prompt.
 *
 * Available in `AgentResponse.turns` after the prompt finishes.
 * Intermediate turns (with tool calls) contain the agent's initial
 * reaction text. The final turn contains the canonical reply.
 */
export interface TurnResult {
  /** Zero-based index of this turn */
  turnIndex: number;
  /** The full text produced in this turn */
  text: string;
  /** Whether this turn contained tool calls */
  hasToolCalls: boolean;
  /** Whether this turn contained thinking blocks */
  hasThinking: boolean;
  /** Names of tools called in this turn (if any) */
  toolNames: string[];
}

/**
 * Result of an agent prompt.
 */
export interface AgentResponse {
  /** The agent's response content (final turn text) */
  content: string;

  /**
   * All turns produced during this prompt, in order.
   *
   * Each turn corresponds to one assistant message. Intermediate turns
   * (with tool calls) contain the agent's initial reaction before tools
   * execute. The final turn contains the canonical reply.
   *
   * For simple single-turn responses, this will be a single-element array
   * matching `content`. For multi-turn tool-using responses, earlier entries
   * contain the intermediate text that was previously discarded.
   */
  turns: TurnResult[];

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

  /** Structured output (when outputFormat is specified) */
  structuredOutput?: unknown;
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

  /** List available models for this provider */
  listModels(): Promise<ModelInfo[]>;

  /** Get the auth provider for this adapter (if authentication is supported) */
  getAuthProvider?(): IAuthProvider | null;
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

  /** Remove a previously registered event handler */
  offEvent(handler: AgentEventHandler): void;

  /** Register lifecycle hooks */
  registerHooks(hooks: UnifiedHooks): void;

  /** Send a prompt and get a response */
  prompt(input: string, options?: PromptOptions): Promise<AgentResponse>;

  /**
   * Send a prompt with streaming response.
   *
   * The `onChunk` callback receives each text fragment as it arrives.
   * The optional second argument provides turn context so consumers can
   * route streaming text by turn without coordinating separate channels.
   *
   * Simple consumers can ignore the meta: `(chunk) => showText(chunk)`
   * Turn-aware consumers can use it: `(chunk, meta) => route(chunk, meta.turnIndex)`
   */
  promptStreaming(
    input: string,
    onChunk: (chunk: string, meta: StreamChunkMeta) => void,
    options?: PromptOptions,
  ): Promise<AgentResponse>;

  /**
   * Inject a user message into a running prompt stream.
   *
   * Only available when `promptStreaming()` is actively running and the
   * provider supports mid-query message injection (e.g., Claude's
   * AsyncIterable prompt form). Call is a no-op if not supported or
   * no prompt is in flight.
   *
   * The injected message will be processed by the agent as a new user
   * turn within the same query. Behavior depends on the provider:
   * - Claude: Queued as next turn via AsyncIterable<SDKUserMessage>
   * - Codex/OpenCode: Not supported (method is optional)
   */
  injectMessage?(content: string): void;

  /** Cancel the current operation */
  cancel(): Promise<void>;

  /** End the session */
  end(): Promise<void>;

  /** Get accumulated usage for this session */
  getUsage(): SessionUsage;

  /** Get accumulated cost for this session */
  getCost(): AgentCost | null;
}
