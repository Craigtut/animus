/**
 * MessageThread — renders display items with color-coded formatting.
 *
 * Shows user messages, agent responses, events, and system messages.
 * Auto-scrolls by slicing to fit terminal height.
 *
 * Event visibility:
 *   Non-verbose (default): tool_call_start, thinking_start
 *   Verbose (/events on):  ALL events including session lifecycle, response
 *                          chunks count, input_received, etc.
 */

import React from 'react';
import { Box, Text, useStdout } from 'ink';
import type { DisplayItem } from '../types.js';
import type {
  SessionStartData,
  SessionEndData,
  InputReceivedData,
  ToolCallStartData,
  ToolCallEndData,
  ToolErrorData,
  ThinkingEndData,
  ResponseEndData,
  ResponseChunkData,
  TurnEndData,
  ErrorData,
} from '@animus/agents';

interface Props {
  items: DisplayItem[];
  streamingText: string;
  verbose: boolean;
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 3) + '...';
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function renderEvent(item: DisplayItem & { kind: 'event' }, verbose: boolean): React.ReactNode {
  const { event } = item;
  const { type, data } = event;

  switch (type) {
    // -- Always shown (non-verbose + verbose) --

    case 'tool_call_start': {
      const d = data as ToolCallStartData;
      const inputStr = truncate(JSON.stringify(d.toolInput), 80);
      return (
        <Text dimColor>
          {'  '}<Text color="yellow">tool</Text> {d.toolName} {inputStr}
        </Text>
      );
    }

    case 'tool_call_end': {
      const d = data as ToolCallEndData;
      return (
        <Text dimColor>
          {'  '}<Text color="green">done</Text> {d.toolName}{' '}
          <Text color="gray">({formatDuration(d.durationMs)})</Text>
        </Text>
      );
    }

    case 'tool_error': {
      const d = data as ToolErrorData;
      return (
        <Text>
          {'  '}<Text color="red" bold>tool error</Text> {d.toolName}: {d.error}
        </Text>
      );
    }

    case 'thinking_start':
      return (
        <Text dimColor>
          {'  '}<Text color="magenta">thinking</Text> ...
        </Text>
      );

    case 'turn_end': {
      const d = data as TurnEndData;
      const tags: string[] = [`turn ${d.turnIndex}`];
      if (d.hasThinking) tags.push('thinking');
      if (d.hasToolCalls) tags.push(`tools: ${d.toolNames.join(', ')}`);
      if (!d.hasToolCalls) tags.push('final');
      return (
        <Text dimColor>
          {'  '}<Text color="blue">turn_end</Text>{' '}
          <Text color="gray">[{tags.join(' | ')}]</Text>{' '}
          <Text color="gray">({d.text.length} chars)</Text>
        </Text>
      );
    }

    case 'error': {
      const d = data as ErrorData;
      return (
        <Text>
          {'  '}<Text color="red" bold>error</Text> [{d.code}] {d.message}
          {d.recoverable ? <Text color="gray"> (recoverable)</Text> : null}
        </Text>
      );
    }

    // -- Verbose only --

    case 'session_start': {
      if (!verbose) return null;
      const d = data as SessionStartData;
      return (
        <Text dimColor>
          {'  '}<Text color="blue">session</Text> started — {d.provider}:{d.model}
        </Text>
      );
    }

    case 'session_end': {
      if (!verbose) return null;
      const d = data as SessionEndData;
      return (
        <Text dimColor>
          {'  '}<Text color="blue">session</Text> ended — {d.reason}{' '}
          ({formatDuration(d.totalDurationMs)})
        </Text>
      );
    }

    case 'input_received': {
      if (!verbose) return null;
      const d = data as InputReceivedData;
      return (
        <Text dimColor>
          {'  '}<Text color="gray">input</Text> {d.type}: {truncate(d.content, 60)}
        </Text>
      );
    }

    case 'thinking_end': {
      if (!verbose) return null;
      const d = data as ThinkingEndData;
      const preview = d.content ? ` — ${truncate(d.content, 60)}` : '';
      return (
        <Text dimColor>
          {'  '}<Text color="magenta">thought</Text> {formatDuration(d.thinkingDurationMs)}{preview}
        </Text>
      );
    }

    case 'response_start':
      if (!verbose) return null;
      return (
        <Text dimColor>
          {'  '}<Text color="cyan">response</Text> streaming...
        </Text>
      );

    case 'response_chunk': {
      // Never render individual chunks — too noisy even for verbose.
      // The streaming text in MessageThread already shows this.
      return null;
    }

    case 'response_end': {
      if (!verbose) return null;
      const d = data as ResponseEndData;
      return (
        <Text dimColor>
          {'  '}<Text color="cyan">response</Text> complete — {d.finishReason}{' '}
          ({d.content.length} chars)
        </Text>
      );
    }

    default:
      // Catch-all for any event type we don't explicitly handle.
      // Shows in verbose mode with raw type + JSON data summary.
      if (!verbose) return null;
      return (
        <Text dimColor>
          {'  '}<Text color="gray">{type}</Text>{' '}
          {truncate(JSON.stringify(data), 80)}
        </Text>
      );
  }
}

export function MessageThread({ items, streamingText, verbose }: Props) {
  const { stdout } = useStdout();
  // Reserve lines for status bar (3) + input (2) + padding (2)
  const maxLines = (stdout?.rows ?? 24) - 7;

  // Build rendered lines
  const rendered: React.ReactNode[] = [];

  for (const item of items) {
    switch (item.kind) {
      case 'user':
        rendered.push(
          <Text key={rendered.length}>
            <Text color="green" bold>you {'>'} </Text>
            <Text>{item.text}</Text>
          </Text>,
        );
        break;

      case 'agent': {
        const stats: string[] = [];
        if (item.durationMs) stats.push(formatDuration(item.durationMs));
        if (item.usage) stats.push(`${item.usage.totalTokens} tokens`);
        if (item.cost) stats.push(formatCost(item.cost.totalCostUsd));
        const statsStr = stats.length > 0 ? ` (${stats.join(', ')})` : '';

        rendered.push(
          <Text key={rendered.length}>
            <Text color="cyan" bold>agent {'>'} </Text>
            <Text>{item.text}</Text>
            {statsStr && <Text color="gray">{statsStr}</Text>}
          </Text>,
        );
        break;
      }

      case 'turn_text': {
        const label = item.hasToolCalls
          ? `turn ${item.turnIndex} | intermediate`
          : `turn ${item.turnIndex} | response`;
        rendered.push(
          <Text key={rendered.length}>
            <Text color="magenta" dimColor>[{label}] </Text>
            <Text dimColor={item.hasToolCalls}>{item.text}</Text>
          </Text>,
        );
        break;
      }

      case 'event': {
        const node = renderEvent(item, verbose);
        if (node) {
          rendered.push(<Box key={rendered.length}>{node}</Box>);
        }
        break;
      }

      case 'system':
        rendered.push(
          <Text key={rendered.length} color="yellow">
            {item.text}
          </Text>,
        );
        break;
    }
  }

  // Streaming text (in-progress response)
  if (streamingText) {
    rendered.push(
      <Text key="streaming">
        <Text color="yellow" dimColor>[streaming] </Text>
        <Text>{streamingText}</Text>
        <Text color="gray"> ...</Text>
      </Text>,
    );
  }

  // Slice to fit terminal
  const visible = rendered.slice(-maxLines);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {visible}
    </Box>
  );
}
