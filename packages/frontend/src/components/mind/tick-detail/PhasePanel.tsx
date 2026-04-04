/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { motion, AnimatePresence } from 'motion/react';
import {
  CaretDown,
  Lightbulb,
  Lightning,
  Eye,
  Gear,
  Star,
  ArrowsClockwise,
} from '@phosphor-icons/react';
import type { PhaseGroup, TickResults } from './types';
import { Badge, formatDuration, formatCost, truncate } from './shared';
import { TurnCard } from './TurnCard';
import { ContextEvolutionChart } from './ContextEvolutionChart';
import { PhaseContextBudgetBar, InspectContextLink } from './context-components';
import type { PhaseUsage, PhaseContextSnapshot, AgenticTurnDelta } from '@animus-labs/shared';

// ============================================================================
// Phase visual config
// ============================================================================

const PHASE_COLORS: Record<string, string> = {
  gather: '#888',
  thought: '#8B7EC8',
  agentic_loop: '#C4943A',
  reflect: '#5B8DEF',
  execute: '#2D8A6E',
};

const PHASE_ICONS: Record<string, typeof Lightbulb> = {
  gather: Gear,
  thought: Lightbulb,
  agentic_loop: Lightning,
  reflect: Eye,
  execute: ArrowsClockwise,
};

// ============================================================================
// Token stats grid
// ============================================================================

/** Cache hit rate: cacheRead / (cacheRead + cacheWrite + input) */
function cacheHitRate(usage: PhaseUsage): number {
  const total = usage.cacheReadTokens + usage.cacheWriteTokens + usage.inputTokens;
  if (total === 0) return 0;
  return (usage.cacheReadTokens / total) * 100;
}

function hitRateColor(rate: number, theme: ReturnType<typeof useTheme>): string {
  if (rate >= 70) return theme.colors.success.main;
  if (rate >= 30) return theme.colors.warning.main;
  return theme.colors.error.main;
}

