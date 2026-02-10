/**
 * Settings Page Tests
 *
 * Tests for Settings page logic: section routing from URL paths,
 * data constants consistency (dimensions, traits, values), persona
 * validation rules, and formatting helpers.
 *
 * These are pure logic tests — no DOM required.
 */

import { describe, it, expect } from 'vitest';

// ============================================================================
// Section routing logic (mirrors SettingsPage's activeSection derivation)
// ============================================================================

type SettingsSection = 'persona' | 'heartbeat' | 'provider' | 'channels' | 'goals' | 'system';

const validSections: SettingsSection[] = ['persona', 'heartbeat', 'provider', 'channels', 'goals', 'system'];

function getActiveSection(pathname: string): SettingsSection {
  const path = pathname.replace('/settings/', '').replace('/settings', '');
  const match = validSections.find((s) => s === path);
  return match ?? 'persona';
}

describe('Settings section routing', () => {
  it('defaults to persona for bare /settings', () => {
    expect(getActiveSection('/settings')).toBe('persona');
  });

  it('defaults to persona for /settings/', () => {
    expect(getActiveSection('/settings/')).toBe('persona');
  });

  it('returns persona for /settings/persona', () => {
    expect(getActiveSection('/settings/persona')).toBe('persona');
  });

  it('returns heartbeat for /settings/heartbeat', () => {
    expect(getActiveSection('/settings/heartbeat')).toBe('heartbeat');
  });

  it('returns provider for /settings/provider', () => {
    expect(getActiveSection('/settings/provider')).toBe('provider');
  });

  it('returns channels for /settings/channels', () => {
    expect(getActiveSection('/settings/channels')).toBe('channels');
  });

  it('returns goals for /settings/goals', () => {
    expect(getActiveSection('/settings/goals')).toBe('goals');
  });

  it('returns system for /settings/system', () => {
    expect(getActiveSection('/settings/system')).toBe('system');
  });

  it('defaults to persona for unknown sub-path', () => {
    expect(getActiveSection('/settings/unknown')).toBe('persona');
  });

  it('defaults to persona for deeply nested path', () => {
    expect(getActiveSection('/settings/persona/extra')).toBe('persona');
  });
});

// ============================================================================
// Sidebar items (must match sections array in SettingsPage)
// ============================================================================

describe('Settings sidebar sections', () => {
  it('has exactly 6 sections', () => {
    expect(validSections).toHaveLength(6);
  });

  it('includes all required sections', () => {
    expect(validSections).toContain('persona');
    expect(validSections).toContain('heartbeat');
    expect(validSections).toContain('provider');
    expect(validSections).toContain('channels');
    expect(validSections).toContain('goals');
    expect(validSections).toContain('system');
  });

  it('has no duplicate sections', () => {
    expect(new Set(validSections).size).toBe(validSections.length);
  });
});

// ============================================================================
// Dimension groups (personality sliders)
// ============================================================================

const dimensionGroups = [
  {
    title: 'Social Orientation',
    dimensions: [
      { id: 'extroversion', leftLabel: 'Introverted', rightLabel: 'Extroverted' },
      { id: 'trust', leftLabel: 'Suspicious', rightLabel: 'Trusting' },
      { id: 'leadership', leftLabel: 'Follower', rightLabel: 'Leader' },
    ],
  },
  {
    title: 'Emotional Temperament',
    dimensions: [
      { id: 'optimism', leftLabel: 'Pessimistic', rightLabel: 'Optimistic' },
      { id: 'confidence', leftLabel: 'Insecure', rightLabel: 'Confident' },
      { id: 'empathy', leftLabel: 'Uncompassionate', rightLabel: 'Empathetic' },
    ],
  },
  {
    title: 'Decision Style',
    dimensions: [
      { id: 'cautious', leftLabel: 'Reckless', rightLabel: 'Cautious' },
      { id: 'patience', leftLabel: 'Impulsive', rightLabel: 'Patient' },
      { id: 'orderly', leftLabel: 'Chaotic', rightLabel: 'Orderly' },
    ],
  },
  {
    title: 'Moral Compass',
    dimensions: [
      { id: 'altruism', leftLabel: 'Selfish', rightLabel: 'Altruistic' },
    ],
  },
];

