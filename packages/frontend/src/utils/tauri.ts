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

/**
 * Intercept clicks on external links and open them in the system browser.
 * In a Tauri webview, `target="_blank"` links don't open in the browser
 * by default — this handler catches them and uses the shell plugin.
 * Call once at app startup. No-op when not running in Tauri.
 */
export function initExternalLinkHandler(): void {
  if (!isTauri()) return;

  // Use capture phase to intercept before Tauri's webview handles target="_blank"
  document.addEventListener('click', (e) => {
    const anchor = (e.target as HTMLElement).closest('a');
    if (!anchor) return;

    const href = anchor.getAttribute('href');
    if (!href) return;

    // Only intercept external URLs (http/https), not in-app routes
    if (!href.startsWith('http://') && !href.startsWith('https://')) return;

    // Only intercept links meant to leave the app (target="_blank" or external origin)
    const isExternal = anchor.target === '_blank' ||
      !href.startsWith(window.location.origin);

    if (!isExternal) return;

    e.preventDefault();
    e.stopImmediatePropagation();

    // Dynamically import to avoid bundling shell plugin in browser builds
    import('@tauri-apps/plugin-shell').then(({ open }) => {
      open(href);
    });
  }, true); // capture phase
}
