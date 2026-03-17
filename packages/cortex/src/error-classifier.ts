/**
 * Error classifier for LLM and network errors.
 *
 * Maps error strings to actionable categories using regex pattern matching.
 * Follows the same pattern pi-ai uses for context overflow detection,
 * extended to cover authentication, rate limits, server errors, and network errors.
 *
 * The classifier is a pure function. It does not throw, does not modify state.
 * It takes an error (or error string) and returns a classification.
 *
 * Reference: error-recovery.md
 */

import type { ClassifiedError, ErrorCategory, ErrorSeverity } from './types.js';

// ---------------------------------------------------------------------------
// Pattern definitions per category (checked in priority order)
// ---------------------------------------------------------------------------

const AUTHENTICATION_PATTERNS: RegExp[] = [
  /invalid.api.key/i,
  /unauthorized/i,
  /not.logged.in/i,
  /authentication.required/i,
  /expired.*token/i,
  /invalid.*credentials/i,
  /api.key.*invalid/i,
  /permission.denied.*key/i,
  /Could not resolve API key/i,
];

const RATE_LIMIT_PATTERNS: RegExp[] = [
  /rate.limit/i,
  /too.many.requests/i,
  /\b429\b/,
  /rate_limit_exceeded/i,
  /throttl/i,
  /request.limit.reached/i,
  /quota.exceeded/i,
];

// Full context overflow detection delegates to pi-ai's isContextOverflow() when available.
// These minimal patterns serve as a fallback when pi-ai is not installed.
const CONTEXT_OVERFLOW_PATTERNS: RegExp[] = [
  /context.*overflow/i,
  /too.many.tokens/i,
  /token.limit/i,
  /prompt.is.too.long/i,
];

const SERVER_ERROR_PATTERNS: RegExp[] = [
  /internal.server.error/i,
  /\b500\b/,
  /\b502\b.*bad.gateway/i,
  /\b503\b.*service.unavailable/i,
  /\b504\b.*gateway.timeout/i,
  /server.*error/i,
  /overloaded/i,
];

const NETWORK_PATTERNS: RegExp[] = [
  /ECONNREFUSED/,
  /ENOTFOUND/,
  /ETIMEDOUT/,
  /ECONNRESET/,
  /network.*error/i,
  /fetch.failed/i,
  /socket.hang.up/i,
  /DNS.*resolution/i,
];

// ---------------------------------------------------------------------------
// Severity and action mappings
// ---------------------------------------------------------------------------

const SEVERITY_MAP: Record<ErrorCategory, ErrorSeverity> = {
  authentication: 'fatal',
  rate_limit: 'retry',
  context_overflow: 'recoverable',
  server_error: 'retry',
  network: 'retry',
  cancelled: 'recoverable',
  unknown: 'recoverable',
};

const SUGGESTED_ACTIONS: Record<ErrorCategory, string | undefined> = {
  authentication: 'Check your API key or re-authenticate in Settings.',
  rate_limit: 'Rate limit hit. The next tick will be delayed.',
  context_overflow: 'Context window exceeded. Compaction will run.',
  server_error: 'The provider is experiencing issues. Retrying.',
  network: 'Network error. Check your connection.',
  cancelled: undefined,
  unknown: undefined,
};

// ---------------------------------------------------------------------------
// Pattern matching helpers
// ---------------------------------------------------------------------------

function matchesAny(message: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(message));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Options for the error classifier.
 */
export interface ClassifyErrorOptions {
  /**
   * The model's context window size in tokens.
   * Used for context overflow detection when delegating to pi-ai.
   */
  contextWindow?: number;

  /**
   * Whether the agent was aborted (user or system cancellation).
   * When true, the error is immediately classified as 'cancelled'.
   * The caller checks agent.state or AbortSignal.aborted and passes this flag;
   * the classifier itself remains pure.
   */
  wasAborted?: boolean;
}

/**
 * Classify an error into an actionable category.
 *
 * Checks error strings against regex patterns in priority order (first match wins):
 * 1. Cancelled (if wasAborted is true)
 * 2. Authentication (9 patterns)
 * 3. Rate limit (7 patterns)
 * 4. Context overflow (4 fallback patterns; delegates to pi-ai isContextOverflow when available)
 * 5. Server error (7 patterns)
 * 6. Network (8 patterns)
 * 7. Unknown (catch-all)
 *
 * @param error - The error to classify (Error object or string)
 * @param options - Optional classification options
 * @returns A ClassifiedError with category, severity, original message, and suggested action
 */
export function classifyError(
  error: Error | string,
  options?: ClassifyErrorOptions,
): ClassifiedError {
  const message = typeof error === 'string' ? error : error.message;

  // 1. Cancelled (highest priority if wasAborted flag is set)
  if (options?.wasAborted) {
    return buildResult('cancelled', message);
  }

  // 2. Authentication
  if (matchesAny(message, AUTHENTICATION_PATTERNS)) {
    return buildResult('authentication', message);
  }

  // 3. Rate limit
  if (matchesAny(message, RATE_LIMIT_PATTERNS)) {
    return buildResult('rate_limit', message);
  }

  // 4. Context overflow
  // Uses built-in patterns. In Phase 1B, this will also delegate to
  // pi-ai's isContextOverflow() when available.
  if (matchesAny(message, CONTEXT_OVERFLOW_PATTERNS)) {
    return buildResult('context_overflow', message);
  }

  // 5. Server error
  if (matchesAny(message, SERVER_ERROR_PATTERNS)) {
    return buildResult('server_error', message);
  }

  // 6. Network
  if (matchesAny(message, NETWORK_PATTERNS)) {
    return buildResult('network', message);
  }

  // 7. Unknown (catch-all)
  return buildResult('unknown', message);
}

/**
 * Build a ClassifiedError from a category and original message.
 */
function buildResult(category: ErrorCategory, originalMessage: string): ClassifiedError {
  const action = SUGGESTED_ACTIONS[category];
  const result: ClassifiedError = {
    category,
    severity: SEVERITY_MAP[category],
    originalMessage,
  };
  if (action !== undefined) {
    result.suggestedAction = action;
  }
  return result;
}
