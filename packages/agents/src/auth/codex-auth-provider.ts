/**
 * Codex Auth Provider -- owns all Codex authentication flows.
 *
 * Migrated from backend services: codex-cli-auth.ts, codex-oauth.ts,
 * and parts of credential-service.ts.
 * Uses ICredentialStore for persistence (no direct DB dependency).
 */

import { spawn, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, writeFile, mkdir } from 'node:fs/promises';
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
import { getCodexBundledBinary, checkSdkAvailable } from '../sdk/sdk-resolver.js';
import { AuthSessionManager, type AuthSession } from './auth-session-manager.js';
import { validateCodexCredential } from './credential-utils.js';

// ============================================================================
// Constants
// ============================================================================

const OPENAI_AUTH_BASE = 'https://auth.openai.com';
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const DEVICE_CODE_TIMEOUT_MS = 15 * 60 * 1000;
const VERIFICATION_URL = `${OPENAI_AUTH_BASE}/codex/device`;
const REDIRECT_URI = 'http://localhost:1455/auth/callback';
const CLI_AUTH_TIMEOUT_MS = 5 * 60 * 1000;

// ============================================================================
// Session Types
// ============================================================================

interface CliAuthSession extends AuthSession {
  childProcess: ReturnType<typeof spawn> | null;
  type: 'cli';
}

interface OAuthSession extends AuthSession {
  deviceAuthId: string;
  userCode: string;
  interval: number;
  abortController: AbortController;
  type: 'oauth';
}

type CodexAuthSession = CliAuthSession | OAuthSession;

interface CodexTokens {
  access_token: string;
  refresh_token: string;
  id_token: string;
  expires_at: number;
  chatgpt_account_id: string;
}

// ============================================================================
// Provider
// ============================================================================

export class CodexAuthProvider implements IAuthProvider {
  readonly provider: AgentProvider = 'codex';
  private sessionMgr: AuthSessionManager<CodexAuthSession>;
  private log: Logger;

  constructor(logger?: Logger) {
    this.log = logger ?? createTaggedLogger('CodexAuth');
    this.sessionMgr = new AuthSessionManager<CodexAuthSession>(this.log, CLI_AUTH_TIMEOUT_MS);
  }

  async detectAuth(store: ICredentialStore): Promise<ProviderAuthStatus> {
    const methods: ProviderAuthMethod[] = [];
    const cliInstalled = checkSdkAvailable('codex');

    // Check env vars
    if (process.env['OPENAI_API_KEY']) {
      methods.push({ method: 'api_key', available: true, source: 'environment', detail: 'OPENAI_API_KEY set' });
    }

    // Check DB credentials
    try {
      const dbCreds = store.getCredentialMetadata('codex');
      for (const cred of dbCreds) {
        if (cred.credentialType === 'cli_detected') continue;
        const alreadyFound = methods.some((m) => m.method === cred.credentialType);
        if (!alreadyFound) {
          const entry: ProviderAuthMethod = {
            method: cred.credentialType as ProviderAuthMethod['method'],
            available: true,
            source: 'database',
          };
          if (cred.credentialType === 'codex_oauth') {
            entry.detail = `ChatGPT OAuth (${(cred.metadata as Record<string, unknown>)?.['accountId'] ?? 'connected'})`;
          }
          methods.push(entry);
        }
      }
    } catch {
      // Table may not exist yet
    }

    // Check CLI auth via bundled binary
    const codexBinary = getCodexBundledBinary();
    if (cliInstalled && codexBinary) {
      const cliAuth = await this.checkCliAuth(codexBinary);
      if (cliAuth.authenticated) {
        const alreadyHasCli = methods.some((m) => m.method === 'cli');
        if (!alreadyHasCli) {
          methods.push({ method: 'cli', available: true, source: 'filesystem', detail: 'Codex CLI authenticated' });
        }
      } else {
        methods.push({
          method: 'cli',
          available: false,
          source: 'filesystem',
          detail: 'Codex CLI installed but not authenticated',
        });
      }
    } else {
      // Fall back to filesystem check
      try {
        if (existsSync(join(homedir(), '.codex', 'auth.json'))) {
          methods.push({ method: 'cli', available: true, source: 'filesystem', detail: 'Codex auth.json found' });
        }
      } catch {
        // Ignore
      }
    }

    return {
      provider: 'codex',
      configured: methods.some((m) => m.available),
      cliInstalled,
      methods,
    };
  }

  async initiateAuth(
    store: ICredentialStore,
    method: 'cli' | 'oauth',
  ): Promise<{ sessionId: string; userCode?: string; verificationUrl?: string; expiresIn?: number }> {
    if (method === 'oauth') {
      return this.initiateDeviceCodeFlow(store);
    }
    return this.initiateCliAuth(store);
  }

