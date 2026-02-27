/**
 * Claude OAuth — CLI-based authentication flow
 *
 * Spawns `claude auth login` which opens a browser for the user to authenticate.
 * After login, Claude Code manages its own credential storage (macOS Keychain /
 * Linux ~/.claude/.credentials.json) and handles token refresh internally.
 *
 * Desktop users only. Docker users continue using ANTHROPIC_API_KEY env var.
 */

import { spawn, execFile } from 'node:child_process';
import { generateUUID } from '@animus-labs/shared';
import type Database from 'better-sqlite3';
import { saveCliDetected, ensureClaudeOnboardingFile, removeCredential as removeStoredCredential } from './credential-service.js';
import { createLogger } from '../lib/logger.js';
import { getClaudeNativeBinary } from '../lib/cli-paths.js';

const log = createLogger('ClaudeOAuth', 'auth');

// ============================================================================
// Constants
// ============================================================================

const AUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ============================================================================
// Types
// ============================================================================

export interface ClaudeAuthStatusUpdate {
  status: 'pending' | 'success' | 'error' | 'cancelled';
  message?: string;
}

interface ClaudeAuthSession {
  id: string;
  status: ClaudeAuthStatusUpdate['status'];
  error?: string;
  childProcess: ReturnType<typeof spawn> | null;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
  listeners: Set<(status: ClaudeAuthStatusUpdate) => void>;
  startedAt: number;
}

// ============================================================================
// Session Store (in-memory)
// ============================================================================

const sessions = new Map<string, ClaudeAuthSession>();

// ============================================================================
// Public API
// ============================================================================

/**
 * Start the Claude auth flow by spawning `claude auth login`.
 * Opens a browser for the user to authenticate. Returns a session ID
 * for the frontend to subscribe to status updates.
 */
export function initiateClaudeAuth(db: Database.Database): { sessionId: string } {
  const sessionId = generateUUID();

  const nativeBinary = getClaudeNativeBinary();
  if (!nativeBinary) {
    throw new Error(
      'Claude Code native binary not found. ' +
      'Install Claude Code (npm install -g @anthropic-ai/claude-code) or use an API key instead.'
    );
  }

  // Build env without CLAUDECODE to avoid nesting guard
  const childEnv = { ...process.env };
  delete childEnv['CLAUDECODE'];

  let childProcess: ReturnType<typeof spawn>;
  try {
    childProcess = spawn(nativeBinary, ['auth', 'login'], {
      env: childEnv,
      stdio: 'pipe',
    });
  } catch (err) {
    throw new Error('Failed to spawn Claude CLI. Is it installed?');
  }

  const session: ClaudeAuthSession = {
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
      log.warn(`Claude auth session ${sessionId} timed out`);
      session.childProcess?.kill();
      session.status = 'error';
      session.error = 'Authentication timed out. Please try again.';
      notifyListeners(session, { status: 'error', message: session.error });
      scheduleCleanup(sessionId);
    }
  }, AUTH_TIMEOUT_MS);

  // Handle spawn errors (e.g., ENOENT if claude binary not found)
  childProcess.on('error', (err: NodeJS.ErrnoException) => {
    if (session.status !== 'pending') return;
    clearTimeoutHandle(session);

    if (err.code === 'ENOENT') {
      session.status = 'error';
      session.error = 'Claude Code binary not found. Install with: npm install -g @anthropic-ai/claude-code';
    } else {
      session.status = 'error';
      session.error = `Failed to start Claude auth: ${err.message}`;
    }
    log.error('Claude auth spawn error:', err);
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
      log.warn(`Claude auth login exited with code ${code}`);
      notifyListeners(session, { status: 'error', message: session.error });
      scheduleCleanup(sessionId);
    }
  });

  return { sessionId };
}

/**
 * Get current session status.
 */
export function getSessionStatus(sessionId: string): ClaudeAuthStatusUpdate | null {
  const session = sessions.get(sessionId);
  if (!session) return null;

  const update: ClaudeAuthStatusUpdate = { status: session.status };
  if (session.error) update.message = session.error;
  return update;
}

/**
 * Subscribe to status updates for a session.
 * Returns an unsubscribe function.
 */
