/**
 * Logger interface and utilities for the agent abstraction layer.
 */

/**
 * Logger interface that adapters and manager use for output.
 *
 * Consumers can inject their own logger implementation to integrate
 * with existing logging infrastructure.
 */
export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

/**
 * Log levels for filtering output.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

/**
 * Default console-based logger implementation.
 *
 * Formats output with timestamps and optional context objects.
 */
export const defaultLogger: Logger = {
  debug(message: string, context?: Record<string, unknown>): void {
    if (process.env['LOG_LEVEL'] === 'debug') {
      console.debug(formatMessage('debug', message, context));
    }
  },

  info(message: string, context?: Record<string, unknown>): void {
    console.info(formatMessage('info', message, context));
  },

  warn(message: string, context?: Record<string, unknown>): void {
    console.warn(formatMessage('warn', message, context));
  },

  error(message: string, context?: Record<string, unknown>): void {
    console.error(formatMessage('error', message, context));
  },
};

/**
 * Format a log message with timestamp and optional context.
 */
function formatMessage(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>,
): string {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [agents:${level}]`;

  if (context && Object.keys(context).length > 0) {
    return `${prefix} ${message} ${JSON.stringify(context)}`;
  }

  return `${prefix} ${message}`;
}

/**
 * Create a logger with a tag prefix for component identification.
 *
 * @param tag - Component identifier (e.g., "ClaudeAdapter", "AgentManager")
 * @param base - Base logger to wrap (defaults to defaultLogger)
 * @returns Logger with prefixed messages
 */
export function createTaggedLogger(tag: string, base?: Logger): Logger {
  const logger = base ?? defaultLogger;

  return {
    debug(message: string, context?: Record<string, unknown>): void {
      logger.debug(`[${tag}] ${message}`, context);
    },

    info(message: string, context?: Record<string, unknown>): void {
      logger.info(`[${tag}] ${message}`, context);
    },

    warn(message: string, context?: Record<string, unknown>): void {
      logger.warn(`[${tag}] ${message}`, context);
    },

    error(message: string, context?: Record<string, unknown>): void {
      logger.error(`[${tag}] ${message}`, context);
    },
  };
}

/**
 * Create a silent logger that produces no output.
 *
 * Useful for testing or when logging is not desired.
 */
export function createSilentLogger(): Logger {
  const noop = (): void => {
    /* intentionally empty */
  };

  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
  };
}

/**
 * Create a logger that collects messages for inspection.
 *
 * Useful for testing to verify logging behavior.
 */
export interface CollectedLogEntry {
  level: LogLevel;
  message: string;
  context?: Record<string, unknown> | undefined;
  timestamp: Date;
}

export interface CollectingLogger extends Logger {
  entries: CollectedLogEntry[];
  clear(): void;
}

export function createCollectingLogger(): CollectingLogger {
  const entries: CollectedLogEntry[] = [];

  const collect =
    (level: LogLevel) =>
    (message: string, context?: Record<string, unknown>): void => {
      entries.push({
        level,
        message,
        context,
        timestamp: new Date(),
      });
    };

  return {
    entries,
    debug: collect('debug'),
    info: collect('info'),
    warn: collect('warn'),
    error: collect('error'),
    clear(): void {
      entries.length = 0;
    },
  };
}
