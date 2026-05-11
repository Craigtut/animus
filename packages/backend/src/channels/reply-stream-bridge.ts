import type { ServerResponse } from 'node:http';
import type { IEventBus, AnimusEventMap } from '@animus-labs/shared';
import { createLogger } from '../lib/logger.js';

const log = createLogger('ReplyStreamBridge', 'channels');

const STREAM_TIMEOUT_MS = 300_000; // 5 minutes

const OPEN_TAG = '<working>';
const CLOSE_TAG = '</working>';

function writeSseEvent(raw: ServerResponse, data: Record<string, unknown>): void {
  if (raw.writableEnded) return;
  raw.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * Streaming filter that strips <working>...</working> tags from a token stream.
 *
 * Tokens arrive as small chunks that may split tags across boundaries.
 * The filter buffers partial tag matches and suppresses content between tags.
 */
export class WorkingTagFilter {
  private inside = false;
  private buffer = '';

  process(chunk: string): string {
    let output = '';
    this.buffer += chunk;

    while (this.buffer.length > 0) {
      if (this.inside) {
        const closeIdx = this.buffer.indexOf(CLOSE_TAG);
        if (closeIdx !== -1) {
          this.buffer = this.buffer.slice(closeIdx + CLOSE_TAG.length);
          this.inside = false;
          continue;
        }
        if (this.buffer.length >= CLOSE_TAG.length) {
          // Keep only enough buffer to detect a partial close tag at the end
          const keep = CLOSE_TAG.length - 1;
          this.buffer = this.buffer.slice(-keep);
        }
        break;
      }

      const openIdx = this.buffer.indexOf(OPEN_TAG);
      if (openIdx !== -1) {
        output += this.buffer.slice(0, openIdx);
        this.buffer = this.buffer.slice(openIdx + OPEN_TAG.length);
        this.inside = true;
        continue;
      }

      // Check if the buffer ends with a partial match for <working>
      const partialLen = this.partialTagMatch(this.buffer);
      if (partialLen > 0) {
        output += this.buffer.slice(0, -partialLen);
        this.buffer = this.buffer.slice(-partialLen);
        break;
      }

      output += this.buffer;
      this.buffer = '';
    }

    return output;
  }

  flush(): string {
    if (this.inside) {
      this.buffer = '';
      return '';
    }
    const remaining = this.buffer;
    this.buffer = '';
    return remaining;
  }

  private partialTagMatch(text: string): number {
    for (let len = Math.min(text.length, OPEN_TAG.length - 1); len > 0; len--) {
      if (text.endsWith(OPEN_TAG.slice(0, len))) {
        return len;
      }
    }
    return 0;
  }
}

/**
 * Match function: returns true if an event belongs to this bridge.
 *
 * When requestId is available, we match on that (unique per HTTP request).
 * Otherwise fall back to channel-only matching (legacy/web channel).
 */
function eventMatchesBridge(
  eventChannel: string,
  eventRequestId: string | undefined,
  bridgeChannel: string,
  bridgeRequestId: string | undefined,
): boolean {
  if (bridgeRequestId) {
    return eventRequestId === bridgeRequestId;
  }
  return eventChannel === bridgeChannel;
}

/**
 * Bridge EventBus reply events to an HTTP SSE response.
 *
 * Subscribes to reply:chunk, reply:turn_complete, and reply:complete events
 * filtered by requestId (when available) or channel type (fallback).
 * Strips <working> tags from the token stream so voice output is clean.
 * Cleans up on completion, client disconnect, or timeout.
 *
 * The tick_end event is NOT used for cleanup. Previous versions closed the
 * stream on any tick_end, which caused cross-talk when a follow-up message
 * opened a new stream while the previous tick was still in reflect/execute.
 * Instead, reply:complete handles normal cleanup (fires in both success and
 * error paths of the agentic loop), and the timeout handles crash cases.
 */
export function bridgeReplyStream(
  raw: ServerResponse,
  channel: string,
  eventBus: IEventBus,
  requestId?: string,
): void {
  let closed = false;
  const tagFilter = new WorkingTagFilter();

  function cleanup(): void {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    eventBus.off('reply:chunk', onChunk);
    eventBus.off('reply:turn_complete', onTurnComplete);
    eventBus.off('reply:complete', onComplete);
    if (!raw.writableEnded) {
      raw.end();
    }
  }

  const onChunk = (data: AnimusEventMap['reply:chunk']): void => {
    if (!eventMatchesBridge(data.channel, data.requestId, channel, requestId)) return;
    const filtered = tagFilter.process(data.content);
    if (filtered) {
      writeSseEvent(raw, { type: 'token', content: filtered });
    }
  };

  const onTurnComplete = (data: AnimusEventMap['reply:turn_complete']): void => {
    if (!eventMatchesBridge(data.channel, data.requestId, channel, requestId)) return;
    const flushed = tagFilter.flush();
    if (flushed) {
      writeSseEvent(raw, { type: 'token', content: flushed });
    }
    writeSseEvent(raw, {
      type: 'turn_complete',
      turn_index: data.turnIndex,
      content: data.content,
    });
  };

  const onComplete = (data: AnimusEventMap['reply:complete']): void => {
    if (!eventMatchesBridge(data.channel, data.requestId, channel, requestId)) return;
    writeSseEvent(raw, { type: 'done' });
    log.info(`Reply stream complete for channel "${channel}" (${data.totalTurns} turns${requestId ? `, req=${requestId}` : ''})`);
    cleanup();
  };

  const timer = setTimeout(() => {
    if (closed) return;
    log.warn(`Reply stream timeout for channel "${channel}" (${STREAM_TIMEOUT_MS}ms${requestId ? `, req=${requestId}` : ''})`);
    writeSseEvent(raw, { type: 'error', error: 'Stream timeout' });
    cleanup();
  }, STREAM_TIMEOUT_MS);

  raw.on('close', () => {
    if (closed) return;
    log.debug(`Reply stream client disconnected for channel "${channel}"${requestId ? ` (req=${requestId})` : ''}`);
    cleanup();
  });

  raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  writeSseEvent(raw, { type: 'connected' });

  eventBus.on('reply:chunk', onChunk);
  eventBus.on('reply:turn_complete', onTurnComplete);
  eventBus.on('reply:complete', onComplete);

  log.info(`Reply stream started for channel "${channel}"${requestId ? ` (req=${requestId})` : ''}`);
}
