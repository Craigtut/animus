/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useMemo } from 'react';
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
  Timer,
  Tray,
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

// ============================================================================
// Cron → Human-Readable
// ============================================================================

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FULL_DAY_NAMES = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

/**
 * Parse common cron patterns into human-readable text.
 * Falls back to showing the raw expression for complex patterns.
 */
function humanizeCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  const formatTime = (h: string, m: string): string => {
    const hourNum = parseInt(h, 10);
    const minNum = parseInt(m, 10);
    if (isNaN(hourNum) || isNaN(minNum)) return '';
    const period = hourNum >= 12 ? 'PM' : 'AM';
    const displayHour = hourNum === 0 ? 12 : hourNum > 12 ? hourNum - 12 : hourNum;
    return `${displayHour}:${minNum.toString().padStart(2, '0')} ${period}`;
  };

  // Detect interval patterns like */3
  const isInterval = (s: string) => s.startsWith('*/');
  const intervalVal = (s: string) => parseInt(s.slice(2), 10);

  const hasSpecificTime = minute !== '*' && hour !== '*' && !isInterval(hour!) && !isInterval(minute!);
  const timeStr = hasSpecificTime ? formatTime(hour!, minute!) : '';

  // Every minute / every hour
  if (cron === '* * * * *') return 'Every minute';
  if (minute !== '*' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Every hour at :${minute!.padStart(2, '0')}`;
  }

  // Interval hours: "0 */3 * * *" → "Every 3 hours"
  if (isInterval(hour!) && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const n = intervalVal(hour!);
    return n === 1 ? 'Every hour' : `Every ${n} hours`;
  }

  // Interval minutes: "*/15 * * * *" → "Every 15 minutes"
  if (isInterval(minute!) && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const n = intervalVal(minute!);
    return n === 1 ? 'Every minute' : `Every ${n} minutes`;
  }

  // Daily: specific time, all days
  if (hasSpecificTime && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Daily at ${timeStr}`;
  }

  // Specific weekday(s)
  if (hasSpecificTime && dayOfMonth === '*' && month === '*' && dayOfWeek !== '*') {
    const days = dayOfWeek!.split(',').map(d => {
      const num = parseInt(d, 10);
      return isNaN(num) ? d : FULL_DAY_NAMES[num] ?? d;
    });
    if (days.length === 1) {
      return `${days[0]} at ${timeStr}`;
    }
    return `${days.join(', ')} at ${timeStr}`;
  }

  // Specific day of month
  if (hasSpecificTime && dayOfMonth !== '*' && month === '*' && dayOfWeek === '*') {
    const dom = parseInt(dayOfMonth!, 10);
    const suffix = dom === 1 || dom === 21 || dom === 31 ? 'st'
      : dom === 2 || dom === 22 ? 'nd'
      : dom === 3 || dom === 23 ? 'rd' : 'th';
    return `${dom}${suffix} of each month at ${timeStr}`;
  }

  // Fallback: show time if we have it
  if (hasSpecificTime) return `${timeStr} (${cron})`;
  return cron;
}

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

  // Build the schedule description line
  const scheduleDescription = useMemo(() => {
    if (task.scheduleType === 'deferred') return null;

    if (task.scheduleType === 'recurring' && task.cronExpression) {
      return humanizeCron(task.cronExpression);
    }

    if (task.nextRunAt) {
      return formatScheduleTime(task.nextRunAt);
    }

    if (task.scheduledAt) {
      return formatScheduleTime(task.scheduledAt);
    }

    return null;
  }, [task.scheduleType, task.cronExpression, task.nextRunAt, task.scheduledAt]);

  // Next run (for recurring tasks that also have a nextRunAt)
  const nextRunLabel = useMemo(() => {
    if (task.scheduleType !== 'recurring' || !task.nextRunAt) return null;
    return formatScheduleTime(task.nextRunAt);
  }, [task.scheduleType, task.nextRunAt]);

  // Priority drives the accent bar opacity (0.1 at 0, 0.8 at 1)
  const priority = (task.priority as number) ?? 0.5;
  const accentOpacity = 0.15 + priority * 0.65;

  // Schedule type icon
  const ScheduleIcon = task.scheduleType === 'recurring' ? ArrowClockwise
    : task.scheduleType === 'deferred' ? Tray
    : Timer;

  return (
    <div
      onClick={() => setExpanded(!expanded)}
      css={css`
        display: flex;
        border-radius: ${theme.borderRadius.md};
        background: ${theme.colors.background.paper};
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        overflow: hidden;
        cursor: pointer;
        position: relative;
        transition: transform ${theme.transitions.fast};
        &:hover { transform: scale(1.005); }
        /* Rim lighting */
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
      `}
    >
      {/* Card content */}
      <div css={css`
        flex: 1;
        min-width: 0;
        padding: ${theme.spacing[4]} ${theme.spacing[5]};
      `}>
        {/* Row 1: Title + status badge + caret */}
        <div css={css`
          display: flex;
          align-items: center;
          gap: ${theme.spacing[2]};
        `}>
          <Typography.Body as="h4" serif css={css`
            flex: 1;
            min-width: 0;
            font-weight: ${theme.typography.fontWeight.semibold};
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          `}>
            {task.title}
          </Typography.Body>
          <Badge variant={STATUS_BADGE[task.status] ?? 'default'} css={css`flex-shrink: 0;`}>
            {task.status === 'in_progress' ? 'active' : task.status}
          </Badge>
          {expanded
            ? <CaretUp size={14} css={css`color: ${theme.colors.text.disabled}; flex-shrink: 0;`} />
            : <CaretDown size={14} css={css`color: ${theme.colors.text.disabled}; flex-shrink: 0;`} />}
        </div>

        {/* Row 2: Schedule line — the key info at a glance */}
        {(scheduleDescription || task.scheduleType === 'deferred') && (
          <div css={css`
            display: flex;
            align-items: center;
            gap: ${theme.spacing[1.5]};
            margin-top: ${theme.spacing[1.5]};
          `}>
            <ScheduleIcon size={11} css={css`
              color: ${theme.colors.text.disabled};
              flex-shrink: 0;
            `} />
            <Typography.Caption color="hint" css={css`
              font-size: 0.7rem;
            `}>
              {scheduleDescription ?? 'Runs when available'}
            </Typography.Caption>
            {nextRunLabel && scheduleDescription !== nextRunLabel && (
              <Typography.Caption color="disabled" css={css`
                font-size: 0.7rem;
                &::before { content: '·'; margin-right: ${theme.spacing[1.5]}; }
              `}>
                Next: {nextRunLabel}
              </Typography.Caption>
            )}
          </div>
        )}

        {/* Expanded detail panel */}
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
                display: flex;
                flex-direction: column;
                gap: ${theme.spacing[3]};
              `}>
                {task.description && (
                  <Typography.SmallBody color="secondary">
                    {task.description}
                  </Typography.SmallBody>
                )}

                {task.instructions && (
                  <Typography.SmallBody serif italic color="hint">
                    {task.instructions}
                  </Typography.SmallBody>
                )}

                {/* Goal linkage */}
                {task.goalId && (
                  <Typography.Caption color="hint">
                    Linked to goal
                  </Typography.Caption>
                )}

                {/* Last error */}
                {task.lastError && (
                  <div css={css`
                    display: flex; align-items: flex-start; gap: ${theme.spacing[2]};
                    padding: ${theme.spacing[2]} ${theme.spacing[3]};
                    border-radius: ${theme.borderRadius.sm};
                    background: ${theme.colors.error.main}0d;
                  `}>
                    <Warning size={13} css={css`color: ${theme.colors.error.main}; flex-shrink: 0; margin-top: 1px;`} />
                    <Typography.Caption css={css`color: ${theme.colors.error.main};`}>
                      {task.lastError}
                    </Typography.Caption>
                  </div>
                )}

                {/* Task Runs */}
                {taskRuns && taskRuns.length > 0 && (
                  <div>
                    <Typography.Caption color="hint" css={css`
                      display: block;
                      margin-bottom: ${theme.spacing[2]};
                    `}>
                      Recent runs ({taskRuns.length})
                    </Typography.Caption>
                    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1]};`}>
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

                {/* Meta row: priority + timestamps */}
                <div css={css`
                  display: flex;
                  align-items: center;
                  gap: ${theme.spacing[3]};
                  flex-wrap: wrap;
                  opacity: 0.45;
                `}>
                  <Typography.Caption css={css`font-size: 0.65rem;`}>
                    Priority {(priority * 10).toFixed(0)}/10
                  </Typography.Caption>
                  <Typography.Caption css={css`font-size: 0.65rem;`}>
                    Created {formatRelativeTime(task.createdAt)}
                  </Typography.Caption>
                  {task.startedAt && (
                    <Typography.Caption css={css`font-size: 0.65rem;`}>
                      Started {formatRelativeTime(task.startedAt)}
                    </Typography.Caption>
                  )}
                  {task.completedAt && (
                    <Typography.Caption css={css`font-size: 0.65rem;`}>
                      Completed {formatRelativeTime(task.completedAt)}
                    </Typography.Caption>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
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
      {isFailed && (
        <Badge variant="error" css={css`flex-shrink: 0;`}>failed</Badge>
      )}
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

  // Filter out deferred tasks from the scheduled list (they show in their own section)
  const nonDeferredScheduled = useMemo(() =>
    scheduledTasks?.filter((t: any) => t.scheduleType !== 'deferred') ?? [],
    [scheduledTasks],
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
  const hasScheduled = nonDeferredScheduled.length > 0;
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
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
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
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
            {nonDeferredScheduled.map((task: any) => (
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
                <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
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
  if (diffMs < 60_000) return 'just now';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(isoString).toLocaleDateString();
}

/**
 * Format a schedule time as a human-readable string.
 * "Today at 2:30 PM", "Tomorrow at 9:00 AM", "Wed at 3:00 PM", "Feb 20 at 10:00 AM"
 */
function formatScheduleTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();

  const timeStr = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  if (diffMs < 0) {
    return `overdue (${timeStr})`;
  }

  const isToday = date.toDateString() === now.toDateString();
  if (isToday) return `Today at ${timeStr}`;

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (date.toDateString() === tomorrow.toDateString()) return `Tomorrow at ${timeStr}`;

  const daysAway = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (daysAway <= 6) {
    const dayName = date.toLocaleDateString(undefined, { weekday: 'short' });
    return `${dayName} at ${timeStr}`;
  }

  const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${dateStr} at ${timeStr}`;
}
