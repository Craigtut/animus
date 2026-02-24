import { describe, it, expect, vi } from 'vitest';

// Mock env before importing modules that depend on logger -> env
vi.mock('../../../src/utils/env.js', () => ({
  env: { ANIMUS_ENCRYPTION_KEY: 'test-key', NODE_ENV: 'test', LOG_LEVEL: 'error' },
  PROJECT_ROOT: '/tmp/animus-test',
  DATA_DIR: '/tmp/animus-test/data',
}));

import {
  buildObserverSystemPrompt,
  buildObserverUserMessage,
  parseObserverOutput,
} from '../../../src/memory/observational-memory/observer.js';

describe('observer', () => {
  const mockPersona = 'You are Animus, a thoughtful AI assistant.';

  describe('buildObserverSystemPrompt', () => {
    it('includes compiled persona when provided', () => {
      const prompt = buildObserverSystemPrompt('messages', mockPersona);
      expect(prompt).toContain(mockPersona);
      expect(prompt).toContain('---');
    });

    it('omits persona section when empty', () => {
      const prompt = buildObserverSystemPrompt('messages', '');
      expect(prompt).not.toContain('---');
      expect(prompt).toContain('# Observation Task');
    });

    it('includes message-specific instructions for messages stream', () => {
      const prompt = buildObserverSystemPrompt('messages', mockPersona);
      expect(prompt).toContain('User assertions');
      expect(prompt).toContain('Temporal anchoring');
      expect(prompt).toContain('State change');
    });

    it('includes thought-specific instructions for thoughts stream', () => {
      const prompt = buildObserverSystemPrompt('thoughts', mockPersona);
      expect(prompt).toContain('Recurring patterns');
      expect(prompt).toContain('Goal-related reasoning');
      expect(prompt).toContain('Self-reflections');
    });

    it('includes experience-specific instructions for experiences stream', () => {
      const prompt = buildObserverSystemPrompt('experiences', mockPersona);
      expect(prompt).toContain('Significant events');
      expect(prompt).toContain('Sub-agent results');
      expect(prompt).toContain('Emotional milestones');
    });

    it('includes common format instructions', () => {
      const prompt = buildObserverSystemPrompt('messages', mockPersona);
      expect(prompt).toContain('Date: Mon DD, YYYY');
      expect(prompt).toContain('HIGH');
      expect(prompt).toContain('MEDIUM');
      expect(prompt).toContain('LOW');
    });
  });

  describe('buildObserverUserMessage', () => {
    it('includes batch items', () => {
      const items = ['[2026-02-14 10:00] Hello', '[2026-02-14 10:01] World'];
      const msg = buildObserverUserMessage(items, null);
      expect(msg).toContain('[2026-02-14 10:00] Hello');
      expect(msg).toContain('[2026-02-14 10:01] World');
      expect(msg).toContain('New Items to Observe');
    });

    it('includes existing observations when provided', () => {
      const existing = 'Date: Feb 13, 2026\n* HIGH (09:00) User likes coffee';
      const items = ['[2026-02-14 10:00] New message'];
      const msg = buildObserverUserMessage(items, existing);
      expect(msg).toContain('Existing Observations');
      expect(msg).toContain(existing);
      expect(msg).toContain('do not duplicate');
    });

    it('omits existing observations section when null', () => {
      const items = ['[2026-02-14 10:00] New message'];
      const msg = buildObserverUserMessage(items, null);
      expect(msg).not.toContain('Existing Observations');
    });
  });

  describe('parseObserverOutput', () => {
    it('extracts date-grouped observations', () => {
      const raw = `Here are the observations:

Date: Feb 14, 2026
* HIGH (10:00) User mentioned they have a dog named Max
* MEDIUM (10:05) User asked about Python debugging

That covers the batch.`;

      const result = parseObserverOutput(raw);
      expect(result.observations).toContain('Date: Feb 14, 2026');
      expect(result.observations).toContain('User mentioned they have a dog named Max');
      expect(result.observations).toContain('User asked about Python debugging');
      expect(result.observations).not.toContain('Here are the observations');
      expect(result.observations).not.toContain('That covers the batch');
    });

    it('handles output with no preamble', () => {
      const raw = `Date: Feb 14, 2026
* HIGH (10:00) Important fact`;

      const result = parseObserverOutput(raw);
      expect(result.observations).toBe('Date: Feb 14, 2026\n* HIGH (10:00) Important fact');
    });

    it('handles multiple date groups', () => {
      const raw = `Date: Feb 13, 2026
* MEDIUM (14:00) First observation

Date: Feb 14, 2026
* HIGH (09:00) Second observation`;

      const result = parseObserverOutput(raw);
      expect(result.observations).toContain('Date: Feb 13, 2026');
      expect(result.observations).toContain('Date: Feb 14, 2026');
    });

    it('returns empty string for empty output', () => {
      expect(parseObserverOutput('').observations).toBe('');
      expect(parseObserverOutput('   ').observations).toBe('');
    });

    it('rejects unstructured output when no date headers found', () => {
      const raw = 'The user seems interested in databases.';
      const result = parseObserverOutput(raw);
      expect(result.observations).toBe('');
    });

    it('preserves sub-bullets', () => {
      const raw = `Date: Feb 14, 2026
* MEDIUM (14:00) Mind debugging auth issue
  * -> ran git status, found 3 modified files
  * -> applied fix, tests now pass`;

      const result = parseObserverOutput(raw);
      expect(result.observations).toContain('-> ran git status');
      expect(result.observations).toContain('-> applied fix');
    });
  });
});
