import { describe, it, expect } from 'vitest';
import {
  isNonResponse,
  hasValidExperienceContent,
  recordCognitiveStateSchema,
} from '../../src/heartbeat/cognitive-tools.js';

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

describe('hasValidExperienceContent', () => {
  it('returns false for null/undefined/non-object', () => {
    expect(hasValidExperienceContent(null)).toBe(false);
    expect(hasValidExperienceContent(undefined)).toBe(false);
  });

  it('returns false when the model returns an empty object (the punt case)', () => {
    // This is the exact failure the enforcement targets: the model calls
    // record_cognitive_state with no fields on a quiet tick.
    expect(hasValidExperienceContent({})).toBe(false);
  });

  it('returns false when experience is missing', () => {
    expect(hasValidExperienceContent({ emotionDeltas: [], decisions: [] })).toBe(false);
  });

  it('returns false when experience.content is missing, empty, or blank', () => {
    expect(hasValidExperienceContent({ experience: {} })).toBe(false);
    expect(hasValidExperienceContent({ experience: { content: '' } })).toBe(false);
    expect(hasValidExperienceContent({ experience: { content: '   \n  ' } })).toBe(false);
  });

  it('returns false when experience.content is not a string', () => {
    expect(hasValidExperienceContent({ experience: { content: 42 } })).toBe(false);
    expect(hasValidExperienceContent({ experience: { content: null } })).toBe(false);
  });

  it('returns true when experience.content is a non-empty string', () => {
    expect(
      hasValidExperienceContent({
        experience: { content: 'Cleo read on the couch as gold light warmed her shins.', importance: 0.4 },
      }),
    ).toBe(true);
  });
});

describe('recordCognitiveStateSchema experience field', () => {
  it('requires experience.content to be present and non-empty', () => {
    // Missing experience entirely fails validation.
    expect(recordCognitiveStateSchema.safeParse({ decisions: [], emotionDeltas: [], memoryCandidate: [] }).success).toBe(false);
    // Empty content string fails (min(1)).
    expect(
      recordCognitiveStateSchema.safeParse({
        experience: { content: '', importance: 0.2 },
        decisions: [],
        emotionDeltas: [],
        memoryCandidate: [],
      }).success,
    ).toBe(false);
  });

  it('accepts a well-formed experience', () => {
    const result = recordCognitiveStateSchema.safeParse({
      experience: { content: 'Cleo turned another page.', importance: 0.3 },
      decisions: [],
      emotionDeltas: [],
      memoryCandidate: [],
    });
    expect(result.success).toBe(true);
  });
});
