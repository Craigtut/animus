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
import {
  createOAuthAuthUrlEvent,
  createOAuthPromptEvent,
  normalizeOAuthAuthInfo,
  type OAuthAuthInfoLike,
  type OAuthPromptInfoLike,
} from '../../services/oauth-flow-events.js';
import { getEventBus } from '../../lib/event-bus.js';
import { createLogger } from '../../lib/logger.js';
import { renderOAuthCallbackPage } from '../../lib/oauth-callback-page.js';
import { inferUtilityModelId, OAuthError } from '@animus-labs/cortex';
import type { OAuthCallbackPageContext } from '@animus-labs/cortex';

const log = createLogger('CortexProvider', 'server');

/**
 * Render the Animus-branded OAuth callback page for a model provider.
 * Wired into Cortex's `renderCallbackPage` hook so the localhost callback
 * page a user lands on after signing in matches the rest of Animus.
 */
function renderProviderCallbackPage(ctx: OAuthCallbackPageContext): string {
  const providerName = ctx.providerName?.trim()
    || (ctx.provider ? ctx.provider.charAt(0).toUpperCase() + ctx.provider.slice(1) : undefined);
  return renderOAuthCallbackPage({
    status: ctx.status,
    providerName,
    ...(ctx.status === 'error' && ctx.details ? { details: ctx.details } : {}),
  });
}

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

/** Last event for the active OAuth flow, replayed to late subscribers. */
let latestOAuthAuthUrlEvent: Extract<OAuthStatusEvent, { type: 'auth_url' }> | null = null;
let latestOAuthStatusEvent: OAuthStatusEvent | null = null;

function emitOAuthStatus(event: OAuthStatusEvent): void {
  if (event.type === 'auth_url') {
    latestOAuthAuthUrlEvent = event;
  }

  latestOAuthStatusEvent = event;
  oauthEmitter.emit('status', event);
}

