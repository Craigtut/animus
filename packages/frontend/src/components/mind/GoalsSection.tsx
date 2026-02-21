/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Target,
  CheckCircle,
  Pause,
  CaretDown,
  CaretUp,
  Play,
  XCircle,
  Sparkle,
  Plant,
  Archive,
  ArrowClockwise,
  Prohibit,
  SealCheck,
  ThumbsUp,
  ThumbsDown,
} from '@phosphor-icons/react';
import { trpc } from '../../utils/trpc';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Typography, Spinner } from '../ui';
import { emotionColors } from '../../styles/theme';
import type { Theme } from '../../styles/theme';

// ============================================================================
// Constants
// ============================================================================

const SEED_GRADUATION_THRESHOLD = 0.7;

const ORIGIN_LABELS: Record<string, string> = {
  user_directed: 'User-directed',
  ai_internal: 'Self-initiated',
  collaborative: 'Collaborative',
};

const ORIGIN_BADGE_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  user_directed: 'default',
  ai_internal: 'info',
  collaborative: 'warning',
};

// ============================================================================
// Time Helpers
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
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return new Date(isoString).toLocaleDateString();
}

function hoursSince(isoString: string): number {
  return (Date.now() - new Date(isoString).getTime()) / 3_600_000;
}

// ============================================================================
// Shared Styles
// ============================================================================

function sectionHeaderStyles(theme: Theme) {
  return css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing[2]};
    margin-bottom: ${theme.spacing[4]};
  `;
}

function collapsibleTriggerStyles(theme: Theme) {
  return css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing[2]};
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    font-family: ${theme.typography.fontFamily.sans};
    font-size: ${theme.typography.fontSize.base};
    font-weight: ${theme.typography.fontWeight.semibold};
    color: ${theme.colors.text.secondary};
    transition: color ${theme.transitions.fast};

    &:hover {
      color: ${theme.colors.text.primary};
    }
  `;
}

