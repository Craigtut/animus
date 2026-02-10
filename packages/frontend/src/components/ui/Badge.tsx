/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { type ReactNode } from 'react';

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info';

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
}

export function Badge({ variant = 'default', children, className }: BadgeProps) {
  const theme = useTheme();

  const variantStyles = {
    default: css`
      background: ${theme.colors.background.elevated};
      color: ${theme.colors.text.secondary};
    `,
    success: css`
      background: ${theme.colors.success.main}1a;
      color: ${theme.colors.success.main};
    `,
    warning: css`
      background: ${theme.colors.warning.main}1a;
      color: ${theme.colors.warning.main};
    `,
    error: css`
      background: ${theme.colors.error.main}1a;
      color: ${theme.colors.error.main};
    `,
    info: css`
      background: ${theme.colors.info.main}1a;
      color: ${theme.colors.info.main};
    `,
  };

  return (
    <span
      className={className}
      css={css`
        display: inline-flex;
        align-items: center;
        padding: ${theme.spacing[0.5]} ${theme.spacing[2]};
        font-size: ${theme.typography.fontSize.xs};
        font-weight: ${theme.typography.fontWeight.medium};
        border-radius: ${theme.borderRadius.full};
        white-space: nowrap;
        ${variantStyles[variant]}
      `}
    >
      {children}
    </span>
  );
}
