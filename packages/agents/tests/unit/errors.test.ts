/**
 * Tests for error utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  AgentError,
  httpStatusToCategory,
  categoryToSeverity,
  wrapError,
} from '../../src/errors.js';

describe('AgentError', () => {
  it('creates an error with all required fields', () => {
    const error = new AgentError({
      code: 'TEST_ERROR',
      message: 'Test error message',
      category: 'execution',
      severity: 'recoverable',
      provider: 'claude',
    });

    expect(error.code).toBe('TEST_ERROR');
    expect(error.message).toBe('Test error message');
    expect(error.category).toBe('execution');
    expect(error.severity).toBe('recoverable');
    expect(error.provider).toBe('claude');
    expect(error.name).toBe('AgentError');
    expect(error.timestamp).toBeDefined();
  });

  it('creates an error with optional fields', () => {
    const error = new AgentError({
      code: 'TEST_ERROR',
      message: 'Test error',
      category: 'authentication',
      severity: 'fatal',
      provider: 'codex',
      sessionId: 'session-123',
      details: {
        originalError: new Error('Original'),
        toolName: 'Read',
      },
    });

    expect(error.sessionId).toBe('session-123');
    expect(error.details?.toolName).toBe('Read');
  });

  it('isRetryable returns true for retry severity', () => {
    const error = new AgentError({
      code: 'RATE_LIMIT',
      message: 'Rate limited',
      category: 'rate_limit',
      severity: 'retry',
      provider: 'claude',
    });

    expect(error.isRetryable).toBe(true);
    expect(error.isFatal).toBe(false);
  });

  it('isFatal returns true for fatal severity', () => {
    const error = new AgentError({
      code: 'AUTH_FAILED',
      message: 'Auth failed',
      category: 'authentication',
      severity: 'fatal',
      provider: 'claude',
    });

    expect(error.isFatal).toBe(true);
    expect(error.isRetryable).toBe(false);
  });

  it('toJSON serializes all fields', () => {
    const error = new AgentError({
      code: 'TEST_ERROR',
      message: 'Test',
      category: 'execution',
      severity: 'recoverable',
      provider: 'opencode',
    });

    const json = error.toJSON();

    expect(json.name).toBe('AgentError');
    expect(json.code).toBe('TEST_ERROR');
    expect(json.provider).toBe('opencode');
  });

  it('toString returns formatted message', () => {
    const error = new AgentError({
      code: 'TEST_ERROR',
      message: 'Test message',
      category: 'execution',
      severity: 'recoverable',
      provider: 'claude',
    });

    expect(error.toString()).toBe('[claude] TEST_ERROR: Test message');
  });
});

describe('httpStatusToCategory', () => {
  it('maps 401 to authentication', () => {
    expect(httpStatusToCategory(401)).toBe('authentication');
  });

  it('maps 403 to authorization', () => {
    expect(httpStatusToCategory(403)).toBe('authorization');
  });

  it('maps 404 to not_found', () => {
    expect(httpStatusToCategory(404)).toBe('not_found');
  });

  it('maps 429 to rate_limit', () => {
    expect(httpStatusToCategory(429)).toBe('rate_limit');
  });

  it('maps 408 to timeout', () => {
    expect(httpStatusToCategory(408)).toBe('timeout');
  });

  it('maps 4xx to invalid_input', () => {
    expect(httpStatusToCategory(400)).toBe('invalid_input');
    expect(httpStatusToCategory(422)).toBe('invalid_input');
  });

  it('maps 5xx to server_error', () => {
    expect(httpStatusToCategory(500)).toBe('server_error');
    expect(httpStatusToCategory(503)).toBe('server_error');
  });

  it('maps unknown to unknown', () => {
    expect(httpStatusToCategory(200)).toBe('unknown');
  });
});

describe('categoryToSeverity', () => {
  it('maps authentication to fatal', () => {
    expect(categoryToSeverity('authentication')).toBe('fatal');
  });

  it('maps authorization to fatal', () => {
    expect(categoryToSeverity('authorization')).toBe('fatal');
  });

  it('maps rate_limit to retry', () => {
    expect(categoryToSeverity('rate_limit')).toBe('retry');
  });

  it('maps timeout to retry', () => {
    expect(categoryToSeverity('timeout')).toBe('retry');
  });

  it('maps execution to recoverable', () => {
    expect(categoryToSeverity('execution')).toBe('recoverable');
  });
});

describe('wrapError', () => {
  it('returns existing AgentError unchanged', () => {
    const original = new AgentError({
      code: 'ORIGINAL',
      message: 'Original error',
      category: 'execution',
      severity: 'recoverable',
      provider: 'claude',
    });

    const wrapped = wrapError(original, 'codex');

    expect(wrapped).toBe(original);
    expect(wrapped.provider).toBe('claude'); // Not changed
  });

  it('wraps Error into AgentError', () => {
    const original = new Error('Regular error');
    const wrapped = wrapError(original, 'claude', 'session-123');

    expect(wrapped).toBeInstanceOf(AgentError);
    expect(wrapped.code).toBe('UNKNOWN_ERROR');
    expect(wrapped.message).toBe('Regular error');
    expect(wrapped.provider).toBe('claude');
    expect(wrapped.sessionId).toBe('session-123');
    expect(wrapped.details?.originalError).toBe(original);
  });

  it('wraps string into AgentError', () => {
    const wrapped = wrapError('String error', 'codex');

    expect(wrapped).toBeInstanceOf(AgentError);
    expect(wrapped.message).toBe('String error');
    expect(wrapped.provider).toBe('codex');
  });

  it('wraps unknown into AgentError', () => {
    const wrapped = wrapError({ weird: 'object' }, 'opencode');

    expect(wrapped).toBeInstanceOf(AgentError);
    expect(wrapped.message).toBe('[object Object]');
    expect(wrapped.details?.originalError).toEqual({ weird: 'object' });
  });
});
