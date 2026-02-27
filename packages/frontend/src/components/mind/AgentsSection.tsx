/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useMemo } from 'react';
import {
  Lightning,
  ClockCounterClockwise,
  Robot,
  TreeStructure,
  CaretDown,
  CaretRight,
  Coins,
  Brain,
  Wrench,
  ChatText,
  WarningCircle,
  X,
  ArrowClockwise,
} from '@phosphor-icons/react';
import { trpc } from '../../utils/trpc';
import { useHeartbeatStore, type SubAgentEventEntry } from '../../store/index';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Typography } from '../ui';

// ============================================================================
// Types
// ============================================================================

interface AgentTask {
  id: string;
  tickNumber: number;
  sessionId: string | null;
  provider: string;
  status: string;
  taskType: string;
  taskDescription: string;
  contactId: string | null;
  sourceChannel: string | null;
  currentActivity: string | null;
  result: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

/** Unified entry for the recent activity feed */
interface ActivityEntry {
  kind: 'agent' | 'decision';
  id: string;
  timestamp: number;
  // Agent fields
  task?: AgentTask;
  // Decision fields
  tickNumber?: number;
  decisionType?: string;
  description?: string;
  outcome?: string;
  outcomeDetail?: string | null;
}

// ============================================================================
// Active Sub-Agents Section
// ============================================================================

function ActiveSubAgentsSection() {
  const theme = useTheme();

  const { data: activeTasks } = trpc.heartbeat.listAgentTasks.useQuery(
    { activeOnly: true },
    { refetchInterval: 5_000 },
  );

  const tasks = (activeTasks ?? []) as unknown as AgentTask[];

  return (
    <section>
      <div css={css`
        display: flex;
        align-items: center;
        gap: ${theme.spacing[2]};
        margin-bottom: ${theme.spacing[4]};
      `}>
        <Lightning size={20} css={css`color: ${theme.colors.text.secondary};`} />
        <Typography.BodyAlt as="h3" css={css`
          font-weight: ${theme.typography.fontWeight.semibold};
        `}>
          Currently running
        </Typography.BodyAlt>
      </div>

      {tasks.length === 0 ? (
        <Typography.Body serif italic color="hint" css={css`
          text-align: center;
          padding: ${theme.spacing[8]} 0;
        `}>
          Nothing running right now.
        </Typography.Body>
      ) : (
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
          {tasks.map((task) => (
            <SubAgentCard key={task.id} task={task} />
          ))}
        </div>
      )}
    </section>
  );
}

// ============================================================================
// Sub-Agent Card (active tasks)
// ============================================================================

function SubAgentCard({ task }: { task: AgentTask }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const cancelMutation = trpc.heartbeat.cancelAgentTask.useMutation();

  const statusLabel = task.status === 'spawning' ? 'Spawning' : 'Running';

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    cancelMutation.mutate({ taskId: task.id });
  };

  const startedAt = task.startedAt ? new Date(task.startedAt).getTime() : new Date(task.createdAt).getTime();

  return (
    <Card variant="elevated" padding="md">
      <div
        css={css`cursor: pointer;`}
        onClick={() => setExpanded(!expanded)}
      >
        <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
          <Robot size={14} css={css`color: ${theme.colors.text.secondary};`} />
          <Typography.SmallBodyAlt as="span" css={css`
            font-weight: ${theme.typography.fontWeight.semibold};
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          `}>
            {formatTaskType(task.taskType)}
          </Typography.SmallBodyAlt>
          <div css={css`
            width: 6px; height: 6px; border-radius: 50%;
            background: ${task.status === 'spawning' ? theme.colors.warning.main : theme.colors.success.main};
            animation: agent-pulse 2000ms ease-in-out infinite;
            flex-shrink: 0;

            @keyframes agent-pulse {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.4; }
            }
          `} />
          <Badge variant={task.status === 'spawning' ? 'warning' : 'success'}>{statusLabel}</Badge>
          <button
            onClick={handleCancel}
            disabled={cancelMutation.isPending}
            css={css`
              display: flex; align-items: center; justify-content: center;
              width: 24px; height: 24px; border: none; border-radius: ${theme.borderRadius.default};
              background: transparent; cursor: pointer; flex-shrink: 0;
              color: ${theme.colors.text.hint};
              &:hover { background: ${theme.colors.error.main}1a; color: ${theme.colors.error.main}; }
            `}
            title="Cancel agent"
          >
            <X size={14} />
          </button>
          {expanded
            ? <CaretDown size={12} css={css`color: ${theme.colors.text.hint}; flex-shrink: 0;`} />
            : <CaretRight size={12} css={css`color: ${theme.colors.text.hint}; flex-shrink: 0;`} />
          }
        </div>

        <Typography.SmallBody color="secondary" css={css`
          margin-top: ${theme.spacing[2]};
        `}>
          {task.taskDescription}
        </Typography.SmallBody>

        {task.currentActivity && (
          <Typography.Caption serif italic color="hint" css={css`
            margin-top: ${theme.spacing[1]};
          `}>
            {task.currentActivity}
          </Typography.Caption>
        )}

        <div css={css`
          display: flex; align-items: center; gap: ${theme.spacing[2]};
          margin-top: ${theme.spacing[1]};
        `}>
          <Typography.Caption color="disabled">
            {task.provider}
          </Typography.Caption>
          <Typography.Caption color="disabled">
            {formatDuration(startedAt, Date.now())}
          </Typography.Caption>
        </div>
      </div>

      {expanded && task.sessionId && (
        <SubAgentEventTimeline sessionId={task.sessionId} isActive />
      )}
    </Card>
  );
}

