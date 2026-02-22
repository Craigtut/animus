/**
 * Channel Process Host — wraps a single child process for one channel package.
 *
 * Manages the lifecycle of a forked child process: start, stop, send messages,
 * forward HTTP requests, health checks, and crash recovery with exponential backoff.
 */

import { fork, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { createLogger } from '../lib/logger.js';
import { generateCorrelationId } from './ipc/protocol.js';
import { createParentHandler } from './ipc/parent-handler.js';
import type { ChannelManifest, ChannelPackage } from '@animus/shared';
import type {
  ParentToChildMessage,
  SendResponseMessage,
  RouteResponseMessage,
  RouteResponseStreamStartMessage,
  RouteResponseChunkMessage,
  RouteResponseEndMessage,
  IncomingMessage,
} from './ipc/protocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ProcessHostConfig {
  pkg: ChannelPackage;
  manifest: ChannelManifest;
  decryptedConfig: Record<string, unknown>;
  onIncoming: (msg: {
    identifier: string;
    content: string;
    conversationId?: string;
    media?: IncomingMessage['media'];
    metadata?: Record<string, unknown>;
  }) => void | Promise<void>;
  onStatusChange: (status: string, error?: string) => void;
  onRouteRegister: (method: string, path: string) => void;
  resolveContact: (contactId: string) => Promise<{ identifier: string; displayName?: string } | null>;
  downloadMedia: (params: {
    url: string;
    mimeType: string;
    filename?: string;
    auth?: { type: 'basic'; username: string; password: string } | { type: 'bearer'; token: string };
  }) => Promise<{ localPath: string; sizeBytes: number }>;
  onPresenceUpdate?: (channelType: string, identifier: string, data: {
    status: 'online' | 'idle' | 'dnd' | 'offline';
    statusText?: string;
    activity?: string;
  }) => void;
}

