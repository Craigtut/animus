/**
 * Cortex Provider Router -- tRPC procedures for Cortex provider management.
 *
 * Handles provider discovery, OAuth flows, API key management, custom
 * endpoints, and provider/model selection. Delegates to CortexCredentialService
 * for credential operations.
 *
 * OAuth flow uses an EventEmitter bridge pattern (same as claude-auth.ts):
 * - initiateOAuth starts the flow and coordinates via EventEmitter
 * - oauthStatus subscription pushes progress events to the frontend
 * - oauthRespond resolves pending prompts from the OAuth flow
 *
 * See docs/cortex/backend-auth-integration.md
 */

import { z } from 'zod/v3';
import { EventEmitter } from 'events';
import { exec } from 'node:child_process';
import { TRPCError } from '@trpc/server';
import { observable } from '@trpc/server/observable';
import { router, protectedProcedure } from '../trpc.js';
import { getSystemDb } from '../../db/index.js';
import * as settingsStore from '../../db/stores/settings-store.js';
import {
  getCortexCredentialService,
  isHeadless,
  type OAuthStatusEvent,
} from '../../services/cortex-credential-service.js';
import { getEventBus } from '../../lib/event-bus.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('CortexProvider', 'server');

/**
 * Open a URL in the system browser. Uses platform-native commands
 * since the `open` npm package is not a dependency.
 */
function openUrl(url: string): void {
  const cmd = process.platform === 'darwin' ? `open "${url}"`
            : process.platform === 'win32' ? `start "" "${url}"`
            : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) log.warn('Could not open browser automatically:', err.message);
  });
}

// ============================================================================
// OAuth Coordination (EventEmitter bridge)
// ============================================================================

/**
 * Per-flow EventEmitter for bridging async OAuth callbacks to the tRPC
 * subscription. The initiateOAuth mutation emits events here; the
 * oauthStatus subscription listens and pushes to the client.
 */
const oauthEmitter = new EventEmitter();
oauthEmitter.setMaxListeners(10);

/** Pending prompt resolver for oauthRespond. */
let pendingPromptResolve: ((response: string) => void) | null = null;

/** Whether an OAuth flow is currently active. */
let activeOAuthProvider: string | null = null;

// ============================================================================
// Router
// ============================================================================

