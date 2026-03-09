import { useEffect, useRef } from 'react';
import { useAutoUpdate, STORAGE_KEY_DISMISSED } from '../hooks/useAutoUpdate';
import { toast, useToastStore } from '../store/toast-store';

export function AutoUpdateManager() {
  const { updateReady, updateVersion, installAndRestart, dismiss } = useAutoUpdate();
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

    toastIdRef.current = toast.info(`Update available (v${updateVersion})`, {
      duration: 0,
      actions: [
        { label: 'Restart Now', onClick: () => { installAndRestart(); } },
        { label: 'Later', onClick: () => { dismiss(); } },
      ],
    });
  }, [updateReady, updateVersion, installAndRestart, dismiss]);

  return null;
}
