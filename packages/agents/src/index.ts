/**
 * @animus-labs/agents
 *
 * Unified agent SDK abstraction layer for Animus.
 *
 * This package provides a consistent interface for interacting with multiple
 * agent SDKs (Claude, Codex, OpenCode) with unified:
 * - Session management
 * - Event streaming and normalization
 * - Permission handling
 * - Hook system
 * - Usage and cost tracking
 *
 * @example
 * ```typescript
 * import { createAgentManager } from '@animus-labs/agents';
 *
 * const manager = createAgentManager();
 *
 * // Create a Claude session
 * const session = await manager.createSession({
 *   provider: 'claude',
 *   systemPrompt: 'You are a helpful assistant.',
 * });
 *
 * // Send a prompt
 * const response = await session.prompt('Hello!');
 * console.log(response.content);
 *
 * // Or stream the response
 * const streamedResponse = await session.promptStreaming(
 *   'Tell me a story',
 *   (chunk) => process.stdout.write(chunk)
 * );
 *
 * // Clean up
 * await session.end();
 * ```
 *
 * @packageDocumentation
 */

// ============================================================================
// Types
// ============================================================================

export type {
  // Permission system
  PermissionConfig,

  // Hook system
  PreToolUseEvent,
  PostToolUseEvent,
  ToolErrorEvent,
  SessionStartEvent,
  SessionEndEvent,
  SubagentStartEvent,
  SubagentEndEvent,
  HookResult,
  UnifiedHooks,

  // MCP
  McpServerConfig,

  // Configuration
  SystemPromptPreset,
  AgentSessionConfig,
  PromptOptions,

  // Events
  AgentEvent,
  AgentEventData,
  SessionStartData,
  SessionEndData,
  InputReceivedData,
  ThinkingStartData,
  ThinkingEndData,
  ToolCallStartData,
  ToolCallEndData,
  ToolErrorData,
  ResponseStartData,
  ResponseChunkData,
  ResponseEndData,
  TurnEndData,
  ErrorData,

  // Streaming & Turns
  StreamChunkMeta,
  TurnResult,

  // Usage & Cost
  SessionUsage,
  AgentCost,
  AgentResponse,

  // Capabilities
  AdapterCapabilities,

  // Handlers
  AgentEventHandler,

  // Model discovery
  ModelInfo,

  // Interfaces
  IAgentAdapter,
  IAgentSession,

  // Credential & Auth
  ICredentialStore,
  IAuthProvider,
  AuthFlowStatusUpdate,
  ProviderAuthStatus,
  ProviderAuthMethod,
} from './types.js';

// ============================================================================
// Schemas
// ============================================================================

export {
  // Validation schemas
  agentProviderSchema,
  permissionConfigSchema,
  mcpServerConfigSchema,
  hookResultSchema,
  baseSessionConfigSchema,
  claudeConfigSchema,
  codexConfigSchema,
  opencodeConfigSchema,
  agentSessionConfigSchema,

  // Inferred types from schemas
  type ClaudeConfig,
  type CodexConfig,
  type OpenCodeConfig,
  type AgentSessionConfigUnion,

  // Validation helpers
  validateConfig,
  safeValidateConfig,
  getConfigErrors,
} from './schemas.js';

// ============================================================================
// Errors
// ============================================================================

export {
  AgentError,
  type AgentErrorCategory,
  type AgentErrorSeverity,
  type AgentErrorDetails,
  type AgentErrorOptions,
  httpStatusToCategory,
  categoryToSeverity,
  wrapError,
} from './errors.js';

// ============================================================================
// Logger
// ============================================================================

export {
  type Logger,
  type LogLevel,
  defaultLogger,
  setDefaultLogger,
  createTaggedLogger,
  createSilentLogger,
  createCollectingLogger,
  type CollectedLogEntry,
  type CollectingLogger,
} from './logger.js';

// ============================================================================
// Manager
// ============================================================================

export {
  AgentManager,
  createAgentManager,
  type AgentManagerConfig,
  type SessionWarmth,
  type WarmthThresholds,
  type SessionInfo,
} from './manager.js';

// ============================================================================
// Event Logging
// ============================================================================

export {
  createLoggingHandler,
  logSessionUsage,
  attachSessionLogging,
  type AgentLogStore,
  type LoggingHookOptions,
} from './logging-hook.js';

// ============================================================================
// Model Registry
// ============================================================================

export {
  ModelRegistry,
  getModelRegistry,
  initModelRegistry,
  resetModelRegistry,
  type ModelEntry,
  type ModelRegistryConfig,
  type DiscoveryFn,
} from './model-registry.js';

// ============================================================================
// Adapters
// ============================================================================

export { BaseAdapter, BaseSession, type AdapterOptions } from './adapters/base.js';
export { ClaudeAdapter } from './adapters/claude.js';
export { CodexAdapter } from './adapters/codex.js';
export { OpenCodeAdapter } from './adapters/opencode.js';
export type { SkillEntry } from './adapters/codex-protocol-types.js';

// ============================================================================
// Capabilities
// ============================================================================

export {
  CLAUDE_CAPABILITIES,
  CODEX_CAPABILITIES,
  OPENCODE_CAPABILITIES,
  getCapabilities,
  hasCapability,
} from './capabilities.js';

// ============================================================================
// Reasoning
// ============================================================================

export {
  getCodexReasoningEffort,
  type ReasoningEffort,
} from './reasoning.js';

// ============================================================================
// Utilities
// ============================================================================

export {
  // Session ID utilities
  createSessionId,
  parseSessionId,
  getProviderFromSessionId,
  createPendingSessionId,
  isPendingSessionId,
  type ParsedSessionId,

  // Retry utilities
  withRetry,
  createRetrier,
  delay,
  type RetryOptions,

  // General utilities
  generateUUID,
  now,
  isDefined,
  assertDefined,
  safeStringify,
  deepClone,
  isNode,
  fileExists,
  readFile,
  readJson,
} from './utils/index.js';

// ============================================================================
// SDK Resolution
// ============================================================================

export {
  configureSdkResolver,
  resolveClaudeCliPaths,
  getClaudeNativeBinary,
  resolveCodexCliPaths,
  getCodexBundledBinary,
  checkSdkAvailable,
  _resetCache as _resetSdkCache,
  type SdkResolverConfig,
  CLAUDE_SDK_VERSION,
  CLAUDE_SDK_PACKAGE,
  SdkManager,
  createSdkManager,
  type SdkInstallStatus,
  type SdkInstallProgress,
  type SdkManagerConfig,
} from './sdk/index.js';

// ============================================================================
// Auth Providers
// ============================================================================

export {
  AuthSessionManager,
  ClaudeAuthProvider,
  CodexAuthProvider,
  inferCredentialType,
  ensureClaudeOnboardingFile,
  validateClaudeCredential,
  validateCodexCredential,
  type AuthSession,
  type CredentialType,
} from './auth/index.js';
