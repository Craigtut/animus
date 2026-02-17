/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, CaretDown, CaretRight } from '@phosphor-icons/react';
import { trpc } from '../../utils/trpc';
import { useHeartbeatStore } from '../../store/heartbeat-store';
import { Typography } from '../ui';
import { AgentTimeline } from './AgentTimeline';

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

function sessionBadgeColor(state: string, theme: ReturnType<typeof useTheme>): string {
  return state === 'cold' ? '#5B8DEF' : '#E8A838';
}

// ============================================================================
// Collapsible Section
// ============================================================================

function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div css={css`margin-bottom: ${theme.spacing[3]};`}>
      <button
        onClick={() => setOpen((o) => !o)}
        css={css`
          display: flex;
          align-items: center;
          gap: ${theme.spacing[1.5]};
          font-size: ${theme.typography.fontSize.sm};
          font-weight: ${theme.typography.fontWeight.semibold};
          color: ${theme.colors.text.secondary};
          cursor: pointer;
          padding: ${theme.spacing[1]} 0;
          transition: color ${theme.transitions.micro};

          &:hover { color: ${theme.colors.text.primary}; }
        `}
      >
        {open ? <CaretDown size={12} /> : <CaretRight size={12} />}
        {title}
      </button>
      {open && (
        <div css={css`
          margin-top: ${theme.spacing[2]};
          padding-left: ${theme.spacing[2]};
        `}>
          {children}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Badge
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
// Prompt Display (syntax-highlighted-ish preformatted text)
// ============================================================================

function PromptDisplay({ content }: { content: string }) {
  const theme = useTheme();
  return (
    <pre css={css`
      font-family: ${theme.typography.fontFamily.mono};
      font-size: 0.8rem;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
      color: ${theme.colors.text.primary};
      background: ${theme.mode === 'light'
        ? 'rgba(0, 0, 0, 0.03)'
        : 'rgba(255, 255, 255, 0.04)'};
      padding: ${theme.spacing[3]};
      border-radius: ${theme.borderRadius.md};
      border: 1px solid ${theme.colors.border.light};
      max-height: 400px;
      overflow-y: auto;
      margin: 0;
    `}>
      {content}
    </pre>
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
              In Progress — {heartbeatState.currentStage}
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

            {/* Session state badge */}
            <Badge label={tick.sessionState} color={sessionBadgeColor(tick.sessionState, theme)} />

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
// Detail View
// ============================================================================

function TickDetail({ tickNumber, onBack }: { tickNumber: number; onBack: () => void }) {
  const theme = useTheme();

  const { data, isLoading } = trpc.heartbeat.getTickDetail.useQuery(
    { tickNumber },
    { retry: false },
  );

  if (isLoading) {
    return (
      <Typography.Body serif italic color="hint" css={css`text-align: center; padding: 4rem 0;`}>
        Loading tick #{tickNumber}...
      </Typography.Body>
    );
  }

  if (!data) {
    return (
      <div>
        <BackButton onBack={onBack} />
        <Typography.Body serif italic color="hint" css={css`text-align: center; padding: 4rem 0;`}>
          Tick #{tickNumber} not found.
        </Typography.Body>
      </div>
    );
  }

  interface ThoughtRow { content: string; importance: number }
  interface ExperienceRow { content: string; importance: number }
  interface EmotionRow { emotion: string; delta: number; reasoning: string; intensity_before: number; intensity_after: number }
  interface ReplyData { content: string; channel: string; contactId?: string }
  interface RawOutput { reply?: ReplyData | null; [key: string]: unknown }

  const thoughts = (data.thoughts ?? []) as unknown as ThoughtRow[];
  const experiences = (data.experiences ?? []) as unknown as ExperienceRow[];
  const emotionHistory = (data.emotionHistory ?? []) as unknown as EmotionRow[];
  const decisions = data.decisions ?? [];
  const rawOutput = data.rawOutput as RawOutput | null;

  return (
    <div>
      <BackButton onBack={onBack} />

      {/* Header */}
      <div css={css`
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: ${theme.spacing[2]};
        margin-bottom: ${theme.spacing[6]};
      `}>
        <Typography.Subtitle color="primary">Tick #{data.tickNumber}</Typography.Subtitle>
        <Badge label={data.triggerType} color={triggerColor(data.triggerType, theme)} />
        <Badge label={data.sessionState} color={sessionBadgeColor(data.sessionState, theme)} />
        {data.durationMs != null && (
          <Typography.Caption color="hint" css={css`font-family: ${theme.typography.fontFamily.mono};`}>
            {formatDuration(data.durationMs)}
          </Typography.Caption>
        )}
        <Typography.Caption color="disabled">
          {new Date(data.createdAt).toLocaleString()}
        </Typography.Caption>
      </div>

      {/* Thought */}
      {thoughts.length > 0 && (
        <Section title="Thought">
          {thoughts.map((t, i) => (
            <div key={i} css={css`margin-bottom: ${theme.spacing[2]};`}>
              <Typography.Body serif color="primary">{t.content}</Typography.Body>
              <Typography.Caption color="hint">importance: {t.importance.toFixed(2)}</Typography.Caption>
            </div>
          ))}
        </Section>
      )}

      {/* Experience */}
      {experiences.length > 0 && (
        <Section title="Experience">
          {experiences.map((e, i) => (
            <div key={i} css={css`margin-bottom: ${theme.spacing[2]};`}>
              <Typography.Body serif italic color="primary">{e.content}</Typography.Body>
              <Typography.Caption color="hint">importance: {e.importance.toFixed(2)}</Typography.Caption>
            </div>
          ))}
        </Section>
      )}

      {/* Reply */}
      {rawOutput?.reply && (
        <Section title="Reply">
          <Typography.Body color="primary">
            {rawOutput.reply.content}
          </Typography.Body>
          <div css={css`
            display: flex;
            gap: ${theme.spacing[2]};
            margin-top: ${theme.spacing[1]};
          `}>
            <Typography.Caption color="hint">
              channel: {rawOutput.reply.channel}
            </Typography.Caption>
          </div>
        </Section>
      )}

      {/* Emotion Deltas */}
      {emotionHistory.length > 0 && (
        <Section title="Emotion Deltas">
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
            {emotionHistory.map((eh, i) => (
              <div key={i} css={css`
                display: flex;
                align-items: baseline;
                gap: ${theme.spacing[2]};
                flex-wrap: wrap;
              `}>
                <Typography.SmallBody css={css`font-weight: ${theme.typography.fontWeight.medium};`}>
                  {eh.emotion}
                </Typography.SmallBody>
                <Typography.Caption
                  css={css`
                    font-family: ${theme.typography.fontFamily.mono};
                    color: ${eh.delta > 0 ? theme.colors.success.main : eh.delta < 0 ? theme.colors.error.main : theme.colors.text.hint};
                  `}
                >
                  {eh.delta > 0 ? '+' : ''}{eh.delta.toFixed(3)}
                </Typography.Caption>
                <Typography.Caption color="hint" css={css`flex: 1;`}>
                  {eh.reasoning}
                </Typography.Caption>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Decisions */}
      {decisions.length > 0 && (
        <Section title="Decisions">
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
            {decisions.map((d, i) => (
              <div key={i} css={css`
                display: flex;
                align-items: baseline;
                gap: ${theme.spacing[2]};
                flex-wrap: wrap;
              `}>
                <Badge label={d.type} color={
                  d.outcome === 'executed' ? theme.colors.success.main
                  : d.outcome === 'dropped' ? theme.colors.warning.main
                  : theme.colors.error.main
                } />
                <Typography.SmallBody color="secondary">{d.description}</Typography.SmallBody>
                <Typography.Caption color="disabled">[{d.outcome}]</Typography.Caption>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Token Usage */}
      {data.tokenBreakdown && (
        <Section title="Token Usage">
          <div css={css`
            display: flex;
            gap: ${theme.spacing[4]};
            flex-wrap: wrap;
          `}>
            {Object.entries(data.tokenBreakdown).map(([key, val]) => (
              <div key={key}>
                <Typography.Caption color="hint">{key}</Typography.Caption>
                <Typography.SmallBody css={css`font-family: ${theme.typography.fontFamily.mono};`}>
                  ~{(val as number).toLocaleString()} tokens
                </Typography.SmallBody>
              </div>
            ))}
          </div>
          {data.usage && (() => {
            const usage = data.usage as { inputTokens?: number; outputTokens?: number; costUsd?: number | null };
            return (
              <div css={css`
                display: flex;
                gap: ${theme.spacing[4]};
                margin-top: ${theme.spacing[2]};
                flex-wrap: wrap;
              `}>
                <div>
                  <Typography.Caption color="hint">Input</Typography.Caption>
                  <Typography.SmallBody css={css`font-family: ${theme.typography.fontFamily.mono};`}>
                    {usage.inputTokens?.toLocaleString()}
                  </Typography.SmallBody>
                </div>
                <div>
                  <Typography.Caption color="hint">Output</Typography.Caption>
                  <Typography.SmallBody css={css`font-family: ${theme.typography.fontFamily.mono};`}>
                    {usage.outputTokens?.toLocaleString()}
                  </Typography.SmallBody>
                </div>
                {usage.costUsd != null && (
                  <div>
                    <Typography.Caption color="hint">Cost</Typography.Caption>
                    <Typography.SmallBody css={css`font-family: ${theme.typography.fontFamily.mono};`}>
                      ${usage.costUsd.toFixed(4)}
                    </Typography.SmallBody>
                  </div>
                )}
              </div>
            );
          })()}
        </Section>
      )}

      {/* Collapsible: System Prompt */}
      <CollapsibleSection title="System Prompt">
        {data.systemPrompt ? (
          <PromptDisplay content={data.systemPrompt} />
        ) : (
          <Typography.Caption color="hint" italic>No system prompt recorded.</Typography.Caption>
        )}
      </CollapsibleSection>

      {/* Collapsible: User Message */}
      <CollapsibleSection title="User Message">
        <PromptDisplay content={data.userMessage} />
      </CollapsibleSection>

      {/* Collapsible: Raw Output */}
      {rawOutput && (
        <CollapsibleSection title="Raw Output">
          <PromptDisplay content={JSON.stringify(rawOutput, null, 2)} />
        </CollapsibleSection>
      )}
    </div>
  );
}

// ============================================================================
// Section wrapper (for detail view)
// ============================================================================

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <div css={css`margin-bottom: ${theme.spacing[5]};`}>
      <Typography.Caption
        color="hint"
        css={css`
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: ${theme.spacing[2]};
          display: block;
        `}
      >
        {title}
      </Typography.Caption>
      {children}
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

  // Derive view mode and selected tick from URL
  const { viewMode, selectedTick } = useMemo(() => {
    const subPath = location.pathname.replace('/mind/heartbeats', '').replace(/^\//, '');
    if (subPath) {
      const tickNum = parseInt(subPath, 10);
      if (!isNaN(tickNum) && tickNum > 0) {
        return { viewMode: 'detail' as const, selectedTick: tickNum };
      }
    }
    return { viewMode: 'list' as const, selectedTick: null };
  }, [location.pathname]);

  const handleSelect = (tickNumber: number) => {
    navigate(`/mind/heartbeats/${tickNumber}`);
  };

  const handleBack = () => {
    navigate('/mind/heartbeats');
  };

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
          <TickList onSelect={handleSelect} />
        </motion.div>
      ) : selectedTick != null ? (
        <motion.div
          key={`detail-${selectedTick}`}
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -12 }}
          transition={{ duration: 0.15 }}
        >
          <AgentTimeline tickNumber={selectedTick} onBack={handleBack} />
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

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
