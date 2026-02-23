/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { Outlet, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import { NavigationPill } from './NavigationPill';
import { CommandPalette } from './CommandPalette';
import { TauriDragRegion } from './TauriDragRegion';
import { useSubscriptionManager } from '../../hooks/useSubscriptionManager';

export function AppLayout() {
  // Wire all tRPC subscriptions into Zustand stores once at the shell level.
  // This ensures subscriptions are active whenever the user is authenticated,
  // regardless of which page they're viewing.
  useSubscriptionManager();
  const theme = useTheme();
  const location = useLocation();

  // Determine the current space for animation key
  const getSpaceKey = () => {
    const path = location.pathname;
    if (path.startsWith('/mind')) return 'mind';
    if (path.startsWith('/people')) return 'people';
    if (path.startsWith('/persona')) return 'persona';
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
      <TauriDragRegion />
      <NavigationPill />
      <CommandPalette />

      <motion.main
        key={getSpaceKey()}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        css={css`
          /* Desktop: leave room for pill at top + titlebar inset on macOS Tauri */
          padding-top: ${getSpaceKey() === 'presence'
            ? 'var(--titlebar-area-height, 0px)'
            : 'calc(60px + var(--titlebar-area-height, 0px))'};

          /* Mobile: leave room for bottom nav */
          @media (max-width: ${theme.breakpoints.md}) {
            padding-top: ${getSpaceKey() === 'presence'
              ? 'var(--titlebar-area-height, 0px)'
              : `calc(${theme.spacing[4]} + var(--titlebar-area-height, 0px))`};
            padding-bottom: 72px;
          }
        `}
      >
        <Outlet />
      </motion.main>
    </div>
  );
}
