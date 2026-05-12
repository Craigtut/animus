/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { type ReactNode, useState, useRef, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';

interface TooltipProps {
  content: string;
  children: ReactNode;
  position?: 'top' | 'bottom';
  align?: 'center' | 'right';
  /** Set a max-width to allow text wrapping (default: no wrap) */
  maxWidth?: number;
}

export function Tooltip({ content, children, position = 'top', align = 'center', maxWidth }: TooltipProps) {
  const theme = useTheme();
  const [visible, setVisible] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const top = position === 'top' ? rect.top - 6 : rect.bottom + 6;
    const left = align === 'right' ? rect.right : rect.left + rect.width / 2;
    setCoords({ top, left });
  }, [position, align]);

  useLayoutEffect(() => {
    if (visible) updatePosition();
  }, [visible, updatePosition]);

  return (
    <div
      ref={triggerRef}
      css={css`display: inline-flex;`}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {createPortal(
        <AnimatePresence>
          {visible && (
            <motion.div
              role="tooltip"
              initial={{ opacity: 0, y: position === 'top' ? 4 : -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.1 }}
              css={css`
                position: fixed;
                top: ${coords.top}px;
                left: ${coords.left}px;
                ${position === 'top' ? 'transform: translateX(-50%) translateY(-100%);' : 'transform: translateX(-50%);'}
                ${align === 'right' ? 'transform: translateY(-100%);' : ''}
                z-index: ${theme.zIndex.tooltip};
                padding: ${theme.spacing[1]} ${theme.spacing[2]};
                background: ${theme.colors.background.default};
                border: 1px solid ${theme.colors.border.default};
                border-radius: ${theme.borderRadius.sm};
                font-size: ${theme.typography.fontSize.xs};
                color: ${theme.colors.text.secondary};
                white-space: ${maxWidth ? 'normal' : 'nowrap'};
                ${maxWidth ? `max-width: ${maxWidth}px;` : ''}
                pointer-events: none;
              `}
            >
              {content}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
