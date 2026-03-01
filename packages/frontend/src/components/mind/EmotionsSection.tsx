/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft } from '@phosphor-icons/react';
import { trpc } from '../../utils/trpc';
import { emotionColors } from '../../styles/theme';
import { Card } from '../ui/Card';
import { Typography } from '../ui';
import { EmotionSparkline } from './EmotionSparkline';
import type { SparklinePoint } from './EmotionSparkline';
import { useHeartbeatStore } from '../../store/heartbeat-store';
import {
  getEmotionDescription,
  getIntensityBand,
  INTENSITY_BAND_LABELS,
  EMOTION_CATEGORIES,
} from '@animus-labs/shared';
import type { EmotionState, EmotionName, EmotionHistoryEntry } from '@animus-labs/shared';

// ============================================================================
// Constants
// ============================================================================

const ALL_EMOTIONS: EmotionName[] = [
  'joy', 'contentment', 'excitement', 'gratitude', 'confidence',
  'stress', 'anxiety', 'frustration', 'sadness', 'boredom',
  'curiosity', 'loneliness',
];

// ============================================================================
// Annotated Emotional Field (aura gradient)
// ============================================================================

function AnnotatedEmotionalField({ emotions }: { emotions: EmotionState[] }) {
  const theme = useTheme();
  const mode = theme.mode;
  const colors = emotionColors[mode];

  const topEmotions = useMemo(() => {
    if (!emotions.length) return [];
    return [...emotions]
      .sort((a, b) => b.intensity - a.intensity)
      .slice(0, 5)
      .filter((e) => e.intensity > 0.15);
  }, [emotions]);

  const orbColors = useMemo(() => {
    if (!emotions.length) {
      return [colors.contentment, colors.joy, colors.curiosity];
    }
    const sorted = [...emotions].sort((a, b) => b.intensity - a.intensity);
    return sorted.slice(0, 3).map((e) => colors[e.emotion as keyof typeof colors] || colors.contentment);
  }, [emotions, colors]);

  return (
    <div
      aria-hidden="true"
      css={css`
        position: relative;
        width: 100%;
        height: clamp(120px, 15vh, 200px);
        overflow: hidden;
        mask-image: linear-gradient(to bottom, transparent 0%, black 25%, black 60%, transparent 100%);
        -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 25%, black 60%, transparent 100%);
        margin-bottom: ${theme.spacing[6]};
      `}
    >
      {orbColors.map((color, i) => (
        <div
          key={i}
          css={css`
            position: absolute;
            border-radius: 50%;
            filter: blur(${80 + i * 15}px);
            will-change: transform, opacity;
            background: ${color};
            opacity: 0.3;
            animation: mind-orb-${i} ${4200 + i * 1600}ms ease-in-out infinite alternate;

            ${i === 0
              ? `width: 50%; height: 75%; top: 10%; left: 22%;`
              : i === 1
                ? `width: 40%; height: 65%; top: 18%; left: 42%;`
                : `width: 45%; height: 55%; top: 8%; left: 12%;`}

            @keyframes mind-orb-${i} {
              0% { transform: translate(0, 0) scale(1); }
              100% { transform: translate(${12 - i * 8}px, ${6 - i * 4}px) scale(${1.02 + i * 0.01}); }
            }

            @media (prefers-reduced-motion: reduce) {
              animation: none;
            }
          `}
        />
      ))}

      {/* Annotated labels positioned within the field */}
      {topEmotions.map((e, i) => {
        const positions = [
          { left: '20%', top: '35%' },
          { left: '55%', top: '25%' },
          { left: '72%', top: '50%' },
          { left: '35%', top: '60%' },
          { left: '10%', top: '20%' },
        ];
        const pos = positions[i] ?? positions[0]!;
        return (
          <Typography.Caption
            key={e.emotion}
            as="span"
            serif
            italic
            css={css`
              position: absolute;
              left: ${pos!.left};
              top: ${pos!.top};
              font-weight: ${theme.typography.fontWeight.medium};
              color: ${theme.colors.text.primary};
              opacity: ${0.3 + e.intensity * 0.4};
              pointer-events: none;
              text-transform: capitalize;
            `}
          >
            {e.emotion}
          </Typography.Caption>
        );
      })}
    </div>
  );
}

