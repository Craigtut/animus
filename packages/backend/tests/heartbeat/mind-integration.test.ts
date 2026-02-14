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

// ---------------------------------------------------------------------------
// Test incremental JSON streaming via llm-json-stream
// ---------------------------------------------------------------------------

import { JsonStream } from 'llm-json-stream';

/**
 * Helper: creates the same async chunk channel used in the heartbeat module.
 * This is a copy of the module-private function for testing purposes.
 */
function createChunkChannel(): {
  push: (chunk: string) => void;
  end: () => void;
  iterable: AsyncIterable<string>;
} {
  let resolve: ((value: IteratorResult<string>) => void) | null = null;
  const buffer: string[] = [];
  let done = false;

  const iterable: AsyncIterable<string> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<string>> {
          if (buffer.length > 0) {
            return Promise.resolve({ value: buffer.shift()!, done: false });
          }
          if (done) {
            return Promise.resolve({ value: undefined as any, done: true });
          }
          return new Promise((r) => { resolve = r; });
        },
      };
    },
  };

  return {
    push(chunk: string) {
      if (resolve) {
        const r = resolve;
        resolve = null;
        r({ value: chunk, done: false });
      } else {
        buffer.push(chunk);
      }
    },
    end() {
      done = true;
      if (resolve) {
        const r = resolve;
        resolve = null;
        r({ value: undefined as any, done: true });
      }
    },
    iterable,
  };
}

describe('Incremental reply streaming via llm-json-stream', () => {
  it('emits reply:chunk events incrementally as JSON streams in', async () => {
    const eventBus = createMockEventBus();
    const chunks: { content: string; accumulated: string }[] = [];

    eventBus.on('reply:chunk', (data: { content: string; accumulated: string }) => {
      chunks.push({ ...data });
    });

    // Simulate what mindQuery does: feed JSON character-by-character through
    // the chunk channel and consume reply.content incrementally
    const channel = createChunkChannel();
    const parser = JsonStream.parse(channel.iterable);
    const replyContentStream = parser.get<string>('reply.content');

    let replyAccumulated = '';
    const replyPromise = (async () => {
      for await (const chunk of replyContentStream) {
        replyAccumulated += chunk;
        eventBus.emit('reply:chunk', { content: chunk, accumulated: replyAccumulated });
      }
    })();

    // Feed a complete MindOutput JSON, simulating an LLM streaming tokens
    const json = JSON.stringify({
      thought: { content: 'Thinking about things', importance: 0.5 },
      reply: {
        content: 'Hello world',
        contactId: 'c1',
        channel: 'web',
        replyToMessageId: 'msg-1',
      },
      experience: { content: 'Had a chat', importance: 0.3 },
      emotionDeltas: [],
      decisions: [],
      workingMemoryUpdate: null,
      coreSelfUpdate: null,
      memoryCandidate: [],
    });

    // Feed character-by-character to simulate LLM streaming
    for (const char of json) {
      channel.push(char);
    }
    channel.end();

    await replyPromise;
    await parser.dispose();

    // Verify we got incremental chunks (not a single bulk emission)
    expect(chunks.length).toBeGreaterThan(1);

    // Verify the final accumulated value matches the reply content
    const lastChunk = chunks[chunks.length - 1]!;
    expect(lastChunk.accumulated).toBe('Hello world');

    // Verify accumulated values are monotonically growing
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.accumulated.length).toBeGreaterThan(chunks[i - 1]!.accumulated.length);
    }
  });

  it('handles null reply gracefully (parser stream ends without error)', async () => {
    const channel = createChunkChannel();
    const parser = JsonStream.parse(channel.iterable);
    const replyContentStream = parser.get<string>('reply.content');

    // Catch the internal promise rejection (fires when path not found in JSON)
    // This prevents unhandled rejection warnings
    (replyContentStream as Promise<string>).catch(() => {});

    let replyAccumulated = '';
    const replyPromise = (async () => {
      try {
        for await (const chunk of replyContentStream) {
          replyAccumulated += chunk;
        }
      } catch {
        // Expected: parser rejects when reply.content doesn't exist (reply is null)
      }
    })();

    // Feed JSON with null reply
    const json = JSON.stringify({
      thought: { content: 'Idle', importance: 0.1 },
      reply: null,
      experience: { content: 'Quiet', importance: 0.1 },
      emotionDeltas: [],
      decisions: [],
      workingMemoryUpdate: null,
      coreSelfUpdate: null,
      memoryCandidate: [],
    });

    for (const char of json) {
      channel.push(char);
    }
    channel.end();

    await replyPromise;
    await parser.dispose();

    // With null reply, the stream errors or yields nothing — both acceptable
    // The key is it doesn't hang or throw an unhandled rejection
    expect(replyAccumulated).toBe('');
  });

  it('streams reply in multi-character chunks', async () => {
    const channel = createChunkChannel();
    const parser = JsonStream.parse(channel.iterable);
    const replyContentStream = parser.get<string>('reply.content');

    const receivedChunks: string[] = [];
    const replyPromise = (async () => {
      for await (const chunk of replyContentStream) {
        receivedChunks.push(chunk);
      }
    })();

    // Feed in larger chunks (simulating real API token boundaries)
    const json = JSON.stringify({
      thought: { content: 'test', importance: 0.1 },
      reply: { content: 'The quick brown fox jumps', contactId: 'c1', channel: 'web', replyToMessageId: 'msg-1' },
      experience: { content: 'test', importance: 0.1 },
      emotionDeltas: [],
      decisions: [],
      workingMemoryUpdate: null,
      coreSelfUpdate: null,
      memoryCandidate: [],
    });

    // Push in word-sized chunks
    const chunkSize = 10;
    for (let i = 0; i < json.length; i += chunkSize) {
      channel.push(json.slice(i, i + chunkSize));
    }
    channel.end();

    await replyPromise;
    await parser.dispose();

    expect(receivedChunks.length).toBeGreaterThan(0);
    expect(receivedChunks.join('')).toBe('The quick brown fox jumps');
  });
});

