/**
 * Tick Queue & Trigger System
 *
 * Priority queue for heartbeat tick triggers. Ticks are processed
 * sequentially — only one tick at a time. Priority determines order.
 *
 * See docs/architecture/heartbeat.md — "Tick Triggers" & "Tick Queuing"
 */

import type { TriggerType } from '@animus-labs/shared';
import { createLogger } from '../lib/logger.js';
import type { TriggerContext } from './context-builder.js';

const log = createLogger('TickQueue', 'heartbeat');

// ============================================================================
// Types
// ============================================================================

export interface QueuedTick {
  id: string;
  trigger: TriggerContext;
  priority: number;  // Lower = higher priority (1 is highest)
  queuedAt: number;  // Date.now() for FIFO within same priority
}

// ============================================================================
// Constants
// ============================================================================

/** Maximum queue depth — drop oldest low-priority ticks beyond this */
const MAX_QUEUE_DEPTH = 10;

/** Priority mapping: lower number = higher priority */
const PRIORITY_MAP: Record<TriggerType, number> = {
  message: 1,
  agent_complete: 2,
  plugin_trigger: 2,
  scheduled_task: 3,
  interval: 4,
};

/** Debounce window for message triggers per contact (ms) */
const MESSAGE_DEBOUNCE_MS = 1500;

// ============================================================================
// Tick Queue
// ============================================================================

export class TickQueue {
  private queue: QueuedTick[] = [];
  private processing = false;
  private tickIdCounter = 0;
  private processor: ((tick: QueuedTick) => Promise<void>) | null = null;

  /** Per-contact debounce timers */
  private messageDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Track if a contact already has a tick queued or running */
  private queuedContactTicks = new Set<string>();

  /** Messages that arrived while a tick was running for the same contact.
   *  Keyed by contactId; only the latest trigger is kept (new messages
   *  supersede older ones since gather will pick up all stored messages). */
  private pendingFollowUps = new Map<string, TriggerContext>();

  /** Interval timer handle */
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private intervalMs: number = 300000;

  /** Timestamp when the interval timer was last started/reset */
  private _intervalResetAt: number | null = null;

  /**
   * Set the processor function that handles each tick.
   */
  setProcessor(fn: (tick: QueuedTick) => Promise<void>): void {
    this.processor = fn;
  }

