/**
 * Layer 1: Microcompaction (tool result trimming).
 *
 * Progressively reduces the footprint of old tool results in conversation
 * history. Operates in-memory only via transformContext; never modifies
 * the persisted conversation history (agent.state.messages).
 *
 * Two sub-mechanisms:
 *   1. Insertion-time cap: Truncate large tool results at insertion time.
 *   2. Threshold-triggered batch processing: At 40%/50%/60% of context
 *      window, batch re-evaluate all tool results by age and category.
 *
 * Between threshold crossings, the cached trim state is replayed
 * identically to preserve prefix caching.
 *
 * References:
 *   - compaction-strategy.md (Layer 1: Tool Result Trimming)
 *   - phase-5-compaction.md (5.2)
 */

import type { AgentMessage } from '../context-manager.js';
import type { MicrocompactionConfig, ToolCategory } from '../types.js';
import { estimateTokens } from '../token-estimator.js';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const MICROCOMPACTION_DEFAULTS: MicrocompactionConfig = {
  maxResultTokens: 50_000,
  softTrimThreshold: 0.40,
  hardClearThreshold: 0.60,
  bookendSize: 2_000,
  preserveRecentTurns: 5,
  extendedRetentionMultiplier: 2,
};

/**
 * The three threshold levels at which batch re-evaluation fires.
 * 40% = soft trim, 50% = advance to placeholder, 60% = hard clear.
 */
const THRESHOLD_LEVELS = [0.40, 0.50, 0.60] as const;

// ---------------------------------------------------------------------------
// Tool category defaults
// ---------------------------------------------------------------------------

/**
 * Default tool categories for built-in tools.
 * Consumers can override and extend via config.toolCategories.
 */
const DEFAULT_TOOL_CATEGORIES: Record<string, ToolCategory> = {
  Read: 'rereadable',
  Glob: 'rereadable',
  Grep: 'rereadable',
  WebFetch: 'non-reproducible',
  Bash: 'non-reproducible',
  SubAgent: 'ephemeral',
  TaskOutput: 'ephemeral',
};

// ---------------------------------------------------------------------------
// Trim state cache
// ---------------------------------------------------------------------------

/**
 * Trim instruction for a single tool result message.
 * Describes how to transform the message content for the LLM context.
 */
export type TrimAction =
  | { kind: 'full' }
  | { kind: 'bookend'; headChars: number; tailChars: number; originalTokens: number }
  | { kind: 'placeholder'; toolName: string; preview: string }
  | { kind: 'clear' };

/**
 * Cached trim state: maps message index (in the conversation history region)
 * to the trim action that should be applied. Only includes entries for
 * tool_result messages that need transformation.
 */
export interface TrimState {
  /** The threshold level that produced this state (0.40, 0.50, or 0.60). */
  thresholdLevel: number;
  /** Map from conversation history index to trim action. */
  actions: Map<number, TrimAction>;
}

// ---------------------------------------------------------------------------
// Insertion-time cap (Tier 1)
// ---------------------------------------------------------------------------

/**
 * Cap a tool result at insertion time. If the result exceeds maxResultTokens,
 * truncate to head + tail bookend format.
 *
 * This runs at insertion, NOT in transformContext. The truncated result is
 * stored in conversation history.
 *
 * @param content - The tool result content string
 * @param config - Microcompaction config (only maxResultTokens and bookendSize used)
 * @returns The potentially truncated content
 */
export function capToolResult(
  content: string,
  config: Pick<MicrocompactionConfig, 'maxResultTokens' | 'bookendSize'>,
): string {
  const tokens = estimateTokens(content);
  if (tokens <= config.maxResultTokens) {
    return content;
  }

  const headSize = config.bookendSize;
  const tailSize = config.bookendSize;

  // Ensure we don't exceed the content length
  if (headSize + tailSize >= content.length) {
    return content;
  }

  const head = content.slice(0, headSize);
  const tail = content.slice(-tailSize);
  const trimmedTokens = tokens - estimateTokens(head) - estimateTokens(tail);

  return `${head}\n\n... [~${trimmedTokens} tokens trimmed at insertion] ...\n\n${tail}`;
}

// ---------------------------------------------------------------------------
// Content extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extract the text content from a message's content field.
 * Handles both string content and content arrays.
 * For content arrays, extracts text from 'text' parts and also from
 * 'tool_result' parts that have a 'text' field (which is where
 * pi-agent-core stores tool output).
 */
