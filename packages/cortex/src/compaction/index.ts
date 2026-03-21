/**
 * Compaction composition: wires all three layers into the transformContext chain.
 *
 * Layer 1 (Microcompaction): tool result trimming at threshold crossings
 * Layer 2 (Compaction): conversation summarization via LLM
 * Layer 3 (Failsafe): emergency truncation, purely mechanical
 *
 * All three layers run inside transformContext, which fires before every LLM
 * call. Compaction is fully self-contained within Cortex; no external calls
 * from the backend are needed to trigger it. Layer 2 fires when token usage
 * exceeds 70% of the context window and a completeFn + source accessors are
 * provided. Layer 3 fires whenever tokens exceed 90% of the model's context
 * window.
 *
 * References:
 *   - compaction-strategy.md
 *   - phase-5-compaction.md (5.5)
 */

import type { AgentMessage, AgentContext } from '../context-manager.js';
import type {
  CortexCompactionConfig,
  AdaptiveThresholdConfig,
  CompactionResult,
  CompactionTarget,
} from '../types.js';
import { estimateTokens } from '../token-estimator.js';
import { MicrocompactionEngine, MICROCOMPACTION_DEFAULTS, extractTextContent, isToolResultMessage, capToolResult } from './microcompaction.js';
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
// computeAdaptiveThreshold is defined below in this file and exported at the declaration site

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

export const ADAPTIVE_DEFAULTS: AdaptiveThresholdConfig = {
  enabled: true,
  recentWindowMs: 300_000,     // 5 minutes
  idleWindowMs: 1_800_000,     // 30 minutes
  recentReduction: 0.0,        // no change when recent
  moderateReduction: 0.10,     // lower threshold by 0.10 when moderately idle
  idleReduction: 0.20,         // lower threshold by 0.20 when fully idle
};

export const DEFAULT_COMPACTION_CONFIG: CortexCompactionConfig = {
  microcompaction: MICROCOMPACTION_DEFAULTS,
  compaction: COMPACTION_DEFAULTS,
  failsafe: FAILSAFE_DEFAULTS,
  adaptive: ADAPTIVE_DEFAULTS,
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
    adaptive: {
      ...ADAPTIVE_DEFAULTS,
      ...partial.adaptive,
    },
  };
}

// ---------------------------------------------------------------------------
// Adaptive threshold calculation
// ---------------------------------------------------------------------------

/**
 * Compute the effective Layer 2 compaction threshold adjusted by interaction
 * recency. When the user has not interacted recently, the threshold is lowered
 * (i.e., compaction fires sooner), reducing token costs for idle sessions.
 *
 * @param baseThreshold - The configured Layer 2 threshold (e.g., 0.70)
 * @param adaptiveConfig - Adaptive threshold configuration
 * @param lastInteractionTime - Timestamp (ms) of the last user interaction, or null if never
 * @param now - Current timestamp (ms), injectable for testing
 * @returns The adjusted threshold (always >= 0)
 */
export function computeAdaptiveThreshold(
  baseThreshold: number,
  adaptiveConfig: AdaptiveThresholdConfig,
  lastInteractionTime: number | null,
  now: number = Date.now(),
): number {
  if (!adaptiveConfig.enabled) {
    return baseThreshold;
  }

  // No interaction recorded yet: treat as fully idle
  if (lastInteractionTime === null) {
    return Math.max(0, baseThreshold - adaptiveConfig.idleReduction);
  }

  const elapsed = now - lastInteractionTime;

  if (elapsed < adaptiveConfig.recentWindowMs) {
    // Recent interaction: apply recentReduction (default 0, no change)
    return Math.max(0, baseThreshold - adaptiveConfig.recentReduction);
  }

  if (elapsed < adaptiveConfig.idleWindowMs) {
    // Moderate idle: apply moderateReduction
    return Math.max(0, baseThreshold - adaptiveConfig.moderateReduction);
  }

  // Fully idle: apply idleReduction
  return Math.max(0, baseThreshold - adaptiveConfig.idleReduction);
}

// ---------------------------------------------------------------------------
// CompactionManager
// ---------------------------------------------------------------------------

