/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { Spinner } from './Spinner';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading = false, disabled, children, ...props }, ref) => {
    const theme = useTheme();

    const sizeStyles = {
      sm: css`
        padding: ${theme.spacing[1.5]} ${theme.spacing[3]};
        font-size: ${theme.typography.fontSize.sm};
        border-radius: 9999px;
      `,
      md: css`
        padding: ${theme.spacing[2]} ${theme.spacing[5]};
        font-size: ${theme.typography.fontSize.base};
        border-radius: 9999px;
      `,
      lg: css`
        padding: ${theme.spacing[3]} ${theme.spacing[6]};
        font-size: ${theme.typography.fontSize.lg};
        border-radius: 9999px;
      `,
    };

    const variantStyles = {
      primary: css`
        background: ${theme.colors.accent};
        color: ${theme.colors.accentForeground};
        &:hover:not(:disabled) {
          opacity: 0.9;
        }
      `,
      secondary: css`
        background: transparent;
        color: ${theme.colors.text.primary};
        border: 1px solid ${theme.colors.border.default};
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        &:hover:not(:disabled) {
          background: ${theme.colors.background.elevated};
        }
      `,
      ghost: css`
        background: transparent;
        color: ${theme.colors.text.secondary};
        &:hover:not(:disabled) {
          color: ${theme.colors.text.primary};
          background: ${theme.colors.background.elevated};
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
        }
      `,
      danger: css`
        background: ${theme.colors.error.main};
        color: #fff;
        &:hover:not(:disabled) {
          background: ${theme.colors.error.dark};
        }
      `,
    };

    return (
      <motion.button
        ref={ref}
        {...(disabled || loading ? {} : { whileHover: { scale: 1.01 }, whileTap: { scale: 0.98 } })}
        transition={{ duration: 0.1 }}
        disabled={disabled || loading}
        css={css`
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: ${theme.spacing[2]};
          font-family: inherit;
          font-weight: ${theme.typography.fontWeight.medium};
          cursor: pointer;
          border: none;
          transition: all ${theme.transitions.fast};
          white-space: nowrap;

          &:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }

          ${sizeStyles[size]}
          ${variantStyles[variant]}
        `}
        {...(props as Record<string, unknown>)}
      >
        {loading && <Spinner size={size === 'sm' ? 14 : 18} />}
        {children}
      </motion.button>
    );
  }
);

Button.displayName = 'Button';
