/**
 * Codex CLI Auth -- CLI-based authentication flow
 *
 * Spawns `codex login` which opens a browser for the user to authenticate.
 * After login, Codex manages its own credential storage (~/.codex/auth.json)
 * and handles token refresh internally.
 *
 * Desktop users only. Docker users continue using OPENAI_API_KEY env var.
 */

import { spawn, execFile } from 'node:child_process';
import { generateUUID } from '@animus-labs/shared';
import type Database from 'better-sqlite3';
import { saveCliDetected, removeCredential as removeStoredCredential } from './credential-service.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('CodexCliAuth', 'auth');

// ============================================================================
// Constants
// ============================================================================

const AUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ============================================================================
// Types
// ============================================================================

export interface CodexCliAuthStatusUpdate {
  status: 'pending' | 'success' | 'error' | 'cancelled';
  message?: string;
}

interface CodexCliAuthSession {
  id: string;
  status: CodexCliAuthStatusUpdate['status'];
  error?: string;
  childProcess: ReturnType<typeof spawn> | null;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
  listeners: Set<(status: CodexCliAuthStatusUpdate) => void>;
  startedAt: number;
}

// ============================================================================
// Session Store (in-memory)
// ============================================================================

const sessions = new Map<string, CodexCliAuthSession>();

// ============================================================================
// Public API
// ============================================================================

/**
 * Start the Codex auth flow by spawning `codex login`.
 * Opens a browser for the user to authenticate. Returns a session ID
 * for the frontend to subscribe to status updates.
 */
export function initiateCodexCliAuth(db: Database.Database): { sessionId: string } {
  const sessionId = generateUUID();

  let childProcess: ReturnType<typeof spawn>;
  try {
    childProcess = spawn('codex', ['login'], {
      stdio: 'pipe',
    });
  } catch (err) {
    throw new Error('Failed to spawn Codex CLI. Is it installed?');
  }

  const session: CodexCliAuthSession = {
    id: sessionId,
    status: 'pending',
    childProcess,
    timeoutHandle: null,
    listeners: new Set(),
    startedAt: Date.now(),
  };

  sessions.set(sessionId, session);

  // Timeout: kill process after AUTH_TIMEOUT_MS
  session.timeoutHandle = setTimeout(() => {
    if (session.status === 'pending') {
      log.warn(`Codex auth session ${sessionId} timed out`);
      session.childProcess?.kill();
      session.status = 'error';
      session.error = 'Authentication timed out. Please try again.';
      notifyListeners(session, { status: 'error', message: session.error });
      scheduleCleanup(sessionId);
    }
  }, AUTH_TIMEOUT_MS);

  // Handle spawn errors (e.g., ENOENT if codex binary not found)
  childProcess.on('error', (err: NodeJS.ErrnoException) => {
    if (session.status !== 'pending') return;
    clearTimeoutHandle(session);

    if (err.code === 'ENOENT') {
      session.status = 'error';
      session.error = 'Codex CLI not installed. Install with: npm install -g @openai/codex';
    } else {
      session.status = 'error';
      session.error = `Failed to start Codex auth: ${err.message}`;
    }
    log.error('Codex auth spawn error:', err);
    notifyListeners(session, { status: 'error', message: session.error });
    scheduleCleanup(sessionId);
  });

  // Handle process exit
  childProcess.on('close', (code) => {
    if (session.status !== 'pending') return;
    clearTimeoutHandle(session);

    if (code === 0) {
      // Process exited successfully; verify auth status
      verifyAuthStatus(session, db);
    } else {
      session.status = 'error';
      session.error = `Authentication failed (exit code ${code})`;
      log.warn(`Codex login exited with code ${code}`);
      notifyListeners(session, { status: 'error', message: session.error });
      scheduleCleanup(sessionId);
    }
  });

  return { sessionId };
}

/**
 * Get current session status.
 */
export function getSessionStatus(sessionId: string): CodexCliAuthStatusUpdate | null {
  const session = sessions.get(sessionId);
  if (!session) return null;

  const update: CodexCliAuthStatusUpdate = { status: session.status };
  if (session.error) update.message = session.error;
  return update;
}

/**
 * Subscribe to status updates for a session.
 * Returns an unsubscribe function.
 */
export function subscribeToStatus(
  sessionId: string,
  callback: (status: CodexCliAuthStatusUpdate) => void
): () => void {
  const session = sessions.get(sessionId);
  if (!session) {
    callback({ status: 'error', message: 'Session not found' });
    return () => {};
  }

  session.listeners.add(callback);

  // Send current status immediately
  const initial: CodexCliAuthStatusUpdate = { status: session.status };
  if (session.error) initial.message = session.error;
  callback(initial);

  return () => {
    session.listeners.delete(callback);
  };
}

/**
 * Cancel an active auth flow.
 */
export function cancelFlow(sessionId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session || session.status !== 'pending') return false;

  clearTimeoutHandle(session);
  session.childProcess?.kill();
  session.status = 'cancelled';
  notifyListeners(session, { status: 'cancelled' });
  scheduleCleanup(sessionId);
  return true;
}

/**
 * Run `codex logout` and remove the stored cli_detected credential.
 */
export async function logoutCodex(db: Database.Database): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('codex', ['logout'], { timeout: 10_000 }, (err) => {
      if (err) {
        log.warn('codex logout error:', err);
      }

      // Remove credential regardless of logout result
      try {
        removeStoredCredential(db, 'codex', 'cli_detected');
      } catch (e) {
        log.error('Failed to remove cli_detected credential:', e);
      }

      resolve(!err);
    });
  });
}

// ============================================================================
// Internal
// ============================================================================

function notifyListeners(session: CodexCliAuthSession, update: CodexCliAuthStatusUpdate): void {
  for (const listener of session.listeners) {
    try {
      listener(update);
    } catch (err) {
      log.error('Listener error:', err);
    }
  }
}

function clearTimeoutHandle(session: CodexCliAuthSession): void {
  if (session.timeoutHandle) {
    clearTimeout(session.timeoutHandle);
    session.timeoutHandle = null;
  }
}

function scheduleCleanup(sessionId: string): void {
  setTimeout(() => sessions.delete(sessionId), 60_000);
}

/**
 * After `codex login` exits 0, run `codex login status`
 * to confirm authentication succeeded. Codex uses exit code only (0 = success).
 */
function verifyAuthStatus(session: CodexCliAuthSession, db: Database.Database): void {
  execFile(
    'codex',
    ['login', 'status'],
    { timeout: 10_000 },
    (err) => {
      if (err) {
        // `codex login` exited 0 but `codex login status` failed.
        // Still treat as success since the login process completed.
        log.warn('codex login status check failed, assuming success since login exited 0:', err);
        completeAuth(session, db);
        return;
      }

      completeAuth(session, db);
    }
  );
}

function completeAuth(
  session: CodexCliAuthSession,
  db: Database.Database,
): void {
  // Save cli_detected credential
  saveCliDetected(db, 'codex');

  log.info('Codex CLI auth complete');

  session.status = 'success';
  notifyListeners(session, { status: 'success' });
  scheduleCleanup(session.id);
}

// ============================================================================
// Testing helpers
// ============================================================================

/** @internal -- exposed for testing only */
export function _getSession(sessionId: string): CodexCliAuthSession | undefined {
  return sessions.get(sessionId);
}

/** @internal -- exposed for testing only */
export function _clearSessions(): void {
  sessions.clear();
}
