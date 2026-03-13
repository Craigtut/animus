/**
 * Tools Router — tRPC procedures for tool permissions and approval requests.
 */

import { z } from 'zod/v3';
import { observable } from '@trpc/server/observable';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import { getSystemDb, getHeartbeatDb } from '../../db/index.js';
import * as systemStore from '../../db/stores/system-store.js';
import * as heartbeatStore from '../../db/stores/heartbeat-store.js';
import { getEventBus } from '../../lib/event-bus.js';
import { triggerTick } from '../../heartbeat/index.js';
import type { ToolApprovalRequest, ToolPermissionMode } from '@animus-labs/shared';

export const toolsRouter = router({
  /**
   * List all tools with their permission settings.
   */
  listTools: protectedProcedure.query(() => {
    const db = getSystemDb();
    return systemStore.getToolPermissions(db);
  }),

  /**
   * Update the permission mode for a single tool.
   */
  updatePermission: protectedProcedure
    .input(
      z.object({
        toolName: z.string(),
        mode: z.enum(['off', 'ask', 'always_allow']),
      })
    )
    .mutation(({ input }) => {
      const db = getSystemDb();
      systemStore.updateToolPermissionMode(db, input.toolName, input.mode);
      getEventBus().emit('tool:permission_changed', {
        toolName: input.toolName,
        mode: input.mode,
      });
      return { success: true };
    }),

  /**
   * Update the permission mode for all tools from a given source.
   */
  updateGroupPermission: protectedProcedure
    .input(
      z.object({
        source: z.string(),
        mode: z.enum(['off', 'ask', 'always_allow']),
      })
    )
    .mutation(({ input }) => {
      const db = getSystemDb();
      systemStore.updateGroupPermissionMode(db, input.source, input.mode);
      getEventBus().emit('tool:permission_changed', {
        toolName: `group:${input.source}`,
        mode: input.mode,
      });
      return { success: true };
    }),

  /**
   * List approval requests, filtered by status.
   */
  listApprovals: protectedProcedure
    .input(
      z.object({
        status: z.enum(['pending', 'all']).optional(),
      }).optional()
    )
    .query(({ input }) => {
      const db = getHeartbeatDb();
      const status = input?.status ?? 'pending';
      if (status === 'all') {
        return heartbeatStore.getRecentApprovals(db);
      }
      return heartbeatStore.getPendingApprovals(db);
    }),

  /**
   * Resolve (approve or deny) an approval request.
   */
  resolveApproval: protectedProcedure
    .input(
      z.object({
        requestId: z.string(),
        approved: z.boolean(),
        scope: z.enum(['once', 'always']).optional(),
      })
    )
    .mutation(({ input }) => {
      const hbDb = getHeartbeatDb();

      // Get the approval request first so we know the tool name
      const request = heartbeatStore.getApprovalRequest(hbDb, input.requestId);
      if (!request) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Approval request not found' });
      }
      if (request.status !== 'pending') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Approval request already resolved with status '${request.status}'`,
        });
      }

      const resolvedStatus = input.approved ? 'approved' : 'denied';
      const resolvedScope = input.scope === 'always' ? undefined : 'once';
      heartbeatStore.resolveApproval(hbDb, input.requestId, resolvedStatus, resolvedScope);

      // If "always allow" and approved, also update the tool permission mode
      if (input.scope === 'always' && input.approved) {
        const systemDb = getSystemDb();
        systemStore.updateToolPermissionMode(systemDb, request.toolName, 'always_allow');
        getEventBus().emit('tool:permission_changed', {
          toolName: request.toolName,
          mode: 'always_allow' as ToolPermissionMode,
        });
      }

      getEventBus().emit('tool:approval_resolved', {
        id: input.requestId,
        toolName: request.toolName,
        status: resolvedStatus,
        scope: resolvedScope ?? null,
      });

      // Trigger a new tick so the mind can retry the tool with the approval.
      // This completes the two-tick approval pattern: Tick 1 gates → user decides → Tick 2 retries.
      if (input.approved) {
        triggerTick({
          type: 'message',
          contactId: request.contactId,
          contactName: '',
          channel: request.channel,
          messageContent: `[Tool "${request.toolName}" approved — you may now retry the action]`,
          messageId: `approval-${input.requestId}`,
        });
      }

      return { success: true };
    }),

  /**
   * Dismiss the trust ramp suggestion for a tool.
   */
  dismissTrustRamp: protectedProcedure
    .input(z.object({ toolName: z.string() }))
    .mutation(({ input }) => {
      const db = getSystemDb();
      systemStore.setTrustRampDismissed(db, input.toolName);
      return { success: true };
    }),

  /**
   * Subscribe to new approval requests in real time.
   */
  onApprovalRequest: protectedProcedure.subscription(() => {
    return observable<ToolApprovalRequest>((emit) => {
      const eventBus = getEventBus();
      const handler = (request: ToolApprovalRequest) => emit.next(request);
      eventBus.on('tool:approval_requested', handler);
      return () => {
        eventBus.off('tool:approval_requested', handler);
      };
    });
  }),

  /**
   * Subscribe to approval resolutions in real time.
   */
  onApprovalResolved: protectedProcedure.subscription(() => {
    return observable<{ id: string; toolName: string; status: 'approved' | 'denied'; scope: 'once' | null }>((emit) => {
      const eventBus = getEventBus();
      const handler = (data: { id: string; toolName: string; status: 'approved' | 'denied'; scope: 'once' | null }) => emit.next(data);
      eventBus.on('tool:approval_resolved', handler);
      return () => {
        eventBus.off('tool:approval_resolved', handler);
      };
    });
  }),
});
