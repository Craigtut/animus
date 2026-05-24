import { describe, expect, it } from 'vitest';
import {
  archetypePresets,
  defaultDimensions,
  getArchetypeDraftPreset,
} from '../src/pages/onboarding/persona/archetype-presets';

describe('getArchetypeDraftPreset', () => {
  it('returns neutral defaults for start from scratch', () => {
    expect(getArchetypeDraftPreset(null)).toEqual({
      archetype: null,
      personalityDimensions: defaultDimensions,
      traits: [],
    });
  });

  it('treats the legacy scratch pseudo-archetype as neutral defaults', () => {
    expect(getArchetypeDraftPreset('scratch')).toEqual({
      archetype: null,
      personalityDimensions: defaultDimensions,
      traits: [],
    });
  });

  it('returns cloned preset values for a selected archetype', () => {
    const result = getArchetypeDraftPreset('scholar');

    expect(result).toEqual({
      archetype: 'scholar',
      personalityDimensions: archetypePresets['scholar']!.dimensions,
      traits: archetypePresets['scholar']!.traits,
    });
    expect(result.personalityDimensions).not.toBe(archetypePresets['scholar']!.dimensions);
    expect(result.traits).not.toBe(archetypePresets['scholar']!.traits);
  });
});
