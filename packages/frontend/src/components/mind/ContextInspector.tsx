/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, CaretDown, CaretRight } from '@phosphor-icons/react';
import { trpc } from '../../utils/trpc';
import { Typography } from '../ui';
import { Badge } from './HeartbeatsSection';
import type {
  ContextSection,
  ContextSectionCategory,
  CortexContextSnapshot,
  ContextSnapshotSection,
  PhaseUsage,
} from '@animus-labs/shared';

// ============================================================================
// Color helpers
// ============================================================================

type Theme = ReturnType<typeof useTheme>;

function categoryColor(category: string, theme: Theme): string {
  switch (category) {
    case 'identity':  return '#8B7EC8';
    case 'trigger':   return theme.colors.accent;
    case 'state':     return '#C4943A';
    case 'memory':    return '#4A9B6E';
    case 'goals':     return '#5B8DEF';
    case 'system':    return theme.colors.text.hint;
    case 'plugins':   return '#2D8A6E';
    default:          return theme.colors.text.secondary;
  }
}

/** Section-group colors for the budget bar and section headers */
const GROUP_COLORS = {
  consumerSystem: '#8B7EC8',   // purple
  cortexSystem:   '#888',      // gray
  slots:          '#2D8A6E',   // teal
  history:        '#5B8DEF',   // blue
  ephemeral:      '#C4943A',   // gold
  trigger:        '',          // accent (resolved at render time)
  cache:          '#6B8A5E',   // sage green
} as const;

// ============================================================================
// Token Budget Bar
// ============================================================================

interface BudgetSegment {
  label: string;
  tokens: number;
  color: string;
}

