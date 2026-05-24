import { useEffect, useRef } from 'react';
import { useAutoUpdate, STORAGE_KEY_DISMISSED } from '../hooks/useAutoUpdate';
import { toast, useToastStore } from '../store/toast-store';

export function AutoUpdateManager() {
  const { updateReady, updateVersion, installAndRelaunch, dismiss } = useAutoUpdate();
  const toastIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!updateReady || !updateVersion) {
      if (toastIdRef.current) {
        useToastStore.getState().removeToast(toastIdRef.current);
        toastIdRef.current = null;
      }
      return;
    }

    const dismissed = localStorage.getItem(STORAGE_KEY_DISMISSED);
    if (dismissed === updateVersion) return;

    if (toastIdRef.current) {
      useToastStore.getState().removeToast(toastIdRef.current);
    }

    toastIdRef.current = toast.info(
      `Update v${updateVersion} is ready to install.`,
      {
        duration: 0,
        actions: [
          { label: 'Restart Now', onClick: () => { void installAndRelaunch(); } },
          { label: 'Later', onClick: () => { dismiss(); } },
        ],
      },
    );
  }, [updateReady, updateVersion, installAndRelaunch, dismiss]);

  return null;
}
