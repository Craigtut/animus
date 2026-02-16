/**
 * Claude Agent SDK adapter.
 *
 * Implements the unified agent interface using the Claude Agent SDK.
 * The SDK spawns Claude Code CLI as a subprocess and communicates
 * via JSON-lines over stdin/stdout.
 *
 * @see https://platform.claude.com/docs/en/agent-sdk/overview
 */

import type { AgentProvider } from '@animus/shared';
import type {
  AgentSessionConfig,
  AdapterCapabilities,
  IAgentSession,
  AgentResponse,
  SessionUsage,
  AgentCost,
  PromptOptions,
  HookResult,
} from '../types.js';
import { AgentError, wrapError } from '../errors.js';
import { createTaggedLogger, type Logger } from '../logger.js';
import { CLAUDE_CAPABILITIES } from '../capabilities.js';
import { BaseAdapter, BaseSession, type AdapterOptions } from './base.js';
import { generateUUID, now, createPendingSessionId } from '../utils/index.js';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Type declarations for the Claude Agent SDK
// The actual SDK will be dynamically imported
interface ClaudeSDK {
  query: (params: QueryParams) => Query;
}

interface QueryParams {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: QueryOptions;
}

interface QueryOptions {
  model?: string;
  systemPrompt?: string;
  cwd?: string;
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
  allowDangerouslySkipPermissions?: boolean;
  allowedTools?: string[];
  disallowedTools?: string[];
  maxTurns?: number;
  maxBudgetUsd?: number;
  maxThinkingTokens?: number;
  includePartialMessages?: boolean;
  abortController?: AbortController;
  resume?: string;
  forkSession?: boolean;
  mcpServers?: Record<string, unknown>;
  hooks?: Record<string, HookMatcher[]>;
  env?: Record<string, string>;
  outputFormat?: {
    type: 'json_schema';
    schema: Record<string, unknown>;
  };
  /** Control which filesystem settings to load. Include 'project' to discover skills and CLAUDE.md. */
  settingSources?: Array<'user' | 'project' | 'local'>;
  stderr?: (message: string) => void;
}

interface HookMatcher {
  matcher: string;
  hooks: HookCallback[];
}

type HookCallback = (input: HookInput) => Promise<HookOutput>;

interface HookInput {
  hook_event_name: string;
  session_id: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
  error?: string;
}

interface HookOutput {
  continue?: boolean;
  decision?: 'approve' | 'block';
  hookSpecificOutput?: {
    hookEventName: string;
    permissionDecision?: 'allow' | 'deny' | 'ask';
    updatedInput?: Record<string, unknown>;
  };
}

interface Query extends AsyncGenerator<SDKMessage, void> {
  interrupt(): Promise<void>;
  setPermissionMode(mode: string): Promise<void>;
  setModel(model?: string): Promise<void>;
  supportedModels(): Promise<ModelInfo[]>;
  accountInfo(): Promise<AccountInfo>;
}

interface SDKUserMessage {
  type: 'user';
  message: {
    role: 'user';
    content: string | ContentPart[];
  };
}

// ============================================================================
// Message Stream for AsyncIterable Prompt
// ============================================================================

/**
 * Creates a push-based async iterable for feeding user messages into a
 * Claude SDK `query()` call using the `AsyncIterable<SDKUserMessage>` form.
 *
 * This allows injecting additional user messages while the agent is
 * actively processing — enabling mid-tick message injection.
 *
 * **Lifecycle**: The stream blocks on `next()` when the queue is empty,
 * keeping stdin open to the CLI subprocess. This is intentional — the
 * SDK's `stream_input` task eagerly drains the iterable, so the stream
 * must stay open for the entire query duration to allow message injection
 * at any point. The stream is ended explicitly by calling `end()` when
 * the `result` message is received on the output side (see promptStreaming).
 *
 * **Why end() on result is safe for injected messages**: Messages pushed
 * before the result are already in the CLI's stdin buffer (stream_input
 * consumed them eagerly). The iterator also delivers any remaining queued
 * items before signaling done (queue check precedes done check in next()).
 * So calling end() after the result doesn't lose buffered messages — the
 * CLI reads all stdin data before seeing EOF.
 *
 * This avoids the known issue (GitHub #9705) where premature stdin closure
 * breaks the bidirectional hook/control protocol.
 */
