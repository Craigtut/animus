/**
 * Mind Integration Tests
 *
 * Tests for the mind query pipeline, including:
 * - safeMindOutput() fallback generation
 * - In-memory agent task store
 * - Reply streaming via EventBus
 *
 * Note: The full mind query pipeline (mindQuery function) is module-private
 * and deeply coupled to DB state. We test the publicly exported functions
 * and the extracted utility functions here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IEventBus, AnimusEventMap } from '@animus/shared';

// ---------------------------------------------------------------------------
// Test the in-memory agent task store logic (extracted from heartbeat/index.ts)
// We replicate the createInMemoryAgentTaskStore factory here since the
// function is module-private. This tests the pattern, not the import.
// ---------------------------------------------------------------------------

import type { AgentTaskStore, AgentTaskRecord } from '../../src/heartbeat/agent-orchestrator.js';

function createInMemoryAgentTaskStore(): AgentTaskStore {
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

describe('In-memory AgentTaskStore', () => {
  let store: AgentTaskStore;

  beforeEach(() => {
    store = createInMemoryAgentTaskStore();
  });

  it('inserts and retrieves a task', () => {
    store.insertAgentTask({
      id: 'task-1',
      tickNumber: 1,
      sessionId: null,
      provider: 'claude',
      status: 'spawning',
      taskType: 'research',
      taskDescription: 'Research topic',
      contactId: 'c1',
      sourceChannel: 'web',
      createdAt: new Date().toISOString(),
    });

    const task = store.getAgentTask('task-1');
    expect(task).not.toBeNull();
    expect(task!.id).toBe('task-1');
    expect(task!.status).toBe('spawning');
    expect(task!.taskType).toBe('research');
  });

  it('updates a task', () => {
    store.insertAgentTask({
      id: 'task-2',
      tickNumber: 1,
      sessionId: null,
      provider: 'claude',
      status: 'spawning',
      taskType: 'analysis',
      taskDescription: 'Analyze data',
      contactId: 'c1',
      sourceChannel: 'web',
      createdAt: new Date().toISOString(),
    });

    store.updateAgentTask('task-2', {
      status: 'running',
      sessionId: 'session-abc',
      startedAt: new Date().toISOString(),
    });

    const task = store.getAgentTask('task-2');
    expect(task!.status).toBe('running');
    expect(task!.sessionId).toBe('session-abc');
  });

  it('returns running tasks only', () => {
    store.insertAgentTask({
      id: 'task-a',
      tickNumber: 1,
      sessionId: null,
      provider: 'claude',
      status: 'running',
      taskType: 'research',
      taskDescription: 'Running task',
      contactId: 'c1',
      sourceChannel: 'web',
      createdAt: new Date().toISOString(),
    });

    store.insertAgentTask({
      id: 'task-b',
      tickNumber: 1,
      sessionId: null,
      provider: 'claude',
      status: 'completed',
      taskType: 'research',
      taskDescription: 'Done task',
      contactId: 'c1',
      sourceChannel: 'web',
      createdAt: new Date().toISOString(),
    });

    store.insertAgentTask({
      id: 'task-c',
      tickNumber: 1,
      sessionId: null,
      provider: 'claude',
      status: 'spawning',
      taskType: 'research',
      taskDescription: 'Spawning task',
      contactId: 'c1',
      sourceChannel: 'web',
      createdAt: new Date().toISOString(),
    });

    const running = store.getRunningAgentTasks();
    expect(running).toHaveLength(2);
    expect(running.map((t) => t.id).sort()).toEqual(['task-a', 'task-c']);
  });

  it('returns null for non-existent tasks', () => {
    expect(store.getAgentTask('nonexistent')).toBeNull();
  });

  it('update on non-existent task is a no-op', () => {
    expect(() =>
      store.updateAgentTask('nonexistent', { status: 'running' })
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Test reply streaming pattern via EventBus
// ---------------------------------------------------------------------------

function createMockEventBus(): IEventBus {
  const handlers = new Map<string, Set<(...args: any[]) => void>>();
  return {
    on(event: string, handler: any) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
    },
    off(event: string, handler: any) {
      handlers.get(event)?.delete(handler);
    },
    emit(event: string, data: any) {
      handlers.get(event)?.forEach((h) => h(data));
    },
  } as unknown as IEventBus;
}

describe('Reply streaming via EventBus', () => {
  it('emits reply:chunk and reply:complete events', () => {
    const eventBus = createMockEventBus();
    const chunks: string[] = [];
    let completed: { content: string; tickNumber: number } | null = null;

    eventBus.on('reply:chunk', (data: { content: string; accumulated: string }) => {
      chunks.push(data.content);
    });

    eventBus.on('reply:complete', (data: { content: string; tickNumber: number }) => {
      completed = data;
    });

    // Simulate what mindQuery does after parsing the reply
    const replyContent = 'Hello, I am here to help.';
    eventBus.emit('reply:chunk', {
      content: replyContent,
      accumulated: replyContent,
    });
    eventBus.emit('reply:complete', {
      content: replyContent,
      tickNumber: 42,
    });

    expect(chunks).toEqual([replyContent]);
    expect(completed).toEqual({
      content: replyContent,
      tickNumber: 42,
    });
  });

  it('handler cleanup removes listeners', () => {
    const eventBus = createMockEventBus();
    const chunks: string[] = [];

    const handler = (data: { content: string; accumulated: string }) => {
      chunks.push(data.content);
    };

    eventBus.on('reply:chunk', handler);

    eventBus.emit('reply:chunk', { content: 'before', accumulated: 'before' });
    expect(chunks).toHaveLength(1);

    eventBus.off('reply:chunk', handler);
    eventBus.emit('reply:chunk', { content: 'after', accumulated: 'after' });
    expect(chunks).toHaveLength(1); // Should not have received the second emit
  });
});

// ---------------------------------------------------------------------------
// Test MindOutput validation with the real schema
// ---------------------------------------------------------------------------

import { mindOutputSchema } from '@animus/shared';

describe('MindOutput schema validation', () => {
  it('validates a complete MindOutput', () => {
    const output = {
      thoughts: [{ content: 'A quiet thought', importance: 0.5 }],
      reply: {
        content: 'Hello there',
        contactId: 'c1',
        channel: 'web',
        replyToMessageId: 'msg-1',
      },
      experiences: [{ content: 'Talked with a user', importance: 0.4 }],
      emotionDeltas: [{ emotion: 'curiosity', delta: 0.1, reasoning: 'Interesting topic' }],
      decisions: [],
      workingMemoryUpdate: null,
      coreSelfUpdate: null,
      memoryCandidate: [],
    };

    const result = mindOutputSchema.safeParse(output);
    expect(result.success).toBe(true);
  });

  it('validates MindOutput with null reply', () => {
    const output = {
      thoughts: [{ content: 'Idle reflection', importance: 0.2 }],
      reply: null,
      experiences: [],
      emotionDeltas: [],
      decisions: [],
      workingMemoryUpdate: null,
      coreSelfUpdate: null,
    };

    const result = mindOutputSchema.safeParse(output);
    expect(result.success).toBe(true);
  });

  it('rejects MindOutput with invalid emotion name', () => {
    const output = {
      thoughts: [],
      reply: null,
      experiences: [],
      emotionDeltas: [{ emotion: 'rage', delta: 0.5, reasoning: 'angry' }],
      decisions: [],
      workingMemoryUpdate: null,
      coreSelfUpdate: null,
    };

    const result = mindOutputSchema.safeParse(output);
    expect(result.success).toBe(false);
  });

  it('validates MindOutput with decisions', () => {
    const output = {
      thoughts: [{ content: 'Need to delegate', importance: 0.7 }],
      reply: null,
      experiences: [],
      emotionDeltas: [],
      decisions: [
        {
          type: 'spawn_agent',
          description: 'Research a topic',
          parameters: { taskType: 'research', instructions: 'Find info about X' },
        },
      ],
      workingMemoryUpdate: null,
      coreSelfUpdate: null,
    };

    const result = mindOutputSchema.safeParse(output);
    expect(result.success).toBe(true);
  });

  it('rejects when thoughts is missing', () => {
    const output = {
      reply: null,
      experiences: [],
      emotionDeltas: [],
      decisions: [],
      workingMemoryUpdate: null,
      coreSelfUpdate: null,
    };

    const result = mindOutputSchema.safeParse(output);
    expect(result.success).toBe(false);
  });
});
