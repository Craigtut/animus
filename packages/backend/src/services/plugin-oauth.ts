/**
 * Plugin OAuth — Authorization Code Flow with PKCE
 *
 * Generic OAuth 2.0 authorization code flow for plugins. Plugins declare
 * OAuth fields in their config schema; this service handles the full flow:
 * initiate -> redirect -> callback -> token exchange -> storage.
 *
 * Sessions are held in memory with a 15-minute TTL. Token objects are stored
 * in the plugin's encrypted config blob with an `__oauth: true` sentinel.
 *
 * See docs/architecture/credential-passing.md for the credential model.
 */

import { randomBytes, createHash } from 'node:crypto';
import { getPluginManager } from '../plugins/index.js';
import { env } from '../utils/env.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('PluginOAuth', 'auth');

// ============================================================================
// Types
// ============================================================================

export interface OAuthStatusUpdate {
  status: 'pending' | 'success' | 'error';
  message?: string;
}

export interface OAuthTokenData {
  __oauth: true;
  access_token: string;
  refresh_token?: string;
  expires_at: number | null;
  scope?: string;
  token_type?: string;
}

interface OAuthSession {
  pluginName: string;
  configKey: string;
  oauthConfig: {
    provider: string;
    authorizationUrl: string;
    tokenUrl: string;
    scopes: string;
  };
  clientId: string;
  clientSecret: string;
  codeVerifier: string;
  createdAt: number;
  status: 'pending' | 'success' | 'error';
  error?: string;
  listeners: Set<(status: OAuthStatusUpdate) => void>;
}

// ============================================================================
// Constants
// ============================================================================

const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes
const CLEANUP_DELAY_MS = 60_000; // 60 seconds after terminal state

// ============================================================================
// Session Store (in-memory)
// ============================================================================

const sessions = new Map<string, OAuthSession>();

// Periodic cleanup of expired sessions
setInterval(() => {
  const now = Date.now();
  for (const [state, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(state);
      log.debug(`Cleaned up expired OAuth session for ${session.pluginName}.${session.configKey}`);
    }
  }
}, 60_000);

// ============================================================================
// PKCE Helpers
// ============================================================================

/**
 * Generate a cryptographically random code_verifier (43-128 chars, base64url).
 */
function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Compute SHA-256 code_challenge from a code_verifier (base64url encoded).
 */
function computeCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Generate a random state parameter.
 */
function generateState(): string {
  return randomBytes(24).toString('base64url');
}

// ============================================================================
// Credential Resolution Helpers
// ============================================================================

/**
 * Resolve client_id and client_secret for an OAuth field from the plugin's
 * config using the field's `dependsOn` array.
 *
 * Convention: dependsOn[0] = client_id key, dependsOn[1] = client_secret key.
 */
function resolveClientCredentials(
  pluginName: string,
  configKey: string,
): { clientId: string; clientSecret: string } {
  const pm = getPluginManager();

  // Look up the config schema field
  const schema = pm.getPluginConfigSchema(pluginName);
  if (!schema) {
    throw new Error(`Plugin "${pluginName}" has no config schema.`);
  }

  const field = schema.fields.find(f => f.key === configKey);
  if (!field) {
    throw new Error(`Config field "${configKey}" not found in plugin "${pluginName}".`);
  }

  if (field.type !== 'oauth') {
    throw new Error(`Config field "${configKey}" in plugin "${pluginName}" is not an OAuth field.`);
  }

  if (!field.oauth) {
    throw new Error(`Config field "${configKey}" in plugin "${pluginName}" is missing OAuth configuration.`);
  }

  if (!field.dependsOn || field.dependsOn.length < 2) {
    throw new Error(
      `OAuth field "${configKey}" in plugin "${pluginName}" must have a dependsOn array ` +
      `with at least 2 entries (client_id key, client_secret key).`
    );
  }

  const config = pm.getPluginConfig(pluginName);
  if (!config) {
    throw new Error(`Plugin "${pluginName}" has no configuration set. The user needs to enter Client ID and Client Secret first.`);
  }

  const clientIdKey = field.dependsOn[0]!;
  const clientSecretKey = field.dependsOn[1]!;

  const clientId = config[clientIdKey];
  const clientSecret = config[clientSecretKey];

  if (typeof clientId !== 'string' || !clientId) {
    throw new Error(`"${clientIdKey}" is not set for plugin "${pluginName}". The user needs to configure this first.`);
  }

  if (typeof clientSecret !== 'string' || !clientSecret) {
    throw new Error(`"${clientSecretKey}" is not set for plugin "${pluginName}". The user needs to configure this first.`);
  }

  return { clientId, clientSecret };
}

/**
 * Look up the OAuth config (authorizationUrl, tokenUrl, scopes) from the
 * plugin's config schema for a given OAuth field key.
 */
