/**
 * Tests for CodexAuthProvider -- Codex CLI-based authentication flow.
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
}));

// Mock node:fs/promises
vi.mock('node:fs/promises', () => ({
  copyFile: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

// Mock sdk-resolver
vi.mock('../../../src/sdk/sdk-resolver.js', () => ({
  getCodexBundledBinary: vi.fn(),
  checkSdkAvailable: vi.fn().mockReturnValue(false),
}));

// Mock credential-utils
vi.mock('../../../src/auth/credential-utils.js', () => ({
  validateCodexCredential: vi.fn(),
}));

import { spawn, execFile } from 'node:child_process';
import { getCodexBundledBinary } from '../../../src/sdk/sdk-resolver.js';
import { CodexAuthProvider } from '../../../src/auth/codex-auth-provider.js';
import type { ICredentialStore, AuthFlowStatusUpdate } from '../../../src/types.js';
import { createSilentLogger } from '../../../src/logger.js';

const mockSpawn = vi.mocked(spawn);
const mockExecFile = vi.mocked(execFile);
const mockGetCodexBinary = vi.mocked(getCodexBundledBinary);

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

describe('CodexAuthProvider', () => {
  let provider: CodexAuthProvider;
  let store: ICredentialStore;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    provider = new CodexAuthProvider(createSilentLogger());
    store = createMockStore();
    mockGetCodexBinary.mockReturnValue('/path/to/codex');
  });

  afterEach(() => {
    provider._clearSessions();
    vi.useRealTimers();
  });

  describe('initiateAuth (cli)', () => {
    it('should return a sessionId and set status to pending', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const { sessionId } = await provider.initiateAuth(store, 'cli');

      expect(sessionId).toBeTruthy();
      const status = provider.getAuthFlowStatus(sessionId);
      expect(status).toBeDefined();
      expect(status?.status).toBe('pending');
    });

    it('should use the bundled binary path from sdk-resolver', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      await provider.initiateAuth(store, 'cli');

      expect(mockSpawn).toHaveBeenCalledWith(
        '/path/to/codex',
        ['login'],
        expect.any(Object),
      );
    });

    it('should throw when bundled binary is not found', async () => {
      mockGetCodexBinary.mockReturnValue(null);

      await expect(provider.initiateAuth(store, 'cli')).rejects.toThrow('Codex SDK binary not found');
    });

    it('should handle ENOENT error', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const updates: AuthFlowStatusUpdate[] = [];
      const { sessionId } = await provider.initiateAuth(store, 'cli');
      provider.subscribeToAuthStatus(sessionId, (s) => updates.push(s));

      const enoent = new Error('spawn codex ENOENT') as NodeJS.ErrnoException;
      enoent.code = 'ENOENT';
      proc.emit('error', enoent);

      expect(updates.length).toBeGreaterThanOrEqual(2);
      const lastUpdate = updates[updates.length - 1]!;
      expect(lastUpdate.status).toBe('error');
      expect(lastUpdate.message).toContain('binary not found');
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
          callback(null, '', '');
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
      expect(store.saveCredential).toHaveBeenCalledWith('codex', 'cli_detected', 'detected');
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
  });

  describe('logout', () => {
    it('should call bundled binary logout and delete credential', async () => {
      mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
        if (typeof callback === 'function') {
          callback(null, '', '');
        }
        return {} as ReturnType<typeof execFile>;
      });

      const result = await provider.logout(store);

      expect(result).toBe(true);
      expect(mockExecFile).toHaveBeenCalledWith(
        '/path/to/codex',
        ['logout'],
        expect.any(Object),
        expect.any(Function),
      );
      expect(store.deleteCredential).toHaveBeenCalledWith('codex', 'cli_detected');
    });

    it('should still delete credential when binary is not found', async () => {
      mockGetCodexBinary.mockReturnValue(null);

      const result = await provider.logout(store);

      expect(result).toBe(false);
      expect(mockExecFile).not.toHaveBeenCalled();
      expect(store.deleteCredential).toHaveBeenCalledWith('codex', 'cli_detected');
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
      expect(store.deleteCredential).toHaveBeenCalledWith('codex', 'cli_detected');
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
});
