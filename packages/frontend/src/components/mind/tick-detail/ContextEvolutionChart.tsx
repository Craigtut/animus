/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useMemo } from 'react';
import { motion } from 'motion/react';
import { ArrowDown } from '@phosphor-icons/react';
import type { AgenticTurn } from './types';

// ============================================================================
// Number formatting
// ============================================================================

function formatCompact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}K`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function reductionPercent(before: number, after: number): string {
  if (before === 0) return '0%';
  const pct = Math.round(((before - after) / before) * 100);
  return `-${pct}%`;
}

// ============================================================================
// Bar color
// ============================================================================

function barColor(ratio: number, mode: 'light' | 'dark'): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  const hue = 175 - clamped * 137;
  const sat = 40 + clamped * 20;
  const lightBase = mode === 'light' ? 48 : 42;
  const light = lightBase + (1 - clamped) * 8;
  return `hsl(${Math.round(hue)}, ${Math.round(sat)}%, ${Math.round(light)}%)`;
}

// ============================================================================
// Label sampling for many turns
// ============================================================================

function shouldShowLabel(index: number, total: number): boolean {
  if (total <= 12) return true;
  if (index === 0 || index === total - 1) return true;
  const step = Math.ceil(total / 8);
  return index % step === 0;
}

// ============================================================================
// ContextEvolutionChart
// ============================================================================

interface ContextEvolutionChartProps {
  turns: AgenticTurn[];
  contextWindow: number | null;
}

export function ContextEvolutionChart({ turns, contextWindow }: ContextEvolutionChartProps) {
  const theme = useTheme();

  // Total context = input + cacheRead + cacheWrite (all three are input token categories)
  const contextSize = (turn: AgenticTurn): number => {
    return (turn.inputTokens ?? 0) + (turn.cacheReadTokens ?? 0) + (turn.cacheWriteTokens ?? 0);
  };

  const { validTurns, maxTokens, ceiling, hasData } = useMemo(() => {
    const valid = turns.filter((t) => contextSize(t) > 0);
    if (valid.length === 0) return { validTurns: [], maxTokens: 0, ceiling: 0, hasData: false };
    const maxCtx = Math.max(...valid.map((t) => contextSize(t)));
    const ceil = contextWindow != null && contextWindow > 0
      ? Math.max(contextWindow, maxCtx)
      : maxCtx;
    return { validTurns: valid, maxTokens: maxCtx, ceiling: ceil, hasData: true };
  }, [turns, contextWindow]);

  if (!hasData) {
    return (
      <div css={css`
        display: flex;
        align-items: center;
        justify-content: center;
        height: 48px;
        border: 1px dashed ${theme.colors.border.light};
        border-radius: ${theme.borderRadius.sm};
        font-size: ${theme.typography.fontSize.xs};
        color: ${theme.colors.text.hint};
      `}>
        No token data
      </div>
    );
  }

  const numTurns = validTurns.length;
  const showLimit = contextWindow != null && contextWindow > 0;
  const limitRatio = showLimit ? contextWindow! / ceiling : 1;
  const chartHeight = Math.min(120, Math.max(60, numTurns * 4));

  return (
    <div css={css`
      border: 1px solid ${theme.colors.border.light};
      border-radius: ${theme.borderRadius.sm};
      padding: ${theme.spacing[2]} ${theme.spacing[3]} ${theme.spacing[1.5]};
      background: ${theme.mode === 'light' ? 'rgba(0,0,0,0.01)' : 'rgba(255,255,255,0.01)'};
    `}>
      {/* Chart area */}
      <div css={css`
        position: relative;
        height: ${chartHeight}px;
        width: 100%;
      `}>
        {/* Subtle grid lines */}
        {[0.5].map((pct) => (
          <div
            key={pct}
            css={css`
              position: absolute;
              left: 0;
              right: 0;
              bottom: ${pct * 100}%;
              height: 1px;
              background: ${theme.colors.border.light};
              pointer-events: none;
            `}
          />
        ))}

        {/* Context window limit line */}
        {showLimit && limitRatio < 1 && (
          <div css={css`
            position: absolute;
            left: 0;
            right: 0;
            bottom: ${limitRatio * 100}%;
            display: flex;
            align-items: center;
            pointer-events: none;
            z-index: 2;
          `}>
            <div css={css`
              flex: 1;
              height: 0;
              border-top: 1px dashed ${theme.colors.warning.main}66;
            `} />
            <span css={css`
              font-family: ${theme.typography.fontFamily.mono};
              font-size: 9px;
              color: ${theme.colors.warning.main};
              padding-left: ${theme.spacing[1]};
              white-space: nowrap;
              flex-shrink: 0;
            `}>
              {formatCompact(contextWindow!)}
            </span>
          </div>
        )}

        {/* Bars */}
        <div css={css`
          position: relative;
          display: flex;
          align-items: flex-end;
          height: 100%;
          gap: ${numTurns > 20 ? '1px' : '2px'};
          padding-right: ${showLimit && limitRatio < 1 ? '48px' : '0'};
        `}>
          {validTurns.map((turn, i) => {
            const tokens = contextSize(turn);
            const heightPct = (tokens / ceiling) * 100;
            const usageRatio = contextWindow != null && contextWindow > 0
              ? tokens / contextWindow
              : tokens / maxTokens;
            const color = barColor(usageRatio, theme.mode);
            const hasCompaction = turn.compactionAfter.length > 0;

            let compactionLabel: string | null = null;
            if (hasCompaction) {
              const compEvent = turn.compactionAfter[0];
              if (compEvent?.tokensBefore != null && compEvent?.tokensAfter != null) {
                compactionLabel = reductionPercent(compEvent.tokensBefore, compEvent.tokensAfter);
              }
            }

            return (
              <div
                key={turn.turnNumber}
                css={css`
                  flex: 1;
                  min-width: 0;
                  display: flex;
                  flex-direction: column;
                  align-items: center;
                  height: 100%;
                  position: relative;
                `}
              >
                <div css={css`
                  flex: 1;
                  width: 100%;
                  display: flex;
                  align-items: flex-end;
                  min-width: 0;
                `}>
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: `${heightPct}%`, opacity: 1 }}
                    transition={{
                      duration: 0.35,
                      delay: i * 0.03,
                      ease: [0.25, 0.1, 0.25, 1],
                    }}
                    title={`Turn ${turn.turnNumber}: ${tokens.toLocaleString()} input tokens`}
                    css={css`
                      width: 100%;
                      max-width: 32px;
                      margin: 0 auto;
                      background: ${color};
                      border-radius: 2px 2px 0 0;
                      min-height: 2px;
                      cursor: default;
                      transition: filter ${theme.transitions.micro};
                      &:hover { filter: brightness(1.15); }
                    `}
                  />
                </div>

                {/* Compaction indicator */}
                {hasCompaction && (
                  <div css={css`
                    position: absolute;
                    right: ${numTurns > 20 ? '-3px' : '-5px'};
                    top: 50%;
                    transform: translateY(-50%);
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    z-index: 3;
                    pointer-events: none;
                  `}>
                    <ArrowDown
                      size={9}
                      weight="bold"
                      css={css`color: ${theme.colors.warning.main};`}
                    />
                    {compactionLabel && numTurns <= 15 && (
                      <span css={css`
                        font-family: ${theme.typography.fontFamily.mono};
                        font-size: 8px;
                        color: ${theme.colors.warning.main};
                        line-height: 1;
                        margin-top: 1px;
                      `}>
                        {compactionLabel}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Labels */}
      <div css={css`
        display: flex;
        gap: ${numTurns > 20 ? '1px' : '2px'};
        margin-top: ${theme.spacing[0.5]};
        padding-right: ${showLimit && limitRatio < 1 ? '48px' : '0'};
      `}>
        {validTurns.map((turn, i) => {
          const show = shouldShowLabel(i, numTurns);
          return (
            <div
              key={turn.turnNumber}
              css={css`
                flex: 1;
                min-width: 0;
                text-align: center;
                overflow: hidden;
              `}
            >
              {show && (
                <div css={css`
                  font-family: ${theme.typography.fontFamily.mono};
                  font-size: 9px;
                  color: ${theme.colors.text.hint};
                  line-height: 1.3;
                  white-space: nowrap;
                  overflow: hidden;
                  text-overflow: ellipsis;
                `}>
                  {formatCompact(contextSize(turn))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
