/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { type ReactNode, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface TooltipProps {
  content: string;
  children: ReactNode;
  position?: 'top' | 'bottom';
  align?: 'center' | 'right';
}

export function Tooltip({ content, children, position = 'top', align = 'center' }: TooltipProps) {
  const theme = useTheme();
  const [visible, setVisible] = useState(false);

  return (
    <div
      css={css`position: relative; display: inline-flex;`}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      <AnimatePresence>
        {visible && (
          <motion.div
            role="tooltip"
            initial={{ opacity: 0, y: position === 'top' ? 4 : -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.1 }}
            css={css`
              position: absolute;
              ${position === 'top' ? 'bottom: calc(100% + 6px);' : 'top: calc(100% + 6px);'}
              ${align === 'right' ? 'right: 0;' : 'left: 50%; transform: translateX(-50%);'}
              z-index: ${theme.zIndex.tooltip};
              padding: ${theme.spacing[1]} ${theme.spacing[2]};
              background: ${theme.colors.background.default};
              border: 1px solid ${theme.colors.border.default};
              border-radius: ${theme.borderRadius.sm};
              font-size: ${theme.typography.fontSize.xs};
              color: ${theme.colors.text.secondary};
              white-space: nowrap;
              pointer-events: none;
            `}
          >
            {content}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