describe('Settings persona dimension groups', () => {
  it('has 4 groups', () => {
    expect(dimensionGroups).toHaveLength(4);
  });

  it('has exactly 10 dimensions total', () => {
    const count = dimensionGroups.reduce((sum, g) => sum + g.dimensions.length, 0);
    expect(count).toBe(10);
  });

  it('all dimension IDs are unique', () => {
    const ids = dimensionGroups.flatMap((g) => g.dimensions.map((d) => d.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses schema-compatible IDs (extroversion, not extraversion)', () => {
    const ids = dimensionGroups.flatMap((g) => g.dimensions.map((d) => d.id));
    expect(ids).toContain('extroversion');
    expect(ids).not.toContain('extraversion');
  });

  it('uses schema-compatible IDs (cautious, not caution)', () => {
    const ids = dimensionGroups.flatMap((g) => g.dimensions.map((d) => d.id));
    expect(ids).toContain('cautious');
    expect(ids).not.toContain('caution');
  });

  it('uses schema-compatible IDs (orderly, not order)', () => {
    const ids = dimensionGroups.flatMap((g) => g.dimensions.map((d) => d.id));
    expect(ids).toContain('orderly');
    expect(ids).not.toContain('order');
  });

  it('every dimension has left and right labels', () => {
    for (const group of dimensionGroups) {
      for (const dim of group.dimensions) {
        expect(dim.leftLabel).toBeTruthy();
        expect(dim.rightLabel).toBeTruthy();
        expect(dim.leftLabel).not.toBe(dim.rightLabel);
      }
    }
  });
});

// ============================================================================
// Trait categories
// ============================================================================

const traitCategories = [
  { title: 'Communication', traits: ['Witty', 'Sarcastic', 'Dry humor', 'Gentle', 'Blunt', 'Poetic', 'Formal', 'Casual', 'Verbose', 'Terse'] },
  { title: 'Cognitive', traits: ['Analytical', 'Creative', 'Practical', 'Abstract', 'Detail-oriented', 'Big-picture', 'Philosophical', 'Scientific'] },
  { title: 'Relational', traits: ['Nurturing', 'Challenging', 'Encouraging', 'Playful', 'Serious', 'Mentoring', 'Collaborative'] },
  { title: 'Quirks', traits: ['Nostalgic', 'Superstitious', 'Perfectionist', 'Daydreamer', 'Night owl', 'Worrier', 'Contrarian'] },
];

describe('Settings persona trait categories', () => {
  it('has 4 categories', () => {
    expect(traitCategories).toHaveLength(4);
  });

  const allTraits = traitCategories.flatMap((c) => c.traits);

  it('has at least 30 total traits', () => {
    expect(allTraits.length).toBeGreaterThanOrEqual(30);
  });

  it('all traits are unique', () => {
    expect(new Set(allTraits).size).toBe(allTraits.length);
  });

  it('every category has a non-empty title', () => {
    for (const cat of traitCategories) {
      expect(cat.title).toBeTruthy();
    }
  });

  it('every category has at least 5 traits', () => {
    for (const cat of traitCategories) {
      expect(cat.traits.length).toBeGreaterThanOrEqual(5);
    }
  });
});

// ============================================================================
// Trait toggle logic
// ============================================================================

describe('Settings trait toggle logic', () => {
  const MAX_TRAITS = 8;

  function toggleTrait(traits: string[], trait: string): string[] {
    if (traits.includes(trait)) {
      return traits.filter((t) => t !== trait);
    } else if (traits.length < MAX_TRAITS) {
      return [...traits, trait];
    }
    return traits;
  }

  it('adds a trait when under limit', () => {
    expect(toggleTrait([], 'Witty')).toEqual(['Witty']);
  });

  it('removes a trait when already selected', () => {
    expect(toggleTrait(['Witty', 'Sarcastic'], 'Witty')).toEqual(['Sarcastic']);
  });

  it('does not add beyond max limit', () => {
    const traits = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    expect(traits).toHaveLength(MAX_TRAITS);
    expect(toggleTrait(traits, 'new')).toEqual(traits);
  });

  it('can remove when at max and re-add different', () => {
    const traits = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const removed = toggleTrait(traits, 'h');
    expect(removed).toHaveLength(7);
    const added = toggleTrait(removed, 'new');
    expect(added).toHaveLength(8);
    expect(added).toContain('new');
  });
});

// ============================================================================
// Value toggle logic
// ============================================================================

describe('Settings value toggle logic', () => {
  const MAX_VALUES = 5;

  function toggleValue(values: string[], id: string): string[] {
    if (values.includes(id)) {
      return values.filter((v) => v !== id);
    } else if (values.length < MAX_VALUES) {
      return [...values, id];
    }
    return values;
  }

  it('adds a value when under limit', () => {
    expect(toggleValue([], 'knowledge')).toEqual(['knowledge']);
  });

  it('removes a value when already selected', () => {
    expect(toggleValue(['knowledge', 'loyalty'], 'knowledge')).toEqual(['loyalty']);
  });

  it('does not add beyond max limit', () => {
    const values = ['a', 'b', 'c', 'd', 'e'];
    expect(toggleValue(values, 'new')).toEqual(values);
  });

  it('maintains selection order (rank)', () => {
    let values: string[] = [];
    values = toggleValue(values, 'knowledge');
    values = toggleValue(values, 'freedom');
    values = toggleValue(values, 'loyalty');
    expect(values).toEqual(['knowledge', 'freedom', 'loyalty']);
    expect(values.indexOf('knowledge')).toBe(0);
    expect(values.indexOf('loyalty')).toBe(2);
  });
});

// ============================================================================
// Persona validation
// ============================================================================

describe('Settings persona validation', () => {
  function validatePersona(name: string, traits: string[], values: string[]): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!name.trim()) errors['name'] = 'Name is required';
    if (traits.length < 5 || traits.length > 8) errors['traits'] = 'Select 5-8 traits';
    if (values.length < 3 || values.length > 5) errors['values'] = 'Select 3-5 values';
    return errors;
  }

  it('passes with valid input', () => {
    const errors = validatePersona('Aria', ['a', 'b', 'c', 'd', 'e'], ['v1', 'v2', 'v3']);
    expect(Object.keys(errors)).toHaveLength(0);
  });

  it('fails with empty name', () => {
    const errors = validatePersona('', ['a', 'b', 'c', 'd', 'e'], ['v1', 'v2', 'v3']);
    expect(errors['name']).toBe('Name is required');
  });

  it('fails with whitespace-only name', () => {
    const errors = validatePersona('   ', ['a', 'b', 'c', 'd', 'e'], ['v1', 'v2', 'v3']);
    expect(errors['name']).toBe('Name is required');
  });

  it('fails with too few traits', () => {
    const errors = validatePersona('Aria', ['a', 'b', 'c'], ['v1', 'v2', 'v3']);
    expect(errors['traits']).toBe('Select 5-8 traits');
  });

  it('fails with too many traits', () => {
    const errors = validatePersona('Aria', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], ['v1', 'v2', 'v3']);
    expect(errors['traits']).toBe('Select 5-8 traits');
  });

  it('fails with too few values', () => {
    const errors = validatePersona('Aria', ['a', 'b', 'c', 'd', 'e'], ['v1', 'v2']);
    expect(errors['values']).toBe('Select 3-5 values');
  });

  it('fails with too many values', () => {
    const errors = validatePersona('Aria', ['a', 'b', 'c', 'd', 'e'], ['v1', 'v2', 'v3', 'v4', 'v5', 'v6']);
    expect(errors['values']).toBe('Select 3-5 values');
  });

  it('reports multiple errors at once', () => {
    const errors = validatePersona('', ['a'], ['v1']);
    expect(Object.keys(errors)).toHaveLength(3);
    expect(errors['name']).toBeDefined();
    expect(errors['traits']).toBeDefined();
    expect(errors['values']).toBeDefined();
  });

  it('accepts exactly 5 traits (minimum)', () => {
    const errors = validatePersona('Aria', ['a', 'b', 'c', 'd', 'e'], ['v1', 'v2', 'v3']);
    expect(errors['traits']).toBeUndefined();
  });

  it('accepts exactly 8 traits (maximum)', () => {
    const errors = validatePersona('Aria', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], ['v1', 'v2', 'v3']);
    expect(errors['traits']).toBeUndefined();
  });

  it('accepts exactly 3 values (minimum)', () => {
    const errors = validatePersona('Aria', ['a', 'b', 'c', 'd', 'e'], ['v1', 'v2', 'v3']);
    expect(errors['values']).toBeUndefined();
  });

  it('accepts exactly 5 values (maximum)', () => {
    const errors = validatePersona('Aria', ['a', 'b', 'c', 'd', 'e'], ['v1', 'v2', 'v3', 'v4', 'v5']);
    expect(errors['values']).toBeUndefined();
  });
});

