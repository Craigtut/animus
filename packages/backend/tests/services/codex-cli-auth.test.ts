/**
 * Tests for Codex CLI Auth service -- CLI-based authentication flow.
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

// Mock cli-paths
vi.mock('../../src/lib/cli-paths.js', () => ({
  getCodexBundledBinary: vi.fn(),
}));

import { spawn, execFile } from 'node:child_process';
import { saveCliDetected, removeCredential } from '../../src/services/credential-service.js';
import { getCodexBundledBinary } from '../../src/lib/cli-paths.js';
import {
  initiateCodexCliAuth,
  getSessionStatus,
  subscribeToStatus,
  cancelFlow,
  logoutCodex,
  _getSession,
  _clearSessions,
  type CodexCliAuthStatusUpdate,
} from '../../src/services/codex-cli-auth.js';

const mockSpawn = vi.mocked(spawn);
const mockExecFile = vi.mocked(execFile);
const mockSaveCliDetected = vi.mocked(saveCliDetected);
const mockRemoveCredential = vi.mocked(removeCredential);
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

const fakeDb = {} as Parameters<typeof initiateCodexCliAuth>[0];

describe('codex-cli-auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _clearSessions();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Default: binary is available
    mockGetCodexBinary.mockReturnValue('/path/to/codex');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initiateCodexCliAuth', () => {
    it('should return a sessionId and set status to pending', () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const { sessionId } = initiateCodexCliAuth(fakeDb);

      expect(sessionId).toBeTruthy();
      const session = _getSession(sessionId);
      expect(session).toBeDefined();
      expect(session?.status).toBe('pending');
    });

    it('should use the bundled binary path from cli-paths', () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      initiateCodexCliAuth(fakeDb);

      expect(mockSpawn).toHaveBeenCalledWith(
        '/path/to/codex',
        ['login'],
        expect.any(Object)
      );
    });

    it('should throw when bundled binary is not found', () => {
      mockGetCodexBinary.mockReturnValue(null);

      expect(() => initiateCodexCliAuth(fakeDb)).toThrow('Codex SDK binary not found');
    });

    it('should handle ENOENT error', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const updates: CodexCliAuthStatusUpdate[] = [];
      const { sessionId } = initiateCodexCliAuth(fakeDb);
      subscribeToStatus(sessionId, (s) => updates.push(s));

      const enoent = new Error('spawn codex ENOENT') as NodeJS.ErrnoException;
      enoent.code = 'ENOENT';
      proc.emit('error', enoent);

      expect(updates.length).toBeGreaterThanOrEqual(2);
      const lastUpdate = updates[updates.length - 1]!;
      expect(lastUpdate.status).toBe('error');
      expect(lastUpdate.message).toContain('SDK binary not found');
    });

    it('should handle non-zero exit code', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const updates: CodexCliAuthStatusUpdate[] = [];
      const { sessionId } = initiateCodexCliAuth(fakeDb);
      subscribeToStatus(sessionId, (s) => updates.push(s));

      proc.emit('close', 1);

      const lastUpdate = updates[updates.length - 1]!;
      expect(lastUpdate.status).toBe('error');
      expect(lastUpdate.message).toContain('exit code 1');
    });

    it('should verify auth and save credential on exit code 0', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      // Mock execFile for login status check (success = exit code 0)
      mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
        if (typeof callback === 'function') {
          callback(null, '', '');
        }
        return {} as ReturnType<typeof execFile>;
      });

      const updates: CodexCliAuthStatusUpdate[] = [];
      const { sessionId } = initiateCodexCliAuth(fakeDb);
      subscribeToStatus(sessionId, (s) => updates.push(s));

      proc.emit('close', 0);

      await vi.advanceTimersByTimeAsync(100);

      const lastUpdate = updates[updates.length - 1]!;
      expect(lastUpdate.status).toBe('success');
      expect(mockSaveCliDetected).toHaveBeenCalledWith(fakeDb, 'codex');
    });

    it('should timeout after 5 minutes', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const updates: CodexCliAuthStatusUpdate[] = [];
      const { sessionId } = initiateCodexCliAuth(fakeDb);
      subscribeToStatus(sessionId, (s) => updates.push(s));

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

      const { sessionId } = initiateCodexCliAuth(fakeDb);
      const status = getSessionStatus(sessionId);

      expect(status).toEqual({ status: 'pending' });
    });
  });

  describe('subscribeToStatus', () => {
    it('should send current status immediately', () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const { sessionId } = initiateCodexCliAuth(fakeDb);
      const updates: CodexCliAuthStatusUpdate[] = [];
      subscribeToStatus(sessionId, (s) => updates.push(s));

      expect(updates).toHaveLength(1);
      expect(updates[0]?.status).toBe('pending');
    });

    it('should return error for unknown session', () => {
      const updates: CodexCliAuthStatusUpdate[] = [];
      subscribeToStatus('nonexistent', (s) => updates.push(s));

      expect(updates).toHaveLength(1);
      expect(updates[0]?.status).toBe('error');
    });
  });

  describe('cancelFlow', () => {
    it('should kill the child process and set status to cancelled', () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const updates: CodexCliAuthStatusUpdate[] = [];
      const { sessionId } = initiateCodexCliAuth(fakeDb);
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
  });

  describe('logoutCodex', () => {
    it('should call bundled binary logout and remove credential', async () => {
      mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
        if (typeof callback === 'function') {
          callback(null, '', '');
        }
        return {} as ReturnType<typeof execFile>;
      });

      const result = await logoutCodex(fakeDb);

      expect(result).toBe(true);
      expect(mockExecFile).toHaveBeenCalledWith(
        '/path/to/codex',
        ['logout'],
        expect.any(Object),
        expect.any(Function)
      );
      expect(mockRemoveCredential).toHaveBeenCalledWith(fakeDb, 'codex', 'cli_detected');
    });

    it('should still remove credential when binary is not found', async () => {
      mockGetCodexBinary.mockReturnValue(null);

      const result = await logoutCodex(fakeDb);

      expect(result).toBe(false);
      expect(mockExecFile).not.toHaveBeenCalled();
      expect(mockRemoveCredential).toHaveBeenCalledWith(fakeDb, 'codex', 'cli_detected');
    });

    it('should still remove credential on logout error', async () => {
      mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
        if (typeof callback === 'function') {
          callback(new Error('logout failed'), '', '');
        }
        return {} as ReturnType<typeof execFile>;
      });

      const result = await logoutCodex(fakeDb);

      expect(result).toBe(false);
      expect(mockRemoveCredential).toHaveBeenCalledWith(fakeDb, 'codex', 'cli_detected');
    });
  });

  describe('session cleanup', () => {
    it('should remove session from map after 60s', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as unknown as ChildProcess);

      const { sessionId } = initiateCodexCliAuth(fakeDb);
      cancelFlow(sessionId);

      expect(_getSession(sessionId)).toBeDefined();

      await vi.advanceTimersByTimeAsync(60_000 + 100);

      expect(_getSession(sessionId)).toBeUndefined();
    });
  });
});
