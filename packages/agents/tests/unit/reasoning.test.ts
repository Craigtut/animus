import { describe, it, expect } from 'vitest';
import { getCodexReasoningEffort, type ReasoningEffort } from '../../src/reasoning.js';

describe('getCodexReasoningEffort', () => {
  it('maps low to low', () => {
    expect(getCodexReasoningEffort('low')).toBe('low');
  });

  it('maps medium to medium', () => {
    expect(getCodexReasoningEffort('medium')).toBe('medium');
  });

  it('maps high to high', () => {
    expect(getCodexReasoningEffort('high')).toBe('high');
  });

  it('maps max to xhigh', () => {
    expect(getCodexReasoningEffort('max')).toBe('xhigh');
  });

  it('handles all valid levels', () => {
    const levels: ReasoningEffort[] = ['low', 'medium', 'high', 'max'];
    const expected = ['low', 'medium', 'high', 'xhigh'];

    levels.forEach((level, i) => {
      expect(getCodexReasoningEffort(level)).toBe(expected[i]);
    });
  });
});