// ============================================================================
// Single-Emotion Aura (for detail page header)
// ============================================================================

function SingleEmotionAura({ color }: { color: string }) {
  const theme = useTheme();
  return (
    <div
      aria-hidden="true"
      css={css`
        position: relative;
        width: 100%;
        height: clamp(80px, 10vh, 120px);
        overflow: hidden;
        mask-image: linear-gradient(to bottom, transparent 0%, black 30%, black 60%, transparent 100%);
        -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 30%, black 60%, transparent 100%);
        margin-bottom: ${theme.spacing[4]};
      `}
    >
      <div
        css={css`
          position: absolute;
          width: 60%;
          height: 100%;
          top: 0;
          left: 20%;
          border-radius: 50%;
          filter: blur(60px);
          background: ${color};
          opacity: 0.35;
          animation: emotion-aura-pulse 3s ease-in-out infinite alternate;

          @keyframes emotion-aura-pulse {
            0% { transform: scale(1); opacity: 0.3; }
            100% { transform: scale(1.05); opacity: 0.4; }
          }

          @media (prefers-reduced-motion: reduce) {
            animation: none;
          }
        `}
      />
    </div>
  );
}

// ============================================================================
// Intensity Bar
// ============================================================================

function IntensityBar({
  intensity,
  baseline,
  color,
}: {
  intensity: number;
  baseline: number;
  color: string;
}) {
  const theme = useTheme();
  const fillPercent = intensity * 100;
  const baselinePercent = baseline * 100;

  return (
    <div css={css`position: relative; width: 100%; height: 6px; border-radius: 3px; background: ${theme.colors.background.elevated};`}>
      <div
        css={css`
          height: 100%;
          width: ${fillPercent}%;
          border-radius: 3px;
          background: ${color};
          opacity: 0.7;
          transition: width ${theme.transitions.normal};
        `}
      />
      {/* Baseline tick */}
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
        title={`Personality baseline: ${Math.round(baseline * 100)}%`}
      />
    </div>
  );
}

// ============================================================================
// Category Badge
// ============================================================================

function CategoryBadge({ category }: { category: 'positive' | 'negative' | 'drive' }) {
  const theme = useTheme();
  const label = category === 'positive' ? 'Positive' : category === 'negative' ? 'Negative' : 'Drive';
  const color = category === 'positive'
    ? theme.colors.success.main
    : category === 'negative'
      ? theme.colors.error.main
      : theme.colors.accent;

  return (
    <span css={css`
      display: inline-block;
      font-size: ${theme.typography.fontSize.xs};
      font-weight: ${theme.typography.fontWeight.medium};
      color: ${color};
      border: 1px solid ${color}33;
      background: ${color}11;
      padding: 1px ${theme.spacing[1.5]};
      border-radius: ${theme.borderRadius.sm};
      white-space: nowrap;
    `}>
      {label}
    </span>
  );
}

// ============================================================================
// Emotion Card (list view)
// ============================================================================

interface EmotionCardProps {
  emotion: EmotionState;
  color: string;
  historyEntries: EmotionHistoryEntry[];
}