/**
 * CompactionManager orchestrates all three compaction layers.
 *
 * It is stateful: it tracks the current token count and the microcompaction
 * cache. The CortexAgent creates one instance and delegates all compaction
 * decisions to it. Compaction is fully autonomous: all three layers run
 * inside applyInTransformContext(), which fires before every LLM call.
 */
export class CompactionManager {
  private readonly config: CortexCompactionConfig;
  private readonly microcompaction: MicrocompactionEngine;
  private readonly slotCount: number;

  /** Running session token count, updated after each LLM call. */
  private _sessionTokenCount = 0;

  /** Context budget for Layer 1/2 compaction decisions (may be artificially limited). */
  private _contextWindow = 0;

  /** Actual model context window for Layer 3 failsafe (never artificially limited). */
  private _modelContextWindow = 0;

  /**
   * Timestamp (ms) of the last user interaction. Used by the adaptive
   * threshold system to decide how aggressively to compact. Updated by
   * the consumer (backend) when a message-triggered tick fires.
   * Null means no interaction has been recorded yet.
   */
  private _lastInteractionTime: number | null = null;

  /** Consumer handlers for compaction lifecycle events. */
  private beforeCompactionHandlers: BeforeCompactionHandler[] = [];
  private postCompactionHandlers: PostCompactionHandler[] = [];
  private compactionErrorHandlers: CompactionErrorHandler[] = [];
  private compactionResultHandlers: Array<(result: CompactionResult) => void> = [];

  /** LLM completion function, set by CortexAgent. */
  private completeFn: CompleteFn | null = null;

  /** Optional debug log callback, wired by consumer for diagnostics. */
  _debugLog: ((msg: string) => void) | null = null;

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
   * Set the context budget (the effective limit for Layer 1/2 compaction).
   * This may be smaller than the model's actual context window when a
   * user-configured limit is applied.
   */
  setContextWindow(contextWindow: number): void {
    this._contextWindow = contextWindow;
  }

  /**
   * Set the model's actual context window (for Layer 3 failsafe only).
   * Layer 3 emergency truncation uses this to avoid dropping messages
   * when the model still has capacity, even if the user-configured
   * budget has been exceeded.
   */
  setModelContextWindow(modelContextWindow: number): void {
    this._modelContextWindow = modelContextWindow;
  }

  /**
   * Set the LLM completion function for Layer 2 summarization.
   */
  setCompleteFn(fn: CompleteFn): void {
    this.completeFn = fn;
  }

  /**
   * Set a debug log callback for compaction diagnostics.
   * The consumer wires this to their logging system.
   */
  setDebugLog(fn: (msg: string) => void): void {
    this._debugLog = fn;
  }

  /**
   * Signal when the user last interacted with the system.
   * The consumer (backend) calls this during GATHER when a message-triggered
   * tick fires. For interval ticks, it is not called, so the timestamp
   * naturally ages.
   */
  setLastInteractionTime(timestamp: number): void {
    this._lastInteractionTime = timestamp;
  }

  /**
   * Get the timestamp of the last user interaction, or null if none recorded.
   */
  get lastInteractionTime(): number | null {
    return this._lastInteractionTime;
  }

  /**
   * Compute the effective Layer 2 compaction threshold, adjusted for
   * interaction recency when adaptive thresholds are enabled.
   *
   * @param now - Current timestamp (ms), injectable for testing
   */
  getEffectiveThreshold(now?: number): number {
    return computeAdaptiveThreshold(
      this.config.compaction.threshold,
      this.config.adaptive,
      this._lastInteractionTime,
      now,
    );
  }

  // -----------------------------------------------------------------------
  // Token Tracking
  // -----------------------------------------------------------------------

  /**
   * Update the session token count from LLM usage data.
   */
  updateTokenCount(inputTokens: number): void {
    this._debugLog?.(`updateTokenCount: ${inputTokens}`);
    this._sessionTokenCount = inputTokens;
  }

  /**
   * Get the current session token count.
   */
  get sessionTokenCount(): number {
    return this._sessionTokenCount;
  }

  /**
   * Get the context budget (effective limit for Layer 1/2).
   */
  get contextWindow(): number {
    return this._contextWindow;
  }

