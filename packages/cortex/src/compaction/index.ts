/**
 * Compaction composition: wires all three layers into the transformContext chain.
 *
 * Layer 1 (Microcompaction): tool result trimming at threshold crossings
 * Layer 2 (Compaction): conversation summarization via LLM
 * Layer 3 (Failsafe): emergency truncation, purely mechanical
 *
 * The composition runs in transformContext, which fires before every LLM call.
 * Layer 2 fires only at end-of-tick (when pipelinePhase is 'idle').
 * Layer 3 fires both at end-of-tick and mid-loop (safety valve).
 *
 * References:
 *   - compaction-strategy.md
 *   - phase-5-compaction.md (5.5)
 */

import type { AgentMessage, AgentContext } from '../context-manager.js';
import type {
  CortexCompactionConfig,
  CompactionResult,
  CompactionTarget,
  PipelinePhase,
} from '../types.js';
import { estimateTokens } from '../token-estimator.js';
import { MicrocompactionEngine, MICROCOMPACTION_DEFAULTS, extractTextContent } from './microcompaction.js';
import {
  runCompaction,
  shouldCompact,
  COMPACTION_DEFAULTS,
} from './compaction.js';
import type { CompleteFn, BeforeCompactionHandler, PostCompactionHandler, CompactionErrorHandler } from './compaction.js';
import {
  emergencyTruncate,
  shouldTruncate,
  FAILSAFE_DEFAULTS,
} from './failsafe.js';

// ---------------------------------------------------------------------------
// Re-exports for consumer convenience
// ---------------------------------------------------------------------------

export { MicrocompactionEngine, capToolResult } from './microcompaction.js';
export type { TrimAction, TrimState } from './microcompaction.js';
export { runCompaction, shouldCompact, partitionHistory, buildSummaryMessage } from './compaction.js';
export type { CompleteFn } from './compaction.js';
export { emergencyTruncate, shouldTruncate, isContextOverflow } from './failsafe.js';
export type { FailsafeTruncationResult } from './failsafe.js';

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

export const DEFAULT_COMPACTION_CONFIG: CortexCompactionConfig = {
  microcompaction: MICROCOMPACTION_DEFAULTS,
  compaction: COMPACTION_DEFAULTS,
  failsafe: FAILSAFE_DEFAULTS,
};

/**
 * Build a full compaction config from partial overrides.
 */
export function buildCompactionConfig(
  partial?: Partial<CortexCompactionConfig>,
): CortexCompactionConfig {
  if (!partial) return DEFAULT_COMPACTION_CONFIG;

  return {
    microcompaction: {
      ...MICROCOMPACTION_DEFAULTS,
      ...partial.microcompaction,
    },
    compaction: {
      ...COMPACTION_DEFAULTS,
      ...partial.compaction,
    },
    failsafe: {
      ...FAILSAFE_DEFAULTS,
      ...partial.failsafe,
    },
  };
}

// ---------------------------------------------------------------------------
// CompactionManager
// ---------------------------------------------------------------------------

/**
 * CompactionManager orchestrates all three compaction layers.
 *
 * It is stateful: it tracks the current token count, the microcompaction
 * cache, and the pipeline phase flag. The CortexAgent creates one instance
 * and delegates all compaction decisions to it.
 */
export class CompactionManager {
  private readonly config: CortexCompactionConfig;
  private readonly microcompaction: MicrocompactionEngine;
  private readonly slotCount: number;

  /** Running session token count, updated after each LLM call. */
  private _sessionTokenCount = 0;

  /** Pipeline phase flag. Controls when Layer 2 can fire. */
  private _pipelinePhase: PipelinePhase = 'idle';

  /** Context window size from the model. */
  private _contextWindow = 0;

  /** Consumer handlers for compaction lifecycle events. */
  private beforeCompactionHandlers: BeforeCompactionHandler[] = [];
  private postCompactionHandlers: PostCompactionHandler[] = [];
  private compactionErrorHandlers: CompactionErrorHandler[] = [];
  private compactionResultHandlers: Array<(result: CompactionResult) => void> = [];

  /** LLM completion function, set by CortexAgent. */
  private completeFn: CompleteFn | null = null;

  constructor(
    config: CortexCompactionConfig,
    slotCount: number,
  ) {
    this.config = config;
    this.slotCount = slotCount;
    this.microcompaction = new MicrocompactionEngine(config.microcompaction);
  }

  // -----------------------------------------------------------------------
  // Configuration
  // -----------------------------------------------------------------------

