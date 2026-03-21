/**
 * Token estimation utility.
 *
 * Uses character-based heuristic (chars / 4), the community standard and
 * closest to Anthropic's official recommendation (chars / 3.5).
 * Character-based is more stable than word-based across content types
 * (prose, code, JSON, markdown).
 *
 * Approximate but sufficient for budget management and compaction triggers.
 * For exact counts, use the Anthropic count_tokens API.
 */

/**
 * Estimate token count for a string using character-count heuristic.
 * Uses chars / 4 (community standard, ~15% underestimate for Claude).
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
