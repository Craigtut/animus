import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import type { ServerResponse } from 'node:http';
import type { IEventBus, AnimusEventMap } from '@animus-labs/shared';
import { bridgeReplyStream, WorkingTagFilter } from '../../src/channels/reply-stream-bridge.js';

function createMockRaw(): ServerResponse & { chunks: string[] } {
  const emitter = new EventEmitter();
  const chunks: string[] = [];
  return Object.assign(emitter, {
    chunks,
    writableEnded: false,
    writeHead: vi.fn(),
    write: vi.fn((data: string) => { chunks.push(data); return true; }),
    end: vi.fn(function (this: any) { this.writableEnded = true; }),
  }) as unknown as ServerResponse & { chunks: string[] };
}

function createMockEventBus(): IEventBus {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(50);
  return {
    on: (event: string, listener: any) => emitter.on(event, listener),
    off: (event: string, listener: any) => emitter.off(event, listener),
    emit: (event: string, payload: any) => emitter.emit(event, payload),
    once: (event: string, listener: any) => emitter.once(event, listener),
  } as unknown as IEventBus;
}

function parseSseEvents(chunks: string[]): Record<string, unknown>[] {
  return chunks
    .join('')
    .split('\n\n')
    .filter(Boolean)
    .map(line => JSON.parse(line.replace('data: ', '')));
}

