import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SubAgentManager } from '../../src/sub-agent-manager.js';
import type { SubAgentResult, TrackedSubAgent } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTrackedEntry(overrides?: Partial<TrackedSubAgent>): TrackedSubAgent {
  let resolveCompletion!: (result: SubAgentResult) => void;
  const completion = new Promise<SubAgentResult>((resolve) => {
    resolveCompletion = resolve;
  });

  return {
    taskId: overrides?.taskId ?? 'task-1',
    agent: overrides?.agent ?? {},
    instructions: overrides?.instructions ?? 'Test instructions',
    background: overrides?.background ?? false,
    spawnedAt: overrides?.spawnedAt ?? Date.now(),
    completion: overrides?.completion ?? completion,
    resolve: overrides?.resolve ?? resolveCompletion,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SubAgentManager', () => {
  let manager: SubAgentManager;

  beforeEach(() => {
    manager = new SubAgentManager({ maxConcurrent: 3 });
  });

  describe('canSpawn', () => {
    it('returns true when under the limit', () => {
      expect(manager.canSpawn()).toBe(true);
    });

    it('returns false when at the limit', () => {
      manager.track(createTrackedEntry({ taskId: 'a' }));
      manager.track(createTrackedEntry({ taskId: 'b' }));
      manager.track(createTrackedEntry({ taskId: 'c' }));
      expect(manager.canSpawn()).toBe(false);
    });

    it('returns true again after a sub-agent completes', () => {
      manager.track(createTrackedEntry({ taskId: 'a' }));
      manager.track(createTrackedEntry({ taskId: 'b' }));
      manager.track(createTrackedEntry({ taskId: 'c' }));
      expect(manager.canSpawn()).toBe(false);

      manager.complete('b', {
        output: 'done',
        status: 'completed',
        usage: { turns: 1, cost: 0.01, durationMs: 100 },
      });
      expect(manager.canSpawn()).toBe(true);
    });
  });

  describe('track', () => {
    it('adds a sub-agent entry and increments activeCount', () => {
      expect(manager.activeCount).toBe(0);
      const tracked = manager.track(createTrackedEntry());
      expect(tracked).toBe(true);
      expect(manager.activeCount).toBe(1);
    });

    it('returns false when the concurrency limit is reached', () => {
      manager.track(createTrackedEntry({ taskId: 'a' }));
      manager.track(createTrackedEntry({ taskId: 'b' }));
      manager.track(createTrackedEntry({ taskId: 'c' }));
      const result = manager.track(createTrackedEntry({ taskId: 'd' }));
      expect(result).toBe(false);
      expect(manager.activeCount).toBe(3);
    });
  });

  describe('complete', () => {
    it('removes the entry from tracking', () => {
      manager.track(createTrackedEntry({ taskId: 'task-1' }));
      expect(manager.activeCount).toBe(1);

      manager.complete('task-1', {
        output: 'result',
        status: 'completed',
        usage: { turns: 2, cost: 0.02, durationMs: 500 },
      });

      expect(manager.activeCount).toBe(0);
      expect(manager.get('task-1')).toBeUndefined();
    });

    it('resolves the completion promise', async () => {
      const entry = createTrackedEntry({ taskId: 'task-1' });
      manager.track(entry);

      const result: SubAgentResult = {
        output: 'test result',
        status: 'completed',
        usage: { turns: 3, cost: 0.05, durationMs: 1000 },
      };

      manager.complete('task-1', result);
      const completed = await entry.completion;
      expect(completed.output).toBe('test result');
      expect(completed.status).toBe('completed');
    });

    it('fires the onCompleted hook', () => {
      const onCompleted = vi.fn();
      manager.setHooks({ onCompleted });

      manager.track(createTrackedEntry({ taskId: 'task-1' }));
      manager.complete('task-1', {
        output: 'done',
        status: 'completed',
        usage: { turns: 1, cost: 0, durationMs: 50 },
      });

      expect(onCompleted).toHaveBeenCalledWith(
        'task-1',
        'done',
        'completed',
        { turns: 1, cost: 0, durationMs: 50 },
      );
    });
  });

  describe('fail', () => {
    it('removes the entry and resolves as failed', async () => {
      const entry = createTrackedEntry({ taskId: 'task-1' });
      manager.track(entry);

      manager.fail('task-1', 'something went wrong');

      expect(manager.activeCount).toBe(0);
      const result = await entry.completion;
      expect(result.status).toBe('failed');
      expect(result.output).toBe('');
    });

    it('fires the onFailed hook', () => {
      const onFailed = vi.fn();
      manager.setHooks({ onFailed });

      manager.track(createTrackedEntry({ taskId: 'task-1' }));
      manager.fail('task-1', 'oops');

      expect(onFailed).toHaveBeenCalledWith('task-1', 'oops');
    });
  });

  describe('lifecycle hooks', () => {
    it('fires onSpawned when track is called', () => {
      const onSpawned = vi.fn();
      manager.setHooks({ onSpawned });

      manager.track(createTrackedEntry({ taskId: 'task-1', instructions: 'do stuff' }));
      expect(onSpawned).toHaveBeenCalledWith('task-1', 'do stuff');
    });

    it('swallows errors in hooks', () => {
      manager.setHooks({
        onSpawned: () => { throw new Error('hook error'); },
      });

      // Should not throw
      expect(() => {
        manager.track(createTrackedEntry());
      }).not.toThrow();
    });
  });

  describe('getBackgroundCompletions', () => {
    it('returns only background sub-agents', () => {
      manager.track(createTrackedEntry({ taskId: 'fg', background: false }));
      manager.track(createTrackedEntry({ taskId: 'bg1', background: true }));
      manager.track(createTrackedEntry({ taskId: 'bg2', background: true }));

      const completions = manager.getBackgroundCompletions();
      expect(completions).toHaveLength(2);
      expect(completions.map(c => c.taskId)).toEqual(['bg1', 'bg2']);
    });
  });

  describe('cancelAll', () => {
    it('cancels all active sub-agents', async () => {
      const abortFn = vi.fn().mockResolvedValue(undefined);

      manager.track(createTrackedEntry({ taskId: 'a' }));
      manager.track(createTrackedEntry({ taskId: 'b' }));

      await manager.cancelAll(abortFn);

      expect(abortFn).toHaveBeenCalledTimes(2);
      expect(manager.activeCount).toBe(0);
    });

    it('resolves completion promises as cancelled', async () => {
      const entryA = createTrackedEntry({ taskId: 'a' });
      const entryB = createTrackedEntry({ taskId: 'b' });
      manager.track(entryA);
      manager.track(entryB);

      await manager.cancelAll(vi.fn().mockResolvedValue(undefined));

      const resultA = await entryA.completion;
      expect(resultA.status).toBe('cancelled');

      const resultB = await entryB.completion;
      expect(resultB.status).toBe('cancelled');
    });

    it('fires onFailed hooks for each cancelled agent', async () => {
      const onFailed = vi.fn();
      manager.setHooks({ onFailed });

      manager.track(createTrackedEntry({ taskId: 'a' }));
      manager.track(createTrackedEntry({ taskId: 'b' }));

      await manager.cancelAll(vi.fn().mockResolvedValue(undefined));

      expect(onFailed).toHaveBeenCalledTimes(2);
      expect(onFailed).toHaveBeenCalledWith('a', 'Parent agent destroyed');
      expect(onFailed).toHaveBeenCalledWith('b', 'Parent agent destroyed');
    });
  });

  describe('destroy', () => {
    it('clears all state', () => {
      manager.track(createTrackedEntry({ taskId: 'a' }));
      manager.track(createTrackedEntry({ taskId: 'b' }));

      manager.destroy();

      expect(manager.activeCount).toBe(0);
      expect(manager.getActiveTaskIds()).toHaveLength(0);
    });
  });

  describe('defaults', () => {
    it('defaults to maxConcurrent 4', () => {
      const defaultManager = new SubAgentManager();
      expect(defaultManager.limit).toBe(4);
    });
  });
});