  /**
   * Get the model's actual context window (for Layer 3 failsafe).
   */
  get modelContextWindow(): number {
    return this._modelContextWindow;
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

  /**
   * Apply insertion-time cap to all uncapped tool results in the source
   * messages array (mutates in place).
   *
   * Called from the transformContext hook on `agent.state.messages` so that
   * Tier 1 capping is automatically applied when tool results enter
   * conversation history through pi-agent-core's internal tool execution
   * loop. The cap is applied at most once per tool result part; already
   * capped content (containing the insertion marker) is skipped.
   *
   * @param messages - The source messages array (mutated in place)
   * @param slotCount - Number of slot messages to skip at the start
   */
  applyInsertionCap(messages: AgentMessage[], slotCount: number): void {
    const config = this.microcompaction.getConfig();
    for (let i = slotCount; i < messages.length; i++) {
      const msg = messages[i]!;
      if (!isToolResultMessage(msg)) continue;
      if (typeof msg.content === 'string') continue;

      let modified = false;
      const newContent = msg.content.map(part => {
        if (part.type !== 'tool_result' || typeof part.text !== 'string') {
          return part;
        }
        // Skip already-capped content
        if (part.text.includes('tokens trimmed at insertion')) {
          return part;
        }
        const capped = capToolResult(part.text, config);
        if (capped !== part.text) {
          modified = true;
          return { ...part, text: capped };
        }
        return part;
      });

      if (modified) {
        messages[i] = { ...msg, content: newContent };
      }
    }
  }

  // -----------------------------------------------------------------------
  // transformContext hook
  // -----------------------------------------------------------------------

  /**
   * Apply compaction layers to the context in transformContext.
   *
   * This is the main entry point called from CortexAgent.getTransformContextHook().
   * It is fully self-contained: all three compaction layers are integrated here,
   * triggered autonomously based on token thresholds. No external calls from
   * the backend are needed to trigger compaction.
   *
   * Execution order:
   * 1. Layer 1 (microcompaction): tool result trimming at threshold crossings
   * 2. Layer 2 (summarization): if tokens exceed 70% after Layer 1, run LLM
   *    summarization on agent.state.messages (the original transcript), then
   *    rebuild context from the updated messages
   * 3. Layer 3 (failsafe): if tokens still exceed 90% after Layers 1-2,
   *    emergency truncation drops the oldest turns
   *
   * @param context - The AgentContext from transformContext
   * @param getHistory - Function to get conversation history from the context
   * @param setHistory - Function to set conversation history in the context
   * @param getSourceHistory - Function to get the original transcript history (agent.state.messages post-slot)
   * @param setSourceHistory - Function to replace the original transcript history (agent.state.messages)
   * @returns Modified context with compacted history
   */
  async applyInTransformContext(
    context: AgentContext,
    getHistory: (ctx: AgentContext) => AgentMessage[],
    setHistory: (ctx: AgentContext, history: AgentMessage[]) => AgentContext,
    getSourceHistory?: () => AgentMessage[],
    setSourceHistory?: (history: AgentMessage[]) => void,
  ): Promise<AgentContext> {
    if (this._contextWindow <= 0) {
      // contextWindow not set, skip compaction
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

    this._debugLog?.(`transformContext: historyLen=${history.length}, sessionTokens=${this._sessionTokenCount}, heuristic=${this.estimateContextTokens(context)}, currentTokens=${currentTokens}, ctxWindow=${this._contextWindow}`);

    // Layer 1: Microcompaction (always runs at threshold crossings)
    history = this.microcompaction.apply(history, this._contextWindow, currentTokens);

    // Layer 2: Conversation summarization (70% threshold)
    // Operates on the original transcript (agent.state.messages), not the
    // in-memory microcompacted context. After Layer 2 modifies the source,
    // we rebuild the context from the updated messages.
    const postMicroTokens = this.estimateHistoryTokens(history);
    const slotTokens = currentTokens - this.estimateHistoryTokens(getHistory(context));
    const totalAfterMicro = slotTokens + postMicroTokens;

    const effectiveThreshold = this.getEffectiveThreshold();

    this._debugLog?.(`Layer2: totalAfterMicro=${totalAfterMicro}, threshold=${effectiveThreshold}, ratio=${(totalAfterMicro / this._contextWindow).toFixed(3)}, completeFn=${!!this.completeFn}, srcAccessors=${!!getSourceHistory && !!setSourceHistory}, shouldCompact=${shouldCompact(totalAfterMicro, this._contextWindow, effectiveThreshold)}`);

    if (
      this.completeFn &&
      getSourceHistory &&
      setSourceHistory &&
      shouldCompact(totalAfterMicro, this._contextWindow, effectiveThreshold)
    ) {
      try {
        const sourceHistory = getSourceHistory();
        if (sourceHistory.length > 0) {
          const { newHistory: compactedSource, result } = await runCompaction(
            sourceHistory,
            this.config.compaction,
            this.completeFn,
            {
              onBeforeCompaction: this.beforeCompactionHandlers,
              onPostCompaction: this.postCompactionHandlers,
              onCompactionError: this.compactionErrorHandlers,
            },
          );

          // Update the source transcript
          setSourceHistory(compactedSource);
          this.microcompaction.resetCache();

          // Update token count estimate
          this._sessionTokenCount = result.tokensAfter;

          // Emit result to CortexAgent event handlers
          for (const handler of this.compactionResultHandlers) {
            try {
              handler(result);
            } catch {
              // Swallow handler errors
            }
          }

          // Rebuild context from updated source: re-apply microcompaction
          // on the now-shorter history
          history = this.microcompaction.apply(
            compactedSource,
            this._contextWindow,
            result.tokensAfter,
          );
        }
      } catch {
        // Layer 2 failed, fall through to Layer 3
      }
    }

    // Layer 3: Emergency truncation (90% of model context window)
    // Uses the MODEL's actual context window, not the budget. Emergency
    // truncation should only fire when we're near the model's real limit,
    // not the user's artificial budget. Layer 1/2 handle the budget.
    {
      const failsafeWindow = this._modelContextWindow > 0 ? this._modelContextWindow : this._contextWindow;
      const postLayerTokens = this.estimateHistoryTokens(history);
      const totalNow = slotTokens + postLayerTokens;

      if (shouldTruncate(totalNow, failsafeWindow, this.config.failsafe.threshold)) {
        const result = emergencyTruncate(
          history,
          failsafeWindow,
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
   * Manually check if compaction is needed and run it.
   *
   * This is a convenience API for consumers who want to trigger compaction
   * outside the agentic loop (e.g., for testing or manual maintenance).
   * The primary compaction trigger is `applyInTransformContext`, which runs
   * automatically before every LLM call.
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

    const history = getHistory();
    if (history.length === 0) return null;

    const estimatedTokens = this.estimateHistoryTokens(history);

    // Use adaptive threshold (adjusts based on interaction recency)
    const effectiveThreshold = this.getEffectiveThreshold();

    // Check Layer 2 threshold
    if (!shouldCompact(this._sessionTokenCount, this._contextWindow, effectiveThreshold)) {
      // Also check using heuristic estimation as fallback
      if (!shouldCompact(estimatedTokens, this._contextWindow, effectiveThreshold)) {
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

    // Layer 3 fallback: emergency truncation (uses model's actual window)
    const failsafeWindow = this._modelContextWindow > 0 ? this._modelContextWindow : this._contextWindow;
    const slotTokens = this._sessionTokenCount - estimatedTokens;
    if (shouldTruncate(this._sessionTokenCount, failsafeWindow, this.config.failsafe.threshold)) {
      const result = emergencyTruncate(
        history,
        failsafeWindow,
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

    // API returned overflow error, so use the model's actual window
    const failsafeWindow = this._modelContextWindow > 0 ? this._modelContextWindow : this._contextWindow;
    const estimatedTokens = this.estimateHistoryTokens(history);
    const slotTokens = Math.max(0, this._sessionTokenCount - estimatedTokens);

    const result = emergencyTruncate(
      history,
      failsafeWindow,
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
    this._lastInteractionTime = null;
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
