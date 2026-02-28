/**
 * Reasoning effort mapping utilities.
 *
 * Maps unified reasoning effort levels to provider-specific parameters.
 */

/** Unified reasoning effort levels. */
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'max';

/**
 * Map unified reasoning effort to Codex's `model_reasoning_effort` parameter.
 *
 * | Unified | Codex                    |
 * |---------|--------------------------|
 * | low     | low                      |
 * | medium  | medium                   |
 * | high    | high                     |
 * | max     | xhigh                    |
 */
export function getCodexReasoningEffort(level: ReasoningEffort): string {
  switch (level) {
    case 'low': return 'low';
    case 'medium': return 'medium';
    case 'high': return 'high';
    case 'max': return 'xhigh';
  }
}
