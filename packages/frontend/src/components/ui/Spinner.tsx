/** @jsxImportSource @emotion/react */
import { css, useTheme, keyframes } from '@emotion/react';

interface SpinnerProps {
  size?: number;
  className?: string;
}

const spin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

export function Spinner({ size = 20, className }: SpinnerProps) {
  const theme = useTheme();

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      css={css`
        animation: ${spin} 800ms linear infinite;
      `}
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke={theme.colors.border.default}
        strokeWidth="2.5"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
