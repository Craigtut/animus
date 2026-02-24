import { describe, it, expect, vi } from 'vitest';

// Mock env before importing modules that depend on logger -> env
vi.mock('../../../src/utils/env.js', () => ({
  env: { ANIMUS_ENCRYPTION_KEY: 'test-key', NODE_ENV: 'test', LOG_LEVEL: 'error' },
  PROJECT_ROOT: '/tmp/animus-test',
  DATA_DIR: '/tmp/animus-test/data',
}));

import {
  buildReflectorSystemPrompt,
  buildReflectorUserMessage,
  parseReflectorOutput,
  validateCompression,
} from '../../../src/memory/observational-memory/reflector.js';

describe('reflector', () => {
  const mockPersona = 'You are Animus, a thoughtful AI assistant.';

  describe('buildReflectorSystemPrompt', () => {
    it('includes compiled persona when provided', () => {
      const prompt = buildReflectorSystemPrompt('messages', mockPersona);
      expect(prompt).toContain(mockPersona);
      expect(prompt).toContain('---');
    });

    it('omits persona section when empty', () => {
      const prompt = buildReflectorSystemPrompt('messages', '');
      expect(prompt).not.toContain('---');
      expect(prompt).toContain('# Reflection Task');
    });

    it('includes the stream type in the prompt', () => {
      const prompt = buildReflectorSystemPrompt('thoughts', mockPersona);
      expect(prompt).toContain('thoughts observations');
    });

    it('includes key reflection principles', () => {
      const prompt = buildReflectorSystemPrompt('messages', mockPersona);
      expect(prompt).toContain('Completeness');
      expect(prompt).toContain('Recency bias');
      expect(prompt).toContain('User assertions take precedence');
      expect(prompt).toContain('Temporal preservation');
      expect(prompt).toContain('Merge related entries');
    });

    it('includes output format instructions', () => {
      const prompt = buildReflectorSystemPrompt('experiences', mockPersona);
      expect(prompt).toContain('Date: Mon DD, YYYY');
      expect(prompt).toContain('HIGH');
      expect(prompt).toContain('MEDIUM');
      expect(prompt).toContain('LOW');
    });
  });

  describe('buildReflectorUserMessage', () => {
    const observations = `Date: Feb 13, 2026
* HIGH (09:00) User has 3 kids
Date: Feb 14, 2026
* MEDIUM (10:00) User working on auth`;

    it('includes observations', () => {
      const msg = buildReflectorUserMessage(observations, 0);
      expect(msg).toContain('Observations to Reflect On');
      expect(msg).toContain(observations);
    });

    it('has no compression guidance at level 0', () => {
      const msg = buildReflectorUserMessage(observations, 0);
      expect(msg).not.toContain('previous output was still too large');
      expect(msg).not.toContain('CRITICAL');
    });

    it('includes gentle guidance at level 1', () => {
      const msg = buildReflectorUserMessage(observations, 1);
      expect(msg).toContain('previous output was still too large');
      expect(msg).toContain('8/10');
      expect(msg).toContain('condense more aggressively');
    });

    it('includes aggressive guidance at level 2', () => {
      const msg = buildReflectorUserMessage(observations, 2);
      expect(msg).toContain('CRITICAL');
      expect(msg).toContain('6/10');
      expect(msg).toContain('heavy compression');
    });
  });

  describe('parseReflectorOutput', () => {
    it('extracts date-grouped observations', () => {
      const raw = `After reviewing, here are the consolidated observations:

Date: Feb 14, 2026
* HIGH (10:00) User has 3 kids: Emma (12), Jake (9), Lily (5)
* MEDIUM (10:30) Working on auth refactor

That should cover it.`;

      const result = parseReflectorOutput(raw);
      expect(result.observations).toContain('Date: Feb 14, 2026');
      expect(result.observations).toContain('User has 3 kids');
      expect(result.observations).not.toContain('After reviewing');
      expect(result.observations).not.toContain('That should cover it');
    });

    it('handles output with no preamble', () => {
      const raw = `Date: Feb 14, 2026
* HIGH (10:00) Important fact`;

      const result = parseReflectorOutput(raw);
      expect(result.observations).toBe(raw);
    });

    it('returns empty string for empty output', () => {
      expect(parseReflectorOutput('').observations).toBe('');
    });

    it('accepts unstructured output when no date headers found', () => {
      const raw = 'User seems interested in databases.';
      const result = parseReflectorOutput(raw);
      expect(result.observations).toBe(raw);
    });
  });

  describe('validateCompression', () => {
    it('returns true when tokens are under threshold', () => {
      expect(validateCompression(500, 1000)).toBe(true);
    });

    it('returns true when tokens equal threshold', () => {
      expect(validateCompression(1000, 1000)).toBe(true);
    });

    it('returns false when tokens exceed threshold', () => {
      expect(validateCompression(1500, 1000)).toBe(false);
    });
  });
});
