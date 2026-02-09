import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestAgentLogsDb } from '../../helpers.js';
import * as store from '../../../src/db/stores/agent-log-store.js';

describe('agent-log-store', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestAgentLogsDb();
  });

  describe('sessions', () => {
    it('creates and retrieves a session', () => {
      const session = store.createSession(db, {
        provider: 'claude',
        model: 'claude-sonnet-4-5-20250929',
      });
      expect(session.id).toBeDefined();
      expect(session.status).toBe('active');
      expect(session.provider).toBe('claude');
      expect(session.model).toBe('claude-sonnet-4-5-20250929');

      const found = store.getSession(db, session.id);
      expect(found).not.toBeNull();
      expect(found!.provider).toBe('claude');
    });

    it('ends a session', () => {
      const session = store.createSession(db, { provider: 'claude' });
      store.endSession(db, session.id, 'completed');

      const found = store.getSession(db, session.id);
      expect(found!.status).toBe('completed');
      expect(found!.endedAt).toBeDefined();
    });

    it('returns null for nonexistent session', () => {
      expect(store.getSession(db, 'nonexistent')).toBeNull();
    });
  });

  describe('events', () => {
    it('inserts and retrieves events', () => {
      const session = store.createSession(db, { provider: 'claude' });
      store.insertEvent(db, {
        sessionId: session.id,
        eventType: 'session_start',
        data: { prompt: 'Hello' },
      });
      store.insertEvent(db, {
        sessionId: session.id,
        eventType: 'response_end',
        data: { response: 'Hi there' },
      });

      const events = store.getSessionEvents(db, session.id);
      expect(events).toHaveLength(2);
      expect(events[0]!.eventType).toBe('session_start');
      expect(events[0]!.data).toEqual({ prompt: 'Hello' });
    });
  });

  describe('usage', () => {
    it('inserts and retrieves usage', () => {
      const session = store.createSession(db, { provider: 'claude' });
      store.insertUsage(db, {
        sessionId: session.id,
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
        costUsd: 0.005,
        model: 'claude-sonnet-4-5-20250929',
      });

      const usage = store.getSessionUsage(db, session.id);
      expect(usage).toHaveLength(1);
      expect(usage[0]!.totalTokens).toBe(300);
    });
  });

  describe('cleanup', () => {
    it('cleans up old sessions', () => {
      // Create a session and manually set started_at to far in the past
      const session = store.createSession(db, { provider: 'claude' });
      db.prepare(
        "UPDATE agent_sessions SET started_at = datetime('now', '-100 days') WHERE id = ?"
      ).run(session.id);

      const deleted = store.cleanupOldSessions(db, 30);
      expect(deleted).toBe(1);

      expect(store.getSession(db, session.id)).toBeNull();
    });
  });
});
