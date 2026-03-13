/**
 * Tool Gate Tests — unified permission enforcement logic.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { resolveToolGate, type ToolGateParams } from '../../src/tools/tool-gate.js';
import { createTestHeartbeatDb } from '../helpers.js';
import * as heartbeatStore from '../../src/db/stores/heartbeat-store.js';
import type { IEventBus, ToolPermissionMode } from '@animus-labs/shared';

function makeMockEventBus(): IEventBus & { emittedEvents: Array<{ event: string; data: unknown }> } {
  const emittedEvents: Array<{ event: string; data: unknown }> = [];
  return {
    emittedEvents,
    emit: (event: string, data: unknown) => { emittedEvents.push({ event, data }); },
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
    removeAllListeners: vi.fn(),
  } as unknown as IEventBus & { emittedEvents: Array<{ event: string; data: unknown }> };
}

function makeParams(
  db: Database.Database,
  eventBus: IEventBus,
  overrides: Partial<ToolGateParams> = {},
): ToolGateParams {
  return {
    heartbeatDb: db,
    permKey: 'Bash',
    mode: 'ask' as ToolPermissionMode,
    displayName: 'Bash',
    toolSource: 'sdk:claude',
    contactId: 'contact-1',
    sourceChannel: 'web',
    conversationId: 'conv-1',
    toolName: 'Bash',
    toolInput: { command: 'ls' },
    originatingAgent: 'mind',
    eventBus,
    ...overrides,
  };
}

function seedApprovalRequest(db: Database.Database, overrides: Partial<Parameters<typeof heartbeatStore.createApprovalRequest>[1]> = {}) {
  return heartbeatStore.createApprovalRequest(db, {
    toolName: 'Bash',
    toolSource: 'sdk:claude',
    contactId: 'contact-1',
    channel: 'web',
    tickNumber: 1,
    agentContext: {
      taskDescription: 'Test',
      conversationSummary: 'Test',
      pendingAction: 'Test',
    },
    toolInput: null,
    triggerSummary: 'Test',
    conversationId: 'conv-1',
    originatingAgent: 'mind',
    ...overrides,
  });
}

describe('resolveToolGate', () => {
  let db: Database.Database;
  let eventBus: ReturnType<typeof makeMockEventBus>;

  beforeEach(() => {
    db = createTestHeartbeatDb();
    eventBus = makeMockEventBus();
  });

  // ========================================================================
  // Mode checks
  // ========================================================================

  describe('mode checks', () => {
    it('denies when mode is off', () => {
      const result = resolveToolGate(makeParams(db, eventBus, { mode: 'off' }));
      expect(result.action).toBe('deny');
      expect((result as { reason: string }).reason).toContain('disabled');
    });

    it('allows when mode is always_allow', () => {
      const result = resolveToolGate(makeParams(db, eventBus, { mode: 'always_allow' }));
      expect(result.action).toBe('allow');
    });
  });

  // ========================================================================
  // Ask mode — active approval
  // ========================================================================

  describe('ask mode — active approval', () => {
    it('consumes active approval and allows', () => {
      const req = seedApprovalRequest(db);
      heartbeatStore.resolveApproval(db, req.id, 'approved', 'once');

      const result = resolveToolGate(makeParams(db, eventBus));
      expect(result.action).toBe('allow');

      // Approval is consumed (status = expired)
      const fetched = heartbeatStore.getApprovalRequest(db, req.id);
      expect(fetched!.status).toBe('expired');
    });

    it('does not find approval for different contact', () => {
      const req = seedApprovalRequest(db, { contactId: 'other-contact' });
      heartbeatStore.resolveApproval(db, req.id, 'approved', 'once');

      const result = resolveToolGate(makeParams(db, eventBus, { contactId: 'contact-1' }));
      expect(result.action).toBe('deny');
    });
  });

  // ========================================================================
  // Ask mode — pending approval enforcement
  // ========================================================================

  describe('ask mode — pending approvals', () => {
    it('blocks when same tool already pending (no new request created)', () => {
      seedApprovalRequest(db);

      const result = resolveToolGate(makeParams(db, eventBus));
      expect(result.action).toBe('deny');
      expect((result as { reason: string }).reason).toContain('requires user approval');

      // No new approval request created (still just the original one)
      const pending = heartbeatStore.getPendingApprovals(db, 'contact-1');
      expect(pending).toHaveLength(1);
      expect(eventBus.emittedEvents).toHaveLength(0);
    });

    it('blocks when different tool already pending', () => {
      seedApprovalRequest(db, { toolName: 'Write' });

      const result = resolveToolGate(makeParams(db, eventBus, { permKey: 'Bash' }));
      expect(result.action).toBe('deny');
      expect((result as { reason: string }).reason).toContain('already a pending');
      expect(eventBus.emittedEvents).toHaveLength(0);
    });
  });

  // ========================================================================
  // Ask mode — new approval request
  // ========================================================================

  describe('ask mode — new approval request', () => {
    it('creates approval request and emits event when no pending exists', () => {
      const result = resolveToolGate(makeParams(db, eventBus));
      expect(result.action).toBe('deny');
      expect((result as { reason: string }).reason).toContain('requires user approval');

      // Approval request was created
      const pending = heartbeatStore.getPendingApprovals(db, 'contact-1');
      expect(pending).toHaveLength(1);
      expect(pending[0]!.toolName).toBe('Bash');

      // Event was emitted
      expect(eventBus.emittedEvents).toHaveLength(1);
      expect(eventBus.emittedEvents[0]!.event).toBe('tool:approval_requested');
    });

    it('stores correct metadata in approval request', () => {
      resolveToolGate(makeParams(db, eventBus, {
        permKey: 'mcp__obsidian__vault',
        toolName: 'mcp__obsidian__vault__get_vault_stats',
        displayName: 'Obsidian Vault',
        toolSource: 'plugin:obsidian',
      }));

      const pending = heartbeatStore.getPendingApprovals(db, 'contact-1');
      expect(pending[0]!.toolName).toBe('mcp__obsidian__vault');
      expect(pending[0]!.toolSource).toBe('plugin:obsidian');
      expect(pending[0]!.triggerSummary).toContain('Obsidian Vault');
    });
  });

  // ========================================================================
  // Plugin MCP tools
  // ========================================================================

  describe('plugin MCP tools', () => {
    it('uses permKey (server-level) for approval storage, not full tool name', () => {
      resolveToolGate(makeParams(db, eventBus, {
        permKey: 'mcp__obsidian__vault',
        toolName: 'mcp__obsidian__vault__read_note',
      }));

      const pending = heartbeatStore.getPendingApprovals(db, 'contact-1');
      expect(pending[0]!.toolName).toBe('mcp__obsidian__vault');
    });

    it('active approval on permKey works for any function on that server', () => {
      // Create and approve at server level
      const req = seedApprovalRequest(db, { toolName: 'mcp__obsidian__vault' });
      heartbeatStore.resolveApproval(db, req.id, 'approved', 'once');

      // Call a specific function — should find the server-level approval
      const result = resolveToolGate(makeParams(db, eventBus, {
        permKey: 'mcp__obsidian__vault',
        toolName: 'mcp__obsidian__vault__read_note',
      }));
      expect(result.action).toBe('allow');
    });
  });
});
