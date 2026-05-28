import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AgentOrchestrator,
  type AgentTaskStore,
  type AgentTaskRecord,
} from '../../src/heartbeat/agent-orchestrator.js';
import type { IEventBus } from '@animus-labs/shared';
import type { CortexAgent, SubAgentManager } from '@animus-labs/cortex';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockEventBus(): IEventBus {
  const handlers = new Map<string, Set<(...args: any[]) => void>>();
  return {
    on: vi.fn((event: string, handler: any) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
    }),
    off: vi.fn((event: string, handler: any) => {
      handlers.get(event)?.delete(handler);
    }),
    emit: vi.fn((event: string, data: any) => {
      handlers.get(event)?.forEach((h) => h(data));
    }),
  } as unknown as IEventBus;
}

function createInMemoryTaskStore(): AgentTaskStore {
  const tasks = new Map<string, AgentTaskRecord>();
  return {
    insertAgentTask(data) {
      tasks.set(data.id, {
        id: data.id,
        tickNumber: data.tickNumber,
        sessionId: data.sessionId,
        provider: data.provider,
        status: data.status as AgentTaskRecord['status'],
        taskType: data.taskType,
        taskDescription: data.taskDescription,
        parentTaskId: data.parentTaskId ?? null,
        contactId: data.contactId,
        sourceChannel: data.sourceChannel,
        currentActivity: null,
        result: null,
        error: null,
        createdAt: data.createdAt,
        startedAt: null,
        completedAt: null,
        inputTokens: 0,
        outputTokens: 0,
        totalCostUsd: 0,
      });
    },
    updateAgentTask(id, data) {
      const task = tasks.get(id);
      if (task) Object.assign(task, data);
    },
    getAgentTask(id) {
      return tasks.get(id) ?? null;
    },
    getRunningAgentTasks() {
      return Array.from(tasks.values()).filter(
        (t) => t.status === 'running' || t.status === 'spawning'
      );
    },
  };
}

/** Create a mock SubAgentManager that tracks sub-agents. */
function createMockSubAgentManager(opts?: { canSpawn?: boolean }): SubAgentManager {
  const tracked = new Map<string, { agent: unknown; instructions: string }>();
  return {
    canSpawn: vi.fn().mockReturnValue(opts?.canSpawn ?? true),
    get activeCount() { return tracked.size; },
    limit: 5,
    get: vi.fn((id: string) => tracked.get(id) ?? undefined),
    fail: vi.fn((id: string) => { tracked.delete(id); }),
    spawn: vi.fn(),
  } as unknown as SubAgentManager;
}

/** Create a mock CortexAgent with a SubAgentManager. */
function createMockCortexAgent(subAgentManager?: SubAgentManager): CortexAgent {
  const sam = subAgentManager ?? createMockSubAgentManager();
  let spawnCount = 0;
  return {
    getSubAgentManager: vi.fn().mockReturnValue(sam),
    spawnBackgroundSubAgent: vi.fn(async () => {
      spawnCount += 1;
      return { taskId: `sub-agent-${spawnCount}` };
    }),
    steer: vi.fn(),
    abort: vi.fn().mockResolvedValue(undefined),
    onSubAgentSpawned: vi.fn(),
    onSubAgentCompleted: vi.fn(),
    onSubAgentFailed: vi.fn(),
  } as unknown as CortexAgent;
}

/**
 * Seed a running sub-agent task record directly. Spawning is no longer an
 * orchestrator method (it happens in-loop via Cortex's SubAgent tool, tracked
 * through onBeforeSubAgentSpawn); the orchestrator now only steers, cancels,
 * and reports tasks that already exist in the store.
 */
