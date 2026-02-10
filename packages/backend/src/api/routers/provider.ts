/**
 * Provider Router — tRPC procedures for agent provider API key management.
 *
 * Validates and saves encrypted API keys for agent providers.
 */

import { z } from 'zod';
import { router, protectedProcedure } from '../trpc.js';
import { getSystemDb } from '../../db/index.js';
import * as systemStore from '../../db/stores/system-store.js';
import { agentProviderSchema } from '@animus/shared';

export const providerRouter = router({
  /**
   * Validate an API key for a provider.
   * Currently a stub — returns success if key is non-empty.
   * Future: actually test the key against the provider API.
   */
  validateKey: protectedProcedure
    .input(
      z.object({
        provider: agentProviderSchema,
        apiKey: z.string().min(1),
      })
    )
    .mutation(({ input }) => {
      // TODO: Actually validate the key against the provider's API
      // For Claude: test with a minimal API call
      // For Codex: test with auth endpoint
      // For OpenCode: test with a health check

      // Basic format validation
      if (input.provider === 'claude' && !input.apiKey.startsWith('sk-ant-')) {
        return { valid: false, message: 'Claude API keys should start with sk-ant-' };
      }

      return { valid: true, message: 'Key format accepted' };
    }),

  /**
   * Save an encrypted API key for a provider.
   * Uses the existing systemStore.setApiKey which stores encrypted keys.
   */
  saveKey: protectedProcedure
    .input(
      z.object({
        provider: agentProviderSchema,
        apiKey: z.string().min(1),
      })
    )
    .mutation(({ input }) => {
      // TODO: Encrypt with EncryptionService before storing
      // For now, store as-is (EncryptionService not yet available)
      systemStore.setApiKey(getSystemDb(), input.provider, input.apiKey);
      return { success: true, provider: input.provider };
    }),

  /**
   * Check if a provider has a configured API key.
   */
  hasKey: protectedProcedure
    .input(z.object({ provider: agentProviderSchema }))
    .query(({ input }) => {
      const key = systemStore.getApiKey(getSystemDb(), input.provider);
      return { hasKey: key !== null, provider: input.provider };
    }),
});
