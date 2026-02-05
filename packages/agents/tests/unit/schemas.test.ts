/**
 * Tests for validation schemas.
 */

import { describe, it, expect } from 'vitest';
import {
  validateConfig,
  safeValidateConfig,
  getConfigErrors,
  agentSessionConfigSchema,
  permissionConfigSchema,
} from '../../src/schemas.js';

describe('permissionConfigSchema', () => {
  it('uses defaults for empty input', () => {
    const result = permissionConfigSchema.parse({});

    expect(result.executionMode).toBe('build');
    expect(result.approvalLevel).toBe('normal');
  });

  it('accepts valid execution modes', () => {
    expect(() =>
      permissionConfigSchema.parse({ executionMode: 'plan' }),
    ).not.toThrow();
    expect(() =>
      permissionConfigSchema.parse({ executionMode: 'build' }),
    ).not.toThrow();
  });

  it('rejects invalid execution modes', () => {
    expect(() =>
      permissionConfigSchema.parse({ executionMode: 'invalid' }),
    ).toThrow();
  });

  it('accepts valid approval levels', () => {
    const levels = ['strict', 'normal', 'trusted', 'none'];
    for (const level of levels) {
      expect(() =>
        permissionConfigSchema.parse({ approvalLevel: level }),
      ).not.toThrow();
    }
  });

  it('accepts tool permissions', () => {
    const result = permissionConfigSchema.parse({
      toolPermissions: {
        Bash: 'deny',
        Read: 'allow',
        Write: 'ask',
      },
    });

    expect(result.toolPermissions?.Bash).toBe('deny');
    expect(result.toolPermissions?.Read).toBe('allow');
    expect(result.toolPermissions?.Write).toBe('ask');
  });
});

describe('agentSessionConfigSchema', () => {
  it('validates Claude config', () => {
    const config = {
      provider: 'claude',
      model: 'claude-sonnet-4-5',
      systemPrompt: 'You are helpful.',
      cwd: '/tmp',
      maxTurns: 10,
      maxBudgetUsd: 5.0,
    };

    const result = agentSessionConfigSchema.parse(config);

    expect(result.provider).toBe('claude');
    expect(result.model).toBe('claude-sonnet-4-5');
    expect(result.maxTurns).toBe(10);
  });

  it('validates Codex config', () => {
    const config = {
      provider: 'codex',
      workingDirectory: '/path/to/project',
      skipGitRepoCheck: true,
    };

    const result = agentSessionConfigSchema.parse(config);

    expect(result.provider).toBe('codex');
    expect(result.workingDirectory).toBe('/path/to/project');
    expect(result.skipGitRepoCheck).toBe(true);
  });

  it('validates OpenCode config', () => {
    const config = {
      provider: 'opencode',
      hostname: '127.0.0.1',
      port: 4096,
      model: 'anthropic/claude-sonnet-4-5',
    };

    const result = agentSessionConfigSchema.parse(config);

    expect(result.provider).toBe('opencode');
    expect(result.hostname).toBe('127.0.0.1');
    expect(result.port).toBe(4096);
  });

  it('rejects invalid provider', () => {
    expect(() =>
      agentSessionConfigSchema.parse({
        provider: 'invalid',
      }),
    ).toThrow();
  });

  it('accepts permissions config', () => {
    const config = {
      provider: 'claude',
      permissions: {
        executionMode: 'plan',
        approvalLevel: 'strict',
      },
    };

    const result = agentSessionConfigSchema.parse(config);

    expect(result.permissions?.executionMode).toBe('plan');
    expect(result.permissions?.approvalLevel).toBe('strict');
  });

  it('rejects negative timeout', () => {
    expect(() =>
      agentSessionConfigSchema.parse({
        provider: 'claude',
        timeoutMs: -1000,
      }),
    ).toThrow();
  });
});

describe('validateConfig', () => {
  it('returns validated config for valid input', () => {
    const config = validateConfig({
      provider: 'claude',
      model: 'claude-3-5-sonnet',
    });

    expect(config.provider).toBe('claude');
  });

  it('throws for invalid input', () => {
    expect(() => validateConfig({ invalid: 'config' })).toThrow();
  });
});

describe('safeValidateConfig', () => {
  it('returns config for valid input', () => {
    const config = safeValidateConfig({
      provider: 'codex',
    });

    expect(config).not.toBeNull();
    expect(config?.provider).toBe('codex');
  });

  it('returns null for invalid input', () => {
    const config = safeValidateConfig({ invalid: 'config' });

    expect(config).toBeNull();
  });
});

describe('getConfigErrors', () => {
  it('returns empty array for valid config', () => {
    const errors = getConfigErrors({
      provider: 'opencode',
    });

    expect(errors).toEqual([]);
  });

  it('returns error messages for invalid config', () => {
    const errors = getConfigErrors({
      provider: 'invalid',
      timeoutMs: -100,
    });

    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes('provider'))).toBe(true);
  });
});
