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

  // Check vault seal state — determines whether to show unlock/migration pages.
  // Polls every 30s so the UI detects server restarts (sealed state) proactively.
  const { data: sealStatus, isLoading: sealLoading } = trpc.seal.status.useQuery(undefined, {
    retry: 3,
    retryDelay: 1000,
    refetchInterval: 30_000,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
  });

  // Check auth on mount — the cookie-based session is the source of truth
  const { data: meData, isLoading: authLoading, error } = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    enabled: sealStatus?.sealState !== 'sealed' && sealStatus?.sealState !== 'needs-migration',
  });

  // Always check if any user exists — used to redirect to /register vs /login.
  // This runs unconditionally (not gated on auth.me) to avoid a timing gap
  // where auth.me finishes but the status query hasn't started yet.
  const { data: authStatus, isLoading: statusLoading } = trpc.auth.status.useQuery(undefined, {
    retry: 3,
    retryDelay: 1000,
    refetchOnWindowFocus: false,
    enabled: sealStatus?.sealState !== 'sealed' && sealStatus?.sealState !== 'needs-migration',
  });

  // Check onboarding status for routing decisions
  const isOnboardingRoute = location.pathname.startsWith('/onboarding');
  const isSetupRoute = location.pathname.startsWith('/setup');
  const { data: onboardingState, isLoading: onboardingLoading } = trpc.onboarding.getState.useQuery(
    undefined,
    { enabled: !!meData, retry: false, refetchOnWindowFocus: false }
  );

  useEffect(() => {
    if (meData) {
      setUser(meData);
    }
    if (error) {
      logout();
    }
  }, [meData, error, setUser, logout]);

  // Vault seal state: redirect to unlock or migration page
  if (sealStatus?.sealState === 'sealed') {
    return <Navigate to="/unlock" replace />;
  }
  if (sealStatus?.sealState === 'needs-migration') {
    return <Navigate to="/migrate" replace />;
  }

  if (sealLoading || authLoading || statusLoading || (meData && onboardingLoading)) {
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
    // No user exists yet — go to registration instead of login
    if (authStatus && !authStatus.hasUser) {
      return <Navigate to="/register" replace />;
    }
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // If onboarding is complete, prevent access to onboarding routes (but not /setup,
  // which handles SDK installation independently of onboarding state)
  if (isOnboardingRoute && onboardingState?.isComplete) {
    return <Navigate to="/" replace />;
  }

  // If onboarding isn't complete, redirect non-onboarding/non-setup routes to onboarding
  if (!isOnboardingRoute && !isSetupRoute && onboardingState && !onboardingState.isComplete) {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}
