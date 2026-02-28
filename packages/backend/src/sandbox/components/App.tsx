/**
 * App — root Ink component for the agent sandbox TUI.
 *
 * Manages display items, sandbox state, command dispatch,
 * and session lifecycle.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Box, useApp, useInput } from 'ink';
import type { AgentProvider } from '@animus-labs/shared';
import type { AgentEvent, TurnEndData } from '@animus-labs/agents';
import { StatusBar } from './StatusBar.js';
import { MessageThread } from './MessageThread.js';
import { CommandInput } from './CommandInput.js';
import type { SandboxSession } from '../session.js';
import type { DisplayItem, SandboxState } from '../types.js';
import { getPluginManager } from '../../plugins/index.js';
import { COGNITIVE_SYSTEM_PROMPT } from '../cognitive-prompt.js';
import type { CognitiveSnapshot } from '../cognitive-tools.js';

interface Props {
  session: SandboxSession;
  initialState: SandboxState;
}

const HELP_TEXT = `Commands:
  /provider claude|codex|opencode  Switch provider (ends session)
  /model <id>                      Set model (ends session)
  /system <prompt>                 Set system prompt (ends session)
  /plugins                         List loaded plugins
  /events on|off                   Toggle verbose event display
  /cognitive on|off                Toggle cognitive MCP tools (ends session)
  /snapshot                        Show last cognitive snapshot
  /session                         Show session info
  /clear                           Clear message thread
  /help                            Show this help
  /quit                            Clean shutdown`;

function formatSnapshot(snap: CognitiveSnapshot): string {
  const lines: string[] = ['── Cognitive Snapshot ──'];

  if (snap.thought) {
    lines.push(`\nThought (${snap.thought.importance.toFixed(2)}):`);
    lines.push(`  ${snap.thought.content}`);
  } else {
    lines.push('\nThought: (none recorded)');
  }

  if (snap.experience) {
    lines.push(`\nExperience (${snap.experience.importance.toFixed(2)}):`);
    lines.push(`  ${snap.experience.content}`);
  }

  if (snap.emotionDeltas.length > 0) {
    lines.push('\nEmotion Deltas:');
    for (const ed of snap.emotionDeltas) {
      const sign = ed.delta >= 0 ? '+' : '';
      lines.push(`  ${ed.emotion}: ${sign}${ed.delta.toFixed(3)} — ${ed.reasoning}`);
    }
  }

  if (snap.energyDelta) {
    const sign = snap.energyDelta.delta >= 0 ? '+' : '';
    lines.push(`\nEnergy: ${sign}${snap.energyDelta.delta.toFixed(3)} — ${snap.energyDelta.reasoning}`);
  }

  if (snap.decisions.length > 0) {
    lines.push('\nDecisions:');
    for (const d of snap.decisions) {
      lines.push(`  [${d.type}] ${d.description}`);
    }
  }

  if (snap.memoryCandidate.length > 0) {
    lines.push('\nMemory Candidates:');
    for (const m of snap.memoryCandidate) {
      lines.push(`  [${m.memoryType}] (${m.importance.toFixed(2)}) ${m.content}`);
    }
  }

  if (snap.workingMemoryUpdate) {
    lines.push(`\nWorking Memory Update: ${snap.workingMemoryUpdate.slice(0, 100)}...`);
  }
  if (snap.coreSelfUpdate) {
    lines.push(`\nCore Self Update: ${snap.coreSelfUpdate.slice(0, 100)}...`);
  }

  return lines.join('\n');
}

export function App({ session, initialState }: Props) {
  const { exit } = useApp();
  const startupItems: DisplayItem[] = [];
  if (initialState.cognitiveMode) {
    startupItems.push({
      kind: 'system',
      text: 'Cognitive mode ACTIVE — tools: mcp__cognitive__record_thought, mcp__cognitive__record_cognitive_state',
      timestamp: Date.now(),
    });
  }
  const [items, setItems] = useState<DisplayItem[]>(startupItems);
  const [state, setState] = useState<SandboxState>(initialState);
  const [input, setInput] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const streamingTextRef = useRef('');
  const stateRef = useRef(state);
  stateRef.current = state;

  // Wire up event forwarding once
  useEffect(() => {
    session.onEvent((event: AgentEvent) => {
      // On turn_end, commit the current streaming text as a labeled turn_text item
      // and clear the streaming buffer for the next turn
      if (event.type === 'turn_end') {
        const d = event.data as TurnEndData;
        const currentText = streamingTextRef.current;

        if (currentText) {
          setItems((prev) => [
            ...prev,
            {
              kind: 'turn_text' as const,
              text: currentText,
              turnIndex: d.turnIndex,
              hasToolCalls: d.hasToolCalls,
              hasThinking: d.hasThinking,
              toolNames: d.toolNames,
              timestamp: Date.now(),
            },
            { kind: 'event', event, timestamp: Date.now() },
          ]);
        } else {
          // No streaming text for this turn (e.g. tool-only turn)
          setItems((prev) => [
            ...prev,
            { kind: 'event', event, timestamp: Date.now() },
          ]);
        }

        // Clear streaming buffer for the next turn
        streamingTextRef.current = '';
        setStreamingText('');
        return;
      }

      setItems((prev) => [
        ...prev,
        { kind: 'event', event, timestamp: Date.now() },
      ]);

      // Track session ID from session_start events
      if (event.type === 'session_start') {
        setState((s) => ({ ...s, sessionId: event.sessionId }));
      }
    });
  }, [session]);

  const addSystem = useCallback((text: string) => {
    setItems((prev) => [
      ...prev,
      { kind: 'system', text, timestamp: Date.now() },
    ]);
  }, []);

  const handleCommand = useCallback(
    async (cmd: string) => {
      const parts = cmd.trim().split(/\s+/);
      const command = parts[0]!.toLowerCase();
      const arg = parts.slice(1).join(' ');

      switch (command) {
        case '/help':
          addSystem(HELP_TEXT);
          break;

        case '/quit':
          addSystem('Shutting down...');
          await session.end();
          exit();
          break;

        case '/clear':
          setItems([]);
          addSystem('Cleared.');
          break;

        case '/provider': {
          const provider = arg.toLowerCase();
          if (!['claude', 'codex', 'opencode'].includes(provider)) {
            addSystem('Usage: /provider claude|codex|opencode');
            break;
          }
          await session.end();
          setState((s) => ({
            ...s,
            provider: provider as AgentProvider,
            sessionId: undefined,
          }));
          addSystem(`Provider set to ${provider}. Session will start on next message.`);
          break;
        }

        case '/model':
          if (!arg) {
            addSystem('Usage: /model <model-id>');
            break;
          }
          await session.end();
          setState((s) => ({ ...s, model: arg, sessionId: undefined }));
          addSystem(`Model set to ${arg}. Session will start on next message.`);
          break;

        case '/system':
          if (!arg) {
            addSystem('Usage: /system <prompt>');
            break;
          }
          await session.end();
          setState((s) => ({
            ...s,
            systemPrompt: arg,
            sessionId: undefined,
          }));
          addSystem('System prompt updated. Session will start on next message.');
          break;

        case '/plugins': {
          const pm = getPluginManager();
          const plugins = pm.getAllPlugins().filter((p) => p.enabled);
          if (plugins.length === 0) {
            addSystem('No plugins loaded.');
          } else {
            const lines = plugins.map((p) => {
              const detail = pm.getPlugin(p.name);
              const parts: string[] = [`  ${p.name}`];
              if (detail) {
                const mcpCount = Object.keys(detail.mcpServers).length;
                if (mcpCount) parts.push(`mcp:${mcpCount}`);
                if (detail.skills.length) parts.push(`skills:${detail.skills.length}`);
              }
              return parts.join(' ');
            });
            addSystem(`Loaded plugins:\n${lines.join('\n')}`);
          }
          break;
        }

        case '/events': {
          const val = arg.toLowerCase();
          if (val !== 'on' && val !== 'off') {
            addSystem('Usage: /events on|off');
            break;
          }
          const verbose = val === 'on';
          setState((s) => ({ ...s, showVerboseEvents: verbose }));
          addSystem(`Verbose events ${verbose ? 'enabled' : 'disabled'}.`);
          break;
        }

        case '/cognitive': {
          const cval = arg.toLowerCase();
          if (cval !== 'on' && cval !== 'off') {
            addSystem(`Cognitive mode is ${stateRef.current.cognitiveMode ? 'ON' : 'OFF'}. Usage: /cognitive on|off`);
            break;
          }
          const cogEnabled = cval === 'on';
          await session.setCognitiveMode(cogEnabled);
          // Update system prompt to match cognitive mode
          const newPrompt = cogEnabled
            ? COGNITIVE_SYSTEM_PROMPT
            : 'You are a helpful assistant running in the Animus agent sandbox.';
          setState((s) => ({
            ...s,
            cognitiveMode: cogEnabled,
            systemPrompt: newPrompt,
            sessionId: undefined,
          }));
          addSystem(`Cognitive mode ${cogEnabled ? 'enabled' : 'disabled'}. Session will restart on next message.`);
          break;
        }

        case '/snapshot': {
          const snap = session.getCognitiveSnapshot();
          if (!snap) {
            addSystem('No cognitive snapshot available. Enable cognitive mode first.');
          } else if (!snap.thought && !snap.experience) {
            addSystem('Cognitive snapshot is empty — no tools were called yet.');
          } else {
            addSystem(formatSnapshot(snap));
          }
          break;
        }

        case '/session':
          if (!session.id) {
            addSystem('No active session.');
          } else {
            addSystem(`Session: ${session.id}`);
          }
          break;

        default:
          addSystem(`Unknown command: ${command}. Type /help for commands.`);
      }
    },
    [session, addSystem, exit],
  );

  const handleSubmit = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      setInput('');

      // Command dispatch
      if (trimmed.startsWith('/')) {
        await handleCommand(trimmed);
        return;
      }

      // Add user message to display
      setItems((prev) => [
        ...prev,
        { kind: 'user', text: trimmed, timestamp: Date.now() },
      ]);

      // If already streaming, inject the message into the running prompt
      if (stateRef.current.isStreaming) {
        session.injectMessage(trimmed);
        return;
      }

      // Start a new prompt
      setState((s) => ({ ...s, isStreaming: true }));
      streamingTextRef.current = '';
      setStreamingText('');

      try {
        const response = await session.prompt(
          trimmed,
          stateRef.current.provider,
          stateRef.current.model,
          stateRef.current.systemPrompt,
          stateRef.current.showVerboseEvents,
          (chunk: string) => {
            streamingTextRef.current += chunk;
            setStreamingText((prev) => prev + chunk);
          },
        );

        // Clear streaming
        streamingTextRef.current = '';
        setStreamingText('');

        // In cognitive mode, the reply streams during intermediate turns
        // (visible as turn_text items). The final response.content may be
        // empty because the last turn is a tool call. Show a summary line
        // with cost/usage instead of the misleading "(no response)".
        if (stateRef.current.cognitiveMode) {
          // Summary line with timing/cost
          const parts: string[] = [];
          if (response.durationMs) parts.push(`${(response.durationMs / 1000).toFixed(1)}s`);
          if (response.usage) parts.push(`${response.usage.totalTokens} tokens`);
          if (response.cost) parts.push(`$${response.cost.totalCostUsd.toFixed(4)}`);

          if (parts.length > 0) {
            setItems((prev) => [
              ...prev,
              { kind: 'system', text: `── done (${parts.join(', ')}) ──`, timestamp: Date.now() },
            ]);
          }

          // Auto-display the cognitive snapshot
          const snap = session.getCognitiveSnapshot();
          if (snap && (snap.thought || snap.experience)) {
            setItems((prev) => [
              ...prev,
              { kind: 'system', text: formatSnapshot(snap), timestamp: Date.now() },
            ]);
          }
        } else {
          // Normal mode: show the final agent response
          setItems((prev) => [
            ...prev,
            {
              kind: 'agent',
              text: response.content || '(no response)',
              timestamp: Date.now(),
              durationMs: response.durationMs,
              usage: response.usage,
              cost: response.cost,
            },
          ]);
        }

        // Update session ID if we didn't have it yet
        if (session.id) {
          setState((s) => ({ ...s, sessionId: session.id }));
        }
      } catch (err) {
        streamingTextRef.current = '';
        setStreamingText('');
        const msg = err instanceof Error ? err.message : String(err);
        addSystem(`Error: ${msg}`);
      } finally {
        setState((s) => ({ ...s, isStreaming: false }));
      }
    },
    [session, handleCommand, addSystem],
  );

  // Ctrl+C handler
  useInput((_, key) => {
    if (key.ctrl && _.toLowerCase() === 'c') {
      session.end().then(() => exit());
    }
  });

  return (
    <Box flexDirection="column" height="100%">
      <StatusBar state={state} />
      <MessageThread
        items={items}
        streamingText={streamingText}
        verbose={state.showVerboseEvents}
      />
      <CommandInput
        isStreaming={state.isStreaming}
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
      />
    </Box>
  );
}
