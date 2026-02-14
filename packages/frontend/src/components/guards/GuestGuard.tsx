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

  const { data: meData, isLoading: authLoading } = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const isAuthed = isAuthenticated || !!meData;

  // Check onboarding status to decide where to redirect authenticated users
  const { data: onboardingState, isLoading: onboardingLoading } = trpc.onboarding.getState.useQuery(
    undefined,
    { enabled: isAuthed, retry: false, refetchOnWindowFocus: false }
  );

  if (authLoading || (isAuthed && onboardingLoading)) {
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

  if (isAuthed) {
    // Redirect to onboarding if not complete, otherwise to main app
    const dest = onboardingState?.isComplete ? '/' : '/onboarding';
    return <Navigate to={dest} replace />;
  }

  return <>{children}</>;
}
