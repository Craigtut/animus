/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import { WarningCircle } from '@phosphor-icons/react';
import { trpc } from '../../../utils/trpc';
import { useHeartbeatStore } from '../../../store/heartbeat-store';
import type { TimelineEvent, TickTimeline, TickResults, TickUsage, PhaseName } from './types';
import type { PhaseUsage, PhaseContextSnapshot } from '@animus-labs/shared';
import { useNavigate } from 'react-router-dom';
import { groupEventsIntoPhases } from './group-events';
import { PhaseBar } from './PhaseBar';
import { PhasePanel } from './PhasePanel';
import { Badge, formatDuration, formatCost, triggerColor } from './shared';

// ============================================================================
// Normalize backend response
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeTimeline(raw: any): TickTimeline | null {
  if (!raw) return null;

  const events: TimelineEvent[] = (raw.events ?? []).map((e: any) => ({  // eslint-disable-line @typescript-eslint/no-explicit-any
    id: String(e.id),
    sessionId: e.sessionId as string | undefined,
    eventType: String(e.eventType),
    data: (e.data ?? {}) as Record<string, unknown>,
    createdAt: String(e.createdAt),
    relativeMs: Number(e.relativeMs ?? 0),
  }));

  let results: TickResults | null = null;
  if (raw.results) {
    const r = raw.results;
    const thoughts = (r.thoughts ?? []).map((t: { content?: string; importance?: number }) => ({
      content: String(t.content ?? ''),
      importance: Number(t.importance ?? 0),
    }));
    const experiences = (r.experiences ?? []).map((e: { content?: string; importance?: number }) => ({
      content: String(e.content ?? ''),
      importance: Number(e.importance ?? 0),
    }));
    const emotionDeltas = (r.emotionHistory ?? r.emotionDeltas ?? []).map((eh: {
      emotion?: string; delta?: number; reasoning?: string;
      intensityBefore?: number; intensity_before?: number;
      intensityAfter?: number; intensity_after?: number;
    }) => ({
      emotion: String(eh.emotion ?? ''),
      delta: Number(eh.delta ?? 0),
      reasoning: String(eh.reasoning ?? ''),
      intensityBefore: Number(eh.intensityBefore ?? eh.intensity_before ?? 0),
      intensityAfter: Number(eh.intensityAfter ?? eh.intensity_after ?? 0),
    }));
    const decisions = (r.decisions ?? []).map((d: {
      type?: string; description?: string; parameters?: Record<string, unknown> | null;
      outcome?: string; outcomeDetail?: string | null; outcome_detail?: string | null;
    }) => ({
      type: String(d.type ?? ''),
      description: String(d.description ?? ''),
      parameters: d.parameters ?? null,
      outcome: String(d.outcome ?? 'executed'),
      outcomeDetail: d.outcomeDetail ?? d.outcome_detail ?? null,
    }));
    const base: TickResults = { thoughts, experiences, emotionDeltas, decisions };
    if (r.reply) {
      const replyObj: { content: string; channel: string; contactId?: string } = {
        content: String(r.reply.content ?? ''),
        channel: String(r.reply.channel ?? ''),
      };
      if (r.reply.contactId) replyObj.contactId = String(r.reply.contactId);
      base.reply = replyObj;
    }
    results = base;
  }

  let usage: TickUsage | null = null;
  if (raw.usage) {
    const u = raw.usage;
    usage = {
      inputTokens: Number(u.inputTokens ?? u.input_tokens ?? 0),
      outputTokens: Number(u.outputTokens ?? u.output_tokens ?? 0),
      cacheReadTokens: Number(u.cacheReadTokens ?? u.cache_read_tokens ?? 0),
      cacheWriteTokens: Number(u.cacheWriteTokens ?? u.cache_write_tokens ?? 0),
      totalTokens: Number(u.totalTokens ?? u.total_tokens ?? 0),
      costUsd: u.costUsd != null ? Number(u.costUsd) : u.cost_usd != null ? Number(u.cost_usd) : null,
    };
  }

  const phaseUsage: PhaseUsage[] = Array.isArray(raw.phaseUsage)
    ? raw.phaseUsage.map((p: Record<string, unknown>) => ({
        phase: String(p['phase'] ?? ''),
        inputTokens: Number(p['inputTokens'] ?? 0),
        outputTokens: Number(p['outputTokens'] ?? 0),
        cacheReadTokens: Number(p['cacheReadTokens'] ?? 0),
        cacheWriteTokens: Number(p['cacheWriteTokens'] ?? 0),
        costUsd: Number(p['costUsd'] ?? 0),
        model: (p['model'] as string) ?? null,
      }))
    : [];

  return {
    tickNumber: Number(raw.tickNumber),
    sessionId: String(raw.sessionId ?? ''),
    triggerType: String(raw.triggerType ?? 'unknown'),
    isComplete: Boolean(raw.isComplete),
    durationMs: raw.durationMs ?? null,
    createdAt: String(raw.createdAt ?? ''),
    events,
    results,
    usage,
    phaseUsage,
    contextWindow: (raw.contextWindow as number) ?? null,
    phaseSnapshots: Array.isArray(raw.phaseSnapshots)
      ? (raw.phaseSnapshots as PhaseContextSnapshot[])
      : [],
  };
}

