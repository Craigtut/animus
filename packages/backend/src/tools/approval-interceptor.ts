/**
 * Approval Interceptor — deterministic text-based tool approval resolution.
 *
 * Runs BEFORE gather-context in the heartbeat pipeline. When a message
 * trigger arrives, checks if the contact has a pending tool approval and
 * whether the message matches a recognized approval/denial phrase. If so,
 * resolves the approval directly (like the button path) and transforms the
 * trigger message so the mind knows to retry the tool.
 *
 * This replaces the old `resolve_tool_approval` MCP tool, which allowed
 * the agent to approve its own tool requests (a security concern).
 *
 * See docs/architecture/tool-permissions.md
 */

import type Database from 'better-sqlite3';
import type { IEventBus } from '@animus-labs/shared';
import type { TriggerContext } from '../heartbeat/context-builder.js';
import { matchApprovalPhrase } from './approval-phrases.js';
import {
  getPendingApprovals,
  resolveApproval,
} from '../db/stores/tool-approval-store.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('ApprovalInterceptor', 'heartbeat');

export interface InterceptorDeps {
  heartbeatDb: Database.Database;
  eventBus: IEventBus;
}

/**
 * Intercept approval/denial phrases in incoming messages.
 *
 * Returns the trigger unchanged if:
 * - Trigger is not a message
 * - No contactId on the trigger
 * - No pending approvals for the contact
 * - Message does not match any recognized phrase
 *
 * Returns a transformed trigger if a phrase is matched:
 * - The pending approval is resolved in the DB
 * - The `tool:approval_resolved` event is emitted
 * - The trigger's messageContent is replaced with a synthetic approval message
 *   (matching the button-path format from tools.ts router)
 */
export function interceptApprovalPhrase(
  trigger: TriggerContext,
  deps: InterceptorDeps,
): TriggerContext {
  // Only intercept message triggers with a contact
  if (trigger.type !== 'message' || !trigger.contactId) {
    return trigger;
  }

  const messageContent = trigger.messageContent ?? '';
  if (!messageContent) {
    return trigger;
  }

  // Check for pending approvals for this contact
  const pending = getPendingApprovals(deps.heartbeatDb, trigger.contactId);
  if (pending.length === 0) {
    return trigger;
  }

  // One-at-a-time enforcement means pending[0] is the one to resolve
  const request = pending[0]!;

  // Match against recognized phrases
  const match = matchApprovalPhrase(messageContent);
  if (!match) {
    return trigger;
  }

  const approved = match === 'approve';
  const status = approved ? 'approved' : 'denied';
  const scope = approved ? 'once' as const : undefined;

  // Resolve the approval in the DB (same as button path)
  resolveApproval(deps.heartbeatDb, request.id, status, scope);

  // Emit event for real-time UI updates
  deps.eventBus.emit('tool:approval_resolved', {
    id: request.id,
    toolName: request.toolName,
    status,
    scope: scope ?? null,
  });

  log.info(
    `Intercepted ${match} phrase for tool "${request.toolName}" ` +
    `(request=${request.id}, contact=${trigger.contactId})`,
  );

  // Transform the trigger so the mind sees the approval/denial
  if (approved) {
    return {
      ...trigger,
      messageContent: `[Tool "${request.toolName}" approved — you may now retry the action]`,
    };
  }

  return {
    ...trigger,
    messageContent: `[Tool "${request.toolName}" denied by user]`,
  };
}
