/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft,
  CaretDown,
  Play,
  Stop,
  ArrowFatLineDown,
  Brain,
  Wrench,
  WarningCircle,
  ChatText,
  XCircle,
  CheckCircle,
  Star,
  Lightning,
  PaperPlaneRight,
  Database,
  Gear,
} from '@phosphor-icons/react';
import { trpc } from '../../utils/trpc';
import { useHeartbeatStore } from '../../store/heartbeat-store';
import type { Theme } from '../../styles/theme';

// ============================================================================
// Types
// ============================================================================

interface TimelineEvent {
  id: string;
  sessionId?: string;
  eventType: string;
  data: Record<string, unknown>;
  createdAt: string;
  relativeMs: number;
}

interface TickTimeline {
  tickNumber: number;
  sessionId: string;
  triggerType: string;
  sessionState: string;
  isComplete: boolean;
  durationMs: number | null;
  createdAt: string;
  events: TimelineEvent[];
  results: TickResults | null;
  usage: TickUsage | null;
}

interface TickResults {
  thoughts: Array<{ content: string; importance: number }>;
  experiences: Array<{ content: string; importance: number }>;
  reply?: { content: string; channel: string; contactId?: string } | null;
  emotionDeltas: Array<{
    emotion: string;
    delta: number;
    reasoning: string;
    intensityBefore: number;
    intensityAfter: number;
  }>;
  decisions: Array<{
    type: string;
    description: string;
    parameters: Record<string, unknown> | null;
    outcome: string;
    outcomeDetail?: string | null;
  }>;
}

interface TickUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number | null;
}

interface AgentTimelineProps {
  tickNumber: number;
  onBack: () => void;
}

// ============================================================================
// Event category mapping
// ============================================================================

type EventCategory = 'session' | 'input' | 'thinking' | 'tool' | 'response' | 'error' | 'complete' | 'execute';

function getEventCategory(eventType: string): EventCategory {
  switch (eventType) {
    case 'session_start':
    case 'session_end':
      return 'session';
    case 'input_received':
    case 'tick_input':
    case 'message_injected':
      return 'input';
    case 'thinking_start':
    case 'thinking_end':
      return 'thinking';
    case 'tool_call_start':
    case 'tool_call_end':
    case 'tool_error':
      return 'tool';
    case 'response_start':
    case 'response_end':
      return 'response';
    case 'error':
      return 'error';
    case 'tick_output':
      return 'complete';
    case 'execute_start':
    case 'execute_reply_sent':
    case 'execute_transaction_complete':
    case 'execute_decisions_complete':
    case 'execute_memory_complete':
    case 'execute_complete':
      return 'execute';
    default:
      return 'session';
  }
}

function getCategoryColor(category: EventCategory, theme: ReturnType<typeof useTheme>): string {
  const isLight = theme.mode === 'light';
  switch (category) {
    case 'session':
      return isLight ? 'rgba(26, 24, 22, 0.40)' : 'rgba(250, 249, 244, 0.40)';
    case 'input':
      return theme.colors.accent;
    case 'thinking':
      return isLight ? '#8B7EC8' : '#A194D9';
    case 'tool':
      return isLight ? '#C4943A' : '#D4A94E';
    case 'response':
      return isLight ? '#4A9B6E' : '#5DB87E';
    case 'error':
      return isLight ? '#C75050' : '#D96060';
    case 'complete':
      return theme.colors.accent;
    case 'execute':
      return isLight ? '#2D8A6E' : '#4ECBA0';
  }
}

// ============================================================================
// Event icon mapping
// ============================================================================

function getEventIcon(eventType: string) {
  switch (eventType) {
    case 'session_start': return Play;
    case 'session_end':   return Stop;
    case 'input_received':
    case 'tick_input':    return ArrowFatLineDown;
    case 'message_injected': return ChatText;
    case 'thinking_start':
    case 'thinking_end':  return Brain;
    case 'tool_call_start':
    case 'tool_call_end': return Wrench;
    case 'tool_error':    return WarningCircle;
    case 'response_start':
    case 'response_end':  return ChatText;
    case 'error':         return XCircle;
    case 'tick_output':   return CheckCircle;
    case 'execute_start':       return Lightning;
    case 'execute_reply_sent':  return PaperPlaneRight;
    case 'execute_transaction_complete': return Database;
    case 'execute_decisions_complete':   return Gear;
    case 'execute_memory_complete':      return Brain;
    case 'execute_complete':             return CheckCircle;
    default:              return Play;
  }
}

// ============================================================================
// Event label mapping
// ============================================================================

function getEventLabel(eventType: string): string {
  switch (eventType) {
    case 'session_start':  return 'Session Started';
    case 'session_end':    return 'Session Ended';
    case 'input_received': return 'Input Received';
    case 'tick_input':     return 'Tick Input';
    case 'message_injected': return 'Message Injected';
    case 'thinking_start': return 'Thinking...';
    case 'thinking_end':   return 'Thinking Complete';
    case 'tool_call_start':return 'Tool Call';
    case 'tool_call_end':  return 'Tool Complete';
    case 'tool_error':     return 'Tool Error';
    case 'response_start': return 'Response Started';
    case 'response_end':   return 'Response Complete';
    case 'error':          return 'Error';
    case 'tick_output':    return 'Tick Complete';
    case 'execute_start':       return 'Execute Started';
    case 'execute_reply_sent':  return 'Reply Sent';
    case 'execute_transaction_complete': return 'DB Transaction';
    case 'execute_decisions_complete':   return 'Decisions Complete';
    case 'execute_memory_complete':      return 'Memory Complete';
    case 'execute_complete':             return 'Execute Complete';
    default:               return eventType;
  }
}

// ============================================================================
// Preview content
// ============================================================================

function str(val: unknown): string {
  return typeof val === 'string' ? val : '';
}

