export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Detect if running in Tauri on macOS.
 * macOS with transparent titlebar needs extra top padding for traffic lights.
 */
function isTauriMacOS(): boolean {
  return isTauri() && navigator.platform.startsWith('Mac');
}

/**
 * Set --titlebar-area-height CSS variable on the document root.
 * Call once at app startup. On macOS Tauri with transparent titlebar,
 * this is 28px to clear the traffic lights. Everywhere else it's 0px.
 */
export function initTitlebarInset(): void {
  const height = isTauriMacOS() ? '28px' : '0px';
  document.documentElement.style.setProperty('--titlebar-area-height', height);
}