export function extractTextContent(message: AgentMessage): string {
  if (typeof message.content === 'string') {
    return message.content;
  }

  // Guard: content may be undefined/null (corrupted toolResult) or empty
  if (!Array.isArray(message.content) || message.content.length === 0) {
    return '';
  }

  return message.content
    .filter(part => typeof part.text === 'string')
    .map(part => part.text as string)
    .join('');
}

/**
 * Check if a message is a tool result.
 * Pi-agent-core stores tool results as messages with content arrays
 * containing tool_result type parts.
 */
export function isToolResultMessage(message: AgentMessage): boolean {
  if (!Array.isArray(message.content)) {
    return false;
  }
  return message.content.some(part => part.type === 'tool_result');
}

/**
 * Check if a message contains a tool use (tool call from the assistant).
 */
export function isToolUseMessage(message: AgentMessage): boolean {
  if (message.role !== 'assistant') {
    return false;
  }
  if (!Array.isArray(message.content)) {
    return false;
  }
  return message.content.some(part => part.type === 'tool_use');
}

/**
 * Extract the tool name from a tool result or tool use message.
 * Returns null if the message is not a tool-related message.
 */
export function extractToolName(message: AgentMessage): string | null {
  if (!Array.isArray(message.content)) {
    return null;
  }

  for (const part of message.content) {
    if (part.type === 'tool_use' && typeof part['name'] === 'string') {
      return part['name'];
    }
    if (part.type === 'tool_result' && typeof part['name'] === 'string') {
      return part['name'];
    }
  }

  return null;
}

/**
 * Get the effective tool category for a tool name.
 */
export function getToolCategory(
  toolName: string,
  customCategories?: Record<string, ToolCategory>,
): ToolCategory | undefined {
  // Custom categories take precedence
  if (customCategories?.[toolName]) {
    return customCategories[toolName];
  }
  return DEFAULT_TOOL_CATEGORIES[toolName];
}

// ---------------------------------------------------------------------------
// Threshold-triggered batch processing (Tier 2-4)
// ---------------------------------------------------------------------------

/**
 * Count the number of assistant turns in conversation history.
 * Used to determine recency windows.
 */
function countAssistantTurns(history: AgentMessage[]): number {
  return history.filter(m => m.role === 'assistant').length;
}

/**
 * Get the assistant turn index for each message in conversation history.
 * Returns an array parallel to history where each entry is the 0-based
 * assistant turn number (counting from the end).
 * For non-assistant messages, returns the turn number of the nearest
 * preceding assistant message.
 */
function getAssistantTurnDistances(history: AgentMessage[]): number[] {
  const totalTurns = countAssistantTurns(history);
  const distances = new Array<number>(history.length).fill(totalTurns);
  let currentTurn = 0;

  for (let i = 0; i < history.length; i++) {
    if (history[i]!.role === 'assistant') {
      currentTurn++;
    }
    // Distance from end = totalTurns - currentTurn
    distances[i] = totalTurns - currentTurn;
  }

  return distances;
}

/**
 * Determine the trim action for a tool result based on its distance
 * from the current turn and the current threshold level.
 */
