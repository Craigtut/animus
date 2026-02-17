import { useState, useEffect, useCallback } from 'react';
import { isTauri } from '../utils/tauri';

interface AutostartState {
  available: boolean;
  enabled: boolean;
  loading: boolean;
  toggle: () => Promise<void>;
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

  const toggle = useCallback(async () => {
    if (!available) return;
    setLoading(true);
    try {
      const { enable, disable, isEnabled } = await import('@tauri-apps/plugin-autostart');
      if (enabled) {
        await disable();
      } else {
        await enable();
      }
      setEnabled(await isEnabled());
    } finally {
      setLoading(false);
    }
  }, [available, enabled]);

  return { available, enabled, loading, toggle };
}