export const cortexProviderRouter = router({
  // ── Discovery ──

  listProviders: protectedProcedure.query(() => {
    return getCortexCredentialService().listProviders();
  }),

  listModels: protectedProcedure
    .input(z.object({ provider: z.string() }))
    .query(async ({ input }) => {
      return getCortexCredentialService().listModels(input.provider);
    }),

  // ── Status ──

  getStatus: protectedProcedure.query(() => {
    const db = getSystemDb();
    const settings = settingsStore.getCortexSettings(db);
    const svc = getCortexCredentialService();

    const status = settings.cortexProvider
      ? svc.getProviderStatus(settings.cortexProvider)
      : { connected: false, method: null, meta: null };

    return {
      provider: settings.cortexProvider,
      model: settings.cortexModel,
      thinkingLevel: settings.cortexThinkingLevel,
      contextWindowLimit: settings.cortexContextWindowLimit,
      ...status,
    };
  }),

  listConfiguredProviders: protectedProcedure.query(() => {
    const svc = getCortexCredentialService();
    const providers = svc.listProviders();

    return providers.map((p) => ({
      ...p,
      status: svc.getProviderStatus(p.id),
    }));
  }),

  // ── OAuth ──

  initiateOAuth: protectedProcedure
    .input(z.object({ provider: z.string() }))
    .mutation(async ({ input }) => {
      const svc = getCortexCredentialService();
      const headless = isHeadless();

      if (activeOAuthProvider) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `An OAuth flow is already in progress for "${activeOAuthProvider}". Cancel it first.`,
        });
      }

      activeOAuthProvider = input.provider;
      log.info(`Starting OAuth flow for provider "${input.provider}" (headless=${headless})`);

      try {
        const result = await svc.initiateOAuth(input.provider, {
          onAuth: (info: { url: string; instructions?: string } | string, legacyInstructions?: string) => {
            // Pi-ai passes { url, instructions } object; handle both shapes for safety
            const authUrl = typeof info === 'string' ? info : info.url;
            const authInstructions = typeof info === 'string' ? legacyInstructions : info.instructions;
            log.info(`OAuth auth URL received for "${input.provider}"`);

            // In non-headless environments, try to open browser
            if (!headless) {
              openUrl(authUrl);
            }

            const event: OAuthStatusEvent = {
              type: 'auth_url',
              url: authUrl,
              ...(authInstructions !== undefined ? { instructions: authInstructions } : {}),
            };
            oauthEmitter.emit('status', event);
          },

          onPrompt: (prompt: { message: string }) => {
            log.info(`OAuth prompt received for "${input.provider}": ${prompt.message}`);
            const event: OAuthStatusEvent = {
              type: 'prompt',
              message: prompt.message,
            };
            oauthEmitter.emit('status', event);

            // Wait for oauthRespond to resolve this
            return new Promise<string>((resolve) => {
              pendingPromptResolve = resolve;
            });
          },

          onProgress: (message: string) => {
            const event: OAuthStatusEvent = {
              type: 'progress',
              message,
            };
            oauthEmitter.emit('status', event);
          },
        });

        // Success: emit to subscription and update settings
        const successEvent: OAuthStatusEvent = {
          type: 'success',
          meta: result.meta,
        };
        oauthEmitter.emit('status', successEvent);

        // Auto-select as active provider with a curated default model
        const db = getSystemDb();
        const { PRIMARY_MODEL_DEFAULTS } = await import('@animus-labs/cortex');
        const curatedDefault = PRIMARY_MODEL_DEFAULTS[input.provider];
        const models = await svc.listModels(input.provider);
        // Use curated default if available and exists in the model list, otherwise first model
        const defaultModel = curatedDefault && models.some(m => m.id === curatedDefault)
          ? curatedDefault
          : models[0]?.id ?? null;

        settingsStore.updateCortexSettings(db, {
          cortexProvider: input.provider,
          cortexModel: defaultModel,
          cortexThinkingLevel: 'medium',
        });

        if (defaultModel) {
          getEventBus().emit('cortex:provider-changed', {
            provider: input.provider,
            model: defaultModel,
          });
        }

        log.info(`OAuth flow completed for "${input.provider}"`);
        return { success: true, provider: input.provider, model: defaultModel };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'OAuth flow failed';
        log.error(`OAuth flow failed for "${input.provider}":`, err);

        const errorEvent: OAuthStatusEvent = {
          type: 'error',
          message,
        };
        oauthEmitter.emit('status', errorEvent);

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message,
        });
      } finally {
        activeOAuthProvider = null;
        pendingPromptResolve = null;
      }
    }),

  oauthStatus: protectedProcedure.subscription(() => {
    return observable<OAuthStatusEvent>((emit) => {
      const handler = (event: OAuthStatusEvent) => {
        emit.next(event);

        if (event.type === 'success' || event.type === 'error') {
          // Give the client time to process, then complete
          setTimeout(() => {
            try { emit.complete(); } catch { /* already closed */ }
          }, 200);
        }
      };

      oauthEmitter.on('status', handler);

      return () => {
        oauthEmitter.off('status', handler);
      };
    });
  }),

  oauthRespond: protectedProcedure
    .input(z.object({ response: z.string() }))
    .mutation(({ input }) => {
      if (!pendingPromptResolve) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No pending OAuth prompt to respond to.',
        });
      }
      pendingPromptResolve(input.response);
      pendingPromptResolve = null;
      return { success: true };
    }),

  cancelOAuth: protectedProcedure.mutation(() => {
    getCortexCredentialService().cancelOAuth();
    activeOAuthProvider = null;
    pendingPromptResolve = null;

    const event: OAuthStatusEvent = {
      type: 'error',
      message: 'OAuth flow cancelled by user.',
    };
    oauthEmitter.emit('status', event);

    return { success: true };
  }),

  // ── API Key ──

  saveApiKey: protectedProcedure
    .input(z.object({
      provider: z.string(),
      apiKey: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      const svc = getCortexCredentialService();
      svc.saveApiKey(input.provider, input.apiKey);

      // Auto-select as active provider with a curated default model
      const db = getSystemDb();
      const { PRIMARY_MODEL_DEFAULTS } = await import('@animus-labs/cortex');
      const curatedDefault = PRIMARY_MODEL_DEFAULTS[input.provider];
      const models = await svc.listModels(input.provider);
      const defaultModel = curatedDefault && models.some(m => m.id === curatedDefault)
        ? curatedDefault
        : models[0]?.id ?? null;

      settingsStore.updateCortexSettings(db, {
        cortexProvider: input.provider,
        cortexModel: defaultModel,
        cortexThinkingLevel: 'medium',
      });

      if (defaultModel) {
        getEventBus().emit('cortex:provider-changed', {
          provider: input.provider,
          model: defaultModel,
        });
      }

      log.info(`API key saved for provider "${input.provider}"`);
      return { success: true, provider: input.provider, model: defaultModel };
    }),

  validateApiKey: protectedProcedure
    .input(z.object({
      provider: z.string(),
      apiKey: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      const valid = await getCortexCredentialService().validateApiKey(
        input.provider, input.apiKey
      );
      return { valid };
    }),

  // ── Custom Endpoint ──

  saveCustomEndpoint: protectedProcedure
    .input(z.object({
      baseUrl: z.string().url(),
      modelId: z.string().min(1),
      contextWindow: z.number().int().positive().optional(),
      apiKey: z.string().optional(),
      compat: z.object({
        supportsDeveloperRole: z.boolean().optional(),
        supportsReasoningEffort: z.boolean().optional(),
      }).optional(),
    }))
    .mutation(async ({ input }) => {
      const svc = getCortexCredentialService();
      svc.saveCustomEndpoint(input);

      // Set as active provider
      const db = getSystemDb();
      settingsStore.updateCortexSettings(db, {
        cortexProvider: 'custom',
        cortexModel: input.modelId,
      });

      getEventBus().emit('cortex:provider-changed', {
        provider: 'custom',
        model: input.modelId,
      });

      log.info(`Custom endpoint saved: ${input.baseUrl}`);
      return { success: true };
    }),

  testCustomEndpoint: protectedProcedure
    .input(z.object({
      baseUrl: z.string().url(),
      modelId: z.string().min(1),
      contextWindow: z.number().int().positive().optional(),
      apiKey: z.string().optional(),
      compat: z.object({
        supportsDeveloperRole: z.boolean().optional(),
        supportsReasoningEffort: z.boolean().optional(),
      }).optional(),
    }))
    .mutation(async ({ input }) => {
      const svc = getCortexCredentialService();
      const valid = await svc.testCustomModel(input);
      return { valid };
    }),

  // ── Provider/Model Selection ──

  setActiveProvider: protectedProcedure
    .input(z.object({
      provider: z.string(),
      model: z.string(),
    }))
    .mutation(({ input }) => {
      const svc = getCortexCredentialService();

      // Verify credentials exist for this provider
      const status = svc.getProviderStatus(input.provider);
      if (!status.connected) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `No credentials configured for ${input.provider}`,
        });
      }

      // Update settings
      const db = getSystemDb();
      settingsStore.updateCortexSettings(db, {
        cortexProvider: input.provider,
        cortexModel: input.model,
      });

      // Notify agent subsystem to switch model
      getEventBus().emit('cortex:provider-changed', {
        provider: input.provider,
        model: input.model,
      });

      log.info(`Active provider set: ${input.provider}/${input.model}`);
      return { success: true };
    }),

  setThinkingLevel: protectedProcedure
    .input(z.object({
      level: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']),
    }))
    .mutation(({ input }) => {
      const db = getSystemDb();
      settingsStore.updateCortexSettings(db, {
        cortexThinkingLevel: input.level,
      });

      getEventBus().emit('cortex:thinking-level-changed', {
        level: input.level,
      });

      log.info(`Thinking level set to "${input.level}"`);
      return { success: true };
    }),

  setContextWindowLimit: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(16_384).nullable(),
    }))
    .mutation(({ input }) => {
      const db = getSystemDb();
      settingsStore.updateCortexSettings(db, {
        cortexContextWindowLimit: input.limit,
      });

      getEventBus().emit('cortex:context-limit-changed', {
        limit: input.limit,
      });

      log.info(`Context window limit set to ${input.limit === null ? 'unlimited' : input.limit}`);
      return { success: true };
    }),

  // ── Credential Management ──

  removeCredential: protectedProcedure
    .input(z.object({ provider: z.string() }))
    .mutation(({ input }) => {
      getCortexCredentialService().removeCredential(input.provider);

      // If removing the active provider, clear settings
      const db = getSystemDb();
      const settings = settingsStore.getCortexSettings(db);
      if (settings.cortexProvider === input.provider) {
        settingsStore.updateCortexSettings(db, {
          cortexProvider: null,
          cortexModel: null,
        });
        getEventBus().emit('cortex:provider-removed', {});
      }

      log.info(`Credentials removed for provider "${input.provider}"`);
      return { success: true };
    }),
});
