/**
 * Layer 3: Emergency Truncation (Failsafe).
 *
 * Last-resort truncation when Layer 2 fails or context is still too large.
 * Drops the oldest conversation turns purely mechanically (no LLM call).
 * Preserves structural integrity: tool_use/tool_result pairs are dropped together.
 *
 * Triggers at 90% of context window (configurable), or reactively when
 * the API returns a context overflow error.
 *
 * This layer also serves as a mid-loop safety valve: it fires inside
 * transformContext during the agentic loop when estimated token count
 * exceeds 90%. Mid-loop truncation does NOT emit onBeforeCompaction
 * (no observational memory processing mid-loop).
 *
 * References:
 *   - compaction-strategy.md (Layer 3: Emergency Truncation)
 *   - phase-5-compaction.md (5.4)
 */

import type { AgentMessage } from '../context-manager.js';
import type { FailsafeConfig } from '../types.js';
import { estimateTokens } from '../token-estimator.js';
import { isToolResultMessage, isToolUseMessage, extractTextContent } from './microcompaction.js';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const FAILSAFE_DEFAULTS: FailsafeConfig = {
  threshold: 0.90,
};

/**
 * Minimum number of recent turns to preserve during emergency truncation.
 * Fewer turns preserved than Layer 2 since this is a last resort.
 */
const FAILSAFE_PRESERVE_TURNS = 3;

// ---------------------------------------------------------------------------
// Truncation
// ---------------------------------------------------------------------------

/**
 * Result of an emergency truncation operation.
 */
export interface FailsafeTruncationResult {
  /** The truncated conversation history. */
  newHistory: AgentMessage[];
  /** Number of turns removed. */
  turnsRemoved: number;
  /** Estimated tokens after truncation. */
  tokensAfter: number;
}

/**
 * Find structural pairs in conversation history.
 * A tool_use message and its corresponding tool_result form a pair.
 * When dropping one, we must drop both.
 *
 * Returns indices that should be dropped together for each index.
 * If a message at index i is part of a pair, pairMap[i] contains
 * all indices in that pair.
 */
function findStructuralPairs(history: AgentMessage[]): Map<number, number[]> {
  const pairMap = new Map<number, number[]>();

  for (let i = 0; i < history.length; i++) {
    const msg = history[i]!;

    if (isToolUseMessage(msg)) {
      // Look for the corresponding tool_result in the next message
      if (i + 1 < history.length && isToolResultMessage(history[i + 1]!)) {
        const pair = [i, i + 1];
        pairMap.set(i, pair);
        pairMap.set(i + 1, pair);
      }
    }
  }

  return pairMap;
}

/**
 * Perform emergency truncation on conversation history.
 *
 * Drops the oldest turns (preserving structural pairs) until the
 * estimated token count drops below the threshold, or until only
 * the preserved tail remains.
 *
 * @param history - Conversation history (post-slot region)
 * @param contextWindow - Total context window size in tokens
 * @param slotTokens - Estimated tokens used by slots
 * @param threshold - Usage ratio threshold (default 0.90)
 * @returns Truncation result with new history and metrics
 */
export function emergencyTruncate(
  history: AgentMessage[],
  contextWindow: number,
  slotTokens: number,
  threshold: number = FAILSAFE_DEFAULTS.threshold,
): FailsafeTruncationResult {
  if (history.length === 0) {
    return { newHistory: [], turnsRemoved: 0, tokensAfter: slotTokens };
  }

  const targetTokens = contextWindow * threshold;
  const pairMap = findStructuralPairs(history);
  const dropped = new Set<number>();

  // Calculate initial token estimate
  let currentTokens = slotTokens + estimateTokens(
    history.map(m => extractTextContent(m)).join('\n'),
  );

  // Drop from the front, but respect the preserved tail
  const preserveFrom = Math.max(0, history.length - FAILSAFE_PRESERVE_TURNS);
  let i = 0;

  while (currentTokens > targetTokens && i < preserveFrom) {
    if (dropped.has(i)) {
      i++;
      continue;
    }

    // Get all indices that must be dropped together
    const pair = pairMap.get(i);
    const indicesToDrop = pair ?? [i];

    // Check that none of the pair indices are in the preserved tail
    const canDrop = indicesToDrop.every(idx => idx < preserveFrom);
    if (!canDrop) {
      i++;
      continue;
    }

    // Drop the turn(s)
    for (const idx of indicesToDrop) {
      const msgTokens = estimateTokens(extractTextContent(history[idx]!));
      currentTokens -= msgTokens;
      dropped.add(idx);
    }

    i++;
  }

  // Build new history excluding dropped messages
  const newHistory = history.filter((_, idx) => !dropped.has(idx));

  return {
    newHistory,
    turnsRemoved: dropped.size,
    tokensAfter: currentTokens,
  };
}

/**
 * Check if emergency truncation should fire based on token count.
 */
export function shouldTruncate(
  currentTokens: number,
  contextWindow: number,
  threshold: number = FAILSAFE_DEFAULTS.threshold,
): boolean {
  if (contextWindow <= 0) return false;
  return (currentTokens / contextWindow) >= threshold;
}

/**
 * Check if an error represents a context overflow.
 * Matches common API error patterns from various providers.
 */
export function isContextOverflow(error: Error): boolean {
  const msg = error.message.toLowerCase();
  return (
    msg.includes('context_length_exceeded') ||
    msg.includes('context window') ||
    msg.includes('maximum context length') ||
    msg.includes('token limit') ||
    msg.includes('too many tokens') ||
    msg.includes('request too large') ||
    msg.includes('prompt is too long') ||
    msg.includes('input too long')
  );
}
