/**
 * Context Snapshot Capture
 *
 * Captures per-phase context snapshots showing what context was assembled
 * and sent to each LLM call in the heartbeat pipeline. Three snapshot types
 * correspond to the three LLM-calling phases: THOUGHT, AGENTIC LOOP, REFLECT.
 * A fourth type (AgenticTurnDelta) captures per-turn deltas within the loop.
 *
 * All snapshot building is wrapped in try/catch so failures never block
 * the pipeline. Errors are logged but not thrown.
 *
 * See docs/cortex/mind-migration.md for the 5-phase pipeline design.
 */

import type { CortexAgent, AgentMessage } from '@animus-labs/cortex';
import type {
  AgentEventType,
  ContextSnapshotSection,
  ThoughtContextSnapshot,
  AgenticContextSnapshot,
  ReflectContextSnapshot,
  AgenticTurnDelta,
  MessageSnapshot,
  HistorySnapshotMeta,
  PhaseContextSnapshot,
} from '@animus-labs/shared';

import { buildSystemPromptManifest } from './context-builder.js';
import type { CompiledPersona } from './persona-compiler.js';
import type { GatherResult } from './gather-context.js';
import type { EphemeralSection } from './cortex-pipeline.js';

import { getAgentLogsDb } from '../db/index.js';
import * as agentLogStore from '../db/stores/agent-log-store.js';
import { getEventBus } from '../lib/event-bus.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('ContextSnapshot', 'heartbeat');

// ============================================================================
// Helper: Token Estimation
// ============================================================================

/** Rough token estimator: chars / 4 (matches shared and cortex packages). */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Extract text content from an AgentMessage, handling both string
 * and complex content array forms.
 */
function extractMessageText(msg: AgentMessage): string {
  if (typeof msg.content === 'string') {
    return msg.content;
  }
  const parts: string[] = [];
  for (const part of msg.content) {
    if (part.type === 'text' && typeof part.text === 'string') {
      parts.push(part.text);
    } else if (part.type === 'tool_use' || part.type === 'toolCall') {
      const name = (part as Record<string, unknown>)['name'] ?? (part as Record<string, unknown>)['toolName'] ?? 'unknown';
      parts.push(`[Tool: ${name}]`);
    } else if (part.type === 'tool_result') {
      const content = (part as Record<string, unknown>)['content'];
      const text = typeof content === 'string' ? content : String(content ?? '');
      parts.push(`[Tool Result: ${text.substring(0, 200)}${text.length > 200 ? '...' : ''}]`);
    }
  }
  return parts.join('\n') || '(empty)';
}

/**
 * Convert an AgentMessage to a MessageSnapshot.
 */
function toMessageSnapshot(msg: AgentMessage): MessageSnapshot {
  const content = extractMessageText(msg);
  return {
    role: msg.role as 'user' | 'assistant' | 'system',
    content,
    tokenCount: estimateTokens(content),
  };
}

/**
 * Convert a simple { role, content } phase message (unknown[]) to a MessageSnapshot.
 * Handles both simple objects and AgentMessage-shaped objects.
 */
function phaseMessageToSnapshot(msg: unknown): MessageSnapshot {
  const m = msg as Record<string, unknown>;
  const role = (m['role'] as string) ?? 'user';
  let content: string;
  if (typeof m['content'] === 'string') {
    content = m['content'];
  } else if (Array.isArray(m['content'])) {
    // AgentMessage with complex content
    content = extractMessageText(m as unknown as AgentMessage);
  } else {
    content = String(m['content'] ?? '');
  }
  return {
    role: role as 'user' | 'assistant' | 'system',
    content,
    tokenCount: estimateTokens(content),
  };
}

/**
 * Build conversation history metadata from an AgentMessage array.
 */
