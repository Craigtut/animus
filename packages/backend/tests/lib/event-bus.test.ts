import { describe, it, expect, vi } from 'vitest';
import { createEventBus } from '../../src/lib/event-bus.js';

describe('EventBus', () => {
  it('emits and receives events', () => {
    const bus = createEventBus();
    const handler = vi.fn();

    bus.on('heartbeat:tick_start', handler);
    bus.emit('heartbeat:tick_start', { tickNumber: 1, triggerType: 'interval' });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ tickNumber: 1, triggerType: 'interval' });
  });

  it('supports multiple listeners', () => {
    const bus = createEventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();

    bus.on('heartbeat:tick_end', h1);
    bus.on('heartbeat:tick_end', h2);
    bus.emit('heartbeat:tick_end', { tickNumber: 1 });

    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });

  it('removes listener with off', () => {
    const bus = createEventBus();
    const handler = vi.fn();

    bus.on('heartbeat:tick_start', handler);
    bus.off('heartbeat:tick_start', handler);
    bus.emit('heartbeat:tick_start', { tickNumber: 1, triggerType: 'interval' });

    expect(handler).not.toHaveBeenCalled();
  });

  it('once fires only once', () => {
    const bus = createEventBus();
    const handler = vi.fn();

    bus.once('heartbeat:tick_end', handler);
    bus.emit('heartbeat:tick_end', { tickNumber: 1 });
    bus.emit('heartbeat:tick_end', { tickNumber: 2 });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ tickNumber: 1 });
  });

  it('does not fire listeners for other events', () => {
    const bus = createEventBus();
    const handler = vi.fn();

    bus.on('heartbeat:tick_start', handler);
    bus.emit('heartbeat:tick_end', { tickNumber: 1 });

    expect(handler).not.toHaveBeenCalled();
  });
});
