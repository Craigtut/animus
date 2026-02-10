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
} from '@phosphor-icons/react';
import { trpc } from '../../utils/trpc';
import { useHeartbeatStore, selectHasRunningAgents } from '../../store/index';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';

// ============================================================================
// Active Agents Section
// ============================================================================

function ActiveAgentsSection() {
  const theme = useTheme();

  // Live events from subscription (via Zustand)
  const agentEvents = useHeartbeatStore((s) => s.agentEvents);
  const hasRunning = useHeartbeatStore(selectHasRunningAgents);

  // Persisted active sessions from agent_logs.db
  const { data: activeSessions } = trpc.agentLogs.listSessions.useQuery(
    { limit: 10, status: 'active' },
    { retry: false, refetchInterval: hasRunning ? 10_000 : false },
  );

  // Derive running agents from live events
  const liveRunning = useMemo(() => {
    const spawned = new Map<string, (typeof agentEvents)[number]>();
    const chronological = [...agentEvents].reverse();
    for (const e of chronological) {
      if (e.type === 'spawned') spawned.set(e.taskId, e);
      else spawned.delete(e.taskId);
    }
    return Array.from(spawned.values());
  }, [agentEvents]);

  // Merge: prefer live events (richer timing), fall back to persisted sessions
  const persistedIds = new Set(activeSessions?.sessions.map((s) => s.id) ?? []);
  const displayAgents = liveRunning.length > 0
    ? liveRunning
    : (activeSessions?.sessions ?? []).map((s) => ({
        type: 'spawned' as const,
        taskId: s.id,
        detail: `${s.provider}${s.model ? ` / ${s.model}` : ''}`,
        receivedAt: new Date(s.startedAt).getTime(),
      }));

  // If we have live agents, also add any persisted ones not in live set
  const mergedAgents = liveRunning.length > 0
    ? [
        ...liveRunning,
        ...(activeSessions?.sessions ?? [])
          .filter((s) => !liveRunning.some((l) => l.taskId === s.id))
          .map((s) => ({
            type: 'spawned' as const,
            taskId: s.id,
            detail: `${s.provider}${s.model ? ` / ${s.model}` : ''}`,
            receivedAt: new Date(s.startedAt).getTime(),
          })),
      ]
    : displayAgents;

  void persistedIds; // consumed in merge logic

  return (
    <section>
      <div css={css`
        display: flex;
        align-items: center;
        gap: ${theme.spacing[2]};
        margin-bottom: ${theme.spacing[4]};
      `}>
        <Lightning size={20} css={css`color: ${theme.colors.text.secondary};`} />
        <h3 css={css`
          font-size: ${theme.typography.fontSize.base};
          font-weight: ${theme.typography.fontWeight.semibold};
        `}>
          Currently running
        </h3>
      </div>

      {mergedAgents.length === 0 ? (
        <p css={css`
          text-align: center;
          padding: ${theme.spacing[8]} 0;
          color: ${theme.colors.text.hint};
          font-size: ${theme.typography.fontSize.base};
        `}>
          Nothing running right now.
        </p>
      ) : (
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
          {mergedAgents.map((agent) => (
            <Card key={agent.taskId} variant="elevated" padding="md">
              <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                <Robot size={14} css={css`color: ${theme.colors.text.secondary};`} />
                <span css={css`
                  font-size: ${theme.typography.fontSize.base};
                  font-weight: ${theme.typography.fontWeight.semibold};
                  overflow: hidden;
                  text-overflow: ellipsis;
                  white-space: nowrap;
                `}>
                  {agent.taskId}
                </span>
                <div css={css`
                  width: 6px; height: 6px; border-radius: 50%;
                  background: ${theme.colors.success.main};
                  animation: agent-pulse 2000ms ease-in-out infinite;
                  flex-shrink: 0;

                  @keyframes agent-pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.4; }
                  }
                `} />
                <Badge variant="success">Running</Badge>
              </div>
              {agent.detail && (
                <p css={css`
                  margin-top: ${theme.spacing[2]};
                  font-size: ${theme.typography.fontSize.sm};
                  color: ${theme.colors.text.secondary};
                `}>
                  {agent.detail}
                </p>
              )}
              <p css={css`
                font-size: ${theme.typography.fontSize.xs};
                color: ${theme.colors.text.hint};
                margin-top: ${theme.spacing[1]};
              `}>
                Started {formatRelativeTime(agent.receivedAt)}
              </p>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

// ============================================================================
// Recent Activity Section (interspersed agent sessions + decisions)
// ============================================================================

/** Unified entry for the activity feed */
interface ActivityEntry {
  kind: 'agent' | 'decision';
  id: string;
  timestamp: number;
  // Agent fields
  sessionId?: string;
  provider?: string;
  model?: string | null;
  agentStatus?: string;
  startedAt?: string;
  endedAt?: string | null;
  // Decision fields
  tickNumber?: number;
  decisionType?: string;
  description?: string;
  outcome?: string;
  outcomeDetail?: string | null;
}

function RecentActivitySection() {
  const theme = useTheme();

  // Persisted completed/failed sessions
  const { data: recentSessions } = trpc.agentLogs.listSessions.useQuery(
    { limit: 20 },
    { retry: false },
  );

  // Recent tick decisions
  const { data: recentDecisions } = trpc.heartbeat.getRecentDecisions.useQuery(
    { limit: 30 },
    { retry: false },
  );

  // Merge and sort chronologically (newest first)
  const entries: ActivityEntry[] = useMemo(() => {
    const result: ActivityEntry[] = [];

    // Agent sessions (exclude active -- those are shown above)
    for (const s of recentSessions?.sessions ?? []) {
      if (s.status === 'active') continue;
      result.push({
        kind: 'agent',
        id: `agent-${s.id}`,
        timestamp: new Date(s.endedAt ?? s.startedAt).getTime(),
        sessionId: s.id,
        provider: s.provider,
        model: s.model,
        agentStatus: s.status,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
      });
    }

    // Decisions
    for (const d of recentDecisions ?? []) {
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
  }, [recentSessions, recentDecisions]);

  return (
    <section>
      <div css={css`
        display: flex;
        align-items: center;
        gap: ${theme.spacing[2]};
        margin-bottom: ${theme.spacing[4]};
      `}>
        <ClockCounterClockwise size={20} css={css`color: ${theme.colors.text.secondary};`} />
        <h3 css={css`
          font-size: ${theme.typography.fontSize.base};
          font-weight: ${theme.typography.fontWeight.semibold};
        `}>
          Recent
        </h3>
      </div>

      {entries.length === 0 ? (
        <Card variant="outlined" padding="md">
          <p css={css`
            color: ${theme.colors.text.hint};
            font-size: ${theme.typography.fontSize.sm};
          `}>
            Agent activity and decision logs will appear here as the system runs.
          </p>
        </Card>
      ) : (
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1]};`}>
          {entries.map((entry) =>
            entry.kind === 'agent' ? (
              <AgentActivityRow key={entry.id} entry={entry} />
            ) : (
              <DecisionActivityRow key={entry.id} entry={entry} />
            ),
          )}
        </div>
      )}
    </section>
  );
}

function AgentActivityRow({ entry }: { entry: ActivityEntry }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);

  const statusVariant =
    entry.agentStatus === 'completed' ? 'success' :
    entry.agentStatus === 'error' ? 'error' :
    entry.agentStatus === 'cancelled' ? 'warning' : 'default';

  const statusLabel =
    entry.agentStatus === 'completed' ? 'Completed' :
    entry.agentStatus === 'error' ? 'Failed' :
    entry.agentStatus === 'cancelled' ? 'Cancelled' : (entry.agentStatus ?? 'Unknown');

  // Compute duration if we have both timestamps
  const duration = entry.startedAt && entry.endedAt
    ? formatDuration(new Date(entry.startedAt).getTime(), new Date(entry.endedAt).getTime())
    : null;

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
          <span css={css`
            font-size: ${theme.typography.fontSize.sm};
            font-weight: ${theme.typography.fontWeight.medium};
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          `}>
            {entry.sessionId}
          </span>
          <Badge variant={statusVariant}>{statusLabel}</Badge>
          {duration && (
            <span css={css`font-size: ${theme.typography.fontSize.xs}; color: ${theme.colors.text.hint};`}>
              {duration}
            </span>
          )}
        </div>
        <div css={css`
          display: flex; align-items: center; gap: ${theme.spacing[2]};
          margin-top: ${theme.spacing[1]};
        `}>
          {entry.provider && (
            <span css={css`font-size: 11px; color: ${theme.colors.text.disabled};`}>
              {entry.provider}{entry.model ? ` / ${entry.model}` : ''}
            </span>
          )}
          <span css={css`font-size: ${theme.typography.fontSize.xs}; color: ${theme.colors.text.disabled};`}>
            {formatRelativeTime(entry.timestamp)}
          </span>
        </div>

        {expanded && entry.sessionId && (
          <AgentDetailExpanded sessionId={entry.sessionId} />
        )}
      </div>
      {expanded
        ? <CaretDown size={12} css={css`color: ${theme.colors.text.hint}; margin-top: 4px; flex-shrink: 0;`} />
        : <CaretRight size={12} css={css`color: ${theme.colors.text.hint}; margin-top: 4px; flex-shrink: 0;`} />
      }
    </div>
  );
}

/** Expanded detail for a single agent session: usage stats */
function AgentDetailExpanded({ sessionId }: { sessionId: string }) {
  const theme = useTheme();

  const { data: usage } = trpc.agentLogs.getSessionUsage.useQuery(
    { sessionId },
    { retry: false },
  );

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

function UsageStat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  const theme = useTheme();
  return (
    <div>
      <div css={css`font-size: 10px; color: ${theme.colors.text.disabled}; text-transform: uppercase; letter-spacing: 0.5px;`}>
        {label}
      </div>
      <div css={css`font-size: ${theme.typography.fontSize.sm}; color: ${theme.colors.text.secondary};`}>
        {value}{unit ? <span css={css`font-size: 10px; color: ${theme.colors.text.hint}; margin-left: 2px;`}>{unit}</span> : null}
      </div>
    </div>
  );
}

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
          <span css={css`
            font-size: ${theme.typography.fontSize.sm};
            font-weight: ${theme.typography.fontWeight.medium};
          `}>
            {formatDecisionType(entry.decisionType ?? '')}
          </span>
          <Badge variant={outcomeVariant}>{outcomeLabel}</Badge>
          {entry.tickNumber != null && (
            <span css={css`font-size: 10px; color: ${theme.colors.text.disabled};`}>
              tick #{entry.tickNumber}
            </span>
          )}
        </div>
        {entry.description && (
          <p css={css`
            font-size: ${theme.typography.fontSize.sm};
            color: ${theme.colors.text.secondary};
            margin-top: ${theme.spacing[1]};
            line-height: ${theme.typography.lineHeight.relaxed};
          `}>
            {entry.description}
          </p>
        )}
        {entry.outcomeDetail && (
          <p css={css`
            font-size: ${theme.typography.fontSize.xs};
            color: ${theme.colors.text.hint};
            margin-top: ${theme.spacing[1]};
            font-style: italic;
          `}>
            {entry.outcomeDetail}
          </p>
        )}
        <span css={css`
          font-size: ${theme.typography.fontSize.xs};
          color: ${theme.colors.text.disabled};
          margin-top: ${theme.spacing[1]};
          display: inline-block;
        `}>
          {formatRelativeTime(entry.timestamp)}
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// Usage Summary Section
// ============================================================================

function UsageSummarySection() {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);

  const { data: usage } = trpc.agentLogs.getAggregateUsage.useQuery(undefined, {
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
        <h3 css={css`
          font-size: ${theme.typography.fontSize.base};
          font-weight: ${theme.typography.fontWeight.semibold};
        `}>
          Usage
        </h3>
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
      <ActiveAgentsSection />
      <RecentActivitySection />
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
