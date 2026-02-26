/** @jsxImportSource @emotion/react */
import { css, useTheme, keyframes } from '@emotion/react';
import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Star, FunnelSimple } from '@phosphor-icons/react';
import { trpc } from '../../utils/trpc';
import { Spinner, Typography } from '../ui';
import { useHeartbeatStore } from '../../store/heartbeat-store';

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

interface Moment {
  tickNumber: number;
  timestamp: string;
  experiences: UnifiedEntry[];
  thoughts: UnifiedEntry[];
}

const PAGE_SIZE = 20;

// ============================================================================
// Live timestamp hook — forces re-render every 60s so relative times stay fresh
// ============================================================================

function useMinuteTick(): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  return tick;
}

// ============================================================================
// Breathing animation for the pulse point
// ============================================================================

const breathe = keyframes`
  0%, 100% { transform: scale(1); opacity: 0.4; }
  50% { transform: scale(1.3); opacity: 0.7; }
`;

// ============================================================================
// Breathing dot for empty state
// ============================================================================

const breatheSlow = keyframes`
  0%, 100% { transform: scale(1); opacity: 0.25; }
  50% { transform: scale(1.15); opacity: 0.5; }
`;

// ============================================================================
// Pulse Point — the heartbeat marker for each moment
// ============================================================================