// ============================================================================
// Stat cell (for the header stats row)
// ============================================================================

function StatCell({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const theme = useTheme();
  return (
    <div css={css`
      display: flex;
      flex-direction: column;
      gap: 2px;
    `}>
      <span css={css`
        font-family: ${theme.typography.fontFamily.sans};
        font-size: 10px;
        font-weight: ${theme.typography.fontWeight.medium};
        color: ${theme.colors.text.hint};
        text-transform: uppercase;
        letter-spacing: 0.05em;
      `}>
        {label}
      </span>
      <span css={css`
        font-family: ${mono ? theme.typography.fontFamily.mono : theme.typography.fontFamily.sans};
        font-size: 13px;
        color: ${theme.colors.text.primary};
      `}>
        {value}
      </span>
    </div>
  );
}

// ============================================================================
// Skeleton loading state
// ============================================================================

function TimelineSkeleton() {
  const theme = useTheme();
  const shimmerLight = theme.mode === 'light'
    ? 'rgba(0,0,0,0.04)'
    : 'rgba(255,255,255,0.03)';
  const shimmerHighlight = theme.mode === 'light'
    ? 'rgba(0,0,0,0.08)'
    : 'rgba(255,255,255,0.07)';

  const shimmerKeyframes = css`
    @keyframes shimmer {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
  `;

  const shimmerStyle = css`
    background: linear-gradient(
      90deg,
      ${shimmerLight} 0%,
      ${shimmerHighlight} 50%,
      ${shimmerLight} 100%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s ease-in-out infinite;
    border-radius: ${theme.borderRadius.sm};
  `;

  return (
    <div css={shimmerKeyframes}>
      <div css={css`${shimmerStyle}; width: 200px; height: 28px; margin-bottom: ${theme.spacing[3]};`} />
      <div css={css`
        display: flex;
        gap: ${theme.spacing[4]};
        margin-bottom: ${theme.spacing[5]};
      `}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} css={css`display: flex; flex-direction: column; gap: 4px;`}>
            <div css={css`${shimmerStyle}; width: 40px; height: 10px;`} />
            <div css={css`${shimmerStyle}; width: 60px; height: 16px;`} />
          </div>
        ))}
      </div>
      <div css={css`${shimmerStyle}; height: 44px; border-radius: ${theme.borderRadius.default}; margin-bottom: ${theme.spacing[4]};`} />
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} css={css`
          ${shimmerStyle};
          height: 42px;
          border-radius: ${theme.borderRadius.default};
          margin-bottom: ${theme.spacing[1.5]};
          opacity: ${1 - i * 0.15};
        `} />
      ))}
    </div>
  );
}

// ============================================================================
// TickDetailView (Main Component)
// ============================================================================

interface TickDetailViewProps {
  tickNumber: number;
}

