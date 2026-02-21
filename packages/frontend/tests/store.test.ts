/**
 * Frontend Store Tests
 *
 * Tests for Zustand stores: AuthStore, ShellStore, SettingsStore, OnboardingStore.
 * These are pure state logic tests that don't require a DOM environment.
 */

import { describe, it, expect, beforeEach, beforeAll } from 'vitest';

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

// Dynamic import after localStorage is defined
let useAuthStore: any;
let useShellStore: any;
let useSettingsStore: any;
let useOnboardingStore: any;
let useHeartbeatStore: any;
let useMessagesStore: any;

beforeAll(async () => {
  const mod = await import('../src/store/index.js');
  useAuthStore = mod.useAuthStore;
  useShellStore = mod.useShellStore;
  useSettingsStore = mod.useSettingsStore;
  useOnboardingStore = mod.useOnboardingStore;
  useHeartbeatStore = mod.useHeartbeatStore;
  useMessagesStore = mod.useMessagesStore;
});

// Reset stores between tests by calling their setState directly
function resetStores() {
  useAuthStore.setState({ isAuthenticated: false, user: null });
  useShellStore.setState({
    activeSpace: 'presence',
    isCommandPaletteOpen: false,
    connectionStatus: 'connected',
  });
  useSettingsStore.setState({ theme: 'light' });
  useOnboardingStore.setState({ currentStep: 'welcome', completedSteps: [] });
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

describe('AuthStore', () => {
  beforeEach(resetStores);

  it('starts unauthenticated', () => {
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
  });

  it('sets user and marks authenticated', () => {
    useAuthStore.getState().setUser({ userId: 'u1', email: 'test@example.com' });
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.user).toEqual({ userId: 'u1', email: 'test@example.com' });
  });

  it('logout clears user and auth state', () => {
    useAuthStore.getState().setUser({ userId: 'u1', email: 'test@example.com' });
    useAuthStore.getState().logout();
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
  });

  it('setUser(null) marks unauthenticated', () => {
    useAuthStore.getState().setUser({ userId: 'u1', email: 'test@example.com' });
    useAuthStore.getState().setUser(null);
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
  });
});

describe('ShellStore', () => {
  beforeEach(resetStores);

  it('defaults to presence space', () => {
    expect(useShellStore.getState().activeSpace).toBe('presence');
  });

  it('changes active space', () => {
    useShellStore.getState().setActiveSpace('mind');
    expect(useShellStore.getState().activeSpace).toBe('mind');
  });

  it('opens and closes command palette', () => {
    expect(useShellStore.getState().isCommandPaletteOpen).toBe(false);
    useShellStore.getState().openCommandPalette();
    expect(useShellStore.getState().isCommandPaletteOpen).toBe(true);
    useShellStore.getState().closeCommandPalette();
    expect(useShellStore.getState().isCommandPaletteOpen).toBe(false);
  });

  it('tracks connection status', () => {
    expect(useShellStore.getState().connectionStatus).toBe('connected');
    useShellStore.getState().setConnectionStatus('reconnecting');
    expect(useShellStore.getState().connectionStatus).toBe('reconnecting');
    useShellStore.getState().setConnectionStatus('disconnected');
    expect(useShellStore.getState().connectionStatus).toBe('disconnected');
  });
});

describe('SettingsStore', () => {
  beforeEach(resetStores);

  it('defaults to light theme', () => {
    expect(useSettingsStore.getState().theme).toBe('light');
  });

  it('changes theme', () => {
    useSettingsStore.getState().setTheme('dark');
    expect(useSettingsStore.getState().theme).toBe('dark');
    useSettingsStore.getState().setTheme('system');
    expect(useSettingsStore.getState().theme).toBe('system');
  });
});

