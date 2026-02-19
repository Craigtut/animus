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
 * Console-based logger used when no external logger is configured.
 */
const consoleLogger: Logger = {
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
 * Mutable box so `setDefaultLogger()` propagates to all existing tagged loggers.
 *
 * Tagged loggers capture `defaultLogger` by reference, which delegates through
 * the box. Replacing `loggerBox.current` retroactively updates every tagged
 * logger that was created with the default base.
 */
const loggerBox: { current: Logger } = { current: consoleLogger };

/**
 * Default logger instance used by `createTaggedLogger` when no base is provided.
 *
 * Delegates through `loggerBox` so that `setDefaultLogger()` affects all
 * existing tagged loggers, including module-level ones created at import time.
 */
export const defaultLogger: Logger = {
  debug(message: string, context?: Record<string, unknown>): void {
    loggerBox.current.debug(message, context);
  },
  info(message: string, context?: Record<string, unknown>): void {
    loggerBox.current.info(message, context);
  },
  warn(message: string, context?: Record<string, unknown>): void {
    loggerBox.current.warn(message, context);
  },
  error(message: string, context?: Record<string, unknown>): void {
    loggerBox.current.error(message, context);
  },
};

/**
 * Replace the default logger implementation.
 *
 * Call this early in your application startup (before creating an AgentManager)
 * to route all agent package logs through your application's logging infrastructure.
 *
 * This retroactively affects all tagged loggers that were created with the
 * default base — including module-level loggers like ModelRegistry.
 *
 * @param logger - Logger implementation matching the agents Logger interface
 */
export function setDefaultLogger(logger: Logger): void {
  loggerBox.current = logger;
}

/**
 * Format a log message with timestamp and optional context.
 * Used by the built-in console logger as a fallback.
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
