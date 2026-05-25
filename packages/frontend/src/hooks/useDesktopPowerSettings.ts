import { useCallback, useEffect, useState } from 'react';
import { toast } from '../store/toast-store';
import { trpc } from '../utils/trpc';
import {
  getDesktopPowerStatus,
  isDesktopPowerPlatform,
  setDesktopPowerSettings,
  type DesktopPowerStatus,
} from '../utils/desktop-power';

interface DesktopPowerSettingsState {
  available: boolean;
  supported: boolean;
  loading: boolean;
  saving: boolean;
  keepComputerAwake: boolean;
  keepDisplayAwake: boolean;
  setKeepComputerAwake: (enabled: boolean) => Promise<void>;
  setKeepDisplayAwake: (enabled: boolean) => Promise<void>;
}

export function useDesktopPowerSettings(): DesktopPowerSettingsState {
  const platformAvailable = isDesktopPowerPlatform();
  const utils = trpc.useUtils();
  const { data: settings, isLoading: settingsLoading } = trpc.settings.getSystemSettings.useQuery();
  const updateSettingsMutation = trpc.settings.updateSystemSettings.useMutation({
    onSuccess: () => utils.settings.getSystemSettings.invalidate(),
  });

  const [status, setStatus] = useState<DesktopPowerStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(platformAvailable);

  useEffect(() => {
    if (!platformAvailable) {
      setStatusLoading(false);
      return;
    }

    let cancelled = false;
    getDesktopPowerStatus()
      .then((nextStatus) => {
        if (!cancelled) setStatus(nextStatus);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      })
      .finally(() => {
        if (!cancelled) setStatusLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [platformAvailable]);

  const apply = useCallback(async (keepComputerAwake: boolean, keepDisplayAwake: boolean) => {
    const previousComputerAwake = settings?.desktopKeepComputerAwake ?? false;
    const previousDisplayAwake = settings?.desktopKeepDisplayAwake ?? false;

    const persisted = await updateSettingsMutation.mutateAsync({
      desktopKeepComputerAwake: keepComputerAwake,
      desktopKeepDisplayAwake: keepDisplayAwake,
    });

    const normalizedComputerAwake = persisted.desktopKeepComputerAwake;
    const normalizedDisplayAwake = persisted.desktopKeepDisplayAwake;

    try {
      const nextStatus = await setDesktopPowerSettings(
        normalizedComputerAwake,
        normalizedDisplayAwake,
      );
      setStatus(nextStatus);
    } catch (error) {
      setStatus(null);
      await updateSettingsMutation.mutateAsync({
        desktopKeepComputerAwake: previousComputerAwake,
        desktopKeepDisplayAwake: previousDisplayAwake,
      }).catch(() => undefined);
      toast.error('Could not apply that desktop setting.', {
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }, [
    settings?.desktopKeepComputerAwake,
    settings?.desktopKeepDisplayAwake,
    updateSettingsMutation,
  ]);

  const keepComputerAwake = settings?.desktopKeepComputerAwake ?? false;
  const keepDisplayAwake = settings?.desktopKeepDisplayAwake ?? false;

  const setKeepComputerAwake = useCallback(async (enabled: boolean) => {
    await apply(enabled, enabled ? keepDisplayAwake : false);
  }, [apply, keepDisplayAwake]);

  const setKeepDisplayAwake = useCallback(async (enabled: boolean) => {
    await apply(enabled ? true : keepComputerAwake, enabled);
  }, [apply, keepComputerAwake]);

  return {
    available: platformAvailable && status?.supported !== false,
    supported: platformAvailable && status?.supported !== false,
    loading: settingsLoading || statusLoading,
    saving: updateSettingsMutation.isPending,
    keepComputerAwake,
    keepDisplayAwake,
    setKeepComputerAwake,
    setKeepDisplayAwake,
  };
}