function getOAuthFieldConfig(
  pluginName: string,
  configKey: string,
): { provider: string; authorizationUrl: string; tokenUrl: string; scopes: string } {
  const pm = getPluginManager();
  const schema = pm.getPluginConfigSchema(pluginName);
  if (!schema) {
    throw new Error(`Plugin "${pluginName}" has no config schema.`);
  }

  const field = schema.fields.find(f => f.key === configKey);
  if (!field || field.type !== 'oauth' || !field.oauth) {
    throw new Error(`Config field "${configKey}" in plugin "${pluginName}" is not a valid OAuth field.`);
  }

  return field.oauth;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Initiate the OAuth authorization code flow for a plugin's OAuth config field.
 *
 * Reads the plugin's config schema to find the OAuth field, gets client
 * credentials from the dependsOn fields, generates PKCE parameters, and
 * builds the authorization URL.
 *
 * Returns the authorization URL for the frontend to open and a sessionId
 * (the state parameter) for tracking.
 */
export function initiateOAuthFlow(
  pluginName: string,
  configKey: string,
): { authorizationUrl: string; sessionId: string } {
  // Resolve OAuth config from schema
  const oauthConfig = getOAuthFieldConfig(pluginName, configKey);

  // Resolve client credentials from plugin config
  const { clientId, clientSecret } = resolveClientCredentials(pluginName, configKey);

  // Generate PKCE parameters
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = computeCodeChallenge(codeVerifier);
  const state = generateState();

  // Build the redirect URI
  const redirectUri = `http://localhost:${env.PORT}/api/oauth/callback`;

  // Build authorization URL
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: oauthConfig.scopes,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  const authorizationUrl = `${oauthConfig.authorizationUrl}?${params.toString()}`;

  // Store session
  const session: OAuthSession = {
    pluginName,
    configKey,
    oauthConfig,
    clientId,
    clientSecret,
    codeVerifier,
    createdAt: Date.now(),
    status: 'pending',
    listeners: new Set(),
  };

  sessions.set(state, session);
  log.info(`Initiated OAuth flow for ${pluginName}.${configKey} (provider: ${oauthConfig.provider})`);

  return { authorizationUrl, sessionId: state };
}

/**
 * Handle the OAuth callback. Looks up the session by state, exchanges the
 * authorization code for tokens, and stores the result in the plugin config.
 */
export async function handleCallback(state: string, code: string): Promise<void> {
  const session = sessions.get(state);
  if (!session) {
    throw new Error('Invalid or expired OAuth session. Please try connecting again.');
  }

  if (session.status !== 'pending') {
    throw new Error(`OAuth session is in "${session.status}" state, not "pending".`);
  }

  const redirectUri = `http://localhost:${env.PORT}/api/oauth/callback`;

  try {
    // Exchange authorization code for tokens
    const tokenResponse = await fetch(session.oauthConfig.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: session.clientId,
        client_secret: session.clientSecret,
        code,
        redirect_uri: redirectUri,
        code_verifier: session.codeVerifier,
      }),
    });

    if (!tokenResponse.ok) {
      const text = await tokenResponse.text().catch(() => '');
      throw new Error(`Token exchange failed: ${tokenResponse.status} ${text}`);
    }

    const tokenData = await tokenResponse.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      token_type?: string;
    };

    if (!tokenData.access_token) {
      throw new Error('Token response missing access_token.');
    }

    // Build the OAuth token object
    const oauthTokens: OAuthTokenData = {
      __oauth: true,
      access_token: tokenData.access_token,
      ...(tokenData.refresh_token != null ? { refresh_token: tokenData.refresh_token } : {}),
      expires_at: tokenData.expires_in
        ? Date.now() + tokenData.expires_in * 1000
        : null,
      ...(tokenData.scope != null ? { scope: tokenData.scope } : {}),
      ...(tokenData.token_type != null ? { token_type: tokenData.token_type } : {}),
    };

    // Store in plugin config under the OAuth config key
    const pm = getPluginManager();
    const existingConfig = pm.getPluginConfig(session.pluginName) ?? {};
    existingConfig[session.configKey] = oauthTokens;
    pm.setPluginConfig(session.pluginName, existingConfig);

    // Update session status
    session.status = 'success';
    notifyListeners(session, { status: 'success' });

    log.info(`OAuth flow completed for ${session.pluginName}.${session.configKey}`);

    // Clean up session after delay
    setTimeout(() => sessions.delete(state), CLEANUP_DELAY_MS);
  } catch (err) {
    session.status = 'error';
    session.error = err instanceof Error ? err.message : 'Unknown error during token exchange.';
    notifyListeners(session, { status: 'error', message: session.error });

    log.error(`OAuth callback failed for ${session.pluginName}.${session.configKey}:`, err);

    // Clean up session after delay
    setTimeout(() => sessions.delete(state), CLEANUP_DELAY_MS);

    throw err;
  }
}

/**
 * Check the current OAuth connection status for a plugin's OAuth config field.
 */
