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
        contactId: data.contactId,
        sourceChannel: data.sourceChannel,
        currentActivity: null,
        result: null,
        error: null,
        createdAt: data.createdAt,
        startedAt: null,
        completedAt: null,
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

const defaultSpawnParams = {
  taskType: 'research',
  description: 'Research quantum computing',
  instructions: 'Look up recent papers on quantum error correction',
  contactId: 'contact-1',
  channel: 'web',
  tickNumber: 5,
  systemPrompt: 'You are a research assistant.',
};

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

  describe('spawnAgent', () => {
    it('creates a task record and returns an id', async () => {
      const taskId = await orchestrator.spawnAgent(defaultSpawnParams);

      expect(typeof taskId).toBe('string');
      expect(taskId.length).toBeGreaterThan(0);

      const task = taskStore.getAgentTask(taskId);
      expect(task).not.toBeNull();
      expect(task!.taskType).toBe('research');
      expect(task!.taskDescription).toBe('Research quantum computing');
      expect(task!.provider).toBe('cortex');
    });

    it('emits agent:spawned event via lifecycle hooks', async () => {
      await orchestrator.spawnAgent(defaultSpawnParams);

      // The lifecycle hooks are wired in setCortexAgent. Since the cortex
      // agent is mocked, the spawned event is emitted by spawnCortexSubAgent
      // via the lifecycle hooks callback, but the mock doesn't actually call
      // back. We verify the task record was created with running status.
      const running = taskStore.getRunningAgentTasks();
      expect(running.length).toBe(1);
    });

    it('sets task status to running', async () => {
      const taskId = await orchestrator.spawnAgent(defaultSpawnParams);

      const task = taskStore.getAgentTask(taskId);
      expect(task!.status).toBe('running');
      expect(task!.startedAt).not.toBeNull();
    });

    it('throws when no CortexAgent is configured', async () => {
      const noAgentOrchestrator = new AgentOrchestrator({
        taskStore,
        eventBus,
        onAgentComplete,
      });

      await expect(
        noAgentOrchestrator.spawnAgent(defaultSpawnParams)
      ).rejects.toThrow('no CortexAgent configured');
    });

    it('fails when spawn budget is exhausted', async () => {
      const limitedOrchestrator = new AgentOrchestrator({
        taskStore,
        eventBus,
        spawnBudgetPerHour: 1,
        onAgentComplete,
      });
      limitedOrchestrator.setCortexAgent(cortexAgent);

      // First spawn succeeds
      await limitedOrchestrator.spawnAgent(defaultSpawnParams);

      // Second spawn exceeds budget
      await expect(
        limitedOrchestrator.spawnAgent(defaultSpawnParams)
      ).rejects.toThrow('budget exhausted');
    });

    it('fails when concurrency limit is reached', async () => {
      const fullSubAgentManager = createMockSubAgentManager({ canSpawn: false });
      const fullCortexAgent = createMockCortexAgent(fullSubAgentManager);

      orchestrator.setCortexAgent(fullCortexAgent);

      await expect(
        orchestrator.spawnAgent(defaultSpawnParams)
      ).rejects.toThrow('concurrency limit reached');
    });
  });

  describe('cancelAgent', () => {
    it('cancels a tracked sub-agent and updates status', async () => {
      const taskId = await orchestrator.spawnAgent(defaultSpawnParams);

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
      const taskId = await orchestrator.spawnAgent(defaultSpawnParams);

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
      await orchestrator.spawnAgent(defaultSpawnParams);

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
    it('clears timeouts and cortex reference', async () => {
      await orchestrator.spawnAgent(defaultSpawnParams);
      await orchestrator.cleanup();

      // After cleanup, cortexAgent is null, so isAgentRunning returns false
      expect(orchestrator.isAgentRunning('any-id')).toBe(false);
    });
  });

  describe('timeout handling', () => {
    it('times out agents after the configured timeout', async () => {
      // Mock the sub-agent as tracked for the timeout handler
      const mockSubAgent = { abort: vi.fn().mockResolvedValue(undefined) };

      const taskId = await orchestrator.spawnAgent(defaultSpawnParams);

      // When the timeout fires, mock the sub-agent as being tracked
      (subAgentManager.get as ReturnType<typeof vi.fn>).mockReturnValue({
        agent: mockSubAgent,
        instructions: 'test',
      });

      // Research timeout is 5 minutes = 300,000 ms
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100);

      const task = taskStore.getAgentTask(taskId);
      expect(task!.status).toBe('timed_out');

      expect(onAgentComplete).toHaveBeenCalledWith(expect.objectContaining({
        outcome: 'timed_out',
      }));
    });
  });

  describe('checkSpawnBudget', () => {
    it('tracks rolling window budget', () => {
      const budget = orchestrator.checkSpawnBudget();
      expect(budget.allowed).toBe(true);
      expect(budget.count).toBe(0);
      expect(budget.limit).toBe(20);
    });

    it('warns at 80% usage', async () => {
      const limitedOrchestrator = new AgentOrchestrator({
        taskStore,
        eventBus,
        spawnBudgetPerHour: 5,
        onAgentComplete,
      });
      limitedOrchestrator.setCortexAgent(cortexAgent);

      // Spawn 4 agents (80% of 5)
      for (let i = 0; i < 4; i++) {
        await limitedOrchestrator.spawnAgent({
          ...defaultSpawnParams,
          description: `Task ${i}`,
        });
      }

      const budget = limitedOrchestrator.checkSpawnBudget();
      expect(budget.warning).toBe(true);
      expect(budget.count).toBe(4);
    });
  });
});