function PhaseTokenStats({ usage }: { usage: PhaseUsage }) {
  const theme = useTheme();

  // Total context = input + cacheRead + cacheWrite (all three are input token categories)
  const totalIn = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const hitRate = cacheHitRate(usage);

  const items: Array<{ label: string; value: string; color?: string }> = [
    { label: 'Total In', value: totalIn.toLocaleString() },
    { label: 'Output', value: usage.outputTokens.toLocaleString() },
  ];
  if (usage.cacheReadTokens > 0 || usage.cacheWriteTokens > 0) {
    items.push({ label: 'Cache Hit', value: `${hitRate.toFixed(0)}%`, color: hitRateColor(hitRate, theme) });
  }
  if (usage.cacheReadTokens > 0) {
    items.push({ label: 'Cached', value: usage.cacheReadTokens.toLocaleString() });
  }
  if (usage.cacheWriteTokens > 0) {
    items.push({ label: 'New', value: usage.cacheWriteTokens.toLocaleString() });
  }
  const cost = formatCost(usage.costUsd);
  if (cost) {
    items.push({ label: 'Cost', value: cost });
  }

  return (
    <div css={css`
      display: flex;
      flex-wrap: wrap;
      gap: ${theme.spacing[4]};
      padding: ${theme.spacing[2]} ${theme.spacing[3]};
      margin-top: ${theme.spacing[3]};
      background: ${theme.mode === 'light' ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.02)'};
      border-radius: ${theme.borderRadius.sm};
    `}>
      {items.map((item) => (
        <div key={item.label} css={css`display: flex; flex-direction: column; gap: 1px;`}>
          <span css={css`
            font-family: ${theme.typography.fontFamily.sans};
            font-size: 10px;
            font-weight: ${theme.typography.fontWeight.medium};
            color: ${theme.colors.text.hint};
            text-transform: uppercase;
            letter-spacing: 0.04em;
          `}>
            {item.label}
          </span>
          <span css={css`
            font-family: ${theme.typography.fontFamily.mono};
            font-size: 12px;
            color: ${item.color ?? theme.colors.text.secondary};
            ${item.color ? `font-weight: ${theme.typography.fontWeight.medium};` : ''}
          `}>
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Phase-specific detail renderers
// ============================================================================

function GatherDetail({ phase }: { phase: PhaseGroup }) {
  const theme = useTheme();
  const tickInputEvent = phase.events.find((e) => e.eventType === 'tick_input');
  const tokenBreakdown = tickInputEvent?.data['tokenBreakdown'] as Record<string, number> | undefined;
  const triggerType = tickInputEvent?.data['triggerType'] as string | undefined;

  return (
    <div>
      {triggerType && (
        <div css={css`margin-bottom: ${theme.spacing[2]};`}>
          <Badge label={triggerType} color={theme.colors.accent} />
        </div>
      )}
      {tokenBreakdown && (
        <div css={css`
          display: flex;
          flex-wrap: wrap;
          gap: ${theme.spacing[4]};
          padding: ${theme.spacing[2]} ${theme.spacing[3]};
          background: ${theme.mode === 'light' ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.02)'};
          border-radius: ${theme.borderRadius.sm};
        `}>
          {Object.entries(tokenBreakdown).map(([key, val]) => (
            <div key={key} css={css`display: flex; flex-direction: column; gap: 1px;`}>
              <span css={css`
                font-family: ${theme.typography.fontFamily.sans};
                font-size: 10px;
                font-weight: ${theme.typography.fontWeight.medium};
                color: ${theme.colors.text.hint};
                text-transform: uppercase;
                letter-spacing: 0.04em;
              `}>
                {key}
              </span>
              <span css={css`
                font-family: ${theme.typography.fontFamily.mono};
                font-size: 12px;
                color: ${theme.colors.text.secondary};
              `}>
                {val.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ThoughtDetail({ phase }: { phase: PhaseGroup }) {
  const theme = useTheme();
  const thoughtEnd = phase.events.find((e) => e.eventType === 'thought_end');
  const content = (thoughtEnd?.data['content'] as string) ?? '';
  const importance = thoughtEnd?.data['importance'] as number | undefined;
  const failed = thoughtEnd?.data['failed'] === true;

  return (
    <div>
      {failed ? (
        <span css={css`font-size: 13px; color: ${theme.colors.error.main};`}>
          Thought generation failed
        </span>
      ) : content ? (
        <div>
          <div css={css`
            font-family: ${theme.typography.fontFamily.serif};
            font-size: 15px;
            line-height: 1.6;
            color: ${theme.colors.text.primary};
          `}>
            {content}
          </div>
          {importance != null && (
            <span css={css`
              display: inline-flex;
              align-items: center;
              gap: 3px;
              font-family: ${theme.typography.fontFamily.mono};
              font-size: 11px;
              color: ${theme.colors.text.hint};
              margin-top: ${theme.spacing[1.5]};
            `}>
              {importance > 0.7 && <Star size={12} weight="fill" />}
              importance: {importance.toFixed(2)}
            </span>
          )}
        </div>
      ) : null}
      {phase.usage && <PhaseTokenStats usage={phase.usage} />}
    </div>
  );
}

function AgenticLoopDetail({
  phase,
  contextWindow,
  turnDeltas,
}: {
  phase: PhaseGroup;
  contextWindow: number | null;
  turnDeltas?: PhaseContextSnapshot[] | undefined;
}) {
  const theme = useTheme();
  const turns = phase.turns ?? [];

  return (
    <div>
      {/* Token usage summary */}
      {phase.usage && <PhaseTokenStats usage={phase.usage} />}

      {/* Context Evolution Chart */}
      {turns.length > 0 && turns.some((t) => t.inputTokens != null) && (
        <div css={css`margin-top: ${theme.spacing[4]};`}>
          <span css={css`
            display: block;
            font-family: ${theme.typography.fontFamily.sans};
            font-size: 10px;
            font-weight: ${theme.typography.fontWeight.medium};
            color: ${theme.colors.text.hint};
            text-transform: uppercase;
            letter-spacing: 0.04em;
            margin-bottom: ${theme.spacing[2]};
          `}>
            Context Window
          </span>
          <ContextEvolutionChart turns={turns} contextWindow={contextWindow} />
        </div>
      )}

      {/* Turn breakdown */}
      {turns.length > 0 && (
        <div css={css`margin-top: ${theme.spacing[4]};`}>
          <span css={css`
            display: block;
            font-family: ${theme.typography.fontFamily.sans};
            font-size: 10px;
            font-weight: ${theme.typography.fontWeight.medium};
            color: ${theme.colors.text.hint};
            text-transform: uppercase;
            letter-spacing: 0.04em;
            margin-bottom: ${theme.spacing[2]};
          `}>
            Turns ({turns.length})
          </span>
          <div css={css`
            display: flex;
            flex-direction: column;
            gap: 0;
          `}>
            {turns.map((turn) => {
              // Match turn delta by turn number
              const delta = turnDeltas?.find(
                (d) => d.phase === 'agentic_turn' && (d as AgenticTurnDelta).turnNumber === turn.turnNumber,
              ) as AgenticTurnDelta | undefined;
              return (
                <TurnCard
                  key={turn.turnNumber}
                  turn={turn}
                  isLast={turn.turnNumber === turns.length}
                  turnDelta={delta}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ReflectDetail({ phase, results }: { phase: PhaseGroup; results: TickResults | null }) {
  const theme = useTheme();
  const reflectEnd = phase.events.find((e) => e.eventType === 'reflect_end');
  const failed = reflectEnd?.data['failed'] === true;

  const emotionCount = (reflectEnd?.data['emotionDeltaCount'] as number) ?? 0;
  const decisionCount = (reflectEnd?.data['decisionCount'] as number) ?? 0;
  const memoryCount = (reflectEnd?.data['memoryCandidateCount'] as number) ?? 0;

  return (
    <div>
      {failed ? (
        <span css={css`color: ${theme.colors.error.main}; font-size: 13px;`}>
          Reflection failed
        </span>
      ) : (
        <div css={css`
          display: flex;
          flex-wrap: wrap;
          gap: ${theme.spacing[2]};
        `}>
          {emotionCount > 0 && <Badge label={`${emotionCount} emotion${emotionCount > 1 ? 's' : ''}`} color={theme.colors.text.secondary} />}
          {decisionCount > 0 && <Badge label={`${decisionCount} decision${decisionCount > 1 ? 's' : ''}`} color={theme.colors.text.secondary} />}
          {memoryCount > 0 && <Badge label={`${memoryCount} memor${memoryCount > 1 ? 'ies' : 'y'}`} color={theme.colors.text.secondary} />}
          {emotionCount === 0 && decisionCount === 0 && memoryCount === 0 && (
            <span css={css`color: ${theme.colors.text.hint}; font-size: 13px;`}>No changes</span>
          )}
        </div>
      )}

      {/* Emotion deltas */}
      {results && results.emotionDeltas.length > 0 && (
        <div css={css`
          margin-top: ${theme.spacing[3]};
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 8px 20px;
          @media (max-width: 768px) { grid-template-columns: 1fr; }
        `}>
          {results.emotionDeltas.map((d, i) => (
            <div key={i} css={css`display: flex; align-items: baseline; gap: ${theme.spacing[1.5]};`}>
              <span css={css`
                font-size: 13px;
                font-weight: ${theme.typography.fontWeight.medium};
                color: ${theme.colors.text.primary};
              `}>
                {d.emotion}
              </span>
              <span css={css`
                font-family: ${theme.typography.fontFamily.mono};
                font-size: 12px;
                color: ${d.delta > 0 ? theme.colors.success.main : d.delta < 0 ? theme.colors.error.main : theme.colors.text.hint};
              `}>
                {d.delta > 0 ? '+' : ''}{d.delta.toFixed(3)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Experiences */}
      {results && results.experiences.length > 0 && (
        <div css={css`margin-top: ${theme.spacing[3]};`}>
          {results.experiences.map((e, i) => (
            <div key={i} css={css`
              border-left: 2px solid ${theme.colors.accent}33;
              padding-left: ${theme.spacing[3]};
              ${i < results.experiences.length - 1 ? `margin-bottom: ${theme.spacing[2]};` : ''}
            `}>
              <span css={css`
                font-family: ${theme.typography.fontFamily.serif};
                font-size: 15px;
                font-style: italic;
                line-height: 1.6;
                color: ${theme.colors.text.primary};
                display: block;
              `}>
                {e.content}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Decisions */}
      {results && results.decisions.length > 0 && (
        <div css={css`
          margin-top: ${theme.spacing[3]};
          display: flex;
          flex-direction: column;
          gap: ${theme.spacing[2]};
        `}>
          {results.decisions.map((d, i) => {
            const outcomeColor = d.outcome === 'executed' ? theme.colors.success.main
              : d.outcome === 'dropped' ? theme.colors.warning.main
              : theme.colors.error.main;
            return (
              <div key={i} css={css`
                display: flex;
                align-items: baseline;
                gap: ${theme.spacing[2]};
                flex-wrap: wrap;
              `}>
                <Badge label={d.type} color={outcomeColor} />
                <span css={css`font-size: 13px; color: ${theme.colors.text.primary};`}>
                  {d.description}
                </span>
                <span css={css`
                  font-family: ${theme.typography.fontFamily.mono};
                  font-size: 11px;
                  color: ${outcomeColor};
                `}>
                  [{d.outcome}]
                </span>
              </div>
            );
          })}
        </div>
      )}

      {phase.usage && <PhaseTokenStats usage={phase.usage} />}
    </div>
  );
}

function ExecuteDetail({ phase, results }: { phase: PhaseGroup; results: TickResults | null }) {
  const theme = useTheme();

  const replySent = phase.events.find((e) => e.eventType === 'execute_reply_sent');
  const decisionsComplete = phase.events.find((e) => e.eventType === 'execute_decisions_complete');
  const memoryComplete = phase.events.find((e) => e.eventType === 'execute_memory_complete');

  const replyPath = (replySent?.data['path'] as string) ?? '';
  const hasReply = replySent?.data['hasReply'] === true;
  const contactName = (replySent?.data['contactName'] as string) ?? '';
  const channel = (replySent?.data['channel'] as string) ?? '';

  const agentDecisions = (decisionsComplete?.data['agentDecisions'] as number) ?? 0;
  const pluginDecisions = (decisionsComplete?.data['pluginDecisions'] as number) ?? 0;

  const memoryCandidates = (memoryComplete?.data['candidateCount'] as number) ?? 0;
  const hadWorkingMemory = memoryComplete?.data['hadWorkingMemoryUpdate'] === true;
  const hadCoreSelf = memoryComplete?.data['hadCoreSelfUpdate'] === true;

  const items: string[] = [];
  if (hasReply) {
    const target = [contactName, channel].filter(Boolean).join(' via ');
    items.push(`Reply sent${target ? ` to ${target}` : ''} (${replyPath || 'standard'})`);
  }
  if (agentDecisions > 0 || pluginDecisions > 0) {
    const parts: string[] = [];
    if (agentDecisions > 0) parts.push(`${agentDecisions} agent`);
    if (pluginDecisions > 0) parts.push(`${pluginDecisions} plugin`);
    items.push(`${parts.join(', ')} decision(s) executed`);
  }
  if (memoryCandidates > 0) items.push(`${memoryCandidates} memory candidate(s)`);
  if (hadWorkingMemory) items.push('Working memory updated');
  if (hadCoreSelf) items.push('Core self updated');
  if (items.length === 0) items.push('No operations');

  return (
    <div css={css`
      display: flex;
      flex-direction: column;
      gap: ${theme.spacing[1]};
    `}>
      {items.map((item, i) => (
        <span key={i} css={css`font-size: 13px; color: ${theme.colors.text.secondary};`}>
          {item}
        </span>
      ))}
      {results?.reply && (
        <div css={css`
          margin-top: ${theme.spacing[2]};
          border-left: 2px solid ${theme.colors.accent}4D;
          padding-left: ${theme.spacing[3]};
        `}>
          <span css={css`
            font-size: 14px;
            line-height: 1.6;
            color: ${theme.colors.text.primary};
            display: block;
          `}>
            {truncate(results.reply.content, 300)}
          </span>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// PhasePanel
// ============================================================================

interface PhasePanelProps {
  phase: PhaseGroup;
  isExpanded: boolean;
  onToggle: () => void;
  results: TickResults | null;
  contextWindow: number | null;
  /** Per-phase context snapshot (if captured) */
  phaseSnapshot?: PhaseContextSnapshot | undefined;
  /** Per-turn deltas for the agentic loop (if captured in debug mode) */
  turnDeltas?: PhaseContextSnapshot[] | undefined;
  /** Navigate to the context detail page for this phase */
  onInspectContext?: (() => void) | undefined;
}

export function PhasePanel({
  phase,
  isExpanded,
  onToggle,
  results,
  contextWindow,
  phaseSnapshot,
  turnDeltas,
  onInspectContext,
}: PhasePanelProps) {
  const theme = useTheme();
  const color = PHASE_COLORS[phase.name] ?? theme.colors.text.secondary;
  const Icon = PHASE_ICONS[phase.name] ?? Gear;

  if (phase.status === 'skipped') return null;

  const summary = getPhaseQuickSummary(phase);

  return (
    <div css={css`
      border: 1px solid ${isExpanded ? `${color}33` : theme.colors.border.light};
      border-radius: ${theme.borderRadius.md};
      overflow: hidden;
      transition: border-color ${theme.transitions.fast};
    `}>
      {/* Header */}
      <button
        onClick={onToggle}
        css={css`
          display: flex;
          align-items: center;
          gap: ${theme.spacing[2]};
          width: 100%;
          padding: 10px ${theme.spacing[3]};
          cursor: pointer;
          text-align: left;
          transition: background ${theme.transitions.micro};
          background: ${isExpanded
            ? (theme.mode === 'light' ? `${color}08` : `${color}0A`)
            : 'transparent'};

          &:hover {
            background: ${theme.mode === 'light'
              ? 'rgba(0, 0, 0, 0.02)'
              : 'rgba(255, 255, 255, 0.03)'};
          }
        `}
      >
        {/* Color bar */}
        <div css={css`
          width: 3px;
          align-self: stretch;
          border-radius: 2px;
          background: ${color};
          opacity: ${phase.status === 'pending' ? 0.3 : isExpanded ? 1 : 0.5};
          transition: opacity ${theme.transitions.fast};
          flex-shrink: 0;
        `} />

        {/* Icon */}
        <Icon
          size={15}
          weight={isExpanded ? 'fill' : 'regular'}
          css={css`color: ${color}; flex-shrink: 0;`}
        />

        {/* Label */}
        <span css={css`
          font-family: ${theme.typography.fontFamily.sans};
          font-size: ${theme.typography.fontSize.sm};
          font-weight: ${theme.typography.fontWeight.medium};
          color: ${theme.colors.text.primary};
          white-space: nowrap;
        `}>
          {phase.label}
        </span>

        {/* Duration */}
        {phase.durationMs != null && (
          <span css={css`
            font-family: ${theme.typography.fontFamily.mono};
            font-size: 12px;
            color: ${theme.colors.text.hint};
          `}>
            {formatDuration(phase.durationMs)}
          </span>
        )}

        {/* Running indicator */}
        {phase.status === 'running' && (
          <motion.div
            animate={{ opacity: [0.3, 0.8, 0.3] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            css={css`
              width: 6px; height: 6px; border-radius: 50%;
              background: ${color}; flex-shrink: 0;
            `}
          />
        )}

        {/* Quick summary (collapsed only) */}
        {!isExpanded && summary && (
          <span css={css`
            font-size: 13px;
            color: ${theme.colors.text.hint};
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            min-width: 0;
            flex: 1;
          `}>
            {summary}
          </span>
        )}

        <span css={css`flex: 1;`} />

        {/* Expand caret */}
        <motion.span
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          css={css`
            color: ${theme.colors.text.hint};
            display: flex;
            align-items: center;
            flex-shrink: 0;
          `}
        >
          <CaretDown size={12} />
        </motion.span>
      </button>

      {/* Expanded detail */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            css={css`overflow: hidden;`}
          >
            <div css={css`
              padding: ${theme.spacing[3]} ${theme.spacing[4]} ${theme.spacing[4]};
              border-top: 1px solid ${theme.colors.border.light};
            `}>
              {/* Inline context budget bar for LLM phases */}
              {phaseSnapshot && phaseSnapshot.phase !== 'agentic_turn' && (
                <div css={css`margin-bottom: ${theme.spacing[4]};`}>
                  <PhaseContextBudgetBar snapshot={phaseSnapshot} contextWindow={contextWindow} />
                  {onInspectContext && (
                    <InspectContextLink
                      onClick={onInspectContext}
                      hasDetailedData={phaseSnapshot.phase === 'thought'
                        ? (phaseSnapshot.systemPrompt?.[0]?.content?.length ?? 0) > 0
                        : phaseSnapshot.phase === 'reflect'
                          ? (phaseSnapshot.systemPrompt?.[0]?.content?.length ?? 0) > 0
                          : true}
                    />
                  )}
                </div>
              )}

              {phase.name === 'gather' && <GatherDetail phase={phase} />}
              {phase.name === 'thought' && <ThoughtDetail phase={phase} />}
              {phase.name === 'agentic_loop' && (
                <AgenticLoopDetail phase={phase} contextWindow={contextWindow} turnDeltas={turnDeltas} />
              )}
              {phase.name === 'reflect' && <ReflectDetail phase={phase} results={results} />}
              {phase.name === 'execute' && <ExecuteDetail phase={phase} results={results} />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// Quick summary for collapsed state
// ============================================================================

function getPhaseQuickSummary(phase: PhaseGroup): string | null {
  switch (phase.name) {
    case 'gather': {
      const tickInput = phase.events.find((e) => e.eventType === 'tick_input');
      const breakdown = tickInput?.data['tokenBreakdown'] as Record<string, number> | undefined;
      if (breakdown) {
        const total = Object.values(breakdown).reduce((s, v) => s + v, 0);
        return `~${Math.round(total / 1000)}K tokens assembled`;
      }
      return null;
    }
    case 'thought': {
      const thoughtEnd = phase.events.find((e) => e.eventType === 'thought_end');
      if (thoughtEnd?.data['failed']) return 'failed';
      const content = (thoughtEnd?.data['content'] as string) ?? '';
      return content ? truncate(content, 60) : null;
    }
    case 'agentic_loop': {
      const turns = phase.turns ?? [];
      if (turns.length === 0) return null;
      const totalOutput = turns.reduce((s, t) => s + (t.outputTokens ?? 0), 0);
      return `${turns.length} turn${turns.length > 1 ? 's' : ''}${totalOutput > 0 ? `, ${Math.round(totalOutput / 1000)}K out` : ''}`;
    }
    case 'reflect': {
      const reflectEnd = phase.events.find((e) => e.eventType === 'reflect_end');
      if (reflectEnd?.data['failed']) return 'failed';
      const emo = (reflectEnd?.data['emotionDeltaCount'] as number) ?? 0;
      const dec = (reflectEnd?.data['decisionCount'] as number) ?? 0;
      const mem = (reflectEnd?.data['memoryCandidateCount'] as number) ?? 0;
      const parts: string[] = [];
      if (emo > 0) parts.push(`${emo} emotion${emo > 1 ? 's' : ''}`);
      if (dec > 0) parts.push(`${dec} decision${dec > 1 ? 's' : ''}`);
      if (mem > 0) parts.push(`${mem} memor${mem > 1 ? 'ies' : 'y'}`);
      return parts.length > 0 ? parts.join(', ') : 'no changes';
    }
    case 'execute': {
      const reply = phase.events.find((e) => e.eventType === 'execute_reply_sent');
      const hasReply = reply?.data['hasReply'] === true;
      const decisions = phase.events.find((e) => e.eventType === 'execute_decisions_complete');
      const totalD = (decisions?.data['totalDecisions'] as number) ?? 0;
      const parts: string[] = [];
      if (hasReply) {
        const path = (reply?.data['path'] as string) ?? '';
        parts.push(`Reply (${path || 'standard'})`);
      }
      if (totalD > 0) parts.push(`${totalD} decision(s)`);
      return parts.length > 0 ? parts.join(', ') : null;
    }
    default:
      return null;
  }
}
