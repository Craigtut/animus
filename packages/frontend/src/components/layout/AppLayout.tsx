/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { Outlet } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useLocation } from 'react-router-dom';
import { NavigationPill } from './NavigationPill';
import { CommandPalette } from './CommandPalette';
import { useSubscriptionManager } from '../../hooks/useSubscriptionManager';

export function AppLayout() {
  // Wire all tRPC subscriptions into Zustand stores once at the shell level.
  // This ensures subscriptions are active whenever the user is authenticated,
  // regardless of which page they're viewing.
  useSubscriptionManager();
  const theme = useTheme();
  const location = useLocation();

  // Determine the current space for AnimatePresence key
  const getSpaceKey = () => {
    const path = location.pathname;
    if (path.startsWith('/mind')) return 'mind';
    if (path.startsWith('/people')) return 'people';
    if (path.startsWith('/settings')) return 'settings';
    return 'presence';
  };

  return (
    <div
      css={css`
        min-height: 100vh;
        background: ${theme.colors.background.default};
      `}
    >
      <NavigationPill />
      <CommandPalette />

      <AnimatePresence mode="wait">
        <motion.main
          key={getSpaceKey()}
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -10 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          css={css`
            /* Desktop: leave room for pill at top */
            padding-top: 60px;

            /* Mobile: leave room for bottom nav */
            @media (max-width: ${theme.breakpoints.md}) {
              padding-top: ${theme.spacing[4]};
              padding-bottom: 72px;
            }
          `}
        >
          <Outlet />
        </motion.main>
      </AnimatePresence>
    </div>
  );
}
