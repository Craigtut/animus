/**
 * Unified Model Registry
 *
 * Single source of truth for model metadata across the system:
 * pricing, context windows, capabilities. Loads local data from
 * models.json (always available) and optionally refreshes pricing
 * from LiteLLM's community-maintained dataset.
 *
 * Trust hierarchy: SDK-provided token counts and total_cost_usd
 * always take precedence. Registry pricing fills gaps.
 */

import { createRequire } from 'node:module';
import type { AgentProvider } from '@animus/shared';
import type { SessionUsage, AgentCost } from './types.js';
import { createTaggedLogger } from './logger.js';

const log = createTaggedLogger('ModelRegistry');

// ============================================================================
// Types
// ============================================================================

export interface ModelEntry {
  /** Model ID as used in our system (e.g. "claude-opus-4-6") */
  id: string;
  /** Human-readable name */
  name: string;
  /** Provider key (e.g. "claude", "codex", "opencode") */
  provider: string;
  /** Context window size in tokens */
  contextWindow: number;
  /** Maximum output tokens */
  maxOutputTokens: number;
  /** USD per token (input) */
  inputCostPerToken: number;
  /** USD per token (output) */
  outputCostPerToken: number;
  /** USD per token (cache read), if applicable */
  cacheReadCostPerToken?: number;
  /** USD per token (cache write), if applicable */
  cacheWriteCostPerToken?: number;
  /** Whether the model supports image/vision input */
  supportsVision: boolean;
  /** Whether the model supports extended thinking */
  supportsThinking: boolean;
}

export interface ModelRegistryConfig {
  /** Directory to cache fetched pricing. If omitted, no disk cache. */
  cacheDir?: string;
  /** TTL for cached data in ms. Default: 24 hours */
  cacheTtlMs?: number;
  /** Disable remote fetch (for testing/offline). Default: false */
  disableRemoteFetch?: boolean;
}

// ============================================================================
// Local model data shape (matches models.json)
// ============================================================================

interface LocalModelData {
  name: string;
  contextWindow: number;
  maxOutputTokens: number;
  inputPricePer1M: number;
  outputPricePer1M: number;
  supportsVision: boolean;
  supportsThinking: boolean;
  notes?: string;
}

type LocalModelsFile = Record<string, Record<string, LocalModelData>>;

// ============================================================================
// LiteLLM data shape (subset of fields we care about)
// ============================================================================

interface LiteLLMModelEntry {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_read_input_token_cost?: number;
  cache_creation_input_token_cost?: number;
  max_tokens?: number;
  max_input_tokens?: number;
}

const LITELLM_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CACHE_FILENAME = 'litellm-models.json';

// ============================================================================
// ModelRegistry
// ============================================================================

export class ModelRegistry {
  private models: Map<string, ModelEntry> = new Map();
  private config: ModelRegistryConfig;

  constructor(config?: ModelRegistryConfig) {
    this.config = config ?? {};
    this.loadLocal();
  }

  /**
   * Load local models.json data synchronously.
   * Uses createRequire for JSON import in ESM context.
   */
  private loadLocal(): void {
    try {
      const require_ = createRequire(import.meta.url);
      const data: LocalModelsFile = require_('./models.json');
      this.loadFromLocalData(data);
    } catch {
      log.warn('Sync load of models.json failed, models will be loaded via loadFromJson()');
    }
  }

  /**
   * Load from parsed local data object.
   */
  private loadFromLocalData(data: LocalModelsFile): void {
    this.models.clear();

    for (const [providerKey, models] of Object.entries(data)) {
      if (providerKey.startsWith('$')) continue; // skip $schema etc.
      for (const [modelId, info] of Object.entries(models)) {
        this.models.set(modelId, {
          id: modelId,
          name: info.name,
          provider: providerKey,
          contextWindow: info.contextWindow,
          maxOutputTokens: info.maxOutputTokens,
          inputCostPerToken: info.inputPricePer1M / 1_000_000,
          outputCostPerToken: info.outputPricePer1M / 1_000_000,
          supportsVision: info.supportsVision,
          supportsThinking: info.supportsThinking,
        });
      }
    }

    log.debug(`Loaded ${this.models.size} models from local data`);
  }

