/**
 * Adapter Context — child process bootstrapper for channel packages.
 *
 * This file runs in an isolated child process. It:
 * 1. Waits for an 'init' message from the parent
 * 2. Creates the AdapterContext SDK
 * 3. Dynamically imports the adapter module
 * 4. Calls createAdapter(ctx) and adapter.start()
 * 5. Sends 'ready' back to the parent
 * 6. Routes subsequent parent messages to the adapter
 *
 * IMPORTANT: This file MUST NOT import any backend internals (database, logger, etc.).
 * It only uses Node.js built-ins and the IPC protocol types.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';

// ============================================================================
// IPC Protocol Types (inline to avoid import path issues in child process)
// The child process may not have access to the backend package's module
// resolution, so we define the minimal interfaces inline.
// ============================================================================

interface InitMessage {
  type: 'init';
  config: Record<string, unknown>;
  channelType: string;
}

interface SendMessage {
  type: 'send';
  id: string;
  contactId: string;
  content: string;
  metadata?: Record<string, unknown>;
  media?: Array<{
    type: 'image' | 'audio' | 'video' | 'file';
    path: string;
    mimeType: string;
    filename?: string;
    data: string;
  }>;
}

interface RouteRequestMessage {
  type: 'route_request';
  id: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  rawBody: string; // base64
  query: Record<string, string>;
}

interface ResolveContactResponseMessage {
  type: 'resolve_contact_response';
  id: string;
  result: { identifier: string; displayName?: string } | null;
}

interface MediaDownloadResponseMessage {
  type: 'media_download_response';
  id: string;
  localPath?: string;
  sizeBytes?: number;
  error?: string;
}

interface ConfigUpdateMessage {
  type: 'config_update';
  config: Record<string, unknown>;
}

interface ActionMessage {
  type: 'action';
  id: string;
  action: { type: string; [key: string]: unknown };
}

interface PingMessage {
  type: 'ping';
  id: string;
}

interface GetHistoryMessage {
  type: 'get_history';
  id: string;
  conversationId: string;
  limit?: number;
  before?: string;
}

interface StopMessage {
  type: 'stop';
}

type ParentMessage =
  | InitMessage
  | SendMessage
  | StopMessage
  | RouteRequestMessage
  | ResolveContactResponseMessage
  | MediaDownloadResponseMessage
  | ConfigUpdateMessage
  | ActionMessage
  | PingMessage
  | GetHistoryMessage;

// ============================================================================
// AdapterContext public types (exposed to adapter authors)
// ============================================================================

export interface RouteRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  rawBody: Buffer;
  query: Record<string, string>;
}

export interface RouteResponse {
  status: number;
  headers?: Record<string, string>;
  body: string | object;
}

export interface StreamingRouteResponse {
  status: number;
  headers: Record<string, string>;
  stream: AsyncIterable<string>;
}

export interface AdapterContext {
  readonly config: Readonly<Record<string, unknown>>;
  readonly channelType: string;
  readonly log: {
    info(msg: string, ...args: unknown[]): void;
    warn(msg: string, ...args: unknown[]): void;
    error(msg: string, ...args: unknown[]): void;
    debug(msg: string, ...args: unknown[]): void;
  };
  reportIncoming(params: {
    identifier: string;
    content: string;
    conversationId?: string;
    conversationType?: 'owned' | 'participated';
    media?: Array<{ type: 'image' | 'audio' | 'video' | 'file'; mimeType: string; url: string; filename?: string }>;
    metadata?: Record<string, unknown>;
    participant?: { displayName: string; avatarUrl?: string; isBot: boolean };
  }): void;
  resolveContact(contactId: string): Promise<{ identifier: string; displayName?: string } | null>;
  registerRoute(config: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    path: string;
    handler: (request: RouteRequest) => Promise<RouteResponse | StreamingRouteResponse>;
  }): void;
  downloadMedia(params: {
    url: string;
    mimeType: string;
    filename?: string;
    auth?: { type: 'basic'; username: string; password: string } | { type: 'bearer'; token: string };
  }): Promise<{ localPath: string; sizeBytes: number }>;
  reportPresence(params: {
    identifier: string;
    status: 'online' | 'idle' | 'dnd' | 'offline';
    statusText?: string;
    activity?: string;
  }): void;
}

export interface ChannelAction {
  type: string;
  [key: string]: unknown;
}

export interface ExternalMessage {
  author: {
    identifier: string;
    displayName: string;
    isBot: boolean;
  };
  content: string;
  timestamp: string;
  threadTs?: string;
  reactions?: Array<{ name: string; count: number }>;
  attachments?: Array<{ type: string; url: string; filename?: string }>;
}

export interface ChannelAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  send(contactId: string, content: string, metadata?: Record<string, unknown>): Promise<void>;
  performAction?(action: ChannelAction): Promise<void>;
  getHistory?(params: {
    conversationId: string;
    limit?: number;
    before?: string;
  }): Promise<ExternalMessage[]>;
}

export type CreateAdapterFn = (ctx: AdapterContext) => ChannelAdapter;

// ============================================================================
// IPC send helper
// ============================================================================

function sendToParent(msg: Record<string, unknown>): void {
  if (process.send) {
    process.send(msg);
  }
}

// ============================================================================
// Correlation ID helpers
// ============================================================================

let correlationCounter = 0;

function generateCorrelationId(): string {
  return `child-${Date.now()}-${++correlationCounter}`;
}

// ============================================================================
// Bootstrapper
// ============================================================================

// Pending resolve_contact and media_download requests
const pendingResolveContact = new Map<string, {
  resolve: (result: { identifier: string; displayName?: string } | null) => void;
  reject: (err: Error) => void;
}>();

const pendingMediaDownload = new Map<string, {
  resolve: (result: { localPath: string; sizeBytes: number }) => void;
  reject: (err: Error) => void;
}>();

// Route handlers registered by the adapter
const routeHandlers = new Map<string, (request: RouteRequest) => Promise<RouteResponse | StreamingRouteResponse>>();

function routeKey(method: string, routePath: string): string {
  return `${method.toUpperCase()} ${routePath}`;
}

let currentConfig: Record<string, unknown> = {};
let currentChannelType = '';
let adapter: ChannelAdapter | null = null;

function createAdapterContext(): AdapterContext {
  const log = {
    info: (msg: string, ...args: unknown[]) => sendToParent({ type: 'log', level: 'info', message: msg, args }),
    warn: (msg: string, ...args: unknown[]) => sendToParent({ type: 'log', level: 'warn', message: msg, args }),
    error: (msg: string, ...args: unknown[]) => sendToParent({ type: 'log', level: 'error', message: msg, args }),
    debug: (msg: string, ...args: unknown[]) => sendToParent({ type: 'log', level: 'debug', message: msg, args }),
  };

  return {
    get config() {
      return currentConfig;
    },
    get channelType() {
      return currentChannelType;
    },
    log,

    reportIncoming(params) {
      sendToParent({
        type: 'incoming',
        identifier: params.identifier,
        content: params.content,
        conversationId: params.conversationId,
        conversationType: params.conversationType,
        media: params.media,
        metadata: params.metadata,
        participant: params.participant,
      });
    },

    resolveContact(contactId: string): Promise<{ identifier: string; displayName?: string } | null> {
      return new Promise((resolve, reject) => {
        const id = generateCorrelationId();
        const timer = setTimeout(() => {
          pendingResolveContact.delete(id);
          reject(new Error(`resolveContact timeout for ${contactId}`));
        }, 15_000);
        pendingResolveContact.set(id, {
          resolve: (result) => {
            clearTimeout(timer);
            pendingResolveContact.delete(id);
            resolve(result);
          },
          reject: (err) => {
            clearTimeout(timer);
            pendingResolveContact.delete(id);
            reject(err);
          },
        });
        sendToParent({ type: 'resolve_contact', id, contactId });
      });
    },

    registerRoute(config) {
      const key = routeKey(config.method, config.path);
      routeHandlers.set(key, config.handler);
      sendToParent({ type: 'route_register', method: config.method, path: config.path });
    },

    downloadMedia(params): Promise<{ localPath: string; sizeBytes: number }> {
      return new Promise((resolve, reject) => {
        const id = generateCorrelationId();
        const timer = setTimeout(() => {
          pendingMediaDownload.delete(id);
          reject(new Error(`downloadMedia timeout for ${params.url}`));
        }, 60_000);
        pendingMediaDownload.set(id, {
          resolve: (result) => {
            clearTimeout(timer);
            pendingMediaDownload.delete(id);
            resolve(result);
          },
          reject: (err) => {
            clearTimeout(timer);
            pendingMediaDownload.delete(id);
            reject(err);
          },
        });
        sendToParent({
          type: 'media_download',
          id,
          url: params.url,
          mimeType: params.mimeType,
          filename: params.filename,
          auth: params.auth,
        });
      });
    },

    reportPresence(params) {
      sendToParent({
        type: 'presence_update',
        identifier: params.identifier,
        status: params.status,
        statusText: params.statusText,
        activity: params.activity,
      });
    },
  };
}

async function handleRouteRequest(msg: RouteRequestMessage): Promise<void> {
  const key = routeKey(msg.method, msg.url.split('?')[0]!);
  const handler = routeHandlers.get(key);

  if (!handler) {
    sendToParent({
      type: 'route_response',
      id: msg.id,
      status: 404,
      body: { error: 'No handler registered for this route' },
    });
    return;
  }

  try {
    const request: RouteRequest = {
      method: msg.method,
      url: msg.url,
      headers: msg.headers,
      body: msg.body,
      rawBody: Buffer.from(msg.rawBody, 'base64'),
      query: msg.query,
    };

    const response = await handler(request);

    if ('stream' in response) {
      // Streaming response
      sendToParent({
        type: 'route_response_stream_start',
        id: msg.id,
        status: response.status,
        headers: response.headers,
      });

      try {
        for await (const chunk of response.stream) {
          sendToParent({ type: 'route_response_chunk', id: msg.id, data: chunk });
        }
      } finally {
        sendToParent({ type: 'route_response_end', id: msg.id });
      }
    } else {
      // Non-streaming response
      sendToParent({
        type: 'route_response',
        id: msg.id,
        status: response.status,
        headers: response.headers,
        body: response.body,
      });
    }
  } catch (err) {
    sendToParent({
      type: 'route_response',
      id: msg.id,
      status: 500,
      body: { error: err instanceof Error ? err.message : String(err) },
    });
  }
}

function handleParentMessage(raw: unknown): void {
  if (typeof raw !== 'object' || raw === null || !('type' in raw)) return;

  const msg = raw as ParentMessage;

  switch (msg.type) {
    case 'send': {
      if (!adapter) {
        sendToParent({ type: 'send_response', id: msg.id, ok: false, error: 'Adapter not initialized' });
        return;
      }
      // Merge media into metadata so adapters receive it via the existing send() signature
      const sendMetadata = msg.media
        ? { ...msg.metadata, media: msg.media }
        : msg.metadata;
      adapter
        .send(msg.contactId, msg.content, sendMetadata)
        .then(() => sendToParent({ type: 'send_response', id: msg.id, ok: true }))
        .catch((err: unknown) =>
          sendToParent({
            type: 'send_response',
            id: msg.id,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          })
        );
      break;
    }

    case 'route_request':
      handleRouteRequest(msg).catch((err: unknown) => {
        sendToParent({
          type: 'error',
          message: `Route request handler failed: ${err instanceof Error ? err.message : String(err)}`,
          stack: err instanceof Error ? err.stack : undefined,
        });
      });
      break;

    case 'resolve_contact_response': {
      const pending = pendingResolveContact.get(msg.id);
      if (pending) {
        pending.resolve(msg.result);
      }
      break;
    }

    case 'media_download_response': {
      const pending = pendingMediaDownload.get(msg.id);
      if (pending) {
        if (msg.error) {
          pending.reject(new Error(msg.error));
        } else if (msg.localPath != null && msg.sizeBytes != null) {
          pending.resolve({ localPath: msg.localPath, sizeBytes: msg.sizeBytes });
        } else {
          pending.reject(new Error('Invalid media download response'));
        }
      }
      break;
    }

    case 'config_update':
      currentConfig = { ...msg.config };
      break;

    case 'stop': {
      const doStop = async () => {
        try {
          if (adapter) {
            await adapter.stop();
          }
        } catch (err) {
          sendToParent({
            type: 'error',
            message: `Stop failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        } finally {
          sendToParent({ type: 'stop_ack' });
        }
      };
      doStop().catch(() => {
        // Already handled in doStop
      });
      break;
    }

    case 'action': {
      if (adapter && typeof adapter.performAction === 'function') {
        adapter
          .performAction(msg.action)
          .then(() => sendToParent({ type: 'action_response', id: msg.id, ok: true }))
          .catch((err: unknown) =>
            sendToParent({
              type: 'action_response',
              id: msg.id,
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            })
          );
      } else {
        // Adapter doesn't implement performAction — silent no-op
        sendToParent({ type: 'action_response', id: msg.id, ok: true });
      }
      break;
    }

    case 'get_history': {
      if (adapter && typeof adapter.getHistory === 'function') {
        adapter
          .getHistory({
            conversationId: msg.conversationId,
            ...(msg.limit !== undefined && { limit: msg.limit }),
            ...(msg.before !== undefined && { before: msg.before }),
          })
          .then((messages) =>
            sendToParent({ type: 'history_response', id: msg.id, ok: true, messages })
          )
          .catch((err: unknown) =>
            sendToParent({
              type: 'history_response',
              id: msg.id,
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            })
          );
      } else {
        sendToParent({
          type: 'history_response',
          id: msg.id,
          ok: false,
          error: 'Adapter does not implement getHistory',
        });
      }
      break;
    }

    case 'ping':
      sendToParent({ type: 'pong', id: msg.id });
      break;

    case 'init':
      // Should not receive init after bootstrap — ignore
      break;
  }
}

async function bootstrap(): Promise<void> {
  // The package path is passed as argv[2]
  const pkgPath = process.argv[2];
  if (!pkgPath) {
    sendToParent({ type: 'error', message: 'No package path provided (expected argv[2])' });
    process.exit(1);
  }

  // Wait for init message
  const initMsg = await new Promise<InitMessage>((resolve) => {
    const onMessage = (raw: unknown) => {
      if (typeof raw === 'object' && raw !== null && (raw as Record<string, unknown>)['type'] === 'init') {
        process.off('message', onMessage);
        resolve(raw as InitMessage);
      }
    };
    process.on('message', onMessage);
  });

  currentConfig = { ...initMsg.config };
  currentChannelType = initMsg.channelType;

  // Create the adapter context SDK
  const ctx = createAdapterContext();

  // Load the channel manifest to find the adapter entry point
  // Supports both channel.json (local dev) and manifest.json (.anpk package installs)
  const { readFileSync, existsSync } = await import('node:fs');
  const channelJsonPath = path.join(pkgPath, 'channel.json');
  const manifestJsonPath = path.join(pkgPath, 'manifest.json');
  const manifestFilePath = existsSync(channelJsonPath) ? channelJsonPath : manifestJsonPath;
  const manifestRaw = JSON.parse(readFileSync(manifestFilePath, 'utf-8')) as Record<string, unknown>;
  const adapterRelPath = manifestRaw['adapter'] as string;
  const adapterAbsPath = path.resolve(pkgPath, adapterRelPath);

  // Dynamically import the adapter module
  const adapterUrl = pathToFileURL(adapterAbsPath).href;
  const adapterModule = (await import(adapterUrl)) as { createAdapter?: CreateAdapterFn; default?: CreateAdapterFn };
  const createAdapter = adapterModule.createAdapter ?? adapterModule.default;

  if (typeof createAdapter !== 'function') {
    sendToParent({ type: 'error', message: 'Adapter module does not export createAdapter or default function' });
    process.exit(1);
  }

  adapter = createAdapter(ctx);

  // Start the adapter
  await adapter.start();

  // Listen for further messages from parent
  process.on('message', handleParentMessage);

  // Signal ready
  sendToParent({ type: 'ready' });
}

// Exit when parent process dies (e.g. tsx watch restart).
// Without this, child processes become orphans that stay connected to
// external services (Slack Socket Mode, Discord gateway, etc.), stealing
// events from the new child that the restarted server forks.
process.on('disconnect', () => {
  if (adapter) {
    // Best-effort cleanup; don't block exit
    Promise.resolve(adapter.stop?.()).catch(() => {}).finally(() => process.exit(0));
    // Force exit after 3s if adapter.stop() hangs
    setTimeout(() => process.exit(0), 3000).unref();
  } else {
    process.exit(0);
  }
});

// Set up global error handlers
process.on('uncaughtException', (err) => {
  sendToParent({
    type: 'error',
    message: `Uncaught exception: ${err.message}`,
    stack: err.stack,
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  sendToParent({ type: 'error', message: `Unhandled rejection: ${msg}`, stack });
});

// Run the bootstrapper
bootstrap().catch((err) => {
  sendToParent({
    type: 'error',
    message: `Bootstrap failed: ${err instanceof Error ? err.message : String(err)}`,
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(1);
});
