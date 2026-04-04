/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CaretRight } from '@phosphor-icons/react';
import type { AgenticTurn } from './types';
import type { AgenticTurnDelta } from '@animus-labs/shared';
import { formatDuration, formatCost } from './shared';
import { MergedEventRow } from './event-row';

// ============================================================================
// TurnCard
// ============================================================================

interface TurnCardProps {
  turn: AgenticTurn;
  isLast: boolean;
  /** Per-turn context delta from debug mode capture */
  turnDelta?: AgenticTurnDelta | undefined;
}

export function TurnCard({ turn, isLast, turnDelta }: TurnCardProps) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);

  const isLive = turn.endMs == null;
  const formattedCost = formatCost(turn.cost);
  const toolCount = turn.mergedEvents.filter((e) => e.kind === 'tool_use').length;

  return (
    <div css={css`
      border-bottom: ${!isLast ? `1px solid ${theme.colors.border.light}` : 'none'};
    `}>
      {/* Header */}
      <button
        onClick={() => setExpanded((o) => !o)}
        css={css`
          display: flex;
          align-items: center;
          gap: ${theme.spacing[2]};
          width: 100%;
          padding: ${theme.spacing[2]} ${theme.spacing[1]};
          cursor: pointer;
          transition: background ${theme.transitions.micro};

          &:hover {
            background: ${theme.mode === 'light'
              ? 'rgba(0, 0, 0, 0.02)'
              : 'rgba(255, 255, 255, 0.03)'};
          }
        `}
      >
        {/* Turn number */}
        <span css={css`
          font-family: ${theme.typography.fontFamily.mono};
          font-size: 12px;
          font-weight: ${theme.typography.fontWeight.medium};
          color: ${theme.colors.text.secondary};
          min-width: 20px;
        `}>
          {turn.turnNumber}
        </span>

        {/* Duration or live indicator */}
        {isLive ? (
          <BreathingIndicator />
        ) : turn.durationMs != null ? (
          <span css={css`
            font-family: ${theme.typography.fontFamily.mono};
            font-size: 11px;
            color: ${theme.colors.text.hint};
            min-width: 36px;
          `}>
            {formatDuration(turn.durationMs)}
          </span>
        ) : null}

        {/* Token stats */}
        <span css={css`
          display: inline-flex;
          align-items: baseline;
          gap: ${theme.spacing[2]};
          font-family: ${theme.typography.fontFamily.mono};
          font-size: 11px;
          color: ${theme.colors.text.hint};
        `}>
          {(turn.inputTokens != null || turn.cacheReadTokens != null || turn.cacheWriteTokens != null) && (
            <span>
              <span css={css`color: ${theme.colors.text.secondary};`}>
                {formatTokenCount((turn.inputTokens ?? 0) + (turn.cacheReadTokens ?? 0) + (turn.cacheWriteTokens ?? 0))}
              </span>
              {' in'}
            </span>
          )}
          {turn.outputTokens != null && (
            <span>
              <span css={css`color: ${theme.colors.text.secondary};`}>
                {formatTokenCount(turn.outputTokens)}
              </span>
              {' out'}
            </span>
          )}
        </span>

        {/* Tool count hint */}
        {toolCount > 0 && !expanded && (
          <span css={css`
            font-family: ${theme.typography.fontFamily.sans};
            font-size: 11px;
            color: ${theme.colors.text.hint};
          `}>
            {toolCount} tool{toolCount !== 1 ? 's' : ''}
          </span>
        )}

        {/* History size from turn delta (debug mode) */}
        {turnDelta && (
          <span css={css`
            font-family: ${theme.typography.fontFamily.mono};
            font-size: 11px;
            color: ${theme.colors.text.hint};
          `}>
            {turnDelta.totalHistoryMessages} msgs
            {turnDelta.newMessageCount > 0 && ` (+${turnDelta.newMessageCount})`}
          </span>
        )}

        {/* Cost */}
        {formattedCost != null && (
          <span css={css`
            font-family: ${theme.typography.fontFamily.mono};
            font-size: 11px;
            color: ${theme.colors.text.hint};
          `}>
            {formattedCost}
          </span>
        )}

        <span css={css`flex: 1;`} />

        {/* Expand caret */}
        <CaretRight
          size={10}
          weight="bold"
          css={css`
            color: ${theme.colors.text.disabled};
            flex-shrink: 0;
            transition: transform ${theme.transitions.micro};
            transform: rotate(${expanded ? '90deg' : '0deg'});
          `}
        />
      </button>

      {/* Expanded body */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            css={css`overflow: hidden;`}
          >
            <div css={css`
              padding: 0 ${theme.spacing[1]} ${theme.spacing[2]} ${theme.spacing[6]};
            `}>
              {turn.mergedEvents.map((event, i) => (
                <MergedEventRow key={i} event={event} index={i} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Compaction callouts */}
      {turn.compactionAfter.length > 0 && (
        <div css={css`
          padding: 0 ${theme.spacing[1]} ${theme.spacing[1]};
        `}>
          {turn.compactionAfter.map((event, i) => (
            <MergedEventRow key={`compaction-${i}`} event={event} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// BreathingIndicator
// ============================================================================

function BreathingIndicator() {
  const theme = useTheme();
  return (
    <motion.span
      animate={{ opacity: [0.35, 0.8, 0.35] }}
      transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      css={css`
        display: inline-block;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: ${theme.colors.warning.main};
        flex-shrink: 0;
      `}
    />
  );
}

// ============================================================================
// Helpers
// ============================================================================

function formatTokenCount(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  }
  return tokens.toLocaleString();
}
