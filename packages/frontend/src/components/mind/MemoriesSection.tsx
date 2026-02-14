/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { UserCircle, Notebook, Database, MagnifyingGlass } from '@phosphor-icons/react';
import { trpc } from '../../utils/trpc';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Typography } from '../ui';

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
        <Typography.BodyAlt as="h3" css={css`
          font-weight: ${theme.typography.fontWeight.semibold};
        `}>
          Long-Term Memory
        </Typography.BodyAlt>
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
        <Typography.SmallBody serif italic color="hint" css={css`
          text-align: center;
          padding: ${theme.spacing[8]} 0;
        `}>
          No long-term memories yet. Knowledge accumulates as the mind processes experiences.
        </Typography.SmallBody>
      ) : (
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
          {displayMemories.map((mem: any) => (
            <Card key={mem.id} variant="outlined" padding="md">
              <Typography.Body serif css={css`
                margin-bottom: ${theme.spacing[2]};
              `}>
                {mem.content}
              </Typography.Body>
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
                    <Typography.Caption color="hint">
                      {(mem.importance as number).toFixed(1)}
                    </Typography.Caption>
                  </div>
                )}
                {mem.accessCount != null && (mem.accessCount as number) > 0 && (
                  <Typography.Caption color="hint">
                    Accessed {mem.accessCount} time{(mem.accessCount as number) !== 1 ? 's' : ''}
                  </Typography.Caption>
                )}
                {mem.createdAt && (
                  <Typography.Caption color="disabled" css={css`
                    margin-left: auto;
                  `}>
                    {formatRelativeTime(mem.createdAt)}
                  </Typography.Caption>
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
