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
  TreeStructure,
  WarningCircle,
  ClockCounterClockwise,
  Notebook,
  ListChecks,
  Flag,
} from '@phosphor-icons/react';
import { trpc } from '../../utils/trpc';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Typography, Spinner } from '../ui';
import { emotionColors } from '../../styles/theme';
import type { Theme } from '../../styles/theme';
import type { GoalEvent, GoalReviewRequest, GoalSnapshot, Milestone, Plan, Task } from '@animus-labs/shared';

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

const REVIEW_SCOPE_LABELS: Record<string, string> = {
  plan_missing: 'Needs a plan',
  milestone_acceptance: 'Milestone ready to judge',
  plan_revision: 'Plan may need revision',
  blocker: 'Blocked',
  next_tasks: 'Needs next tasks',
  user_alignment: 'Needs your alignment',
  completion_check: 'May be complete',
};

const REVIEW_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  low: 'default',
  normal: 'warning',
  high: 'error',
};

const EVENT_LABELS: Record<string, string> = {
  'goal.created': 'Goal created',
  'goal.activated': 'Goal activated',
  'goal.paused': 'Goal paused',
  'goal.resumed': 'Goal resumed',
  'goal.completed': 'Goal completed',
  'goal.abandoned': 'Goal abandoned',
  'plan.created': 'Plan version created',
  'plan.superseded': 'Plan superseded',
  'milestone.started': 'Milestone started',
  'milestone.updated': 'Milestone updated',
  'milestone.completed': 'Milestone completed',
  'milestone.blocked': 'Milestone blocked',
  'task.created': 'Task created',
  'task.started': 'Task started',
  'task.completed': 'Task completed',
  'task.cancelled': 'Task cancelled',
  'task.skipped': 'Task skipped',
  'task.failed': 'Task failed',
  'review.requested': 'Review requested',
  'review.resolved': 'Review resolved',
  'snapshot.updated': 'Snapshot updated',
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

function clamp01(value: number | null | undefined): number {
  if (value == null || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function confidenceLabel(value: number | null | undefined): string {
  const pct = Math.round(clamp01(value) * 100);
  return `${pct}%`;
}

function milestoneProgress(milestones: Milestone[] | null | undefined): string | null {
  if (!milestones || milestones.length === 0) return null;
  const completed = milestones.filter((m) => m.status === 'completed' || m.status === 'skipped').length;
  return `${completed}/${milestones.length} milestones`;
}

function currentMilestoneFrom(snapshot: GoalSnapshot | null | undefined, plan: Plan | null | undefined): Milestone | null {
  const milestones = plan?.milestones ?? [];
  if (snapshot?.currentMilestoneId) {
    const byId = milestones.find((m) => m.id === snapshot.currentMilestoneId);
    if (byId) return byId;
  }
  return milestones.find((m) => m.status === 'in_progress') ?? milestones.find((m) => m.status === 'pending') ?? null;
}

function isOpenTask(task: Task): boolean {
  return task.status === 'pending' || task.status === 'scheduled' || task.status === 'in_progress' || task.status === 'paused';
}

function detailPanelStyles(theme: Theme) {
  return css`
    padding: ${theme.spacing[3]};
    border-radius: ${theme.borderRadius.default};
    background: ${theme.mode === 'light' ? 'rgba(26, 24, 22, 0.025)' : 'rgba(250, 249, 244, 0.035)'};
    border: 1px solid ${theme.colors.border.light};
  `;
}

function sectionLabelStyles(theme: Theme) {
  return css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing[1.5]};
    margin-bottom: ${theme.spacing[2]};
    color: ${theme.colors.text.hint};
    text-transform: uppercase;
    letter-spacing: 0;
    font-weight: ${theme.typography.fontWeight.medium};
  `;
}

function ConfidenceMeter({ label, value }: { label: string; value: number | null | undefined }) {
  const theme = useTheme();
  const pct = clamp01(value) * 100;

  return (
    <div>
      <div css={css`
        display: flex;
        justify-content: space-between;
        gap: ${theme.spacing[2]};
        margin-bottom: ${theme.spacing[1]};
      `}>
        <Typography.Tiny as="span" color="hint">
          {label}
        </Typography.Tiny>
        <Typography.Tiny as="span" color="hint">
          {confidenceLabel(value)}
        </Typography.Tiny>
      </div>
      <div css={css`
        height: 3px;
        border-radius: 2px;
        background: ${theme.colors.background.elevated};
        overflow: hidden;
      `}>
        <motion.div
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          css={css`
            height: 100%;
            border-radius: 2px;
            background: ${theme.colors.accent};
            opacity: 0.55;
          `}
        />
      </div>
    </div>
  );
}

function SnapshotPanel({
  snapshot,
  currentMilestone,
}: {
  snapshot: GoalSnapshot | null | undefined;
  currentMilestone: Milestone | null;
}) {
  const theme = useTheme();

  if (!snapshot) {
    return (
      <div css={detailPanelStyles(theme)}>
        <Typography.Caption color="hint">
          Waiting for the first strategic snapshot.
        </Typography.Caption>
      </div>
    );
  }

  return (
    <div css={detailPanelStyles(theme)}>
      <Typography.Caption css={sectionLabelStyles(theme)}>
        <Flag size={13} />
        Current state
      </Typography.Caption>

      <div css={css`
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(180px, 0.42fr);
        gap: ${theme.spacing[4]};

        @media (max-width: ${theme.breakpoints.md}) {
          grid-template-columns: 1fr;
        }
      `}>
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
          {snapshot.summary && (
            <Typography.SmallBody color="secondary" css={css`line-height: 1.6;`}>
              {snapshot.summary}
            </Typography.SmallBody>
          )}

          {currentMilestone && (
            <div>
              <Typography.Caption color="hint" css={css`display: block; margin-bottom: ${theme.spacing[1]};`}>
                Current milestone
              </Typography.Caption>
              <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                <MilestoneIcon status={currentMilestone.status} />
                <Typography.SmallBody color="primary">
                  {currentMilestone.title}
                </Typography.SmallBody>
              </div>
            </div>
          )}

          {snapshot.recentProgress && (
            <div>
              <Typography.Caption color="hint" css={css`display: block; margin-bottom: ${theme.spacing[1]};`}>
                Recent movement
              </Typography.Caption>
              <Typography.Caption color="secondary" css={css`line-height: 1.55;`}>
                {snapshot.recentProgress}
              </Typography.Caption>
            </div>
          )}

          {snapshot.nextBestMove && (
            <div>
              <Typography.Caption color="hint" css={css`display: block; margin-bottom: ${theme.spacing[1]};`}>
                Next move
              </Typography.Caption>
              <Typography.SmallBody serif italic color="secondary" css={css`line-height: 1.55;`}>
                {snapshot.nextBestMove}
              </Typography.SmallBody>
            </div>
          )}
        </div>

        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
          <ConfidenceMeter label="Plan confidence" value={snapshot.planConfidence} />
          <ConfidenceMeter label="Completion confidence" value={snapshot.completionConfidence} />

          {snapshot.knownBlockers.length > 0 && (
            <div>
              <Typography.Caption color="hint" css={css`display: block; margin-bottom: ${theme.spacing[1]};`}>
                Blockers
              </Typography.Caption>
              <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1]};`}>
                {snapshot.knownBlockers.map((blocker, index) => (
                  <Typography.Caption key={`${blocker}-${index}`} color="secondary" css={css`line-height: 1.45;`}>
                    {blocker}
                  </Typography.Caption>
                ))}
              </div>
            </div>
          )}

          {snapshot.openQuestions.length > 0 && (
            <div>
              <Typography.Caption color="hint" css={css`display: block; margin-bottom: ${theme.spacing[1]};`}>
                Open questions
              </Typography.Caption>
              <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1]};`}>
                {snapshot.openQuestions.map((question, index) => (
                  <Typography.Caption key={`${question}-${index}`} color="secondary" css={css`line-height: 1.45;`}>
                    {question}
                  </Typography.Caption>
                ))}
              </div>
            </div>
          )}

          <Typography.Tiny color="disabled">
            Updated {formatRelativeTime(snapshot.updatedAt)}
          </Typography.Tiny>
        </div>
      </div>
    </div>
  );
}

function ReviewCueList({ reviews }: { reviews: GoalReviewRequest[] | undefined }) {
  const theme = useTheme();
  if (!reviews || reviews.length === 0) return null;

  return (
    <div css={detailPanelStyles(theme)}>
      <Typography.Caption css={sectionLabelStyles(theme)}>
        <WarningCircle size={13} />
        Needs judgment
      </Typography.Caption>
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
        {reviews.map((review) => (
          <div key={review.id} css={css`
            display: grid;
            grid-template-columns: auto minmax(0, 1fr) auto;
            align-items: baseline;
            gap: ${theme.spacing[2]};
            padding: ${theme.spacing[2]} 0;
            border-bottom: 1px solid ${theme.colors.border.light};

            &:last-of-type {
              border-bottom: none;
            }

            @media (max-width: ${theme.breakpoints.md}) {
              grid-template-columns: 1fr;
            }
          `}>
            <Badge variant={REVIEW_VARIANT[review.urgency] ?? 'warning'}>
              {REVIEW_SCOPE_LABELS[review.scope] ?? review.scope}
            </Badge>
            <Typography.Caption color="secondary" css={css`line-height: 1.5;`}>
              {review.reason}
            </Typography.Caption>
            <Typography.Tiny color="disabled">
              {formatRelativeTime(review.createdAt)}
            </Typography.Tiny>
          </div>
        ))}
      </div>
    </div>
  );
}

function CompactMilestoneRail({ milestones, currentMilestoneId }: { milestones: Milestone[]; currentMilestoneId?: string | null }) {
  const theme = useTheme();

  if (milestones.length === 0) return null;

  return (
    <div css={css`
      display: flex;
      align-items: center;
      gap: ${theme.spacing[1]};
      margin-top: ${theme.spacing[3]};
    `}>
      {milestones.map((milestone) => {
        const isCurrent = milestone.id === currentMilestoneId || milestone.status === 'in_progress';
        const color = milestone.status === 'completed'
          ? theme.colors.success.main
          : milestone.status === 'blocked'
            ? theme.colors.error.main
            : milestone.status === 'skipped'
              ? theme.colors.text.disabled
              : isCurrent
                ? theme.colors.accent
                : theme.colors.border.default;
        return (
          <span
            key={milestone.id}
            title={`${milestone.title} (${milestone.status.replaceAll('_', ' ')})`}
            css={css`
              height: 5px;
              flex: 1;
              min-width: 16px;
              border-radius: 999px;
              background: ${color};
              opacity: ${milestone.status === 'pending' ? 0.5 : 0.75};
            `}
          />
        );
      })}
    </div>
  );
}

function MilestoneList({
  milestones,
  currentMilestoneId,
  tasks,
}: {
  milestones: Milestone[];
  currentMilestoneId?: string | null;
  tasks?: Task[] | undefined;
}) {
  const theme = useTheme();

  if (milestones.length === 0) return null;

  return (
    <div css={detailPanelStyles(theme)}>
      <Typography.Caption css={sectionLabelStyles(theme)}>
        <TreeStructure size={13} />
        Milestones
      </Typography.Caption>
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
        {milestones.map((milestone) => {
          const openTasks = (tasks ?? []).filter((task) => (
            task.milestoneId === milestone.id && isOpenTask(task)
          ));
          const isCurrent = milestone.id === currentMilestoneId || milestone.status === 'in_progress';

          return (
            <div key={milestone.id} css={css`
              display: grid;
              grid-template-columns: 18px minmax(0, 1fr) auto;
              gap: ${theme.spacing[2]};
              align-items: flex-start;
              padding: ${theme.spacing[2]} 0;
              border-bottom: 1px solid ${theme.colors.border.light};

              &:last-of-type {
                border-bottom: none;
              }
            `}>
              <div css={css`padding-top: 2px;`}>
                <MilestoneIcon status={milestone.status} />
              </div>
              <div css={css`min-width: 0;`}>
                <div css={css`
                  display: flex;
                  align-items: center;
                  gap: ${theme.spacing[2]};
                  flex-wrap: wrap;
                  margin-bottom: ${theme.spacing[1]};
                `}>
                  <Typography.SmallBody as="span" color={milestone.status === 'completed' ? 'hint' : 'primary'} css={css`
                    font-weight: ${isCurrent ? theme.typography.fontWeight.semibold : theme.typography.fontWeight.normal};
                    ${milestone.status === 'completed' ? 'text-decoration: line-through;' : ''}
                  `}>
                    {milestone.title}
                  </Typography.SmallBody>
                  {isCurrent && (
                    <Badge variant="info">current</Badge>
                  )}
                  {openTasks.length > 0 && (
                    <Typography.Tiny color="hint">
                      {openTasks.length} open task{openTasks.length === 1 ? '' : 's'}
                    </Typography.Tiny>
                  )}
                </div>

                {milestone.description && (
                  <Typography.Caption color="secondary" css={css`display: block; line-height: 1.5;`}>
                    {milestone.description}
                  </Typography.Caption>
                )}
                {milestone.acceptanceCriteria && (
                  <Typography.Caption color="hint" css={css`display: block; line-height: 1.5; margin-top: ${theme.spacing[1]};`}>
                    Acceptance: {milestone.acceptanceCriteria}
                  </Typography.Caption>
                )}
                {milestone.blockerNotes && (
                  <Typography.Caption css={css`
                    display: block;
                    line-height: 1.5;
                    margin-top: ${theme.spacing[1]};
                    color: ${theme.colors.error.main};
                  `}>
                    {milestone.blockerNotes}
                  </Typography.Caption>
                )}
                {milestone.completionRationale && (
                  <Typography.Caption color="hint" css={css`display: block; line-height: 1.5; margin-top: ${theme.spacing[1]};`}>
                    {milestone.completionRationale}
                  </Typography.Caption>
                )}
              </div>
              <Typography.Tiny color="disabled" css={css`white-space: nowrap; padding-top: 2px;`}>
                {confidenceLabel(milestone.confidence)}
              </Typography.Tiny>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CurrentTaskList({
  tasks,
  currentMilestoneId,
}: {
  tasks?: Task[] | undefined;
  currentMilestoneId?: string | null;
}) {
  const theme = useTheme();
  const openTasks = (tasks ?? []).filter((task) => (
    isOpenTask(task) && (!currentMilestoneId || task.milestoneId === currentMilestoneId)
  ));

  if (openTasks.length === 0) return null;

  return (
    <div css={detailPanelStyles(theme)}>
      <Typography.Caption css={sectionLabelStyles(theme)}>
        <ListChecks size={13} />
        Open tasks
      </Typography.Caption>
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1.5]};`}>
        {openTasks.slice(0, 6).map((task) => (
          <div key={task.id} css={css`
            display: flex;
            align-items: center;
            gap: ${theme.spacing[2]};
          `}>
            <Badge variant={task.status === 'in_progress' ? 'warning' : 'default'}>
              {task.status === 'in_progress' ? 'active' : task.status}
            </Badge>
            <Typography.Caption color="secondary" css={css`
              flex: 1;
              min-width: 0;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            `}>
              {task.title}
            </Typography.Caption>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlanHistory({ plans, activePlanId }: { plans: Plan[] | undefined; activePlanId?: string | null }) {
  const theme = useTheme();
  if (!plans || plans.length <= 1) return null;

  const sorted = [...plans].sort((a, b) => b.version - a.version);

  return (
    <div css={detailPanelStyles(theme)}>
      <Typography.Caption css={sectionLabelStyles(theme)}>
        <ClockCounterClockwise size={13} />
        Plan history
      </Typography.Caption>
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
        {sorted.map((plan) => (
          <div key={plan.id} css={css`
            display: grid;
            grid-template-columns: auto minmax(0, 1fr) auto;
            gap: ${theme.spacing[2]};
            align-items: baseline;
          `}>
            <Badge variant={plan.id === activePlanId ? 'info' : 'default'}>
              v{plan.version}
            </Badge>
            <Typography.Caption color="secondary" css={css`
              min-width: 0;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            `}>
              {plan.reasonCreated || plan.revisionReason || plan.strategy}
            </Typography.Caption>
            <Typography.Tiny color="disabled">
              {plan.status}
            </Typography.Tiny>
          </div>
        ))}
      </div>
    </div>
  );
}

function GoalEventTimeline({ events }: { events: GoalEvent[] | undefined }) {
  const theme = useTheme();
  if (!events || events.length === 0) return null;

  return (
    <div css={detailPanelStyles(theme)}>
      <Typography.Caption css={sectionLabelStyles(theme)}>
        <Notebook size={13} />
        Recent movement
      </Typography.Caption>
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
        {events.slice(0, 8).map((event) => (
          <div key={event.id} css={css`
            display: grid;
            grid-template-columns: minmax(120px, 0.28fr) minmax(0, 1fr) auto;
            gap: ${theme.spacing[2]};
            align-items: baseline;

            @media (max-width: ${theme.breakpoints.md}) {
              grid-template-columns: 1fr;
            }
          `}>
            <Typography.Caption color="hint">
              {EVENT_LABELS[event.type] ?? event.type}
            </Typography.Caption>
            <Typography.Caption color="secondary" css={css`line-height: 1.45;`}>
              {event.summary}
            </Typography.Caption>
            <Typography.Tiny color="disabled">
              {formatRelativeTime(event.createdAt)}
            </Typography.Tiny>
          </div>
        ))}
      </div>
    </div>
  );
}

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
    { retry: false },
  );
  const { data: snapshot } = trpc.goals.getGoalSnapshot.useQuery(
    { goalId: goal.id },
    { retry: false },
  );
  const { data: reviewRequests } = trpc.goals.getPendingReviewRequests.useQuery(
    { goalId: goal.id },
    { retry: false },
  );
  const { data: events } = trpc.goals.getRecentEvents.useQuery(
    { goalId: goal.id, limit: 12 },
    { retry: false, enabled: expanded },
  );
  const { data: plans } = trpc.goals.getPlansByGoal.useQuery(
    { goalId: goal.id },
    { retry: false, enabled: expanded },
  );
  const { data: goalTasks } = trpc.tasks.getTasks.useQuery(
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
  const milestones = plan?.milestones ?? [];
  const currentMilestone = currentMilestoneFrom(snapshot, plan);
  const progress = milestoneProgress(milestones);
  const pendingReviewCount = reviewRequests?.length ?? 0;
  const nextLine = snapshot?.nextBestMove ?? currentMilestone?.title ?? planSummary;

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
              {pendingReviewCount > 0 && (
                <Badge variant={reviewRequests?.some((r) => r.urgency === 'high') ? 'error' : 'warning'}>
                  {pendingReviewCount} needs review
                </Badge>
              )}
              {plan && (
                <Typography.Caption color="hint">
                  Plan v{plan.version}{progress ? ` · ${progress}` : ''}
                </Typography.Caption>
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
              {!expanded && nextLine && (
                <Typography.Caption color="hint" css={css`
                  display: -webkit-box;
                  -webkit-line-clamp: 1;
                  -webkit-box-orient: vertical;
                  overflow: hidden;
                `}>
                  Next: {nextLine}
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

        {milestones.length > 0 && (
          <CompactMilestoneRail
            milestones={milestones}
            currentMilestoneId={snapshot?.currentMilestoneId}
          />
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

                <div css={css`
                  display: flex;
                  flex-direction: column;
                  gap: ${theme.spacing[3]};
                  margin-bottom: ${theme.spacing[3]};
                `}>
                  <ReviewCueList reviews={reviewRequests} />
                  <SnapshotPanel snapshot={snapshot} currentMilestone={currentMilestone} />

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
                    <div css={detailPanelStyles(theme)}>
                      <Typography.Caption css={sectionLabelStyles(theme)}>
                        <TreeStructure size={13} />
                        Plan v{plan.version}
                      </Typography.Caption>
                      <Typography.SmallBody color="secondary" css={css`
                        line-height: 1.6;
                      `}>
                        {plan.strategy}
                      </Typography.SmallBody>
                      {(plan.reasonCreated || plan.revisionReason) && (
                        <Typography.Caption color="hint" css={css`
                          display: block;
                          margin-top: ${theme.spacing[2]};
                          line-height: 1.5;
                        `}>
                          {plan.reasonCreated || plan.revisionReason}
                        </Typography.Caption>
                      )}
                      {plan.assumptions.length > 0 && (
                        <div css={css`
                          display: flex;
                          flex-wrap: wrap;
                          gap: ${theme.spacing[1]};
                          margin-top: ${theme.spacing[3]};
                        `}>
                          {plan.assumptions.map((assumption, index) => (
                            <Badge key={`${assumption}-${index}`} variant="default">
                              {assumption}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div css={detailPanelStyles(theme)}>
                      <Typography.Caption color="hint">
                        No plan version yet.
                      </Typography.Caption>
                    </div>
                  )}

                  <MilestoneList
                    milestones={milestones}
                    currentMilestoneId={snapshot?.currentMilestoneId}
                    tasks={goalTasks}
                  />
                  <CurrentTaskList
                    tasks={goalTasks}
                    currentMilestoneId={currentMilestone?.id}
                  />
                  <PlanHistory plans={plans} activePlanId={plan?.id} />
                  <GoalEventTimeline events={events} />
                </div>

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
  if (status === 'blocked') {
    return <WarningCircle size={14} weight="fill" css={css`color: ${theme.colors.error.main}; flex-shrink: 0;`} />;
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