function determineTrimAction(
  message: AgentMessage,
  distanceFromEnd: number,
  thresholdIndex: number,
  config: MicrocompactionConfig,
): TrimAction {
  const toolName = extractToolName(message);
  const category = toolName ? getToolCategory(toolName, config.toolCategories) : undefined;

  // Determine the recency window for this tool category
  const baseWindow = config.preserveRecentTurns;
  const retentionWindow = (category === 'non-reproducible')
    ? baseWindow * config.extendedRetentionMultiplier
    : baseWindow;

  // Recent turns are always preserved
  if (distanceFromEnd < retentionWindow) {
    return { kind: 'full' };
  }

  const content = extractTextContent(message);

  // Threshold 0 (40%): soft trim to bookend
  if (thresholdIndex === 0) {
    if (category === 'rereadable' || category === 'ephemeral' || category === 'computational' || !category) {
      const tokens = estimateTokens(content);
      return {
        kind: 'bookend',
        headChars: config.bookendSize,
        tailChars: config.bookendSize,
        originalTokens: tokens,
      };
    }
    // Non-reproducible gets more time at 40%
    if (distanceFromEnd >= retentionWindow) {
      const tokens = estimateTokens(content);
      return {
        kind: 'bookend',
        headChars: config.bookendSize,
        tailChars: config.bookendSize,
        originalTokens: tokens,
      };
    }
    return { kind: 'full' };
  }

  // Threshold 1 (50%): advance bookend to placeholder
  if (thresholdIndex === 1) {
    if (category === 'non-reproducible' && distanceFromEnd < retentionWindow * 2) {
      // Non-reproducible still gets bookend at 50% if within extended window
      const tokens = estimateTokens(content);
      return {
        kind: 'bookend',
        headChars: config.bookendSize,
        tailChars: config.bookendSize,
        originalTokens: tokens,
      };
    }
    const preview = content.slice(0, 80).replace(/\n/g, ' ').trim();
    return {
      kind: 'placeholder',
      toolName: toolName ?? 'unknown',
      preview,
    };
  }

  // Threshold 2 (60%): hard clear
  // Clear rereadable entirely, clear ephemeral, keep non-reproducible in bookend
  if (category === 'non-reproducible') {
    const tokens = estimateTokens(content);
    return {
      kind: 'bookend',
      headChars: config.bookendSize,
      tailChars: config.bookendSize,
      originalTokens: tokens,
    };
  }

  if (category === 'rereadable' || category === 'ephemeral') {
    return { kind: 'clear' };
  }

  // Default: placeholder for unknown tools at 60%
  const preview = content.slice(0, 80).replace(/\n/g, ' ').trim();
  return {
    kind: 'placeholder',
    toolName: toolName ?? 'unknown',
    preview,
  };
}

/**
 * Compute the full trim state for conversation history at a given threshold.
 */
export function computeTrimState(
  history: AgentMessage[],
  thresholdIndex: number,
  config: MicrocompactionConfig,
): TrimState {
  const distances = getAssistantTurnDistances(history);
  const actions = new Map<number, TrimAction>();

  for (let i = 0; i < history.length; i++) {
    const message = history[i]!;

    // Only trim tool result messages
    if (!isToolResultMessage(message)) {
      continue;
    }

    const action = determineTrimAction(message, distances[i]!, thresholdIndex, config);

    // Only store non-full actions (full means no transformation needed)
    if (action.kind !== 'full') {
      actions.set(i, action);
    }
  }

  return {
    thresholdLevel: THRESHOLD_LEVELS[thresholdIndex] ?? 0,
    actions,
  };
}

/**
 * Apply a bookend trim to content.
 */
export function applyBookend(
  content: string,
  headChars: number,
  tailChars: number,
  originalTokens: number,
): string {
  if (headChars + tailChars >= content.length) {
    return content;
  }

  const head = content.slice(0, headChars);
  const tail = content.slice(-tailChars);
  const trimmedTokens = originalTokens - estimateTokens(head) - estimateTokens(tail);

  return `${head}\n\n... [~${trimmedTokens} tokens trimmed] ...\n\n${tail}`;
}

/**
 * Apply a trim action to a message, returning a new message.
 */
export function applyTrimAction(message: AgentMessage, action: TrimAction): AgentMessage {
  if (action.kind === 'full') {
    return message;
  }

  const content = extractTextContent(message);

  if (action.kind === 'bookend') {
    const trimmed = applyBookend(content, action.headChars, action.tailChars, action.originalTokens);
    return { role: message.role, content: trimmed };
  }

  if (action.kind === 'placeholder') {
    const placeholder = `[Tool result trimmed -- ${action.toolName}: "${action.preview}" -- see assistant response below for findings]`;
    return { role: message.role, content: placeholder };
  }

  if (action.kind === 'clear') {
    return { role: message.role, content: '[Tool result cleared]' };
  }

  return message;
}

/**
 * Determine which threshold level is active based on context usage ratio.
 * Returns -1 if below all thresholds (no trimming needed).
 */