interface PendingSend {
  resolve: (ok: boolean) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingAction {
  resolve: (ok: boolean) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingRoute {
  resolve: (value: RouteResponseMessage) => void;
  reject: (err: Error) => void;
  streaming?: {
    emitter: EventEmitter;
  };
  timer: ReturnType<typeof setTimeout>;
}

const MAX_CONSECUTIVE_FAILURES = 5;
const READY_TIMEOUT_MS = 10_000;
const STOP_ACK_TIMEOUT_MS = 10_000;
const KILL_TIMEOUT_MS = 5_000;
const SEND_TIMEOUT_MS = 30_000;
const ACTION_TIMEOUT_MS = 10_000;
const ROUTE_TIMEOUT_MS = 30_000;
const HEALTH_CHECK_INTERVAL_MS = 30_000;
const PING_TIMEOUT_MS = 5_000;
const MAX_BACKOFF_MS = 60_000;

export class ChannelProcessHost {
  private childProcess: ChildProcess | null = null;
  private config: ProcessHostConfig;
  private log: ReturnType<typeof createLogger>;

  private pendingSendRequests = new Map<string, PendingSend>();
  private pendingActionRequests = new Map<string, PendingAction>();
  private pendingRouteRequests = new Map<string, PendingRoute>();

  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private pendingPing: { id: string; timer: ReturnType<typeof setTimeout> } | null = null;

  private consecutiveFailures = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private stopping = false;

  private registeredRoutes = new Set<string>();

  constructor(config: ProcessHostConfig) {
    this.config = config;
    this.log = createLogger(`ProcessHost:${config.pkg.name}`, 'channels');
  }

  async start(): Promise<void> {
    if (this.childProcess && !this.childProcess.killed) {
      this.log.warn('Process already running, stopping first');
      await this.stop();
    }

    this.stopping = false;

    // Determine bootstrapper path
    const bootstrapperPath = path.join(__dirname, 'sdk', 'adapter-context.js');

    // Build fork args
    const forkArgs = [this.config.pkg.path];

    // Build fork options
    const forkOpts: Parameters<typeof fork>[2] = {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env },
    };

    // In production, use --permission flag for sandboxing
    const execArgv: string[] = [];
    if (process.env['NODE_ENV'] === 'production') {
      execArgv.push(
        '--permission',
        `--allow-fs-read=${this.config.pkg.path}`,
        '--allow-net',
      );
    }
    if (execArgv.length > 0) {
      forkOpts.execArgv = execArgv;
    }

    // Create a promise that resolves on 'ready' or rejects on timeout
    const readyPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Channel ${this.config.pkg.name} did not send ready within ${READY_TIMEOUT_MS}ms`));
      }, READY_TIMEOUT_MS);

      // We store resolve/reject so the handler can call them
      this._readyResolve = () => {
        clearTimeout(timer);
        resolve();
      };
      this._readyReject = (err: Error) => {
        clearTimeout(timer);
        reject(err);
      };
    });

    this.log.debug(`Forking child process for ${this.config.pkg.name}`);
    this.childProcess = fork(bootstrapperPath, forkArgs, forkOpts);

    // Pipe child stdout/stderr to our logger
    this.childProcess.stdout?.on('data', (data: Buffer) => {
      this.log.debug(`[stdout] ${data.toString().trim()}`);
    });
    this.childProcess.stderr?.on('data', (data: Buffer) => {
      this.log.warn(`[stderr] ${data.toString().trim()}`);
    });

    // Set up message handler
    const handler = createParentHandler({
      channelType: this.config.pkg.channelType,
      channelName: this.config.pkg.name,

      onReady: () => {
        this._readyResolve?.();
      },

      onIncoming: (msg) => {
        const incoming: Parameters<ProcessHostConfig['onIncoming']>[0] = {
          identifier: msg.identifier,
          content: msg.content,
        };
        if (msg.conversationId) incoming.conversationId = msg.conversationId;
        if (msg.media) incoming.media = msg.media;
        if (msg.metadata) incoming.metadata = msg.metadata;
        this.config.onIncoming(incoming);
      },

      onSendResponse: (msg) => {
        const pending = this.pendingSendRequests.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingSendRequests.delete(msg.id);
          pending.resolve(msg.ok);
        }
      },

      onRouteResponse: (msg) => {
        const pending = this.pendingRouteRequests.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingRouteRequests.delete(msg.id);
          pending.resolve(msg);
        }
      },

      onRouteStreamStart: (msg) => {
        const pending = this.pendingRouteRequests.get(msg.id);
        if (pending?.streaming) {
          pending.streaming.emitter.emit('start', msg);
        }
      },

      onRouteStreamChunk: (msg) => {
        const pending = this.pendingRouteRequests.get(msg.id);
        if (pending?.streaming) {
          pending.streaming.emitter.emit('chunk', msg.data);
        }
      },

      onRouteStreamEnd: (msg) => {
        const pending = this.pendingRouteRequests.get(msg.id);
        if (pending?.streaming) {
          clearTimeout(pending.timer);
          pending.streaming.emitter.emit('end');
          this.pendingRouteRequests.delete(msg.id);
        }
      },

      onResolveContact: async (msg) => {
        try {
          const result = await this.config.resolveContact(msg.contactId);
          this.sendToChild({
            type: 'resolve_contact_response',
            id: msg.id,
            result,
          });
        } catch (err) {
          this.sendToChild({
            type: 'resolve_contact_response',
            id: msg.id,
            result: null,
          });
        }
      },

      onMediaDownload: async (msg) => {
        try {
          const params: Parameters<ProcessHostConfig['downloadMedia']>[0] = {
            url: msg.url,
            mimeType: msg.mimeType,
          };
          if (msg.filename) params.filename = msg.filename;
          if (msg.auth) params.auth = msg.auth;
          const result = await this.config.downloadMedia(params);
          this.sendToChild({
            type: 'media_download_response',
            id: msg.id,
            localPath: result.localPath,
            sizeBytes: result.sizeBytes,
          });
        } catch (err) {
          this.sendToChild({
            type: 'media_download_response',
            id: msg.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },

      onPresenceUpdate: (msg) => {
        this.config.onPresenceUpdate?.(
          this.config.pkg.channelType,
          msg.identifier,
          {
            status: msg.status,
            statusText: msg.statusText,
            activity: msg.activity,
          }
        );
      },

      onActionResponse: (msg) => {
        const pending = this.pendingActionRequests.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingActionRequests.delete(msg.id);
          pending.resolve(msg.ok);
        }
      },

      onRouteRegister: (msg) => {
        const key = `${msg.method} ${msg.path}`;
        this.registeredRoutes.add(key);
        this.config.onRouteRegister(msg.method, msg.path);
      },

      onError: (msg) => {
        this.log.error(`Child process error: ${msg.message}`);
        // If we're waiting for ready, reject
        this._readyReject?.(new Error(msg.message));
      },

      onStopAck: () => {
        this._stopAckResolve?.();
      },

      onPong: (msg) => {
        if (this.pendingPing && this.pendingPing.id === msg.id) {
          clearTimeout(this.pendingPing.timer);
          this.pendingPing = null;
        }
      },
    });

    this.childProcess.on('message', handler);

    // Handle unexpected exit
    this.childProcess.on('exit', (code, signal) => {
      this.handleExit(code, signal);
    });

    // Send init message
    this.sendToChild({
      type: 'init',
      config: this.config.decryptedConfig,
      channelType: this.config.pkg.channelType,
    });

    // Wait for ready
    await readyPromise;

    // Start health checks
    this.startHealthCheck();

    // Reset failure count on successful start
    this.consecutiveFailures = 0;

    this.log.debug(`Channel ${this.config.pkg.name} process started successfully`);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.stopHealthCheck();

    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    if (!this.childProcess || this.childProcess.killed) {
      this.childProcess = null;
      this.rejectAllPending('Process stopped');
      return;
    }

    // Send stop and wait for ack
    const stopPromise = new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.log.warn('Stop ack timeout, sending SIGTERM');
        resolve();
      }, STOP_ACK_TIMEOUT_MS);

      this._stopAckResolve = () => {
        clearTimeout(timer);
        resolve();
      };
    });

    this.sendToChild({ type: 'stop' });
    await stopPromise;

    // If still alive, SIGTERM then SIGKILL
    if (this.childProcess && !this.childProcess.killed) {
      this.childProcess.kill('SIGTERM');

      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (this.childProcess && !this.childProcess.killed) {
            this.log.warn('SIGTERM timeout, sending SIGKILL');
            this.childProcess.kill('SIGKILL');
          }
          resolve();
        }, KILL_TIMEOUT_MS);

        this.childProcess!.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }

    this.childProcess = null;
    this.registeredRoutes.clear();
    this.rejectAllPending('Process stopped');
    this.log.info(`Channel ${this.config.pkg.name} process stopped`);
  }

  async restart(): Promise<void> {
    await this.stop();
    this.stopping = false;
    await this.start();
  }

  async send(
    contactId: string,
    content: string,
    metadata?: Record<string, unknown>,
    media?: Array<{ type: string; path: string; mimeType: string; filename?: string }>
  ): Promise<boolean> {
    if (!this.childProcess || this.childProcess.killed) {
      this.log.error('Cannot send: process not running');
      return false;
    }

    const id = generateCorrelationId();

    // Read files and base64-encode for IPC (child process may not have fs permissions)
    let ipcMedia: import('./ipc/protocol.js').SendMessage['media'];
    if (media && media.length > 0) {
      ipcMedia = [];
      for (const m of media) {
        try {
          const data = fs.readFileSync(m.path);
          const entry: NonNullable<import('./ipc/protocol.js').SendMessage['media']>[number] = {
            type: m.type as 'image' | 'audio' | 'video' | 'file',
            path: m.path,
            mimeType: m.mimeType,
            data: data.toString('base64'),
          };
          if (m.filename) entry.filename = m.filename;
          ipcMedia.push(entry);
        } catch (err) {
          this.log.error(`Failed to read media file ${m.path} for IPC:`, err);
        }
      }
      if (ipcMedia.length === 0) ipcMedia = undefined;
    }

    return new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingSendRequests.delete(id);
        reject(new Error(`Send timeout after ${SEND_TIMEOUT_MS}ms`));
      }, SEND_TIMEOUT_MS);

      this.pendingSendRequests.set(id, { resolve, reject, timer });

      const msg: import('./ipc/protocol.js').SendMessage = {
        type: 'send',
        id,
        contactId,
        content,
      };
      if (metadata) msg.metadata = metadata;
      if (ipcMedia) msg.media = ipcMedia;
      this.sendToChild(msg);
    });
  }

  async performAction(action: { type: string; [key: string]: unknown }): Promise<boolean> {
    if (!this.childProcess || this.childProcess.killed) {
      this.log.warn('Cannot perform action: process not running');
      return false;
    }

    const id = generateCorrelationId();

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingActionRequests.delete(id);
        this.log.warn(`Action timeout after ${ACTION_TIMEOUT_MS}ms (type: ${action.type})`);
        resolve(false);
      }, ACTION_TIMEOUT_MS);

      this.pendingActionRequests.set(id, { resolve, reject: () => resolve(false), timer });

      this.sendToChild({ type: 'action', id, action });
    });
  }

  async forwardRequest(request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: unknown;
    rawBody: Buffer;
    query: Record<string, string>;
  }): Promise<
    | { type: 'response'; data: RouteResponseMessage }
    | { type: 'stream'; status: number; headers: Record<string, string>; stream: AsyncGenerator<string> }
  > {
    if (!this.childProcess || this.childProcess.killed) {
      throw new Error('Cannot forward request: process not running');
    }

    const id = generateCorrelationId();
    const emitter = new EventEmitter();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRouteRequests.delete(id);
        emitter.removeAllListeners();
        reject(new Error(`Route request timeout after ${ROUTE_TIMEOUT_MS}ms`));
      }, ROUTE_TIMEOUT_MS);

      // Set up streaming handler - check for stream_start first
      let isStreaming = false;

      emitter.once('start', (startMsg: RouteResponseStreamStartMessage) => {
        isStreaming = true;

        // Create async generator for streaming
        async function* streamGenerator(): AsyncGenerator<string> {
          while (true) {
            const value = await new Promise<string | null>((chunkResolve) => {
              emitter.once('chunk', (data: string) => chunkResolve(data));
              emitter.once('end', () => chunkResolve(null));
            });
            if (value === null) break;
            yield value;
          }
        }

        resolve({
          type: 'stream',
          status: startMsg.status,
          headers: startMsg.headers,
          stream: streamGenerator(),
        });
      });

      this.pendingRouteRequests.set(id, {
        resolve: (msg: RouteResponseMessage) => {
          if (!isStreaming) {
            resolve({ type: 'response', data: msg });
          }
        },
        reject,
        streaming: { emitter },
        timer,
      });

      this.sendToChild({
        type: 'route_request',
        id,
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: request.body,
        rawBody: request.rawBody.toString('base64'),
        query: request.query,
      });
    });
  }

  updateConfig(config: Record<string, unknown>): void {
    this.config.decryptedConfig = config;
    if (this.childProcess && !this.childProcess.killed) {
      this.sendToChild({ type: 'config_update', config });
    }
  }

  get isRunning(): boolean {
    return this.childProcess !== null && !this.childProcess.killed;
  }

  getRegisteredRoutes(): string[] {
    return [...this.registeredRoutes];
  }

  // ---- Internal ----

  // Temporary resolve/reject holders for ready and stop_ack
  private _readyResolve: (() => void) | null = null;
  private _readyReject: ((err: Error) => void) | null = null;
  private _stopAckResolve: (() => void) | null = null;

  private sendToChild(msg: ParentToChildMessage): void {
    if (!this.childProcess || this.childProcess.killed) {
      this.log.warn(`Cannot send to child: process not running (msg type: ${msg.type})`);
      return;
    }

    try {
      this.childProcess.send(msg);
    } catch (err) {
      this.log.error(`Failed to send IPC message (type: ${msg.type}):`, err);
    }
  }

  private handleExit(code: number | null, signal: string | null): void {
    this.childProcess = null;
    this.stopHealthCheck();

    if (this.stopping) {
      this.log.info(`Process exited (expected): code=${code}, signal=${signal}`);
      return;
    }

    // Unexpected crash
    this.consecutiveFailures++;
    this.log.error(
      `Process crashed: code=${code}, signal=${signal} (failure ${this.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`
    );

    this.rejectAllPending('Process crashed');
    this.registeredRoutes.clear();

    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      this.log.error(
        `Channel ${this.config.pkg.name} reached max failures (${MAX_CONSECUTIVE_FAILURES}), marking as failed`
      );
      this.config.onStatusChange('failed', `Crashed ${this.consecutiveFailures} times consecutively`);
      return;
    }

    // Schedule restart with exponential backoff
    const delay = Math.min(1000 * 2 ** (this.consecutiveFailures - 1), MAX_BACKOFF_MS);
    this.log.info(`Scheduling restart in ${delay}ms`);
    this.config.onStatusChange('error', `Crashed, restarting in ${Math.round(delay / 1000)}s`);

    this.restartTimer = setTimeout(async () => {
      this.restartTimer = null;
      if (this.stopping) return;

      try {
        this.config.onStatusChange('starting');
        await this.start();
        this.config.onStatusChange('connected');
      } catch (err) {
        this.log.error(`Restart failed:`, err);
        this.config.onStatusChange('error', err instanceof Error ? err.message : String(err));
        // handleExit will be called again from the failed process
      }
    }, delay);
  }

  private startHealthCheck(): void {
    this.stopHealthCheck();

    this.healthCheckTimer = setInterval(() => {
      if (!this.childProcess || this.childProcess.killed) return;

      const id = generateCorrelationId();
      const timer = setTimeout(() => {
        this.log.error('Ping timeout - killing unresponsive process');
        this.pendingPing = null;
        if (this.childProcess && !this.childProcess.killed) {
          this.childProcess.kill('SIGKILL');
        }
      }, PING_TIMEOUT_MS);

      this.pendingPing = { id, timer };
      this.sendToChild({ type: 'ping', id });
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    if (this.pendingPing) {
      clearTimeout(this.pendingPing.timer);
      this.pendingPing = null;
    }
  }

  private rejectAllPending(reason: string): void {
    const error = new Error(reason);

    for (const [id, pending] of this.pendingSendRequests) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingSendRequests.clear();

    for (const [id, pending] of this.pendingActionRequests) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingActionRequests.clear();

    for (const [id, pending] of this.pendingRouteRequests) {
      clearTimeout(pending.timer);
      if (pending.streaming) {
        pending.streaming.emitter.removeAllListeners();
      }
      pending.reject(error);
    }
    this.pendingRouteRequests.clear();
  }
}
