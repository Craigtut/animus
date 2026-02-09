import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TickQueue } from '../../src/heartbeat/tick-queue.js';

describe('TickQueue', () => {
  let queue: TickQueue;

  beforeEach(() => {
    vi.useFakeTimers();
    queue = new TickQueue();
  });

  afterEach(() => {
    queue.destroy();
    vi.useRealTimers();
  });

  describe('basic enqueue/process', () => {
    it('processes ticks in priority order', async () => {
      const processed: string[] = [];

      // Block the processor so all ticks queue before any are processed
      let unblock: (() => void) | null = null;
      let firstCall = true;

      queue.setProcessor(async (tick) => {
        if (firstCall) {
          firstCall = false;
          // Block on the first tick so others queue up
          await new Promise<void>((resolve) => { unblock = resolve; });
        }
        processed.push(tick.trigger.type);
      });

      // First enqueue starts processing and blocks
      queue.enqueue({ type: 'interval' });

      // These queue while first is blocked
      queue.enqueue({ type: 'agent_complete' });
      queue.enqueue({ type: 'message', contactId: 'c1', messageContent: 'hi' });

      // Unblock the first tick
      unblock!();
      await vi.runAllTimersAsync();

      // First processed is interval (was already running)
      // Remaining queue processes in priority order: message then agent_complete
      expect(processed[0]).toBe('interval');
      expect(processed[1]).toBe('message');
      expect(processed[2]).toBe('agent_complete');
    });

    it('processes ticks sequentially', async () => {
      let concurrent = 0;
      let maxConcurrent = 0;

      queue.setProcessor(async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 10));
        concurrent--;
      });

      queue.enqueue({ type: 'interval' });
      queue.enqueue({ type: 'interval', elapsedMs: 100 });

      await vi.runAllTimersAsync();

      expect(maxConcurrent).toBe(1);
    });

    it('maintains FIFO within same priority', async () => {
      const processed: string[] = [];

      queue.setProcessor(async (tick) => {
        processed.push(tick.trigger.messageContent || '');
      });

      queue.enqueue({ type: 'message', contactId: 'c1', messageContent: 'first' });
      queue.enqueue({ type: 'message', contactId: 'c2', messageContent: 'second' });

      await vi.runAllTimersAsync();

      expect(processed[0]).toBe('first');
      expect(processed[1]).toBe('second');
    });
  });

  describe('interval coalescing', () => {
    it('coalesces multiple interval ticks', () => {
      queue.setProcessor(async () => {
        // Don't process, just queue
      });

      queue.enqueueInterval();
      queue.enqueueInterval();
      queue.enqueueInterval();

      // Should only have one interval tick in queue
      // (first one may have started processing, so check depth)
      // The first enqueueInterval triggers processing, removing it from queue
      // The next two should coalesce
      expect(queue.depth).toBeLessThanOrEqual(1);
    });
  });

  describe('message debouncing', () => {
    it('debounces messages from same contact', async () => {
      const processed: string[] = [];
      queue.setProcessor(async (tick) => {
        processed.push(tick.trigger.type);
      });

      queue.enqueueMessage({ type: 'message', contactId: 'c1', messageContent: 'msg1' });
      queue.enqueueMessage({ type: 'message', contactId: 'c1', messageContent: 'msg2' });
      queue.enqueueMessage({ type: 'message', contactId: 'c1', messageContent: 'msg3' });

      // Advance past debounce window (1500ms)
      await vi.advanceTimersByTimeAsync(2000);

      // Should only process one tick
      expect(processed).toHaveLength(1);
    });

    it('does not debounce messages from different contacts', async () => {
      const processed: string[] = [];
      queue.setProcessor(async (tick) => {
        processed.push(tick.trigger.contactId || '');
      });

      queue.enqueueMessage({ type: 'message', contactId: 'c1', messageContent: 'msg1' });
      queue.enqueueMessage({ type: 'message', contactId: 'c2', messageContent: 'msg2' });

      await vi.advanceTimersByTimeAsync(2000);
      await vi.runAllTimersAsync();

      expect(processed).toHaveLength(2);
      expect(processed).toContain('c1');
      expect(processed).toContain('c2');
    });
  });

  describe('queue overflow', () => {
    it('drops interval ticks when queue is full', () => {
      // Don't set a processor so ticks stay queued
      // But first tick auto-processes, so set a blocking processor
      let resolver: (() => void) | null = null;
      queue.setProcessor(() => new Promise<void>((r) => { resolver = r; }));

      // First enqueue starts processing
      queue.enqueue({ type: 'message', contactId: 'c0', messageContent: 'blocking' });

      // Fill queue beyond max (10)
      for (let i = 0; i < 12; i++) {
        queue.enqueue({ type: 'interval', elapsedMs: i });
      }

      expect(queue.depth).toBeLessThanOrEqual(10);

      // Cleanup
      resolver?.();
    });
  });

  describe('interval timer', () => {
    it('starts and stops interval', async () => {
      const processed: string[] = [];
      queue.setProcessor(async (tick) => {
        processed.push(tick.trigger.type);
      });

      queue.startInterval(1000);

      // Advance 3 seconds — should fire ~3 intervals (after coalescing)
      await vi.advanceTimersByTimeAsync(3500);

      expect(processed.length).toBeGreaterThanOrEqual(1);
      expect(processed.every((t) => t === 'interval')).toBe(true);

      queue.stopInterval();
    });
  });

  describe('clear', () => {
    it('clears all queued ticks', () => {
      queue.setProcessor(async () => {});
      queue.enqueue({ type: 'interval' });
      queue.enqueue({ type: 'interval', elapsedMs: 100 });
      queue.clear();
      expect(queue.depth).toBe(0);
    });
  });
});
