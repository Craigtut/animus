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
  contactId: UUID | null;
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
  importance: number; // 0 to 1
  createdAt: Timestamp;
  expiresAt: Timestamp | null;
}

export interface Experience {
  id: UUID;
  tickNumber: number;
  content: string;
  importance: number; // 0 to 1
  createdAt: Timestamp;
  expiresAt: Timestamp | null;
}

/** The 12 fixed emotions */
export type EmotionName =
  | 'joy'
  | 'contentment'
  | 'excitement'
  | 'gratitude'
  | 'confidence'
  | 'stress'
  | 'anxiety'
  | 'frustration'
  | 'sadness'
  | 'boredom'
  | 'curiosity'
  | 'loneliness';

/** Emotion category for UI aggregation */
export type EmotionCategory = 'positive' | 'negative' | 'drive';

/** Current state of a single emotion */
export interface EmotionState {
  emotion: EmotionName;
  category: EmotionCategory;
  intensity: number; // 0 to 1
  baseline: number; // 0 to 1 (resting state, personality-driven)
  lastUpdatedAt: Timestamp;
}

/** Delta output from the mind during a tick */
export interface EmotionDelta {
  emotion: EmotionName;
  delta: number; // e.g., +0.05, -0.03
  reasoning: string;
}

/** Historical record of an emotion change */
export interface EmotionHistoryEntry {
  id: UUID;
  tickNumber: number;
  emotion: EmotionName;
  delta: number;
  reasoning: string;
  intensityBefore: number;
  intensityAfter: number;
  createdAt: Timestamp;
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
// Message & Channel Types
// ============================================================================

/** Supported communication channels */
export type ChannelType = 'web' | 'sms' | 'discord' | 'api';

/** Contact permission tier */
export type PermissionTier = 'primary' | 'standard';

/** Direction of a message */
export type MessageDirection = 'inbound' | 'outbound';

/** Who sent the message */
export type MessageSender = 'user' | 'animus' | 'sub_agent';

export interface Channel {
  id: UUID;
  type: ChannelType;
  name: string;
  config: Record<string, unknown>;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Conversation {
  id: UUID;
  channelId: UUID;
  title: string | null;
  startedAt: Timestamp;
  lastMessageAt: Timestamp;
  messageCount: number;
}

export interface Message {
  id: UUID;
  conversationId: UUID;
  direction: MessageDirection;
  sender: MessageSender;
  content: string;
  channelType: ChannelType;
  tickNumber: number | null;
  agentTaskId: UUID | null;
  metadata: Record<string, unknown> | null;
  createdAt: Timestamp;
}

// ============================================================================
// Contact Types
// ============================================================================

export interface Contact {
  id: UUID;
  fullName: string;
  phoneNumber: string | null;
  email: string | null;
  isPrimary: boolean;
  permissionTier: PermissionTier;
  notes: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ContactChannel {
  id: UUID;
  contactId: UUID;
  channel: ChannelType;
  identifier: string;
  displayName: string | null;
  isVerified: boolean;
  createdAt: Timestamp;
}

// ============================================================================
// Channel Adapter Types
// ============================================================================

/** Media attachment type */
export type MediaAttachmentType = 'image' | 'audio' | 'video' | 'file';

/** A media file downloaded and stored locally by the channel adapter */
export interface MediaAttachment {
  id: UUID;
  type: MediaAttachmentType;
  mimeType: string;
  localPath: string;
  originalFilename: string | null;
  sizeBytes: number;
}

/** Contact identity resolved during channel ingestion */
export interface ResolvedContact {
  id: UUID;
  fullName: string;
  permissionTier: PermissionTier;
}

/** Normalized message from any channel, ready for heartbeat pipeline */
export interface IncomingMessage {
  channel: ChannelType;
  channelIdentifier: string;
  contact: ResolvedContact | null;
  conversationId: string | null;
  content: string;
  media?: MediaAttachment[];
  rawMetadata: Record<string, unknown>;
  receivedAt: Timestamp;
}

// ============================================================================
// Channel Configuration Types
// ============================================================================

export interface SmsChannelConfig {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
  webhookUrl: string;
}

export interface DiscordChannelConfig {
  botToken: string;
  applicationId: string;
  allowedGuildIds: string[];
}

export interface OpenaiApiChannelConfig {
  // No credentials needed — maps to primary contact
}

export interface OllamaApiChannelConfig {
  // No credentials needed — maps to primary contact
}

/** Channel type identifier for config storage */
export type ChannelConfigType = 'sms' | 'discord' | 'openai_api' | 'ollama_api';

export interface ChannelConfig {
  id: UUID;
  channelType: ChannelConfigType;
  isEnabled: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
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
  emotionHistoryRetentionDays: number;
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
