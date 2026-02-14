/** @jsxImportSource @emotion/react */
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store';
import { trpc } from '../../utils/trpc';
import { Spinner } from '../ui/Spinner';
import { css, useTheme } from '@emotion/react';
import { useEffect } from 'react';

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const theme = useTheme();
  const location = useLocation();
  const { isAuthenticated, setUser, logout } = useAuthStore();

  // Check auth on mount — the cookie-based session is the source of truth
  const { data: meData, isLoading: authLoading, error } = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  // Check onboarding status for non-onboarding routes
  const isOnboardingRoute = location.pathname.startsWith('/onboarding');
  const { data: onboardingState, isLoading: onboardingLoading } = trpc.onboarding.getState.useQuery(
    undefined,
    { enabled: !!meData && !isOnboardingRoute, retry: false, refetchOnWindowFocus: false }
  );

  useEffect(() => {
    if (meData) {
      setUser(meData);
    }
    if (error) {
      logout();
    }
  }, [meData, error, setUser, logout]);

  if (authLoading || (meData && !isOnboardingRoute && onboardingLoading)) {
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

  if (!meData) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // If onboarding isn't complete, redirect non-onboarding routes to onboarding
  if (!isOnboardingRoute && onboardingState && !onboardingState.isComplete) {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}