// ============================================================================
// Sub-Agent Event Timeline
// ============================================================================

/** Event types to exclude from timeline (too noisy) */
const EXCLUDED_EVENT_TYPES = new Set(['response_chunk']);

function SubAgentEventTimeline({ sessionId, isActive, taskId }: {
  sessionId: string;
  isActive: boolean;
  taskId?: string;
}) {
  const theme = useTheme();

  // For active tasks: read live events from the store
  const liveEvents = useHeartbeatStore((s) => s.subAgentEvents.get(sessionId));

  // For completed tasks: fetch from backend on expand
  const { data: detail } = trpc.heartbeat.getAgentTaskDetail.useQuery(
    { taskId: taskId ?? '' },
    { enabled: !isActive && !!taskId },
  );

  const events = isActive
    ? (liveEvents ?? [])
    : (detail?.events ?? []) as SubAgentEventEntry[];

  const filtered = events.filter((e) => !EXCLUDED_EVENT_TYPES.has(e.eventType));

  if (filtered.length === 0) {
    return (
      <div css={css`
        margin-top: ${theme.spacing[3]};
        padding: ${theme.spacing[2]} ${theme.spacing[3]};
        background: ${theme.colors.background.elevated};
        border-radius: ${theme.borderRadius.default};
      `}>
        <Typography.Caption serif italic color="hint">
          {isActive ? 'Waiting for events...' : 'No events recorded.'}
        </Typography.Caption>
      </div>
    );
  }

  return (
    <div css={css`
      margin-top: ${theme.spacing[3]};
      padding: ${theme.spacing[2]} 0;
      border-top: 1px solid ${theme.colors.border.light};
      max-height: 300px;
      overflow-y: auto;
    `}>
      {filtered.map((event) => (
        <TimelineEventRow key={event.id} event={event} />
      ))}
    </div>
  );
}

function TimelineEventRow({ event }: { event: SubAgentEventEntry }) {
  const theme = useTheme();

  const { icon: Icon, label, detail } = getEventDisplay(event);

  return (
    <div css={css`
      display: flex; align-items: flex-start; gap: ${theme.spacing[2]};
      padding: ${theme.spacing[1]} ${theme.spacing[3]};
      font-size: ${theme.typography.fontSize.xs};
    `}>
      <Icon size={12} css={css`
        color: ${theme.colors.text.hint};
        margin-top: 2px;
        flex-shrink: 0;
      `} />
      <div css={css`flex: 1; min-width: 0;`}>
        <Typography.Caption as="span" color="secondary">{label}</Typography.Caption>
        {detail && (
          <Typography.Caption as="span" color="hint" css={css`margin-left: ${theme.spacing[1]};`}>
            {detail}
          </Typography.Caption>
        )}
      </div>
      <Typography.Caption color="disabled" css={css`flex-shrink: 0; white-space: nowrap;`}>
        {formatTimeOnly(event.createdAt)}
      </Typography.Caption>
    </div>
  );
}

