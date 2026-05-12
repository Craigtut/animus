/**
 * IPC Protocol — typed message interfaces for parent <-> child process communication.
 *
 * This file defines interfaces only (no runtime backend dependencies).
 * Both parent process and child process code can import these types.
 */

// ============================================================================
// Main -> Child Messages
// ============================================================================

export interface InitMessage {
  type: 'init';
  config: Record<string, unknown>;
  channelType: string;
}

export interface SendMessage {
  type: 'send';
  id: string;
  contactId: string;
  content: string;
  replyTo?: string;
  metadata?: Record<string, unknown>;
  media?: Array<{
    type: 'image' | 'audio' | 'video' | 'file';
    path: string;
    mimeType: string;
    filename?: string;
    /** File contents as base64 — avoids child process needing fs read permission */
    data: string;
  }>;
}

export interface StopMessage {
  type: 'stop';
}

export interface RouteRequestMessage {
  type: 'route_request';
  id: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  rawBody: string; // base64 encoded
  query: Record<string, string>;
}

export interface ResolveContactResponseMessage {
  type: 'resolve_contact_response';
  id: string;
  result: { identifier: string; displayName?: string } | null;
}

export interface MediaDownloadResponseMessage {
  type: 'media_download_response';
  id: string;
  localPath?: string;
  sizeBytes?: number;
  error?: string;
}

// Speech IPC — responses from parent to child

export interface SpeechTranscribeResponseMessage {
  type: 'speech_transcribe_response';
  id: string;
  text?: string;
  error?: string;
}

export interface SpeechSynthesizeResponseMessage {
  type: 'speech_synthesize_response';
  id: string;
  audioBase64?: string;
  sampleRate?: number;
  error?: string;
}

export interface SpeechStatusResponseMessage {
  type: 'speech_status_response';
  id: string;
  sttAvailable: boolean;
  ttsAvailable: boolean;
  ffmpegAvailable: boolean;
  voiceCount: number;
}

export interface SpeechVoicesResponseMessage {
  type: 'speech_voices_response';
  id: string;
  voices?: Array<{ id: string; name: string; type: string; description?: string }>;
  error?: string;
}

export interface ConfigUpdateMessage {
  type: 'config_update';
  config: Record<string, unknown>;
}

export interface ConfigUpdateResponseMessage {
  type: 'config_update_response';
  id: string;
  error?: string;
}

export interface ActionMessage {
  type: 'action';
  id: string;
  action: { type: string; [key: string]: unknown };
}

export interface PingMessage {
  type: 'ping';
  id: string;
}

export interface GetHistoryMessage {
  type: 'get_history';
  id: string;
  conversationId: string;
  limit?: number;
  before?: string;
}

export type ParentToChildMessage =
  | InitMessage
  | SendMessage
  | StopMessage
  | RouteRequestMessage
  | ResolveContactResponseMessage
  | MediaDownloadResponseMessage
  | SpeechTranscribeResponseMessage
  | SpeechSynthesizeResponseMessage
  | SpeechStatusResponseMessage
  | SpeechVoicesResponseMessage
  | ConfigUpdateResponseMessage
  | ConfigUpdateMessage
  | ActionMessage
  | PingMessage
  | GetHistoryMessage;

// ============================================================================
// Child -> Main Messages
// ============================================================================

export interface ReadyMessage {
  type: 'ready';
}

export interface IncomingMessage {
  type: 'incoming';
  identifier: string;
  content: string;
  conversationId?: string;
  conversationType?: 'owned' | 'participated';
  media?: Array<{
    type: 'image' | 'audio' | 'video' | 'file';
    mimeType: string;
    url: string;
    filename?: string;
  }>;
  metadata?: Record<string, unknown>;
  participant?: { displayName: string; avatarUrl?: string; isBot: boolean };
}

export interface SendResponseMessage {
  type: 'send_response';
  id: string;
  ok: boolean;
  error?: string;
  externalId?: string;
  attempts?: number;
}

export interface RouteResponseMessage {
  type: 'route_response';
  id: string;
  status: number;
  headers?: Record<string, string>;
  body: unknown;
}

export interface RouteResponseStreamStartMessage {
  type: 'route_response_stream_start';
  id: string;
  status: number;
  headers: Record<string, string>;
}

export interface RouteResponseChunkMessage {
  type: 'route_response_chunk';
  id: string;
  data: string;
}

export interface RouteResponseEndMessage {
  type: 'route_response_end';
  id: string;
}

export interface ResolveContactMessage {
  type: 'resolve_contact';
  id: string;
  contactId: string;
}

export interface MediaDownloadMessage {
  type: 'media_download';
  id: string;
  url: string;
  mimeType: string;
  filename?: string;
  auth?: { type: 'basic'; username: string; password: string } | { type: 'bearer'; token: string };
}

export interface LogMessage {
  type: 'log';
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  args: unknown[];
}

export interface RouteRegisterMessage {
  type: 'route_register';
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
  stack?: string;
}

export interface StopAckMessage {
  type: 'stop_ack';
}

export interface ActionResponseMessage {
  type: 'action_response';
  id: string;
  ok: boolean;
  error?: string;
}

export interface PongMessage {
  type: 'pong';
  id: string;
}

export interface PresenceUpdateMessage {
  type: 'presence_update';
  identifier: string;
  status: 'online' | 'idle' | 'dnd' | 'offline';
  statusText?: string;
  activity?: string;
}

// Speech IPC — requests from child to parent

export interface SpeechTranscribeMessage {
  type: 'speech_transcribe';
  id: string;
  audioBase64: string;
  sampleRate?: number;
}

export interface SpeechSynthesizeMessage {
  type: 'speech_synthesize';
  id: string;
  text: string;
  voiceId?: string;
  speed?: number;
}

export interface SpeechStatusMessage {
  type: 'speech_status';
  id: string;
}

export interface SpeechVoicesMessage {
  type: 'speech_voices';
  id: string;
}

export interface ConfigUpdateRequestMessage {
  type: 'config_update_request';
  id: string;
  updates: Record<string, unknown>;
}

export interface HistoryResponseMessage {
  type: 'history_response';
  id: string;
  ok: boolean;
  messages?: Array<{
    author: { identifier: string; displayName: string; isBot: boolean };
    content: string;
    timestamp: string;
    threadTs?: string;
    reactions?: Array<{ name: string; count: number }>;
    attachments?: Array<{ type: string; url: string; filename?: string }>;
  }>;
  error?: string;
}

export type ChildToParentMessage =
  | ReadyMessage
  | IncomingMessage
  | SendResponseMessage
  | RouteResponseMessage
  | RouteResponseStreamStartMessage
  | RouteResponseChunkMessage
  | RouteResponseEndMessage
  | ResolveContactMessage
  | MediaDownloadMessage
  | SpeechTranscribeMessage
  | SpeechSynthesizeMessage
  | SpeechStatusMessage
  | SpeechVoicesMessage
  | ConfigUpdateRequestMessage
  | LogMessage
  | RouteRegisterMessage
  | ErrorMessage
  | StopAckMessage
  | ActionResponseMessage
  | PongMessage
  | PresenceUpdateMessage
  | HistoryResponseMessage;

export type IpcMessage = ParentToChildMessage | ChildToParentMessage;

// ============================================================================
// Utilities
// ============================================================================

let correlationCounter = 0;

export function generateCorrelationId(): string {
  return `ipc-${Date.now()}-${++correlationCounter}`;
}
