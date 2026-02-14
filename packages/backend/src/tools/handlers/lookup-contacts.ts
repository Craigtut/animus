/**
 * lookup_contacts handler — discover contacts and their available channels.
 *
 * Mind-only tool. Sub-agents don't have the contacts store wired in,
 * so calling this from a sub-agent context returns an error.
 */

import type { z } from 'zod';
import type { ToolHandler, ToolResult } from '../types.js';
import { lookupContactsDef } from '@animus/shared';

type LookupContactsInput = z.infer<typeof lookupContactsDef.inputSchema>;

export const lookupContactsHandler: ToolHandler<LookupContactsInput> = async (
  input,
  context
): Promise<ToolResult> => {
  // Guard: mind-only tool
  if (!context.stores.contacts) {
    return {
      content: [
        {
          type: 'text',
          text: 'lookup_contacts is only available to the mind session.',
        },
      ],
      isError: true,
    };
  }

  // 1. Load all contacts
  let contacts = context.stores.contacts.listContacts();

  // 2. Apply name filter (case-insensitive partial match)
  if (input.nameFilter) {
    const filter = input.nameFilter.toLowerCase();
    contacts = contacts.filter((c) =>
      c.fullName.toLowerCase().includes(filter)
    );
  }

  // 3. Build results with channels
  const results: Array<{
    contact: typeof contacts[0];
    channels: ReturnType<NonNullable<typeof context.stores.contacts>['getContactChannels']>;
  }> = [];

  for (const contact of contacts) {
    let channels = context.stores.contacts.getContactChannels(contact.id);

    // Apply channel filter if specified
    if (input.channel) {
      channels = channels.filter((ch) => ch.channel === input.channel);
      if (channels.length === 0) continue; // Skip contacts without this channel
    }

    results.push({ contact, channels });
  }

  if (results.length === 0) {
    const filterDesc = [
      input.nameFilter ? `name matching "${input.nameFilter}"` : null,
      input.channel ? `reachable via ${input.channel}` : null,
    ]
      .filter(Boolean)
      .join(' and ');

    return {
      content: [
        {
          type: 'text',
          text: filterDesc
            ? `No contacts found ${filterDesc}.`
            : 'No contacts found.',
        },
      ],
    };
  }

  // 4. Format output
  const formatted = results
    .map(({ contact, channels }) => {
      const channelList = channels
        .map((ch) =>
          ch.displayName
            ? `${ch.channel} (${ch.displayName})`
            : ch.channel
        )
        .join(', ');

      const lines = [
        `${contact.fullName} [${contact.permissionTier}]`,
        `  ID: ${contact.id}`,
        `  Channels: ${channelList || 'none'}`,
      ];

      if (contact.notes) {
        lines.push(`  Notes: ${contact.notes}`);
      }

      return lines.join('\n');
    })
    .join('\n\n');

  return {
    content: [
      {
        type: 'text',
        text: `Found ${results.length} contact${results.length === 1 ? '' : 's'}:\n\n${formatted}`,
      },
    ],
  };
};
