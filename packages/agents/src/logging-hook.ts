/**
 * Event logging hook for agent sessions.
 *
 * Provides a hook that can be attached to any agent session to automatically
 * log all events to agent_logs.db via the agent-log-store functions.
 *
 * This bridges the @animus/agents package with the backend's logging store.
 * The backend passes in its store functions; this module knows nothing about
 * better-sqlite3 or the database directly.
 */

import type { AgentProvider } from '@animus/shared';
import type {
  AgentEvent,
  AgentEventHandler,
  IAgentSession,
  SessionUsage,
  AgentCost,
} from './types.js';
import { createTaggedLogger, type Logger } from './logger.js';

/**
 * Interface for the logging store functions that the backend provides.
 *
 * These match the signatures in agent-log-store.ts but are decoupled
 * so the agents package doesn't depend on better-sqlite3.
 */
export interface AgentLogStore {
  createSession(data: {
    provider: AgentProvider;
    model?: string | null;
  }): { id: string };

  endSession(id: string, status: 'completed' | 'error' | 'cancelled'): void;

  insertEvent(data: {
    sessionId: string;
    eventType: string;
    data?: Record<string, unknown>;
  }): void;

  insertUsage(data: {
    sessionId: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd?: number | null;
    model: string;
  }): void;
}

/**
 * Options for the logging hook.
 */
export interface LoggingHookOptions {
  /** The log store to write events to */
  store: AgentLogStore;

  /** Custom logger instance */
  logger?: Logger;

  /**
   * Whether to log response_chunk events.
   * These can be very high volume; defaults to false.
   */
  logChunks?: boolean;
}

/**
 * State tracked per session by the logging hook.
 */
interface SessionLogState {
  logSessionId: string;
  provider: AgentProvider;
  model: string;
}

/**
 * Create a logging event handler that persists all agent events to the log store.
 *
 * Attach this to a session via `session.onEvent(handler)`.
 *
 * @example
 * ```typescript
 * const handler = createLoggingHandler({
 *   store: myLogStore,
 * });
 *
 * const session = await manager.createSession({ provider: 'claude' });
 * session.onEvent(handler);
 * ```
 */
export function createLoggingHandler(options: LoggingHookOptions): {
  handler: AgentEventHandler;
  getLogSessionId: () => string | null;
} {
  const logger = options.logger ?? createTaggedLogger('LoggingHook');
  const logChunks = options.logChunks ?? false;
  let state: SessionLogState | null = null;

  const handler: AgentEventHandler = async (event: AgentEvent) => {
    try {
      // Initialize log session on first event of any type.
      // This handles the case where the handler is attached after session_start
      // (e.g., attaching to a warm/reused session).
      if (!state) {
        let provider: AgentProvider = 'claude';
        let model = 'unknown';

        // session_start events have provider/model in data
        if (event.type === 'session_start') {
          const startData = event.data as { provider?: AgentProvider; model?: string };
          provider = startData.provider ?? provider;
          model = startData.model ?? model;
        } else if (event.sessionId?.includes(':')) {
          // Extract provider from session ID format "provider:nativeId"
          const colonIdx = event.sessionId.indexOf(':');
          provider = event.sessionId.slice(0, colonIdx) as AgentProvider;
        }

        const logSession = options.store.createSession({
          provider,
          model,
        });

        state = {
          logSessionId: logSession.id,
          provider,
          model,
        };

        logger.debug('Log session created', {
          logSessionId: state.logSessionId,
          agentSessionId: event.sessionId,
          triggerEvent: event.type,
        });
      }

      // Skip high-volume chunk events unless explicitly enabled
      if (event.type === 'response_chunk' && !logChunks) {
        return;
      }

      // Log the event
      options.store.insertEvent({
        sessionId: state.logSessionId,
        eventType: event.type,
        data: event.data as Record<string, unknown>,
      });

      // On session_end, finalize the log session
      if (event.type === 'session_end') {
        const endData = event.data as { reason?: string };
        const status = mapEndReasonToStatus(endData.reason);

        options.store.endSession(state.logSessionId, status);

        logger.debug('Log session ended', {
          logSessionId: state.logSessionId,
          status,
        });
      }
    } catch (error) {
      // Logging failures should never break the session
      logger.error('Failed to log event', {
        eventType: event.type,
        error: String(error),
      });
    }
  };

  return {
    handler,
    getLogSessionId: () => state?.logSessionId ?? null,
  };
}

/**
 * Log usage data for a session.
 *
 * Call this after a prompt completes to record token usage.
 */
export function logSessionUsage(
  store: AgentLogStore,
  logSessionId: string,
  usage: SessionUsage,
  cost: AgentCost | null,
  model: string,
): void {
  store.insertUsage({
    sessionId: logSessionId,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    costUsd: cost?.totalCostUsd ?? null,
    model,
  });
}

/**
 * Attach logging to a session.
 *
 * Convenience function that attaches the logging handler and returns
 * a function to log usage after prompts.
 *
 * @example
 * ```typescript
 * const session = await manager.createSession({ provider: 'claude' });
 * const logging = attachSessionLogging(session, { store: myLogStore });
 *
 * const response = await session.prompt('Hello');
 * logging.logUsage(response.usage, response.cost ?? null, response.model);
 * ```
 */
export function attachSessionLogging(
  session: IAgentSession,
  options: LoggingHookOptions,
): {
  logUsage: (usage: SessionUsage, cost: AgentCost | null, model: string) => void;
  getLogSessionId: () => string | null;
} {
  const { handler, getLogSessionId } = createLoggingHandler(options);
  session.onEvent(handler);

  return {
    logUsage: (usage: SessionUsage, cost: AgentCost | null, model: string) => {
      const logSessionId = getLogSessionId();
      if (logSessionId) {
        logSessionUsage(options.store, logSessionId, usage, cost, model);
      }
    },
    getLogSessionId,
  };
}

/**
 * Map session end reason to log store status.
 */
function mapEndReasonToStatus(reason?: string): 'completed' | 'error' | 'cancelled' {
  switch (reason) {
    case 'error':
      return 'error';
    case 'cancelled':
    case 'timeout':
      return 'cancelled';
    case 'completed':
    default:
      return 'completed';
  }
}
