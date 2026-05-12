/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useMemo, useCallback } from 'react';
import { motion } from 'motion/react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';
import {
  CurrencyDollar,
  Coins,
  Lightning,
  Heartbeat,
  ArrowsClockwise,
  Export,
  CaretUp,
  CaretDown,
} from '@phosphor-icons/react';
import type { Theme } from '../styles/theme';
import type {
  TimeWindow,
  BreakdownDimension,
  UsageTimeSeriesBucket,
  UsageBreakdownRow,
  BudgetStatus,
  CacheStats,
  UsageTotals,
} from '@animus-labs/shared';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Toggle } from '../components/ui/Toggle';
import { Typography } from '../components/ui/Typography';
import { Select } from '../components/ui/Select';
import { trpc } from '../utils/trpc';

// ============================================================================
// Formatting helpers
// ============================================================================

function formatCost(usd: number): string {
  if (usd < 0.01 && usd > 0) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatPercent(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function formatDateLabel(isoString: string, timeWindow: TimeWindow): string {
  const d = new Date(isoString);
  if (timeWindow === '1h' || timeWindow === '12h' || timeWindow === '24h') {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatDimensionLabel(dimension: string, value: string): string {
  if (dimension === 'tick_type') {
    const labels: Record<string, string> = {
      message: 'Message',
      interval: 'Interval',
      scheduled_task: 'Scheduled Task',
      agent_complete: 'Agent Complete',
      plugin_trigger: 'Plugin Trigger',
    };
    return labels[value] || value;
  }
  if (dimension === 'pipeline_phase') {
    const labels: Record<string, string> = {
      thought: 'Thought',
      agentic_loop: 'Agentic Loop',
      reflect: 'Reflect',
    };
    return labels[value] || value;
  }
  return value;
}

// ============================================================================
// Chart color palette (works in both light and dark mode)
// ============================================================================

const CHART_COLORS = {
  area: 'rgba(99, 102, 241, 0.7)',     // indigo
  areaFill: 'rgba(99, 102, 241, 0.12)',
  input: '#6366f1',                      // indigo
  output: '#8b5cf6',                     // purple
  cacheRead: '#10b981',                  // emerald
  cacheWrite: '#f59e0b',                 // amber
};

// ============================================================================
// Time Window Selector
// ============================================================================

const TIME_WINDOWS: TimeWindow[] = ['1h', '12h', '24h', '7d', '30d', '90d'];

function TimeWindowSelector({
  value,
  onChange,
}: {
  value: TimeWindow;
  onChange: (v: TimeWindow) => void;
}) {
  const theme = useTheme();

  return (
    <div
      css={css`
        display: flex;
        gap: ${theme.spacing[1]};
        padding: ${theme.spacing[1]};
        border-radius: ${theme.borderRadius.full};
        background: ${theme.colors.background.paper};
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid ${theme.colors.border.light};
        width: fit-content;
      `}
    >
      {TIME_WINDOWS.map((w) => {
        const isActive = w === value;
        return (
          <button
            key={w}
            onClick={() => onChange(w)}
            css={css`
              position: relative;
              padding: ${theme.spacing[1.5]} ${theme.spacing[3]};
              border-radius: ${theme.borderRadius.full};
              font-size: ${theme.typography.fontSize.sm};
              font-weight: ${isActive
                ? theme.typography.fontWeight.semibold
                : theme.typography.fontWeight.normal};
              color: ${isActive ? theme.colors.accentForeground : theme.colors.text.secondary};
              background: ${isActive ? theme.colors.accent : 'transparent'};
              border: none;
              cursor: pointer;
              transition: all ${theme.transitions.fast};
              font-family: ${theme.typography.fontFamily.mono};
              white-space: nowrap;

              &:hover {
                color: ${isActive ? theme.colors.accentForeground : theme.colors.text.primary};
                ${!isActive ? `background: ${theme.colors.background.elevated};` : ''}
              }
            `}
          >
            {w}
          </button>
        );
      })}
    </div>
  );
}

// ============================================================================
// Stat Card
// ============================================================================

function StatCard({
  label,
  value,
  subtitle,
  icon: Icon,
}: {
  label: string;
  value: string;
  subtitle?: string;
  icon: React.ComponentType<any>;
}) {
  const theme = useTheme();

  return (
    <Card variant="elevated" padding="md">
      <div
        css={css`
          display: flex;
          flex-direction: column;
          gap: ${theme.spacing[2]};
        `}
      >
        <div
          css={css`
            display: flex;
            align-items: center;
            gap: ${theme.spacing[2]};
          `}
        >
          <Icon size={16} />
          <Typography.Caption color="secondary">{label}</Typography.Caption>
        </div>
        <div
          css={css`
            font-family: ${theme.typography.fontFamily.mono};
            font-size: ${theme.typography.fontSize['2xl']};
            font-weight: ${theme.typography.fontWeight.semibold};
            color: ${theme.colors.text.primary};
            line-height: ${theme.typography.lineHeight.tight};
          `}
        >
          {value}
        </div>
        {subtitle && (
          <Typography.Caption color="hint">{subtitle}</Typography.Caption>
        )}
      </div>
    </Card>
  );
}

// ============================================================================
// Cost Chart
// ============================================================================

function CostChart({
  data,
  timeWindow,
  theme,
}: {
  data: UsageTimeSeriesBucket[];
  timeWindow: TimeWindow;
  theme: Theme;
}) {
  const chartData = useMemo(
    () =>
      data.map((b) => ({
        ...b,
        label: formatDateLabel(b.timestamp, timeWindow),
      })),
    [data, timeWindow],
  );

  if (chartData.length === 0) {
    return (
      <div
        css={css`
          height: 200px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: ${theme.colors.text.hint};
          font-size: ${theme.typography.fontSize.sm};
        `}
      >
        No data for this period
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_COLORS.area} stopOpacity={0.3} />
            <stop offset="100%" stopColor={CHART_COLORS.area} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid
          stroke={theme.colors.border.light}
          strokeDasharray="3 3"
          vertical={false}
        />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: theme.colors.text.hint, fontFamily: theme.typography.fontFamily.mono }}
          axisLine={false}
          tickLine={false}
          dy={8}
        />
        <YAxis
          tick={{ fontSize: 11, fill: theme.colors.text.hint, fontFamily: theme.typography.fontFamily.mono }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => `$${v.toFixed(2)}`}
          width={56}
        />
        <RechartsTooltip
          contentStyle={{
            background: theme.mode === 'light' ? 'rgba(255,255,255,0.92)' : 'rgba(28,26,24,0.92)',
            border: `1px solid ${theme.colors.border.default}`,
            borderRadius: theme.borderRadius.default,
            fontFamily: theme.typography.fontFamily.mono,
            fontSize: theme.typography.fontSize.xs,
            color: theme.colors.text.primary,
            backdropFilter: 'blur(12px)',
          }}
          formatter={(value: any) => [`$${Number(value).toFixed(4)}`, 'Cost']}
          labelFormatter={(label: any) => String(label)}
        />
        <Area
          type="monotone"
          dataKey="costUsd"
          stroke={CHART_COLORS.area}
          strokeWidth={2}
          fill="url(#costGradient)"
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0, fill: CHART_COLORS.area }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ============================================================================
// Token Chart
// ============================================================================

function TokenChart({
  data,
  timeWindow,
  theme,
}: {
  data: UsageTimeSeriesBucket[];
  timeWindow: TimeWindow;
  theme: Theme;
}) {
  const chartData = useMemo(
    () =>
      data.map((b) => ({
        ...b,
        label: formatDateLabel(b.timestamp, timeWindow),
      })),
    [data, timeWindow],
  );

  if (chartData.length === 0) {
    return (
      <div
        css={css`
          height: 200px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: ${theme.colors.text.hint};
          font-size: ${theme.typography.fontSize.sm};
        `}
      >
        No data for this period
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid
          stroke={theme.colors.border.light}
          strokeDasharray="3 3"
          vertical={false}
        />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: theme.colors.text.hint, fontFamily: theme.typography.fontFamily.mono }}
          axisLine={false}
          tickLine={false}
          dy={8}
        />
        <YAxis
          tick={{ fontSize: 11, fill: theme.colors.text.hint, fontFamily: theme.typography.fontFamily.mono }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => formatTokens(v)}
          width={56}
        />
        <RechartsTooltip
          contentStyle={{
            background: theme.mode === 'light' ? 'rgba(255,255,255,0.92)' : 'rgba(28,26,24,0.92)',
            border: `1px solid ${theme.colors.border.default}`,
            borderRadius: theme.borderRadius.default,
            fontFamily: theme.typography.fontFamily.mono,
            fontSize: theme.typography.fontSize.xs,
            color: theme.colors.text.primary,
            backdropFilter: 'blur(12px)',
          }}
          formatter={(value: any, name: any) => [formatTokens(Number(value)), String(name)]}
        />
        <Legend
          wrapperStyle={{
            fontSize: theme.typography.fontSize.xs,
            fontFamily: theme.typography.fontFamily.mono,
          }}
        />
        <Bar dataKey="cacheReadTokens" name="Cache Read" fill={CHART_COLORS.cacheRead} radius={[2, 2, 0, 0]} barSize={10} />
        <Bar dataKey="cacheWriteTokens" name="Cache Write" fill={CHART_COLORS.cacheWrite} radius={[2, 2, 0, 0]} barSize={10} />
        <Bar dataKey="inputTokens" name="Input (uncached)" fill={CHART_COLORS.input} radius={[2, 2, 0, 0]} barSize={10} />
        <Bar dataKey="outputTokens" name="Output" fill={CHART_COLORS.output} radius={[2, 2, 0, 0]} barSize={10} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ============================================================================
// Budget Card
// ============================================================================

function BudgetCard({
  status,
}: {
  status: BudgetStatus | undefined;
}) {
  const theme = useTheme();
  const [editing, setEditing] = useState(false);
  const [budgetInput, setBudgetInput] = useState('');

  const setBudgetMutation = trpc.usage.setBudget.useMutation();
  const toggleThrottleMutation = trpc.usage.setThrottleEnabled.useMutation();
  const resetCycleMutation = trpc.usage.resetBudgetCycle.useMutation();
  const utils = trpc.useUtils();

  const handleSaveBudget = useCallback(async () => {
    const amount = parseFloat(budgetInput);
    if (isNaN(amount) || amount < 0) return;
    await setBudgetMutation.mutateAsync({ weeklyBudgetUsd: amount });
    utils.usage.getBudgetStatus.invalidate();
    setEditing(false);
    setBudgetInput('');
  }, [budgetInput, setBudgetMutation, utils]);

  const handleToggleThrottle = useCallback(async (enabled: boolean) => {
    await toggleThrottleMutation.mutateAsync({ enabled });
    utils.usage.getBudgetStatus.invalidate();
  }, [toggleThrottleMutation, utils]);

  const handleResetCycle = useCallback(async () => {
    await resetCycleMutation.mutateAsync();
    utils.usage.getBudgetStatus.invalidate();
  }, [resetCycleMutation, utils]);

  if (!status) {
    return (
      <Card variant="elevated" padding="lg">
        <div css={css`
          display: flex;
          align-items: center;
          justify-content: center;
          padding: ${theme.spacing[8]} 0;
          color: ${theme.colors.text.hint};
          font-size: ${theme.typography.fontSize.sm};
        `}>
          Loading budget status...
        </div>
      </Card>
    );
  }

  const hasBudget = status.config.weeklyBudgetUsd > 0;
  const percentUsed = status.percentUsed;
  const progressColor =
    percentUsed > 0.95
      ? theme.colors.error.main
      : percentUsed > 0.8
        ? theme.colors.warning.main
        : theme.colors.success.main;

  const windowStart = new Date(status.currentWindowStart).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  });
  const windowEnd = new Date(status.currentWindowEnd).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  });

  return (
    <Card variant="elevated" padding="lg">
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[6]};`}>
        {/* Header */}
        <div css={css`
          display: flex;
          align-items: center;
          justify-content: space-between;
        `}>
          <Typography.Subtitle>Weekly Budget</Typography.Subtitle>
          <Typography.Caption color="hint">
            {windowStart} - {windowEnd}
          </Typography.Caption>
        </div>

        {/* Budget amount */}
        {!hasBudget && !editing ? (
          <div css={css`
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: ${theme.spacing[4]};
            padding: ${theme.spacing[4]} 0;
          `}>
            <Typography.SmallBody color="hint">
              No weekly budget set. Set one to track spending and optionally throttle the heartbeat.
            </Typography.SmallBody>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { setEditing(true); setBudgetInput(''); }}
            >
              Set Budget
            </Button>
          </div>
        ) : (
          <>
            {/* Current budget display / edit */}
            {editing ? (
              <div css={css`
                display: flex;
                align-items: flex-end;
                gap: ${theme.spacing[3]};
              `}>
                <div css={css`flex: 1; max-width: 200px;`}>
                  <Input
                    label="Weekly limit (USD)"
                    type="number"
                    placeholder="e.g. 10.00"
                    value={budgetInput}
                    onChange={(e) => setBudgetInput((e.target as HTMLInputElement).value)}
                  />
                </div>
                <Button
                  size="sm"
                  onClick={handleSaveBudget}
                  loading={setBudgetMutation.isPending}
                >
                  Save
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <div css={css`
                display: flex;
                align-items: baseline;
                gap: ${theme.spacing[3]};
              `}>
                <div css={css`
                  font-family: ${theme.typography.fontFamily.mono};
                  font-size: ${theme.typography.fontSize['3xl']};
                  font-weight: ${theme.typography.fontWeight.semibold};
                  color: ${theme.colors.text.primary};
                `}>
                  {formatCost(status.config.weeklyBudgetUsd)}
                </div>
                <Typography.Caption color="hint">/ week</Typography.Caption>
                <button
                  onClick={() => {
                    setEditing(true);
                    setBudgetInput(status.config.weeklyBudgetUsd.toString());
                  }}
                  css={css`
                    font-size: ${theme.typography.fontSize.xs};
                    color: ${theme.colors.text.hint};
                    background: none;
                    border: none;
                    cursor: pointer;
                    text-decoration: underline;
                    text-decoration-color: transparent;
                    transition: text-decoration-color ${theme.transitions.fast};
                    &:hover {
                      text-decoration-color: ${theme.colors.text.hint};
                    }
                  `}
                >
                  Edit
                </button>
              </div>
            )}

            {/* Progress bar */}
            {hasBudget && (
              <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
                <div css={css`
                  height: 6px;
                  border-radius: ${theme.borderRadius.full};
                  background: ${theme.colors.background.elevated};
                  overflow: hidden;
                `}>
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(percentUsed * 100, 100)}%` }}
                    transition={{ duration: 0.6, ease: 'easeOut' }}
                    css={css`
                      height: 100%;
                      border-radius: inherit;
                      background: ${progressColor};
                    `}
                  />
                </div>
                <div css={css`
                  display: flex;
                  justify-content: space-between;
                  align-items: center;
                `}>
                  <span css={css`
                    font-family: ${theme.typography.fontFamily.mono};
                    font-size: ${theme.typography.fontSize.sm};
                    color: ${theme.colors.text.secondary};
                  `}>
                    {formatCost(status.currentSpendUsd)} spent ({formatPercent(percentUsed)})
                  </span>
                  <span css={css`
                    font-family: ${theme.typography.fontFamily.mono};
                    font-size: ${theme.typography.fontSize.sm};
                    color: ${theme.colors.text.hint};
                  `}>
                    {formatCost(status.remainingUsd)} remaining
                  </span>
                </div>
              </div>
            )}

            {/* Estimated time remaining */}
            {hasBudget && status.estimatedHoursRemaining !== null && (
              <Typography.SmallBody color="secondary">
                Estimated ~{status.estimatedHoursRemaining < 24
                  ? `${Math.round(status.estimatedHoursRemaining)} hours`
                  : `${(status.estimatedHoursRemaining / 24).toFixed(1)} days`
                } remaining at current rate
              </Typography.SmallBody>
            )}

            {/* Hard stop warning */}
            {status.isHardStopped && (
              <div css={css`
                padding: ${theme.spacing[3]} ${theme.spacing[4]};
                border-radius: ${theme.borderRadius.default};
                background: ${theme.colors.error.light}22;
                border: 1px solid ${theme.colors.error.main}33;
                color: ${theme.colors.error.dark};
                font-size: ${theme.typography.fontSize.sm};
              `}>
                Budget exceeded. Agent is paused until the cycle resets on {windowEnd}.
              </div>
            )}

            {/* Throttle toggle */}
            {hasBudget && (
              <div css={css`
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: ${theme.spacing[3]} 0;
                border-top: 1px solid ${theme.colors.border.light};
              `}>
                <div>
                  <Typography.SmallBody>Throttle heartbeat</Typography.SmallBody>
                  <Typography.Caption color="hint">
                    Gradually slow the tick interval as spending approaches the limit
                  </Typography.Caption>
                </div>
                <Toggle
                  checked={status.config.throttleEnabled}
                  onChange={handleToggleThrottle}
                />
              </div>
            )}

            {/* Reset cycle */}
            {hasBudget && (
              <div css={css`
                display: flex;
                justify-content: flex-end;
              `}>
                <button
                  onClick={handleResetCycle}
                  css={css`
                    display: flex;
                    align-items: center;
                    gap: ${theme.spacing[1.5]};
                    font-size: ${theme.typography.fontSize.xs};
                    color: ${theme.colors.text.hint};
                    background: none;
                    border: none;
                    cursor: pointer;
                    transition: color ${theme.transitions.fast};
                    &:hover {
                      color: ${theme.colors.text.secondary};
                    }
                  `}
                >
                  <ArrowsClockwise size={12} />
                  Reset cycle
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

// ============================================================================
// Breakdown Table
// ============================================================================

type SortKey = 'dimension' | 'costUsd' | 'totalTokens' | 'cacheReadTokens' | 'percentOfTotal';

function BreakdownTable({
  data,
  dimension,
  onDimensionChange,
}: {
  data: UsageBreakdownRow[] | undefined;
  dimension: BreakdownDimension;
  onDimensionChange: (d: BreakdownDimension) => void;
}) {
  const theme = useTheme();
  const [sortBy, setSortBy] = useState<SortKey>('costUsd');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const handleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortDir('desc');
    }
  };

  const sortedData = useMemo(() => {
    if (!data) return [];
    return [...data].sort((a, b) => {
      const aVal = sortBy === 'dimension' ? a.dimension : a[sortBy];
      const bVal = sortBy === 'dimension' ? b.dimension : b[sortBy];
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      const numA = aVal as number;
      const numB = bVal as number;
      return sortDir === 'asc' ? numA - numB : numB - numA;
    });
  }, [data, sortBy, sortDir]);

  const dimensionOptions = [
    { value: 'tick_type', label: 'Tick Type' },
    { value: 'model', label: 'Model' },
    { value: 'pipeline_phase', label: 'Pipeline Phase' },
    { value: 'contact', label: 'Contact' },
  ];

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortBy !== column) return null;
    return sortDir === 'asc' ? <CaretUp size={10} weight="bold" /> : <CaretDown size={10} weight="bold" />;
  };

  const headerCss = css`
    padding: ${theme.spacing[2]} ${theme.spacing[3]};
    text-align: left;
    font-size: ${theme.typography.fontSize.xs};
    font-weight: ${theme.typography.fontWeight.medium};
    color: ${theme.colors.text.hint};
    text-transform: uppercase;
    letter-spacing: 0.04em;
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
    transition: color ${theme.transitions.fast};

    &:hover {
      color: ${theme.colors.text.secondary};
    }
  `;

  const cellCss = css`
    padding: ${theme.spacing[2]} ${theme.spacing[3]};
    font-size: ${theme.typography.fontSize.sm};
    color: ${theme.colors.text.primary};
    font-family: ${theme.typography.fontFamily.mono};
    white-space: nowrap;
  `;

  const labelCellCss = css`
    padding: ${theme.spacing[2]} ${theme.spacing[3]};
    font-size: ${theme.typography.fontSize.sm};
    color: ${theme.colors.text.primary};
    white-space: nowrap;
  `;

  return (
    <Card variant="elevated" padding="md">
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
        {/* Header with dimension selector */}
        <div css={css`
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: ${theme.spacing[3]};
        `}>
          <Typography.Subtitle>Breakdown</Typography.Subtitle>
          <div css={css`max-width: 180px;`}>
            <Select
              options={dimensionOptions}
              value={dimension}
              onChange={(v) => onDimensionChange(v as BreakdownDimension)}
            />
          </div>
        </div>

        {/* Table */}
        <div css={css`
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;

          &::-webkit-scrollbar { height: 4px; }
          &::-webkit-scrollbar-track { background: transparent; }
          &::-webkit-scrollbar-thumb {
            background: ${theme.colors.border.default};
            border-radius: 2px;
          }
        `}>
          <table css={css`
            width: 100%;
            border-collapse: collapse;
            min-width: 500px;
          `}>
            <thead>
              <tr css={css`
                border-bottom: 1px solid ${theme.colors.border.light};
              `}>
                <th css={headerCss} onClick={() => handleSort('dimension')}>
                  <span css={css`display: inline-flex; align-items: center; gap: ${theme.spacing[1]};`}>
                    {dimensionOptions.find((o) => o.value === dimension)?.label || 'Dimension'}
                    <SortIcon column="dimension" />
                  </span>
                </th>
                <th css={css`${headerCss} text-align: right;`} onClick={() => handleSort('costUsd')}>
                  <span css={css`display: inline-flex; align-items: center; gap: ${theme.spacing[1]}; justify-content: flex-end;`}>
                    Cost
                    <SortIcon column="costUsd" />
                  </span>
                </th>
                <th css={css`${headerCss} text-align: right;`} onClick={() => handleSort('totalTokens')}>
                  <span css={css`display: inline-flex; align-items: center; gap: ${theme.spacing[1]}; justify-content: flex-end;`}>
                    Tokens
                    <SortIcon column="totalTokens" />
                  </span>
                </th>
                <th css={css`${headerCss} text-align: right;`} onClick={() => handleSort('cacheReadTokens')}>
                  <span css={css`display: inline-flex; align-items: center; gap: ${theme.spacing[1]}; justify-content: flex-end;`}>
                    Cache Read
                    <SortIcon column="cacheReadTokens" />
                  </span>
                </th>
                <th css={css`${headerCss} text-align: right;`} onClick={() => handleSort('percentOfTotal')}>
                  <span css={css`display: inline-flex; align-items: center; gap: ${theme.spacing[1]}; justify-content: flex-end;`}>
                    % of Total
                    <SortIcon column="percentOfTotal" />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedData.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    css={css`
                      padding: ${theme.spacing[8]} ${theme.spacing[3]};
                      text-align: center;
                      color: ${theme.colors.text.hint};
                      font-size: ${theme.typography.fontSize.sm};
                    `}
                  >
                    No data for this period
                  </td>
                </tr>
              ) : (
                sortedData.map((row, i) => (
                  <tr
                    key={row.dimension}
                    css={css`
                      border-bottom: ${i < sortedData.length - 1
                        ? `1px solid ${theme.colors.border.light}`
                        : 'none'};
                      transition: background ${theme.transitions.micro};
                      &:hover {
                        background: ${theme.colors.background.elevated};
                      }
                    `}
                  >
                    <td css={labelCellCss}>{formatDimensionLabel(dimension, row.dimension)}</td>
                    <td css={css`${cellCss} text-align: right;`}>{formatCost(row.costUsd)}</td>
                    <td css={css`${cellCss} text-align: right;`}>{formatTokens(row.totalTokens)}</td>
                    <td css={css`${cellCss} text-align: right;`}>{formatTokens(row.cacheReadTokens)}</td>
                    <td css={css`${cellCss} text-align: right;`}>{formatPercent(row.percentOfTotal)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}

// ============================================================================
// Export Button
// ============================================================================

function ExportButton({ timeWindow }: { timeWindow: TimeWindow }) {
  const theme = useTheme();
  const [exporting, setExporting] = useState(false);

  const exportQuery = trpc.usage.exportUsage.useQuery(
    { timeWindow, format: 'csv' },
    { enabled: false },
  );

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const result = await exportQuery.refetch();
      if (result.data) {
        const blob = new Blob([result.data as string], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `animus-usage-${timeWindow}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } finally {
      setExporting(false);
    }
  }, [exportQuery, timeWindow]);

  return (
    <button
      onClick={handleExport}
      disabled={exporting}
      css={css`
        display: inline-flex;
        align-items: center;
        gap: ${theme.spacing[1.5]};
        font-size: ${theme.typography.fontSize.xs};
        color: ${theme.colors.text.hint};
        background: none;
        border: none;
        cursor: pointer;
        transition: color ${theme.transitions.fast};
        opacity: ${exporting ? 0.5 : 1};

        &:hover:not(:disabled) {
          color: ${theme.colors.text.secondary};
        }
      `}
    >
      <Export size={14} />
      {exporting ? 'Exporting...' : 'Export CSV'}
    </button>
  );
}

// ============================================================================
// Usage Page
// ============================================================================

export function UsagePage() {
  const theme = useTheme();
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('24h');
  const [breakdownDimension, setBreakdownDimension] = useState<BreakdownDimension>('tick_type');

  // tRPC queries
  const timeSeries = trpc.usage.getTimeSeries.useQuery({ timeWindow });
  const breakdown = trpc.usage.getBreakdown.useQuery({
    timeWindow,
    dimension: breakdownDimension,
  });
  const cacheStats = trpc.usage.getCacheStats.useQuery({ timeWindow });
  const budgetStatus = trpc.usage.getBudgetStatus.useQuery();

  const totals: UsageTotals | undefined = timeSeries.data?.totals;
  const buckets: UsageTimeSeriesBucket[] = timeSeries.data?.buckets ?? [];
  const cache: CacheStats | undefined = cacheStats.data ?? undefined;

  const periodLabel = useMemo(() => {
    const labels: Record<TimeWindow, string> = {
      '1h': 'past hour',
      '12h': 'past 12 hours',
      '24h': 'past 24 hours',
      '7d': 'past 7 days',
      '30d': 'past 30 days',
      '90d': 'past 90 days',
    };
    return labels[timeWindow];
  }, [timeWindow]);

  return (
    <div
      css={css`
        max-width: 780px;
        margin: 0 auto;
        padding: ${theme.spacing[6]} ${theme.spacing[6]} ${theme.spacing[16]};

        @media (max-width: ${theme.breakpoints.md}) {
          padding: ${theme.spacing[4]} ${theme.spacing[4]} ${theme.spacing[16]};
        }
      `}
    >
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        css={css`
          display: flex;
          flex-direction: column;
          gap: ${theme.spacing[8]};
        `}
      >
        {/* Page header */}
        <div css={css`
          display: flex;
          flex-direction: column;
          gap: ${theme.spacing[4]};
        `}>
          <Typography.Title>Usage</Typography.Title>
          <TimeWindowSelector value={timeWindow} onChange={setTimeWindow} />
        </div>

        {/* Stat cards */}
        <div
          css={css`
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: ${theme.spacing[4]};

            @media (max-width: ${theme.breakpoints.lg}) {
              grid-template-columns: repeat(2, 1fr);
            }

            @media (max-width: ${theme.breakpoints.sm}) {
              grid-template-columns: 1fr;
            }
          `}
        >
          <StatCard
            label="Total Cost"
            value={totals ? formatCost(totals.costUsd) : '--'}
            subtitle={periodLabel}
            icon={CurrencyDollar}
          />
          <StatCard
            label="Total Tokens"
            value={totals ? formatTokens(totals.totalTokens) : '--'}
            subtitle={periodLabel}
            icon={Coins}
          />
          <StatCard
            label="Cache Efficiency"
            value={cache ? formatPercent(cache.cacheHitRate) : '--'}
            subtitle="hit rate"
            icon={Lightning}
          />
          <StatCard
            label="Total Ticks"
            value={totals ? totals.tickCount.toString() : '--'}
            subtitle={periodLabel}
            icon={Heartbeat}
          />
        </div>

        {/* Cost Chart */}
        <Card variant="elevated" padding="md">
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
            <Typography.Subtitle>Cost Over Time</Typography.Subtitle>
            <CostChart data={buckets} timeWindow={timeWindow} theme={theme} />
          </div>
        </Card>

        {/* Token Chart */}
        <Card variant="elevated" padding="md">
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
            <Typography.Subtitle>Token Usage</Typography.Subtitle>
            <TokenChart data={buckets} timeWindow={timeWindow} theme={theme} />
          </div>
        </Card>

        {/* Budget */}
        <BudgetCard status={budgetStatus.data ?? undefined} />

        {/* Breakdown Table */}
        <BreakdownTable
          data={breakdown.data ?? undefined}
          dimension={breakdownDimension}
          onDimensionChange={setBreakdownDimension}
        />

        {/* Export */}
        <div css={css`
          display: flex;
          justify-content: flex-end;
        `}>
          <ExportButton timeWindow={timeWindow} />
        </div>
      </motion.div>
    </div>
  );
}