// ============================================================================
// Heartbeat interval formatting
// ============================================================================

describe('Settings heartbeat interval formatting', () => {
  function formatInterval(ms: number): string {
    const mins = Math.round(ms / 60000);
    return `Every ${mins} minute${mins !== 1 ? 's' : ''}`;
  }

  it('formats 1 minute (singular)', () => {
    expect(formatInterval(60000)).toBe('Every 1 minute');
  });

  it('formats 5 minutes', () => {
    expect(formatInterval(300000)).toBe('Every 5 minutes');
  });

  it('formats 30 minutes', () => {
    expect(formatInterval(1800000)).toBe('Every 30 minutes');
  });

  it('rounds to nearest minute', () => {
    expect(formatInterval(90000)).toBe('Every 2 minutes');
  });
});

// ============================================================================
// "Ago" time formatting
// ============================================================================

describe('Settings formatAgo helper', () => {
  function formatAgo(ts: string | null): string {
    if (!ts) return 'Never';
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins === 1) return '1 minute ago';
    return `${mins} minutes ago`;
  }

  it('returns "Never" for null', () => {
    expect(formatAgo(null)).toBe('Never');
  });

  it('returns "Just now" for recent timestamps', () => {
    const recent = new Date(Date.now() - 30000).toISOString();
    expect(formatAgo(recent)).toBe('Just now');
  });

  it('returns "1 minute ago" for ~1 minute', () => {
    const oneMin = new Date(Date.now() - 90000).toISOString();
    expect(formatAgo(oneMin)).toBe('1 minute ago');
  });

  it('returns minutes ago for several minutes', () => {
    const fiveMin = new Date(Date.now() - 5.5 * 60000).toISOString();
    expect(formatAgo(fiveMin)).toBe('5 minutes ago');
  });
});