function buildHistoryMeta(history: AgentMessage[]): HistorySnapshotMeta {
  let totalTokens = 0;
  let oldestTimestamp: string | null = null;
  let hasSummary = false;
  let summaryTokens: number | null = null;

  for (const msg of history) {
    const text = extractMessageText(msg);
    totalTokens += estimateTokens(text);
  }

  // Detect compaction summary: first message that is assistant-role
  // and starts with a summary marker pattern
  if (history.length > 0) {
    const first = history[0]!;
    const firstText = extractMessageText(first);
    if (first.role === 'assistant' && (
      firstText.includes('Summary of') ||
      firstText.includes('Previous conversation') ||
      firstText.includes('[Conversation summary')
    )) {
      hasSummary = true;
      summaryTokens = estimateTokens(firstText);
    }
  }

  // Try to extract timestamp from earliest message
  if (history.length > 0) {
    const firstMsg = history[0] as unknown as Record<string, unknown>;
    if (typeof firstMsg['timestamp'] === 'string') {
      oldestTimestamp = firstMsg['timestamp'];
    }
  }

  return {
    messageCount: history.length,
    totalTokens,
    hasSummary,
    summaryTokens,
    oldestMessageTimestamp: oldestTimestamp,
  };
}

/**
 * Detect whether a phase message is a context slot message.
 * Slot messages have content starting with `<context slot="`.
 */
function isSlotMessage(msg: unknown): boolean {
  const m = msg as Record<string, unknown>;
  return typeof m['content'] === 'string' && m['content'].startsWith('<context slot="');
}

/**
 * Extract the slot name from a slot message's content.
 * E.g. `<context slot="credentials">\n...\n</context>` => "credentials"
 */
function extractSlotName(content: string): string {
  const match = content.match(/^<context slot="([^"]+)">/);
  return match?.[1] ?? 'unknown';
}

/**
 * Extract the inner content from a slot message (between the tags).
 */
function extractSlotContent(content: string): string {
  const startIdx = content.indexOf('>\n');
  const endIdx = content.lastIndexOf('\n</context>');
  if (startIdx >= 0 && endIdx > startIdx) {
    return content.substring(startIdx + 2, endIdx);
  }
  return content;
}

// ============================================================================
// buildThoughtSnapshot
// ============================================================================

/**
 * Build a ThoughtContextSnapshot from the THOUGHT phase inputs.
 *
 * Decomposes phaseMessages by detecting:
 * - Slot messages: content starts with `<context slot="`
 * - The last message is always the prompt
 * - Messages between slots and prompt that are not slot-formatted
 *   are ephemeral or history (recent-conversation slot)
 */
export function buildThoughtSnapshot(params: {
  cortexAgent: CortexAgent;
  thoughtSystemPrompt: string;
  phaseMessages: unknown[];
  tickNumber: number;
  debugMode: boolean;
}): ThoughtContextSnapshot | null {
  try {
    const { cortexAgent, thoughtSystemPrompt, phaseMessages, tickNumber, debugMode } = params;

    // System prompt: single concatenated string, store as one section
    const systemPrompt: ContextSnapshotSection[] = [{
      name: 'Thought System Prompt',
      content: debugMode ? thoughtSystemPrompt : '',
      tokenCount: estimateTokens(thoughtSystemPrompt),
      category: 'system',
    }];

    // Decompose phaseMessages:
    // - Slot messages (content starts with <context slot=")
    // - The last message is always the prompt
    // - Everything between slots and prompt is ephemeral or history
    const slots: ContextSnapshotSection[] = [];
    const ephemeral: ContextSnapshotSection[] = [];
    let conversationHistory: HistorySnapshotMeta = {
      messageCount: 0,
      totalTokens: 0,
      hasSummary: false,
      summaryTokens: null,
      oldestMessageTimestamp: null,
    };

    // The last message is always the prompt
    const promptMsg = phaseMessages[phaseMessages.length - 1] as Record<string, unknown>;
    const promptContent = typeof promptMsg?.['content'] === 'string' ? promptMsg['content'] : '';
    const prompt: ContextSnapshotSection = {
      name: 'Thought Prompt',
      content: debugMode ? promptContent : '',
      tokenCount: estimateTokens(promptContent),
      category: 'prompt',
    };

    // Process all messages except the last (prompt)
    for (let i = 0; i < phaseMessages.length - 1; i++) {
      const msg = phaseMessages[i]!;

      if (isSlotMessage(msg)) {
        const content = (msg as Record<string, unknown>)['content'] as string;
        const slotName = extractSlotName(content);

        // The recent-conversation slot is actually history metadata
        if (slotName === 'recent-conversation') {
          const innerContent = extractSlotContent(content);
          const lines = innerContent.split('\n').filter(l => l.trim());
          conversationHistory = {
            messageCount: lines.length,
            totalTokens: estimateTokens(innerContent),
            hasSummary: false,
            summaryTokens: null,
            oldestMessageTimestamp: null,
          };
        } else {
          const innerContent = extractSlotContent(content);
          slots.push({
            name: slotName,
            content: debugMode ? innerContent : '',
            tokenCount: estimateTokens(innerContent),
            category: 'state',
          });
        }
      } else {
        // Non-slot, non-prompt message: ephemeral context
        const content = typeof (msg as Record<string, unknown>)['content'] === 'string'
          ? (msg as Record<string, unknown>)['content'] as string
          : '';
        if (content) {
          ephemeral.push({
            name: 'Ephemeral Context',
            content: debugMode ? content : '',
            tokenCount: estimateTokens(content),
            category: 'state',
          });
        }
      }
    }

    // Context window from CompactionManager
    const contextWindow: number = cortexAgent.getCompactionManager().contextWindow;

    // Total estimated tokens
    const totalTokens =
      systemPrompt.reduce((sum, s) => sum + s.tokenCount, 0) +
      slots.reduce((sum, s) => sum + s.tokenCount, 0) +
      conversationHistory.totalTokens +
      ephemeral.reduce((sum, s) => sum + s.tokenCount, 0) +
      prompt.tokenCount;

    const snapshot: ThoughtContextSnapshot = {
      phase: 'thought',
      tickNumber,
      systemPrompt,
      slots,
      conversationHistory,
      ephemeral,
      prompt,
      contextWindow,
      totalTokens,
    };

    // Debug mode: include full messages array
    if (debugMode) {
      snapshot.messages = phaseMessages.map(phaseMessageToSnapshot);
    }

    return snapshot;
  } catch (err) {
    log.error('Failed to build thought context snapshot:', err);
    return null;
  }
}

