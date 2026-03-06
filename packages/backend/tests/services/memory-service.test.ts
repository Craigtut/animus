/**
 * Tests for MemoryService — business logic for memory data access.
 *
 * Mocks the database getter and MemoryManager, uses a real in-memory SQLite
 * database for cursor-pagination and store-level operations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestMemoryDb, createTestContactsDb } from '../helpers.js';
import * as memoryStore from '../../src/db/stores/memory-store.js';

// ============================================================================
// Mocks — must be set up before importing the service
// ============================================================================

let mockMemDb: Database.Database;
let mockContactsDb: Database.Database;

vi.mock('../../src/db/index.js', () => ({
  getMemoryDb: () => mockMemDb,
  getContactsDb: () => mockContactsDb,
}));

const mockMemoryManager = {
  retrieveRelevant: vi.fn(),
  deleteLongTermMemory: vi.fn(),
};

let memoryManagerValue: typeof mockMemoryManager | null = mockMemoryManager;

vi.mock('../../src/heartbeat/index.js', () => ({
  getMemoryManager: () => memoryManagerValue,
}));

vi.mock('../../src/lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ============================================================================
// Import after mocks are registered
// ============================================================================

const { getMemoryService, resetMemoryService } = await import(
  '../../src/services/memory-service.js'
);

// ============================================================================
// Tests
// ============================================================================

describe('MemoryService', () => {
  beforeEach(() => {
    mockMemDb = createTestMemoryDb();
    mockContactsDb = createTestContactsDb();
    memoryManagerValue = mockMemoryManager;
    vi.clearAllMocks();
    resetMemoryService();
  });

  // --------------------------------------------------------------------------
  // getWorkingMemory
  // --------------------------------------------------------------------------

  describe('getWorkingMemory', () => {
    it('returns null when no working memory exists for the contact', () => {
      const service = getMemoryService();
      const result = service.getWorkingMemory('nonexistent-contact');
      expect(result).toBeNull();
    });

    it('returns working memory when it exists', () => {
      memoryStore.upsertWorkingMemory(mockMemDb, 'contact-1', 'Likes hiking', 8);
      const service = getMemoryService();
      const result = service.getWorkingMemory('contact-1');
      expect(result).not.toBeNull();
      expect(result!.contactId).toBe('contact-1');
      expect(result!.content).toBe('Likes hiking');
    });
  });

  // --------------------------------------------------------------------------
  // listWorkingMemories
  // --------------------------------------------------------------------------

  describe('listWorkingMemories', () => {
    it('returns empty array when no working memories exist', () => {
      const service = getMemoryService();
      const result = service.listWorkingMemories();
      expect(result).toEqual([]);
    });

    it('returns all working memories', () => {
      memoryStore.upsertWorkingMemory(mockMemDb, 'contact-1', 'Notes A', 10);
      memoryStore.upsertWorkingMemory(mockMemDb, 'contact-2', 'Notes B', 20);
      const service = getMemoryService();
      const result = service.listWorkingMemories();
      expect(result).toHaveLength(2);
      const ids = result.map((m) => m.contactId).sort();
      expect(ids).toEqual(['contact-1', 'contact-2']);
    });
  });

  // --------------------------------------------------------------------------
  // getCoreSelf
  // --------------------------------------------------------------------------

  describe('getCoreSelf', () => {
    it('returns default (empty) core self initially', () => {
      const service = getMemoryService();
      const result = service.getCoreSelf();
      // The migration seeds core_self with an empty row (id=1, content='')
      expect(result).not.toBeNull();
      expect(result!.content).toBe('');
    });

    it('returns updated core self after upsert', () => {
      memoryStore.upsertCoreSelf(mockMemDb, 'I am thoughtful and curious', 12);
      const service = getMemoryService();
      const result = service.getCoreSelf();
      expect(result).not.toBeNull();
      expect(result!.content).toBe('I am thoughtful and curious');
    });
  });

  // --------------------------------------------------------------------------
  // browseLongTermMemories — semantic search (with query)
  // --------------------------------------------------------------------------

  describe('browseLongTermMemories with query', () => {
    it('calls retrieveRelevant on the MemoryManager', async () => {
      const fakeResults = [
        {
          id: 'mem-1',
          content: 'User likes cats',
          importance: 0.8,
          memoryType: 'fact',
          sourceType: null,
          sourceId: null,
          contactId: null,
          keywords: [],
          strength: 1,
          createdAt: '2025-01-01T00:00:00Z',
          lastAccessedAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:00Z',
          relevance: 0.9,
          recency: 0.5,
          score: 0.85,
        },
      ];
      mockMemoryManager.retrieveRelevant.mockResolvedValue(fakeResults);

      const service = getMemoryService();
      const result = await service.browseLongTermMemories({
        query: 'cats',
        limit: 10,
      });

      expect(mockMemoryManager.retrieveRelevant).toHaveBeenCalledWith('cats', 10, false);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.content).toBe('User likes cats');
      expect(result.items[0]!.relevance).toBe(0.9);
      expect(result.items[0]!.score).toBe(0.85);
      expect(result.nextCursor).toBeUndefined();
    });

    it('returns empty items when MemoryManager is null', async () => {
      memoryManagerValue = null;

      const service = getMemoryService();
      const result = await service.browseLongTermMemories({
        query: 'anything',
        limit: 10,
      });

      expect(result.items).toEqual([]);
      expect(result.nextCursor).toBeUndefined();
      expect(mockMemoryManager.retrieveRelevant).not.toHaveBeenCalled();
    });

    it('post-filters results by contactId', async () => {
      const fakeResults = [
        {
          id: 'mem-1',
          content: 'Memory for contact A',
          contactId: 'contact-a',
          relevance: 0.9,
          recency: 0.5,
          score: 0.85,
        },
        {
          id: 'mem-2',
          content: 'Memory for contact B',
          contactId: 'contact-b',
          relevance: 0.8,
          recency: 0.4,
          score: 0.75,
        },
      ];
      mockMemoryManager.retrieveRelevant.mockResolvedValue(fakeResults);

      const service = getMemoryService();
      const result = await service.browseLongTermMemories({
        query: 'test',
        contactId: 'contact-a',
        limit: 10,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.contactId).toBe('contact-a');
    });

    it('post-filters results by memoryType', async () => {
      const fakeResults = [
        {
          id: 'mem-1',
          content: 'A fact',
          memoryType: 'fact',
          relevance: 0.9,
          recency: 0.5,
          score: 0.85,
        },
        {
          id: 'mem-2',
          content: 'A procedure',
          memoryType: 'procedure',
          relevance: 0.8,
          recency: 0.4,
          score: 0.75,
        },
      ];
      mockMemoryManager.retrieveRelevant.mockResolvedValue(fakeResults);

      const service = getMemoryService();
      const result = await service.browseLongTermMemories({
        query: 'test',
        memoryType: 'fact',
        limit: 10,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.memoryType).toBe('fact');
    });
  });

  // --------------------------------------------------------------------------
  // browseLongTermMemories — cursor pagination (without query)
  // --------------------------------------------------------------------------

  describe('browseLongTermMemories without query (pagination)', () => {
    /**
     * Insert test memories with distinct created_at timestamps so that
     * cursor-based pagination (which uses created_at < ?) works reliably.
     */
    function insertTestMemories(count: number, opts?: { contactId?: string; memoryType?: 'fact' | 'experience' | 'procedure' | 'outcome' }) {
      const memories = [];
      for (let i = 0; i < count; i++) {
        // Use a base timestamp with offset to guarantee unique, ordered created_at values
        const ts = `2025-01-01T00:00:${String(count - i).padStart(2, '0')}Z`;
        const id = `mem-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`;
        const contactId = opts?.contactId ?? null;
        const memoryType = opts?.memoryType ?? 'fact';
        mockMemDb.prepare(
          `INSERT INTO long_term_memories
             (id, content, importance, memory_type, source_type, source_id, contact_id, keywords, strength, created_at, last_accessed_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, NULL, ?, '[]', 1, ?, ?, ?)`
        ).run(id, `Memory ${i}`, 0.5, memoryType, contactId, ts, ts, ts);
        memories.push({ id, content: `Memory ${i}`, createdAt: ts });
      }
      return memories;
    }

    it('returns empty result when no memories exist', async () => {
      const service = getMemoryService();
      const result = await service.browseLongTermMemories({ limit: 10 });

      expect(result.items).toEqual([]);
      expect(result.nextCursor).toBeUndefined();
    });

    it('returns items with null scores', async () => {
      insertTestMemories(1);

      const service = getMemoryService();
      const result = await service.browseLongTermMemories({ limit: 10 });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.relevance).toBeNull();
      expect(result.items[0]!.recency).toBeNull();
      expect(result.items[0]!.score).toBeNull();
    });

    it('paginates correctly with nextCursor', async () => {
      insertTestMemories(5);

      const service = getMemoryService();
      const page1 = await service.browseLongTermMemories({ limit: 2 });

      expect(page1.items).toHaveLength(2);
      expect(page1.nextCursor).toBeDefined();

      const page2 = await service.browseLongTermMemories({
        limit: 2,
        cursor: page1.nextCursor,
      });

      expect(page2.items).toHaveLength(2);

      // Verify no overlap between pages
      const page1Ids = new Set(page1.items.map((m) => m.id));
      for (const item of page2.items) {
        expect(page1Ids.has(item.id)).toBe(false);
      }
    });

    it('returns no nextCursor on last page', async () => {
      insertTestMemories(3);

      const service = getMemoryService();
      const result = await service.browseLongTermMemories({ limit: 5 });

      expect(result.items).toHaveLength(3);
      expect(result.nextCursor).toBeUndefined();
    });

    it('filters by contactId', async () => {
      insertTestMemories(3, { contactId: 'contact-a' });
      insertTestMemories(2, { contactId: 'contact-b' });

      const service = getMemoryService();
      const result = await service.browseLongTermMemories({
        limit: 10,
        contactId: 'contact-a',
      });

      expect(result.items).toHaveLength(3);
      for (const item of result.items) {
        expect(item.contactId).toBe('contact-a');
      }
    });

    it('filters by memoryType', async () => {
      insertTestMemories(2, { memoryType: 'fact' });
      insertTestMemories(3, { memoryType: 'procedure' });

      const service = getMemoryService();
      const result = await service.browseLongTermMemories({
        limit: 10,
        memoryType: 'procedure',
      });

      expect(result.items).toHaveLength(3);
      for (const item of result.items) {
        expect(item.memoryType).toBe('procedure');
      }
    });
  });

  // --------------------------------------------------------------------------
  // deleteLongTermMemory
  // --------------------------------------------------------------------------

  describe('deleteLongTermMemory', () => {
    it('throws PRECONDITION_FAILED when MemoryManager is null', async () => {
      memoryManagerValue = null;

      const service = getMemoryService();
      await expect(service.deleteLongTermMemory('some-id')).rejects.toThrow(
        /Memory system not initialized/
      );

      try {
        await service.deleteLongTermMemory('some-id');
      } catch (err: any) {
        expect(err.code).toBe('PRECONDITION_FAILED');
      }
    });

    it('throws NOT_FOUND when delete returns false', async () => {
      mockMemoryManager.deleteLongTermMemory.mockResolvedValue(false);

      const service = getMemoryService();
      await expect(service.deleteLongTermMemory('nonexistent')).rejects.toThrow(
        /Memory not found/
      );

      try {
        await service.deleteLongTermMemory('nonexistent');
      } catch (err: any) {
        expect(err.code).toBe('NOT_FOUND');
      }
    });

    it('succeeds when delete returns true', async () => {
      mockMemoryManager.deleteLongTermMemory.mockResolvedValue(true);

      const service = getMemoryService();
      const result = await service.deleteLongTermMemory('mem-123');

      expect(result).toEqual({ success: true });
      expect(mockMemoryManager.deleteLongTermMemory).toHaveBeenCalledWith('mem-123');
    });
  });
});
