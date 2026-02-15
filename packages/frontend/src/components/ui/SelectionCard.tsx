/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { type HTMLAttributes, type ReactNode, type KeyboardEvent } from 'react';
import { Check } from '@phosphor-icons/react';
import { Card } from './Card';

type SelectionCardPadding = 'none' | 'sm' | 'md' | 'lg';

interface SelectionCardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onClick'> {
  selected: boolean;
  rank?: number | undefined;
  disabled?: boolean;
  onClick?: () => void;
  padding?: SelectionCardPadding;
  children: ReactNode;
}

export function SelectionCard({
  selected,
  rank,
  disabled = false,
  onClick,
  padding = 'md',
  children,
  ...props
}: SelectionCardProps) {
  const theme = useTheme();

  const handleKeyDown = (e: KeyboardEvent) => {
    if (disabled) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick?.();
    }
  };

  return (
    <Card
      variant={selected ? 'elevated' : 'outlined'}
      padding={padding}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-pressed={selected}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onClick}
      onKeyDown={handleKeyDown}
      css={css`
        cursor: ${disabled ? 'default' : 'pointer'};
        transition: all ${theme.transitions.normal};

        ${selected ? css`
          box-shadow: ${theme.shadows.md};
          border-color: ${theme.colors.border.focus};
        ` : css`
          opacity: ${disabled ? 0.4 : 0.72};
        `}

        ${!disabled ? css`
          &:hover {
            transform: scale(1.01);
            ${!selected ? css`opacity: 0.88;` : ''}
          }
        ` : ''}
      `}
      {...props}
    >
      {/* Indicator */}
      {selected && (
        <div
          css={css`
            position: absolute;
            top: ${theme.spacing[3]};
            right: ${theme.spacing[3]};
            width: 24px;
            height: 24px;
            border-radius: 50%;
            background: ${theme.colors.accent};
            color: ${theme.colors.accentForeground};
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1;
          `}
        >
          {rank != null ? (
            <span
              css={css`
                font-size: ${theme.typography.fontSize.xs};
                font-weight: ${theme.typography.fontWeight.semibold};
                line-height: 1;
              `}
            >
              {rank}
            </span>
          ) : (
            <Check size={14} weight="bold" />
          )}
        </div>
      )}
      {children}
    </Card>
  );
}
