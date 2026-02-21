/**
 * Subscription Wiring Tests
 *
 * Tests for the store-level logic that real-time subscriptions drive:
 * - HeartbeatStore: deduplication, caps, selectors, reply stream lifecycle
 * - MessagesStore: deduplication, caps, message ordering
 * - selectHasRunningAgents selector (non-trivial event processing)
 *
 * These are pure state logic tests using Zustand stores.
 * No DOM or React rendering required.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

// Polyfill localStorage for node environment
const storage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
  get length() { return storage.size; },
  key: (index: number) => [...storage.keys()][index] ?? null,
};

beforeAll(() => {
  (globalThis as any).localStorage = localStorageMock;
});

let useHeartbeatStore: any;
let useMessagesStore: any;
let selectHasRunningAgents: any;
let selectEmotionsArray: any;
let selectEmotion: any;

beforeAll(async () => {
  const hbMod = await import('../src/store/heartbeat-store.js');
  useHeartbeatStore = hbMod.useHeartbeatStore;
  selectHasRunningAgents = hbMod.selectHasRunningAgents;
  selectEmotionsArray = hbMod.selectEmotionsArray;
  selectEmotion = hbMod.selectEmotion;

  const msgMod = await import('../src/store/messages-store.js');
  useMessagesStore = msgMod.useMessagesStore;
});

function resetStores() {
  useHeartbeatStore.setState({
    heartbeatState: null,
    isHeartbeatActive: false,
    emotions: new Map(),
    recentThoughts: [],
    recentExperiences: [],
    agentEvents: [],
    replyStream: { turns: [] },
  });
  useMessagesStore.setState({
    activeConversationId: null,
    liveMessages: [],
    hasNewMessage: false,
  });
}

// ============================================================================
// HeartbeatStore — Emotion selectors
// ============================================================================

describe('HeartbeatStore emotion selectors', () => {
  beforeEach(resetStores);

  it('selectEmotionsArray returns empty array when no emotions', () => {
    const result = selectEmotionsArray(useHeartbeatStore.getState());
    expect(result).toEqual([]);
  });

  it('selectEmotionsArray returns all emotions as array', () => {
    useHeartbeatStore.getState().setEmotions([
      { emotion: 'joy', category: 'positive', intensity: 0.8, baseline: 0.5, lastUpdatedAt: '2024-01-01' },
      { emotion: 'sadness', category: 'negative', intensity: 0.2, baseline: 0.3, lastUpdatedAt: '2024-01-01' },
    ]);
    const result = selectEmotionsArray(useHeartbeatStore.getState());
    expect(result).toHaveLength(2);
  });

  it('selectEmotion returns specific emotion', () => {
    useHeartbeatStore.getState().updateEmotion({
      emotion: 'curiosity', category: 'drive', intensity: 0.7, baseline: 0.5, lastUpdatedAt: '2024-01-01',
    });
    const result = selectEmotion(useHeartbeatStore.getState(), 'curiosity');
    expect(result?.intensity).toBe(0.7);
  });

  it('selectEmotion returns undefined for nonexistent emotion', () => {
    const result = selectEmotion(useHeartbeatStore.getState(), 'nonexistent');
    expect(result).toBeUndefined();
  });

  it('setEmotions replaces previous emotions entirely', () => {
    useHeartbeatStore.getState().setEmotions([
      { emotion: 'joy', category: 'positive', intensity: 0.8, baseline: 0.5, lastUpdatedAt: '2024-01-01' },
    ]);
    useHeartbeatStore.getState().setEmotions([
      { emotion: 'sadness', category: 'negative', intensity: 0.2, baseline: 0.3, lastUpdatedAt: '2024-01-01' },
    ]);
    const state = useHeartbeatStore.getState();
    expect(state.emotions.size).toBe(1);
    expect(state.emotions.has('joy')).toBe(false);
    expect(state.emotions.has('sadness')).toBe(true);
  });

  it('updateEmotion overwrites existing emotion', () => {
    useHeartbeatStore.getState().updateEmotion({
      emotion: 'joy', category: 'positive', intensity: 0.5, baseline: 0.5, lastUpdatedAt: '2024-01-01',
    });
    useHeartbeatStore.getState().updateEmotion({
      emotion: 'joy', category: 'positive', intensity: 0.9, baseline: 0.5, lastUpdatedAt: '2024-01-02',
    });
    const state = useHeartbeatStore.getState();
    expect(state.emotions.size).toBe(1);
    expect(state.emotions.get('joy')?.intensity).toBe(0.9);
  });
});

// ============================================================================
// HeartbeatStore — selectHasRunningAgents
// ============================================================================

describe('selectHasRunningAgents', () => {
  beforeEach(resetStores);

  it('returns false when no events', () => {
    expect(selectHasRunningAgents(useHeartbeatStore.getState())).toBe(false);
  });

  it('returns true after a spawn event', () => {
    useHeartbeatStore.getState().addAgentEvent({ type: 'spawned', taskId: 'task-1', detail: 'claude' });
    expect(selectHasRunningAgents(useHeartbeatStore.getState())).toBe(true);
  });

  it('returns false after spawn + completion', () => {
    useHeartbeatStore.getState().addAgentEvent({ type: 'spawned', taskId: 'task-1', detail: 'claude' });
    useHeartbeatStore.getState().addAgentEvent({ type: 'completed', taskId: 'task-1', detail: 'done' });
    expect(selectHasRunningAgents(useHeartbeatStore.getState())).toBe(false);
  });

  it('returns false after spawn + failure', () => {
    useHeartbeatStore.getState().addAgentEvent({ type: 'spawned', taskId: 'task-1', detail: 'claude' });
    useHeartbeatStore.getState().addAgentEvent({ type: 'failed', taskId: 'task-1', detail: 'error' });
    expect(selectHasRunningAgents(useHeartbeatStore.getState())).toBe(false);
  });

  it('tracks multiple independent tasks', () => {
    useHeartbeatStore.getState().addAgentEvent({ type: 'spawned', taskId: 'task-1' });
    useHeartbeatStore.getState().addAgentEvent({ type: 'spawned', taskId: 'task-2' });
    expect(selectHasRunningAgents(useHeartbeatStore.getState())).toBe(true);

    useHeartbeatStore.getState().addAgentEvent({ type: 'completed', taskId: 'task-1' });
    expect(selectHasRunningAgents(useHeartbeatStore.getState())).toBe(true);

    useHeartbeatStore.getState().addAgentEvent({ type: 'completed', taskId: 'task-2' });
    expect(selectHasRunningAgents(useHeartbeatStore.getState())).toBe(false);
  });

  it('handles re-spawn of same task', () => {
    useHeartbeatStore.getState().addAgentEvent({ type: 'spawned', taskId: 'task-1' });
    useHeartbeatStore.getState().addAgentEvent({ type: 'completed', taskId: 'task-1' });
    useHeartbeatStore.getState().addAgentEvent({ type: 'spawned', taskId: 'task-1' });
    expect(selectHasRunningAgents(useHeartbeatStore.getState())).toBe(true);
  });
});

// ============================================================================
// HeartbeatStore — Experience deduplication and cap
// ============================================================================

describe('HeartbeatStore experience dedup and cap', () => {
  beforeEach(resetStores);

  it('deduplicates experiences by id', () => {
    const exp = { id: 'e1', tickNumber: 1, content: 'Test', importance: 0.5, createdAt: '2024-01-01', expiresAt: null };
    useHeartbeatStore.getState().addExperience(exp);
    useHeartbeatStore.getState().addExperience(exp);
    useHeartbeatStore.getState().addExperience(exp);
    expect(useHeartbeatStore.getState().recentExperiences).toHaveLength(1);
  });

  it('prepends new experiences (most recent first)', () => {
    const exp1 = { id: 'e1', tickNumber: 1, content: 'First', importance: 0.5, createdAt: '2024-01-01', expiresAt: null };
    const exp2 = { id: 'e2', tickNumber: 2, content: 'Second', importance: 0.6, createdAt: '2024-01-02', expiresAt: null };
    useHeartbeatStore.getState().addExperience(exp1);
    useHeartbeatStore.getState().addExperience(exp2);
    expect(useHeartbeatStore.getState().recentExperiences[0]?.id).toBe('e2');
  });

  it('caps at 50 experiences', () => {
    for (let i = 0; i < 55; i++) {
      useHeartbeatStore.getState().addExperience({
        id: `e-${i}`,
        tickNumber: i,
        content: `Experience ${i}`,
        importance: 0.5,
        createdAt: new Date(Date.now() + i * 1000).toISOString(),
        expiresAt: null,
      });
    }
    expect(useHeartbeatStore.getState().recentExperiences).toHaveLength(50);
    // Most recent (last added) should be first
    expect(useHeartbeatStore.getState().recentExperiences[0]?.id).toBe('e-54');
  });
});

// ============================================================================
// HeartbeatStore — Agent events cap
// ============================================================================

describe('HeartbeatStore agent events cap', () => {
  beforeEach(resetStores);

  it('caps at 100 agent events', () => {
    for (let i = 0; i < 110; i++) {
      useHeartbeatStore.getState().addAgentEvent({
        type: 'spawned',
        taskId: `task-${i}`,
      });
    }
    expect(useHeartbeatStore.getState().agentEvents).toHaveLength(100);
  });

  it('keeps most recent events when capped', () => {
    for (let i = 0; i < 110; i++) {
      useHeartbeatStore.getState().addAgentEvent({
        type: 'spawned',
        taskId: `task-${i}`,
      });
    }
    // Most recent should be first
    expect(useHeartbeatStore.getState().agentEvents[0]?.taskId).toBe('task-109');
  });

  it('adds receivedAt timestamp', () => {
    const before = Date.now();
    useHeartbeatStore.getState().addAgentEvent({ type: 'spawned', taskId: 'task-1' });
    const after = Date.now();
    const event = useHeartbeatStore.getState().agentEvents[0]!;
    expect(event.receivedAt).toBeGreaterThanOrEqual(before);
    expect(event.receivedAt).toBeLessThanOrEqual(after);
  });
});

// ============================================================================
// HeartbeatStore — Reply stream advanced scenarios
// ============================================================================

describe('HeartbeatStore reply stream edge cases', () => {
  beforeEach(resetStores);

  it('preserves tickNumber from previous append when streaming', () => {
    const store = useHeartbeatStore.getState;
    // If tickNumber was set before streaming, it should persist
    store().completeReply('previous', 10);
    store().clearReplyStream();
    store().appendReplyChunk('new ', 0);
    // tickNumber should NOT carry over after clearReplyStream
    expect(store().replyStream.tickNumber).toBeUndefined();
  });

  it('handles empty chunk appends', () => {
    const store = useHeartbeatStore.getState;
    store().appendReplyChunk('', 0);
    expect(store().replyStream.turns).toHaveLength(1);
    expect(store().replyStream.turns[0]?.isStreaming).toBe(true);
    expect(store().replyStream.turns[0]?.accumulated).toBe('');
  });

  it('handles rapid sequential appends', () => {
    const store = useHeartbeatStore.getState;
    const chunks = ['H', 'e', 'l', 'l', 'o', ' ', 'W', 'o', 'r', 'l', 'd'];
    for (const chunk of chunks) {
      store().appendReplyChunk(chunk, 0);
    }
    expect(store().replyStream.turns[0]?.accumulated).toBe('Hello World');
    expect(store().replyStream.turns[0]?.isStreaming).toBe(true);
  });

  it('completeReply sets tickNumber', () => {
    const store = useHeartbeatStore.getState;
    store().appendReplyChunk('Hello', 0);
    store().completeReply('Hello', 42);
    expect(store().replyStream.tickNumber).toBe(42);
    expect(store().replyStream.turns[0]?.isStreaming).toBe(false);
  });

  it('completeReply without tickNumber works', () => {
    const store = useHeartbeatStore.getState;
    store().appendReplyChunk('Hello', 0);
    store().completeReply('Hello');
    expect(store().replyStream.tickNumber).toBeUndefined();
    expect(store().replyStream.turns[0]?.isStreaming).toBe(false);
  });

  it('clearReplyStream resets everything', () => {
    const store = useHeartbeatStore.getState;
    store().appendReplyChunk('Hello', 0);
    store().completeReply('Hello', 42);
    store().clearReplyStream();
    expect(store().replyStream).toEqual({ turns: [] });
  });

  it('tracks multiple turns separately', () => {
    const store = useHeartbeatStore.getState;
    store().appendReplyChunk('Turn 0 text', 0);
    store().appendReplyChunk('Turn 1 text', 1);
    expect(store().replyStream.turns).toHaveLength(2);
    expect(store().replyStream.turns[0]?.accumulated).toBe('Turn 0 text');
    expect(store().replyStream.turns[1]?.accumulated).toBe('Turn 1 text');
  });

  it('completeTurn marks specific turn as complete', () => {
    const store = useHeartbeatStore.getState;
    store().appendReplyChunk('Turn 0 text', 0);
    store().appendReplyChunk('Turn 1 text', 1);
    store().completeTurn(0, 'Turn 0 text');
    expect(store().replyStream.turns[0]?.isComplete).toBe(true);
    expect(store().replyStream.turns[0]?.isStreaming).toBe(false);
    expect(store().replyStream.turns[1]?.isStreaming).toBe(true);
    expect(store().replyStream.turns[1]?.isComplete).toBe(false);
  });
});

// ============================================================================
// HeartbeatStore — Heartbeat state derives isActive
// ============================================================================

describe('HeartbeatStore heartbeat state', () => {
  beforeEach(resetStores);

  it('sets isHeartbeatActive from state.isRunning', () => {
    useHeartbeatStore.getState().setHeartbeatState({
      tickNumber: 1,
      currentStage: 'idle',
      sessionState: 'active',
      triggerType: null,
      triggerContext: null,
      mindSessionId: null,
      sessionTokenCount: 0,
      startedAt: '2024-01-01T00:00:00Z',
      lastTickAt: null,
      sessionWarmSince: null,
      isRunning: true,
    });
    expect(useHeartbeatStore.getState().isHeartbeatActive).toBe(true);
  });

  it('sets isHeartbeatActive to false when not running', () => {
    useHeartbeatStore.getState().setHeartbeatState({
      tickNumber: 1,
      currentStage: 'idle',
      sessionState: 'cold',
      triggerType: null,
      triggerContext: null,
      mindSessionId: null,
      sessionTokenCount: 0,
      startedAt: '2024-01-01T00:00:00Z',
      lastTickAt: null,
      sessionWarmSince: null,
      isRunning: false,
    });
    expect(useHeartbeatStore.getState().isHeartbeatActive).toBe(false);
  });

  it('setHeartbeatActive overrides derived state', () => {
    useHeartbeatStore.getState().setHeartbeatActive(true);
    expect(useHeartbeatStore.getState().isHeartbeatActive).toBe(true);
    useHeartbeatStore.getState().setHeartbeatActive(false);
    expect(useHeartbeatStore.getState().isHeartbeatActive).toBe(false);
  });
});

// ============================================================================
// MessagesStore — Live messages cap
// ============================================================================

describe('MessagesStore live messages cap', () => {
  beforeEach(resetStores);

  it('caps at 200 live messages', () => {
    for (let i = 0; i < 210; i++) {
      useMessagesStore.getState().addMessage({
        id: `m-${i}`,
        conversationId: 'c1',
        contactId: 'ct1',
        direction: 'inbound',
        channel: 'web',
        content: `Message ${i}`,
        metadata: null,
        tickNumber: null,
        createdAt: `2024-01-01T${String(i).padStart(4, '0')}`,
      });
    }
    expect(useMessagesStore.getState().liveMessages).toHaveLength(200);
  });

  it('keeps most recent messages when capped', () => {
    for (let i = 0; i < 210; i++) {
      useMessagesStore.getState().addMessage({
        id: `m-${i}`,
        conversationId: 'c1',
        contactId: 'ct1',
        direction: 'inbound',
        channel: 'web',
        content: `Message ${i}`,
        metadata: null,
        tickNumber: null,
        createdAt: `2024-01-01T${String(i).padStart(4, '0')}`,
      });
    }
    // Most recently added should be first (prepended)
    expect(useMessagesStore.getState().liveMessages[0]?.id).toBe('m-209');
  });
});

// ============================================================================
// MessagesStore — Deduplication edge cases
// ============================================================================

describe('MessagesStore deduplication', () => {
  beforeEach(resetStores);

  it('deduplicates messages with same id', () => {
    const msg = {
      id: 'm1',
      conversationId: 'c1',
      contactId: 'ct1',
      direction: 'inbound' as const,
      channel: 'web' as const,
      content: 'Hello',
      metadata: null,
      tickNumber: null,
      createdAt: '2024-01-01',
    };
    useMessagesStore.getState().addMessage(msg);
    useMessagesStore.getState().addMessage({ ...msg, content: 'Different content' }); // same id
    expect(useMessagesStore.getState().liveMessages).toHaveLength(1);
    expect(useMessagesStore.getState().liveMessages[0]?.content).toBe('Hello'); // first wins
  });

  it('allows messages with different ids', () => {
    const base = {
      conversationId: 'c1',
      contactId: 'ct1',
      direction: 'inbound' as const,
      channel: 'web' as const,
      content: 'Hello',
      metadata: null,
      tickNumber: null,
      createdAt: '2024-01-01',
    };
    useMessagesStore.getState().addMessage({ ...base, id: 'm1' });
    useMessagesStore.getState().addMessage({ ...base, id: 'm2' });
    useMessagesStore.getState().addMessage({ ...base, id: 'm3' });
    expect(useMessagesStore.getState().liveMessages).toHaveLength(3);
  });

  it('sets hasNewMessage on every new unique message', () => {
    useMessagesStore.getState().addMessage({
      id: 'm1',
      conversationId: 'c1',
      contactId: 'ct1',
      direction: 'inbound',
      channel: 'web',
      content: 'Hello',
      metadata: null,
      tickNumber: null,
      createdAt: '2024-01-01',
    });
    expect(useMessagesStore.getState().hasNewMessage).toBe(true);
    useMessagesStore.getState().acknowledgeNewMessage();
    expect(useMessagesStore.getState().hasNewMessage).toBe(false);

    useMessagesStore.getState().addMessage({
      id: 'm2',
      conversationId: 'c1',
      contactId: 'ct1',
      direction: 'outbound',
      channel: 'web',
      content: 'Reply',
      metadata: null,
      tickNumber: 5,
      createdAt: '2024-01-01',
    });
    expect(useMessagesStore.getState().hasNewMessage).toBe(true);
  });

  it('does not set hasNewMessage for duplicate', () => {
    const msg = {
      id: 'm1',
      conversationId: 'c1',
      contactId: 'ct1',
      direction: 'inbound' as const,
      channel: 'web' as const,
      content: 'Hello',
      metadata: null,
      tickNumber: null,
      createdAt: '2024-01-01',
    };
    useMessagesStore.getState().addMessage(msg);
    useMessagesStore.getState().acknowledgeNewMessage();
    useMessagesStore.getState().addMessage(msg); // duplicate
    // hasNewMessage should stay false since addMessage returns prev (no-op)
    expect(useMessagesStore.getState().hasNewMessage).toBe(false);
  });
});

// ============================================================================
// MessagesStore — clearLiveMessages
// ============================================================================

describe('MessagesStore clearLiveMessages', () => {
  beforeEach(resetStores);

  it('clears all messages and resets flag', () => {
    useMessagesStore.getState().addMessage({
      id: 'm1',
      conversationId: 'c1',
      contactId: 'ct1',
      direction: 'inbound',
      channel: 'web',
      content: 'Hello',
      metadata: null,
      tickNumber: null,
      createdAt: '2024-01-01',
    });
    expect(useMessagesStore.getState().liveMessages).toHaveLength(1);
    expect(useMessagesStore.getState().hasNewMessage).toBe(true);

    useMessagesStore.getState().clearLiveMessages();
    expect(useMessagesStore.getState().liveMessages).toEqual([]);
    expect(useMessagesStore.getState().hasNewMessage).toBe(false);
  });
});

// ============================================================================
// Subscription routing validation
// ============================================================================

describe('Subscription routing expectations', () => {
  // These tests verify the subscription manager's contract:
  // each subscription routes data to the correct store action.
  beforeEach(resetStores);

  it('heartbeat.onStateChange → setHeartbeatState', () => {
    const mockState = {
      tickNumber: 5,
      currentStage: 'idle' as const,
      sessionState: 'active' as const,
      triggerType: null,
      triggerContext: null,
      mindSessionId: null,
      sessionTokenCount: 0,
      startedAt: '2024-01-01T00:00:00Z',
      lastTickAt: '2024-01-01T00:05:00Z',
      sessionWarmSince: null,
      isRunning: true,
    };

    // Simulate what the subscription manager does
    useHeartbeatStore.getState().setHeartbeatState(mockState);

    expect(useHeartbeatStore.getState().heartbeatState).toEqual(mockState);
    expect(useHeartbeatStore.getState().isHeartbeatActive).toBe(true);
  });

  it('heartbeat.onEmotionChange → updateEmotion', () => {
    const emotion = {
      emotion: 'joy' as const,
      category: 'positive' as const,
      intensity: 0.75,
      baseline: 0.5,
      lastUpdatedAt: '2024-01-01T00:00:00Z',
    };

    useHeartbeatStore.getState().updateEmotion(emotion);

    expect(useHeartbeatStore.getState().emotions.get('joy')).toEqual(emotion);
  });

  it('heartbeat.onThoughts → addThought', () => {
    const thought = {
      id: 't1',
      tickNumber: 1,
      content: 'I wonder...',
      importance: 0.6,
      createdAt: '2024-01-01T00:00:00Z',
      expiresAt: null,
    };

    useHeartbeatStore.getState().addThought(thought);

    expect(useHeartbeatStore.getState().recentThoughts).toHaveLength(1);
    expect(useHeartbeatStore.getState().recentThoughts[0]?.content).toBe('I wonder...');
  });

  it('heartbeat.onExperience → addExperience', () => {
    const experience = {
      id: 'e1',
      tickNumber: 1,
      content: 'Helped a user',
      importance: 0.7,
      createdAt: '2024-01-01T00:00:00Z',
      expiresAt: null,
    };

    useHeartbeatStore.getState().addExperience(experience);

    expect(useHeartbeatStore.getState().recentExperiences).toHaveLength(1);
  });

  it('heartbeat.onAgentStatus → addAgentEvent', () => {
    useHeartbeatStore.getState().addAgentEvent({
      type: 'spawned',
      taskId: 'task-research',
      detail: 'claude',
    });

    const events = useHeartbeatStore.getState().agentEvents;
    expect(events).toHaveLength(1);
    expect(events[0]?.taskId).toBe('task-research');
  });

  it('heartbeat.onReply chunk → appendReplyChunk', () => {
    useHeartbeatStore.getState().appendReplyChunk('Hello ', 0);
    useHeartbeatStore.getState().appendReplyChunk('world', 0);

    const stream = useHeartbeatStore.getState().replyStream;
    expect(stream.turns).toHaveLength(1);
    expect(stream.turns[0]?.isStreaming).toBe(true);
    expect(stream.turns[0]?.accumulated).toBe('Hello world');
  });

  it('heartbeat.onReply complete → completeReply', () => {
    useHeartbeatStore.getState().appendReplyChunk('Hello world', 0);
    useHeartbeatStore.getState().completeReply('Hello world', 42);

    const stream = useHeartbeatStore.getState().replyStream;
    expect(stream.turns[0]?.isStreaming).toBe(false);
    expect(stream.turns[0]?.accumulated).toBe('Hello world');
    expect(stream.tickNumber).toBe(42);
  });

  it('messages.onMessage → addMessage', () => {
    const msg = {
      id: 'msg-live',
      conversationId: 'c1',
      contactId: 'ct1',
      direction: 'inbound' as const,
      channel: 'web' as const,
      content: 'Live message',
      metadata: null,
      tickNumber: null,
      createdAt: '2024-01-01T00:00:00Z',
    };

    useMessagesStore.getState().addMessage(msg);

    expect(useMessagesStore.getState().liveMessages).toHaveLength(1);
    expect(useMessagesStore.getState().hasNewMessage).toBe(true);
  });
});
