/**
 * OpenCode SDK adapter.
 *
 * Implements the unified agent interface using the OpenCode SDK.
 * OpenCode uses a client/server architecture where the SDK communicates
 * with a running OpenCode server process via HTTP and SSE.
 *
 * Key Feature: Supports 75+ LLM providers through the AI SDK.
 *
 * @see https://opencode.ai/docs/sdk/
 */

import type { AgentProvider } from '@animus/shared';
import type {
  AgentSessionConfig,
  AdapterCapabilities,
  IAgentSession,
  AgentResponse,
  PromptOptions,
} from '../types.js';
import { AgentError, wrapError } from '../errors.js';
import { createTaggedLogger, type Logger } from '../logger.js';
import { OPENCODE_CAPABILITIES } from '../capabilities.js';
import { BaseAdapter, BaseSession, type AdapterOptions } from './base.js';
import { generateUUID, createPendingSessionId } from '../utils/index.js';

// Type declarations for the OpenCode SDK
interface OpenCodeSDK {
  createOpencode: (options: CreateOpencodeOptions) => Promise<{ client: OpencodeClient }>;
  createOpencodeClient: (options: ClientOptions) => OpencodeClient;
}

interface CreateOpencodeOptions {
  hostname?: string;
  port?: number;
  timeout?: number;
  signal?: AbortSignal;
  config?: Record<string, unknown>;
}

interface ClientOptions {
  baseUrl: string;
}

interface OpencodeClient {
  session: SessionApi;
  event: EventApi;
  auth: AuthApi;
  global: GlobalApi;
}

interface SessionApi {
  create(params: { body: { title?: string } }): Promise<SessionInfo>;
  get(params: { path: { id: string } }): Promise<SessionInfo>;
  list(): Promise<SessionInfo[]>;
  delete(params: { path: { id: string } }): Promise<void>;
  abort(params: { path: { id: string } }): Promise<void>;
  prompt(params: PromptParams): Promise<PromptResponse>;
  messages(params: { path: { id: string } }): Promise<MessageInfo[]>;
}

interface PromptParams {
  path: { id: string };
  body: {
    model?: ModelSpec;
    parts: MessagePart[];
    noReply?: boolean;
  };
}

interface ModelSpec {
  providerID: string;
  modelID: string;
}

interface MessagePart {
  type: 'text' | 'tool' | 'result' | 'file' | 'reasoning';
  text?: string;
  content?: unknown;
}

interface PromptResponse {
  id: string;
}

interface SessionInfo {
  id: string;
  title?: string;
  createdAt?: string;
}

interface MessageInfo {
  id: string;
  role: string;
  parts: MessagePart[];
}

interface EventApi {
  subscribe(): Promise<EventStream>;
}

interface EventStream {
  stream: AsyncIterable<OpenCodeEvent>;
}

type OpenCodeEvent =
  | SessionCreatedEvent
  | SessionIdleEvent
  | SessionErrorEvent
  | MessageUpdatedEvent
  | MessagePartUpdatedEvent
  | ToolExecuteBeforeEvent
  | ToolExecuteAfterEvent;

interface SessionCreatedEvent {
  type: 'session.created';
  properties: {
    sessionID: string;
  };
}

interface SessionIdleEvent {
  type: 'session.idle';
  properties: {
    sessionID: string;
  };
}

interface SessionErrorEvent {
  type: 'session.error';
  properties: {
    sessionID: string;
    error: string;
  };
}

interface MessageUpdatedEvent {
  type: 'message.updated';
  properties: {
    sessionID: string;
    messageID: string;
    role: string;
    parts: MessagePart[];
  };
}

interface MessagePartUpdatedEvent {
  type: 'message.part.updated';
  properties: {
    sessionID: string;
    messageID: string;
    part: MessagePart;
    partIndex: number;
  };
}

interface ToolExecuteBeforeEvent {
  type: 'tool.execute.before';
  properties: {
    sessionID: string;
    toolName: string;
    toolInput: unknown;
  };
}