function createMessageStream(): MessageStream {
  const queue: SDKUserMessage[] = [];
  let waiting: ((result: IteratorResult<SDKUserMessage>) => void) | null = null;
  let done = false;

  const iterable: AsyncIterable<SDKUserMessage> = {
    [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
      return {
        next(): Promise<IteratorResult<SDKUserMessage>> {
          // If there's a queued message, return it immediately
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift()!, done: false });
          }
          // If the stream has been ended, signal completion
          if (done) {
            return Promise.resolve({ value: undefined as unknown as SDKUserMessage, done: true });
          }
          // Queue is empty — block until a message is pushed or end() is called.
          // The SDK's stream_input task will be blocked here, keeping stdin
          // open to the CLI subprocess. This is the desired behavior.
          return new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
            waiting = resolve;
          });
        },
      };
    },
  };

  return {
    /** Push a user message into the stream */
    push(msg: SDKUserMessage): void {
      if (done) return;
      if (waiting) {
        const resolve = waiting;
        waiting = null;
        resolve({ value: msg, done: false });
      } else {
        queue.push(msg);
      }
    },
    /** Signal that no more messages will be pushed */
    end(): void {
      done = true;
      if (waiting) {
        const resolve = waiting;
        waiting = null;
        resolve({ value: undefined as unknown as SDKUserMessage, done: true });
      }
    },
    iterable,
  };
}

interface MessageStream {
  push(msg: SDKUserMessage): void;
  end(): void;
  iterable: AsyncIterable<SDKUserMessage>;
}

interface ContentPart {
  type: 'text' | 'image';
  text?: string;
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

type SDKMessage =
  | SystemMessage
  | AssistantMessage
  | ResultMessage
  | PartialMessage
  | StreamEventMessage;

interface SystemMessage {
  type: 'system';
  subtype: 'init' | string;
  session_id: string;
  model?: string;
}

interface AssistantMessage {
  type: 'assistant';
  message: {
    content: ContentBlock[];
  };
}

interface ContentBlock {
  type: 'text' | 'tool_use' | 'thinking';
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

interface ResultMessage {
  type: 'result';
  subtype: 'success' | 'error_max_turns' | 'error_during_execution' | 'error_max_budget_usd' | 'error_max_structured_output_retries';
  session_id: string;
  duration_ms: number;
  num_turns: number;
  result: string;
  total_cost_usd: number;
  structured_output?: unknown;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

interface PartialMessage {
  type: 'partial';
  content: string;
}

interface StreamEventMessage {
  type: 'stream_event';
  event: StreamEvent;
}

interface StreamEvent {
  type: string;
  delta?: {
    type: string;
    text?: string;
  };
}

interface ModelInfo {
  id: string;
  name: string;
}

interface AccountInfo {
  email?: string;
  plan?: string;
}

/**
 * Claude Agent SDK adapter.
 */
export class ClaudeAdapter extends BaseAdapter {
  readonly provider: AgentProvider = 'claude';
  readonly capabilities: AdapterCapabilities = CLAUDE_CAPABILITIES;

  private sdk: ClaudeSDK | null = null;

  constructor(options?: AdapterOptions) {
    super(options);
    this.initLogger(options);
  }

