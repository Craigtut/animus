/**
 * Approval Phrases Tests — deterministic phrase matching for tool approvals.
 */

import { describe, it, expect } from 'vitest';
import {
  APPROVAL_PHRASES,
  DENIAL_PHRASES,
  matchApprovalPhrase,
} from '../../src/tools/approval-phrases.js';

describe('matchApprovalPhrase', () => {
  describe('approval phrases', () => {
    const approvalWords = Array.from(APPROVAL_PHRASES);

    it.each(approvalWords)('recognizes "%s" as approval', (phrase) => {
      expect(matchApprovalPhrase(phrase)).toBe('approve');
    });

    it('is case-insensitive', () => {
      expect(matchApprovalPhrase('YES')).toBe('approve');
      expect(matchApprovalPhrase('Approve')).toBe('approve');
      expect(matchApprovalPhrase('Go Ahead')).toBe('approve');
    });

    it('trims whitespace', () => {
      expect(matchApprovalPhrase('  yes  ')).toBe('approve');
      expect(matchApprovalPhrase('\tapprove\n')).toBe('approve');
    });
  });

  describe('denial phrases', () => {
    const denialWords = Array.from(DENIAL_PHRASES);

    it.each(denialWords)('recognizes "%s" as denial', (phrase) => {
      expect(matchApprovalPhrase(phrase)).toBe('deny');
    });

    it('is case-insensitive', () => {
      expect(matchApprovalPhrase('NO')).toBe('deny');
      expect(matchApprovalPhrase('Deny')).toBe('deny');
      expect(matchApprovalPhrase('ABSOLUTELY NOT')).toBe('deny');
    });

    it('trims whitespace', () => {
      expect(matchApprovalPhrase('  no  ')).toBe('deny');
      expect(matchApprovalPhrase('\tdeny\n')).toBe('deny');
    });
  });

  describe('non-matching input', () => {
    it('returns null for empty string', () => {
      expect(matchApprovalPhrase('')).toBeNull();
    });

    it('returns null for whitespace-only', () => {
      expect(matchApprovalPhrase('   ')).toBeNull();
    });

    it('returns null for partial matches in longer sentences', () => {
      expect(matchApprovalPhrase('I approve of that')).toBeNull();
      expect(matchApprovalPhrase('yes please do it now')).toBeNull();
      expect(matchApprovalPhrase('no I think we should wait')).toBeNull();
    });

    it('returns null for unrecognized words', () => {
      expect(matchApprovalPhrase('maybe')).toBeNull();
      expect(matchApprovalPhrase('hello')).toBeNull();
      expect(matchApprovalPhrase('hmm')).toBeNull();
    });
  });

  describe('phrase sets', () => {
    it('has no overlap between approval and denial phrases', () => {
      for (const phrase of APPROVAL_PHRASES) {
        expect(DENIAL_PHRASES.has(phrase)).toBe(false);
      }
    });

    it('all entries are lowercase', () => {
      for (const phrase of APPROVAL_PHRASES) {
        expect(phrase).toBe(phrase.toLowerCase());
      }
      for (const phrase of DENIAL_PHRASES) {
        expect(phrase).toBe(phrase.toLowerCase());
      }
    });
  });
});