  subscribeToAuthStatus(sessionId: string, cb: (s: AuthFlowStatusUpdate) => void): () => void {
    return this.sessionMgr.subscribe(sessionId, cb);
  }

  getAuthFlowStatus(sessionId: string): AuthFlowStatusUpdate | null {
    return this.sessionMgr.getStatus(sessionId);
  }

  cancelAuthFlow(sessionId: string): boolean {
    const session = this.sessionMgr.getSession(sessionId);
    if (session?.type === 'cli' && session.childProcess) {
      session.childProcess.kill();
    } else if (session?.type === 'oauth') {
      session.abortController.abort();
    }
    return this.sessionMgr.cancel(sessionId);
  }

  async logout(store: ICredentialStore): Promise<boolean> {
    const codexBinary = getCodexBundledBinary();

    return new Promise((resolve) => {
      if (!codexBinary) {
        this.log.warn('Codex binary not found, skipping CLI logout');
        try { store.deleteCredential('codex', 'cli_detected'); } catch { /* ignore */ }
        resolve(false);
        return;
      }

      execFile(codexBinary, ['logout'], { timeout: 10_000 }, (err) => {
        if (err) this.log.warn('codex logout error', { error: String(err) });
        try { store.deleteCredential('codex', 'cli_detected'); } catch { /* ignore */ }
        resolve(!err);
      });
    });
  }

  async prepareSessionEnv(store: ICredentialStore, sessionDir: string): Promise<Record<string, string>> {
    // Check if OAuth tokens are available
    const cred = store.getCredential('codex', 'codex_oauth');
    if (cred) {
      return this.prepareOAuthSessionAuth(store, sessionDir, cred.data);
    }

    // CLI auth: copy auth.json from ~/.codex/ to sessionDir
    await this.copyCliAuth(sessionDir);
    return { CODEX_HOME: sessionDir };
  }

  async validateCredential(key: string): Promise<{ valid: boolean; message: string }> {
    return validateCodexCredential(key);
  }

  // ===========================================================================
  // CLI Auth Flow
  // ===========================================================================

  private initiateCliAuth(store: ICredentialStore): { sessionId: string } {
    const sessionId = this.sessionMgr.createSessionId();

    const codexBinary = getCodexBundledBinary();
    if (!codexBinary) {
      throw new Error('Codex SDK binary not found. The @openai/codex-sdk package may not be installed correctly.');
    }

    let childProcess: ReturnType<typeof spawn>;
    try {
      childProcess = spawn(codexBinary, ['login'], { stdio: 'pipe' });
    } catch {
      throw new Error('Failed to spawn Codex CLI.');
    }

    const session: CliAuthSession = {
      id: sessionId,
      status: 'pending',
      childProcess,
      timeoutHandle: null,
      listeners: new Set(),
      startedAt: Date.now(),
      type: 'cli',
    };

    this.sessionMgr.setSession(session);

    this.sessionMgr.setupTimeout(session, (s) => {
      this.log.warn(`Codex auth session ${s.id} timed out`);
      if (s.type === 'cli') s.childProcess?.kill();
      s.status = 'error';
      s.error = 'Authentication timed out. Please try again.';
      this.sessionMgr.notify(s, { status: 'error', message: s.error });
      this.sessionMgr.scheduleCleanup(s.id);
    });

    childProcess.on('error', (err: NodeJS.ErrnoException) => {
      if (session.status !== 'pending') return;
      this.sessionMgr.clearTimeout(session);

      session.status = 'error';
      session.error = err.code === 'ENOENT'
        ? 'Codex SDK binary not found.'
        : `Failed to start Codex auth: ${err.message}`;
      this.log.error('Codex auth spawn error', { error: String(err) });
      this.sessionMgr.notify(session, { status: 'error', message: session.error });
      this.sessionMgr.scheduleCleanup(sessionId);
    });

    childProcess.on('close', (code) => {
      if (session.status !== 'pending') return;
      this.sessionMgr.clearTimeout(session);

      if (code === 0) {
        this.verifyCliAuthAndComplete(session, store);
      } else {
        session.status = 'error';
        session.error = `Authentication failed (exit code ${code})`;
        this.log.warn(`Codex login exited with code ${code}`);
        this.sessionMgr.notify(session, { status: 'error', message: session.error });
        this.sessionMgr.scheduleCleanup(sessionId);
      }
    });

    return { sessionId };
  }

  private verifyCliAuthAndComplete(session: CliAuthSession, store: ICredentialStore): void {
    const codexBinary = getCodexBundledBinary();
    if (!codexBinary) {
      this.log.warn('Codex binary not found during verification, assuming success');
      this.completeCliAuth(session, store);
      return;
    }

    execFile(codexBinary, ['login', 'status'], { timeout: 10_000 }, (err) => {
      if (err) {
        this.log.warn('codex login status check failed, assuming success since login exited 0', { error: String(err) });
      }
      this.completeCliAuth(session, store);
    });
  }