describe('OnboardingStore', () => {
  beforeEach(resetStores);

  it('starts at welcome step with no completed steps', () => {
    const state = useOnboardingStore.getState();
    expect(state.currentStep).toBe('welcome');
    expect(state.completedSteps).toEqual([]);
  });

  it('sets current step', () => {
    useOnboardingStore.getState().setCurrentStep('agent_provider');
    expect(useOnboardingStore.getState().currentStep).toBe('agent_provider');
  });

  it('marks steps complete', () => {
    useOnboardingStore.getState().markStepComplete('welcome');
    useOnboardingStore.getState().markStepComplete('agent_provider');
    const state = useOnboardingStore.getState();
    expect(state.completedSteps).toEqual(['welcome', 'agent_provider']);
  });

  it('does not duplicate completed steps', () => {
    useOnboardingStore.getState().markStepComplete('welcome');
    useOnboardingStore.getState().markStepComplete('welcome');
    expect(useOnboardingStore.getState().completedSteps).toEqual(['welcome']);
  });

  it('reset clears all progress', () => {
    useOnboardingStore.getState().setCurrentStep('persona_traits');
    useOnboardingStore.getState().markStepComplete('welcome');
    useOnboardingStore.getState().markStepComplete('agent_provider');
    useOnboardingStore.getState().reset();
    const state = useOnboardingStore.getState();
    expect(state.currentStep).toBe('welcome');
    expect(state.completedSteps).toEqual([]);
  });

  it('tracks full onboarding progression', () => {
    const steps: string[] = [
      'welcome',
      'agent_provider',
      'identity',
      'about_you',
      'channels',
      'persona_existence',
      'persona_identity',
      'persona_archetype',
      'persona_dimensions',
      'persona_traits',
      'persona_values',
      'persona_background',
      'persona_review',
      'birth',
      'complete',
    ];

    for (const step of steps) {
      useOnboardingStore.getState().setCurrentStep(step);
      useOnboardingStore.getState().markStepComplete(step);
    }

    const state = useOnboardingStore.getState();
    expect(state.currentStep).toBe('complete');
    expect(state.completedSteps).toHaveLength(steps.length);
    expect(state.completedSteps).toEqual(steps);
  });
});

