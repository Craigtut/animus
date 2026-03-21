/**
 * Cortex Event Log Bridge
 *
 * Bridges CortexAgent EventBridge events to agent_logs.db, enabling the
 * Heartbeats timeline to display SDK-level events (tool calls, responses,
 * session lifecycle) for Cortex-powered ticks.
 *
 * Subscribes to CortexAgent events and writes them to agent_logs.db using
 * the same schema as the rest of the system.
 *
 * Skipped events:
 * - response_chunk: excluded from timeline query (too noisy), and the
 *   reply:chunk EventBus emission is already handled in cortex-pipeline.ts
 * - turn_start: no matching AgentEventType in the schema
 */

import type { CortexAgent, CortexEvent } from '@animus-labs/cortex';
import type { AgentEventType, IEventBus } from '@animus-labs/shared';

import { getAgentLogsDb } from '../db/index.js';
import * as agentLogStore from '../db/stores/agent-log-store.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('CortexLogBridge', 'heartbeat');

export interface CortexLoggingConfig {
  sessionId: string;
  eventBus: IEventBus;
  provider?: string;
  model?: string;
}

/**
 * Attach event logging to a CortexAgent's EventBridge.
 *
 * Subscribes to all EventBridge events and persists them to agent_logs.db
 * with the same AgentEventType values the legacy path uses. Also emits
 * agent:event:logged on the EventBus for live timeline updates.
 *
 * @returns Object with detach() to clean up the subscription.
 */
