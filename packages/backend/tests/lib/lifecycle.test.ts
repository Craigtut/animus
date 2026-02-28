import { describe, it, expect, vi } from 'vitest';
import { LifecycleManager, SubsystemLifecycle, SubsystemHealth } from '../../src/lib/lifecycle.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockSubsystem(
  name: string,
  deps?: string[],
): SubsystemLifecycle & { startCalled: boolean; stopCalled: boolean } {
  return {
    name,
    dependsOn: deps,
    startCalled: false,
    stopCalled: false,
    async start() {
      this.startCalled = true;
    },
    async stop() {
      this.stopCalled = true;
    },
  };
}

/**
 * Creates a mock subsystem that records the order it was started/stopped
 * into the provided arrays.
 */
function createOrderedSubsystem(
  name: string,
  startOrder: string[],
  stopOrder: string[],
  deps?: string[],
): SubsystemLifecycle {
  return {
    name,
    dependsOn: deps,
    async start() {
      startOrder.push(name);
    },
    async stop() {
      stopOrder.push(name);
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LifecycleManager', () => {
  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------

  describe('register', () => {
    it('initializes subsystems with pending status', () => {
      const mgr = new LifecycleManager();
      const sub = createMockSubsystem('db');

      mgr.register(sub);

      expect(mgr.getStatus('db')).toBe('pending');
    });

    it('returns this for chaining', () => {
      const mgr = new LifecycleManager();
      const a = createMockSubsystem('a');
      const b = createMockSubsystem('b');

      const result = mgr.register(a).register(b);

      expect(result).toBe(mgr);
    });

    it('throws on duplicate registration', () => {
      const mgr = new LifecycleManager();
      mgr.register(createMockSubsystem('db'));

      expect(() => mgr.register(createMockSubsystem('db'))).toThrow(
        'Subsystem "db" is already registered',
      );
    });
  });

  // -----------------------------------------------------------------------
  // startAll
  // -----------------------------------------------------------------------

  describe('startAll', () => {
    it('starts all subsystems and sets status to running', async () => {
      const mgr = new LifecycleManager();
      const a = createMockSubsystem('a');
      const b = createMockSubsystem('b');

      mgr.register(a).register(b);
      await mgr.startAll();

      expect(a.startCalled).toBe(true);
      expect(b.startCalled).toBe(true);
      expect(mgr.getStatus('a')).toBe('running');
      expect(mgr.getStatus('b')).toBe('running');
    });

    it('starts subsystems in dependency order (A -> B -> C)', async () => {
      const mgr = new LifecycleManager();
      const startOrder: string[] = [];
      const stopOrder: string[] = [];

      const c = createOrderedSubsystem('c', startOrder, stopOrder, ['b']);
      const a = createOrderedSubsystem('a', startOrder, stopOrder);
      const b = createOrderedSubsystem('b', startOrder, stopOrder, ['a']);

      // Register in arbitrary order to verify topological sort works
      mgr.register(c).register(a).register(b);
      await mgr.startAll();

      expect(startOrder).toEqual(['a', 'b', 'c']);
    });

    it('sets failed status when start() throws', async () => {
      const mgr = new LifecycleManager();
      const failing: SubsystemLifecycle = {
        name: 'broken',
        async start() {
          throw new Error('init failed');
        },
        async stop() {},
      };

      mgr.register(failing);
      await mgr.startAll();

      expect(mgr.getStatus('broken')).toBe('failed');
    });

    it('cascades failure to dependents without calling their start()', async () => {
      const mgr = new LifecycleManager();

      const a: SubsystemLifecycle = {
        name: 'a',
        async start() {
          throw new Error('a failed');
        },
        async stop() {},
      };

      const b = createMockSubsystem('b', ['a']);
      const c = createMockSubsystem('c', ['b']);

      mgr.register(a).register(b).register(c);
      await mgr.startAll();

      expect(mgr.getStatus('a')).toBe('failed');
      expect(mgr.getStatus('b')).toBe('failed');
      expect(b.startCalled).toBe(false);
      expect(mgr.getStatus('c')).toBe('failed');
      expect(c.startCalled).toBe(false);
    });

    it('marks subsystems with unknown dependencies as failed', async () => {
      const mgr = new LifecycleManager();
      const sub = createMockSubsystem('orphan', ['nonexistent']);

      mgr.register(sub);
      await mgr.startAll();

      expect(mgr.getStatus('orphan')).toBe('failed');
      expect(sub.startCalled).toBe(false);
    });

    it('continues starting independent subsystems after a failure', async () => {
      const mgr = new LifecycleManager();

      const failing: SubsystemLifecycle = {
        name: 'failing',
        async start() {
          throw new Error('boom');
        },
        async stop() {},
      };

      const independent = createMockSubsystem('independent');

      mgr.register(failing).register(independent);
      await mgr.startAll();

      expect(mgr.getStatus('failing')).toBe('failed');
      expect(mgr.getStatus('independent')).toBe('running');
      expect(independent.startCalled).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // stopAll
  // -----------------------------------------------------------------------

  describe('stopAll', () => {
    it('stops subsystems in reverse registration order', async () => {
      const mgr = new LifecycleManager();
      const startOrder: string[] = [];
      const stopOrder: string[] = [];

      const a = createOrderedSubsystem('a', startOrder, stopOrder);
      const b = createOrderedSubsystem('b', startOrder, stopOrder, ['a']);
      const c = createOrderedSubsystem('c', startOrder, stopOrder, ['b']);

      mgr.register(a).register(b).register(c);
      await mgr.startAll();
      await mgr.stopAll();

      expect(stopOrder).toEqual(['c', 'b', 'a']);
    });

    it('sets status to stopped on success', async () => {
      const mgr = new LifecycleManager();
      const sub = createMockSubsystem('db');

      mgr.register(sub);
      await mgr.startAll();
      await mgr.stopAll();

      expect(mgr.getStatus('db')).toBe('stopped');
    });

    it('skips subsystems not in running state', async () => {
      const mgr = new LifecycleManager();
      const sub = createMockSubsystem('never-started');

      mgr.register(sub);
      // Do not call startAll()
      await mgr.stopAll();

      expect(sub.stopCalled).toBe(false);
      expect(mgr.getStatus('never-started')).toBe('pending');
    });

    it('skips failed subsystems during stop', async () => {
      const mgr = new LifecycleManager();

      const failing: SubsystemLifecycle & { stopCalled: boolean } = {
        name: 'failing',
        stopCalled: false,
        async start() {
          throw new Error('start failed');
        },
        async stop() {
          this.stopCalled = true;
        },
      };

      mgr.register(failing);
      await mgr.startAll();
      await mgr.stopAll();

      expect(failing.stopCalled).toBe(false);
    });

    it('isolates stop failures so other subsystems still stop', async () => {
      const mgr = new LifecycleManager();

      const a = createMockSubsystem('a');
      const bStopper: SubsystemLifecycle & { startCalled: boolean; stopCalled: boolean } = {
        name: 'b',
        startCalled: false,
        stopCalled: false,
        async start() {
          this.startCalled = true;
        },
        async stop() {
          this.stopCalled = true;
          throw new Error('stop failed');
        },
      };
      const c = createMockSubsystem('c');

      mgr.register(a).register(bStopper).register(c);
      await mgr.startAll();
      await mgr.stopAll();

      // c is stopped first (reverse order), then b fails, then a should still be stopped
      expect(c.stopCalled).toBe(true);
      expect(bStopper.stopCalled).toBe(true);
      expect(a.stopCalled).toBe(true);
      expect(mgr.getStatus('b')).toBe('failed');
      expect(mgr.getStatus('a')).toBe('stopped');
      expect(mgr.getStatus('c')).toBe('stopped');
    });
  });

  // -----------------------------------------------------------------------
  // health
  // -----------------------------------------------------------------------

  describe('health', () => {
    it('returns current statuses for all subsystems', async () => {
      const mgr = new LifecycleManager();
      const a = createMockSubsystem('a');
      const b = createMockSubsystem('b');

      mgr.register(a).register(b);

      const healthBefore = mgr.health();
      expect(healthBefore).toEqual({
        a: { status: 'pending' },
        b: { status: 'pending' },
      });

      await mgr.startAll();

      const healthAfter = mgr.health();
      expect(healthAfter).toEqual({
        a: { status: 'running' },
        b: { status: 'running' },
      });
    });

    it('uses custom healthCheck() when provided', async () => {
      const mgr = new LifecycleManager();

      const sub: SubsystemLifecycle = {
        name: 'custom',
        async start() {},
        async stop() {},
        healthCheck(): SubsystemHealth {
          return { status: 'running', detail: 'all good, 42 items cached' };
        },
      };

      mgr.register(sub);
      await mgr.startAll();

      const h = mgr.health();
      expect(h.custom).toEqual({ status: 'running', detail: 'all good, 42 items cached' });
    });

    it('returns error details after a failed start', async () => {
      const mgr = new LifecycleManager();

      const failing: SubsystemLifecycle = {
        name: 'failing',
        async start() {
          throw new Error('connection refused');
        },
        async stop() {},
      };

      mgr.register(failing);
      await mgr.startAll();

      const h = mgr.health();
      expect(h.failing.status).toBe('failed');
    });
  });

  // -----------------------------------------------------------------------
  // getStatus
  // -----------------------------------------------------------------------

  describe('getStatus', () => {
    it('returns undefined for unregistered subsystems', () => {
      const mgr = new LifecycleManager();
      expect(mgr.getStatus('nonexistent')).toBeUndefined();
    });

    it('tracks status transitions through the lifecycle', async () => {
      const mgr = new LifecycleManager();
      const sub = createMockSubsystem('db');

      mgr.register(sub);
      expect(mgr.getStatus('db')).toBe('pending');

      await mgr.startAll();
      expect(mgr.getStatus('db')).toBe('running');

      await mgr.stopAll();
      expect(mgr.getStatus('db')).toBe('stopped');
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles subsystems with no dependencies', async () => {
      const mgr = new LifecycleManager();
      const a = createMockSubsystem('a');
      const b = createMockSubsystem('b');

      mgr.register(a).register(b);
      await mgr.startAll();

      expect(mgr.getStatus('a')).toBe('running');
      expect(mgr.getStatus('b')).toBe('running');
    });

    it('handles empty manager gracefully', async () => {
      const mgr = new LifecycleManager();

      // Should not throw
      await mgr.startAll();
      await mgr.stopAll();

      expect(mgr.health()).toEqual({});
    });

    it('handles diamond dependency (A <- B, A <- C, B <- D, C <- D)', async () => {
      const mgr = new LifecycleManager();
      const startOrder: string[] = [];
      const stopOrder: string[] = [];

      const a = createOrderedSubsystem('a', startOrder, stopOrder);
      const b = createOrderedSubsystem('b', startOrder, stopOrder, ['a']);
      const c = createOrderedSubsystem('c', startOrder, stopOrder, ['a']);
      const d = createOrderedSubsystem('d', startOrder, stopOrder, ['b', 'c']);

      mgr.register(a).register(b).register(c).register(d);
      await mgr.startAll();

      // A must come first, D must come last, B and C can be in either order
      expect(startOrder[0]).toBe('a');
      expect(startOrder[3]).toBe('d');
      expect(new Set(startOrder.slice(1, 3))).toEqual(new Set(['b', 'c']));

      // All should be running
      expect(mgr.getStatus('a')).toBe('running');
      expect(mgr.getStatus('b')).toBe('running');
      expect(mgr.getStatus('c')).toBe('running');
      expect(mgr.getStatus('d')).toBe('running');
    });

    it('handles multiple dependencies where one fails', async () => {
      const mgr = new LifecycleManager();

      const a = createMockSubsystem('a');
      const b: SubsystemLifecycle = {
        name: 'b',
        async start() {
          throw new Error('b failed');
        },
        async stop() {},
      };
      // d depends on both a (running) and b (failed)
      const d = createMockSubsystem('d', ['a', 'b']);

      mgr.register(a).register(b).register(d);
      await mgr.startAll();

      expect(mgr.getStatus('a')).toBe('running');
      expect(mgr.getStatus('b')).toBe('failed');
      expect(mgr.getStatus('d')).toBe('failed');
      expect(d.startCalled).toBe(false);
    });
  });
});
