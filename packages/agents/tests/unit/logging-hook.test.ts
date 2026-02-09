/**
 * Tests for the event logging hook.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createLoggingHandler,
  logSessionUsage,
  attachSessionLogging,
  type AgentLogStore,
} from '../../src/logging-hook.js';
import { createSilentLogger } from '../../src/logger.js';
import type { AgentEvent, IAgentSession, SessionUsage, AgentCost } from '../../src/types.js';

function createMockStore(): AgentLogStore {
  return {
    createSession: vi.fn().mockReturnValue({ id: 'log-session-1' }),
    endSession: vi.fn(),
    insertEvent: vi.fn(),
    insertUsage: vi.fn(),
  };
}

function createEvent(
  type: AgentEvent['type'],
  data: Record<string, unknown> = {},
): AgentEvent {
  return {
    id: 'evt-1',
    sessionId: 'claude:test-session',
    type,
    timestamp: new Date().toISOString(),
    data: data as any,
  };
}

describe('createLoggingHandler', () => {
  let store: ReturnType<typeof createMockStore>;

  beforeEach(() => {
    store = createMockStore();
  });

  it('creates a log session on session_start event', async () => {
    const { handler, getLogSessionId } = createLoggingHandler({
      store,
      logger: createSilentLogger(),
    });

    await handler(
      createEvent('session_start', { provider: 'claude', model: 'opus-4' }),
    );

    expect(store.createSession).toHaveBeenCalledWith({
      provider: 'claude',
      model: 'opus-4',
    });
    expect(getLogSessionId()).toBe('log-session-1');
  });

  it('logs events to the store', async () => {
    const { handler } = createLoggingHandler({
      store,
      logger: createSilentLogger(),
    });

    // Start session first
    await handler(
      createEvent('session_start', { provider: 'claude', model: 'test' }),
    );

    // Log an event
    await handler(
      createEvent('input_received', { content: 'hello', type: 'text' }),
    );

    expect(store.insertEvent).toHaveBeenCalledTimes(2); // session_start + input_received
    expect(store.insertEvent).toHaveBeenLastCalledWith({
      sessionId: 'log-session-1',
      eventType: 'input_received',
      data: { content: 'hello', type: 'text' },
    });
  });

  it('skips response_chunk events by default', async () => {
    const { handler } = createLoggingHandler({
      store,
      logger: createSilentLogger(),
    });

    await handler(
      createEvent('session_start', { provider: 'claude', model: 'test' }),
    );

    await handler(
      createEvent('response_chunk', { content: 'hi', accumulated: 'hi' }),
    );

    // Only session_start event should be logged, not the chunk
    expect(store.insertEvent).toHaveBeenCalledTimes(1);
  });

  it('logs response_chunk events when logChunks is enabled', async () => {
    const { handler } = createLoggingHandler({
      store,
      logger: createSilentLogger(),
      logChunks: true,
    });

    await handler(
      createEvent('session_start', { provider: 'claude', model: 'test' }),
    );

    await handler(
      createEvent('response_chunk', { content: 'hi', accumulated: 'hi' }),
    );

    expect(store.insertEvent).toHaveBeenCalledTimes(2);
  });

  it('ends the log session on session_end event', async () => {
    const { handler } = createLoggingHandler({
      store,
      logger: createSilentLogger(),
    });

    await handler(
      createEvent('session_start', { provider: 'claude', model: 'test' }),
    );

    await handler(createEvent('session_end', { reason: 'completed' }));

    expect(store.endSession).toHaveBeenCalledWith('log-session-1', 'completed');
  });

  it('maps error end reason to error status', async () => {
    const { handler } = createLoggingHandler({
      store,
      logger: createSilentLogger(),
    });

    await handler(
      createEvent('session_start', { provider: 'claude', model: 'test' }),
    );

    await handler(createEvent('session_end', { reason: 'error' }));

    expect(store.endSession).toHaveBeenCalledWith('log-session-1', 'error');
  });

  it('maps timeout end reason to cancelled status', async () => {
    const { handler } = createLoggingHandler({
      store,
      logger: createSilentLogger(),
    });

    await handler(
      createEvent('session_start', { provider: 'claude', model: 'test' }),
    );

    await handler(createEvent('session_end', { reason: 'timeout' }));

    expect(store.endSession).toHaveBeenCalledWith('log-session-1', 'cancelled');
  });

  it('maps cancelled end reason to cancelled status', async () => {
    const { handler } = createLoggingHandler({
      store,
      logger: createSilentLogger(),
    });

    await handler(
      createEvent('session_start', { provider: 'claude', model: 'test' }),
    );

    await handler(createEvent('session_end', { reason: 'cancelled' }));

    expect(store.endSession).toHaveBeenCalledWith('log-session-1', 'cancelled');
  });

  it('does not throw when store fails', async () => {
    const failingStore = createMockStore();
    (failingStore.insertEvent as any).mockImplementation(() => {
      throw new Error('DB error');
    });

    const { handler } = createLoggingHandler({
      store: failingStore,
      logger: createSilentLogger(),
    });

    await handler(
      createEvent('session_start', { provider: 'claude', model: 'test' }),
    );

    // Should not throw
    await expect(
      handler(createEvent('input_received', { content: 'hello', type: 'text' })),
    ).resolves.toBeUndefined();
  });

  it('creates log session on first event even without session_start', async () => {
    const { handler, getLogSessionId } = createLoggingHandler({
      store,
      logger: createSilentLogger(),
    });

    // Send event without session_start first — should auto-initialize
    await handler(
      createEvent('input_received', { content: 'hello', type: 'text' }),
    );

    expect(store.createSession).toHaveBeenCalledOnce();
    expect(store.insertEvent).toHaveBeenCalledOnce();
    expect(getLogSessionId()).toBe('log-session-1');
  });

  it('getLogSessionId returns null before any events', () => {
    const { getLogSessionId } = createLoggingHandler({
      store,
      logger: createSilentLogger(),
    });

    expect(getLogSessionId()).toBeNull();
  });
});

describe('logSessionUsage', () => {
  it('inserts usage data to the store', () => {
    const store = createMockStore();
    const usage: SessionUsage = {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    };
    const cost: AgentCost = {
      inputCostUsd: 0.003,
      outputCostUsd: 0.0075,
      totalCostUsd: 0.0105,
      model: 'opus-4',
      provider: 'claude',
    };

    logSessionUsage(store, 'log-session-1', usage, cost, 'opus-4');

    expect(store.insertUsage).toHaveBeenCalledWith({
      sessionId: 'log-session-1',
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      costUsd: 0.0105,
      model: 'opus-4',
    });
  });

  it('handles null cost', () => {
    const store = createMockStore();
    const usage: SessionUsage = {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    };

    logSessionUsage(store, 'log-session-1', usage, null, 'opus-4');

    expect(store.insertUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        costUsd: null,
      }),
    );
  });
});

describe('attachSessionLogging', () => {
  it('attaches handler to session and returns logUsage function', async () => {
    const store = createMockStore();
    const mockSession: Partial<IAgentSession> = {
      onEvent: vi.fn(),
    };

    const { logUsage, getLogSessionId } = attachSessionLogging(
      mockSession as IAgentSession,
      { store, logger: createSilentLogger() },
    );

    expect(mockSession.onEvent).toHaveBeenCalled();
    expect(getLogSessionId()).toBeNull(); // Not started yet
    expect(logUsage).toBeInstanceOf(Function);
  });

  it('logUsage calls store when session is active', async () => {
    const store = createMockStore();
    let eventHandler: any;

    const mockSession: Partial<IAgentSession> = {
      onEvent: vi.fn((handler) => {
        eventHandler = handler;
      }),
    };

    const { logUsage } = attachSessionLogging(mockSession as IAgentSession, {
      store,
      logger: createSilentLogger(),
    });

    // Simulate session_start
    await eventHandler(
      createEvent('session_start', { provider: 'claude', model: 'test' }),
    );

    // Now log usage
    const usage: SessionUsage = {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
    };
    logUsage(usage, null, 'test-model');

    expect(store.insertUsage).toHaveBeenCalledWith({
      sessionId: 'log-session-1',
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      costUsd: null,
      model: 'test-model',
    });
  });

  it('logUsage is a no-op when session has not started', () => {
    const store = createMockStore();
    const mockSession: Partial<IAgentSession> = {
      onEvent: vi.fn(),
    };

    const { logUsage } = attachSessionLogging(mockSession as IAgentSession, {
      store,
      logger: createSilentLogger(),
    });

    const usage: SessionUsage = {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
    };
    logUsage(usage, null, 'test-model');

    expect(store.insertUsage).not.toHaveBeenCalled();
  });
});
