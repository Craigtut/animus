/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { Link, useLocation } from 'react-router-dom';
import { WarningCircle } from '@phosphor-icons/react';
import { useMemo } from 'react';
import { useHeartbeatStore } from '../store/heartbeat-store';

/**
 * Persistent banner shown across the app when the active AI provider's auth has
 * failed (OAuth token expired and unrefreshable, or an API key was revoked). The
 * mind cannot think until credentials are restored, so this stays up until the
 * user reconnects. It self-clears when auth recovers: the backend emits
 * cortex:auth-recovered (handled in useSubscriptionManager), and reconnecting
 * from Settings clears the underlying error directly.
 */
export function ProviderAuthBanner() {
  const theme = useTheme();
  const location = useLocation();
  const systemErrors = useHeartbeatStore((s) => s.systemErrors);

  const authError = useMemo(
    () => systemErrors.filter((e) => e.category === 'authentication').at(-1) ?? null,
    [systemErrors],
  );

  // The AI Provider settings page already shows the detailed reconnect card.
  if (!authError || location.pathname.startsWith('/settings/cortex_provider')) return null;

  return (
    <div
      css={css`
        display: flex;
        align-items: center;
        justify-content: center;
        gap: ${theme.spacing[3]};
        padding: ${theme.spacing[2]} ${theme.spacing[4]};
        background: ${theme.colors.warning.main}26;
        border-bottom: 1px solid ${theme.colors.warning.main}44;
        font-size: ${theme.typography.fontSize.sm};
        color: ${theme.mode === 'light' ? theme.colors.warning.dark : theme.colors.warning.light};
        text-align: center;
        flex-wrap: wrap;
      `}
    >
      <WarningCircle size={16} weight="fill" />
      <span>Your AI provider needs to be reconnected. Thinking is paused until you sign in again.</span>
      <Link
        to="/settings/cortex_provider"
        css={css`
          color: inherit;
          font-weight: ${theme.typography.fontWeight.medium};
          text-decoration: underline;
          text-underline-offset: 2px;
          transition: opacity ${theme.transitions.fast};
          &:hover {
            opacity: 0.8;
          }
        `}
      >
        Reconnect
      </Link>
    </div>
  );
}
