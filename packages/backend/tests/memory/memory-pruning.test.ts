/**
 * Tests for MemoryManager.pruneToCapacity — size-based memory pruning.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestMemoryDb } from '../helpers.js';
import * as memoryStore from '../../src/db/stores/memory-store.js';
import {
  MemoryManager,
  MEMORY_CORE_IMPORTANCE_FLOOR,
} from '../../src/memory/memory-manager.js';
import type { VectorStore } from '../../src/memory/vector-store.js';
import type { IEmbeddingProvider } from '@animus/shared';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('../../src/lib/event-bus.js', () => ({
  getEventBus: () => ({
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  }),
}));

function createMockVectorStore(): VectorStore {
  return {
    initialize: vi.fn(async () => {}),
    isReady: () => true,
    addMemory: vi.fn(async () => {}),
    search: vi.fn(async () => []),
    deleteMemory: vi.fn(async () => {}),
    deleteAll: vi.fn(async () => {}),
  } as unknown as VectorStore;
}

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

/**
 * Insert a memory into the test DB with controllable parameters.
 * Returns the memory ID.
 */
function insertTestMemory(
  db: Database.Database,
  overrides: {
    importance?: number;
    strength?: number;
    hoursAgo?: number;
    memoryType?: string;
  } = {},
): string {
  const memory = memoryStore.insertLongTermMemory(db, {
    content: `Test memory ${Math.random()}`,
    importance: overrides.importance ?? 0.5,
    memoryType: (overrides.memoryType ?? 'fact') as 'fact',
  });

  // Backdate lastAccessedAt if hoursAgo specified
  if (overrides.hoursAgo !== undefined && overrides.hoursAgo > 0) {
    const past = new Date(Date.now() - overrides.hoursAgo * 60 * 60 * 1000).toISOString();
    db.prepare(
      'UPDATE long_term_memories SET last_accessed_at = ? WHERE id = ?'
    ).run(past, memory.id);
  }

  // Adjust strength if specified
  if (overrides.strength !== undefined && overrides.strength !== 1) {
    db.prepare(
      'UPDATE long_term_memories SET strength = ? WHERE id = ?'
    ).run(overrides.strength, memory.id);
  }

  return memory.id;
}

// ============================================================================
// Tests
// ============================================================================

describe('MemoryManager.pruneToCapacity', () => {
  let db: Database.Database;
  let vectorStore: VectorStore;
  let manager: MemoryManager;

  beforeEach(() => {
    db = createTestMemoryDb();
    vectorStore = createMockVectorStore();
    manager = new MemoryManager(db, vectorStore, createMockEmbeddingProvider());
  });

  it('returns 0 when count < maxPoolSize and no decay-eligible memories', async () => {
    // Insert a few recent, healthy memories
    insertTestMemory(db, { importance: 0.5, hoursAgo: 1 });
    insertTestMemory(db, { importance: 0.5, hoursAgo: 2 });

    const pruned = await manager.pruneToCapacity(100);
    expect(pruned).toBe(0);
    expect(memoryStore.getLongTermMemoryCount(db)).toBe(2);
  });

  it('never prunes core memories (importance >= MEMORY_CORE_IMPORTANCE_FLOOR)', async () => {
    // Insert core memories (high importance) that are very old
    insertTestMemory(db, { importance: MEMORY_CORE_IMPORTANCE_FLOOR, hoursAgo: 50000 });
    insertTestMemory(db, { importance: 0.8, hoursAgo: 50000 });
    insertTestMemory(db, { importance: 0.9, hoursAgo: 50000 });

    // Set maxPoolSize to 1, so we'd want to prune 2, but they're all core
    const pruned = await manager.pruneToCapacity(1);
    expect(pruned).toBe(0);
    expect(memoryStore.getLongTermMemoryCount(db)).toBe(3);
  });

  it('prunes excess memories when count > maxPoolSize', async () => {
    // Insert 5 non-core memories
    for (let i = 0; i < 5; i++) {
      insertTestMemory(db, { importance: 0.2, hoursAgo: i * 100 });
    }

    expect(memoryStore.getLongTermMemoryCount(db)).toBe(5);

    // Pool size of 3 means 2 excess
    const pruned = await manager.pruneToCapacity(3);
    expect(pruned).toBe(2);
    expect(memoryStore.getLongTermMemoryCount(db)).toBe(3);
    expect(vectorStore.deleteMemory).toHaveBeenCalledTimes(2);
  });

  it('prunes decay-eligible memories even when under the cap', async () => {
    // Insert 2 healthy recent memories
    insertTestMemory(db, { importance: 0.5, hoursAgo: 1 });
    insertTestMemory(db, { importance: 0.5, hoursAgo: 1 });

    // Insert 1 heavily decayed memory: low importance, very old, low strength
    // retention = e^(-hours / (strength * 720))
    // With strength=1 and hoursAgo=20000: retention = e^(-20000/720) ~ 0
    insertTestMemory(db, {
      importance: 0.1,
      strength: 1,
      hoursAgo: 20000,
    });

    expect(memoryStore.getLongTermMemoryCount(db)).toBe(3);

    // Pool size is very large, so no excess pruning needed
    const pruned = await manager.pruneToCapacity(10000);
    expect(pruned).toBe(1); // only the decayed one
    expect(memoryStore.getLongTermMemoryCount(db)).toBe(2);
  });

  it('prunes lowest-scored memories first', async () => {
    // Create memories with varying quality
    const recentHighImportance = insertTestMemory(db, { importance: 0.6, hoursAgo: 1 });
    const oldLowImportance = insertTestMemory(db, { importance: 0.1, hoursAgo: 5000 });
    const mediumMemory = insertTestMemory(db, { importance: 0.3, hoursAgo: 100 });

    // Force prune 1 by setting maxPoolSize = 2
    await manager.pruneToCapacity(2);

    // The old low-importance one should be pruned first
    expect(memoryStore.getLongTermMemory(db, oldLowImportance)).toBeNull();
    expect(memoryStore.getLongTermMemory(db, recentHighImportance)).not.toBeNull();
    expect(memoryStore.getLongTermMemory(db, mediumMemory)).not.toBeNull();
  });

  it('pruneDecayed delegates to pruneToCapacity with Infinity', async () => {
    // Insert a decayed memory
    insertTestMemory(db, { importance: 0.1, strength: 1, hoursAgo: 20000 });
    // Insert a healthy memory
    insertTestMemory(db, { importance: 0.5, hoursAgo: 1 });

    const pruned = await manager.pruneDecayed();
    expect(pruned).toBe(1);
    expect(memoryStore.getLongTermMemoryCount(db)).toBe(1);
  });
});
