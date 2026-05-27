/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Wrench,
  ChatText,
  ArrowsClockwise,
  Lightning,
  CaretRight,
} from '@phosphor-icons/react';
import type { MergedEvent } from './types';
import { DurationBadge, CodeBlock, truncate } from './shared';
import { getToolCallSummary, getToolOutputSummary, ToolInputDetail } from './tool-detail';

// ============================================================================
// MergedEventRow
// ============================================================================

interface MergedEventRowProps {
  event: MergedEvent;
  index: number;
}

export function MergedEventRow({ event }: MergedEventRowProps) {
  switch (event.kind) {
    case 'tool_use':
      return <ToolUseRow event={event} />;
    case 'response':
      return <ResponseRow event={event} />;
    case 'compaction':
      return <CompactionRow event={event} />;
    case 'event':
    default:
      return <FallbackRow event={event} />;
  }
}

// ============================================================================
// ToolUseRow
// ============================================================================

function ToolUseRow({ event }: { event: MergedEvent }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);

  const toolColor = '#C4943A';
  const errorTint = event.isError ? theme.colors.error.main : undefined;
  const iconColor = errorTint ?? toolColor;

  const name = event.toolName ?? 'unknown';
  const summary = getToolCallSummary(name, event.toolInput);
  const outputSummary = event.toolOutput != null
    ? getToolOutputSummary(name, event.toolOutput)
    : '';

  return (
    <div>
      <button
        onClick={() => setExpanded((o) => !o)}
        css={css`
          display: flex;
          align-items: center;
          gap: ${theme.spacing[2]};
          width: 100%;
          padding: ${theme.spacing[1.5]} 0;
          cursor: pointer;
          transition: background ${theme.transitions.micro};
          border-radius: ${theme.borderRadius.sm};

          &:hover {
            background: ${theme.mode === 'light'
              ? 'rgba(0, 0, 0, 0.025)'
              : 'rgba(255, 255, 255, 0.03)'};
          }
        `}
      >
        <Wrench
          size={14}
          weight="regular"
          css={css`color: ${iconColor}; flex-shrink: 0;`}
        />

        <span css={css`
          flex: 1;
          min-width: 0;
          display: flex;
          align-items: baseline;
          gap: ${theme.spacing[1.5]};
          text-align: left;
        `}>
          <span css={css`
            font-family: ${theme.typography.fontFamily.mono};
            font-size: 12px;
            font-weight: ${theme.typography.fontWeight.medium};
            color: ${errorTint ?? theme.colors.text.primary};
            white-space: nowrap;
          `}>
            {name}
          </span>
          {summary && (
            <span css={css`
              font-family: ${theme.typography.fontFamily.mono};
              font-size: 11px;
              color: ${theme.colors.text.hint};
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
              min-width: 0;
            `}>
              {summary}
            </span>
          )}
          {outputSummary && (
            <span css={css`
              font-family: ${theme.typography.fontFamily.mono};
              font-size: 11px;
              color: ${theme.colors.text.secondary};
              white-space: nowrap;
              flex-shrink: 0;
            `}>
              {outputSummary}
            </span>
          )}
        </span>

        {event.durationMs != null && (
          <DurationBadge ms={event.durationMs} />
        )}

        <CaretRight
          size={12}
          weight="bold"
          css={css`
            color: ${theme.colors.text.disabled};
            flex-shrink: 0;
            transition: transform ${theme.transitions.micro};
            transform: rotate(${expanded ? '90deg' : '0deg'});
          `}
        />
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
              margin-left: 22px;
              padding: ${theme.spacing[3]};
              background: ${theme.mode === 'light'
                ? 'rgba(0, 0, 0, 0.02)'
                : 'rgba(255, 255, 255, 0.025)'};
              border: 1px solid ${theme.colors.border.light};
              border-radius: ${theme.borderRadius.default};
              margin-bottom: ${theme.spacing[1]};
            `}>
              {event.toolInput && (
                <ToolInputDetail toolName={name} input={event.toolInput} />
              )}
              {event.toolOutput != null && (
                <div css={css`margin-top: ${theme.spacing[2]};`}>
                  <span css={css`
                    display: block;
                    font-family: ${theme.typography.fontFamily.sans};
                    font-size: 11px;
                    font-weight: ${theme.typography.fontWeight.medium};
                    color: ${event.isError ? theme.colors.error.main : theme.colors.text.hint};
                    text-transform: uppercase;
                    letter-spacing: 0.04em;
                    margin-bottom: ${theme.spacing[0.5]};
                  `}>
                    {event.isError ? 'Error' : 'Output'}
                  </span>
                  <CodeBlock
                    content={typeof event.toolOutput === 'string'
                      ? event.toolOutput
                      : JSON.stringify(event.toolOutput, null, 2)}
                    maxHeight={300}
                  />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// ResponseRow
// ============================================================================

function ResponseRow({ event }: { event: MergedEvent }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);

  const responseColor = '#4A9B6E';
  const content = event.content ?? '';
  const preview = truncate(content, 80);

  return (
    <div>
      <button
        onClick={() => setExpanded((o) => !o)}
        css={css`
          display: flex;
          align-items: center;
          gap: ${theme.spacing[2]};
          width: 100%;
          padding: ${theme.spacing[1.5]} 0;
          cursor: pointer;
          transition: background ${theme.transitions.micro};
          border-radius: ${theme.borderRadius.sm};

          &:hover {
            background: ${theme.mode === 'light'
              ? 'rgba(0, 0, 0, 0.025)'
              : 'rgba(255, 255, 255, 0.03)'};
          }
        `}
      >
        <ChatText
          size={14}
          weight="regular"
          css={css`color: ${responseColor}; flex-shrink: 0;`}
        />

        <span css={css`
          flex: 1;
          min-width: 0;
          font-family: ${theme.typography.fontFamily.sans};
          font-size: 13px;
          color: ${theme.colors.text.secondary};
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          text-align: left;
        `}>
          {preview}
        </span>

        {event.durationMs != null && (
          <DurationBadge ms={event.durationMs} />
        )}

        <CaretRight
          size={12}
          weight="bold"
          css={css`
            color: ${theme.colors.text.disabled};
            flex-shrink: 0;
            transition: transform ${theme.transitions.micro};
            transform: rotate(${expanded ? '90deg' : '0deg'});
          `}
        />
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
              margin-left: 22px;
              padding: ${theme.spacing[3]};
              background: ${theme.mode === 'light'
                ? 'rgba(0, 0, 0, 0.02)'
                : 'rgba(255, 255, 255, 0.025)'};
              border: 1px solid ${theme.colors.border.light};
              border-radius: ${theme.borderRadius.default};
              margin-bottom: ${theme.spacing[1]};
              font-family: ${theme.typography.fontFamily.sans};
              font-size: 13px;
              line-height: ${theme.typography.lineHeight.relaxed};
              color: ${theme.colors.text.primary};
              white-space: pre-wrap;
              word-break: break-word;
            `}>
              {content}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// CompactionRow