// ---------------------------------------------------------------------------
// Test createChunkChannel async iterator behavior
// ---------------------------------------------------------------------------

describe('createChunkChannel', () => {
  it('yields pushed values in order', async () => {
    const channel = createChunkChannel();
    channel.push('a');
    channel.push('b');
    channel.push('c');
    channel.end();

    const result: string[] = [];
    for await (const chunk of channel.iterable) {
      result.push(chunk);
    }
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('awaits push when buffer is empty', async () => {
    const channel = createChunkChannel();

    // Start consuming before pushing
    const resultPromise = (async () => {
      const result: string[] = [];
      for await (const chunk of channel.iterable) {
        result.push(chunk);
      }
      return result;
    })();

    // Push after a microtask delay
    await new Promise((r) => setTimeout(r, 10));
    channel.push('delayed');
    channel.end();

    const result = await resultPromise;
    expect(result).toEqual(['delayed']);
  });

  it('completes immediately when end() is called on empty buffer', async () => {
    const channel = createChunkChannel();
    channel.end();

    const result: string[] = [];
    for await (const chunk of channel.iterable) {
      result.push(chunk);
    }
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Test MindOutput validation with the real schema
// ---------------------------------------------------------------------------

import { mindOutputSchema } from '@animus/shared';

describe('MindOutput schema validation', () => {
  it('validates a complete MindOutput', () => {
    const output = {
      thought: { content: 'A quiet thought', importance: 0.5 },
      reply: {
        content: 'Hello there',
        contactId: 'c1',
        channel: 'web',
        replyToMessageId: 'msg-1',
      },
      experience: { content: 'Talked with a user', importance: 0.4 },
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
      thought: { content: 'Idle reflection', importance: 0.2 },
      reply: null,
      experience: { content: 'A quiet moment passed.', importance: 0.1 },
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
      thought: { content: '', importance: 0 },
      reply: null,
      experience: { content: '', importance: 0 },
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
      thought: { content: 'Need to delegate', importance: 0.7 },
      reply: null,
      experience: { content: 'Realized this task needs a specialist.', importance: 0.5 },
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

  it('rejects when thought is missing', () => {
    const output = {
      reply: null,
      experience: { content: '', importance: 0 },
      emotionDeltas: [],
      decisions: [],
      workingMemoryUpdate: null,
      coreSelfUpdate: null,
    };

    const result = mindOutputSchema.safeParse(output);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test session cleanup on mind query failure (leak prevention)
// ---------------------------------------------------------------------------

import { AgentManager } from '@animus/agents';

describe('AgentManager.removeTrackedSession', () => {
  it('force-removes a tracked session without calling end()', async () => {
    AgentManager.resetGlobalCleanup();
    const manager = new AgentManager({
      autoRegisterAdapters: false,
      maxConcurrentSessions: 4,
    });

    // Create a mock adapter that produces mock sessions
    const mockSession = {
      id: 'claude:test-session-1',
      provider: 'claude' as const,
      isActive: true,
      onEvent: vi.fn(),
      prompt: vi.fn(),
      promptStreaming: vi.fn(),
      cancel: vi.fn(),
      end: vi.fn(),
      getUsage: vi.fn(() => ({ inputTokens: 0, outputTokens: 0, totalTokens: 0 })),
      getHistory: vi.fn(() => []),
    };

    const mockAdapter = {
      provider: 'claude' as const,
      capabilities: {
        streaming: true,
        subAgents: false,
        maxContextTokens: 200000,
        supportedModels: ['claude-sonnet-4-5-20250514'],
      },
      isConfigured: () => true,
      createSession: vi.fn(async () => mockSession),
      resumeSession: vi.fn(),
      validateConfig: vi.fn(),
    };

    manager.registerAdapter(mockAdapter as any);

    // Create a session (tracked internally)
    await manager.createSession({ provider: 'claude' });
    expect(manager.getActiveSessionCount()).toBe(1);

    // Force-remove it (simulating the fallback path when end() fails)
    const removed = manager.removeTrackedSession('claude:test-session-1');
    expect(removed).toBe(true);
    expect(manager.getActiveSessionCount()).toBe(0);

    // Should be able to create new sessions (no concurrency exhaustion)
    expect(manager.canCreateSession()).toBe(true);
  });

  it('returns false when removing a non-existent session', () => {
    AgentManager.resetGlobalCleanup();
    const manager = new AgentManager({
      autoRegisterAdapters: false,
      maxConcurrentSessions: 4,
    });

    const removed = manager.removeTrackedSession('nonexistent');
    expect(removed).toBe(false);
  });

  it('prevents concurrency exhaustion from leaked sessions', async () => {
    AgentManager.resetGlobalCleanup();
    const manager = new AgentManager({
      autoRegisterAdapters: false,
      maxConcurrentSessions: 2,
    });

    let sessionCounter = 0;
    const mockAdapter = {
      provider: 'claude' as const,
      capabilities: {
        streaming: true,
        subAgents: false,
        maxContextTokens: 200000,
        supportedModels: ['claude-sonnet-4-5-20250514'],
      },
      isConfigured: () => true,
      createSession: vi.fn(async () => {
        sessionCounter++;
        return {
          id: `claude:session-${sessionCounter}`,
          provider: 'claude' as const,
          isActive: true,
          onEvent: vi.fn(),
          prompt: vi.fn(),
          promptStreaming: vi.fn(),
          cancel: vi.fn(),
          end: vi.fn(),
          getUsage: vi.fn(() => ({ inputTokens: 0, outputTokens: 0, totalTokens: 0 })),
          getHistory: vi.fn(() => []),
        };
      }),
      resumeSession: vi.fn(),
      validateConfig: vi.fn(),
    };

    manager.registerAdapter(mockAdapter as any);

    // Create and "leak" sessions by force-removing (simulating end() + null)
    const s1 = await manager.createSession({ provider: 'claude' });
    manager.removeTrackedSession(s1.id);

    const s2 = await manager.createSession({ provider: 'claude' });
    manager.removeTrackedSession(s2.id);

    // Should still be able to create sessions despite 2 having been created
    expect(manager.getActiveSessionCount()).toBe(0);
    expect(manager.canCreateSession()).toBe(true);

    const s3 = await manager.createSession({ provider: 'claude' });
    expect(s3.id).toBe('claude:session-3');
    expect(manager.getActiveSessionCount()).toBe(1);
  });
});
