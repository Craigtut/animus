import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventBridge } from '../../src/event-bridge.js';
import type { PiEvent, PiEventSource, CortexEvent, CortexEventType } from '../../src/event-bridge.js';

/**
 * Create a mock pi-agent-core event source.
 * Stores the subscription handler so we can emit events manually.
 */
function createMockSource(): PiEventSource & { emit: (event: PiEvent) => void } {
  let handler: ((event: PiEvent) => void) | null = null;

  return {
    subscribe(h: (event: PiEvent) => void): () => void {
      handler = h;
      return () => {
        handler = null;
      };
    },
    emit(event: PiEvent): void {
      if (handler) {
        handler(event);
      }
    },
  };
}

describe('EventBridge', () => {
  let bridge: EventBridge;
  let source: ReturnType<typeof createMockSource>;

  beforeEach(() => {
    bridge = new EventBridge(true);
    source = createMockSource();
    bridge.wire(source);
  });

  // -----------------------------------------------------------------------
  // Event mapping
  // -----------------------------------------------------------------------

  describe('event mapping', () => {
    const mappings: Array<[string, CortexEventType]> = [
      ['agent_start', 'session_start'],
      ['agent_end', 'session_end'],
      ['turn_start', 'turn_start'],
      ['turn_end', 'turn_end'],
      ['message_start', 'response_start'],
      ['message_update', 'response_chunk'],
      ['message_end', 'response_end'],
      ['tool_execution_start', 'tool_call_start'],
      ['tool_execution_end', 'tool_call_end'],
    ];

    for (const [piType, cortexType] of mappings) {
      it(`maps ${piType} to ${cortexType}`, () => {
        const listener = vi.fn();
        bridge.on(cortexType, listener);

        source.emit({ type: piType as PiEvent['type'] });

        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith(
          expect.objectContaining({ type: cortexType }),
        );
      });
    }

    it('drops tool_execution_update events (no mapping)', () => {
      const allListener = vi.fn();
      bridge.onAll(allListener);

      source.emit({ type: 'tool_execution_update' });

      expect(allListener).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // turn_end with AgentTextOutput
  // -----------------------------------------------------------------------

  describe('turn_end with working tags', () => {
    it('parses working tags from turn text and includes AgentTextOutput', () => {
      const listener = vi.fn();
      bridge.on('turn_end', listener);

      source.emit({
        type: 'turn_end',
        text: 'Hello! <working>Analysis here.</working> Final answer.',
      });

      expect(listener).toHaveBeenCalledTimes(1);

      const event: CortexEvent = listener.mock.calls[0][0];
      expect(event.textOutput).toBeDefined();
      expect(event.textOutput!.userFacing).toBe('Hello!\nFinal answer.');
      expect(event.textOutput!.working).toBe('Analysis here.');
      expect(event.textOutput!.raw).toBe('Hello! <working>Analysis here.</working> Final answer.');
    });

    it('extracts text from message.content string', () => {
      const listener = vi.fn();
      bridge.on('turn_end', listener);

      source.emit({
        type: 'turn_end',
        message: {
          content: '<working>Reasoning.</working>User-facing text.',
        },
      });

      const event: CortexEvent = listener.mock.calls[0][0];
      expect(event.textOutput).toBeDefined();
      expect(event.textOutput!.userFacing).toBe('User-facing text.');
    });

    it('extracts text from message.content array', () => {
      const listener = vi.fn();
      bridge.on('turn_end', listener);

      source.emit({
        type: 'turn_end',
        message: {
          content: [
            { type: 'text', text: 'Part one. ' },
            { type: 'text', text: 'Part two.' },
          ],
        },
      });

      const event: CortexEvent = listener.mock.calls[0][0];
      expect(event.textOutput).toBeDefined();
      expect(event.textOutput!.userFacing).toBe('Part one. Part two.');
    });

    it('extracts text from result.content string', () => {
      const listener = vi.fn();
      bridge.on('turn_end', listener);

      source.emit({
        type: 'turn_end',
        result: {
          content: 'Result text here.',
        },
      });

      const event: CortexEvent = listener.mock.calls[0][0];
      expect(event.textOutput).toBeDefined();
      expect(event.textOutput!.userFacing).toBe('Result text here.');
    });

    it('handles turn_end with no extractable text', () => {
      const listener = vi.fn();
      bridge.on('turn_end', listener);

      source.emit({
        type: 'turn_end',
        // No text, message, or result properties
      });

      const event: CortexEvent = listener.mock.calls[0][0];
      expect(event.textOutput).toBeUndefined();
    });

    it('does not parse working tags when disabled', () => {
      bridge.setWorkingTagsEnabled(false);

      const listener = vi.fn();
      bridge.on('turn_end', listener);

      source.emit({
        type: 'turn_end',
        text: 'Hello <working>internal</working> world',
      });

      const event: CortexEvent = listener.mock.calls[0][0];
      // When working tags are disabled, textOutput is not set
      expect(event.textOutput).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Listener management
  // -----------------------------------------------------------------------

  describe('listener management', () => {
    it('supports multiple listeners for the same event type', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      bridge.on('session_start', listener1);
      bridge.on('session_start', listener2);

      source.emit({ type: 'agent_start' });

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it('unsubscribes individual listeners', () => {
      const listener = vi.fn();
      const unsub = bridge.on('session_start', listener);

      source.emit({ type: 'agent_start' });
      expect(listener).toHaveBeenCalledTimes(1);

      unsub();

      source.emit({ type: 'agent_start' });
      expect(listener).toHaveBeenCalledTimes(1); // Not called again
    });

    it('onAll receives all mapped events', () => {
      const allListener = vi.fn();
      bridge.onAll(allListener);

      source.emit({ type: 'agent_start' });
      source.emit({ type: 'turn_end', text: 'Hello' });
      source.emit({ type: 'agent_end' });

      expect(allListener).toHaveBeenCalledTimes(3);
      expect(allListener.mock.calls[0][0].type).toBe('session_start');
      expect(allListener.mock.calls[1][0].type).toBe('turn_end');
      expect(allListener.mock.calls[2][0].type).toBe('session_end');
    });

    it('onAll unsubscribes correctly', () => {
      const allListener = vi.fn();
      const unsub = bridge.onAll(allListener);

      source.emit({ type: 'agent_start' });
      expect(allListener).toHaveBeenCalledTimes(1);

      unsub();

      source.emit({ type: 'agent_end' });
      expect(allListener).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // Wire / Unwire / Destroy
  // -----------------------------------------------------------------------

  describe('lifecycle', () => {
    it('unwire disconnects from the source', () => {
      const listener = vi.fn();
      bridge.on('session_start', listener);

      bridge.unwire();

      source.emit({ type: 'agent_start' });
      expect(listener).not.toHaveBeenCalled();
    });

    it('wire replaces previous connection', () => {
      const listener = vi.fn();
      bridge.on('session_start', listener);

      const source2 = createMockSource();
      bridge.wire(source2);

      // Old source should not trigger events
      source.emit({ type: 'agent_start' });
      expect(listener).not.toHaveBeenCalled();

      // New source should work
      source2.emit({ type: 'agent_start' });
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('destroy cleans up all listeners and connection', () => {
      const typeListener = vi.fn();
      const allListener = vi.fn();
      bridge.on('session_start', typeListener);
      bridge.onAll(allListener);

      bridge.destroy();

      source.emit({ type: 'agent_start' });
      expect(typeListener).not.toHaveBeenCalled();
      expect(allListener).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Event data passthrough
  // -----------------------------------------------------------------------

  describe('event data passthrough', () => {
    it('includes original pi event data in the cortex event', () => {
      const listener = vi.fn();
      bridge.on('session_start', listener);

      const piEvent: PiEvent = {
        type: 'agent_start',
        sessionId: 'test-123',
        timestamp: Date.now(),
      };

      source.emit(piEvent);

      const event: CortexEvent = listener.mock.calls[0][0];
      expect(event.data).toBe(piEvent);
    });

    it('passes tool call data through', () => {
      const startListener = vi.fn();
      const endListener = vi.fn();
      bridge.on('tool_call_start', startListener);
      bridge.on('tool_call_end', endListener);

      source.emit({
        type: 'tool_execution_start',
        toolName: 'read',
        args: { path: '/tmp/test.txt' },
      });

      source.emit({
        type: 'tool_execution_end',
        toolName: 'read',
        result: 'file contents here',
      });

      expect(startListener).toHaveBeenCalledTimes(1);
      expect(endListener).toHaveBeenCalledTimes(1);

      const startData = (startListener.mock.calls[0][0] as CortexEvent).data as Record<string, unknown>;
      expect(startData.toolName).toBe('read');
    });
  });
});