// ============================================================================

function formatReductionPercent(before: number, after: number): string {
  if (before <= 0) return '0%';
  return `${Math.round((1 - after / before) * 100)}%`;
}

function CompactionRow({ event }: { event: MergedEvent }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);

  const compactionColor = '#7A6B94';

  let label: string;
  if (event.compactionType === 'microcompaction') {
    label = 'Tool Results Trimmed';
  } else if (event.compactionType === 'emergency_truncation') {
    label = 'Emergency Truncation';
  } else if (event.compactionType === 'observation') {
    const messages = event.messagesCompacted != null
      ? `${event.messagesCompacted} message${event.messagesCompacted !== 1 ? 's' : ''}`
      : 'messages';
    const tokens = event.observationTokens != null
      ? ` (${formatTokenCount(event.observationTokens)} observed)`
      : '';
    label = `Observation: compacted ${messages}${tokens}`;
  } else if (event.compactionType === 'reflection') {
    if (event.tokensBefore != null && event.tokensAfter != null) {
      const reduction = formatReductionPercent(event.tokensBefore, event.tokensAfter);
      label = `Reflection: ${formatTokenCount(event.tokensBefore)} -> ${formatTokenCount(event.tokensAfter)} (${reduction} reduction)`;
    } else {
      label = 'Observation Reflection';
    }
  } else if (event.tokensBefore != null && event.tokensAfter != null) {
    const reduction = formatReductionPercent(event.tokensBefore, event.tokensAfter);
    label = `Compaction: ${formatTokenCount(event.tokensBefore)} -> ${formatTokenCount(event.tokensAfter)} (${reduction} reduction)`;
  } else {
    label = 'Compaction';
  }

  return (
    <div
      css={css`
        margin: ${theme.spacing[1]} 0;
        border: 1px solid ${compactionColor}33;
        border-radius: ${theme.borderRadius.sm};
        background: ${compactionColor}0A;
      `}
    >
      <button
        onClick={() => setExpanded((o) => !o)}
        css={css`
          display: flex;
          align-items: center;
          gap: ${theme.spacing[2]};
          width: 100%;
          padding: ${theme.spacing[1.5]} ${theme.spacing[2]};
          cursor: pointer;
          transition: background ${theme.transitions.micro};
          border-radius: ${theme.borderRadius.sm};

          &:hover {
            background: ${compactionColor}0F;
          }
        `}
      >
        <ArrowsClockwise
          size={13}
          weight="regular"
          css={css`color: ${compactionColor}; flex-shrink: 0;`}
        />

        <span css={css`
          flex: 1;
          font-family: ${theme.typography.fontFamily.mono};
          font-size: 11px;
          font-weight: ${theme.typography.fontWeight.medium};
          color: ${compactionColor};
          text-align: left;
        `}>
          {label}
        </span>

        {(event.compactionType === 'observation' ? event.messagesCompacted : event.turnsCompacted) != null && (
          <span css={css`
            font-family: ${theme.typography.fontFamily.mono};
            font-size: 11px;
            color: ${compactionColor}99;
          `}>
            {event.compactionType === 'observation'
              ? `${event.messagesCompacted} msg${event.messagesCompacted !== 1 ? 's' : ''}`
              : `${event.turnsCompacted} turn${event.turnsCompacted !== 1 ? 's' : ''}`}
          </span>
        )}

        <CaretRight
          size={10}
          weight="bold"
          css={css`
            color: ${compactionColor}66;
            flex-shrink: 0;
            transition: transform ${theme.transitions.micro};
            transform: rotate(${expanded ? '90deg' : '0deg'});
          `}
        />
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
              padding: 0 ${theme.spacing[2]} ${theme.spacing[2]};
            `}>
              <CodeBlock
                content={JSON.stringify(
                  event.rawEvents.map((e) => ({ type: e.eventType, data: e.data })),
                  null,
                  2,
                )}
                maxHeight={200}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// FallbackRow
// ============================================================================

function FallbackRow({ event }: { event: MergedEvent }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);

  const raw = event.rawEvents[0];
  const eventType = raw?.eventType ?? 'unknown';
  const preview = raw?.data
    ? truncate(JSON.stringify(raw.data), 60)
    : '';

  return (
    <div>
      <button
        onClick={() => setExpanded((o) => !o)}
        css={css`
          display: flex;
          align-items: center;
          gap: ${theme.spacing[2]};
          width: 100%;
          padding: ${theme.spacing[1.5]} 0;
          cursor: pointer;
          transition: background ${theme.transitions.micro};
          border-radius: ${theme.borderRadius.sm};

          &:hover {
            background: ${theme.mode === 'light'
              ? 'rgba(0, 0, 0, 0.025)'
              : 'rgba(255, 255, 255, 0.03)'};
          }
        `}
      >
        <Lightning
          size={14}
          weight="regular"
          css={css`color: ${theme.colors.text.hint}; flex-shrink: 0;`}
        />

        <span css={css`
          font-family: ${theme.typography.fontFamily.mono};
          font-size: 12px;
          font-weight: ${theme.typography.fontWeight.medium};
          color: ${theme.colors.text.secondary};
          white-space: nowrap;
          flex-shrink: 0;
        `}>
          {eventType}
        </span>

        {preview && (
          <span css={css`
            flex: 1;
            min-width: 0;
            font-family: ${theme.typography.fontFamily.mono};
            font-size: 11px;
            color: ${theme.colors.text.hint};
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            text-align: left;
          `}>
            {preview}
          </span>
        )}

        <CaretRight
          size={12}
          weight="bold"
          css={css`
            color: ${theme.colors.text.disabled};
            flex-shrink: 0;
            transition: transform ${theme.transitions.micro};
            transform: rotate(${expanded ? '90deg' : '0deg'});
          `}
        />
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
              margin-left: 22px;
              padding: ${theme.spacing[2]};
              margin-bottom: ${theme.spacing[1]};
            `}>
              <CodeBlock
                content={JSON.stringify(
                  event.rawEvents.map((e) => ({
                    type: e.eventType,
                    relativeMs: e.relativeMs,
                    data: e.data,
                  })),
                  null,
                  2,
                )}
                maxHeight={300}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function formatTokenCount(tokens: number): string {
  if (tokens >= 1000) {
    return `${Math.round(tokens / 1000)}K`;
  }
  return tokens.toLocaleString();
}
