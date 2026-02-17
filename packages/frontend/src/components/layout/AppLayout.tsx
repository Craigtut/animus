/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useCallback } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import { NavigationPill } from './NavigationPill';
import { CommandPalette } from './CommandPalette';
import { useSubscriptionManager } from '../../hooks/useSubscriptionManager';
import { isTauri } from '../../utils/tauri';

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

  const handleDragRegionMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.buttons === 1) {
      e.preventDefault();
      import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
        getCurrentWindow().startDragging();
      });
    }
  }, []);

  return (
    <div
      css={css`
        min-height: 100vh;
        background: ${theme.colors.background.default};
      `}
    >
      {/* Tauri: frosted glass titlebar with drag region */}
      {isTauri() && (
        <>
          {/* Visual titlebar strip: frosted glass behind traffic lights */}
          <div
            onMouseDown={handleDragRegionMouseDown}
            css={css`
              position: fixed;
              top: 0;
              left: 0;
              right: 0;
              height: var(--titlebar-area-height, 0px);
              z-index: ${theme.zIndex.navPill + 1};
              background: ${theme.mode === 'light'
                ? 'rgba(0, 0, 0, 0.04)'
                : 'rgba(0, 0, 0, 0.2)'};
              backdrop-filter: blur(12px);
              -webkit-backdrop-filter: blur(12px);
              border-bottom: 1px solid ${theme.mode === 'light'
                ? 'rgba(0, 0, 0, 0.06)'
                : 'rgba(255, 255, 255, 0.06)'};
            `}
          />
          {/* Extended drag region: invisible, sits behind nav pill for wider drag target */}
          <div
            onMouseDown={handleDragRegionMouseDown}
            css={css`
              position: fixed;
              top: var(--titlebar-area-height, 0px);
              left: 0;
              right: 0;
              height: 40px;
              z-index: ${theme.zIndex.navPill - 1};
            `}
          />
        </>
      )}
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