// ============================================================================
// buildAgenticSnapshot
// ============================================================================

/**
 * Build an AgenticContextSnapshot for the AGENTIC LOOP phase.
 *
 * This is a refactored version of the existing buildContextSnapshot() from
 * heartbeat/index.ts, adapted to return an AgenticContextSnapshot with
 * the per-phase type shape.
 */
export function buildAgenticSnapshot(params: {
  cortexAgent: CortexAgent;
  compiledPersona: CompiledPersona;
  gathered: GatherResult;
  ephemeralSections: EphemeralSection[];
  triggerPrompt: string;
  tickNumber: number;
  debugMode: boolean;
  timezone?: string;
  firstTurnInputTokens?: number | null;
}): AgenticContextSnapshot | null {
  try {
    const {
      cortexAgent,
      compiledPersona,
      gathered,
      ephemeralSections,
      triggerPrompt,
      tickNumber,
      debugMode,
      timezone,
      firstTurnInputTokens,
    } = params;

    // Consumer system prompt sections (persona, emotions, energy, etc.)
    const consumerManifest = buildSystemPromptManifest(compiledPersona, {
      energySystemEnabled: gathered.energySystemEnabled ?? false,
      tickIntervalMs: gathered.tickIntervalMs,
      ...(timezone ? { timezone } : {}),
    });
    const consumerSystemPrompt: ContextSnapshotSection[] = consumerManifest
      .filter(s => s.included)
      .map(s => ({
        name: s.title,
        content: s.content ?? '',
        tokenCount: s.tokenCount,
        category: s.category,
      }));

    // Cortex operational system prompt sections
    const cortexSections = cortexAgent.getSystemPromptSections();
    const cortexSystemPrompt: ContextSnapshotSection[] = cortexSections.map(s => ({
      name: s.name,
      content: s.content,
      tokenCount: estimateTokens(s.content),
      category: 'system',
    }));

    // Context slots. Include Cortex-owned internal slots such as
    // _available_tools and _observations so the inspector's total matches the
    // actual prompt surface more closely.
    const cm = cortexAgent.getContextManager();
    const slots: ContextSnapshotSection[] = [...cm.slots].map(name => {
      const content = cm.getSlot(name) ?? '';
      return {
        name,
        content,
        tokenCount: estimateTokens(content),
        category: 'state',
      };
    });

    // Conversation history metadata
    const history = cortexAgent.getConversationHistory();
    const conversationHistory = buildHistoryMeta(history);

    // Ephemeral sections
    const ephemeral: ContextSnapshotSection[] = ephemeralSections.map(s => ({
      name: s.name,
      content: s.content,
      tokenCount: estimateTokens(s.content),
      category: 'state',
    }));

    // Trigger message
    const triggerMessage = {
      content: triggerPrompt,
      tokenCount: estimateTokens(triggerPrompt),
    };

    // Context window from CompactionManager
    const contextWindow: number = cortexAgent.getCompactionManager().contextWindow;

    // Total estimated tokens
    const totalTokens =
      consumerSystemPrompt.reduce((sum, s) => sum + s.tokenCount, 0) +
      cortexSystemPrompt.reduce((sum, s) => sum + s.tokenCount, 0) +
      slots.reduce((sum, s) => sum + s.tokenCount, 0) +
      conversationHistory.totalTokens +
      ephemeral.reduce((sum, s) => sum + s.tokenCount, 0) +
      triggerMessage.tokenCount;

    const snapshot: AgenticContextSnapshot = {
      phase: 'agentic_loop',
      tickNumber,
      consumerSystemPrompt,
      cortexSystemPrompt,
      slots,
      conversationHistory,
      ephemeral,
      triggerMessage,
      contextWindow,
      totalTokens,
    };

    // Add actual first-turn input tokens if available
    if (firstTurnInputTokens != null) {
      snapshot.firstTurnActualInputTokens = firstTurnInputTokens;
    }

    // Debug mode: capture full message array from conversation history
    if (debugMode) {
      snapshot.messages = history.map(toMessageSnapshot);
    }

    return snapshot;
  } catch (err) {
    log.error('Failed to build agentic context snapshot:', err);
    return null;
  }
}