function seedRunningTask(taskStore: AgentTaskStore, id = 'sub-agent-1'): string {
  taskStore.insertAgentTask({
    id,
    tickNumber: 5,
    sessionId: null,
    provider: 'cortex',
    status: 'running',
    taskType: 'research',
    taskDescription: 'Research quantum computing',
    contactId: 'contact-1',
    sourceChannel: 'web',
    createdAt: new Date().toISOString(),
  });
  taskStore.updateAgentTask(id, { startedAt: new Date().toISOString() });
  return id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentOrchestrator', () => {
  let orchestrator: AgentOrchestrator;
  let taskStore: AgentTaskStore;
  let eventBus: IEventBus;
  let onAgentComplete: ReturnType<typeof vi.fn>;
  let cortexAgent: CortexAgent;
  let subAgentManager: SubAgentManager;

  beforeEach(() => {
    vi.useFakeTimers();
    taskStore = createInMemoryTaskStore();
    eventBus = createMockEventBus();
    onAgentComplete = vi.fn();
    subAgentManager = createMockSubAgentManager();
    cortexAgent = createMockCortexAgent(subAgentManager);

    orchestrator = new AgentOrchestrator({
      taskStore,
      eventBus,
      onAgentComplete,
    });
    orchestrator.setCortexAgent(cortexAgent);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('cancelAgent', () => {
    it('cancels a tracked sub-agent and updates status', async () => {
      const taskId = seedRunningTask(taskStore);

      // Mock the sub-agent as tracked
      const mockSubAgent = { abort: vi.fn().mockResolvedValue(undefined) };
      (subAgentManager.get as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        agent: mockSubAgent,
        instructions: 'test',
      });

      await orchestrator.cancelAgent({
        agentId: taskId,
        reason: 'No longer needed',
      });

      const task = taskStore.getAgentTask(taskId);
      expect(task!.status).toBe('cancelled');
      expect(task!.error).toBe('No longer needed');

      expect(eventBus.emit).toHaveBeenCalledWith('agent:cancelled', expect.objectContaining({
        taskId,
        reason: 'No longer needed',
      }));
    });

    it('handles cancelling a non-existent agent gracefully', async () => {
      await expect(
        orchestrator.cancelAgent({ agentId: 'nonexistent', reason: 'test' })
      ).resolves.not.toThrow();
    });
  });

  describe('updateAgent', () => {
    it('steers a tracked sub-agent', async () => {
      const taskId = seedRunningTask(taskStore);

      const mockSubAgent = { steer: vi.fn() };
      (subAgentManager.get as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        agent: mockSubAgent,
        instructions: 'test',
      });

      await orchestrator.updateAgent({
        agentId: taskId,
        context: 'New information arrived',
      });

      expect(mockSubAgent.steer).toHaveBeenCalledWith('New information arrived');
    });

    it('handles updating a non-existent agent gracefully', async () => {
      await expect(
        orchestrator.updateAgent({ agentId: 'nonexistent', context: 'test' })
      ).resolves.not.toThrow();
    });

    it('warns when no CortexAgent is configured', async () => {
      const noAgentOrchestrator = new AgentOrchestrator({
        taskStore,
        eventBus,
        onAgentComplete,
      });

      // Should not throw, just log a warning
      await expect(
        noAgentOrchestrator.updateAgent({ agentId: 'some-id', context: 'test' })
      ).resolves.not.toThrow();
    });
  });

  describe('getRunningTasks', () => {
    it('returns running tasks from the task store', async () => {
      seedRunningTask(taskStore);

      const running = orchestrator.getRunningTasks();
      expect(running.length).toBe(1);
      expect(running[0]!.taskDescription).toBe('Research quantum computing');
    });
  });

  describe('isAgentRunning', () => {
    it('returns true when sub-agent is tracked by cortex', () => {
      (subAgentManager.get as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        agent: {},
        instructions: 'test',
      });

      expect(orchestrator.isAgentRunning('some-id')).toBe(true);
    });

    it('returns false when sub-agent is not tracked', () => {
      (subAgentManager.get as ReturnType<typeof vi.fn>).mockReturnValueOnce(undefined);

      expect(orchestrator.isAgentRunning('unknown-id')).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('clears the cortex reference', async () => {
      seedRunningTask(taskStore);
      await orchestrator.cleanup();

      // After cleanup, cortexAgent is null, so isAgentRunning returns false
      expect(orchestrator.isAgentRunning('any-id')).toBe(false);
    });
  });

  describe('long-running agents', () => {
    it('does not impose a wall-clock timeout on Cortex sub-agents', async () => {
      const taskId = seedRunningTask(taskStore);

      await vi.advanceTimersByTimeAsync(30 * 60 * 1000);

      const task = taskStore.getAgentTask(taskId);
      expect(task!.status).toBe('running');
      expect(onAgentComplete).not.toHaveBeenCalled();
    });
  });

});
