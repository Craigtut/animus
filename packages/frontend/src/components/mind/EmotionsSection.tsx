/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { trpc } from '../../utils/trpc';
import { emotionColors } from '../../styles/theme';
import { Card } from '../ui/Card';
import { EmotionSparkline } from './EmotionSparkline';
import type { EmotionState, EmotionName, EmotionHistoryEntry } from '@animus/shared';

// ============================================================================
// Annotated Emotional Field (reduced height for Mind page)
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
        mask-image: linear-gradient(to bottom, black 60%, transparent 100%);
        -webkit-mask-image: linear-gradient(to bottom, black 60%, transparent 100%);
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
          <span
            key={e.emotion}
            css={css`
              position: absolute;
              left: ${pos!.left};
              top: ${pos!.top};
              font-size: 11px;
              font-weight: ${theme.typography.fontWeight.semibold};
              color: ${theme.colors.text.primary};
              opacity: ${0.3 + e.intensity * 0.4};
              pointer-events: none;
              text-transform: capitalize;
            `}
          >
            {e.emotion}
          </span>
        );
      })}
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
    <div css={css`position: relative; width: 100%; height: 4px; border-radius: 2px; background: ${theme.colors.background.elevated};`}>
      <div
        css={css`
          height: 100%;
          width: ${fillPercent}%;
          border-radius: 2px;
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
          top: -2px;
          width: 2px;
          height: 8px;
          background: ${theme.colors.text.hint};
          border-radius: 1px;
          transform: translateX(-50%);
        `}
      />
    </div>
  );
}

// ============================================================================
// Emotion Card
// ============================================================================

interface EmotionCardProps {
  emotion: EmotionState;
  color: string;
  historyEntries: EmotionHistoryEntry[];
  isExpanded: boolean;
  onToggle: () => void;
}

