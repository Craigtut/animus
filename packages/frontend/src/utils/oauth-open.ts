import { isTauri } from './tauri';

/**
 * OAuth sign-in page opening, across platforms.
 *
 * In remote/headless mode the backend can't open a browser (no display), so the
 * frontend must open the provider's sign-in page itself. The catch: the auth URL
 * isn't known when the user clicks "Sign In" — it arrives asynchronously over a
 * subscription after a backend round-trip. Browsers only honor `window.open`
 * inside a user gesture, so a plain open on arrival gets swallowed by popup
 * blockers.
 *
 * The fix is a two-step handshake: grab a blank tab synchronously in the click
 * handler (`preopenAuthWindow`), then navigate it once the URL arrives
 * (`openAuthUrl`). The Tauri desktop app has no popup-blocker problem and must
 * route external URLs to the system browser, so it skips the pre-open and opens
 * directly via the shell plugin.
 */

/**
 * Pre-open a blank browser tab from within a click handler, to be navigated to
 * the auth URL later. Web only: returns null in Tauri (the desktop app opens the
 * system browser directly on arrival) and when the browser blocked the popup.
 */
export function preopenAuthWindow(): Window | null {
  if (isTauri()) return null;
  try {
    return window.open('about:blank', '_blank');
  } catch {
    return null;
  }
}

/**
 * Send the browser to an OAuth sign-in page.
 *
 * - Tauri: opens the system default browser via the shell plugin (the webview
 *   must never host the provider login).
 * - Web with a pre-opened tab: navigates that tab, surviving popup blockers.
 * - Web without one: best-effort `window.open` (may be blocked, in which case
 *   the URL is still rendered as a clickable link as a fallback).
 */
export function openAuthUrl(url: string, preopened: Window | null): void {
  if (isTauri()) {
    void import('@tauri-apps/plugin-shell')
      .then(({ open }) => open(url))
      .catch(() => {
        window.open(url, '_blank', 'noopener,noreferrer');
      });
    return;
  }

  if (preopened && !preopened.closed) {
    try {
      // replace() keeps about:blank out of the new tab's history.
      preopened.location.replace(url);
      return;
    } catch {
      // Fall through to a fresh window.
    }
  }

  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Close a pre-opened auth tab that never received a URL (e.g. the user
 * cancelled, or the flow errored before the URL arrived). Safe to call with
 * null or an already-closed window.
 */
export function closeAuthWindow(win: Window | null): void {
  if (win && !win.closed) {
    try {
      win.close();
    } catch {
      // Ignore; nothing we can do if the browser refuses.
    }
  }
}