function getEventDisplay(event: SubAgentEventEntry): {
  icon: typeof Brain;
  label: string;
  detail: string;
} {
  const data = event.data ?? {};

  switch (event.eventType) {
    case 'thinking_start':
    case 'thinking_end':
      return {
        icon: Brain,
        label: 'Thinking',
        detail: (data['text'] as string)?.slice(0, 80) ?? '',
      };
    case 'tool_call_start':
      return {
        icon: Wrench,
        label: `Tool: ${(data['toolName'] as string) ?? 'unknown'}`,
        detail: '',
      };
    case 'tool_call_end':
    case 'tool_error':
      return {
        icon: Wrench,
        label: `Tool result`,
        detail: (data['error'] as string) ? `Error: ${(data['error'] as string).slice(0, 60)}` : 'OK',
      };
    case 'response_start':
    case 'response_chunk':
    case 'response_end':
      return {
        icon: ChatText,
        label: 'Response',
        detail: (data['text'] as string)?.slice(0, 80) ?? '',
      };
    case 'error':
      return {
        icon: WarningCircle,
        label: 'Error',
        detail: (data['message'] as string)?.slice(0, 80) ?? (data['error'] as string)?.slice(0, 80) ?? '',
      };
    case 'tick_input':
      return {
        icon: ArrowClockwise,
        label: 'Tick input',
        detail: `tick #${data['tickNumber'] ?? '?'}`,
      };
    case 'tick_output':
      return {
        icon: ArrowClockwise,
        label: 'Tick output',
        detail: data['durationMs'] ? `${Math.round(data['durationMs'] as number / 1000)}s` : '',
      };
    default:
      return {
        icon: Robot,
        label: formatEventType(event.eventType),
        detail: '',
      };
  }
}

// ============================================================================
// Recent Sub-Agents Section (completed/failed/timed_out + decisions)
// ============================================================================

function RecentSubAgentsSection() {
  const theme = useTheme();

  const { data: recentTasks } = trpc.heartbeat.listAgentTasks.useQuery(
    { limit: 20 },
  );

  const { data: recentDecisions } = trpc.heartbeat.getRecentDecisions.useQuery(
    { limit: 30 },
    { retry: false },
  );

  const entries: ActivityEntry[] = useMemo(() => {
    const result: ActivityEntry[] = [];
    const tasks = (recentTasks ?? []) as unknown as AgentTask[];

    // Agent tasks (exclude active statuses — those show above)
    for (const task of tasks) {
      if (task.status === 'spawning' || task.status === 'running') continue;
      result.push({
        kind: 'agent',
        id: `agent-${task.id}`,
        timestamp: new Date(task.completedAt ?? task.createdAt).getTime(),
        task,
      });
    }

    // Only show agent-related decisions (not generic mind decisions like no_action, send_reaction)
    const agentDecisionTypes = new Set(['spawn_agent', 'update_agent', 'cancel_agent']);
    for (const d of recentDecisions ?? []) {
      if (!agentDecisionTypes.has(d.type)) continue;
      result.push({
        kind: 'decision',
        id: `decision-${d.id}`,
        timestamp: new Date(d.createdAt).getTime(),
        tickNumber: d.tickNumber,
        decisionType: d.type,
        description: d.description,
        outcome: d.outcome,
        outcomeDetail: d.outcomeDetail,
      });
    }

    result.sort((a, b) => b.timestamp - a.timestamp);
    return result;
  }, [recentTasks, recentDecisions]);

  return (
    <section>
      <div css={css`
        display: flex;
        align-items: center;
        gap: ${theme.spacing[2]};
        margin-bottom: ${theme.spacing[4]};
      `}>
        <ClockCounterClockwise size={20} css={css`color: ${theme.colors.text.secondary};`} />
        <Typography.BodyAlt as="h3" css={css`
          font-weight: ${theme.typography.fontWeight.semibold};
        `}>
          Recent
        </Typography.BodyAlt>
      </div>

      {entries.length === 0 ? (
        <Card variant="outlined" padding="md">
          <Typography.SmallBody serif italic color="hint">
            Agent activity and decision logs will appear here as the system runs.
          </Typography.SmallBody>
        </Card>
      ) : (
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1]};`}>
          {entries.map((entry) =>
            entry.kind === 'agent' ? (
              <SubAgentRow key={entry.id} task={entry.task!} />
            ) : (
              <DecisionActivityRow key={entry.id} entry={entry} />
            ),
          )}
        </div>
      )}
    </section>
  );
}

// ============================================================================
// Sub-Agent Row (completed tasks)
// ============================================================================

function SubAgentRow({ task }: { task: AgentTask }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);

  const statusVariant =
    task.status === 'completed' ? 'success' :
    task.status === 'failed' ? 'error' :
    task.status === 'cancelled' ? 'warning' :
    task.status === 'timed_out' ? 'error' : 'default';

  const statusLabel =
    task.status === 'completed' ? 'Completed' :
    task.status === 'failed' ? 'Failed' :
    task.status === 'cancelled' ? 'Cancelled' :
    task.status === 'timed_out' ? 'Timed Out' : task.status;

  const startMs = task.startedAt ? new Date(task.startedAt).getTime() : new Date(task.createdAt).getTime();
  const endMs = task.completedAt ? new Date(task.completedAt).getTime() : Date.now();
  const duration = formatDuration(startMs, endMs);

  return (
    <div
      css={css`
        display: flex;
        align-items: flex-start;
        gap: ${theme.spacing[2]};
        padding: ${theme.spacing[3]} ${theme.spacing[2]};
        border-bottom: 1px solid ${theme.colors.border.light};
        cursor: pointer;

        &:hover { background: ${theme.colors.background.elevated}; }
        &:last-of-type { border-bottom: none; }
      `}
      onClick={() => setExpanded(!expanded)}
    >
      <Robot size={14} css={css`
        color: ${theme.colors.text.hint};
        margin-top: 3px;
        flex-shrink: 0;
      `} />
      <div css={css`flex: 1; min-width: 0;`}>
        <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]}; flex-wrap: wrap;`}>
          <Typography.SmallBodyAlt as="span" css={css`
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          `}>
            {formatTaskType(task.taskType)}
          </Typography.SmallBodyAlt>
          <Badge variant={statusVariant}>{statusLabel}</Badge>
          {duration && (
            <Typography.Caption color="hint">
              {duration}
            </Typography.Caption>
          )}
        </div>
        <Typography.SmallBody color="secondary" css={css`
          margin-top: ${theme.spacing[1]};
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        `}>
          {task.taskDescription}
        </Typography.SmallBody>
        <div css={css`
          display: flex; align-items: center; gap: ${theme.spacing[2]};
          margin-top: ${theme.spacing[1]};
        `}>
          <Typography.Caption color="disabled">
            {task.provider}
          </Typography.Caption>
          <Typography.Caption color="disabled">
            {formatRelativeTime(new Date(task.completedAt ?? task.createdAt).getTime())}
          </Typography.Caption>
        </div>

        {expanded && task.sessionId && (
          <SubAgentEventTimeline sessionId={task.sessionId} isActive={false} taskId={task.id} />
        )}
        {expanded && (
          <TaskUsageDetail taskId={task.id} />
        )}
      </div>
      {expanded
        ? <CaretDown size={12} css={css`color: ${theme.colors.text.hint}; margin-top: 4px; flex-shrink: 0;`} />
        : <CaretRight size={12} css={css`color: ${theme.colors.text.hint}; margin-top: 4px; flex-shrink: 0;`} />
      }
    </div>
  );
}

