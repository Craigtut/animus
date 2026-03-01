/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { isTauri } from '../../utils/tauri';

/**
 * Renders the Tauri window drag region (frosted glass titlebar strip + extended invisible drag target).
 * Safe to include on any page; renders nothing outside Tauri.
 *
 * Uses data-tauri-drag-region + app-region:drag CSS for native-level drag handling.
 * The CSS property tells WKWebView (macOS) / WebView2 (Windows) to handle the drag
 * at the platform layer, avoiding the IPC roundtrip that breaks startDragging().
 * No JavaScript mouse handlers: they interfere with wry's native hit-testing.
 */
export function TauriDragRegion() {
  const theme = useTheme();

  if (!isTauri()) return null;

  return (
    <>
      {/* Visual titlebar strip: frosted glass behind traffic lights */}
      <div
        data-tauri-drag-region
        css={css`
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          height: var(--titlebar-area-height, 0px);
          z-index: ${theme.zIndex.navPill + 1};
          background: ${theme.mode === 'light'
            ? 'rgba(0, 0, 0, 0.04)'
            : 'rgba(0, 0, 0, 0.2)'};
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border-bottom: 1px solid ${theme.mode === 'light'
            ? 'rgba(0, 0, 0, 0.06)'
            : 'rgba(255, 255, 255, 0.06)'};
          app-region: drag;
          -webkit-app-region: drag;
          user-select: none;
          -webkit-user-select: none;
        `}
      />
      {/* Extended drag region: invisible, sits behind nav pill for wider drag target */}
      <div
        data-tauri-drag-region
        css={css`
          position: fixed;
          top: var(--titlebar-area-height, 0px);
          left: 0;
          right: 0;
          height: 40px;
          z-index: ${theme.zIndex.navPill - 1};
          app-region: drag;
          -webkit-app-region: drag;
          user-select: none;
          -webkit-user-select: none;
        `}
      />
    </>
  );
}
