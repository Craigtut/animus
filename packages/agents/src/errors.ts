/**
 * Error types and classes for the agent abstraction layer.
 */

import type { AgentProvider } from '@animus-labs/shared';

/**
 * Classification of agent errors for consistent handling.
 */
export type AgentErrorCategory =
  | 'authentication' // Bad key, expired token
  | 'authorization' // Permission denied
  | 'rate_limit' // Rate limited
  | 'execution' // Tool/code failed
  | 'resource_exhausted' // Max turns, budget, context
  | 'timeout' // Operation timed out
  | 'network' // Connection error
  | 'server_error' // 5xx errors
  | 'not_found' // Resource missing
  | 'invalid_input' // Bad input
  | 'unsupported' // Feature not supported
  | 'cancelled' // User cancelled
  | 'unknown';

/**
 * Severity level for determining retry behavior.
 */
export type AgentErrorSeverity = 'recoverable' | 'fatal' | 'retry';

/**
 * Additional details that may accompany an error.
 */
export interface AgentErrorDetails {
  originalError?: unknown;
  toolName?: string;
  toolInput?: unknown;
  retryAfterMs?: number;
  suggestedAction?: string;
  httpStatus?: number;
  responseBody?: unknown;
}

/**
 * Options for creating an AgentError.
 */
export interface AgentErrorOptions {
  code: string;
  message: string;
  category: AgentErrorCategory;
  severity: AgentErrorSeverity;
  provider: AgentProvider;
  sessionId?: string | undefined;
  details?: AgentErrorDetails | undefined;
  cause?: Error | undefined;
}

/**
 * Unified error class for all agent-related errors.
 *
 * Provides consistent error handling across all three SDKs with
 * categorization for appropriate retry and recovery strategies.
 */
export class AgentError extends Error {
  /** Error code for programmatic handling */
  readonly code: string;

  /** Error category for grouping related errors */
  readonly category: AgentErrorCategory;

  /** Severity determines retry behavior */
  readonly severity: AgentErrorSeverity;

  /** Provider where the error occurred */
  readonly provider: AgentProvider;

  /** Session ID if error occurred within a session */
  readonly sessionId?: string | undefined;

  /** ISO 8601 timestamp when error was created */
  readonly timestamp: string;

  /** Additional error details */
  readonly details?: AgentErrorDetails | undefined;

  constructor(options: AgentErrorOptions) {
    super(options.message, { cause: options.cause });

    this.name = 'AgentError';
    this.code = options.code;
    this.category = options.category;
    this.severity = options.severity;
    this.provider = options.provider;
    this.sessionId = options.sessionId;
    this.timestamp = new Date().toISOString();
    this.details = options.details;

    // Maintain proper stack trace in V8 engines
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AgentError);
    }
  }

  /**
   * Returns true if this error should be retried.
   */
  get isRetryable(): boolean {
    return this.severity === 'retry';
  }

  /**
   * Returns true if this error is fatal and should not be retried.
   */
  get isFatal(): boolean {
    return this.severity === 'fatal';
  }

  /**
   * Serialize error for logging or transmission.
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      category: this.category,
      severity: this.severity,
      provider: this.provider,
      sessionId: this.sessionId,
      timestamp: this.timestamp,
      details: this.details,
      stack: this.stack,
    };
  }

  /**
   * Create a string representation for logging.
   */
  override toString(): string {
    return `[${this.provider}] ${this.code}: ${this.message}`;
  }
}

/**
 * Map HTTP status codes to error categories.
 */
export function httpStatusToCategory(status: number): AgentErrorCategory {
  if (status === 401) return 'authentication';
  if (status === 403) return 'authorization';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limit';
  if (status === 408) return 'timeout';
  if (status >= 400 && status < 500) return 'invalid_input';
  if (status >= 500) return 'server_error';
  return 'unknown';
}

/**
 * Determine severity based on category.
 */
export function categoryToSeverity(category: AgentErrorCategory): AgentErrorSeverity {
  switch (category) {
    case 'authentication':
    case 'authorization':
    case 'invalid_input':
    case 'unsupported':
    case 'not_found':
      return 'fatal';

    case 'rate_limit':
    case 'timeout':
    case 'network':
    case 'server_error':
      return 'retry';

    case 'execution':
    case 'resource_exhausted':
    case 'cancelled':
    case 'unknown':
    default:
      return 'recoverable';
  }
}

/**
 * Create an AgentError from an unknown error.
 */
export function wrapError(
  error: unknown,
  provider: AgentProvider,
  sessionId?: string,
): AgentError {
  if (error instanceof AgentError) {
    return error;
  }

  if (error instanceof Error) {
    return new AgentError({
      code: 'UNKNOWN_ERROR',
      message: error.message,
      category: 'unknown',
      severity: 'recoverable',
      provider,
      sessionId,
      cause: error,
      details: {
        originalError: error,
      },
    });
  }

  return new AgentError({
    code: 'UNKNOWN_ERROR',
    message: String(error),
    category: 'unknown',
    severity: 'recoverable',
    provider,
    sessionId,
    details: {
      originalError: error,
    },
  });
}
