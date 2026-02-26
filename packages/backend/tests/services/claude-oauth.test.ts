/**
 * Tests for Claude OAuth service — CLI-based authentication flow.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

// Mock child_process
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
}));

// Mock credential service
vi.mock('../../src/services/credential-service.js', () => ({
  saveCliDetected: vi.fn(),
  ensureClaudeOnboardingFile: vi.fn(),
  removeCredential: vi.fn(),
}));

// Mock logger
vi.mock('../../src/lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { spawn, execFile } from 'node:child_process';
import { saveCliDetected, ensureClaudeOnboardingFile, removeCredential } from '../../src/services/credential-service.js';
import {
  initiateClaudeAuth,
  getSessionStatus,
  subscribeToStatus,
  cancelFlow,
  logoutClaude,
  _getSession,
  _clearSessions,
  type ClaudeAuthStatusUpdate,
} from '../../src/services/claude-oauth.js';

const mockSpawn = vi.mocked(spawn);
const mockExecFile = vi.mocked(execFile);
const mockSaveCliDetected = vi.mocked(saveCliDetected);
const mockEnsureOnboarding = vi.mocked(ensureClaudeOnboardingFile);
const mockRemoveCredential = vi.mocked(removeCredential);

function createMockProcess(): EventEmitter & Partial<ChildProcess> {
  const proc = new EventEmitter() as EventEmitter & Partial<ChildProcess>;
  proc.kill = vi.fn();
  // Add stdin/stdout/stderr stubs
  (proc as Record<string, unknown>).stdin = null;
  (proc as Record<string, unknown>).stdout = new EventEmitter();
  (proc as Record<string, unknown>).stderr = new EventEmitter();
  (proc as Record<string, unknown>).pid = 12345;
  return proc;
}

const fakeDb = {} as Parameters<typeof initiateClaudeAuth>[0];

describe('claude-oauth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _clearSessions();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initiateClaudeAuth', () => {
    it('should return a sessionId and set status to pending', () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const { sessionId } = initiateClaudeAuth(fakeDb);

      expect(sessionId).toBeTruthy();
      const session = _getSession(sessionId);
      expect(session).toBeDefined();
      expect(session?.status).toBe('pending');
    });

    it('should strip CLAUDECODE from child env', () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);
      process.env['CLAUDECODE'] = 'true';

      initiateClaudeAuth(fakeDb);

      const spawnCall = mockSpawn.mock.calls[0]!;
      const env = spawnCall[2]?.env as Record<string, string>;
      expect(env).toBeDefined();
      expect(env['CLAUDECODE']).toBeUndefined();

      delete process.env['CLAUDECODE'];
    });

    it('should handle ENOENT error (CLI not installed)', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const updates: ClaudeAuthStatusUpdate[] = [];
      const { sessionId } = initiateClaudeAuth(fakeDb);
      subscribeToStatus(sessionId, (s) => updates.push(s));

      // Simulate ENOENT
      const enoent = new Error('spawn claude ENOENT') as NodeJS.ErrnoException;
      enoent.code = 'ENOENT';
      proc.emit('error', enoent);

      // Should have received pending (initial) + error
      expect(updates.length).toBeGreaterThanOrEqual(2);
      const lastUpdate = updates[updates.length - 1]!;
      expect(lastUpdate.status).toBe('error');
      expect(lastUpdate.message).toContain('Claude CLI not installed');
    });

    it('should handle non-zero exit code', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const updates: ClaudeAuthStatusUpdate[] = [];
      const { sessionId } = initiateClaudeAuth(fakeDb);
      subscribeToStatus(sessionId, (s) => updates.push(s));

      proc.emit('close', 1);

      const lastUpdate = updates[updates.length - 1]!;
      expect(lastUpdate.status).toBe('error');
      expect(lastUpdate.message).toContain('exit code 1');
    });

    it('should verify auth and save credential on exit code 0', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      // Mock execFile for auth status check
      mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
        if (typeof callback === 'function') {
          callback(null, JSON.stringify({ loggedIn: true, email: 'test@example.com', plan: 'pro' }), '');
        }
        return {} as ReturnType<typeof execFile>;
      });

      const updates: ClaudeAuthStatusUpdate[] = [];
      const { sessionId } = initiateClaudeAuth(fakeDb);
      subscribeToStatus(sessionId, (s) => updates.push(s));

      proc.emit('close', 0);

      // Wait for execFile callback
      await vi.advanceTimersByTimeAsync(100);

      const lastUpdate = updates[updates.length - 1]!;
      expect(lastUpdate.status).toBe('success');
      expect(mockSaveCliDetected).toHaveBeenCalledWith(fakeDb, 'claude');
      expect(mockEnsureOnboarding).toHaveBeenCalled();
    });

    it('should handle auth status showing not logged in', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
        if (typeof callback === 'function') {
          callback(null, JSON.stringify({ loggedIn: false }), '');
        }
        return {} as ReturnType<typeof execFile>;
      });

      const updates: ClaudeAuthStatusUpdate[] = [];
      const { sessionId } = initiateClaudeAuth(fakeDb);
      subscribeToStatus(sessionId, (s) => updates.push(s));

      proc.emit('close', 0);

      await vi.advanceTimersByTimeAsync(100);

      const lastUpdate = updates[updates.length - 1]!;
      expect(lastUpdate.status).toBe('error');
      expect(lastUpdate.message).toContain('not completed');
    });

    it('should timeout after 5 minutes', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const updates: ClaudeAuthStatusUpdate[] = [];
      const { sessionId } = initiateClaudeAuth(fakeDb);
      subscribeToStatus(sessionId, (s) => updates.push(s));

      // Advance past the timeout
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100);

      const lastUpdate = updates[updates.length - 1]!;
      expect(lastUpdate.status).toBe('error');
      expect(lastUpdate.message).toContain('timed out');
      expect(proc.kill).toHaveBeenCalled();
    });
  });

  describe('getSessionStatus', () => {
    it('should return null for unknown session', () => {
      expect(getSessionStatus('nonexistent')).toBeNull();
    });

    it('should return current status', () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const { sessionId } = initiateClaudeAuth(fakeDb);
      const status = getSessionStatus(sessionId);

      expect(status).toEqual({ status: 'pending' });
    });
  });

  describe('subscribeToStatus', () => {
    it('should send current status immediately', () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const { sessionId } = initiateClaudeAuth(fakeDb);
      const updates: ClaudeAuthStatusUpdate[] = [];
      subscribeToStatus(sessionId, (s) => updates.push(s));

      expect(updates).toHaveLength(1);
      expect(updates[0]?.status).toBe('pending');
    });

    it('should return error for unknown session', () => {
      const updates: ClaudeAuthStatusUpdate[] = [];
      subscribeToStatus('nonexistent', (s) => updates.push(s));

      expect(updates).toHaveLength(1);
      expect(updates[0]?.status).toBe('error');
      expect(updates[0]?.message).toContain('Session not found');
    });

    it('should allow unsubscribing', () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const { sessionId } = initiateClaudeAuth(fakeDb);
      const updates: ClaudeAuthStatusUpdate[] = [];
      const unsub = subscribeToStatus(sessionId, (s) => updates.push(s));

      expect(updates).toHaveLength(1); // initial

      unsub();

      // Trigger a status change; should not receive it
      proc.emit('close', 1);
      expect(updates).toHaveLength(1); // still 1
    });
  });

  describe('cancelFlow', () => {
    it('should kill the child process and set status to cancelled', () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const updates: ClaudeAuthStatusUpdate[] = [];
      const { sessionId } = initiateClaudeAuth(fakeDb);
      subscribeToStatus(sessionId, (s) => updates.push(s));

      const result = cancelFlow(sessionId);

      expect(result).toBe(true);
      expect(proc.kill).toHaveBeenCalled();
      const lastUpdate = updates[updates.length - 1]!;
      expect(lastUpdate.status).toBe('cancelled');
    });

    it('should return false for unknown session', () => {
      expect(cancelFlow('nonexistent')).toBe(false);
    });

    it('should return false for already completed session', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
        if (typeof callback === 'function') {
          callback(null, JSON.stringify({ loggedIn: true }), '');
        }
        return {} as ReturnType<typeof execFile>;
      });

      const { sessionId } = initiateClaudeAuth(fakeDb);
      proc.emit('close', 0);
      await vi.advanceTimersByTimeAsync(100);

      expect(cancelFlow(sessionId)).toBe(false);
    });
  });

  describe('session cleanup', () => {
    it('should remove session from map after 60s', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const { sessionId } = initiateClaudeAuth(fakeDb);
      cancelFlow(sessionId);

      expect(_getSession(sessionId)).toBeDefined();

      await vi.advanceTimersByTimeAsync(60_000 + 100);

      expect(_getSession(sessionId)).toBeUndefined();
    });
  });

  describe('logoutClaude', () => {
    it('should call claude auth logout and remove credential', async () => {
      mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
        if (typeof callback === 'function') {
          callback(null, '', '');
        }
        return {} as ReturnType<typeof execFile>;
      });

      const result = await logoutClaude(fakeDb);

      expect(result).toBe(true);
      expect(mockRemoveCredential).toHaveBeenCalledWith(fakeDb, 'claude', 'cli_detected');
    });

    it('should strip CLAUDECODE from env when calling logout', async () => {
      process.env['CLAUDECODE'] = 'true';

      mockExecFile.mockImplementation((_cmd, _args, opts, callback) => {
        const env = (opts as Record<string, unknown>)?.env as Record<string, string>;
        expect(env['CLAUDECODE']).toBeUndefined();
        if (typeof callback === 'function') {
          callback(null, '', '');
        }
        return {} as ReturnType<typeof execFile>;
      });

      await logoutClaude(fakeDb);

      delete process.env['CLAUDECODE'];
    });

    it('should still remove credential on logout error', async () => {
      mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
        if (typeof callback === 'function') {
          callback(new Error('logout failed'), '', '');
        }
        return {} as ReturnType<typeof execFile>;
      });

      const result = await logoutClaude(fakeDb);

      expect(result).toBe(false);
      expect(mockRemoveCredential).toHaveBeenCalledWith(fakeDb, 'claude', 'cli_detected');
    });
  });
});