describe('HeartbeatStore', () => {
  beforeEach(resetStores);

  it('defaults to inactive', () => {
    expect(useHeartbeatStore.getState().isHeartbeatActive).toBe(false);
  });

  it('toggles heartbeat active state', () => {
    useHeartbeatStore.getState().setHeartbeatActive(true);
    expect(useHeartbeatStore.getState().isHeartbeatActive).toBe(true);
    useHeartbeatStore.getState().setHeartbeatActive(false);
    expect(useHeartbeatStore.getState().isHeartbeatActive).toBe(false);
  });

  it('defaults to null heartbeat state', () => {
    expect(useHeartbeatStore.getState().heartbeatState).toBeNull();
  });

  it('sets heartbeat state and derives isActive', () => {
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
    useHeartbeatStore.getState().setHeartbeatState(mockState);
    const state = useHeartbeatStore.getState();
    expect(state.heartbeatState).toEqual(mockState);
    expect(state.isHeartbeatActive).toBe(true);
  });

  it('updates individual emotions', () => {
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

  it('setEmotions replaces all emotions', () => {
    const emotions = [
      { emotion: 'joy' as const, category: 'positive' as const, intensity: 0.5, baseline: 0.3, lastUpdatedAt: '2024-01-01T00:00:00Z' },
      { emotion: 'sadness' as const, category: 'negative' as const, intensity: 0.2, baseline: 0.3, lastUpdatedAt: '2024-01-01T00:00:00Z' },
    ];
    useHeartbeatStore.getState().setEmotions(emotions);
    expect(useHeartbeatStore.getState().emotions.size).toBe(2);
    expect(useHeartbeatStore.getState().emotions.get('joy')?.intensity).toBe(0.5);
  });

  it('adds thoughts with deduplication', () => {
    const thought1 = { id: 't1', tickNumber: 1, content: 'Hello', importance: 0.5, createdAt: '2024-01-01T00:00:00Z', expiresAt: null };
    const thought2 = { id: 't2', tickNumber: 2, content: 'World', importance: 0.6, createdAt: '2024-01-01T00:01:00Z', expiresAt: null };

    useHeartbeatStore.getState().addThought(thought1);
    useHeartbeatStore.getState().addThought(thought2);
    useHeartbeatStore.getState().addThought(thought1); // duplicate

    expect(useHeartbeatStore.getState().recentThoughts).toHaveLength(2);
    // Most recent first
    expect(useHeartbeatStore.getState().recentThoughts[0]?.id).toBe('t2');
  });

  it('adds experiences with deduplication', () => {
    const exp1 = { id: 'e1', tickNumber: 1, content: 'Did something', importance: 0.4, createdAt: '2024-01-01T00:00:00Z', expiresAt: null };
    useHeartbeatStore.getState().addExperience(exp1);
    useHeartbeatStore.getState().addExperience(exp1); // duplicate
    expect(useHeartbeatStore.getState().recentExperiences).toHaveLength(1);
  });

  it('adds agent events with timestamp', () => {
    useHeartbeatStore.getState().addAgentEvent({ type: 'spawned', taskId: 'task-1', detail: 'claude' });
    const events = useHeartbeatStore.getState().agentEvents;
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('spawned');
    expect(events[0]?.receivedAt).toBeGreaterThan(0);
  });

  it('manages reply stream lifecycle', () => {
    const store = useHeartbeatStore.getState;

    // Start streaming (turn 0)
    store().appendReplyChunk('Hello ', 0);
    expect(store().replyStream.turns).toHaveLength(1);
    expect(store().replyStream.turns[0]?.isStreaming).toBe(true);
    expect(store().replyStream.turns[0]?.accumulated).toBe('Hello ');

    // Continue streaming
    store().appendReplyChunk('world', 0);
    expect(store().replyStream.turns[0]?.accumulated).toBe('Hello world');

    // Complete
    store().completeReply('Hello world', 42);
    expect(store().replyStream.turns[0]?.isStreaming).toBe(false);
    expect(store().replyStream.turns[0]?.accumulated).toBe('Hello world');
    expect(store().replyStream.tickNumber).toBe(42);

    // Clear
    store().clearReplyStream();
    expect(store().replyStream.turns).toEqual([]);
  });

  it('caps thoughts at 50', () => {
    for (let i = 0; i < 55; i++) {
      useHeartbeatStore.getState().addThought({
        id: `t-${i}`,
        tickNumber: i,
        content: `Thought ${i}`,
        importance: 0.5,
        createdAt: new Date(Date.now() + i * 1000).toISOString(),
        expiresAt: null,
      });
    }
    expect(useHeartbeatStore.getState().recentThoughts).toHaveLength(50);
  });
});

describe('MessagesStore', () => {
  beforeEach(resetStores);

  it('defaults to no active conversation', () => {
    expect(useMessagesStore.getState().activeConversationId).toBeNull();
  });

  it('sets active conversation', () => {
    useMessagesStore.getState().setActiveConversationId('conv-123');
    expect(useMessagesStore.getState().activeConversationId).toBe('conv-123');
  });

  it('clears active conversation', () => {
    useMessagesStore.getState().setActiveConversationId('conv-123');
    useMessagesStore.getState().setActiveConversationId(null);
    expect(useMessagesStore.getState().activeConversationId).toBeNull();
  });

  it('defaults to empty live messages', () => {
    expect(useMessagesStore.getState().liveMessages).toEqual([]);
    expect(useMessagesStore.getState().hasNewMessage).toBe(false);
  });

  it('adds messages with deduplication', () => {
    const msg1 = {
      id: 'm1',
      conversationId: 'c1',
      contactId: 'ct1',
      direction: 'inbound' as const,
      channel: 'web' as const,
      content: 'Hello',
      metadata: null,
      tickNumber: null,
      createdAt: '2024-01-01T00:00:00Z',
    };
    useMessagesStore.getState().addMessage(msg1);
    useMessagesStore.getState().addMessage(msg1); // duplicate
    expect(useMessagesStore.getState().liveMessages).toHaveLength(1);
    expect(useMessagesStore.getState().hasNewMessage).toBe(true);
  });

  it('acknowledges new message flag', () => {
    const msg = {
      id: 'm2',
      conversationId: 'c1',
      contactId: 'ct1',
      direction: 'outbound' as const,
      channel: 'web' as const,
      content: 'Reply',
      metadata: null,
      tickNumber: 5,
      createdAt: '2024-01-01T00:01:00Z',
    };
    useMessagesStore.getState().addMessage(msg);
    expect(useMessagesStore.getState().hasNewMessage).toBe(true);
    useMessagesStore.getState().acknowledgeNewMessage();
    expect(useMessagesStore.getState().hasNewMessage).toBe(false);
  });

  it('clears live messages', () => {
    const msg = {
      id: 'm3',
      conversationId: 'c1',
      contactId: 'ct1',
      direction: 'inbound' as const,
      channel: 'web' as const,
      content: 'test',
      metadata: null,
      tickNumber: null,
      createdAt: '2024-01-01T00:00:00Z',
    };
    useMessagesStore.getState().addMessage(msg);
    useMessagesStore.getState().clearLiveMessages();
    expect(useMessagesStore.getState().liveMessages).toEqual([]);
    expect(useMessagesStore.getState().hasNewMessage).toBe(false);
  });
});
