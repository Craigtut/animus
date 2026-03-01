/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useMemo, useState, useCallback, useRef } from 'react';
import { Typography } from '../ui';
import { getIntensityBand, INTENSITY_BAND_LABELS } from '@animus-labs/shared';
import type { IntensityBand } from '@animus-labs/shared';

export interface SparklinePoint {
  value: number;
  isSignificant?: boolean;
  timestamp?: string;
  tickNumber?: number;
  delta?: number;
  emotionName?: string;
}

interface EmotionSparklineProps {
  data: SparklinePoint[];
  color: string;
  width?: number;
  height?: number;
  interactive?: boolean;
}

const PADDING = 4;

function formatSparklineTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatSparklineDate(ts: string): string {
  const d = new Date(ts);
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (isToday) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  if (isYesterday) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * A minimal inline sparkline chart with no axis labels.
 * Shows a smooth line path and optional dots for significant deltas.
 * When `interactive` is true, supports hover with tooltip.
 */
export function EmotionSparkline({
  data,
  color,
  width = 120,
  height = 40,
  interactive = false,
}: EmotionSparklineProps) {
  const theme = useTheme();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const chartW = width - PADDING * 2;
  const chartH = height - PADDING * 2;

  const points = useMemo(() => {
    if (data.length < 2) return [];
    return data.map((p, i) => ({
      x: PADDING + (i / (data.length - 1)) * chartW,
      y: PADDING + (1 - p.value) * chartH,
    }));
  }, [data, chartW, chartH]);

  const pathD = useMemo(() => {
    if (points.length < 2) return '';
    const first = points[0]!;
    let d = `M ${first.x},${first.y}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1]!;
      const curr = points[i]!;
      const cpx = (prev.x + curr.x) / 2;
      d += ` C ${cpx},${prev.y} ${cpx},${curr.y} ${curr.x},${curr.y}`;
    }
    return d;
  }, [points]);

  const significantDots = useMemo(() => {
    if (data.length < 2) return [];
    return data
      .map((p, i) => ({
        x: PADDING + (i / (data.length - 1)) * chartW,
        y: PADDING + (1 - p.value) * chartH,
        significant: p.isSignificant,
      }))
      .filter((d) => d.significant);
  }, [data, chartW, chartH]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!interactive) return;
      const svg = svgRef.current;
      if (!svg || points.length < 2) return;
      const rect = svg.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      let nearest = 0;
      let nearestDist = Infinity;
      for (let i = 0; i < points.length; i++) {
        const dist = Math.abs(points[i]!.x - mouseX);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = i;
        }
      }
      setHoveredIndex(nearest);
    },
    [interactive, points]
  );

  const handleMouseLeave = useCallback(() => {
    setHoveredIndex(null);
  }, []);

  const hoveredPoint = hoveredIndex !== null ? data[hoveredIndex] : null;
  const hoveredCoord = hoveredIndex !== null ? points[hoveredIndex] : null;

  if (data.length < 2) {
    return (
      <div
        css={css`
          width: ${width}px;
          height: ${height}px;
          display: flex;
          align-items: center;
          justify-content: center;
        `}
      >
        <Typography.Caption color="hint">
          --
        </Typography.Caption>
      </div>
    );
  }

  const tooltipLeft = hoveredCoord && hoveredCoord.x > width * 0.7;

  return (
    <div css={css`position: relative;`}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        onMouseMove={interactive ? handleMouseMove : undefined}
        onMouseLeave={interactive ? handleMouseLeave : undefined}
        css={css`
          display: block;
          overflow: visible;
          ${interactive ? 'cursor: crosshair;' : ''}
        `}
      >
        <path
          d={pathD}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.7}
        />

        {/* Static significant dots (non-interactive mode) */}
        {!interactive && significantDots.map((dot, i) => (
          <circle
            key={i}
            cx={dot.x}
            cy={dot.y}
            r={2}
            fill={color}
            opacity={0.9}
          />
        ))}

        {/* Hovered point indicator (interactive mode) */}
        {interactive && hoveredCoord && (
          <>
            <line
              x1={hoveredCoord.x}
              y1={PADDING}
              x2={hoveredCoord.x}
              y2={height - PADDING}
              stroke={theme.colors.text.hint}
              strokeWidth={1}
              strokeDasharray="2,2"
              opacity={0.5}
            />
            <circle
              cx={hoveredCoord.x}
              cy={hoveredCoord.y}
              r={3.5}
              fill={color}
              stroke={theme.colors.background.default}
              strokeWidth={1.5}
            />
          </>
        )}
      </svg>

      {/* Tooltip */}
      {interactive && hoveredPoint && hoveredCoord && (
        <div
          css={css`
            position: absolute;
            top: -8px;
            ${tooltipLeft ? 'right' : 'left'}: ${
              tooltipLeft
                ? `${width - hoveredCoord.x + 10}px`
                : `${hoveredCoord.x + 10}px`
            };
            transform: translateY(-100%);
            background: ${theme.colors.background.elevated};
            border: 1px solid ${theme.colors.border.default};
            border-radius: ${theme.borderRadius.md};
            padding: ${theme.spacing[1]} ${theme.spacing[2]};
            pointer-events: none;
            z-index: ${theme.zIndex.tooltip};
            white-space: nowrap;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
          `}
        >
          <div css={css`
            display: flex;
            align-items: center;
            gap: ${theme.spacing[2]};
          `}>
            <span css={css`
              font-family: ${theme.typography.fontFamily.serif};
              font-size: ${theme.typography.fontSize.sm};
              font-weight: ${theme.typography.fontWeight.semibold};
              color: ${color};
            `}>
              {Math.round(hoveredPoint.value * 100)}%
            </span>
            <span css={css`
              font-size: ${theme.typography.fontSize.xs};
              color: ${theme.colors.text.hint};
            `}>
              {INTENSITY_BAND_LABELS[getIntensityBand(hoveredPoint.value) as IntensityBand]}
            </span>
            {hoveredPoint.delta != null && (
              <span css={css`
                font-size: ${theme.typography.fontSize.xs};
                font-family: ${theme.typography.fontFamily.mono};
                color: ${hoveredPoint.delta >= 0 ? theme.colors.success.main : theme.colors.error.main};
              `}>
                {hoveredPoint.delta >= 0 ? '+' : ''}{hoveredPoint.delta.toFixed(2)}
              </span>
            )}
          </div>
          {hoveredPoint.timestamp && (
            <div css={css`
              font-size: ${theme.typography.fontSize.xs};
              color: ${theme.colors.text.hint};
              margin-top: 1px;
            `}>
              {formatSparklineDate(hoveredPoint.timestamp)}{' '}
              {formatSparklineTime(hoveredPoint.timestamp)}
              {hoveredPoint.tickNumber != null && (
                <span css={css`margin-left: ${theme.spacing[1]}; opacity: 0.6;`}>
                  Tick #{hoveredPoint.tickNumber}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
