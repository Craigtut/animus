/**
 * @animus-labs/cortex
 *
 * Production-grade agent wrapper for pi-agent-core.
 * Provides context management, MCP tool support, tool permissions,
 * budget guards, compaction, skill system, and event logging.
 *
 * Phase 1A exports: types and pure utility modules.
 * Phase 1B exports: CortexAgent, ContextManager, EventBridge, BudgetGuard.
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
export { CortexAgent } from './cortex-agent.js';
export type { PiAgent, PiModel } from './cortex-agent.js';
