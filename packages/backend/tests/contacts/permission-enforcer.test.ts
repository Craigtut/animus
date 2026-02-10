import { describe, it, expect } from 'vitest';
import {
  canPerform,
  canPerformByTier,
  isDecisionAllowed,
  filterAllowedDecisions,
  getAvailableToolTypes,
} from '../../src/contacts/permission-enforcer.js';
import type { Contact } from '@animus/shared';

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'test-id',
    userId: null,
    fullName: 'Test Contact',
    phoneNumber: null,
    email: null,
    isPrimary: false,
    permissionTier: 'standard',
    notes: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('permission-enforcer', () => {
  describe('canPerform', () => {
    it('allows primary contacts full access', () => {
      const primary = makeContact({ isPrimary: true, permissionTier: 'primary' });
      expect(canPerform(primary, 'trigger_tick')).toBe(true);
      expect(canPerform(primary, 'spawn_agent')).toBe(true);
      expect(canPerform(primary, 'schedule_task')).toBe(true);
      expect(canPerform(primary, 'update_goal')).toBe(true);
      expect(canPerform(primary, 'access_config')).toBe(true);
    });

    it('restricts standard contacts', () => {
      const standard = makeContact({ isPrimary: false, permissionTier: 'standard' });
      expect(canPerform(standard, 'trigger_tick')).toBe(true);
      expect(canPerform(standard, 'receive_reply')).toBe(true);
      expect(canPerform(standard, 'send_message')).toBe(true);
      expect(canPerform(standard, 'spawn_agent')).toBe(false);
      expect(canPerform(standard, 'schedule_task')).toBe(false);
      expect(canPerform(standard, 'update_goal')).toBe(false);
      expect(canPerform(standard, 'access_tools')).toBe(false);
      expect(canPerform(standard, 'access_config')).toBe(false);
    });
  });

  describe('canPerformByTier', () => {
    it('checks by tier string', () => {
      expect(canPerformByTier('primary', 'spawn_agent')).toBe(true);
      expect(canPerformByTier('standard', 'spawn_agent')).toBe(false);
    });
  });

  describe('isDecisionAllowed', () => {
    it('allows all decisions for primary', () => {
      expect(isDecisionAllowed('primary', 'spawn_agent')).toBe(true);
      expect(isDecisionAllowed('primary', 'schedule_task')).toBe(true);
      expect(isDecisionAllowed('primary', 'update_goal')).toBe(true);
      expect(isDecisionAllowed('primary', 'no_action')).toBe(true);
    });

    it('restricts standard to send_message and no_action', () => {
      expect(isDecisionAllowed('standard', 'send_message')).toBe(true);
      expect(isDecisionAllowed('standard', 'no_action')).toBe(true);
      expect(isDecisionAllowed('standard', 'spawn_agent')).toBe(false);
      expect(isDecisionAllowed('standard', 'schedule_task')).toBe(false);
      expect(isDecisionAllowed('standard', 'update_goal')).toBe(false);
    });
  });

  describe('filterAllowedDecisions', () => {
    it('separates allowed and dropped decisions', () => {
      const result = filterAllowedDecisions('standard', [
        'send_message',
        'spawn_agent',
        'schedule_task',
        'no_action',
      ]);
      expect(result.allowed).toEqual(['send_message', 'no_action']);
      expect(result.dropped).toEqual(['spawn_agent', 'schedule_task']);
    });

    it('allows all for primary', () => {
      const result = filterAllowedDecisions('primary', [
        'send_message',
        'spawn_agent',
        'schedule_task',
      ]);
      expect(result.allowed).toEqual(['send_message', 'spawn_agent', 'schedule_task']);
      expect(result.dropped).toEqual([]);
    });
  });

  describe('getAvailableToolTypes', () => {
    it('returns full tool set for primary', () => {
      const tools = getAvailableToolTypes('primary');
      expect(tools).toContain('spawn_agent');
      expect(tools).toContain('schedule_task');
      expect(tools).toContain('system_config');
    });

    it('returns limited tools for standard', () => {
      const tools = getAvailableToolTypes('standard');
      expect(tools).toContain('send_message');
      expect(tools).toContain('read_memory');
      expect(tools).not.toContain('spawn_agent');
      expect(tools).not.toContain('schedule_task');
    });
  });
});
