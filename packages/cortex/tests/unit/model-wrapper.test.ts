import { describe, it, expect } from 'vitest';
import { wrapModel, unwrapModel, isCortexModel } from '../../src/model-wrapper.js';
import type { CortexModel } from '../../src/model-wrapper.js';

describe('model-wrapper', () => {
  // -----------------------------------------------------------------------
  // wrapModel
  // -----------------------------------------------------------------------

  describe('wrapModel', () => {
    it('wraps a model with brand, provider, modelId, and contextWindow', () => {
      const inner = { provider: 'anthropic', name: 'claude-sonnet-4' };
      const wrapped = wrapModel(inner, 'anthropic', 'claude-sonnet-4', 200_000);

      expect(wrapped.__brand).toBe('CortexModel');
      expect(wrapped.provider).toBe('anthropic');
      expect(wrapped.modelId).toBe('claude-sonnet-4');
      expect(wrapped.contextWindow).toBe(200_000);
    });

    it('extracts contextWindow from the inner model when not specified', () => {
      const inner = { provider: 'openai', name: 'gpt-4o', contextWindow: 128_000 };
      const wrapped = wrapModel(inner, 'openai', 'gpt-4o');

      expect(wrapped.contextWindow).toBe(128_000);
    });

    it('defaults contextWindow to 200,000 when not available', () => {
      const inner = { provider: 'custom', name: 'my-model' };
      const wrapped = wrapModel(inner, 'custom', 'my-model');

      expect(wrapped.contextWindow).toBe(200_000);
    });

    it('uses explicit contextWindow over model-extracted value', () => {
      const inner = { provider: 'anthropic', name: 'model', contextWindow: 50_000 };
      const wrapped = wrapModel(inner, 'anthropic', 'model', 100_000);

      expect(wrapped.contextWindow).toBe(100_000);
    });

    it('wraps null inner models', () => {
      const wrapped = wrapModel(null, 'test', 'test-model', 10_000);

      expect(wrapped.__brand).toBe('CortexModel');
      expect(wrapped.provider).toBe('test');
    });

    it('wraps primitive inner models', () => {
      const wrapped = wrapModel('some-string', 'test', 'test-model', 10_000);

      expect(wrapped.__brand).toBe('CortexModel');
    });
  });

  // -----------------------------------------------------------------------
  // unwrapModel
  // -----------------------------------------------------------------------

  describe('unwrapModel', () => {
    it('round-trips: unwrap(wrap(x)) === x', () => {
      const inner = { provider: 'anthropic', name: 'claude-sonnet-4', extra: 'data' };
      const wrapped = wrapModel(inner, 'anthropic', 'claude-sonnet-4', 200_000);
      const unwrapped = unwrapModel(wrapped);

      expect(unwrapped).toBe(inner);
    });

    it('preserves the exact reference of the inner model', () => {
      const inner = Object.freeze({ provider: 'openai', name: 'gpt-4o' });
      const wrapped = wrapModel(inner, 'openai', 'gpt-4o', 128_000);
      const unwrapped = unwrapModel(wrapped);

      expect(unwrapped).toBe(inner);
    });

    it('throws on non-CortexModel input', () => {
      const fake = { __brand: 'CortexModel', provider: 'test', modelId: 'test', contextWindow: 100 };

      expect(() => unwrapModel(fake as CortexModel)).toThrow('Expected a CortexModel');
    });

    it('throws on null input', () => {
      expect(() => unwrapModel(null as unknown as CortexModel)).toThrow('Expected a CortexModel');
    });

    it('throws on undefined input', () => {
      expect(() => unwrapModel(undefined as unknown as CortexModel)).toThrow('Expected a CortexModel');
    });
  });

  // -----------------------------------------------------------------------
  // isCortexModel
  // -----------------------------------------------------------------------

  describe('isCortexModel', () => {
    it('returns true for a properly wrapped model', () => {
      const wrapped = wrapModel({}, 'test', 'test-model', 10_000);
      expect(isCortexModel(wrapped)).toBe(true);
    });

    it('returns false for null', () => {
      expect(isCortexModel(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isCortexModel(undefined)).toBe(false);
    });

    it('returns false for a string', () => {
      expect(isCortexModel('not a model')).toBe(false);
    });

    it('returns false for a number', () => {
      expect(isCortexModel(42)).toBe(false);
    });

    it('returns false for an object with wrong brand', () => {
      expect(isCortexModel({ __brand: 'NotCortexModel' })).toBe(false);
    });

    it('returns false for an object with correct brand but missing Symbol', () => {
      const fake = {
        __brand: 'CortexModel',
        provider: 'test',
        modelId: 'test',
        contextWindow: 100,
      };
      expect(isCortexModel(fake)).toBe(false);
    });

    it('returns false for an object with correct brand but wrong types', () => {
      expect(isCortexModel({ __brand: 'CortexModel', provider: 123 })).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Type safety (compile-time assertions)
  // -----------------------------------------------------------------------

  describe('type safety', () => {
    it('wrapped model exposes readonly provider, modelId, contextWindow', () => {
      const wrapped = wrapModel({}, 'anthropic', 'claude-sonnet-4', 200_000);

      // These should be readable
      const _provider: string = wrapped.provider;
      const _modelId: string = wrapped.modelId;
      const _contextWindow: number = wrapped.contextWindow;
      const _brand: 'CortexModel' = wrapped.__brand;

      // Suppress unused variable warnings
      expect(_provider).toBe('anthropic');
      expect(_modelId).toBe('claude-sonnet-4');
      expect(_contextWindow).toBe(200_000);
      expect(_brand).toBe('CortexModel');
    });
  });
});
