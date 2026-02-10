/**
 * Tests for expanded heartbeat store functions:
 * - getEmotionHistory with filtering
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestHeartbeatDb } from '../../helpers.js';
import * as heartbeatStore from '../../../src/db/stores/heartbeat-store.js';

describe('heartbeat-store (expanded)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestHeartbeatDb();
  });

  describe('getEmotionHistory', () => {
    it('returns empty array when no history', () => {
      const history = heartbeatStore.getEmotionHistory(db);
      expect(history).toHaveLength(0);
    });

    it('returns all history entries', () => {
      heartbeatStore.insertEmotionHistory(db, {
        tickNumber: 1,
        emotion: 'joy',
        delta: 0.05,
        reasoning: 'Good news',
        intensityBefore: 0.1,
        intensityAfter: 0.15,
      });
      heartbeatStore.insertEmotionHistory(db, {
        tickNumber: 1,
        emotion: 'curiosity',
        delta: 0.03,
        reasoning: 'Interesting question',
        intensityBefore: 0.2,
        intensityAfter: 0.23,
      });

      const history = heartbeatStore.getEmotionHistory(db);
      expect(history).toHaveLength(2);
    });

    it('filters by emotion name', () => {
      heartbeatStore.insertEmotionHistory(db, {
        tickNumber: 1,
        emotion: 'joy',
        delta: 0.05,
        reasoning: 'test',
        intensityBefore: 0.1,
        intensityAfter: 0.15,
      });
      heartbeatStore.insertEmotionHistory(db, {
        tickNumber: 1,
        emotion: 'sadness',
        delta: 0.02,
        reasoning: 'test',
        intensityBefore: 0.0,
        intensityAfter: 0.02,
      });

      const joyOnly = heartbeatStore.getEmotionHistory(db, { emotion: 'joy' });
      expect(joyOnly).toHaveLength(1);
      expect(joyOnly[0]!.emotion).toBe('joy');
    });

    it('respects limit', () => {
      for (let i = 0; i < 5; i++) {
        heartbeatStore.insertEmotionHistory(db, {
          tickNumber: i + 1,
          emotion: 'joy',
          delta: 0.01,
          reasoning: `tick ${i + 1}`,
          intensityBefore: i * 0.01,
          intensityAfter: (i + 1) * 0.01,
        });
      }

      const limited = heartbeatStore.getEmotionHistory(db, { limit: 3 });
      expect(limited).toHaveLength(3);
    });
  });
});