export function getOAuthStatus(
  pluginName: string,
  configKey: string,
): { connected: boolean; expiresAt: number | null } {
  const pm = getPluginManager();
  const config = pm.getPluginConfig(pluginName);

  if (!config) {
    return { connected: false, expiresAt: null };
  }

  const value = config[configKey];
  if (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>)['__oauth'] === true
  ) {
    const oauthData = value as OAuthTokenData;
    return {
      connected: true,
      expiresAt: oauthData.expires_at,
    };
  }

  return { connected: false, expiresAt: null };
}

/**
 * Refresh OAuth tokens for a plugin's OAuth config field.
 *
 * Reads the existing tokens, sends a refresh_token grant to the provider's
 * token endpoint, and updates the stored tokens.
 *
 * Returns the new access_token.
 */
export async function refreshTokens(
  pluginName: string,
  configKey: string,
): Promise<string> {
  const pm = getPluginManager();
  const config = pm.getPluginConfig(pluginName);

  if (!config) {
    throw new Error(`Plugin "${pluginName}" has no configuration.`);
  }

  const value = config[configKey];
  if (
    typeof value !== 'object' ||
    value === null ||
    !(value as Record<string, unknown>)['__oauth']
  ) {
    throw new Error(`"${configKey}" in plugin "${pluginName}" is not an OAuth token object.`);
  }

  const oauthData = value as OAuthTokenData;
  if (!oauthData.refresh_token) {
    throw new Error(`No refresh_token available for "${configKey}" in plugin "${pluginName}". The user may need to re-authenticate.`);
  }

  // Get OAuth config (tokenUrl) from schema
  const oauthConfig = getOAuthFieldConfig(pluginName, configKey);

  // Get client credentials
  const { clientId, clientSecret } = resolveClientCredentials(pluginName, configKey);

  log.info(`Refreshing OAuth tokens for ${pluginName}.${configKey}`);

  const tokenResponse = await fetch(oauthConfig.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: oauthData.refresh_token,
    }),
  });

  if (!tokenResponse.ok) {
    const text = await tokenResponse.text().catch(() => '');
    throw new Error(`Token refresh failed: ${tokenResponse.status} ${text}`);
  }

  const refreshed = await tokenResponse.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
  };

  if (!refreshed.access_token) {
    throw new Error('Refresh response missing access_token.');
  }

  // Update the token object (preserve existing refresh_token if not rotated)
  const resolvedScope = refreshed.scope ?? oauthData.scope;
  const resolvedTokenType = refreshed.token_type ?? oauthData.token_type;
  const updatedTokens: OAuthTokenData = {
    __oauth: true,
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token ?? oauthData.refresh_token,
    expires_at: refreshed.expires_in
      ? Date.now() + refreshed.expires_in * 1000
      : null,
    ...(resolvedScope != null ? { scope: resolvedScope } : {}),
    ...(resolvedTokenType != null ? { token_type: resolvedTokenType } : {}),
  };

  // Re-read config to avoid stale data races, then update
  const freshConfig = pm.getPluginConfig(pluginName) ?? {};
  freshConfig[configKey] = updatedTokens;
  pm.setPluginConfig(pluginName, freshConfig);

  log.info(`OAuth tokens refreshed for ${pluginName}.${configKey}`);

  return refreshed.access_token;
}

/**
 * Disconnect OAuth (clear tokens) for a plugin's OAuth config field.
 */
export function disconnect(pluginName: string, configKey: string): void {
  const pm = getPluginManager();
  const config = pm.getPluginConfig(pluginName);

  if (!config) {
    log.warn(`Cannot disconnect OAuth: plugin "${pluginName}" has no configuration.`);
    return;
  }

  config[configKey] = null;
  pm.setPluginConfig(pluginName, config);

  log.info(`Disconnected OAuth for ${pluginName}.${configKey}`);
}

/**
 * Subscribe to status updates for an active OAuth session.
 * Returns an unsubscribe function.
 */
export function subscribeToStatus(
  sessionId: string,
  callback: (status: OAuthStatusUpdate) => void,
): () => void {
  const session = sessions.get(sessionId);
  if (!session) {
    callback({ status: 'error', message: 'Session not found' });
    return () => {};
  }

  session.listeners.add(callback);

  // Send current status immediately
  const initial: OAuthStatusUpdate = { status: session.status };
  if (session.error) initial.message = session.error;
  callback(initial);

  return () => {
    session.listeners.delete(callback);
  };
}

/**
 * Cancel an active OAuth flow.
 */
export function cancelFlow(sessionId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session || session.status !== 'pending') return false;

  session.status = 'error';
  session.error = 'Flow cancelled by user.';
  notifyListeners(session, { status: 'error', message: session.error });

  // Cleanup after delay
  setTimeout(() => sessions.delete(sessionId), CLEANUP_DELAY_MS);
  return true;
}

// ============================================================================
// Internal
// ============================================================================

function notifyListeners(session: OAuthSession, update: OAuthStatusUpdate): void {
  for (const listener of session.listeners) {
    try {
      listener(update);
    } catch (err) {
      log.error('OAuth status listener error:', err);
    }
  }
}
