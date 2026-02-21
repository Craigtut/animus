import { describe, it, expect } from 'vitest';
import { isNonResponse } from '../../src/heartbeat/cognitive-tools.js';

describe('isNonResponse', () => {
  it('returns true for empty/whitespace-only text', () => {
    expect(isNonResponse('')).toBe(true);
    expect(isNonResponse('  ')).toBe(true);
    expect(isNonResponse('\n')).toBe(true);
  });

  it('matches "No response requested" variants', () => {
    expect(isNonResponse('No response requested.')).toBe(true);
    expect(isNonResponse('No response requested')).toBe(true);
    expect(isNonResponse('No response needed.')).toBe(true);
    expect(isNonResponse('No response required.')).toBe(true);
    expect(isNonResponse('No response necessary.')).toBe(true);
    expect(isNonResponse('NO RESPONSE REQUESTED.')).toBe(true);
    expect(isNonResponse('  No response requested.  ')).toBe(true);
  });

  it('matches "No reply" variants', () => {
    expect(isNonResponse('No reply needed.')).toBe(true);
    expect(isNonResponse('No reply requested.')).toBe(true);
    expect(isNonResponse('No reply required')).toBe(true);
    expect(isNonResponse('No reply necessary')).toBe(true);
  });

  it('matches "No message" variants', () => {
    expect(isNonResponse('No message needed.')).toBe(true);
    expect(isNonResponse('No message requested.')).toBe(true);
  });

  it('matches bracket/paren variants', () => {
    expect(isNonResponse('[No response]')).toBe(true);
    expect(isNonResponse('[No reply]')).toBe(true);
    expect(isNonResponse('(No response)')).toBe(true);
    expect(isNonResponse('(No reply)')).toBe(true);
  });

  it('matches N/A', () => {
    expect(isNonResponse('N/A')).toBe(true);
    expect(isNonResponse('N/A.')).toBe(true);
    expect(isNonResponse('n/a')).toBe(true);
  });

  it('does NOT match legitimate replies containing non-response words', () => {
    expect(isNonResponse('No response requested, but I wanted to say hi!')).toBe(false);
    expect(isNonResponse('There was no response needed from the server.')).toBe(false);
    expect(isNonResponse('Hello! How are you?')).toBe(false);
    expect(isNonResponse('The API returned N/A for the missing field.')).toBe(false);
  });

  it('does NOT match normal reply text', () => {
    expect(isNonResponse('Sure, I can help with that!')).toBe(false);
    expect(isNonResponse('Here is the information you requested.')).toBe(false);
    expect(isNonResponse('I appreciate you reaching out.')).toBe(false);
  });
});
