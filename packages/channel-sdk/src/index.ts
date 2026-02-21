/**
 * @animus/channel-sdk — Public types for channel adapter authors.
 *
 * Channel packages import these types to implement the ChannelAdapter interface.
 * Since adapters only use `import type`, the SDK is erased at compile time
 * and the compiled adapter.js has zero runtime dependencies on this package.
 */

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
    media?: Array<{ type: 'image' | 'audio' | 'video' | 'file'; mimeType: string; url: string; filename?: string }>;
    metadata?: Record<string, unknown>;
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

export interface ChannelAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  send(contactId: string, content: string, metadata?: Record<string, unknown>): Promise<void>;
  performAction?(action: ChannelAction): Promise<void>;
}

export type CreateAdapterFn = (ctx: AdapterContext) => ChannelAdapter;
