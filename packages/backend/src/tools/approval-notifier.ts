/**
 * Approval Notifier — delivers tool approval requests to users via channels.
 *
 * Listens for `tool:approval_requested` events and sends structured approval
 * prompts through the channel router. Each channel adapter renders the approval
 * UI according to its capabilities (Discord embeds/buttons, SMS text, API JSON).
 *
 * The mind's natural reply already explains what it wants to do. The notifier
 * sends an additional structured message with approval metadata so channel
 * adapters can render interactive approval UI (buttons, cards, etc.).
 *
 * See docs/architecture/mcp-tools.md — "Tool Permissions"
 */

import type { IEventBus, ToolApprovalRequest } from '@animus-labs/shared';
import { createLogger } from '../lib/logger.js';
import { getChannelRouter } from '../channels/channel-router.js';
import { getSystemDb } from '../db/index.js';
import { getToolPermission } from '../db/stores/system-store.js';
import type { ChannelType } from '@animus-labs/shared';

const log = createLogger('ApprovalNotifier', 'heartbeat');

/**
 * Build the approval metadata that channel adapters detect and render.
 */
function buildApprovalMetadata(request: ToolApprovalRequest, displayName: string) {
  return {
    message_type: 'tool_approval_request' as const,
    approval_requests: [
      {
        requestId: request.id,
        toolName: request.toolName,
        toolDisplayName: displayName,
        toolSource: request.toolSource,
        triggerSummary: request.triggerSummary,
        expiresAt: request.expiresAt,
      },
    ],
  };
}

/**
 * Build a human-readable text summary for the approval prompt.
 * This is the message content — adapters that support rich UI will
 * also use the metadata for interactive rendering.
 */
function buildApprovalText(request: ToolApprovalRequest, displayName: string): string {
  const lines: string[] = [];
  lines.push(`I'd like to use the "${displayName}" tool.`);
  if (request.agentContext?.pendingAction) {
    lines.push(request.agentContext.pendingAction);
  }
  lines.push('');
  lines.push('Reply "approve" to allow this action, or "deny" to reject it.');
  return lines.join('\n');
}

/**
 * Send an approval request to the user through the active channel.
 */
async function deliverApprovalRequest(request: ToolApprovalRequest): Promise<void> {
  // Look up display name from tool_permissions
  let displayName = request.toolName;
  try {
    const sysDb = getSystemDb();
    const perm = getToolPermission(sysDb, request.toolName);
    if (perm) {
      displayName = perm.displayName;
    }
  } catch {
    // DB not available — use raw tool name
  }

  const content = buildApprovalText(request, displayName);
  const metadata = buildApprovalMetadata(request, displayName);

  const router = getChannelRouter();
  try {
    await router.sendOutbound({
      contactId: request.contactId,
      channel: request.channel as ChannelType,
      content,
      metadata,
    });
    log.info(`Approval prompt delivered: tool="${request.toolName}" channel="${request.channel}"`);
  } catch (err) {
    log.error(`Failed to deliver approval prompt for tool "${request.toolName}":`, err);
  }
}

/**
 * Send a resolution notification to the user.
 */
async function deliverApprovalResolution(event: {
  id: string;
  toolName: string;
  status: 'approved' | 'denied';
  scope: 'once' | null;
}): Promise<void> {
  // Resolution is communicated via the tRPC subscription to the web frontend.
  // For non-web channels, the mind's next reply naturally reflects the outcome.
  // We emit the event metadata so adapters can update their UI if supported.
  log.info(
    `Approval resolved: tool="${event.toolName}" id="${event.id}" ` +
    `status="${event.status}" scope="${event.scope ?? 'none'}"`,
  );
}

export function setupApprovalNotifier(eventBus: IEventBus): void {
  eventBus.on('tool:approval_requested', (request: ToolApprovalRequest) => {
    log.info(
      `Approval requested: tool="${request.toolName}" source="${request.toolSource}" ` +
      `contact="${request.contactId}" channel="${request.channel}" ` +
      `agent="${request.originatingAgent}" tick=${request.tickNumber} ` +
      `expires="${request.expiresAt}"`,
    );

    if (request.agentContext) {
      log.debug(
        `Approval context: action="${request.agentContext.pendingAction}" ` +
        `task="${request.agentContext.taskDescription}"`,
      );
    }

    // Deliver the approval prompt to the user via channel router
    deliverApprovalRequest(request).catch((err) => {
      log.error('Unexpected error in approval delivery:', err);
    });
  });

  eventBus.on('tool:approval_resolved', (event) => {
    deliverApprovalResolution(event).catch((err) => {
      log.error('Unexpected error in resolution notification:', err);
    });
  });

  eventBus.on('tool:approval_expired', (event) => {
    log.warn(
      `Approval expired: tool="${event.toolName}" id="${event.id}"`,
    );
  });

  log.debug('Approval notifier initialized');
}
