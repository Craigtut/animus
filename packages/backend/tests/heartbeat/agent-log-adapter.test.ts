import { describe, it, expect } from 'vitest';
import { createAgentLogStoreAdapter } from '../../src/heartbeat/agent-log-adapter.js';
import { createTestAgentLogsDb } from '../helpers.js';

describe('createAgentLogStoreAdapter', () => {
  it('returns an object with the expected methods', () => {
    const db = createTestAgentLogsDb();
    const adapter = createAgentLogStoreAdapter(db);

    expect(adapter).toHaveProperty('createSession');
    expect(adapter).toHaveProperty('endSession');
    expect(adapter).toHaveProperty('insertEvent');
    expect(adapter).toHaveProperty('insertUsage');
    expect(typeof adapter.createSession).toBe('function');
    expect(typeof adapter.endSession).toBe('function');
    expect(typeof adapter.insertEvent).toBe('function');
    expect(typeof adapter.insertUsage).toBe('function');
  });

  it('createSession inserts and returns a session with an id', () => {
    const db = createTestAgentLogsDb();
    const adapter = createAgentLogStoreAdapter(db);

    const session = adapter.createSession({ provider: 'claude', model: 'claude-opus-4-6' });
    expect(session).toHaveProperty('id');
    expect(typeof session.id).toBe('string');
    expect(session.id.length).toBeGreaterThan(0);
  });

  it('endSession does not throw for valid session', () => {
    const db = createTestAgentLogsDb();
    const adapter = createAgentLogStoreAdapter(db);

    const session = adapter.createSession({ provider: 'claude' });
    expect(() => adapter.endSession(session.id, 'completed')).not.toThrow();
  });

  it('insertEvent creates an event for a session', () => {
    const db = createTestAgentLogsDb();
    const adapter = createAgentLogStoreAdapter(db);

    const session = adapter.createSession({ provider: 'claude' });
    expect(() =>
      adapter.insertEvent({
        sessionId: session.id,
        eventType: 'input_received',
        data: { message: 'hello' },
      })
    ).not.toThrow();
  });

  it('insertUsage records token usage', () => {
    const db = createTestAgentLogsDb();
    const adapter = createAgentLogStoreAdapter(db);

    const session = adapter.createSession({ provider: 'claude' });
    expect(() =>
      adapter.insertUsage({
        sessionId: session.id,
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
        costUsd: 0.005,
        model: 'claude-opus-4-6',
      })
    ).not.toThrow();
  });

  it('multiple sessions can be created independently', () => {
    const db = createTestAgentLogsDb();
    const adapter = createAgentLogStoreAdapter(db);

    const s1 = adapter.createSession({ provider: 'claude' });
    const s2 = adapter.createSession({ provider: 'codex' });

    expect(s1.id).not.toBe(s2.id);
  });
});
