/**
 * OpenAI Codex SDK adapter.
 *
 * Implements the unified agent interface using the Codex SDK.
 * The SDK wraps a bundled codex binary, spawning the CLI and
 * exchanging JSONL events over stdin/stdout.
 *
 * Key Limitation: Codex does NOT support cancel/abort operations.
 *
 * @see https://developers.openai.com/codex/sdk/
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
import { CODEX_CAPABILITIES } from '../capabilities.js';
import { BaseAdapter, BaseSession, type AdapterOptions } from './base.js';
import { generateUUID, createPendingSessionId } from '../utils/index.js';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Type declarations for the Codex SDK
interface CodexSDK {
  Codex: new (options?: CodexOptions) => CodexClient;
}

interface CodexOptions {
  env?: Record<string, string>;
  config?: Record<string, unknown>;
}

interface CodexClient {
  startThread(options?: ThreadOptions): CodexThread;
  resumeThread(threadId: string): CodexThread;
}

interface ThreadOptions {
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;
}

interface CodexThread {
  id: string;
  run(input: string | InputPart[], options?: RunOptions): Promise<TurnResult>;
  runStreamed(input: string | InputPart[], options?: RunOptions): Promise<StreamedResult>;
}

interface InputPart {
  type: 'text' | 'local_image';
  text?: string;
  path?: string;
}

interface RunOptions {
  outputSchema?: object;
}

interface TurnResult {
  finalResponse: string;
  items: TurnItem[];
  usage?: UsageInfo;
}

interface StreamedResult {
  events: AsyncIterable<CodexEvent>;
}

interface TurnItem {
  type: string;
  content?: string;
}

type CodexEvent =
  | ThreadStartedEvent
  | TurnStartedEvent
  | ItemStartedEvent
  | ItemCompletedEvent
  | ItemDeltaEvent
  | TurnCompletedEvent
  | TurnFailedEvent
  | ErrorEvent;

interface ThreadStartedEvent {
  type: 'thread.started';
  thread_id: string;
}

interface TurnStartedEvent {
  type: 'turn.started';
}

interface ItemStartedEvent {
  type: 'item.started';
  item: TurnItem;
}

interface ItemCompletedEvent {
  type: 'item.completed';
  item: TurnItem;
}

interface ItemDeltaEvent {
  type: 'item/agentMessage/delta' | 'item/reasoning/delta';
  delta?: {
    text?: string;
  };
}

interface TurnCompletedEvent {
  type: 'turn.completed';
  usage?: UsageInfo;
}

interface TurnFailedEvent {
  type: 'turn.failed';
  error?: string;
}

interface ErrorEvent {
  type: 'error';
  error?: string;
}

interface UsageInfo {
  input_tokens?: number;
  output_tokens?: number;
}

/**
 * OpenAI Codex SDK adapter.
 */
export class CodexAdapter extends BaseAdapter {
  readonly provider: AgentProvider = 'codex';
  readonly capabilities: AdapterCapabilities = CODEX_CAPABILITIES;

  private sdk: CodexSDK | null = null;

  constructor(options?: AdapterOptions) {
    super(options);
    this.initLogger(options);
  }

  /**
   * Check if Codex is configured with valid credentials.
   *
   * Checks for:
   * 1. OPENAI_API_KEY environment variable
   * 2. Pre-authenticated Codex CLI at ~/.codex/auth.json
   */
  isConfigured(): boolean {
    // Check API key
    if (process.env['OPENAI_API_KEY']) {
      return true;
    }

    // Check for pre-authenticated Codex CLI
    try {
      const authPath = join(homedir(), '.codex', 'auth.json');
      return existsSync(authPath);
    } catch {
      return false;
    }
  }

