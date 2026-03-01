/**
 * Memory Service - business logic for memory data access.
 *
 * Encapsulates working memory, core self, long-term memory browsing/search,
 * and memory deletion.
 * The router layer handles auth and input validation; this layer owns the logic.
 */

import { TRPCError } from '@trpc/server';
import { createLogger } from '../lib/logger.js';
import { getMemoryDb, getContactsDb } from '../db/index.js';
import * as memoryStore from '../db/stores/memory-store.js';
import * as contactStore from '../db/stores/contact-store.js';
import { getMemoryManager } from '../heartbeat/index.js';
import type { WorkingMemory, CoreSelf, LongTermMemory } from '@animus-labs/shared';

const log = createLogger('MemoryService', 'heartbeat');

// ============================================================================
// Types
// ============================================================================

export interface ScoredMemoryItem extends LongTermMemory {
  relevance: number | null;
  recency: number | null;
  score: number | null;
}

export interface BrowseResult {
  items: ScoredMemoryItem[];
  nextCursor: string | undefined;
}

export interface WorkingMemoryWithContact extends WorkingMemory {
  contactName: string | null;
  permissionTier: string | null;
}

export interface BrowseInput {
  query?: string | undefined;
  contactId?: string | undefined;
  memoryType?: 'fact' | 'experience' | 'procedure' | 'outcome' | undefined;
  limit: number;
  cursor?: string | undefined;
}

// ============================================================================
// Service
// ============================================================================

/** Map a LongTermMemory to the browse response shape (null scores). */
function toScoredItem(m: LongTermMemory): ScoredMemoryItem {
  return { ...m, relevance: null, recency: null, score: null };
}

class MemoryService {
  /**
   * Get working memory for a specific contact.
   */
  getWorkingMemory(contactId: string): WorkingMemory | null {
    return memoryStore.getWorkingMemory(getMemoryDb(), contactId);
  }

  /**
   * List all working memories across contacts, enriched with contact names.
   */
  listWorkingMemories(): WorkingMemoryWithContact[] {
    const memories = memoryStore.listAllWorkingMemories(getMemoryDb());
    const contactsDb = getContactsDb();

    return memories.map((wm) => {
      const contact = contactStore.getContact(contactsDb, wm.contactId);
      return {
        ...wm,
        contactName: contact?.fullName ?? null,
        permissionTier: contact?.permissionTier ?? null,
      };
    });
  }

  /**
   * Get the core self (singleton).
   */
  getCoreSelf(): CoreSelf | null {
    return memoryStore.getCoreSelf(getMemoryDb());
  }

  /**
   * Browse or search long-term memories.
   * - No query: cursor-paginated browse, ordered by created_at DESC
   * - With query: semantic search via MemoryManager.retrieveRelevant()
   */
  async browseLongTermMemories(input: BrowseInput): Promise<BrowseResult> {
    const { query, contactId, memoryType, limit, cursor } = input;

    // Search mode: semantic search via MemoryManager
    if (query && query.trim().length > 0) {
      const manager = getMemoryManager();
      if (!manager) {
        return { items: [], nextCursor: undefined };
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
      ...(contactId != null ? { contactId } : {}),
      ...(memoryType != null ? { memoryType } : {}),
    });

    const hasMore = rows.length > limit;
    const pageItems = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: pageItems.map((m) => toScoredItem(m)),
      nextCursor: hasMore ? pageItems[pageItems.length - 1]?.createdAt : undefined,
    };
  }

  /**
   * Delete a long-term memory by ID (removes from SQLite + LanceDB).
   */
  async deleteLongTermMemory(id: string): Promise<{ success: true }> {
    const manager = getMemoryManager();
    if (!manager) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Memory system not initialized' });
    }
    const deleted = await manager.deleteLongTermMemory(id);
    if (!deleted) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Memory not found' });
    }
    return { success: true };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: MemoryService | null = null;

export function getMemoryService(): MemoryService {
  if (!instance) instance = new MemoryService();
  return instance;
}

export function resetMemoryService(): void {
  instance = null;
}
