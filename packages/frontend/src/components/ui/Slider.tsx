/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useCallback, useRef, useState, useEffect } from 'react';

interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  leftLabel?: string;
  rightLabel?: string;
  showNeutral?: boolean;
  disabled?: boolean;
}

export function Slider({
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  leftLabel,
  rightLabel,
  showNeutral = true,
  disabled = false,
}: SliderProps) {
  const theme = useTheme();
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const neutralMin = 0.45;
  const neutralMax = 0.55;
  const isNeutral = showNeutral && value >= neutralMin && value <= neutralMax;
  const percentage = ((value - min) / (max - min)) * 100;

  const updateValue = useCallback(
    (clientX: number) => {
      if (!trackRef.current || disabled) return;
      const rect = trackRef.current.getBoundingClientRect();
      const raw = (clientX - rect.left) / rect.width;
      const clamped = Math.max(0, Math.min(1, raw));
      const stepped = Math.round(clamped / step) * step;
      const scaled = min + stepped * (max - min);
      onChange(Math.round(scaled * 100) / 100);
    },
    [min, max, step, onChange, disabled]
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => updateValue(e.clientX);
    const onUp = () => setDragging(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, updateValue]);

  return (
    <div
      css={css`
        display: flex;
        flex-direction: column;
        gap: ${theme.spacing[1]};
        opacity: ${disabled ? 0.5 : 1};
      `}
    >
      <div css={css`display: flex; justify-content: space-between; align-items: center;`}>
        {leftLabel && (
          <span css={css`font-size: ${theme.typography.fontSize.xs}; color: ${theme.colors.text.hint};`}>
            {leftLabel}
          </span>
        )}
        {isNeutral && (
          <span css={css`
            font-size: ${theme.typography.fontSize.xs};
            color: ${theme.colors.text.hint};
            position: absolute;
            left: 50%;
            transform: translateX(-50%);
          `}>
            neutral
          </span>
        )}
        {rightLabel && (
          <span css={css`font-size: ${theme.typography.fontSize.xs}; color: ${theme.colors.text.hint};`}>
            {rightLabel}
          </span>
        )}
      </div>
      <div
        ref={trackRef}
        role="slider"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        tabIndex={disabled ? -1 : 0}
        onPointerDown={(e) => {
          if (disabled) return;
          setDragging(true);
          updateValue(e.clientX);
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault();
            onChange(Math.min(max, Math.round((value + step) * 100) / 100));
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault();
            onChange(Math.max(min, Math.round((value - step) * 100) / 100));
          }
        }}
        css={css`
          position: relative;
          height: 24px;
          display: flex;
          align-items: center;
          cursor: ${disabled ? 'not-allowed' : 'pointer'};
          touch-action: none;
          user-select: none;
        `}
      >
        {/* Track */}
        <div
          css={css`
            position: absolute;
            width: 100%;
            height: 4px;
            border-radius: ${theme.borderRadius.full};
            background: ${theme.colors.background.elevated};
          `}
        >
          {/* Fill */}
          <div
            css={css`
              height: 100%;
              width: ${percentage}%;
              border-radius: ${theme.borderRadius.full};
              background: ${theme.colors.accent};
              opacity: 0.4;
              transition: width 50ms ease-out;
            `}
          />
        </div>
        {/* Neutral marker */}
        {showNeutral && (
          <div
            css={css`
              position: absolute;
              left: 50%;
              width: 2px;
              height: 8px;
              background: ${theme.colors.border.default};
              transform: translateX(-50%);
              border-radius: 1px;
            `}
          />
        )}
        {/* Thumb */}
        <div
          css={css`
            position: absolute;
            left: ${percentage}%;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: ${theme.colors.accent};
            transform: translateX(-50%);
            transition: ${dragging ? 'none' : `left 50ms ease-out`};
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);

            &:hover {
              box-shadow: 0 1px 6px rgba(0, 0, 0, 0.2);
            }
          `}
        />
      </div>
    </div>
  );
}
