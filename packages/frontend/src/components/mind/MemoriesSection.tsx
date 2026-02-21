/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { UserCircle, Notebook, Database, MagnifyingGlass, X, Trash } from '@phosphor-icons/react';
import { trpc } from '../../utils/trpc';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Typography, Spinner } from '../ui';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';

// ============================================================================
// Core Self Section
// ============================================================================

function CoreSelfSection() {
  const theme = useTheme();

  const { data: coreSelf } = trpc.memory.getCoreSelf.useQuery(undefined, {
    retry: false,
  });

  return (
    <section>
      <div css={css`
        display: flex;
        align-items: center;
        gap: ${theme.spacing[2]};
        margin-bottom: ${theme.spacing[4]};
      `}>
        <UserCircle size={20} css={css`color: ${theme.colors.text.secondary};`} />
        <Typography.BodyAlt as="h3" css={css`
          font-weight: ${theme.typography.fontWeight.semibold};
        `}>
          Self-Knowledge
        </Typography.BodyAlt>
      </div>
      <Card variant="elevated" padding="lg">
        {coreSelf?.content ? (
          <>
            <Typography.Body serif italic css={css`
              white-space: pre-wrap;
            `}>
              {coreSelf.content}
            </Typography.Body>
            {coreSelf.updatedAt && (
              <Typography.Caption color="hint" css={css`
                margin-top: ${theme.spacing[3]};
              `}>
                Last updated {formatRelativeTime(coreSelf.updatedAt)}
              </Typography.Caption>
            )}
          </>
        ) : (
          <Typography.Body serif italic color="hint">
            The mind hasn't reflected on itself yet. Self-knowledge builds over time.
          </Typography.Body>
        )}
      </Card>
    </section>
  );
}

// ============================================================================
// Working Memory Section
// ============================================================================

function WorkingMemorySection() {
  const theme = useTheme();

  const { data: workingMemories } = trpc.memory.listWorkingMemories.useQuery(undefined, {
    retry: false,
  });

  return (
    <section>
      <div css={css`
        display: flex;
        align-items: center;
        gap: ${theme.spacing[2]};
        margin-bottom: ${theme.spacing[4]};
      `}>
        <Notebook size={20} css={css`color: ${theme.colors.text.secondary};`} />
        <Typography.BodyAlt as="h3" css={css`
          font-weight: ${theme.typography.fontWeight.semibold};
        `}>
          Contact Notes
        </Typography.BodyAlt>
      </div>

      {!workingMemories || workingMemories.length === 0 ? (
        <Card variant="outlined" padding="md">
          <Typography.SmallBody serif italic color="hint">
            No working memories yet. Notes about contacts will appear here as the mind interacts.
          </Typography.SmallBody>
        </Card>
      ) : (
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
          {workingMemories.map((wm) => (
            <WorkingMemoryCard key={wm.contactId} memory={wm} />
          ))}
        </div>
      )}
    </section>
  );
}

interface WorkingMemoryItem {
  contactId: string;
  contactName?: string | null;
  content?: string | null;
  tier?: string | null;
  updatedAt?: string | null;
}