function EmotionCard({ emotion, color, historyEntries, isExpanded, onToggle }: EmotionCardProps) {
  const theme = useTheme();

  const categoryLabel = emotion.category === 'positive'
    ? 'Positive'
    : emotion.category === 'negative'
      ? 'Negative'
      : 'Drive';

  const sparklineData = useMemo(() => {
    if (!historyEntries.length) return [];
    // Take last 24 entries for sparkline
    return historyEntries.slice(-24).map((h) => ({
      value: h.intensityAfter,
      isSignificant: Math.abs(h.delta) >= 0.1,
    }));
  }, [historyEntries]);

  const lastDelta = historyEntries.length > 0
    ? historyEntries[historyEntries.length - 1]
    : null;

  const recentDeltas = useMemo(() => {
    return historyEntries.slice(-10).reverse();
  }, [historyEntries]);

  return (
    <Card interactive variant="elevated" padding="md" onClick={onToggle}>
      {/* Header row */}
      <div css={css`display: flex; align-items: center; justify-content: space-between; margin-bottom: ${theme.spacing[2]};`}>
        <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
          <span css={css`
            font-size: ${theme.typography.fontSize.base};
            font-weight: ${theme.typography.fontWeight.semibold};
            color: ${theme.colors.text.primary};
            text-transform: capitalize;
          `}>
            {emotion.emotion}
          </span>
          <span css={css`
            font-size: 11px;
            color: ${theme.colors.text.hint};
          `}>
            {categoryLabel}
          </span>
        </div>
        <EmotionSparkline data={sparklineData} color={color} />
      </div>

      {/* Intensity bar */}
      <IntensityBar intensity={emotion.intensity} baseline={emotion.baseline} color={color} />
      <span css={css`
        font-size: ${theme.typography.fontSize.xs};
        color: ${theme.colors.text.hint};
        margin-top: ${theme.spacing[1]};
        display: block;
      `}>
        {emotion.intensity.toFixed(2)}
      </span>

      {/* Last delta */}
      {lastDelta && (
        <p css={css`
          font-size: ${theme.typography.fontSize.xs};
          color: ${theme.colors.text.secondary};
          margin-top: ${theme.spacing[2]};
          line-height: ${theme.typography.lineHeight.normal};
        `}>
          {lastDelta.delta >= 0 ? '+' : ''}{lastDelta.delta.toFixed(2)} &mdash; {`"${lastDelta.reasoning}"`}
        </p>
      )}

      {/* Expanded detail */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            css={css`overflow: hidden;`}
          >
            <div css={css`
              margin-top: ${theme.spacing[4]};
              padding-top: ${theme.spacing[4]};
              border-top: 1px solid ${theme.colors.border.light};
            `}>
              {/* 7-day chart placeholder -- using larger sparkline */}
              <div css={css`margin-bottom: ${theme.spacing[4]};`}>
                <span css={css`
                  font-size: ${theme.typography.fontSize.xs};
                  color: ${theme.colors.text.hint};
                  margin-bottom: ${theme.spacing[2]};
                  display: block;
                `}>
                  History
                </span>
                <EmotionSparkline
                  data={historyEntries.map((h) => ({
                    value: h.intensityAfter,
                    isSignificant: Math.abs(h.delta) >= 0.1,
                  }))}
                  color={color}
                  width={280}
                  height={60}
                />
              </div>

              {/* Recent deltas */}
              <span css={css`
                font-size: ${theme.typography.fontSize.xs};
                color: ${theme.colors.text.hint};
                margin-bottom: ${theme.spacing[2]};
                display: block;
              `}>
                Recent changes
              </span>
              {recentDeltas.length === 0 ? (
                <span css={css`font-size: ${theme.typography.fontSize.xs}; color: ${theme.colors.text.hint};`}>
                  No changes recorded yet.
                </span>
              ) : (
                <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
                  {recentDeltas.map((d) => (
                    <div key={d.id} css={css`
                      display: flex;
                      align-items: baseline;
                      gap: ${theme.spacing[2]};
                      font-size: ${theme.typography.fontSize.xs};
                      color: ${theme.colors.text.secondary};
                    `}>
                      <span css={css`
                        font-weight: ${theme.typography.fontWeight.medium};
                        color: ${d.delta >= 0 ? theme.colors.success.main : theme.colors.error.main};
                        min-width: 40px;
                      `}>
                        {d.delta >= 0 ? '+' : ''}{d.delta.toFixed(2)}
                      </span>
                      <span css={css`flex: 1;`}>{d.reasoning}</span>
                      <span css={css`color: ${theme.colors.text.hint}; white-space: nowrap;`}>
                        Tick #{d.tickNumber}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Baseline info */}
              <div css={css`
                margin-top: ${theme.spacing[3]};
                font-size: ${theme.typography.fontSize.xs};
                color: ${theme.colors.text.hint};
              `}>
                Personality baseline: {emotion.baseline.toFixed(2)}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

// ============================================================================
// Emotions Section
// ============================================================================

const ALL_EMOTIONS: EmotionName[] = [
  'joy', 'contentment', 'excitement', 'gratitude', 'confidence',
  'stress', 'anxiety', 'frustration', 'sadness', 'boredom',
  'curiosity', 'loneliness',
];

export function EmotionsSection() {
  const theme = useTheme();
  const mode = theme.mode;
  const colors = emotionColors[mode];

  const [expandedEmotion, setExpandedEmotion] = useState<EmotionName | null>(null);

  // Fetch current emotion states
  const { data: emotionStates } = trpc.heartbeat.getEmotions.useQuery(undefined, {
    retry: false,
  });

  // Fetch emotion history for sparklines
  const { data: historyData } = trpc.heartbeat.getEmotionHistory.useQuery(
    { limit: 200 },
    { retry: false },
  );

  // Subscribe to real-time emotion updates
  const [liveEmotions, setLiveEmotions] = useState<EmotionState[]>([]);
  trpc.heartbeat.onEmotionChange.useSubscription(undefined, {
    onData: (emotion: EmotionState) => {
      setLiveEmotions((prev) => {
        const idx = prev.findIndex((e) => e.emotion === emotion.emotion);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = emotion;
          return next;
        }
        return [...prev, emotion];
      });
    },
  });

  const currentEmotions = useMemo(() => {
    const base = emotionStates ?? [];
    const map = new Map<string, EmotionState>();
    for (const e of base) map.set(e.emotion, e);
    for (const e of liveEmotions) map.set(e.emotion, e);
    return map;
  }, [emotionStates, liveEmotions]);

  // Group history by emotion
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
        category: getCategoryForEmotion(name),
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
            isExpanded={expandedEmotion === emotion.emotion}
            onToggle={() =>
              setExpandedEmotion((prev) =>
                prev === emotion.emotion ? null : (emotion.emotion as EmotionName)
              )
            }
          />
        ))}
      </div>
    </div>
  );
}

// Helper
function getCategoryForEmotion(name: EmotionName): 'positive' | 'negative' | 'drive' {
  const positive = new Set(['joy', 'contentment', 'excitement', 'gratitude', 'confidence']);
  const negative = new Set(['stress', 'anxiety', 'frustration', 'sadness', 'loneliness']);
  if (positive.has(name)) return 'positive';
  if (negative.has(name)) return 'negative';
  return 'drive';
}
