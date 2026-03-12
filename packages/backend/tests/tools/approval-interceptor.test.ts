/**
 * Approval Interceptor Tests — pre-pipeline phrase interception.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import type { TriggerContext } from '../../src/heartbeat/context-builder.js';
import { interceptApprovalPhrase, type InterceptorDeps } from '../../src/tools/approval-interceptor.js';
import { createTestHeartbeatDb } from '../helpers.js';
import * as heartbeatStore from '../../src/db/stores/heartbeat-store.js';

function makeTrigger(overrides: Partial<TriggerContext> = {}): TriggerContext {
  return {
    type: 'message',
    contactId: 'contact-1',
    channel: 'sms',
    messageContent: 'yes',
    ...overrides,
  } as TriggerContext;
}

function makeApprovalData(overrides: Partial<Parameters<typeof heartbeatStore.createApprovalRequest>[1]> = {}) {
  return {
    toolName: 'write',
    toolSource: 'sdk:claude',
    contactId: 'contact-1',
    channel: 'sms',
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

describe('interceptApprovalPhrase', () => {
  let db: Database.Database;
  let deps: InterceptorDeps;
  let emittedEvents: Array<{ event: string; data: unknown }>;

  beforeEach(() => {
    db = createTestHeartbeatDb();
    emittedEvents = [];
    deps = {
      heartbeatDb: db,
      eventBus: {
        emit: (event: string, data: unknown) => {
          emittedEvents.push({ event, data });
        },
        on: vi.fn(),
        off: vi.fn(),
        once: vi.fn(),
        removeAllListeners: vi.fn(),
      } as unknown as InterceptorDeps['eventBus'],
    };
  });

  // ========================================================================
  // Pass-through cases
  // ========================================================================

  describe('pass-through (no interception)', () => {
    it('returns trigger unchanged for non-message triggers', () => {
      const trigger = makeTrigger({ type: 'interval' as TriggerContext['type'] });
      const result = interceptApprovalPhrase(trigger, deps);
      expect(result).toBe(trigger);
    });

    it('returns trigger unchanged when no contactId', () => {
      const trigger = makeTrigger({ contactId: undefined });
      const result = interceptApprovalPhrase(trigger, deps);
      expect(result).toBe(trigger);
    });

    it('returns trigger unchanged when message is empty', () => {
      const trigger = makeTrigger({ messageContent: '' });
      const result = interceptApprovalPhrase(trigger, deps);
      expect(result).toBe(trigger);
    });

    it('returns trigger unchanged when no pending approvals', () => {
      const trigger = makeTrigger({ messageContent: 'yes' });
      const result = interceptApprovalPhrase(trigger, deps);
      expect(result).toBe(trigger);
    });

    it('returns trigger unchanged when message is not a recognized phrase', () => {
      heartbeatStore.createApprovalRequest(db, makeApprovalData());
      const trigger = makeTrigger({ messageContent: 'I think that sounds good' });
      const result = interceptApprovalPhrase(trigger, deps);
      expect(result).toBe(trigger);
    });
  });

  // ========================================================================
  // Approval interception
  // ========================================================================

  describe('approval', () => {
    it('resolves pending approval and transforms trigger for "yes"', () => {
      const req = heartbeatStore.createApprovalRequest(db, makeApprovalData());
      const trigger = makeTrigger({ messageContent: 'yes' });

      const result = interceptApprovalPhrase(trigger, deps);

      expect(result.messageContent).toContain('approved');
      expect(result.messageContent).toContain('write');

      // DB is updated
      const fetched = heartbeatStore.getApprovalRequest(db, req.id);
      expect(fetched!.status).toBe('approved');
      expect(fetched!.scope).toBe('once');
    });

    it('resolves pending approval for "approve"', () => {
      const req = heartbeatStore.createApprovalRequest(db, makeApprovalData());
      const trigger = makeTrigger({ messageContent: 'approve' });

      const result = interceptApprovalPhrase(trigger, deps);

      expect(result.messageContent).toContain('approved');
      const fetched = heartbeatStore.getApprovalRequest(db, req.id);
      expect(fetched!.status).toBe('approved');
    });

    it('emits tool:approval_resolved event on approval', () => {
      const req = heartbeatStore.createApprovalRequest(db, makeApprovalData());
      interceptApprovalPhrase(makeTrigger({ messageContent: 'yes' }), deps);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0]!.event).toBe('tool:approval_resolved');
      expect(emittedEvents[0]!.data).toEqual({
        id: req.id,
        toolName: 'write',
        status: 'approved',
        scope: 'once',
      });
    });
  });

  // ========================================================================
  // Denial interception
  // ========================================================================

  describe('denial', () => {
    it('resolves pending approval as denied for "no"', () => {
      const req = heartbeatStore.createApprovalRequest(db, makeApprovalData());
      const trigger = makeTrigger({ messageContent: 'no' });

      const result = interceptApprovalPhrase(trigger, deps);

      expect(result.messageContent).toContain('denied');
      expect(result.messageContent).toContain('write');

      const fetched = heartbeatStore.getApprovalRequest(db, req.id);
      expect(fetched!.status).toBe('denied');
      expect(fetched!.scope).toBeNull();
    });

    it('emits tool:approval_resolved event on denial', () => {
      const req = heartbeatStore.createApprovalRequest(db, makeApprovalData());
      interceptApprovalPhrase(makeTrigger({ messageContent: 'deny' }), deps);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0]!.data).toEqual({
        id: req.id,
        toolName: 'write',
        status: 'denied',
        scope: null,
      });
    });
  });

  // ========================================================================
  // Contact isolation
  // ========================================================================

  describe('contact isolation', () => {
    it('only intercepts approvals for the triggering contact', () => {
      heartbeatStore.createApprovalRequest(db, makeApprovalData({ contactId: 'other-contact' }));
      const trigger = makeTrigger({ contactId: 'contact-1', messageContent: 'yes' });

      const result = interceptApprovalPhrase(trigger, deps);

      // No pending for contact-1, so trigger passes through unchanged
      expect(result).toBe(trigger);
    });
  });

  // ========================================================================
  // One-at-a-time (resolves first pending)
  // ========================================================================

  describe('one-at-a-time', () => {
    it('resolves only the first pending approval when multiple exist', () => {
      heartbeatStore.createApprovalRequest(db, makeApprovalData({ toolName: 'write' }));
      heartbeatStore.createApprovalRequest(db, makeApprovalData({ toolName: 'edit' }));

      const trigger = makeTrigger({ messageContent: 'yes' });
      const result = interceptApprovalPhrase(trigger, deps);

      // One of the two gets resolved (whichever getPendingApprovals returns first)
      expect(result.messageContent).toContain('approved');

      // Only one is resolved, the other remains pending
      const pending = heartbeatStore.getPendingApprovals(db, 'contact-1');
      expect(pending).toHaveLength(1);
    });
  });

  // ========================================================================
  // Preserves other trigger fields
  // ========================================================================

  describe('trigger transformation', () => {
    it('preserves all trigger fields except messageContent', () => {
      heartbeatStore.createApprovalRequest(db, makeApprovalData());
      const trigger = makeTrigger({
        messageContent: 'yes',
        contactId: 'contact-1',
        channel: 'sms',
      });

      const result = interceptApprovalPhrase(trigger, deps);

      expect(result.type).toBe('message');
      expect(result.contactId).toBe('contact-1');
      expect(result.channel).toBe('sms');
      expect(result.messageContent).not.toBe('yes');
    });
  });
});
