/**
 * Agent Manager - Central factory for creating and managing agent sessions.
 *
 * The AgentManager provides a unified interface for:
 * - Checking provider configuration status
 * - Creating sessions across any provider
 * - Resuming existing sessions
 * - Querying provider capabilities
 * - Session warmth tracking (warm/cooling/cold)
 * - Concurrency limits
 * - Crash recovery
 * - Cleanup of all active sessions
 */

import type { AgentProvider } from '@animus/shared';
import type {
  IAgentAdapter,
  IAgentSession,
  AgentSessionConfig,
  AdapterCapabilities,
} from './types.js';
import { AgentError } from './errors.js';
import { createTaggedLogger, type Logger } from './logger.js';
import { agentSessionConfigSchema } from './schemas.js';
import { parseSessionId } from './utils/index.js';
import { ClaudeAdapter } from './adapters/claude.js';
import { CodexAdapter } from './adapters/codex.js';
import { OpenCodeAdapter } from './adapters/opencode.js';
import { BaseAdapter } from './adapters/base.js';

// ============================================================================
// Session Warmth Tracking
// ============================================================================

/**
 * Session warmth states for heartbeat integration.
 *
 * - warm: Session is actively processing or was recently active
 * - cooling: Session has been idle for a short period
 * - cold: Session has been idle for a long period and may need rewarming
 */
export type SessionWarmth = 'warm' | 'cooling' | 'cold';

/**
 * Thresholds for session warmth transitions (in milliseconds).
 */
export interface WarmthThresholds {
  /** Time before a warm session becomes cooling (default: 60s) */
  warmToCoolingMs: number;

  /** Time before a cooling session becomes cold (default: 5min) */
  coolingToColdMs: number;
}

const DEFAULT_WARMTH_THRESHOLDS: WarmthThresholds = {
  warmToCoolingMs: 60_000,
  coolingToColdMs: 300_000,
};

/**
 * Internal tracking state for a managed session.
 */
interface TrackedSession {
  session: IAgentSession;
  lastActivityAt: number;
  config: AgentSessionConfig;
}

// ============================================================================
// Manager Configuration
// ============================================================================

/**
 * Configuration for the AgentManager.
 */
export interface AgentManagerConfig {
  /** Custom logger instance */
  logger?: Logger;

  /** Whether to auto-register default adapters (default: true) */
  autoRegisterAdapters?: boolean;

  /** Maximum concurrent sessions across all providers (default: unlimited) */
  maxConcurrentSessions?: number;

  /** Warmth thresholds for session state tracking */
  warmthThresholds?: Partial<WarmthThresholds>;
}

/**
 * Session information including warmth state.
 */
export interface SessionInfo {
  id: string;
  provider: AgentProvider;
  isActive: boolean;
  warmth: SessionWarmth;
  lastActivityAt: number;
  idleMs: number;
}

/**
 * Central manager for agent adapters and sessions.
 *
 * Provides a unified interface for creating agent sessions across
 * multiple providers (Claude, Codex, OpenCode).
 *
 * @example
 * ```typescript
 * const manager = createAgentManager();
 *
 * // Check if provider is configured
 * if (manager.isConfigured('claude')) {
 *   const session = await manager.createSession({
 *     provider: 'claude',
 *     systemPrompt: 'You are a helpful assistant.',
 *   });
 *
 *   const response = await session.prompt('Hello!');
 *   console.log(response.content);
 *
 *   await session.end();
 * }
 * ```
 */
export class AgentManager {
  private adapters: Map<AgentProvider, IAgentAdapter> = new Map();
  private trackedSessions: Map<string, TrackedSession> = new Map();
  private logger: Logger;
  private cleanupRegistered = false;
  private maxConcurrentSessions: number | null;
  private warmthThresholds: WarmthThresholds;

  constructor(config?: AgentManagerConfig) {
    this.logger = config?.logger ?? createTaggedLogger('AgentManager');
    this.maxConcurrentSessions = config?.maxConcurrentSessions ?? null;
    this.warmthThresholds = {
      ...DEFAULT_WARMTH_THRESHOLDS,
      ...config?.warmthThresholds,
    };

    // Auto-register default adapters unless disabled
    if (config?.autoRegisterAdapters !== false) {
      this.registerDefaultAdapters(config?.logger);
    }

    // Register cleanup handlers
    this.registerCleanupHandlers();
  }