interface ToolExecuteAfterEvent {
  type: 'tool.execute.after';
  properties: {
    sessionID: string;
    toolName: string;
    toolInput: unknown;
    toolOutput: unknown;
    error?: string;
  };
}

interface AuthApi {
  set(params: { path: { id: string }; body: { type: string; key: string } }): Promise<void>;
}

interface GlobalApi {
  health(): Promise<{ data: { version: string } }>;
}

/**
 * OpenCode SDK adapter.
 */
export class OpenCodeAdapter extends BaseAdapter {
  readonly provider: AgentProvider = 'opencode';
  readonly capabilities: AdapterCapabilities = OPENCODE_CAPABILITIES;

  private sdk: OpenCodeSDK | null = null;
  private serverClient: OpencodeClient | null = null;
  private serverAbortController: AbortController | null = null;

  constructor(options?: AdapterOptions) {
    super(options);
    this.initLogger(options);
  }

  /**
   * Check if OpenCode is configured with valid credentials.
   *
   * OpenCode requires per-provider auth. We check for at least one
   * common provider's API key.
   */
  isConfigured(): boolean {
    return !!(
      process.env['ANTHROPIC_API_KEY'] ||
      process.env['OPENAI_API_KEY'] ||
      process.env['GOOGLE_API_KEY']
    );
  }

