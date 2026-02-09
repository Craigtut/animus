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
  type AgentEventHandler,
} from '../../src/index.js';

// Mock adapter for testing
function createMockAdapter(
  provider: 'claude' | 'codex' | 'opencode',
  isConfigured = true,
): IAgentAdapter {
  const mockSession = createMockSession(provider);

  return {
    provider,
    capabilities:
      provider === 'claude' ? CLAUDE_CAPABILITIES : CODEX_CAPABILITIES,
    isConfigured: () => isConfigured,
    createSession: vi.fn().mockResolvedValue(mockSession),
    resumeSession: vi.fn().mockResolvedValue(mockSession),
  };
}

// Create a mock session that supports event handlers
function createMockSession(
  provider: 'claude' | 'codex' | 'opencode',
  id?: string,
): IAgentSession {
  const handlers: AgentEventHandler[] = [];

  return {
    id: id ?? `${provider}:mock-session`,
    provider,
    isActive: true,
    onEvent: vi.fn((handler: AgentEventHandler) => {
      handlers.push(handler);
    }),
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

  // ============================================================================
  // Session Warmth Tracking
  // ============================================================================

  describe('session warmth', () => {
    it('newly created session is warm', async () => {
      manager.registerAdapter(createMockAdapter('claude'));
      await manager.createSession({ provider: 'claude' });

      const warmth = manager.getSessionWarmth('claude:mock-session');
      expect(warmth).toBe('warm');
    });

    it('returns cold for unknown session', () => {
      expect(manager.getSessionWarmth('claude:unknown')).toBe('cold');
    });

    it('getSessionInfos returns info for all sessions', async () => {
      manager.registerAdapter(createMockAdapter('claude'));
      await manager.createSession({ provider: 'claude' });

      const infos = manager.getSessionInfos();

      expect(infos).toHaveLength(1);
      expect(infos[0].id).toBe('claude:mock-session');
      expect(infos[0].provider).toBe('claude');
      expect(infos[0].warmth).toBe('warm');
      expect(infos[0].idleMs).toBeLessThan(1000);
    });

    it('getColdSessions returns empty for new sessions', async () => {
      manager.registerAdapter(createMockAdapter('claude'));
      await manager.createSession({ provider: 'claude' });

      const cold = manager.getColdSessions();
      expect(cold).toHaveLength(0);
    });

    it('touchSession updates last activity time', async () => {
      manager.registerAdapter(createMockAdapter('claude'));
      await manager.createSession({ provider: 'claude' });

      manager.touchSession('claude:mock-session');

      const infos = manager.getSessionInfos();
      expect(infos[0].idleMs).toBeLessThan(100);
    });

    it('session becomes cooling after warmToCoolingMs', async () => {
      const shortWarmth = new AgentManager({
        autoRegisterAdapters: false,
        logger: createSilentLogger(),
        warmthThresholds: {
          warmToCoolingMs: 0, // Instant
          coolingToColdMs: 60000,
        },
      });

      shortWarmth.registerAdapter(createMockAdapter('claude'));
      await shortWarmth.createSession({ provider: 'claude' });

      // Wait a tiny bit
      await new Promise((r) => setTimeout(r, 5));

      const warmth = shortWarmth.getSessionWarmth('claude:mock-session');
      expect(warmth).toBe('cooling');
    });

    it('session becomes cold after coolingToColdMs', async () => {
      const shortWarmth = new AgentManager({
        autoRegisterAdapters: false,
        logger: createSilentLogger(),
        warmthThresholds: {
          warmToCoolingMs: 0,
          coolingToColdMs: 0, // Instant
        },
      });

      shortWarmth.registerAdapter(createMockAdapter('claude'));
      await shortWarmth.createSession({ provider: 'claude' });

      await new Promise((r) => setTimeout(r, 5));

      const warmth = shortWarmth.getSessionWarmth('claude:mock-session');
      expect(warmth).toBe('cold');
    });
  });

  // ============================================================================
  // Concurrency Limits
  // ============================================================================

  describe('concurrency limits', () => {
    it('defaults to unlimited', () => {
      expect(manager.getMaxConcurrentSessions()).toBeNull();
    });

    it('accepts limit in config', () => {
      const limited = new AgentManager({
        autoRegisterAdapters: false,
        logger: createSilentLogger(),
        maxConcurrentSessions: 3,
      });

      expect(limited.getMaxConcurrentSessions()).toBe(3);
    });

    it('canCreateSession returns true when under limit', async () => {
      const limited = new AgentManager({
        autoRegisterAdapters: false,
        logger: createSilentLogger(),
        maxConcurrentSessions: 2,
      });
      limited.registerAdapter(createMockAdapter('claude'));

      expect(limited.canCreateSession()).toBe(true);

      await limited.createSession({ provider: 'claude' });
      expect(limited.canCreateSession()).toBe(true);
    });

    it('canCreateSession returns false at limit', async () => {
      const limited = new AgentManager({
        autoRegisterAdapters: false,
        logger: createSilentLogger(),
        maxConcurrentSessions: 1,
      });
      limited.registerAdapter(createMockAdapter('claude'));

      await limited.createSession({ provider: 'claude' });
      expect(limited.canCreateSession()).toBe(false);
    });

    it('throws CONCURRENCY_LIMIT when limit reached', async () => {
      const limited = new AgentManager({
        autoRegisterAdapters: false,
        logger: createSilentLogger(),
        maxConcurrentSessions: 1,
      });
      limited.registerAdapter(createMockAdapter('claude'));

      await limited.createSession({ provider: 'claude' });

      await expect(
        limited.createSession({ provider: 'claude' }),
      ).rejects.toThrow('Maximum concurrent sessions reached');
    });

    it('setMaxConcurrentSessions updates the limit', () => {
      manager.setMaxConcurrentSessions(5);
      expect(manager.getMaxConcurrentSessions()).toBe(5);

      manager.setMaxConcurrentSessions(null);
      expect(manager.getMaxConcurrentSessions()).toBeNull();
    });

    it('canCreateSession always returns true when unlimited', async () => {
      manager.registerAdapter(createMockAdapter('claude'));
      expect(manager.canCreateSession()).toBe(true);

      await manager.createSession({ provider: 'claude' });
      expect(manager.canCreateSession()).toBe(true);
    });
  });

  // ============================================================================
  // Crash Recovery
  // ============================================================================

  describe('crash recovery', () => {
    it('recovers sessions from persisted IDs', async () => {
      const adapter = createMockAdapter('claude');
      manager.registerAdapter(adapter);

      const results = await manager.recoverSessions([
        'claude:session-1',
        'claude:session-2',
      ]);

      expect(results.size).toBe(2);
      expect(results.get('claude:session-1')?.recovered).toBe(true);
      expect(results.get('claude:session-2')?.recovered).toBe(true);
    });

    it('handles recovery failures gracefully', async () => {
      const adapter = createMockAdapter('claude');
      (adapter.resumeSession as any).mockRejectedValue(
        new Error('Session not found'),
      );
      manager.registerAdapter(adapter);

      const results = await manager.recoverSessions(['claude:lost-session']);

      expect(results.get('claude:lost-session')?.recovered).toBe(false);
      expect(results.get('claude:lost-session')?.error).toContain(
        'Session not found',
      );
    });

    it('returns empty map for empty input', async () => {
      const results = await manager.recoverSessions([]);
      expect(results.size).toBe(0);
    });

    it('tracks recovered sessions', async () => {
      const adapter = createMockAdapter('claude');
      manager.registerAdapter(adapter);

      await manager.recoverSessions(['claude:recovered-session']);

      expect(manager.getActiveSessionCount()).toBe(1);
    });
  });

  // ============================================================================
  // Additional Session Tracking
  // ============================================================================

  describe('getActiveSessionIds', () => {
    it('returns list of active session IDs', async () => {
      manager.registerAdapter(createMockAdapter('claude'));
      await manager.createSession({ provider: 'claude' });

      const ids = manager.getActiveSessionIds();
      expect(ids).toContain('claude:mock-session');
    });

    it('returns empty array when no sessions', () => {
      expect(manager.getActiveSessionIds()).toEqual([]);
    });
  });

  describe('getActiveSessionCountByProvider', () => {
    it('counts sessions per provider', async () => {
      manager.registerAdapter(createMockAdapter('claude'));
      manager.registerAdapter(createMockAdapter('codex'));

      await manager.createSession({ provider: 'claude' });

      expect(manager.getActiveSessionCountByProvider('claude')).toBe(1);
      expect(manager.getActiveSessionCountByProvider('codex')).toBe(0);
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

  it('accepts concurrency limit', () => {
    const manager = createAgentManager({
      logger: createSilentLogger(),
      maxConcurrentSessions: 5,
    });

    expect(manager.getMaxConcurrentSessions()).toBe(5);
  });
});