function getPreviewContent(event: TimelineEvent): string {
  const d = event.data;
  switch (event.eventType) {
    case 'session_start':
      return [d['provider'], d['model']].filter(Boolean).join(' / ');
    case 'session_end': {
      const reason = str(d['reason']) || 'completed';
      const durMs = d['durationMs'];
      const dur = durMs != null ? ` - ${formatDuration(durMs as number)} total` : '';
      return `${reason}${dur}`;
    }
    case 'input_received':
      return truncate(str(d['content']) || str(d['text']), 80);
    case 'message_injected': {
      const name = str(d['contactName']);
      const ch = str(d['channel']);
      const preview = truncate(str(d['content']), 60);
      return `${name}${ch ? ` via ${ch}` : ''}: ${preview}`;
    }
    case 'tick_input': {
      const trigger = str(d['triggerType']);
      const session = str(d['sessionState']);
      return `${trigger} trigger${session ? ` - ${session} session` : ''}`;
    }
    case 'thinking_start':
      return '';
    case 'thinking_end':
      return truncate(str(d['content']), 80);
    case 'tool_call_start': {
      const toolName = str(d['toolName']);
      const input = d['input'] as Record<string, unknown> | undefined;
      if (input) {
        const firstKey = Object.keys(input)[0];
        if (firstKey) {
          const val = typeof input[firstKey] === 'string'
            ? `'${truncate(input[firstKey] as string, 30)}'`
            : JSON.stringify(input[firstKey]);
          return `${toolName} - ${firstKey}: ${val}`;
        }
      }
      return toolName;
    }
    case 'tool_call_end':
      return `${str(d['toolName'])} - success`;
    case 'tool_error':
      return `${str(d['toolName'])} - ${truncate(str(d['error']), 60)}`;
    case 'response_start':
      return '';
    case 'response_end': {
      const content = truncate(str(d['content']), 80);
      const reason = d['finishReason'] ? ` [${d['finishReason']}]` : '';
      return `${content}${reason}`;
    }
    case 'error':
      return `${str(d['code'])} - ${truncate(str(d['message']), 60)}`;
    case 'tick_output':
      return event.relativeMs > 0 ? `completed in ${formatDuration(event.relativeMs)}` : 'completed';
    case 'execute_start':
      return `tick #${d['tickNumber'] ?? '?'}`;
    case 'execute_reply_sent': {
      const path = str(d['path']);
      const hasReply = d['hasReply'];
      if (!hasReply) return 'no reply needed';
      return path === 'early' ? 'sent via streaming (early)'
           : path === 'follow-up' ? 'follow-up sent (content differed)'
           : path === 'fallback' ? 'sent via fallback path'
           : 'no send needed';
    }
    case 'execute_transaction_complete':
      return d['durationMs'] != null ? `completed in ${formatDuration(d['durationMs'] as number)}` : 'completed';
    case 'execute_decisions_complete': {
      const agentD = d['agentDecisions'] as number ?? 0;
      const pluginD = d['pluginDecisions'] as number ?? 0;
      const parts: string[] = [];
      if (agentD > 0) parts.push(`${agentD} agent`);
      if (pluginD > 0) parts.push(`${pluginD} plugin`);
      return parts.length > 0 ? parts.join(', ') : 'no decisions executed';
    }
    case 'execute_memory_complete': {
      const count = d['candidateCount'] as number ?? 0;
      const parts: string[] = [];
      if (count > 0) parts.push(`${count} candidate${count > 1 ? 's' : ''}`);
      if (d['hadWorkingMemoryUpdate']) parts.push('working memory');
      if (d['hadCoreSelfUpdate']) parts.push('core self');
      if (d['hadSeedResonance']) parts.push('seed resonance');
      return parts.length > 0 ? parts.join(', ') : 'no memory operations';
    }
    case 'execute_complete': {
      const totalMs = d['totalDurationMs'] as number;
      return totalMs != null ? `completed in ${formatDuration(totalMs)}` : 'completed';
    }
    default:
      return '';
  }
}

// ============================================================================
// Duration badge logic
// ============================================================================

/**
 * Normalize the raw backend response into our local TickTimeline shape.
 * The backend may use snake_case or different field names (e.g. emotionHistory
 * instead of emotionDeltas). This adapter handles all variations.
 */
function normalizeTimeline(raw: any): TickTimeline | null {
  if (!raw) return null;

  const events: TimelineEvent[] = (raw.events ?? []).map((e: any) => ({
    id: String(e.id),
    sessionId: e.sessionId,
    eventType: String(e.eventType),
    data: (e.data ?? {}) as Record<string, unknown>,
    createdAt: String(e.createdAt),
    relativeMs: Number(e.relativeMs ?? 0),
  }));

  let results: TickResults | null = null;
  if (raw.results) {
    const r = raw.results;
    const thoughts = (r.thoughts ?? []).map((t: any) => ({
      content: String(t.content ?? ''),
      importance: Number(t.importance ?? 0),
    }));
    const experiences = (r.experiences ?? []).map((e: any) => ({
      content: String(e.content ?? ''),
      importance: Number(e.importance ?? 0),
    }));
    // Backend uses emotionHistory, we call it emotionDeltas
    const emotionDeltas = (r.emotionHistory ?? r.emotionDeltas ?? []).map((eh: any) => ({
      emotion: String(eh.emotion ?? ''),
      delta: Number(eh.delta ?? 0),
      reasoning: String(eh.reasoning ?? ''),
      intensityBefore: Number(eh.intensityBefore ?? eh.intensity_before ?? 0),
      intensityAfter: Number(eh.intensityAfter ?? eh.intensity_after ?? 0),
    }));
    const decisions = (r.decisions ?? []).map((d: any) => ({
      type: String(d.type ?? ''),
      description: String(d.description ?? ''),
      parameters: d.parameters ?? null,
      outcome: String(d.outcome ?? 'executed'),
      outcomeDetail: d.outcomeDetail ?? d.outcome_detail ?? null,
    }));
    const base: TickResults = { thoughts, experiences, emotionDeltas, decisions };
    if (r.reply) {
      const replyObj: { content: string; channel: string; contactId?: string } = {
        content: String(r.reply.content ?? ''),
        channel: String(r.reply.channel ?? ''),
      };
      if (r.reply.contactId) replyObj.contactId = String(r.reply.contactId);
      base.reply = replyObj;
    }
    results = base;
  }

  let usage: TickUsage | null = null;
  if (raw.usage) {
    const u = raw.usage;
    usage = {
      inputTokens: Number(u.inputTokens ?? u.input_tokens ?? 0),
      outputTokens: Number(u.outputTokens ?? u.output_tokens ?? 0),
      totalTokens: Number(u.totalTokens ?? u.total_tokens ?? 0),
      costUsd: u.costUsd ?? u.cost_usd ?? null,
    };
  }

  return {
    tickNumber: Number(raw.tickNumber),
    sessionId: String(raw.sessionId ?? ''),
    triggerType: String(raw.triggerType ?? 'unknown'),
    sessionState: String(raw.sessionState ?? 'unknown'),
    isComplete: Boolean(raw.isComplete),
    durationMs: raw.durationMs ?? null,
    createdAt: String(raw.createdAt ?? ''),
    events,
    results,
    usage,
  };
}

function getDurationBadgeColor(ms: number, theme: Theme) {
  if (ms < 200) return theme.colors.success.main;
  if (ms <= 1000) return theme.colors.warning.main;
  return theme.colors.error.main;
}

function shouldShowDuration(eventType: string): boolean {
  return [
    'thinking_end', 'tool_call_end', 'session_end', 'tick_output',
    'execute_reply_sent', 'execute_transaction_complete', 'execute_decisions_complete',
    'execute_memory_complete', 'execute_complete',
  ].includes(eventType);
}

function computeEventDuration(event: TimelineEvent, allEvents: TimelineEvent[]): number | null {
  const pairMap: Record<string, string> = {
    thinking_end: 'thinking_start',
    tool_call_end: 'tool_call_start',
    session_end: 'session_start',
    response_end: 'response_start',
  };

  if (event.eventType === 'tick_output') {
    const first = allEvents[0];
    if (first) return event.relativeMs - first.relativeMs;
    return null;
  }

  // Execute events: duration relative to execute_start
  if (event.eventType.startsWith('execute_') && event.eventType !== 'execute_start') {
    const execStart = allEvents.find(e => e.eventType === 'execute_start');
    if (execStart) return event.relativeMs - execStart.relativeMs;
    return null;
  }

  const startType = pairMap[event.eventType];
  if (!startType) return null;

  // For tool events, match by toolName and find the most recent unpaired start
  if (event.eventType === 'tool_call_end') {
    const toolName = event.data['toolName'];
    for (let i = allEvents.indexOf(event) - 1; i >= 0; i--) {
      const candidate = allEvents[i]!;
      if (candidate.eventType === 'tool_call_start' && candidate.data['toolName'] === toolName) {
        return event.relativeMs - candidate.relativeMs;
      }
    }
    return null;
  }

  // For other paired events, find the most recent start of that type
  for (let i = allEvents.indexOf(event) - 1; i >= 0; i--) {
    const candidate = allEvents[i]!;
    if (candidate.eventType === startType) {
      return event.relativeMs - candidate.relativeMs;
    }
  }
  return null;
}

