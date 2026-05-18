import { describe, expect, it } from 'vitest';
import { evaluateActiveProviderReadiness } from '../cortex-provider-readiness.js';

const connectedStatus = {
  connected: true,
  method: 'api_key' as const,
  meta: null,
};

const disconnectedStatus = {
  connected: false,
  method: null,
  meta: null,
};

describe('evaluateActiveProviderReadiness', () => {
  it('requires an active provider', () => {
    const result = evaluateActiveProviderReadiness({
      provider: null,
      model: 'claude-sonnet-4',
      status: connectedStatus,
    });

    expect(result.ready).toBe(false);
    expect(result.reason).toBe('missing_provider');
  });

  it('requires an active model', () => {
    const result = evaluateActiveProviderReadiness({
      provider: 'anthropic',
      model: null,
      status: connectedStatus,
    });

    expect(result.ready).toBe(false);
    expect(result.reason).toBe('missing_model');
  });

  it('requires provider credentials', () => {
    const result = evaluateActiveProviderReadiness({
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      status: disconnectedStatus,
    });

    expect(result.ready).toBe(false);
    expect(result.reason).toBe('missing_credentials');
  });

  it('is ready when provider, model, and credentials are present', () => {
    const result = evaluateActiveProviderReadiness({
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      status: connectedStatus,
    });

    expect(result.ready).toBe(true);
    expect(result.reason).toBeNull();
  });
});