  /**
   * Load models from a parsed local JSON object (for testing or async init).
   */
  loadFromJson(data: LocalModelsFile): void {
    this.loadFromLocalData(data);
  }

  /**
   * Fetch LiteLLM data, merge pricing updates, cache to disk.
   * Non-blocking — if it fails, local data stands.
   */
  async refresh(): Promise<{ updated: number; errors: string[] }> {
    if (this.config.disableRemoteFetch) {
      return { updated: 0, errors: [] };
    }

    // Try disk cache first
    if (this.loadDiskCache()) {
      return { updated: 0, errors: [] };
    }

    const errors: string[] = [];
    let updated = 0;

    try {
      const response = await fetch(LITELLM_URL, {
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        errors.push(`LiteLLM fetch failed: ${response.status} ${response.statusText}`);
        return { updated, errors };
      }

      const data = (await response.json()) as Record<string, LiteLLMModelEntry>;

      // Cache to disk
      await this.writeDiskCache(data);

      // Merge pricing
      updated = this.mergeLiteLLMPricing(data);
    } catch (err) {
      errors.push(`LiteLLM fetch error: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (errors.length > 0) {
      log.debug('LiteLLM refresh had errors', { errors });
    } else {
      log.info(`LiteLLM refresh complete: ${updated} models updated`);
    }

    return { updated, errors };
  }

  /**
   * Load cached LiteLLM data from disk if within TTL.
   */
  private loadDiskCache(): boolean {
    if (!this.config.cacheDir) return false;

    try {
      const require_ = createRequire(import.meta.url);
      const fs = require_('node:fs') as typeof import('node:fs');
      const nodePath = require_('node:path') as typeof import('node:path');
      const cachePath = nodePath.join(this.config.cacheDir, CACHE_FILENAME);

      if (!fs.existsSync(cachePath)) return false;

      const stat = fs.statSync(cachePath);
      const age = Date.now() - stat.mtimeMs;
      const ttl = this.config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;

      if (age > ttl) {
        log.debug('Disk cache expired', { ageMs: age, ttlMs: ttl });
        return false;
      }

      const raw = fs.readFileSync(cachePath, 'utf-8');
      const data = JSON.parse(raw) as Record<string, LiteLLMModelEntry>;
      const updated = this.mergeLiteLLMPricing(data);
      log.debug(`Loaded LiteLLM cache from disk (${updated} models updated)`);
      return true;
    } catch (err) {
      log.debug('Failed to load disk cache', { error: String(err) });
      return false;
    }
  }

  /**
   * Write fetched LiteLLM data to disk cache.
   */
  private async writeDiskCache(data: Record<string, LiteLLMModelEntry>): Promise<void> {
    if (!this.config.cacheDir) return;

    try {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');

      await fs.mkdir(this.config.cacheDir, { recursive: true });
      const cachePath = path.join(this.config.cacheDir, CACHE_FILENAME);
      await fs.writeFile(cachePath, JSON.stringify(data));
      log.debug('Wrote LiteLLM cache to disk');
    } catch (err) {
      log.debug('Failed to write disk cache', { error: String(err) });
    }
  }

  /**
   * Merge LiteLLM pricing into our existing model entries.
   * Only updates pricing fields — context windows and capabilities
   * stay as defined in our local models.json.
   */
  private mergeLiteLLMPricing(data: Record<string, LiteLLMModelEntry>): number {
    let updated = 0;

    // Build a normalized lookup from LiteLLM keys
    const litellmMap = new Map<string, LiteLLMModelEntry>();
    for (const [key, entry] of Object.entries(data)) {
      if (!entry || typeof entry !== 'object') continue;
      // Store by original key
      litellmMap.set(key.toLowerCase(), entry);
      // Also store normalized (strip provider prefixes like "anthropic/", "openai/")
      const stripped = key.replace(/^[a-zA-Z-]+\//, '').toLowerCase();
      if (!litellmMap.has(stripped)) {
        litellmMap.set(stripped, entry);
      }
    }

    for (const [modelId, model] of this.models) {
      const normalizedId = modelId.toLowerCase();

      // Try exact match, then with provider prefix
      const providerPrefixes: Record<string, string[]> = {
        claude: ['anthropic/'],
        codex: ['openai/', ''],
        opencode: [''],
      };

      let litellmEntry: LiteLLMModelEntry | undefined;

      // Direct match
      litellmEntry = litellmMap.get(normalizedId);

      // Try with provider prefixes
      if (!litellmEntry) {
        const prefixes = providerPrefixes[model.provider] ?? [''];
        for (const prefix of prefixes) {
          litellmEntry = litellmMap.get(`${prefix}${normalizedId}`);
          if (litellmEntry) break;
        }
      }

      if (litellmEntry) {
        // Only update pricing fields
        if (litellmEntry.input_cost_per_token !== undefined) {
          model.inputCostPerToken = litellmEntry.input_cost_per_token;
        }
        if (litellmEntry.output_cost_per_token !== undefined) {
          model.outputCostPerToken = litellmEntry.output_cost_per_token;
        }
        if (litellmEntry.cache_read_input_token_cost !== undefined) {
          model.cacheReadCostPerToken = litellmEntry.cache_read_input_token_cost;
        }
        if (litellmEntry.cache_creation_input_token_cost !== undefined) {
          model.cacheWriteCostPerToken = litellmEntry.cache_creation_input_token_cost;
        }
        updated++;
      }
    }

    return updated;
  }

  /**
   * Get full model info. Returns null if unknown.
   */
  getModel(modelId: string): ModelEntry | null {
    return this.models.get(modelId) ?? null;
  }

  /**
   * Calculate cost from actual SDK usage.
   * Returns null if model is unknown.
   */
  calculateCost(
    modelId: string,
    provider: string,
    usage: SessionUsage,
  ): AgentCost | null {
    const model = this.models.get(modelId);
    if (!model) return null;

    const inputCost = usage.inputTokens * model.inputCostPerToken;
    const outputCost = usage.outputTokens * model.outputCostPerToken;

    let cacheCost = 0;
    if (usage.cacheReadTokens && model.cacheReadCostPerToken) {
      cacheCost += usage.cacheReadTokens * model.cacheReadCostPerToken;
    }
    if (usage.cacheWriteTokens && model.cacheWriteCostPerToken) {
      cacheCost += usage.cacheWriteTokens * model.cacheWriteCostPerToken;
    }

    return {
      inputCostUsd: inputCost + cacheCost,
      outputCostUsd: outputCost,
      totalCostUsd: inputCost + outputCost + cacheCost,
      model: modelId,
      provider: provider as AgentProvider,
    };
  }

  /**
   * Estimate cost before a request.
   */
  estimateCost(
    modelId: string,
    estimatedInputTokens: number,
    estimatedOutputTokens: number,
  ): { inputCostUsd: number; outputCostUsd: number; totalCostUsd: number } | null {
    const model = this.models.get(modelId);
    if (!model) return null;

    const inputCostUsd = estimatedInputTokens * model.inputCostPerToken;
    const outputCostUsd = estimatedOutputTokens * model.outputCostPerToken;

    return {
      inputCostUsd,
      outputCostUsd,
      totalCostUsd: inputCostUsd + outputCostUsd,
    };
  }

  /**
   * List all known models, optionally filtered by provider key.
   */
  listModels(providerKey?: string): ModelEntry[] {
    const all = Array.from(this.models.values());
    if (!providerKey) return all;
    return all.filter((m) => m.provider === providerKey);
  }

  /**
   * Get context window size for a model.
   */
  getContextWindow(modelId: string): number | null {
    return this.models.get(modelId)?.contextWindow ?? null;
  }

  /**
   * Get count of loaded models.
   */
  get size(): number {
    return this.models.size;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let registry: ModelRegistry | null = null;

/**
 * Get the shared model registry instance.
 * Creates one with defaults if not yet initialized.
 */
export function getModelRegistry(): ModelRegistry {
  if (!registry) {
    registry = new ModelRegistry();
  }
  return registry;
}

/**
 * Initialize the model registry with specific config.
 * Call this once at startup before any adapters use it.
 */
export function initModelRegistry(config?: ModelRegistryConfig): ModelRegistry {
  registry = new ModelRegistry(config);
  return registry;
}

/**
 * Reset the registry (for testing).
 */
export function resetModelRegistry(): void {
  registry = null;
}
