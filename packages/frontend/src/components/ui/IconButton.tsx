/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

type IconButtonSize = 'sm' | 'md' | 'lg';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: IconButtonSize;
  label: string;
  children: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ size = 'md', label, children, disabled, ...props }, ref) => {
    const theme = useTheme();

    const sizeMap = {
      sm: { box: '28px', icon: '16px' },
      md: { box: '36px', icon: '20px' },
      lg: { box: '44px', icon: '24px' },
    };

    const s = sizeMap[size];

    return (
      <button
        ref={ref}
        aria-label={label}
        disabled={disabled}
        css={css`
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: ${s.box};
          height: ${s.box};
          border-radius: ${theme.borderRadius.default};
          color: ${theme.colors.text.secondary};
          transition: all ${theme.transitions.fast};
          cursor: pointer;
          padding: 0;

          &:hover:not(:disabled) {
            color: ${theme.colors.text.primary};
            background: ${theme.colors.background.elevated};
          }

          &:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }

          & > svg {
            width: ${s.icon};
            height: ${s.icon};
          }
        `}
        {...props}
      >
        {children}
      </button>
    );
  }
);

IconButton.displayName = 'IconButton';
