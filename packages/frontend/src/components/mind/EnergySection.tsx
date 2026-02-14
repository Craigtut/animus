/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useMemo, useCallback, useRef } from 'react';
import { motion } from 'motion/react';
import {
  CoffeeBean,
  Sparkle,
  Eye,
  EyeClosed,
  Moon,
  MoonStars,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { trpc } from '../../utils/trpc';
import { Card } from '../ui/Card';
import { Typography } from '../ui';
import { useHeartbeatStore } from '../../store/heartbeat-store';

// ============================================================================
// Energy band definitions
// ============================================================================

type EnergyBand = 'peak' | 'alert' | 'tired' | 'drowsy' | 'very_drowsy' | 'sleeping';

const bandMeta: Record<EnergyBand, { label: string; description: string; color: string; icon: Icon }> = {
  peak:        { label: 'Peak',        description: 'Feeling sharp and energized',       color: '#4ade80', icon: CoffeeBean },
  alert:       { label: 'Alert',       description: 'Normal operating mode',              color: '',        icon: Sparkle },    // color set at render from theme
  tired:       { label: 'Tired',       description: 'Energy is fading',                   color: '#fbbf24', icon: Eye },
  drowsy:      { label: 'Drowsy',      description: 'Thoughts are slowing',               color: '#f97316', icon: EyeClosed },
  very_drowsy: { label: 'Very Drowsy', description: 'Sleep is pulling at every thought',  color: '#ef4444', icon: Moon },
  sleeping:    { label: 'Sleeping',    description: 'Sleeping',                            color: '#818cf8', icon: MoonStars },
};

function getBandFromLevel(level: number): EnergyBand {
  if (level < 0.05) return 'sleeping';
  if (level < 0.10) return 'very_drowsy';
  if (level < 0.20) return 'drowsy';
  if (level < 0.40) return 'tired';
  if (level < 0.70) return 'alert';
  return 'peak';
}

function getBandColor(band: EnergyBand, fallback: string): string {
  if (band === 'alert') return fallback;
  return bandMeta[band].color;
}

// ============================================================================
// Energy Gauge
// ============================================================================

function EnergyGauge({
  level,
  band,
  circadianBaseline,
}: {
  level: number;
  band: EnergyBand;
  circadianBaseline: number;
}) {
  const theme = useTheme();
  const color = getBandColor(band, theme.colors.text.secondary);
  const fillPercent = level * 100;
  const baselinePercent = circadianBaseline * 100;

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
      <div css={css`display: flex; align-items: baseline; justify-content: space-between;`}>
        <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
          <Typography.Body as="span" serif css={css`
            font-size: ${theme.typography.fontSize.lg};
            font-weight: ${theme.typography.fontWeight.semibold};
          `}>
            {(level * 100).toFixed(0)}%
          </Typography.Body>
          <Typography.Caption as="span" css={css`
            color: ${color};
            font-weight: ${theme.typography.fontWeight.medium};
          `}>
            {bandMeta[band].label}
          </Typography.Caption>
        </div>
        <Typography.Caption color="hint">
          {bandMeta[band].description}
        </Typography.Caption>
      </div>

      {/* Bar */}
      <div css={css`position: relative; width: 100%; height: 6px; border-radius: 3px; background: ${theme.colors.background.elevated};`}>
        <motion.div
          animate={{ width: `${fillPercent}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          css={css`
            height: 100%;
            border-radius: 3px;
            background: ${color};
            opacity: 0.7;
          `}
        />
        {/* Circadian baseline marker */}
        <div
          css={css`
            position: absolute;
            left: ${baselinePercent}%;
            top: -3px;
            width: 2px;
            height: 12px;
            background: ${theme.colors.text.hint};
            border-radius: 1px;
            transform: translateX(-50%);
          `}
          title={`Circadian baseline: ${(circadianBaseline * 100).toFixed(0)}%`}
        />
      </div>

      <Typography.Caption color="hint" css={css`display: block;`}>
        Circadian baseline: {(circadianBaseline * 100).toFixed(0)}%
      </Typography.Caption>
    </div>
  );
}

// ============================================================================
// Energy History Entry type (matches backend API shape)
// ============================================================================

interface EnergyHistoryEntry {
  id: number;
  tickNumber: number;
  energyBefore: number;
  energyAfter: number;
  delta: number;
  reasoning: string;
  circadianBaseline: number;
  energyBand: string;
  createdAt: string;
}

// ============================================================================
// Interactive Energy Sparkline with hover tooltip
// ============================================================================

interface SparklineDataPoint {
  value: number;
  timestamp: string;
  band: EnergyBand;
  tickNumber: number;
}

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

const SPARKLINE_PADDING = 4;

function EnergySparkline({
  data,
  color,
  width = 280,
  height = 60,
}: {
  data: SparklineDataPoint[];
  color: string;
  width?: number;
  height?: number;
}) {
  const theme = useTheme();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const chartW = width - SPARKLINE_PADDING * 2;
  const chartH = height - SPARKLINE_PADDING * 2;

  const points = useMemo(() => {
    if (data.length < 2) return [];
    return data.map((p, i) => ({
      x: SPARKLINE_PADDING + (i / (data.length - 1)) * chartW,
      y: SPARKLINE_PADDING + (1 - p.value) * chartH,
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

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg || points.length < 2) return;
      const rect = svg.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      // Find nearest point
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
    [points]
  );

  const handleMouseLeave = useCallback(() => {
    setHoveredIndex(null);
  }, []);

  const hoveredPoint = hoveredIndex !== null ? data[hoveredIndex] : null;
  const hoveredCoord = hoveredIndex !== null ? points[hoveredIndex] : null;

  if (data.length < 2) return null;

  // Tooltip positioning: flip to left side if near right edge
  const tooltipLeft =
    hoveredCoord && hoveredCoord.x > width * 0.7;

  return (
    <div css={css`position: relative;`}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        css={css`
          display: block;
          overflow: visible;
          cursor: crosshair;
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

        {/* Hovered point indicator */}
        {hoveredCoord && (
          <>
            {/* Vertical guide line */}
            <line
              x1={hoveredCoord.x}
              y1={SPARKLINE_PADDING}
              x2={hoveredCoord.x}
              y2={height - SPARKLINE_PADDING}
              stroke={theme.colors.text.hint}
              strokeWidth={1}
              strokeDasharray="2,2"
              opacity={0.5}
            />
            {/* Dot */}
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
      {hoveredPoint && hoveredCoord && (
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
              color: ${getBandColor(hoveredPoint.band, theme.colors.text.primary)};
            `}>
              {(hoveredPoint.value * 100).toFixed(0)}%
            </span>
            <span css={css`
              font-size: ${theme.typography.fontSize.xs};
              color: ${theme.colors.text.hint};
            `}>
              {bandMeta[hoveredPoint.band]?.label ?? hoveredPoint.band}
            </span>
          </div>
          <div css={css`
            font-size: ${theme.typography.fontSize.xs};
            color: ${theme.colors.text.hint};
            margin-top: 1px;
          `}>
            {formatSparklineDate(hoveredPoint.timestamp)}{' '}
            {formatSparklineTime(hoveredPoint.timestamp)}
            <span css={css`margin-left: ${theme.spacing[1]}; opacity: 0.6;`}>
              Tick #{hoveredPoint.tickNumber}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Time formatting for history entries
// ============================================================================

function formatHistoryTime(ts: string): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ============================================================================
// Energy Section
// ============================================================================

export function EnergySection() {
  const theme = useTheme();

  const [showAllHistory, setShowAllHistory] = useState(false);

  // Fetch current energy state
  const { data: energyState } = trpc.heartbeat.getEnergyState.useQuery(undefined, {
    retry: false,
  });

  // Fetch energy history for sparkline
  const { data: historyData } = trpc.heartbeat.getEnergyHistory.useQuery(
    { limit: 200 },
    { retry: false },
  );

  // Real-time energy data from centralized subscription manager
  const storeEnergyLevel = useHeartbeatStore((s) => s.energyLevel);
  const storeEnergyBand = useHeartbeatStore((s) => s.energyBand);

  const currentLevel = storeEnergyLevel ?? energyState?.energyLevel ?? 0.85;
  const currentBand = (storeEnergyBand ?? energyState?.energyBand ?? getBandFromLevel(currentLevel)) as EnergyBand;
  const circadianBaseline = energyState?.circadianBaseline ?? 0.85;

  // Sparkline data from history (chronological order: oldest → newest, left → right)
  // historyData arrives DESC (newest first), so reverse for chronological display
  const sparklineData = useMemo((): SparklineDataPoint[] => {
    if (!historyData?.length) return [];
    // Take most recent 48, then reverse to chronological (left=oldest, right=newest)
    return historyData
      .slice(0, 48)
      .reverse()
      .map((h: EnergyHistoryEntry) => ({
        value: h.energyAfter,
        timestamp: h.createdAt,
        band: getBandFromLevel(h.energyAfter),
        tickNumber: h.tickNumber,
      }));
  }, [historyData]);

  // Recent deltas for the history list (newest first — data already comes DESC)
  const recentDeltas = useMemo(() => {
    if (!historyData?.length) return [];
    return historyData.slice(0, showAllHistory ? 50 : 10);
  }, [historyData, showAllHistory]);

  const bandColor = getBandColor(currentBand, theme.colors.text.secondary);

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[6]};`}>
      {/* Energy Gauge */}
      <Card variant="elevated" padding="md">
        <EnergyGauge
          level={currentLevel}
          band={currentBand}
          circadianBaseline={circadianBaseline}
        />

        {/* Interactive Sparkline */}
        {sparklineData.length >= 2 && (
          <div css={css`margin-top: ${theme.spacing[4]};`}>
            <Typography.Caption color="hint" css={css`
              margin-bottom: ${theme.spacing[2]};
              display: block;
            `}>
              Recent trend
            </Typography.Caption>
            <EnergySparkline
              data={sparklineData}
              color={bandColor}
            />
          </div>
        )}
      </Card>

      {/* Recent Energy Deltas */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
        <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
          Energy History
        </Typography.Subtitle>

        {recentDeltas.length === 0 ? (
          <Typography.SmallBody color="hint">
            No energy changes recorded yet.
          </Typography.SmallBody>
        ) : (
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
            {recentDeltas.map((entry: EnergyHistoryEntry) => {
              const entryBand = entry.energyBand as EnergyBand;
              const entryColor = getBandColor(entryBand, theme.colors.text.secondary);
              const deltaColor = entry.delta >= 0
                ? theme.colors.success.main
                : theme.colors.error.main;
              const BandIcon = bandMeta[entryBand]?.icon ?? Sparkle;

              return (
                <Card key={entry.id} variant="outlined" padding="sm">
                  {/* Row 1: Delta + band icon + timestamp */}
                  <div css={css`
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: ${theme.spacing[1.5]};
                  `}>
                    <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                      <Typography.SmallBody as="span" serif css={css`
                        font-weight: ${theme.typography.fontWeight.semibold};
                        color: ${deltaColor};
                        letter-spacing: -0.01em;
                      `}>
                        {entry.delta >= 0 ? '+' : ''}{entry.delta.toFixed(3)}
                      </Typography.SmallBody>
                      <BandIcon
                        size={14}
                        weight="fill"
                        color={entryColor}
                        css={css`opacity: 0.8; flex-shrink: 0;`}
                        aria-label={bandMeta[entryBand]?.label ?? entryBand}
                      />
                    </div>
                    <Typography.Caption as="span" color="hint" css={css`
                      flex-shrink: 0;
                      opacity: 0.45;
                    `}>
                      {formatHistoryTime(entry.createdAt)}
                    </Typography.Caption>
                  </div>

                  {/* Row 2: Reasoning — the narrative */}
                  {entry.reasoning && (
                    <Typography.SmallBody serif italic color="secondary" css={css`
                      line-height: ${theme.typography.lineHeight.normal};
                      margin-bottom: ${theme.spacing[1.5]};
                    `}>
                      {entry.reasoning}
                    </Typography.SmallBody>
                  )}

                  {/* Row 3: Metadata */}
                  <div css={css`
                    display: flex;
                    align-items: center;
                    gap: ${theme.spacing[1]};
                  `}>
                    <Typography.Caption as="span" color="hint" css={css`opacity: 0.55;`}>
                      {(entry.energyBefore * 100).toFixed(0)}% → {(entry.energyAfter * 100).toFixed(0)}%
                    </Typography.Caption>
                    <Typography.Caption as="span" color="hint" css={css`opacity: 0.3;`}>
                      ·
                    </Typography.Caption>
                    <Typography.Caption as="span" color="hint" css={css`opacity: 0.55;`}>
                      Tick {entry.tickNumber}
                    </Typography.Caption>
                  </div>
                </Card>
              );
            })}

            {!showAllHistory && (historyData?.length ?? 0) > 10 && (
              <button
                onClick={() => setShowAllHistory(true)}
                css={css`
                  padding: ${theme.spacing[2]};
                  font-size: ${theme.typography.fontSize.sm};
                  color: ${theme.colors.text.secondary};
                  cursor: pointer;
                  transition: color ${theme.transitions.fast};
                  &:hover { color: ${theme.colors.text.primary}; }
                `}
              >
                Show more
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
