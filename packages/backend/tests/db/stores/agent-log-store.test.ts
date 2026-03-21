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

    it('retrieves usage by tick number with per-phase records', () => {
      const session = store.createSession(db, { provider: 'claude' });
      store.insertUsage(db, {
        sessionId: session.id,
        inputTokens: 1000,
        outputTokens: 200,
        cacheReadTokens: 800,
        cacheWriteTokens: 500,
        totalTokens: 1200,
        costUsd: 0.01,
        model: 'claude-sonnet-4-5-20250929',
        tickNumber: 42,
        tickType: 'interval',
        pipelinePhase: 'THOUGHT',
      });
      store.insertUsage(db, {
        sessionId: session.id,
        inputTokens: 2000,
        outputTokens: 500,
        cacheReadTokens: 1500,
        cacheWriteTokens: 0,
        totalTokens: 2500,
        costUsd: 0.03,
        model: 'claude-sonnet-4-5-20250929',
        tickNumber: 42,
        tickType: 'interval',
        pipelinePhase: 'AGENTIC_LOOP',
      });
      store.insertUsage(db, {
        sessionId: session.id,
        inputTokens: 1200,
        outputTokens: 150,
        cacheReadTokens: 1000,
        cacheWriteTokens: 0,
        totalTokens: 1350,
        costUsd: 0.008,
        model: 'claude-sonnet-4-5-20250929',
        tickNumber: 42,
        tickType: 'interval',
        pipelinePhase: 'REFLECT',
      });

      const usage = store.getUsageByTickNumber(db, 42);
      expect(usage).toHaveLength(3);

      expect(usage[0]!.pipelinePhase).toBe('THOUGHT');
      expect(usage[0]!.cacheReadTokens).toBe(800);
      expect(usage[0]!.cacheWriteTokens).toBe(500);
      expect(usage[0]!.inputTokens).toBe(1000);

      expect(usage[1]!.pipelinePhase).toBe('AGENTIC_LOOP');
      expect(usage[1]!.cacheReadTokens).toBe(1500);
      expect(usage[1]!.cacheWriteTokens).toBe(0);

      expect(usage[2]!.pipelinePhase).toBe('REFLECT');
      expect(usage[2]!.cacheReadTokens).toBe(1000);
    });

    it('returns empty array for tick number with no usage', () => {
      const usage = store.getUsageByTickNumber(db, 9999);
      expect(usage).toHaveLength(0);
    });

    it('does not include usage from other ticks', () => {
      const session = store.createSession(db, { provider: 'claude' });
      store.insertUsage(db, {
        sessionId: session.id,
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        model: 'claude-sonnet-4-5-20250929',
        tickNumber: 10,
        pipelinePhase: 'THOUGHT',
      });
      store.insertUsage(db, {
        sessionId: session.id,
        inputTokens: 200,
        outputTokens: 80,
        totalTokens: 280,
        model: 'claude-sonnet-4-5-20250929',
        tickNumber: 11,
        pipelinePhase: 'THOUGHT',
      });

      const tick10Usage = store.getUsageByTickNumber(db, 10);
      expect(tick10Usage).toHaveLength(1);
      expect(tick10Usage[0]!.inputTokens).toBe(100);

      const tick11Usage = store.getUsageByTickNumber(db, 11);
      expect(tick11Usage).toHaveLength(1);
      expect(tick11Usage[0]!.inputTokens).toBe(200);
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
