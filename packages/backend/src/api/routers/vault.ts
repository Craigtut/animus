/**
 * Vault Router — tRPC procedures for password vault management.
 *
 * Provides CRUD operations for user-managed credentials.
 * Passwords are encrypted at rest and masked in list/get responses.
 * Only create/update accept raw passwords; reads return hints only.
 */

import { z } from 'zod/v3';
import { router, protectedProcedure } from '../trpc.js';
import { getSystemDb } from '../../db/index.js';
import * as vaultStore from '../../db/stores/vault-store.js';

export const vaultRouter = router({
  /**
   * List all vault entries (metadata only, no passwords).
   */
  list: protectedProcedure.query(() => {
    return vaultStore.listVaultEntries(getSystemDb());
  }),

  /**
   * Get a single vault entry by ID (metadata only, no password).
   */
  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      const entry = vaultStore.getVaultEntryMetadata(getSystemDb(), input.id);
      if (!entry) {
        throw new Error(`Vault entry not found: ${input.id}`);
      }
      return entry;
    }),

  /**
   * Create a new vault entry.
   */
  create: protectedProcedure
    .input(z.object({
      label: z.string().min(1),
      service: z.string().min(1),
      url: z.string().nullable().optional(),
      identity: z.string().nullable().optional(),
      password: z.string().min(1),
      notes: z.string().nullable().optional(),
    }))
    .mutation(({ input }) => {
      return vaultStore.createVaultEntry(getSystemDb(), input);
    }),

  /**
   * Update an existing vault entry.
   * Only send fields that are changing. Password is optional.
   */
  update: protectedProcedure
    .input(z.object({
      id: z.string(),
      label: z.string().min(1).optional(),
      service: z.string().min(1).optional(),
      url: z.string().nullable().optional(),
      identity: z.string().nullable().optional(),
      password: z.string().min(1).optional(),
      notes: z.string().nullable().optional(),
    }))
    .mutation(({ input }) => {
      const { id, ...data } = input;
      const updated = vaultStore.updateVaultEntry(getSystemDb(), id, data);
      if (!updated) {
        throw new Error(`Vault entry not found: ${id}`);
      }
      return updated;
    }),

  /**
   * Delete a vault entry.
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const deleted = vaultStore.deleteVaultEntry(getSystemDb(), input.id);
      if (!deleted) {
        throw new Error(`Vault entry not found: ${input.id}`);
      }
      return { success: true };
    }),
});
