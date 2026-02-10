/**
 * Subscription Manager Hook
 *
 * Centralizes all tRPC WebSocket subscriptions into a single mount point.
 * Routes incoming data into the appropriate Zustand stores.
 *
 * Mount this once in the app shell (after authentication) to ensure:
 * - All subscriptions share one WebSocket connection
 * - No duplicate subscriptions when navigating between pages
 * - Stores stay populated regardless of which page is active
 * - Reconnection is handled gracefully via tRPC's built-in retry
 */

import { trpc } from '../utils/trpc';
import { useHeartbeatStore } from '../store/heartbeat-store';
import { useMessagesStore } from '../store/messages-store';
import { useQueryClient } from '@tanstack/react-query';

export function useSubscriptionManager() {
  const queryClient = useQueryClient();

  const {
    setHeartbeatState,
    updateEmotion,
    addThought,
    addExperience,
    addAgentEvent,
    appendReplyChunk,
    completeReply,
  } = useHeartbeatStore.getState();

  const { addMessage } = useMessagesStore.getState();

  // ========================================================================
  // 1. Heartbeat state changes
  // ========================================================================
  trpc.heartbeat.onStateChange.useSubscription(undefined, {
    onData: (state) => {
      // Use getState() to avoid stale closure
      useHeartbeatStore.getState().setHeartbeatState(state);
    },
  });

  // ========================================================================
  // 2. Emotion updates
  // ========================================================================
  trpc.heartbeat.onEmotionChange.useSubscription(undefined, {
    onData: (emotion) => {
      useHeartbeatStore.getState().updateEmotion(emotion);
    },
  });

  // ========================================================================
  // 3. New thoughts
  // ========================================================================
  trpc.heartbeat.onThoughts.useSubscription(undefined, {
    onData: (thought) => {
      useHeartbeatStore.getState().addThought(thought);
      // Also invalidate the query cache so pages re-fetching get fresh data
      queryClient.invalidateQueries({ queryKey: [['heartbeat', 'getRecentThoughts']] });
    },
  });

  // ========================================================================
  // 4. New experiences
  // ========================================================================
  trpc.heartbeat.onExperience.useSubscription(undefined, {
    onData: (experience) => {
      useHeartbeatStore.getState().addExperience(experience);
      queryClient.invalidateQueries({ queryKey: [['heartbeat', 'getRecentExperiences']] });
    },
  });

  // ========================================================================
  // 5. Agent status events
  // ========================================================================
  trpc.heartbeat.onAgentStatus.useSubscription(undefined, {
    onData: (event) => {
      useHeartbeatStore.getState().addAgentEvent(event);
    },
  });

  // ========================================================================
  // 6. Reply streaming (from the mind)
  // ========================================================================
  trpc.heartbeat.onReply.useSubscription(undefined, {
    onData: (data) => {
      if (data.type === 'chunk') {
        useHeartbeatStore.getState().appendReplyChunk(data.content);
      } else {
        useHeartbeatStore.getState().completeReply(data.content, data.tickNumber);
        // Invalidate messages to pick up the completed reply
        queryClient.invalidateQueries({ queryKey: [['messages', 'getRecent']] });
      }
    },
  });

  // ========================================================================
  // 7. New messages (both inbound and outbound)
  // ========================================================================
  trpc.messages.onMessage.useSubscription(undefined, {
    onData: (msg) => {
      useMessagesStore.getState().addMessage(msg);
      // Invalidate the query cache so the conversation view refreshes
      queryClient.invalidateQueries({ queryKey: [['messages', 'getRecent']] });
    },
  });
}
