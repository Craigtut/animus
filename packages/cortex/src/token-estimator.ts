/**
 * Heuristic token estimation.
 *
 * Uses character-based heuristic (chars / 4), the community standard and
 * closest to Anthropic's official recommendation (chars / 3.5).
 * Character-based is more stable than word-based across content types
 * (prose, code, JSON, markdown).
 *
 * This is a duplicate of the same utility in @animus-labs/shared,
 * kept inline to avoid a dependency from cortex to shared.
 */

/**
 * Estimate the number of tokens in a text string.
 *
 * Uses chars / 4 heuristic (community standard, ~15% underestimate for Claude).
 * Not a tokenizer; a fast estimation for budget decisions and compaction triggers.
 * For exact counts, use the Anthropic count_tokens API.
 *
 * @param text - The text to estimate tokens for
 * @returns Estimated token count (always at least 0, rounded up)
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
