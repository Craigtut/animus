/**
 * Tool Approval Store Tests — CRUD for tool_approval_requests table.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestHeartbeatDb } from '../helpers.js';
import * as heartbeatStore from '../../src/db/stores/heartbeat-store.js';

function makeApprovalData(overrides: Partial<Parameters<typeof heartbeatStore.createApprovalRequest>[1]> = {}) {
  return {
    toolName: 'write',
    toolSource: 'sdk:claude',
    contactId: 'contact-1',
    channel: 'web',
    tickNumber: 1,
    agentContext: {
      taskDescription: 'Write a file',
      conversationSummary: 'User asked to create a config',
      pendingAction: 'Execute write tool',
    },
    toolInput: { path: '/tmp/test.txt', content: 'hello' },
    triggerSummary: 'Agent wants to use "Write File"',
    conversationId: 'conv-1',
    originatingAgent: 'mind',
    ...overrides,
  };
}

describe('tool approval store', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestHeartbeatDb();
  });

  // ========================================================================
  // createApprovalRequest
  // ========================================================================

  describe('createApprovalRequest', () => {
    it('creates and returns an approval request with correct fields', () => {
      const req = heartbeatStore.createApprovalRequest(db, makeApprovalData());
      expect(req.id).toBeDefined();
      expect(req.toolName).toBe('write');
      expect(req.toolSource).toBe('sdk:claude');
      expect(req.contactId).toBe('contact-1');
      expect(req.channel).toBe('web');
      expect(req.tickNumber).toBe(1);
      expect(req.status).toBe('pending');
      expect(req.scope).toBeNull();
      expect(req.agentContext.taskDescription).toBe('Write a file');
      expect(req.toolInput).toEqual({ path: '/tmp/test.txt', content: 'hello' });
      expect(req.triggerSummary).toBe('Agent wants to use "Write File"');
      expect(req.resolvedAt).toBeNull();
      expect(req.expiresAt).toBeDefined();
    });

    it('persists to database and can be retrieved', () => {
      const req = heartbeatStore.createApprovalRequest(db, makeApprovalData());
      const fetched = heartbeatStore.getApprovalRequest(db, req.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.toolName).toBe('write');
      expect(fetched!.status).toBe('pending');
    });

    it('handles null toolInput', () => {
      const req = heartbeatStore.createApprovalRequest(db, makeApprovalData({ toolInput: null }));
      expect(req.toolInput).toBeNull();
      const fetched = heartbeatStore.getApprovalRequest(db, req.id);
      expect(fetched!.toolInput).toBeNull();
    });
  });

  // ========================================================================
  // getPendingApprovals
  // ========================================================================

  describe('getPendingApprovals', () => {
    it('returns only pending, non-expired requests', () => {
      heartbeatStore.createApprovalRequest(db, makeApprovalData({ toolName: 'write' }));
      heartbeatStore.createApprovalRequest(db, makeApprovalData({ toolName: 'edit' }));

      const pending = heartbeatStore.getPendingApprovals(db);
      expect(pending).toHaveLength(2);
    });

    it('filters by contactId', () => {
      heartbeatStore.createApprovalRequest(db, makeApprovalData({ contactId: 'c1' }));
      heartbeatStore.createApprovalRequest(db, makeApprovalData({ contactId: 'c2' }));

      const c1Pending = heartbeatStore.getPendingApprovals(db, 'c1');
      expect(c1Pending).toHaveLength(1);
      expect(c1Pending[0]!.contactId).toBe('c1');
    });

    it('excludes resolved requests', () => {
      const req = heartbeatStore.createApprovalRequest(db, makeApprovalData());
      heartbeatStore.resolveApproval(db, req.id, 'approved', 'once');

      const pending = heartbeatStore.getPendingApprovals(db);
      expect(pending).toHaveLength(0);
    });
  });

  // ========================================================================
  // resolveApproval
  // ========================================================================

  describe('resolveApproval', () => {
    it('approves with scope once', () => {
      const req = heartbeatStore.createApprovalRequest(db, makeApprovalData());
      heartbeatStore.resolveApproval(db, req.id, 'approved', 'once');

      const fetched = heartbeatStore.getApprovalRequest(db, req.id);
      expect(fetched!.status).toBe('approved');
      expect(fetched!.scope).toBe('once');
      expect(fetched!.resolvedAt).not.toBeNull();
    });

    it('denies without scope', () => {
      const req = heartbeatStore.createApprovalRequest(db, makeApprovalData());
      heartbeatStore.resolveApproval(db, req.id, 'denied');

      const fetched = heartbeatStore.getApprovalRequest(db, req.id);
      expect(fetched!.status).toBe('denied');
      expect(fetched!.scope).toBeNull();
    });
  });

  // ========================================================================
  // getActiveApproval
  // ========================================================================

  describe('getActiveApproval', () => {
    it('returns approved request with scope once', () => {
      const req = heartbeatStore.createApprovalRequest(db, makeApprovalData());
      heartbeatStore.resolveApproval(db, req.id, 'approved', 'once');

      const active = heartbeatStore.getActiveApproval(db, 'write', 'contact-1');
      expect(active).not.toBeNull();
      expect(active!.id).toBe(req.id);
    });

    it('returns null for denied request', () => {
      const req = heartbeatStore.createApprovalRequest(db, makeApprovalData());
      heartbeatStore.resolveApproval(db, req.id, 'denied');

      const active = heartbeatStore.getActiveApproval(db, 'write', 'contact-1');
      expect(active).toBeNull();
    });

    it('returns null for wrong contact', () => {
      const req = heartbeatStore.createApprovalRequest(db, makeApprovalData());
      heartbeatStore.resolveApproval(db, req.id, 'approved', 'once');

      const active = heartbeatStore.getActiveApproval(db, 'write', 'other-contact');
      expect(active).toBeNull();
    });
  });

  // ========================================================================
  // consumeApproval
  // ========================================================================

  describe('consumeApproval', () => {
    it('marks approval as expired (consumed)', () => {
      const req = heartbeatStore.createApprovalRequest(db, makeApprovalData());
      heartbeatStore.resolveApproval(db, req.id, 'approved', 'once');
      heartbeatStore.consumeApproval(db, req.id);

      const fetched = heartbeatStore.getApprovalRequest(db, req.id);
      expect(fetched!.status).toBe('expired');
    });

    it('consumed approval is no longer active', () => {
      const req = heartbeatStore.createApprovalRequest(db, makeApprovalData());
      heartbeatStore.resolveApproval(db, req.id, 'approved', 'once');
      heartbeatStore.consumeApproval(db, req.id);

      const active = heartbeatStore.getActiveApproval(db, 'write', 'contact-1');
      expect(active).toBeNull();
    });
  });

  // ========================================================================
  // expirePendingApprovals
  // ========================================================================

  describe('expirePendingApprovals', () => {
    it('expires requests past their expiry time', () => {
      const req = heartbeatStore.createApprovalRequest(db, makeApprovalData());

      // Backdate expires_at to 1 hour ago using SQLite datetime format
      const pastDate = new Date(Date.now() - 3600000).toISOString().replace('T', ' ').replace('Z', '');
      db.prepare('UPDATE tool_approval_requests SET expires_at = ? WHERE id = ?').run(pastDate, req.id);

      const expired = heartbeatStore.expirePendingApprovals(db);
      expect(expired).toBe(1);

      const pending = heartbeatStore.getPendingApprovals(db);
      expect(pending).toHaveLength(0);
    });

    it('does not expire future requests', () => {
      heartbeatStore.createApprovalRequest(db, makeApprovalData());
      const expired = heartbeatStore.expirePendingApprovals(db);
      expect(expired).toBe(0);
    });
  });

  // ========================================================================
  // getApprovalStats
  // ========================================================================

  describe('getApprovalStats', () => {
    it('counts approved and denied in time window', () => {
      const r1 = heartbeatStore.createApprovalRequest(db, makeApprovalData());
      heartbeatStore.resolveApproval(db, r1.id, 'approved', 'once');

      const r2 = heartbeatStore.createApprovalRequest(db, makeApprovalData());
      heartbeatStore.resolveApproval(db, r2.id, 'approved', 'once');

      const r3 = heartbeatStore.createApprovalRequest(db, makeApprovalData());
      heartbeatStore.resolveApproval(db, r3.id, 'denied');

      const stats = heartbeatStore.getApprovalStats(db, 'write', 7);
      expect(stats.approved).toBe(2);
      expect(stats.denied).toBe(1);
    });

    it('returns zero for unknown tool', () => {
      const stats = heartbeatStore.getApprovalStats(db, 'nonexistent', 7);
      expect(stats.approved).toBe(0);
      expect(stats.denied).toBe(0);
    });
  });

  // ========================================================================
  // cleanupOldApprovals
  // ========================================================================

  describe('cleanupOldApprovals', () => {
    it('removes resolved approvals older than retention period', () => {
      // Create and resolve an approval, then backdate it
      const req = heartbeatStore.createApprovalRequest(db, makeApprovalData());
      heartbeatStore.resolveApproval(db, req.id, 'approved', 'once');

      // Backdate the created_at to 30 days ago
      const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      db.prepare('UPDATE tool_approval_requests SET created_at = ? WHERE id = ?').run(oldDate, req.id);

      const cleaned = heartbeatStore.cleanupOldApprovals(db, 7);
      expect(cleaned).toBe(1);
    });

    it('does not remove pending approvals', () => {
      const req = heartbeatStore.createApprovalRequest(db, makeApprovalData());
      // Backdate but leave as pending
      const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      db.prepare('UPDATE tool_approval_requests SET created_at = ? WHERE id = ?').run(oldDate, req.id);

      const cleaned = heartbeatStore.cleanupOldApprovals(db, 7);
      expect(cleaned).toBe(0);
    });
  });

  // ========================================================================
  // getRecentApprovals
  // ========================================================================

  describe('getRecentApprovals', () => {
    it('returns approvals ordered by created_at descending', () => {
      heartbeatStore.createApprovalRequest(db, makeApprovalData({ toolName: 'write' }));
      heartbeatStore.createApprovalRequest(db, makeApprovalData({ toolName: 'edit' }));
      heartbeatStore.createApprovalRequest(db, makeApprovalData({ toolName: 'bash' }));

      const recent = heartbeatStore.getRecentApprovals(db, 2);
      expect(recent).toHaveLength(2);
    });
  });
});