function EmotionCard({ emotion, color, historyEntries }: EmotionCardProps) {
  const theme = useTheme();
  const navigate = useNavigate();

  const sparklineData = useMemo((): SparklinePoint[] => {
    if (!historyEntries.length) return [];
    // History arrives DESC (newest first). Take 24 most recent, reverse for chronological.
    return historyEntries.slice(0, 24).reverse().map((h) => ({
      value: h.intensityAfter,
      isSignificant: Math.abs(h.delta) >= 0.1,
    }));
  }, [historyEntries]);

  const band = getIntensityBand(emotion.intensity);
  const bandLabel = INTENSITY_BAND_LABELS[band];
  const description = getEmotionDescription(emotion.emotion, emotion.intensity);
  const category = EMOTION_CATEGORIES[emotion.emotion];

  const lastDelta = historyEntries.length > 0 ? historyEntries[0] : null;

  return (
    <Card
      interactive
      variant="elevated"
      padding="md"
      onClick={() => navigate(`/mind/emotions/${emotion.emotion}`)}
    >
      {/* Header row */}
      <div css={css`display: flex; align-items: center; justify-content: space-between; margin-bottom: ${theme.spacing[2]};`}>
        <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
          <Typography.Body as="span" serif css={css`
            font-size: ${theme.typography.fontSize.lg};
            font-weight: ${theme.typography.fontWeight.semibold};
            text-transform: capitalize;
          `}>
            {emotion.emotion}
          </Typography.Body>
          <CategoryBadge category={category} />
        </div>
        <EmotionSparkline data={sparklineData} color={color} />
      </div>

      {/* Intensity bar */}
      <IntensityBar intensity={emotion.intensity} baseline={emotion.baseline} color={color} />

      {/* Percentage + band label */}
      <div css={css`
        display: flex;
        align-items: baseline;
        gap: ${theme.spacing[2]};
        margin-top: ${theme.spacing[1]};
      `}>
        <Typography.Caption css={css`
          font-weight: ${theme.typography.fontWeight.medium};
          color: ${color};
        `}>
          {Math.round(emotion.intensity * 100)}%
        </Typography.Caption>
        <Typography.Caption color="hint">
          {bandLabel}
        </Typography.Caption>
      </div>

      {/* Poetic description */}
      {band !== 'dormant' && (
        <Typography.Caption serif italic color="secondary" css={css`
          margin-top: ${theme.spacing[1]};
          display: block;
          line-height: ${theme.typography.lineHeight.normal};
        `}>
          {description}
        </Typography.Caption>
      )}

      {/* Last delta */}
      {lastDelta && (
        <Typography.SmallBody serif italic color="secondary" css={css`
          margin-top: ${theme.spacing[2]};
          line-height: ${theme.typography.lineHeight.normal};
        `}>
          {lastDelta.delta >= 0 ? '+' : ''}{lastDelta.delta.toFixed(2)}: &ldquo;{lastDelta.reasoning}&rdquo;
        </Typography.SmallBody>
      )}
    </Card>
  );
}

// ============================================================================
// Emotions List View
// ============================================================================