// ============================================================================
// Values data constants
// ============================================================================

const allValues = [
  { id: 'knowledge', name: 'Knowledge & Truth' },
  { id: 'loyalty', name: 'Loyalty & Devotion' },
  { id: 'freedom', name: 'Freedom & Independence' },
  { id: 'creativity', name: 'Creativity & Expression' },
  { id: 'justice', name: 'Justice & Fairness' },
  { id: 'growth', name: 'Growth & Self-improvement' },
  { id: 'connection', name: 'Connection & Belonging' },
  { id: 'achievement', name: 'Achievement & Excellence' },
  { id: 'harmony', name: 'Harmony & Peace' },
  { id: 'adventure', name: 'Adventure & Discovery' },
  { id: 'compassion', name: 'Compassion & Service' },
  { id: 'authenticity', name: 'Authenticity & Honesty' },
  { id: 'resilience', name: 'Resilience & Perseverance' },
  { id: 'wisdom', name: 'Wisdom & Discernment' },
  { id: 'humor', name: 'Humor & Joy' },
  { id: 'security', name: 'Security & Stability' },
];

describe('Settings values data', () => {
  it('has exactly 16 values', () => {
    expect(allValues).toHaveLength(16);
  });

  it('all value IDs are unique', () => {
    const ids = allValues.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all value names contain &', () => {
    for (const v of allValues) {
      expect(v.name).toContain('&');
    }
  });
});