  /**
   * Load the OpenCode SDK dynamically.
   */
  private async loadSDK(): Promise<OpenCodeSDK> {
    if (this.sdk) {
      return this.sdk;
    }

    try {
      const module = await import('@opencode-ai/sdk');
      this.sdk = module as unknown as OpenCodeSDK;
      return this.sdk;
    } catch (error) {
      throw new AgentError({
        code: 'SDK_LOAD_FAILED',
        message: 'Failed to load OpenCode SDK. Is @opencode-ai/sdk installed?',
        category: 'invalid_input',
        severity: 'fatal',
        provider: 'opencode',
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  /**
   * Get or create the server client.
   *
   * Auto-starts the OpenCode server if not already running.
   */
  private async getClient(config: AgentSessionConfig): Promise<OpencodeClient> {
    if (this.serverClient) {
      return this.serverClient;
    }

    const sdk = await this.loadSDK();

    this.serverAbortController = new AbortController();

    try {
      const { client } = await sdk.createOpencode({
        hostname: config.hostname ?? '127.0.0.1',
        port: config.port ?? 4096,
        timeout: 10000, // 10 second server startup timeout
        signal: this.serverAbortController.signal,
      });

      this.serverClient = client;
      this.logger.info('OpenCode server connected', {
        hostname: config.hostname ?? '127.0.0.1',
        port: config.port ?? 4096,
      });

      return client;
    } catch (error) {
      throw new AgentError({
        code: 'SERVER_CONNECTION_FAILED',
        message: 'Failed to connect to OpenCode server',
        category: 'network',
        severity: 'retry',
        provider: 'opencode',
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  /**
   * Create a new OpenCode session.
   */
  async createSession(config: AgentSessionConfig): Promise<IAgentSession> {
    this.validateConfig(config);

    if (!this.isConfigured()) {
      throw new AgentError({
        code: 'MISSING_CREDENTIALS',
        message:
          'OpenCode credentials not configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or another provider API key.',
        category: 'authentication',
        severity: 'fatal',
        provider: 'opencode',
      });
    }

    const client = await this.getClient(config);
    const session = new OpenCodeSession(client, config, this.logger);
    await session.initialize();

    this.trackSession(session);

    // Setup cleanup on session end
    session.onEvent(async (event) => {
      if (event.type === 'session_end') {
        this.untrackSession(session.id);
      }
    });

    return session;
  }

  /**
   * Resume an existing OpenCode session.
   */
  override async resumeSession(sessionId: string): Promise<IAgentSession> {
    const { nativeId } = await import('../utils/index.js').then((m) =>
      m.parseSessionId(sessionId),
    );

    const client = await this.getClient({ provider: 'opencode' });
    const session = new OpenCodeSession(client, { provider: 'opencode' }, this.logger, nativeId);

    this.trackSession(session);

    return session;
  }

  /**
   * Cleanup server connection.
   */
  override async cleanup(): Promise<void> {
    await super.cleanup();

    if (this.serverAbortController) {
      this.serverAbortController.abort();
      this.serverAbortController = null;
    }

    this.serverClient = null;
    this.logger.info('OpenCode server connection closed');
  }
}

/**
 * OpenCode session implementation.
 */
class OpenCodeSession extends BaseSession {
  readonly provider: AgentProvider = 'opencode';

  private client: OpencodeClient;
  private nativeSessionId: string | null = null;
  private pendingId: string;
  private eventStreamActive = false;
  private eventAbortController: AbortController | null = null;

  constructor(
    client: OpencodeClient,
    config: AgentSessionConfig,
    logger: Logger,
    resumeId?: string,
  ) {
    super(config, logger);
    this.client = client;
    this.pendingId = createPendingSessionId('opencode');
    this.nativeSessionId = resumeId ?? null;
  }

  /**
   * Session ID in format "opencode:{nativeId}".
   */
  get id(): string {
    return this.nativeSessionId ? `opencode:${this.nativeSessionId}` : this.pendingId;
  }

  /**
   * Initialize the session.
   */
  async initialize(): Promise<void> {
    if (!this.nativeSessionId) {
      const response = await this.client.session.create({
        body: { title: 'Animus Session' },
      });
      this.nativeSessionId = response.id;
    }

    await this.emit(
      this.createEvent('session_start', {
        provider: 'opencode',
        model: this.config.model ?? 'anthropic/claude-sonnet-4-5',
        config: this.config,
      }),
    );

    if (this.hooks.onSessionStart) {
      await this.hooks.onSessionStart({
        sessionId: this.id,
        provider: 'opencode',
        model: this.config.model ?? 'anthropic/claude-sonnet-4-5',
        config: this.config,
      });
    }
  }

  /**
   * Parse model string into provider/model spec.
   */
  private parseModel(): ModelSpec {
    const model = this.config.model ?? 'anthropic/claude-sonnet-4-5';
    const [providerID, ...rest] = model.split('/');
    const modelID = rest.join('/');

    return {
      providerID: providerID ?? 'anthropic',
      modelID: modelID || 'claude-sonnet-4-5',
    };
  }

  /**
   * Send a prompt and get a response.
   */
  async prompt(input: string, options?: PromptOptions): Promise<AgentResponse> {
    this.assertActive();

    if (!this.nativeSessionId) {
      throw new AgentError({
        code: 'SESSION_NOT_INITIALIZED',
        message: 'Session not initialized. Call initialize() first.',
        category: 'invalid_input',
        severity: 'fatal',
        provider: 'opencode',
        sessionId: this.id,
      });
    }

    const startTime = Date.now();
    let response = '';
    let finishReason: AgentResponse['finishReason'] = 'complete';

    try {
      // Emit input received event
      await this.emit(
        this.createEvent('input_received', {
          content: input,
          type: 'text',
        }),
      );

      // Subscribe to events
      const eventStream = await this.client.event.subscribe();
      this.eventAbortController = new AbortController();

      // Start listening for events in background
      const eventPromise = this.processEventStream(eventStream.stream);

      // Send the prompt
      await this.client.session.prompt({
        path: { id: this.nativeSessionId },
        body: {
          model: this.parseModel(),
          parts: [{ type: 'text', text: input }],
        },
      });

      // Wait for session to become idle
      response = await this.waitForResponse(eventStream.stream);

      return {
        content: response,
        finishReason,
        usage: this.getUsage(),
        cost: this.getCost() ?? undefined,
        durationMs: Date.now() - startTime,
        model: this.config.model ?? 'anthropic/claude-sonnet-4-5',
      };
    } catch (error) {
      throw wrapError(error, 'opencode', this.id);
    } finally {
      this.eventAbortController = null;
    }
  }

  /**
   * Send a prompt with streaming response.
   */
  async promptStreaming(
    input: string,
    onChunk: (chunk: string) => void,
    options?: PromptOptions,
  ): Promise<AgentResponse> {
    this.assertActive();

    if (!this.nativeSessionId) {
      throw new AgentError({
        code: 'SESSION_NOT_INITIALIZED',
        message: 'Session not initialized',
        category: 'invalid_input',
        severity: 'fatal',
        provider: 'opencode',
        sessionId: this.id,
      });
    }

    const startTime = Date.now();
    let response = '';
    let accumulated = '';
    let finishReason: AgentResponse['finishReason'] = 'complete';

    try {
      // Emit events
      await this.emit(
        this.createEvent('input_received', {
          content: input,
          type: 'text',
        }),
      );
      await this.emit(this.createEvent('response_start', {}));

      // Subscribe to events
      const eventStream = await this.client.event.subscribe();
      this.eventAbortController = new AbortController();

      // Send the prompt
      await this.client.session.prompt({
        path: { id: this.nativeSessionId },
        body: {
          model: this.parseModel(),
          parts: [{ type: 'text', text: input }],
        },
      });

      // Process events with streaming
      for await (const event of eventStream.stream) {
        // Filter for our session
        if (!this.isOurSessionEvent(event)) {
          continue;
        }

        await this.processEvent(event);

        // Handle text streaming
        if (event.type === 'message.part.updated') {
          const part = event.properties.part;
          if (part.type === 'text' && part.text) {
            const chunk = part.text.slice(accumulated.length);
            if (chunk) {
              accumulated = part.text;
              onChunk(chunk);

              await this.emit(
                this.createEvent('response_chunk', {
                  content: chunk,
                  accumulated,
                }),
              );
            }
          }
        }

        // Check for completion
        if (event.type === 'session.idle') {
          response = accumulated;
          break;
        }

        if (event.type === 'session.error') {
          finishReason = 'error';
          break;
        }
      }

      // Emit response end
      await this.emit(
        this.createEvent('response_end', {
          content: response,
          finishReason,
        }),
      );

      return {
        content: response,
        finishReason,
        usage: this.getUsage(),
        cost: this.getCost() ?? undefined,
        durationMs: Date.now() - startTime,
        model: this.config.model ?? 'anthropic/claude-sonnet-4-5',
      };
    } catch (error) {
      throw wrapError(error, 'opencode', this.id);
    } finally {
      this.eventAbortController = null;
    }
  }

  /**
   * Cancel the current operation.
   */
  async cancel(): Promise<void> {
    if (!this.nativeSessionId) {
      return;
    }

    this.logger.info('Cancelling session', { sessionId: this.id });

    try {
      await this.client.session.abort({
        path: { id: this.nativeSessionId },
      });
    } catch (error) {
      this.logger.warn('Failed to abort session', { error: String(error) });
    }
  }

  /**
   * End the session.
   */
  async end(): Promise<void> {
    if (!this._isActive) {
      return;
    }

    this.logger.info('Ending session', { sessionId: this.id });

    if (this.nativeSessionId) {
      try {
        await this.client.session.delete({
          path: { id: this.nativeSessionId },
        });
      } catch (error) {
        this.logger.warn('Failed to delete session', { error: String(error) });
      }
    }

    this._isActive = false;

    await this.emit(
      this.createEvent('session_end', {
        reason: 'completed',
        totalDurationMs: this.getDurationMs(),
      }),
    );

    if (this.hooks.onSessionEnd) {
      await this.hooks.onSessionEnd({
        sessionId: this.id,
        reason: 'completed',
        totalDurationMs: this.getDurationMs(),
      });
    }
  }

  /**
   * Check if an event belongs to our session.
   */
  private isOurSessionEvent(event: OpenCodeEvent): boolean {
    if ('properties' in event && 'sessionID' in event.properties) {
      return event.properties.sessionID === this.nativeSessionId;
    }
    return false;
  }

  /**
   * Process the event stream in background.
   */
  private async processEventStream(stream: AsyncIterable<OpenCodeEvent>): Promise<void> {
    try {
      for await (const event of stream) {
        if (!this.isOurSessionEvent(event)) {
          continue;
        }
        await this.processEvent(event);
      }
    } catch (error) {
      this.logger.debug('Event stream ended', { error: String(error) });
    }
  }

  /**
   * Wait for response by listening to event stream.
   */
  private async waitForResponse(stream: AsyncIterable<OpenCodeEvent>): Promise<string> {
    let response = '';

    for await (const event of stream) {
      if (!this.isOurSessionEvent(event)) {
        continue;
      }

      await this.processEvent(event);

      // Collect text from message updates
      if (event.type === 'message.updated') {
        const textParts = event.properties.parts
          .filter((p) => p.type === 'text')
          .map((p) => p.text ?? '')
          .join('');
        response = textParts;
      }

      // Check for completion
      if (event.type === 'session.idle') {
        break;
      }

      if (event.type === 'session.error') {
        throw new AgentError({
          code: 'SESSION_ERROR',
          message: event.properties.error,
          category: 'execution',
          severity: 'recoverable',
          provider: 'opencode',
          sessionId: this.id,
        });
      }
    }

    return response;
  }

  /**
   * Process an OpenCode event and emit appropriate unified events.
   */
  private async processEvent(event: OpenCodeEvent): Promise<void> {
    switch (event.type) {
      case 'session.created':
        // Already handled in initialize
        break;

      case 'session.idle':
        // Session completed - handled in waitForResponse
        break;

      case 'session.error':
        await this.emit(
          this.createEvent('error', {
            code: 'SESSION_ERROR',
            message: event.properties.error,
            recoverable: false,
          }),
        );

        if (this.hooks.onToolError) {
          await this.hooks.onToolError({
            sessionId: this.id,
            toolName: 'unknown',
            toolInput: {},
            toolCallId: generateUUID(),
            error: event.properties.error,
            isRetryable: false,
          });
        }
        break;

      case 'message.part.updated':
        const part = event.properties.part;

        // Handle reasoning/thinking
        if (part.type === 'reasoning') {
          // Could emit thinking events here
        }

        // Handle tool results
        if (part.type === 'result') {
          // Tool completed
        }
        break;

      case 'tool.execute.before':
        const beforeToolId = generateUUID();

        // Call hook (cannot block, can modify)
        if (this.hooks.onPreToolUse) {
          const result = await this.hooks.onPreToolUse({
            sessionId: this.id,
            toolName: event.properties.toolName,
            toolInput: event.properties.toolInput,
            toolCallId: beforeToolId,
          });

          if (result?.allow === false) {
            this.logger.warn(
              'onPreToolUse returned allow=false, but OpenCode does not support blocking tool calls',
              { sessionId: this.id },
            );
          }
        }

        await this.emit(
          this.createEvent('tool_call_start', {
            toolName: event.properties.toolName,
            toolInput: (event.properties.toolInput as Record<string, unknown>) ?? {},
            toolCallId: beforeToolId,
          }),
        );
        break;

      case 'tool.execute.after':
        const afterToolId = generateUUID();

        if (event.properties.error) {
          await this.emit(
            this.createEvent('tool_error', {
              toolCallId: afterToolId,
              toolName: event.properties.toolName,
              error: event.properties.error,
              isRetryable: false,
            }),
          );

          if (this.hooks.onToolError) {
            await this.hooks.onToolError({
              sessionId: this.id,
              toolName: event.properties.toolName,
              toolInput: event.properties.toolInput,
              toolCallId: afterToolId,
              error: event.properties.error,
              isRetryable: false,
            });
          }
        } else {
          await this.emit(
            this.createEvent('tool_call_end', {
              toolCallId: afterToolId,
              toolName: event.properties.toolName,
              output: event.properties.toolOutput,
              durationMs: 0, // Not available
            }),
          );

          if (this.hooks.onPostToolUse) {
            await this.hooks.onPostToolUse({
              sessionId: this.id,
              toolName: event.properties.toolName,
              toolInput: event.properties.toolInput,
              toolCallId: afterToolId,
              toolOutput: event.properties.toolOutput,
              durationMs: 0,
            });
          }
        }
        break;
    }
  }
}
