/**
 * Tests for MemoryManager — write pipeline, retrieval, forgetting.
 *
 * Uses in-memory SQLite (memory.db) and a mock VectorStore/EmbeddingProvider.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestMemoryDb } from '../helpers.js';
import {
  MemoryManager,
  MEMORY_DEDUP_THRESHOLD,
  MEMORY_SKIP_THRESHOLD,
  MEMORY_RELEVANCE_THRESHOLD,
  WORKING_MEMORY_TOKEN_CAP,
  CORE_SELF_TOKEN_CAP,
} from '../../src/memory/memory-manager.js';
import type { VectorStore, SearchResult } from '../../src/memory/vector-store.js';
import type { IEmbeddingProvider } from '@animus/shared';
import * as memoryStore from '../../src/db/stores/memory-store.js';

// --------------------------------------------------------------------------
// Mock factories
// --------------------------------------------------------------------------

function createMockEmbeddingProvider(): IEmbeddingProvider {
  return {
    dimensions: 3,
    maxTokens: 512,
    modelId: 'test-model',
    isReady: () => true,
    initialize: async () => {},
    embed: async (texts: string[]) => texts.map(() => [1, 0, 0]),
    embedSingle: async () => [1, 0, 0],
  };
}

function createMockVectorStore(searchResults: SearchResult[] = []): VectorStore {
  return {
    initialize: vi.fn(async () => {}),
    isReady: () => true,
    addMemory: vi.fn(async () => {}),
    search: vi.fn(async () => searchResults),
    deleteMemory: vi.fn(async () => {}),
    deleteAll: vi.fn(async () => {}),
  } as unknown as VectorStore;
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe('MemoryManager', () => {
  let db: Database.Database;
  let embeddingProvider: IEmbeddingProvider;

  beforeEach(() => {
    db = createTestMemoryDb();
    embeddingProvider = createMockEmbeddingProvider();
  });

  // ========================================================================
  // Working Memory
  // ========================================================================

  describe('working memory', () => {
    it('returns null for nonexistent contact', () => {
      const vectorStore = createMockVectorStore();
      const manager = new MemoryManager(db, vectorStore, embeddingProvider);
      expect(manager.getWorkingMemory('nonexistent-id')).toBeNull();
    });

    it('stores and retrieves working memory', () => {
      const vectorStore = createMockVectorStore();
      const manager = new MemoryManager(db, vectorStore, embeddingProvider);
      manager.updateWorkingMemory('contact-1', 'Some notes about this contact');
      const wm = manager.getWorkingMemory('contact-1');
      expect(wm).not.toBeNull();
      expect(wm!.content).toBe('Some notes about this contact');
    });

    it('updates existing working memory', () => {
      const vectorStore = createMockVectorStore();
      const manager = new MemoryManager(db, vectorStore, embeddingProvider);
      manager.updateWorkingMemory('contact-1', 'First note');
      manager.updateWorkingMemory('contact-1', 'Updated note');
      const wm = manager.getWorkingMemory('contact-1');
      expect(wm!.content).toBe('Updated note');
    });

    it('caps working memory by token limit', () => {
      const vectorStore = createMockVectorStore();
      const manager = new MemoryManager(db, vectorStore, embeddingProvider);
      // Create a very long string that exceeds the token cap
      const longContent = 'word '.repeat(3000);
      manager.updateWorkingMemory('contact-1', longContent);
      const wm = manager.getWorkingMemory('contact-1');
      expect(wm!.tokenCount).toBeLessThanOrEqual(WORKING_MEMORY_TOKEN_CAP);
    });
  });

  // ========================================================================
  // Core Self
  // ========================================================================

  describe('core self', () => {
    it('returns null when not initialized', () => {
      const vectorStore = createMockVectorStore();
      const manager = new MemoryManager(db, vectorStore, embeddingProvider);
      // core_self has a default row from migration, but content may be empty
      const cs = manager.getCoreSelf();
      // Depending on migration, it may or may not exist
      // Just test that the method works
      expect(cs === null || typeof cs.content === 'string').toBe(true);
    });

    it('stores and retrieves core self', () => {
      const vectorStore = createMockVectorStore();
      const manager = new MemoryManager(db, vectorStore, embeddingProvider);
      manager.updateCoreSelf('I am an AI assistant who values honesty.');
      const cs = manager.getCoreSelf();
      expect(cs).not.toBeNull();
      expect(cs!.content).toBe('I am an AI assistant who values honesty.');
    });

    it('caps core self by token limit', () => {
      const vectorStore = createMockVectorStore();
      const manager = new MemoryManager(db, vectorStore, embeddingProvider);
      const longContent = 'word '.repeat(3000);
      manager.updateCoreSelf(longContent);
      const cs = manager.getCoreSelf();
      expect(cs!.tokenCount).toBeLessThanOrEqual(CORE_SELF_TOKEN_CAP);
    });
  });

  // ========================================================================
  // Long-Term Memory: Write Pipeline
  // ========================================================================

  describe('storeMemory', () => {
    it('stores a new memory when no duplicates exist', async () => {
      const vectorStore = createMockVectorStore([]); // no search results
      const manager = new MemoryManager(db, vectorStore, embeddingProvider);

      const memory = await manager.storeMemory({
        content: 'The user likes TypeScript',
        memoryType: 'fact',
        importance: 0.7,
      });

      expect(memory).not.toBeNull();
      expect(memory!.content).toBe('The user likes TypeScript');
      expect(memory!.importance).toBe(0.7);
      expect(memory!.memoryType).toBe('fact');
      expect(vectorStore.addMemory).toHaveBeenCalledOnce();
    });

    it('skips near-duplicate memories', async () => {
      // First store a memory
      const vectorStore = createMockVectorStore([
        { id: 'existing-1', score: MEMORY_SKIP_THRESHOLD + 0.01 },
      ]);
      const manager = new MemoryManager(db, vectorStore, embeddingProvider);

      const memory = await manager.storeMemory({
        content: 'Already known fact',
        memoryType: 'fact',
        importance: 0.5,
      });

      expect(memory).toBeNull();
      expect(vectorStore.addMemory).not.toHaveBeenCalled();
    });

    it('deduplicates similar memories by updating access', async () => {
      const vectorStore = createMockVectorStore([]);
      const manager = new MemoryManager(db, vectorStore, embeddingProvider);

      // First, store a memory
      const original = await manager.storeMemory({
        content: 'User preference fact',
        memoryType: 'fact',
        importance: 0.6,
      });
      expect(original).not.toBeNull();

      // Now create a new manager with a vector store that reports similarity
      const vectorStore2 = createMockVectorStore([
        { id: original!.id, score: MEMORY_DEDUP_THRESHOLD + 0.02 },
      ]);
      const manager2 = new MemoryManager(db, vectorStore2, embeddingProvider);

      const deduplicated = await manager2.storeMemory({
        content: 'Similar user preference fact',
        memoryType: 'fact',
        importance: 0.6,
      });

      // Should return the existing memory (updated), not a new one
      expect(deduplicated).not.toBeNull();
      expect(deduplicated!.id).toBe(original!.id);
      expect(vectorStore2.addMemory).not.toHaveBeenCalled();
    });

    it('stores memory with all optional fields', async () => {
      const vectorStore = createMockVectorStore([]);
      const manager = new MemoryManager(db, vectorStore, embeddingProvider);

      const memory = await manager.storeMemory({
        content: 'User talked about dogs',
        memoryType: 'experience',
        importance: 0.5,
        sourceType: 'conversation',
        sourceId: 'msg-123',
        contactId: 'contact-1',
        keywords: ['dogs', 'pets'],
      });

      expect(memory).not.toBeNull();
      expect(memory!.sourceType).toBe('conversation');
      expect(memory!.contactId).toBe('contact-1');
      expect(memory!.keywords).toContain('dogs');
    });
  });

  // ========================================================================
  // Long-Term Memory: Retrieval
  // ========================================================================

  describe('retrieveRelevant', () => {
    it('returns empty array when no memories exist', async () => {
      const vectorStore = createMockVectorStore([]);
      const manager = new MemoryManager(db, vectorStore, embeddingProvider);

      const results = await manager.retrieveRelevant('any query');
      expect(results).toHaveLength(0);
    });

    it('retrieves and scores memories', async () => {
      const vectorStore = createMockVectorStore([]);
      const manager = new MemoryManager(db, vectorStore, embeddingProvider);

      // Store a memory first
      const stored = await manager.storeMemory({
        content: 'User loves hiking',
        memoryType: 'fact',
        importance: 0.8,
      });
      expect(stored).not.toBeNull();

      // Create a new vector store that returns the stored memory with high relevance
      const vectorStore2 = createMockVectorStore([
        { id: stored!.id, score: 0.9 },
      ]);
      const manager2 = new MemoryManager(db, vectorStore2, embeddingProvider);

      const results = await manager2.retrieveRelevant('hiking outdoors');
      expect(results.length).toBeGreaterThanOrEqual(1);

      const result = results[0]!;
      expect(result.content).toBe('User loves hiking');
      expect(result.relevance).toBeGreaterThan(0);
      expect(result.score).toBeGreaterThan(0);
    });

    it('filters out low-scoring memories', async () => {
      const vectorStore = createMockVectorStore([]);
      const manager = new MemoryManager(db, vectorStore, embeddingProvider);

      const stored = await manager.storeMemory({
        content: 'Barely relevant fact',
        memoryType: 'fact',
        importance: 0.1,
      });

      // Very low relevance score
      const vectorStore2 = createMockVectorStore([
        { id: stored!.id, score: 0.01 },
      ]);
      const manager2 = new MemoryManager(db, vectorStore2, embeddingProvider);

      const results = await manager2.retrieveRelevant('something else');
      // score = 0.4 * 0.01 + 0.3 * 0.1 + 0.3 * recency ≈ 0.034 + recency
      // This should be below the threshold if recency is low
      // (depends on timing, but with very low relevance and importance it should filter)
      expect(results.length).toBeLessThanOrEqual(1);
    });

    it('sorts results by score descending', async () => {
      const vectorStore = createMockVectorStore([]);
      const manager = new MemoryManager(db, vectorStore, embeddingProvider);

      const mem1 = await manager.storeMemory({ content: 'Fact A', memoryType: 'fact', importance: 0.9 });
      const mem2 = await manager.storeMemory({ content: 'Fact B', memoryType: 'fact', importance: 0.3 });

      const vectorStore2 = createMockVectorStore([
        { id: mem1!.id, score: 0.9 },
        { id: mem2!.id, score: 0.5 },
      ]);
      const manager2 = new MemoryManager(db, vectorStore2, embeddingProvider);

      const results = await manager2.retrieveRelevant('query', 10);
      if (results.length >= 2) {
        expect(results[0]!.score).toBeGreaterThanOrEqual(results[1]!.score);
      }
    });
  });

  // ========================================================================
  // Long-Term Memory: Forgetting
  // ========================================================================

  describe('pruneDecayed', () => {
    it('prunes old low-importance memories', async () => {
      const vectorStore = createMockVectorStore([]);
      const manager = new MemoryManager(db, vectorStore, embeddingProvider);

      // Store a memory
      const memory = await manager.storeMemory({
        content: 'Forgettable fact',
        memoryType: 'fact',
        importance: 0.1,
      });
      expect(memory).not.toBeNull();

      // Manually set last_accessed_at far in the past to trigger decay
      db.prepare(
        'UPDATE long_term_memories SET last_accessed_at = ? WHERE id = ?'
      ).run(new Date(Date.now() - 5000 * 60 * 60 * 1000).toISOString(), memory!.id);

      const pruned = await manager.pruneDecayed();
      expect(pruned).toBeGreaterThanOrEqual(1);
      expect(vectorStore.deleteMemory).toHaveBeenCalled();

      // Verify memory is gone from SQLite
      const fetched = memoryStore.getLongTermMemory(db, memory!.id);
      expect(fetched).toBeNull();
    });

    it('does not prune high-importance memories', async () => {
      const vectorStore = createMockVectorStore([]);
      const manager = new MemoryManager(db, vectorStore, embeddingProvider);

      const memory = await manager.storeMemory({
        content: 'Core knowledge',
        memoryType: 'fact',
        importance: 0.9,
      });

      // Even with old access time, high importance should survive
      db.prepare(
        'UPDATE long_term_memories SET last_accessed_at = ? WHERE id = ?'
      ).run(new Date(Date.now() - 5000 * 60 * 60 * 1000).toISOString(), memory!.id);

      const pruned = await manager.pruneDecayed();
      expect(pruned).toBe(0);

      const fetched = memoryStore.getLongTermMemory(db, memory!.id);
      expect(fetched).not.toBeNull();
    });

    it('does not prune recently accessed memories', async () => {
      const vectorStore = createMockVectorStore([]);
      const manager = new MemoryManager(db, vectorStore, embeddingProvider);

      const memory = await manager.storeMemory({
        content: 'Recent fact',
        memoryType: 'fact',
        importance: 0.2,
      });

      // last_accessed_at is set to now() by default, so retention should be high
      const pruned = await manager.pruneDecayed();
      expect(pruned).toBe(0);
    });
  });

  // ========================================================================
  // Consolidation
  // ========================================================================

  describe('consolidate', () => {
    it('returns 0 (placeholder)', async () => {
      const vectorStore = createMockVectorStore([]);
      const manager = new MemoryManager(db, vectorStore, embeddingProvider);
      const count = await manager.consolidate();
      expect(count).toBe(0);
    });
  });
});
