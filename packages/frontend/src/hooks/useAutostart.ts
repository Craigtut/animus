import { useState, useEffect, useCallback } from 'react';
import { isTauri } from '../utils/tauri';

interface AutostartState {
  available: boolean;
  enabled: boolean;
  loading: boolean;
  toggle: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
}

export function useAutostart(): AutostartState {
  const [available, setAvailable] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isTauri()) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    import('@tauri-apps/plugin-autostart').then(({ isEnabled }) => {
      if (cancelled) return;
      setAvailable(true);
      return isEnabled();
    }).then((result) => {
      if (cancelled) return;
      if (result !== undefined) setEnabled(result);
    }).catch(() => {
      // Plugin not available
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, []);

  const setEnabledExplicit = useCallback(async (nextEnabled: boolean) => {
    if (!available) return;
    setLoading(true);
    try {
      const { enable, disable, isEnabled } = await import('@tauri-apps/plugin-autostart');
      if (nextEnabled) {
        await enable();
      } else {
        await disable();
      }
      setEnabled(await isEnabled());
    } finally {
      setLoading(false);
    }
  }, [available]);

  const toggle = useCallback(async () => {
    await setEnabledExplicit(!enabled);
  }, [enabled, setEnabledExplicit]);

  return { available, enabled, loading, toggle, setEnabled: setEnabledExplicit };
}
