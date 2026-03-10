/**
 * Memory Router - tRPC procedures for memory data (working memory, core self, long-term).
 */

import { z } from 'zod/v3';
import { observable } from '@trpc/server/observable';
import { router, protectedProcedure } from '../trpc.js';
import { getEventBus } from '../../lib/event-bus.js';
import { getMemoryService } from '../../services/memory-service.js';

export const memoryRouter = router({
  /**
   * Get working memory for a specific contact.
   */
  getWorkingMemory: protectedProcedure
    .input(z.object({ contactId: z.string() }))
    .query(({ input }) => {
      return getMemoryService().getWorkingMemory(input.contactId);
    }),

  /**
   * List all working memories across contacts.
   */
  listWorkingMemories: protectedProcedure.query(() => {
    return getMemoryService().listWorkingMemories();
  }),

  /**
   * Get the core self (singleton).
   */
  getCoreSelf: protectedProcedure.query(() => {
    return getMemoryService().getCoreSelf();
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
      return getMemoryService().browseLongTermMemories(input);
    }),

  /**
   * Delete a long-term memory by ID (removes from SQLite + LanceDB).
   */
  deleteLongTermMemory: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      return getMemoryService().deleteLongTermMemory(input.id);
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
