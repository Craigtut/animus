import { describe, it, expect } from 'vitest';
import { estimateTokens } from '../../src/token-estimator.js';

describe('estimateTokens', () => {
  it('returns 0 for an empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('returns 0 for a whitespace-only string', () => {
    expect(estimateTokens('   ')).toBe(0);
    expect(estimateTokens('\n\t  \n')).toBe(0);
  });

  it('estimates a single word as 2 tokens (ceil(1 * 1.3) = 2)', () => {
    expect(estimateTokens('hello')).toBe(2);
  });

  it('estimates 10 words as 13 tokens (ceil(10 * 1.3) = 13)', () => {
    expect(estimateTokens('one two three four five six seven eight nine ten')).toBe(13);
  });

  it('estimates 5 words as 7 tokens (ceil(5 * 1.3) = 7)', () => {
    expect(estimateTokens('the quick brown fox jumped')).toBe(7);
  });

  it('handles multiple spaces between words', () => {
    expect(estimateTokens('hello    world')).toBe(3); // 2 words -> ceil(2 * 1.3) = 3
  });

  it('handles tabs and newlines as whitespace', () => {
    expect(estimateTokens('hello\tworld\nfoo')).toBe(4); // 3 words -> ceil(3 * 1.3) = 4
  });

  it('handles leading and trailing whitespace', () => {
    expect(estimateTokens('  hello world  ')).toBe(3); // 2 words -> ceil(2 * 1.3) = 3
  });

  it('handles a longer text passage', () => {
    const text = 'The quick brown fox jumps over the lazy dog near the river bank';
    // 13 words -> ceil(13 * 1.3) = ceil(16.9) = 17
    expect(estimateTokens(text)).toBe(17);
  });

  it('handles text with punctuation (words include punctuation)', () => {
    const text = 'Hello, world! How are you?';
    // 5 words (whitespace-split) -> ceil(5 * 1.3) = 7
    expect(estimateTokens(text)).toBe(7);
  });

  it('handles code-like content', () => {
    const text = 'const x = 42;';
    // 4 words -> ceil(4 * 1.3) = ceil(5.2) = 6
    expect(estimateTokens(text)).toBe(6);
  });
});
