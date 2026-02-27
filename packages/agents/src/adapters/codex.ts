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

import type { AgentProvider } from '@animus-labs/shared';
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
  model?: string;
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
   * 2. CODEX_OAUTH_CONFIGURED sentinel (set by Animus OAuth flow)
   * 3. Pre-authenticated Codex CLI at ~/.codex/auth.json
   */
  isConfigured(): boolean {
    // Check API key
    if (process.env['OPENAI_API_KEY']) {
      return true;
    }

    // Check for Codex OAuth configured via Animus
    if (process.env['CODEX_OAUTH_CONFIGURED']) {
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
   * List available models for the Codex provider.
   *
   * Returns the hardcoded capability list. Codex SDK does not
   * provide a runtime model discovery API.
   */
  async listModels(): Promise<Array<{ id: string; name: string }>> {
    return this.capabilities.supportedModels.map((id) => ({ id, name: id }));
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

    // The Codex SDK treats `env` as a complete replacement (not a merge with
    // process.env). If we only pass our overrides (e.g. CODEX_HOME), the
    // subprocess loses PATH, HOME, OPENAI_API_KEY, and everything else.
    // Merge our overrides onto the full process.env so the subprocess has a
    // working environment while still picking up our CODEX_HOME override.
    let mergedEnv: Record<string, string> | undefined;
    if (config.env) {
      mergedEnv = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) mergedEnv[key] = value;
      }
      Object.assign(mergedEnv, config.env);
    }
    // Build Codex-specific config from session config
    const codexConfig: Record<string, unknown> = {};

    // System prompt via developer_instructions
    if (config.systemPrompt) {
      const prompt = typeof config.systemPrompt === 'string'
        ? config.systemPrompt
        : config.systemPrompt.append ?? '';
      if (prompt) {
        codexConfig['developer_instructions'] = prompt;
      }
    }

    // MCP server configs -- pass through as-is, Codex SDK accepts them in config
    if (config.mcpServers && Object.keys(config.mcpServers).length > 0) {
      codexConfig['mcp_servers'] = config.mcpServers;
    }

    // Tool permission enforcement via approval_policy
    // Determine if any enabled tools require 'ask' mode approval.
    // If all enabled tools are in allowedTools, use 'never' (auto-approve all).
    // Otherwise default to 'on-request' as the safe default.
    // Note: Codex runs as a headless subprocess. If 'on-request' causes hangs,
    // we may need to fall back to binary mode (always_allow + off only).
    if (config.allowedTools && config.disallowedTools) {
      // All tools explicitly accounted for -- safe to auto-approve
      codexConfig['approval_policy'] = 'never';
    } else if (config.allowedTools && config.allowedTools.length > 0) {
      // Some tools allowed, but we can't know if there are 'ask' mode tools
      // without the full tool count. Default safe.
      codexConfig['approval_policy'] = 'never';
    } else {
      codexConfig['approval_policy'] = 'on-request';
    }

    const codex = new sdk.Codex({
      env: mergedEnv,
      config: codexConfig,
    });

    const session = new CodexSession(codex, config, this.logger, config.resume);
    const initialId = session.id;  // Capture pending ID before it changes
    this.trackSession(session);

    // Setup cleanup on session end -- untrack by both IDs to handle ID changes
    session.onEvent(async (event) => {
      if (event.type === 'session_end') {
        this.untrackSession(session.id);    // native thread ID
        this.untrackSession(initialId);     // pending ID
      }
    });

    return session;
  }

  /**
   * Resume an existing Codex thread.
   *
   * Delegates to createSession() with the resume option set, so the full
   * config-building logic (system prompt, MCP servers, approval policy)
   * runs for the resumed session, matching Claude's behavior.
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

    return this.createSession({ provider: 'codex', resume: nativeId });
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
  /** Tracks the toolCallId from item.started so item.completed can reuse it */
  private activeToolCallId: string | null = null;

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
   * Get the model name for this session.
   */
  getModelName(): string {
    return this.config.model ?? 'codex-mini-latest';
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
      model: this.config.model,
      workingDirectory: this.config.workingDirectory ?? this.config.cwd,
      skipGitRepoCheck: this.config.skipGitRepoCheck,
    });

    // temperature and maxOutputTokens are not supported by Codex SDK
    if (this.config.temperature !== undefined) {
      this.logger.debug('temperature not supported by Codex SDK, ignoring');
    }
    if (this.config.maxOutputTokens !== undefined) {
      this.logger.debug('maxOutputTokens not supported by Codex SDK, ignoring');
    }

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
            config: { ...this.config },
          }),
        );

        if (this.hooks.onSessionStart) {
          await this.hooks.onSessionStart({
            sessionId: this.id,
            provider: 'codex',
            model: this.config.model ?? 'codex-mini-latest',
            config: { ...this.config },
          });
        }
      }

      // Run the prompt
      const result = await thread.run(input);
      response = result.finalResponse;

      // Update usage and calculate cost
      if (result.usage) {
        this.updateUsage({
          inputTokens: result.usage.input_tokens ?? 0,
          outputTokens: result.usage.output_tokens ?? 0,
        });
      }
      this.calculateAndSetCost();

      // Inspect result items for tool calls and thinking
      const toolItems = (result.items ?? []).filter(
        (item) => item.type === 'command' || item.type === 'tool',
      );
      const hasToolCalls = toolItems.length > 0;
      const toolNames = toolItems.map((item) => item.type);
      const hasThinking = (result.items ?? []).some((item) => item.type === 'reasoning');

      // Emit turn_end for consistency with streaming path
      const turnResult = {
        turnIndex: 0,
        text: response,
        hasToolCalls,
        hasThinking,
        toolNames,
      };
      await this.emit(this.createEvent('turn_end', turnResult));

      return {
        content: response,
        turns: [turnResult],
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
    onChunk: (chunk: string, meta: import('../types.js').StreamChunkMeta) => void,
    options?: PromptOptions,
  ): Promise<AgentResponse> {
    this.assertActive();

    const startTime = Date.now();
    let response = '';
    let accumulated = '';
    let finishReason: AgentResponse['finishReason'] = 'complete';

    // Turn tracking state
    let turnIndex = 0;
    let currentTurnText = '';
    let currentTurnHasToolCalls = false;
    let currentTurnToolNames: string[] = [];
    let currentTurnHasThinking = false;
    const turns: import('../types.js').TurnResult[] = [];

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

          case 'item.started':
            // When a tool call starts, emit turn_end for any accumulated text
            if (event.item.type === 'command' || event.item.type === 'tool') {
              if (currentTurnText) {
                const turnResult = {
                  turnIndex,
                  text: currentTurnText,
                  hasToolCalls: true,
                  hasThinking: currentTurnHasThinking,
                  toolNames: [...currentTurnToolNames],
                };
                turns.push(turnResult);
                await this.emit(this.createEvent('turn_end', turnResult));
                turnIndex++;
                currentTurnText = '';
                currentTurnToolNames = [];
                currentTurnHasThinking = false;
              }
              currentTurnHasToolCalls = true;
              currentTurnToolNames.push(event.item.type);
            }
            if (event.item.type === 'reasoning') {
              currentTurnHasThinking = true;
            }
            break;

          case 'item/agentMessage/delta':
            if (event.delta?.text) {
              const chunk = event.delta.text;
              accumulated += chunk;
              currentTurnText += chunk;
              onChunk(chunk, { turnIndex });

              await this.emit(
                this.createEvent('response_chunk', {
                  content: chunk,
                  accumulated,
                }),
              );
            }
            break;

          case 'item/reasoning/delta':
            // Reasoning deltas tracked for hasThinking but not appended to turn text
            currentTurnHasThinking = true;
            break;

          case 'turn.completed':
            response = accumulated;
            if (event.usage) {
              this.updateUsage({
                inputTokens: event.usage.input_tokens ?? 0,
                outputTokens: event.usage.output_tokens ?? 0,
              });
            }

            // Emit turn_end for remaining text OR tool-only turns (matches Claude behavior
            // which always emits turn_end for every assistant message, even with empty text)
            if (currentTurnText || currentTurnHasToolCalls) {
              const turnResult = {
                turnIndex,
                text: currentTurnText,
                hasToolCalls: currentTurnHasToolCalls,
                hasThinking: currentTurnHasThinking,
                toolNames: [...currentTurnToolNames],
              };
              turns.push(turnResult);
              await this.emit(this.createEvent('turn_end', turnResult));
              turnIndex++;
              currentTurnText = '';
              currentTurnToolNames = [];
              currentTurnHasThinking = false;
              currentTurnHasToolCalls = false;
            }
            break;

          case 'turn.failed':
            finishReason = 'error';
            break;
        }
      }

      // Calculate cost from registry
      this.calculateAndSetCost();

      // Emit response end
      await this.emit(
        this.createEvent('response_end', {
          content: response,
          finishReason,
        }),
      );

      return {
        content: response,
        turns: turns.length > 0 ? turns : [{ turnIndex: 0, text: response, hasToolCalls: false, hasThinking: false, toolNames: [] }],
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
    await this.cancel();
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
            config: { ...this.config },
          }),
        );

        if (this.hooks.onSessionStart) {
          await this.hooks.onSessionStart({
            sessionId: this.id,
            provider: 'codex',
            model: this.config.model ?? 'codex-mini-latest',
            config: { ...this.config },
          });
        }
        break;

      case 'item.started':
        // Check if this is a command/tool execution
        if (event.item.type === 'command' || event.item.type === 'tool') {
          const toolCallId = generateUUID();
          this.activeToolCallId = toolCallId;

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
          // Reuse the toolCallId from item.started so start/end can be correlated
          const toolCallId = this.activeToolCallId ?? generateUUID();
          this.activeToolCallId = null;

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
