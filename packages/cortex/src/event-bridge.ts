/**
 * Event bridge: maps pi-agent-core events to normalized consumer events.
 *
 * Pi-agent-core emits 10 events across 4 scopes (agent, turn, message, tool).
 * The event bridge normalizes these into a consumer-facing event stream for
 * logging, monitoring, and lifecycle hooks.
 *
 * Key mappings:
 *   agent_start  -> session_start
 *   agent_end    -> session_end (onLoopComplete fires here)
 *   turn_start   -> turn_start
 *   turn_end     -> turn_end + AgentTextOutput (parse working tags)
 *   message_start  -> response_start
 *   message_update -> response_chunk
 *   message_end    -> response_end
 *   tool_execution_start -> tool_call_start
 *   tool_execution_update -> (dropped)
 *   tool_execution_end   -> tool_call_end
 *
 * Reference: cortex-architecture.md (Event Bridge section)
 */

import type { AgentTextOutput } from './types.js';
import { parseWorkingTags } from './working-tags.js';

// ---------------------------------------------------------------------------
// Normalized event types emitted to consumers
// ---------------------------------------------------------------------------

export type CortexEventType =
  | 'session_start'
  | 'session_end'
  | 'turn_start'
  | 'turn_end'
  | 'response_start'
  | 'response_chunk'
  | 'response_end'
  | 'tool_call_start'
  | 'tool_call_end';

/**
 * Normalized event data emitted by the event bridge.
 */
export interface CortexEvent {
  type: CortexEventType;
  /** The original pi-agent-core event data (opaque to the bridge). */
  data?: unknown;
  /** Parsed text output, present only for turn_end events. */
  textOutput?: AgentTextOutput;
}

/**
 * Callback type for event listeners.
 */
export type CortexEventListener = (event: CortexEvent) => void;

// ---------------------------------------------------------------------------
// Pi-agent-core event types (minimal contract, no runtime dependency)
// ---------------------------------------------------------------------------

export type PiEventType =
  | 'agent_start'
  | 'agent_end'
  | 'turn_start'
  | 'turn_end'
  | 'message_start'
  | 'message_update'
  | 'message_end'
  | 'tool_execution_start'
  | 'tool_execution_update'
  | 'tool_execution_end';

export interface PiEvent {
  type: PiEventType;
  [key: string]: unknown;
}

/**
 * Minimal interface for pi-agent-core's Agent.subscribe().
 * Returns an unsubscribe function.
 */
export interface PiEventSource {
  subscribe(handler: (event: PiEvent) => void): () => void;
}

// ---------------------------------------------------------------------------
// Event type mapping
// ---------------------------------------------------------------------------

const PI_TO_CORTEX_MAP: Partial<Record<PiEventType, CortexEventType>> = {
  agent_start: 'session_start',
  agent_end: 'session_end',
  turn_start: 'turn_start',
  turn_end: 'turn_end',
  message_start: 'response_start',
  message_update: 'response_chunk',
  message_end: 'response_end',
  tool_execution_start: 'tool_call_start',
  // tool_execution_update is dropped (no mapping)
  tool_execution_end: 'tool_call_end',
};

// ---------------------------------------------------------------------------
// EventBridge
// ---------------------------------------------------------------------------

export class EventBridge {
  private readonly listeners = new Map<CortexEventType, Set<CortexEventListener>>();
  private readonly allListeners = new Set<CortexEventListener>();
  private unsubscribeFromPi: (() => void) | null = null;
  private workingTagsEnabled: boolean;

  /**
   * Create an EventBridge.
   *
   * @param workingTagsEnabled - Whether to parse working tags on turn_end
   */
  constructor(workingTagsEnabled = true) {
    this.workingTagsEnabled = workingTagsEnabled;
  }

  /**
   * Wire the bridge to a pi-agent-core Agent's event stream.
   * Stores the unsubscribe function for cleanup.
   *
   * @param source - The pi-agent-core Agent (or any PiEventSource)
   */
  wire(source: PiEventSource): void {
    // Clean up previous wiring if any
    this.unwire();

    this.unsubscribeFromPi = source.subscribe((piEvent: PiEvent) => {
      this.handlePiEvent(piEvent);
    });
  }