describe('bridgeReplyStream', () => {
  let raw: ReturnType<typeof createMockRaw>;
  let eventBus: IEventBus;

  beforeEach(() => {
    vi.useFakeTimers();
    raw = createMockRaw();
    eventBus = createMockEventBus();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes SSE headers and connected event on start', () => {
    bridgeReplyStream(raw, 'home-assistant', eventBus);

    expect(raw.writeHead).toHaveBeenCalledWith(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const events = parseSseEvents(raw.chunks);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'connected' });
  });

  it('forwards reply:chunk events as SSE token events', () => {
    bridgeReplyStream(raw, 'home-assistant', eventBus);

    eventBus.emit('reply:chunk', {
      content: 'Hello',
      accumulated: 'Hello',
      turnIndex: 0,
      channel: 'home-assistant',
      contactId: 'c1',
    });

    eventBus.emit('reply:chunk', {
      content: ', world',
      accumulated: 'Hello, world',
      turnIndex: 0,
      channel: 'home-assistant',
      contactId: 'c1',
    });

    const events = parseSseEvents(raw.chunks);
    expect(events).toHaveLength(3);
    expect(events[1]).toEqual({ type: 'token', content: 'Hello' });
    expect(events[2]).toEqual({ type: 'token', content: ', world' });
  });

  it('filters out events from other channels', () => {
    bridgeReplyStream(raw, 'home-assistant', eventBus);

    eventBus.emit('reply:chunk', {
      content: 'from discord',
      accumulated: 'from discord',
      turnIndex: 0,
      channel: 'discord',
      contactId: 'c2',
    });

    const events = parseSseEvents(raw.chunks);
    expect(events).toHaveLength(1); // only connected
  });

  it('forwards turn_complete events', () => {
    bridgeReplyStream(raw, 'home-assistant', eventBus);

    eventBus.emit('reply:turn_complete', {
      turnIndex: 0,
      content: 'Full turn text',
      tickNumber: 5,
      channel: 'home-assistant',
      contactId: 'c1',
    });

    const events = parseSseEvents(raw.chunks);
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({
      type: 'turn_complete',
      turn_index: 0,
      content: 'Full turn text',
    });
  });

  it('closes stream on reply:complete', () => {
    bridgeReplyStream(raw, 'home-assistant', eventBus);

    eventBus.emit('reply:complete', {
      content: 'Full response',
      tickNumber: 5,
      totalTurns: 1,
      channel: 'home-assistant',
      contactId: 'c1',
    });

    const events = parseSseEvents(raw.chunks);
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({ type: 'done' });
    expect(raw.end).toHaveBeenCalled();
  });

  it('does not close stream on heartbeat:tick_end from a different tick', () => {
    bridgeReplyStream(raw, 'home-assistant', eventBus, 'req-2');

    eventBus.emit('heartbeat:tick_end', { tickNumber: 5 });

    const events = parseSseEvents(raw.chunks);
    expect(events).toHaveLength(1); // only connected, not closed
    expect(raw.end).not.toHaveBeenCalled();
  });

  it('cleans up on client disconnect', () => {
    bridgeReplyStream(raw, 'home-assistant', eventBus);

    raw.emit('close');

    // After disconnect, new events should not produce output
    const chunkCountBefore = raw.chunks.length;
    eventBus.emit('reply:chunk', {
      content: 'late',
      accumulated: 'late',
      turnIndex: 0,
      channel: 'home-assistant',
      contactId: 'c1',
    });
    expect(raw.chunks.length).toBe(chunkCountBefore);
  });

  it('sends error event on timeout', () => {
    bridgeReplyStream(raw, 'home-assistant', eventBus);

    vi.advanceTimersByTime(300_000);

    const events = parseSseEvents(raw.chunks);
    const lastEvent = events[events.length - 1];
    expect(lastEvent).toEqual({ type: 'error', error: 'Stream timeout' });
    expect(raw.end).toHaveBeenCalled();
  });

  it('handles full streaming lifecycle', () => {
    bridgeReplyStream(raw, 'home-assistant', eventBus);

    eventBus.emit('reply:chunk', {
      content: 'Hi',
      accumulated: 'Hi',
      turnIndex: 0,
      channel: 'home-assistant',
      contactId: 'c1',
    });

    eventBus.emit('reply:chunk', {
      content: ' there',
      accumulated: 'Hi there',
      turnIndex: 0,
      channel: 'home-assistant',
      contactId: 'c1',
    });

    eventBus.emit('reply:turn_complete', {
      turnIndex: 0,
      content: 'Hi there',
      tickNumber: 1,
      channel: 'home-assistant',
      contactId: 'c1',
    });

    eventBus.emit('reply:complete', {
      content: 'Hi there',
      tickNumber: 1,
      totalTurns: 1,
      channel: 'home-assistant',
      contactId: 'c1',
    });

    const events = parseSseEvents(raw.chunks);
    expect(events).toEqual([
      { type: 'connected' },
      { type: 'token', content: 'Hi' },
      { type: 'token', content: ' there' },
      { type: 'turn_complete', turn_index: 0, content: 'Hi there' },
      { type: 'done' },
    ]);
    expect(raw.end).toHaveBeenCalledOnce();
  });

  it('filters events by requestId when provided', () => {
    bridgeReplyStream(raw, 'home-assistant', eventBus, 'req-1');

    // Event with matching requestId should pass
    eventBus.emit('reply:chunk', {
      content: 'match',
      accumulated: 'match',
      turnIndex: 0,
      channel: 'home-assistant',
      contactId: 'c1',
      requestId: 'req-1',
    });

    // Event with different requestId should be filtered
    eventBus.emit('reply:chunk', {
      content: 'no-match',
      accumulated: 'no-match',
      turnIndex: 0,
      channel: 'home-assistant',
      contactId: 'c1',
      requestId: 'req-2',
    });

    // Event with no requestId should also be filtered (requestId bridge expects match)
    eventBus.emit('reply:chunk', {
      content: 'no-id',
      accumulated: 'no-id',
      turnIndex: 0,
      channel: 'home-assistant',
      contactId: 'c1',
    });

    const events = parseSseEvents(raw.chunks);
    const tokenEvents = events.filter((e: any) => e.type === 'token');
    expect(tokenEvents).toHaveLength(1);
    expect(tokenEvents[0]).toEqual({ type: 'token', content: 'match' });
  });

  it('concurrent streams with different requestIds do not cross-talk', () => {
    const raw1 = createMockRaw();
    const raw2 = createMockRaw();

    bridgeReplyStream(raw1, 'home-assistant', eventBus, 'req-1');
    bridgeReplyStream(raw2, 'home-assistant', eventBus, 'req-2');

    eventBus.emit('reply:chunk', {
      content: 'for-1',
      accumulated: 'for-1',
      turnIndex: 0,
      channel: 'home-assistant',
      contactId: 'c1',
      requestId: 'req-1',
    });

    eventBus.emit('reply:chunk', {
      content: 'for-2',
      accumulated: 'for-2',
      turnIndex: 0,
      channel: 'home-assistant',
      contactId: 'c1',
      requestId: 'req-2',
    });

    const events1 = parseSseEvents(raw1.chunks).filter((e: any) => e.type === 'token');
    const events2 = parseSseEvents(raw2.chunks).filter((e: any) => e.type === 'token');

    expect(events1).toHaveLength(1);
    expect(events1[0]).toEqual({ type: 'token', content: 'for-1' });
    expect(events2).toHaveLength(1);
    expect(events2[0]).toEqual({ type: 'token', content: 'for-2' });
  });

  it('filters working tags from streamed tokens', () => {
    bridgeReplyStream(raw, 'home-assistant', eventBus);

    eventBus.emit('reply:chunk', {
      content: 'Hello! ',
      accumulated: 'Hello! ',
      turnIndex: 0,
      channel: 'home-assistant',
      contactId: 'c1',
    });

    eventBus.emit('reply:chunk', {
      content: '<working>',
      accumulated: 'Hello! <working>',
      turnIndex: 0,
      channel: 'home-assistant',
      contactId: 'c1',
    });

    eventBus.emit('reply:chunk', {
      content: 'internal reasoning here',
      accumulated: 'Hello! <working>internal reasoning here',
      turnIndex: 0,
      channel: 'home-assistant',
      contactId: 'c1',
    });

    eventBus.emit('reply:chunk', {
      content: '</working>',
      accumulated: 'Hello! <working>internal reasoning here</working>',
      turnIndex: 0,
      channel: 'home-assistant',
      contactId: 'c1',
    });

    eventBus.emit('reply:chunk', {
      content: ' Goodbye!',
      accumulated: 'Hello! <working>internal reasoning here</working> Goodbye!',
      turnIndex: 0,
      channel: 'home-assistant',
      contactId: 'c1',
    });

    const events = parseSseEvents(raw.chunks);
    const tokenEvents = events.filter((e: any) => e.type === 'token');
    const combined = tokenEvents.map((e: any) => e.content).join('');
    expect(combined).toBe('Hello!  Goodbye!');
  });

  it('filters working tags split across token boundaries', () => {
    bridgeReplyStream(raw, 'home-assistant', eventBus);

    const chunks = ['Hi ', '<work', 'ing>', 'secret', '</work', 'ing>', ' there'];
    for (const chunk of chunks) {
      eventBus.emit('reply:chunk', {
        content: chunk,
        accumulated: '',
        turnIndex: 0,
        channel: 'home-assistant',
        contactId: 'c1',
      });
    }

    eventBus.emit('reply:turn_complete', {
      turnIndex: 0,
      content: 'Hi  there',
      tickNumber: 1,
      channel: 'home-assistant',
      contactId: 'c1',
    });

    const events = parseSseEvents(raw.chunks);
    const tokenEvents = events.filter((e: any) => e.type === 'token');
    const combined = tokenEvents.map((e: any) => e.content).join('');
    expect(combined).toBe('Hi  there');
  });
});

describe('WorkingTagFilter', () => {
  it('passes through text without tags', () => {
    const f = new WorkingTagFilter();
    expect(f.process('hello world')).toBe('hello world');
  });

  it('strips a complete working block', () => {
    const f = new WorkingTagFilter();
    expect(f.process('before <working>secret</working> after')).toBe('before  after');
  });

  it('handles tags split across chunks', () => {
    const f = new WorkingTagFilter();
    expect(f.process('hello <work')).toBe('hello ');
    expect(f.process('ing>')).toBe('');
    expect(f.process('hidden')).toBe('');
    expect(f.process('</working>')).toBe('');
    expect(f.process(' world')).toBe(' world');
  });

  it('handles unclosed tag', () => {
    const f = new WorkingTagFilter();
    expect(f.process('text <working>hidden stuff')).toBe('text ');
    expect(f.flush()).toBe('');
  });

  it('handles multiple working blocks', () => {
    const f = new WorkingTagFilter();
    const result = f.process('a <working>x</working> b <working>y</working> c');
    expect(result).toBe('a  b  c');
  });

  it('flushes buffered content when no tag found', () => {
    const f = new WorkingTagFilter();
    expect(f.process('text <')).toBe('text ');
    expect(f.flush()).toBe('<');
  });
});
