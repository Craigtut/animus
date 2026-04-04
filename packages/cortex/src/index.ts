/**
 * @animus-labs/cortex
 *
 * Production-grade agent wrapper for pi-agent-core.
 * Provides context management, MCP tool support, tool permissions,
 * budget guards, compaction, skill system, and event logging.
 *
 * Phase 1A exports: types and pure utility modules.
 * Phase 1B exports: CortexAgent, ContextManager, EventBridge, BudgetGuard.
 * Phase 1C exports: Built-in tools (Read, Write, Edit, Glob, Grep, Bash, TaskOutput, WebFetch).
 * Phase 1D exports: ProviderManager, model wrapper, provider registry.
 */

// Types
export type {
  CortexUsage,
  CortexLifecycleState,
  CortexAgentConfig,
  ContextManagerConfig,
  ErrorCategory,
  ErrorSeverity,
  ClassifiedError,
  AgentTextOutput,
  ToolContentDetails,
  BudgetGuardConfig,
  ToolCategory,
  MicrocompactionConfig,
  CompactionConfig,
  FailsafeConfig,
  AdaptiveThresholdConfig,
  CortexCompactionConfig,
  CompactionTarget,
  CompactionResult,
  CompactionDegradedInfo,
  CompactionExhaustedInfo,
  PersistResultFn,
  CortexEvents,
  UtilityModelDefaults,
  McpTransportConfig,
  McpStdioConfig,
  McpHttpConfig,
  McpConnectionState,
  SkillConfig,
  SkillEntry,
  LoadedSkill,
  CortexScriptContext,
  SubAgentSpawnConfig,
  SubAgentResult,
  TrackedSubAgent,
} from './types.js';

// Schema Converter
export { zodToTypebox } from './schema-converter.js';

// Token Estimator
export { estimateTokens } from './token-estimator.js';

// Working Tags Parser
export {
  stripWorkingTags,
  extractWorkingContent,
  parseWorkingTags,
} from './working-tags.js';

// Error Classifier
export { classifyError } from './error-classifier.js';
export type { ClassifyErrorOptions } from './error-classifier.js';

// Context Manager (Phase 1B)
export { ContextManager } from './context-manager.js';
export type {
  AgentMessage,
  AgentStateAccessor,
  AgentContext,
} from './context-manager.js';

// Event Bridge (Phase 1B)
export { EventBridge } from './event-bridge.js';
export type {
  CortexEventType,
  CortexEvent,
  CortexEventListener,
  PiEventType,
  PiEvent,
  PiEventSource,
} from './event-bridge.js';

// Budget Guard (Phase 1B)
export { BudgetGuard } from './budget-guard.js';

// CortexAgent (Phase 1B)
export { CortexAgent, MINIMUM_CONTEXT_WINDOW, DEFAULT_CONTEXT_WINDOW_LIMIT } from './cortex-agent.js';
export type { PiAgent, PiModel } from './cortex-agent.js';

// MCP Client Manager (Phase 3)
export { McpClientManager } from './mcp-client.js';
export type { AgentTool } from './mcp-client.js';

// Built-in Tools (Phase 1C)
export {
  ReadRegistry,
  CwdTracker,
  createReadTool,
  createWriteTool,
  createEditTool,
  createGlobTool,
  createGrepTool,
  createBashTool,
  createTaskOutputTool,
  createWebFetchTool,
  WebFetchCache,
  getBackgroundTask,
  getAllBackgroundTasks,
  buildSafeEnv,
  isCriticalPath,
  classifyCommand,
  checkObfuscation,
  stripInvisibleChars,
  checkScriptPreflight,
  checkAutoModeClassifier,
  runSafetyChecks,
  validateWritePaths,
  extractWritePaths,
  TOOL_NAMES,
} from './tools/index.js';
export type {
  ReadDetails,
  ReadParamsType,
  ReadToolConfig,
  WriteDetails,
  WriteParamsType,
  WriteToolConfig,
  DiffHunk,
  EditDetails,
  EditParamsType,
  EditToolConfig,
  GlobDetails,
  GlobParamsType,
  GlobToolConfig,
  GrepDetails,
  GrepParamsType,
  GrepToolConfig,
  BashDetails,
  BashParamsType,
  BashToolConfig,
  BackgroundTask,
  TaskOutputDetails,
  TaskOutputParamsType,
  WebFetchDetails,
  WebFetchParamsType,
  WebFetchToolConfig,
  CacheEntry,
  CommandClassification,
  SafetyCheckResult,
  BuiltInToolName,
  SubAgentToolConfig,
  SubAgentDetails,
  SubAgentParamsType,
} from './tools/index.js';

// Skill System (Phase 4)
export { SkillRegistry, parseFrontmatter } from './skill-registry.js';
export { preprocessSkillBody, substituteVariables, executeShellCommand, executeScript } from './skill-preprocessor.js';
export { createLoadSkillTool, buildLoadSkillDescription, LOAD_SKILL_TOOL_NAME } from './skill-tool.js';
export type { LoadSkillToolConfig, LoadSkillParamsType } from './skill-tool.js';
export { LoadSkillParams } from './skill-tool.js';

// Sub-Agent Manager (Phase 4)
export { SubAgentManager } from './sub-agent-manager.js';
export type { SubAgentManagerConfig, SubAgentLifecycleHooks } from './sub-agent-manager.js';

// Compaction (Phase 5)
export {
  CompactionManager,
  buildCompactionConfig,
  DEFAULT_COMPACTION_CONFIG,
  ADAPTIVE_DEFAULTS,
  computeAdaptiveThreshold,
  MicrocompactionEngine,
  capToolResult,
  runCompaction,
  shouldCompact,
  partitionHistory,
  buildSummaryMessage,
  emergencyTruncate,
  shouldTruncate,
  isContextOverflow,
} from './compaction/index.js';
export type {
  TrimAction,
  TrimState,
  CompleteFn,
  FailsafeTruncationResult,
} from './compaction/index.js';

// Model Wrapper (Phase 1D)
export { wrapModel, unwrapModel, isCortexModel } from './model-wrapper.js';
export type { CortexModel } from './model-wrapper.js';

// Provider Registry (Phase 1D)
export {
  PROVIDER_REGISTRY,
  OAUTH_PROVIDER_IDS,
  LOGIN_FUNCTION_NAMES,
  UTILITY_MODEL_DEFAULTS,
  PRIMARY_MODEL_DEFAULTS,
  PROVIDER_CACHE_CONFIG,
  resolveCacheRetention,
} from './provider-registry.js';
export type {
  AuthMethod,
  ProviderInfo,
  ModelInfo,
  ProviderCacheConfig,
  CacheRetention,
} from './provider-registry.js';

// Provider Manager (Phase 1D)
export { ProviderManager } from './provider-manager.js';
export type {
  IProviderManager,
  OAuthCallbacks,
  OAuthMeta,
  OAuthResult,
  OAuthRefreshResult,
  CustomModelConfig,
} from './provider-manager.js';
