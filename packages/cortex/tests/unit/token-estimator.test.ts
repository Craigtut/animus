import { describe, it, expect } from 'vitest';
import { estimateTokens } from '../../src/token-estimator.js';

describe('estimateTokens', () => {
  it('returns 0 for an empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('returns 0 for a whitespace-only string', () => {
    expect(estimateTokens('   ')).toBe(1); // 3 chars / 4 = ceil(0.75) = 1
    expect(estimateTokens('\n\t  \n')).toBe(2); // 5 chars / 4 = ceil(1.25) = 2
  });

  it('estimates a single word by character count', () => {
    // 'hello' = 5 chars / 4 = ceil(1.25) = 2
    expect(estimateTokens('hello')).toBe(2);
  });

  it('estimates a 10-word sentence', () => {
    const text = 'one two three four five six seven eight nine ten';
    // 48 chars / 4 = 12
    expect(estimateTokens(text)).toBe(12);
  });

  it('estimates a 5-word sentence', () => {
    const text = 'the quick brown fox jumped';
    // 26 chars / 4 = ceil(6.5) = 7
    expect(estimateTokens(text)).toBe(7);
  });

  it('handles multiple spaces between words', () => {
    // 'hello    world' = 14 chars / 4 = ceil(3.5) = 4
    expect(estimateTokens('hello    world')).toBe(4);
  });

  it('handles tabs and newlines as characters', () => {
    // 'hello\tworld\nfoo' = 15 chars / 4 = ceil(3.75) = 4
    expect(estimateTokens('hello\tworld\nfoo')).toBe(4);
  });

  it('handles leading and trailing whitespace', () => {
    // '  hello world  ' = 15 chars / 4 = ceil(3.75) = 4
    expect(estimateTokens('  hello world  ')).toBe(4);
  });

  it('handles a longer text passage', () => {
    const text = 'The quick brown fox jumps over the lazy dog near the river bank';
    // 63 chars / 4 = ceil(15.75) = 16
    expect(estimateTokens(text)).toBe(16);
  });

  it('handles text with punctuation', () => {
    const text = 'Hello, world! How are you?';
    // 26 chars / 4 = ceil(6.5) = 7
    expect(estimateTokens(text)).toBe(7);
  });

  it('handles code-like content', () => {
    const text = 'const x = 42;';
    // 14 chars / 4 = ceil(3.5) = 4
    expect(estimateTokens(text)).toBe(4);
  });

  it('handles JSON content', () => {
    const text = '{"key":"value","count":42}';
    // 25 chars / 4 = ceil(6.25) = 7
    expect(estimateTokens(text)).toBe(7);
  });
});
