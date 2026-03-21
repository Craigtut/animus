/**
 * ContextManager: slot-based persistent context + ephemeral per-call injection.
 *
 * Manages the content an agent sees through two mechanisms:
 * - **Slots**: Named content blocks at the start of the message array.
 *   Persistent, updated immediately via setSlot(). Ordered by stability
 *   (most stable first) for prefix cache optimization.
 * - **Ephemeral context**: Per-call content injected via transformContext.
 *   Never stored in agent.state.messages. Rebuilt every LLM call.
 *
 * Message array layout:
 *   [SLOT REGION (0..N-1)] [CONVERSATION HISTORY] [EPHEMERAL (in transformContext)] [PROMPT]
 *
 * Reference: context-manager.md
 */

import type { ContextManagerConfig } from './types.js';

// ---------------------------------------------------------------------------
// Minimal pi-agent-core type contracts (no runtime dependency)
// ---------------------------------------------------------------------------

/**
 * Minimal interface for pi-agent-core's Agent.state.messages entries.
 * The actual type is Message from @mariozechner/pi-ai, but we define
 * only what we need to avoid a hard dependency.
 */
export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
}

/**
 * Minimal interface for pi-agent-core's Agent to access state.messages.
 * We only need to read and write the messages array.
 */
export interface AgentStateAccessor {
  state: {
    messages: AgentMessage[];
    systemPrompt?: string;
    model?: unknown;
    thinkingLevel?: string;
    tools?: unknown[];
    error?: string;
  };
}

/**
 * The context object passed to transformContext hooks.
 * Mirrors pi-agent-core's AgentContext shape.
 */
export interface AgentContext {
  systemPrompt: string;
  model: unknown;
  messages: AgentMessage[];
  tools: unknown[];
  thinkingLevel: string;
}

// ---------------------------------------------------------------------------
// ContextManager
// ---------------------------------------------------------------------------

export class ContextManager {
  private readonly agent: AgentStateAccessor;
  private readonly slotNames: readonly string[];
  private readonly slotIndexMap: ReadonlyMap<string, number>;
  private ephemeralContent: string | null = null;

  /**
   * Create a ContextManager.
   *
   * @param agent - The pi-agent-core Agent instance (or any object with state.messages)
   * @param config - Configuration with ordered slot names
   */
  constructor(agent: AgentStateAccessor, config: ContextManagerConfig) {
    this.agent = agent;
    this.slotNames = Object.freeze([...config.slots]);

    // Build index map: slot name -> position in messages array
    const indexMap = new Map<string, number>();
    for (let i = 0; i < config.slots.length; i++) {
      const name = config.slots[i]!;
      if (indexMap.has(name)) {
        throw new Error(`Duplicate slot name: "${name}"`);
      }
      indexMap.set(name, i);
    }
    this.slotIndexMap = indexMap;

    // Initialize slot positions in the messages array with empty user-role messages.
    // This ensures the array has the correct length from the start.
    this.initializeSlots();
  }

  /**
   * The number of context slots.
   */
  get slotCount(): number {
    return this.slotNames.length;
  }

  /**
   * The ordered slot names (frozen copy).
   */
  get slots(): readonly string[] {
    return this.slotNames;
  }

  /**
   * Update a slot's content. Immediately updates the corresponding
   * message in agent.state.messages at the slot's position.
   *
   * @param name - The slot name (must match a name from the config)
   * @param content - The raw string content (consumer handles formatting)
   * @throws Error if the slot name is not recognized
   */
  setSlot(name: string, content: string): void {
    const index = this.slotIndexMap.get(name);
    if (index === undefined) {
      throw new Error(`Unknown slot name: "${name}". Valid slots: ${[...this.slotIndexMap.keys()].join(', ')}`);
    }

    this.agent.state.messages[index] = {
      role: 'user',
      content,
    };
  }

  /**
   * Read current slot content.
   *
   * @param name - The slot name
   * @returns The slot's content string, or null if the slot has not been set
   * @throws Error if the slot name is not recognized
   */
  getSlot(name: string): string | null {
    const index = this.slotIndexMap.get(name);
    if (index === undefined) {
      throw new Error(`Unknown slot name: "${name}". Valid slots: ${[...this.slotIndexMap.keys()].join(', ')}`);
    }

    const message = this.agent.state.messages[index];
    if (!message) {
      return null;
    }

    // Content can be a string or a content array
    if (typeof message.content === 'string') {
      return message.content;
    }

    // For content arrays, concatenate text parts
    return message.content
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('');
  }

  /**
   * Set ephemeral content for the next LLM call(s).
   * Injected at the end of the message array inside the transformContext hook.
   * Never written to agent.state.messages.
   * Pass null to clear.
   *
   * @param content - The ephemeral content string, or null to clear
   */
  setEphemeral(content: string | null): void {
    this.ephemeralContent = content;
  }

  /**
   * Get the current ephemeral content.
   *
   * @returns The ephemeral content, or null if not set
   */
  getEphemeral(): string | null {
    return this.ephemeralContent;
  }

  /**
   * Returns a transformContext hook function that appends ephemeral content.
   *
   * The hook is composable: the consumer can chain it with other transformContext
   * logic (compaction, skill buffer, etc.).
   *
   * The ephemeral content is appended as a user-role message at the end of
   * the messages array, after all conversation history but before the prompt.
   * This placement ensures it does not invalidate the prefix cache for
   * content above it.
   *
   * @returns A function suitable for use as a transformContext hook
   */
  getTransformContextHook(): (context: AgentContext) => AgentContext {
    return (context: AgentContext): AgentContext => {
      if (this.ephemeralContent === null) {
        return context;
      }

      // Append ephemeral content as a user-role message at the end
      return {
        ...context,
        messages: [
          ...context.messages,
          {
            role: 'user' as const,
            content: this.ephemeralContent,
          },
        ],
      };
    };
  }

  /**
   * Initialize slot positions with empty user-role messages.
   * Ensures the messages array has the correct length from construction.
   */
  private initializeSlots(): void {
    // Ensure the messages array exists and has at least slotCount entries
    while (this.agent.state.messages.length < this.slotNames.length) {
      this.agent.state.messages.push({
        role: 'user',
        content: '',
      });
    }
  }
}
