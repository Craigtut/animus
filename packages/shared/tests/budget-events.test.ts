/**
 * Tests for budget-related event bus types.
 *
 * Verifies that the AnimusEventMap includes the new budget events
 * with correct payload shapes.
 */

import { describe, it, expect } from 'vitest';
import type { AnimusEventMap, IEventBus } from '../src/event-bus.js';

describe('budget event types', () => {
  it('budget:alert payload has correct shape', () => {
    // Type-level check: this compiles only if the event type exists and payload matches
    const payload: AnimusEventMap['budget:alert'] = {
      threshold: 0.8,
      spentUsd: 8.00,
      limitUsd: 10.00,
      percentUsed: 80,
    };
    expect(payload.threshold).toBe(0.8);
    expect(payload.spentUsd).toBe(8.00);
    expect(payload.limitUsd).toBe(10.00);
    expect(payload.percentUsed).toBe(80);
  });

  it('budget:hard_stop payload has correct shape', () => {
    const payload: AnimusEventMap['budget:hard_stop'] = {
      spentUsd: 10.50,
      limitUsd: 10.00,
    };
    expect(payload.spentUsd).toBe(10.50);
    expect(payload.limitUsd).toBe(10.00);
  });

  it('budget:reset payload has correct shape', () => {
    const payload: AnimusEventMap['budget:reset'] = {
      newWindowStart: '2026-03-15T00:00:00Z',
      newWindowEnd: '2026-03-22T00:00:00Z',
    };
    expect(payload.newWindowStart).toBe('2026-03-15T00:00:00Z');
    expect(payload.newWindowEnd).toBe('2026-03-22T00:00:00Z');
  });

  it('budget:tick_blocked payload has correct shape', () => {
    const payload: AnimusEventMap['budget:tick_blocked'] = {
      reason: 'budget exceeded',
      triggerType: 'interval',
    };
    expect(payload.reason).toBe('budget exceeded');
    expect(payload.triggerType).toBe('interval');
  });

  it('IEventBus interface accepts budget events', () => {
    // Type-level verification: this function signature compiles if events are valid
    function testEmit(bus: IEventBus) {
      bus.emit('budget:alert', { threshold: 0.5, spentUsd: 5, limitUsd: 10, percentUsed: 50 });
      bus.emit('budget:hard_stop', { spentUsd: 11, limitUsd: 10 });
      bus.emit('budget:reset', { newWindowStart: '', newWindowEnd: '' });
      bus.emit('budget:tick_blocked', { reason: 'test', triggerType: 'interval' });
    }
    // If the above compiles, the types are correct
    expect(testEmit).toBeInstanceOf(Function);
  });
});
