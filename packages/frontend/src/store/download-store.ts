/**
 * Download Store
 *
 * Client-side state for active, completed, and failed downloads.
 * Fed by the downloads.onProgress tRPC subscription via useSubscriptionManager.
 */

import { create } from 'zustand';

// ============================================================================
// Types
// ============================================================================

export type DownloadPhase = 'downloading' | 'extracting' | 'completed' | 'failed';

export interface DownloadItem {
  assetId: string;
  label: string;
  category: string;
  phase: DownloadPhase;
  bytesDownloaded: number;
  totalBytes: number;
  percent: number;
  error?: string;
  retriesRemaining?: number;
  completedAt?: number;
}

interface DownloadStore {
  items: Map<string, DownloadItem>;
  /** Whether toast should be visible */
  visible: boolean;
  /** Whether user has manually dismissed */
  dismissed: boolean;

  // Actions
  handleStarted: (assetId: string, label: string, category: string) => void;
  handleProgress: (assetId: string, label: string, category: string, bytesDownloaded: number, totalBytes: number, percent: number, phase: 'downloading' | 'extracting') => void;
  handleCompleted: (assetId: string, label: string, category: string) => void;
  handleFailed: (assetId: string, label: string, category: string, error: string, retriesRemaining: number) => void;
  dismiss: () => void;
  retry: () => void;
}

// ============================================================================
// Store
// ============================================================================

export const useDownloadStore = create<DownloadStore>((set, get) => ({
  items: new Map(),
  visible: false,
  dismissed: false,

  handleStarted: (assetId, label, category) => {
    set((state) => {
      const items = new Map(state.items);
      items.set(assetId, {
        assetId,
        label,
        category,
        phase: 'downloading',
        bytesDownloaded: 0,
        totalBytes: 0,
        percent: 0,
      });
      return { items, visible: true, dismissed: false };
    });
  },

  handleProgress: (assetId, label, category, bytesDownloaded, totalBytes, percent, phase) => {
    set((state) => {
      const items = new Map(state.items);
      const existing = items.get(assetId);
      items.set(assetId, {
        assetId,
        label,
        category,
        phase,
        bytesDownloaded,
        totalBytes,
        percent,
        ...(existing?.error != null ? { error: existing.error } : {}),
      });
      return { items, visible: true, dismissed: false };
    });
  },

  handleCompleted: (assetId, label, category) => {
    set((state) => {
      const items = new Map(state.items);
      items.set(assetId, {
        assetId,
        label,
        category,
        phase: 'completed',
        bytesDownloaded: 0,
        totalBytes: 0,
        percent: 100,
        completedAt: Date.now(),
      });

      // Auto-dismiss after 3s if all items are completed
      const allDone = Array.from(items.values()).every((i) => i.phase === 'completed');
      if (allDone) {
        setTimeout(() => {
          const current = get();
          const stillAllDone = Array.from(current.items.values()).every((i) => i.phase === 'completed');
          if (stillAllDone) {
            set({ visible: false, items: new Map() });
          }
        }, 3000);
      }

      return { items };
    });
  },

  handleFailed: (assetId, label, category, error, retriesRemaining) => {
    set((state) => {
      const items = new Map(state.items);
      items.set(assetId, {
        assetId,
        label,
        category,
        phase: 'failed',
        bytesDownloaded: 0,
        totalBytes: 0,
        percent: 0,
        error,
        retriesRemaining,
      });
      return { items };
    });
  },

  dismiss: () => {
    set({ dismissed: true, visible: false });
  },

  retry: () => {
    // Clear failed items — the retry triggers a new tRPC mutation
    set((state) => {
      const items = new Map(state.items);
      for (const [id, item] of items) {
        if (item.phase === 'failed') items.delete(id);
      }
      return { items, dismissed: false };
    });
  },
}));