export function subscribeToStatus(
  sessionId: string,
  callback: (status: ClaudeAuthStatusUpdate) => void
): () => void {
  const session = sessions.get(sessionId);
  if (!session) {
    callback({ status: 'error', message: 'Session not found' });
    return () => {};
  }

  session.listeners.add(callback);

  // Send current status immediately
  const initial: ClaudeAuthStatusUpdate = { status: session.status };
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
 * Run `claude auth logout` and remove the stored cli_detected credential.
 */
export async function logoutClaude(db: Database.Database): Promise<boolean> {
  const nativeBinary = getClaudeNativeBinary();

  return new Promise((resolve) => {
    if (!nativeBinary) {
      log.warn('Claude native binary not found, skipping CLI logout');
      // Still remove credential for graceful degradation
      try {
        removeStoredCredential(db, 'claude', 'cli_detected');
      } catch (e) {
        log.error('Failed to remove cli_detected credential:', e);
      }
      resolve(false);
      return;
    }

    const childEnv = { ...process.env };
    delete childEnv['CLAUDECODE'];

    execFile(nativeBinary, ['auth', 'logout'], { env: childEnv, timeout: 10_000 }, (err) => {
      if (err) {
        log.warn('claude auth logout error:', err);
      }

      // Remove credential regardless of logout result
      try {
        removeStoredCredential(db, 'claude', 'cli_detected');
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

function notifyListeners(session: ClaudeAuthSession, update: ClaudeAuthStatusUpdate): void {
  for (const listener of session.listeners) {
    try {
      listener(update);
    } catch (err) {
      log.error('Listener error:', err);
    }
  }
}

function clearTimeoutHandle(session: ClaudeAuthSession): void {
  if (session.timeoutHandle) {
    clearTimeout(session.timeoutHandle);
    session.timeoutHandle = null;
  }
}

function scheduleCleanup(sessionId: string): void {
  setTimeout(() => sessions.delete(sessionId), 60_000);
}

/**
 * After `claude auth login` exits 0, run `claude auth status --json`
 * to confirm authentication succeeded.
 */
function verifyAuthStatus(session: ClaudeAuthSession, db: Database.Database): void {
  const nativeBinary = getClaudeNativeBinary();
  if (!nativeBinary) {
    // Binary was available at login start but disappeared; assume success
    log.warn('Claude native binary not found during verification, assuming success');
    completeAuth(session, db, {});
    return;
  }

  const childEnv = { ...process.env };
  delete childEnv['CLAUDECODE'];

  execFile(
    nativeBinary,
    ['auth', 'status', '--json'],
    { env: childEnv, timeout: 10_000 },
    (err, stdout) => {
      if (err) {
        log.warn('claude auth status check failed:', err);
        // Still treat as success since `auth login` exited 0
        completeAuth(session, db, {});
        return;
      }

      try {
        const status = JSON.parse(stdout) as Record<string, unknown>;
        if (status['loggedIn'] === true || status['authenticated'] === true) {
          completeAuth(session, db, status);
        } else {
          session.status = 'error';
          session.error = 'Authentication was not completed. Please try again.';
          notifyListeners(session, { status: 'error', message: session.error });
          scheduleCleanup(session.id);
        }
      } catch {
        // JSON parse failed, but login exited 0; assume success
        log.warn('Could not parse claude auth status output, assuming success');
        completeAuth(session, db, {});
      }
    }
  );
}

function completeAuth(
  session: ClaudeAuthSession,
  db: Database.Database,
  statusData: Record<string, unknown>
): void {
  // Save cli_detected credential
  saveCliDetected(db, 'claude');
  ensureClaudeOnboardingFile();

  const email = statusData['email'] as string | undefined;
  const plan = statusData['plan'] as string | undefined;
  if (email) {
    log.info(`Claude auth complete: ${email} (${plan ?? 'unknown plan'})`);
  } else {
    log.info('Claude auth complete');
  }

  session.status = 'success';
  notifyListeners(session, { status: 'success' });
  scheduleCleanup(session.id);
}

// ============================================================================
// Testing helpers
// ============================================================================

/** @internal — exposed for testing only */
export function _getSession(sessionId: string): ClaudeAuthSession | undefined {
  return sessions.get(sessionId);
}

/** @internal — exposed for testing only */
export function _clearSessions(): void {
  sessions.clear();
}