  /**
   * Check if Claude is configured with valid credentials.
   *
   * Checks for:
   * 1. ANTHROPIC_API_KEY environment variable
   * 2. CLAUDE_CODE_OAUTH_TOKEN environment variable
   * 3. CLAUDE_CLI_CONFIGURED sentinel (set by credential service when CLI detected)
   * 4. Pre-authenticated Claude Code at ~/.claude/.credentials or ~/.claude/.credentials.json
   */
  isConfigured(): boolean {
    // Check API key
    if (process.env['ANTHROPIC_API_KEY']) {
      return true;
    }

    // Check OAuth token
    if (process.env['CLAUDE_CODE_OAUTH_TOKEN']) {
      return true;
    }

    // Check CLI sentinel (set by credential-service when user selected "Use CLI")
    if (process.env['CLAUDE_CLI_CONFIGURED']) {
      return true;
    }

    // Check for pre-authenticated Claude Code credentials files
    try {
      const claudeDir = join(homedir(), '.claude');
      const hasCreds = existsSync(join(claudeDir, '.credentials'));
      const hasCredsJson = existsSync(join(claudeDir, '.credentials.json'));
      if (hasCreds || hasCredsJson) return true;
      this.logger.debug('Claude not configured', {
        ANTHROPIC_API_KEY: !!process.env['ANTHROPIC_API_KEY'],
        CLAUDE_CODE_OAUTH_TOKEN: !!process.env['CLAUDE_CODE_OAUTH_TOKEN'],
        CLAUDE_CLI_CONFIGURED: !!process.env['CLAUDE_CLI_CONFIGURED'],
        credsFile: hasCreds,
        credsJsonFile: hasCredsJson,
      });
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Load the Claude SDK dynamically.
   */
  private async loadSDK(): Promise<ClaudeSDK> {
    if (this.sdk) {
      return this.sdk;
    }

    try {
      const module = await import('@anthropic-ai/claude-agent-sdk');
      this.sdk = module as unknown as ClaudeSDK;
      return this.sdk;
    } catch (error) {
      throw new AgentError({
        code: 'SDK_LOAD_FAILED',
        message: 'Failed to load Claude Agent SDK. Is @anthropic-ai/claude-agent-sdk installed?',
        category: 'invalid_input',
        severity: 'fatal',
        provider: 'claude',
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  /**
   * List available models from the Claude SDK.
   *
   * Returns the hardcoded capability list. Runtime discovery via
   * `supportedModels()` requires an active query, so we cache results
   * from the first session and update the list when available.
   */
  async listModels(): Promise<Array<{ id: string; name: string }>> {
    return this.capabilities.supportedModels.map((id) => ({ id, name: id }));
  }

  /**
   * Create a new Claude session.
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
          'Claude credentials not configured. Set ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN, or authenticate Claude Code.',
        category: 'authentication',
        severity: 'fatal',
        provider: 'claude',
      });
    }

    const sdk = await this.loadSDK();
    const session = new ClaudeSession(sdk, config, this.logger);

    this.trackSession(session);

    // Setup cleanup on session end
    session.onEvent(async (event) => {
      if (event.type === 'session_end') {
        this.untrackSession(session.id);
      }
    });

    return session;
  }
}

/**
 * Claude session implementation.
 */
class ClaudeSession extends BaseSession {
  readonly provider: AgentProvider = 'claude';

  private sdk: ClaudeSDK;
  private queryInstance: Query | null = null;
  private abortController: AbortController | null = null;
  private nativeSessionId: string | null = null;
  private pendingId: string;
  private stderrBuffer: string = '';
  /** Model resolved from SDK init message (actual model in use) */
  private resolvedModel: string | null = null;
  /** Active message stream for AsyncIterable prompt injection */
  private activeMessageStream: MessageStream | null = null;
  /** Whether verbose lifecycle logging is enabled */
  private verbose: boolean;
  /** Timer for periodic "still waiting" logs */
  private waitingTimer: ReturnType<typeof setInterval> | null = null;
  /** Count of SDK messages received in current prompt */
  private sdkMessageCount = 0;

  constructor(sdk: ClaudeSDK, config: AgentSessionConfig, logger: Logger) {
    super(config, logger);
    this.sdk = sdk;
    this.pendingId = createPendingSessionId('claude');
    this.verbose = config.verbose ?? false;
  }

  /**
   * Log at info level when verbose, debug level otherwise.
   */
  private vlog(message: string, context?: Record<string, unknown>): void {
    if (this.verbose) {
      this.logger.info(message, context);
    } else {
      this.logger.debug(message, context);
    }
  }

  /**
   * Start a periodic timer that logs "still waiting" every 10 seconds.
   * Helps diagnose hangs where no SDK messages are being received.
   */
  private startWaitingTimer(label: string): void {
    if (this.waitingTimer) return;
    const startTime = Date.now();
    this.waitingTimer = setInterval(() => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.info(`[${label}] Still waiting for SDK response...`, {
        elapsedSec: elapsed,
        sdkMessagesReceived: this.sdkMessageCount,
        sessionId: this.id,
      });
    }, 10_000);
  }

  /**
   * Stop the periodic waiting timer.
   */
  private stopWaitingTimer(): void {
    if (this.waitingTimer) {
      clearInterval(this.waitingTimer);
      this.waitingTimer = null;
    }
  }

  /**
   * Session ID in format "claude:{nativeId}".
   */
  get id(): string {
    return this.nativeSessionId ? `claude:${this.nativeSessionId}` : this.pendingId;
  }

  /**
   * Get the model name, preferring the resolved model from the SDK init message.
   */
  private getModelName(): string {
    return this.resolvedModel ?? this.getModelName();
  }

  /**
   * Send a prompt and get a response.
   */
  async prompt(input: string, options?: PromptOptions): Promise<AgentResponse> {
    this.assertActive();

    const timeout = options?.timeoutMs ?? this.config.timeoutMs ?? 300000;
    this.abortController = new AbortController();

    const timer = setTimeout(() => {
      this.abortController?.abort();
    }, timeout);

    const startTime = Date.now();
    let response = '';
    let structuredOutput: unknown;
    let finishReason: AgentResponse['finishReason'] = 'complete';
    let gotSuccessResult = false;

    try {
      const sdkOptions = this.buildSdkOptions();

      this.vlog('Starting SDK query (non-streaming)', {
        sessionId: this.id,
        promptLength: input.length,
        promptPreview: input.substring(0, 120),
        model: sdkOptions.model ?? 'default',
        timeoutMs: timeout,
        hasOutputFormat: !!sdkOptions.outputFormat,
        hasMcpServers: !!sdkOptions.mcpServers,
      });

      this.sdkMessageCount = 0;
      const queryStartTime = Date.now();
      this.startWaitingTimer('prompt');

      this.queryInstance = this.sdk.query({
        prompt: input,
        options: sdkOptions,
      });

      // Emit input received event
      await this.emit(
        this.createEvent('input_received', {
          content: input,
          type: 'text',
        }),
      );

      // Process messages from the SDK
      let firstMessageLogged = false;
      for await (const message of this.queryInstance) {
        this.sdkMessageCount++;

        // Log time-to-first-message
        if (!firstMessageLogged) {
          const ttfm = Date.now() - queryStartTime;
          this.vlog('First SDK message received', {
            timeToFirstMessageMs: ttfm,
            messageType: message.type,
            messageSubtype: (message as SystemMessage).subtype,
          });
          firstMessageLogged = true;
          this.stopWaitingTimer();
        }

        // Log every SDK message type
        this.vlog('SDK message', {
          type: message.type,
          subtype: (message as SystemMessage).subtype,
          msgIndex: this.sdkMessageCount,
        });

        await this.processMessage(message);

        // Extract session ID from init message
        if (message.type === 'system' && message.subtype === 'init') {
          this.nativeSessionId = message.session_id;
          this.vlog('Session ID resolved', { nativeSessionId: message.session_id });
        }

        // Extract response from assistant message
        if (message.type === 'assistant') {
          response = this.extractContent(message);
        }

        // Extract result info
        if (message.type === 'result') {
          // Guard: don't let a spurious error result overwrite a prior success
          if (gotSuccessResult) {
            this.logger.warn('Ignoring duplicate result message after success', {
              subtype: message.subtype,
              sessionId: this.id,
            });
            continue;
          }

          this.updateUsageFromResult(message);
          finishReason = this.mapFinishReason(message.subtype);
          response = message.result || response;
          if (message.structured_output !== undefined) {
            structuredOutput = message.structured_output;
          }

          if (message.subtype === 'success') {
            gotSuccessResult = true;
          }
        }
      }

      const totalMs = Date.now() - startTime;
      this.vlog('Prompt completed', {
        sessionId: this.id,
        totalMs,
        sdkMessages: this.sdkMessageCount,
        finishReason,
        responseLength: response.length,
        hasStructuredOutput: structuredOutput !== undefined,
      });

      return {
        content: response,
        finishReason,
        usage: this.getUsage(),
        cost: this.getCost() ?? undefined,
        durationMs: totalMs,
        model: this.getModelName(),
        structuredOutput,
      };
    } catch (error) {
      this.stopWaitingTimer();

      // If we already captured a successful result before the error was thrown,
      // return the good response instead of throwing.
      if (gotSuccessResult) {
        const totalMs = Date.now() - startTime;
        this.logger.warn('CLI process errored after successful result, returning success', {
          sessionId: this.id,
          error: error instanceof Error ? error.message : String(error),
          finishReason,
          totalMs,
        });

        return {
          content: response,
          finishReason,
          usage: this.getUsage(),
          cost: this.getCost() ?? undefined,
          durationMs: totalMs,
          model: this.getModelName(),
          structuredOutput,
        };
      }

      // Check if it was an abort
      if (this.abortController?.signal.aborted) {
        throw new AgentError({
          code: 'TIMEOUT',
          message: `Prompt timed out after ${timeout}ms`,
          category: 'timeout',
          severity: 'retry',
          provider: 'claude',
          sessionId: this.id,
        });
      }

      // Enrich error with stderr output from the CLI subprocess
      const stderrInfo = this.stderrBuffer.trim();
      if (stderrInfo) {
        this.logger.error('Claude CLI stderr output:', { stderr: stderrInfo });
      }
      const enrichedError = error instanceof Error && stderrInfo
        ? new Error(`${error.message}\nCLI stderr: ${stderrInfo}`)
        : error;
      this.stderrBuffer = '';

      throw wrapError(enrichedError, 'claude', this.id);
    } finally {
      clearTimeout(timer);
      this.stopWaitingTimer();
      this.abortController = null;
      this.queryInstance = null;
    }
  }

  /**
   * Send a prompt with streaming response.
   *
   * Uses the AsyncIterable<SDKUserMessage> prompt form to enable
   * mid-query message injection via `injectMessage()`.
   */
  async promptStreaming(
    input: string,
    onChunk: (chunk: string) => void,
    options?: PromptOptions,
  ): Promise<AgentResponse> {
    this.assertActive();

    const timeout = options?.timeoutMs ?? this.config.timeoutMs ?? 300000;
    this.abortController = new AbortController();

    const timer = setTimeout(() => {
      this.abortController?.abort();
    }, timeout);

    const startTime = Date.now();
    let response = '';
    let accumulated = '';
    let structuredOutput: unknown;
    let finishReason: AgentResponse['finishReason'] = 'complete';
    let gotSuccessResult = false;

    try {
      const sdkOptions = this.buildSdkOptions();
      // Enable partial messages for streaming
      sdkOptions.includePartialMessages = true;

      this.vlog('Starting SDK query (streaming)', {
        sessionId: this.id,
        promptLength: input.length,
        promptPreview: input.substring(0, 120),
        model: sdkOptions.model ?? 'default',
        timeoutMs: timeout,
        hasOutputFormat: !!sdkOptions.outputFormat,
        hasMcpServers: !!sdkOptions.mcpServers,
        mcpServerNames: sdkOptions.mcpServers ? Object.keys(sdkOptions.mcpServers) : [],
        allowedToolCount: sdkOptions.allowedTools?.length ?? 0,
        permissionMode: sdkOptions.permissionMode,
      });

      this.sdkMessageCount = 0;
      const queryStartTime = Date.now();
      this.startWaitingTimer('promptStreaming');

      // Create message stream for AsyncIterable prompt pattern.
      // This enables injectMessage() to push additional user messages
      // into the running query.
      this.activeMessageStream = createMessageStream();

      // Push the initial user message
      this.activeMessageStream.push({
        type: 'user',
        message: { role: 'user', content: input },
      });

      this.vlog('Message stream created, calling sdk.query()');

      this.queryInstance = this.sdk.query({
        prompt: this.activeMessageStream.iterable,
        options: sdkOptions,
      });

      this.vlog('sdk.query() returned, entering message loop');

      // Emit input received event
      await this.emit(
        this.createEvent('input_received', {
          content: input,
          type: 'text',
        }),
      );

      // Emit response start
      await this.emit(this.createEvent('response_start', {}));

      // Process messages from the SDK
      let firstMessageLogged = false;
      let lastMessageType = '';
      for await (const message of this.queryInstance) {
        this.sdkMessageCount++;

        // Log time-to-first-message
        if (!firstMessageLogged) {
          const ttfm = Date.now() - queryStartTime;
          this.vlog('First SDK message received', {
            timeToFirstMessageMs: ttfm,
            messageType: message.type,
            messageSubtype: (message as SystemMessage).subtype,
          });
          firstMessageLogged = true;
          this.stopWaitingTimer();
        }

        // Log non-stream_event messages (stream_events are too noisy even for verbose)
        if (message.type !== 'stream_event' && message.type !== 'partial') {
          this.vlog('SDK message', {
            type: message.type,
            subtype: (message as SystemMessage).subtype,
            msgIndex: this.sdkMessageCount,
          });
        }
        lastMessageType = message.type;

        await this.processMessage(message);

        // Extract session ID from init message
        if (message.type === 'system' && message.subtype === 'init') {
          this.nativeSessionId = message.session_id;
          this.vlog('Session ID resolved', {
            nativeSessionId: message.session_id,
            resolvedModel: message.model,
          });
        }

        // Handle streaming events
        if (message.type === 'stream_event') {
          const event = message.event;
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            const chunk = event.delta.text ?? '';
            accumulated += chunk;
            onChunk(chunk);

            // Emit chunk event
            await this.emit(
              this.createEvent('response_chunk', {
                content: chunk,
                accumulated,
              }),
            );
          }
        }

        // Extract final response from assistant message
        if (message.type === 'assistant') {
          response = this.extractContent(message);
          this.vlog('Assistant message received', {
            contentBlocks: (message as AssistantMessage).message.content.length,
            textLength: response.length,
            toolCalls: (message as AssistantMessage).message.content
              .filter(b => b.type === 'tool_use')
              .map(b => b.name),
          });
        }

        // Extract result info
        if (message.type === 'result') {
          const resultMsg = message as ResultMessage;
          this.vlog('Result message received', {
            subtype: resultMsg.subtype,
            durationMs: resultMsg.duration_ms,
            numTurns: resultMsg.num_turns,
            totalCostUsd: resultMsg.total_cost_usd,
            inputTokens: resultMsg.usage.input_tokens,
            outputTokens: resultMsg.usage.output_tokens,
            cacheReadTokens: resultMsg.usage.cache_read_input_tokens,
            hasStructuredOutput: resultMsg.structured_output !== undefined,
          });

          // End the message stream now that the CLI has produced its result.
          this.activeMessageStream?.end();

          // Guard: if we already captured a successful result, don't let a
          // subsequent spurious error result (e.g., CLI exit code 1 after
          // stdin closure) overwrite the good data.
          if (gotSuccessResult) {
            this.logger.warn('Ignoring duplicate result message after success', {
              subtype: resultMsg.subtype,
              sessionId: this.id,
            });
            continue;
          }

          this.updateUsageFromResult(resultMsg);
          finishReason = this.mapFinishReason(resultMsg.subtype);
          response = resultMsg.result || response;
          if (resultMsg.structured_output !== undefined) {
            structuredOutput = resultMsg.structured_output;
          }

          if (resultMsg.subtype === 'success') {
            gotSuccessResult = true;
          }
        }
      }

      const totalMs = Date.now() - startTime;
      this.vlog('Streaming prompt completed', {
        sessionId: this.id,
        totalMs,
        sdkMessages: this.sdkMessageCount,
        finishReason,
        responseLength: response.length,
        accumulatedStreamLength: accumulated.length,
        lastMessageType,
      });

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
        durationMs: totalMs,
        model: this.getModelName(),
        structuredOutput,
      };
    } catch (error) {
      this.stopWaitingTimer();

      // If we already captured a successful result before the error was thrown
      // (e.g., CLI process exited with code 1 after sending a success result),
      // return the good response instead of throwing.
      if (gotSuccessResult) {
        const totalMs = Date.now() - startTime;
        this.logger.warn('CLI process errored after successful result, returning success', {
          sessionId: this.id,
          error: error instanceof Error ? error.message : String(error),
          finishReason,
          totalMs,
        });

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
          durationMs: totalMs,
          model: this.getModelName(),
          structuredOutput,
        };
      }

      if (this.abortController?.signal.aborted) {
        throw new AgentError({
          code: 'TIMEOUT',
          message: `Prompt timed out after ${timeout}ms`,
          category: 'timeout',
          severity: 'retry',
          provider: 'claude',
          sessionId: this.id,
        });
      }

      // Enrich error with stderr output from the CLI subprocess
      const stderrInfo = this.stderrBuffer.trim();
      if (stderrInfo) {
        this.logger.error('Claude CLI stderr output:', { stderr: stderrInfo });
      }
      const enrichedError = error instanceof Error && stderrInfo
        ? new Error(`${error.message}\nCLI stderr: ${stderrInfo}`)
        : error;
      this.stderrBuffer = '';

      throw wrapError(enrichedError, 'claude', this.id);
    } finally {
      clearTimeout(timer);
      this.stopWaitingTimer();
      this.abortController = null;
      this.queryInstance = null;
      // Clean up message stream
      this.activeMessageStream?.end();
      this.activeMessageStream = null;
    }
  }

  /**
   * Inject a user message into a running prompt stream.
   *
   * Only works when `promptStreaming()` is actively running and using
   * the AsyncIterable prompt form. The message is pushed into the
   * stream and will be processed by the agent as a new user turn.
   */
  injectMessage(content: string): void {
    if (!this.activeMessageStream) {
      this.logger.warn('Cannot inject message — no active prompt stream');
      return;
    }

    this.logger.info('Injecting user message into active prompt stream', {
      contentPreview: content.substring(0, 80),
    });

    this.activeMessageStream.push({
      type: 'user',
      message: { role: 'user', content },
    });
  }

  /**
   * Cancel the current operation.
   */
  async cancel(): Promise<void> {
    this.logger.info('Cancelling session', { sessionId: this.id });

    this.abortController?.abort();

    if (this.queryInstance) {
      try {
        await this.queryInstance.interrupt();
      } catch (error) {
        this.logger.warn('Failed to interrupt query', { error: String(error) });
      }
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

    await this.cancel();
    this._isActive = false;

    await this.emit(
      this.createEvent('session_end', {
        reason: 'completed',
        totalDurationMs: this.getDurationMs(),
      }),
    );

    // Call session end hook
    if (this.hooks.onSessionEnd) {
      await this.hooks.onSessionEnd({
        sessionId: this.id,
        reason: 'completed',
        totalDurationMs: this.getDurationMs(),
      });
    }
  }

  /**
   * Build SDK options from session config.
   */
  private buildSdkOptions(): QueryOptions {
    const permMode = this.mapPermissionMode();
    const options: QueryOptions = {
      model: this.config.model,
      systemPrompt: this.config.systemPrompt,
      cwd: this.config.cwd,
      permissionMode: permMode,
      allowDangerouslySkipPermissions: permMode === 'bypassPermissions' ? true : undefined,
      allowedTools: this.config.allowedTools,
      disallowedTools: this.getDisallowedTools(),
      maxTurns: this.config.maxTurns,
      maxBudgetUsd: this.config.maxBudgetUsd,
      maxThinkingTokens: this.config.maxThinkingTokens,
      includePartialMessages: this.config.includePartialMessages,
      abortController: this.abortController ?? undefined,
      resume: this.config.resume,
      forkSession: this.config.forkSession,
      mcpServers: this.config.mcpServers,
      hooks: this.buildSdkHooks(),
      env: this.config.env,
      outputFormat: this.config.outputFormat,
      // Only load filesystem settings when explicitly requested.
      // Most sessions (mind, sub-agents) build their own context and don't
      // need CLAUDE.md, skills, or agent definitions from the project.
      settingSources: this.config.settingSources,
      // Capture stderr from the Claude CLI subprocess for diagnostics.
      // When verbose, log at info level so stderr is visible in real-time.
      stderr: (message: string) => {
        const trimmed = message.trim();
        if (trimmed) {
          if (this.verbose) {
            this.logger.info('Claude CLI stderr:', { stderr: trimmed });
          } else {
            this.logger.debug('Claude CLI stderr:', { stderr: trimmed });
          }
        }
        // Accumulate stderr for error reporting
        this.stderrBuffer += message;
        // Keep buffer bounded (last 4KB)
        if (this.stderrBuffer.length > 4096) {
          this.stderrBuffer = this.stderrBuffer.slice(-4096);
        }
      },
    };

    // temperature and maxOutputTokens are not supported by the Claude Agent SDK
    if (this.config.temperature !== undefined) {
      this.logger.debug('temperature not supported by Claude Agent SDK, ignoring');
    }
    if (this.config.maxOutputTokens !== undefined) {
      this.logger.debug('maxOutputTokens not supported by Claude Agent SDK, ignoring');
    }

    return options;
  }

  /**
   * Map unified permission config to Claude permission mode.
   */
  private mapPermissionMode(): QueryOptions['permissionMode'] {
    const perms = this.config.permissions;

    if (perms?.executionMode === 'plan') {
      return 'plan';
    }

    switch (perms?.approvalLevel) {
      case 'none':
        return 'bypassPermissions';
      case 'trusted':
        return 'acceptEdits';
      case 'strict':
      case 'normal':
      default:
        return 'default';
    }
  }

  /**
   * Get disallowed tools from permission config.
   */
  private getDisallowedTools(): string[] | undefined {
    const explicit = this.config.disallowedTools ?? [];
    const fromPerms =
      this.config.permissions?.toolPermissions
        ? Object.entries(this.config.permissions.toolPermissions)
            .filter(([, v]) => v === 'deny')
            .map(([k]) => k)
        : [];

    const combined = [...explicit, ...fromPerms];
    return combined.length > 0 ? combined : undefined;
  }

  /**
   * Build SDK hooks from unified hooks.
   */
  private buildSdkHooks(): QueryOptions['hooks'] | undefined {
    if (!this.hooks) {
      return undefined;
    }

    const hooks: QueryOptions['hooks'] = {};

    // PreToolUse hook
    if (this.hooks.onPreToolUse) {
      hooks['PreToolUse'] = [
        {
          matcher: '.*',
          hooks: [
            async (input: HookInput): Promise<HookOutput> => {
              const result = await this.hooks.onPreToolUse!({
                sessionId: this.id,
                toolName: input.tool_name ?? '',
                toolInput: input.tool_input,
                toolCallId: generateUUID(),
              });

              if (!result) {
                return {};
              }

              const output: HookOutput = {};

              if (result.allow === false) {
                output.decision = 'block';
                output.hookSpecificOutput = {
                  hookEventName: 'PreToolUse',
                  permissionDecision: 'deny',
                };
              }

              if (result.modifiedInput !== undefined) {
                output.hookSpecificOutput = {
                  hookEventName: 'PreToolUse',
                  updatedInput: result.modifiedInput as Record<string, unknown>,
                };
              }

              return output;
            },
          ],
        },
      ];
    }

    // PostToolUse hook
    if (this.hooks.onPostToolUse) {
      hooks['PostToolUse'] = [
        {
          matcher: '.*',
          hooks: [
            async (input: HookInput): Promise<HookOutput> => {
              await this.hooks.onPostToolUse!({
                sessionId: this.id,
                toolName: input.tool_name ?? '',
                toolInput: input.tool_input,
                toolCallId: generateUUID(),
                toolOutput: input.tool_response,
                durationMs: 0, // Not available from SDK
              });
              return {};
            },
          ],
        },
      ];
    }

    // PostToolUseFailure hook (maps to onToolError)
    if (this.hooks.onToolError) {
      hooks['PostToolUseFailure'] = [
        {
          matcher: '.*',
          hooks: [
            async (input: HookInput): Promise<HookOutput> => {
              await this.hooks.onToolError!({
                sessionId: this.id,
                toolName: input.tool_name ?? '',
                toolInput: input.tool_input,
                toolCallId: generateUUID(),
                error: input.error ?? 'Unknown error',
                isRetryable: false,
              });
              return {};
            },
          ],
        },
      ];
    }

    return Object.keys(hooks).length > 0 ? hooks : undefined;
  }

  /**
   * Return a JSON-safe copy of the session config for logging.
   * Strips non-serializable fields like MCP server instances.
   */
  private getSafeConfig(): Record<string, unknown> {
    const { mcpServers, ...rest } = this.config;
    if (!mcpServers) return { ...rest };

    // Replace each server entry with just its serializable fields
    const safeMcp: Record<string, Record<string, unknown>> = {};
    for (const [name, server] of Object.entries(mcpServers)) {
      const { instance, ...safeFields } = server as Record<string, unknown>;
      safeMcp[name] = {
        ...safeFields,
        ...(instance ? { instance: '[McpServer]' } : {}),
      };
    }
    return { ...rest, mcpServers: safeMcp };
  }

  /**
   * Process an SDK message and emit appropriate events.
   */
  private async processMessage(message: SDKMessage): Promise<void> {
    switch (message.type) {
      case 'system':
        if (message.subtype === 'init') {
          // Capture actual model from SDK init message
          if (message.model) {
            this.resolvedModel = message.model;
          }

          // Strip non-serializable fields (e.g. MCP server instances) for logging
          const safeConfig = this.getSafeConfig();
          await this.emit(
            this.createEvent('session_start', {
              provider: 'claude',
              model: this.getModelName(),
              config: safeConfig,
            }),
          );

          // Call session start hook
          if (this.hooks.onSessionStart) {
            await this.hooks.onSessionStart({
              sessionId: this.id,
              provider: 'claude',
              model: this.getModelName(),
              config: safeConfig,
            });
          }
        }
        break;

      case 'assistant':
        // Process content blocks for tool calls
        for (const block of message.message.content) {
          if (block.type === 'tool_use' && block.name && block.id) {
            await this.emit(
              this.createEvent('tool_call_start', {
                toolName: block.name,
                toolInput: (block.input as Record<string, unknown>) ?? {},
                toolCallId: block.id,
              }),
            );
          }

          if (block.type === 'thinking') {
            await this.emit(this.createEvent('thinking_start', {}));
            // Note: thinking_end would be emitted when we see the next non-thinking block
          }
        }
        break;

      case 'result':
        // Result is handled in prompt methods
        break;

      case 'stream_event':
        // Stream events are handled in promptStreaming
        break;
    }
  }

  /**
   * Extract text content from an assistant message.
   */
  private extractContent(message: AssistantMessage): string {
    return message.message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('');
  }

  /**
   * Update usage from a result message.
   */
  private updateUsageFromResult(result: ResultMessage): void {
    this.updateUsage({
      inputTokens: result.usage.input_tokens,
      outputTokens: result.usage.output_tokens,
      cacheReadTokens: result.usage.cache_read_input_tokens,
      cacheWriteTokens: result.usage.cache_creation_input_tokens,
    });

    this.cost = {
      inputCostUsd: 0, // Would need pricing data to calculate
      outputCostUsd: 0,
      totalCostUsd: result.total_cost_usd,
      model: this.getModelName(),
      provider: 'claude',
    };
  }

  /**
   * Map result subtype to finish reason.
   */
  private mapFinishReason(subtype: string): AgentResponse['finishReason'] {
    switch (subtype) {
      case 'success':
        return 'complete';
      case 'error_max_turns':
      case 'error_max_budget_usd':
        return 'max_tokens';
      case 'error_during_execution':
      case 'error_max_structured_output_retries':
        return 'error';
      default:
        return 'complete';
    }
  }
}