  /**
   * Set the context window size (from the model's metadata).
   */
  setContextWindow(contextWindow: number): void {
    this._contextWindow = contextWindow;
  }

  /**
   * Set the LLM completion function for Layer 2 summarization.
   */
  setCompleteFn(fn: CompleteFn): void {
    this.completeFn = fn;
  }

  /**
   * Set the current pipeline phase.
   */
  setPipelinePhase(phase: PipelinePhase): void {
    this._pipelinePhase = phase;
  }

  /**
   * Get the current pipeline phase.
   */
  get pipelinePhase(): PipelinePhase {
    return this._pipelinePhase;
  }

  // -----------------------------------------------------------------------
  // Token Tracking
  // -----------------------------------------------------------------------

  /**
   * Update the session token count from LLM usage data.
   */
  updateTokenCount(inputTokens: number): void {
    this._sessionTokenCount = inputTokens;
  }

  /**
   * Get the current session token count.
   */
  get sessionTokenCount(): number {
    return this._sessionTokenCount;
  }

  /**
   * Get the context window size.
   */
  get contextWindow(): number {
    return this._contextWindow;
  }

  /**
   * Get the current context usage ratio.
   */
  get usageRatio(): number {
    if (this._contextWindow <= 0) return 0;
    return this._sessionTokenCount / this._contextWindow;
  }

  // -----------------------------------------------------------------------
  // Event Handlers
  // -----------------------------------------------------------------------

  /**
   * Register a handler called before compaction starts (awaited).
   */
  onBeforeCompaction(handler: BeforeCompactionHandler): void {
    this.beforeCompactionHandlers.push(handler);
  }

  /**
   * Register a handler called after compaction completes.
   */
  onPostCompaction(handler: PostCompactionHandler): void {
    this.postCompactionHandlers.push(handler);
  }

  /**
   * Register a handler called if compaction fails.
   */
  onCompactionError(handler: CompactionErrorHandler): void {
    this.compactionErrorHandlers.push(handler);
  }

  /**
   * Register a handler that receives the CompactionResult (for CortexAgent event emission).
   */
  onCompactionResult(handler: (result: CompactionResult) => void): void {
    this.compactionResultHandlers.push(handler);
  }

  // -----------------------------------------------------------------------
  // Insertion-time cap
  // -----------------------------------------------------------------------

  /**
   * Cap a tool result at insertion time (before it enters conversation history).
   */
  capToolResult(content: string): string {
    return this.microcompaction.capAtInsertion(content);
  }

  // -----------------------------------------------------------------------
  // transformContext hook
  // -----------------------------------------------------------------------

  /**
   * Apply compaction layers to the context in transformContext.
   *
   * This is the main entry point called from CortexAgent.getTransformContextHook().
   * Runs Layer 1 (microcompaction) always, Layer 3 (failsafe) as mid-loop
   * safety valve when needed.
   *
   * Layer 2 is NOT triggered here. It is triggered at end-of-tick by
   * checkAndRunCompaction() called from the pipeline.
   *
   * @param context - The AgentContext from transformContext
   * @param getHistory - Function to get conversation history from the context
   * @returns Modified context with compacted history
   */
  applyInTransformContext(
    context: AgentContext,
    getHistory: (ctx: AgentContext) => AgentMessage[],
    setHistory: (ctx: AgentContext, history: AgentMessage[]) => AgentContext,
  ): AgentContext {
    if (this._contextWindow <= 0) {
      return context;
    }

    let history = getHistory(context);
    if (history.length === 0) {
      return context;
    }

    // Estimate current tokens if we don't have post-hoc data yet
    const currentTokens = this._sessionTokenCount > 0
      ? this._sessionTokenCount
      : this.estimateContextTokens(context);

    // Layer 1: Microcompaction (always runs at threshold crossings)
    history = this.microcompaction.apply(history, this._contextWindow, currentTokens);

    // Layer 3: Mid-loop safety valve (only during agentic loop, at 90%)
    if (this._pipelinePhase === 'agentic_loop') {
      const postMicroTokens = this.estimateHistoryTokens(history);
      const slotTokens = currentTokens - this.estimateHistoryTokens(getHistory(context));
      const totalAfterMicro = slotTokens + postMicroTokens;

      if (shouldTruncate(totalAfterMicro, this._contextWindow, this.config.failsafe.threshold)) {
        const result = emergencyTruncate(
          history,
          this._contextWindow,
          slotTokens,
          this.config.failsafe.threshold,
        );
        history = result.newHistory;
      }
    }

    return setHistory(context, history);
  }

