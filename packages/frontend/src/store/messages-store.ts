/**
 * Messages Store
 *
 * Centralized client-side state for conversations and messages.
 * Holds the active conversation, a live message buffer fed by
 * the messages.onMessage subscription, and typing/streaming indicators.
 */

import { create } from 'zustand';
import type { Message } from '@animus/shared';

interface MessagesStoreState {
  activeConversationId: string | null;

  /** Buffer of messages received via subscription (newest first) */
  liveMessages: Message[];

  /** Tracks whether a new message was just received (for scroll-to-bottom triggers) */
  hasNewMessage: boolean;

  // -- Actions --
  setActiveConversationId: (id: string | null) => void;
  addMessage: (msg: Message) => void;
  acknowledgeNewMessage: () => void;
  clearLiveMessages: () => void;
}

const MAX_LIVE_MESSAGES = 200;

export const useMessagesStore = create<MessagesStoreState>()((set) => ({
  activeConversationId: null,
  liveMessages: [],
  hasNewMessage: false,

  setActiveConversationId: (id) => set({ activeConversationId: id }),

  addMessage: (msg) =>
    set((prev) => {
      // Deduplicate by id
      if (prev.liveMessages.some((m) => m.id === msg.id)) return prev;
      return {
        liveMessages: [msg, ...prev.liveMessages].slice(0, MAX_LIVE_MESSAGES),
        hasNewMessage: true,
      };
    }),

  acknowledgeNewMessage: () => set({ hasNewMessage: false }),

  clearLiveMessages: () => set({ liveMessages: [], hasNewMessage: false }),
}));
