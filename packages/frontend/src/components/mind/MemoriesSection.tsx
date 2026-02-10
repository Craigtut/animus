/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { UserCircle, Notebook, Database, MagnifyingGlass } from '@phosphor-icons/react';
import { trpc } from '../../utils/trpc';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';

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
        <h3 css={css`
          font-size: ${theme.typography.fontSize.base};
          font-weight: ${theme.typography.fontWeight.semibold};
        `}>
          Self-Knowledge
        </h3>
      </div>
      <Card variant="elevated" padding="lg">
        {coreSelf?.content ? (
          <>
            <p css={css`
              font-size: 15px;
              line-height: ${theme.typography.lineHeight.relaxed};
              color: ${theme.colors.text.primary};
              white-space: pre-wrap;
            `}>
              {coreSelf.content}
            </p>
            {coreSelf.updatedAt && (
              <p css={css`
                font-size: ${theme.typography.fontSize.xs};
                color: ${theme.colors.text.hint};
                margin-top: ${theme.spacing[3]};
              `}>
                Last updated {formatRelativeTime(coreSelf.updatedAt)}
              </p>
            )}
          </>
        ) : (
          <p css={css`
            color: ${theme.colors.text.hint};
            font-size: ${theme.typography.fontSize.base};
            line-height: ${theme.typography.lineHeight.relaxed};
          `}>
            The mind hasn't reflected on itself yet. Self-knowledge builds over time.
          </p>
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
        <h3 css={css`
          font-size: ${theme.typography.fontSize.base};
          font-weight: ${theme.typography.fontWeight.semibold};
        `}>
          Contact Notes
        </h3>
      </div>

      {!workingMemories || workingMemories.length === 0 ? (
        <Card variant="outlined" padding="md">
          <p css={css`color: ${theme.colors.text.hint}; font-size: ${theme.typography.fontSize.sm};`}>
            No working memories yet. Notes about contacts will appear here as the mind interacts.
          </p>
        </Card>
      ) : (
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
          {workingMemories.map((wm: any) => (
            <WorkingMemoryCard key={wm.contactId} memory={wm} />
          ))}
        </div>
      )}
    </section>
  );
}

function WorkingMemoryCard({ memory }: { memory: any }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);

  const content: string = memory.content || '';
  const isLong = content.length > 200;

  return (
    <Card variant="elevated" padding="md" interactive onClick={() => setExpanded(!expanded)}>
      <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]}; margin-bottom: ${theme.spacing[2]};`}>
        <span css={css`
          font-size: ${theme.typography.fontSize.base};
          font-weight: ${theme.typography.fontWeight.semibold};
        `}>
          {memory.contactName || memory.contactId}
        </span>
        {memory.tier && (
          <Badge>{memory.tier}</Badge>
        )}
      </div>
      {content ? (
        <p css={css`
          font-size: ${theme.typography.fontSize.sm};
          line-height: ${theme.typography.lineHeight.relaxed};
          color: ${theme.colors.text.secondary};
          ${!expanded && isLong ? `
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
            overflow: hidden;
          ` : ''}
          white-space: pre-wrap;
        `}>
          {content}
        </p>
      ) : (
        <p css={css`font-size: ${theme.typography.fontSize.sm}; color: ${theme.colors.text.hint};`}>
          No notes yet
        </p>
      )}
      {memory.updatedAt && (
        <p css={css`
          font-size: ${theme.typography.fontSize.xs};
          color: ${theme.colors.text.hint};
          margin-top: ${theme.spacing[2]};
        `}>
          Updated {formatRelativeTime(memory.updatedAt)}
        </p>
      )}
    </Card>
  );
}

// ============================================================================
// Long-Term Memory Section
// ============================================================================

const MEMORY_TYPE_BADGE: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  fact: 'default',
  experience: 'info',
  procedure: 'warning',
  outcome: 'success',
};

function LongTermMemorySection() {
  const theme = useTheme();
  const [searchQuery, setSearchQuery] = useState('');

  const { data: memories } = trpc.memory.searchLongTermMemories.useQuery(
    { limit: 20 },
    { retry: false },
  );

  const displayMemories: any[] = memories ?? [];

  return (
    <section>
      <div css={css`
        display: flex;
        align-items: center;
        gap: ${theme.spacing[2]};
        margin-bottom: ${theme.spacing[4]};
      `}>
        <Database size={20} css={css`color: ${theme.colors.text.secondary};`} />
        <h3 css={css`
          font-size: ${theme.typography.fontSize.base};
          font-weight: ${theme.typography.fontWeight.semibold};
        `}>
          Long-Term Memory
        </h3>
      </div>

      {/* Search input */}
      <div css={css`position: relative; margin-bottom: ${theme.spacing[4]};`}>
        <MagnifyingGlass
          size={16}
          css={css`
            position: absolute;
            left: ${theme.spacing[3]};
            top: 50%;
            transform: translateY(-50%);
            color: ${theme.colors.text.hint};
          `}
        />
        <input
          type="text"
          placeholder="Search memories..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          css={css`
            width: 100%;
            padding: ${theme.spacing[2]} ${theme.spacing[3]};
            padding-left: ${theme.spacing[8]};
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
      </div>

      {displayMemories.length === 0 ? (
        <p css={css`
          text-align: center;
          padding: ${theme.spacing[8]} 0;
          color: ${theme.colors.text.hint};
          font-size: ${theme.typography.fontSize.sm};
        `}>
          No long-term memories yet. Knowledge accumulates as the mind processes experiences.
        </p>
      ) : (
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
          {displayMemories.map((mem: any) => (
            <Card key={mem.id} variant="outlined" padding="md">
              <p css={css`
                font-size: 15px;
                line-height: ${theme.typography.lineHeight.relaxed};
                color: ${theme.colors.text.primary};
                margin-bottom: ${theme.spacing[2]};
              `}>
                {mem.content}
              </p>
              <div css={css`
                display: flex;
                align-items: center;
                gap: ${theme.spacing[2]};
                flex-wrap: wrap;
              `}>
                {mem.memoryType && (
                  <Badge variant={MEMORY_TYPE_BADGE[mem.memoryType] ?? 'default'}>
                    {mem.memoryType}
                  </Badge>
                )}
                {mem.importance != null && (
                  <div css={css`display: flex; align-items: center; gap: ${theme.spacing[1]};`}>
                    <div css={css`
                      width: 40px; height: 3px; border-radius: 2px;
                      background: ${theme.colors.background.elevated}; overflow: hidden;
                    `}>
                      <div css={css`
                        width: ${(mem.importance as number) * 100}%;
                        height: 100%; background: ${theme.colors.accent};
                        opacity: 0.5; border-radius: 2px;
                      `} />
                    </div>
                    <span css={css`font-size: 10px; color: ${theme.colors.text.hint};`}>
                      {(mem.importance as number).toFixed(1)}
                    </span>
                  </div>
                )}
                {mem.accessCount != null && (mem.accessCount as number) > 0 && (
                  <span css={css`font-size: ${theme.typography.fontSize.xs}; color: ${theme.colors.text.hint};`}>
                    Accessed {mem.accessCount} time{(mem.accessCount as number) !== 1 ? 's' : ''}
                  </span>
                )}
                {mem.createdAt && (
                  <span css={css`
                    font-size: ${theme.typography.fontSize.xs};
                    color: ${theme.colors.text.disabled};
                    margin-left: auto;
                  `}>
                    {formatRelativeTime(mem.createdAt)}
                  </span>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </section>
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
