import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestMemoryDb } from '../../helpers.js';
import * as store from '../../../src/db/stores/memory-store.js';

describe('memory-store', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestMemoryDb();
  });

  describe('working memory', () => {
    it('returns null for nonexistent contact', () => {
      expect(store.getWorkingMemory(db, 'nonexistent')).toBeNull();
    });

    it('upserts and retrieves working memory', () => {
      store.upsertWorkingMemory(db, 'contact-1', 'Likes cats', 5);
      const wm = store.getWorkingMemory(db, 'contact-1');
      expect(wm).not.toBeNull();
      expect(wm!.content).toBe('Likes cats');
      expect(wm!.tokenCount).toBe(5);
    });

    it('updates existing working memory', () => {
      store.upsertWorkingMemory(db, 'contact-1', 'v1', 3);
      store.upsertWorkingMemory(db, 'contact-1', 'v2', 4);
      const wm = store.getWorkingMemory(db, 'contact-1');
      expect(wm!.content).toBe('v2');
      expect(wm!.tokenCount).toBe(4);
    });
  });

  describe('core self', () => {
    it('returns default empty core self', () => {
      const cs = store.getCoreSelf(db);
      expect(cs).not.toBeNull();
      expect(cs!.content).toBe('');
    });

    it('updates core self', () => {
      store.upsertCoreSelf(db, 'I am curious and empathetic', 10);
      const cs = store.getCoreSelf(db);
      expect(cs!.content).toBe('I am curious and empathetic');
      expect(cs!.tokenCount).toBe(10);
    });
  });

  describe('long-term memories', () => {
    it('inserts and retrieves a memory', () => {
      const mem = store.insertLongTermMemory(db, {
        content: 'User prefers dark mode',
        importance: 0.7,
        memoryType: 'fact',
        sourceType: 'conversation',
        keywords: ['preference', 'dark-mode'],
      });
      expect(mem.id).toBeDefined();
      expect(mem.strength).toBe(1);

      const found = store.getLongTermMemory(db, mem.id);
      expect(found).not.toBeNull();
      expect(found!.content).toBe('User prefers dark mode');
      expect(found!.keywords).toEqual(['preference', 'dark-mode']);
    });

    it('searches by memory type', () => {
      store.insertLongTermMemory(db, {
        content: 'A fact',
        importance: 0.5,
        memoryType: 'fact',
      });
      store.insertLongTermMemory(db, {
        content: 'A procedure',
        importance: 0.5,
        memoryType: 'procedure',
      });

      const facts = store.searchLongTermMemories(db, { memoryType: 'fact' });
      expect(facts).toHaveLength(1);
      expect(facts[0]!.content).toBe('A fact');
    });

    it('updates memory access', () => {
      const mem = store.insertLongTermMemory(db, {
        content: 'Test',
        importance: 0.5,
        memoryType: 'fact',
      });
      store.updateMemoryAccess(db, mem.id);
      const updated = store.getLongTermMemory(db, mem.id);
      expect(updated!.strength).toBe(2);
    });

    it('returns null for nonexistent memory', () => {
      expect(store.getLongTermMemory(db, 'nonexistent')).toBeNull();
    });
  });
});