  /**
   * Register the default adapters for all providers.
   */
  private registerDefaultAdapters(logger?: Logger): void {
    this.registerAdapter(new ClaudeAdapter({ logger }));
    this.registerAdapter(new CodexAdapter({ logger }));
    this.registerAdapter(new OpenCodeAdapter({ logger }));
  }

  /**
   * Register cleanup handlers for graceful shutdown.
   */
  private registerCleanupHandlers(): void {
    if (this.cleanupRegistered || AgentManager.globalCleanupRegistered) {
      return;
    }

    const cleanup = async (): Promise<void> => {
      await this.cleanup();
    };

    // Handle various exit signals
    process.on('beforeExit', cleanup);
    process.on('SIGINT', async () => {
      await cleanup();
      process.exit(0);
    });
    process.on('SIGTERM', async () => {
      await cleanup();
      process.exit(0);
    });

    this.cleanupRegistered = true;
    AgentManager.globalCleanupRegistered = true;
  }

  // Static flag to prevent multiple global registrations in tests
  private static globalCleanupRegistered = false;

  /**
   * Reset the global cleanup flag (for testing only).
   */
  static resetGlobalCleanup(): void {
    AgentManager.globalCleanupRegistered = false;
  }

  /**
   * Register an adapter for a provider.
   *
   * Replaces any existing adapter for the same provider.
   */
  registerAdapter(adapter: IAgentAdapter): void {
    this.adapters.set(adapter.provider, adapter);
    this.logger.info('Adapter registered', { provider: adapter.provider });
  }

  /**
   * Get the adapter for a provider.
   *
   * @throws AgentError if no adapter is registered for the provider
   */
  getAdapter(provider: AgentProvider): IAgentAdapter {
    const adapter = this.adapters.get(provider);

    if (!adapter) {
      throw new AgentError({
        code: 'ADAPTER_NOT_FOUND',
        message: `No adapter registered for provider: ${provider}`,
        category: 'invalid_input',
        severity: 'fatal',
        provider,
      });
    }

    return adapter;
  }

  /**
   * Check if a provider is properly configured.
   */
  isConfigured(provider: AgentProvider): boolean {
    const adapter = this.adapters.get(provider);
    return adapter?.isConfigured() ?? false;
  }

  /**
   * Get the capabilities of a provider.
   *
   * @throws AgentError if no adapter is registered for the provider
   */
  getCapabilities(provider: AgentProvider): AdapterCapabilities {
    return this.getAdapter(provider).capabilities;
  }

