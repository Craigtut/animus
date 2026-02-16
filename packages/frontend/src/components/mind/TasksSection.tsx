/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ListChecks,
  CheckCircle,
  Clock,
  Pause,
  CaretDown,
  CaretUp,
  ArrowClockwise,
  CalendarBlank,
  XCircle,
  Lightning,
  Warning,
} from '@phosphor-icons/react';
import { trpc } from '../../utils/trpc';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Typography } from '../ui';

// ============================================================================
// Task Status Helpers
// ============================================================================

const STATUS_BADGE: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  pending: 'default',
  scheduled: 'info',
  in_progress: 'warning',
  completed: 'success',
  failed: 'error',
  cancelled: 'default',
  paused: 'warning',
};

const STATUS_ICON: Record<string, React.ElementType> = {
  pending: Clock,
  scheduled: CalendarBlank,
  in_progress: Lightning,
  completed: CheckCircle,
  failed: XCircle,
  cancelled: XCircle,
  paused: Pause,
};

const SCHEDULE_LABELS: Record<string, string> = {
  one_shot: 'One-time',
  recurring: 'Recurring',
  deferred: 'When available',
};

// ============================================================================
// Task Card
// ============================================================================

function TaskCard({ task }: { task: any }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);

  const { data: taskRuns } = trpc.tasks.getTaskRuns.useQuery(
    { taskId: task.id },
    { retry: false, enabled: expanded },
  );

  return (
    <Card variant="elevated" padding="md" interactive onClick={() => setExpanded(!expanded)}>
      {/* Header */}
      <div css={css`display: flex; align-items: flex-start; justify-content: space-between; gap: ${theme.spacing[2]};`}>
        <div css={css`flex: 1; min-width: 0;`}>
          <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]}; margin-bottom: ${theme.spacing[1]}; flex-wrap: wrap;`}>
            <Typography.Body as="h4" serif css={css`
              font-size: ${theme.typography.fontSize.lg};
              font-weight: ${theme.typography.fontWeight.semibold};
            `}>
              {task.title}
            </Typography.Body>
            <Badge variant={STATUS_BADGE[task.status] ?? 'default'}>
              {task.status.replace('_', ' ')}
            </Badge>
            {task.scheduleType && (
              <Badge variant="default">
                {task.scheduleType === 'recurring' && <ArrowClockwise size={10} css={css`margin-right: ${theme.spacing[1]};`} />}
                {SCHEDULE_LABELS[task.scheduleType] ?? task.scheduleType}
              </Badge>
            )}
          </div>
          <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
            {task.createdBy && (
              <Typography.Caption color="hint">
                by {task.createdBy}
              </Typography.Caption>
            )}
            {task.nextRunAt && (
              <Typography.Caption color="hint">
                <Clock size={11} css={css`margin-right: ${theme.spacing[0.5]}; vertical-align: -1px;`} />
                next: {formatRelativeTime(task.nextRunAt)}
              </Typography.Caption>
            )}
            {task.cronExpression && (
              <Typography.Caption color="disabled">
                {task.cronExpression}
              </Typography.Caption>
            )}
          </div>
        </div>
        {expanded ? <CaretUp size={16} css={css`color: ${theme.colors.text.hint}; flex-shrink: 0;`} />
                   : <CaretDown size={16} css={css`color: ${theme.colors.text.hint}; flex-shrink: 0;`} />}
      </div>

      {/* Priority bar */}
      {task.priority != null && (
        <div css={css`margin-top: ${theme.spacing[3]};`}>
          <div css={css`
            display: flex; align-items: center; justify-content: space-between;
            margin-bottom: ${theme.spacing[1]};
          `}>
            <Typography.Caption color="hint">Priority</Typography.Caption>
            <Typography.Caption color="hint">
              {(task.priority as number).toFixed(2)}
            </Typography.Caption>
          </div>
          <div css={css`
            width: 100%; height: 4px; border-radius: 2px;
            background: ${theme.colors.background.elevated};
          `}>
            <div css={css`
              height: 100%; width: ${(task.priority as number) * 100}%;
              border-radius: 2px; background: ${theme.colors.accent};
              opacity: 0.5; transition: width ${theme.transitions.normal};
            `} />
          </div>
        </div>
      )}

      {/* Expanded: description, instructions, runs, timestamps */}
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
              {task.description && (
                <Typography.SmallBody color="secondary" css={css`
                  margin-bottom: ${theme.spacing[3]};
                `}>
                  {task.description}
                </Typography.SmallBody>
              )}

              {task.instructions && (
                <Typography.SmallBody serif italic color="hint" css={css`
                  margin-bottom: ${theme.spacing[3]};
                `}>
                  Instructions: {task.instructions}
                </Typography.SmallBody>
              )}

              {/* Goal linkage */}
              {task.goalId && (
                <Typography.Caption color="hint" css={css`
                  display: block;
                  margin-bottom: ${theme.spacing[2]};
                `}>
                  Linked to goal: {task.goalId}
                </Typography.Caption>
              )}

              {/* Last error */}
              {task.lastError && (
                <div css={css`
                  display: flex; align-items: flex-start; gap: ${theme.spacing[2]};
                  margin-bottom: ${theme.spacing[3]};
                  padding: ${theme.spacing[2]} ${theme.spacing[3]};
                  border-radius: ${theme.borderRadius.sm};
                  background: ${theme.colors.error.main}0d;
                `}>
                  <Warning size={14} css={css`color: ${theme.colors.error.main}; flex-shrink: 0; margin-top: 2px;`} />
                  <Typography.Caption css={css`color: ${theme.colors.error.main};`}>
                    {task.lastError}
                  </Typography.Caption>
                </div>
              )}

              {/* Task Runs (if expanded and loaded) */}
              {taskRuns && taskRuns.length > 0 && (
                <div css={css`margin-top: ${theme.spacing[2]};`}>
                  <Typography.Caption color="hint" css={css`
                    display: block;
                    margin-bottom: ${theme.spacing[2]};
                  `}>
                    Recent runs ({taskRuns.length})
                  </Typography.Caption>
                  <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
                    {taskRuns.slice(0, 5).map((run: any) => {
                      const RunIcon = STATUS_ICON[run.status] ?? Clock;
                      return (
                        <div key={run.id} css={css`
                          display: flex; align-items: center; gap: ${theme.spacing[2]};
                          padding: ${theme.spacing[1]} 0;
                        `}>
                          <RunIcon
                            size={12}
                            weight={run.status === 'completed' ? 'fill' : 'regular'}
                            css={css`
                              color: ${run.status === 'completed'
                                ? theme.colors.success.main
                                : run.status === 'failed'
                                  ? theme.colors.error.main
                                  : theme.colors.text.hint};
                              flex-shrink: 0;
                            `}
                          />
                          <Typography.Caption color="secondary" css={css`flex: 1;`}>
                            {run.status}
                          </Typography.Caption>
                          {run.startedAt && (
                            <Typography.Caption color="disabled">
                              {formatRelativeTime(run.startedAt)}
                            </Typography.Caption>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Timestamps */}
              <div css={css`
                margin-top: ${theme.spacing[3]};
                display: flex;
                gap: ${theme.spacing[3]};
                flex-wrap: wrap;
              `}>
                <Typography.Caption color="disabled">Created {formatRelativeTime(task.createdAt)}</Typography.Caption>
                {task.startedAt && <Typography.Caption color="disabled">Started {formatRelativeTime(task.startedAt)}</Typography.Caption>}
                {task.completedAt && <Typography.Caption color="disabled">Completed {formatRelativeTime(task.completedAt)}</Typography.Caption>}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

// ============================================================================
// History Task Row (compact)
// ============================================================================

function HistoryTaskRow({ task }: { task: any }) {
  const theme = useTheme();
  const isCompleted = task.status === 'completed';
  const isFailed = task.status === 'failed';
  const Icon = isFailed ? XCircle : CheckCircle;

  return (
    <div css={css`
      display: flex; align-items: center; gap: ${theme.spacing[2]};
      padding: ${theme.spacing[2]} 0;
      border-bottom: 1px solid ${theme.colors.border.light};
    `}>
      <Icon
        size={14}
        weight="fill"
        css={css`
          color: ${isCompleted ? theme.colors.success.main : isFailed ? theme.colors.error.main : theme.colors.text.hint};
          flex-shrink: 0;
        `}
      />
      <Typography.SmallBody as="span" color="secondary" css={css`flex: 1; min-width: 0;`}>
        {task.title}
      </Typography.SmallBody>
      <Badge variant={STATUS_BADGE[task.status] ?? 'default'} css={css`flex-shrink: 0;`}>
        {task.status}
      </Badge>
      {task.completedAt && (
        <Typography.Caption color="disabled" css={css`flex-shrink: 0;`}>
          {formatRelativeTime(task.completedAt)}
        </Typography.Caption>
      )}
    </div>
  );
}

// ============================================================================
// Tasks Section
// ============================================================================

export function TasksSection() {
  const theme = useTheme();
  const [showHistory, setShowHistory] = useState(false);
  const [showDeferred, setShowDeferred] = useState(false);

  // Fetch tasks by status
  const { data: activeTasks } = trpc.tasks.getTasks.useQuery(
    { status: 'in_progress' },
    { retry: false },
  );
  const { data: scheduledTasks } = trpc.tasks.getTasks.useQuery(
    { status: 'scheduled' },
    { retry: false },
  );
  const { data: deferredTasks } = trpc.tasks.getDeferredTasks.useQuery(
    undefined,
    { retry: false },
  );
  const { data: completedTasks } = trpc.tasks.getTasks.useQuery(
    { status: 'completed' },
    { retry: false, enabled: showHistory },
  );
  const { data: failedTasks } = trpc.tasks.getTasks.useQuery(
    { status: 'failed' },
    { retry: false, enabled: showHistory },
  );

  // Real-time subscription — invalidate on task changes
  const utils = trpc.useUtils();
  trpc.tasks.onTaskChange.useSubscription(undefined, {
    onData: () => {
      utils.tasks.getTasks.invalidate();
      utils.tasks.getDeferredTasks.invalidate();
    },
  });

  const hasActive = activeTasks && activeTasks.length > 0;
  const hasScheduled = scheduledTasks && scheduledTasks.length > 0;
  const hasDeferred = deferredTasks && deferredTasks.length > 0;
  const hasCompletedHistory = completedTasks && completedTasks.length > 0;
  const hasFailedHistory = failedTasks && failedTasks.length > 0;
  const hasHistory = hasCompletedHistory || hasFailedHistory;
  const isEmpty = !hasActive && !hasScheduled && !hasDeferred;

  if (isEmpty) {
    return (
      <div css={css`
        text-align: center;
        padding: ${theme.spacing[16]} 0;
      `}>
        <ListChecks size={40} weight="light" css={css`color: ${theme.colors.text.hint}; margin: 0 auto ${theme.spacing[4]};`} />
        <Typography.Body serif italic color="hint" css={css`
          max-width: 360px;
          margin: 0 auto;
        `}>
          No tasks yet. Tasks are created by the mind to organize and schedule work.
        </Typography.Body>
      </div>
    );
  }

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[8]};`}>
      {/* Active Tasks (in_progress) */}
      {hasActive && (
        <section>
          <Typography.BodyAlt as="h3" css={css`
            font-weight: ${theme.typography.fontWeight.semibold};
            margin-bottom: ${theme.spacing[4]};
            display: flex;
            align-items: center;
            gap: ${theme.spacing[2]};
          `}>
            <Lightning size={16} weight="fill" css={css`color: ${theme.colors.warning.main};`} />
            Active
          </Typography.BodyAlt>
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
            {activeTasks!.map((task: any) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </div>
        </section>
      )}

      {/* Scheduled Tasks */}
      {hasScheduled && (
        <section>
          <Typography.BodyAlt as="h3" css={css`
            font-weight: ${theme.typography.fontWeight.semibold};
            margin-bottom: ${theme.spacing[4]};
            display: flex;
            align-items: center;
            gap: ${theme.spacing[2]};
          `}>
            <CalendarBlank size={16} css={css`color: ${theme.colors.text.hint};`} />
            Scheduled
          </Typography.BodyAlt>
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
            {scheduledTasks!.map((task: any) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </div>
        </section>
      )}

      {/* Deferred Tasks */}
      {hasDeferred && (
        <section>
          <button
            onClick={() => setShowDeferred(!showDeferred)}
            css={css`
              display: flex;
              align-items: center;
              gap: ${theme.spacing[2]};
              font-size: ${theme.typography.fontSize.base};
              font-weight: ${theme.typography.fontWeight.semibold};
              color: ${theme.colors.text.secondary};
              margin-bottom: ${showDeferred ? theme.spacing[4] : 0};
              cursor: pointer;
            `}
          >
            When available
            <Typography.Caption as="span" color="hint" css={css`font-weight: ${theme.typography.fontWeight.normal};`}>
              ({deferredTasks!.length})
            </Typography.Caption>
            {showDeferred
              ? <CaretUp size={14} css={css`color: ${theme.colors.text.hint};`} />
              : <CaretDown size={14} css={css`color: ${theme.colors.text.hint};`} />}
          </button>
          <AnimatePresence>
            {showDeferred && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                css={css`overflow: hidden;`}
              >
                <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
                  {deferredTasks!.map((task: any) => (
                    <TaskCard key={task.id} task={task} />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      )}

      {/* History (completed / failed / cancelled) */}
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
              {hasHistory ? (
                <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1]};`}>
                  {[...(completedTasks ?? []), ...(failedTasks ?? [])]
                    .sort((a: any, b: any) => {
                      const aTime = a.completedAt ?? a.updatedAt;
                      const bTime = b.completedAt ?? b.updatedAt;
                      return new Date(bTime).getTime() - new Date(aTime).getTime();
                    })
                    .map((task: any) => (
                      <HistoryTaskRow key={task.id} task={task} />
                    ))
                  }
                </div>
              ) : (
                <Typography.SmallBody color="hint" css={css`
                  padding: ${theme.spacing[4]} 0;
                `}>
                  No completed or failed tasks yet.
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
  if (diffMs < 0) {
    // Future time
    const absDiff = Math.abs(diffMs);
    if (absDiff < 60_000) return 'in a moment';
    const mins = Math.floor(absDiff / 60_000);
    if (mins < 60) return `in ${mins} min`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `in ${hours} hr`;
    const days = Math.floor(hours / 24);
    return `in ${days}d`;
  }
  if (diffMs < 60_000) return 'just now';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(isoString).toLocaleDateString();
}
