/**
 * Memory Router — tRPC procedures for memory data (working memory, core self, long-term).
 */

import { z } from 'zod';
import { router, protectedProcedure } from '../trpc.js';
import { getMemoryDb } from '../../db/index.js';
import * as memoryStore from '../../db/stores/memory-store.js';

export const memoryRouter = router({
  /**
   * Get working memory for a specific contact.
   */
  getWorkingMemory: protectedProcedure
    .input(z.object({ contactId: z.string() }))
    .query(({ input }) => {
      const db = getMemoryDb();
      return memoryStore.getWorkingMemory(db, input.contactId);
    }),

  /**
   * List all working memories across contacts.
   */
  listWorkingMemories: protectedProcedure.query(() => {
    const db = getMemoryDb();
    return memoryStore.listAllWorkingMemories(db);
  }),

  /**
   * Get the core self (singleton).
   */
  getCoreSelf: protectedProcedure.query(() => {
    const db = getMemoryDb();
    return memoryStore.getCoreSelf(db);
  }),

  /**
   * Search long-term memories with optional filters.
   */
  searchLongTermMemories: protectedProcedure
    .input(
      z.object({
        contactId: z.string().optional(),
        memoryType: z.enum(['fact', 'experience', 'procedure', 'outcome']).optional(),
        limit: z.number().int().positive().max(100).default(50),
      }).optional()
    )
    .query(({ input }) => {
      const db = getMemoryDb();
      return memoryStore.searchLongTermMemories(db, {
        contactId: input?.contactId,
        memoryType: input?.memoryType,
        limit: input?.limit ?? 50,
      });
    }),
});