// ============================================================================
// buildReflectSnapshot
// ============================================================================

/**
 * Build a ReflectContextSnapshot from the REFLECT phase inputs.
 *
 * Same decomposition approach as Thought: slot messages detected by
 * `<context slot="` prefix, last message is always the prompt.
 * History section contains raw current-tick turns (not summarized).
 */
export function buildReflectSnapshot(params: {
  cortexAgent: CortexAgent;
  reflectSystemPrompt: string;
  phaseMessages: unknown[];
  currentTickTurns: AgentMessage[];
  tickNumber: number;
  debugMode: boolean;
}): ReflectContextSnapshot | null {
  try {
    const { cortexAgent, reflectSystemPrompt, phaseMessages, currentTickTurns, tickNumber, debugMode } = params;

    // System prompt: 8 sections concatenated, store as one section
    const systemPrompt: ContextSnapshotSection[] = [{
      name: 'Reflect System Prompt',
      content: debugMode ? reflectSystemPrompt : '',
      tokenCount: estimateTokens(reflectSystemPrompt),
      category: 'system',
    }];

    // Decompose phaseMessages (same approach as Thought)
    const slots: ContextSnapshotSection[] = [];
    const ephemeral: ContextSnapshotSection[] = [];

    // The last message is always the prompt
    const promptMsg = phaseMessages[phaseMessages.length - 1] as Record<string, unknown>;
    const promptContent = typeof promptMsg?.['content'] === 'string' ? promptMsg['content'] : '';
    const prompt: ContextSnapshotSection = {
      name: 'Reflect Prompt',
      content: debugMode ? promptContent : '',
      tokenCount: estimateTokens(promptContent),
      category: 'prompt',
    };

    // Current-tick turns metadata (these are injected as raw AgentMessages,
    // not wrapped in slot tags, so we detect them separately)
    let currentTickTokens = 0;
    for (const msg of currentTickTurns) {
      currentTickTokens += estimateTokens(extractMessageText(msg));
    }
    const currentTickTurnsMeta = {
      messageCount: currentTickTurns.length,
      totalTokens: currentTickTokens,
    };

    // Build a set of current-tick turn messages for identity matching.
    // In buildPhaseMessages with includeHistory='current-tick', the raw
    // AgentMessages are pushed directly, so we need to identify them
    // to separate them from slot and ephemeral messages.
    const turnSet = new Set(currentTickTurns);

    // Process all messages except the last (prompt)
    for (let i = 0; i < phaseMessages.length - 1; i++) {
      const msg = phaseMessages[i]!;

      // Check if this is one of the raw current-tick turns
      if (turnSet.has(msg as AgentMessage)) {
        // Skip: already captured in currentTickTurnsMeta
        continue;
      }

      if (isSlotMessage(msg)) {
        const content = (msg as Record<string, unknown>)['content'] as string;
        const slotName = extractSlotName(content);
        const innerContent = extractSlotContent(content);
        slots.push({
          name: slotName,
          content: debugMode ? innerContent : '',
          tokenCount: estimateTokens(innerContent),
          category: 'state',
        });
      } else {
        // Non-slot, non-turn, non-prompt message: ephemeral context
        const content = typeof (msg as Record<string, unknown>)['content'] === 'string'
          ? (msg as Record<string, unknown>)['content'] as string
          : '';
        if (content) {
          ephemeral.push({
            name: 'Ephemeral Context',
            content: debugMode ? content : '',
            tokenCount: estimateTokens(content),
            category: 'state',
          });
        }
      }
    }

    // Context window from CompactionManager
    const contextWindow: number = cortexAgent.getCompactionManager().contextWindow;

    // Total estimated tokens
    const totalTokens =
      systemPrompt.reduce((sum, s) => sum + s.tokenCount, 0) +
      slots.reduce((sum, s) => sum + s.tokenCount, 0) +
      currentTickTurnsMeta.totalTokens +
      ephemeral.reduce((sum, s) => sum + s.tokenCount, 0) +
      prompt.tokenCount;

    const snapshot: ReflectContextSnapshot = {
      phase: 'reflect',
      tickNumber,
      systemPrompt,
      slots,
      currentTickTurns: currentTickTurnsMeta,
      ephemeral,
      prompt,
      contextWindow,
      totalTokens,
    };

    // Debug mode: include full messages array
    if (debugMode) {
      snapshot.messages = phaseMessages.map(phaseMessageToSnapshot);
    }

    return snapshot;
  } catch (err) {
    log.error('Failed to build reflect context snapshot:', err);
    return null;
  }
}