// ============================================================================
// Whether event has expandable detail
// ============================================================================

function hasExpandableDetail(eventType: string): boolean {
  return !['thinking_start', 'response_start'].includes(eventType);
}

// ============================================================================
// Helpers
// ============================================================================

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '...';
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatRelativeMs(ms: number): string {
  if (ms === 0) return '0s';
  if (ms < 1000) return `+${(ms / 1000).toFixed(1)}s`;
  if (ms < 10000) return `+${(ms / 1000).toFixed(1)}s`;
  return `+${(ms / 1000).toFixed(1)}s`;
}

function triggerColor(triggerType: string, theme: Theme): string {
  switch (triggerType) {
    case 'message':        return theme.colors.accent;
    case 'interval':       return theme.colors.text.hint;
    case 'scheduled_task': return theme.colors.warning.main;
    case 'agent_complete': return theme.colors.success.main;
    default:               return theme.colors.text.secondary;
  }
}

// ============================================================================
// Badge (local copy matching HeartbeatsSection pattern)
// ============================================================================

function Badge({ label, color }: { label: string; color: string }) {
  const theme = useTheme();
  return (
    <span css={css`
      display: inline-block;
      font-size: ${theme.typography.fontSize.xs};
      font-weight: ${theme.typography.fontWeight.medium};
      color: ${color};
      border: 1px solid ${color}33;
      background: ${color}11;
      padding: 1px ${theme.spacing[1.5]};
      border-radius: ${theme.borderRadius.sm};
      white-space: nowrap;
    `}>
      {label}
    </span>
  );
}

// ============================================================================
// Section label
// ============================================================================

function SectionLabel({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <span css={css`
      display: block;
      font-family: ${theme.typography.fontFamily.sans};
      font-size: 11px;
      font-weight: ${theme.typography.fontWeight.medium};
      color: ${theme.colors.text.hint};
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: ${theme.spacing[2]};
    `}>
      {children}
    </span>
  );
}

// ============================================================================
// Detail field row
// ============================================================================

