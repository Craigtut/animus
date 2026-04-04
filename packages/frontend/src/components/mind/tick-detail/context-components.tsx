/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CaretDown, ArrowSquareOut } from '@phosphor-icons/react';
import type { ContextSnapshotSection, PhaseContextSnapshot } from '@animus-labs/shared';

// ============================================================================
// Shared constants
// ============================================================================

const SECTION_COLORS = {
  systemPrompt: '#8B7EC8',
  cortexPrompt: '#888',
  slots: '#2D8A6E',
  history: '#5B8DEF',
  ephemeral: '#C4943A',
  prompt: '',  // resolved from theme.colors.accent at render time
} as const;

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

// ============================================================================
// BudgetSegment - a single colored segment in the bar
// ============================================================================

interface BudgetSegment {
  label: string;
  tokens: number;
  color: string;
}

// ============================================================================
// PhaseContextBudgetBar
//
// A compact stacked bar showing how the context window is divided across
// sections for a given phase. Works with any PhaseContextSnapshot shape.
// ============================================================================

export function PhaseContextBudgetBar({
  snapshot,
  contextWindow,
}: {
  snapshot: PhaseContextSnapshot;
  contextWindow?: number | null;
}) {
  const theme = useTheme();

  // Build segments based on snapshot phase type
  const segments = buildSegments(snapshot, theme.colors.accent);
  const totalTokens = 'totalTokens' in snapshot ? (snapshot.totalTokens ?? 0) : segments.reduce((s, seg) => s + seg.tokens, 0);
  const snapshotWindow = 'contextWindow' in snapshot ? (snapshot.contextWindow ?? null) : null;
  const window = contextWindow ?? snapshotWindow ?? totalTokens;
  const usagePct = window > 0 ? Math.round((totalTokens / window) * 100) : 0;
  const pct = (tokens: number) => Math.max((tokens / Math.max(window, 1)) * 100, 0.4);

  return (
    <div>
      {/* Header: total / window */}
      <div css={css`
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: 6px;
      `}>
        <span css={css`
          font-family: ${theme.typography.fontFamily.sans};
          font-size: 10px;
          font-weight: ${theme.typography.fontWeight.medium};
          color: ${theme.colors.text.hint};
          text-transform: uppercase;
          letter-spacing: 0.04em;
        `}>
          Context Budget
        </span>
        <span css={css`
          font-family: ${theme.typography.fontFamily.mono};
          font-size: 11px;
          color: ${theme.colors.text.secondary};
        `}>
          ~{totalTokens.toLocaleString()} / {window.toLocaleString()} ({usagePct}%)
        </span>
      </div>

      {/* Stacked bar */}
      <div css={css`
        display: flex;
        height: 6px;
        border-radius: 3px;
        overflow: hidden;
        background: ${theme.mode === 'light' ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)'};
      `}>
        {segments.map((seg) => (
          seg.tokens > 0 && (
            <div
              key={seg.label}
              title={`${seg.label}: ~${seg.tokens.toLocaleString()} tokens`}
              css={css`
                width: ${pct(seg.tokens)}%;
                background: ${seg.color};
                min-width: 2px;
              `}
            />
          )
        ))}
      </div>

      {/* Legend */}
      <div css={css`
        display: flex;
        flex-wrap: wrap;
        gap: 8px 12px;
        margin-top: 6px;
      `}>
        {segments.filter(s => s.tokens > 0).map((seg) => (
          <div key={seg.label} css={css`
            display: flex;
            align-items: center;
            gap: 4px;
          `}>
            <div css={css`
              width: 6px;
              height: 6px;
              border-radius: 1px;
              background: ${seg.color};
            `} />
            <span css={css`
              font-size: 10px;
              color: ${theme.colors.text.hint};
            `}>
              {seg.label}
            </span>
            <span css={css`
              font-family: ${theme.typography.fontFamily.mono};
              font-size: 10px;
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

function buildSegments(snapshot: PhaseContextSnapshot, accentColor: string): BudgetSegment[] {
  switch (snapshot.phase) {
    case 'thought':
      return [
        { label: 'System', tokens: snapshot.systemPrompt.reduce((s, x) => s + x.tokenCount, 0), color: SECTION_COLORS.systemPrompt },
        { label: 'Slots', tokens: snapshot.slots.reduce((s, x) => s + x.tokenCount, 0), color: SECTION_COLORS.slots },
        { label: 'History', tokens: snapshot.conversationHistory.totalTokens, color: SECTION_COLORS.history },
        { label: 'Ephemeral', tokens: snapshot.ephemeral.reduce((s, x) => s + x.tokenCount, 0), color: SECTION_COLORS.ephemeral },
        { label: 'Prompt', tokens: snapshot.prompt.tokenCount, color: accentColor },
      ];
    case 'agentic_loop':
      return [
        { label: 'Consumer', tokens: snapshot.consumerSystemPrompt.reduce((s, x) => s + x.tokenCount, 0), color: SECTION_COLORS.systemPrompt },
        { label: 'Cortex', tokens: snapshot.cortexSystemPrompt.reduce((s, x) => s + x.tokenCount, 0), color: SECTION_COLORS.cortexPrompt },
        { label: 'Slots', tokens: snapshot.slots.reduce((s, x) => s + x.tokenCount, 0), color: SECTION_COLORS.slots },
        { label: 'History', tokens: snapshot.conversationHistory.totalTokens, color: SECTION_COLORS.history },
        { label: 'Ephemeral', tokens: snapshot.ephemeral.reduce((s, x) => s + x.tokenCount, 0), color: SECTION_COLORS.ephemeral },
        { label: 'Trigger', tokens: snapshot.triggerMessage.tokenCount, color: accentColor },
      ];
    case 'reflect':
      return [
        { label: 'System', tokens: snapshot.systemPrompt.reduce((s, x) => s + x.tokenCount, 0), color: SECTION_COLORS.systemPrompt },
        { label: 'Slots', tokens: snapshot.slots.reduce((s, x) => s + x.tokenCount, 0), color: SECTION_COLORS.slots },
        { label: 'Tick Turns', tokens: snapshot.currentTickTurns.totalTokens, color: SECTION_COLORS.history },
        { label: 'Ephemeral', tokens: snapshot.ephemeral.reduce((s, x) => s + x.tokenCount, 0), color: SECTION_COLORS.ephemeral },
        { label: 'Prompt', tokens: snapshot.prompt.tokenCount, color: accentColor },
      ];
    case 'agentic_turn':
      return []; // Turn deltas don't have a budget bar
  }
}

// ============================================================================
// InspectContextLink
//
// A subtle navigation link to the full context detail page.
// ============================================================================

export function InspectContextLink({
  onClick,
  hasDetailedData,
}: {
  onClick: () => void;
  hasDetailedData: boolean;
}) {
  const theme = useTheme();

  return (
    <button
      onClick={onClick}
      css={css`
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-family: ${theme.typography.fontFamily.sans};
        font-size: 11px;
        color: ${theme.colors.text.hint};
        cursor: pointer;
        padding: 4px 0;
        transition: color ${theme.transitions.micro};
        margin-top: ${theme.spacing[2]};

        &:hover {
          color: ${theme.colors.text.secondary};
        }
      `}
    >
      <ArrowSquareOut size={12} />
      {hasDetailedData ? 'Inspect context' : 'Inspect context (enable debug mode for full content)'}
    </button>
  );
}

// ============================================================================
// ContextSectionList
//
// Renders a list of ContextSnapshotSection items with expandable content.
// Used in the full context detail page.
// ============================================================================

export function ContextSectionList({
  title,
  sections,
  color,
}: {
  title: string;
  sections: ContextSnapshotSection[];
  color: string;
}) {
  const theme = useTheme();
  const totalTokens = sections.reduce((s, x) => s + x.tokenCount, 0);

  if (sections.length === 0) return null;

  return (
    <div css={css`margin-bottom: ${theme.spacing[4]};`}>
      {/* Group header */}
      <div css={css`
        display: flex;
        align-items: center;
        gap: ${theme.spacing[2]};
        padding-bottom: ${theme.spacing[2]};
        border-bottom: 1px solid ${theme.colors.border.light};
        margin-bottom: ${theme.spacing[2]};
      `}>
        <div css={css`
          width: 3px;
          height: 14px;
          border-radius: 2px;
          background: ${color};
          flex-shrink: 0;
        `} />
        <span css={css`
          font-family: ${theme.typography.fontFamily.sans};
          font-size: ${theme.typography.fontSize.sm};
          font-weight: ${theme.typography.fontWeight.semibold};
          color: ${theme.colors.text.primary};
        `}>
          {title}
        </span>
        <span css={css`flex: 1;`} />
        <span css={css`
          font-family: ${theme.typography.fontFamily.mono};
          font-size: 11px;
          color: ${theme.colors.text.hint};
        `}>
          ~{totalTokens.toLocaleString()} tok
        </span>
      </div>

      {/* Section cards */}
      {sections.map((section, i) => (
        <SectionCard key={`${section.name}-${i}`} section={section} />
      ))}
    </div>
  );
}

// ============================================================================
// SectionCard - individual expandable section
// ============================================================================

function SectionCard({ section }: { section: ContextSnapshotSection }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const hasContent = section.content.length > 0;

  return (
    <div css={css`
      border: 1px solid ${theme.colors.border.light};
      border-radius: ${theme.borderRadius.sm};
      margin-bottom: ${theme.spacing[1]};
      overflow: hidden;
    `}>
      <button
        onClick={hasContent ? () => setExpanded(e => !e) : undefined}
        css={css`
          display: flex;
          align-items: center;
          gap: ${theme.spacing[2]};
          width: 100%;
          padding: ${theme.spacing[1.5]} ${theme.spacing[3]};
          cursor: ${hasContent ? 'pointer' : 'default'};
          text-align: left;
          opacity: ${hasContent ? 1 : 0.5};
          transition: background ${theme.transitions.micro};

          ${hasContent && `&:hover {
            background: ${theme.mode === 'light' ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.02)'};
          }`}
        `}
      >
        <span css={css`
          font-size: 13px;
          font-weight: ${theme.typography.fontWeight.medium};
          color: ${hasContent ? theme.colors.text.primary : theme.colors.text.hint};
        `}>
          {section.name}
        </span>
        {!hasContent && (
          <span css={css`font-size: 11px; color: ${theme.colors.text.hint}; font-style: italic;`}>
            (empty)
          </span>
        )}
        <span css={css`flex: 1;`} />
        <span css={css`
          font-family: ${theme.typography.fontFamily.mono};
          font-size: 11px;
          color: ${theme.colors.text.hint};
        `}>
          ~{section.tokenCount.toLocaleString()} tok
        </span>
        {hasContent && (
          <motion.span
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: 0.15 }}
            css={css`color: ${theme.colors.text.hint}; display: flex; align-items: center;`}
          >
            <CaretDown size={10} />
          </motion.span>
        )}
      </button>

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
                font-size: 12px;
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
