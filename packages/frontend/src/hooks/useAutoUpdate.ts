import { useState, useEffect, useCallback, useRef } from 'react';
import { isTauri } from '../utils/tauri';
import { toast } from '../store/toast-store';

const STORAGE_KEY_ENABLED = 'animus_auto_update_enabled';
export const STORAGE_KEY_DISMISSED = 'animus_dismissed_update_version';
const CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

export interface AutoUpdateState {
  available: boolean;
  enabled: boolean;
  checking: boolean;
  downloading: boolean;
  updateReady: boolean;
  updateVersion: string | null;
  toggle: () => void;
  checkNow: () => Promise<void>;
  dismiss: () => void;
}

export function useAutoUpdate(): AutoUpdateState {
  const [available, setAvailable] = useState(false);
  const [enabled, setEnabled] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY_ENABLED);
    return stored === null ? true : stored === 'true';
  });
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateRef = useRef<any>(null);
  const isRunningRef = useRef(false);

  const checkForUpdate = useCallback(async (silent: boolean) => {
    if (isRunningRef.current) return;
    isRunningRef.current = true;
    setChecking(true);
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();

      if (update) {
        // Skip re-downloading a version the user already dismissed
        const dismissed = localStorage.getItem(STORAGE_KEY_DISMISSED);
        if (silent && update.version === dismissed) {
          return;
        }

        updateRef.current = update;
        setUpdateVersion(update.version);
        setDownloading(true);
        setChecking(false);

        await update.download();
        setDownloading(false);
        setUpdateReady(true);

        if (!silent) {
          toast.success(`Update v${update.version} downloaded and ready to install.`);
        }
      } else {
        if (!silent) {
          toast.info('You are running the latest version.');
        }
      }
    } catch (err) {
      if (!silent) {
        toast.error('Failed to check for updates.', {
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      isRunningRef.current = false;
      setChecking(false);
      setDownloading(false);
    }
  }, []); // stable reference, no state dependencies

  const dismiss = useCallback(() => {
    const version = updateRef.current?.version;
    if (version) {
      localStorage.setItem(STORAGE_KEY_DISMISSED, version);
    }
    setUpdateReady(false);
    setUpdateVersion(null);
    updateRef.current = null;
  }, []);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY_ENABLED, String(next));
      return next;
    });
  }, []);

  const checkNow = useCallback(async () => {
    await checkForUpdate(false);
  }, [checkForUpdate]);

  // Detect Tauri availability
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;

    import('@tauri-apps/plugin-updater').then(() => {
      if (!cancelled) setAvailable(true);
    }).catch(() => {
      // Plugin not available
    });

    return () => { cancelled = true; };
  }, []);

  // Initial check on mount + interval
  useEffect(() => {
    if (!available || !enabled) return;

    // Check after a short delay to let the app settle
    const initialTimeout = setTimeout(() => {
      checkForUpdate(true);
    }, 5000);

    const interval = setInterval(() => {
      checkForUpdate(true);
    }, CHECK_INTERVAL);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, [available, enabled, checkForUpdate]);

  // Listen for tray menu 'check-for-updates' event
  useEffect(() => {
    if (!isTauri()) return;

    let unlisten: (() => void) | undefined;

    import('@tauri-apps/api/event').then(({ listen }) => {
      listen('check-for-updates', () => {
        checkForUpdate(false);
      }).then((fn) => {
        unlisten = fn;
      });
    }).catch(() => {
      // Event API not available
    });

    return () => { unlisten?.(); };
  }, [checkForUpdate]);

  return {
    available,
    enabled,
    checking,
    downloading,
    updateReady,
    updateVersion,
    toggle,
    checkNow,
    dismiss,
  };
}