function WorkingMemoryCard({ memory }: { memory: WorkingMemoryItem }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);

  const content: string = memory.content || '';
  const isLong = content.length > 200;

  return (
    <Card variant="elevated" padding="md" interactive onClick={() => setExpanded(!expanded)}>
      <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]}; margin-bottom: ${theme.spacing[2]};`}>
        <Typography.BodyAlt as="span" css={css`
          font-weight: ${theme.typography.fontWeight.semibold};
        `}>
          {memory.contactName || memory.contactId}
        </Typography.BodyAlt>
        {memory.tier && (
          <Badge>{memory.tier}</Badge>
        )}
      </div>
      {content ? (
        <Typography.SmallBody color="secondary" css={css`
          ${!expanded && isLong ? `
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
            overflow: hidden;
          ` : ''}
          white-space: pre-wrap;
        `}>
          {content}
        </Typography.SmallBody>
      ) : (
        <Typography.SmallBody color="hint">
          No notes yet
        </Typography.SmallBody>
      )}
      {memory.updatedAt && (
        <Typography.Caption color="hint" css={css`
          margin-top: ${theme.spacing[2]};
        `}>
          Updated {formatRelativeTime(memory.updatedAt)}
        </Typography.Caption>
      )}
    </Card>
  );
}

// ============================================================================
// Long-Term Memory Section
// ============================================================================

const MEMORY_TYPE_META: Record<string, { label: string; variant: 'default' | 'success' | 'warning' | 'error' | 'info' }> = {
  fact: { label: 'Fact', variant: 'default' },
  experience: { label: 'Experience', variant: 'info' },
  procedure: { label: 'How-to', variant: 'warning' },
  outcome: { label: 'Outcome', variant: 'success' },
};

function getImportanceLabel(importance: number): string {
  if (importance >= 0.8) return 'Core';
  if (importance >= 0.6) return 'Strong';
  if (importance >= 0.4) return 'Moderate';
  return 'Passing';
}

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 500;

interface MemoryItem {
  id: string;
  content: string;
  importance: number;
  memoryType: string;
  contactId: string | null;
  keywords: string[];
  strength: number;
  createdAt: string;
  lastAccessedAt: string;
  relevance: number | null;
  recency: number | null;
  score: number | null;
}

function LongTermMemorySection() {
  const theme = useTheme();
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedQuery = useDebouncedValue(searchQuery, SEARCH_DEBOUNCE_MS);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const isSearchMode = debouncedQuery.trim().length > 0;

  // Browse mode: infinite scroll, most recent first
  const browseQuery = trpc.memory.browseLongTermMemories.useInfiniteQuery(
    { limit: PAGE_SIZE },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      enabled: !isSearchMode,
      retry: false,
    },
  );

  // Search mode: semantic search (no pagination)
  const searchResult = trpc.memory.browseLongTermMemories.useQuery(
    { query: debouncedQuery.trim(), limit: 30 },
    {
      enabled: isSearchMode,
      retry: false,
    },
  );

  // Flatten browse pages
  const browseItems = useMemo(
    () => browseQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [browseQuery.data],
  );

  // Deduplicate and select active items
  const displayItems: MemoryItem[] = useMemo(() => {
    const items = isSearchMode ? (searchResult.data?.items ?? []) : browseItems;
    const seen = new Set<string>();
    return (items as MemoryItem[]).filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  }, [isSearchMode, searchResult.data, browseItems]);

  // IntersectionObserver for browse mode infinite scroll
  const hasMore = !isSearchMode && (browseQuery.hasNextPage ?? false);
  const isFetchingMore = browseQuery.isFetchingNextPage;

  const fetchMore = useCallback(() => {
    if (browseQuery.hasNextPage && !browseQuery.isFetchingNextPage) {
      browseQuery.fetchNextPage();
    }
  }, [browseQuery]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || isSearchMode) return;

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
  }, [hasMore, isFetchingMore, fetchMore, isSearchMode]);

  const isLoading = isSearchMode ? searchResult.isLoading : browseQuery.isLoading;

  return (
    <section>
      <div css={css`
        display: flex;
        align-items: center;
        gap: ${theme.spacing[2]};
        margin-bottom: ${theme.spacing[4]};
      `}>
        <Database size={20} css={css`color: ${theme.colors.text.secondary};`} />
        <Typography.BodyAlt as="h3" css={css`
          font-weight: ${theme.typography.fontWeight.semibold};
        `}>
          Long-Term Memory
        </Typography.BodyAlt>
      </div>

      {/* Search input */}
      <div css={css`margin-bottom: ${theme.spacing[4]};`}>
        <div css={css`position: relative;`}>
          <MagnifyingGlass
            size={16}
            css={css`
              position: absolute;
              left: ${theme.spacing[3]};
              top: 50%;
              transform: translateY(-50%);
              color: ${theme.colors.text.hint};
              pointer-events: none;
            `}
          />
          <input
            type="text"
            placeholder="Search memories semantically..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            css={css`
              width: 100%;
              padding: ${theme.spacing[2]} ${theme.spacing[3]};
              padding-left: ${theme.spacing[8]};
              padding-right: ${searchQuery ? theme.spacing[8] : theme.spacing[3]};
              background: ${theme.colors.background.paper};
              border: 1px solid ${theme.colors.border.default};
              border-radius: ${theme.borderRadius.default};
              color: ${theme.colors.text.primary};
              font-size: ${theme.typography.fontSize.sm};
              outline: none;

              &:focus { border-color: ${theme.colors.border.focus}; }
              &::placeholder { color: ${theme.colors.text.hint}; }
            `}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              css={css`
                position: absolute;
                right: ${theme.spacing[2]};
                top: 50%;
                transform: translateY(-50%);
                background: none;
                border: none;
                padding: ${theme.spacing[1]};
                cursor: pointer;
                color: ${theme.colors.text.hint};
                display: flex;
                align-items: center;
                &:hover { color: ${theme.colors.text.secondary}; }
              `}
            >
              <X size={14} />
            </button>
          )}
        </div>
        {isSearchMode && (
          <Typography.Caption color="hint" css={css`
            margin-top: ${theme.spacing[1]};
          `}>
            {searchResult.isFetching
              ? 'Searching...'
              : `${displayItems.length} result${displayItems.length !== 1 ? 's' : ''} found`}
          </Typography.Caption>
        )}
      </div>

      {/* Results */}
      {isLoading ? (
        <div css={css`
          display: flex; justify-content: center;
          padding: ${theme.spacing[16]} 0;
        `}>
          <Spinner size={24} />
        </div>
      ) : displayItems.length === 0 ? (
        <Typography.SmallBody serif italic color="hint" css={css`
          text-align: center;
          padding: ${theme.spacing[8]} 0;
        `}>
          {isSearchMode
            ? 'No memories match your search.'
            : 'No long-term memories yet. Knowledge accumulates as the mind processes experiences.'}
        </Typography.SmallBody>
      ) : (
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
          {displayItems.map((mem) => (
            <MemoryCard key={mem.id} memory={mem} showScore={isSearchMode} />
          ))}

          {/* Browse mode: sentinel for infinite scroll */}
          {!isSearchMode && (
            <div ref={sentinelRef}>
              {isFetchingMore && (
                <div css={css`
                  display: flex; align-items: center; justify-content: center;
                  gap: ${theme.spacing[2]}; padding: ${theme.spacing[6]} 0;
                `}>
                  <Spinner size={16} />
                  <Typography.Caption color="hint">Loading more...</Typography.Caption>
                </div>
              )}
            </div>
          )}

          {/* End of list */}
          {!isSearchMode && !hasMore && displayItems.length > 0 && (
            <Typography.Caption as="div" color="disabled" css={css`
              text-align: center;
              padding: ${theme.spacing[4]} 0 ${theme.spacing[2]};
            `}>
              That's everything.
            </Typography.Caption>
          )}
        </div>
      )}
    </section>
  );
}

function MemoryCard({ memory, showScore }: { memory: MemoryItem; showScore: boolean }) {
  const theme = useTheme();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const deleteMutation = trpc.memory.deleteLongTermMemory.useMutation({
    onSuccess: () => setConfirmingDelete(false),
  });

  const typeMeta = MEMORY_TYPE_META[memory.memoryType] ?? { label: memory.memoryType, variant: 'default' as const };
  const impLabel = getImportanceLabel(memory.importance);
  const isCore = memory.importance >= 0.8;

  return (
    <div css={css`
      position: relative;
      border-radius: ${theme.borderRadius.md};
      padding: ${theme.spacing[4]} ${theme.spacing[5]};
      background: ${isCore ? theme.colors.background.paper : theme.colors.background.elevated};
      backdrop-filter: blur(${isCore ? 16 : 8}px);
      -webkit-backdrop-filter: blur(${isCore ? 16 : 8}px);
      border: 1px solid ${theme.colors.border.default};
      transition: transform ${theme.transitions.fast}, box-shadow ${theme.transitions.fast};
      overflow: hidden;

      &:hover {
        transform: translateY(-1px);
        box-shadow: ${theme.shadows.md};
      }
      &:hover .memory-delete-trigger { opacity: 1; }

      /* Rim lighting for core memories */
      ${isCore ? `
        &::before {
          content: '';
          position: absolute;
          inset: -1px;
          border-radius: inherit;
          padding: 1px;
          background: ${theme.colors.rimGradient};
          mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          mask-composite: exclude;
          -webkit-mask-composite: xor;
          pointer-events: none;
        }
      ` : ''}
    `}>
      {/* Delete confirmation overlay */}
      {confirmingDelete && (
        <div css={css`
          position: absolute;
          inset: 0;
          z-index: 2;
          border-radius: inherit;
          background: rgba(250, 249, 244, 0.92);
          display: flex;
          align-items: flex-end;
          justify-content: flex-end;
          padding: ${theme.spacing[3]} ${theme.spacing[4]};
        `}>
          <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
            <button
              onClick={() => setConfirmingDelete(false)}
              disabled={deleteMutation.isPending}
              css={css`
                background: none; border: 1px solid ${theme.colors.border.default};
                padding: ${theme.spacing[1]} ${theme.spacing[3]}; cursor: pointer;
                font-family: ${theme.typography.fontFamily.sans};
                font-size: ${theme.typography.fontSize.xs}; border-radius: ${theme.borderRadius.sm};
                color: ${theme.colors.text.secondary};
                &:hover { background: ${theme.colors.background.paper}; }
                &:disabled { opacity: 0.5; cursor: not-allowed; }
              `}
            >
              Cancel
            </button>
            <button
              onClick={() => deleteMutation.mutate({ id: memory.id })}
              disabled={deleteMutation.isPending}
              css={css`
                background: ${theme.colors.error.main}; border: none;
                padding: ${theme.spacing[1]} ${theme.spacing[3]}; cursor: pointer;
                font-family: ${theme.typography.fontFamily.sans};
                font-size: ${theme.typography.fontSize.xs}; border-radius: ${theme.borderRadius.sm};
                color: white;
                &:hover { opacity: 0.9; }
                &:disabled { opacity: 0.5; cursor: not-allowed; }
              `}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      )}

      {/* Type badge — top of card */}
      <div css={css`
        display: flex; align-items: center;
        gap: ${theme.spacing[2]};
        margin-bottom: ${theme.spacing[2]};
      `}>
        <Badge variant={typeMeta.variant}>
          {typeMeta.label}
        </Badge>

        {showScore && memory.score != null && (
          <Badge variant="info">
            {(memory.score * 100).toFixed(0)}% match
          </Badge>
        )}
      </div>

      {/* Content — always fully visible */}
      <Typography.Body serif css={css`
        line-height: ${theme.typography.lineHeight.relaxed};
      `}>
        {memory.content}
      </Typography.Body>

      {/* Metadata footer */}
      <div css={css`
        display: flex; align-items: center;
        gap: ${theme.spacing[2]};
        margin-top: ${theme.spacing[3]};
      `}>
        <Typography.Tiny as="span" color="disabled" css={css`
          letter-spacing: 0.02em;
        `}>
          {impLabel}
        </Typography.Tiny>

        <Typography.Tiny as="span" color="disabled" css={css`
          opacity: 0.6;
        `}>
          {memory.importance.toFixed(1)}
        </Typography.Tiny>

        <div css={css`
          margin-left: auto;
          display: flex; align-items: center;
          gap: ${theme.spacing[2]};
        `}>
          <Typography.Tiny color="disabled">
            {formatRelativeTime(memory.createdAt)}
          </Typography.Tiny>

          {/* Delete trigger */}
          <button
            className="memory-delete-trigger"
            onClick={() => setConfirmingDelete(true)}
            css={css`
              background: none; border: none; padding: 2px; cursor: pointer;
              color: ${theme.colors.text.disabled}; display: flex; align-items: center;
              opacity: 0;
              transition: opacity ${theme.transitions.fast};
              &:hover { color: ${theme.colors.error.main}; }
            `}
            title="Delete memory"
          >
            <Trash size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Memories Section (composed)
// ============================================================================

export function MemoriesSection() {
  const theme = useTheme();

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[8]};`}>
      <CoreSelfSection />
      <WorkingMemorySection />
      <LongTermMemorySection />
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
