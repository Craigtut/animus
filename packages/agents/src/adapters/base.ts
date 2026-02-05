/**
 * Base adapter and session classes.
 *
 * Provides shared logic for all provider-specific adapters.
 */

import type { AgentProvider, AgentEventType } from '@animus/shared';
import type {
  IAgentAdapter,
  IAgentSession,
  AgentSessionConfig,
  AdapterCapabilities,
  AgentEvent,
  AgentEventHandler,
  AgentEventData,
  UnifiedHooks,
  SessionUsage,
  AgentCost,
  AgentResponse,
  PromptOptions,
} from '../types.js';
import { AgentError } from '../errors.js';
import { createTaggedLogger, type Logger } from '../logger.js';
import { agentSessionConfigSchema } from '../schemas.js';
import { generateUUID, now, createSessionId, parseSessionId } from '../utils/index.js';

/**
 * Options for adapter construction.
 */
export interface AdapterOptions {
  /** Custom logger instance */
  logger?: Logger | undefined;
}

/**
 * Base adapter class with shared logic.
 *
 * Provider-specific adapters extend this class and implement
 * the abstract methods for their SDK.
 */
export abstract class BaseAdapter implements IAgentAdapter {
  abstract readonly provider: AgentProvider;
  abstract readonly capabilities: AdapterCapabilities;

  protected logger: Logger;
  protected activeSessions: Map<string, IAgentSession> = new Map();

  constructor(options?: AdapterOptions) {
    // Logger is created in subclass constructor after provider is set
    this.logger = options?.logger ?? createTaggedLogger('BaseAdapter');
  }

  /**
   * Initialize the logger with the correct provider tag.
   * Call this in subclass constructor after setting provider.
   */
  protected initLogger(options?: AdapterOptions): void {
    this.logger = options?.logger ?? createTaggedLogger(`${this.provider}Adapter`);
  }

  abstract isConfigured(): boolean;
  abstract createSession(config: AgentSessionConfig): Promise<IAgentSession>;

  /**
   * Resume an existing session by ID.
   *
   * Default implementation extracts the native ID and creates a new
   * session with the resume option. Subclasses may override for
   * provider-specific resume behavior.
   */
  async resumeSession(sessionId: string): Promise<IAgentSession> {
    const { provider, nativeId } = parseSessionId(sessionId);

    if (provider !== this.provider) {
      throw new AgentError({
        code: 'PROVIDER_MISMATCH',
        message: `Session ${sessionId} belongs to ${provider}, not ${this.provider}`,
        category: 'invalid_input',
        severity: 'fatal',
        provider: this.provider,
      });
    }

    // Create session with resume option
    const config: AgentSessionConfig = {
      provider: this.provider,
      resume: nativeId,
    };

    return this.createSession(config);
  }

  /**
   * Validate configuration against schema.
   *
   * @throws ZodError if validation fails
   */
  protected validateConfig(config: AgentSessionConfig): void {
    agentSessionConfigSchema.parse(config);
  }

  /**
   * Create a unified session ID from native ID.
   */
  protected createSessionId(nativeId: string): string {
    return createSessionId(this.provider, nativeId);
  }

  /**
   * Track a session for cleanup.
   */
  protected trackSession(session: IAgentSession): void {
    this.activeSessions.set(session.id, session);
    this.logger.debug('Session tracked', { sessionId: session.id });
  }

  /**
   * Untrack a session.
   */
  protected untrackSession(sessionId: string): void {
    this.activeSessions.delete(sessionId);
    this.logger.debug('Session untracked', { sessionId });
  }

  /**
   * Get count of active sessions.
   */
  getActiveSessionCount(): number {
    return this.activeSessions.size;
  }

  /**
   * Clean up all active sessions.
   *
   * Called on process exit or when adapter is disposed.
   */
  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up sessions', { count: this.activeSessions.size });

    const promises = Array.from(this.activeSessions.values()).map((session) =>
      session.end().catch((error) => {
        this.logger.warn('Session cleanup failed', {
          sessionId: session.id,
          error: String(error),
        });
      }),
    );

    await Promise.allSettled(promises);
    this.activeSessions.clear();
  }
}

/**
 * Base session class with shared logic.
 *
 * Provider-specific sessions extend this class and implement
 * the abstract methods for their SDK.
 */
export abstract class BaseSession implements IAgentSession {
  abstract readonly id: string;
  abstract readonly provider: AgentProvider;

  protected _isActive = true;
  protected eventHandlers: AgentEventHandler[] = [];
  protected hooks: UnifiedHooks = {};
  protected usage: SessionUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
  protected cost: AgentCost | null = null;
  protected logger: Logger;
  protected config: AgentSessionConfig;
  protected startTime: number;

  constructor(config: AgentSessionConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.startTime = Date.now();

    // Register initial hooks if provided
    if (config.hooks) {
      this.hooks = { ...config.hooks };
    }
  }

  /**
   * Whether the session is still active.
   */
  get isActive(): boolean {
    return this._isActive;
  }

  /**
   * Register an event handler.
   */
  onEvent(handler: AgentEventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Register lifecycle hooks.
   */
  registerHooks(hooks: UnifiedHooks): void {
    this.hooks = { ...this.hooks, ...hooks };
  }

  /**
   * Emit an event to all registered handlers.
   */
  protected async emit(event: AgentEvent): Promise<void> {
    for (const handler of this.eventHandlers) {
      try {
        await handler(event);
      } catch (error) {
        this.logger.error('Event handler error', {
          eventType: event.type,
          error: String(error),
        });
      }
    }
  }

  /**
   * Create an event with standard fields.
   */
  protected createEvent(type: AgentEventType, data: AgentEventData): AgentEvent {
    return {
      id: generateUUID(),
      sessionId: this.id,
      type,
      timestamp: now(),
      data,
    };
  }

  /**
   * Update usage statistics.
   */
  protected updateUsage(partial: Partial<SessionUsage>): void {
    this.usage = {
      ...this.usage,
      ...partial,
      totalTokens:
        (partial.inputTokens ?? this.usage.inputTokens) +
        (partial.outputTokens ?? this.usage.outputTokens),
    };

    // Calculate remaining context if we have the window size
    if (this.usage.contextWindowSize && this.usage.contextWindowUsed !== undefined) {
      this.usage.contextWindowRemaining =
        this.usage.contextWindowSize - this.usage.contextWindowUsed;
    }
  }

  /**
   * Get accumulated usage for this session.
   */
  getUsage(): SessionUsage {
    return { ...this.usage };
  }

  /**
   * Get accumulated cost for this session.
   */
  getCost(): AgentCost | null {
    return this.cost ? { ...this.cost } : null;
  }

  /**
   * Check if the session is still active, throwing if not.
   */
  protected assertActive(): void {
    if (!this._isActive) {
      throw new AgentError({
        code: 'SESSION_ENDED',
        message: 'Session has already ended',
        category: 'invalid_input',
        severity: 'fatal',
        provider: this.provider,
        sessionId: this.id,
      });
    }
  }

  /**
   * Calculate session duration.
   */
  protected getDurationMs(): number {
    return Date.now() - this.startTime;
  }

  // Abstract methods that subclasses must implement

  abstract prompt(input: string, options?: PromptOptions): Promise<AgentResponse>;

  abstract promptStreaming(
    input: string,
    onChunk: (chunk: string) => void,
    options?: PromptOptions,
  ): Promise<AgentResponse>;

  abstract cancel(): Promise<void>;

  abstract end(): Promise<void>;
}
