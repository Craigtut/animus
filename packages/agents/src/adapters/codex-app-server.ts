/**
 * JSON-RPC client for the Codex App Server Protocol.
 *
 * Manages a long-lived `codex app-server` child process, providing
 * typed request/response methods and notification dispatch via EventEmitter.
 *
 * The app server protocol enables mid-turn message injection (`turn/steer`)
 * and cancellation (`turn/interrupt`), unlocking capabilities that the
 * SDK's per-turn `codex exec` approach cannot provide.
 *
 * @see codex-protocol-types.ts for the type definitions
 */

import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createTaggedLogger, type Logger } from '../logger.js';
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  InitializeParams,
  InitializeResult,
  ThreadStartParams,
  ThreadResumeParams,
  ThreadForkParams,
  Thread,
  TurnStartParams,
  TurnSteerParams,
  TurnInterruptParams,
  Turn,
  ApprovalResponseParams,
  RawThreadStartResult,
  RawTurnStartResult,
  RawTurnStartedParams,
  RawTurnCompletedParams,
  RawItemStartedParams,
  RawItemCompletedParams,
  RawErrorNotificationParams,
  RawTokenUsageUpdatedParams,
  RawItemObject,
  TurnStatus,
  SkillsListParams,
  SkillEntry,
  SkillsListResult,
  SkillsConfigWriteParams,
} from './codex-protocol-types.js';
import {
  REQUEST_METHODS,
  NOTIFICATION_METHODS,
} from './codex-protocol-types.js';

const REQUEST_TIMEOUT_MS = 30_000;

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Rich model metadata returned by the app-server `model/list` endpoint.
 */
export interface CodexModelInfo {
  id: string;
  displayName?: string;
  contextWindow?: number;
  isDefault?: boolean;
  hidden?: boolean;
  upgrade?: string;
  reasoningEffort?: string;
  inputModalities?: string[];
}

export interface CodexAppServerOptions {
  /** Environment variables to pass to the app-server process */
  env?: Record<string, string>;
  /** Logger instance */
  logger?: Logger;
}

/**
 * Resolve the path to the `codex` binary.
 *
 * Strategy:
 * 1. Use createRequire to find @openai/codex-sdk, then construct vendor path
 * 2. Fall back to `which codex` on PATH
 */
function resolveCodexBinary(): string {
  // Strategy 1: Resolve via @openai/codex-sdk vendor path
  // The Codex SDK's exports field only has an "import" condition (no "require"),
  // so createRequire().resolve() fails. Use resolve.paths to get the
  // node_modules search directories, then check each for the package directly.
  try {
    const require = createRequire(import.meta.url);
    const searchPaths = require.resolve.paths('@openai/codex-sdk') ?? [];
    let sdkRoot: string | null = null;
    for (const searchPath of searchPaths) {
      const candidate = join(searchPath, '@openai', 'codex-sdk');
      if (existsSync(join(candidate, 'package.json'))) {
        sdkRoot = candidate;
        break;
      }
    }
    if (!sdkRoot) throw new Error('Codex SDK not found in node_modules');

    const platform = process.platform;
    const arch = process.arch;

    let triple: string;
    if (platform === 'darwin' && arch === 'arm64') {
      triple = 'aarch64-apple-darwin';
    } else if (platform === 'darwin' && arch === 'x64') {
      triple = 'x86_64-apple-darwin';
    } else if (platform === 'linux' && arch === 'arm64') {
      triple = 'aarch64-unknown-linux-musl';
    } else if (platform === 'linux' && arch === 'x64') {
      triple = 'x86_64-unknown-linux-musl';
    } else if (platform === 'win32' && arch === 'arm64') {
      triple = 'aarch64-pc-windows-msvc';
    } else if (platform === 'win32' && arch === 'x64') {
      triple = 'x86_64-pc-windows-msvc';
    } else {
      throw new Error(`Unsupported platform: ${platform}/${arch}`);
    }

    const binaryName = platform === 'win32' ? 'codex.exe' : 'codex';
    const vendorPath = join(sdkRoot, 'vendor', triple, 'codex', binaryName);

    if (existsSync(vendorPath)) {
      return vendorPath;
    }
  } catch {
    // Fall through to PATH lookup
  }

  // Strategy 2: Fall back to system PATH
  try {
    const whichCmd = process.platform === 'win32' ? 'where codex' : 'which codex';
    const which = execSync(whichCmd, { encoding: 'utf-8' }).trim().split('\n')[0]?.trim();
    if (which && existsSync(which)) {
      return which;
    }
  } catch {
    // Not found on PATH either
  }

  throw new Error(
    'Could not find codex binary. Is @openai/codex-sdk installed?',
  );
}

