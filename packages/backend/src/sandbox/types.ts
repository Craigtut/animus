/**
 * Sandbox TUI Types
 *
 * Discriminated unions for display items and state management
 * for the agent sandbox terminal UI.
 */

import type { AgentProvider } from '@animus-labs/shared';
import type { AgentEvent, SessionUsage, AgentCost } from '@animus-labs/agents';

// ============================================================================
// Display Items
// ============================================================================

export interface UserMessage {
  kind: 'user';
  text: string;
  timestamp: number;
}

export interface AgentMessage {
  kind: 'agent';
  text: string;
  timestamp: number;
  durationMs?: number | undefined;
  usage?: SessionUsage | undefined;
  cost?: AgentCost | undefined;
}

/** Intermediate turn text committed at turn boundaries (before tools, between turns). */
export interface TurnTextMessage {
  kind: 'turn_text';
  text: string;
  turnIndex: number;
  hasToolCalls: boolean;
  hasThinking: boolean;
  toolNames: string[];
  timestamp: number;
}

export interface EventItem {
  kind: 'event';
  event: AgentEvent;
  timestamp: number;
}

export interface SystemMessage {
  kind: 'system';
  text: string;
  timestamp: number;
}

export type DisplayItem = UserMessage | AgentMessage | TurnTextMessage | EventItem | SystemMessage;

// ============================================================================
// State
// ============================================================================

export interface SandboxState {
  provider: AgentProvider;
  model?: string | undefined;
  systemPrompt: string;
  showVerboseEvents: boolean;
  isStreaming: boolean;
  pluginsLoaded: number;
  sessionId?: string | undefined;
  cognitiveMode: boolean;
}

// ============================================================================
// CLI Args
// ============================================================================

export interface SandboxCliArgs {
  provider: AgentProvider;
  model?: string | undefined;
  systemPrompt: string;
  noPlugins: boolean;
  verbose: boolean;
  cognitive: boolean;
}
