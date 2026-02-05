/**
 * Agent Manager - Central factory for creating and managing agent sessions.
 *
 * The AgentManager provides a unified interface for:
 * - Checking provider configuration status
 * - Creating sessions across any provider
 * - Resuming existing sessions
 * - Querying provider capabilities
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

/**
 * Configuration for the AgentManager.
 */
export interface AgentManagerConfig {
  /** Custom logger instance */
  logger?: Logger;

  /** Whether to auto-register default adapters (default: true) */
  autoRegisterAdapters?: boolean;
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
  private activeSessions: Map<string, IAgentSession> = new Map();
  private logger: Logger;
  private cleanupRegistered = false;

  constructor(config?: AgentManagerConfig) {
    this.logger = config?.logger ?? createTaggedLogger('AgentManager');

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
   * - Session creation fails
   */
  async createSession(config: AgentSessionConfig): Promise<IAgentSession> {
    // 1. Validate configuration
    const validated = agentSessionConfigSchema.parse(config);
    this.logger.debug('Configuration validated', { provider: validated.provider });

    // 2. Get adapter
    const adapter = this.getAdapter(validated.provider);

    // 3. Check if configured
    if (!adapter.isConfigured()) {
      throw new AgentError({
        code: 'MISSING_CREDENTIALS',
        message: `${validated.provider} credentials not configured`,
        category: 'authentication',
        severity: 'fatal',
        provider: validated.provider,
      });
    }

    // 4. Create session
    this.logger.info('Creating session', { provider: validated.provider });
    const session = await adapter.createSession(validated);

    // 5. Track session
    this.activeSessions.set(session.id, session);
    this.logger.debug('Session tracked', { sessionId: session.id });

    // 6. Setup cleanup on session end
    session.onEvent(async (event) => {
      if (event.type === 'session_end') {
        this.activeSessions.delete(session.id);
        this.logger.debug('Session untracked', { sessionId: session.id });
      }
    });

    return session;
  }

  /**
   * Resume an existing session by ID.
   *
   * The session ID format is "{provider}:{nativeId}".
   *
   * @param sessionId - The session ID to resume
   * @returns Promise resolving to the resumed session
   */
  async resumeSession(sessionId: string): Promise<IAgentSession> {
    const { provider } = parseSessionId(sessionId);
    const adapter = this.getAdapter(provider);

    this.logger.info('Resuming session', { sessionId, provider });
    const session = await adapter.resumeSession(sessionId);

    // Track the resumed session
    this.activeSessions.set(session.id, session);

    // Setup cleanup
    session.onEvent(async (event) => {
      if (event.type === 'session_end') {
        this.activeSessions.delete(session.id);
      }
    });

    return session;
  }

  /**
   * Get an active session by ID.
   *
   * @returns The session or undefined if not found
   */
  getSession(sessionId: string): IAgentSession | undefined {
    return this.activeSessions.get(sessionId);
  }

  /**
   * Get count of active sessions.
   */
  getActiveSessionCount(): number {
    return this.activeSessions.size;
  }

  /**
   * Get count of active sessions for a specific provider.
   */
  getActiveSessionCountByProvider(provider: AgentProvider): number {
    return Array.from(this.activeSessions.values()).filter(
      (s) => s.provider === provider,
    ).length;
  }

  /**
   * Clean up all active sessions and adapters.
   *
   * Should be called when shutting down the application.
   */
  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up', { sessionCount: this.activeSessions.size });

    // End all active sessions
    const sessionPromises = Array.from(this.activeSessions.values()).map((session) =>
      session.end().catch((error) => {
        this.logger.warn('Session cleanup failed', {
          sessionId: session.id,
          error: String(error),
        });
      }),
    );

    await Promise.allSettled(sessionPromises);
    this.activeSessions.clear();

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