/**
 * JSON-RPC client for the Codex App Server.
 *
 * Manages process lifecycle, request/response correlation, and
 * notification dispatch. Emits typed events for all server notifications.
 */
export class CodexAppServerClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private readline: ReadlineInterface | null = null;
  private pendingRequests = new Map<number, PendingRequest>();
  private nextId = 1;
  private logger: Logger;
  private env: Record<string, string> | undefined;
  private _isRunning = false;

  constructor(options?: CodexAppServerOptions) {
    super();
    this.logger = options?.logger ?? createTaggedLogger('CodexAppServer');
    this.env = options?.env;
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  /**
   * Spawn the app-server process and complete the initialization handshake.
   */
  async start(): Promise<void> {
    if (this._isRunning) {
      return;
    }

    const binaryPath = resolveCodexBinary();
    this.logger.info('Starting codex app-server', { binary: binaryPath });

    // Build environment: merge process.env with overrides
    const mergedEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) mergedEnv[key] = value;
    }
    if (this.env) {
      Object.assign(mergedEnv, this.env);
    }

    this.process = spawn(binaryPath, ['app-server'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: mergedEnv,
    });

    // Pipe stderr to logger at debug level
    if (this.process.stderr) {
      const stderrRl = createInterface({ input: this.process.stderr });
      stderrRl.on('line', (line) => {
        this.logger.debug(`[stderr] ${line}`);
      });
    }

    // Set up JSONL reader on stdout
    if (!this.process.stdout) {
      throw new Error('Failed to get stdout from app-server process');
    }

    this.readline = createInterface({ input: this.process.stdout });
    this.readline.on('line', (line) => {
      this.handleLine(line);
    });

    // Monitor process exit
    this.process.on('exit', (code, signal) => {
      this._isRunning = false;
      this.logger.info('App-server process exited', { code, signal });

      // Reject all pending requests
      for (const [id, pending] of this.pendingRequests) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`App-server process exited (code=${code}, signal=${signal})`));
        this.pendingRequests.delete(id);
      }

      this.emit('process_exit', { code, signal });
    });

    this.process.on('error', (error) => {
      this._isRunning = false;
      this.logger.error('App-server process error', { error: String(error) });
      this.emit('process_error', error);
    });

    // Perform initialization handshake
    const initResult = await this.sendRequest<InitializeResult>(
      REQUEST_METHODS.INITIALIZE,
      {
        protocolVersion: '2.0',
        clientInfo: {
          name: 'animus-agents',
          version: '1.0.0',
        },
      } satisfies InitializeParams,
    );

    // Send `initialized` notification
    this.sendNotification('initialized');

    this._isRunning = true;
    this.logger.info('App-server initialized', {
      userAgent: initResult.userAgent ?? initResult.serverInfo?.version,
    });
  }

  /**
   * Gracefully stop the app-server process.
   */
  async stop(): Promise<void> {
    if (!this.process || !this._isRunning) {
      return;
    }

    this.logger.info('Stopping app-server');

    return new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        this.logger.warn('App-server did not exit gracefully, sending SIGKILL');
        this.process?.kill('SIGKILL');
      }, 5000);

      this.process!.once('exit', () => {
        clearTimeout(killTimer);
        this._isRunning = false;
        this.process = null;
        this.readline = null;
        resolve();
      });

      this.process!.kill('SIGTERM');
    });
  }

  // =========================================================================
  // Public API Methods
  // =========================================================================

  async threadStart(params: ThreadStartParams): Promise<Thread> {
    const raw = await this.sendRequest<RawThreadStartResult>(REQUEST_METHODS.THREAD_START, params);
    return { threadId: raw.thread.id };
  }

  async threadResume(params: ThreadResumeParams): Promise<Thread> {
    // Resume may return the same nested format
    const raw = await this.sendRequest<RawThreadStartResult | Thread>(REQUEST_METHODS.THREAD_RESUME, params);
    if ('thread' in raw && raw.thread?.id) {
      return { threadId: raw.thread.id };
    }
    return raw as Thread;
  }

  async threadFork(params: ThreadForkParams): Promise<Thread> {
    const raw = await this.sendRequest<RawThreadStartResult | Thread>(REQUEST_METHODS.THREAD_FORK, params);
    if ('thread' in raw && raw.thread?.id) {
      return { threadId: raw.thread.id };
    }
    return raw as Thread;
  }

  async turnStart(params: TurnStartParams): Promise<Turn> {
    const raw = await this.sendRequest<RawTurnStartResult>(REQUEST_METHODS.TURN_START, params);
    return { turnId: raw.turn.id };
  }

  async turnSteer(params: TurnSteerParams): Promise<{ turnId: string }> {
    const raw = await this.sendRequest<RawTurnStartResult | { turnId: string }>(REQUEST_METHODS.TURN_STEER, params);
    if ('turn' in raw && (raw as RawTurnStartResult).turn?.id) {
      return { turnId: (raw as RawTurnStartResult).turn.id };
    }
    return raw as { turnId: string };
  }

  async turnInterrupt(params: TurnInterruptParams): Promise<void> {
    await this.sendRequest<void>(REQUEST_METHODS.TURN_INTERRUPT, params);
  }

  sendApprovalResponse(params: ApprovalResponseParams): void {
    this.sendNotification(REQUEST_METHODS.APPROVAL_RESPONSE, params);
  }

  /**
   * List available models from the app-server.
   *
   * Sends a `model/list` JSON-RPC request. This method may not be
   * supported in older Codex versions, so errors are caught gracefully.
   */
  async modelList(): Promise<CodexModelInfo[]> {
    try {
      const result = await this.sendRequest<
        CodexModelInfo[]
        | { models: CodexModelInfo[] }
      >(REQUEST_METHODS.MODEL_LIST);

      // Handle both array and { models: [...] } response shapes
      let raw: CodexModelInfo[];
      if (Array.isArray(result)) {
        raw = result;
      } else if (result && typeof result === 'object' && 'models' in result && Array.isArray(result.models)) {
        raw = result.models;
      } else {
        return [];
      }

      // Map snake_case API fields to camelCase
      return raw.map(m => {
        const r = m as unknown as Record<string, unknown>;
        return {
          id: m.id,
          displayName: m.displayName ?? r['display_name'] as string | undefined,
          contextWindow: m.contextWindow ?? r['context_window'] as number | undefined,
          isDefault: m.isDefault ?? r['is_default'] as boolean | undefined,
          hidden: m.hidden,
          upgrade: m.upgrade,
          reasoningEffort: m.reasoningEffort ?? r['reasoning_effort'] as string | undefined,
          inputModalities: m.inputModalities ?? r['input_modalities'] as string[] | undefined,
        };
      });
    } catch {
      this.logger.debug('model/list not supported by this app-server version');
      return [];
    }
  }

  /**
   * List skills known to the app-server.
   *
   * Sends a `skills/list` JSON-RPC request. This method may not be
   * supported in older Codex versions, so errors are caught gracefully.
   */
  async skillsList(params?: SkillsListParams): Promise<SkillEntry[]> {
    try {
      const result = await this.sendRequest<
        SkillEntry[]
        | SkillsListResult
      >(REQUEST_METHODS.SKILLS_LIST, params);

      // Handle both array and { skills: [...] } response shapes
      if (Array.isArray(result)) {
        return result;
      }
      if (result && typeof result === 'object' && 'skills' in result && Array.isArray(result.skills)) {
        return result.skills;
      }
      return [];
    } catch {
      this.logger.debug('skills/list not supported by this app-server version');
      return [];
    }
  }

  /**
   * Enable or disable a skill at runtime.
   *
   * Sends a `skills/config/write` JSON-RPC request. Returns true on
   * success, false if the method is not supported or errors occur.
   */
  async skillsConfigWrite(path: string, enabled: boolean): Promise<boolean> {
    try {
      await this.sendRequest<unknown>(
        REQUEST_METHODS.SKILLS_CONFIG_WRITE,
        { path, enabled } satisfies SkillsConfigWriteParams,
      );
      return true;
    } catch {
      this.logger.debug('skills/config/write failed or not supported', { path, enabled });
      return false;
    }
  }

  // =========================================================================
  // Transport Layer
  // =========================================================================

  private sendRequest<T>(method: string, params?: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        reject(new Error('App-server stdin is not writable'));
        return;
      }

      const id = this.nextId++;
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms: ${method}`));
      }, REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timer,
      });

      const line = JSON.stringify(request) + '\n';
      this.process.stdin.write(line, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pendingRequests.delete(id);
          reject(new Error(`Failed to write to app-server stdin: ${err.message}`));
        }
      });
    });
  }

  private sendNotification(method: string, params?: unknown): void {
    if (!this.process?.stdin?.writable) {
      this.logger.warn('Cannot send notification, stdin not writable', { method });
      return;
    }

    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    const line = JSON.stringify(notification) + '\n';
    this.process.stdin.write(line);
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;

    let message: JsonRpcResponse | JsonRpcNotification;
    try {
      message = JSON.parse(line);
    } catch {
      this.logger.warn('Failed to parse JSONL line from app-server', {
        line: line.substring(0, 200),
      });
      return;
    }

    // Response to a request (has `id`)
    if ('id' in message && typeof (message as JsonRpcResponse).id === 'number') {
      const response = message as JsonRpcResponse;
      const pending = this.pendingRequests.get(response.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(response.id);

        if (response.error) {
          pending.reject(
            new Error(`JSON-RPC error ${response.error.code}: ${response.error.message}`),
          );
        } else {
          pending.resolve(response.result);
        }
      }
      return;
    }

    // Server notification (no `id`)
    const notification = message as JsonRpcNotification;
    this.emit('notification', notification);

    // Normalize notification params to match our typed interfaces
    const normalized = this.normalizeNotification(notification.method, notification.params);
    if (normalized) {
      this.emit(normalized.method, normalized.params);
    }
  }

  // =========================================================================
  // Notification Normalization
  // =========================================================================

  /**
   * Normalize raw app-server notification params to match our typed interfaces.
   *
   * The Codex app-server uses nested objects (e.g., `{ turn: { id, status } }`)
   * while our adapter types use flat fields (e.g., `{ turnId, status }`).
   * This method translates between the two representations.
   */
  private normalizeNotification(
    method: string,
    params: unknown,
  ): { method: string; params: unknown } | null {
    const raw = params as Record<string, unknown> | undefined;
    if (!raw) return { method, params };

    switch (method) {
      case NOTIFICATION_METHODS.TURN_STARTED: {
        // Raw: { threadId, turn: { id, ... } }
        const p = raw as unknown as RawTurnStartedParams;
        if (p.turn?.id) {
          return {
            method,
            params: {
              threadId: p.threadId,
              turnId: p.turn.id,
            },
          };
        }
        return { method, params };
      }

      case NOTIFICATION_METHODS.TURN_COMPLETED: {
        // Raw: { threadId, turn: { id, status, error, items } }
        const p = raw as unknown as RawTurnCompletedParams;
        if (p.turn?.id) {
          // Extract final response from agent message items if available
          let finalResponse: string | undefined;
          if (p.turn.items) {
            const agentMessages = (p.turn.items as Array<{ type: string; content?: Array<{ type: string; text?: string }> }>).filter(
              (item) => item.type === 'agentMessage',
            );
            if (agentMessages.length > 0) {
              const lastMsg = agentMessages[agentMessages.length - 1]!;
              if (lastMsg.content) {
                finalResponse = lastMsg.content
                  .filter((c: { type: string; text?: string }) => c.type === 'text' && c.text)
                  .map((c: { type: string; text?: string }) => c.text)
                  .join('');
              }
            }
          }

          return {
            method,
            params: {
              threadId: p.threadId,
              turnId: p.turn.id,
              status: (p.turn.status ?? 'failed') as TurnStatus,
              finalResponse,
              error: p.turn.error ?? undefined,
            },
          };
        }
        return { method, params };
      }

      case NOTIFICATION_METHODS.ITEM_STARTED:
      case NOTIFICATION_METHODS.ITEM_COMPLETED: {
        // Raw: { item: { type, id, ... }, threadId, turnId }
        const p = raw as unknown as RawItemStartedParams;
        if (p.item?.id) {
          return {
            method,
            params: {
              turnId: p.turnId,
              itemId: p.item.id,
              itemType: p.item.type,
              data: extractItemData(p.item),
            },
          };
        }
        return { method, params };
      }

      case NOTIFICATION_METHODS.AGENT_MESSAGE_DELTA:
      case NOTIFICATION_METHODS.REASONING_TEXT_DELTA:
      case NOTIFICATION_METHODS.REASONING_SUMMARY_DELTA: {
        // Raw: { threadId, turnId, itemId, delta: "text" } (delta is a plain string)
        // Normalized: { turnId, itemId, delta: { text: "text" } }
        // Note: summaryTextDelta is remapped to textDelta so session code handles it
        const p = raw as { threadId?: string; turnId?: string; itemId?: string; delta?: string | { text: string } };
        const deltaValue = p.delta;
        const emitMethod = method === NOTIFICATION_METHODS.REASONING_SUMMARY_DELTA
          ? NOTIFICATION_METHODS.REASONING_TEXT_DELTA
          : method;
        return {
          method: emitMethod,
          params: {
            turnId: p.turnId,
            itemId: p.itemId,
            delta: typeof deltaValue === 'string' ? { text: deltaValue } : deltaValue,
          },
        };
      }

      case NOTIFICATION_METHODS.TOKEN_USAGE_UPDATED: {
        // Raw: { threadId, turnId, tokenUsage: { total: { inputTokens, outputTokens, ... } } }
        // Normalized: { threadId, usage: { inputTokens, outputTokens, totalTokens } }
        const p = raw as unknown as RawTokenUsageUpdatedParams;
        if (p.tokenUsage?.total) {
          return {
            method,
            params: {
              threadId: p.threadId,
              usage: {
                inputTokens: p.tokenUsage.total.inputTokens,
                outputTokens: p.tokenUsage.total.outputTokens,
                totalTokens: p.tokenUsage.total.totalTokens,
              },
            },
          };
        }
        // Fallback: maybe already normalized
        return { method, params };
      }

      case NOTIFICATION_METHODS.APPROVAL_REQUEST:
        // Already uses flat fields
        return { method, params };

      case NOTIFICATION_METHODS.ERROR: {
        // Raw: { error: { message, codexErrorInfo }, willRetry, threadId, turnId }
        const p = raw as unknown as RawErrorNotificationParams;
        if (p.error) {
          return {
            method,
            params: {
              code: p.error.codexErrorInfo ?? 'CODEX_ERROR',
              message: p.error.message,
              willRetry: p.willRetry,
              threadId: p.threadId,
              turnId: p.turnId,
            },
          };
        }
        return { method, params };
      }

      default:
        // Unknown notification (e.g., codex/event/*) — emit as-is
        return { method, params };
    }
  }
}

/**
 * Extract item data from a raw item object, stripping the type/id fields
 * to produce a data payload matching our typed interfaces.
 */
function extractItemData(item: RawItemObject): Record<string, unknown> {
  const { type: _type, id: _id, ...data } = item;
  return data;
}
