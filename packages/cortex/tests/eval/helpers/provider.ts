/**
 * Real LLM provider helpers for evaluation tests.
 *
 * Wraps pi-ai to provide:
 *   - Model resolution (Haiku for evals)
 *   - completeFn compatible with Cortex's CompleteFn type
 *   - Usage extraction from pi-ai AssistantMessage responses
 *   - Automatic authentication via the auth module
 */

import type { CortexUsage } from '../../../src/types.js';
import type { CompleteFn } from '../../../src/compaction/compaction.js';
import { costTracker } from './cost-tracker.js';
import {
  resolveEvalApiKey,
  hasEvalCredentials as checkCredentials,
  EVAL_PROVIDER_CONFIGS,
  DEFAULT_EVAL_PROVIDER,
} from './auth.js';

// ---------------------------------------------------------------------------
// Re-exports from auth for convenience
// ---------------------------------------------------------------------------

export { hasEvalCredentials, canRunEvals } from './auth.js';
export { DEFAULT_EVAL_PROVIDER } from './auth.js';

// ---------------------------------------------------------------------------
// Provider config (derived from auth)
// ---------------------------------------------------------------------------

const defaultConfig = EVAL_PROVIDER_CONFIGS[DEFAULT_EVAL_PROVIDER]!;
export const EVAL_PROVIDER = defaultConfig.provider;
export const EVAL_MODEL_ID = defaultConfig.modelId;

// ---------------------------------------------------------------------------
// Pi-ai dynamic imports (mirrors CortexAgent pattern)
// ---------------------------------------------------------------------------

interface PiAiModule {
  getModel: (provider: string, modelId: string) => unknown;
  complete: (model: unknown, context: unknown, options?: unknown) => Promise<unknown>;
}

let _piAi: PiAiModule | null = null;

async function loadPiAi(): Promise<PiAiModule> {
  if (_piAi) return _piAi;
  const modulePath = '@mariozechner/pi-ai';
  _piAi = await import(modulePath) as PiAiModule;
  return _piAi;
}

// ---------------------------------------------------------------------------
// Model resolution
// ---------------------------------------------------------------------------

const modelCache = new Map<string, unknown>();

/**
 * Get the eval model for a provider. Cached after first call.
 */
export async function getEvalModel(providerName: string = DEFAULT_EVAL_PROVIDER): Promise<unknown> {
  const cached = modelCache.get(providerName);
  if (cached) return cached;

  const config = EVAL_PROVIDER_CONFIGS[providerName];
  if (!config) throw new Error(`Unknown eval provider: "${providerName}"`);

  const piAi = await loadPiAi();
  const model = piAi.getModel(config.provider, config.modelId);
  modelCache.set(providerName, model);
  return model;
}

// ---------------------------------------------------------------------------
// Usage extraction (mirrors CortexAgent.extractUsageFromAssistantMessage)
// ---------------------------------------------------------------------------

function extractUsage(result: unknown): CortexUsage | null {
  if (!result || typeof result !== 'object') return null;
  const msg = result as Record<string, unknown>;
  const usage = msg['usage'];
  if (!usage || typeof usage !== 'object') return null;

  const u = usage as Record<string, unknown>;
  const input = typeof u['input'] === 'number' ? u['input'] : 0;
  const output = typeof u['output'] === 'number' ? u['output'] : 0;
  const cacheRead = typeof u['cacheRead'] === 'number' ? u['cacheRead'] : 0;
  const cacheWrite = typeof u['cacheWrite'] === 'number' ? u['cacheWrite'] : 0;
  const totalTokens = typeof u['totalTokens'] === 'number' ? u['totalTokens'] : input + output;

  const costObj = u['cost'];
  let cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  if (costObj && typeof costObj === 'object') {
    const c = costObj as Record<string, unknown>;
    cost = {
      input: typeof c['input'] === 'number' ? c['input'] : 0,
      output: typeof c['output'] === 'number' ? c['output'] : 0,
      cacheRead: typeof c['cacheRead'] === 'number' ? c['cacheRead'] : 0,
      cacheWrite: typeof c['cacheWrite'] === 'number' ? c['cacheWrite'] : 0,
      total: typeof c['total'] === 'number' ? c['total'] : 0,
    };
  }

  const model = typeof msg['model'] === 'string' ? msg['model'] : undefined;
  return { input, output, cacheRead, cacheWrite, totalTokens, cost, model };
}

function extractText(result: unknown): string {
  if (!result || typeof result !== 'object') return '';
  const msg = result as Record<string, unknown>;

  if (typeof msg.content === 'string') return msg.content;

  if (Array.isArray(msg.content)) {
    return (msg.content as Array<Record<string, unknown>>)
      .filter(part => part.type === 'text' && typeof part.text === 'string')
      .map(part => part.text as string)
      .join('');
  }

  if (typeof msg.text === 'string') return msg.text;
  return '';
}

// ---------------------------------------------------------------------------
// Complete function (tracked)
// ---------------------------------------------------------------------------

export interface TrackedCompleteResult {
  text: string;
  usage: CortexUsage | null;
  raw: unknown;
}

/**
 * Make a tracked LLM call. Records usage in the global cost tracker.
 * Resolves API key automatically via the auth module.
 *
 * @param context - System prompt and messages
 * @param options - Additional pi-ai options (cacheRetention, maxTokens, etc.)
 * @param providerName - Provider to use (default: 'anthropic')
 * @returns Text response, usage data, and raw pi-ai result
 */
export async function evalComplete(
  context: { systemPrompt: string; messages: unknown[] },
  options?: Record<string, unknown>,
  providerName: string = DEFAULT_EVAL_PROVIDER,
): Promise<TrackedCompleteResult> {
  const piAi = await loadPiAi();
  const model = await getEvalModel(providerName);
  const apiKey = await resolveEvalApiKey(providerName);

  const completeOptions: Record<string, unknown> = { apiKey, ...options };

  const result = await piAi.complete(model, {
    systemPrompt: context.systemPrompt,
    messages: context.messages,
  }, completeOptions);

  // Check for silent errors (pi-ai resolves with stopReason 'error')
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if (r['stopReason'] === 'error') {
      throw new Error(`LLM call failed: ${r['errorMessage'] ?? 'unknown error'}`);
    }
  }

  const text = extractText(result);
  const usage = extractUsage(result);

  if (usage) {
    costTracker.record(usage);
  }

  return { text, usage, raw: result };
}

/**
 * Create a CompleteFn compatible with Cortex's compaction system.
 * Wraps evalComplete to match the (context) => Promise<string> signature.
 *
 * @param providerName - Provider to use (default: 'anthropic')
 */
export function createEvalCompleteFn(providerName: string = DEFAULT_EVAL_PROVIDER): CompleteFn {
  return async (context) => {
    const { text } = await evalComplete(context, undefined, providerName);
    return text;
  };
}
