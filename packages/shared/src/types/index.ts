/**
 * Shared TypeScript types for Animus
 */

// ============================================================================
// Core Types
// ============================================================================

/** Unique identifier type */
export type UUID = string;

/** ISO 8601 timestamp string */
export type Timestamp = string;

// ============================================================================
// User & Auth Types
// ============================================================================

export interface User {
  id: UUID;
  email: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Session {
  id: UUID;
  userId: UUID;
  expiresAt: Timestamp;
  createdAt: Timestamp;
}

// ============================================================================
// Heartbeat Types
// ============================================================================

/** The current phase of a heartbeat tick */
export type HeartbeatPhase =
  | 'idle'
  | 'perceive'
  | 'think'
  | 'feel'
  | 'decide'
  | 'act'
  | 'reflect'
  | 'consolidate';

export interface HeartbeatState {
  tickNumber: number;
  currentPhase: HeartbeatPhase;
  pipelineProgress: HeartbeatPhase[];
  startedAt: Timestamp;
  lastTickAt: Timestamp | null;
  isRunning: boolean;
}

export interface Thought {
  id: UUID;
  tickNumber: number;
  content: string;
  type: 'observation' | 'reflection' | 'intention' | 'question' | 'insight';
  createdAt: Timestamp;
  expiresAt: Timestamp | null;
}

export interface Experience {
  id: UUID;
  tickNumber: number;
  description: string;
  emotionalValence: number; // -1 to 1
  salience: number; // 0 to 1
  createdAt: Timestamp;
  expiresAt: Timestamp | null;
}

export interface Emotion {
  id: UUID;
  tickNumber: number;
  name: string;
  intensity: number; // 0 to 1
  createdAt: Timestamp;
  expiresAt: Timestamp | null;
}

export interface Task {
  id: UUID;
  title: string;
  description: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  createdAt: Timestamp;
  updatedAt: Timestamp;
  dueAt: Timestamp | null;
  completedAt: Timestamp | null;
}

// ============================================================================
// Agent Types
// ============================================================================

/** Supported agent SDK providers */
export type AgentProvider = 'claude' | 'codex' | 'opencode';

export interface AgentSession {
  id: UUID;
  provider: AgentProvider;
  startedAt: Timestamp;
  endedAt: Timestamp | null;
  status: 'active' | 'completed' | 'error' | 'cancelled';
}

export interface AgentEvent {
  id: UUID;
  sessionId: UUID;
  eventType: AgentEventType;
  data: Record<string, unknown>;
  createdAt: Timestamp;
}

export type AgentEventType =
  | 'session_start'
  | 'session_end'
  | 'input_received'
  | 'thinking_start'
  | 'thinking_end'
  | 'tool_call_start'
  | 'tool_call_end'
  | 'tool_error'
  | 'response_start'
  | 'response_chunk'
  | 'response_end'
  | 'error';

export interface AgentUsage {
  sessionId: UUID;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number | null;
  model: string;
  createdAt: Timestamp;
}

// ============================================================================
// Settings Types
// ============================================================================

export interface SystemSettings {
  heartbeatIntervalMs: number;
  thoughtRetentionDays: number;
  experienceRetentionDays: number;
  emotionRetentionDays: number;
  agentLogRetentionDays: number;
  defaultAgentProvider: AgentProvider;
}

export interface PersonalitySettings {
  name: string;
  traits: string[];
  communicationStyle: string;
  values: string[];
}

// ============================================================================
// API Types
// ============================================================================

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}
