/**
 * @animus-labs/cortex
 *
 * Production-grade agent wrapper for pi-agent-core.
 * Provides context management, MCP tool support, tool permissions,
 * budget guards, compaction, skill system, and event logging.
 *
 * Phase 1A exports: types and pure utility modules.
 */

// Types
export type {
  CortexLifecycleState,
  CortexAgentConfig,
  ContextManagerConfig,
  ErrorCategory,
  ErrorSeverity,
  ClassifiedError,
  AgentTextOutput,
  ToolContentDetails,
  BudgetGuardConfig,
  CompactionResult,
  CortexEvents,
  UtilityModelDefaults,
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
