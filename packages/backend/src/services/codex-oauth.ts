/**
 * Codex OAuth — Device Code Flow
 *
 * Implements OpenAI's non-standard device code flow for Codex CLI authentication.
 * Proxies the flow through Animus's backend so the web UI can display the user code.
 *
 * @see docs/agents/codex/oauth.md
 */

import { generateUUID } from '@animus-labs/shared';
import { copyFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type Database from 'better-sqlite3';
import * as systemStore from '../db/stores/system-store.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('CodexOAuth', 'auth');

// ============================================================================
// Constants
// ============================================================================

const OPENAI_AUTH_BASE = 'https://auth.openai.com';
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const DEVICE_CODE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const VERIFICATION_URL = `${OPENAI_AUTH_BASE}/codex/device`;
const REDIRECT_URI = 'http://localhost:1455/auth/callback';

// ============================================================================
// Types
// ============================================================================

export interface AuthStatusUpdate {
  status: 'pending' | 'success' | 'error' | 'expired' | 'cancelled';
  elapsed?: number;
  message?: string;
}

interface DeviceCodeSession {
  id: string;
  deviceAuthId: string;
  userCode: string;
  interval: number;
  startedAt: number;
  abortController: AbortController;
  status: 'pending' | 'success' | 'error' | 'expired' | 'cancelled';
  error?: string;
  listeners: Set<(status: AuthStatusUpdate) => void>;
}

interface CodexTokens {
  access_token: string;
  refresh_token: string;
  id_token: string;
  expires_at: number;
  chatgpt_account_id: string;
}

// ============================================================================
// Session Store (in-memory)
// ============================================================================

const sessions = new Map<string, DeviceCodeSession>();

// ============================================================================
// Public API
// ============================================================================

/**
 * Start the device code flow.
 * Returns session info for the frontend to display the user code.
 */
export async function initiateDeviceCodeFlow(db: Database.Database): Promise<{
  sessionId: string;
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
}> {
  // Phase 1: Request user code
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

  const sessionId = generateUUID();
  const session: DeviceCodeSession = {
    id: sessionId,
    deviceAuthId: data.device_auth_id,
    userCode: data.user_code,
    interval: typeof data.interval === 'string' ? parseInt(data.interval, 10) : data.interval,
    startedAt: Date.now(),
    abortController: new AbortController(),
    status: 'pending',
    listeners: new Set(),
  };

  sessions.set(sessionId, session);

  // Start background polling
  pollForAuthCode(session, db).catch((err) => {
    log.error('Polling error:', err);
  });

  return {
    sessionId,
    userCode: data.user_code,
    verificationUrl: VERIFICATION_URL,
    expiresIn: Math.floor(DEVICE_CODE_TIMEOUT_MS / 1000),
  };
}

/**
 * Get current session status.
 */
export function getSessionStatus(sessionId: string): AuthStatusUpdate | null {
  const session = sessions.get(sessionId);
  if (!session) return null;

  const update: AuthStatusUpdate = {
    status: session.status,
    elapsed: Math.floor((Date.now() - session.startedAt) / 1000),
  };
  if (session.error) update.message = session.error;
  return update;
}

/**
 * Subscribe to status updates for a session.
 * Returns an unsubscribe function.
 */
export function subscribeToStatus(
  sessionId: string,
  callback: (status: AuthStatusUpdate) => void
): () => void {
  const session = sessions.get(sessionId);
  if (!session) {
    callback({ status: 'error', message: 'Session not found' });
    return () => {};
  }

  session.listeners.add(callback);

  // Send current status immediately
  const initial: AuthStatusUpdate = {
    status: session.status,
    elapsed: Math.floor((Date.now() - session.startedAt) / 1000),
  };
  if (session.error) initial.message = session.error;
  callback(initial);

  return () => {
    session.listeners.delete(callback);
  };
}

/**
 * Cancel an active device code flow.
 */
export function cancelFlow(sessionId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session || session.status !== 'pending') return false;

  session.abortController.abort();
  session.status = 'cancelled';
  notifyListeners(session, { status: 'cancelled' });

  // Cleanup after a delay
  setTimeout(() => sessions.delete(sessionId), 60_000);
  return true;
}

/**
 * Refresh an access token using the refresh token.
 */
export async function refreshAccessToken(refreshToken: string): Promise<{
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

/**
 * Prepare Codex session auth directory.
 * Decrypts stored OAuth tokens, refreshes if needed, writes temp auth.json.
 * Returns env vars to pass to the Codex SDK.
 */
export async function prepareCodexSessionAuth(
  db: Database.Database,
  sessionDir: string
): Promise<Record<string, string>> {
  const cred = systemStore.getCredential(db, 'codex', 'codex_oauth');
  if (!cred) {
    throw new Error('No Codex OAuth credentials found');
  }

  let tokens: CodexTokens = JSON.parse(cred.data);

  // Refresh if token expires within 5 minutes
  const fiveMinutes = 5 * 60 * 1000;
  if (tokens.expires_at - Date.now() < fiveMinutes) {
    try {
      const refreshed = await refreshAccessToken(tokens.refresh_token);
      tokens = {
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token,
        id_token: refreshed.id_token,
        expires_at: Date.now() + refreshed.expires_in * 1000,
        chatgpt_account_id: tokens.chatgpt_account_id,
      };

      // Update stored credentials
      systemStore.saveCredential(
        db,
        'codex',
        'codex_oauth',
        JSON.stringify(tokens),
        {
          accountId: tokens.chatgpt_account_id,
          expiresAt: new Date(tokens.expires_at).toISOString(),
          authMode: 'chatgpt',
        }
      );
    } catch (err) {
      log.error('Token refresh failed, using existing token:', err);
    }
  }

  // Write auth.json to session directory
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
    { mode: 0o600 }
  );

  return { CODEX_HOME: sessionDir };
}

