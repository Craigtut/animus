/**
 * Claude Auth Provider -- owns all Claude authentication flows.
 *
 * Migrated from backend services: claude-oauth.ts and parts of credential-service.ts.
 * Uses ICredentialStore for persistence (no direct DB dependency).
 */

import { spawn, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import type { AgentProvider } from '@animus-labs/shared';
import type {
  IAuthProvider,
  ICredentialStore,
  AuthFlowStatusUpdate,
  ProviderAuthStatus,
  ProviderAuthMethod,
} from '../types.js';
import { createTaggedLogger, type Logger } from '../logger.js';
import { getClaudeNativeBinary } from '../sdk/sdk-resolver.js';
import { checkSdkAvailable } from '../sdk/sdk-resolver.js';
import { AuthSessionManager, type AuthSession } from './auth-session-manager.js';
import { ensureClaudeOnboardingFile, validateClaudeCredential, type CredentialType } from './credential-utils.js';

const isWindows = platform() === 'win32';

interface ClaudeAuthSession extends AuthSession {
  childProcess: ReturnType<typeof spawn> | null;
}

export class ClaudeAuthProvider implements IAuthProvider {
  readonly provider: AgentProvider = 'claude';
  private sessionMgr: AuthSessionManager<ClaudeAuthSession>;
  private log: Logger;

  constructor(logger?: Logger) {
    this.log = logger ?? createTaggedLogger('ClaudeAuth');
    this.sessionMgr = new AuthSessionManager<ClaudeAuthSession>(this.log, 5 * 60 * 1000);
  }

  async detectAuth(store: ICredentialStore): Promise<ProviderAuthStatus> {
    const methods: ProviderAuthMethod[] = [];
    const cliInstalled = checkSdkAvailable('claude');

    // Check env vars
    if (process.env['ANTHROPIC_API_KEY']) {
      methods.push({ method: 'api_key', available: true, source: 'environment', detail: 'ANTHROPIC_API_KEY set' });
    }
    if (process.env['CLAUDE_CODE_OAUTH_TOKEN']) {
      methods.push({ method: 'oauth_token', available: true, source: 'environment', detail: 'CLAUDE_CODE_OAUTH_TOKEN set' });
    }

    // Check DB credentials
    try {
      const dbCreds = store.getCredentialMetadata('claude');
      for (const cred of dbCreds) {
        const alreadyFound = methods.some(
          (m) => m.method === cred.credentialType || (m.method === 'api_key' && cred.credentialType === 'api_key'),
        );
        if (!alreadyFound && cred.credentialType !== 'cli_detected') {
          methods.push({
            method: cred.credentialType as ProviderAuthMethod['method'],
            available: true,
            source: 'database',
          });
        }
      }
    } catch {
      // Table may not exist yet
    }

    // Check native binary auth status
    const nativeBinary = getClaudeNativeBinary();
    if (nativeBinary) {
      const cliAuth = await this.checkCliAuth(nativeBinary);
      if (cliAuth.authenticated) {
        const alreadyHasCli = methods.some((m) => m.method === 'cli');
        if (!alreadyHasCli) {
          methods.push({
            method: 'cli',
            available: true,
            source: 'filesystem',
            detail: cliAuth.email ? `Signed in as ${cliAuth.email}` : 'Claude Code authenticated',
          });
        }
      } else {
        // CLI says not authenticated. Report stale status for backend to clean up.
        methods.push({
          method: 'cli',
          available: false,
          source: 'filesystem',
          detail: 'Claude Code installed but not authenticated',
        });
      }
    } else {
      // No native binary: fall back to filesystem check
      try {
        const home = homedir();
        if (existsSync(join(home, '.claude', '.credentials')) || existsSync(join(home, '.claude', '.credentials.json'))) {
          methods.push({ method: 'cli', available: true, source: 'filesystem', detail: 'Claude Code credentials found' });
        }
      } catch {
        // Ignore
      }
    }

    return {
      provider: 'claude',
      configured: methods.some((m) => m.available),
      cliInstalled,
      methods,
    };
  }

  async initiateAuth(store: ICredentialStore, method: 'cli' | 'oauth'): Promise<{ sessionId: string; status: 'success' | 'error'; message?: string }> {
    const sessionId = this.sessionMgr.createSessionId();

    const nativeBinary = getClaudeNativeBinary();
    if (!nativeBinary) {
      throw new Error(
        'Claude Code native binary not found. ' +
        'Install Claude Code (npm install -g @anthropic-ai/claude-code) or use an API key instead.',
      );
    }

    const childEnv = { ...process.env };
    delete childEnv['CLAUDECODE'];

    let childProcess: ReturnType<typeof spawn>;
    try {
      childProcess = spawn(nativeBinary, ['auth', 'login'], {
        env: childEnv,
        stdio: 'pipe',
        shell: isWindows,
      });
    } catch {
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

    this.sessionMgr.setSession(session);

    // Return a promise that resolves when auth completes.
    // The CLI blocks until OAuth finishes, so the mutation awaits the result.
    return new Promise((resolve) => {
      const done = (status: 'success' | 'error', message?: string) => {
        this.sessionMgr.clearTimeout(session);
        session.status = status;
        if (message) session.error = message;
        this.sessionMgr.notify(session, { status, message });
        this.sessionMgr.scheduleCleanup(session.id);
        resolve({ sessionId, status, message });
      };

      // Timeout
      this.sessionMgr.setupTimeout(session, (s) => {
        this.log.warn(`Claude auth session ${s.id} timed out`);
        s.childProcess?.kill();
        done('error', 'Authentication timed out. Please try again.');
      });

      childProcess.on('error', (err: NodeJS.ErrnoException) => {
        if (session.status !== 'pending') return;

        if (err.code === 'ENOENT') {
          this.log.error('Claude auth spawn error: ENOENT');
          done('error', 'Claude Code binary not found. Install with: npm install -g @anthropic-ai/claude-code');
        } else {
          this.log.error('Claude auth spawn error', { error: String(err) });
          done('error', `Failed to start Claude auth: ${err.message}`);
        }
      });

      childProcess.on('close', (code) => {
        if (session.status !== 'pending') return;

        if (code === 0) {
          this.verifyAuthAndResolve(session, store, done);
        } else {
          this.log.warn(`Claude auth login exited with code ${code}`);
          done('error', `Authentication failed (exit code ${code})`);
        }
      });
    });
  }

  subscribeToAuthStatus(sessionId: string, cb: (s: AuthFlowStatusUpdate) => void): () => void {
    return this.sessionMgr.subscribe(sessionId, cb);
  }

  getAuthFlowStatus(sessionId: string): AuthFlowStatusUpdate | null {
    return this.sessionMgr.getStatus(sessionId);
  }

  cancelAuthFlow(sessionId: string): boolean {
    const session = this.sessionMgr.getSession(sessionId);
    if (session?.childProcess) {
      session.childProcess.kill();
    }
    return this.sessionMgr.cancel(sessionId);
  }

  async logout(store: ICredentialStore): Promise<boolean> {
    const nativeBinary = getClaudeNativeBinary();

    return new Promise((resolve) => {
      if (!nativeBinary) {
        this.log.warn('Claude native binary not found, skipping CLI logout');
        try { store.deleteCredential('claude', 'cli_detected'); } catch { /* ignore */ }
        resolve(false);
        return;
      }

      const childEnv = { ...process.env };
      delete childEnv['CLAUDECODE'];

      execFile(nativeBinary, ['auth', 'logout'], { env: childEnv, timeout: 10_000, shell: isWindows }, (err) => {
        if (err) this.log.warn('claude auth logout error', { error: String(err) });
        try { store.deleteCredential('claude', 'cli_detected'); } catch { /* ignore */ }
        resolve(!err);
      });
    });
  }

  async validateCredential(key: string, type: string): Promise<{ valid: boolean; message: string }> {
    return validateClaudeCredential(key, type as CredentialType);
  }

  // ===========================================================================
  // Internal
  // ===========================================================================

  private checkCliAuth(binaryPath: string): Promise<{ authenticated: boolean; email?: string }> {
    return new Promise((resolve) => {
      const childEnv = { ...process.env };
      delete childEnv['CLAUDECODE'];

      execFile(
        binaryPath,
        ['auth', 'status', '--json'],
        { env: childEnv, timeout: 5000, shell: isWindows },
        (err, stdout) => {
          if (err) {
            resolve({ authenticated: false });
            return;
          }
          try {
            const status = JSON.parse(stdout) as Record<string, unknown>;
            const authenticated = status['loggedIn'] === true || status['authenticated'] === true;
            const email = (status['email'] as string) || undefined;
            resolve({ authenticated, ...(email != null ? { email } : {}) });
          } catch {
            resolve({ authenticated: false });
          }
        },
      );
    });
  }

  private verifyAuthAndResolve(
    session: ClaudeAuthSession,
    store: ICredentialStore,
    done: (status: 'success' | 'error', message?: string) => void,
  ): void {
    const nativeBinary = getClaudeNativeBinary();
    if (!nativeBinary) {
      this.log.warn('Claude native binary not found during verification, assuming success');
      this.completeAuth(session, store, {});
      done('success');
      return;
    }

    const childEnv = { ...process.env };
    delete childEnv['CLAUDECODE'];

    execFile(
      nativeBinary,
      ['auth', 'status', '--json'],
      { env: childEnv, timeout: 10_000, shell: isWindows },
      (err, stdout) => {
        if (err) {
          this.log.warn('claude auth status check failed', { error: String(err) });
          this.completeAuth(session, store, {});
          done('success');
          return;
        }

        try {
          const status = JSON.parse(stdout) as Record<string, unknown>;
          if (status['loggedIn'] === true || status['authenticated'] === true) {
            this.completeAuth(session, store, status);
            done('success');
          } else {
            done('error', 'Authentication was not completed. Please try again.');
          }
        } catch {
          this.log.warn('Could not parse claude auth status output, assuming success');
          this.completeAuth(session, store, {});
          done('success');
        }
      },
    );
  }

  private completeAuth(
    session: ClaudeAuthSession,
    store: ICredentialStore,
    statusData: Record<string, unknown>,
  ): void {
    store.saveCredential('claude', 'cli_detected', 'detected');
    ensureClaudeOnboardingFile(this.log);

    const email = statusData['email'] as string | undefined;
    const plan = statusData['plan'] as string | undefined;
    if (email) {
      this.log.info(`Claude auth complete: ${email} (${plan ?? 'unknown plan'})`);
    } else {
      this.log.info('Claude auth complete');
    }
  }

  /** @internal -- for testing */
  _clearSessions(): void {
    this.sessionMgr._clearAll();
  }
}
