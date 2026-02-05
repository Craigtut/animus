/**
 * Tests for AgentManager.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AgentManager,
  createAgentManager,
  AgentError,
  createSilentLogger,
  CLAUDE_CAPABILITIES,
  CODEX_CAPABILITIES,
  type IAgentAdapter,
  type IAgentSession,
  type AgentSessionConfig,
  type AdapterCapabilities,
} from '../../src/index.js';

// Mock adapter for testing
function createMockAdapter(
  provider: 'claude' | 'codex' | 'opencode',
  isConfigured = true,
): IAgentAdapter {
  const mockSession: IAgentSession = {
    id: `${provider}:mock-session`,
    provider,
    isActive: true,
    onEvent: vi.fn(),
    registerHooks: vi.fn(),
    prompt: vi.fn().mockResolvedValue({
      content: 'Mock response',
      finishReason: 'complete',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      durationMs: 100,
      model: 'mock-model',
    }),
    promptStreaming: vi.fn().mockResolvedValue({
      content: 'Mock streamed response',
      finishReason: 'complete',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      durationMs: 100,
      model: 'mock-model',
    }),
    cancel: vi.fn().mockResolvedValue(undefined),
    end: vi.fn().mockResolvedValue(undefined),
    getUsage: vi.fn().mockReturnValue({ inputTokens: 10, outputTokens: 20, totalTokens: 30 }),
    getCost: vi.fn().mockReturnValue(null),
  };

  return {
    provider,
    capabilities:
      provider === 'claude' ? CLAUDE_CAPABILITIES : CODEX_CAPABILITIES,
    isConfigured: () => isConfigured,
    createSession: vi.fn().mockResolvedValue(mockSession),
    resumeSession: vi.fn().mockResolvedValue(mockSession),
  };
}

describe('AgentManager', () => {
  let manager: AgentManager;

  beforeEach(() => {
    // Create manager without auto-registering adapters
    manager = new AgentManager({
      autoRegisterAdapters: false,
      logger: createSilentLogger(),
    });
  });

  describe('registerAdapter', () => {
    it('registers an adapter', () => {
      const adapter = createMockAdapter('claude');
      manager.registerAdapter(adapter);

      expect(manager.getRegisteredProviders()).toContain('claude');
    });

    it('replaces existing adapter for same provider', () => {
      const adapter1 = createMockAdapter('claude');
      const adapter2 = createMockAdapter('claude');

      manager.registerAdapter(adapter1);
      manager.registerAdapter(adapter2);

      expect(manager.getAdapter('claude')).toBe(adapter2);
    });
  });

  describe('getAdapter', () => {
    it('returns registered adapter', () => {
      const adapter = createMockAdapter('codex');
      manager.registerAdapter(adapter);

      expect(manager.getAdapter('codex')).toBe(adapter);
    });

    it('throws for unregistered provider', () => {
      expect(() => manager.getAdapter('claude')).toThrow(AgentError);
      expect(() => manager.getAdapter('claude')).toThrow('No adapter registered');
    });
  });

  describe('isConfigured', () => {
    it('returns true for configured adapter', () => {
      manager.registerAdapter(createMockAdapter('claude', true));
      expect(manager.isConfigured('claude')).toBe(true);
    });

    it('returns false for unconfigured adapter', () => {
      manager.registerAdapter(createMockAdapter('claude', false));
      expect(manager.isConfigured('claude')).toBe(false);
    });

    it('returns false for unregistered provider', () => {
      expect(manager.isConfigured('claude')).toBe(false);
    });
  });

  describe('getCapabilities', () => {
    it('returns adapter capabilities', () => {
      manager.registerAdapter(createMockAdapter('claude'));

      const caps = manager.getCapabilities('claude');

      expect(caps.canCancel).toBe(true);
      expect(caps.supportsFork).toBe(true);
    });

    it('throws for unregistered provider', () => {
      expect(() => manager.getCapabilities('codex')).toThrow(AgentError);
    });
  });

  describe('getRegisteredProviders', () => {
    it('returns empty array initially', () => {
      expect(manager.getRegisteredProviders()).toEqual([]);
    });

    it('returns all registered providers', () => {
      manager.registerAdapter(createMockAdapter('claude'));
      manager.registerAdapter(createMockAdapter('codex'));

      const providers = manager.getRegisteredProviders();

      expect(providers).toContain('claude');
      expect(providers).toContain('codex');
    });
  });

  describe('getConfiguredProviders', () => {
    it('returns only configured providers', () => {
      manager.registerAdapter(createMockAdapter('claude', true));
      manager.registerAdapter(createMockAdapter('codex', false));
      manager.registerAdapter(createMockAdapter('opencode', true));

      const configured = manager.getConfiguredProviders();

      expect(configured).toContain('claude');
      expect(configured).not.toContain('codex');
      expect(configured).toContain('opencode');
    });
  });

  describe('createSession', () => {
    it('creates session through adapter', async () => {
      const adapter = createMockAdapter('claude');
      manager.registerAdapter(adapter);

      const session = await manager.createSession({
        provider: 'claude',
        model: 'claude-3-5-sonnet',
      });

      expect(adapter.createSession).toHaveBeenCalled();
      expect(session.provider).toBe('claude');
    });

    it('throws for unconfigured provider', async () => {
      manager.registerAdapter(createMockAdapter('claude', false));

      await expect(
        manager.createSession({ provider: 'claude' }),
      ).rejects.toThrow('credentials not configured');
    });

    it('throws for invalid config', async () => {
      await expect(
        manager.createSession({ provider: 'invalid' as any }),
      ).rejects.toThrow();
    });

    it('tracks active sessions', async () => {
      manager.registerAdapter(createMockAdapter('claude'));

      await manager.createSession({ provider: 'claude' });

      expect(manager.getActiveSessionCount()).toBe(1);
    });
  });

  describe('resumeSession', () => {
    it('resumes session through adapter', async () => {
      const adapter = createMockAdapter('claude');
      manager.registerAdapter(adapter);

      const session = await manager.resumeSession('claude:mock-session');

      expect(adapter.resumeSession).toHaveBeenCalledWith('claude:mock-session');
      expect(session).toBeDefined();
    });

    it('throws for unregistered provider', async () => {
      await expect(
        manager.resumeSession('claude:mock-session'),
      ).rejects.toThrow('No adapter registered');
    });
  });

  describe('getSession', () => {
    it('returns active session by ID', async () => {
      manager.registerAdapter(createMockAdapter('claude'));
      await manager.createSession({ provider: 'claude' });

      const session = manager.getSession('claude:mock-session');

      expect(session).toBeDefined();
      expect(session?.provider).toBe('claude');
    });

    it('returns undefined for unknown session', () => {
      expect(manager.getSession('claude:unknown')).toBeUndefined();
    });
  });

  describe('getActiveSessionCount', () => {
    it('returns count of active sessions', async () => {
      manager.registerAdapter(createMockAdapter('claude'));
      manager.registerAdapter(createMockAdapter('codex'));

      expect(manager.getActiveSessionCount()).toBe(0);

      await manager.createSession({ provider: 'claude' });
      expect(manager.getActiveSessionCount()).toBe(1);

      await manager.createSession({ provider: 'codex' });
      expect(manager.getActiveSessionCount()).toBe(2);
    });
  });

  describe('cleanup', () => {
    it('ends all active sessions', async () => {
      const adapter = createMockAdapter('claude');
      manager.registerAdapter(adapter);

      const session = await manager.createSession({ provider: 'claude' });

      await manager.cleanup();

      expect(session.end).toHaveBeenCalled();
      expect(manager.getActiveSessionCount()).toBe(0);
    });
  });
});

describe('createAgentManager', () => {
  it('creates manager with default config', () => {
    // This will try to register real adapters which may not be configured
    const manager = createAgentManager({
      logger: createSilentLogger(),
    });

    expect(manager).toBeInstanceOf(AgentManager);
    // Should have registered default adapters
    expect(manager.getRegisteredProviders().length).toBe(3);
  });

  it('accepts custom logger', () => {
    const logger = createSilentLogger();
    const manager = createAgentManager({ logger });

    expect(manager).toBeInstanceOf(AgentManager);
  });
});
