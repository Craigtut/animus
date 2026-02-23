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
import { useDownloadStore } from '../store/download-store';
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
    completeTurn,
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
      queryClient.invalidateQueries({ queryKey: [['heartbeat', 'getEmotionHistory']] });
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
      // Invalidate listAgentTasks so the Agents tab refreshes on spawn/complete/fail
      queryClient.invalidateQueries({ queryKey: [['heartbeat', 'listAgentTasks']] });
    },
  });

  // ========================================================================
  // 6. Reply streaming (from the mind)
  // ========================================================================
  trpc.heartbeat.onReply.useSubscription(undefined, {
    onData: (data) => {
      if (data.type === 'chunk') {
        useHeartbeatStore.getState().appendReplyChunk(data.content, data.turnIndex ?? 0);
      } else if (data.type === 'turn_complete') {
        useHeartbeatStore.getState().completeTurn(data.turnIndex ?? 0, data.content);
        // No query invalidation here — the onMessage subscription handles that
        // when message:sent fires from sendOutbound
      } else {
        useHeartbeatStore.getState().completeReply(data.content, data.tickNumber, data.totalTurns);
        // Safety net: invalidate messages in case turn-level sends were missed
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

  // ========================================================================
  // 8. Energy updates
  // ========================================================================
  trpc.heartbeat.onEnergyChange.useSubscription(undefined, {
    onData: (data) => {
      useHeartbeatStore.getState().updateEnergy(data.energyLevel, data.band);
      queryClient.invalidateQueries({ queryKey: [['heartbeat', 'getEnergyState']] });
      queryClient.invalidateQueries({ queryKey: [['heartbeat', 'getEnergyHistory']] });
    },
  });

  // ========================================================================
  // 9. Goal changes
  // ========================================================================
  trpc.goals.onGoalChange.useSubscription(undefined, {
    onData: () => {
      queryClient.invalidateQueries({ queryKey: [['goals']] });
    },
  });

  // ========================================================================
  // 10. Seed changes
  // ========================================================================
  trpc.goals.onSeedChange.useSubscription(undefined, {
    onData: () => {
      queryClient.invalidateQueries({ queryKey: [['goals', 'getSeeds']] });
    },
  });

  // ========================================================================
  // 11. Memory changes
  // ========================================================================
  trpc.memory.onMemoryChange.useSubscription(undefined, {
    onData: (event: { type: string; detail?: unknown }) => {
      if (event.type === 'working') {
        queryClient.invalidateQueries({ queryKey: [['memory', 'getWorkingMemory']] });
        queryClient.invalidateQueries({ queryKey: [['memory', 'listWorkingMemories']] });
      } else if (event.type === 'core') {
        queryClient.invalidateQueries({ queryKey: [['memory', 'getCoreSelf']] });
      } else if (event.type === 'stored' || event.type === 'pruned' || event.type === 'deleted') {
        queryClient.invalidateQueries({ queryKey: [['memory', 'browseLongTermMemories']] });
      }
    },
  });

  // ========================================================================
  // 12. Tick decisions
  // ========================================================================
  trpc.heartbeat.onDecision.useSubscription(undefined, {
    onData: () => {
      queryClient.invalidateQueries({ queryKey: [['heartbeat', 'getRecentDecisions']] });
      queryClient.invalidateQueries({ queryKey: [['heartbeat', 'getTickDecisions']] });
    },
  });

  // ========================================================================
  // 13. Tick context stored (heartbeat inspector)
  // ========================================================================
  trpc.heartbeat.onTickStored.useSubscription(undefined, {
    onData: () => {
      queryClient.invalidateQueries({ queryKey: [['heartbeat', 'listTicks']] });
    },
  });

  // ========================================================================
  // 14. Tick input stored (early — before LLM prompting)
  // ========================================================================
  trpc.heartbeat.onTickInputStored.useSubscription(undefined, {
    onData: () => {
      queryClient.invalidateQueries({ queryKey: [['heartbeat', 'listTicks']] });
    },
  });

  // ========================================================================
  // 15. Sub-agent live events (for Agents tab event timeline)
  // ========================================================================
  trpc.heartbeat.onAgentEvent.useSubscription(undefined, {
    onData: (event) => {
      useHeartbeatStore.getState().addSubAgentEvent(event);
    },
  });

  // ========================================================================
  // 16. Tool approval requests
  // ========================================================================
  trpc.tools.onApprovalRequest.useSubscription(undefined, {
    onData: () => {
      queryClient.invalidateQueries({ queryKey: [['tools', 'listApprovals']] });
    },
  });

  // ========================================================================
  // 17. Tool approval resolutions
  // ========================================================================
  trpc.tools.onApprovalResolved.useSubscription(undefined, {
    onData: () => {
      queryClient.invalidateQueries({ queryKey: [['tools', 'listApprovals']] });
      queryClient.invalidateQueries({ queryKey: [['tools', 'listTools']] });
    },
  });

  // ========================================================================
  // 18. Download progress
  // ========================================================================
  trpc.downloads.onProgress.useSubscription(undefined, {
    onData: (data) => {
      const store = useDownloadStore.getState();
      switch (data.type) {
        case 'started':
          store.handleStarted(data.assetId, data.label, data.category);
          break;
        case 'progress':
          store.handleProgress(data.assetId, data.label, data.category, data.bytesDownloaded, data.totalBytes, data.percent, data.phase);
          break;
        case 'completed':
          store.handleCompleted(data.assetId, data.label, data.category);
          // Invalidate speech status so Voice tab updates
          queryClient.invalidateQueries({ queryKey: [['speech']] });
          break;
        case 'failed':
          store.handleFailed(data.assetId, data.label, data.category, data.error, data.retriesRemaining);
          break;
      }
    },
  });
}
