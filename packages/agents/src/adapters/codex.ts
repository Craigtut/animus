/**
 * OpenAI Codex adapter using the App Server Protocol.
 *
 * Implements the unified agent interface via a long-lived `codex app-server`
 * JSON-RPC 2.0 process. This replaces the previous SDK-based approach
 * (which spawned disposable `codex exec` processes per turn) and unlocks:
 * - Mid-turn message injection via `turn/steer`
 * - Real cancellation via `turn/interrupt`
 * - Pre-execution approval via approval request/response
 *
 * The @openai/codex-sdk package is still required for the bundled binary.
 *
 * @see https://github.com/openai/codex/tree/main/codex-rs/app-server-protocol
 */

import type { AgentProvider } from '@animus-labs/shared';
import type {
  AgentSessionConfig,
  AdapterCapabilities,
  IAgentSession,
  AgentResponse,
  ModelInfo,
  PromptOptions,
  TurnResult,
  StreamChunkMeta,
} from '../types.js';
import { AgentError, wrapError } from '../errors.js';
import { createTaggedLogger, type Logger } from '../logger.js';
import { CODEX_CAPABILITIES } from '../capabilities.js';
import type { IAuthProvider } from '../types.js';
import { BaseAdapter, BaseSession, type AdapterOptions } from './base.js';
import { generateUUID, createPendingSessionId } from '../utils/index.js';
import { CodexAuthProvider } from '../auth/codex-auth-provider.js';
import { getCodexReasoningEffort } from '../reasoning.js';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CodexAppServerClient } from './codex-app-server.js';
import type {
  AppServerApprovalPolicy,
  ItemStartedParams,
  ItemCompletedParams,
  AgentMessageDeltaParams,
  ReasoningTextDeltaParams,
  TurnStartedParams_Notification,
  TurnCompletedParams,
  TokenUsageUpdatedParams,
  ApprovalRequestParams,
  CommandExecutionData,
  McpToolCallData,
  FileChangeData,
  ReasoningData,
  WebSearchData,
  TurnError,
  SkillEntry,
} from './codex-protocol-types.js';
import { NOTIFICATION_METHODS } from './codex-protocol-types.js';

/**
 * Maximum time (ms) to wait for a turn to complete before interrupting.
 * This prevents indefinite hangs when Codex shell commands or other tools stall.
 * After this timeout, the adapter sends `turn/interrupt` and waits a grace period
 * for the turn/completed notification before force-resolving.
 */
const TURN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Grace period (ms) after sending turn/interrupt to wait for turn/completed.
 * If the app-server doesn't respond within this window, force-resolve the promise.
 */
const INTERRUPT_GRACE_MS = 10 * 1000; // 10 seconds

/**
 * OpenAI Codex adapter using the App Server Protocol.
 */
export class CodexAdapter extends BaseAdapter {
  readonly provider: AgentProvider = 'codex';
  readonly capabilities: AdapterCapabilities = CODEX_CAPABILITIES;

  private appServer: CodexAppServerClient | null = null;
  private authProvider: CodexAuthProvider;

  constructor(options?: AdapterOptions) {
    super(options);
    this.initLogger(options);
    this.authProvider = new CodexAuthProvider(this.logger);
  }

  override getAuthProvider(): IAuthProvider {
    return this.authProvider;
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
    if (process.env['OPENAI_API_KEY']) {
      return true;
    }

    if (process.env['CODEX_OAUTH_CONFIGURED']) {
      return true;
    }

    try {
      const authPath = join(homedir(), '.codex', 'auth.json');
      return existsSync(authPath);
    } catch {
      return false;
    }
  }

