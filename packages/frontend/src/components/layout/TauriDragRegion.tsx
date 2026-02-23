/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useCallback } from 'react';
import { isTauri } from '../../utils/tauri';

/**
 * Renders the Tauri window drag region (frosted glass titlebar strip + extended invisible drag target).
 * Safe to include on any page — renders nothing when not running inside Tauri.
 */
export function TauriDragRegion() {
  const theme = useTheme();

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.buttons === 1) {
      e.preventDefault();
      import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
        getCurrentWindow().startDragging();
      });
    }
  }, []);

  if (!isTauri()) return null;

  return (
    <>
      {/* Visual titlebar strip: frosted glass behind traffic lights */}
      <div
        onMouseDown={handleMouseDown}
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
        `}
      />
      {/* Extended drag region: invisible, sits behind nav pill for wider drag target */}
      <div
        onMouseDown={handleMouseDown}
        css={css`
          position: fixed;
          top: var(--titlebar-area-height, 0px);
          left: 0;
          right: 0;
          height: 40px;
          z-index: ${theme.zIndex.navPill - 1};
        `}
      />
    </>
  );
}
