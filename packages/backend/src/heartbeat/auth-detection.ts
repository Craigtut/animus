/**
 * Provider auth detection for the mind.
 *
 * The mind's getApiKey callback is the single point where credentials are
 * resolved (and OAuth tokens refreshed) before every LLM call, which makes it
 * the most reliable place to detect that re-authentication is needed: more
 * reliable than inferring it from how a downstream provider error happens to
 * classify. These helpers surface that state to the UI and emit a recovery
 * signal once credentials resolve again, so the persistent re-auth banner can
 * self-clear.
 */

import { getEventBus } from '../lib/event-bus.js';
import { isConfigured as isVaultUnsealed } from '../lib/encryption-service.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('CortexMind', 'heartbeat');

/** Minimal mind state this module reads/writes. Satisfied by CortexMindState. */
export interface AuthDetectionState {
  /**
   * True once a provider auth failure has been surfaced to the UI (re-auth
   * needed). Used to emit a single `cortex:auth-recovered` when credentials
   * resolve again.
   */
  authErrorActive: boolean;
}

/**
 * Surface a provider auth failure (re-authentication needed) to the UI.
 *
 * Marks the mind state so a later successful credential resolution can emit a
 * recovery signal, then emits the `system:error` (authentication) and
 * `cortex:auth-failed` events the frontend listens to. Safe to call repeatedly
 * within a tick: the frontend dedupes system errors by category within a short
 * window, so the persistent re-auth banner shows once.
 */
export function surfaceAuthFailure(
  state: AuthDetectionState,
  provider: string | undefined,
  message: string,
): void {
  state.authErrorActive = true;
  getEventBus().emit('system:error', {
    category: 'authentication',
    message,
    ...(provider ? { provider } : {}),
    recoverable: false,
    suggestedAction: 'Reconnect your AI provider in Settings.',
  });
  getEventBus().emit('cortex:auth-failed', {
    ...(provider ? { provider } : {}),
    message,
  });
}

/**
 * Resolve an API key while detecting provider auth state for the UI.
 *
 * - On success after a prior failure: clears the flag and emits
 *   `cortex:auth-recovered` so the persistent re-auth banner self-clears. This
 *   covers every recovery path (token refreshed, user reconnected, switched
 *   provider, set a new key) because all of them make the next resolution succeed.
 * - On failure: surfaces a re-auth-needed signal, but only when the failure is
 *   genuinely unrecoverable without user action. A sealed vault is skipped (its
 *   remediation is unlock, not re-auth), and a provider with an env-var key is
 *   skipped (Cortex falls back to it, so the call can still succeed).
 */
export async function resolveApiKeyWithAuthDetection(
  state: AuthDetectionState,
  providerName: string,
  resolveApiKey: (provider: string) => Promise<string>,
  hasEnvApiKey: (provider: string) => boolean,
): Promise<string> {
  try {
    const key = await resolveApiKey(providerName);
    if (state.authErrorActive) {
      state.authErrorActive = false;
      getEventBus().emit('cortex:auth-recovered', { provider: providerName });
      log.info(`Provider auth recovered for "${providerName}"`);
    }
    return key;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isVaultUnsealed() && !hasEnvApiKey(providerName)) {
      surfaceAuthFailure(state, providerName, message);
    }
    throw err;
  }
}
