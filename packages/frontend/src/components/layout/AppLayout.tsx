/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { Outlet, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { NavigationPill } from './NavigationPill';
import { CommandPalette } from './CommandPalette';
import { TauriDragRegion } from './TauriDragRegion';
import { useSubscriptionManager } from '../../hooks/useSubscriptionManager';
import { trpc, setWsAuthToken } from '../../utils/trpc';

/**
 * Mounts all tRPC WebSocket subscriptions.
 * Rendered as a standalone component so it can be conditionally mounted
 * after the WebSocket auth token is available.
 */
function SubscriptionMount() {
  useSubscriptionManager();
  return null;
}

export function AppLayout() {
  // Fetch the JWT for WebSocket connectionParams authentication.
  // WKWebView on macOS doesn't reliably send cookies with WebSocket upgrade
  // requests. tRPC's connectionParams sends the token as the first WS message
  // (not in the URL), so it works securely across all platforms.
  const { data: tokenData } = trpc.auth.wsToken.useQuery(undefined, {
    retry: 3,
    retryDelay: 1000,
  });
  const [wsReady, setWsReady] = useState(false);

  useEffect(() => {
    if (tokenData?.token && !wsReady) {
      setWsAuthToken(tokenData.token);
      setWsReady(true);
    }
  }, [tokenData, wsReady]);

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
      {/* Mount subscriptions only after WS auth token is available */}
      {wsReady && <SubscriptionMount />}

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
