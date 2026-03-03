/**
 * Credential Audit Store Tests
 *
 * Tests the credential access audit logging functionality.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestAgentLogsDb } from '../../helpers.js';
import {
  logCredentialAccess,
  getRecentCredentialAccess,
} from '../../../src/db/stores/credential-audit-store.js';

describe('credential-audit-store', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestAgentLogsDb();
  });

  describe('logCredentialAccess', () => {
    it('should log a vault credential access', () => {
      logCredentialAccess(db, {
        credentialType: 'vault',
        credentialRef: 'vault:abc-123',
        toolName: 'run_with_credentials',
        agentContext: 'mind',
      });

      const logs = getRecentCredentialAccess(db);
      expect(logs).toHaveLength(1);
      expect(logs[0]!.credentialType).toBe('vault');
      expect(logs[0]!.credentialRef).toBe('vault:abc-123');
      expect(logs[0]!.toolName).toBe('run_with_credentials');
      expect(logs[0]!.agentContext).toBe('mind');
      expect(logs[0]!.accessedAt).toBeTruthy();
    });

    it('should log a plugin credential access', () => {
      logCredentialAccess(db, {
        credentialType: 'plugin',
        credentialRef: 'weather.API_KEY',
        toolName: 'run_with_credentials',
        agentContext: 'sub-agent:task-42',
      });

      const logs = getRecentCredentialAccess(db);
      expect(logs).toHaveLength(1);
      expect(logs[0]!.credentialType).toBe('plugin');
      expect(logs[0]!.credentialRef).toBe('weather.API_KEY');
      expect(logs[0]!.agentContext).toBe('sub-agent:task-42');
    });

    it('should log with null agent context', () => {
      logCredentialAccess(db, {
        credentialType: 'channel',
        credentialRef: 'discord.BOT_TOKEN',
        toolName: 'channel_init',
      });

      const logs = getRecentCredentialAccess(db);
      expect(logs).toHaveLength(1);
      expect(logs[0]!.agentContext).toBeNull();
    });

    it('should create unique IDs for each log entry', () => {
      logCredentialAccess(db, {
        credentialType: 'vault',
        credentialRef: 'vault:abc',
        toolName: 'run_with_credentials',
      });
      logCredentialAccess(db, {
        credentialType: 'vault',
        credentialRef: 'vault:abc',
        toolName: 'run_with_credentials',
      });

      const logs = getRecentCredentialAccess(db);
      expect(logs).toHaveLength(2);
      expect(logs[0]!.id).not.toBe(logs[1]!.id);
    });
  });

  describe('getRecentCredentialAccess', () => {
    it('should return empty array when no logs', () => {
      const logs = getRecentCredentialAccess(db);
      expect(logs).toHaveLength(0);
    });

    it('should return logs in reverse chronological order', () => {
      logCredentialAccess(db, {
        credentialType: 'vault',
        credentialRef: 'vault:first',
        toolName: 'run_with_credentials',
      });
      logCredentialAccess(db, {
        credentialType: 'vault',
        credentialRef: 'vault:second',
        toolName: 'run_with_credentials',
      });

      const logs = getRecentCredentialAccess(db);
      expect(logs).toHaveLength(2);
      // Most recent first
      expect(logs[0]!.credentialRef).toBe('vault:second');
      expect(logs[1]!.credentialRef).toBe('vault:first');
    });

    it('should respect the limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        logCredentialAccess(db, {
          credentialType: 'vault',
          credentialRef: `vault:entry-${i}`,
          toolName: 'run_with_credentials',
        });
      }

      const logs = getRecentCredentialAccess(db, 3);
      expect(logs).toHaveLength(3);
    });
  });
});
