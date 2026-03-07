/** @jsxImportSource @emotion/react */
import { Navigate, useLocation } from 'react-router-dom';
import { trpc } from '../../utils/trpc';

interface SetupGuardProps {
  children: React.ReactNode;
}

/**
 * Guard that redirects to /setup if the Claude Agent SDK is not installed.
 * Passes through transparently when the SDK is already available (dev mode,
 * Docker, or after runtime installation in Tauri).
 */
export function SetupGuard({ children }: SetupGuardProps) {
  const location = useLocation();

  const { data: sdkStatus, isLoading } = trpc.sdk.status.useQuery(undefined, {
    retry: 2,
    retryDelay: 1000,
    staleTime: 30_000,
  });

  // While loading, pass through to avoid flash
  if (isLoading) {
    return <>{children}</>;
  }

  // SDK not installed and not already on /setup: redirect
  if (sdkStatus && !sdkStatus.installed && !sdkStatus.installing && !location.pathname.startsWith('/setup')) {
    return <Navigate to="/setup" replace />;
  }

  return <>{children}</>;
}
