/**
 * Token estimation utility.
 *
 * Approximate but sufficient for budget management — no need for tiktoken precision.
 * From docs/architecture/context-builder.md — "Token counting accuracy"
 */

/**
 * Estimate token count for a string using word-count heuristic.
 */
export function estimateTokens(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * 1.3);
}
