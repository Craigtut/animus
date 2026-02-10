/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { motion } from 'motion/react';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
}

export function Toggle({ checked, onChange, disabled = false, label }: ToggleProps) {
  const theme = useTheme();

  return (
    <label
      css={css`
        display: inline-flex;
        align-items: center;
        gap: ${theme.spacing[2]};
        cursor: ${disabled ? 'not-allowed' : 'pointer'};
        opacity: ${disabled ? 0.5 : 1};
      `}
    >
      <button
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        css={css`
          position: relative;
          width: 40px;
          height: 22px;
          border-radius: ${theme.borderRadius.full};
          background: ${checked ? theme.colors.accent : theme.colors.background.elevated};
          border: 1px solid ${theme.colors.border.default};
          padding: 0;
          transition: background ${theme.transitions.fast};
          cursor: inherit;
        `}
      >
        <motion.div
          animate={{ x: checked ? 18 : 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          css={css`
            width: 18px;
            height: 18px;
            border-radius: 50%;
            background: ${checked ? theme.colors.accentForeground : theme.colors.text.secondary};
            position: absolute;
            top: 1px;
            left: 1px;
          `}
        />
      </button>
      {label && (
        <span css={css`
          font-size: ${theme.typography.fontSize.sm};
          color: ${theme.colors.text.primary};
        `}>
          {label}
        </span>
      )}
    </label>
  );
}
