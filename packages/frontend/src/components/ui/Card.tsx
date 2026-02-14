/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { type HTMLAttributes, type ReactNode } from 'react';

type CardVariant = 'elevated' | 'outlined' | 'transparent';
type CardPadding = 'none' | 'sm' | 'md' | 'lg';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  padding?: CardPadding;
  interactive?: boolean;
  children: ReactNode;
}

export function Card({
  variant = 'elevated',
  padding = 'md',
  interactive = false,
  children,
  ...props
}: CardProps) {
  const theme = useTheme();

  const paddingMap = {
    none: '0',
    sm: theme.spacing[3],
    md: theme.spacing[6],
    lg: theme.spacing[8],
  };

  const variantStyles = {
    elevated: css`
      background: ${theme.colors.background.paper};
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid transparent;
      position: relative;
      /* Rim lighting — gradient border via pseudo-element to preserve border-radius */
      &::before {
        content: '';
        position: absolute;
        inset: -1px;
        border-radius: inherit;
        padding: 1px;
        background: ${theme.colors.rimGradient};
        mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
        mask-composite: exclude;
        -webkit-mask-composite: xor;
        pointer-events: none;
      }
    `,
    outlined: css`
      background: ${theme.colors.background.elevated};
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border: 1px solid ${theme.colors.border.default};
    `,
    transparent: css`
      background: transparent;
      border: none;
    `,
  };

  return (
    <div
      css={css`
        border-radius: ${theme.borderRadius.md};
        padding: ${paddingMap[padding]};
        transition: transform ${theme.transitions.fast};
        overflow: hidden;
        position: relative;
        ${variantStyles[variant]}
        ${interactive ? css`
          cursor: pointer;
          &:hover {
            transform: scale(1.01);
          }
        ` : ''}
      `}
      {...props}
    >
      {children}
    </div>
  );
}