export function attachCortexLogging(
  cortexAgent: CortexAgent,
  config: CortexLoggingConfig,
): { detach: () => void } {
  const { sessionId, eventBus, provider, model } = config;

  // Track tool_call_start timestamps for computing duration on tool_call_end
  const toolStartTimes = new Map<string, number>();

  const unsub = cortexAgent.getEventBridge().onAll((event: CortexEvent) => {
    try {
      const mapped = mapCortexEvent(event, { provider, model, toolStartTimes });
      if (!mapped) return;

      const agentLogsDb = getAgentLogsDb();
      const stored = agentLogStore.insertEvent(agentLogsDb, {
        sessionId,
        eventType: mapped.eventType,
        data: mapped.data,
      });

      eventBus.emit('agent:event:logged', {
        id: stored.id,
        sessionId: stored.sessionId,
        eventType: stored.eventType,
        data: stored.data,
        createdAt: stored.createdAt,
      });
    } catch (err) {
      // Never let logging errors break the agent pipeline
      log.debug('Failed to log cortex event:', err);
    }
  });

  return {
    detach: () => {
      unsub();
      toolStartTimes.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// Event mapping
// ---------------------------------------------------------------------------

interface MapContext {
  provider: string | undefined;
  model: string | undefined;
  toolStartTimes: Map<string, number>;
}

interface MappedEvent {
  eventType: AgentEventType;
  data: Record<string, unknown>;
}

/**
 * Map a CortexEvent to an AgentEventType + data payload suitable for
 * agent_logs.db storage and frontend timeline rendering.
 *
 * Returns null for events that should be skipped.
 */
function mapCortexEvent(event: CortexEvent, ctx: MapContext): MappedEvent | null {
  // The raw pi-agent-core event is stored as event.data
  const piEvent = event.data as Record<string, unknown> | undefined;

  switch (event.type) {
    case 'session_start':
      // Pi-agent-core's agent_start maps to the AGENTIC LOOP phase start.
      // The legacy "session_start" name is kept in the schema for the old path,
      // but Cortex uses the phase-oriented naming.
      return {
        eventType: 'agentic_start',
        data: {
          provider: ctx.provider ?? 'cortex',
          model: ctx.model ?? 'unknown',
        },
      };

    case 'session_end':
      return {
        eventType: 'agentic_end',
        data: {
          reason: 'completed',
          status: 'completed',
        },
      };

    case 'tool_call_start': {
      const toolName = (piEvent?.['toolName'] as string) ?? 'unknown';
      const toolCallId = (piEvent?.['toolCallId'] as string) ?? '';
      const args = piEvent?.['args'];

      // Track start time for duration computation
      if (toolCallId) {
        ctx.toolStartTimes.set(toolCallId, Date.now());
      }

      return {
        eventType: 'tool_call_start',
        data: {
          toolName,
          toolInput: args ?? {},
          toolCallId,
        },
      };
    }

    case 'tool_call_end': {
      const toolName = (piEvent?.['toolName'] as string) ?? 'unknown';
      const toolCallId = (piEvent?.['toolCallId'] as string) ?? '';
      const result = piEvent?.['result'];
      const isError = (piEvent?.['isError'] as boolean) ?? false;

      // Compute duration from tracked start time
      let durationMs: number | undefined;
      if (toolCallId && ctx.toolStartTimes.has(toolCallId)) {
        durationMs = Date.now() - ctx.toolStartTimes.get(toolCallId)!;
        ctx.toolStartTimes.delete(toolCallId);
      }

      // Extract output text from AgentToolResult.content
      let output: unknown = result;
      if (result && typeof result === 'object' && Array.isArray((result as Record<string, unknown>)['content'])) {
        const content = (result as Record<string, unknown>)['content'] as Array<{ type: string; text?: string }>;
        const textParts = content
          .filter((p) => p.type === 'text' && typeof p.text === 'string')
          .map((p) => p.text!);
        if (textParts.length > 0) {
          output = textParts.join('\n');
        }
      }

      return {
        eventType: isError ? 'tool_error' : 'tool_call_end',
        data: {
          toolName,
          output,
          toolCallId,
          isError,
          ...(durationMs != null ? { durationMs } : {}),
        },
      };
    }

    case 'response_start':
      return {
        eventType: 'response_start',
        data: {},
      };

    case 'response_end': {
      // Extract content from the finalized AssistantMessage
      const message = piEvent?.['message'] as Record<string, unknown> | undefined;
      let content = '';
      if (message && Array.isArray(message['content'])) {
        const parts = message['content'] as Array<{ type: string; text?: string }>;
        content = parts
          .filter((p) => p.type === 'text' && typeof p.text === 'string')
          .map((p) => p.text!)
          .join('');
      } else if (message && typeof message['content'] === 'string') {
        content = message['content'];
      }

      const stopReason = message?.['stopReason'] as string | undefined;

      return {
        eventType: 'response_end',
        data: {
          content: content.length > 500 ? content.substring(0, 500) + '...' : content,
          ...(stopReason ? { finishReason: stopReason } : {}),
        },
      };
    }

    case 'turn_end': {
      // Use the parsed textOutput from the EventBridge (already has working tag parsing)
      const textOutput = event.textOutput;

      // Also extract usage from the AssistantMessage if available
      const message = piEvent?.['message'] as Record<string, unknown> | undefined;
      const usage = message?.['usage'] as Record<string, unknown> | undefined;
      const model = message?.['model'] as string | undefined;
      const stopReason = message?.['stopReason'] as string | undefined;

      return {
        eventType: 'turn_end',
        data: {
          content: textOutput?.raw ?? '',
          userFacing: textOutput?.userFacing ?? '',
          working: textOutput?.working ?? null,
          ...(model ? { model } : {}),
          ...(stopReason ? { stopReason } : {}),
          ...(usage ? {
            inputTokens: usage['input'] ?? usage['inputTokens'] ?? 0,
            outputTokens: usage['output'] ?? usage['outputTokens'] ?? 0,
            totalTokens: usage['totalTokens'] ?? 0,
            cost: usage['cost'] ?? null,
          } : {}),
        },
      };
    }

    // Skip: response_chunk (too noisy, excluded from timeline)
    case 'response_chunk':
      return null;

    // Skip: turn_start (no matching AgentEventType)
    case 'turn_start':
      return null;

    default:
      return null;
  }
}
