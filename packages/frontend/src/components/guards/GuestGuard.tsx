/** @jsxImportSource @emotion/react */
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../../store';
import { trpc } from '../../utils/trpc';
import { Spinner } from '../ui/Spinner';
import { css, useTheme } from '@emotion/react';

interface GuestGuardProps {
  children: React.ReactNode;
}

export function GuestGuard({ children }: GuestGuardProps) {
  const theme = useTheme();
  const { isAuthenticated } = useAuthStore();

  const { data: meData, isLoading } = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return (
      <div css={css`
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: ${theme.colors.background.default};
      `}>
        <Spinner size={24} />
      </div>
    );
  }

  if (isAuthenticated || meData) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
