/**
 * Provider Router — tRPC procedures for agent provider credential management.
 *
 * Handles multi-method authentication: API keys, OAuth tokens, CLI detection.
 * Uses the EncryptionService for encrypted storage in the credentials table.
 */

import { z } from 'zod';
import { router, protectedProcedure } from '../trpc.js';
import { getSystemDb } from '../../db/index.js';
import * as systemStore from '../../db/stores/system-store.js';
import {
  detectProviderAuth,
  validateCredential,
  saveCredential,
  saveCliDetected,
  removeCredential,
  inferCredentialType,
} from '../../services/credential-service.js';
import { getModelRegistry, type ModelEntry } from '@animus-labs/agents';

const providerSchema = z.enum(['claude', 'codex']);

export const providerRouter = router({
  /**
   * Detect available authentication methods for all providers.
   * Returns CLI detection, env vars, DB credentials, filesystem checks.
   */
  detect: protectedProcedure.query(async () => {
    return detectProviderAuth(getSystemDb());
  }),

  /**
   * Validate a credential against the provider's API.
   * Auto-detects credential type from prefix. Makes a real API call.
   */
  validateKey: protectedProcedure
    .input(
      z.object({
        provider: providerSchema,
        key: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      const credentialType = inferCredentialType(input.provider, input.key);
      const result = await validateCredential(input.provider, input.key, credentialType);
      return { ...result, credentialType };
    }),

  /**
   * Save an encrypted credential for a provider.
   * Encrypts via EncryptionService, stores in credentials table, updates process.env.
   */
  saveKey: protectedProcedure
    .input(
      z.object({
        provider: providerSchema,
        key: z.string().min(1),
        credentialType: z.enum(['api_key', 'oauth_token']).optional(),
      })
    )
    .mutation(({ input }) => {
      const result = saveCredential(
        getSystemDb(),
        input.provider,
        input.key,
        input.credentialType
      );
      return { success: true, provider: input.provider, credentialType: result.credentialType };
    }),

  /**
   * Mark a provider as using CLI authentication.
   * Saves a cli_detected sentinel in the credentials table.
   */
  useCli: protectedProcedure
    .input(z.object({ provider: providerSchema }))
    .mutation(({ input }) => {
      saveCliDetected(getSystemDb(), input.provider);
      return { success: true };
    }),

  /**
   * Check if a provider has configured credentials.
   * Checks the credentials table and returns type info.
   */
  hasKey: protectedProcedure
    .input(z.object({ provider: providerSchema }))
    .query(({ input }) => {
      const db = getSystemDb();
      const metas = systemStore.getCredentialMetadata(db, input.provider);
      const activeCred = metas.find((m) => m.credentialType !== 'cli_detected');
      const cliDetected = metas.some((m) => m.credentialType === 'cli_detected');

      if (activeCred) {
        return {
          hasKey: true,
          credentialType: activeCred.credentialType,
          provider: input.provider,
        };
      }

      if (cliDetected) {
        return {
          hasKey: true,
          credentialType: 'cli_detected',
          provider: input.provider,
        };
      }

      return {
        hasKey: false,
        credentialType: null,
        provider: input.provider,
      };
    }),

  /**
   * Remove credentials for a provider and clear env vars.
   */
  removeKey: protectedProcedure
    .input(z.object({ provider: providerSchema }))
    .mutation(({ input }) => {
      removeCredential(getSystemDb(), input.provider);
      return { success: true };
    }),

  /**
   * List available models for a provider (or all providers).
   * Uses dynamic discovery when a provider is specified and discovery
   * functions are registered (after heartbeat init). Falls back to
   * static models.json data otherwise.
   */
  listModels: protectedProcedure
    .input(z.object({ provider: z.enum(['claude', 'codex', 'opencode']).optional() }))
    .query(async ({ input }) => {
      const registry = getModelRegistry();
      const models = input.provider
        ? await registry.discoverModels(input.provider)
        : registry.listModels();
      return models.map((m: ModelEntry) => ({
        id: m.id,
        name: m.name,
        provider: m.provider,
        contextWindow: m.contextWindow,
        maxOutputTokens: m.maxOutputTokens,
        inputPricePer1M: m.inputCostPerToken * 1_000_000,
        outputPricePer1M: m.outputCostPerToken * 1_000_000,
        supportsVision: m.supportsVision,
        supportsThinking: m.supportsThinking,
        recommended: m.recommended ?? false,
        isDefault: m.isDefault ?? false,
        createdAt: m.createdAt ?? null,
      }));
    }),
});