/** Usage stats for a completed sub-agent task */
function TaskUsageDetail({ taskId }: { taskId: string }) {
  const theme = useTheme();

  const { data: detail } = trpc.heartbeat.getAgentTaskDetail.useQuery(
    { taskId },
    { retry: false },
  );

  const usage = detail?.usage;
  if (!usage || usage.length === 0) return null;

  const totals = usage.reduce(
    (acc, u) => ({
      input: acc.input + u.inputTokens,
      output: acc.output + u.outputTokens,
      total: acc.total + u.totalTokens,
      cost: acc.cost + (u.costUsd ?? 0),
    }),
    { input: 0, output: 0, total: 0, cost: 0 },
  );

  return (
    <div css={css`
      margin-top: ${theme.spacing[2]};
      padding: ${theme.spacing[2]} ${theme.spacing[3]};
      background: ${theme.colors.background.elevated};
      border-radius: ${theme.borderRadius.default};
      display: flex; gap: ${theme.spacing[4]}; flex-wrap: wrap;
    `}>
      <UsageStat label="Input" value={totals.input.toLocaleString()} unit="tokens" />
      <UsageStat label="Output" value={totals.output.toLocaleString()} unit="tokens" />
      <UsageStat label="Total" value={totals.total.toLocaleString()} unit="tokens" />
      {totals.cost > 0 && (
        <UsageStat label="Cost" value={`$${totals.cost.toFixed(4)}`} />
      )}
    </div>
  );
}

// ============================================================================
// Decision Activity Row (kept from previous implementation)
// ============================================================================

