/**
 * Memory Router — tRPC procedures for memory data (working memory, core self, long-term).
 */

import { z } from 'zod';
import { observable } from '@trpc/server/observable';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import { getMemoryDb } from '../../db/index.js';
import * as memoryStore from '../../db/stores/memory-store.js';
import { getEventBus } from '../../lib/event-bus.js';
import { getMemoryManager } from '../../heartbeat/index.js';
import type { LongTermMemory } from '@animus-labs/shared';

/** Map a LongTermMemory to the browse response shape (null scores). */
function toScoredItem(m: LongTermMemory) {
  return { ...m, relevance: null as number | null, recency: null as number | null, score: null as number | null };
}

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
   * Browse or search long-term memories.
   * - No query: cursor-paginated browse, ordered by created_at DESC
   * - With query: semantic search via MemoryManager.retrieveRelevant()
   */
  browseLongTermMemories: protectedProcedure
    .input(
      z.object({
        query: z.string().optional(),
        contactId: z.string().optional(),
        memoryType: z.enum(['fact', 'experience', 'procedure', 'outcome']).optional(),
        limit: z.number().int().positive().max(50).default(20),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const { query, contactId, memoryType, limit, cursor } = input;

      // Search mode: semantic search via MemoryManager
      if (query && query.trim().length > 0) {
        const manager = getMemoryManager();
        if (!manager) {
          return { items: [] as Array<ReturnType<typeof toScoredItem>>, nextCursor: undefined };
        }

        let results = await manager.retrieveRelevant(query.trim(), limit, false);

        // Post-filter by contactId/memoryType if provided
        if (contactId) {
          results = results.filter((m) => m.contactId === contactId);
        }
        if (memoryType) {
          results = results.filter((m) => m.memoryType === memoryType);
        }

        return {
          items: results.map((m) => ({
            ...m,
            relevance: m.relevance as number | null,
            recency: m.recency as number | null,
            score: m.score as number | null,
          })),
          nextCursor: undefined,
        };
      }

      // Browse mode: cursor-paginated
      const db = getMemoryDb();
      const rows = memoryStore.getLongTermMemoriesPaginated(db, limit + 1, cursor, {
        contactId,
        memoryType,
      });

      const hasMore = rows.length > limit;
      const pageItems = hasMore ? rows.slice(0, limit) : rows;

      return {
        items: pageItems.map((m) => toScoredItem(m)),
        nextCursor: hasMore ? pageItems[pageItems.length - 1]?.createdAt : undefined,
      };
    }),

  /**
   * Delete a long-term memory by ID (removes from SQLite + LanceDB).
   */
  deleteLongTermMemory: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const manager = getMemoryManager();
      if (!manager) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Memory system not initialized' });
      const deleted = await manager.deleteLongTermMemory(input.id);
      if (!deleted) throw new TRPCError({ code: 'NOT_FOUND', message: 'Memory not found' });
      return { success: true };
    }),

  /**
   * Subscribe to memory changes across all layers.
   */
  onMemoryChange: protectedProcedure.subscription(() => {
    return observable<{ type: 'working' | 'core' | 'stored' | 'pruned' | 'deleted'; detail?: any }>((emit) => {
      const eventBus = getEventBus();
      const onWorking = (data: { contactId: string }) => emit.next({ type: 'working', detail: data });
      const onCore = () => emit.next({ type: 'core' });
      const onStored = (mem: any) => emit.next({ type: 'stored', detail: mem });
      const onPruned = (data: { count: number }) => emit.next({ type: 'pruned', detail: data });
      const onDeleted = (data: { id: string }) => emit.next({ type: 'deleted', detail: data });
      eventBus.on('memory:working_updated', onWorking);
      eventBus.on('memory:core_updated', onCore);
      eventBus.on('memory:stored', onStored);
      eventBus.on('memory:pruned', onPruned);
      eventBus.on('memory:deleted', onDeleted);
      return () => {
        eventBus.off('memory:working_updated', onWorking);
        eventBus.off('memory:core_updated', onCore);
        eventBus.off('memory:stored', onStored);
        eventBus.off('memory:pruned', onPruned);
        eventBus.off('memory:deleted', onDeleted);
      };
    });
  }),
});