export function getActiveThresholdIndex(usageRatio: number, config: MicrocompactionConfig): number {
  if (usageRatio >= config.hardClearThreshold) {
    return 2;
  }
  // Use the midpoint between soft and hard as the 50% threshold
  const midThreshold = (config.softTrimThreshold + config.hardClearThreshold) / 2;
  if (usageRatio >= midThreshold) {
    return 1;
  }
  if (usageRatio >= config.softTrimThreshold) {
    return 0;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// MicrocompactionEngine
// ---------------------------------------------------------------------------

/**
 * Stateful engine for microcompaction. Caches trim state between threshold
 * crossings to preserve prefix cache optimization.
 */
export class MicrocompactionEngine {
  private readonly config: MicrocompactionConfig;
  private cachedState: TrimState | null = null;

  constructor(config: Partial<MicrocompactionConfig> = {}) {
    this.config = { ...MICROCOMPACTION_DEFAULTS, ...config };
  }

  /**
   * Whether a persist callback is configured.
   */
  get hasPersistCallback(): boolean {
    return typeof this.config.persistResult === 'function';
  }

  /**
   * Get the current config (for testing/inspection).
   */
  getConfig(): MicrocompactionConfig {
    return this.config;
  }

  /**
   * Cap a tool result at insertion time.
   */
  capAtInsertion(content: string): string {
    return capToolResult(content, this.config);
  }

  /**
   * Apply microcompaction to conversation history messages.
   * Called inside transformContext. Returns a new array; never modifies the input.
   *
   * When a persistResult callback is configured, non-reproducible and computational
   * tool results that are being cleared or replaced with a placeholder will be
   * persisted to disk first, and the replacement text will include the file path
   * so the agent can Read the content back if needed.
   *
   * @param history - Conversation history messages (post-slot region)
   * @param contextWindow - Total context window size in tokens
   * @param currentTokens - Current estimated token count
   * @returns Potentially trimmed conversation history
   */
  async apply(
    history: AgentMessage[],
    contextWindow: number,
    currentTokens: number,
  ): Promise<AgentMessage[]> {
    if (contextWindow <= 0 || history.length === 0) {
      return history;
    }

    const usageRatio = currentTokens / contextWindow;
    const thresholdIndex = getActiveThresholdIndex(usageRatio, this.config);

    // Below all thresholds: return untouched
    if (thresholdIndex < 0) {
      return history;
    }

    // Check if we need to recompute or can replay cached state
    const needRecompute = !this.cachedState
      || this.cachedState.thresholdLevel < (THRESHOLD_LEVELS[thresholdIndex] ?? 0);

    if (needRecompute) {
      this.cachedState = computeTrimState(history, thresholdIndex, this.config);
    }

    // Apply cached actions
    if (!this.cachedState || this.cachedState.actions.size === 0) {
      return history;
    }

    const result: AgentMessage[] = [];
    for (let i = 0; i < history.length; i++) {
      const action = this.cachedState.actions.get(i);
      if (action) {
        const persisted = await this.maybePersistBeforeTrim(history[i]!, action, i);
        result.push(persisted);
      } else {
        result.push(history[i]!);
      }
    }

    return result;
  }

  /**
   * If a persistResult callback is configured and the action is clearing a
   * non-reproducible or computational result, persist the original content
   * to disk and return a message with the file path reference.
   * Otherwise, apply the standard trim action.
   */
  private async maybePersistBeforeTrim(
    message: AgentMessage,
    action: TrimAction,
    messageIndex: number,
  ): Promise<AgentMessage> {
    // Only persist for destructive actions (placeholder/clear), not bookend/full
    if (action.kind !== 'placeholder' && action.kind !== 'clear') {
      return applyTrimAction(message, action);
    }

    // Only persist if callback exists
    if (!this.config.persistResult) {
      return applyTrimAction(message, action);
    }

    // Only persist non-reproducible and computational results
    const toolName = extractToolName(message);
    const category = toolName ? getToolCategory(toolName, this.config.toolCategories) : undefined;
    if (category !== 'non-reproducible' && category !== 'computational') {
      return applyTrimAction(message, action);
    }

    // Persist the original content to disk
    const content = extractTextContent(message);
    try {
      const path = await this.config.persistResult(content, {
        toolName: toolName ?? 'unknown',
        messageIndex,
        category,
      });

      const preview = content.slice(0, 80).replace(/\n/g, ' ').trim();
      const persistedText = `[Tool result persisted -- ${toolName ?? 'unknown'}: "${preview}" -- use Read on ${path} for full content]`;
      return { role: message.role, content: persistedText };
    } catch {
      // Persist failed, fall back to standard trim
      return applyTrimAction(message, action);
    }
  }

  /**
   * Reset the cached trim state. Called after Layer 2 compaction
   * replaces conversation history.
   */
  resetCache(): void {
    this.cachedState = null;
  }

  /**
   * Get the cached state (for testing/inspection).
   */
  getCachedState(): TrimState | null {
    return this.cachedState;
  }
}