  /**
   * Get list of registered providers.
   */
  getRegisteredProviders(): AgentProvider[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Get list of configured providers (ready to use).
   */
  getConfiguredProviders(): AgentProvider[] {
    return this.getRegisteredProviders().filter((p) => this.isConfigured(p));
  }

  /**
   * Create a new agent session.
   *
   * @param config - Session configuration
   * @returns Promise resolving to the created session
   *
   * @throws AgentError if:
   * - Configuration validation fails
   * - Provider is not configured
   * - Concurrency limit reached
   * - Session creation fails
   */
  async createSession(config: AgentSessionConfig): Promise<IAgentSession> {
    // 1. Validate configuration
    const validated = agentSessionConfigSchema.parse(config);
    this.logger.debug('Configuration validated', { provider: validated.provider });

    // 2. Check concurrency limit
    if (
      this.maxConcurrentSessions !== null &&
      this.trackedSessions.size >= this.maxConcurrentSessions
    ) {
      throw new AgentError({
        code: 'CONCURRENCY_LIMIT',
        message: `Maximum concurrent sessions reached (${this.maxConcurrentSessions}). End an existing session first.`,
        category: 'resource_exhausted',
        severity: 'recoverable',
        provider: validated.provider,
      });
    }

    // 3. Get adapter
    const adapter = this.getAdapter(validated.provider);

    // 4. Check if configured
    if (!adapter.isConfigured()) {
      throw new AgentError({
        code: 'MISSING_CREDENTIALS',
        message: `${validated.provider} credentials not configured`,
        category: 'authentication',
        severity: 'fatal',
        provider: validated.provider,
      });
    }

    // 5. Create session
    this.logger.info('Creating session', { provider: validated.provider });
    const session = await adapter.createSession(validated);

    // 6. Track session with warmth state
    this.trackSession(session, validated);

    return session;
  }

  /**
   * Resume an existing session by ID.
   *
   * The session ID format is "{provider}:{nativeId}".
   *
   * @param sessionId - The session ID to resume
   * @param config - Optional config to associate with the resumed session
   * @returns Promise resolving to the resumed session
   */
  async resumeSession(
    sessionId: string,
    config?: Partial<AgentSessionConfig>,
  ): Promise<IAgentSession> {
    const { provider } = parseSessionId(sessionId);
    const adapter = this.getAdapter(provider);

    this.logger.info('Resuming session', { sessionId, provider });
    const session = await adapter.resumeSession(sessionId);

    // Track the resumed session
    const sessionConfig: AgentSessionConfig = {
      provider,
      ...config,
    };
    this.trackSession(session, sessionConfig);

    return session;
  }

  /**
   * Track a session for warmth and cleanup management.
   */
  private trackSession(session: IAgentSession, config: AgentSessionConfig): void {
    const tracked: TrackedSession = {
      session,
      lastActivityAt: Date.now(),
      config,
    };

    // Capture the initial (possibly pending) ID used as the map key
    const initialId = session.id;
    this.trackedSessions.set(initialId, tracked);
    this.logger.debug('Session tracked', { sessionId: initialId });

    // Update activity on events and handle ID changes
    session.onEvent(async (event) => {
      const currentId = session.id;

      // Re-key if the session ID stabilized (pending → native)
      if (currentId !== initialId && this.trackedSessions.has(initialId)) {
        this.trackedSessions.delete(initialId);
        this.trackedSessions.set(currentId, tracked);
        this.logger.debug('Session re-keyed', { from: initialId, to: currentId });
      }

      const t = this.trackedSessions.get(currentId);
      if (t) {
        t.lastActivityAt = Date.now();
      }

      if (event.type === 'session_end') {
        // Delete by both IDs to be safe
        this.trackedSessions.delete(currentId);
        this.trackedSessions.delete(initialId);
        this.logger.debug('Session untracked', { sessionId: currentId });
      }
    });
  }

  /**
   * Get an active session by ID.
   *
   * @returns The session or undefined if not found
   */
  getSession(sessionId: string): IAgentSession | undefined {
    return this.trackedSessions.get(sessionId)?.session;
  }

  /**
   * Get count of active sessions.
   */
  getActiveSessionCount(): number {
    return this.trackedSessions.size;
  }

  /**
   * Get count of active sessions for a specific provider.
   */
  getActiveSessionCountByProvider(provider: AgentProvider): number {
    return Array.from(this.trackedSessions.values()).filter(
      (t) => t.session.provider === provider,
    ).length;
  }

  /**
   * Get all active session IDs.
   */
  getActiveSessionIds(): string[] {
    return Array.from(this.trackedSessions.keys());
  }

  // ============================================================================
  // Session Warmth
  // ============================================================================

  /**
   * Get the warmth state of a session.
   */
  getSessionWarmth(sessionId: string): SessionWarmth {
    const tracked = this.trackedSessions.get(sessionId);
    if (!tracked) {
      return 'cold';
    }

    const idleMs = Date.now() - tracked.lastActivityAt;

    if (idleMs < this.warmthThresholds.warmToCoolingMs) {
      return 'warm';
    }

    if (idleMs < this.warmthThresholds.coolingToColdMs) {
      return 'cooling';
    }

    return 'cold';
  }

  /**
   * Get detailed info for all active sessions.
   */
  getSessionInfos(): SessionInfo[] {
    const now = Date.now();

    return Array.from(this.trackedSessions.entries()).map(([id, tracked]) => {
      const idleMs = now - tracked.lastActivityAt;

      return {
        id,
        provider: tracked.session.provider,
        isActive: tracked.session.isActive,
        warmth: this.getSessionWarmth(id),
        lastActivityAt: tracked.lastActivityAt,
        idleMs,
      };
    });
  }

  /**
   * Get all cold sessions that may need cleanup or rewarming.
   */
  getColdSessions(): SessionInfo[] {
    return this.getSessionInfos().filter((s) => s.warmth === 'cold');
  }

  /**
   * Touch a session to mark it as recently active.
   * Useful when the heartbeat knows a session is still relevant.
   */
  touchSession(sessionId: string): void {
    const tracked = this.trackedSessions.get(sessionId);
    if (tracked) {
      tracked.lastActivityAt = Date.now();
    }
  }

  // ============================================================================
  // Concurrency
  // ============================================================================

  /**
   * Get the maximum concurrent sessions limit.
   * Returns null if unlimited.
   */
  getMaxConcurrentSessions(): number | null {
    return this.maxConcurrentSessions;
  }

  /**
   * Update the maximum concurrent sessions limit.
   */
  setMaxConcurrentSessions(limit: number | null): void {
    this.maxConcurrentSessions = limit;
    this.logger.info('Concurrency limit updated', { limit });
  }

  /**
   * Check if a new session can be created without hitting the limit.
   */
  canCreateSession(): boolean {
    if (this.maxConcurrentSessions === null) {
      return true;
    }
    return this.trackedSessions.size < this.maxConcurrentSessions;
  }

  /**
   * Force-remove a session from tracking without ending it.
   * Use as a last resort when session.end() fails.
   */
  removeTrackedSession(sessionId: string): boolean {
    return this.trackedSessions.delete(sessionId);
  }

  // ============================================================================
  // Crash Recovery
  // ============================================================================

  /**
   * Attempt to recover sessions from persisted state.
   *
   * The backend orchestrator stores running session IDs in SQLite.
   * On restart, it calls this method with those IDs to try resuming them.
   *
   * @param sessionIds - Session IDs to attempt recovery for
   * @returns Map of session ID to recovery result
   */
  async recoverSessions(
    sessionIds: string[],
  ): Promise<Map<string, { recovered: boolean; session?: IAgentSession; error?: string }>> {
    const results = new Map<
      string,
      { recovered: boolean; session?: IAgentSession; error?: string }
    >();

    this.logger.info('Attempting crash recovery', { sessionCount: sessionIds.length });

    for (const sessionId of sessionIds) {
      try {
        const session = await this.resumeSession(sessionId);
        results.set(sessionId, { recovered: true, session });
        this.logger.info('Session recovered', { sessionId });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Session lost during crash recovery';
        results.set(sessionId, { recovered: false, error: message });
        this.logger.warn('Session recovery failed', { sessionId, error: message });
      }
    }

    return results;
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  /**
   * Clean up all active sessions and adapters.
   *
   * Should be called when shutting down the application.
   */
  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up', { sessionCount: this.trackedSessions.size });

    // End all active sessions
    const sessionPromises = Array.from(this.trackedSessions.values()).map((tracked) =>
      tracked.session.end().catch((error) => {
        this.logger.warn('Session cleanup failed', {
          sessionId: tracked.session.id,
          error: String(error),
        });
      }),
    );

    await Promise.allSettled(sessionPromises);
    this.trackedSessions.clear();

    // Cleanup adapters (especially OpenCode server)
    const adapterPromises = Array.from(this.adapters.values()).map((adapter) => {
      if (adapter instanceof BaseAdapter) {
        return adapter.cleanup().catch((error) => {
          this.logger.warn('Adapter cleanup failed', {
            provider: adapter.provider,
            error: String(error),
          });
        });
      }
      return Promise.resolve();
    });

    await Promise.allSettled(adapterPromises);

    this.logger.info('Cleanup complete');
  }
}

/**
 * Create an AgentManager with default configuration.
 *
 * This is the recommended way to create an AgentManager.
 * It automatically registers all available adapters.
 *
 * @example
 * ```typescript
 * const manager = createAgentManager();
 *
 * const session = await manager.createSession({
 *   provider: 'claude',
 *   systemPrompt: 'You are helpful.',
 * });
 * ```
 */
export function createAgentManager(config?: AgentManagerConfig): AgentManager {
  return new AgentManager(config);
}
