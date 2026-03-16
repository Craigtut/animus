import { describe, it, expect } from 'vitest';
import { classifyError } from '../../src/error-classifier.js';

describe('classifyError', () => {
  // -----------------------------------------------------------------------
  // Cancelled
  // -----------------------------------------------------------------------
  describe('cancelled', () => {
    it('classifies as cancelled when wasAborted is true', () => {
      const result = classifyError('Some random error', { wasAborted: true });
      expect(result.category).toBe('cancelled');
      expect(result.severity).toBe('recoverable');
      expect(result.suggestedAction).toBeUndefined();
    });

    it('cancelled takes priority over all other patterns', () => {
      // Even if the message matches authentication, wasAborted wins
      const result = classifyError('invalid api key', { wasAborted: true });
      expect(result.category).toBe('cancelled');
    });
  });

  // -----------------------------------------------------------------------
  // Authentication
  // -----------------------------------------------------------------------
  describe('authentication', () => {
    const authMessages = [
      'invalid api key provided',
      'Unauthorized access to resource',
      'User is not logged in',
      'Authentication required for this endpoint',
      'Your expired token cannot be used',
      'The invalid credentials were rejected',
      'Your api key is invalid',
      'Permission denied for this key',
      'Could not resolve API key for provider anthropic',
    ];

    for (const msg of authMessages) {
      it(`classifies "${msg}" as authentication`, () => {
        const result = classifyError(msg);
        expect(result.category).toBe('authentication');
        expect(result.severity).toBe('fatal');
        expect(result.suggestedAction).toBe(
          'Check your API key or re-authenticate in Settings.',
        );
      });
    }

    it('classifies Error objects as authentication', () => {
      const result = classifyError(new Error('Invalid API key'));
      expect(result.category).toBe('authentication');
    });
  });

  // -----------------------------------------------------------------------
  // Rate Limit
  // -----------------------------------------------------------------------
  describe('rate_limit', () => {
    const rateLimitMessages = [
      'Rate limit exceeded for this API',
      'Too many requests, please slow down',
      'HTTP 429: rate limit',
      'rate_limit_exceeded: try again later',
      'Request was throttled by the server',
      'Request limit reached for the day',
      'Quota exceeded for this billing period',
    ];

    for (const msg of rateLimitMessages) {
      it(`classifies "${msg}" as rate_limit`, () => {
        const result = classifyError(msg);
        expect(result.category).toBe('rate_limit');
        expect(result.severity).toBe('retry');
        expect(result.suggestedAction).toBe(
          'Rate limit hit. The next tick will be delayed.',
        );
      });
    }
  });

  // -----------------------------------------------------------------------
  // Context Overflow
  // -----------------------------------------------------------------------
  describe('context_overflow', () => {
    // Minimal fallback patterns (full detection delegates to pi-ai's isContextOverflow)
    const overflowMessages = [
      'context overflow detected',
      'Too many tokens in the request',
      'token limit reached for model',
      'prompt is too long for the model',
    ];

    for (const msg of overflowMessages) {
      it(`classifies "${msg}" as context_overflow`, () => {
        const result = classifyError(msg);
        expect(result.category).toBe('context_overflow');
        expect(result.severity).toBe('recoverable');
        expect(result.suggestedAction).toBe(
          'Context window exceeded. Compaction will run.',
        );
      });
    }
  });

  // -----------------------------------------------------------------------
  // Server Error
  // -----------------------------------------------------------------------
  describe('server_error', () => {
    const serverMessages = [
      'Internal server error occurred',
      'HTTP 500 response',
      '502 bad gateway from upstream',
      '503 service unavailable temporarily',
      '504 gateway timeout waiting for response',
      'The server returned an error',
      'The service is overloaded, try again',
    ];

    for (const msg of serverMessages) {
      it(`classifies "${msg}" as server_error`, () => {
        const result = classifyError(msg);
        expect(result.category).toBe('server_error');
        expect(result.severity).toBe('retry');
        expect(result.suggestedAction).toBe(
          'The provider is experiencing issues. Retrying.',
        );
      });
    }
  });

  // -----------------------------------------------------------------------
  // Network
  // -----------------------------------------------------------------------
  describe('network', () => {
    const networkMessages = [
      'connect ECONNREFUSED 127.0.0.1:443',
      'getaddrinfo ENOTFOUND api.example.com',
      'connect ETIMEDOUT 10.0.0.1:443',
      'read ECONNRESET by peer',
      'A network error occurred during the request',
      'TypeError: fetch failed',
      'socket hang up during TLS handshake',
      'DNS resolution failed for api.anthropic.com',
    ];

    for (const msg of networkMessages) {
      it(`classifies "${msg}" as network`, () => {
        const result = classifyError(msg);
        expect(result.category).toBe('network');
        expect(result.severity).toBe('retry');
        expect(result.suggestedAction).toBe(
          'Network error. Check your connection.',
        );
      });
    }
  });

  // -----------------------------------------------------------------------
  // Unknown
  // -----------------------------------------------------------------------
  describe('unknown', () => {
    it('classifies unrecognized errors as unknown', () => {
      const result = classifyError('Something completely unexpected happened');
      expect(result.category).toBe('unknown');
      expect(result.severity).toBe('recoverable');
      expect(result.suggestedAction).toBeUndefined();
    });

    it('preserves the original message in the result', () => {
      const msg = 'A very specific and unique error message 12345';
      const result = classifyError(msg);
      expect(result.originalMessage).toBe(msg);
    });
  });

  // -----------------------------------------------------------------------
  // Priority ordering
  // -----------------------------------------------------------------------
  describe('priority ordering', () => {
    it('authentication takes priority over rate_limit for ambiguous messages', () => {
      // A message that could match both auth and rate limit patterns
      // "unauthorized" matches authentication; "429" matches rate_limit
      // But since auth is checked first, it should win
      const result = classifyError('unauthorized request returned 429');
      expect(result.category).toBe('authentication');
    });

    it('authentication takes priority over server_error', () => {
      // "unauthorized" matches auth; "server error" matches server_error
      const result = classifyError('unauthorized server error');
      expect(result.category).toBe('authentication');
    });

    it('rate_limit takes priority over server_error for 429 messages', () => {
      // "429" matches rate_limit; could potentially match other patterns
      const result = classifyError('Error 429 from server');
      expect(result.category).toBe('rate_limit');
    });

    it('server_error takes priority over network', () => {
      // "internal server error" matches server_error
      const result = classifyError('internal server error with ECONNRESET');
      expect(result.category).toBe('server_error');
    });
  });

  // -----------------------------------------------------------------------
  // Error object handling
  // -----------------------------------------------------------------------
  describe('Error object handling', () => {
    it('extracts message from Error objects', () => {
      const error = new Error('Rate limit exceeded');
      const result = classifyError(error);
      expect(result.category).toBe('rate_limit');
      expect(result.originalMessage).toBe('Rate limit exceeded');
    });

    it('handles string errors directly', () => {
      const result = classifyError('ECONNREFUSED');
      expect(result.category).toBe('network');
      expect(result.originalMessage).toBe('ECONNREFUSED');
    });
  });

  // -----------------------------------------------------------------------
  // Options
  // -----------------------------------------------------------------------
  describe('options', () => {
    it('ignores wasAborted when false', () => {
      const result = classifyError('Rate limit exceeded', { wasAborted: false });
      expect(result.category).toBe('rate_limit');
    });

    it('ignores wasAborted when undefined', () => {
      const result = classifyError('Rate limit exceeded', {});
      expect(result.category).toBe('rate_limit');
    });

    it('accepts contextWindow option without affecting basic classification', () => {
      const result = classifyError('Some unknown error', { contextWindow: 128000 });
      expect(result.category).toBe('unknown');
    });
  });
});
