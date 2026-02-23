/**
 * Agent Log Store Adapter
 *
 * Curries the backend's agent-log-store functions (which take `db` as first param)
 * to match the AgentLogStore interface expected by @animus-labs/agents logging hook.
 */

import type Database from 'better-sqlite3';
import type { AgentLogStore } from '@animus-labs/agents';
import * as agentLogStore from '../db/stores/agent-log-store.js';
import type { AgentEventType } from '@animus-labs/shared';
import { getEventBus } from '../lib/event-bus.js';

/**
 * Create an AgentLogStore adapter that curries the db parameter.
 *
 * The @animus-labs/agents logging hook expects functions without a db parameter.
 * The backend's agent-log-store functions take db as the first parameter.
 * This adapter bridges the gap.
 */
export function createAgentLogStoreAdapter(db: Database.Database): AgentLogStore {
  return {
    createSession: (data) => agentLogStore.createSession(db, data),
    endSession: (id, status) => agentLogStore.endSession(db, id, status),
    insertEvent: (data) => {
      const event = agentLogStore.insertEvent(db, {
        ...data,
        eventType: data.eventType as AgentEventType,
      });
      try {
        getEventBus().emit('agent:event:logged', {
          id: event.id,
          sessionId: event.sessionId,
          eventType: event.eventType,
          data: event.data,
          createdAt: event.createdAt,
        });
      } catch { /* don't break logging if EventBus fails */ }
      return event;
    },
    insertUsage: (data) => agentLogStore.insertUsage(db, data),
  };
}
