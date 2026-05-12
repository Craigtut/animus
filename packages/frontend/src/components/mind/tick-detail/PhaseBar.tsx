/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { motion } from 'motion/react';
import {
  Lightbulb,
  Lightning,
  Eye,
  Gear,
  ArrowsClockwise,
} from '@phosphor-icons/react';
import type { PhaseGroup, PhaseName } from './types';
import { formatDuration } from './shared';

// ============================================================================
// Phase visual config
// ============================================================================

const PHASE_COLORS: Record<PhaseName, string> = {
  gather: '',
  thought: '#8B7EC8',
  agentic_loop: '#C4943A',
  reflect: '#5B8DEF',
  execute: '#2D8A6E',
};

const SHORT_LABELS: Record<PhaseName, string> = {
  gather: 'Gather',
  thought: 'Thought',
  agentic_loop: 'Loop',
  reflect: 'Reflect',
  execute: 'Exec',
};

const PHASE_ICONS: Record<PhaseName, typeof Lightbulb> = {
  gather: Gear,
  thought: Lightbulb,
  agentic_loop: Lightning,
  reflect: Eye,
  execute: ArrowsClockwise,
};

// ============================================================================
// PhaseBar
// ============================================================================

interface PhaseBarProps {
  phases: PhaseGroup[];
  expandedPhase: PhaseName | null;
  onPhaseClick: (phase: PhaseName) => void;
}

export function PhaseBar({ phases, expandedPhase, onPhaseClick }: PhaseBarProps) {
  const theme = useTheme();

  const phaseColor = (name: PhaseName): string =>
    name === 'gather' ? theme.colors.text.hint : PHASE_COLORS[name];

  return (
    <div css={css`
      display: flex;
      gap: 2px;
      border-radius: ${theme.borderRadius.default};
      overflow: hidden;
      width: 100%;
      background: ${theme.mode === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.03)'};
    `}>
      {phases.map((phase) => {
        const color = phaseColor(phase.name);
        const isExpanded = expandedPhase === phase.name;
        const isSkipped = phase.status === 'skipped';
        const isPending = phase.status === 'pending';
        const isRunning = phase.status === 'running';
        const isClickable = !isSkipped && !isPending;
        const Icon = PHASE_ICONS[phase.name];

        // Sub-label: show turn count for agentic, cache hit rate for LLM phases
        let subLabel: string | null = null;
        if (phase.name === 'agentic_loop' && phase.turns && phase.turns.length > 0) {
          subLabel = `${phase.turns.length} turn${phase.turns.length !== 1 ? 's' : ''}`;
        } else if (phase.usage && phase.usage.outputTokens > 0) {
          subLabel = `${phase.usage.outputTokens.toLocaleString()} out`;
        }

        // Cache hit rate color for LLM phases
        let cacheHitPct: number | null = null;
        if (phase.usage) {
          const total = phase.usage.cacheReadTokens + phase.usage.cacheWriteTokens + phase.usage.inputTokens;
          if (total > 0) cacheHitPct = (phase.usage.cacheReadTokens / total) * 100;
        }

        return (
          <div
            key={phase.name}
            css={css`
              position: relative;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              gap: 2px;
              min-width: 52px;
              height: 44px;
              flex-grow: ${phase.durationMs != null && phase.durationMs > 0
                ? Math.max(phase.durationMs, 1)
                : 1};
              background: ${color}${isExpanded ? '18' : '0A'};
              cursor: ${isClickable ? 'pointer' : 'default'};
              opacity: ${isSkipped ? 0.25 : isPending ? 0.15 : 1};
              transition: background ${theme.transitions.fast}, opacity ${theme.transitions.fast};
              user-select: none;

              ${isClickable && `
                &:hover {
                  background: ${color}1F;
                }
              `}

              ${isRunning && `
                animation: phase-pulse 2000ms ease-in-out infinite;
                @keyframes phase-pulse {
                  0%, 100% { background: ${color}0A; }
                  50% { background: ${color}22; }
                }
              `}
            `}
            onClick={() => isClickable && onPhaseClick(phase.name)}
            role={isClickable ? 'button' : undefined}
            tabIndex={isClickable ? 0 : undefined}
            onKeyDown={(e) => {
              if (isClickable && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                onPhaseClick(phase.name);
              }
            }}
          >
            {/* Primary: icon + label + duration */}
            <span css={css`
              display: flex;
              align-items: center;
              gap: 4px;
              line-height: 1;
            `}>
              <Icon
                size={11}
                weight={isExpanded ? 'fill' : 'regular'}
                css={css`color: ${isExpanded ? color : theme.colors.text.hint}; flex-shrink: 0;`}
              />
              <span css={css`
                font-family: ${theme.typography.fontFamily.sans};
                font-size: 11px;
                font-weight: ${isExpanded ? theme.typography.fontWeight.semibold : theme.typography.fontWeight.medium};
                color: ${isExpanded ? color : theme.colors.text.secondary};
                transition: color ${theme.transitions.fast};
              `}>
                {SHORT_LABELS[phase.name]}
              </span>
              {phase.durationMs != null && !isSkipped && !isPending && (
                <span css={css`
                  font-family: ${theme.typography.fontFamily.mono};
                  font-size: 10px;
                  color: ${theme.colors.text.hint};
                `}>
                  {formatDuration(phase.durationMs)}
                </span>
              )}
            </span>

            {/* Sub-label */}
            {subLabel && (
              <span css={css`
                font-family: ${theme.typography.fontFamily.mono};
                font-size: 9px;
                color: ${theme.colors.text.hint};
                line-height: 1;
              `}>
                {subLabel}
              </span>
            )}

            {/* Active indicator */}
            {isExpanded && (
              <motion.div
                layoutId="phase-bar-indicator"
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                css={css`
                  position: absolute;
                  bottom: 0;
                  left: 0;
                  right: 0;
                  height: 2px;
                  background: ${color};
                `}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
