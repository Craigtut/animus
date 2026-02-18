import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AgentOrchestrator,
  type AgentTaskStore,
  type AgentTaskRecord,
} from '../../src/heartbeat/agent-orchestrator.js';
import type { AgentManager, IAgentSession, AgentResponse, AgentLogStore } from '@animus/agents';
import type { IEventBus, AnimusEventMap } from '@animus/shared';
import type { ToolHandlerContext } from '../../src/tools/types.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockSession(overrides?: Partial<IAgentSession>): IAgentSession {
  return {
    id: 'claude:test-session-1',
    provider: 'claude',
    isActive: true,
    onEvent: vi.fn(),
    registerHooks: vi.fn(),
    prompt: vi.fn().mockResolvedValue({
      content: 'Agent result content',
      turns: [{ turnIndex: 0, text: 'Agent result content', hasToolCalls: false, hasThinking: false, toolNames: [] }],
      model: 'claude-opus-4-6',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      cost: null,
    } satisfies AgentResponse),
    promptStreaming: vi.fn(),
    cancel: vi.fn().mockResolvedValue(undefined),
    end: vi.fn().mockResolvedValue(undefined),
    getUsage: vi.fn().mockReturnValue({ inputTokens: 10, outputTokens: 20, totalTokens: 30 }),
    getCost: vi.fn().mockReturnValue(null),
    ...overrides,
  };
}

function createMockManager(session?: IAgentSession): AgentManager {
  const mockSession = session ?? createMockSession();
  return {
    createSession: vi.fn().mockResolvedValue(mockSession),
    getConfiguredProviders: vi.fn().mockReturnValue(['claude']),
    cleanup: vi.fn().mockResolvedValue(undefined),
  } as unknown as AgentManager;
}

function createMockLogStore(): AgentLogStore {
  return {
    createSession: vi.fn().mockReturnValue({ id: 'log-session-1' }),
    endSession: vi.fn(),
    insertEvent: vi.fn(),
    insertUsage: vi.fn(),
  };
}

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

