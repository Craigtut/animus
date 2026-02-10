/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Star } from '@phosphor-icons/react';
import { trpc } from '../../utils/trpc';
import { Tooltip } from '../ui/Tooltip';
import type { Thought, Experience, TriggerType } from '@animus/shared';

// ============================================================================
// Types
// ============================================================================

type EntryType = 'thought' | 'experience';
type FilterType = 'all' | 'thoughts' | 'experiences';

interface UnifiedEntry {
  id: string;
  type: EntryType;
  content: string;
  importance: number;
  tickNumber: number;
  createdAt: string;
}

// ============================================================================
// Tick Dot
// ============================================================================

function TickDot({ tickNumber }: { tickNumber: number }) {
  const theme = useTheme();

  // Without trigger info, use warm gray. Could be extended when trigger data is available.
  return (
    <Tooltip content={`Tick #${tickNumber}`}>
      <div css={css`
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: ${theme.colors.text.hint};
        flex-shrink: 0;
      `} />
    </Tooltip>
  );
}

// ============================================================================
// Entry Row
// ============================================================================

function EntryRow({ entry }: { entry: UnifiedEntry }) {
  const theme = useTheme();
  const isExperience = entry.type === 'experience';
  const isImportant = entry.importance > 0.7;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      css={css`
        display: flex;
        gap: ${theme.spacing[3]};
        align-items: flex-start;
      `}
    >
      {/* Left column: tick indicator */}
      <div css={css`
        width: 48px;
        display: flex;
        flex-direction: column;
        align-items: center;
        padding-top: ${theme.spacing[1.5]};
        flex-shrink: 0;
      `}>
        <TickDot tickNumber={entry.tickNumber} />
      </div>

      {/* Right column: content */}
      <div css={css`
        flex: 1;
        min-width: 0;
        ${isExperience ? `
          border-left: 2px solid ${theme.colors.accent}20;
          padding-left: ${theme.spacing[3]};
        ` : ''}
      `}>
        {/* Content */}
        <p css={css`
          font-size: 15px;
          line-height: ${theme.typography.lineHeight.relaxed};
          color: ${theme.colors.text.primary};
          ${isExperience ? `font-style: italic;` : ''}
        `}>
          {entry.content}
        </p>

        {/* Metadata row */}
        <div css={css`
          display: flex;
          align-items: center;
          gap: ${theme.spacing[2]};
          margin-top: ${theme.spacing[1]};
        `}>
          <span css={css`
            font-size: 11px;
            color: ${theme.colors.text.hint};
          `}>
            {entry.type === 'thought' ? 'Thought' : 'Experience'}
          </span>
          {isImportant && (
            <Star size={12} weight="fill" css={css`color: ${theme.colors.warning.main}; opacity: 0.7;`} />
          )}
          <span css={css`
            font-size: ${theme.typography.fontSize.xs};
            color: ${theme.colors.text.disabled};
            margin-left: auto;
          `}>
            {formatRelativeTime(entry.createdAt)}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

// ============================================================================
// Thoughts Section
// ============================================================================

export function ThoughtsSection() {
  const theme = useTheme();
  const [filter, setFilter] = useState<FilterType>('all');
  const [importantOnly, setImportantOnly] = useState(false);

  // Fetch thoughts and experiences
  const { data: thoughts } = trpc.heartbeat.getRecentThoughts.useQuery(
    { limit: 50 },
    { retry: false },
  );
  const { data: experiences } = trpc.heartbeat.getRecentExperiences.useQuery(
    { limit: 50 },
    { retry: false },
  );

  // Real-time subscriptions
  const [liveThoughts, setLiveThoughts] = useState<Thought[]>([]);
  const [liveExperiences, setLiveExperiences] = useState<Experience[]>([]);

  trpc.heartbeat.onThoughts.useSubscription(undefined, {
    onData: (thought) => {
      setLiveThoughts((prev) => [thought, ...prev].slice(0, 50));
    },
  });

  trpc.heartbeat.onExperience.useSubscription(undefined, {
    onData: (exp) => {
      setLiveExperiences((prev) => [exp, ...prev].slice(0, 50));
    },
  });

  // Merge and sort entries
  const entries = useMemo(() => {
    const allThoughts = [...liveThoughts, ...(thoughts ?? [])];
    const allExperiences = [...liveExperiences, ...(experiences ?? [])];

    // Deduplicate by id
    const seenIds = new Set<string>();
    const unified: UnifiedEntry[] = [];

    for (const t of allThoughts) {
      if (seenIds.has(t.id)) continue;
      seenIds.add(t.id);
      unified.push({
        id: t.id,
        type: 'thought',
        content: t.content,
        importance: t.importance,
        tickNumber: t.tickNumber,
        createdAt: t.createdAt,
      });
    }

    for (const e of allExperiences) {
      if (seenIds.has(e.id)) continue;
      seenIds.add(e.id);
      unified.push({
        id: e.id,
        type: 'experience',
        content: e.content,
        importance: e.importance,
        tickNumber: e.tickNumber,
        createdAt: e.createdAt,
      });
    }

    // Sort by createdAt descending
    unified.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return unified;
  }, [thoughts, experiences, liveThoughts, liveExperiences]);

  // Apply filters
  const filteredEntries = useMemo(() => {
    let result = entries;
    if (filter === 'thoughts') result = result.filter((e) => e.type === 'thought');
    if (filter === 'experiences') result = result.filter((e) => e.type === 'experience');
    if (importantOnly) result = result.filter((e) => e.importance > 0.7);
    return result;
  }, [entries, filter, importantOnly]);

  return (
    <div>
      {/* Filter row */}
      <div css={css`
        display: flex;
        align-items: center;
        gap: ${theme.spacing[3]};
        margin-bottom: ${theme.spacing[6]};
        flex-wrap: wrap;
      `}>
        {(['all', 'thoughts', 'experiences'] as FilterType[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            css={css`
              font-size: ${theme.typography.fontSize.sm};
              font-weight: ${filter === f
                ? theme.typography.fontWeight.semibold
                : theme.typography.fontWeight.normal};
              color: ${filter === f
                ? theme.colors.text.primary
                : theme.colors.text.secondary};
              padding: ${theme.spacing[1]} ${theme.spacing[2]};
              border-radius: ${theme.borderRadius.sm};
              transition: all ${theme.transitions.micro};
              cursor: pointer;

              &:hover {
                color: ${theme.colors.text.primary};
              }
            `}
          >
            {f === 'all' ? 'All' : f === 'thoughts' ? 'Thoughts' : 'Experiences'}
          </button>
        ))}
        <div css={css`width: 1px; height: 16px; background: ${theme.colors.border.light};`} />
        <button
          onClick={() => setImportantOnly((v) => !v)}
          css={css`
            font-size: ${theme.typography.fontSize.sm};
            font-weight: ${importantOnly
              ? theme.typography.fontWeight.semibold
              : theme.typography.fontWeight.normal};
            color: ${importantOnly
              ? theme.colors.text.primary
              : theme.colors.text.secondary};
            padding: ${theme.spacing[1]} ${theme.spacing[2]};
            border-radius: ${theme.borderRadius.sm};
            transition: all ${theme.transitions.micro};
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: ${theme.spacing[1]};

            &:hover {
              color: ${theme.colors.text.primary};
            }
          `}
        >
          <Star size={12} weight={importantOnly ? 'fill' : 'regular'} />
          Important only
        </button>
      </div>

      {/* Entry list */}
      {filteredEntries.length === 0 ? (
        <div css={css`
          text-align: center;
          padding: ${theme.spacing[16]} 0;
          color: ${theme.colors.text.hint};
        `}>
          {entries.length === 0
            ? "No thoughts yet. The mind hasn't started thinking."
            : 'No entries match the current filter.'}
        </div>
      ) : (
        <div css={css`
          display: flex;
          flex-direction: column;
          gap: ${theme.spacing[4]};
        `}>
          <AnimatePresence>
            {filteredEntries.map((entry) => (
              <EntryRow key={entry.id} entry={entry} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
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
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(isoString).toLocaleDateString();
}
