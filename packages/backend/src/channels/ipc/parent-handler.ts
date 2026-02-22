/**
 * Parent Handler — processes IPC messages from child channel processes.
 *
 * Creates a handler function bound to a specific channel's callbacks.
 * Used by ChannelProcessHost to route incoming child messages.
 */

import { createLogger } from '../../lib/logger.js';
import type {
  ChildToParentMessage,
  IncomingMessage,
  SendResponseMessage,
  ActionResponseMessage,
  RouteResponseMessage,
  RouteResponseStreamStartMessage,
  RouteResponseChunkMessage,
  RouteResponseEndMessage,
  ResolveContactMessage,
  MediaDownloadMessage,
  RouteRegisterMessage,
  ErrorMessage,
  PongMessage,
  PresenceUpdateMessage,
} from './protocol.js';

export interface ParentHandlerDeps {
  channelType: string;
  channelName: string;
  onReady: () => void;
  onIncoming: (msg: IncomingMessage) => void;
  onSendResponse: (msg: SendResponseMessage) => void;
  onRouteResponse: (msg: RouteResponseMessage) => void;
  onRouteStreamStart: (msg: RouteResponseStreamStartMessage) => void;
  onRouteStreamChunk: (msg: RouteResponseChunkMessage) => void;
  onRouteStreamEnd: (msg: RouteResponseEndMessage) => void;
  onResolveContact: (msg: ResolveContactMessage) => void;
  onMediaDownload: (msg: MediaDownloadMessage) => void;
  onRouteRegister: (msg: RouteRegisterMessage) => void;
  onActionResponse: (msg: ActionResponseMessage) => void;
  onPresenceUpdate: (msg: PresenceUpdateMessage) => void;
  onError: (msg: ErrorMessage) => void;
  onStopAck: () => void;
  onPong: (msg: PongMessage) => void;
}

export function createParentHandler(deps: ParentHandlerDeps): (raw: unknown) => void {
  const log = createLogger(`IPC:${deps.channelName}`, 'channels');

  return (raw: unknown) => {
    if (typeof raw !== 'object' || raw === null || !('type' in raw)) {
      log.warn('Received invalid IPC message (not an object with type):', raw);
      return;
    }

    const msg = raw as ChildToParentMessage;

    switch (msg.type) {
      case 'ready':
        log.debug('Child process ready');
        deps.onReady();
        break;

      case 'incoming':
        log.debug(`Incoming message from ${msg.identifier}`);
        deps.onIncoming(msg);
        break;

      case 'send_response':
        log.debug(`Send response [${msg.id}]: ${msg.ok ? 'ok' : msg.error}`);
        deps.onSendResponse(msg);
        break;

      case 'route_response':
        log.debug(`Route response [${msg.id}]: ${msg.status}`);
        deps.onRouteResponse(msg);
        break;

      case 'route_response_stream_start':
        log.debug(`Route stream start [${msg.id}]: ${msg.status}`);
        deps.onRouteStreamStart(msg);
        break;

      case 'route_response_chunk':
        deps.onRouteStreamChunk(msg);
        break;

      case 'route_response_end':
        log.debug(`Route stream end [${msg.id}]`);
        deps.onRouteStreamEnd(msg);
        break;

      case 'resolve_contact':
        log.debug(`Resolve contact request [${msg.id}]: ${msg.contactId}`);
        deps.onResolveContact(msg);
        break;

      case 'media_download':
        log.debug(`Media download request [${msg.id}]: ${msg.url}`);
        deps.onMediaDownload(msg);
        break;

      case 'log':
        if (msg.level === 'info') {
          log.debug(`[child] ${msg.message}`, ...msg.args);
        } else {
          log[msg.level](`[child] ${msg.message}`, ...msg.args);
        }
        break;

      case 'route_register':
        log.debug(`Route registered: ${msg.method} ${msg.path}`);
        deps.onRouteRegister(msg);
        break;

      case 'action_response':
        log.debug(`Action response [${msg.id}]: ${msg.ok ? 'ok' : msg.error}`);
        deps.onActionResponse(msg);
        break;

      case 'presence_update':
        log.debug(`Presence update: ${msg.identifier} → ${msg.status}`);
        deps.onPresenceUpdate(msg);
        break;

      case 'error':
        log.error(`Child error: ${msg.message}`, msg.stack ?? '');
        deps.onError(msg);
        break;

      case 'stop_ack':
        log.debug('Stop acknowledged');
        deps.onStopAck();
        break;

      case 'pong':
        log.debug(`Pong [${msg.id}]`);
        deps.onPong(msg);
        break;

      default:
        log.warn(`Unknown IPC message type: ${(msg as Record<string, unknown>)['type']}`);
        break;
    }
  };
}