  private completeCliAuth(session: CliAuthSession, store: ICredentialStore): void {
    store.saveCredential('codex', 'cli_detected', 'detected');
    this.log.info('Codex CLI auth complete');
    session.status = 'success';
    this.sessionMgr.notify(session, { status: 'success' });
    this.sessionMgr.scheduleCleanup(session.id);
  }

  // ===========================================================================
  // Device Code OAuth Flow
  // ===========================================================================

  private async initiateDeviceCodeFlow(store: ICredentialStore): Promise<{
    sessionId: string;
    userCode: string;
    verificationUrl: string;
    expiresIn: number;
  }> {
    const response = await fetch(`${OPENAI_AUTH_BASE}/api/accounts/deviceauth/usercode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: CODEX_CLIENT_ID }),
    });

    if (response.status === 404) {
      throw new Error('Device code authentication is not enabled. Please enable it in your ChatGPT security settings.');
    }
    if (!response.ok) {
      throw new Error(`Failed to request device code: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      device_auth_id: string;
      user_code: string;
      interval: number | string;
    };

    const sessionId = this.sessionMgr.createSessionId();
    const session: OAuthSession = {
      id: sessionId,
      deviceAuthId: data.device_auth_id,
      userCode: data.user_code,
      interval: typeof data.interval === 'string' ? parseInt(data.interval, 10) : data.interval,
      startedAt: Date.now(),
      abortController: new AbortController(),
      status: 'pending',
      listeners: new Set(),
      timeoutHandle: null,
      type: 'oauth',
    };

    this.sessionMgr.setSession(session);

    // Start background polling
    this.pollForAuthCode(session, store).catch((err) => {
      this.log.error('Polling error', { error: String(err) });
    });

    return {
      sessionId,
      userCode: data.user_code,
      verificationUrl: VERIFICATION_URL,
      expiresIn: Math.floor(DEVICE_CODE_TIMEOUT_MS / 1000),
    };
  }

