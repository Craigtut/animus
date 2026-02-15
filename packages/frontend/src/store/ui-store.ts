/**
 * UI Store (Shell)
 *
 * Manages app shell UI state: active navigation space, command palette visibility,
 * and WebSocket connection status. Not persisted -- resets on page reload.
 */

import { create } from 'zustand';

export type SpaceName = 'presence' | 'mind' | 'people' | 'persona' | 'settings';

interface ShellState {
  activeSpace: SpaceName;
  setActiveSpace: (space: SpaceName) => void;
  isCommandPaletteOpen: boolean;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  connectionStatus: 'connected' | 'reconnecting' | 'disconnected';
  setConnectionStatus: (status: 'connected' | 'reconnecting' | 'disconnected') => void;
}

export const useShellStore = create<ShellState>()((set) => ({
  activeSpace: 'presence',
  setActiveSpace: (space) => set({ activeSpace: space }),
  isCommandPaletteOpen: false,
  openCommandPalette: () => set({ isCommandPaletteOpen: true }),
  closeCommandPalette: () => set({ isCommandPaletteOpen: false }),
  connectionStatus: 'connected',
  setConnectionStatus: (status) => set({ connectionStatus: status }),
}));
