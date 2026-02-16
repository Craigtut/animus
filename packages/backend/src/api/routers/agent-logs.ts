/**
 * Agent Logs Router — tRPC procedures for agent sessions, events, and usage.
 */

import { z } from 'zod';
import { router, protectedProcedure } from '../trpc.js';
import { getAgentLogsDb } from '../../db/index.js';
import * as agentLogStore from '../../db/stores/agent-log-store.js';

export const agentLogsRouter = router({
  /**
   * List agent sessions with pagination.
   */
  listSessions: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().positive().max(100).default(20),
        offset: z.number().int().nonnegative().default(0),
        status: z.enum(['active', 'completed', 'error', 'cancelled']).optional(),
      }).optional()
    )
    .query(({ input }) => {
      const db = getAgentLogsDb();
      return agentLogStore.listSessions(db, {
        limit: input?.limit ?? 20,
        offset: input?.offset ?? 0,
        ...(input?.status !== undefined && { status: input.status }),
      });
    }),

  /**
   * Get a single session by ID.
   */
  getSession: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) => {
      const db = getAgentLogsDb();
      return agentLogStore.getSession(db, input.sessionId);
    }),

  /**
   * Get events for a specific session.
   */
  getSessionEvents: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) => {
      const db = getAgentLogsDb();
      return agentLogStore.getSessionEvents(db, input.sessionId);
    }),

  /**
   * Get usage records for a specific session.
   */
  getSessionUsage: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) => {
      const db = getAgentLogsDb();
      return agentLogStore.getSessionUsage(db, input.sessionId);
    }),

  /**
   * Get aggregate usage stats.
   */
  getAggregateUsage: protectedProcedure
    .input(
      z.object({
        since: z.string().optional(),
      }).optional()
    )
    .query(({ input }) => {
      const db = getAgentLogsDb();
      return agentLogStore.getAggregateUsage(db, {
        ...(input?.since !== undefined && { since: input.since }),
      });
    }),
});