// ============================================================================
// Goal approval modes
// ============================================================================

describe('Settings goal approval modes', () => {
  const modes = ['always_approve', 'auto_approve', 'full_autonomy'] as const;

  it('has exactly 3 modes', () => {
    expect(modes).toHaveLength(3);
  });

  it('always_approve is the first (default)', () => {
    expect(modes[0]).toBe('always_approve');
  });
});

// ============================================================================
// Password validation
// ============================================================================

describe('Settings password validation', () => {
  function validatePassword(newPassword: string, confirmPassword: string): string {
    if (newPassword.length < 8) return 'Password must be at least 8 characters';
    if (newPassword !== confirmPassword) return 'Passwords do not match';
    return '';
  }

  it('passes with valid matching passwords', () => {
    expect(validatePassword('securepass', 'securepass')).toBe('');
  });

  it('fails when too short', () => {
    expect(validatePassword('short', 'short')).toBe('Password must be at least 8 characters');
  });

  it('fails when passwords do not match', () => {
    expect(validatePassword('securepass1', 'securepass2')).toBe('Passwords do not match');
  });

  it('checks length before match', () => {
    expect(validatePassword('short', 'other')).toBe('Password must be at least 8 characters');
  });

  it('passes with exactly 8 characters', () => {
    expect(validatePassword('12345678', '12345678')).toBe('');
  });
});

// ============================================================================
// Channel definitions
// ============================================================================

describe('Settings channel definitions', () => {
  const channelDefs = [
    { type: 'web', alwaysOn: true },
    { type: 'sms', alwaysOn: false },
    { type: 'discord', alwaysOn: false },
    { type: 'openai_api', alwaysOn: true },
  ];

  it('has 4 channel types', () => {
    expect(channelDefs).toHaveLength(4);
  });

  it('web and API are always on', () => {
    const alwaysOn = channelDefs.filter((c) => c.alwaysOn);
    expect(alwaysOn.map((c) => c.type).sort()).toEqual(['openai_api', 'web']);
  });

  it('SMS and Discord are configurable', () => {
    const configurable = channelDefs.filter((c) => !c.alwaysOn);
    expect(configurable.map((c) => c.type).sort()).toEqual(['discord', 'sms']);
  });
});

// ============================================================================
// Discord guild ID parsing
// ============================================================================

describe('Settings Discord guild ID parsing', () => {
  function parseGuildIds(input: string): string[] {
    return input.split(',').map((s) => s.trim()).filter(Boolean);
  }

  it('parses single guild ID', () => {
    expect(parseGuildIds('12345')).toEqual(['12345']);
  });

  it('parses comma-separated IDs', () => {
    expect(parseGuildIds('111,222,333')).toEqual(['111', '222', '333']);
  });

  it('handles spaces around commas', () => {
    expect(parseGuildIds('111 , 222 , 333')).toEqual(['111', '222', '333']);
  });

  it('filters empty entries', () => {
    expect(parseGuildIds('111,,333,')).toEqual(['111', '333']);
  });

  it('handles empty input', () => {
    expect(parseGuildIds('')).toEqual([]);
  });
});