  /**
   * Enqueue a tick trigger.
   */
  enqueue(trigger: TriggerContext): void {
    const priority = PRIORITY_MAP[trigger.type] ?? 4;
    const tick: QueuedTick = {
      id: `tick_${++this.tickIdCounter}`,
      trigger,
      priority,
      queuedAt: Date.now(),
    };

    this.queue.push(tick);
    this.queue.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.queuedAt - b.queuedAt; // FIFO within same priority
    });

    // Enforce max queue depth
    while (this.queue.length > MAX_QUEUE_DEPTH) {
      this.dropLowestPriority();
    }

    this.processNext();
  }

  /**
   * Enqueue a message trigger with per-contact debouncing.
   * Messages from the same contact within the debounce window
   * are coalesced into a single tick trigger.
   */
  enqueueMessage(trigger: TriggerContext): void {
    const contactId = trigger.contactId;
    if (!contactId) {
      this.enqueue(trigger);
      return;
    }

    // If this contact already has a tick queued or running, store the
    // trigger as a pending follow-up. When the current tick finishes,
    // the follow-up will be enqueued as a new tick. This preserves
    // the trigger metadata (including requestId/replyTo) so the reply
    // routes back to the correct waiting HTTP connection.
    if (this.queuedContactTicks.has(contactId)) {
      this.pendingFollowUps.set(contactId, trigger);
      log.debug(`Stored pending follow-up for contact ${contactId} (tick in progress)`);
      return;
    }

    // Clear existing debounce timer for this contact
    const existing = this.messageDebounceTimers.get(contactId);
    if (existing) {
      clearTimeout(existing);
    }

    // Set new debounce timer
    const timer = setTimeout(() => {
      this.messageDebounceTimers.delete(contactId);
      this.queuedContactTicks.add(contactId);
      this.enqueue(trigger);
    }, MESSAGE_DEBOUNCE_MS);

    this.messageDebounceTimers.set(contactId, timer);
  }

  /**
   * Enqueue an interval tick. Coalesces with existing interval ticks.
   */
  enqueueInterval(): void {
    // Coalesce — if an interval tick is already queued, skip
    const hasIntervalQueued = this.queue.some((t) => t.trigger.type === 'interval');
    if (hasIntervalQueued) return;

    this.enqueue({
      type: 'interval',
      elapsedMs: this.intervalMs,
    });
  }

  /**
   * Start the interval timer.
   */
  startInterval(intervalMs: number): void {
    this.stopInterval();
    this.intervalMs = intervalMs;
    this._intervalResetAt = Date.now();
    this.intervalTimer = setInterval(() => {
      this.enqueueInterval();
    }, intervalMs);
  }

  /**
   * Stop the interval timer.
   */
  stopInterval(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    this._intervalResetAt = null;
  }

  /**
   * Reset the interval timer (called after any tick completes).
   */
  resetInterval(): void {
    if (this.intervalTimer) {
      this.startInterval(this.intervalMs);
    }
  }

  /**
   * Update the interval duration.
   */
  updateInterval(intervalMs: number): void {
    if (intervalMs !== this.intervalMs) {
      log.debug(`Interval changed: ${this.intervalMs}ms → ${intervalMs}ms`);
    }
    this.intervalMs = intervalMs;
    if (this.intervalTimer) {
      this.startInterval(intervalMs);
    }
  }

  /**
   * Get current queue depth.
   */
  get depth(): number {
    return this.queue.length;
  }

  /**
   * Check if a tick is currently being processed.
   */
  get isProcessing(): boolean {
    return this.processing;
  }

  /**
   * Get the estimated next tick timestamp (ISO string), or null if no interval is active.
   */
  get nextTickAt(): string | null {
    if (!this._intervalResetAt || !this.intervalTimer) return null;
    return new Date(this._intervalResetAt + this.intervalMs).toISOString();
  }

  /**
   * Delay the next tick by the specified duration.
   * Stops the current interval, waits, then restarts it.
   * Used for rate-limit backoff.
   */
  delayNext(ms: number): void {
    if (ms <= 0) return;
    log.info(`Delaying next tick by ${ms}ms (rate-limit backoff)`);

    // Stop the interval temporarily
    const wasRunning = this.intervalTimer !== null;
    this.stopInterval();

    // After the delay, restart the interval
    setTimeout(() => {
      if (wasRunning) {
        this.startInterval(this.intervalMs);
        // Fire an interval tick immediately after the delay
        this.enqueueInterval();
      }
    }, ms);
  }

  /**
   * Clear all queued ticks and timers.
   */
  clear(): void {
    this.queue = [];
    this.queuedContactTicks.clear();
    this.pendingFollowUps.clear();
    for (const timer of this.messageDebounceTimers.values()) {
      clearTimeout(timer);
    }
    this.messageDebounceTimers.clear();
  }

  /**
   * Destroy the queue: stop interval, clear everything.
   */
  destroy(): void {
    this.stopInterval();
    this.clear();
    this.processor = null;
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  private async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0 || !this.processor) {
      return;
    }

    this.processing = true;
    const tick = this.queue.shift()!;

    try {
      await this.processor(tick);
    } catch (err) {
      log.error(`Error processing tick ${tick.id}:`, err);
    } finally {
      const contactId = tick.trigger.contactId;
      if (contactId) {
        this.queuedContactTicks.delete(contactId);

        // If a follow-up message arrived during this tick, enqueue it now.
        // The follow-up trigger carries the new message's requestId so
        // the reply routes back to the correct waiting HTTP connection.
        const followUp = this.pendingFollowUps.get(contactId);
        if (followUp) {
          this.pendingFollowUps.delete(contactId);
          log.info(`Enqueuing pending follow-up for contact ${contactId}`);
          this.enqueueMessage(followUp);
        }
      }
      this.processing = false;
      // Reset interval timer after any tick completes
      this.resetInterval();
      // Process next in queue
      this.processNext();
    }
  }

  private dropLowestPriority(): void {
    // Find the last (lowest priority) interval tick and drop it
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i]!.trigger.type === 'interval') {
        this.queue.splice(i, 1);
        return;
      }
    }
    // If no interval ticks, drop the oldest entry (last in sorted order)
    const dropped = this.queue.pop();
    if (dropped) {
      log.warn(`Queue overflow: dropped tick ${dropped.id} (${dropped.trigger.type})`);
    }
  }
}
