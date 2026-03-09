/** @jsxImportSource @emotion/react */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from '@emotion/react';
import { css, useTheme } from '@emotion/react';
import { Component, type ErrorInfo, type ReactNode, useState, useEffect, useSyncExternalStore } from 'react';

import { trpc, trpcClient } from './utils/trpc';
import { lightTheme, darkTheme } from './styles/theme';
import { GlobalStyles } from './styles/GlobalStyles';
import { useSettingsStore } from './store';

// Guards
import { AuthGuard } from './components/guards/AuthGuard';
import { GuestGuard } from './components/guards/GuestGuard';
import { SetupGuard } from './components/guards/SetupGuard';

// Layout
import { AppLayout } from './components/layout/AppLayout';

// Auth pages
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';

// Vault pages
import { UnlockPage } from './pages/UnlockPage';
import { MigrationPage } from './pages/MigrationPage';

// Onboarding
import { OnboardingLayout } from './pages/onboarding/OnboardingLayout';
import { WelcomeStep } from './pages/onboarding/WelcomeStep';
import { AgentProviderStep } from './pages/onboarding/AgentProviderStep';
import { IdentityStep } from './pages/onboarding/IdentityStep';
import { AboutYouStep } from './pages/onboarding/AboutYouStep';
import { ExistenceStep } from './pages/onboarding/persona/ExistenceStep';
import { PersonaIdentityStep } from './pages/onboarding/persona/IdentityStep';
import { ArchetypeStep } from './pages/onboarding/persona/ArchetypeStep';
import { DimensionsStep } from './pages/onboarding/persona/DimensionsStep';
import { TraitsStep } from './pages/onboarding/persona/TraitsStep';
import { ValuesStep } from './pages/onboarding/persona/ValuesStep';
import { BackgroundStep } from './pages/onboarding/persona/BackgroundStep';
import { ReviewStep } from './pages/onboarding/persona/ReviewStep';
import { RestoreStep } from './pages/onboarding/RestoreStep';
import { BirthPage } from './pages/onboarding/BirthPage';

// App pages
import { PresencePage } from './pages/PresencePage';
import { MindPage } from './pages/MindPage';
import { PeoplePage } from './pages/PeoplePage';
import { PersonaPage } from './pages/PersonaPage';
import { SettingsPage } from './pages/SettingsPage';
import { ConfigurationPage } from './pages/ConfigurationPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { SetupPage } from './pages/SetupPage';
import { MaintenanceOverlay } from './components/MaintenanceOverlay';
import { DownloadToast } from './components/DownloadToast';
import { ToastContainer } from './components/ToastContainer';
import { AutoUpdateManager } from './components/AutoUpdateManager';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      retry: 1,
    },
  },
});

// ============================================================================
// Error Boundary
// ============================================================================

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] Uncaught error:', error, info.componentStack);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          fontFamily: 'Outfit, system-ui, sans-serif',
          background: '#FAF9F4',
          color: '#2C2925',
        }}>
          <h1 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Something went wrong</h1>
          <p style={{ color: '#8A857E', marginBottom: '1.5rem' }}>
            {this.state.error?.message ?? 'An unexpected error occurred.'}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '0.5rem 1.5rem',
              border: '1px solid #D5D0C8',
              borderRadius: '8px',
              background: 'white',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ============================================================================
// Theme
// ============================================================================

/** Subscribe to OS color scheme changes */
function useSystemDarkMode(): boolean {
  return useSyncExternalStore(
    (callback) => {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      mql.addEventListener('change', callback);
      return () => mql.removeEventListener('change', callback);
    },
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
}

function ThemeSelector({ children }: { children: ReactNode }) {
  const themePref = useSettingsStore((s) => s.theme);
  const systemDark = useSystemDarkMode();

  let resolvedTheme = lightTheme;
  if (themePref === 'dark') {
    resolvedTheme = darkTheme;
  } else if (themePref === 'system') {
    resolvedTheme = systemDark ? darkTheme : lightTheme;
  }

  return (
    <ThemeProvider theme={resolvedTheme}>
      <GlobalStyles />
      {children}
    </ThemeProvider>
  );
}

export function App() {
  return (
    <ErrorBoundary>
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ThemeSelector>
          <BrowserRouter>
            <Routes>
              {/* Vault routes (no auth required) */}
              <Route path="/unlock" element={<UnlockPage />} />
              <Route path="/migrate" element={<MigrationPage />} />

              {/* Guest routes */}
              <Route path="/login" element={<GuestGuard><LoginPage /></GuestGuard>} />
              <Route path="/register" element={<GuestGuard><RegisterPage /></GuestGuard>} />

              {/* Setup route (auth required, before onboarding) */}
              <Route path="/setup" element={<AuthGuard><SetupPage /></AuthGuard>} />

              {/* Onboarding routes (auth required, SDK must be installed) */}
              <Route path="/onboarding" element={<AuthGuard><SetupGuard><OnboardingLayout /></SetupGuard></AuthGuard>}>
                <Route index element={<Navigate to="welcome" replace />} />
                <Route path="welcome" element={<WelcomeStep />} />
                <Route path="restore" element={<RestoreStep />} />
                <Route path="agent" element={<AgentProviderStep />} />
                <Route path="identity" element={<IdentityStep />} />
                <Route path="about-you" element={<AboutYouStep />} />
                <Route path="persona" element={<Navigate to="existence" replace />} />
                <Route path="persona/existence" element={<ExistenceStep />} />
                <Route path="persona/identity" element={<PersonaIdentityStep />} />
                <Route path="persona/archetype" element={<ArchetypeStep />} />
                <Route path="persona/dimensions" element={<DimensionsStep />} />
                <Route path="persona/traits" element={<TraitsStep />} />
                <Route path="persona/values" element={<ValuesStep />} />
                <Route path="persona/background" element={<BackgroundStep />} />
                <Route path="persona/review" element={<ReviewStep />} />
              </Route>
              <Route path="/onboarding/birth" element={<AuthGuard><SetupGuard><BirthPage /></SetupGuard></AuthGuard>} />

              {/* Main app routes (auth required, SDK must be installed) */}
              <Route element={<AuthGuard><SetupGuard><AppLayout /></SetupGuard></AuthGuard>}>
                <Route path="/" element={<PresencePage />} />
                <Route path="/presence" element={<Navigate to="/" replace />} />
                <Route path="/mind" element={<MindPage />} />
                <Route path="/mind/*" element={<MindPage />} />
                <Route path="/people" element={<PeoplePage />} />
                <Route path="/people/*" element={<PeoplePage />} />
                <Route path="/persona" element={<PersonaPage />} />
                <Route path="/persona/*" element={<PersonaPage />} />
                <Route path="/settings/channels/:name/configure" element={<ConfigurationPage extensionType="channel" />} />
                <Route path="/settings/plugins/:name/configure" element={<ConfigurationPage extensionType="plugin" />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/settings/*" element={<SettingsPage />} />
              </Route>

              {/* 404 */}
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </BrowserRouter>
          <MaintenanceOverlay />
          <DownloadToast />
          <AutoUpdateManager />
          <ToastContainer />
        </ThemeSelector>
      </QueryClientProvider>
    </trpc.Provider>
    </ErrorBoundary>
  );
}