  /**
   * Ensure the app-server process is running.
   *
   * Lazily spawns one app-server process shared across all sessions.
   */
  private async ensureAppServer(config: AgentSessionConfig): Promise<CodexAppServerClient> {
    if (this.appServer?.isRunning) {
      return this.appServer;
    }

    // Build merged environment
    let mergedEnv: Record<string, string> | undefined;
    if (config.env) {
      mergedEnv = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) mergedEnv[key] = value;
      }
      Object.assign(mergedEnv, config.env);
    }

    this.appServer = new CodexAppServerClient({
      env: mergedEnv,
      logger: this.logger,
    });

    // Handle unexpected process exits
    this.appServer.on('process_exit', ({ code, signal }: { code: number | null; signal: string | null }) => {
      this.logger.warn('App-server process exited unexpectedly', { code, signal });
      this.appServer = null;
    });

    try {
      await this.appServer.start();
    } catch (error) {
      this.appServer = null;
      throw new AgentError({
        code: 'APP_SERVER_START_FAILED',
        message: `Failed to start codex app-server: ${error instanceof Error ? error.message : String(error)}`,
        category: 'execution',
        severity: 'fatal',
        provider: 'codex',
        cause: error instanceof Error ? error : undefined,
      });
    }

    return this.appServer;
  }

  /**
   * List available models for the Codex provider.
   *
   * Three-strategy approach:
   * 1. App-server `model/list` (if running): curated for the Codex experience
   * 2. OpenAI REST API (fallback if app-server not running, OPENAI_API_KEY available)
   * 3. Static fallback from capabilities
   */
  async listModels(): Promise<ModelInfo[]> {
    // Strategy 1: App-server model/list (has rich metadata)
    if (this.appServer?.isRunning) {
      try {
        const codexModels = await this.appServer.modelList();
        if (codexModels.length > 0) {
          return codexModels
            .filter(m => !m.hidden)
            .map(m => ({
              id: m.id,
              name: m.displayName ?? m.id,
              recommended: true, // All non-hidden app-server models are recommended
              isDefault: m.isDefault ?? false,
            }));
        }
      } catch {
        this.logger.debug('App-server model/list failed, trying OpenAI API');
      }
    }

    // Strategy 2: OpenAI REST API (no recommendation signals available)
    const apiKey = process.env['OPENAI_API_KEY'];
    if (apiKey) {
      try {
        const response = await fetch('https://api.openai.com/v1/models', {
          headers: { 'Authorization': `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10_000),
        });

        if (response.ok) {
          const body = await response.json() as {
            data: Array<{ id: string; name?: string }>;
          };

          // Filter to relevant models
          const relevant = body.data.filter((m) =>
            /^(gpt-|o[34]|codex)/i.test(m.id)
          );

          if (relevant.length > 0) {
            // No recommendation signals from OpenAI REST API;
            // falls through to models.json editorial flags during enrichment
            return relevant.map((m) => ({ id: m.id, name: m.name ?? m.id }));
          }
        }
      } catch (err) {
        this.logger.debug('OpenAI models API failed, using static list', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Strategy 3: Static fallback
    return this.capabilities.supportedModels.map((id) => ({ id, name: id }));
  }

  /**
   * Sync a skill to the running app-server at runtime.
   *
   * Calls `skills/config/write` to enable or disable a skill without
   * requiring a process restart. Returns false if the app-server is not
   * running or the method is unsupported.
   */
  async syncSkill(skillPath: string, enabled: boolean): Promise<boolean> {
    if (!this.appServer?.isRunning) {
      return false;
    }
    return this.appServer.skillsConfigWrite(skillPath, enabled);
  }

  /**
   * List skills known to the running app-server.
   *
   * Returns an empty array if the app-server is not running or the
   * method is unsupported.
   */
  async listSkills(): Promise<SkillEntry[]> {
    if (!this.appServer?.isRunning) {
      return [];
    }
    return this.appServer.skillsList();
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

    const client = await this.ensureAppServer(config);

    // Use 'on-request' when canUseTool is provided so the app-server sends
    // approval requests that flow through our permission system.
    // Only use 'never' when there's no gating callback (e.g., sub-agents).
    const approvalPolicy: AppServerApprovalPolicy = config.canUseTool ? 'on-request' : 'never';

    // Extract system prompt
    let instructions: string | undefined;
    if (config.systemPrompt) {
      instructions = typeof config.systemPrompt === 'string'
        ? config.systemPrompt
        : config.systemPrompt.append ?? undefined;
    }

    const session = new CodexSession(client, config, this.logger, {
      resumeThreadId: config.resume ?? null,
      approvalPolicy,
      instructions,
    });

    const initialId = session.id;
    this.trackSession(session);

    session.onEvent(async (event) => {
      if (event.type === 'session_end') {
        this.untrackSession(session.id);
        this.untrackSession(initialId);
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

    return this.createSession({ provider: 'codex', resume: nativeId });
  }

  /**
   * Clean up all sessions and stop the app-server process.
   */
  override async cleanup(): Promise<void> {
    await super.cleanup();

    if (this.appServer) {
      await this.appServer.stop();
      this.appServer = null;
    }
  }
}

// ============================================================================
// Session Options
// ============================================================================

interface CodexSessionOptions {
  resumeThreadId: string | null;
  approvalPolicy: AppServerApprovalPolicy;
  instructions?: string;
}

// ============================================================================
// CodexSession
// ============================================================================

/**
 * Codex session using the App Server Protocol.
 *
 * Communicates with the long-lived app-server process to manage threads
 * and turns, with support for mid-turn injection and cancellation.
 */
class CodexSession extends BaseSession {
  readonly provider: AgentProvider = 'codex';

  private client: CodexAppServerClient;
  private threadId: string | null = null;
  private activeTurnId: string | null = null;
  private isPromptActive = false;
  private pendingId: string;
  private resumeThreadId: string | null;
  private approvalPolicy: AppServerApprovalPolicy;
  private instructions: string | undefined;

  /** Tracks the toolCallId from item/started so item/completed can reuse it */
  private activeToolCallId: string | null = null;

  constructor(
    client: CodexAppServerClient,
    config: AgentSessionConfig,
    logger: Logger,
    options: CodexSessionOptions,
  ) {
    super(config, logger);
    this.client = client;
    this.pendingId = createPendingSessionId('codex');
    this.resumeThreadId = options.resumeThreadId;
    this.approvalPolicy = options.approvalPolicy;
    this.instructions = options.instructions;

    // Listen for approval requests from the app-server
    this.setupApprovalHandler();
  }

  /**
   * Session ID in format "codex:{threadId}".
   */
  get id(): string {
    return this.threadId ? `codex:${this.threadId}` : this.pendingId;
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
  private async ensureThread(): Promise<string> {
    if (this.threadId) {
      return this.threadId;
    }

    if (this.resumeThreadId) {
      const result = await this.client.threadResume({ threadId: this.resumeThreadId });
      this.threadId = result.threadId;
      return this.threadId;
    }

    // Convert MCP server configs to dotted-key format for the `config` param.
    // The app-server ignores a top-level `mcpServers` field in thread/start;
    // MCP servers must be passed via `config` as dotted-key overrides
    // (e.g. "mcp_servers.tools.command" = "node").
    const configOverrides = mcpServersToConfigOverrides(
      this.config.mcpServers as Record<string, Record<string, unknown>> | undefined,
    );

    // Map unified reasoning effort to Codex's model_reasoning_effort config
    if (this.config.reasoningEffort) {
      configOverrides['model_reasoning_effort'] = getCodexReasoningEffort(this.config.reasoningEffort);
    }

    const result = await this.client.threadStart({
      model: this.config.model,
      instructions: this.instructions,
      cwd: this.config.workingDirectory ?? this.config.cwd,
      approvalPolicy: this.approvalPolicy,
      ...(Object.keys(configOverrides).length > 0 ? { config: configOverrides } : {}),
    });
    this.threadId = result.threadId;

    if (this.config.temperature !== undefined) {
      this.logger.debug('temperature not supported by Codex, ignoring');
    }
    if (this.config.maxOutputTokens !== undefined) {
      this.logger.debug('maxOutputTokens not supported by Codex, ignoring');
    }

    return this.threadId;
  }

  /**
   * Send a prompt and get a response (non-streaming).
   *
   * Uses the streaming path internally to get notifications, but does
   * not call onChunk. This keeps a single code path for event handling.
   */
  async prompt(input: string, options?: PromptOptions): Promise<AgentResponse> {
    // Delegate to promptStreaming with a no-op onChunk
    return this.promptStreaming(input, () => {}, options);
  }

  /**
   * Send a prompt with streaming response.
   */
  async promptStreaming(
    input: string,
    onChunk: (chunk: string, meta: StreamChunkMeta) => void,
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
    const turns: TurnResult[] = [];

    try {
      const threadId = await this.ensureThread();

      // Emit input received event
      await this.emit(
        this.createEvent('input_received', {
          content: input,
          type: 'text',
        }),
      );

      // Emit session start on first prompt
      if (!this.resumeThreadId || turnIndex === 0) {
        await this.emit(
          this.createEvent('session_start', {
            provider: 'codex',
            model: this.getModelName(),
            config: { ...this.config },
          }),
        );

        if (this.hooks.onSessionStart) {
          await this.hooks.onSessionStart({
            sessionId: this.id,
            provider: 'codex',
            model: this.getModelName(),
            config: { ...this.config },
          });
        }
      }

      // Register ALL notification listeners BEFORE calling turnStart().
      // This prevents a race condition where the app-server sends notifications
      // (turn/started, item/started, etc.) in the same stdout buffer as the
      // turn/start response. Node's readline processes all buffered lines
      // synchronously, so events emitted before listeners are registered are lost.
      //
      // The turnId filter uses this.activeTurnId which is set from both the
      // turn/start response and the turn/started notification.
      await new Promise<void>((resolve, reject) => {
        // Turn timeout: prevents indefinite hangs when tool calls stall.
        // Resets on every notification (activity-based).
        let turnTimer: ReturnType<typeof setTimeout> | null = null;
        let graceTimer: ReturnType<typeof setTimeout> | null = null;

        const resetTurnTimer = () => {
          if (turnTimer) clearTimeout(turnTimer);
          turnTimer = setTimeout(() => {
            this.logger.warn('Turn timeout reached, interrupting', {
              sessionId: this.id,
              turnId: this.activeTurnId,
              elapsedMs: Date.now() - startTime,
            });

            // Try to interrupt the turn gracefully
            if (this.activeTurnId && this.threadId) {
              this.client.turnInterrupt({
                threadId: this.threadId,
                turnId: this.activeTurnId,
              }).catch((err) => {
                this.logger.warn('Turn interrupt failed during timeout', { error: String(err) });
              });
            }

            // If turn/completed doesn't arrive within grace period, force-resolve
            graceTimer = setTimeout(() => {
              this.logger.warn('Turn did not complete after interrupt, force-resolving', {
                sessionId: this.id,
              });
              finishReason = 'error';
              response = accumulated;
              this.activeTurnId = null;
              this.isPromptActive = false;
              cleanup();
              resolve();
            }, INTERRUPT_GRACE_MS);
          }, TURN_TIMEOUT_MS);
        };

        const cleanup = () => {
          if (turnTimer) clearTimeout(turnTimer);
          if (graceTimer) clearTimeout(graceTimer);
          this.client.removeListener(NOTIFICATION_METHODS.TURN_STARTED, onTurnStarted);
          this.client.removeListener(NOTIFICATION_METHODS.ITEM_STARTED, onItemStarted);
          this.client.removeListener(NOTIFICATION_METHODS.ITEM_COMPLETED, onItemCompleted);
          this.client.removeListener(NOTIFICATION_METHODS.AGENT_MESSAGE_DELTA, onDelta);
          this.client.removeListener(NOTIFICATION_METHODS.REASONING_TEXT_DELTA, onReasoningDelta);
          this.client.removeListener(NOTIFICATION_METHODS.TURN_COMPLETED, onTurnCompleted);
          this.client.removeListener(NOTIFICATION_METHODS.TOKEN_USAGE_UPDATED, onTokenUsage);
          this.client.removeListener(NOTIFICATION_METHODS.ERROR, onError);
          this.client.removeListener('process_exit', onProcessExit);
        };

        const onTurnStarted = (params: TurnStartedParams_Notification) => {
          if (params.turnId) {
            this.activeTurnId = params.turnId;
          }
          resetTurnTimer();
        };

        const onItemStarted = async (params: ItemStartedParams) => {
          if (params.turnId !== this.activeTurnId) return;
          resetTurnTimer();

          const itemType = params.itemType;

          if (itemType === 'commandExecution' || itemType === 'mcpToolCall' || itemType === 'fileChange' || itemType === 'webSearch' || itemType === 'collabAgentToolCall') {
            // When a tool call starts, emit turn_end for accumulated text
            if (currentTurnText) {
              const turnResult: TurnResult = {
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

            const toolCallId = generateUUID();
            this.activeToolCallId = toolCallId;

            // Determine tool name and input from item data
            const toolName = getToolName(itemType, params.data);
            const toolInput = getToolInput(itemType, params.data);
            currentTurnToolNames.push(toolName);

            // Pre-execution gating is handled exclusively in setupApprovalHandler
            // via canUseTool and onPreToolUse. By the time onItemStarted fires,
            // the tool has already been approved and started executing.

            await this.emit(
              this.createEvent('tool_call_start', {
                toolName,
                toolInput: typeof toolInput === 'object' && toolInput !== null
                  ? toolInput as Record<string, unknown>
                  : { content: toolInput },
                toolCallId,
              }),
            );
          }

          if (itemType === 'reasoning') {
            currentTurnHasThinking = true;
            await this.emit(this.createEvent('thinking_start', {}));
          }
        };

        const onItemCompleted = async (params: ItemCompletedParams) => {
          if (params.turnId !== this.activeTurnId) return;
          resetTurnTimer();

          const itemType = params.itemType;

          if (itemType === 'commandExecution' || itemType === 'mcpToolCall' || itemType === 'fileChange' || itemType === 'webSearch' || itemType === 'collabAgentToolCall') {
            const toolCallId = this.activeToolCallId ?? generateUUID();
            this.activeToolCallId = null;

            const toolName = getToolName(itemType, params.data);
            const output = getToolOutput(itemType, params.data);
            const durationMs = getToolDuration(params.data);

            await this.emit(
              this.createEvent('tool_call_end', {
                toolCallId,
                toolName,
                output,
                durationMs,
              }),
            );

            if (this.hooks.onPostToolUse) {
              await this.hooks.onPostToolUse({
                sessionId: this.id,
                toolName,
                toolInput: {},
                toolCallId,
                toolOutput: output,
                durationMs,
              });
            }
          }

          if (itemType === 'reasoning') {
            const data = params.data as ReasoningData | undefined;
            await this.emit(
              this.createEvent('thinking_end', {
                thinkingDurationMs: 0,
                content: data?.content,
              }),
            );
          }
        };

        const onDelta = async (params: AgentMessageDeltaParams) => {
          if (params.turnId !== this.activeTurnId) return;
          resetTurnTimer();

          const text = params.delta?.text;
          if (text) {
            accumulated += text;
            currentTurnText += text;
            onChunk(text, { turnIndex });

            await this.emit(
              this.createEvent('response_chunk', {
                content: text,
                accumulated,
              }),
            );
          }
        };

        const onReasoningDelta = (params: ReasoningTextDeltaParams) => {
          if (params.turnId !== this.activeTurnId) return;
          resetTurnTimer();
          currentTurnHasThinking = true;
        };

        const onTurnCompleted = async (params: TurnCompletedParams) => {
          if (params.turnId !== this.activeTurnId) return;

          this.activeTurnId = null;
          this.isPromptActive = false;

          if (params.status === 'completed') {
            response = params.finalResponse ?? accumulated;

            // Emit turn_end for remaining text or tool-only turns
            if (currentTurnText || currentTurnHasToolCalls) {
              const turnResult: TurnResult = {
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

            cleanup();
            resolve();
          } else if (params.status === 'interrupted') {
            finishReason = 'complete';
            response = accumulated;

            if (currentTurnText || currentTurnHasToolCalls) {
              const turnResult: TurnResult = {
                turnIndex,
                text: currentTurnText,
                hasToolCalls: currentTurnHasToolCalls,
                hasThinking: currentTurnHasThinking,
                toolNames: [...currentTurnToolNames],
              };
              turns.push(turnResult);
              await this.emit(this.createEvent('turn_end', turnResult));
            }

            cleanup();
            resolve();
          } else if (params.status === 'failed') {
            finishReason = 'error';
            const errorMsg = params.error?.message ?? 'Turn failed';

            await this.emit(
              this.createEvent('error', {
                code: params.error?.code ?? 'TURN_FAILED',
                message: errorMsg,
                recoverable: false,
              }),
            );

            if (this.hooks.onToolError) {
              await this.hooks.onToolError({
                sessionId: this.id,
                toolName: 'unknown',
                toolInput: {},
                toolCallId: generateUUID(),
                error: errorMsg,
                isRetryable: false,
              });
            }

            cleanup();
            resolve();
          }
        };

        const onTokenUsage = (params: TokenUsageUpdatedParams) => {
          this.updateUsage({
            inputTokens: params.usage.inputTokens,
            outputTokens: params.usage.outputTokens,
          });
        };

        const onError = async (params: { code?: string; message?: string } | undefined) => {
          const errorMsg = params?.message ?? 'Unknown error';
          await this.emit(
            this.createEvent('error', {
              code: params?.code ?? 'CODEX_ERROR',
              message: errorMsg,
              recoverable: false,
            }),
          );
        };

        const onProcessExit = () => {
          cleanup();
          reject(new Error('App-server process exited during prompt'));
        };

        // Register listeners FIRST — before turnStart sends the request
        this.client.on(NOTIFICATION_METHODS.TURN_STARTED, onTurnStarted);
        this.client.on(NOTIFICATION_METHODS.ITEM_STARTED, onItemStarted);
        this.client.on(NOTIFICATION_METHODS.ITEM_COMPLETED, onItemCompleted);
        this.client.on(NOTIFICATION_METHODS.AGENT_MESSAGE_DELTA, onDelta);
        this.client.on(NOTIFICATION_METHODS.REASONING_TEXT_DELTA, onReasoningDelta);
        this.client.on(NOTIFICATION_METHODS.TURN_COMPLETED, onTurnCompleted);
        this.client.on(NOTIFICATION_METHODS.TOKEN_USAGE_UPDATED, onTokenUsage);
        this.client.on(NOTIFICATION_METHODS.ERROR, onError);
        this.client.on('process_exit', onProcessExit);

        // NOW start the turn — listeners are ready to catch all notifications
        // Start the turn timer immediately so it's active during turnStart()
        resetTurnTimer();

        this.client.turnStart({
          threadId,
          input: [{ type: 'text', text: input }],
        }).then((turn) => {
          this.activeTurnId = turn.turnId;
          this.isPromptActive = true;
          resetTurnTimer();

          this.emit(this.createEvent('response_start', {})).catch(() => {});
        }).catch((err) => {
          cleanup();
          reject(err);
        });
      });

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
        model: this.getModelName(),
      };
    } catch (error) {
      this.isPromptActive = false;
      this.activeTurnId = null;
      throw wrapError(error, 'codex', this.id);
    }
  }

  /**
   * Inject a user message into a running prompt stream.
   *
   * Uses `turn/steer` to cancel the current response, preserve context,
   * append the new message, and create a new response. Fire-and-forget.
   */
  injectMessage(content: string): void {
    if (!this.isPromptActive || !this.threadId || !this.activeTurnId) {
      this.logger.warn('injectMessage called but no active prompt', {
        sessionId: this.id,
        isPromptActive: this.isPromptActive,
        hasThread: !!this.threadId,
        hasActiveTurn: !!this.activeTurnId,
      });
      return;
    }

    this.client.turnSteer({
      threadId: this.threadId,
      input: [{ type: 'text', text: content }],
      expectedTurnId: this.activeTurnId,
    }).catch((error) => {
      this.logger.warn('Failed to inject message via turn/steer', {
        sessionId: this.id,
        error: String(error),
      });
    });
  }

  /**
   * Cancel the current operation via `turn/interrupt`.
   */
  async cancel(): Promise<void> {
    if (!this.activeTurnId || !this.threadId) {
      this.logger.debug('Cancel called but no active turn', { sessionId: this.id });
      return;
    }

    this.logger.info('Cancelling active turn', {
      sessionId: this.id,
      turnId: this.activeTurnId,
    });

    try {
      await this.client.turnInterrupt({
        threadId: this.threadId,
        turnId: this.activeTurnId,
      });
    } catch (error) {
      this.logger.warn('Failed to interrupt turn', {
        sessionId: this.id,
        error: String(error),
      });
    }
  }

  /**
   * End the session.
   *
   * Cancels any active turn but does NOT stop the app-server process
   * (it's shared across sessions).
   */
  async end(): Promise<void> {
    if (!this._isActive) {
      return;
    }

    this.logger.info('Ending session', { sessionId: this.id });

    if (this.activeTurnId) {
      await this.cancel();
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
   * Set up the approval request handler.
   *
   * When the app-server requests approval for a tool execution,
   * this handler determines the decision based on the session's
   * approval policy and hook configuration.
   */
  private setupApprovalHandler(): void {
    this.client.on(NOTIFICATION_METHODS.APPROVAL_REQUEST, async (params: ApprovalRequestParams) => {
      let decision: 'approve' | 'decline' = 'approve';
      const permissionKey = mapToPermissionKey(params.itemType, params.data);

      // Check canUseTool callback (maps to backend's resolveToolPermission)
      if (this.config.canUseTool) {
        const toolInput = getToolInput(params.itemType, params.data);
        try {
          const result = await this.config.canUseTool(
            permissionKey,
            typeof toolInput === 'object' && toolInput !== null
              ? toolInput as Record<string, unknown>
              : { content: toolInput },
          );
          if (result.behavior === 'deny') {
            decision = 'decline';
          }
        } catch (error) {
          this.logger.warn('canUseTool threw, auto-approving', {
            error: String(error),
          });
        }
      }

      // Check onPreToolUse hook
      if (decision === 'approve' && this.hooks.onPreToolUse) {
        const toolCallId = generateUUID();
        try {
          const result = await this.hooks.onPreToolUse({
            sessionId: this.id,
            toolName: permissionKey,
            toolInput: params.data,
            toolCallId,
          });
          if (result?.allow === false) {
            decision = 'decline';
          }
        } catch (error) {
          this.logger.warn('onPreToolUse threw during approval, auto-approving', {
            error: String(error),
          });
        }
      }

      this.client.sendApprovalResponse({
        requestId: params.requestId,
        decision,
      });
    });
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Map Codex item types to the canonical permission key format
 * stored in the backend's `tool_permissions` table.
 *
 * - commandExecution -> 'Bash' (PascalCase, matching the seeded SDK tool name)
 * - fileChange create/delete -> 'Write', modify -> 'Edit'
 * - mcpToolCall -> 'mcp__<server>__<tool>' (double-underscore format)
 */
function mapToPermissionKey(itemType: string, data: unknown): string {
  if (itemType === 'commandExecution') {
    return 'Bash';
  }
  if (itemType === 'fileChange') {
    const fc = data as FileChangeData | undefined;
    if (fc?.changeType === 'create' || fc?.changeType === 'delete') return 'Write';
    return 'Edit';
  }
  if (itemType === 'mcpToolCall') {
    const mcp = data as McpToolCallData | undefined;
    if (mcp?.server && mcp?.tool) {
      return `mcp__${mcp.server}__${mcp.tool}`;
    }
    return 'mcp_tool';
  }
  if (itemType === 'webSearch') {
    return 'WebSearch';
  }
  if (itemType === 'collabAgentToolCall') {
    return 'CollabAgent';
  }
  return itemType;
}

function getToolName(itemType: string, data: unknown): string {
  if (itemType === 'commandExecution') {
    const cmd = data as CommandExecutionData | undefined;
    return cmd?.command ? `command:${cmd.command.split(' ')[0]}` : 'command';
  }
  if (itemType === 'mcpToolCall') {
    const mcp = data as McpToolCallData | undefined;
    return mcp?.tool ? `${mcp.server}:${mcp.tool}` : 'mcp_tool';
  }
  if (itemType === 'fileChange') {
    const fc = data as FileChangeData | undefined;
    return fc?.changeType ? `file:${fc.changeType}` : 'file_change';
  }
  if (itemType === 'webSearch') {
    const ws = data as WebSearchData | undefined;
    return ws?.query ? `webSearch:${ws.query.substring(0, 50)}` : 'webSearch';
  }
  if (itemType === 'collabAgentToolCall') {
    const ca = data as Record<string, unknown> | undefined;
    const tool = ca?.['tool'] as string | undefined;
    return tool ? `collabAgent:${tool}` : 'collabAgent';
  }
  // Legacy SDK event types
  if (itemType === 'command' || itemType === 'tool') {
    return itemType;
  }
  return itemType;
}

function getToolInput(itemType: string, data: unknown): unknown {
  if (itemType === 'commandExecution') {
    const cmd = data as CommandExecutionData | undefined;
    return cmd ? { command: cmd.command, cwd: cmd.cwd } : {};
  }
  if (itemType === 'mcpToolCall') {
    const mcp = data as McpToolCallData | undefined;
    return mcp?.args ?? {};
  }
  if (itemType === 'fileChange') {
    const fc = data as FileChangeData | undefined;
    return fc ? { path: fc.path, changeType: fc.changeType } : {};
  }
  if (itemType === 'webSearch') {
    const ws = data as WebSearchData | undefined;
    return ws ? { query: ws.query, queries: ws.queries } : {};
  }
  if (itemType === 'collabAgentToolCall') {
    const ca = data as Record<string, unknown> | undefined;
    return ca ? { tool: ca['tool'], prompt: ca['prompt'] } : {};
  }
  return data ?? {};
}

function getToolOutput(itemType: string, data: unknown): unknown {
  if (itemType === 'commandExecution') {
    const cmd = data as CommandExecutionData | undefined;
    return cmd?.output ?? cmd?.aggregatedOutput ?? '';
  }
  if (itemType === 'mcpToolCall') {
    const mcp = data as McpToolCallData | undefined;
    return mcp?.result ?? '';
  }
  if (itemType === 'fileChange') {
    const fc = data as FileChangeData | undefined;
    return fc?.diff ?? '';
  }
  if (itemType === 'webSearch') {
    const ws = data as WebSearchData | undefined;
    return ws?.query ? `Web search: ${ws.query}` : 'Web search completed';
  }
  if (itemType === 'collabAgentToolCall') {
    const ca = data as Record<string, unknown> | undefined;
    return ca?.['message'] ?? '';
  }
  return '';
}

function getToolDuration(data: unknown): number {
  if (data && typeof data === 'object' && 'durationMs' in data) {
    return (data as { durationMs?: number }).durationMs ?? 0;
  }
  return 0;
}

/**
 * Convert MCP server configs to dotted-key overrides for the `config` param.
 *
 * The Codex app-server ignores a top-level `mcpServers` field in `thread/start`.
 * MCP servers must be passed via the `config` param as dotted-key overrides
 * that get merged into the Codex config resolution pipeline.
 *
 * Input format (from mind-session MCP bridge):
 *   { "tools": { command: "npx", args: [...], env: { KEY: "val" } }, ... }
 *
 * Output format (dotted-key config overrides):
 *   { "mcp_servers.tools.command": "npx", "mcp_servers.tools.args": [...], ... }
 */
function mcpServersToConfigOverrides(
  mcpServers: Record<string, Record<string, unknown>> | undefined,
): Record<string, unknown> {
  if (!mcpServers || Object.keys(mcpServers).length === 0) return {};

  const config: Record<string, unknown> = {};

  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    const prefix = `mcp_servers.${serverName}`;

    for (const [key, value] of Object.entries(serverConfig)) {
      if (key === 'env' && value && typeof value === 'object' && !Array.isArray(value)) {
        // Flatten env as dotted keys: mcp_servers.<name>.env.<KEY> = "val"
        for (const [envKey, envValue] of Object.entries(value as Record<string, string>)) {
          config[`${prefix}.env.${envKey}`] = envValue;
        }
      } else {
        // Direct value: mcp_servers.<name>.<key> = value
        config[`${prefix}.${key}`] = value;
      }
    }
  }

  return config;
}
