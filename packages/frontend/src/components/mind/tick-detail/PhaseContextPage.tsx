/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useMemo } from 'react';
import { ArrowLeft } from '@phosphor-icons/react';
import { trpc } from '../../../utils/trpc';
import { Typography } from '../../ui';
import {
  PhaseContextBudgetBar,
  ContextSectionList,
} from './context-components';
import { Badge, formatCost } from './shared';
import type {
  PhaseContextSnapshot,
  ThoughtContextSnapshot,
  AgenticContextSnapshot,
  AgenticTurnDelta,
  ReflectContextSnapshot,
  ContextSnapshotSection,
  MessageSnapshot,
} from '@animus-labs/shared';

// ============================================================================
// Section colors (matching context-components)
// ============================================================================

const SECTION_COLORS = {
  systemPrompt: '#8B7EC8',
  cortexPrompt: '#888',
  slots: '#2D8A6E',
  history: '#5B8DEF',
  ephemeral: '#C4943A',
};

const PHASE_LABELS: Record<string, string> = {
  thought: 'Thought',
  agentic_loop: 'Agentic Loop',
  reflect: 'Reflect',
};

// ============================================================================
// PhaseContextPage
// ============================================================================

interface PhaseContextPageProps {
  tickNumber: number;
  phase: string;
  onBack: () => void;
}

export function PhaseContextPage({ tickNumber, phase, onBack }: PhaseContextPageProps) {
  const theme = useTheme();

  const { data: rawTimeline, isLoading } = trpc.heartbeat.getTickTimeline.useQuery(
    { tickNumber },
    { retry: false },
  );

  const snapshot = useMemo<PhaseContextSnapshot | null>(() => {
    if (!rawTimeline) return null;
    const snapshots = (rawTimeline as Record<string, unknown>)['phaseSnapshots'] as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(snapshots)) return null;
    return (snapshots.find((s) => s['phase'] === phase) as PhaseContextSnapshot | undefined) ?? null;
  }, [rawTimeline, phase]);

  const turnDeltas = useMemo<AgenticTurnDelta[]>(() => {
    if (!rawTimeline || phase !== 'agentic_loop') return [];
    const snapshots = (rawTimeline as Record<string, unknown>)['phaseSnapshots'] as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(snapshots)) return [];
    return snapshots
      .filter((s) => s['phase'] === 'agentic_turn')
      .sort((a, b) => ((a['turnNumber'] as number) ?? 0) - ((b['turnNumber'] as number) ?? 0)) as unknown as AgenticTurnDelta[];
  }, [rawTimeline, phase]);

  if (isLoading) {
    return (
      <div css={css`padding: ${theme.spacing[6]} 0; text-align: center;`}>
        <Typography.Body serif italic color="hint">Loading context...</Typography.Body>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div>
        <BackNav onBack={onBack} tickNumber={tickNumber} phase={phase} />
        <div css={css`
          padding: ${theme.spacing[8]} 0;
          text-align: center;
        `}>
          <Typography.Body color="hint">
            No context snapshot available for this phase.
          </Typography.Body>
          <Typography.Caption as="p" color="disabled" css={css`margin-top: ${theme.spacing[2]};`}>
            Enable "Context debug mode" in Settings to capture detailed context data.
          </Typography.Caption>
        </div>
      </div>
    );
  }

  return (
    <div>
      <BackNav onBack={onBack} tickNumber={tickNumber} phase={phase} />

      {/* Page title */}
      <div css={css`
        display: flex;
        align-items: center;
        gap: ${theme.spacing[2]};
        margin-bottom: ${theme.spacing[5]};
      `}>
        <Typography.Subtitle css={css`
          font-weight: ${theme.typography.fontWeight.semibold};
          color: ${theme.colors.text.primary};
        `}>
          {PHASE_LABELS[phase] ?? phase} Context
        </Typography.Subtitle>
        <Badge label={`Tick #${tickNumber}`} color={theme.colors.text.hint} />
      </div>

      {/* Budget bar */}
      <div css={css`
        padding: ${theme.spacing[3]} ${theme.spacing[4]};
        border: 1px solid ${theme.colors.border.light};
        border-radius: ${theme.borderRadius.md};
        margin-bottom: ${theme.spacing[5]};
      `}>
        <PhaseContextBudgetBar snapshot={snapshot} />
      </div>

      {/* Phase-specific sections */}
      {snapshot.phase === 'thought' && <ThoughtContextDetail snapshot={snapshot} />}
      {snapshot.phase === 'agentic_loop' && <AgenticContextDetail snapshot={snapshot} turnDeltas={turnDeltas} />}
      {snapshot.phase === 'reflect' && <ReflectContextDetail snapshot={snapshot} />}
    </div>
  );
}

// ============================================================================
// Back navigation
// ============================================================================

function BackNav({ onBack, tickNumber, phase }: { onBack: () => void; tickNumber: number; phase: string }) {
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
      Back to tick #{tickNumber}
    </button>
  );
}