function requestOAuthInput(prompt: OAuthPromptInfoLike): Promise<string> {
  emitOAuthStatus(createOAuthPromptEvent(prompt));

  return new Promise<string>((resolve) => {
    pendingPromptResolve = resolve;
  });
}

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

  /**
   * The utility model Cortex recommends for a provider, inferred
   * programmatically from the provider's current model catalog
   * (Cortex 0.2.3 `inferUtilityModelId`). Used by the settings UI to
   * label the "Recommended" option with the model that actually resolves.
   */
  getRecommendedUtilityModel: protectedProcedure
    .input(z.object({ provider: z.string() }))
    .query(async ({ input }) => {
      const models = await getCortexCredentialService().listModels(input.provider);
      const modelId = inferUtilityModelId(models as unknown as Record<string, unknown>[]);
      const match = modelId ? models.find((m) => m.id === modelId) : undefined;
      return {
        modelId,
        modelName: match?.name ?? modelId,
      };
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
      headless: isHeadless(),
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
      latestOAuthAuthUrlEvent = null;
      latestOAuthStatusEvent = {
        type: 'progress',
        message: 'Starting sign-in...',
      };
      log.info(`Starting OAuth flow for provider "${input.provider}" (headless=${headless})`);

      try {
        let lastAuthEvent: Extract<OAuthStatusEvent, { type: 'auth_url' }> | null = null;

        const result = await svc.initiateOAuth(input.provider, {
          onAuth: (info: OAuthAuthInfoLike) => {
            // Cortex normalizes pi-ai provider callbacks before they reach Animus.
            const authInfo = normalizeOAuthAuthInfo(input.provider, info);
            const authUrl = authInfo.url;
            log.info(`OAuth auth URL received for "${input.provider}"`);

            // In non-headless environments, try to open browser
            if (!headless) {
              openUrl(authUrl);
            }

            const event = createOAuthAuthUrlEvent(authInfo);
            lastAuthEvent = event;
            emitOAuthStatus(event);
          },

          onPrompt: (prompt: OAuthPromptInfoLike) => {
            log.info(`OAuth prompt received for "${input.provider}": ${prompt.message}`);
            return requestOAuthInput(prompt);
          },

          onProgress: (message: string) => {
            const event: OAuthStatusEvent = {
              type: 'progress',
              message,
            };
            emitOAuthStatus(event);
          },

          ...(headless ? {
            onManualCodeInput: () => {
              const placeholder = lastAuthEvent?.callbackPort && lastAuthEvent?.callbackPath
                ? `http://localhost:${lastAuthEvent.callbackPort}${lastAuthEvent.callbackPath}?code=...`
                : undefined;
              return requestOAuthInput({
                message: 'Paste the final redirect URL or authorization code:',
                ...(placeholder ? { placeholder } : {}),
                allowEmpty: false,
              });
            },
          } : {}),

          renderCallbackPage: renderProviderCallbackPage,
        });

        // Success: emit to subscription and update settings
        const successEvent: OAuthStatusEvent = {
          type: 'success',
          meta: result.meta,
        };
        emitOAuthStatus(successEvent);

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
          cortexThinkingLevel: 'high',
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
        // Cortex (>=0.2.4) performs the callback-port preflight, timeout,
        // cancellation, and callback-failure detection and surfaces them as
        // typed OAuthError. Map each to an actionable message + tRPC code.
        let code: 'INTERNAL_SERVER_ERROR' | 'CONFLICT' | 'BAD_REQUEST' | 'TIMEOUT' =
          'INTERNAL_SERVER_ERROR';
        let message = err instanceof Error ? err.message : 'OAuth flow failed';

        if (err instanceof OAuthError) {
          switch (err.code) {
            case 'callback_port_in_use':
              code = 'CONFLICT';
              message = input.provider === 'anthropic'
                ? `The Anthropic sign-in port (${err.port}) is in use by another app — commonly Claude Desktop or Claude Code — or a previous sign-in is stuck. Quit those apps (or restart Animus), then try again.`
                : `The sign-in port (${err.port}) is in use by another application. Close it and try again.`;
              break;
            case 'cancelled':
              code = 'BAD_REQUEST';
              message = 'Sign-in was cancelled.';
              break;
            case 'timed_out':
              code = 'TIMEOUT';
              message = 'Sign-in timed out — the browser callback never completed. Please try again.';
              break;
            case 'callback_failed':
              code = 'BAD_REQUEST';
              message = `Sign-in failed: ${err.message.replace(/^OAuth callback for "[^"]+" reported a failure:\s*/, '')}`;
              break;
            case 'unsupported_provider':
              code = 'BAD_REQUEST';
              message = `Provider "${input.provider}" does not support OAuth sign-in.`;
              break;
          }
        }

        log.error(`OAuth flow failed for "${input.provider}" (${message})`, err);

        const errorEvent: OAuthStatusEvent = {
          type: 'error',
          message,
        };
        emitOAuthStatus(errorEvent);

        throw new TRPCError({ code, message });
      } finally {
        activeOAuthProvider = null;
        pendingPromptResolve = null;
        latestOAuthAuthUrlEvent = null;
        latestOAuthStatusEvent = null;
      }
    }),

  oauthStatus: protectedProcedure.subscription(() => {
    return observable<OAuthStatusEvent>((emit) => {
      if (activeOAuthProvider && latestOAuthStatusEvent) {
        const replayAuthUrlEvent = latestOAuthAuthUrlEvent;
        const replayEvent = latestOAuthStatusEvent;
        queueMicrotask(() => {
          if (replayAuthUrlEvent && replayAuthUrlEvent !== replayEvent) {
            emit.next(replayAuthUrlEvent);
          }
          emit.next(replayEvent);
        });
      }

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
    latestOAuthAuthUrlEvent = null;
    latestOAuthStatusEvent = null;

    const event: OAuthStatusEvent = {
      type: 'error',
      message: 'OAuth flow cancelled by user.',
    };
    emitOAuthStatus(event);

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
        cortexThinkingLevel: 'high',
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
      const result = await getCortexCredentialService().validateApiKey(
        input.provider, input.apiKey
      );
      return {
        valid: result.valid,
        retryable: result.retryable,
        status: result.status,
        message: result.message,
      };
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
      level: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'max']),
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

  /**
   * Set the utility model used for internal operations (thought, reflect,
   * WebFetch summarization, safety checks). `'default'` lets Cortex infer
   * the recommended fast model for the active provider; any other value is
   * an explicit model id from that provider. Applies live without a restart.
   */
  setUtilityModel: protectedProcedure
    .input(z.object({ model: z.string().min(1) }))
    .mutation(({ input }) => {
      const db = getSystemDb();
      settingsStore.updateCortexSettings(db, {
        utilityModel: input.model,
      });

      getEventBus().emit('cortex:utility-model-changed', {
        utilityModel: input.model,
      });

      log.info(`Utility model set to "${input.model}"`);
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