export function TickDetailView({ tickNumber }: TickDetailViewProps) {
  const theme = useTheme();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [liveEvents, setLiveEvents] = useState<TimelineEvent[]>([]);
  const [expandedPhase, setExpandedPhase] = useState<PhaseName | null>(null);

  const heartbeatState = useHeartbeatStore((s) => s.heartbeatState);
  const isTickActive = heartbeatState != null
    && heartbeatState.tickNumber === tickNumber
    && heartbeatState.currentStage !== 'idle';

  const {
    data: rawTimeline,
    isLoading,
    isError,
    refetch,
  } = trpc.heartbeat.getTickTimeline.useQuery(
    { tickNumber },
    {
      retry: false,
      refetchInterval: (query) => {
        if (!query.state.data && isTickActive) return 2000;
        return false;
      },
    },
  );

  const timeline = useMemo(() => normalizeTimeline(rawTimeline), [rawTimeline]);
  const isLive = timeline != null && !timeline.isComplete;

  trpc.heartbeat.onAgentEvent.useSubscription(undefined, {
    enabled: isLive,
    onData: (event) => {
      if (!timeline || event.sessionId !== timeline.sessionId) return;
      setLiveEvents((prev) => {
        if (prev.some((e) => e.id === event.id)) return prev;
        if (timeline.events.some((e) => e.id === event.id)) return prev;
        const firstEventTime = timeline.events.length > 0
          ? new Date(timeline.events[0]!.createdAt).getTime()
          : Date.now();
        const eventTime = new Date(event.createdAt).getTime();
        return [...prev, {
          id: event.id,
          sessionId: event.sessionId,
          eventType: event.eventType,
          data: event.data ?? {},
          createdAt: event.createdAt,
          relativeMs: eventTime - firstEventTime,
        }];
      });
    },
  });

  const allEvents = useMemo(() => {
    if (!timeline) return [];
    const merged = [...timeline.events];
    for (const le of liveEvents) {
      if (!merged.some((e) => e.id === le.id)) merged.push(le);
    }
    merged.sort((a, b) => a.relativeMs - b.relativeMs);
    return merged;
  }, [timeline, liveEvents]);

  const phases = useMemo(() => {
    if (allEvents.length === 0) return [];
    return groupEventsIntoPhases(allEvents, timeline?.phaseUsage ?? []);
  }, [allEvents, timeline?.phaseUsage]);

  // Build a map of phase -> snapshot for quick lookup, and extract turn deltas
  const { phaseSnapshotMap, turnDeltas } = useMemo(() => {
    const map = new Map<string, PhaseContextSnapshot>();
    const deltas: PhaseContextSnapshot[] = [];
    for (const snap of timeline?.phaseSnapshots ?? []) {
      if (snap.phase === 'agentic_turn') {
        deltas.push(snap);
      } else {
        map.set(snap.phase, snap);
      }
    }
    // Sort turn deltas by turn number
    deltas.sort((a, b) => {
      const aNum = 'turnNumber' in a ? (a as unknown as { turnNumber: number }).turnNumber : 0;
      const bNum = 'turnNumber' in b ? (b as unknown as { turnNumber: number }).turnNumber : 0;
      return aNum - bNum;
    });
    return { phaseSnapshotMap: map, turnDeltas: deltas };
  }, [timeline?.phaseSnapshots]);

  const handleInspectContext = useCallback((phase: PhaseName) => {
    navigate(`/mind/heartbeats/${tickNumber}/${phase}/context`);
  }, [navigate, tickNumber]);

  useEffect(() => {
    if (!isLive) return;
    const runningPhase = phases.find((p) => p.status === 'running');
    if (runningPhase) setExpandedPhase(runningPhase.name);
  }, [isLive, phases]);

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 100);
  }, []);

  useEffect(() => {
    if (isLive && autoScroll && containerRef.current) {
      containerRef.current.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [allEvents.length, isLive, autoScroll]);

  const handlePhaseClick = (phase: PhaseName) => {
    setExpandedPhase((prev) => prev === phase ? null : phase);
  };

  // --- Loading ---
  if (isLoading) return <TimelineSkeleton />;

  // --- Error ---
  if (isError) {
    return (
      <div css={css`
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: ${theme.spacing[3]};
        padding: 4rem 0;
      `}>
        <WarningCircle size={32} weight="regular" color={theme.colors.text.hint} />
        <span css={css`font-size: 14px; color: ${theme.colors.text.secondary};`}>
          Something went wrong loading this tick.
        </span>
        <button
          onClick={() => refetch()}
          css={css`
            font-size: 14px;
            color: ${theme.colors.text.secondary};
            border: 1px solid ${theme.colors.border.default};
            padding: ${theme.spacing[1.5]} ${theme.spacing[4]};
            border-radius: ${theme.borderRadius.default};
            cursor: pointer;
            &:hover { color: ${theme.colors.text.primary}; border-color: ${theme.colors.border.focus}; }
          `}
        >
          Try again
        </button>
      </div>
    );
  }

  // --- Active but not yet in DB ---
  if (!timeline && isTickActive) {
    const stage = heartbeatState?.currentStage ?? 'gather';
    return (
      <div css={css`
        display: flex; flex-direction: column; align-items: center;
        gap: ${theme.spacing[3]}; padding: 4rem 0;
      `}>
        <motion.div
          animate={{ opacity: [0.3, 0.8, 0.3] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          css={css`width: 12px; height: 12px; border-radius: 50%; background: ${theme.colors.accent};`}
        />
        <span css={css`
          font-family: ${theme.typography.fontFamily.serif};
          font-size: 16px; font-style: italic; color: ${theme.colors.text.hint};
        `}>
          {stage === 'gather' ? 'Gathering context...' : stage === 'mind' ? 'Starting mind session...' : 'Processing...'}
        </span>
      </div>
    );
  }

  // --- Not found ---
  if (!timeline) {
    return (
      <div css={css`
        display: flex; flex-direction: column; align-items: center;
        gap: ${theme.spacing[2]}; padding: 4rem 0;
      `}>
        <span css={css`
          font-family: ${theme.typography.fontFamily.serif};
          font-size: 16px; font-style: italic; color: ${theme.colors.text.hint};
        `}>
          Tick #{tickNumber} not found
        </span>
      </div>
    );
  }

  // --- Main render ---
  return (
    <div ref={containerRef} onScroll={isLive ? handleScroll : undefined}>
      {/* ================================================================
          HEADER: tick identity + key stats
          ================================================================ */}
      <div css={css`margin-bottom: ${theme.spacing[5]};`}>
        {/* Top line: tick number + trigger */}
        <div css={css`
          display: flex;
          align-items: center;
          gap: ${theme.spacing[2]};
          margin-bottom: ${theme.spacing[3]};
        `}>
          <span css={css`
            font-family: ${theme.typography.fontFamily.mono};
            font-size: ${theme.typography.fontSize.xl};
            font-weight: ${theme.typography.fontWeight.semibold};
            color: ${theme.colors.text.primary};
          `}>
            #{timeline.tickNumber}
          </span>
          <Badge label={timeline.triggerType} color={triggerColor(timeline.triggerType, theme)} />
          <span css={css`
            font-size: ${theme.typography.fontSize.sm};
            color: ${theme.colors.text.disabled};
            margin-left: auto;
          `}>
            {new Date(timeline.createdAt).toLocaleString()}
          </span>
        </div>

        {/* Stats row: structured key-value cells */}
        <div css={css`
          display: flex;
          gap: ${theme.spacing[6]};
          flex-wrap: wrap;
          padding: ${theme.spacing[3]} 0;
          border-top: 1px solid ${theme.colors.border.light};
          border-bottom: 1px solid ${theme.colors.border.light};
        `}>
          {timeline.durationMs != null && (
            <StatCell label="Duration" value={formatDuration(timeline.durationMs)} />
          )}
          {timeline.usage && (() => {
            const u = timeline.usage;
            const totalIn = u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens;
            return (
              <>
                <StatCell label="Total In" value={totalIn.toLocaleString()} />
                <StatCell label="Output" value={u.outputTokens.toLocaleString()} />
                {u.cacheReadTokens > 0 && (
                  <StatCell label="Cached" value={u.cacheReadTokens.toLocaleString()} />
                )}
              </>
            );
          })()}
          {timeline.usage?.costUsd != null && (
            <StatCell label="Cost" value={formatCost(timeline.usage.costUsd) ?? '-'} />
          )}
        </div>
      </div>

      {/* ================================================================
          PHASE BAR
          ================================================================ */}
      {phases.length > 0 && (
        <div css={css`margin-bottom: ${theme.spacing[4]};`}>
          <PhaseBar
            phases={phases}
            expandedPhase={expandedPhase}
            onPhaseClick={handlePhaseClick}
          />
        </div>
      )}

      {/* ================================================================
          PHASE PANELS
          ================================================================ */}
      <div css={css`
        display: flex;
        flex-direction: column;
        gap: ${theme.spacing[2]};
      `}>
        {phases.map((phase) => (
          <PhasePanel
            key={phase.name}
            phase={phase}
            isExpanded={expandedPhase === phase.name}
            onToggle={() => handlePhaseClick(phase.name)}
            results={timeline.results}
            contextWindow={timeline.contextWindow}
            phaseSnapshot={phaseSnapshotMap.get(phase.name)}
            turnDeltas={phase.name === 'agentic_loop' ? turnDeltas : undefined}
            onInspectContext={
              (phase.name === 'thought' || phase.name === 'agentic_loop' || phase.name === 'reflect')
                && phaseSnapshotMap.has(phase.name)
                ? () => handleInspectContext(phase.name)
                : undefined
            }
          />
        ))}
      </div>

      {/* Live indicator */}
      {isLive && (
        <div css={css`
          display: flex; align-items: center; gap: ${theme.spacing[2]};
          padding: ${theme.spacing[4]} 0; justify-content: center;
        `}>
          <motion.div
            animate={{ opacity: [0.3, 0.8, 0.3] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            css={css`width: 8px; height: 8px; border-radius: 50%; background: ${theme.colors.accent};`}
          />
          <span css={css`
            font-family: ${theme.typography.fontFamily.serif};
            font-size: 13px; font-style: italic; color: ${theme.colors.text.hint};
          `}>
            Tick in progress...
          </span>
        </div>
      )}

      {/* Jump to latest */}
      {isLive && !autoScroll && (
        <button
          onClick={() => {
            setAutoScroll(true);
            containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'smooth' });
          }}
          css={css`
            position: fixed; bottom: 24px; right: 24px;
            font-size: 12px; color: ${theme.colors.accentForeground};
            background: ${theme.colors.accent};
            padding: ${theme.spacing[1]} ${theme.spacing[3]};
            border-radius: ${theme.borderRadius.full};
            cursor: pointer; z-index: ${theme.zIndex.sticky};
            &:hover { opacity: 0.9; }
          `}
        >
          Jump to latest
        </button>
      )}
    </div>
  );
}