  private async pollForAuthCode(session: OAuthSession, store: ICredentialStore): Promise<void> {
    const { signal } = session.abortController;

    while (!signal.aborted) {
      const elapsed = Date.now() - session.startedAt;
      if (elapsed >= DEVICE_CODE_TIMEOUT_MS) {
        session.status = 'expired';
        this.sessionMgr.notify(session, { status: 'expired' });
        this.sessionMgr.scheduleCleanup(session.id);
        return;
      }

      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, session.interval * 1000);
        signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
      });

      if (signal.aborted) return;

      try {
        const response = await fetch(`${OPENAI_AUTH_BASE}/api/accounts/deviceauth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            device_auth_id: session.deviceAuthId,
            user_code: session.userCode,
          }),
          signal,
        });

        if (response.status === 403) {
          this.sessionMgr.notify(session, {
            status: 'pending',
            message: `Waiting for authorization (${Math.floor(elapsed / 1000)}s)`,
          });
          continue;
        }

        if (response.status === 404) {
          session.status = 'error';
          session.error = 'Device code authentication is not enabled for your account.';
          this.sessionMgr.notify(session, { status: 'error', message: session.error });
          this.sessionMgr.scheduleCleanup(session.id);
          return;
        }

        if (response.ok) {
          const authData = await response.json() as {
            authorization_code: string;
            code_challenge: string;
            code_verifier: string;
          };

          // Exchange for tokens
          const tokenResponse = await fetch(`${OPENAI_AUTH_BASE}/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              client_id: CODEX_CLIENT_ID,
              code: authData.authorization_code,
              code_verifier: authData.code_verifier,
              redirect_uri: REDIRECT_URI,
            }),
          });

          if (!tokenResponse.ok) {
            const text = await tokenResponse.text().catch(() => '');
            session.status = 'error';
            session.error = this.parseTokenExchangeError(tokenResponse.status, text);
            this.sessionMgr.notify(session, { status: 'error', message: session.error });
            this.sessionMgr.scheduleCleanup(session.id);
            return;
          }

          const tokenData = await tokenResponse.json() as {
            access_token: string;
            refresh_token: string;
            id_token: string;
            expires_in: number;
          };

          const accountId = this.extractAccountId(tokenData.access_token);

          const tokens: CodexTokens = {
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            id_token: tokenData.id_token,
            expires_at: Date.now() + tokenData.expires_in * 1000,
            chatgpt_account_id: accountId,
          };

          store.saveCredential('codex', 'codex_oauth', JSON.stringify(tokens), {
            accountId,
            expiresAt: new Date(tokens.expires_at).toISOString(),
            authMode: 'chatgpt',
          });

          process.env['CODEX_OAUTH_CONFIGURED'] = 'true';

          session.status = 'success';
          this.sessionMgr.notify(session, { status: 'success' });
          this.sessionMgr.scheduleCleanup(session.id);
          return;
        }

        this.log.warn(`Unexpected poll status: ${response.status}`);
      } catch (err) {
        if (signal.aborted) return;
        this.log.error('Poll error', { error: String(err) });
      }
    }
  }

  // ===========================================================================
  // Session Auth Preparation
  // ===========================================================================

  private async prepareOAuthSessionAuth(
    store: ICredentialStore,
    sessionDir: string,
    credData: string,
  ): Promise<Record<string, string>> {
    let tokens: CodexTokens = JSON.parse(credData);

    // Refresh if token expires within 5 minutes
    const fiveMinutes = 5 * 60 * 1000;
    if (tokens.expires_at - Date.now() < fiveMinutes) {
      try {
        const refreshed = await this.refreshAccessToken(tokens.refresh_token);
        tokens = {
          access_token: refreshed.access_token,
          refresh_token: refreshed.refresh_token,
          id_token: refreshed.id_token,
          expires_at: Date.now() + refreshed.expires_in * 1000,
          chatgpt_account_id: tokens.chatgpt_account_id,
        };

        store.saveCredential('codex', 'codex_oauth', JSON.stringify(tokens), {
          accountId: tokens.chatgpt_account_id,
          expiresAt: new Date(tokens.expires_at).toISOString(),
          authMode: 'chatgpt',
        });
      } catch (err) {
        this.log.error('Token refresh failed, using existing token', { error: String(err) });
      }
    }

    await mkdir(sessionDir, { recursive: true });
    const authJson = {
      auth_mode: 'chatgpt',
      tokens: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        id_token: tokens.id_token,
        expires_at: new Date(tokens.expires_at).toISOString(),
      },
      last_refresh: new Date().toISOString(),
    };

    await writeFile(
      join(sessionDir, 'auth.json'),
      JSON.stringify(authJson, null, 2),
      { mode: 0o600 },
    );

    return { CODEX_HOME: sessionDir };
  }

  private async copyCliAuth(codexHome: string): Promise<void> {
    const source = join(homedir(), '.codex', 'auth.json');
    if (!existsSync(source)) {
      this.log.debug('No CLI auth.json at ~/.codex/auth.json, skipping copy');
      return;
    }

    try {
      await mkdir(codexHome, { recursive: true });
      const dest = join(codexHome, 'auth.json');
      await copyFile(source, dest);
      this.log.debug(`Copied CLI auth.json to ${dest}`);
    } catch (err) {
      this.log.warn('Failed to copy CLI auth.json to CODEX_HOME', { error: String(err) });
    }
  }

  // ===========================================================================
  // Token Management
  // ===========================================================================

  async refreshAccessToken(refreshToken: string): Promise<{
    access_token: string;
    refresh_token: string;
    id_token: string;
    expires_in: number;
  }> {
    const response = await fetch(`${OPENAI_AUTH_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: CODEX_CLIENT_ID,
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Token refresh failed: ${response.status} ${text}`);
    }

    return response.json() as Promise<{
      access_token: string;
      refresh_token: string;
      id_token: string;
      expires_in: number;
    }>;
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private checkCliAuth(binaryPath: string): Promise<{ authenticated: boolean }> {
    return new Promise((resolve) => {
      execFile(
        binaryPath,
        ['login', 'status'],
        { timeout: 5000, shell: platform() === 'win32' },
        (err) => {
          resolve({ authenticated: !err });
        },
      );
    });
  }

  private parseTokenExchangeError(status: number, responseText: string): string {
    try {
      const data = JSON.parse(responseText) as Record<string, unknown>;
      const errorCode = data['error'] as string | undefined;
      const errorDescription = data['error_description'] as string | undefined;

      if (errorCode === 'token_exchange_user_error') {
        return 'Your ChatGPT account may not support API access. Check your subscription settings, or use an API key instead.';
      }
      if (errorDescription) return errorDescription;
      if (errorCode) return `Token exchange failed: ${errorCode}`;
    } catch {
      // Not JSON
    }
    return `Token exchange failed (${status}). Try using an API key instead.`;
  }

  private extractAccountId(accessToken: string): string {
    try {
      const parts = accessToken.split('.');
      if (parts.length !== 3) return '';
      const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
      return payload?.['https://api.openai.com/auth']?.chatgpt_account_id ?? '';
    } catch {
      return '';
    }
  }

  /** @internal -- for testing */
  _clearSessions(): void {
    this.sessionMgr._clearAll();
  }
}
