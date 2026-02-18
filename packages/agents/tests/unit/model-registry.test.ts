/**
 * Tests for the unified model registry.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  ModelRegistry,
  getModelRegistry,
  initModelRegistry,
  resetModelRegistry,
  type ModelEntry,
} from '../../src/model-registry.js';

// Sample local models data matching the models.json shape
const SAMPLE_LOCAL_DATA = {
  claude: {
    'claude-opus-4-6': {
      name: 'Claude Opus 4.6',
      contextWindow: 200000,
      maxOutputTokens: 128000,
      inputPricePer1M: 5.0,
      outputPricePer1M: 25.0,
      supportsVision: true,
      supportsThinking: true,
    },
    'claude-haiku-4-5-20251001': {
      name: 'Claude Haiku 4.5',
      contextWindow: 200000,
      maxOutputTokens: 64000,
      inputPricePer1M: 1.0,
      outputPricePer1M: 5.0,
      supportsVision: true,
      supportsThinking: true,
    },
  },
  codex: {
    'codex-mini-latest': {
      name: 'Codex Mini',
      contextWindow: 200000,
      maxOutputTokens: 100000,
      inputPricePer1M: 1.5,
      outputPricePer1M: 6.0,
      supportsVision: true,
      supportsThinking: true,
    },
  },
  opencode: {},
};

describe('ModelRegistry', () => {
  let registry: ModelRegistry;

  beforeEach(() => {
    resetModelRegistry();
    // Create a registry with remote fetch disabled (no network in tests)
    registry = new ModelRegistry({ disableRemoteFetch: true });
    // Load sample data
    registry.loadFromJson(SAMPLE_LOCAL_DATA);
  });

  afterEach(() => {
    resetModelRegistry();
  });

  describe('loadFromJson', () => {
    it('populates models from local data', () => {
      expect(registry.size).toBe(3);
    });

    it('skips $schema keys', () => {
      registry.loadFromJson({
        $schema: {} as any,
        claude: {
          'test-model': {
            name: 'Test',
            contextWindow: 100000,
            maxOutputTokens: 10000,
            inputPricePer1M: 1.0,
            outputPricePer1M: 2.0,
            supportsVision: false,
            supportsThinking: false,
          },
        },
      });
      expect(registry.size).toBe(1);
    });

    it('normalizes pricing from per-1M to per-token', () => {
      const model = registry.getModel('claude-opus-4-6');
      expect(model).not.toBeNull();
      // $5.00 per 1M = $0.000005 per token
      expect(model!.inputCostPerToken).toBeCloseTo(0.000005, 10);
      // $25.00 per 1M = $0.000025 per token
      expect(model!.outputCostPerToken).toBeCloseTo(0.000025, 10);
    });
  });

  describe('getModel', () => {
    it('returns model data for known models', () => {
      const model = registry.getModel('claude-opus-4-6');
      expect(model).not.toBeNull();
      expect(model!.id).toBe('claude-opus-4-6');
      expect(model!.name).toBe('Claude Opus 4.6');
      expect(model!.provider).toBe('claude');
      expect(model!.contextWindow).toBe(200000);
      expect(model!.maxOutputTokens).toBe(128000);
      expect(model!.supportsVision).toBe(true);
      expect(model!.supportsThinking).toBe(true);
    });

    it('returns null for unknown models', () => {
      expect(registry.getModel('nonexistent-model')).toBeNull();
    });
  });

  describe('calculateCost', () => {
    it('calculates correct cost from usage', () => {
      const cost = registry.calculateCost('claude-opus-4-6', 'claude', {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
      });

      expect(cost).not.toBeNull();
      // 1000 tokens × $5/1M = $0.005
      expect(cost!.inputCostUsd).toBeCloseTo(0.005, 6);
      // 500 tokens × $25/1M = $0.0125
      expect(cost!.outputCostUsd).toBeCloseTo(0.0125, 6);
      // Total
      expect(cost!.totalCostUsd).toBeCloseTo(0.0175, 6);
      expect(cost!.model).toBe('claude-opus-4-6');
      expect(cost!.provider).toBe('claude');
    });

    it('includes cache costs when available', () => {
      // First set cache pricing on a model
      const model = registry.getModel('claude-opus-4-6')!;
      model.cacheReadCostPerToken = 0.0000005; // $0.50/1M
      model.cacheWriteCostPerToken = 0.0000075; // $7.50/1M

      const cost = registry.calculateCost('claude-opus-4-6', 'claude', {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cacheReadTokens: 2000,
        cacheWriteTokens: 100,
      });

      expect(cost).not.toBeNull();
      // inputCostUsd includes cache: (1000 × 5/1M) + (2000 × 0.50/1M) + (100 × 7.50/1M)
      const expectedInput = 0.005 + 0.001 + 0.00075;
      expect(cost!.inputCostUsd).toBeCloseTo(expectedInput, 6);
    });

    it('returns null for unknown model', () => {
      expect(
        registry.calculateCost('nonexistent', 'claude', {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        }),
      ).toBeNull();
    });
  });

  describe('estimateCost', () => {
    it('estimates cost from token counts', () => {
      const est = registry.estimateCost('claude-opus-4-6', 10000, 5000);

      expect(est).not.toBeNull();
      // 10000 × $5/1M = $0.05
      expect(est!.inputCostUsd).toBeCloseTo(0.05, 6);
      // 5000 × $25/1M = $0.125
      expect(est!.outputCostUsd).toBeCloseTo(0.125, 6);
      expect(est!.totalCostUsd).toBeCloseTo(0.175, 6);
    });

    it('returns null for unknown model', () => {
      expect(registry.estimateCost('nonexistent', 1000, 500)).toBeNull();
    });
  });

  describe('listModels', () => {
    it('returns all models when no filter', () => {
      const all = registry.listModels();
      expect(all).toHaveLength(3);
    });

    it('filters by provider', () => {
      const claudeModels = registry.listModels('claude');
      expect(claudeModels).toHaveLength(2);
      expect(claudeModels.every((m) => m.provider === 'claude')).toBe(true);
    });

    it('returns empty for unknown provider', () => {
      expect(registry.listModels('unknown')).toHaveLength(0);
    });

    it('filters codex models', () => {
      const codexModels = registry.listModels('codex');
      expect(codexModels).toHaveLength(1);
      expect(codexModels[0].id).toBe('codex-mini-latest');
    });
  });

  describe('getContextWindow', () => {
    it('returns context window for known model', () => {
      expect(registry.getContextWindow('claude-opus-4-6')).toBe(200000);
    });

    it('returns null for unknown model', () => {
      expect(registry.getContextWindow('nonexistent')).toBeNull();
    });
  });

  describe('LiteLLM merge', () => {
    it('updates pricing from LiteLLM data', async () => {
      // Simulate what refresh() does internally
      const litellmData = {
        'claude-opus-4-6': {
          input_cost_per_token: 0.000006, // slightly different
          output_cost_per_token: 0.000030,
          cache_read_input_token_cost: 0.0000005,
          cache_creation_input_token_cost: 0.0000075,
        },
      };

      // Use a registry that won't try remote fetch
      const reg = new ModelRegistry({ disableRemoteFetch: true });
      reg.loadFromJson(SAMPLE_LOCAL_DATA);

      // Access private method via any cast for testing
      const updated = (reg as any).mergeLiteLLMPricing(litellmData);

      expect(updated).toBeGreaterThan(0);

      const model = reg.getModel('claude-opus-4-6');
      expect(model!.inputCostPerToken).toBe(0.000006);
      expect(model!.outputCostPerToken).toBe(0.000030);
      expect(model!.cacheReadCostPerToken).toBe(0.0000005);
      expect(model!.cacheWriteCostPerToken).toBe(0.0000075);
    });

    it('does not update capabilities from LiteLLM', async () => {
      const litellmData = {
        'claude-opus-4-6': {
          input_cost_per_token: 0.000006,
          output_cost_per_token: 0.000030,
          max_tokens: 999999, // should not update contextWindow
          max_input_tokens: 999999,
        },
      };

      const reg = new ModelRegistry({ disableRemoteFetch: true });
      reg.loadFromJson(SAMPLE_LOCAL_DATA);
      (reg as any).mergeLiteLLMPricing(litellmData);

      const model = reg.getModel('claude-opus-4-6');
      // contextWindow should still be our local value
      expect(model!.contextWindow).toBe(200000);
      expect(model!.maxOutputTokens).toBe(128000);
    });

    it('matches models by normalized key (strip provider prefix)', async () => {
      const litellmData = {
        'anthropic/claude-opus-4-6': {
          input_cost_per_token: 0.000007,
          output_cost_per_token: 0.000035,
        },
      };

      const reg = new ModelRegistry({ disableRemoteFetch: true });
      reg.loadFromJson(SAMPLE_LOCAL_DATA);
      const updated = (reg as any).mergeLiteLLMPricing(litellmData);

      expect(updated).toBeGreaterThan(0);
      const model = reg.getModel('claude-opus-4-6');
      expect(model!.inputCostPerToken).toBe(0.000007);
    });
  });

  describe('refresh', () => {
    it('returns immediately when remote fetch is disabled', async () => {
      const result = await registry.refresh();
      expect(result.updated).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('handles fetch failure gracefully', async () => {
      const reg = new ModelRegistry({ disableRemoteFetch: false });
      reg.loadFromJson(SAMPLE_LOCAL_DATA);

      // Mock fetch to fail
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      try {
        const result = await reg.refresh();
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0]).toContain('Network error');

        // Models should still be available from local data
        expect(reg.getModel('claude-opus-4-6')).not.toBeNull();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('singleton', () => {
    it('getModelRegistry returns same instance', () => {
      resetModelRegistry();
      const a = getModelRegistry();
      const b = getModelRegistry();
      expect(a).toBe(b);
    });

    it('initModelRegistry creates new instance', () => {
      resetModelRegistry();
      const a = getModelRegistry();
      const b = initModelRegistry({ disableRemoteFetch: true });
      expect(a).not.toBe(b);
      expect(getModelRegistry()).toBe(b);
    });

    it('resetModelRegistry clears singleton', () => {
      const a = getModelRegistry();
      resetModelRegistry();
      const b = getModelRegistry();
      expect(a).not.toBe(b);
    });
  });
});
