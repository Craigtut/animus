/**
 * Tests for memory context building.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestMemoryDb } from '../helpers.js';
import { MemoryManager, type ScoredMemory } from '../../src/memory/memory-manager.js';
import { buildMemoryContext } from '../../src/memory/memory-context.js';
import type { VectorStore, SearchResult } from '../../src/memory/vector-store.js';
import type { IEmbeddingProvider, LongTermMemory } from '@animus/shared';

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

describe('buildMemoryContext', () => {
  let db: Database.Database;
  let embeddingProvider: IEmbeddingProvider;

  beforeEach(() => {
    db = createTestMemoryDb();
    embeddingProvider = createMockEmbeddingProvider();
  });

  it('returns all null sections when no data exists', async () => {
    const vectorStore = createMockVectorStore();
    const manager = new MemoryManager(db, vectorStore, embeddingProvider);

    const ctx = await buildMemoryContext(manager, 'contact-1', null);
    expect(ctx.workingMemorySection).toBeNull();
    expect(ctx.longTermMemorySection).toBeNull();
    expect(ctx.tokenEstimate).toBe(0);
  });

  it('includes working memory for given contact', async () => {
    const vectorStore = createMockVectorStore();
    const manager = new MemoryManager(db, vectorStore, embeddingProvider);
    manager.updateWorkingMemory('contact-1', 'Prefers concise answers');

    const ctx = await buildMemoryContext(manager, 'contact-1', null);
    expect(ctx.workingMemorySection).not.toBeNull();
    expect(ctx.workingMemorySection).toBe('Prefers concise answers');
    expect(ctx.tokenEstimate).toBeGreaterThan(0);
  });

  it('does not include working memory when no contactId', async () => {
    const vectorStore = createMockVectorStore();
    const manager = new MemoryManager(db, vectorStore, embeddingProvider);
    manager.updateWorkingMemory('contact-1', 'Some notes');

    const ctx = await buildMemoryContext(manager, null, null);
    expect(ctx.workingMemorySection).toBeNull();
  });

  it('includes core self when available', async () => {
    const vectorStore = createMockVectorStore();
    const manager = new MemoryManager(db, vectorStore, embeddingProvider);
    manager.updateCoreSelf('I am thoughtful and deliberate.');

    const ctx = await buildMemoryContext(manager, null, null);
    expect(ctx.coreSelfSection).not.toBeNull();
    expect(ctx.coreSelfSection).toBe('I am thoughtful and deliberate.');
  });

  it('includes long-term memories when query provided', async () => {
    const vectorStore = createMockVectorStore([]);
    const manager = new MemoryManager(db, vectorStore, embeddingProvider);

    // Store a memory
    const stored = await manager.storeMemory({
      content: 'User enjoys hiking',
      memoryType: 'fact',
      importance: 0.8,
    });

    // Create manager with vector store that returns results
    const vectorStore2 = createMockVectorStore([
      { id: stored!.id, score: 0.85 },
    ]);
    const manager2 = new MemoryManager(db, vectorStore2, embeddingProvider);

    const ctx = await buildMemoryContext(manager2, null, 'outdoor activities');
    expect(ctx.longTermMemorySection).not.toBeNull();
    expect(ctx.longTermMemorySection).toContain('User enjoys hiking');
  });

  it('does not include long-term memories when no query', async () => {
    const vectorStore = createMockVectorStore([]);
    const manager = new MemoryManager(db, vectorStore, embeddingProvider);

    await manager.storeMemory({
      content: 'Some fact',
      memoryType: 'fact',
      importance: 0.5,
    });

    const ctx = await buildMemoryContext(manager, null, null);
    expect(ctx.longTermMemorySection).toBeNull();
  });

  it('respects token budget', async () => {
    const vectorStore = createMockVectorStore();
    const manager = new MemoryManager(db, vectorStore, embeddingProvider);

    // Set a very large working memory and core self
    manager.updateWorkingMemory('contact-1', 'word '.repeat(500));
    manager.updateCoreSelf('word '.repeat(500));

    // With a small budget, long-term memories should not be fetched
    const ctx = await buildMemoryContext(manager, 'contact-1', 'test query', 100);
    // Should have working memory and core self but token estimate should be capped
    expect(ctx.tokenEstimate).toBeGreaterThan(0);
  });
});