// ============================================================================
// Thought context detail
// ============================================================================

function ThoughtContextDetail({ snapshot }: { snapshot: ThoughtContextSnapshot }) {
  const theme = useTheme();

  return (
    <div>
      <ContextSectionList
        title="System Prompt"
        sections={snapshot.systemPrompt}
        color={SECTION_COLORS.systemPrompt}
      />

      <ContextSectionList
        title="Context Slots"
        sections={snapshot.slots}
        color={SECTION_COLORS.slots}
      />

      {/* History summary */}
      <div css={css`margin-bottom: ${theme.spacing[4]};`}>
        <SectionHeader
          title="Conversation History"
          color={SECTION_COLORS.history}
          tokens={snapshot.conversationHistory.totalTokens}
        />
        <div css={css`
          display: flex;
          gap: ${theme.spacing[4]};
          padding: ${theme.spacing[2]} ${theme.spacing[3]};
        `}>
          <StatPair label="Messages" value={String(snapshot.conversationHistory.messageCount)} />
          <StatPair label="Compacted" value={snapshot.conversationHistory.hasSummary ? 'Yes' : 'No'} />
        </div>
      </div>

      <ContextSectionList
        title="Ephemeral Context"
        sections={snapshot.ephemeral}
        color={SECTION_COLORS.ephemeral}
      />

      <ContextSectionList
        title="Thought Prompt"
        sections={[snapshot.prompt]}
        color={theme.colors.accent}
      />

      {/* Full messages (debug mode) */}
      {snapshot.messages && snapshot.messages.length > 0 && (
        <MessageList title="Full Message Array" messages={snapshot.messages} />
      )}
    </div>
  );
}

// ============================================================================
// Agentic context detail
// ============================================================================

