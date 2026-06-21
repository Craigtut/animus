import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AnimusEventMap } from '@animus-labs/shared';

// Control the vault sealed/unsealed state per test.
const hoisted = vi.hoisted(() => ({ vaultUnsealed: true }));
vi.mock('../../lib/encryption-service.js', () => ({
  isConfigured: () => hoisted.vaultUnsealed,
}));

import { getEventBus } from '../../lib/event-bus.js';
import {
  resolveApiKeyWithAuthDetection,
  surfaceAuthFailure,
} from '../auth-detection.js';

/** Capture every payload emitted for a given event until stop() is called. */
function collect<K extends keyof AnimusEventMap>(event: K) {
  const items: AnimusEventMap[K][] = [];
  const handler = (p: AnimusEventMap[K]) => items.push(p);
  getEventBus().on(event, handler);
  return { items, stop: () => getEventBus().off(event, handler) };
}

describe('auth-detection', () => {
  beforeEach(() => {
    hoisted.vaultUnsealed = true;
  });

  describe('resolveApiKeyWithAuthDetection', () => {
    it('returns the key and emits nothing on a clean success', async () => {
      const state = { authErrorActive: false };
      const recovered = collect('cortex:auth-recovered');

      const key = await resolveApiKeyWithAuthDetection(
        state,
        'anthropic',
        async () => 'sk-123',
        () => false,
      );

      expect(key).toBe('sk-123');
      expect(state.authErrorActive).toBe(false);
      expect(recovered.items).toHaveLength(0);
      recovered.stop();
    });

    it('emits cortex:auth-recovered and clears the flag on success after a prior failure', async () => {
      const state = { authErrorActive: true };
      const recovered = collect('cortex:auth-recovered');

      const key = await resolveApiKeyWithAuthDetection(
        state,
        'anthropic',
        async () => 'sk-123',
        () => false,
      );

      expect(key).toBe('sk-123');
      expect(state.authErrorActive).toBe(false);
      expect(recovered.items).toEqual([{ provider: 'anthropic' }]);
      recovered.stop();
    });

    it('surfaces a re-auth signal and rethrows when resolution fails (vault unsealed, no env key)', async () => {
      const state = { authErrorActive: false };
      const sysErr = collect('system:error');
      const authFailed = collect('cortex:auth-failed');

      await expect(
        resolveApiKeyWithAuthDetection(
          state,
          'anthropic',
          async () => {
            throw new Error('OAuth token refresh failed for provider anthropic');
          },
          () => false,
        ),
      ).rejects.toThrow(/OAuth token refresh failed/);

      expect(state.authErrorActive).toBe(true);
      expect(sysErr.items).toHaveLength(1);
      expect(sysErr.items[0]).toMatchObject({
        category: 'authentication',
        provider: 'anthropic',
        recoverable: false,
      });
      expect(authFailed.items).toHaveLength(1);
      expect(authFailed.items[0]).toMatchObject({ provider: 'anthropic' });
      sysErr.stop();
      authFailed.stop();
    });

    it('does not surface re-auth when the vault is sealed (unlock is the remedy, not re-auth)', async () => {
      hoisted.vaultUnsealed = false;
      const state = { authErrorActive: false };
      const sysErr = collect('system:error');

      await expect(
        resolveApiKeyWithAuthDetection(
          state,
          'anthropic',
          async () => {
            throw new Error('Vault is sealed. Cannot perform "resolveApiKey".');
          },
          () => false,
        ),
      ).rejects.toThrow(/Vault is sealed/);

      expect(state.authErrorActive).toBe(false);
      expect(sysErr.items).toHaveLength(0);
      sysErr.stop();
    });

    it('does not surface re-auth when an env-var key is available (Cortex falls back to it)', async () => {
      const state = { authErrorActive: false };
      const sysErr = collect('system:error');

      await expect(
        resolveApiKeyWithAuthDetection(
          state,
          'anthropic',
          async () => {
            throw new Error('OAuth token refresh failed for provider anthropic');
          },
          () => true,
        ),
      ).rejects.toThrow();

      expect(state.authErrorActive).toBe(false);
      expect(sysErr.items).toHaveLength(0);
      sysErr.stop();
    });
  });

  describe('surfaceAuthFailure', () => {
    it('sets the flag and emits system:error + cortex:auth-failed with the provider', () => {
      const state = { authErrorActive: false };
      const sysErr = collect('system:error');
      const authFailed = collect('cortex:auth-failed');

      surfaceAuthFailure(state, 'openai-codex', 'boom');

      expect(state.authErrorActive).toBe(true);
      expect(sysErr.items[0]).toMatchObject({
        category: 'authentication',
        provider: 'openai-codex',
        message: 'boom',
        recoverable: false,
      });
      expect(sysErr.items[0]?.suggestedAction).toBeTruthy();
      expect(authFailed.items[0]).toMatchObject({ provider: 'openai-codex', message: 'boom' });
      sysErr.stop();
      authFailed.stop();
    });
  });
});