function PulsePoint({ isHovered }: { isHovered: boolean }) {
  const theme = useTheme();

  return (
    <motion.div
      animate={{
        scale: isHovered ? 1.3 : 1,
        opacity: isHovered ? 0.7 : 0.35,
      }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      css={css`
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: ${theme.colors.accent};
        flex-shrink: 0;
        ${isHovered ? `animation: ${breathe} 3s ease-in-out infinite;` : ''}
      `}
    />
  );
}

// ============================================================================
// Thread Line — connects entries within a moment
// ============================================================================

function ThreadLine() {
  const theme = useTheme();

  return (
    <div css={css`
      width: 1px;
      flex: 1;
      min-height: 8px;
      background: ${theme.colors.border.default};
      margin: ${theme.spacing[1]} 0;
    `} />
  );
}

// ============================================================================
// Experience Entry — the prominent lead of each moment
// ============================================================================

function ExperienceEntry({ entry }: { entry: UnifiedEntry }) {
  const theme = useTheme();
  const isImportant = entry.importance > 0.7;

  return (
    <div css={css`
      padding: ${theme.spacing[1]} 0;
      ${isImportant ? `
        background: ${theme.mode === 'light'
          ? 'linear-gradient(135deg, rgba(217, 119, 6, 0.03) 0%, transparent 80%)'
          : 'linear-gradient(135deg, rgba(245, 158, 11, 0.04) 0%, transparent 80%)'};
        border-radius: ${theme.borderRadius.sm};
        padding: ${theme.spacing[2]} ${theme.spacing[3]};
        margin: -${theme.spacing[1]} -${theme.spacing[3]};
      ` : ''}
    `}>
      <Typography.Body
        serif
        color="primary"
        css={css`
          line-height: ${theme.typography.lineHeight.relaxed};
          font-size: ${theme.typography.fontSize.lg};
        `}
      >
        {entry.content}
      </Typography.Body>
    </div>
  );
}

// ============================================================================
// Thought Entry — the quieter reflections beneath
// ============================================================================

function ThoughtEntry({ entry, showLabel }: { entry: UnifiedEntry; showLabel?: boolean }) {
  const theme = useTheme();
  const isImportant = entry.importance > 0.7;

  return (
    <div css={css`
      padding: ${theme.spacing[0.5]} 0;
      ${isImportant ? `
        background: ${theme.mode === 'light'
          ? 'linear-gradient(135deg, rgba(217, 119, 6, 0.03) 0%, transparent 80%)'
          : 'linear-gradient(135deg, rgba(245, 158, 11, 0.04) 0%, transparent 80%)'};
        border-radius: ${theme.borderRadius.sm};
        padding: ${theme.spacing[1.5]} ${theme.spacing[3]};
        margin: -${theme.spacing[0.5]} -${theme.spacing[3]};
      ` : ''}
    `}>
      {showLabel && (
        <Typography.Tiny
          color="disabled"
          css={css`
            text-transform: uppercase;
            letter-spacing: 0.06em;
            margin-bottom: ${theme.spacing[1]};
            display: block;
          `}
        >
          Thought
        </Typography.Tiny>
      )}
      <Typography.SmallBody
        serif
        italic
        color="secondary"
        css={css`
          line-height: ${theme.typography.lineHeight.relaxed};
        `}
      >
        {entry.content}
      </Typography.SmallBody>
    </div>
  );
}

// ============================================================================
// Moment Block — a grouped heartbeat event
// ============================================================================

function MomentBlock({ moment, index }: { moment: Moment; index: number }) {
  const theme = useTheme();
  const [isHovered, setIsHovered] = useState(false);

  const allEntries = [...moment.experiences, ...moment.thoughts];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.35,
        ease: [0.25, 0.1, 0.25, 1],
        delay: Math.min(index * 0.06, 0.3),
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      css={css`
        display: flex;
        gap: ${theme.spacing[4]};
        align-items: stretch;
        padding: ${theme.spacing[3]} 0;
      `}
    >
      {/* Left column: pulse point + thread */}
      <div css={css`
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 6px;
        flex-shrink: 0;
        padding-top: ${theme.spacing[0.5]};
      `}>
        <PulsePoint isHovered={isHovered} />
        {allEntries.length > 1 && <ThreadLine />}
      </div>

      {/* Right column: content */}
      <div css={css`
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: ${theme.spacing[2]};
      `}>
        {/* Atmospheric timestamp — becomes more visible on hover */}
        <motion.div
          animate={{ opacity: isHovered ? 0.7 : 0.35 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
        >
          <Typography.Caption
            color="primary"
            css={css`
              letter-spacing: 0.02em;
            `}
          >
            {formatAtmosphericTime(moment.timestamp)}
          </Typography.Caption>
        </motion.div>

        {/* Experiences first — the prominent anchor */}
        {moment.experiences.map((exp) => (
          <ExperienceEntry key={exp.id} entry={exp} />
        ))}

        {/* Thoughts below — quieter reflections */}
        {moment.thoughts.length > 0 && (
          <div css={css`
            display: flex;
            flex-direction: column;
            gap: ${theme.spacing[1]};
            ${moment.experiences.length > 0 ? `
              padding-top: ${theme.spacing[1]};
            ` : ''}
          `}>
            {moment.thoughts.map((thought, i) => (
              <ThoughtEntry key={thought.id} entry={thought} showLabel={i === 0} />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ============================================================================
// Filter Bar — subtle, receding controls
// ============================================================================

function FilterBar({
  filter,
  setFilter,
  importantOnly,
  setImportantOnly,
}: {
  filter: FilterType;
  setFilter: (f: FilterType) => void;
  importantOnly: boolean;
  setImportantOnly: (v: boolean) => void;
}) {
  const theme = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  const hasActiveFilter = filter !== 'all' || importantOnly;

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  return (
    <div
      ref={filterRef}
      css={css`
        display: flex;
        align-items: center;
        justify-content: flex-end;
        margin-bottom: ${theme.spacing[4]};
        position: relative;
      `}
    >
      <button
        onClick={() => setIsOpen((o) => !o)}
        css={css`
          display: flex;
          align-items: center;
          gap: ${theme.spacing[1.5]};
          padding: ${theme.spacing[1.5]} ${theme.spacing[3]};
          border-radius: ${theme.borderRadius.default};
          font-size: ${theme.typography.fontSize.xs};
          color: ${hasActiveFilter ? theme.colors.text.primary : theme.colors.text.hint};
          border: 1px solid ${theme.colors.border.default};
          cursor: pointer;
          transition: all ${theme.transitions.fast};

          &:hover {
            color: ${theme.colors.text.primary};
            border-color: ${theme.colors.border.focus};
          }
        `}
      >
        <FunnelSimple size={18} weight={hasActiveFilter ? 'fill' : 'regular'} />
        {hasActiveFilter ? (
          <span>{filter !== 'all' ? (filter === 'thoughts' ? 'Thoughts' : 'Experiences') : ''}{importantOnly ? (filter !== 'all' ? ' + important' : 'Important') : ''}</span>
        ) : (
          <span>Filter</span>
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.12, ease: 'easeOut' }}
            css={css`
              position: absolute;
              top: calc(100% + ${theme.spacing[1]});
              right: 0;
              display: flex;
              flex-direction: column;
              gap: ${theme.spacing[0.5]};
              padding: ${theme.spacing[2]};
              border-radius: ${theme.borderRadius.md};
              background: ${theme.mode === 'light'
                ? 'rgba(250, 249, 244, 0.95)'
                : 'rgba(28, 26, 24, 0.95)'};
              backdrop-filter: blur(16px);
              -webkit-backdrop-filter: blur(16px);
              border: 1px solid ${theme.colors.border.light};
              min-width: 140px;
              z-index: ${theme.zIndex.dropdown};
            `}
          >
            {(['all', 'thoughts', 'experiences'] as FilterType[]).map((f) => (
              <button
                key={f}
                onClick={() => { setFilter(f); setIsOpen(false); }}
                css={css`
                  font-size: ${theme.typography.fontSize.xs};
                  font-weight: ${filter === f
                    ? theme.typography.fontWeight.semibold
                    : theme.typography.fontWeight.normal};
                  color: ${filter === f
                    ? theme.colors.text.primary
                    : theme.colors.text.secondary};
                  padding: ${theme.spacing[1.5]} ${theme.spacing[2]};
                  border-radius: ${theme.borderRadius.sm};
                  text-align: left;
                  cursor: pointer;
                  transition: all ${theme.transitions.micro};

                  &:hover {
                    color: ${theme.colors.text.primary};
                    background: ${theme.colors.background.elevated};
                  }
                `}
              >
                {f === 'all' ? 'All' : f === 'thoughts' ? 'Thoughts only' : 'Experiences only'}
              </button>
            ))}

            <div css={css`
              height: 1px;
              background: ${theme.colors.border.light};
              margin: ${theme.spacing[1]} 0;
            `} />

            <button
              onClick={() => { setImportantOnly(!importantOnly); setIsOpen(false); }}
              css={css`
                font-size: ${theme.typography.fontSize.xs};
                font-weight: ${importantOnly
                  ? theme.typography.fontWeight.semibold
                  : theme.typography.fontWeight.normal};
                color: ${importantOnly
                  ? theme.colors.text.primary
                  : theme.colors.text.secondary};
                padding: ${theme.spacing[1.5]} ${theme.spacing[2]};
                border-radius: ${theme.borderRadius.sm};
                text-align: left;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: ${theme.spacing[1.5]};
                transition: all ${theme.transitions.micro};

                &:hover {
                  color: ${theme.colors.text.primary};
                  background: ${theme.colors.background.elevated};
                }
              `}
            >
              <Star size={11} weight={importantOnly ? 'fill' : 'regular'} />
              Important only
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// Empty State
// ============================================================================

function EmptyState({ hasEntries }: { hasEntries: boolean }) {
  const theme = useTheme();

  return (
    <div css={css`
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: ${theme.spacing[24]} 0 ${theme.spacing[16]};
      gap: ${theme.spacing[6]};
    `}>
      <div css={css`
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: ${theme.colors.accent};
        animation: ${breatheSlow} 5s ease-in-out infinite;
      `} />

      <Typography.Body
        as="div"
        serif
        italic
        color="hint"
        css={css`
          text-align: center;
          max-width: 280px;
        `}
      >
        {hasEntries
          ? 'Nothing here matches the current filter.'
          : "Quiet. The mind hasn't begun to stir."}
      </Typography.Body>
    </div>
  );
}

// ============================================================================
// Loading Indicator
// ============================================================================

function LoadingMore() {
  const theme = useTheme();
  return (
    <div css={css`
      display: flex;
      align-items: center;
      justify-content: center;
      gap: ${theme.spacing[2]};
      padding: ${theme.spacing[8]} 0;
    `}>
      <Spinner size={14} />
      <Typography.Caption color="disabled">Loading more...</Typography.Caption>
    </div>
  );
}

// ============================================================================
// Thoughts Section (Journal)
// ============================================================================

export function ThoughtsSection() {
  const theme = useTheme();
  const [filter, setFilter] = useState<FilterType>('all');
  const [importantOnly, setImportantOnly] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Re-render every 60s so relative timestamps stay live
  useMinuteTick();

  // Paginated queries
  const thoughtsQuery = trpc.heartbeat.getThoughtsPaginated.useInfiniteQuery(
    { limit: PAGE_SIZE, importantOnly: importantOnly || undefined },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      retry: false,
    },
  );

  const experiencesQuery = trpc.heartbeat.getExperiencesPaginated.useInfiniteQuery(
    { limit: PAGE_SIZE, importantOnly: importantOnly || undefined },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      retry: false,
    },
  );

  // Real-time data from centralized subscription manager
  const liveThoughts = useHeartbeatStore(s => s.recentThoughts);
  const liveExperiences = useHeartbeatStore(s => s.recentExperiences);

  // Flatten paginated results
  const pagedThoughts = useMemo(
    () => thoughtsQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [thoughtsQuery.data],
  );
  const pagedExperiences = useMemo(
    () => experiencesQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [experiencesQuery.data],
  );

  // Merge live + paginated, deduplicate, and build unified entries
  const entries = useMemo(() => {
    const allThoughts = [...liveThoughts, ...pagedThoughts];
    const allExperiences = [...liveExperiences, ...pagedExperiences];

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

    return unified;
  }, [pagedThoughts, pagedExperiences, liveThoughts, liveExperiences]);

  // Apply type filter
  const filteredEntries = useMemo(() => {
    if (filter === 'thoughts') return entries.filter((e) => e.type === 'thought');
    if (filter === 'experiences') return entries.filter((e) => e.type === 'experience');
    return entries;
  }, [entries, filter]);

  // Group filtered entries into moments by tickNumber
  const moments = useMemo(() => {
    const grouped = new Map<number, UnifiedEntry[]>();

    for (const entry of filteredEntries) {
      const existing = grouped.get(entry.tickNumber);
      if (existing) {
        existing.push(entry);
      } else {
        grouped.set(entry.tickNumber, [entry]);
      }
    }

    const result: Moment[] = [];
    for (const [tickNumber, items] of grouped) {
      // Sort within each group: experiences first, then by createdAt
      const experiences = items
        .filter((e) => e.type === 'experience')
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      const thoughts = items
        .filter((e) => e.type === 'thought')
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      // Use the earliest timestamp as the moment's time
      const allTimestamps = items.map((e) => new Date(e.createdAt).getTime());
      const timestamp = new Date(Math.min(...allTimestamps)).toISOString();

      result.push({ tickNumber, timestamp, experiences, thoughts });
    }

    // Sort moments by timestamp, newest first
    result.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return result;
  }, [filteredEntries]);

  // Determine loading / hasMore state based on active filter
  const isFetchingMore = (filter === 'thoughts'
    ? thoughtsQuery.isFetchingNextPage
    : filter === 'experiences'
      ? experiencesQuery.isFetchingNextPage
      : thoughtsQuery.isFetchingNextPage || experiencesQuery.isFetchingNextPage
  );

  const hasMore = (filter === 'thoughts'
    ? thoughtsQuery.hasNextPage
    : filter === 'experiences'
      ? experiencesQuery.hasNextPage
      : (thoughtsQuery.hasNextPage || experiencesQuery.hasNextPage)
  );

  const fetchMore = useCallback(() => {
    if (filter === 'thoughts') {
      if (thoughtsQuery.hasNextPage && !thoughtsQuery.isFetchingNextPage) {
        thoughtsQuery.fetchNextPage();
      }
    } else if (filter === 'experiences') {
      if (experiencesQuery.hasNextPage && !experiencesQuery.isFetchingNextPage) {
        experiencesQuery.fetchNextPage();
      }
    } else {
      if (thoughtsQuery.hasNextPage && !thoughtsQuery.isFetchingNextPage) {
        thoughtsQuery.fetchNextPage();
      }
      if (experiencesQuery.hasNextPage && !experiencesQuery.isFetchingNextPage) {
        experiencesQuery.fetchNextPage();
      }
    }
  }, [filter, thoughtsQuery, experiencesQuery]);

  // IntersectionObserver on sentinel element
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (observedEntries) => {
        if (observedEntries[0]?.isIntersecting && hasMore && !isFetchingMore) {
          fetchMore();
        }
      },
      { rootMargin: '200px' },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, isFetchingMore, fetchMore]);

  const isInitialLoading = thoughtsQuery.isLoading || experiencesQuery.isLoading;

  return (
    <div>
      <FilterBar
        filter={filter}
        setFilter={setFilter}
        importantOnly={importantOnly}
        setImportantOnly={setImportantOnly}
      />

      {isInitialLoading ? (
        <div css={css`
          display: flex;
          justify-content: center;
          padding: ${theme.spacing[16]} 0;
        `}>
          <Spinner size={20} />
        </div>
      ) : moments.length === 0 ? (
        <EmptyState hasEntries={entries.length > 0} />
      ) : (
        <div css={css`
          display: flex;
          flex-direction: column;
          gap: ${theme.spacing[8]};
        `}>
          {moments.map((moment, i) => (
            <MomentBlock
              key={moment.tickNumber}
              moment={moment}
              index={i}
            />
          ))}

          {/* Sentinel + loading indicator */}
          <div ref={sentinelRef}>
            {isFetchingMore && <LoadingMore />}
          </div>

          {/* End of list — quiet finish */}
          {!hasMore && moments.length > 0 && (
            <div css={css`
              display: flex;
              justify-content: center;
              padding: ${theme.spacing[4]} 0 ${theme.spacing[2]};
            `}>
              <div css={css`
                width: 4px;
                height: 4px;
                border-radius: 50%;
                background: ${theme.colors.text.disabled};
              `} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Formats a timestamp into atmospheric, human-feeling language.
 * Instead of "3 min ago" we say "just now". Instead of "2d ago" we say
 * "two days ago". The goal is language that feels like memory, not data.
 */
function formatAtmosphericTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;

  if (diffMs < 60_000) return 'just now';
  if (diffMs < 120_000) return 'a moment ago';

  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins} minutes ago`;

  const hours = Math.floor(mins / 60);
  if (hours === 1) return 'an hour ago';
  if (hours < 6) return `${hours} hours ago`;

  // Check if same day
  const nowDate = new Date(now);
  const thenDate = new Date(then);

  if (
    nowDate.getFullYear() === thenDate.getFullYear() &&
    nowDate.getMonth() === thenDate.getMonth() &&
    nowDate.getDate() === thenDate.getDate()
  ) {
    if (hours < 12) return 'earlier today';
    return 'this morning';
  }

  // Yesterday
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (
    yesterday.getFullYear() === thenDate.getFullYear() &&
    yesterday.getMonth() === thenDate.getMonth() &&
    yesterday.getDate() === thenDate.getDate()
  ) {
    const thenHour = thenDate.getHours();
    if (thenHour < 12) return 'yesterday morning';
    if (thenHour < 17) return 'yesterday afternoon';
    return 'yesterday evening';
  }

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';

  return thenDate.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
}