function AgenticContextDetail({ snapshot, turnDeltas }: { snapshot: AgenticContextSnapshot; turnDeltas: AgenticTurnDelta[] }) {
  const theme = useTheme();

  return (
    <div>
      <ContextSectionList
        title="Consumer System Prompt"
        sections={snapshot.consumerSystemPrompt}
        color={SECTION_COLORS.systemPrompt}
      />

      <ContextSectionList
        title="Cortex System Prompt"
        sections={snapshot.cortexSystemPrompt}
        color={SECTION_COLORS.cortexPrompt}
      />

      <ContextSectionList
        title="Context Slots"
        sections={snapshot.slots}
        color={SECTION_COLORS.slots}
      />

      {/* History metadata */}
      <div css={css`margin-bottom: ${theme.spacing[4]};`}>
        <SectionHeader
          title="Conversation History"
          color={SECTION_COLORS.history}
          tokens={snapshot.conversationHistory.totalTokens}
        />
        <div css={css`
          display: flex;
          gap: ${theme.spacing[4]};
          padding: ${theme.spacing[2]} ${theme.spacing[3]};
        `}>
          <StatPair label="Messages" value={String(snapshot.conversationHistory.messageCount)} />
          <StatPair label="Compacted" value={snapshot.conversationHistory.hasSummary ? 'Yes' : 'No'} />
          {snapshot.conversationHistory.summaryTokens != null && (
            <StatPair label="Summary" value={`~${snapshot.conversationHistory.summaryTokens.toLocaleString()} tok`} />
          )}
        </div>
      </div>

      <ContextSectionList
        title="Ephemeral Context"
        sections={snapshot.ephemeral}
        color={SECTION_COLORS.ephemeral}
      />

      {/* Trigger */}
      <ContextSectionList
        title="Trigger Message"
        sections={[{
          name: 'Trigger',
          content: snapshot.triggerMessage.content,
          tokenCount: snapshot.triggerMessage.tokenCount,
        }]}
        color={theme.colors.accent}
      />

      {/* Per-turn history growth (debug mode) */}
      {turnDeltas.length > 0 && (
        <div css={css`margin-bottom: ${theme.spacing[4]};`}>
          <SectionHeader title="Per-Turn History Growth" color={SECTION_COLORS.history} tokens={0} />
          <div css={css`
            display: flex;
            flex-direction: column;
            gap: ${theme.spacing[1]};
          `}>
            {turnDeltas.map((delta) => (
              <div key={delta.turnNumber} css={css`
                display: flex;
                align-items: center;
                gap: ${theme.spacing[3]};
                padding: ${theme.spacing[1.5]} ${theme.spacing[3]};
                border: 1px solid ${theme.colors.border.light};
                border-radius: ${theme.borderRadius.sm};
              `}>
                <span css={css`
                  font-family: ${theme.typography.fontFamily.mono};
                  font-size: 12px;
                  font-weight: ${theme.typography.fontWeight.medium};
                  color: ${theme.colors.text.secondary};
                  min-width: 50px;
                `}>
                  Turn {delta.turnNumber}
                </span>
                <StatPair label="History" value={`${delta.totalHistoryMessages} msgs`} />
                <StatPair label="History Tokens" value={`~${delta.totalHistoryTokens.toLocaleString()}`} />
                <StatPair label="New" value={`+${delta.newMessageCount} msgs`} />
                <StatPair
                  label="API Input"
                  value={`${(delta.turnUsage.inputTokens + delta.turnUsage.cacheReadTokens + delta.turnUsage.cacheWriteTokens).toLocaleString()}`}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Full messages (debug mode) */}
      {snapshot.messages && snapshot.messages.length > 0 && (
        <MessageList title="Full Conversation History" messages={snapshot.messages} />
      )}
    </div>
  );
}

// ============================================================================
// Reflect context detail
// ============================================================================

function ReflectContextDetail({ snapshot }: { snapshot: ReflectContextSnapshot }) {
  const theme = useTheme();

  return (
    <div>
      <ContextSectionList
        title="System Prompt"
        sections={snapshot.systemPrompt}
        color={SECTION_COLORS.systemPrompt}
      />

      <ContextSectionList
        title="Context Slots"
        sections={snapshot.slots}
        color={SECTION_COLORS.slots}
      />

      {/* Current tick turns */}
      <div css={css`margin-bottom: ${theme.spacing[4]};`}>
        <SectionHeader
          title="Current Tick Turns"
          color={SECTION_COLORS.history}
          tokens={snapshot.currentTickTurns.totalTokens}
        />
        <div css={css`
          display: flex;
          gap: ${theme.spacing[4]};
          padding: ${theme.spacing[2]} ${theme.spacing[3]};
        `}>
          <StatPair label="Messages" value={String(snapshot.currentTickTurns.messageCount)} />
        </div>
      </div>

      <ContextSectionList
        title="Ephemeral Context"
        sections={snapshot.ephemeral}
        color={SECTION_COLORS.ephemeral}
      />

      <ContextSectionList
        title="Reflect Prompt"
        sections={[snapshot.prompt]}
        color={theme.colors.accent}
      />

      {/* Full messages (debug mode) */}
      {snapshot.messages && snapshot.messages.length > 0 && (
        <MessageList title="Full Message Array" messages={snapshot.messages} />
      )}
    </div>
  );
}

// ============================================================================
// Shared helpers
// ============================================================================

function SectionHeader({ title, color, tokens }: { title: string; color: string; tokens: number }) {
  const theme = useTheme();
  return (
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
        ~{tokens.toLocaleString()} tok
      </span>
    </div>
  );
}

function StatPair({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <div css={css`display: flex; flex-direction: column; gap: 1px;`}>
      <span css={css`
        font-size: 10px;
        font-weight: ${theme.typography.fontWeight.medium};
        color: ${theme.colors.text.hint};
        text-transform: uppercase;
        letter-spacing: 0.04em;
      `}>
        {label}
      </span>
      <span css={css`
        font-family: ${theme.typography.fontFamily.mono};
        font-size: 12px;
        color: ${theme.colors.text.secondary};
      `}>
        {value}
      </span>
    </div>
  );
}

function MessageList({ title, messages }: { title: string; messages: MessageSnapshot[] }) {
  const theme = useTheme();
  return (
    <div css={css`margin-bottom: ${theme.spacing[4]};`}>
      <SectionHeader title={title} color={theme.colors.text.hint} tokens={messages.reduce((s, m) => s + m.tokenCount, 0)} />
      <div css={css`
        display: flex;
        flex-direction: column;
        gap: ${theme.spacing[1]};
      `}>
        {messages.map((msg, i) => (
          <div key={i} css={css`
            border: 1px solid ${theme.colors.border.light};
            border-radius: ${theme.borderRadius.sm};
            overflow: hidden;
          `}>
            <div css={css`
              display: flex;
              align-items: center;
              gap: ${theme.spacing[2]};
              padding: ${theme.spacing[1.5]} ${theme.spacing[3]};
              background: ${theme.mode === 'light' ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.02)'};
              border-bottom: 1px solid ${theme.colors.border.light};
            `}>
              <Badge
                label={msg.role}
                color={msg.role === 'assistant' ? '#8B7EC8'
                  : msg.role === 'system' ? '#888'
                  : theme.colors.accent}
              />
              <span css={css`flex: 1;`} />
              <span css={css`
                font-family: ${theme.typography.fontFamily.mono};
                font-size: 11px;
                color: ${theme.colors.text.hint};
              `}>
                ~{msg.tokenCount.toLocaleString()} tok
              </span>
            </div>
            <pre css={css`
              font-family: ${theme.typography.fontFamily.mono};
              font-size: 12px;
              line-height: 1.5;
              white-space: pre-wrap;
              word-break: break-word;
              color: ${theme.colors.text.primary};
              padding: ${theme.spacing[3]};
              margin: 0;
              max-height: 300px;
              overflow-y: auto;
            `}>
              {msg.content}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}
