/**
 * manage_vault_entry handler — create, update, or delete vault entries.
 *
 * Passwords are always system-generated (agents never choose them).
 * Update and delete operations are scoped to agent-created entries only.
 *
 * See docs/architecture/credential-passing.md
 */

import type { ToolHandler, ToolResult } from '../types.js';
import { getSystemDb, getAgentLogsDb } from '../../db/index.js';
import * as vaultStore from '../../db/stores/vault-store.js';
import { logCredentialAccess } from '../../db/stores/credential-audit-store.js';
import { generatePassword } from '../../lib/password-generator.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('ManageVaultEntry', 'heartbeat');

interface ManageVaultEntryInput {
  action: 'create' | 'update' | 'delete';
  label?: string;
  service?: string;
  id?: string;
  url?: string;
  identity?: string;
  notes?: string;
  passwordLength?: number;
  excludeSymbols?: boolean;
  regeneratePassword?: boolean;
}

export const manageVaultEntryHandler: ToolHandler = async (
  rawInput,
  _context,
): Promise<ToolResult> => {
  try {
    const input = rawInput as ManageVaultEntryInput;
    const db = getSystemDb();

    switch (input.action) {
      case 'create': {
        if (!input.label || !input.service) {
          return {
            content: [{ type: 'text', text: 'Create requires "label" and "service" fields.' }],
            isError: true,
          };
        }
        const password = generatePassword({
          ...(input.passwordLength != null ? { length: input.passwordLength } : {}),
          ...(input.excludeSymbols != null ? { excludeSymbols: input.excludeSymbols } : {}),
        });

        const entry = vaultStore.createVaultEntry(db, {
          label: input.label,
          service: input.service,
          url: input.url,
          identity: input.identity,
          password,
          notes: input.notes,
          createdBy: 'agent',
        });

        // Audit log
        try {
          logCredentialAccess(getAgentLogsDb(), {
            credentialType: 'vault',
            credentialRef: `vault:${entry.id}`,
            toolName: 'manage_vault_entry',
            agentContext: `Created vault entry "${input.label}" for ${input.service}`,
          });
        } catch (auditErr) {
          log.warn('Failed to write audit log:', auditErr);
        }

        // Check for other entries with the same service
        const serviceCount = vaultStore.countVaultEntriesByService(db, input.service);
        const dupeNote = serviceCount > 1
          ? `\n\nNote: ${serviceCount - 1} other ${serviceCount - 1 === 1 ? 'entry exists' : 'entries exist'} for this service.`
          : '';

        log.info(`Created vault entry "${input.label}" for ${input.service} (id: ${entry.id})`);

        return {
          content: [{
            type: 'text',
            text: `Vault entry created successfully.\n\n` +
              `- ref: vault:${entry.id}\n` +
              `- label: ${entry.label}\n` +
              `- service: ${entry.service}\n` +
              (entry.identity ? `- identity: ${entry.identity}\n` : '') +
              (entry.url ? `- url: ${entry.url}\n` : '') +
              `- password hint: ${entry.hint}\n` +
              `\nUse credentialRef "vault:${entry.id}" with run_with_credentials.` +
              dupeNote,
          }],
        };
      }

      case 'update': {
        if (!input.id) {
          return {
            content: [{ type: 'text', text: 'Update requires an "id" field.' }],
            isError: true,
          };
        }
        const existing = vaultStore.getVaultEntryMetadata(db, input.id);
        if (!existing) {
          return {
            content: [{ type: 'text', text: `Vault entry not found: ${input.id}` }],
            isError: true,
          };
        }

        if (existing.createdBy !== 'agent') {
          return {
            content: [{
              type: 'text',
              text: 'Cannot update this entry: it was created by the user. Only agent-created entries can be modified by the agent.',
            }],
            isError: true,
          };
        }

        const updateData: Parameters<typeof vaultStore.updateVaultEntry>[2] = {};
        if (input.label !== undefined) updateData.label = input.label;
        if (input.service !== undefined) updateData.service = input.service;
        if (input.url !== undefined) updateData.url = input.url;
        if (input.identity !== undefined) updateData.identity = input.identity;
        if (input.notes !== undefined) updateData.notes = input.notes;
        if (input.regeneratePassword) {
          updateData.password = generatePassword({
            ...(input.passwordLength != null ? { length: input.passwordLength } : {}),
            ...(input.excludeSymbols != null ? { excludeSymbols: input.excludeSymbols } : {}),
          });
        }

        const updated = vaultStore.updateVaultEntry(db, input.id, updateData);
        if (!updated) {
          return {
            content: [{ type: 'text', text: `Failed to update vault entry: ${input.id}` }],
            isError: true,
          };
        }

        // Audit log
        try {
          logCredentialAccess(getAgentLogsDb(), {
            credentialType: 'vault',
            credentialRef: `vault:${input.id}`,
            toolName: 'manage_vault_entry',
            agentContext: `Updated vault entry "${updated.label}"${input.regeneratePassword ? ' (password regenerated)' : ''}`,
          });
        } catch (auditErr) {
          log.warn('Failed to write audit log:', auditErr);
        }

        log.info(`Updated vault entry "${updated.label}" (id: ${input.id})${input.regeneratePassword ? ' with new password' : ''}`);

        return {
          content: [{
            type: 'text',
            text: `Vault entry updated.\n\n` +
              `- ref: vault:${updated.id}\n` +
              `- label: ${updated.label}\n` +
              `- service: ${updated.service}\n` +
              (updated.identity ? `- identity: ${updated.identity}\n` : '') +
              (updated.url ? `- url: ${updated.url}\n` : '') +
              `- password hint: ${updated.hint}\n` +
              (input.regeneratePassword ? '- password was regenerated\n' : ''),
          }],
        };
      }

      case 'delete': {
        if (!input.id) {
          return {
            content: [{ type: 'text', text: 'Delete requires an "id" field.' }],
            isError: true,
          };
        }
        const existing = vaultStore.getVaultEntryMetadata(db, input.id);
        if (!existing) {
          return {
            content: [{ type: 'text', text: `Vault entry not found: ${input.id}` }],
            isError: true,
          };
        }

        if (existing.createdBy !== 'agent') {
          return {
            content: [{
              type: 'text',
              text: 'Cannot delete this entry: it was created by the user. Only agent-created entries can be deleted by the agent.',
            }],
            isError: true,
          };
        }

        const deleted = vaultStore.deleteVaultEntry(db, input.id);
        if (!deleted) {
          return {
            content: [{ type: 'text', text: `Failed to delete vault entry: ${input.id}` }],
            isError: true,
          };
        }

        // Audit log
        try {
          logCredentialAccess(getAgentLogsDb(), {
            credentialType: 'vault',
            credentialRef: `vault:${input.id}`,
            toolName: 'manage_vault_entry',
            agentContext: `Deleted vault entry "${existing.label}" (${existing.service})`,
          });
        } catch (auditErr) {
          log.warn('Failed to write audit log:', auditErr);
        }

        log.info(`Deleted vault entry "${existing.label}" (id: ${input.id})`);

        return {
          content: [{
            type: 'text',
            text: `Vault entry deleted: "${existing.label}" (${existing.service}).`,
          }],
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown action: ${input.action}` }],
          isError: true,
        };
    }
  } catch (err) {
    log.error('Failed to manage vault entry:', err);
    return {
      content: [{ type: 'text', text: `Failed to manage vault entry: ${String(err)}` }],
      isError: true,
    };
  }
};
