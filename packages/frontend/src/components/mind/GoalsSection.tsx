/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Target, CheckCircle, Pause, CaretDown, CaretUp } from '@phosphor-icons/react';
import { trpc } from '../../utils/trpc';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Typography } from '../ui';
import { emotionColors } from '../../styles/theme';

// ============================================================================
// Goal Status Helpers
// ============================================================================

const STATUS_BADGE: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  proposed: 'info',
  active: 'success',
  paused: 'warning',
  completed: 'success',
  abandoned: 'default',
};

const ORIGIN_LABELS: Record<string, string> = {
  user_directed: 'User-directed',
  ai_internal: 'AI-internal',
  collaborative: 'Collaborative',
};

// ============================================================================
// Goal Card
// ============================================================================

interface GoalItem {
  id: string;
  title: string;
  status: string;
  origin?: string | null;
  linkedEmotion?: string | null;
  currentSalience?: number | null;
  description?: string | null;
  motivation?: string | null;
  createdAt: string;
  lastProgressAt?: string | null;
  completedAt?: string | null;
}

function GoalCard({ goal }: { goal: GoalItem }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);

  const { data: plan } = trpc.goals.getActivePlan.useQuery(
    { goalId: goal.id },
    { retry: false, enabled: expanded },
  );

  return (
    <Card variant="elevated" padding="md" interactive onClick={() => setExpanded(!expanded)}>
      {/* Header */}
      <div css={css`display: flex; align-items: flex-start; justify-content: space-between; gap: ${theme.spacing[2]};`}>
        <div css={css`flex: 1; min-width: 0;`}>
          <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]}; margin-bottom: ${theme.spacing[1]};`}>
            <Typography.Body as="h4" serif css={css`
              font-size: ${theme.typography.fontSize.lg};
              font-weight: ${theme.typography.fontWeight.semibold};
            `}>
              {goal.title}
            </Typography.Body>
            <Badge variant={STATUS_BADGE[goal.status] ?? 'default'}>
              {goal.status}
            </Badge>
          </div>
          <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
            {goal.origin && (
              <Typography.Caption color="hint">
                {ORIGIN_LABELS[goal.origin] ?? goal.origin}
              </Typography.Caption>
            )}
            {goal.linkedEmotion && (
              <Typography.Caption color="hint">
                {goal.linkedEmotion}
              </Typography.Caption>
            )}
          </div>
        </div>
        {expanded ? <CaretUp size={16} css={css`color: ${theme.colors.text.hint}; flex-shrink: 0;`} />
                   : <CaretDown size={16} css={css`color: ${theme.colors.text.hint}; flex-shrink: 0;`} />}
      </div>

      {/* Salience bar */}
      {goal.currentSalience != null && (
        <div css={css`margin-top: ${theme.spacing[3]};`}>
          <div css={css`
            display: flex; align-items: center; justify-content: space-between;
            margin-bottom: ${theme.spacing[1]};
          `}>
            <Typography.Caption color="hint">Salience</Typography.Caption>
            <Typography.Caption color="hint">
              {(goal.currentSalience as number).toFixed(2)}
            </Typography.Caption>
          </div>
          <div css={css`
            width: 100%; height: 4px; border-radius: 2px;
            background: ${theme.colors.background.elevated};
          `}>
            <div css={css`
              height: 100%; width: ${(goal.currentSalience as number) * 100}%;
              border-radius: 2px; background: ${theme.colors.accent};
              opacity: 0.5; transition: width ${theme.transitions.normal};
            `} />
          </div>
        </div>
      )}

      {/* Expanded: description + plan */}
      <AnimatePresence>
        {expanded && (
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
              {goal.description && (
                <Typography.SmallBody color="secondary" css={css`
                  margin-bottom: ${theme.spacing[3]};
                `}>
                  {goal.description}
                </Typography.SmallBody>
              )}

              {goal.motivation && (
                <Typography.SmallBody serif italic color="hint" css={css`
                  margin-bottom: ${theme.spacing[3]};
                `}>
                  Motivation: {goal.motivation}
                </Typography.SmallBody>
              )}

              {/* Active plan */}
              {plan && (
                <div css={css`margin-top: ${theme.spacing[2]};`}>
                  <Typography.Caption color="hint" css={css`
                    display: block;
                    margin-bottom: ${theme.spacing[2]};
                  `}>
                    Plan v{plan.version}
                  </Typography.Caption>
                  <Typography.SmallBody color="secondary" css={css`
                    margin-bottom: ${theme.spacing[3]};
                  `}>
                    {plan.strategy}
                  </Typography.SmallBody>

                  {/* Milestones */}
                  {plan.milestones && plan.milestones.length > 0 && (
                    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
                      {plan.milestones.map((ms, i) => (
                        <div key={i} css={css`
                          display: flex; align-items: center; gap: ${theme.spacing[2]};
                        `}>
                          {ms.status === 'completed' ? (
                            <CheckCircle size={14} weight="fill" css={css`color: ${theme.colors.success.main};`} />
                          ) : ms.status === 'in_progress' ? (
                            <div css={css`
                              width: 14px; height: 14px; border-radius: 50%;
                              border: 2px solid ${theme.colors.accent};
                              animation: ms-pulse 2000ms ease-in-out infinite;
                              @keyframes ms-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
                            `} />
                          ) : (
                            <div css={css`
                              width: 14px; height: 14px; border-radius: 50%;
                              border: 1.5px solid ${theme.colors.border.default};
                            `} />
                          )}
                          <Typography.SmallBody as="span" css={css`
                            color: ${ms.status === 'completed' ? theme.colors.text.hint : theme.colors.text.primary};
                            ${ms.status === 'completed' ? 'text-decoration: line-through;' : ''}
                            ${ms.status === 'skipped' ? `color: ${theme.colors.text.disabled};` : ''}
                          `}>
                            {ms.title}
                          </Typography.SmallBody>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Timestamps */}
              <div css={css`
                margin-top: ${theme.spacing[3]};
                display: flex;
                gap: ${theme.spacing[3]};
              `}>
                <Typography.Caption color="disabled">Created {formatRelativeTime(goal.createdAt)}</Typography.Caption>
                {goal.lastProgressAt && <Typography.Caption color="disabled">Last progress {formatRelativeTime(goal.lastProgressAt)}</Typography.Caption>}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

// ============================================================================
// Seed Card
// ============================================================================

interface SeedItem {
  id: string;
  content: string;
  strength: number;
  linkedEmotion?: string | null;
  reinforcementCount: number;
}

function SeedCard({ seed }: { seed: SeedItem }) {
  const theme = useTheme();
  const mode = theme.mode;
  const colors = emotionColors[mode];
  const linkedColor = seed.linkedEmotion
    ? colors[seed.linkedEmotion as keyof typeof colors]
    : undefined;

  return (
    <Card variant="outlined" padding="sm">
      <Typography.SmallBody serif css={css`
        margin-bottom: ${theme.spacing[2]};
      `}>
        {seed.content}
      </Typography.SmallBody>
      <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
        {/* Strength bar (toward 0.7 threshold) */}
        <div css={css`
          flex: 1; height: 3px; border-radius: 2px;
          background: ${theme.colors.background.elevated};
        `}>
          <div css={css`
            height: 100%;
            width: ${Math.min(((seed.strength as number) / 0.7) * 100, 100)}%;
            border-radius: 2px;
            background: ${linkedColor ?? theme.colors.accent};
            opacity: 0.6;
            transition: width ${theme.transitions.normal};
          `} />
        </div>
        <Typography.Caption color="hint" css={css`white-space: nowrap;`}>
          {(seed.strength as number).toFixed(2)} / 0.70
        </Typography.Caption>
        {seed.linkedEmotion && (
          <Typography.Caption color="hint" css={css`text-transform: capitalize;`}>
            {seed.linkedEmotion}
          </Typography.Caption>
        )}
        <Typography.Caption color="disabled">
          x{seed.reinforcementCount}
        </Typography.Caption>
      </div>
    </Card>
  );
}

// ============================================================================
// Goals Section
// ============================================================================

export function GoalsSection() {
  const theme = useTheme();
  const [showHistory, setShowHistory] = useState(false);
  const [showSeeds, setShowSeeds] = useState(false);

  // Fetch goals by status
  const { data: activeGoals } = trpc.goals.getGoals.useQuery(
    { status: 'active' },
    { retry: false },
  );
  const { data: proposedGoals } = trpc.goals.getGoals.useQuery(
    { status: 'proposed' },
    { retry: false },
  );
  const { data: seeds } = trpc.goals.getSeeds.useQuery(undefined, { retry: false });
  const { data: completedGoals } = trpc.goals.getGoals.useQuery(
    { status: 'completed' },
    { retry: false, enabled: showHistory },
  );

  const hasActiveGoals = activeGoals && activeGoals.length > 0;
  const hasProposed = proposedGoals && proposedGoals.length > 0;
  const hasSeeds = seeds && seeds.length > 0;
  const hasCompleted = completedGoals && completedGoals.length > 0;
  const isEmpty = !hasActiveGoals && !hasProposed && !hasSeeds;

  if (isEmpty) {
    return (
      <div css={css`
        text-align: center;
        padding: ${theme.spacing[16]} 0;
      `}>
        <Target size={40} weight="light" css={css`color: ${theme.colors.text.hint}; margin: 0 auto ${theme.spacing[4]};`} />
        <Typography.Body serif italic color="hint" css={css`
          max-width: 360px;
          margin: 0 auto;
        `}>
          No goals yet. Goals emerge from seeds as the mind develops interests and receives direction.
        </Typography.Body>
      </div>
    );
  }

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[8]};`}>
      {/* Active Goals */}
      {hasActiveGoals && (
        <section>
          <Typography.BodyAlt as="h3" css={css`
            font-weight: ${theme.typography.fontWeight.semibold};
            margin-bottom: ${theme.spacing[4]};
          `}>
            Active Goals
          </Typography.BodyAlt>
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
            {activeGoals!.map((goal) => (
              <GoalCard key={goal.id} goal={goal} />
            ))}
          </div>
        </section>
      )}

      {/* Proposed Goals */}
      {hasProposed && (
        <section>
          <Typography.BodyAlt as="h3" color="secondary" css={css`
            font-weight: ${theme.typography.fontWeight.semibold};
            margin-bottom: ${theme.spacing[4]};
          `}>
            Awaiting your input
          </Typography.BodyAlt>
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
            {proposedGoals!.map((goal) => (
              <GoalCard key={goal.id} goal={goal} />
            ))}
          </div>
        </section>
      )}

      {/* Seeds */}
      {hasSeeds && (
        <section>
          <button
            onClick={() => setShowSeeds(!showSeeds)}
            css={css`
              display: flex;
              align-items: center;
              gap: ${theme.spacing[2]};
              font-size: ${theme.typography.fontSize.base};
              font-weight: ${theme.typography.fontWeight.semibold};
              color: ${theme.colors.text.secondary};
              margin-bottom: ${showSeeds ? theme.spacing[4] : 0};
              cursor: pointer;
            `}
          >
            Emerging interests
            <Typography.Caption as="span" color="hint" css={css`font-weight: ${theme.typography.fontWeight.normal};`}>
              ({seeds!.length})
            </Typography.Caption>
            {showSeeds
              ? <CaretUp size={14} css={css`color: ${theme.colors.text.hint};`} />
              : <CaretDown size={14} css={css`color: ${theme.colors.text.hint};`} />}
          </button>
          <AnimatePresence>
            {showSeeds && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                css={css`overflow: hidden;`}
              >
                <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
                  {seeds!.map((seed) => (
                    <SeedCard key={seed.id} seed={seed} />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      )}

      {/* History */}
      <section>
        <button
          onClick={() => setShowHistory(!showHistory)}
          css={css`
            display: flex;
            align-items: center;
            gap: ${theme.spacing[2]};
            font-size: ${theme.typography.fontSize.base};
            font-weight: ${theme.typography.fontWeight.semibold};
            color: ${theme.colors.text.secondary};
            margin-bottom: ${showHistory ? theme.spacing[4] : 0};
            cursor: pointer;
          `}
        >
          History
          {showHistory
            ? <CaretUp size={14} css={css`color: ${theme.colors.text.hint};`} />
            : <CaretDown size={14} css={css`color: ${theme.colors.text.hint};`} />}
        </button>
        <AnimatePresence>
          {showHistory && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              css={css`overflow: hidden;`}
            >
              {hasCompleted ? (
                <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
                  {completedGoals!.map((goal) => (
                    <div key={goal.id} css={css`
                      display: flex; align-items: center; gap: ${theme.spacing[2]};
                      padding: ${theme.spacing[2]} 0;
                      border-bottom: 1px solid ${theme.colors.border.light};
                    `}>
                      <CheckCircle size={14} weight="fill" css={css`color: ${theme.colors.success.main}; flex-shrink: 0;`} />
                      <Typography.SmallBody as="span" color="secondary">
                        {goal.title}
                      </Typography.SmallBody>
                      {goal.completedAt && (
                        <Typography.Caption color="disabled" css={css`margin-left: auto;`}>
                          {formatRelativeTime(goal.completedAt)}
                        </Typography.Caption>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <Typography.SmallBody color="hint" css={css`
                  padding: ${theme.spacing[4]} 0;
                `}>
                  No completed or abandoned goals yet.
                </Typography.SmallBody>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </section>
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
