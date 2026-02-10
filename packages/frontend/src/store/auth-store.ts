/**
 * Auth Store
 *
 * Manages authentication state: current user and session status.
 * Persisted to localStorage so the UI remembers login state across refreshes.
 * The cookie-based JWT session is the true source of truth (validated by AuthGuard).
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface AuthState {
  isAuthenticated: boolean;
  user: { userId: string; email: string } | null;
  setUser: (user: { userId: string; email: string } | null) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      isAuthenticated: false,
      user: null,
      setUser: (user) => set({ user, isAuthenticated: !!user }),
      logout: () => set({ user: null, isAuthenticated: false }),
    }),
    {
      name: 'animus-auth',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
