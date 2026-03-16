/**
 * Heuristic token estimation.
 *
 * Estimates token count from text using a word-count * 1.3 multiplier.
 * Used for pre-request context size estimation and compaction triggering.
 *
 * This is a duplicate of the same utility in @animus-labs/shared,
 * kept inline to avoid a dependency from cortex to shared.
 */

/**
 * Estimate the number of tokens in a text string.
 *
 * Uses a simple heuristic: split by whitespace, count words, multiply by 1.3.
 * This approximation works well enough for English text and mixed content.
 * It is not a tokenizer; it is a fast estimation for budget decisions.
 *
 * @param text - The text to estimate tokens for
 * @returns Estimated token count (always at least 0, rounded up)
 */
export function estimateTokens(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * 1.3);
}