function createMockToolContext(): ToolHandlerContext {
  return {
    agentTaskId: 'test-task',
    contactId: 'test-contact',
    sourceChannel: 'web',
    conversationId: 'test-conv',
    stores: {
      messages: { createMessage: vi.fn().mockReturnValue({ id: 'msg-1' }) },
      heartbeat: { updateAgentTaskProgress: vi.fn() },
      memory: { retrieveRelevant: vi.fn().mockResolvedValue([]) },
    },
    eventBus: createMockEventBus(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentOrchestrator', () => {
  let orchestrator: AgentOrchestrator;
  let manager: AgentManager;
  let taskStore: AgentTaskStore;
  let logStore: AgentLogStore;
  let eventBus: IEventBus;
  let onAgentComplete: ReturnType<typeof vi.fn>;
  let mockSession: IAgentSession;

  beforeEach(() => {
    vi.useFakeTimers();
    mockSession = createMockSession();
    manager = createMockManager(mockSession);
    taskStore = createInMemoryTaskStore();
    logStore = createMockLogStore();
    eventBus = createMockEventBus();
    onAgentComplete = vi.fn();

    orchestrator = new AgentOrchestrator({
      manager,
      taskStore,
      logStore,
      eventBus,
      buildToolContext: () => createMockToolContext(),
      onAgentComplete,
    });
  });

  describe('spawnAgent', () => {
    it('creates a task record and returns an id', async () => {
      const taskId = await orchestrator.spawnAgent({
        taskType: 'research',
        description: 'Research quantum computing',
        instructions: 'Look up recent papers on quantum error correction',
        contactId: 'contact-1',
        channel: 'web',
        tickNumber: 5,
        systemPrompt: 'You are a research assistant.',
      });

      expect(typeof taskId).toBe('string');
      expect(taskId.length).toBeGreaterThan(0);

      const task = taskStore.getAgentTask(taskId);
      expect(task).not.toBeNull();
      expect(task!.taskType).toBe('research');
      expect(task!.taskDescription).toBe('Research quantum computing');
    });

    it('emits agent:spawned event', async () => {
      await orchestrator.spawnAgent({
        taskType: 'analysis',
        description: 'Analyze data',
        instructions: 'Analyze the dataset',
        contactId: 'c1',
        channel: 'web',
        tickNumber: 1,
        systemPrompt: '',
      });

      expect(eventBus.emit).toHaveBeenCalledWith('agent:spawned', expect.objectContaining({
        provider: 'claude',
      }));
    });

    it('updates task to running after session creation', async () => {
      const taskId = await orchestrator.spawnAgent({
        taskType: 'code_generation',
        description: 'Generate code',
        instructions: 'Write a function',
        contactId: 'c1',
        channel: 'web',
        tickNumber: 1,
        systemPrompt: '',
      });

      const task = taskStore.getAgentTask(taskId);
      // Task should be running or completed (async run may have finished)
      expect(['running', 'completed']).toContain(task!.status);
    });

    it('calls onAgentComplete after the agent finishes', async () => {
      // Use real timers for this test since we need microtasks to settle
      vi.useRealTimers();

      await orchestrator.spawnAgent({
        taskType: 'research',
        description: 'Research topic',
        instructions: 'Find info',
        contactId: 'c1',
        channel: 'web',
        tickNumber: 1,
        systemPrompt: '',
      });

      // Allow the async runAgent to settle (it fires with .catch())
      await new Promise((r) => setTimeout(r, 50));

      expect(onAgentComplete).toHaveBeenCalledWith(expect.objectContaining({
        outcome: 'completed',
      }));

      // Restore fake timers for other tests
      vi.useFakeTimers();
    });

    it('handles session creation failure', async () => {
      (manager.createSession as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('API key invalid')
      );

      await expect(
        orchestrator.spawnAgent({
          taskType: 'research',
          description: 'Should fail',
          instructions: 'This will fail',
          contactId: 'c1',
          channel: 'web',
          tickNumber: 1,
          systemPrompt: '',
        })
      ).rejects.toThrow('API key invalid');

      expect(eventBus.emit).toHaveBeenCalledWith('agent:failed', expect.objectContaining({
        error: 'API key invalid',
      }));
    });
  });

  describe('cancelAgent', () => {
    it('cancels a running agent and updates status', async () => {
      // Use a blocking session so the agent stays running
      const blockingSession = createMockSession({
        prompt: vi.fn().mockImplementation(() => new Promise(() => {})),
      });
      const blockingManager = createMockManager(blockingSession);

      const blockingOrchestrator = new AgentOrchestrator({
        manager: blockingManager,
        taskStore,
        logStore,
        eventBus,
        buildToolContext: () => createMockToolContext(),
        onAgentComplete,
      });

      const taskId = await blockingOrchestrator.spawnAgent({
        taskType: 'research',
        description: 'Long task',
        instructions: 'Take your time',
        contactId: 'c1',
        channel: 'web',
        tickNumber: 1,
        systemPrompt: '',
      });

      await blockingOrchestrator.cancelAgent({
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

      await blockingOrchestrator.cleanup();
    });

    it('handles cancelling a non-existent agent gracefully', async () => {
      await expect(
        orchestrator.cancelAgent({ agentId: 'nonexistent', reason: 'test' })
      ).resolves.not.toThrow();
    });
  });

  describe('updateAgent', () => {
    it('sends new context to a running agent', async () => {
      // Use a blocking session so the agent stays running for the update
      const blockingSession = createMockSession({
        // First call (the initial instructions) blocks forever;
        // second call (the update) resolves immediately
        prompt: vi.fn()
          .mockImplementationOnce(() => new Promise(() => {}))
          .mockResolvedValue({
            content: 'Updated',
            model: 'claude-opus-4-6',
            usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
            cost: null,
          }),
      });
      const blockingManager = createMockManager(blockingSession);

      const blockingOrchestrator = new AgentOrchestrator({
        manager: blockingManager,
        taskStore,
        logStore,
        eventBus,
        buildToolContext: () => createMockToolContext(),
        onAgentComplete,
      });

      const taskId = await blockingOrchestrator.spawnAgent({
        taskType: 'research',
        description: 'Research topic',
        instructions: 'Start research',
        contactId: 'c1',
        channel: 'web',
        tickNumber: 1,
        systemPrompt: '',
      });

      await blockingOrchestrator.updateAgent({
        agentId: taskId,
        context: 'New information arrived',
      });

      // First call was the initial prompt, second was the update
      expect(blockingSession.prompt).toHaveBeenCalledTimes(2);
      expect(blockingSession.prompt).toHaveBeenLastCalledWith('New information arrived');

      await blockingOrchestrator.cleanup();
    });

    it('handles updating a non-existent agent gracefully', async () => {
      await expect(
        orchestrator.updateAgent({ agentId: 'nonexistent', context: 'test' })
      ).resolves.not.toThrow();
    });
  });

  describe('getRunningTasks', () => {
    it('returns running tasks', async () => {
      // Make the session block so it stays running
      const blockingSession = createMockSession({
        prompt: vi.fn().mockImplementation(() => new Promise(() => {})),
      });
      const blockingManager = createMockManager(blockingSession);

      const blockingOrchestrator = new AgentOrchestrator({
        manager: blockingManager,
        taskStore,
        logStore,
        eventBus,
        buildToolContext: () => createMockToolContext(),
        onAgentComplete,
      });

      await blockingOrchestrator.spawnAgent({
        taskType: 'research',
        description: 'Running task',
        instructions: 'Will stay running',
        contactId: 'c1',
        channel: 'web',
        tickNumber: 1,
        systemPrompt: '',
      });

      const running = blockingOrchestrator.getRunningTasks();
      expect(running.length).toBe(1);
      expect(running[0]!.taskDescription).toBe('Running task');
    });
  });

  describe('cleanup', () => {
    it('ends all active sessions', async () => {
      // Block the session to keep it active
      const blockingSession = createMockSession({
        prompt: vi.fn().mockImplementation(() => new Promise(() => {})),
      });
      const blockingManager = createMockManager(blockingSession);

      const blockingOrchestrator = new AgentOrchestrator({
        manager: blockingManager,
        taskStore,
        logStore,
        eventBus,
        buildToolContext: () => createMockToolContext(),
        onAgentComplete,
      });

      await blockingOrchestrator.spawnAgent({
        taskType: 'research',
        description: 'Task 1',
        instructions: 'Work',
        contactId: 'c1',
        channel: 'web',
        tickNumber: 1,
        systemPrompt: '',
      });

      await blockingOrchestrator.cleanup();
      expect(blockingSession.end).toHaveBeenCalled();
    });
  });

  describe('timeout handling', () => {
    it('times out agents after the configured timeout', async () => {
      // Use a blocking session that never completes
      const blockingSession = createMockSession({
        prompt: vi.fn().mockImplementation(() => new Promise(() => {})),
      });
      const blockingManager = createMockManager(blockingSession);

      const timeoutOrchestrator = new AgentOrchestrator({
        manager: blockingManager,
        taskStore,
        logStore,
        eventBus,
        buildToolContext: () => createMockToolContext(),
        onAgentComplete,
      });

      const taskId = await timeoutOrchestrator.spawnAgent({
        taskType: 'research',
        description: 'Slow task',
        instructions: 'This will timeout',
        contactId: 'c1',
        channel: 'web',
        tickNumber: 1,
        systemPrompt: '',
      });

      // Research timeout is 5 minutes = 300,000 ms
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100);

      const task = taskStore.getAgentTask(taskId);
      expect(task!.status).toBe('timed_out');

      expect(onAgentComplete).toHaveBeenCalledWith(expect.objectContaining({
        outcome: 'timed_out',
      }));

      await timeoutOrchestrator.cleanup();
    });
  });
});