function EmotionsList() {
  const theme = useTheme();
  const mode = theme.mode;
  const colors = emotionColors[mode];

  const { data: emotionStates } = trpc.heartbeat.getEmotions.useQuery(undefined, {
    retry: false,
  });

  const { data: historyData } = trpc.heartbeat.getEmotionHistory.useQuery(
    { limit: 200 },
    { retry: false },
  );

  const storeEmotions = useHeartbeatStore(s => s.emotions);
  const currentEmotions = useMemo(() => {
    const base = emotionStates ?? [];
    const map = new Map<string, EmotionState>();
    for (const e of base) map.set(e.emotion, e);
    for (const [key, value] of storeEmotions) map.set(key, value);
    return map;
  }, [emotionStates, storeEmotions]);

  const historyByEmotion = useMemo(() => {
    const map = new Map<string, EmotionHistoryEntry[]>();
    for (const entry of (historyData ?? [])) {
      const list = map.get(entry.emotion) ?? [];
      list.push(entry);
      map.set(entry.emotion, list);
    }
    return map;
  }, [historyData]);

  const emotionsList = useMemo(() => {
    return ALL_EMOTIONS.map((name) => {
      const state = currentEmotions.get(name);
      return state ?? {
        emotion: name,
        category: EMOTION_CATEGORIES[name],
        intensity: 0.3,
        baseline: 0.3,
        lastUpdatedAt: new Date().toISOString(),
      } as EmotionState;
    });
  }, [currentEmotions]);

  return (
    <div>
      <AnnotatedEmotionalField emotions={emotionsList} />

      <div
        css={css`
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: ${theme.spacing[4]};

          @media (max-width: ${theme.breakpoints.md}) {
            grid-template-columns: 1fr;
          }
        `}
      >
        {emotionsList.map((emotion) => (
          <EmotionCard
            key={emotion.emotion}
            emotion={emotion}
            color={colors[emotion.emotion as keyof typeof colors] || colors.contentment}
            historyEntries={historyByEmotion.get(emotion.emotion) ?? []}
          />
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Emotion Detail Page
// ============================================================================

function EmotionDetailPage({ emotionName }: { emotionName: EmotionName }) {
  const theme = useTheme();
  const navigate = useNavigate();
  const mode = theme.mode;
  const colors = emotionColors[mode];
  const color = colors[emotionName as keyof typeof colors] || colors.contentment;

  const [showCount, setShowCount] = useState(10);

  // Fetch current state
  const { data: emotionStates } = trpc.heartbeat.getEmotions.useQuery(undefined, {
    retry: false,
  });

  // Fetch deep history for this emotion
  const { data: historyData } = trpc.heartbeat.getEmotionHistory.useQuery(
    { emotion: emotionName, limit: 500 },
    { retry: false },
  );

  const storeEmotions = useHeartbeatStore(s => s.emotions);

  const emotionState = useMemo((): EmotionState => {
    const fromStore = storeEmotions.get(emotionName);
    if (fromStore) return fromStore;
    const fromQuery = (emotionStates ?? []).find((e) => e.emotion === emotionName);
    if (fromQuery) return fromQuery;
    return {
      emotion: emotionName,
      category: EMOTION_CATEGORIES[emotionName],
      intensity: 0,
      baseline: 0,
      lastUpdatedAt: new Date().toISOString(),
    } as EmotionState;
  }, [emotionStates, storeEmotions, emotionName]);

  // History arrives DESC (newest first)
  const history = historyData ?? [];

  const sparklineData = useMemo((): SparklinePoint[] => {
    if (!history.length) return [];
    // Reverse for chronological (oldest left, newest right)
    return [...history].reverse().map((h) => ({
      value: h.intensityAfter,
      isSignificant: Math.abs(h.delta) >= 0.1,
      timestamp: h.createdAt,
      tickNumber: h.tickNumber,
      delta: h.delta,
      emotionName: h.emotion,
    }));
  }, [history]);

  const band = getIntensityBand(emotionState.intensity);
  const bandLabel = INTENSITY_BAND_LABELS[band];
  const description = getEmotionDescription(emotionName, emotionState.intensity);
  const category = EMOTION_CATEGORIES[emotionName];

  const recentChanges = history.slice(0, showCount);

  return (
    <div>
      {/* Back button */}
      <button
        onClick={() => navigate('/mind/emotions')}
        css={css`
          display: flex;
          align-items: center;
          gap: ${theme.spacing[1]};
          font-size: ${theme.typography.fontSize.sm};
          color: ${theme.colors.text.secondary};
          cursor: pointer;
          padding: ${theme.spacing[1]} 0;
          margin-bottom: ${theme.spacing[4]};
          transition: color ${theme.transitions.micro};

          &:hover { color: ${theme.colors.text.primary}; }
        `}
      >
        <ArrowLeft size={14} />
        Back to emotions
      </button>

      {/* Single-emotion aura */}
      <SingleEmotionAura color={color} />

      {/* Emotion name + category + percentage */}
      <div css={css`margin-bottom: ${theme.spacing[6]};`}>
        <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]}; margin-bottom: ${theme.spacing[2]};`}>
          <Typography.Subtitle serif css={css`text-transform: capitalize;`}>
            {emotionName}
          </Typography.Subtitle>
          <CategoryBadge category={category} />
        </div>

        <div css={css`display: flex; align-items: baseline; gap: ${theme.spacing[2]}; margin-bottom: ${theme.spacing[2]};`}>
          <Typography.Body as="span" serif css={css`
            font-size: ${theme.typography.fontSize.xl};
            font-weight: ${theme.typography.fontWeight.semibold};
            color: ${color};
          `}>
            {Math.round(emotionState.intensity * 100)}%
          </Typography.Body>
          <Typography.Caption color="hint" css={css`font-weight: ${theme.typography.fontWeight.medium};`}>
            {bandLabel}
          </Typography.Caption>
        </div>

        {/* Poetic description */}
        {band !== 'dormant' && (
          <Typography.Body serif italic color="secondary" css={css`
            line-height: ${theme.typography.lineHeight.relaxed};
          `}>
            {description}
          </Typography.Body>
        )}
      </div>

      {/* Enhanced intensity bar */}
      <div css={css`margin-bottom: ${theme.spacing[6]};`}>
        <IntensityBar intensity={emotionState.intensity} baseline={emotionState.baseline} color={color} />
        <Typography.Caption color="hint" css={css`
          margin-top: ${theme.spacing[1]};
          display: block;
        `}>
          Personality baseline: {Math.round(emotionState.baseline * 100)}%
        </Typography.Caption>
      </div>

      {/* Full interactive sparkline chart */}
      {sparklineData.length >= 2 && (
        <div css={css`margin-bottom: ${theme.spacing[6]};`}>
          <Typography.Caption
            color="hint"
            css={css`
              text-transform: uppercase;
              letter-spacing: 0.05em;
              margin-bottom: ${theme.spacing[2]};
              display: block;
            `}
          >
            History
          </Typography.Caption>
          <EmotionSparkline
            data={sparklineData}
            color={color}
            width={560}
            height={120}
            interactive
          />
        </div>
      )}

      {/* Recent changes */}
      <div css={css`margin-bottom: ${theme.spacing[6]};`}>
        <Typography.Caption
          color="hint"
          css={css`
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: ${theme.spacing[3]};
            display: block;
          `}
        >
          Recent changes
        </Typography.Caption>

        {recentChanges.length === 0 ? (
          <Typography.Body serif italic color="hint">
            No changes recorded yet.
          </Typography.Body>
        ) : (
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
            {recentChanges.map((d) => (
              <Card key={d.id} variant="outlined" padding="sm">
                {/* Row 1: delta + timestamp */}
                <div css={css`
                  display: flex;
                  align-items: center;
                  justify-content: space-between;
                  margin-bottom: ${theme.spacing[1]};
                `}>
                  <Typography.SmallBody css={css`
                    font-weight: ${theme.typography.fontWeight.medium};
                    font-family: ${theme.typography.fontFamily.mono};
                    color: ${d.delta >= 0 ? theme.colors.success.main : theme.colors.error.main};
                  `}>
                    {d.delta >= 0 ? '+' : ''}{d.delta.toFixed(3)}
                  </Typography.SmallBody>
                  <Typography.Caption color="hint" css={css`white-space: nowrap;`}>
                    {formatRelativeTime(d.createdAt)}
                  </Typography.Caption>
                </div>

                {/* Row 2: reasoning */}
                <Typography.SmallBody serif italic color="secondary" css={css`
                  line-height: ${theme.typography.lineHeight.normal};
                  margin-bottom: ${theme.spacing[1]};
                `}>
                  {d.reasoning}
                </Typography.SmallBody>

                {/* Row 3: before -> after + tick */}
                <div css={css`
                  display: flex;
                  align-items: center;
                  justify-content: space-between;
                `}>
                  <Typography.Caption color="hint" css={css`font-family: ${theme.typography.fontFamily.mono};`}>
                    {Math.round(d.intensityBefore * 100)}% &rarr; {Math.round(d.intensityAfter * 100)}%
                  </Typography.Caption>
                  <Typography.Caption color="disabled" css={css`white-space: nowrap;`}>
                    Tick #{d.tickNumber}
                  </Typography.Caption>
                </div>
              </Card>
            ))}

            {/* Show more */}
            {history.length > showCount && (
              <button
                onClick={() => setShowCount((c) => c + 20)}
                css={css`
                  font-size: ${theme.typography.fontSize.sm};
                  color: ${theme.colors.text.secondary};
                  cursor: pointer;
                  padding: ${theme.spacing[2]} 0;
                  text-align: center;
                  transition: color ${theme.transitions.micro};

                  &:hover { color: ${theme.colors.text.primary}; }
                `}
              >
                Show more ({history.length - showCount} remaining)
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Main Export: URL-based list/detail switching
// ============================================================================

export function EmotionsSection() {
  const location = useLocation();
  const navigate = useNavigate();

  const { viewMode, emotionName } = useMemo(() => {
    const subPath = location.pathname.replace('/mind/emotions', '').replace(/^\//, '');
    if (subPath && ALL_EMOTIONS.includes(subPath as EmotionName)) {
      return { viewMode: 'detail' as const, emotionName: subPath as EmotionName };
    }
    return { viewMode: 'list' as const, emotionName: null };
  }, [location.pathname]);

  return (
    <AnimatePresence mode="wait">
      {viewMode === 'list' ? (
        <motion.div
          key="list"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <EmotionsList />
        </motion.div>
      ) : emotionName ? (
        <motion.div
          key={`detail-${emotionName}`}
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -12 }}
          transition={{ duration: 0.15 }}
        >
          <EmotionDetailPage emotionName={emotionName} />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function formatRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;

  if (diffMs < 60_000) return 'just now';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(isoString).toLocaleDateString();
}