  // -----------------------------------------------------------------------
  // End-of-tick compaction check
  // -----------------------------------------------------------------------

  /**
   * Check if compaction is needed and run it. Called at end-of-tick
   * (after EXECUTE, before the next tick).
   *
   * This is where Layer 2 (summarization) fires. Layer 3 fires as
   * a fallback if Layer 2 fails or is insufficient.
   *
   * @param getHistory - Get current conversation history
   * @param setHistory - Replace conversation history
   * @returns CompactionResult if compaction ran, null otherwise
   */
  async checkAndRunCompaction(
    getHistory: () => AgentMessage[],
    setHistory: (history: AgentMessage[]) => void,
  ): Promise<CompactionResult | null> {
    if (this._contextWindow <= 0) return null;

    // Only allow Layer 2 when idle (between ticks)
    if (this._pipelinePhase !== 'idle') return null;

    const history = getHistory();
    if (history.length === 0) return null;

    const estimatedTokens = this.estimateHistoryTokens(history);

    // Check Layer 2 threshold
    if (!shouldCompact(this._sessionTokenCount, this._contextWindow, this.config.compaction.threshold)) {
      // Also check using heuristic estimation as fallback
      if (!shouldCompact(estimatedTokens, this._contextWindow, this.config.compaction.threshold)) {
        return null;
      }
    }

    // Attempt Layer 2 (summarization)
    if (this.completeFn) {
      try {
        const { newHistory, result } = await runCompaction(
          history,
          this.config.compaction,
          this.completeFn,
          {
            onBeforeCompaction: this.beforeCompactionHandlers,
            onPostCompaction: this.postCompactionHandlers,
            onCompactionError: this.compactionErrorHandlers,
          },
        );

        setHistory(newHistory);
        this.microcompaction.resetCache();

        // Update token count estimate
        this._sessionTokenCount = result.tokensAfter;

        // Emit result
        for (const handler of this.compactionResultHandlers) {
          try {
            handler(result);
          } catch {
            // Swallow handler errors
          }
        }

        return result;

      } catch {
        // Layer 2 failed, fall through to Layer 3
      }
    }

    // Layer 3 fallback: emergency truncation
    const slotTokens = this._sessionTokenCount - estimatedTokens;
    if (shouldTruncate(this._sessionTokenCount, this._contextWindow, this.config.failsafe.threshold)) {
      const result = emergencyTruncate(
        history,
        this._contextWindow,
        Math.max(0, slotTokens),
        this.config.failsafe.threshold,
      );
      setHistory(result.newHistory);
      this.microcompaction.resetCache();
      this._sessionTokenCount = result.tokensAfter;
    }

    return null;
  }

  // -----------------------------------------------------------------------
  // Reactive overflow handling
  // -----------------------------------------------------------------------

  /**
   * Handle a context overflow error by performing emergency truncation.
   * Called when the API returns a context overflow error.
   *
   * @param getHistory - Get current conversation history
   * @param setHistory - Replace conversation history
   */
  handleOverflowError(
    getHistory: () => AgentMessage[],
    setHistory: (history: AgentMessage[]) => void,
  ): void {
    const history = getHistory();
    if (history.length === 0) return;

    const estimatedTokens = this.estimateHistoryTokens(history);
    const slotTokens = Math.max(0, this._sessionTokenCount - estimatedTokens);

    const result = emergencyTruncate(
      history,
      this._contextWindow,
      slotTokens,
      this.config.failsafe.threshold,
    );

    setHistory(result.newHistory);
    this.microcompaction.resetCache();
    this._sessionTokenCount = result.tokensAfter;
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  /**
   * Clear all state and handlers.
   */
  destroy(): void {
    this.microcompaction.resetCache();
    this.beforeCompactionHandlers = [];
    this.postCompactionHandlers = [];
    this.compactionErrorHandlers = [];
    this.compactionResultHandlers = [];
    this.completeFn = null;
    this._sessionTokenCount = 0;
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Estimate tokens for a set of history messages.
   */
  private estimateHistoryTokens(history: AgentMessage[]): number {
    return estimateTokens(
      history.map(m => extractTextContent(m)).join('\n'),
    );
  }

  /**
   * Estimate total context tokens from an AgentContext object.
   */
  private estimateContextTokens(context: AgentContext): number {
    let total = estimateTokens(context.systemPrompt);
    for (const msg of context.messages) {
      total += estimateTokens(extractTextContent(msg));
    }
    return total;
  }
}