function DetailField({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  const theme = useTheme();
  return (
    <div css={css`margin-bottom: ${theme.spacing[2]};`}>
      <span css={css`
        display: block;
        font-family: ${theme.typography.fontFamily.sans};
        font-size: 11px;
        font-weight: ${theme.typography.fontWeight.medium};
        color: ${theme.colors.text.hint};
        text-transform: uppercase;
        letter-spacing: 0.04em;
        margin-bottom: ${theme.spacing[0.5]};
      `}>
        {label}
      </span>
      <span css={css`
        font-family: ${mono ? theme.typography.fontFamily.mono : theme.typography.fontFamily.sans};
        font-size: ${mono ? '12px' : '13px'};
        color: ${theme.colors.text.primary};
        word-break: break-word;
      `}>
        {children}
      </span>
    </div>
  );
}

// ============================================================================
// Code block (for JSON / pre-formatted text)
// ============================================================================

function CodeBlock({ content, maxHeight = 300 }: { content: string; maxHeight?: number }) {
  const theme = useTheme();
  return (
    <pre css={css`
      font-family: ${theme.typography.fontFamily.mono};
      font-size: 12px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
      color: ${theme.colors.text.primary};
      background: ${theme.mode === 'light'
        ? 'rgba(0, 0, 0, 0.03)'
        : 'rgba(255, 255, 255, 0.04)'};
      padding: ${theme.spacing[3]};
      border-radius: ${theme.borderRadius.default};
      border: 1px solid ${theme.colors.border.light};
      max-height: ${maxHeight}px;
      overflow-y: auto;
      margin: 0;
    `}>
      {content}
    </pre>
  );
}

// ============================================================================
// Collapsible detail section (within event detail)
// ============================================================================

function DetailCollapsible({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <div css={css`margin-top: ${theme.spacing[2]};`}>
      <button
        onClick={() => setOpen((o) => !o)}
        css={css`
          display: flex;
          align-items: center;
          gap: ${theme.spacing[1]};
          font-family: ${theme.typography.fontFamily.sans};
          font-size: 11px;
          font-weight: ${theme.typography.fontWeight.medium};
          color: ${theme.colors.text.hint};
          text-transform: uppercase;
          letter-spacing: 0.04em;
          cursor: pointer;
          padding: ${theme.spacing[0.5]} 0;
          transition: color ${theme.transitions.micro};
          &:hover { color: ${theme.colors.text.secondary}; }
        `}
      >
        {open ? <CaretDown size={10} /> : <CaretDown size={10} css={css`transform: rotate(-90deg);`} />}
        {title}
      </button>
      {open && (
        <div css={css`margin-top: ${theme.spacing[1.5]};`}>
          {children}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Event Detail Content
// ============================================================================

function EventDetail({ event, allEvents }: { event: TimelineEvent; allEvents: TimelineEvent[] }) {
  const theme = useTheme();
  const d = event.data;

  switch (event.eventType) {
    case 'session_start':
      return (
        <div>
          <DetailField label="PROVIDER">{str(d['provider']) || 'unknown'}</DetailField>
          <DetailField label="MODEL">{str(d['model']) || 'unknown'}</DetailField>
          <DetailField label="SESSION" mono>{str(d['sessionId'])}</DetailField>
        </div>
      );

    case 'session_end': {
      const duration = computeEventDuration(event, allEvents);
      const status = str(d['status']);
      return (
        <div>
          <DetailField label="REASON">{str(d['reason']) || 'completed'}</DetailField>
          {duration != null && <DetailField label="DURATION">{formatDuration(duration)}</DetailField>}
          <DetailField label="STATUS">
            <span css={css`
              color: ${status === 'completed' ? theme.colors.success.main : theme.colors.error.main};
            `}>
              {status || 'unknown'}
            </span>
          </DetailField>
        </div>
      );
    }

    case 'input_received':
      return <CodeBlock content={str(d['content']) || str(d['text'])} />;

    case 'message_injected':
      return (
        <div>
          <DetailField label="FROM">{str(d['contactName'])} via {str(d['channel'])}</DetailField>
          <DetailField label="MESSAGE">{str(d['content'])}</DetailField>
        </div>
      );

    case 'tick_input': {
      const trigger = str(d['triggerType']);
      const session = str(d['sessionState']);
      return (
        <div>
          <DetailField label="TICK" mono>{String(d['tickNumber'] ?? '')}</DetailField>
          <DetailField label="TRIGGER">
            <Badge label={trigger || ''} color={triggerColor(trigger, theme)} />
          </DetailField>
          <DetailField label="SESSION">
            <Badge
              label={session || ''}
              color={session === 'cold' ? '#5B8DEF' : '#E8A838'}
            />
          </DetailField>
          {d['tokenBreakdown'] != null ? (
            <DetailField label="TOKENS">
              <div css={css`display: flex; flex-wrap: wrap; gap: ${theme.spacing[3]};`}>
                {Object.entries(d['tokenBreakdown'] as Record<string, number>).map(([key, val]) => (
                  <div key={key}>
                    <span css={css`
                      font-size: 11px;
                      color: ${theme.colors.text.hint};
                      text-transform: uppercase;
                      display: block;
                    `}>{key}</span>
                    <span css={css`
                      font-family: ${theme.typography.fontFamily.mono};
                      font-size: 12px;
                      color: ${theme.colors.text.primary};
                    `}>{val.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </DetailField>
          ) : null}
          {d['systemPrompt'] != null ? (
            <DetailCollapsible title="System Prompt">
              <CodeBlock content={str(d['systemPrompt'])} maxHeight={300} />
            </DetailCollapsible>
          ) : null}
          {d['userMessage'] != null ? (
            <DetailCollapsible title="User Message">
              <CodeBlock content={str(d['userMessage'])} maxHeight={300} />
            </DetailCollapsible>
          ) : null}
        </div>
      );
    }

    case 'thinking_end': {
      const duration = computeEventDuration(event, allEvents);
      return (
        <div>
          {duration != null && <DetailField label="DURATION">{formatDuration(duration)}</DetailField>}
          <div css={css`
            font-family: ${theme.typography.fontFamily.serif};
            font-size: 15px;
            line-height: 1.6;
            color: ${theme.colors.text.primary};
            margin-top: ${theme.spacing[2]};
          `}>
            {str(d['content'])}
          </div>
        </div>
      );
    }

    case 'tool_call_start':
      return (
        <div>
          <DetailField label="TOOL">
            <span css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
              {str(d['toolName'])}
            </span>
          </DetailField>
          {d['input'] != null ? (
            <DetailField label="INPUT">
              <CodeBlock content={JSON.stringify(d['input'], null, 2)} maxHeight={300} />
            </DetailField>
          ) : null}
        </div>
      );

    case 'tool_call_end': {
      const duration = computeEventDuration(event, allEvents);
      const output = d['output'];
      return (
        <div>
          <DetailField label="TOOL">
            <span css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
              {str(d['toolName'])}
            </span>
          </DetailField>
          {duration != null && <DetailField label="DURATION">{formatDuration(duration)}</DetailField>}
          {output != null ? (
            <DetailField label="OUTPUT">
              <CodeBlock
                content={typeof output === 'string' ? output : JSON.stringify(output, null, 2)}
                maxHeight={200}
              />
            </DetailField>
          ) : null}
        </div>
      );
    }

    case 'tool_error':
      return (
        <div>
          <DetailField label="TOOL">
            <span css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
              {str(d['toolName'])}
            </span>
          </DetailField>
          <DetailField label="ERROR">
            <span css={css`color: ${theme.colors.error.main};`}>
              {str(d['error']) || str(d['message'])}
            </span>
          </DetailField>
          {d['stack'] != null ? (
            <DetailCollapsible title="Stack Trace">
              <CodeBlock content={str(d['stack'])} maxHeight={200} />
            </DetailCollapsible>
          ) : null}
        </div>
      );

    case 'response_end':
      return (
        <div>
          {d['finishReason'] != null ? <DetailField label="REASON">{str(d['finishReason'])}</DetailField> : null}
          {d['content'] != null ? (
            <div css={css`
              max-height: 400px;
              overflow-y: auto;
              font-family: ${theme.typography.fontFamily.sans};
              font-size: 13px;
              line-height: 1.6;
              color: ${theme.colors.text.primary};
              margin-top: ${theme.spacing[2]};
            `}>
              {str(d['content'])}
            </div>
          ) : null}
        </div>
      );

    case 'error':
      return (
        <div>
          {d['code'] != null ? <DetailField label="CODE" mono>{str(d['code'])}</DetailField> : null}
          <DetailField label="MESSAGE">
            <span css={css`color: ${theme.colors.error.main};`}>
              {str(d['message'])}
            </span>
          </DetailField>
          {d['details'] != null ? (
            <DetailCollapsible title="Details">
              <CodeBlock content={JSON.stringify(d['details'], null, 2)} maxHeight={200} />
            </DetailCollapsible>
          ) : null}
        </div>
      );

    case 'execute_start':
      return (
        <div>
          <DetailField label="TICK" mono>{String(d['tickNumber'] ?? '')}</DetailField>
          <DetailField label="PHASE">Execute</DetailField>
        </div>
      );

    case 'execute_reply_sent': {
      const path = str(d['path']);
      const hasReply = d['hasReply'];
      const duration = computeEventDuration(event, allEvents);
      return (
        <div>
          <DetailField label="REPLY PATH">
            <Badge
              label={path || 'none'}
              color={path === 'early' ? theme.colors.success.main
                   : path === 'follow-up' ? theme.colors.warning.main
                   : path === 'fallback' ? theme.colors.accent
                   : theme.colors.text.hint}
            />
          </DetailField>
          <DetailField label="HAS REPLY">{hasReply ? 'Yes' : 'No'}</DetailField>
          {duration != null && <DetailField label="DURATION">{formatDuration(duration)}</DetailField>}
        </div>
      );
    }

    case 'execute_transaction_complete': {
      const duration = computeEventDuration(event, allEvents);
      return (
        <div>
          {duration != null && <DetailField label="DURATION">{formatDuration(duration)}</DetailField>}
          <DetailField label="PHASE">Thoughts, emotions, decisions, energy persisted to heartbeat.db</DetailField>
        </div>
      );
    }

    case 'execute_decisions_complete': {
      const agentD = d['agentDecisions'] as number ?? 0;
      const pluginD = d['pluginDecisions'] as number ?? 0;
      const duration = computeEventDuration(event, allEvents);
      return (
        <div>
          {duration != null && <DetailField label="DURATION">{formatDuration(duration)}</DetailField>}
          <DetailField label="AGENT DECISIONS">{agentD}</DetailField>
          <DetailField label="PLUGIN DECISIONS">{pluginD}</DetailField>
        </div>
      );
    }

    case 'execute_memory_complete': {
      const duration = computeEventDuration(event, allEvents);
      return (
        <div>
          {duration != null && <DetailField label="DURATION">{formatDuration(duration)}</DetailField>}
          <DetailField label="CANDIDATES">{String(d['candidateCount'] ?? 0)}</DetailField>
          {Boolean(d['hadWorkingMemoryUpdate']) && <DetailField label="WORKING MEMORY">Updated</DetailField>}
          {Boolean(d['hadCoreSelfUpdate']) && <DetailField label="CORE SELF">Updated</DetailField>}
          {Boolean(d['hadSeedResonance']) && <DetailField label="SEED RESONANCE">Checked</DetailField>}
        </div>
      );
    }

    case 'execute_complete': {
      const totalMs = d['totalDurationMs'] as number;
      return (
        <div>
          {totalMs != null && <DetailField label="TOTAL DURATION">{formatDuration(totalMs)}</DetailField>}
        </div>
      );
    }

    default:
      return d ? <CodeBlock content={JSON.stringify(d, null, 2)} maxHeight={200} /> : null;
  }
}

// ============================================================================
// TimelineEventRow
// ============================================================================

function TimelineEventRow({
  event,
  allEvents,
  index,
  isLive,
}: {
  event: TimelineEvent;
  allEvents: TimelineEvent[];
  index: number;
  isLive: boolean;
}) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const category = getEventCategory(event.eventType);
  const color = getCategoryColor(category, theme);
  const Icon = getEventIcon(event.eventType);
  const label = getEventLabel(event.eventType);
  const preview = getPreviewContent(event);
  const expandable = hasExpandableDetail(event.eventType) && event.eventType !== 'tick_output';
  const duration = shouldShowDuration(event.eventType) ? computeEventDuration(event, allEvents) : null;
  const isError = category === 'error';

  const handleClick = () => {
    if (expandable) setExpanded((e) => !e);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
    if (e.key === 'Escape' && expanded) {
      e.preventDefault();
      setExpanded(false);
    }
  };

  return (
    <motion.div
      initial={isLive ? { opacity: 0, y: 12 } : { opacity: 0 }}
      animate={{ opacity: 1, y: 0 }}
      transition={isLive ? { duration: 0.2, ease: 'easeOut' } : { duration: 0.15, delay: index * 0.03 }}
    >
      {/* Clickable row */}
      <div
        role={expandable ? 'button' : undefined}
        tabIndex={expandable ? 0 : undefined}
        onClick={handleClick}
        onKeyDown={expandable ? handleKeyDown : undefined}
        css={css`
          display: flex;
          align-items: center;
          padding: 8px 0;
          cursor: ${expandable ? 'pointer' : 'default'};
          border-radius: ${theme.borderRadius.default};
          transition: background ${theme.transitions.micro};

          &:hover {
            background: ${expandable
              ? (theme.mode === 'light' ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.03)')
              : 'transparent'};
          }
        `}
      >
        {/* Relative timestamp column */}
        <span css={css`
          width: 60px;
          min-width: 60px;
          text-align: right;
          font-family: ${theme.typography.fontFamily.mono};
          font-size: 11px;
          color: ${theme.colors.text.hint};
          padding-right: ${theme.spacing[2]};
          user-select: none;
        `}>
          {formatRelativeMs(event.relativeMs)}
        </span>

        {/* Timeline dot */}
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.2, delay: isLive ? 0 : index * 0.03, type: 'spring', stiffness: 500, damping: 25 }}
          css={css`
            width: ${isError ? '10px' : '8px'};
            height: ${isError ? '10px' : '8px'};
            min-width: ${isError ? '10px' : '8px'};
            border-radius: 50%;
            background: ${color};
            margin-right: 12px;
          `}
        />

        {/* Event content */}
        <div css={css`
          flex: 1;
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 6px;
        `}>
          <Icon size={14} weight="regular" color={color} css={css`flex-shrink: 0;`} />

          <span css={css`
            font-family: ${theme.typography.fontFamily.sans};
            font-size: 13px;
            font-weight: ${theme.typography.fontWeight.medium};
            color: ${theme.colors.text.primary};
            white-space: nowrap;
            flex-shrink: 0;
          `}>
            {label}
          </span>

          {preview && (
            <span css={css`
              font-family: ${theme.typography.fontFamily.sans};
              font-size: 13px;
              color: ${theme.colors.text.secondary};
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
              min-width: 0;
              flex: 1;
            `}>
              {preview}
            </span>
          )}

          {duration != null && (
            <span
              title={`${Math.round(duration).toLocaleString()}ms`}
              css={css`
                font-family: ${theme.typography.fontFamily.mono};
                font-size: 11px;
                padding: 1px 6px;
                border-radius: 6px;
                background: ${getDurationBadgeColor(duration, theme)}1F;
                color: ${getDurationBadgeColor(duration, theme)};
                white-space: nowrap;
                flex-shrink: 0;
              `}
            >
              {formatDuration(duration)}
            </span>
          )}

          {expandable && (
            <motion.span
              animate={{ rotate: expanded ? 180 : 0 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              css={css`
                color: ${theme.colors.text.hint};
                display: flex;
                align-items: center;
                flex-shrink: 0;
                margin-left: auto;
              `}
            >
              <CaretDown size={12} />
            </motion.span>
          )}
        </div>
      </div>

      {/* Expanded detail panel */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            css={css`overflow: hidden;`}
          >
            <motion.div
              initial={{ y: 8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.2, ease: 'easeOut', delay: 0.05 }}
              css={css`
                background: ${theme.colors.background.paper};
                border-radius: ${theme.borderRadius.default};
                padding: 12px 16px;
                margin: 8px 0 8px 84px;
                border: 1px solid ${theme.colors.border.light};
              `}
            >
              <EventDetail event={event} allEvents={allEvents} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ============================================================================
// Breathing indicator (for live ticks)
// ============================================================================

function BreathingIndicator() {
  const theme = useTheme();
  return (
    <div css={css`
      display: flex;
      align-items: center;
      gap: ${theme.spacing[2]};
      padding: ${theme.spacing[4]} 0;
      padding-left: 60px;
    `}>
      <motion.div
        animate={{ opacity: [0.3, 0.8, 0.3] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        css={css`
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: ${theme.colors.accent};
          margin-left: 4px;
          margin-right: 12px;
        `}
      />
      <span css={css`
        font-family: ${theme.typography.fontFamily.serif};
        font-size: 13px;
        font-style: italic;
        color: ${theme.colors.text.hint};
      `}>
        Tick in progress...
      </span>
    </div>
  );
}

// ============================================================================
// TickCompletionCard
// ============================================================================

function TickCompletionCard({
  results,
  usage,
}: {
  results: TickResults;
  usage: TickUsage | null;
}) {
  const theme = useTheme();

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      css={css`margin-top: ${theme.spacing[6]};`}
    >
      {/* Label above card */}
      <span css={css`
        display: block;
        font-family: ${theme.typography.fontFamily.sans};
        font-size: 11px;
        font-weight: ${theme.typography.fontWeight.medium};
        color: ${theme.colors.text.hint};
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: ${theme.spacing[2]};
      `}>
        Tick Output
      </span>

      <div css={css`
        background: ${theme.colors.background.paper};
        border: 1px solid ${theme.colors.border.light};
        border-image: ${theme.colors.rimGradient} 1;
        border-radius: ${theme.borderRadius.md};
        padding: 20px 24px;

        /* Override border-image to keep border-radius */
        border: 1px solid ${theme.colors.border.light};
        position: relative;
        overflow: hidden;

        &::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 1px;
          background: ${theme.colors.rimGradient};
        }
      `}>
        {/* Thoughts */}
        {results.thoughts.length > 0 && (
          <div css={css`margin-bottom: ${theme.spacing[5]};`}>
            <SectionLabel>Thought</SectionLabel>
            {results.thoughts.map((t, i) => (
              <div key={i} css={css`
                margin-bottom: ${i < results.thoughts.length - 1 ? theme.spacing[3] : '0'};
                display: flex;
                flex-direction: column;
                gap: ${theme.spacing[1]};
              `}>
                <span css={css`
                  font-family: ${theme.typography.fontFamily.serif};
                  font-size: 15px;
                  line-height: 1.6;
                  color: ${theme.colors.text.primary};
                `}>
                  {t.content}
                </span>
                <span css={css`
                  display: inline-flex;
                  align-items: center;
                  gap: 3px;
                  font-family: ${theme.typography.fontFamily.mono};
                  font-size: 11px;
                  color: ${theme.colors.text.hint};
                `}>
                  {t.importance > 0.7 && <Star size={12} weight="fill" />}
                  {t.importance.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Experiences */}
        {results.experiences.length > 0 && (
          <div css={css`margin-bottom: ${theme.spacing[5]};`}>
            <SectionLabel>Experience</SectionLabel>
            {results.experiences.map((e, i) => (
              <div key={i} css={css`
                margin-bottom: ${i < results.experiences.length - 1 ? theme.spacing[3] : '0'};
                border-left: 2px solid ${theme.colors.accent}33;
                padding-left: ${theme.spacing[3]};
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
                <span css={css`
                  display: inline-flex;
                  align-items: center;
                  gap: 3px;
                  font-family: ${theme.typography.fontFamily.mono};
                  font-size: 11px;
                  color: ${theme.colors.text.hint};
                  margin-top: ${theme.spacing[1]};
                `}>
                  {e.importance > 0.7 && <Star size={12} weight="fill" />}
                  {e.importance.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Reply */}
        {results.reply && (
          <div css={css`margin-bottom: ${theme.spacing[5]};`}>
            <SectionLabel>Reply</SectionLabel>
            <div css={css`
              border-left: 2px solid ${theme.colors.accent}4D;
              padding-left: ${theme.spacing[3]};
            `}>
              <span css={css`
                font-family: ${theme.typography.fontFamily.sans};
                font-size: 14px;
                line-height: 1.6;
                color: ${theme.colors.text.primary};
                display: block;
              `}>
                {results.reply.content}
              </span>
              <div css={css`
                display: flex;
                gap: ${theme.spacing[2]};
                align-items: center;
                margin-top: ${theme.spacing[1.5]};
              `}>
                <Badge label={results.reply.channel} color={theme.colors.text.hint} />
                {results.reply.contactId && (
                  <span css={css`
                    font-family: ${theme.typography.fontFamily.mono};
                    font-size: 11px;
                    color: ${theme.colors.text.hint};
                  `}>
                    {results.reply.contactId}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Emotion Deltas */}
        {results.emotionDeltas.length > 0 && (
          <div css={css`margin-bottom: ${theme.spacing[5]};`}>
            <SectionLabel>Emotions</SectionLabel>
            <EmotionDeltaGrid deltas={results.emotionDeltas} />
          </div>
        )}

        {/* Decisions */}
        {results.decisions.length > 0 && (
          <div css={css`margin-bottom: ${theme.spacing[5]};`}>
            <SectionLabel>Decisions</SectionLabel>
            <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
              {results.decisions.map((d, i) => (
                <DecisionRow key={i} decision={d} />
              ))}
            </div>
          </div>
        )}

        {/* Token Usage */}
        {usage && (
          <div>
            <SectionLabel>Tokens</SectionLabel>
            <TokenUsageSummary usage={usage} />
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ============================================================================
// EmotionDeltaGrid
// ============================================================================

function EmotionDeltaGrid({ deltas }: { deltas: TickResults['emotionDeltas'] }) {
  const theme = useTheme();
  const [expandedReasons, setExpandedReasons] = useState<Record<number, boolean>>({});

  const toggleReason = (index: number) => {
    setExpandedReasons((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  return (
    <div css={css`
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px 24px;

      @media (max-width: 768px) {
        grid-template-columns: 1fr;
      }
    `}>
      {deltas.map((d, i) => (
        <div key={i}>
          <div css={css`display: flex; align-items: baseline; gap: ${theme.spacing[2]};`}>
            <span css={css`
              font-family: ${theme.typography.fontFamily.sans};
              font-size: 13px;
              font-weight: ${theme.typography.fontWeight.medium};
              color: ${theme.colors.text.primary};
            `}>
              {d.emotion}
            </span>
            <span css={css`
              font-family: ${theme.typography.fontFamily.mono};
              font-size: 13px;
              color: ${d.delta > 0 ? theme.colors.success.main : d.delta < 0 ? theme.colors.error.main : theme.colors.text.hint};
            `}>
              {d.delta > 0 ? '+' : ''}{d.delta.toFixed(3)}
            </span>
            <span css={css`
              font-family: ${theme.typography.fontFamily.mono};
              font-size: 11px;
              color: ${theme.colors.text.hint};
            `}>
              {d.intensityBefore.toFixed(2)} &rarr; {d.intensityAfter.toFixed(2)}
            </span>
          </div>
          {d.reasoning && (
            <div
              onClick={() => toggleReason(i)}
              css={css`
                font-family: ${theme.typography.fontFamily.sans};
                font-size: 12px;
                color: ${theme.colors.text.secondary};
                margin-top: 2px;
                cursor: pointer;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: ${expandedReasons[i] ? 'normal' : 'nowrap'};
              `}
            >
              {d.reasoning}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// DecisionRow
// ============================================================================

function DecisionRow({ decision }: { decision: TickResults['decisions'][number] }) {
  const theme = useTheme();
  const outcomeColor =
    decision.outcome === 'executed' ? theme.colors.success.main
    : decision.outcome === 'dropped' ? theme.colors.warning.main
    : theme.colors.error.main;

  return (
    <div>
      <div css={css`
        display: flex;
        align-items: baseline;
        gap: ${theme.spacing[2]};
        flex-wrap: wrap;
      `}>
        <Badge label={decision.type} color={outcomeColor} />
        <span css={css`
          font-family: ${theme.typography.fontFamily.sans};
          font-size: 13px;
          color: ${theme.colors.text.primary};
        `}>
          {decision.description}
        </span>
        <span css={css`
          font-family: ${theme.typography.fontFamily.mono};
          font-size: 11px;
          color: ${outcomeColor};
        `}>
          [{decision.outcome}]
        </span>
      </div>
      {(decision.outcome === 'dropped' || decision.outcome === 'failed') && decision.outcomeDetail && (
        <div css={css`
          font-family: ${theme.typography.fontFamily.sans};
          font-size: 12px;
          color: ${theme.colors.text.secondary};
          margin-top: 2px;
          padding-left: ${theme.spacing[2]};
        `}>
          {decision.outcomeDetail}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// TokenUsageSummary
// ============================================================================

function TokenUsageSummary({ usage }: { usage: TickUsage }) {
  const theme = useTheme();
  return (
    <div css={css`
      display: flex;
      gap: 24px;
      flex-wrap: wrap;
    `}>
      <div>
        <span css={css`
          display: block;
          font-family: ${theme.typography.fontFamily.sans};
          font-size: 11px;
          font-weight: ${theme.typography.fontWeight.medium};
          color: ${theme.colors.text.hint};
          text-transform: uppercase;
        `}>Input</span>
        <span css={css`
          font-family: ${theme.typography.fontFamily.mono};
          font-size: 13px;
          color: ${theme.colors.text.primary};
        `}>{usage.inputTokens.toLocaleString()}</span>
      </div>
      <div>
        <span css={css`
          display: block;
          font-family: ${theme.typography.fontFamily.sans};
          font-size: 11px;
          font-weight: ${theme.typography.fontWeight.medium};
          color: ${theme.colors.text.hint};
          text-transform: uppercase;
        `}>Output</span>
        <span css={css`
          font-family: ${theme.typography.fontFamily.mono};
          font-size: 13px;
          color: ${theme.colors.text.primary};
        `}>{usage.outputTokens.toLocaleString()}</span>
      </div>
      <div>
        <span css={css`
          display: block;
          font-family: ${theme.typography.fontFamily.sans};
          font-size: 11px;
          font-weight: ${theme.typography.fontWeight.medium};
          color: ${theme.colors.text.hint};
          text-transform: uppercase;
        `}>Total</span>
        <span css={css`
          font-family: ${theme.typography.fontFamily.mono};
          font-size: 13px;
          font-weight: ${theme.typography.fontWeight.semibold};
          color: ${theme.colors.text.primary};
        `}>{usage.totalTokens.toLocaleString()}</span>
      </div>
      {usage.costUsd != null && (
        <div>
          <span css={css`
            display: block;
            font-family: ${theme.typography.fontFamily.sans};
            font-size: 11px;
            font-weight: ${theme.typography.fontWeight.medium};
            color: ${theme.colors.text.hint};
            text-transform: uppercase;
          `}>Cost</span>
          <span css={css`
            font-family: ${theme.typography.fontFamily.mono};
            font-size: 13px;
            color: ${theme.colors.text.primary};
          `}>${usage.costUsd.toFixed(4)}</span>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Skeleton loading state
// ============================================================================

function TimelineSkeleton() {
  const theme = useTheme();
  const shimmerLight = theme.mode === 'light'
    ? 'rgba(0,0,0,0.04)'
    : 'rgba(255,255,255,0.03)';
  const shimmerHighlight = theme.mode === 'light'
    ? 'rgba(0,0,0,0.08)'
    : 'rgba(255,255,255,0.07)';

  const shimmerKeyframes = css`
    @keyframes shimmer {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
  `;

  const shimmerStyle = css`
    background: linear-gradient(
      90deg,
      ${shimmerLight} 0%,
      ${shimmerHighlight} 50%,
      ${shimmerLight} 100%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s ease-in-out infinite;
    border-radius: ${theme.borderRadius.sm};
  `;

  return (
    <div css={shimmerKeyframes}>
      {/* Header skeleton */}
      <div css={css`
        display: flex;
        gap: ${theme.spacing[2]};
        margin-bottom: ${theme.spacing[6]};
      `}>
        <div css={css`${shimmerStyle}; width: 60px; height: 20px;`} />
        <div css={css`${shimmerStyle}; width: 80px; height: 20px;`} />
        <div css={css`${shimmerStyle}; width: 50px; height: 20px;`} />
      </div>

      {/* Event rows skeleton */}
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} css={css`
          display: flex;
          align-items: center;
          padding: 8px 0;
          gap: 12px;
        `}>
          <div css={css`width: 60px; display: flex; justify-content: flex-end;`}>
            <div css={css`${shimmerStyle}; width: 36px; height: 12px;`} />
          </div>
          <div css={css`
            ${shimmerStyle};
            width: 8px;
            height: 8px;
            border-radius: 50%;
            flex-shrink: 0;
          `} />
          <div css={css`${shimmerStyle}; height: 14px; flex: 1; max-width: ${[60, 45, 70, 55, 40, 65][i]}%;`} />
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// AgentTimeline (Main Component)
// ============================================================================

export function AgentTimeline({ tickNumber, onBack }: AgentTimelineProps) {
  const theme = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [liveEvents, setLiveEvents] = useState<TimelineEvent[]>([]);

  // Check if this tick is currently active in the heartbeat system
  const heartbeatState = useHeartbeatStore((s) => s.heartbeatState);
  const isTickActive = heartbeatState != null
    && heartbeatState.tickNumber === tickNumber
    && heartbeatState.currentStage !== 'idle';

  // Fetch timeline data — refetch on a short interval while tick is active but not yet in DB
  const {
    data: rawTimeline,
    isLoading,
    isError,
    refetch,
  } = trpc.heartbeat.getTickTimeline.useQuery(
    { tickNumber },
    {
      retry: false,
      refetchInterval: (query) => {
        // Poll every 2s while the tick is active but no data yet
        if (!query.state.data && isTickActive) return 2000;
        return false;
      },
    },
  );

  // Normalize the raw tRPC response into our local types
  const timeline = useMemo(() => normalizeTimeline(rawTimeline), [rawTimeline]);

  const isLive = timeline != null && !timeline.isComplete;

  // Subscribe to live events when tick is not complete
  trpc.heartbeat.onAgentEvent.useSubscription(undefined, {
    enabled: isLive,
    onData: (event: any) => {
      if (!timeline || event.sessionId !== timeline.sessionId) return;

      setLiveEvents((prev) => {
        // Dedup by event ID
        if (prev.some((e) => e.id === event.id)) return prev;
        // Also check against initial query events
        if (timeline.events.some((e) => e.id === event.id)) return prev;

        const firstEventTime = timeline.events.length > 0
          ? new Date(timeline.events[0]!.createdAt).getTime()
          : Date.now();
        const eventTime = new Date(event.createdAt).getTime();

        const newEvent: TimelineEvent = {
          id: event.id,
          sessionId: event.sessionId,
          eventType: event.eventType,
          data: event.data ?? {},
          createdAt: event.createdAt,
          relativeMs: eventTime - firstEventTime,
        };

        return [...prev, newEvent];
      });
    },
  });

  // Merge query + live events
  const allEvents = useMemo(() => {
    if (!timeline) return [];
    const merged = [...timeline.events];
    for (const le of liveEvents) {
      if (!merged.some((e) => e.id === le.id)) {
        merged.push(le);
      }
    }
    merged.sort((a, b) => a.relativeMs - b.relativeMs);
    return merged;
  }, [timeline, liveEvents]);

  // Check if tick_output arrived via live events
  const tickOutputArrived = useMemo(() => {
    return liveEvents.some((e) => e.eventType === 'tick_output');
  }, [liveEvents]);

  // Filter out tick_output from event rows (it gets the completion card)
  const eventRows = useMemo(() => {
    return allEvents.filter((e) => e.eventType !== 'tick_output');
  }, [allEvents]);

  // Auto-scroll logic
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    setAutoScroll(isAtBottom);
  }, []);

  useEffect(() => {
    if (isLive && autoScroll && containerRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [allEvents.length, isLive, autoScroll]);

  // Escape key to go back
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onBack]);

  // Loading state
  if (isLoading) {
    return (
      <div>
        <BackButton onBack={onBack} />
        <TimelineSkeleton />
      </div>
    );
  }

  // Error state
  if (isError) {
    return (
      <div>
        <BackButton onBack={onBack} />
        <div css={css`
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: ${theme.spacing[3]};
          padding: 4rem 0;
        `}>
          <WarningCircle size={32} weight="regular" color={theme.colors.text.hint} />
          <span css={css`
            font-family: ${theme.typography.fontFamily.sans};
            font-size: 14px;
            color: ${theme.colors.text.secondary};
          `}>
            Something went wrong loading this tick.
          </span>
          <button
            onClick={() => refetch()}
            css={css`
              font-family: ${theme.typography.fontFamily.sans};
              font-size: 14px;
              color: ${theme.colors.text.secondary};
              border: 1px solid ${theme.colors.border.default};
              padding: ${theme.spacing[1.5]} ${theme.spacing[4]};
              border-radius: ${theme.borderRadius.default};
              cursor: pointer;
              transition: all ${theme.transitions.micro};
              &:hover {
                color: ${theme.colors.text.primary};
                border-color: ${theme.colors.border.focus};
              }
            `}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  // Empty state — tick is active but not yet in DB
  // Show stage-specific messages so the user knows what's actually happening
  if (!timeline && isTickActive) {
    const stage = heartbeatState?.currentStage ?? 'gather';
    const stageLabel = stage === 'gather'
      ? 'Gathering context...'
      : stage === 'mind'
        ? 'Starting mind session...'
        : 'Processing...';
    const stageDetail = stage === 'gather'
      ? 'Assembling memories, emotions, and context.'
      : stage === 'mind'
        ? 'Connecting to the agent provider. Events will appear shortly.'
        : `Tick #${tickNumber} is running.`;

    return (
      <div>
        <BackButton onBack={onBack} />
        <div css={css`
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: ${theme.spacing[3]};
          padding: 4rem 0;
        `}>
          <motion.div
            animate={{ opacity: [0.3, 0.8, 0.3] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            css={css`
              width: 12px;
              height: 12px;
              border-radius: 50%;
              background: ${theme.colors.accent};
            `}
          />
          <span css={css`
            font-family: ${theme.typography.fontFamily.serif};
            font-size: 16px;
            font-style: italic;
            color: ${theme.colors.text.hint};
          `}>
            {stageLabel}
          </span>
          <span css={css`
            font-family: ${theme.typography.fontFamily.sans};
            font-size: 14px;
            color: ${theme.colors.text.secondary};
          `}>
            {stageDetail}
          </span>
        </div>
      </div>
    );
  }

  // Empty state (tick not found)
  if (!timeline) {
    return (
      <div>
        <BackButton onBack={onBack} />
        <div css={css`
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: ${theme.spacing[2]};
          padding: 4rem 0;
        `}>
          <span css={css`
            font-family: ${theme.typography.fontFamily.serif};
            font-size: 16px;
            font-style: italic;
            color: ${theme.colors.text.hint};
          `}>
            Tick #{tickNumber} not found
          </span>
          <span css={css`
            font-family: ${theme.typography.fontFamily.sans};
            font-size: 14px;
            color: ${theme.colors.text.secondary};
          `}>
            This tick may have been cleaned up, or it hasn't completed yet.
          </span>
        </div>
      </div>
    );
  }

  // Determine if we should show the completion card
  const showCompletion = timeline.isComplete || tickOutputArrived;

  return (
    <div ref={containerRef} onScroll={isLive ? handleScroll : undefined}>
      <BackButton onBack={onBack} />

      {/* Header */}
      <TimelineHeader timeline={timeline} />

      {/* Timeline body */}
      <div css={css`position: relative;`}>
        {/* Vertical timeline line */}
        {eventRows.length > 0 && (
          <div css={css`
            position: absolute;
            left: 64px;
            top: 12px;
            bottom: ${showCompletion ? '24px' : (isLive ? '0' : '12px')};
            width: 1px;
            background: ${theme.colors.border.default};
          `} />
        )}

        {/* Event rows */}
        {eventRows.map((event, i) => (
          <TimelineEventRow
            key={event.id}
            event={event}
            allEvents={allEvents}
            index={i}
            isLive={liveEvents.some((le) => le.id === event.id)}
          />
        ))}

        {/* Breathing indicator for live ticks */}
        {isLive && !tickOutputArrived && <BreathingIndicator />}
      </div>

      {/* Completion card */}
      {showCompletion && timeline.results && (
        <TickCompletionCard
          results={timeline.results}
          usage={timeline.usage}
        />
      )}

      {/* Jump to latest (when in live mode and scrolled up) */}
      {isLive && !autoScroll && (
        <button
          onClick={() => {
            setAutoScroll(true);
            containerRef.current?.scrollTo({
              top: containerRef.current.scrollHeight,
              behavior: 'smooth',
            });
          }}
          css={css`
            position: fixed;
            bottom: 24px;
            right: 24px;
            font-family: ${theme.typography.fontFamily.sans};
            font-size: 12px;
            color: ${theme.colors.accentForeground};
            background: ${theme.colors.accent};
            padding: ${theme.spacing[1]} ${theme.spacing[3]};
            border-radius: ${theme.borderRadius.full};
            cursor: pointer;
            z-index: ${theme.zIndex.sticky};
            transition: opacity ${theme.transitions.micro};
            &:hover { opacity: 0.9; }
          `}
        >
          Jump to latest
        </button>
      )}
    </div>
  );
}

// ============================================================================
// TimelineHeader
// ============================================================================

function TimelineHeader({ timeline }: { timeline: TickTimeline }) {
  const theme = useTheme();
  return (
    <div css={css`margin-bottom: ${theme.spacing[6]};`}>
      <div css={css`
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: ${theme.spacing[2]};
      `}>
        {/* Tick number */}
        <span css={css`
          font-family: ${theme.typography.fontFamily.mono};
          font-size: 18px;
          font-weight: ${theme.typography.fontWeight.semibold};
          color: ${theme.colors.text.primary};
        `}>
          #{timeline.tickNumber}
        </span>

        {/* Trigger badge */}
        <Badge label={timeline.triggerType} color={triggerColor(timeline.triggerType, theme)} />

        {/* Session state badge */}
        <Badge
          label={timeline.sessionState}
          color={timeline.sessionState === 'cold' ? '#5B8DEF' : '#E8A838'}
        />

        {/* Duration */}
        {timeline.durationMs != null && (
          <span css={css`
            font-family: ${theme.typography.fontFamily.mono};
            font-size: 14px;
            color: ${theme.colors.text.secondary};
          `}>
            {formatDuration(timeline.durationMs)}
          </span>
        )}

        {/* Timestamp */}
        <span css={css`
          font-family: ${theme.typography.fontFamily.sans};
          font-size: 13px;
          color: ${theme.colors.text.disabled};
        `}>
          {new Date(timeline.createdAt).toLocaleString()}
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// BackButton (local copy)
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
        font-family: ${theme.typography.fontFamily.sans};
        font-size: 14px;
        color: ${theme.colors.text.secondary};
        cursor: pointer;
        padding: ${theme.spacing[1]} 0;
        margin-bottom: ${theme.spacing[4]};
        transition: color 150ms ease-out;

        &:hover { color: ${theme.colors.text.primary}; }
      `}
    >
      <ArrowLeft size={14} />
      Back to ticks
    </button>
  );
}
