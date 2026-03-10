/**
 * Generic in-memory auth session manager.
 *
 * Extracts the shared pattern of: Map of sessions + listeners + timeout +
 * cleanup, used by all auth providers (Claude CLI, Codex CLI, Codex OAuth).
 */

import type { AuthFlowStatusUpdate } from '../types.js';
import { generateUUID } from '../utils/index.js';
import { type Logger } from '../logger.js';

export interface AuthSession {
  id: string;
  status: AuthFlowStatusUpdate['status'];
  error?: string;
  listeners: Set<(status: AuthFlowStatusUpdate) => void>;
  startedAt: number;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
}

/**
 * Generic auth session manager that handles session storage,
 * listener notification, timeouts, and cleanup.
 */
export class AuthSessionManager<T extends AuthSession> {
  protected sessions = new Map<string, T>();
  protected log: Logger;
  protected timeoutMs: number;

  constructor(log: Logger, timeoutMs = 5 * 60 * 1000) {
    this.log = log;
    this.timeoutMs = timeoutMs;
  }

  createSessionId(): string {
    return generateUUID();
  }

  getSession(sessionId: string): T | undefined {
    return this.sessions.get(sessionId);
  }

  setSession(session: T): void {
    this.sessions.set(session.id, session);
  }

  getStatus(sessionId: string): AuthFlowStatusUpdate | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const update: AuthFlowStatusUpdate = { status: session.status };
    if (session.error) update.message = session.error;
    return update;
  }

  subscribe(
    sessionId: string,
    callback: (status: AuthFlowStatusUpdate) => void,
  ): () => void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.log.warn(`Subscribe: session ${sessionId} not found`);
      callback({ status: 'error', message: 'Session not found' });
      return () => {};
    }

    session.listeners.add(callback);
    this.log.debug(`Subscribe: session ${sessionId} now has ${session.listeners.size} listener(s), current status: ${session.status}`);

    // Send current status on next tick so tRPC observable has time to wire up
    const initial: AuthFlowStatusUpdate = { status: session.status };
    if (session.error) initial.message = session.error;
    setImmediate(() => callback(initial));

    return () => {
      session.listeners.delete(callback);
    };
  }

  notify(session: T, update: AuthFlowStatusUpdate): void {
    for (const listener of session.listeners) {
      try {
        listener(update);
      } catch (err) {
        this.log.error('Listener error', { error: String(err) });
      }
    }
  }

  cancel(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'pending') return false;

    this.clearTimeout(session);
    session.status = 'cancelled';
    this.notify(session, { status: 'cancelled' });
    this.scheduleCleanup(sessionId);
    return true;
  }

  setupTimeout(session: T, onTimeout: (session: T) => void): void {
    session.timeoutHandle = setTimeout(() => {
      if (session.status === 'pending') {
        onTimeout(session);
      }
    }, this.timeoutMs);
  }

  clearTimeout(session: T): void {
    if (session.timeoutHandle) {
      globalThis.clearTimeout(session.timeoutHandle);
      session.timeoutHandle = null;
    }
  }

  scheduleCleanup(sessionId: string): void {
    setTimeout(() => this.sessions.delete(sessionId), 60_000);
  }

  /** @internal -- for testing */
  _clearAll(): void {
    this.sessions.clear();
  }
}