function TokenBudgetBar({ snapshot }: { snapshot: CortexContextSnapshot }) {
  const theme = useTheme();
  const contextWindow = snapshot.contextWindow || 1;
  const pct = (tokens: number) => Math.max((tokens / contextWindow) * 100, 0.3);
  const usagePct = Math.round((snapshot.totalTokens / contextWindow) * 100);

  const segments: BudgetSegment[] = [
    {
      label: 'Consumer Prompt',
      tokens: snapshot.consumerSystemPrompt.reduce((s, x) => s + x.tokenCount, 0),
      color: GROUP_COLORS.consumerSystem,
    },
    {
      label: 'Cortex Prompt',
      tokens: snapshot.cortexSystemPrompt.reduce((s, x) => s + x.tokenCount, 0),
      color: GROUP_COLORS.cortexSystem,
    },
    {
      label: 'Slots',
      tokens: snapshot.slots.reduce((s, x) => s + x.tokenCount, 0),
      color: GROUP_COLORS.slots,
    },
    {
      label: 'History',
      tokens: snapshot.conversationHistory.totalTokens,
      color: GROUP_COLORS.history,
    },
    {
      label: 'Ephemeral',
      tokens: snapshot.ephemeral.reduce((s, x) => s + x.tokenCount, 0),
      color: GROUP_COLORS.ephemeral,
    },
    {
      label: 'Trigger',
      tokens: snapshot.triggerMessage.tokenCount,
      color: theme.colors.accent,
    },
  ];

  return (
    <div css={css`margin-bottom: ${theme.spacing[5]};`}>
      {/* Usage header */}
      <div css={css`
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: ${theme.spacing[2]};
      `}>
        <Typography.Caption color="hint">Context Budget</Typography.Caption>
        <span css={css`
          font-family: ${theme.typography.fontFamily.mono};
          font-size: ${theme.typography.fontSize.xs};
          color: ${theme.colors.text.secondary};
        `}>
          ~{snapshot.totalTokens.toLocaleString()} / {contextWindow.toLocaleString()} ({usagePct}%)
        </span>
      </div>

      {/* Stacked bar */}
      <div css={css`
        display: flex;
        height: 8px;
        border-radius: 4px;
        overflow: hidden;
        background: ${theme.mode === 'light'
          ? 'rgba(0,0,0,0.06)'
          : 'rgba(255,255,255,0.06)'};
      `}>
        {segments.map((seg) => (
          seg.tokens > 0 && (
            <div
              key={seg.label}
              title={`${seg.label}: ~${seg.tokens.toLocaleString()} tok`}
              css={css`
                width: ${pct(seg.tokens)}%;
                background: ${seg.color};
                min-width: 2px;
                transition: width 0.2s ease;
              `}
            />
          )
        ))}
      </div>

      {/* Legend */}
      <div css={css`
        display: flex;
        flex-wrap: wrap;
        gap: ${theme.spacing[3]};
        margin-top: ${theme.spacing[2]};
      `}>
        {segments.filter(s => s.tokens > 0).map((seg) => (
          <div key={seg.label} css={css`
            display: flex;
            align-items: center;
            gap: ${theme.spacing[1]};
          `}>
            <div css={css`
              width: 8px;
              height: 8px;
              border-radius: 2px;
              background: ${seg.color};
            `} />
            <span css={css`
              font-size: ${theme.typography.fontSize.xs};
              color: ${theme.colors.text.hint};
            `}>
              {seg.label}
            </span>
            <span css={css`
              font-family: ${theme.typography.fontFamily.mono};
              font-size: ${theme.typography.fontSize.xs};
              color: ${theme.colors.text.hint};
            `}>
              ~{seg.tokens.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Snapshot Section Card (for ContextSnapshotSection items)
// ============================================================================

type CacheStatus = 'cached' | 'partial' | 'uncached' | undefined;

function SnapshotCard({ section, cacheStatus }: { section: ContextSnapshotSection; cacheStatus?: CacheStatus }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const hasContent = section.content.length > 0;

  return (
    <div
      role={hasContent ? 'button' : undefined}
      tabIndex={hasContent ? 0 : undefined}
      onClick={hasContent ? () => setExpanded((e) => !e) : undefined}
      onKeyDown={hasContent ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setExpanded((v) => !v);
        }
      } : undefined}
      css={css`
        border: 1px solid ${theme.colors.border.light};
        border-radius: ${theme.borderRadius.md};
        margin-bottom: ${theme.spacing[1]};
        opacity: ${hasContent ? 1 : 0.5};
        cursor: ${hasContent ? 'pointer' : 'default'};
        transition: background ${theme.transitions.micro};
        overflow: hidden;

        ${hasContent ? `&:hover {
          background: ${theme.mode === 'light'
            ? 'rgba(0, 0, 0, 0.02)'
            : 'rgba(255, 255, 255, 0.02)'};
        }` : ''}
      `}
    >
      <div css={css`
        display: flex;
        align-items: center;
        gap: ${theme.spacing[2]};
        padding: ${theme.spacing[2]} ${theme.spacing[3]};
      `}>
        <span css={css`
          font-size: ${theme.typography.fontSize.sm};
          font-weight: ${theme.typography.fontWeight.medium};
          color: ${hasContent ? theme.colors.text.primary : theme.colors.text.hint};
        `}>
          {section.name}
        </span>
        {!hasContent && (
          <span css={css`
            font-size: ${theme.typography.fontSize.xs};
            color: ${theme.colors.text.hint};
            font-style: italic;
          `}>
            (empty)
          </span>
        )}
        <span css={css`flex: 1;`} />
        {hasContent && (
          <span css={css`
            font-family: ${theme.typography.fontFamily.mono};
            font-size: ${theme.typography.fontSize.xs};
            color: ${theme.colors.text.hint};
          `}>
            ~{section.tokenCount.toLocaleString()} tok
          </span>
        )}
        {cacheStatus && (
          <span
            title={cacheStatus === 'cached' ? 'Fully cached (prefix hit)' : cacheStatus === 'partial' ? 'Partially cached (cache boundary)' : 'Not cached (beyond prefix)'}
            css={css`
              display: inline-flex;
              align-items: center;
              gap: 4px;
              font-size: ${theme.typography.fontSize.xs};
              font-family: ${theme.typography.fontFamily.mono};
              color: ${cacheStatus === 'cached'
                ? theme.colors.success.main
                : cacheStatus === 'partial'
                  ? theme.colors.warning.main
                  : theme.colors.text.hint};
              opacity: ${cacheStatus === 'uncached' ? 0.5 : 1};
            `}
          >
            <span css={css`
              width: 6px;
              height: 6px;
              border-radius: 50%;
              background: ${cacheStatus === 'cached'
                ? theme.colors.success.main
                : cacheStatus === 'partial'
                  ? theme.colors.warning.main
                  : theme.colors.border.light};
            `} />
            {cacheStatus === 'cached' ? 'cached' : cacheStatus === 'partial' ? 'partial' : ''}
          </span>
        )}
        {hasContent && (
          <motion.span
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: 0.15 }}
            css={css`
              display: flex;
              align-items: center;
              color: ${theme.colors.text.hint};
            `}
          >
            <CaretDown size={12} />
          </motion.span>
        )}
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            css={css`overflow: hidden;`}
          >
            <div css={css`
              border-top: 1px solid ${theme.colors.border.light};
              padding: ${theme.spacing[3]};
            `}>
              <pre css={css`
                font-family: ${theme.typography.fontFamily.mono};
                font-size: 0.8rem;
                line-height: 1.5;
                white-space: pre-wrap;
                word-break: break-word;
                color: ${theme.colors.text.primary};
                margin: 0;
                max-height: 400px;
                overflow-y: auto;
              `}>
                {section.content}
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// Collapsible Section Group
// ============================================================================

function SectionGroup({
  title,
  color,
  tokenCount,
  defaultExpanded = false,
  children,
}: {
  title: string;
  color: string;
  tokenCount: number;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div css={css`margin-bottom: ${theme.spacing[3]};`}>
      <button
        onClick={() => setExpanded(e => !e)}
        css={css`
          display: flex;
          align-items: center;
          gap: ${theme.spacing[2]};
          width: 100%;
          padding: ${theme.spacing[2]} 0;
          cursor: pointer;
          border-bottom: 1px solid ${theme.colors.border.light};
          margin-bottom: ${expanded ? theme.spacing[2] : '0'};
          transition: all ${theme.transitions.micro};

          &:hover {
            opacity: 0.8;
          }
        `}
      >
        <div css={css`
          width: 4px;
          height: 16px;
          border-radius: 2px;
          background: ${color};
          flex-shrink: 0;
        `} />
        <span css={css`
          font-size: ${theme.typography.fontSize.sm};
          font-weight: ${theme.typography.fontWeight.semibold};
          color: ${theme.colors.text.primary};
        `}>
          {title}
        </span>
        <span css={css`flex: 1;`} />
        <span css={css`
          font-family: ${theme.typography.fontFamily.mono};
          font-size: ${theme.typography.fontSize.xs};
          color: ${theme.colors.text.hint};
        `}>
          ~{tokenCount.toLocaleString()} tok
        </span>
        <motion.span
          animate={{ rotate: expanded ? 90 : 0 }}
          transition={{ duration: 0.15 }}
          css={css`
            display: flex;
            align-items: center;
            color: ${theme.colors.text.hint};
          `}
        >
          <CaretRight size={12} />
        </motion.span>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            css={css`overflow: hidden; padding-left: ${theme.spacing[2]};`}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// Conversation History Card (metadata only)
// ============================================================================

function ConversationHistoryCard({ snapshot }: { snapshot: CortexContextSnapshot }) {
  const theme = useTheme();
  const h = snapshot.conversationHistory;

  return (
    <div css={css`margin-bottom: ${theme.spacing[3]};`}>
      <div css={css`
        display: flex;
        align-items: center;
        gap: ${theme.spacing[2]};
        padding: ${theme.spacing[2]} 0;
        border-bottom: 1px solid ${theme.colors.border.light};
        margin-bottom: ${theme.spacing[2]};
      `}>
        <div css={css`
          width: 4px;
          height: 16px;
          border-radius: 2px;
          background: ${GROUP_COLORS.history};
          flex-shrink: 0;
        `} />
        <span css={css`
          font-size: ${theme.typography.fontSize.sm};
          font-weight: ${theme.typography.fontWeight.semibold};
          color: ${theme.colors.text.primary};
        `}>
          Conversation History
        </span>
        <span css={css`flex: 1;`} />
        <span css={css`
          font-family: ${theme.typography.fontFamily.mono};
          font-size: ${theme.typography.fontSize.xs};
          color: ${theme.colors.text.hint};
        `}>
          ~{h.totalTokens.toLocaleString()} tok
        </span>
      </div>

      <div css={css`
        display: flex;
        flex-wrap: wrap;
        gap: ${theme.spacing[4]};
        padding-left: ${theme.spacing[2]};
      `}>
        <div>
          <Typography.Caption color="hint" css={css`display: block;`}>Messages</Typography.Caption>
          <span css={css`
            font-family: ${theme.typography.fontFamily.mono};
            font-size: ${theme.typography.fontSize.sm};
            color: ${theme.colors.text.primary};
          `}>
            {h.messageCount}
          </span>
        </div>
        <div>
          <Typography.Caption color="hint" css={css`display: block;`}>Compacted</Typography.Caption>
          <span css={css`
            font-family: ${theme.typography.fontFamily.mono};
            font-size: ${theme.typography.fontSize.sm};
            color: ${h.hasSummary ? '#C4943A' : theme.colors.text.primary};
          `}>
            {h.hasSummary ? `Yes (~${h.summaryTokens?.toLocaleString()} tok)` : 'No'}
          </span>
        </div>
        {h.oldestMessageTimestamp && (
          <div>
            <Typography.Caption color="hint" css={css`display: block;`}>Oldest Message</Typography.Caption>
            <span css={css`
              font-size: ${theme.typography.fontSize.sm};
              color: ${theme.colors.text.primary};
            `}>
              {new Date(h.oldestMessageTimestamp).toLocaleString()}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Cache Performance Section
// ============================================================================

/** Map raw phase keys to human-readable names */
function phaseLabel(phase: string): string {
  switch (phase) {
    case 'thought':       return 'Thought';
    case 'agentic_loop':  return 'Agentic Loop';
    case 'reflect':       return 'Reflect';
    default:              return phase;
  }
}

/**
 * Compute cache hit rate as a percentage (0-100).
 * Total input = cacheRead + cacheWrite + input (non-cached).
 * Cache writes are input tokens written to cache for future use, NOT served from cache.
 */
function cacheHitRate(cacheRead: number, cacheWrite: number, input: number): number {
  const total = cacheRead + cacheWrite + input;
  if (total === 0) return 0;
  return (cacheRead / total) * 100;
}

/** Pick a semantic color for cache hit rate: green (>70%), amber (30-70%), red (<30%) */
function hitRateColor(rate: number, theme: Theme): string {
  if (rate >= 70) return theme.colors.success.main;
  if (rate >= 30) return theme.colors.warning.main;
  return theme.colors.error.main;
}

/** Format a USD cost value */
function formatCost(usd: number): string {
  if (usd < 0.005) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

function CachePerformanceSection({ phases }: { phases: PhaseUsage[] }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(true);

  // Compute totals
  const totals = useMemo(() => {
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;
    let costUsd = 0;
    for (const p of phases) {
      inputTokens += p.inputTokens;
      outputTokens += p.outputTokens;
      cacheReadTokens += p.cacheReadTokens;
      cacheWriteTokens += p.cacheWriteTokens;
      costUsd += p.costUsd;
    }
    return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costUsd };
  }, [phases]);

  const totalHitRate = cacheHitRate(totals.cacheReadTokens, totals.cacheWriteTokens, totals.inputTokens);

  const monoXs = css`
    font-family: ${theme.typography.fontFamily.mono};
    font-size: ${theme.typography.fontSize.xs};
  `;

  const headerCell = css`
    font-size: 10px;
    font-weight: ${theme.typography.fontWeight.medium};
    color: ${theme.colors.text.hint};
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: ${theme.spacing[1]} ${theme.spacing[2]};
    text-align: right;
    white-space: nowrap;
  `;

  const dataCell = css`
    ${monoXs};
    color: ${theme.colors.text.secondary};
    padding: ${theme.spacing[1]} ${theme.spacing[2]};
    text-align: right;
  `;

  const labelCell = css`
    font-size: ${theme.typography.fontSize.sm};
    font-weight: ${theme.typography.fontWeight.medium};
    color: ${theme.colors.text.primary};
    padding: ${theme.spacing[1]} ${theme.spacing[2]};
    text-align: left;
  `;

  return (
    <div css={css`margin-bottom: ${theme.spacing[3]};`}>
      <button
        onClick={() => setExpanded(e => !e)}
        css={css`
          display: flex;
          align-items: center;
          gap: ${theme.spacing[2]};
          width: 100%;
          padding: ${theme.spacing[2]} 0;
          cursor: pointer;
          border-bottom: 1px solid ${theme.colors.border.light};
          margin-bottom: ${expanded ? theme.spacing[2] : '0'};
          transition: all ${theme.transitions.micro};

          &:hover {
            opacity: 0.8;
          }
        `}
      >
        <div css={css`
          width: 4px;
          height: 16px;
          border-radius: 2px;
          background: ${GROUP_COLORS.cache};
          flex-shrink: 0;
        `} />
        <span css={css`
          font-size: ${theme.typography.fontSize.sm};
          font-weight: ${theme.typography.fontWeight.semibold};
          color: ${theme.colors.text.primary};
        `}>
          Cache Performance
        </span>
        <span css={css`flex: 1;`} />
        {/* Overall hit rate badge */}
        <span css={css`
          ${monoXs};
          color: ${hitRateColor(totalHitRate, theme)};
          font-weight: ${theme.typography.fontWeight.medium};
        `}>
          {totalHitRate.toFixed(0)}% hit
        </span>
        <span css={css`
          ${monoXs};
          color: ${theme.colors.text.hint};
          margin-left: ${theme.spacing[1]};
        `}>
          {formatCost(totals.costUsd)}
        </span>
        <motion.span
          animate={{ rotate: expanded ? 90 : 0 }}
          transition={{ duration: 0.15 }}
          css={css`
            display: flex;
            align-items: center;
            color: ${theme.colors.text.hint};
          `}
        >
          <CaretRight size={12} />
        </motion.span>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            css={css`overflow: hidden; padding-left: ${theme.spacing[2]};`}
          >
            <div css={css`
              overflow-x: auto;
              border: 1px solid ${theme.colors.border.light};
              border-radius: ${theme.borderRadius.md};
            `}>
              <table css={css`
                width: 100%;
                border-collapse: collapse;
                min-width: 480px;
              `}>
                <thead>
                  <tr css={css`
                    border-bottom: 1px solid ${theme.colors.border.light};
                  `}>
                    <th css={css`${headerCell}; text-align: left;`}>Phase</th>
                    <th css={headerCell}>Total In</th>
                    <th css={headerCell}>Cached</th>
                    <th css={headerCell}>New</th>
                    <th css={headerCell}>Output</th>
                    <th css={headerCell}>Hit Rate</th>
                    <th css={headerCell}>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {phases.map((p) => {
                    const rate = cacheHitRate(p.cacheReadTokens, p.cacheWriteTokens, p.inputTokens);
                    return (
                      <tr
                        key={p.phase}
                        css={css`
                          border-bottom: 1px solid ${theme.colors.border.light};
                          transition: background ${theme.transitions.micro};
                          &:hover {
                            background: ${theme.mode === 'light'
                              ? 'rgba(0, 0, 0, 0.02)'
                              : 'rgba(255, 255, 255, 0.02)'};
                          }
                          &:last-of-type {
                            border-bottom: none;
                          }
                        `}
                      >
                        <td css={labelCell}>
                          <div css={css`
                            display: flex;
                            align-items: center;
                            gap: ${theme.spacing[2]};
                          `}>
                            {phaseLabel(p.phase)}
                            {p.model && (
                              <span css={css`
                                font-size: 10px;
                                color: ${theme.colors.text.hint};
                                font-weight: ${theme.typography.fontWeight.normal};
                              `}>
                                {p.model}
                              </span>
                            )}
                          </div>
                        </td>
                        <td css={dataCell}>{(p.inputTokens + p.cacheReadTokens + p.cacheWriteTokens).toLocaleString()}</td>
                        <td css={dataCell}>{p.cacheReadTokens.toLocaleString()}</td>
                        <td css={dataCell}>{p.cacheWriteTokens.toLocaleString()}</td>
                        <td css={dataCell}>{p.outputTokens.toLocaleString()}</td>
                        <td css={css`
                          ${dataCell};
                          color: ${hitRateColor(rate, theme)};
                          font-weight: ${theme.typography.fontWeight.medium};
                        `}>
                          {rate.toFixed(0)}%
                        </td>
                        <td css={dataCell}>{formatCost(p.costUsd)}</td>
                      </tr>
                    );
                  })}

                  {/* Totals row */}
                  <tr css={css`
                    border-top: 2px solid ${theme.colors.border.default};
                    background: ${theme.mode === 'light'
                      ? 'rgba(0, 0, 0, 0.02)'
                      : 'rgba(255, 255, 255, 0.02)'};
                  `}>
                    <td css={css`
                      ${labelCell};
                      font-weight: ${theme.typography.fontWeight.semibold};
                    `}>
                      Total
                    </td>
                    <td css={css`${dataCell}; color: ${theme.colors.text.primary}; font-weight: ${theme.typography.fontWeight.medium};`}>
                      {(totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens).toLocaleString()}
                    </td>
                    <td css={css`${dataCell}; color: ${theme.colors.text.primary}; font-weight: ${theme.typography.fontWeight.medium};`}>
                      {totals.cacheReadTokens.toLocaleString()}
                    </td>
                    <td css={css`${dataCell}; color: ${theme.colors.text.primary}; font-weight: ${theme.typography.fontWeight.medium};`}>
                      {totals.cacheWriteTokens.toLocaleString()}
                    </td>
                    <td css={css`${dataCell}; color: ${theme.colors.text.primary}; font-weight: ${theme.typography.fontWeight.medium};`}>
                      {totals.outputTokens.toLocaleString()}
                    </td>
                    <td css={css`
                      ${dataCell};
                      color: ${hitRateColor(totalHitRate, theme)};
                      font-weight: ${theme.typography.fontWeight.semibold};
                    `}>
                      {totalHitRate.toFixed(0)}%
                    </td>
                    <td css={css`${dataCell}; color: ${theme.colors.text.primary}; font-weight: ${theme.typography.fontWeight.semibold};`}>
                      {formatCost(totals.costUsd)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// Cortex Context View (new layout)
// ============================================================================

/**
 * Compute cache status for each section by walking the context layout top-to-bottom.
 * Prefix caching works sequentially: everything from the start up to cacheReadTokens
 * was served from cache. We walk sections in the same order they appear in the API
 * request and mark each as 'cached', 'partial', or 'uncached' based on where the
 * cache boundary falls.
 *
 * Uses the agentic_loop phase usage since that phase's context matches the
 * inspector's layout (system prompt + slots + history + ephemeral + trigger).
 */
function computeCacheBoundary(
  snapshot: CortexContextSnapshot,
  phaseUsage?: PhaseUsage[],
): Map<string, CacheStatus> {
  const statusMap = new Map<string, CacheStatus>();
  if (!phaseUsage || phaseUsage.length === 0) return statusMap;

  // Use the agentic_loop phase (its context matches the inspector layout)
  const loopUsage = phaseUsage.find(p => p.phase === 'agentic_loop');
  if (!loopUsage || loopUsage.cacheReadTokens === 0) return statusMap;

  const cacheReadTokens = loopUsage.cacheReadTokens;
  let accumulated = 0;

  // Walk sections in the same order as the API request
  const allSections: Array<{ key: string; tokens: number }> = [];

  // System prompt (single block in the API)
  const systemTokens = snapshot.consumerSystemPrompt.reduce((s, x) => s + x.tokenCount, 0)
    + snapshot.cortexSystemPrompt.reduce((s, x) => s + x.tokenCount, 0);
  allSections.push({ key: '__system_prompt__', tokens: systemTokens });

  // Individual consumer system prompt sections
  for (const section of snapshot.consumerSystemPrompt) {
    allSections.push({ key: `consumer:${section.name}`, tokens: section.tokenCount });
  }
  // Individual cortex system prompt sections
  for (const section of snapshot.cortexSystemPrompt) {
    allSections.push({ key: `cortex:${section.name}`, tokens: section.tokenCount });
  }

  // Context slots (each is a separate message in the array)
  for (const section of snapshot.slots) {
    allSections.push({ key: `slot:${section.name}`, tokens: section.tokenCount });
  }

  // Conversation history
  allSections.push({ key: '__history__', tokens: snapshot.conversationHistory.totalTokens });

  // Ephemeral sections
  for (const section of snapshot.ephemeral) {
    allSections.push({ key: `ephemeral:${section.name}`, tokens: section.tokenCount });
  }

  // Trigger
  allSections.push({ key: '__trigger__', tokens: snapshot.triggerMessage.tokenCount });

  // The system prompt is sent as a single block with cache_control.
  // Anthropic caches the entire system prompt atomically. So we check
  // if the system prompt tokens fit within cacheReadTokens first.
  // Then for messages (slots, history, ephemeral), we walk one by one.

  // Walk: system prompt is atomic
  if (cacheReadTokens >= systemTokens) {
    // Entire system prompt cached
    for (const section of snapshot.consumerSystemPrompt) {
      statusMap.set(`consumer:${section.name}`, 'cached');
    }
    for (const section of snapshot.cortexSystemPrompt) {
      statusMap.set(`cortex:${section.name}`, 'cached');
    }
    accumulated = systemTokens;
  } else if (cacheReadTokens > 0) {
    // Partial system prompt cache (shouldn't happen with atomic caching, but handle gracefully)
    let sysPrefixRemaining = cacheReadTokens;
    for (const section of snapshot.consumerSystemPrompt) {
      if (sysPrefixRemaining >= section.tokenCount) {
        statusMap.set(`consumer:${section.name}`, 'cached');
        sysPrefixRemaining -= section.tokenCount;
      } else if (sysPrefixRemaining > 0) {
        statusMap.set(`consumer:${section.name}`, 'partial');
        sysPrefixRemaining = 0;
      } else {
        statusMap.set(`consumer:${section.name}`, 'uncached');
      }
    }
    for (const section of snapshot.cortexSystemPrompt) {
      if (sysPrefixRemaining >= section.tokenCount) {
        statusMap.set(`cortex:${section.name}`, 'cached');
        sysPrefixRemaining -= section.tokenCount;
      } else if (sysPrefixRemaining > 0) {
        statusMap.set(`cortex:${section.name}`, 'partial');
        sysPrefixRemaining = 0;
      } else {
        statusMap.set(`cortex:${section.name}`, 'uncached');
      }
    }
    return statusMap; // Cache ended within system prompt
  } else {
    return statusMap; // No cache at all
  }

  // Walk message-level sections (slots, history, ephemeral, trigger)
  const messageSections = [
    ...snapshot.slots.map(s => ({ key: `slot:${s.name}`, tokens: s.tokenCount })),
    { key: '__history__', tokens: snapshot.conversationHistory.totalTokens },
    ...snapshot.ephemeral.map(s => ({ key: `ephemeral:${s.name}`, tokens: s.tokenCount })),
    { key: '__trigger__', tokens: snapshot.triggerMessage.tokenCount },
  ];

  for (const section of messageSections) {
    if (accumulated + section.tokens <= cacheReadTokens) {
      statusMap.set(section.key, 'cached');
      accumulated += section.tokens;
    } else if (accumulated < cacheReadTokens) {
      statusMap.set(section.key, 'partial');
      accumulated = cacheReadTokens; // boundary crossed
    } else {
      statusMap.set(section.key, 'uncached');
    }
  }

  return statusMap;
}

function CortexContextView({
  snapshot,
  phaseUsage,
}: {
  snapshot: CortexContextSnapshot;
  phaseUsage?: PhaseUsage[] | undefined;
}) {
  const theme = useTheme();

  const consumerTokens = snapshot.consumerSystemPrompt.reduce((s, x) => s + x.tokenCount, 0);
  const cortexTokens = snapshot.cortexSystemPrompt.reduce((s, x) => s + x.tokenCount, 0);
  const slotTokens = snapshot.slots.reduce((s, x) => s + x.tokenCount, 0);
  const ephemeralTokens = snapshot.ephemeral.reduce((s, x) => s + x.tokenCount, 0);

  // Compute per-section cache status from agentic loop cache_read_tokens
  const cacheMap = useMemo(
    () => computeCacheBoundary(snapshot, phaseUsage),
    [snapshot, phaseUsage],
  );

  return (
    <>
      <TokenBudgetBar snapshot={snapshot} />

      {/* 1. Consumer System Prompt */}
      <SectionGroup
        title="Consumer System Prompt"
        color={GROUP_COLORS.consumerSystem}
        tokenCount={consumerTokens}
      >
        {snapshot.consumerSystemPrompt.map((section, i) => (
          <SnapshotCard key={i} section={section} cacheStatus={cacheMap.get(`consumer:${section.name}`)} />
        ))}
      </SectionGroup>

      {/* 2. Cortex System Prompt */}
      <SectionGroup
        title="Cortex System Prompt"
        color={GROUP_COLORS.cortexSystem}
        tokenCount={cortexTokens}
      >
        {snapshot.cortexSystemPrompt.map((section, i) => (
          <SnapshotCard key={i} section={section} cacheStatus={cacheMap.get(`cortex:${section.name}`)} />
        ))}
      </SectionGroup>

      {/* 3. Context Slots */}
      <SectionGroup
        title="Context Slots"
        color={GROUP_COLORS.slots}
        tokenCount={slotTokens}
        defaultExpanded
      >
        {snapshot.slots.map((section, i) => (
          <SnapshotCard key={i} section={section} cacheStatus={cacheMap.get(`slot:${section.name}`)} />
        ))}
      </SectionGroup>

      {/* 4. Conversation History (metadata card, not collapsible group) */}
      <ConversationHistoryCard snapshot={snapshot} />

      {/* 5. Ephemeral Context */}
      <SectionGroup
        title="Ephemeral Context"
        color={GROUP_COLORS.ephemeral}
        tokenCount={ephemeralTokens}
        defaultExpanded
      >
        {snapshot.ephemeral.map((section, i) => (
          <SnapshotCard key={i} section={section} cacheStatus={cacheMap.get(`ephemeral:${section.name}`)} />
        ))}
      </SectionGroup>

      {/* 6. Trigger Message */}
      <SectionGroup
        title="Trigger Message"
        color={theme.colors.accent}
        tokenCount={snapshot.triggerMessage.tokenCount}
        defaultExpanded
      >
        <SnapshotCard
          section={{
            name: 'User Message',
            content: snapshot.triggerMessage.content,
            tokenCount: snapshot.triggerMessage.tokenCount,
          }}
          cacheStatus={cacheMap.get('__trigger__')}
        />
      </SectionGroup>

      {/* 7. Cache Performance (only when phaseUsage data is available) */}
      {phaseUsage && phaseUsage.length > 0 && (
        <CachePerformanceSection phases={phaseUsage} />
      )}
    </>
  );
}

// ============================================================================
// Legacy Context View (old two-tab layout for pre-Cortex ticks)
// ============================================================================

function LegacySectionCard({ section }: { section: ContextSection }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const canExpand = section.included && section.content != null;

  return (
    <div
      role={canExpand ? 'button' : undefined}
      tabIndex={canExpand ? 0 : undefined}
      onClick={canExpand ? () => setExpanded((e) => !e) : undefined}
      onKeyDown={canExpand ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setExpanded((v) => !v);
        }
      } : undefined}
      css={css`
        border: 1px solid ${theme.colors.border.light};
        border-radius: ${theme.borderRadius.md};
        margin-bottom: ${theme.spacing[2]};
        opacity: ${section.included ? 1 : 0.5};
        cursor: ${canExpand ? 'pointer' : 'default'};
        transition: background ${theme.transitions.micro};
        overflow: hidden;

        ${canExpand ? `&:hover {
          background: ${theme.mode === 'light'
            ? 'rgba(0, 0, 0, 0.02)'
            : 'rgba(255, 255, 255, 0.02)'};
        }` : ''}
      `}
    >
      <div css={css`
        display: flex;
        align-items: center;
        gap: ${theme.spacing[2]};
        padding: ${theme.spacing[2]} ${theme.spacing[3]};
      `}>
        <Badge label={section.category} color={categoryColor(section.category, theme)} />
        <span css={css`
          font-size: ${theme.typography.fontSize.sm};
          font-weight: ${theme.typography.fontWeight.medium};
          color: ${section.included ? theme.colors.text.primary : theme.colors.text.secondary};
        `}>
          {section.title}
        </span>
        <span css={css`flex: 1;`} />
        {section.included && (
          <span css={css`
            font-family: ${theme.typography.fontFamily.mono};
            font-size: ${theme.typography.fontSize.xs};
            color: ${theme.colors.text.hint};
          `}>
            ~{section.tokenCount.toLocaleString()} tok
          </span>
        )}
        {canExpand && (
          <motion.span
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: 0.15 }}
            css={css`
              display: flex;
              align-items: center;
              color: ${theme.colors.text.hint};
            `}
          >
            <CaretDown size={12} />
          </motion.span>
        )}
      </div>

      {!section.included && section.reason && (
        <div css={css`padding: 0 ${theme.spacing[3]} ${theme.spacing[2]};`}>
          <Typography.Caption color="hint" css={css`font-style: italic;`}>
            {section.reason}
          </Typography.Caption>
        </div>
      )}

      <AnimatePresence>
        {expanded && section.content && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            css={css`overflow: hidden;`}
          >
            <div css={css`
              border-top: 1px solid ${theme.colors.border.light};
              padding: ${theme.spacing[3]};
            `}>
              <pre css={css`
                font-family: ${theme.typography.fontFamily.mono};
                font-size: 0.8rem;
                line-height: 1.5;
                white-space: pre-wrap;
                word-break: break-word;
                color: ${theme.colors.text.primary};
                margin: 0;
              `}>
                {section.content}
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

type LegacyTabId = 'system' | 'user';

function LegacyTabBar({ active, onChange }: { active: LegacyTabId; onChange: (tab: LegacyTabId) => void }) {
  const theme = useTheme();
  const tabs: Array<{ id: LegacyTabId; label: string }> = [
    { id: 'system', label: 'System Prompt' },
    { id: 'user', label: 'User Message' },
  ];

  return (
    <div css={css`
      display: flex;
      gap: ${theme.spacing[4]};
      border-bottom: 1px solid ${theme.colors.border.light};
      margin-bottom: ${theme.spacing[4]};
    `}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          css={css`
            font-size: ${theme.typography.fontSize.sm};
            font-weight: ${active === tab.id
              ? theme.typography.fontWeight.semibold
              : theme.typography.fontWeight.normal};
            color: ${active === tab.id
              ? theme.colors.text.primary
              : theme.colors.text.secondary};
            padding: ${theme.spacing[2]} 0;
            border-bottom: 2px solid ${active === tab.id
              ? theme.colors.accent
              : 'transparent'};
            cursor: pointer;
            transition: all ${theme.transitions.micro};

            &:hover {
              color: ${theme.colors.text.primary};
            }
          `}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function LegacyTokenSummary({ sections }: { sections: ContextSection[] }) {
  const theme = useTheme();
  const includedSections = sections.filter((s) => s.included);
  const totalTokens = includedSections.reduce((sum, s) => sum + s.tokenCount, 0);
  const includedCount = includedSections.length;
  const excludedCount = sections.length - includedCount;

  return (
    <div css={css`
      display: flex;
      align-items: center;
      gap: ${theme.spacing[4]};
      margin-bottom: ${theme.spacing[4]};
      flex-wrap: wrap;
    `}>
      <div>
        <Typography.Caption color="hint" css={css`display: block;`}>Total Tokens</Typography.Caption>
        <span css={css`
          font-family: ${theme.typography.fontFamily.mono};
          font-size: ${theme.typography.fontSize.sm};
          font-weight: ${theme.typography.fontWeight.semibold};
          color: ${theme.colors.text.primary};
        `}>
          ~{totalTokens.toLocaleString()}
        </span>
      </div>
      <div>
        <Typography.Caption color="hint" css={css`display: block;`}>Sections</Typography.Caption>
        <span css={css`
          font-family: ${theme.typography.fontFamily.mono};
          font-size: ${theme.typography.fontSize.sm};
          color: ${theme.colors.text.primary};
        `}>
          {includedCount} included
        </span>
        {excludedCount > 0 && (
          <span css={css`
            font-family: ${theme.typography.fontFamily.mono};
            font-size: ${theme.typography.fontSize.sm};
            color: ${theme.colors.text.hint};
            margin-left: ${theme.spacing[1]};
          `}>
            / {excludedCount} excluded
          </span>
        )}
      </div>
    </div>
  );
}

function LegacyContextView({
  systemSections,
  userSections,
}: {
  systemSections: ContextSection[];
  userSections: ContextSection[];
}) {
  const [activeTab, setActiveTab] = useState<LegacyTabId>('user');
  const activeSections = activeTab === 'system' ? systemSections : userSections;
  const noSystemManifest = activeTab === 'system' && systemSections.length === 0;

  return (
    <>
      <LegacyTabBar active={activeTab} onChange={setActiveTab} />

      {noSystemManifest ? (
        <Typography.Body serif italic color="hint" css={css`text-align: center; padding: 2rem 0;`}>
          No system prompt manifest available for this tick.
        </Typography.Body>
      ) : activeSections.length === 0 ? (
        <Typography.Body serif italic color="hint" css={css`text-align: center; padding: 2rem 0;`}>
          No manifest available for this tick.
        </Typography.Body>
      ) : (
        <>
          <LegacyTokenSummary sections={activeSections} />
          {activeSections.map((section) => (
            <LegacySectionCard key={section.id} section={section} />
          ))}
        </>
      )}
    </>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function ContextInspector({
  tickNumber,
  onBack,
}: {
  tickNumber: number;
  onBack: () => void;
}) {
  const theme = useTheme();

  const { data, isLoading } = trpc.heartbeat.getTickDetail.useQuery(
    { tickNumber },
    { retry: false },
  );

  // Parse the Cortex context snapshot if available
  const cortexSnapshot = useMemo<CortexContextSnapshot | null>(() => {
    if (!data?.cortexContextSnapshot) return null;
    return data.cortexContextSnapshot as unknown as CortexContextSnapshot;
  }, [data]);

  // Parse per-phase usage data if available
  const phaseUsage = useMemo<PhaseUsage[] | undefined>(() => {
    if (!data) return undefined;
    const dataRecord = data as Record<string, unknown>;
    const raw = dataRecord['phaseUsage'];
    if (!Array.isArray(raw) || raw.length === 0) return undefined;
    return (raw as Array<Record<string, unknown>>).map((p) => ({
      phase: String(p['phase'] ?? ''),
      inputTokens: Number(p['inputTokens'] ?? p['input_tokens'] ?? 0),
      outputTokens: Number(p['outputTokens'] ?? p['output_tokens'] ?? 0),
      cacheReadTokens: Number(p['cacheReadTokens'] ?? p['cache_read_tokens'] ?? 0),
      cacheWriteTokens: Number(p['cacheWriteTokens'] ?? p['cache_write_tokens'] ?? 0),
      costUsd: Number(p['costUsd'] ?? p['cost_usd'] ?? 0),
      model: (p['model'] as string) ?? null,
    }));
  }, [data]);

  // Legacy manifests (for pre-Cortex ticks)
  const systemSections = useMemo<ContextSection[]>(() => {
    if (!data) return [];
    return (data.systemPromptManifest as ContextSection[] | null) ?? [];
  }, [data]);

  const userSections = useMemo<ContextSection[]>(() => {
    if (!data) return [];
    return (data.userMessageManifest as ContextSection[] | null) ?? [];
  }, [data]);

  if (isLoading) {
    return (
      <Typography.Body serif italic color="hint" css={css`text-align: center; padding: 4rem 0;`}>
        Loading context...
      </Typography.Body>
    );
  }

  if (!data) {
    return (
      <div>
        <BackButton onBack={onBack} />
        <Typography.Body serif italic color="hint" css={css`text-align: center; padding: 4rem 0;`}>
          Tick #{tickNumber} not found.
        </Typography.Body>
      </div>
    );
  }

  const hasLegacy = systemSections.length > 0 || userSections.length > 0;

  return (
    <div>
      <BackButton onBack={onBack} />

      <div css={css`margin-bottom: ${theme.spacing[4]};`}>
        <Typography.Subtitle color="primary">
          Context Inspector: Tick #{tickNumber}
        </Typography.Subtitle>
      </div>

      {cortexSnapshot ? (
        <CortexContextView snapshot={cortexSnapshot} phaseUsage={phaseUsage} />
      ) : hasLegacy ? (
        <LegacyContextView
          systemSections={systemSections}
          userSections={userSections}
        />
      ) : (
        <Typography.Body serif italic color="hint" css={css`text-align: center; padding: 2rem 0;`}>
          No context data available for this tick.
        </Typography.Body>
      )}
    </div>
  );
}

// ============================================================================
// Back Button
// ============================================================================

function BackButton({ onBack }: { onBack: () => void }) {
  const theme = useTheme();
  return (
    <button
      onClick={onBack}
      css={css`
        display: flex;
        align-items: center;
        gap: ${theme.spacing[1]};
        font-size: ${theme.typography.fontSize.sm};
        color: ${theme.colors.text.secondary};
        cursor: pointer;
        padding: ${theme.spacing[1]} 0;
        margin-bottom: ${theme.spacing[4]};
        transition: color ${theme.transitions.micro};

        &:hover { color: ${theme.colors.text.primary}; }
      `}
    >
      <ArrowLeft size={14} />
      Back to timeline
    </button>
  );
}
