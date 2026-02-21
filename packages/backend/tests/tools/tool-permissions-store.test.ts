/**
 * Tool Permissions Store Tests — CRUD for tool_permissions table.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestSystemDb } from '../helpers.js';
import * as systemStore from '../../src/db/stores/system-store.js';

function insertPermission(db: Database.Database, overrides: Partial<Parameters<typeof systemStore.upsertToolPermission>[1]> = {}) {
  const data = {
    toolName: 'test_tool',
    toolSource: 'animus:core',
    displayName: 'Test Tool',
    description: 'A test tool',
    riskTier: 'acts' as const,
    mode: 'ask' as const,
    isDefault: true,
    ...overrides,
  };
  systemStore.upsertToolPermission(db, data);
  return data;
}

describe('tool permissions store', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestSystemDb();
  });

  // ========================================================================
  // upsertToolPermission
  // ========================================================================

  describe('upsertToolPermission', () => {
    it('inserts a new tool permission', () => {
      insertPermission(db);
      const perm = systemStore.getToolPermission(db, 'test_tool');
      expect(perm).not.toBeNull();
      expect(perm!.toolName).toBe('test_tool');
      expect(perm!.toolSource).toBe('animus:core');
      expect(perm!.riskTier).toBe('acts');
      expect(perm!.mode).toBe('ask');
      expect(perm!.isDefault).toBe(true);
      expect(perm!.usageCount).toBe(0);
    });

    it('updates default permissions on re-insert', () => {
      insertPermission(db);
      insertPermission(db, { description: 'Updated description' });

      const perm = systemStore.getToolPermission(db, 'test_tool');
      expect(perm!.description).toBe('Updated description');
    });

    it('does NOT update user-customized permissions on re-insert', () => {
      insertPermission(db);
      // User customizes
      systemStore.updateToolPermissionMode(db, 'test_tool', 'always_allow');

      // Re-seed with different description
      insertPermission(db, { description: 'Updated description', mode: 'ask' });

      const perm = systemStore.getToolPermission(db, 'test_tool');
      // Mode should stay as user set it
      expect(perm!.mode).toBe('always_allow');
      expect(perm!.isDefault).toBe(false);
    });
  });

  // ========================================================================
  // getToolPermissions
  // ========================================================================

  describe('getToolPermissions', () => {
    it('returns empty array when no permissions exist', () => {
      const perms = systemStore.getToolPermissions(db);
      expect(perms).toEqual([]);
    });

    it('returns all permissions sorted by source and name', () => {
      insertPermission(db, { toolName: 'z_tool', toolSource: 'animus:core' });
      insertPermission(db, { toolName: 'a_tool', toolSource: 'sdk:claude' });
      insertPermission(db, { toolName: 'b_tool', toolSource: 'animus:core' });

      const perms = systemStore.getToolPermissions(db);
      expect(perms).toHaveLength(3);
      // Sorted: animus:core before sdk:claude, then alphabetical
      expect(perms[0]!.toolName).toBe('b_tool');
      expect(perms[1]!.toolName).toBe('z_tool');
      expect(perms[2]!.toolName).toBe('a_tool');
    });
  });

  // ========================================================================
  // updateToolPermissionMode
  // ========================================================================

  describe('updateToolPermissionMode', () => {
    it('changes mode and marks as non-default', () => {
      insertPermission(db);
      systemStore.updateToolPermissionMode(db, 'test_tool', 'off');

      const perm = systemStore.getToolPermission(db, 'test_tool');
      expect(perm!.mode).toBe('off');
      expect(perm!.isDefault).toBe(false);
    });
  });

  // ========================================================================
  // updateGroupPermissionMode
  // ========================================================================

  describe('updateGroupPermissionMode', () => {
    it('updates all tools in a source group', () => {
      insertPermission(db, { toolName: 'tool_a', toolSource: 'sdk:claude' });
      insertPermission(db, { toolName: 'tool_b', toolSource: 'sdk:claude' });
      insertPermission(db, { toolName: 'tool_c', toolSource: 'animus:core' });

      systemStore.updateGroupPermissionMode(db, 'sdk:claude', 'always_allow');

      const a = systemStore.getToolPermission(db, 'tool_a');
      const b = systemStore.getToolPermission(db, 'tool_b');
      const c = systemStore.getToolPermission(db, 'tool_c');

      expect(a!.mode).toBe('always_allow');
      expect(b!.mode).toBe('always_allow');
      expect(c!.mode).toBe('ask'); // Unaffected
    });
  });

  // ========================================================================
  // incrementToolUsage
  // ========================================================================

  describe('incrementToolUsage', () => {
    it('increments usage count and updates last_used_at', () => {
      insertPermission(db);
      expect(systemStore.getToolPermission(db, 'test_tool')!.usageCount).toBe(0);

      systemStore.incrementToolUsage(db, 'test_tool');
      const perm = systemStore.getToolPermission(db, 'test_tool');
      expect(perm!.usageCount).toBe(1);
      expect(perm!.lastUsedAt).not.toBeNull();
    });

    it('increments multiple times', () => {
      insertPermission(db);
      systemStore.incrementToolUsage(db, 'test_tool');
      systemStore.incrementToolUsage(db, 'test_tool');
      systemStore.incrementToolUsage(db, 'test_tool');

      const perm = systemStore.getToolPermission(db, 'test_tool');
      expect(perm!.usageCount).toBe(3);
    });
  });

  // ========================================================================
  // setTrustRampDismissed
  // ========================================================================

  describe('setTrustRampDismissed', () => {
    it('sets trust_ramp_dismissed_at timestamp', () => {
      insertPermission(db);
      expect(systemStore.getToolPermission(db, 'test_tool')!.trustRampDismissedAt).toBeNull();

      systemStore.setTrustRampDismissed(db, 'test_tool');
      const perm = systemStore.getToolPermission(db, 'test_tool');
      expect(perm!.trustRampDismissedAt).not.toBeNull();
    });
  });

  // ========================================================================
  // getToolsEligibleForTrustRamp
  // ========================================================================

  describe('getToolsEligibleForTrustRamp', () => {
    it('returns tools in ask mode with no dismissed timestamp', () => {
      insertPermission(db, { toolName: 'ask_tool', mode: 'ask' });
      insertPermission(db, { toolName: 'allow_tool', mode: 'always_allow' });

      const eligible = systemStore.getToolsEligibleForTrustRamp(db);
      expect(eligible).toHaveLength(1);
      expect(eligible[0]!.toolName).toBe('ask_tool');
    });

    it('excludes tools with recently dismissed trust ramp', () => {
      insertPermission(db, { toolName: 'ask_tool', mode: 'ask' });
      systemStore.setTrustRampDismissed(db, 'ask_tool');

      const eligible = systemStore.getToolsEligibleForTrustRamp(db);
      expect(eligible).toHaveLength(0);
    });

    it('excludes off tools', () => {
      insertPermission(db, { toolName: 'off_tool', mode: 'off' });
      const eligible = systemStore.getToolsEligibleForTrustRamp(db);
      expect(eligible).toHaveLength(0);
    });
  });

  // ========================================================================
  // getToolPermission — null case
  // ========================================================================

  describe('getToolPermission', () => {
    it('returns null for unknown tool', () => {
      const perm = systemStore.getToolPermission(db, 'nonexistent');
      expect(perm).toBeNull();
    });
  });
});