  /**
   * Load the Codex SDK dynamically.
   */
  private async loadSDK(): Promise<CodexSDK> {
    if (this.sdk) {
      return this.sdk;
    }

    try {
      const module = await import('@openai/codex-sdk');
      this.sdk = module as unknown as CodexSDK;
      return this.sdk;
    } catch (error) {
      throw new AgentError({
        code: 'SDK_LOAD_FAILED',
        message: 'Failed to load Codex SDK. Is @openai/codex-sdk installed?',
        category: 'invalid_input',
        severity: 'fatal',
        provider: 'codex',
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  /**
   * Create a new Codex session.
   */
  async createSession(config: AgentSessionConfig): Promise<IAgentSession> {
    this.validateConfig(config);

    if (config.provider !== this.provider) {
      throw new AgentError({
        code: 'PROVIDER_MISMATCH',
        message: `Config provider "${config.provider}" does not match adapter provider "${this.provider}"`,
        category: 'invalid_input',
        severity: 'fatal',
        provider: this.provider,
      });
    }

    if (!this.isConfigured()) {
      throw new AgentError({
        code: 'MISSING_CREDENTIALS',
        message:
          'Codex credentials not configured. Set OPENAI_API_KEY or authenticate via `codex` CLI.',
        category: 'authentication',
        severity: 'fatal',
        provider: 'codex',
      });
    }

    const sdk = await this.loadSDK();
    const codex = new sdk.Codex({
      env: config.env,
    });

    const session = new CodexSession(codex, config, this.logger);
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
   * Resume an existing Codex thread.
   */
  override async resumeSession(sessionId: string): Promise<IAgentSession> {
    const { provider, nativeId } = await import('../utils/index.js').then((m) =>
      m.parseSessionId(sessionId),
    );

    if (provider !== this.provider) {
      throw new AgentError({
        code: 'PROVIDER_MISMATCH',
        message: `Session ${sessionId} belongs to ${provider}, not ${this.provider}`,
        category: 'invalid_input',
        severity: 'fatal',
        provider: this.provider,
      });
    }

    if (!this.isConfigured()) {
      throw new AgentError({
        code: 'MISSING_CREDENTIALS',
        message: 'Codex credentials not configured.',
        category: 'authentication',
        severity: 'fatal',
        provider: 'codex',
      });
    }

    const sdk = await this.loadSDK();
    const codex = new sdk.Codex();
    const session = new CodexSession(codex, { provider: 'codex' }, this.logger, nativeId);

    this.trackSession(session);

    return session;
  }
}

/**
 * Codex session implementation.
 */
class CodexSession extends BaseSession {
  readonly provider: AgentProvider = 'codex';

  private codex: CodexClient;
  private thread: CodexThread | null = null;
  private pendingId: string;
  private resumeThreadId: string | null;

  constructor(
    codex: CodexClient,
    config: AgentSessionConfig,
    logger: Logger,
    resumeId?: string,
  ) {
    super(config, logger);
    this.codex = codex;
    this.pendingId = createPendingSessionId('codex');
    this.resumeThreadId = resumeId ?? null;
  }

  /**
   * Session ID in format "codex:{threadId}".
   */
  get id(): string {
    return this.thread ? `codex:${this.thread.id}` : this.pendingId;
  }

  /**
   * Initialize thread if needed.
   */
  private async ensureThread(): Promise<CodexThread> {
    if (this.thread) {
      return this.thread;
    }

    // Resume existing thread
    if (this.resumeThreadId) {
      this.thread = this.codex.resumeThread(this.resumeThreadId);
      return this.thread;
    }

    // Start new thread
    this.thread = this.codex.startThread({
      workingDirectory: this.config.workingDirectory ?? this.config.cwd,
      skipGitRepoCheck: this.config.skipGitRepoCheck,
    });

    return this.thread;
  }

  /**
   * Send a prompt and get a response.
   */
  async prompt(input: string, options?: PromptOptions): Promise<AgentResponse> {
    this.assertActive();

    const startTime = Date.now();
    let response = '';
    let finishReason: AgentResponse['finishReason'] = 'complete';

    try {
      const thread = await this.ensureThread();

      // Emit input received event
      await this.emit(
        this.createEvent('input_received', {
          content: input,
          type: 'text',
        }),
      );

      // Emit session start on first prompt
      if (!this.resumeThreadId) {
        await this.emit(
          this.createEvent('session_start', {
            provider: 'codex',
            model: this.config.model ?? 'codex-mini-latest',
            config: this.config,
          }),
        );

        if (this.hooks.onSessionStart) {
          await this.hooks.onSessionStart({
            sessionId: this.id,
            provider: 'codex',
            model: this.config.model ?? 'codex-mini-latest',
            config: this.config,
          });
        }
      }

      // Run the prompt
      const result = await thread.run(input);
      response = result.finalResponse;

      // Update usage
      if (result.usage) {
        this.updateUsage({
          inputTokens: result.usage.input_tokens ?? 0,
          outputTokens: result.usage.output_tokens ?? 0,
        });
      }

      return {
        content: response,
        finishReason,
        usage: this.getUsage(),
        cost: this.getCost() ?? undefined,
        durationMs: Date.now() - startTime,
        model: this.config.model ?? 'codex-mini-latest',
      };
    } catch (error) {
      throw wrapError(error, 'codex', this.id);
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

    const startTime = Date.now();
    let response = '';
    let accumulated = '';
    let finishReason: AgentResponse['finishReason'] = 'complete';

    try {
      const thread = await this.ensureThread();

      // Emit input received event
      await this.emit(
        this.createEvent('input_received', {
          content: input,
          type: 'text',
        }),
      );

      // Run streamed
      const { events } = await thread.runStreamed(input);

      // Emit response start
      await this.emit(this.createEvent('response_start', {}));

      for await (const event of events) {
        await this.processEvent(event);

        switch (event.type) {
          case 'thread.started':
            // Session already started
            break;

          case 'item/agentMessage/delta':
            if (event.delta?.text) {
              const chunk = event.delta.text;
              accumulated += chunk;
              onChunk(chunk);

              await this.emit(
                this.createEvent('response_chunk', {
                  content: chunk,
                  accumulated,
                }),
              );
            }
            break;

          case 'turn.completed':
            response = accumulated;
            if (event.usage) {
              this.updateUsage({
                inputTokens: event.usage.input_tokens ?? 0,
                outputTokens: event.usage.output_tokens ?? 0,
              });
            }
            break;

          case 'turn.failed':
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
        model: this.config.model ?? 'codex-mini-latest',
      };
    } catch (error) {
      throw wrapError(error, 'codex', this.id);
    }
  }

  /**
   * Cancel the current operation.
   *
   * NOTE: Codex SDK does NOT support cancel/abort.
   * This is a no-op that logs a warning.
   */
  async cancel(): Promise<void> {
    this.logger.warn(
      'Cancel operation not supported for Codex provider. Operation will complete naturally.',
      { sessionId: this.id },
    );
    // No-op - Codex doesn't support cancel
  }

  /**
   * End the session.
   */
  async end(): Promise<void> {
    if (!this._isActive) {
      return;
    }

    this.logger.info('Ending session', { sessionId: this.id });
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
   * Process a Codex event and emit appropriate unified events.
   */
  private async processEvent(event: CodexEvent): Promise<void> {
    switch (event.type) {
      case 'thread.started':
        await this.emit(
          this.createEvent('session_start', {
            provider: 'codex',
            model: this.config.model ?? 'codex-mini-latest',
            config: this.config,
          }),
        );

        if (this.hooks.onSessionStart) {
          await this.hooks.onSessionStart({
            sessionId: this.id,
            provider: 'codex',
            model: this.config.model ?? 'codex-mini-latest',
            config: this.config,
          });
        }
        break;

      case 'item.started':
        // Check if this is a command/tool execution
        if (event.item.type === 'command' || event.item.type === 'tool') {
          const toolCallId = generateUUID();

          // Emit pre-tool-use for logging (cannot block)
          if (this.hooks.onPreToolUse) {
            const result = await this.hooks.onPreToolUse({
              sessionId: this.id,
              toolName: event.item.type,
              toolInput: event.item.content,
              toolCallId,
            });

            // Warn if user tried to block
            if (result?.allow === false) {
              this.logger.warn(
                'onPreToolUse returned allow=false, but Codex does not support blocking tool calls',
                { sessionId: this.id },
              );
            }
          }

          await this.emit(
            this.createEvent('tool_call_start', {
              toolName: event.item.type,
              toolInput: { content: event.item.content },
              toolCallId,
            }),
          );
        }

        // Check for reasoning/thinking
        if (event.item.type === 'reasoning') {
          await this.emit(this.createEvent('thinking_start', {}));
        }
        break;

      case 'item.completed':
        if (event.item.type === 'command' || event.item.type === 'tool') {
          const toolCallId = generateUUID();

          await this.emit(
            this.createEvent('tool_call_end', {
              toolCallId,
              toolName: event.item.type,
              output: event.item.content,
              durationMs: 0, // Not available
            }),
          );

          if (this.hooks.onPostToolUse) {
            await this.hooks.onPostToolUse({
              sessionId: this.id,
              toolName: event.item.type,
              toolInput: {},
              toolCallId,
              toolOutput: event.item.content,
              durationMs: 0,
            });
          }
        }

        if (event.item.type === 'reasoning') {
          await this.emit(
            this.createEvent('thinking_end', {
              thinkingDurationMs: 0,
              content: event.item.content,
            }),
          );
        }
        break;

      case 'turn.failed':
        await this.emit(
          this.createEvent('error', {
            code: 'TURN_FAILED',
            message: event.error ?? 'Turn failed',
            recoverable: false,
          }),
        );

        if (this.hooks.onToolError) {
          await this.hooks.onToolError({
            sessionId: this.id,
            toolName: 'unknown',
            toolInput: {},
            toolCallId: generateUUID(),
            error: event.error ?? 'Turn failed',
            isRetryable: false,
          });
        }
        break;

      case 'error':
        await this.emit(
          this.createEvent('error', {
            code: 'CODEX_ERROR',
            message: event.error ?? 'Unknown error',
            recoverable: false,
          }),
        );
        break;
    }
  }
}
