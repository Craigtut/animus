/**
 * Settings Store
 *
 * Persisted user preferences. Currently just theme selection;
 * will grow as the Settings page gains more options.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface SettingsState {
  theme: 'light' | 'dark' | 'system';
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'light',  // light is default per spec
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'animus-settings',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