// ============================================================================
// buildTurnDelta
// ============================================================================

/**
 * Build an AgenticTurnDelta capturing the per-turn state change within
 * the agentic loop.
 */
export function buildTurnDelta(params: {
  cortexAgent: CortexAgent;
  turnNumber: number;
  prevHistoryLength: number;
  turnUsage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
  tickNumber: number;
  debugMode: boolean;
}): AgenticTurnDelta | null {
  try {
    const { cortexAgent, turnNumber, prevHistoryLength, turnUsage, tickNumber, debugMode } = params;

    const currentHistory = cortexAgent.getConversationHistory();
    const totalHistoryMessages = currentHistory.length;
    const newMessageCount = totalHistoryMessages - prevHistoryLength;

    // Estimate total history tokens
    let totalHistoryTokens = 0;
    for (const msg of currentHistory) {
      totalHistoryTokens += estimateTokens(extractMessageText(msg));
    }

    const delta: AgenticTurnDelta = {
      phase: 'agentic_turn',
      tickNumber,
      turnNumber,
      newMessageCount,
      totalHistoryMessages,
      totalHistoryTokens,
      turnUsage,
    };

    // Debug mode: capture the new messages as snapshots
    if (debugMode && newMessageCount > 0) {
      const newMessages = currentHistory.slice(prevHistoryLength);
      delta.newMessages = newMessages.map(toMessageSnapshot);
    }

    return delta;
  } catch (err) {
    log.error('Failed to build agentic turn delta:', err);
    return null;
  }
}

// ============================================================================
// logPhaseSnapshot
// ============================================================================

/**
 * Log a PhaseContextSnapshot as a phase_context_snapshot event in agent_logs.db.
 * Also emits the event via the event bus for real-time subscribers.
 */
export function logPhaseSnapshot(
  logSessionId: string,
  tickNumber: number,
  snapshot: PhaseContextSnapshot,
): void {
  try {
    const agentLogsDb = getAgentLogsDb();
    const event = agentLogStore.insertEvent(agentLogsDb, {
      sessionId: logSessionId,
      eventType: 'phase_context_snapshot' as AgentEventType,
      data: { ...snapshot } as unknown as Record<string, unknown>,
    });

    const eventBus = getEventBus();
    eventBus.emit('agent:event:logged', {
      id: event.id,
      sessionId: event.sessionId,
      eventType: event.eventType,
      data: event.data,
      createdAt: event.createdAt,
    });
  } catch (err) {
    log.error('Failed to log phase context snapshot:', err);
  }
}