/**
 * Copy CLI auth credentials into a CODEX_HOME directory.
 *
 * When using CLI-based auth (`codex login`), credentials live at
 * ~/.codex/auth.json (or the system keyring). Since we override CODEX_HOME
 * for plugin config, the binary's file fallback won't find auth at the
 * default location. This copies the auth file so it's available at
 * $CODEX_HOME/auth.json.
 *
 * Safe to call when no CLI auth exists (no-ops silently).
 */
export async function copyCodexCliAuth(codexHome: string): Promise<void> {
  const source = join(homedir(), '.codex', 'auth.json');
  if (!existsSync(source)) {
    log.debug('No CLI auth.json at ~/.codex/auth.json, skipping copy');
    return;
  }

  try {
    await mkdir(codexHome, { recursive: true });
    const dest = join(codexHome, 'auth.json');
    await copyFile(source, dest);
    log.debug(`Copied CLI auth.json to ${dest}`);
  } catch (err) {
    log.warn('Failed to copy CLI auth.json to CODEX_HOME:', err);
  }
}

// ============================================================================
// Internal
// ============================================================================

function notifyListeners(session: DeviceCodeSession, update: AuthStatusUpdate): void {
  for (const listener of session.listeners) {
    try {
      listener(update);
    } catch (err) {
      log.error('Listener error:', err);
    }
  }
}

/**
 * Background polling loop for a device code session.
 */
async function pollForAuthCode(session: DeviceCodeSession, db: Database.Database): Promise<void> {
  const { signal } = session.abortController;

  while (!signal.aborted) {
    // Check timeout
    const elapsed = Date.now() - session.startedAt;
    if (elapsed >= DEVICE_CODE_TIMEOUT_MS) {
      session.status = 'expired';
      notifyListeners(session, { status: 'expired' });
      setTimeout(() => sessions.delete(session.id), 60_000);
      return;
    }

    // Wait for the polling interval
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, session.interval * 1000);
      signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });

    if (signal.aborted) return;

    try {
      // Phase 3: Poll for authorization code
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
        // Authorization pending
        notifyListeners(session, {
          status: 'pending',
          elapsed: Math.floor((Date.now() - session.startedAt) / 1000),
        });
        continue;
      }

      if (response.status === 404) {
        session.status = 'error';
        session.error = 'Device code authentication is not enabled for your account.';
        notifyListeners(session, { status: 'error', message: session.error });
        setTimeout(() => sessions.delete(session.id), 60_000);
        return;
      }

      if (response.ok) {
        // Phase 3 success: got authorization code + PKCE
        const authData = await response.json() as {
          authorization_code: string;
          code_challenge: string;
          code_verifier: string;
        };

        // Phase 4: Exchange for tokens
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
          session.error = parseTokenExchangeError(tokenResponse.status, text);
          notifyListeners(session, { status: 'error', message: session.error });
          setTimeout(() => sessions.delete(session.id), 60_000);
          return;
        }

        const tokenData = await tokenResponse.json() as {
          access_token: string;
          refresh_token: string;
          id_token: string;
          expires_in: number;
        };

        // Extract account ID from JWT
        const accountId = extractAccountId(tokenData.access_token);

        // Store encrypted tokens
        const tokens: CodexTokens = {
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          id_token: tokenData.id_token,
          expires_at: Date.now() + tokenData.expires_in * 1000,
          chatgpt_account_id: accountId,
        };

        systemStore.saveCredential(
          db,
          'codex',
          'codex_oauth',
          JSON.stringify(tokens),
          {
            accountId,
            expiresAt: new Date(tokens.expires_at).toISOString(),
            authMode: 'chatgpt',
          }
        );

        // Set sentinel env var
        process.env['CODEX_OAUTH_CONFIGURED'] = 'true';

        session.status = 'success';
        notifyListeners(session, { status: 'success' });
        setTimeout(() => sessions.delete(session.id), 60_000);
        return;
      }

      // Unexpected status
      log.warn(`Unexpected poll status: ${response.status}`);
    } catch (err) {
      if (signal.aborted) return;
      log.error('Poll error:', err);
      // Continue polling on transient errors
    }
  }
}

/**
 * Parse a token exchange error into a user-friendly message.
 */
function parseTokenExchangeError(status: number, responseText: string): string {
  try {
    const data = JSON.parse(responseText) as Record<string, unknown>;
    const errorCode = data['error'] as string | undefined;
    const errorDescription = data['error_description'] as string | undefined;

    if (errorCode === 'token_exchange_user_error') {
      return 'Your ChatGPT account may not support API access. Check your subscription settings, or use an API key instead.';
    }

    if (errorDescription) {
      return errorDescription;
    }

    if (errorCode) {
      return `Token exchange failed: ${errorCode}`;
    }
  } catch {
    // Not JSON, fall through
  }

  return `Token exchange failed (${status}). Try using an API key instead.`;
}

/**
 * Extract chatgpt_account_id from a JWT access token.
 */
function extractAccountId(accessToken: string): string {
  try {
    const parts = accessToken.split('.');
    if (parts.length !== 3) return '';
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
    return payload?.['https://api.openai.com/auth']?.chatgpt_account_id ?? '';
  } catch {
    return '';
  }
}
