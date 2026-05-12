/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowLeft } from '@phosphor-icons/react';
import { trpc } from '../../utils/trpc';
import { useHeartbeatStore } from '../../store/heartbeat-store';
import { Typography } from '../ui';
import { TickDetailView } from './tick-detail';
import { PhaseContextPage } from './tick-detail/PhaseContextPage';

// ============================================================================
// Trigger badge colors
// ============================================================================

function triggerColor(triggerType: string, theme: ReturnType<typeof useTheme>): string {
  switch (triggerType) {
    case 'message':        return theme.colors.accent;
    case 'interval':       return theme.colors.text.hint;
    case 'scheduled_task': return theme.colors.warning.main;
    case 'agent_complete': return theme.colors.success.main;
    default:               return theme.colors.text.secondary;
  }
}

// ============================================================================
// Badge (local, for TickList)
// ============================================================================

function Badge({ label, color }: { label: string; color: string }) {
  const theme = useTheme();
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
// List View
// ============================================================================

function TickList({ onSelect }: { onSelect: (tickNumber: number) => void }) {
  const theme = useTheme();
  const [page, setPage] = useState(0);
  const limit = 20;

  const { data, isLoading } = trpc.heartbeat.listTicks.useQuery(
    { limit, offset: page * limit },
    { retry: false },
  );

  const heartbeatState = useHeartbeatStore((s) => s.heartbeatState);

  const ticks = data?.ticks ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  // Show a live entry when a tick is in progress but not yet in the DB
  const showLiveEntry = useMemo(() => {
    if (!heartbeatState || heartbeatState.currentStage === 'idle') return false;
    // Don't show if the current tick is already in the loaded DB ticks
    return !ticks.some((t) => t.tickNumber === heartbeatState.tickNumber);
  }, [heartbeatState, ticks]);

  if (isLoading) {
    return (
      <Typography.Body serif italic color="hint" css={css`text-align: center; padding: 4rem 0;`}>
        Loading heartbeat ticks...
      </Typography.Body>
    );
  }

  if (ticks.length === 0 && !showLiveEntry) {
    return (
      <Typography.Body serif italic color="hint" css={css`text-align: center; padding: 4rem 0;`}>
        No heartbeat ticks recorded yet. Start the heartbeat and trigger a tick.
      </Typography.Body>
    );
  }

  return (
    <div>
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1]};`}>
        {/* Live entry for in-progress tick */}
        {showLiveEntry && heartbeatState && (
          <motion.button
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => onSelect(heartbeatState.tickNumber)}
            css={css`
              display: flex;
              align-items: center;
              gap: ${theme.spacing[3]};
              padding: ${theme.spacing[2]} ${theme.spacing[3]};
              border-radius: ${theme.borderRadius.md};
              cursor: pointer;
              text-align: left;
              transition: background ${theme.transitions.micro};
              background: ${theme.mode === 'light'
                ? 'rgba(0, 0, 0, 0.02)'
                : 'rgba(255, 255, 255, 0.02)'};

              &:hover {
                background: ${theme.mode === 'light'
                  ? 'rgba(0, 0, 0, 0.04)'
                  : 'rgba(255, 255, 255, 0.05)'};
              }
            `}
          >
            {/* Pulsing indicator */}
            <motion.div
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
              css={css`
                width: 6px;
                height: 6px;
                border-radius: 50%;
                background: ${theme.colors.accent};
                flex-shrink: 0;
              `}
            />

            {/* Tick number */}
            <Typography.Caption
              color="hint"
              css={css`
                font-family: ${theme.typography.fontFamily.mono};
                min-width: 40px;
                text-align: right;
              `}
            >
              #{heartbeatState.tickNumber}
            </Typography.Caption>

            {/* Trigger badge */}
            {heartbeatState.triggerType && (
              <Badge label={heartbeatState.triggerType} color={triggerColor(heartbeatState.triggerType, theme)} />
            )}

            {/* In Progress label */}
            <Typography.SmallBody
              color="secondary"
              css={css`
                flex: 1;
                min-width: 0;
                font-style: italic;
              `}
            >
              In Progress: {heartbeatState.currentStage}
            </Typography.SmallBody>
          </motion.button>
        )}

        {ticks.map((tick) => (
          <button
            key={tick.tickNumber}
            onClick={() => onSelect(tick.tickNumber)}
            css={css`
              display: flex;
              align-items: center;
              gap: ${theme.spacing[3]};
              padding: ${theme.spacing[2]} ${theme.spacing[3]};
              border-radius: ${theme.borderRadius.md};
              cursor: pointer;
              text-align: left;
              transition: background ${theme.transitions.micro};

              &:hover {
                background: ${theme.mode === 'light'
                  ? 'rgba(0, 0, 0, 0.03)'
                  : 'rgba(255, 255, 255, 0.04)'};
              }
            `}
          >
            {/* Tick number */}
            <Typography.Caption
              color="hint"
              css={css`
                font-family: ${theme.typography.fontFamily.mono};
                min-width: 40px;
                text-align: right;
              `}
            >
              #{tick.tickNumber}
            </Typography.Caption>

            {/* Trigger badge */}
            <Badge label={tick.triggerType} color={triggerColor(tick.triggerType, theme)} />

            {/* Thought preview */}
            <Typography.SmallBody
              color="secondary"
              css={css`
                flex: 1;
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
              `}
            >
              {tick.thoughtPreview || '...'}
            </Typography.SmallBody>

            {/* Duration */}
            {tick.durationMs != null && (
              <Typography.Caption
                color="hint"
                css={css`
                  font-family: ${theme.typography.fontFamily.mono};
                  white-space: nowrap;
                `}
              >
                {formatDuration(tick.durationMs)}
              </Typography.Caption>
            )}

            {/* Time */}
            <Typography.Caption color="disabled" css={css`white-space: nowrap;`}>
              {formatRelativeTime(tick.createdAt)}
            </Typography.Caption>
          </button>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div css={css`
          display: flex;
          justify-content: center;
          gap: ${theme.spacing[2]};
          margin-top: ${theme.spacing[4]};
        `}>
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            css={css`
              font-size: ${theme.typography.fontSize.sm};
              color: ${page === 0 ? theme.colors.text.disabled : theme.colors.text.secondary};
              cursor: ${page === 0 ? 'default' : 'pointer'};
              padding: ${theme.spacing[1]} ${theme.spacing[2]};

              &:hover:not(:disabled) { color: ${theme.colors.text.primary}; }
            `}
          >
            Previous
          </button>
          <Typography.Caption color="hint" css={css`
            display: flex; align-items: center;
          `}>
            {page + 1} / {totalPages}
          </Typography.Caption>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            css={css`
              font-size: ${theme.typography.fontSize.sm};
              color: ${page >= totalPages - 1 ? theme.colors.text.disabled : theme.colors.text.secondary};
              cursor: ${page >= totalPages - 1 ? 'default' : 'pointer'};
              padding: ${theme.spacing[1]} ${theme.spacing[2]};

              &:hover:not(:disabled) { color: ${theme.colors.text.primary}; }
            `}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Back button
// ============================================================================

function BackButton({ onBack }: { onBack: () => void }) {
  const theme = useTheme();
  return (
    <button
      onClick={onBack}
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
      Back to ticks
    </button>
  );
}

// ============================================================================
// Main export
// ============================================================================

export function HeartbeatsSection() {
  const location = useLocation();
  const navigate = useNavigate();

  // Derive view mode from URL
  type ViewMode = { mode: 'list' } | { mode: 'detail'; tick: number } | { mode: 'phase-context'; tick: number; phase: string };

  const view = useMemo<ViewMode>(() => {
    const subPath = location.pathname.replace('/mind/heartbeats', '').replace(/^\//, '');
    if (!subPath) return { mode: 'list' };

    // /mind/heartbeats/:tick/:phase/context
    const phaseContextMatch = subPath.match(/^(\d+)\/(thought|agentic_loop|reflect)\/context$/);
    if (phaseContextMatch) {
      const tickNum = parseInt(phaseContextMatch[1]!, 10);
      if (!isNaN(tickNum) && tickNum > 0) {
        return { mode: 'phase-context', tick: tickNum, phase: phaseContextMatch[2]! };
      }
    }

    // /mind/heartbeats/:tick/context (legacy, redirect to detail)
    const legacyContextMatch = subPath.match(/^(\d+)\/context$/);
    if (legacyContextMatch) {
      const tickNum = parseInt(legacyContextMatch[1]!, 10);
      if (!isNaN(tickNum) && tickNum > 0) {
        return { mode: 'detail', tick: tickNum };
      }
    }

    // /mind/heartbeats/:tick
    const tickNum = parseInt(subPath, 10);
    if (!isNaN(tickNum) && tickNum > 0) {
      return { mode: 'detail', tick: tickNum };
    }

    return { mode: 'list' };
  }, [location.pathname]);

  const handleSelect = (tickNumber: number) => {
    navigate(`/mind/heartbeats/${tickNumber}`);
  };

  const handleBack = () => {
    navigate('/mind/heartbeats');
  };

  if (view.mode === 'phase-context') {
    return (
      <PhaseContextPage
        tickNumber={view.tick}
        phase={view.phase}
        onBack={() => navigate(`/mind/heartbeats/${view.tick}`)}
      />
    );
  }

  if (view.mode === 'detail') {
    return (
      <div>
        <BackButton onBack={handleBack} />
        <TickDetailView tickNumber={view.tick} />
      </div>
    );
  }

  return <TickList onSelect={handleSelect} />;
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

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
