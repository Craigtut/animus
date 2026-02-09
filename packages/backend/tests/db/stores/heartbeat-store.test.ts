import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestHeartbeatDb } from '../../helpers.js';
import * as store from '../../../src/db/stores/heartbeat-store.js';

describe('heartbeat-store', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestHeartbeatDb();
  });

  describe('heartbeat state', () => {
    it('returns default state', () => {
      const state = store.getHeartbeatState(db);
      expect(state.tickNumber).toBe(0);
      expect(state.currentStage).toBe('idle');
      expect(state.sessionState).toBe('cold');
      expect(state.isRunning).toBe(false);
    });

    it('updates heartbeat state', () => {
      store.updateHeartbeatState(db, {
        tickNumber: 5,
        currentStage: 'gather',
        isRunning: true,
      });
      const state = store.getHeartbeatState(db);
      expect(state.tickNumber).toBe(5);
      expect(state.currentStage).toBe('gather');
      expect(state.isRunning).toBe(true);
    });
  });

  describe('emotions', () => {
    it('returns 12 seeded emotions', () => {
      const emotions = store.getEmotionStates(db);
      expect(emotions).toHaveLength(12);
      const names = emotions.map((e) => e.emotion);
      expect(names).toContain('joy');
      expect(names).toContain('curiosity');
    });

    it('updates emotion intensity', () => {
      store.updateEmotionIntensity(db, 'joy', 0.8);
      const emotions = store.getEmotionStates(db);
      const joy = emotions.find((e) => e.emotion === 'joy');
      expect(joy!.intensity).toBe(0.8);
    });

    it('inserts emotion history', () => {
      const entry = store.insertEmotionHistory(db, {
        tickNumber: 1,
        emotion: 'joy',
        delta: 0.3,
        reasoning: 'User greeted warmly',
        intensityBefore: 0.2,
        intensityAfter: 0.5,
      });
      expect(entry.id).toBeDefined();
      expect(entry.delta).toBe(0.3);
    });
  });

  describe('thoughts', () => {
    it('inserts and retrieves thoughts', () => {
      store.insertThought(db, {
        tickNumber: 1,
        content: 'First thought',
        importance: 0.7,
      });
      store.insertThought(db, {
        tickNumber: 2,
        content: 'Second thought',
        importance: 0.3,
      });

      const thoughts = store.getRecentThoughts(db, 10);
      expect(thoughts).toHaveLength(2);
      const contents = thoughts.map((t) => t.content);
      expect(contents).toContain('First thought');
      expect(contents).toContain('Second thought');
    });
  });

  describe('experiences', () => {
    it('inserts and retrieves experiences', () => {
      store.insertExperience(db, {
        tickNumber: 1,
        content: 'Helped user solve a problem',
        importance: 0.9,
      });

      const experiences = store.getRecentExperiences(db, 10);
      expect(experiences).toHaveLength(1);
      expect(experiences[0]!.importance).toBe(0.9);
    });
  });

  describe('tick decisions', () => {
    it('inserts and retrieves decisions', () => {
      store.insertTickDecision(db, {
        tickNumber: 1,
        type: 'send_message',
        description: 'Reply to user',
        parameters: { contactId: '123', content: 'Hello' },
        outcome: 'executed',
      });

      const decisions = store.getTickDecisions(db, 1);
      expect(decisions).toHaveLength(1);
      expect(decisions[0]!.type).toBe('send_message');
      expect(decisions[0]!.parameters).toEqual({ contactId: '123', content: 'Hello' });
    });
  });

  describe('cleanup', () => {
    it('removes expired entries', () => {
      // Insert a thought with past expiry
      store.insertThought(db, {
        tickNumber: 1,
        content: 'Expired',
        importance: 0.1,
        expiresAt: '2020-01-01T00:00:00.000Z',
      });
      // Insert a thought with future expiry
      store.insertThought(db, {
        tickNumber: 2,
        content: 'Still valid',
        importance: 0.5,
        expiresAt: '2099-01-01T00:00:00.000Z',
      });

      const result = store.cleanupExpiredEntries(db);
      expect(result.thoughts).toBe(1);

      const remaining = store.getRecentThoughts(db, 10);
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.content).toBe('Still valid');
    });
  });
});