function cardStackStyles(theme: Theme) {
  return css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing[3]};
  `;
}

// Shared expand/collapse animation props
const collapseTransition = { duration: 0.25, ease: [0.25, 0.1, 0.25, 1] as const };

// ============================================================================
// Section 1: Active Goals
// ============================================================================

interface ActiveGoalCardProps {
  goal: GoalItem;
}

function ActiveGoalCard({ goal }: ActiveGoalCardProps) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);

  const { data: plan, isLoading: planLoading } = trpc.goals.getActivePlan.useQuery(
    { goalId: goal.id },
    { retry: false, enabled: expanded },
  );

  const pauseMutation = trpc.goals.pauseGoal.useMutation();
  const abandonMutation = trpc.goals.abandonGoal.useMutation();

  const mode = theme.mode;
  const colors = emotionColors[mode];
  const emotionColor = goal.linkedEmotion
    ? colors[goal.linkedEmotion as keyof typeof colors]
    : undefined;

  const planSummary = plan?.strategy
    ? plan.strategy.length > 120
      ? plan.strategy.slice(0, 120).trimEnd() + '...'
      : plan.strategy
    : null;

  return (
    <motion.div layout="position" layoutId={`goal-${goal.id}`}>
      <Card variant="elevated" padding="md">
        {/* Header row */}
        <div
          css={css`
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: ${theme.spacing[2]};
            cursor: pointer;
          `}
          onClick={() => setExpanded((v) => !v)}
        >
          <div css={css`flex: 1; min-width: 0;`}>
            <Typography.Body as="h4" serif css={css`
              font-size: ${theme.typography.fontSize.lg};
              font-weight: ${theme.typography.fontWeight.semibold};
              margin-bottom: ${theme.spacing[1]};
            `}>
              {goal.title}
            </Typography.Body>

            {/* Meta badges row */}
            <div css={css`
              display: flex;
              align-items: center;
              gap: ${theme.spacing[2]};
              flex-wrap: wrap;
            `}>
              {goal.origin && (
                <Badge variant={ORIGIN_BADGE_VARIANT[goal.origin] ?? 'default'}>
                  {ORIGIN_LABELS[goal.origin] ?? goal.origin}
                </Badge>
              )}
              {goal.linkedEmotion && (
                <span css={css`
                  display: inline-flex;
                  align-items: center;
                  gap: ${theme.spacing[1]};
                  font-size: ${theme.typography.fontSize.xs};
                  color: ${emotionColor ?? theme.colors.text.hint};
                `}>
                  <span css={css`
                    width: 6px;
                    height: 6px;
                    border-radius: 50%;
                    background: ${emotionColor ?? theme.colors.text.hint};
                    flex-shrink: 0;
                  `} />
                  {goal.linkedEmotion}
                </span>
              )}
              {!expanded && planSummary && (
                <Typography.Caption color="hint" css={css`
                  display: -webkit-box;
                  -webkit-line-clamp: 1;
                  -webkit-box-orient: vertical;
                  overflow: hidden;
                `}>
                  {planSummary}
                </Typography.Caption>
              )}
            </div>
          </div>

          <div css={css`
            display: flex;
            align-items: center;
            gap: ${theme.spacing[2]};
            flex-shrink: 0;
          `}>
            {/* Pause button (ghost, always visible) */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                pauseMutation.mutate({ goalId: goal.id });
              }}
              disabled={pauseMutation.isPending}
              title="Pause goal"
              css={css`
                display: flex;
                align-items: center;
                justify-content: center;
                width: 28px;
                height: 28px;
                border-radius: ${theme.borderRadius.sm};
                background: none;
                border: none;
                cursor: pointer;
                color: ${theme.colors.text.hint};
                transition: all ${theme.transitions.fast};
                opacity: 0.6;

                &:hover:not(:disabled) {
                  opacity: 1;
                  color: ${theme.colors.warning.main};
                  background: ${theme.colors.background.elevated};
                }
                &:disabled {
                  opacity: 0.3;
                  cursor: not-allowed;
                }
              `}
            >
              <Pause size={14} weight="bold" />
            </button>

            {expanded
              ? <CaretUp size={14} css={css`color: ${theme.colors.text.hint};`} />
              : <CaretDown size={14} css={css`color: ${theme.colors.text.hint};`} />}
          </div>
        </div>

        {/* Salience bar */}
        {goal.currentSalience != null && (
          <div css={css`margin-top: ${theme.spacing[3]};`}>
            <div css={css`
              display: flex;
              align-items: center;
              justify-content: space-between;
              margin-bottom: ${theme.spacing[0.5]};
            `}>
              <Typography.Tiny as="span" color="hint" css={css`
                text-transform: uppercase;
                letter-spacing: 0.05em;
              `}>
                Salience
              </Typography.Tiny>
              <Typography.Tiny as="span" color="hint">
                {(goal.currentSalience as number).toFixed(2)}
              </Typography.Tiny>
            </div>
            <div css={css`
              width: 100%;
              height: 3px;
              border-radius: 2px;
              background: ${theme.colors.background.elevated};
              overflow: hidden;
            `}>
              <motion.div
                initial={false}
                animate={{ width: `${(goal.currentSalience as number) * 100}%` }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
                css={css`
                  height: 100%;
                  border-radius: 2px;
                  background: ${emotionColor ?? theme.colors.accent};
                  opacity: 0.6;
                `}
              />
            </div>
          </div>
        )}

        {/* Expanded detail */}
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={collapseTransition}
              css={css`overflow: hidden;`}
            >
              <div css={css`
                margin-top: ${theme.spacing[4]};
                padding-top: ${theme.spacing[4]};
                border-top: 1px solid ${theme.colors.border.light};
              `}>
                {/* Description */}
                {goal.description && (
                  <Typography.SmallBody color="secondary" css={css`
                    margin-bottom: ${theme.spacing[3]};
                  `}>
                    {goal.description}
                  </Typography.SmallBody>
                )}

                {/* Motivation */}
                {goal.motivation && (
                  <Typography.SmallBody serif italic color="hint" css={css`
                    margin-bottom: ${theme.spacing[3]};
                  `}>
                    {goal.motivation}
                  </Typography.SmallBody>
                )}

                {/* Plan details */}
                {planLoading ? (
                  <div css={css`
                    display: flex;
                    align-items: center;
                    gap: ${theme.spacing[2]};
                    padding: ${theme.spacing[2]} 0;
                  `}>
                    <Spinner size={14} />
                    <Typography.Caption color="hint">Loading plan...</Typography.Caption>
                  </div>
                ) : plan ? (
                  <div css={css`margin-bottom: ${theme.spacing[3]};`}>
                    <Typography.Caption color="hint" css={css`
                      display: block;
                      margin-bottom: ${theme.spacing[2]};
                      text-transform: uppercase;
                      letter-spacing: 0.05em;
                    `}>
                      Plan v{plan.version} &middot; Strategy
                    </Typography.Caption>
                    <Typography.SmallBody color="secondary" css={css`
                      margin-bottom: ${theme.spacing[3]};
                    `}>
                      {plan.strategy}
                    </Typography.SmallBody>

                    {/* Milestones */}
                    {plan.milestones && plan.milestones.length > 0 && (
                      <div css={css`
                        display: flex;
                        flex-direction: column;
                        gap: ${theme.spacing[2]};
                      `}>
                        <Typography.Caption color="hint" css={css`
                          text-transform: uppercase;
                          letter-spacing: 0.05em;
                        `}>
                          Milestones
                        </Typography.Caption>
                        {plan.milestones.map((ms, i) => (
                          <div key={i} css={css`
                            display: flex;
                            align-items: center;
                            gap: ${theme.spacing[2]};
                          `}>
                            <MilestoneIcon status={ms.status} />
                            <Typography.SmallBody as="span" css={css`
                              color: ${ms.status === 'completed'
                                ? theme.colors.text.hint
                                : ms.status === 'skipped'
                                  ? theme.colors.text.disabled
                                  : theme.colors.text.primary};
                              ${ms.status === 'completed' ? 'text-decoration: line-through;' : ''}
                            `}>
                              {ms.title}
                            </Typography.SmallBody>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}

                {/* Timestamps */}
                <div css={css`
                  display: flex;
                  gap: ${theme.spacing[3]};
                  flex-wrap: wrap;
                  margin-top: ${theme.spacing[2]};
                `}>
                  <Typography.Caption color="disabled">
                    Created {formatRelativeTime(goal.createdAt)}
                  </Typography.Caption>
                  {goal.lastProgressAt && (
                    <Typography.Caption color="disabled">
                      Progress {formatRelativeTime(goal.lastProgressAt)}
                    </Typography.Caption>
                  )}
                </div>

                {/* Abandon action (in expanded view, danger ghost) */}
                <div css={css`
                  margin-top: ${theme.spacing[4]};
                  padding-top: ${theme.spacing[3]};
                  border-top: 1px solid ${theme.colors.border.light};
                  display: flex;
                  justify-content: flex-end;
                `}>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={abandonMutation.isPending}
                    onClick={(e) => {
                      e.stopPropagation();
                      abandonMutation.mutate({ goalId: goal.id });
                    }}
                    css={css`
                      color: ${theme.colors.error.main};
                      &:hover:not(:disabled) {
                        color: ${theme.colors.error.dark};
                        background: ${theme.colors.error.main}0d;
                      }
                    `}
                  >
                    <XCircle size={14} />
                    Abandon
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </motion.div>
  );
}

function MilestoneIcon({ status }: { status: string }) {
  const theme = useTheme();

  if (status === 'completed') {
    return <CheckCircle size={14} weight="fill" css={css`color: ${theme.colors.success.main}; flex-shrink: 0;`} />;
  }
  if (status === 'in_progress') {
    return (
      <div css={css`
        width: 14px;
        height: 14px;
        border-radius: 50%;
        border: 2px solid ${theme.colors.accent};
        flex-shrink: 0;
        animation: ms-pulse 2000ms ease-in-out infinite;
        @keyframes ms-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `} />
    );
  }
  if (status === 'skipped') {
    return <Prohibit size={14} css={css`color: ${theme.colors.text.disabled}; flex-shrink: 0;`} />;
  }
  // pending
  return (
    <div css={css`
      width: 14px;
      height: 14px;
      border-radius: 50%;
      border: 1.5px solid ${theme.colors.border.default};
      flex-shrink: 0;
    `} />
  );
}

function ActiveGoalsSection() {
  const theme = useTheme();

  const { data: activeGoals, isLoading } = trpc.goals.getGoals.useQuery(
    { status: 'active' },
    { retry: false },
  );

  const hasGoals = activeGoals && activeGoals.length > 0;

  if (isLoading) {
    return (
      <section>
        <div css={sectionHeaderStyles(theme)}>
          <Target size={20} css={css`color: ${theme.colors.text.secondary};`} />
          <Typography.BodyAlt as="h3" css={css`
            font-weight: ${theme.typography.fontWeight.semibold};
          `}>
            Active Goals
          </Typography.BodyAlt>
        </div>
        <div css={css`
          display: flex;
          justify-content: center;
          padding: ${theme.spacing[8]} 0;
        `}>
          <Spinner size={20} />
        </div>
      </section>
    );
  }

  return (
    <section>
      <div css={sectionHeaderStyles(theme)}>
        <Target size={20} css={css`color: ${theme.colors.text.secondary};`} />
        <Typography.BodyAlt as="h3" css={css`
          font-weight: ${theme.typography.fontWeight.semibold};
        `}>
          Active Goals
        </Typography.BodyAlt>
        {hasGoals && (
          <Typography.Caption as="span" color="hint">
            ({activeGoals.length})
          </Typography.Caption>
        )}
      </div>

      {!hasGoals ? (
        <div css={css`
          text-align: center;
          padding: ${theme.spacing[12]} 0 ${theme.spacing[8]};
        `}>
          <Target
            size={36}
            weight="light"
            css={css`
              color: ${theme.colors.text.disabled};
              margin: 0 auto ${theme.spacing[3]};
              display: block;
            `}
          />
          <Typography.Body serif italic color="hint" css={css`
            max-width: 340px;
            margin: 0 auto;
          `}>
            No active goals yet. Goals emerge from seeds as the mind develops interests and receives direction.
          </Typography.Body>
        </div>
      ) : (
        <div css={cardStackStyles(theme)}>
          <AnimatePresence mode="popLayout">
            {activeGoals.map((goal) => (
              <ActiveGoalCard key={goal.id} goal={goal as GoalItem} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}

// ============================================================================
// Section 2: Proposed Goals
// ============================================================================

function ProposedGoalCard({ goal }: { goal: GoalItem }) {
  const theme = useTheme();

  const activateMutation = trpc.goals.activateGoal.useMutation();
  const abandonMutation = trpc.goals.abandonGoal.useMutation();

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
    >
      <div css={css`
        position: relative;
        border-radius: ${theme.borderRadius.md};
        padding: ${theme.spacing[5]};
        background: ${theme.colors.background.paper};
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid ${theme.colors.border.default};

        /* Info-colored left border for proposed distinction */
        &::after {
          content: '';
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 3px;
          background: ${theme.colors.info.main};
          opacity: 0.5;
          border-radius: ${theme.borderRadius.md} 0 0 ${theme.borderRadius.md};
          pointer-events: none;
        }
      `}>
        <div css={css`
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: ${theme.spacing[3]};
        `}>
          <div css={css`flex: 1; min-width: 0;`}>
            <Typography.Body as="h4" serif css={css`
              font-size: ${theme.typography.fontSize.lg};
              font-weight: ${theme.typography.fontWeight.semibold};
              margin-bottom: ${theme.spacing[1]};
            `}>
              {goal.title}
            </Typography.Body>

            {goal.motivation && (
              <Typography.SmallBody serif italic color="hint" css={css`
                margin-bottom: ${theme.spacing[2]};
              `}>
                {goal.motivation}
              </Typography.SmallBody>
            )}

            {goal.origin && (
              <Badge variant={ORIGIN_BADGE_VARIANT[goal.origin] ?? 'default'}>
                {ORIGIN_LABELS[goal.origin] ?? goal.origin}
              </Badge>
            )}
          </div>

          {/* Action buttons */}
          <div css={css`
            display: flex;
            align-items: center;
            gap: ${theme.spacing[2]};
            flex-shrink: 0;
          `}>
            <Button
              variant="ghost"
              size="sm"
              loading={abandonMutation.isPending}
              disabled={activateMutation.isPending}
              onClick={() => abandonMutation.mutate({ goalId: goal.id })}
            >
              <ThumbsDown size={14} />
              Decline
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={activateMutation.isPending}
              disabled={abandonMutation.isPending}
              onClick={() => activateMutation.mutate({ goalId: goal.id })}
            >
              <ThumbsUp size={14} />
              Approve
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function ProposedGoalsSection() {
  const theme = useTheme();

  const { data: proposedGoals } = trpc.goals.getGoals.useQuery(
    { status: 'proposed' },
    { retry: false },
  );

  if (!proposedGoals || proposedGoals.length === 0) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    >
      <div css={sectionHeaderStyles(theme)}>
        <Sparkle size={20} css={css`color: ${theme.colors.info.main};`} />
        <Typography.BodyAlt as="h3" css={css`
          font-weight: ${theme.typography.fontWeight.semibold};
          color: ${theme.colors.text.secondary};
        `}>
          Awaiting Your Input
        </Typography.BodyAlt>
        <Typography.Caption as="span" color="hint">
          ({proposedGoals.length})
        </Typography.Caption>
      </div>

      <div css={cardStackStyles(theme)}>
        <AnimatePresence mode="popLayout">
          {proposedGoals.map((goal) => (
            <ProposedGoalCard key={goal.id} goal={goal as GoalItem} />
          ))}
        </AnimatePresence>
      </div>
    </motion.section>
  );
}

// ============================================================================
// Section 3: Seeds / Emerging Interests
// ============================================================================

type SeedHealth = 'gaining' | 'stable' | 'fading';

function getSeedHealth(lastReinforcedAt: string): SeedHealth {
  const hours = hoursSince(lastReinforcedAt);
  if (hours < 2) return 'gaining';
  if (hours < 12) return 'stable';
  return 'fading';
}

const HEALTH_BORDER_COLORS: Record<SeedHealth, (theme: Theme) => string> = {
  gaining: (theme) => theme.colors.success.main,
  stable: (theme) => theme.colors.border.default,
  fading: (theme) => theme.colors.warning.main,
};

const HEALTH_LABELS: Record<SeedHealth, string> = {
  gaining: 'Gaining strength',
  stable: 'Stable',
  fading: 'Fading',
};

interface SeedItem {
  id: string;
  content: string;
  strength: number;
  linkedEmotion?: string | null;
  reinforcementCount: number;
  status: string;
  lastReinforcedAt: string;
  graduatedToGoalId?: string | null;
}

function SeedCard({ seed, isGraduating }: { seed: SeedItem; isGraduating: boolean }) {
  const theme = useTheme();
  const mode = theme.mode;
  const colors = emotionColors[mode];
  const linkedColor = seed.linkedEmotion
    ? colors[seed.linkedEmotion as keyof typeof colors]
    : undefined;

  const health = getSeedHealth(seed.lastReinforcedAt);
  const borderColor = HEALTH_BORDER_COLORS[health](theme);
  const progressPercent = Math.min((seed.strength / SEED_GRADUATION_THRESHOLD) * 100, 100);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
    >
      <div css={css`
        position: relative;
        border-radius: ${theme.borderRadius.md};
        padding: ${theme.spacing[4]};
        background: ${isGraduating
          ? theme.colors.background.paper
          : theme.colors.background.elevated};
        backdrop-filter: blur(${isGraduating ? 16 : 8}px);
        -webkit-backdrop-filter: blur(${isGraduating ? 16 : 8}px);
        border: 1px solid ${isGraduating
          ? theme.colors.info.main + '33'
          : theme.colors.border.default};

        /* Health-tinted left border */
        &::after {
          content: '';
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 3px;
          background: ${borderColor};
          opacity: ${health === 'stable' ? 0.15 : 0.55};
          border-radius: ${theme.borderRadius.md} 0 0 ${theme.borderRadius.md};
          pointer-events: none;
        }

        /* Rim lighting for graduating seeds */
        ${isGraduating ? `
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
        {/* Graduating badge */}
        {isGraduating && (
          <div css={css`margin-bottom: ${theme.spacing[2]};`}>
            <Badge variant="info">
              <Sparkle size={10} weight="fill" css={css`margin-right: ${theme.spacing[1]};`} />
              Ready to graduate
            </Badge>
          </div>
        )}

        {/* Content */}
        <Typography.SmallBody serif css={css`
          margin-bottom: ${theme.spacing[3]};
          line-height: ${theme.typography.lineHeight.relaxed};
        `}>
          {seed.content}
        </Typography.SmallBody>

        {/* Strength visualization bar */}
        <div css={css`margin-bottom: ${theme.spacing[2]};`}>
          <div css={css`
            position: relative;
            width: 100%;
            height: 4px;
            border-radius: 2px;
            background: ${theme.colors.background.default};
            overflow: visible;
          `}>
            {/* Fill bar */}
            <motion.div
              initial={false}
              animate={{ width: `${progressPercent}%` }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
              css={css`
                height: 100%;
                border-radius: 2px;
                background: ${linkedColor ?? theme.colors.accent};
                opacity: ${isGraduating ? 0.9 : 0.55};
              `}
            />
            {/* Threshold marker */}
            <div css={css`
              position: absolute;
              right: 0;
              top: -3px;
              width: 1px;
              height: 10px;
              background: ${theme.colors.text.disabled};
              opacity: 0.5;
            `} />
          </div>
          <div css={css`
            display: flex;
            justify-content: space-between;
            margin-top: ${theme.spacing[0.5]};
          `}>
            <Typography.Tiny as="span" color="hint">
              {seed.strength.toFixed(2)} / {SEED_GRADUATION_THRESHOLD.toFixed(2)}
            </Typography.Tiny>
            <Typography.Tiny as="span" color="hint">threshold</Typography.Tiny>
          </div>
        </div>

        {/* Meta row */}
        <div css={css`
          display: flex;
          align-items: center;
          gap: ${theme.spacing[2]};
          flex-wrap: wrap;
        `}>
          {/* Linked emotion */}
          {seed.linkedEmotion && (
            <span css={css`
              display: inline-flex;
              align-items: center;
              gap: ${theme.spacing[1]};
              font-size: ${theme.typography.fontSize.xs};
              color: ${linkedColor ?? theme.colors.text.hint};
            `}>
              <span css={css`
                width: 5px;
                height: 5px;
                border-radius: 50%;
                background: ${linkedColor ?? theme.colors.text.hint};
              `} />
              {seed.linkedEmotion}
            </span>
          )}

          {/* Reinforcement count */}
          <Typography.Tiny as="span" color="disabled">
            <ArrowClockwise size={10} css={css`margin-right: 2px; vertical-align: -1px;`} />
            {seed.reinforcementCount}x reinforced
          </Typography.Tiny>

          {/* Health + relative time */}
          <Typography.Tiny as="span" css={css`
            margin-left: auto;
            color: ${health === 'gaining'
              ? theme.colors.success.main
              : health === 'fading'
                ? theme.colors.warning.main
                : theme.colors.text.disabled};
          `}>
            {HEALTH_LABELS[health]} &middot; reinforced {formatRelativeTime(seed.lastReinforcedAt)}
          </Typography.Tiny>
        </div>
      </div>
    </motion.div>
  );
}

function SeedsSection() {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);

  const { data: seeds } = trpc.goals.getSeeds.useQuery(undefined, { retry: false });

  const hasSeeds = seeds && seeds.length > 0;

  // Sort: graduating first, then by strength descending
  const sortedSeeds = useMemo(() => {
    if (!seeds) return [];
    return [...seeds].sort((a, b) => {
      const aGrad = a.status === 'graduating' ? 1 : 0;
      const bGrad = b.status === 'graduating' ? 1 : 0;
      if (aGrad !== bGrad) return bGrad - aGrad;
      return b.strength - a.strength;
    });
  }, [seeds]);

  const graduatingCount = sortedSeeds.filter((s) => s.status === 'graduating').length;

  return (
    <section>
      <button
        onClick={() => setExpanded((v) => !v)}
        css={collapsibleTriggerStyles(theme)}
      >
        <Plant size={18} css={css`
          color: ${graduatingCount > 0 ? theme.colors.info.main : theme.colors.text.hint};
        `} />
        <span>Emerging Interests</span>
        {hasSeeds && (
          <Typography.Caption as="span" color="hint" css={css`
            font-weight: ${theme.typography.fontWeight.normal};
          `}>
            ({seeds!.length})
          </Typography.Caption>
        )}
        {graduatingCount > 0 && (
          <Badge variant="info" css={css`margin-left: ${theme.spacing[1]};`}>
            {graduatingCount} graduating
          </Badge>
        )}
        {expanded
          ? <CaretUp size={13} css={css`color: ${theme.colors.text.hint};`} />
          : <CaretDown size={13} css={css`color: ${theme.colors.text.hint};`} />}
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={collapseTransition}
            css={css`overflow: hidden;`}
          >
            <div css={css`
              display: flex;
              flex-direction: column;
              gap: ${theme.spacing[3]};
              padding-top: ${theme.spacing[4]};
            `}>
              {sortedSeeds.length === 0 ? (
                <Typography.SmallBody serif italic color="hint" css={css`
                  padding: ${theme.spacing[4]} 0;
                `}>
                  No emerging interests yet. Seeds form as the mind develops patterns in its thinking.
                </Typography.SmallBody>
              ) : (
                <AnimatePresence mode="popLayout">
                  {sortedSeeds.map((seed) => (
                    <SeedCard
                      key={seed.id}
                      seed={seed as SeedItem}
                      isGraduating={seed.status === 'graduating'}
                    />
                  ))}
                </AnimatePresence>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Empty-section hint when collapsed */}
      {!expanded && hasSeeds && (
        <Typography.Caption color="disabled" css={css`
          margin-top: ${theme.spacing[1]};
          margin-left: ${theme.spacing[8]};
        `}>
          {graduatingCount > 0
            ? `${graduatingCount} seed${graduatingCount > 1 ? 's' : ''} approaching graduation`
            : 'Click to view seed details'}
        </Typography.Caption>
      )}
    </section>
  );
}

// ============================================================================
// Section 4: Inactive Goals
// ============================================================================

function InactiveGoalsSection() {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);

  // Lazy-load: only fetch when expanded
  const { data: pausedGoals, isLoading: pausedLoading } = trpc.goals.getGoals.useQuery(
    { status: 'paused' },
    { retry: false, enabled: expanded },
  );
  const { data: completedGoals, isLoading: completedLoading } = trpc.goals.getGoals.useQuery(
    { status: 'completed' },
    { retry: false, enabled: expanded },
  );
  const { data: abandonedGoals, isLoading: abandonedLoading } = trpc.goals.getGoals.useQuery(
    { status: 'abandoned' },
    { retry: false, enabled: expanded },
  );

  const isLoading = expanded && (pausedLoading || completedLoading || abandonedLoading);
  const hasPaused = pausedGoals && pausedGoals.length > 0;
  const hasCompleted = completedGoals && completedGoals.length > 0;
  const hasAbandoned = abandonedGoals && abandonedGoals.length > 0;
  const hasAny = hasPaused || hasCompleted || hasAbandoned;

  return (
    <section>
      <button
        onClick={() => setExpanded((v) => !v)}
        css={collapsibleTriggerStyles(theme)}
      >
        <Archive size={18} css={css`color: ${theme.colors.text.hint};`} />
        <span>Inactive Goals</span>
        {expanded
          ? <CaretUp size={13} css={css`color: ${theme.colors.text.hint};`} />
          : <CaretDown size={13} css={css`color: ${theme.colors.text.hint};`} />}
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={collapseTransition}
            css={css`overflow: hidden;`}
          >
            <div css={css`padding-top: ${theme.spacing[4]};`}>
              {isLoading ? (
                <div css={css`
                  display: flex;
                  justify-content: center;
                  padding: ${theme.spacing[6]} 0;
                `}>
                  <Spinner size={18} />
                </div>
              ) : !hasAny ? (
                <Typography.SmallBody serif italic color="hint" css={css`
                  padding: ${theme.spacing[4]} 0;
                `}>
                  No paused, completed, or abandoned goals yet.
                </Typography.SmallBody>
              ) : (
                <div css={css`
                  display: flex;
                  flex-direction: column;
                  gap: ${theme.spacing[6]};
                `}>
                  {/* Paused */}
                  {hasPaused && (
                    <InactiveSubGroup
                      label="Paused"
                      goals={pausedGoals as GoalItem[]}
                      icon={<Pause size={14} weight="bold" css={css`color: ${theme.colors.warning.main};`} />}
                      showResume
                    />
                  )}

                  {/* Completed */}
                  {hasCompleted && (
                    <InactiveSubGroup
                      label="Completed"
                      goals={completedGoals as GoalItem[]}
                      icon={<SealCheck size={14} weight="fill" css={css`color: ${theme.colors.success.main};`} />}
                    />
                  )}

                  {/* Abandoned */}
                  {hasAbandoned && (
                    <InactiveSubGroup
                      label="Abandoned"
                      goals={abandonedGoals as GoalItem[]}
                      icon={<XCircle size={14} css={css`color: ${theme.colors.text.disabled};`} />}
                    />
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function InactiveSubGroup({
  label,
  goals,
  icon,
  showResume = false,
}: {
  label: string;
  goals: GoalItem[];
  icon: React.ReactNode;
  showResume?: boolean;
}) {
  const theme = useTheme();

  return (
    <div>
      <Typography.Caption color="hint" css={css`
        display: block;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        margin-bottom: ${theme.spacing[2]};
      `}>
        {label} ({goals.length})
      </Typography.Caption>

      <div css={css`
        display: flex;
        flex-direction: column;
        gap: ${theme.spacing[1]};
      `}>
        {goals.map((goal) => (
          <InactiveGoalRow
            key={goal.id}
            goal={goal}
            icon={icon}
            showResume={showResume}
          />
        ))}
      </div>
    </div>
  );
}

function InactiveGoalRow({
  goal,
  icon,
  showResume,
}: {
  goal: GoalItem;
  icon: React.ReactNode;
  showResume: boolean;
}) {
  const theme = useTheme();
  const resumeMutation = trpc.goals.resumeGoal.useMutation();

  const dateText = goal.completedAt
    ? formatRelativeTime(goal.completedAt)
    : goal.abandonedAt
      ? formatRelativeTime(goal.abandonedAt)
      : formatRelativeTime(goal.updatedAt ?? goal.createdAt);

  return (
    <div css={css`
      display: flex;
      align-items: center;
      gap: ${theme.spacing[2]};
      padding: ${theme.spacing[2]} ${theme.spacing[3]};
      border-radius: ${theme.borderRadius.sm};
      transition: background ${theme.transitions.fast};

      &:hover {
        background: ${theme.colors.background.elevated};
      }
    `}>
      <span css={css`flex-shrink: 0; display: flex;`}>{icon}</span>

      <Typography.SmallBody as="span" color="secondary" css={css`
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      `}>
        {goal.title}
      </Typography.SmallBody>

      <Typography.Caption as="span" color="disabled" css={css`
        flex-shrink: 0;
        white-space: nowrap;
      `}>
        {dateText}
      </Typography.Caption>

      {showResume && (
        <button
          onClick={() => resumeMutation.mutate({ goalId: goal.id })}
          disabled={resumeMutation.isPending}
          title="Resume goal"
          css={css`
            display: flex;
            align-items: center;
            gap: ${theme.spacing[1]};
            background: none;
            border: none;
            padding: ${theme.spacing[1]} ${theme.spacing[2]};
            border-radius: ${theme.borderRadius.sm};
            cursor: pointer;
            font-family: ${theme.typography.fontFamily.sans};
            font-size: ${theme.typography.fontSize.xs};
            color: ${theme.colors.text.hint};
            transition: all ${theme.transitions.fast};
            flex-shrink: 0;

            &:hover:not(:disabled) {
              color: ${theme.colors.success.main};
              background: ${theme.colors.success.main}0d;
            }
            &:disabled {
              opacity: 0.4;
              cursor: not-allowed;
            }
          `}
        >
          <Play size={12} weight="fill" />
          Resume
        </button>
      )}
    </div>
  );
}

// ============================================================================
// Goal Item Interface (internal)
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
  updatedAt?: string | null;
  lastProgressAt?: string | null;
  completedAt?: string | null;
  abandonedAt?: string | null;
  abandonedReason?: string | null;
}

// ============================================================================
// Goals Section (composed)
// ============================================================================

export function GoalsSection() {
  const theme = useTheme();

  return (
    <div css={css`
      display: flex;
      flex-direction: column;
      gap: ${theme.spacing[8]};
    `}>
      {/* 1. Active Goals -- always visible, primary section */}
      <ActiveGoalsSection />

      {/* 2. Proposed Goals -- visible when any exist */}
      <ProposedGoalsSection />

      {/* 3. Seeds / Emerging Interests -- collapsible */}
      <SeedsSection />

      {/* 4. Inactive Goals -- collapsible, lazy-loaded */}
      <InactiveGoalsSection />
    </div>
  );
}
