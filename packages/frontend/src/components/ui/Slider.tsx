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

  const percentage = ((value - min) / (max - min)) * 100;

  // Neutral zone uses normalized percentage (0-100) so it works with any min/max range
  const neutralMinPct = 45;
  const neutralMaxPct = 55;
  const isNeutral = showNeutral && percentage >= neutralMinPct && percentage <= neutralMaxPct;

  // How far from center (0 = center, 1 = edge)
  const deviation = Math.abs(percentage - 50) / 50;

  // Which side is active
  const leaningLeft = percentage < neutralMinPct;
  const leaningRight = percentage > neutralMaxPct;

  const updateValue = useCallback(
    (clientX: number) => {
      if (!trackRef.current || disabled) return;
      const rect = trackRef.current.getBoundingClientRect();
      const raw = (clientX - rect.left) / rect.width;
      const clamped = Math.max(0, Math.min(1, raw));
      const scaled = min + clamped * (max - min);
      const snapped = Math.round((scaled - min) / step) * step + min;
      onChange(Math.max(min, Math.min(max, Math.round(snapped * 100) / 100)));
    },
    [min, max, step, onChange, disabled]
  );

  const pointerIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => updateValue(e.clientX);
    const onUp = () => {
      setDragging(false);
      if (pointerIdRef.current !== null && trackRef.current) {
        try { trackRef.current.releasePointerCapture(pointerIdRef.current); } catch {}
        pointerIdRef.current = null;
      }
    };
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
        gap: ${theme.spacing[2]};
        opacity: ${disabled ? 0.5 : 1};
      `}
    >
      {/* Labels row */}
      <div css={css`display: flex; justify-content: space-between; align-items: baseline; position: relative;`}>
        {leftLabel && (
          <span css={css`
            font-size: ${theme.typography.fontSize.sm};
            font-weight: ${showNeutral && leaningLeft ? theme.typography.fontWeight.medium : theme.typography.fontWeight.normal};
            color: ${showNeutral && leaningLeft ? theme.colors.text.primary : theme.colors.text.hint};
            transition: all ${theme.transitions.normal};
          `}>
            {leftLabel}
          </span>
        )}
        {isNeutral && (
          <span css={css`
            font-size: ${theme.typography.fontSize.xs};
            color: ${theme.colors.text.disabled};
            position: absolute;
            left: 50%;
            transform: translateX(-50%);
            letter-spacing: 0.04em;
          `}>
            neutral
          </span>
        )}
        {rightLabel && (
          <span css={css`
            font-size: ${theme.typography.fontSize.sm};
            font-weight: ${showNeutral && leaningRight ? theme.typography.fontWeight.medium : theme.typography.fontWeight.normal};
            color: ${showNeutral && leaningRight ? theme.colors.text.primary : theme.colors.text.hint};
            transition: all ${theme.transitions.normal};
          `}>
            {rightLabel}
          </span>
        )}
      </div>

      {/* Track area */}
      <div
        ref={trackRef}
        role="slider"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-label={leftLabel && rightLabel ? `${leftLabel} to ${rightLabel}` : undefined}
        tabIndex={disabled ? -1 : 0}
        onPointerDown={(e) => {
          if (disabled) return;
          e.preventDefault();
          pointerIdRef.current = e.pointerId;
          trackRef.current?.setPointerCapture(e.pointerId);
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
          height: 32px;
          display: flex;
          align-items: center;
          cursor: ${disabled ? 'not-allowed' : 'pointer'};
          touch-action: none;
          user-select: none;

          &:focus-visible {
            outline: none;
          }
          &:focus-visible > div:last-child {
            box-shadow: 0 0 0 3px ${theme.colors.border.focus};
          }
        `}
      >
        {/* Track background */}
        <div
          css={css`
            position: absolute;
            width: 100%;
            height: 6px;
            border-radius: ${theme.borderRadius.full};
            background: ${theme.colors.border.default};
            overflow: hidden;
          `}
        >
          {/* Fill */}
          {showNeutral ? (
            /* Center-outward fill for dimension sliders */
            !isNeutral && (
              <div
                css={css`
                  position: absolute;
                  top: 0;
                  height: 100%;
                  border-radius: ${theme.borderRadius.full};
                  background: ${theme.colors.accent};
                  opacity: ${0.5 + deviation * 0.42};
                  transition: ${dragging ? 'opacity 50ms ease-out' : 'all 120ms ease-out'};
                  ${leaningLeft ? css`
                    right: 50%;
                    width: ${50 - percentage}%;
                  ` : css`
                    left: 50%;
                    width: ${percentage - 50}%;
                  `}
                `}
              />
            )
          ) : (
            /* Left-to-thumb fill for linear sliders */
            <div
              css={css`
                position: absolute;
                top: 0;
                left: 0;
                height: 100%;
                width: ${percentage}%;
                border-radius: ${theme.borderRadius.full};
                background: ${theme.colors.accent};
                transition: ${dragging ? 'none' : 'width 50ms ease-out'};
              `}
            />
          )}
        </div>

        {/* Neutral center tick */}
        {showNeutral && (
          <div
            css={css`
              position: absolute;
              left: 50%;
              width: 2px;
              height: 14px;
              background: ${theme.colors.border.default};
              transform: translateX(-50%);
              border-radius: 1px;
              opacity: ${isNeutral ? 0.7 : 0.3};
              transition: opacity ${theme.transitions.fast};
            `}
          />
        )}

        {/* Thumb */}
        <div
          css={css`
            position: absolute;
            left: ${percentage}%;
            width: ${dragging ? 20 : 18}px;
            height: ${dragging ? 20 : 18}px;
            border-radius: 50%;
            background: ${theme.colors.accent};
            transform: translateX(-50%);
            transition: ${dragging ? 'width 100ms, height 100ms' : 'left 50ms ease-out, width 100ms, height 100ms'};
            box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08);
            pointer-events: none;
          `}
        />
      </div>
    </div>
  );
}
