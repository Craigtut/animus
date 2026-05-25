import type { PhaseUsage, PhaseContextSnapshot } from '@animus-labs/shared';

// ============================================================================
// Raw timeline event (from backend)
// ============================================================================

export interface TimelineEvent {
  id: string;
  sessionId?: string;
  eventType: string;
  data: Record<string, unknown>;
  createdAt: string;
  relativeMs: number;
}

// ============================================================================
// Tick data (normalized from tRPC response)
// ============================================================================

export interface TickResults {
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

export interface TickUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd: number | null;
}

export interface TickTimeline {
  tickNumber: number;
  sessionId: string;
  triggerType: string;
  isComplete: boolean;
  durationMs: number | null;
  createdAt: string;
  events: TimelineEvent[];
  results: TickResults | null;
  usage: TickUsage | null;
  phaseUsage: PhaseUsage[];
  contextWindow: number | null;
  phaseSnapshots: PhaseContextSnapshot[];
}

// ============================================================================
// Phase grouping
// ============================================================================

export type PhaseName = 'gather' | 'thought' | 'agentic_loop' | 'reflect' | 'execute';
export type PhaseStatus = 'pending' | 'running' | 'complete' | 'failed' | 'skipped';

export interface PhaseGroup {
  name: PhaseName;
  label: string;
  startMs: number | null;
  endMs: number | null;
  durationMs: number | null;
  status: PhaseStatus;
  events: TimelineEvent[];
  /** Only populated for the agentic_loop phase */
  turns?: AgenticTurn[];
  /** Per-phase usage from PhaseUsage records (if available) */
  usage?: PhaseUsage;
}

// ============================================================================
// Agentic loop turns
// ============================================================================

export interface AgenticTurn {
  turnNumber: number;
  startMs: number;
  endMs: number | null;
  durationMs: number | null;
  /** Non-cached input tokens (from pi-ai usage.input) */
  inputTokens: number | null;
  /** Output tokens */
  outputTokens: number | null;
  /** Cache read tokens (from pi-ai usage.cacheRead) */
  cacheReadTokens: number | null;
  /** Cache write tokens (from pi-ai usage.cacheWrite) */
  cacheWriteTokens: number | null;
  /** Total tokens (from pi-ai usage.totalTokens) */
  totalTokens: number | null;
  cost: number | null;
  model: string | null;
  stopReason: string | null;
  /** Merged events within this turn (tool uses, responses, etc.) */
  mergedEvents: MergedEvent[];
  /** Compaction events that occurred after this turn (before the next) */
  compactionAfter: MergedEvent[];
}

// ============================================================================
// Merged events (collapsed start/end pairs)
// ============================================================================

export type MergedEventKind = 'tool_use' | 'response' | 'compaction' | 'event';

export interface MergedEvent {
  kind: MergedEventKind;
  startMs: number;
  endMs: number | null;
  durationMs: number | null;
  /** For tool_use */
  toolName?: string | undefined;
  toolInput?: Record<string, unknown> | undefined;
  toolOutput?: unknown;
  isError?: boolean | undefined;
  /** For response */
  content?: string | undefined;
  finishReason?: string | undefined;
  /** For compaction */
  tokensBefore?: number | undefined;
  tokensAfter?: number | undefined;
  turnsCompacted?: number | undefined;
  messagesCompacted?: number | undefined;
  observationTokens?: number | undefined;
  compactionType?: 'compaction' | 'microcompaction' | 'emergency_truncation' | 'observation' | 'reflection' | undefined;
  /** The raw event(s) this was merged from (for expand-to-detail) */
  rawEvents: TimelineEvent[];
}

// ============================================================================
// Phase metadata
// ============================================================================

export const PHASE_ORDER: PhaseName[] = ['gather', 'thought', 'agentic_loop', 'reflect', 'execute'];

export const PHASE_LABELS: Record<PhaseName, string> = {
  gather: 'Gather',
  thought: 'Thought',
  agentic_loop: 'Agentic Loop',
  reflect: 'Reflect',
  execute: 'Execute',
};
