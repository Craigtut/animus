/**
 * Tests for the new query routes (memory, goals, agent-logs stores + heartbeat getRecentDecisions).
 *
 * These test the store-level functions that back the tRPC routers.
 * Router integration is covered by the typecheck + the E2E pipeline test.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createTestMemoryDb,
  createTestHeartbeatDb,
  createTestAgentLogsDb,
} from '../helpers.js';
import * as memoryStore from '../../src/db/stores/memory-store.js';
import * as heartbeatStore from '../../src/db/stores/heartbeat-store.js';
import * as agentLogStore from '../../src/db/stores/agent-log-store.js';
import type Database from 'better-sqlite3';

// ============================================================================
// Memory Store — listAllWorkingMemories
// ============================================================================

describe('memoryStore.listAllWorkingMemories', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestMemoryDb();
  });

  it('should return empty array when no working memories exist', () => {
    const result = memoryStore.listAllWorkingMemories(db);
    expect(result).toEqual([]);
  });

  it('should return all working memories', () => {
    memoryStore.upsertWorkingMemory(db, 'contact-1', 'Notes about Alice', 50);
    memoryStore.upsertWorkingMemory(db, 'contact-2', 'Notes about Bob', 30);

    const result = memoryStore.listAllWorkingMemories(db);
    expect(result).toHaveLength(2);
    expect(result.map((m) => m.contactId)).toContain('contact-1');
    expect(result.map((m) => m.contactId)).toContain('contact-2');
  });

  it('should return all entries (ordering depends on timestamp resolution)', () => {
    memoryStore.upsertWorkingMemory(db, 'contact-1', 'Notes A', 10);
    memoryStore.upsertWorkingMemory(db, 'contact-2', 'Notes B', 20);

    const result = memoryStore.listAllWorkingMemories(db);
    expect(result).toHaveLength(2);
    const ids = result.map((m) => m.contactId).sort();
    expect(ids).toEqual(['contact-1', 'contact-2']);
  });
});

// ============================================================================
// Heartbeat Store — getRecentDecisions
// ============================================================================

describe('heartbeatStore.getRecentDecisions', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestHeartbeatDb();
  });

  it('should return empty array when no decisions exist', () => {
    const result = heartbeatStore.getRecentDecisions(db);
    expect(result).toEqual([]);
  });

  it('should return decisions across ticks', () => {
    heartbeatStore.insertTickDecision(db, {
      tickNumber: 1,
      type: 'reply',
      description: 'Reply to user',
      outcome: 'executed',
    });
    heartbeatStore.insertTickDecision(db, {
      tickNumber: 2,
      type: 'spawn_agent',
      description: 'Spawn research agent',
      outcome: 'executed',
    });

    const result = heartbeatStore.getRecentDecisions(db);
    expect(result).toHaveLength(2);
    // Both tick numbers present
    const ticks = result.map((d) => d.tickNumber).sort();
    expect(ticks).toEqual([1, 2]);
  });

  it('should respect limit option', () => {
    for (let i = 0; i < 5; i++) {
      heartbeatStore.insertTickDecision(db, {
        tickNumber: i,
        type: 'reply',
        description: `Decision ${i}`,
        outcome: 'executed',
      });
    }

    const result = heartbeatStore.getRecentDecisions(db, { limit: 2 });
    expect(result).toHaveLength(2);
  });

  it('should parse JSON parameters', () => {
    heartbeatStore.insertTickDecision(db, {
      tickNumber: 1,
      type: 'spawn_agent',
      description: 'Spawn agent',
      parameters: { provider: 'claude', model: 'opus' },
      outcome: 'executed',
    });

    const result = heartbeatStore.getRecentDecisions(db);
    expect(result[0]!.parameters).toEqual({ provider: 'claude', model: 'opus' });
  });
});

// ============================================================================
// Agent Log Store — listSessions
// ============================================================================

describe('agentLogStore.listSessions', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestAgentLogsDb();
  });

  it('should return empty results when no sessions exist', () => {
    const result = agentLogStore.listSessions(db);
    expect(result.sessions).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('should list sessions with total count', () => {
    agentLogStore.createSession(db, { provider: 'claude' });
    agentLogStore.createSession(db, { provider: 'codex' });

    const result = agentLogStore.listSessions(db);
    expect(result.sessions).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it('should filter by status', () => {
    const session = agentLogStore.createSession(db, { provider: 'claude' });
    agentLogStore.createSession(db, { provider: 'codex' });
    agentLogStore.endSession(db, session.id, 'completed');

    const active = agentLogStore.listSessions(db, { status: 'active' });
    expect(active.sessions).toHaveLength(1);
    expect(active.total).toBe(1);

    const completed = agentLogStore.listSessions(db, { status: 'completed' });
    expect(completed.sessions).toHaveLength(1);
    expect(completed.total).toBe(1);
  });

  it('should support pagination with offset', () => {
    for (let i = 0; i < 5; i++) {
      agentLogStore.createSession(db, { provider: 'claude' });
    }

    const page1 = agentLogStore.listSessions(db, { limit: 2, offset: 0 });
    expect(page1.sessions).toHaveLength(2);
    expect(page1.total).toBe(5);

    const page2 = agentLogStore.listSessions(db, { limit: 2, offset: 2 });
    expect(page2.sessions).toHaveLength(2);

    const page3 = agentLogStore.listSessions(db, { limit: 2, offset: 4 });
    expect(page3.sessions).toHaveLength(1);
  });
});

// ============================================================================
// Agent Log Store — getAggregateUsage
// ============================================================================

describe('agentLogStore.getAggregateUsage', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestAgentLogsDb();
  });

  it('should return zero totals when no usage exists', () => {
    const result = agentLogStore.getAggregateUsage(db);
    expect(result.totalInputTokens).toBe(0);
    expect(result.totalOutputTokens).toBe(0);
    expect(result.totalTokens).toBe(0);
    expect(result.totalCostUsd).toBe(0);
    expect(result.sessionCount).toBe(0);
  });

  it('should aggregate usage across sessions', () => {
    const s1 = agentLogStore.createSession(db, { provider: 'claude' });
    const s2 = agentLogStore.createSession(db, { provider: 'codex' });

    agentLogStore.insertUsage(db, {
      sessionId: s1.id,
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      costUsd: 0.01,
      model: 'claude-opus',
    });
    agentLogStore.insertUsage(db, {
      sessionId: s2.id,
      inputTokens: 200,
      outputTokens: 100,
      totalTokens: 300,
      costUsd: 0.02,
      model: 'gpt-4',
    });

    const result = agentLogStore.getAggregateUsage(db);
    expect(result.totalInputTokens).toBe(300);
    expect(result.totalOutputTokens).toBe(150);
    expect(result.totalTokens).toBe(450);
    expect(result.totalCostUsd).toBe(0.03);
    expect(result.sessionCount).toBe(2);
  });
});