function DecisionActivityRow({ entry }: { entry: ActivityEntry }) {
  const theme = useTheme();

  const outcomeVariant =
    entry.outcome === 'executed' ? 'success' :
    entry.outcome === 'dropped' ? 'warning' :
    entry.outcome === 'failed' ? 'error' : 'default';

  const outcomeLabel =
    entry.outcome === 'executed' ? 'Executed' :
    entry.outcome === 'dropped' ? 'Dropped' :
    entry.outcome === 'failed' ? 'Failed' : (entry.outcome ?? 'Unknown');

  return (
    <div css={css`
      display: flex;
      align-items: flex-start;
      gap: ${theme.spacing[2]};
      padding: ${theme.spacing[3]} ${theme.spacing[2]};
      border-bottom: 1px solid ${theme.colors.border.light};

      &:last-of-type { border-bottom: none; }
    `}>
      <TreeStructure size={14} css={css`
        color: ${theme.colors.text.hint};
        margin-top: 3px;
        flex-shrink: 0;
      `} />
      <div css={css`flex: 1; min-width: 0;`}>
        <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]}; flex-wrap: wrap;`}>
          <Typography.SmallBodyAlt as="span">
            {formatDecisionType(entry.decisionType ?? '')}
          </Typography.SmallBodyAlt>
          <Badge variant={outcomeVariant}>{outcomeLabel}</Badge>
          {entry.tickNumber != null && (
            <Typography.Caption color="disabled">
              tick #{entry.tickNumber}
            </Typography.Caption>
          )}
        </div>
        {entry.description && (
          <Typography.SmallBody color="secondary" css={css`
            margin-top: ${theme.spacing[1]};
          `}>
            {entry.description}
          </Typography.SmallBody>
        )}
        {entry.outcomeDetail && (
          <Typography.Caption serif italic color="hint" css={css`
            margin-top: ${theme.spacing[1]};
          `}>
            {entry.outcomeDetail}
          </Typography.Caption>
        )}
        <Typography.Caption as="span" color="disabled" css={css`
          margin-top: ${theme.spacing[1]};
          display: inline-block;
        `}>
          {formatRelativeTime(entry.timestamp)}
        </Typography.Caption>
      </div>
    </div>
  );
}

// ============================================================================
// Usage Summary Section (kept as-is)
// ============================================================================

function UsageStat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div>
      <Typography.Caption as="div" color="disabled" css={css`text-transform: uppercase; letter-spacing: 0.5px;`}>
        {label}
      </Typography.Caption>
      <Typography.SmallBody as="div" color="secondary">
        {value}{unit ? <Typography.Caption as="span" color="hint" css={css`margin-left: 2px;`}>{unit}</Typography.Caption> : null}
      </Typography.SmallBody>
    </div>
  );
}

function UsageSummarySection() {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);

  const { data: usage } = trpc.heartbeat.getSubAgentUsage.useQuery(undefined, {
    retry: false,
  });

  if (!usage || usage.totalTokens === 0) return null;

  return (
    <section>
      <div
        css={css`
          display: flex;
          align-items: center;
          gap: ${theme.spacing[2]};
          margin-bottom: ${theme.spacing[4]};
          cursor: pointer;
        `}
        onClick={() => setExpanded(!expanded)}
      >
        <Coins size={20} css={css`color: ${theme.colors.text.secondary};`} />
        <Typography.BodyAlt as="h3" css={css`
          font-weight: ${theme.typography.fontWeight.semibold};
        `}>
          Usage
        </Typography.BodyAlt>
        {expanded
          ? <CaretDown size={14} css={css`color: ${theme.colors.text.hint};`} />
          : <CaretRight size={14} css={css`color: ${theme.colors.text.hint};`} />
        }
      </div>

      {expanded && (
        <Card variant="outlined" padding="md">
          <div css={css`
            display: flex; gap: ${theme.spacing[6]}; flex-wrap: wrap;
          `}>
            <UsageStat label="Sessions" value={usage.sessionCount.toLocaleString()} />
            <UsageStat label="Input tokens" value={usage.totalInputTokens.toLocaleString()} />
            <UsageStat label="Output tokens" value={usage.totalOutputTokens.toLocaleString()} />
            <UsageStat label="Total tokens" value={usage.totalTokens.toLocaleString()} />
            {usage.totalCostUsd > 0 && (
              <UsageStat label="Total cost" value={`$${usage.totalCostUsd.toFixed(4)}`} />
            )}
          </div>
        </Card>
      )}
    </section>
  );
}

// ============================================================================
// Agents Section (composed)
// ============================================================================

export function AgentsSection() {
  const theme = useTheme();

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[8]};`}>
      <ActiveSubAgentsSection />
      <RecentSubAgentsSection />
      <UsageSummarySection />
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  if (diffMs < 60_000) return 'just now';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function formatDuration(startMs: number, endMs: number): string {
  const diffMs = endMs - startMs;
  if (diffMs < 60_000) return `${Math.round(diffMs / 1000)}s`;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return remainMins > 0 ? `${hours}h ${remainMins}m` : `${hours}h`;
}

function formatDecisionType(type: string): string {
  return type
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatTaskType(type: string): string {
  return type
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatEventType(type: string): string {
  return type
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatTimeOnly(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}
