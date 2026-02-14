/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Star } from '@phosphor-icons/react';
import { trpc } from '../../utils/trpc';
import { Tooltip } from '../ui/Tooltip';
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

const PAGE_SIZE = 20;

// ============================================================================
// Tick Dot
// ============================================================================

function TickDot({ tickNumber }: { tickNumber: number }) {
  const theme = useTheme();

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
        <Typography.Body
          serif
          italic={isExperience}
          color="primary"
          css={css`
            line-height: ${theme.typography.lineHeight.relaxed};
          `}
        >
          {entry.content}
        </Typography.Body>

        <div css={css`
          display: flex;
          align-items: center;
          gap: ${theme.spacing[2]};
          margin-top: ${theme.spacing[1]};
        `}>
          <Typography.Caption color="hint">
            {entry.type === 'thought' ? 'Thought' : 'Experience'}
          </Typography.Caption>
          {isImportant && (
            <Star size={12} weight="fill" css={css`color: ${theme.colors.warning.main}; opacity: 0.7;`} />
          )}
          <Typography.Caption color="disabled" css={css`margin-left: auto;`}>
            {formatRelativeTime(entry.createdAt)}
          </Typography.Caption>
        </div>
      </div>
    </motion.div>
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
      padding: ${theme.spacing[6]} 0;
    `}>
      <Spinner size={16} />
      <Typography.Caption color="hint">Loading more...</Typography.Caption>
    </div>
  );
}

// ============================================================================
// Thoughts Section
// ============================================================================

export function ThoughtsSection() {
  const theme = useTheme();
  const [filter, setFilter] = useState<FilterType>('all');
  const [importantOnly, setImportantOnly] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

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

  // Merge live + paginated, deduplicate, sort
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

    unified.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return unified;
  }, [pagedThoughts, pagedExperiences, liveThoughts, liveExperiences]);

  // Apply type filter
  const filteredEntries = useMemo(() => {
    if (filter === 'thoughts') return entries.filter((e) => e.type === 'thought');
    if (filter === 'experiences') return entries.filter((e) => e.type === 'experience');
    return entries;
  }, [entries, filter]);

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
      // "all" — fetch next page from whichever still has data
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
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !isFetchingMore) {
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
      {/* Filter row */}
      <div css={css`
        display: flex;
        align-items: center;
        justify-content: center;
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
      {isInitialLoading ? (
        <div css={css`
          display: flex;
          justify-content: center;
          padding: ${theme.spacing[16]} 0;
        `}>
          <Spinner size={24} />
        </div>
      ) : filteredEntries.length === 0 ? (
        <Typography.Body
          as="div"
          serif
          italic
          color="hint"
          css={css`
            text-align: center;
            padding: ${theme.spacing[16]} 0;
          `}
        >
          {entries.length === 0
            ? "No thoughts yet. The mind hasn't started thinking."
            : 'No entries match the current filter.'}
        </Typography.Body>
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

          {/* Sentinel + loading indicator */}
          <div ref={sentinelRef}>
            {isFetchingMore && <LoadingMore />}
          </div>

          {/* End of list indicator */}
          {!hasMore && filteredEntries.length > 0 && (
            <Typography.Caption
              as="div"
              color="disabled"
              css={css`
                text-align: center;
                padding: ${theme.spacing[4]} 0 ${theme.spacing[2]};
              `}
            >
              That's everything.
            </Typography.Caption>
          )}
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
