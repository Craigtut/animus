/**
 * list_vault_entries handler — returns vault entry metadata (never passwords).
 *
 * The agent uses this to discover what credentials are stored in the vault
 * before referencing them via run_with_credentials with vault:<id> refs.
 *
 * See docs/architecture/credential-passing.md
 */

import type { z } from 'zod';
import type { ToolHandler, ToolResult } from '../types.js';
import { listVaultEntriesDef } from '@animus-labs/shared';
import { getSystemDb } from '../../db/index.js';
import * as vaultStore from '../../db/stores/vault-store.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('ListVaultEntries', 'heartbeat');

type ListVaultEntriesInput = z.infer<typeof listVaultEntriesDef.inputSchema>;

export const listVaultEntriesHandler: ToolHandler<ListVaultEntriesInput> = async (
  input,
  _context,
): Promise<ToolResult> => {
  try {
    const db = getSystemDb();
    let entries = vaultStore.listVaultEntries(db);

    // Apply optional service filter
    if (input.service) {
      const filter = input.service.toLowerCase();
      entries = entries.filter(e =>
        e.service.toLowerCase().includes(filter) ||
        e.label.toLowerCase().includes(filter)
      );
    }

    if (entries.length === 0) {
      const msg = input.service
        ? `No vault entries found matching "${input.service}". The user can add credentials in Settings > Passwords.`
        : 'The password vault is empty. The user can add credentials in Settings > Passwords.';
      return {
        content: [{ type: 'text', text: msg }],
      };
    }

    const lines = entries.map((e) => {
      const parts = [`- **${e.label}** (${e.service})`];
      parts.push(`  ref: vault:${e.id}`);
      if (e.identity) parts.push(`  identity: ${e.identity}`);
      if (e.url) parts.push(`  url: ${e.url}`);
      parts.push(`  password hint: ${e.hint}`);
      if (e.notes) parts.push(`  notes: ${e.notes}`);
      return parts.join('\n');
    });

    const text = `Password vault (${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}):\n\n${lines.join('\n\n')}\n\nTo use a credential, call run_with_credentials with the vault ref (e.g., credentialRef: "vault:<id>").`;

    log.info(`Listed ${entries.length} vault entries${input.service ? ` (filtered by "${input.service}")` : ''}`);

    return {
      content: [{ type: 'text', text }],
    };
  } catch (err) {
    log.error('Failed to list vault entries:', err);
    return {
      content: [{ type: 'text', text: `Failed to list vault entries: ${String(err)}` }],
      isError: true,
    };
  }
};
