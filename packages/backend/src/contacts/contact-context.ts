/**
 * Contact Context Builder
 *
 * Assembles context about a contact for the mind prompt.
 * Includes contact info, tier, channels, recent messages, working memory.
 *
 * See docs/architecture/contacts.md — "Integration with the Heartbeat Pipeline"
 */

import { getContactsDb, getMessagesDb } from '../db/index.js';
import * as contactStore from '../db/stores/contact-store.js';
import * as messageStore from '../db/stores/message-store.js';
import { getAvailableToolTypes } from './permission-enforcer.js';
import type { Contact, ChannelType, PermissionTier } from '@animus-labs/shared';

// ============================================================================
// Types
// ============================================================================

export interface ContactContext {
  contact: Contact;
  channels: Array<{
    channel: ChannelType;
    identifier: string;
    displayName: string | null;
  }>;
  permissionTier: PermissionTier;
  availableTools: string[];
  recentMessageCount: number;
}

// ============================================================================
// Context Assembly
// ============================================================================

/**
 * Build context about a contact for inclusion in the mind prompt.
 */
export function buildContactContext(contactId: string): ContactContext | null {
  const cDb = getContactsDb();
  const msgDb = getMessagesDb();

  const contact = contactStore.getContact(cDb, contactId);
  if (!contact) return null;

  const channels = contactStore.getContactChannelsByContactId(cDb, contactId);
  const tier: PermissionTier = contact.isPrimary ? 'primary' : contact.permissionTier;
  const availableTools = getAvailableToolTypes(tier);

  // Count recent messages
  const recentMessages = messageStore.getMessagesByContact(msgDb, contactId, {
    limit: 1,
  });

  return {
    contact,
    channels: channels.map((ch) => ({
      channel: ch.channel,
      identifier: ch.identifier,
      displayName: ch.displayName,
    })),
    permissionTier: tier,
    availableTools,
    recentMessageCount: recentMessages.length,
  };
}

/**
 * Format contact context into a text block for the mind prompt.
 */
export function formatContactContextBlock(
  ctx: ContactContext,
  triggerChannel: ChannelType
): string {
  const lines: string[] = [
    `-- CURRENT INTERACTION --`,
    `Contact: ${ctx.contact.fullName} (${ctx.permissionTier} tier)`,
    `Channel: ${triggerChannel}`,
  ];

  if (ctx.permissionTier === 'primary') {
    lines.push('Permissions: Full access.');
  } else {
    lines.push(
      'Permissions: Reply only. No sub-agents, tasks, goals, or personal tools.'
    );
    lines.push(
      'Privacy: Do NOT reference conversations with other contacts. Do NOT share'
    );
    lines.push(
      'personal information about other contacts. Keep this conversation self-contained.'
    );
  }

  if (ctx.contact.notes) {
    lines.push('');
    lines.push(`Notes: ${ctx.contact.notes}`);
  }

  lines.push(`-------------------------`);

  return lines.join('\n');
}
