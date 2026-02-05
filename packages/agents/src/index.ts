/**
 * @animus/agents
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
 * import { createAgentManager } from '@animus/agents';
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
  ErrorData,

  // Usage & Cost
  SessionUsage,
  AgentCost,
  AgentResponse,

  // Capabilities
  AdapterCapabilities,

  // Handlers
  AgentEventHandler,

  // Interfaces
  IAgentAdapter,
  IAgentSession,
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
} from './manager.js';

// ============================================================================
// Adapters
// ============================================================================

export { BaseAdapter, BaseSession, type AdapterOptions } from './adapters/base.js';
export { ClaudeAdapter } from './adapters/claude.js';
export { CodexAdapter } from './adapters/codex.js';
export { OpenCodeAdapter } from './adapters/opencode.js';

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
