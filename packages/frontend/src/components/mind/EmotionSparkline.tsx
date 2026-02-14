/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useMemo } from 'react';
import { Typography } from '../ui';

interface SparklinePoint {
  value: number;
  isSignificant?: boolean;
}

interface EmotionSparklineProps {
  data: SparklinePoint[];
  color: string;
  width?: number;
  height?: number;
}

/**
 * A minimal inline sparkline chart with no axis labels.
 * Shows a smooth line path and optional dots for significant deltas.
 */
export function EmotionSparkline({
  data,
  color,
  width = 120,
  height = 40,
}: EmotionSparklineProps) {
  const theme = useTheme();

  const pathD = useMemo(() => {
    if (data.length < 2) return '';

    const padding = 4;
    const chartW = width - padding * 2;
    const chartH = height - padding * 2;

    const points = data.map((p, i) => ({
      x: padding + (i / (data.length - 1)) * chartW,
      y: padding + (1 - p.value) * chartH,
    }));

    // Build smooth path with simple cubic bezier between points
    const first = points[0]!;
    let d = `M ${first.x},${first.y}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1]!;
      const curr = points[i]!;
      const cpx = (prev.x + curr.x) / 2;
      d += ` C ${cpx},${prev.y} ${cpx},${curr.y} ${curr.x},${curr.y}`;
    }
    return d;
  }, [data, width, height]);

  const significantDots = useMemo(() => {
    if (data.length < 2) return [];
    const padding = 4;
    const chartW = width - padding * 2;
    const chartH = height - padding * 2;

    return data
      .map((p, i) => ({
        x: padding + (i / (data.length - 1)) * chartW,
        y: padding + (1 - p.value) * chartH,
        significant: p.isSignificant,
      }))
      .filter((d) => d.significant);
  }, [data, width, height]);

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

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      css={css`
        display: block;
        overflow: visible;
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
      {significantDots.map((dot, i) => (
        <circle
          key={i}
          cx={dot.x}
          cy={dot.y}
          r={2}
          fill={color}
          opacity={0.9}
        />
      ))}
    </svg>
  );
}
