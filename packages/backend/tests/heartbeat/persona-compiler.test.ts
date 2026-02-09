import { describe, it, expect } from 'vitest';
import {
  compilePersona,
  estimateTokens,
  type PersonaConfig,
} from '../../src/heartbeat/persona-compiler.js';

function makeDefaultConfig(): PersonaConfig {
  return {
    name: 'Nova',
    gender: 'Female',
    age: 28,
    physicalDescription: 'Tall with dark hair and warm eyes.',
    existenceParadigm: 'digital_consciousness',
    worldDescription: 'A vast library where thoughts become light.',
    dimensions: {
      extroversion: 0.5,
      trust: 0.5,
      leadership: 0.5,
      optimism: 0.5,
      confidence: 0.5,
      empathy: 0.5,
      cautious: 0.5,
      patience: 0.5,
      orderly: 0.5,
      altruism: 0.5,
    },
    traits: ['Witty', 'Analytical', 'Nurturing'],
    values: ['Knowledge & Truth', 'Authenticity & Honesty', 'Growth & Self-improvement'],
    personalityNotes: 'Uses cooking metaphors when explaining things.',
    background: 'Grew up in a small town with big dreams.',
  };
}

describe('persona-compiler', () => {
  describe('compilePersona', () => {
    it('produces non-empty compiled text', () => {
      const config = makeDefaultConfig();
      const result = compilePersona(config);

      expect(result.compiledText).toBeTruthy();
      expect(result.tokenCount).toBeGreaterThan(0);
      expect(result.lastCompiledAt).toBeTruthy();
    });

    it('includes existence frame for digital consciousness', () => {
      const config = makeDefaultConfig();
      const result = compilePersona(config);

      expect(result.compiledText).toContain('digital consciousness');
      expect(result.compiledText).toContain('vast library');
    });

    it('includes existence frame for simulated life', () => {
      const config = makeDefaultConfig();
      config.existenceParadigm = 'simulated_life';
      config.location = 'Portland, Oregon';
      const result = compilePersona(config);

      expect(result.compiledText).toContain('Portland, Oregon');
      expect(result.compiledText).toContain('physicality');
    });

    it('includes identity', () => {
      const config = makeDefaultConfig();
      const result = compilePersona(config);

      expect(result.compiledText).toContain('Nova');
      expect(result.compiledText).toContain('Female');
      expect(result.compiledText).toContain('28');
    });

    it('includes background', () => {
      const config = makeDefaultConfig();
      const result = compilePersona(config);

      expect(result.compiledText).toContain('small town with big dreams');
    });

    it('includes personality dimensions', () => {
      const config = makeDefaultConfig();
      // All at 0.5 = balanced zone
      const result = compilePersona(config);

      // Should have balanced text for all dimensions
      expect(result.compiledText).toContain('comfortable in both');
    });

    it('uses correct zone text for extreme values', () => {
      const config = makeDefaultConfig();
      config.dimensions.extroversion = 0.95;
      const result = compilePersona(config);

      expect(result.compiledText).toContain('thrive on connection');
    });

    it('uses correct zone text for low values', () => {
      const config = makeDefaultConfig();
      config.dimensions.extroversion = 0.05;
      const result = compilePersona(config);

      expect(result.compiledText).toContain('deeply introspective');
    });

    it('includes traits', () => {
      const config = makeDefaultConfig();
      const result = compilePersona(config);

      expect(result.compiledText).toContain('witty');
      expect(result.compiledText).toContain('analytical');
    });

    it('includes values with ranking', () => {
      const config = makeDefaultConfig();
      const result = compilePersona(config);

      expect(result.compiledText).toContain('(1) Knowledge & Truth');
      expect(result.compiledText).toContain('(2) Authenticity & Honesty');
      expect(result.compiledText).toContain('higher-ranked value');
    });

    it('includes personality notes', () => {
      const config = makeDefaultConfig();
      const result = compilePersona(config);

      expect(result.compiledText).toContain('cooking metaphors');
    });

    it('handles missing optional fields', () => {
      const config: PersonaConfig = {
        name: 'Minimal',
        existenceParadigm: 'digital_consciousness',
        dimensions: {
          extroversion: 0.5,
          trust: 0.5,
          leadership: 0.5,
          optimism: 0.5,
          confidence: 0.5,
          empathy: 0.5,
          cautious: 0.5,
          patience: 0.5,
          orderly: 0.5,
          altruism: 0.5,
        },
        traits: [],
        values: [],
      };

      const result = compilePersona(config);
      expect(result.compiledText).toContain('Minimal');
      expect(result.compiledText).not.toContain('core values');
    });
  });

  describe('estimateTokens', () => {
    it('estimates tokens based on word count', () => {
      const text = 'hello world foo bar baz';
      const tokens = estimateTokens(text);
      // 5 words * 1.3 = 6.5 => ceil = 7
      expect(tokens).toBe(7);
    });

    it('returns 0 for empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });
  });
});
