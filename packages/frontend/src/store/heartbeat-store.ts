/**
 * Heartbeat Store
 *
 * Centralized client-side cache for all heartbeat-related real-time data:
 * - Heartbeat state (tick number, stage, running status)
 * - Emotion intensities (all 12 emotions)
 * - Recent thoughts and experiences
 * - Agent status events
 * - Reply streaming state
 *
 * Subscription data flows into this store via the SubscriptionManager hook,
 * making it available to all pages without duplicate subscriptions.
 */

import { create } from 'zustand';
import type { HeartbeatState, EmotionState, Thought, Experience } from '@animus/shared';

// ============================================================================
// Agent event shape (matches heartbeat.onAgentStatus subscription)
// ============================================================================

export interface AgentStatusEvent {
  type: 'spawned' | 'completed' | 'failed';
  taskId: string;
  detail?: string;
  receivedAt: number;
}

// ============================================================================
// Reply streaming state
// ============================================================================

export interface ReplyStreamState {
  isStreaming: boolean;
  accumulated: string;
  tickNumber?: number;
}

// ============================================================================
// Store shape
// ============================================================================

interface HeartbeatStoreState {
  // -- Heartbeat state --
  heartbeatState: HeartbeatState | null;
  isHeartbeatActive: boolean;

  // -- Emotions --
  emotions: Map<string, EmotionState>;

  // -- Thoughts & Experiences --
  recentThoughts: Thought[];
  recentExperiences: Experience[];

  // -- Agent events --
  agentEvents: AgentStatusEvent[];

  // -- Reply streaming --
  replyStream: ReplyStreamState;

  // -- Actions --
  setHeartbeatState: (state: HeartbeatState) => void;
  setHeartbeatActive: (active: boolean) => void;
  updateEmotion: (emotion: EmotionState) => void;
  setEmotions: (emotions: EmotionState[]) => void;
  addThought: (thought: Thought) => void;
  addExperience: (experience: Experience) => void;
  addAgentEvent: (event: Omit<AgentStatusEvent, 'receivedAt'>) => void;
  appendReplyChunk: (content: string) => void;
  completeReply: (content: string, tickNumber?: number) => void;
  clearReplyStream: () => void;
}

const MAX_RECENT_THOUGHTS = 50;
const MAX_RECENT_EXPERIENCES = 50;
const MAX_AGENT_EVENTS = 100;

export const useHeartbeatStore = create<HeartbeatStoreState>()((set) => ({
  // Initial state
  heartbeatState: null,
  isHeartbeatActive: false,
  emotions: new Map(),
  recentThoughts: [],
  recentExperiences: [],
  agentEvents: [],
  replyStream: { isStreaming: false, accumulated: '' },

  // -- Heartbeat state --
  setHeartbeatState: (state) =>
    set({
      heartbeatState: state,
      isHeartbeatActive: state.isRunning,
    }),

  setHeartbeatActive: (active) => set({ isHeartbeatActive: active }),

  // -- Emotions --
  updateEmotion: (emotion) =>
    set((prev) => {
      const next = new Map(prev.emotions);
      next.set(emotion.emotion, emotion);
      return { emotions: next };
    }),

  setEmotions: (emotions) =>
    set(() => {
      const map = new Map<string, EmotionState>();
      for (const e of emotions) map.set(e.emotion, e);
      return { emotions: map };
    }),

  // -- Thoughts --
  addThought: (thought) =>
    set((prev) => {
      // Deduplicate by id, prepend, and cap
      if (prev.recentThoughts.some((t) => t.id === thought.id)) return prev;
      return {
        recentThoughts: [thought, ...prev.recentThoughts].slice(0, MAX_RECENT_THOUGHTS),
      };
    }),

  // -- Experiences --
  addExperience: (experience) =>
    set((prev) => {
      if (prev.recentExperiences.some((e) => e.id === experience.id)) return prev;
      return {
        recentExperiences: [experience, ...prev.recentExperiences].slice(0, MAX_RECENT_EXPERIENCES),
      };
    }),

  // -- Agent events --
  addAgentEvent: (event) =>
    set((prev) => ({
      agentEvents: [
        { ...event, receivedAt: Date.now() },
        ...prev.agentEvents,
      ].slice(0, MAX_AGENT_EVENTS),
    })),

  // -- Reply streaming --
  appendReplyChunk: (content) =>
    set((prev) => {
      const next: ReplyStreamState = {
        isStreaming: true,
        accumulated: prev.replyStream.accumulated + content,
      };
      if (prev.replyStream.tickNumber !== undefined) {
        next.tickNumber = prev.replyStream.tickNumber;
      }
      return { replyStream: next };
    }),

  completeReply: (content, tickNumber) =>
    set(() => {
      const next: ReplyStreamState = {
        isStreaming: false,
        accumulated: content,
      };
      if (tickNumber !== undefined) {
        next.tickNumber = tickNumber;
      }
      return { replyStream: next };
    }),

  clearReplyStream: () =>
    set(() => ({
      replyStream: { isStreaming: false, accumulated: '' },
    })),
}));

// ============================================================================
// Selectors (for ergonomic access)
// ============================================================================

/** Get all emotions as an array sorted by name */
export const selectEmotionsArray = (state: HeartbeatStoreState): EmotionState[] =>
  Array.from(state.emotions.values());

/** Get a specific emotion's current state */
export const selectEmotion = (state: HeartbeatStoreState, name: string): EmotionState | undefined =>
  state.emotions.get(name);

/** Check if any agents are currently running */
export const selectHasRunningAgents = (state: HeartbeatStoreState): boolean => {
  const spawned = new Set<string>();
  // Process oldest to newest
  const chronological = [...state.agentEvents].reverse();
  for (const e of chronological) {
    if (e.type === 'spawned') spawned.add(e.taskId);
    else spawned.delete(e.taskId);
  }
  return spawned.size > 0;
};