  /**
   * Disconnect from the pi-agent-core event stream.
   */
  unwire(): void {
    if (this.unsubscribeFromPi) {
      this.unsubscribeFromPi();
      this.unsubscribeFromPi = null;
    }
  }

  /**
   * Register a listener for a specific event type.
   *
   * @param type - The event type to listen for
   * @param listener - The callback function
   * @returns An unsubscribe function
   */
  on(type: CortexEventType, listener: CortexEventListener): () => void {
    let typeListeners = this.listeners.get(type);
    if (!typeListeners) {
      typeListeners = new Set();
      this.listeners.set(type, typeListeners);
    }
    typeListeners.add(listener);

    return () => {
      typeListeners!.delete(listener);
    };
  }

  /**
   * Register a listener for all event types.
   *
   * @param listener - The callback function
   * @returns An unsubscribe function
   */
  onAll(listener: CortexEventListener): () => void {
    this.allListeners.add(listener);
    return () => {
      this.allListeners.delete(listener);
    };
  }

  /**
   * Update whether working tags parsing is enabled.
   */
  setWorkingTagsEnabled(enabled: boolean): void {
    this.workingTagsEnabled = enabled;
  }

  /**
   * Clean up all listeners and disconnect from the pi-agent-core event stream.
   */
  destroy(): void {
    this.unwire();
    this.listeners.clear();
    this.allListeners.clear();
  }

  /**
   * Handle a pi-agent-core event by mapping and emitting to consumers.
   */
  private handlePiEvent(piEvent: PiEvent): void {
    const cortexType = PI_TO_CORTEX_MAP[piEvent.type];
    if (!cortexType) {
      // Unmapped event (e.g., tool_execution_update) is dropped
      return;
    }

    const cortexEvent: CortexEvent = {
      type: cortexType,
      data: piEvent,
    };

    // For turn_end, parse working tags from the turn's text content
    if (cortexType === 'turn_end' && this.workingTagsEnabled) {
      const text = this.extractTurnText(piEvent);
      if (text) {
        cortexEvent.textOutput = parseWorkingTags(text);
      }
    }

    this.emit(cortexEvent);
  }

  /**
   * Extract the text content from a turn_end event.
   * Pi-agent-core's turn_end event carries the assistant message for that turn.
   */
  private extractTurnText(piEvent: PiEvent): string | null {
    // The turn_end event from pi-agent-core carries the assistant message.
    // The structure varies, so we try multiple access patterns.

    // Pattern 1: Direct text property
    if (typeof piEvent['text'] === 'string') {
      return piEvent['text'];
    }

    // Pattern 2: message.content as string
    const message = piEvent['message'] as Record<string, unknown> | undefined;
    if (message && typeof message['content'] === 'string') {
      return message['content'];
    }

    // Pattern 3: message.content as array with text parts
    if (message && Array.isArray(message['content'])) {
      const textParts = (message['content'] as Array<{ type: string; text?: string }>)
        .filter((part) => part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text!);
      if (textParts.length > 0) {
        return textParts.join('');
      }
    }

    // Pattern 4: result.content
    const result = piEvent['result'] as Record<string, unknown> | undefined;
    if (result && typeof result['content'] === 'string') {
      return result['content'];
    }

    // Pattern 5: content on the content parts of the result
    if (result && Array.isArray(result['content'])) {
      const textParts = (result['content'] as Array<{ type: string; text?: string }>)
        .filter((part) => part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text!);
      if (textParts.length > 0) {
        return textParts.join('');
      }
    }

    return null;
  }

  /**
   * Emit a normalized event to all matching listeners.
   * Each listener is wrapped in try/catch so a throwing listener
   * does not prevent subsequent listeners from receiving the event.
   */
  private emit(event: CortexEvent): void {
    // Notify type-specific listeners
    const typeListeners = this.listeners.get(event.type);
    if (typeListeners) {
      for (const listener of typeListeners) {
        try {
          listener(event);
        } catch {
          // Swallow listener errors to prevent cascading failures
        }
      }
    }

    // Notify catch-all listeners
    for (const listener of this.allListeners) {
      try {
        listener(event);
      } catch {
        // Swallow listener errors to prevent cascading failures
      }
    }
  }
}
