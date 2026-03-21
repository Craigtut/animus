/**
 * Budget guard: enforces turn count and cost limits during the agentic loop.
 *
 * Monitors turn_end events for turn counting and cost accumulation.
 * On breach, calls the provided abort function to stop the loop.
 * Defaults to Infinity for both limits (no enforcement unless configured).
 *
 * Counters reset on agent_start (beginning of each agentic loop).
 *
 * Reference: cortex-architecture.md (Budget Guards section)
 */

import type { BudgetGuardConfig } from './types.js';
import type { EventBridge } from './event-bridge.js';

// ---------------------------------------------------------------------------
// BudgetGuard
// ---------------------------------------------------------------------------

export class BudgetGuard {
  private readonly maxTurns: number;
  private readonly maxCost: number;
  private readonly abortFn: () => void;

  private turnCount = 0;
  private totalCost = 0;
  private breached = false;

  private unsubscribers: Array<() => void> = [];

  /**
   * Create a BudgetGuard.
   *
   * @param config - Budget limits (maxTurns, maxCost). Both default to Infinity.
   * @param abortFn - Function to call when a limit is breached (typically agent.abort())
   */
  constructor(config: Partial<BudgetGuardConfig>, abortFn: () => void) {
    this.maxTurns = config.maxTurns ?? Infinity;
    this.maxCost = config.maxCost ?? Infinity;
    this.abortFn = abortFn;
  }

  /**
   * Wire the guard to an event bridge.
   * Subscribes to turn_end (for turn counting and cost) and session_start (for reset).
   *
   * @param bridge - The EventBridge to subscribe to
   */
  wire(bridge: EventBridge): void {
    // Clean up any previous wiring
    this.unwire();

    // Reset counters on agent_start (beginning of a new agentic loop)
    this.unsubscribers.push(
      bridge.on('session_start', () => {
        this.reset();
      }),
    );

    // Track turns and cost on turn_end
    this.unsubscribers.push(
      bridge.on('turn_end', (event) => {
        this.turnCount++;

        // Extract cost from the event data if available
        const cost = this.extractCost(event.data);
        if (cost > 0) {
          this.totalCost += cost;
        }

        // Check limits
        this.checkLimits();
      }),
    );
  }

  /**
   * Disconnect from the event bridge.
   */
  unwire(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
  }

  /**
   * Get the current turn count.
   */
  getTurnCount(): number {
    return this.turnCount;
  }

  /**
   * Get the accumulated cost.
   */
  getTotalCost(): number {
    return this.totalCost;
  }

  /**
   * Whether any limit has been breached.
   */
  isBreached(): boolean {
    return this.breached;
  }

  /**
   * Reset counters. Called automatically on session_start.
   */
  reset(): void {
    this.turnCount = 0;
    this.totalCost = 0;
    this.breached = false;
  }

  /**
   * Clean up all subscriptions.
   */
  destroy(): void {
    this.unwire();
  }

  /**
   * Check if any limits have been exceeded and abort if so.
   */
  private checkLimits(): void {
    if (this.breached) {
      return; // Already breached, don't abort multiple times
    }

    if (this.turnCount >= this.maxTurns) {
      this.breached = true;
      this.abortFn();
      return;
    }

    if (this.totalCost >= this.maxCost) {
      this.breached = true;
      this.abortFn();
    }
  }

  /**
   * Extract cost from a turn_end event's data.
   *
   * Pi-agent-core's turn_end event carries the AssistantMessage which
   * includes usage.cost.total from pi-ai.
   */
  private extractCost(data: unknown): number {
    if (!data || typeof data !== 'object') {
      return 0;
    }

    const event = data as Record<string, unknown>;

    // Pattern 1: Direct cost property
    if (typeof event['cost'] === 'number') {
      return event['cost'];
    }

    // Pattern 2: message.cost.total (pi-ai AssistantMessage structure)
    const message = event['message'] as Record<string, unknown> | undefined;
    if (message) {
      const cost = message['cost'] as Record<string, unknown> | undefined;
      if (cost && typeof cost['total'] === 'number') {
        return cost['total'];
      }
    }

    // Pattern 3: result.cost.total
    const result = event['result'] as Record<string, unknown> | undefined;
    if (result) {
      const cost = result['cost'] as Record<string, unknown> | undefined;
      if (cost && typeof cost['total'] === 'number') {
        return cost['total'];
      }
    }

    // Pattern 4: usage.cost.total
    const usage = event['usage'] as Record<string, unknown> | undefined;
    if (usage) {
      const cost = usage['cost'] as Record<string, unknown> | undefined;
      if (cost && typeof cost['total'] === 'number') {
        return cost['total'];
      }
    }

    return 0;
  }
}
