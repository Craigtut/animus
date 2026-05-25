import { useEffect, useRef } from 'react';
import { trpc } from '../utils/trpc';
import { isTauri } from '../utils/tauri';
import { setDesktopPowerSettings } from '../utils/desktop-power';
import { useAuthStore } from '../store/auth-store';

export function DesktopRuntimeManager() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const lastAppliedRef = useRef<string | null>(null);

  const { data: settings } = trpc.settings.getSystemSettings.useQuery(undefined, {
    enabled: isTauri() && isAuthenticated,
    retry: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!isTauri()) return;
    if (isAuthenticated) return;

    lastAppliedRef.current = 'false:false';
    void setDesktopPowerSettings(false, false).catch(() => {});
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isTauri() || !settings) return;

    const key = `${settings.desktopKeepComputerAwake}:${settings.desktopKeepDisplayAwake}`;
    if (lastAppliedRef.current === key) return;
    lastAppliedRef.current = key;

    void setDesktopPowerSettings(
      settings.desktopKeepComputerAwake,
      settings.desktopKeepDisplayAwake,
    ).catch(() => {
      lastAppliedRef.current = null;
    });
  }, [settings]);

  return null;
}
