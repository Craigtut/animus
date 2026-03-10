/**
 * resolve_tool_approval handler — resolves a pending tool approval request.
 *
 * Used by the mind when a user approves or denies a tool usage request
 * via natural language conversation.
 */

import type { z } from 'zod/v3';
import type { ToolHandler, ToolResult } from '../types.js';
import { resolveToolApprovalDef } from '@animus-labs/shared';
import { getHeartbeatDb } from '../../db/index.js';
import {
  getApprovalRequest,
  resolveApproval,
} from '../../db/stores/heartbeat-store.js';
import { triggerTick } from '../../heartbeat/index.js';

type ResolveToolApprovalInput = z.infer<typeof resolveToolApprovalDef.inputSchema>;

export const resolveToolApprovalHandler: ToolHandler<ResolveToolApprovalInput> = async (
  input,
  context
): Promise<ToolResult> => {
  const heartbeatDb = getHeartbeatDb();

  // Look up the approval request
  const request = getApprovalRequest(heartbeatDb, input.requestId);
  if (!request) {
    return {
      content: [{ type: 'text', text: `Approval request "${input.requestId}" not found.` }],
      isError: true,
    };
  }

  if (request.status !== 'pending') {
    return {
      content: [{ type: 'text', text: `Approval request "${input.requestId}" has already been resolved (status: ${request.status}).` }],
      isError: true,
    };
  }

  const status = input.approved ? 'approved' : 'denied';
  const scope = input.approved ? 'once' as const : undefined;

  // Update the approval request
  resolveApproval(heartbeatDb, input.requestId, status, scope);

  // Emit event for real-time updates
  context.eventBus.emit('tool:approval_resolved', {
    id: input.requestId,
    toolName: request.toolName,
    status,
    scope: scope ?? null,
  });

  // Trigger a new tick so the mind can retry the tool with the approval.
  // This matches the button-click path in tools.ts router (two-tick approval pattern).
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

  const action = input.approved ? 'approved' : 'denied';
  return {
    content: [
      {
        type: 'text',
        text: `Tool "${request.toolName}" has been ${action}. ${input.approved ? 'A new tick has been triggered to retry the tool.' : 'The tool request has been denied.'}`,
      },
    ],
  };
};
