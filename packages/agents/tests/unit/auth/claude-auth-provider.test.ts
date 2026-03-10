/**
 * Tests for ClaudeAuthProvider -- Claude CLI-based authentication flow.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

// Mock child_process
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
}));

// Mock node:fs
vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readdirSync: vi.fn().mockReturnValue([]),
}));

// Mock sdk-resolver
vi.mock('../../../src/sdk/sdk-resolver.js', () => ({
  getClaudeNativeBinary: vi.fn(),
  checkSdkAvailable: vi.fn().mockReturnValue(false),
}));

// Mock credential-utils
vi.mock('../../../src/auth/credential-utils.js', () => ({
  ensureClaudeOnboardingFile: vi.fn(),
  validateClaudeCredential: vi.fn(),
}));

import { spawn, execFile } from 'node:child_process';
import { getClaudeNativeBinary } from '../../../src/sdk/sdk-resolver.js';
import { ensureClaudeOnboardingFile } from '../../../src/auth/credential-utils.js';
import { ClaudeAuthProvider } from '../../../src/auth/claude-auth-provider.js';
import type { ICredentialStore, AuthFlowStatusUpdate } from '../../../src/types.js';
import { createSilentLogger } from '../../../src/logger.js';

const mockSpawn = vi.mocked(spawn);
const mockExecFile = vi.mocked(execFile);
const mockGetNativeBinary = vi.mocked(getClaudeNativeBinary);
const mockEnsureOnboarding = vi.mocked(ensureClaudeOnboardingFile);

function createMockProcess(): EventEmitter & Partial<ChildProcess> {
  const proc = new EventEmitter() as EventEmitter & Partial<ChildProcess>;
  proc.kill = vi.fn();
  (proc as Record<string, unknown>).stdin = null;
  (proc as Record<string, unknown>).stdout = new EventEmitter();
  (proc as Record<string, unknown>).stderr = new EventEmitter();
  (proc as Record<string, unknown>).pid = 12345;
  return proc;
}

function createMockStore(): ICredentialStore {
  return {
    saveCredential: vi.fn(),
    getCredential: vi.fn().mockReturnValue(null),
    deleteCredential: vi.fn().mockReturnValue(true),
    getCredentialMetadata: vi.fn().mockReturnValue([]),
  };
}

describe('ClaudeAuthProvider', () => {
  let provider: ClaudeAuthProvider;
  let store: ICredentialStore;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    provider = new ClaudeAuthProvider(createSilentLogger());
    store = createMockStore();
    mockGetNativeBinary.mockReturnValue('/usr/local/bin/claude');
  });

  afterEach(() => {
    provider._clearSessions();
    vi.useRealTimers();
  });

  describe('initiateAuth', () => {
    it('should return a sessionId and set status to pending', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const { sessionId } = await provider.initiateAuth(store, 'cli');

      expect(sessionId).toBeTruthy();
      const status = provider.getAuthFlowStatus(sessionId);
      expect(status).toBeDefined();
      expect(status?.status).toBe('pending');
    });

    it('should use native binary path from sdk-resolver', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      await provider.initiateAuth(store, 'cli');

      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/claude',
        ['auth', 'login'],
        expect.any(Object),
      );
    });

    it('should strip CLAUDECODE from child env', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);
      process.env['CLAUDECODE'] = 'true';

      await provider.initiateAuth(store, 'cli');

      const spawnCall = mockSpawn.mock.calls[0]!;
      const env = spawnCall[2]?.env as Record<string, string>;
      expect(env).toBeDefined();
      expect(env['CLAUDECODE']).toBeUndefined();

      delete process.env['CLAUDECODE'];
    });

    it('should throw when native binary is not found', async () => {
      mockGetNativeBinary.mockReturnValue(null);

      await expect(provider.initiateAuth(store, 'cli')).rejects.toThrow('Claude Code native binary not found');
    });

    it('should handle ENOENT error (binary not found)', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const updates: AuthFlowStatusUpdate[] = [];
      const { sessionId } = await provider.initiateAuth(store, 'cli');
      provider.subscribeToAuthStatus(sessionId, (s) => updates.push(s));

      const enoent = new Error('spawn claude ENOENT') as NodeJS.ErrnoException;
      enoent.code = 'ENOENT';
      proc.emit('error', enoent);

      expect(updates.length).toBeGreaterThanOrEqual(2);
      const lastUpdate = updates[updates.length - 1]!;
      expect(lastUpdate.status).toBe('error');
      expect(lastUpdate.message).toContain('Claude Code binary not found');
    });

    it('should handle non-zero exit code', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const updates: AuthFlowStatusUpdate[] = [];
      const { sessionId } = await provider.initiateAuth(store, 'cli');
      provider.subscribeToAuthStatus(sessionId, (s) => updates.push(s));

      proc.emit('close', 1);

      const lastUpdate = updates[updates.length - 1]!;
      expect(lastUpdate.status).toBe('error');
      expect(lastUpdate.message).toContain('exit code 1');
    });

    it('should verify auth and save credential on exit code 0', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
        if (typeof callback === 'function') {
          callback(null, JSON.stringify({ loggedIn: true, email: 'test@example.com', plan: 'pro' }), '');
        }
        return {} as ReturnType<typeof execFile>;
      });

      const updates: AuthFlowStatusUpdate[] = [];
      const { sessionId } = await provider.initiateAuth(store, 'cli');
      provider.subscribeToAuthStatus(sessionId, (s) => updates.push(s));

      proc.emit('close', 0);
      await vi.advanceTimersByTimeAsync(100);

      const lastUpdate = updates[updates.length - 1]!;
      expect(lastUpdate.status).toBe('success');
      expect(store.saveCredential).toHaveBeenCalledWith('claude', 'cli_detected', 'detected');
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

      const updates: AuthFlowStatusUpdate[] = [];
      const { sessionId } = await provider.initiateAuth(store, 'cli');
      provider.subscribeToAuthStatus(sessionId, (s) => updates.push(s));

      proc.emit('close', 0);
      await vi.advanceTimersByTimeAsync(100);

      const lastUpdate = updates[updates.length - 1]!;
      expect(lastUpdate.status).toBe('error');
      expect(lastUpdate.message).toContain('not completed');
    });

    it('should timeout after 5 minutes', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const updates: AuthFlowStatusUpdate[] = [];
      const { sessionId } = await provider.initiateAuth(store, 'cli');
      provider.subscribeToAuthStatus(sessionId, (s) => updates.push(s));

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100);

      const lastUpdate = updates[updates.length - 1]!;
      expect(lastUpdate.status).toBe('error');
      expect(lastUpdate.message).toContain('timed out');
      expect(proc.kill).toHaveBeenCalled();
    });
  });

  describe('getAuthFlowStatus', () => {
    it('should return null for unknown session', () => {
      expect(provider.getAuthFlowStatus('nonexistent')).toBeNull();
    });

    it('should return current status', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const { sessionId } = await provider.initiateAuth(store, 'cli');
      const status = provider.getAuthFlowStatus(sessionId);

      expect(status).toEqual({ status: 'pending' });
    });
  });

  describe('subscribeToAuthStatus', () => {
    it('should send current status immediately', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const { sessionId } = await provider.initiateAuth(store, 'cli');
      const updates: AuthFlowStatusUpdate[] = [];
      provider.subscribeToAuthStatus(sessionId, (s) => updates.push(s));

      expect(updates).toHaveLength(1);
      expect(updates[0]?.status).toBe('pending');
    });

    it('should return error for unknown session', () => {
      const updates: AuthFlowStatusUpdate[] = [];
      provider.subscribeToAuthStatus('nonexistent', (s) => updates.push(s));

      expect(updates).toHaveLength(1);
      expect(updates[0]?.status).toBe('error');
      expect(updates[0]?.message).toContain('Session not found');
    });

    it('should allow unsubscribing', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const { sessionId } = await provider.initiateAuth(store, 'cli');
      const updates: AuthFlowStatusUpdate[] = [];
      const unsub = provider.subscribeToAuthStatus(sessionId, (s) => updates.push(s));

      expect(updates).toHaveLength(1);
      unsub();

      proc.emit('close', 1);
      expect(updates).toHaveLength(1); // still 1
    });
  });

  describe('cancelAuthFlow', () => {
    it('should kill the child process and set status to cancelled', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const updates: AuthFlowStatusUpdate[] = [];
      const { sessionId } = await provider.initiateAuth(store, 'cli');
      provider.subscribeToAuthStatus(sessionId, (s) => updates.push(s));

      const result = provider.cancelAuthFlow(sessionId);

      expect(result).toBe(true);
      expect(proc.kill).toHaveBeenCalled();
      const lastUpdate = updates[updates.length - 1]!;
      expect(lastUpdate.status).toBe('cancelled');
    });

    it('should return false for unknown session', () => {
      expect(provider.cancelAuthFlow('nonexistent')).toBe(false);
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

      const { sessionId } = await provider.initiateAuth(store, 'cli');
      proc.emit('close', 0);
      await vi.advanceTimersByTimeAsync(100);

      expect(provider.cancelAuthFlow(sessionId)).toBe(false);
    });
  });

  describe('session cleanup', () => {
    it('should remove session after 60s', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const { sessionId } = await provider.initiateAuth(store, 'cli');
      provider.cancelAuthFlow(sessionId);

      expect(provider.getAuthFlowStatus(sessionId)).toBeDefined();

      await vi.advanceTimersByTimeAsync(60_000 + 100);

      expect(provider.getAuthFlowStatus(sessionId)).toBeNull();
    });
  });

  describe('logout', () => {
    it('should call native binary auth logout and delete credential', async () => {
      mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
        if (typeof callback === 'function') {
          callback(null, '', '');
        }
        return {} as ReturnType<typeof execFile>;
      });

      const result = await provider.logout(store);

      expect(result).toBe(true);
      expect(mockExecFile).toHaveBeenCalledWith(
        '/usr/local/bin/claude',
        ['auth', 'logout'],
        expect.any(Object),
        expect.any(Function),
      );
      expect(store.deleteCredential).toHaveBeenCalledWith('claude', 'cli_detected');
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

      await provider.logout(store);

      delete process.env['CLAUDECODE'];
    });

    it('should still delete credential when native binary is not found', async () => {
      mockGetNativeBinary.mockReturnValue(null);

      const result = await provider.logout(store);

      expect(result).toBe(false);
      expect(mockExecFile).not.toHaveBeenCalled();
      expect(store.deleteCredential).toHaveBeenCalledWith('claude', 'cli_detected');
    });

    it('should still delete credential on logout error', async () => {
      mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
        if (typeof callback === 'function') {
          callback(new Error('logout failed'), '', '');
        }
        return {} as ReturnType<typeof execFile>;
      });

      const result = await provider.logout(store);

      expect(result).toBe(false);
      expect(store.deleteCredential).toHaveBeenCalledWith('claude', 'cli_detected');
    });
  });
});
