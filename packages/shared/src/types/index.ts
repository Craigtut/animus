/**
 * TypeScript types derived from Zod schemas via z.infer<>.
 *
 * DO NOT define types manually here — derive them from schemas.
 * The schemas in /schemas/ are the single source of truth.
 */

import { z } from 'zod/v3';
import type {
  // Common
  uuidSchema,
  timestampSchema,
  channelTypeSchema,
  permissionTierSchema,
  agentProviderSchema,
  paginationInputSchema,
  // System
  userSchema,
  contactSchema,
  contactChannelSchema,
  systemSettingsSchema,
  onboardingStateSchema,
  existenceParadigmSchema,
  personalityDimensionsSchema,
  archetypeSchema,
  personaSchema,
  // Heartbeat
  heartbeatStageSchema,
  triggerTypeSchema,
  heartbeatStateSchema,
  emotionNameSchema,
  emotionCategorySchema,
  emotionStateSchema,
  emotionDeltaSchema,
  emotionHistoryEntrySchema,
  energyBandSchema,
  energyHistoryEntrySchema,
  thoughtSchema,
  experienceSchema,
  builtInDecisionTypeSchema,
  decisionTypeSchema,
  decisionOutcomeSchema,
  tickDecisionSchema,
  seedStatusSchema,
  seedSourceSchema,
  goalSeedSchema,
  goalOriginSchema,
  goalStatusSchema,
  goalSchema,
  planStatusSchema,
  milestoneStatusSchema,
  goalMilestoneEvidenceSchema,
  milestoneSchema,
  planSchema,
  goalEventSourceSchema,
  goalEventTypeSchema,
  goalEventSchema,
  goalSnapshotUpdatedBySchema,
  goalSnapshotSchema,
  goalReviewScopeSchema,
  goalReviewStatusSchema,
  goalReviewUrgencySchema,
  goalReviewRequestedBySchema,
  goalReviewRequestSchema,
  goalSalienceLogSchema,
  scheduleTypeSchema,
  taskStatusSchema,
  taskCreatedBySchema,
  taskSchema,
  taskJournalStatusSchema,
  taskJournalArtifactTypeSchema,
  taskJournalArtifactSchema,
  taskJournalSchema,
  taskJournalUpdateSchema,
  taskRunStatusSchema,
  taskRunSchema,
  agentTaskStatusSchema,
  agentTaskSchema,
  // Memory
  workingMemorySchema,
  coreSelfSchema,
  memoryTypeSchema,
  memorySourceTypeSchema,
  longTermMemorySchema,
  memoryCandidateSchema,
  // Messages
  conversationSchema,
  messageDirectionSchema,
  deliveryStatusSchema,
  messageSchema,
  mediaAttachmentTypeSchema,
  storedMediaAttachmentSchema,
  // Agent logs
  agentSessionStatusSchema,
  agentSessionSchema,
  agentEventTypeSchema,
  agentEventSchema,
  agentUsageSchema,
  // Channels (runtime)
  resolvedContactSchema,
  mediaAttachmentSchema,
  incomingMessageSchema,
  // Mind output
  mindOutputSchema,
  taskResultOutcomeSchema,
  taskTickOutputSchema,
  // Plugins
  PluginManifestSchema,
  pluginSourceSchema,
  pluginStatusSchema,
  PluginRecordSchema,
  AgentFrontmatterSchema,
  ContextSourceSchema,
  HookDefinitionSchema,
  DecisionTypeSchema,
  TriggerDefinitionSchema,
  PluginMcpServerSchema,
  // Package settings
  packageTypeSchema,
  packageSettingsActionSchema,
  packageSettingsSurfaceTypeSchema,
  packageSettingsSurfaceSchema,
  packageSettingsManifestSchema,
  // Usage & Budget
  tickTypeSchema,
  pipelinePhaseSchema,
  timeWindowSchema,
  breakdownDimensionSchema,
  usageRecordSchema,
  usageTimeSeriesBucketSchema,
  usageTotalsSchema,
  usageTimeSeriesSchema,
  usageBreakdownRowSchema,
  cacheStatsSchema,
  budgetConfigSchema,
  budgetStatusSchema,
  budgetAlertSchema,
  // Observational Memory
  streamTypeSchema,
  observationSchema,
  observationStartedEventSchema,
  observationCompletedEventSchema,
  observationFailedEventSchema,
  reflectionStartedEventSchema,
  reflectionCompletedEventSchema,
  reflectionFailedEventSchema,
  // Saves
  saveManifestSchema,
  saveInfoSchema,
} from '../schemas/index.js';

// ============================================================================
// Primitives
// ============================================================================

export type UUID = z.infer<typeof uuidSchema>;
export type Timestamp = z.infer<typeof timestampSchema>;

// ============================================================================
// Common Enums
// ============================================================================

export type ChannelType = z.infer<typeof channelTypeSchema>;
export type PermissionTier = z.infer<typeof permissionTierSchema>;
export type AgentProvider = z.infer<typeof agentProviderSchema>;

// ============================================================================
// System (system.db)
// ============================================================================

export type User = z.infer<typeof userSchema>;
export type Contact = z.infer<typeof contactSchema>;
export type ContactChannel = z.infer<typeof contactChannelSchema>;
export type SystemSettings = z.infer<typeof systemSettingsSchema>;
export type PaginationInput = z.infer<typeof paginationInputSchema>;
export type OnboardingState = z.infer<typeof onboardingStateSchema>;
export type ExistenceParadigm = z.infer<typeof existenceParadigmSchema>;
export type PersonalityDimensions = z.infer<typeof personalityDimensionsSchema>;
export type Archetype = z.infer<typeof archetypeSchema>;
export type Persona = z.infer<typeof personaSchema>;

// ============================================================================
// Heartbeat (heartbeat.db)
// ============================================================================

export type HeartbeatStage = z.infer<typeof heartbeatStageSchema>;
export type TriggerType = z.infer<typeof triggerTypeSchema>;
export type HeartbeatState = z.infer<typeof heartbeatStateSchema>;

export type EmotionName = z.infer<typeof emotionNameSchema>;
export type EmotionCategory = z.infer<typeof emotionCategorySchema>;
export type EmotionState = z.infer<typeof emotionStateSchema>;
export type EmotionDelta = z.infer<typeof emotionDeltaSchema>;
export type EmotionHistoryEntry = z.infer<typeof emotionHistoryEntrySchema>;

export type EnergyBand = z.infer<typeof energyBandSchema>;
export type EnergyHistoryEntry = z.infer<typeof energyHistoryEntrySchema>;

export type Thought = z.infer<typeof thoughtSchema>;
export type Experience = z.infer<typeof experienceSchema>;

export type BuiltInDecisionType = z.infer<typeof builtInDecisionTypeSchema>;
export type DecisionType = z.infer<typeof decisionTypeSchema>;
export type DecisionOutcome = z.infer<typeof decisionOutcomeSchema>;
export type TickDecision = z.infer<typeof tickDecisionSchema>;

export type SeedStatus = z.infer<typeof seedStatusSchema>;
export type SeedSource = z.infer<typeof seedSourceSchema>;
export type GoalSeed = z.infer<typeof goalSeedSchema>;

export type GoalOrigin = z.infer<typeof goalOriginSchema>;
export type GoalStatus = z.infer<typeof goalStatusSchema>;
export type Goal = z.infer<typeof goalSchema>;

export type PlanStatus = z.infer<typeof planStatusSchema>;
export type MilestoneStatus = z.infer<typeof milestoneStatusSchema>;
export type GoalMilestoneEvidence = z.infer<typeof goalMilestoneEvidenceSchema>;
export type Milestone = z.infer<typeof milestoneSchema>;
export type Plan = z.infer<typeof planSchema>;
export type GoalEventSource = z.infer<typeof goalEventSourceSchema>;
export type GoalEventType = z.infer<typeof goalEventTypeSchema>;
export type GoalEvent = z.infer<typeof goalEventSchema>;
export type GoalSnapshotUpdatedBy = z.infer<typeof goalSnapshotUpdatedBySchema>;
export type GoalSnapshot = z.infer<typeof goalSnapshotSchema>;
export type GoalReviewScope = z.infer<typeof goalReviewScopeSchema>;
export type GoalReviewStatus = z.infer<typeof goalReviewStatusSchema>;
export type GoalReviewUrgency = z.infer<typeof goalReviewUrgencySchema>;
export type GoalReviewRequestedBy = z.infer<typeof goalReviewRequestedBySchema>;
export type GoalReviewRequest = z.infer<typeof goalReviewRequestSchema>;

export type GoalSalienceLog = z.infer<typeof goalSalienceLogSchema>;

export type ScheduleType = z.infer<typeof scheduleTypeSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type TaskCreatedBy = z.infer<typeof taskCreatedBySchema>;
export type Task = z.infer<typeof taskSchema>;
export type TaskJournalStatus = z.infer<typeof taskJournalStatusSchema>;
export type TaskJournalArtifactType = z.infer<typeof taskJournalArtifactTypeSchema>;
export type TaskJournalArtifact = z.infer<typeof taskJournalArtifactSchema>;
export type TaskJournal = z.infer<typeof taskJournalSchema>;
export type TaskJournalUpdate = z.infer<typeof taskJournalUpdateSchema>;

export type TaskRunStatus = z.infer<typeof taskRunStatusSchema>;
export type TaskRun = z.infer<typeof taskRunSchema>;

export type AgentTaskStatus = z.infer<typeof agentTaskStatusSchema>;
export type AgentTask = z.infer<typeof agentTaskSchema>;

// ============================================================================
// Memory (memory.db)
// ============================================================================

export type WorkingMemory = z.infer<typeof workingMemorySchema>;
export type CoreSelf = z.infer<typeof coreSelfSchema>;
export type MemoryType = z.infer<typeof memoryTypeSchema>;
export type MemorySourceType = z.infer<typeof memorySourceTypeSchema>;
export type LongTermMemory = z.infer<typeof longTermMemorySchema>;
export type MemoryCandidate = z.infer<typeof memoryCandidateSchema>;

// ============================================================================
// Messages (messages.db)
// ============================================================================

export type Conversation = z.infer<typeof conversationSchema>;
export type MessageDirection = z.infer<typeof messageDirectionSchema>;
export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>;
export type Message = z.infer<typeof messageSchema>;
export type MediaAttachmentType = z.infer<typeof mediaAttachmentTypeSchema>;
export type StoredMediaAttachment = z.infer<typeof storedMediaAttachmentSchema>;

// ============================================================================
// Agent Logs (agent_logs.db)
// ============================================================================

export type AgentSessionStatus = z.infer<typeof agentSessionStatusSchema>;
export type AgentSession = z.infer<typeof agentSessionSchema>;
export type AgentEventType = z.infer<typeof agentEventTypeSchema>;
export type AgentEvent = z.infer<typeof agentEventSchema>;
export type AgentUsage = z.infer<typeof agentUsageSchema>;

// ============================================================================
// Phase Usage (per-phase cache visibility for Context Inspector)
// ============================================================================

export interface PhaseUsage {
  phase: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  model: string | null;
}

// ============================================================================
// Usage & Budget
// ============================================================================

export type TickType = z.infer<typeof tickTypeSchema>;
export type PipelinePhase = z.infer<typeof pipelinePhaseSchema>;
export type TimeWindow = z.infer<typeof timeWindowSchema>;
export type BreakdownDimension = z.infer<typeof breakdownDimensionSchema>;
export type UsageRecord = z.infer<typeof usageRecordSchema>;
export type UsageTimeSeriesBucket = z.infer<typeof usageTimeSeriesBucketSchema>;
export type UsageTotals = z.infer<typeof usageTotalsSchema>;
export type UsageTimeSeries = z.infer<typeof usageTimeSeriesSchema>;
export type UsageBreakdownRow = z.infer<typeof usageBreakdownRowSchema>;
export type CacheStats = z.infer<typeof cacheStatsSchema>;
export type BudgetConfig = z.infer<typeof budgetConfigSchema>;
export type BudgetStatus = z.infer<typeof budgetStatusSchema>;
export type BudgetAlert = z.infer<typeof budgetAlertSchema>;

// ============================================================================
// Channels (runtime)
// ============================================================================

export type ResolvedContact = z.infer<typeof resolvedContactSchema>;
export type MediaAttachment = z.infer<typeof mediaAttachmentSchema>;
export type IncomingMessage = z.infer<typeof incomingMessageSchema>;

// ============================================================================
// Mind Output
// ============================================================================

export type MindOutput = z.infer<typeof mindOutputSchema>;
export type TaskResultOutcome = z.infer<typeof taskResultOutcomeSchema>;
export type TaskTickOutput = z.infer<typeof taskTickOutputSchema>;

// ============================================================================
// Plugins
// ============================================================================

export type PluginManifest = z.infer<typeof PluginManifestSchema>;
export type PluginSource = z.infer<typeof pluginSourceSchema>;
export type PluginStatus = z.infer<typeof pluginStatusSchema>;
export type PluginRecord = z.infer<typeof PluginRecordSchema>;
export type AgentFrontmatter = z.infer<typeof AgentFrontmatterSchema>;
export type ContextSource = z.infer<typeof ContextSourceSchema>;
export type HookDefinition = z.infer<typeof HookDefinitionSchema>;
export type DecisionTypeDefinition = z.infer<typeof DecisionTypeSchema>;
export type TriggerDefinition = z.infer<typeof TriggerDefinitionSchema>;
export type PluginMcpServer = z.infer<typeof PluginMcpServerSchema>;

// ============================================================================
// Package Settings
// ============================================================================

export type PackageType = z.infer<typeof packageTypeSchema>;
export type PackageSettingsAction = z.infer<typeof packageSettingsActionSchema>;
export type PackageSettingsSurfaceType = z.infer<typeof packageSettingsSurfaceTypeSchema>;
export type PackageSettingsSurface = z.infer<typeof packageSettingsSurfaceSchema>;
export type PackageSettingsManifest = z.infer<typeof packageSettingsManifestSchema>;

// ============================================================================
// Observational Memory (memory.db)
// ============================================================================

export type StreamType = z.infer<typeof streamTypeSchema>;
export type Observation = z.infer<typeof observationSchema>;
export type ObservationStartedEvent = z.infer<typeof observationStartedEventSchema>;
export type ObservationCompletedEvent = z.infer<typeof observationCompletedEventSchema>;
export type ObservationFailedEvent = z.infer<typeof observationFailedEventSchema>;
export type ReflectionStartedEvent = z.infer<typeof reflectionStartedEventSchema>;
export type ReflectionCompletedEvent = z.infer<typeof reflectionCompletedEventSchema>;
export type ReflectionFailedEvent = z.infer<typeof reflectionFailedEventSchema>;

// ============================================================================
// Saves
// ============================================================================

export type SaveManifest = z.infer<typeof saveManifestSchema>;
export type SaveInfo = z.infer<typeof saveInfoSchema>;

// ============================================================================
// Channel Packages
// ============================================================================

export type {
  ChannelManifestAuthor,
  ChannelIdentity,
  ChannelCapability,
  ChannelPermissions,
  ChannelStoreMetadata,
  ChannelManifest,
  ConfigFieldType,
  ConfigFieldOption,
  ConfigFieldHelpLink,
  ConfigFieldOAuth,
  ConfigField,
  ConfigSchema,
  SetupGuide,
  SetupGuideStep,
  SetupGuideLink,
  ChannelPackageStatus,
  ChannelPackage,
  ChannelInfo,
  IpcMessageType,
  IpcMessageBase,
  ChannelStatusEvent,
} from './channel-packages.js';

// ============================================================================
// Tool Permissions
// ============================================================================

export type RiskTier = 'safe' | 'communicates' | 'acts' | 'sensitive';
export type ToolPermissionMode = 'off' | 'ask' | 'always_allow';
export type ToolApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';

export interface ToolPermission {
  toolName: string;
  toolSource: string;
  displayName: string;
  description: string;
  riskTier: RiskTier;
  mode: ToolPermissionMode;
  isDefault: boolean;
  usageCount: number;
  lastUsedAt: string | null;
  trustRampDismissedAt: string | null;
  updatedAt: string;
}

export interface ToolApprovalAgentContext {
  taskDescription: string;
  conversationSummary: string;
  pendingAction: string;
  relatedGoal?: string;
}

export interface ToolApprovalRequest {
  id: string;
  toolName: string;
  toolSource: string;
  contactId: string;
  channel: string;
  tickNumber: number;
  agentContext: ToolApprovalAgentContext;
  toolInput: Record<string, unknown> | null;
  triggerSummary: string;
  conversationId: string | null;
  originatingAgent: string;
  status: ToolApprovalStatus;
  scope: 'once' | null;
  createdAt: string;
  resolvedAt: string | null;
  expiresAt: string;
}

// ============================================================================
// API Types (not schema-derived)
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

// ============================================================================
// Context Builder (context-builder output types, shared with frontend)
// ============================================================================

export type ContextSectionCategory =
  | 'identity'
  | 'trigger'
  | 'state'
  | 'memory'
  | 'goals'
  | 'system'
  | 'plugins';

export interface ContextSection {
  id: string;
  title: string;
  included: boolean;
  content?: string;
  reason?: string;
  category: ContextSectionCategory;
  tokenCount: number;
}

// ============================================================================
// Cortex Context Snapshot (context inspector, shared with frontend)
// ============================================================================

/** A single named section with content and token estimate */
export interface ContextSnapshotSection {
  name: string;
  content: string;
  tokenCount: number;
  category?: string;
}

/** Snapshot of all context sent to the LLM for a given tick */
export interface CortexContextSnapshot {
  /** Consumer/Animus system prompt sections (persona, emotions, etc.) */
  consumerSystemPrompt: ContextSnapshotSection[];
  /** Cortex operational system prompt sections (rules, tools, environment) */
  cortexSystemPrompt: ContextSnapshotSection[];
  /** Named context slots (dynamic, currently 9) */
  slots: ContextSnapshotSection[];
  /** Conversation history metadata (not full content) */
  conversationHistory: {
    messageCount: number;
    totalTokens: number;
    hasSummary: boolean;
    summaryTokens: number | null;
    oldestMessageTimestamp: string | null;
  };
  /** Ephemeral per-tick context (full content) */
  ephemeral: ContextSnapshotSection[];
  /** The trigger/user message for this tick */
  triggerMessage: {
    content: string;
    tokenCount: number;
  };
  /** Model context window size for budget visualization */
  contextWindow: number;
  /** Total tokens across all sections (estimated via chars/4) */
  totalTokens: number;
  /** Actual input tokens from the first agentic loop turn (from API response) */
  firstTurnActualInputTokens?: number;
}

// ============================================================================
// Per-Phase Context Snapshots (debug context capture)
// ============================================================================

/** A single message as sent to the LLM (captured in debug mode only) */
export interface MessageSnapshot {
  role: 'user' | 'assistant' | 'system';
  content: string;
  tokenCount: number;
}

/** Lightweight history metadata (always captured) */
export interface HistorySnapshotMeta {
  messageCount: number;
  totalTokens: number;
  hasSummary: boolean;
  summaryTokens: number | null;
  oldestMessageTimestamp: string | null;
}

/** Thought phase context snapshot */
export interface ThoughtContextSnapshot {
  phase: 'thought';
  tickNumber: number;
  /** Thought-specific system prompt sections (3 sections: instructions, persona, preamble) */
  systemPrompt: ContextSnapshotSection[];
  /** Context slots included (8 of 9, no credentials) */
  slots: ContextSnapshotSection[];
  /** Summarized conversation history metadata */
  conversationHistory: HistorySnapshotMeta;
  /** Ephemeral per-tick context sections */
  ephemeral: ContextSnapshotSection[];
  /** The thought generation prompt */
  prompt: ContextSnapshotSection;
  /** Model context window size */
  contextWindow: number;
  /** Total estimated tokens across all sections */
  totalTokens: number;
  /** Full message array (debug mode only) */
  messages?: MessageSnapshot[] | undefined;
}

/** Agentic loop context snapshot (extends existing CortexContextSnapshot shape) */
export interface AgenticContextSnapshot {
  phase: 'agentic_loop';
  tickNumber: number;
  /** Consumer/Animus system prompt sections */
  consumerSystemPrompt: ContextSnapshotSection[];
  /** Cortex operational system prompt sections */
  cortexSystemPrompt: ContextSnapshotSection[];
  /** Named context slots */
  slots: ContextSnapshotSection[];
  /** Conversation history metadata */
  conversationHistory: HistorySnapshotMeta;
  /** Ephemeral per-tick context */
  ephemeral: ContextSnapshotSection[];
  /** The trigger/user message */
  triggerMessage: { content: string; tokenCount: number };
  /** Model context window size */
  contextWindow: number;
  /** Total estimated tokens */
  totalTokens: number;
  /** Actual input tokens from the first turn (from API) */
  firstTurnActualInputTokens?: number | undefined;
  /** Full message array at loop start (debug mode only) */
  messages?: MessageSnapshot[] | undefined;
}

/** Per-turn delta within the agentic loop (debug mode only) */
export interface AgenticTurnDelta {
  phase: 'agentic_turn';
  tickNumber: number;
  turnNumber: number;
  /** Number of new messages added since last turn */
  newMessageCount: number;
  /** Total conversation history messages at this turn */
  totalHistoryMessages: number;
  /** Total history tokens at this turn */
  totalHistoryTokens: number;
  /** Usage from this turn's API response */
  turnUsage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
  /** The new messages added (debug mode only) */
  newMessages?: MessageSnapshot[] | undefined;
}

/** Reflect phase context snapshot */
export interface ReflectContextSnapshot {
  phase: 'reflect';
  tickNumber: number;
  /** Reflect-specific system prompt sections (8 sections) */
  systemPrompt: ContextSnapshotSection[];
  /** Context slots included (8 of 9, no credentials) */
  slots: ContextSnapshotSection[];
  /** Current-tick agentic turn messages metadata */
  currentTickTurns: { messageCount: number; totalTokens: number };
  /** Ephemeral per-tick context sections */
  ephemeral: ContextSnapshotSection[];
  /** The reflect prompt */
  prompt: ContextSnapshotSection;
  /** Model context window size */
  contextWindow: number;
  /** Total estimated tokens */
  totalTokens: number;
  /** Full message array (debug mode only) */
  messages?: MessageSnapshot[] | undefined;
}

/** Discriminated union of all phase context snapshots */
export type PhaseContextSnapshot =
  | ThoughtContextSnapshot
  | AgenticContextSnapshot
  | ReflectContextSnapshot
  | AgenticTurnDelta;

// ============================================================================
// Distribution (Package System)
// ============================================================================

export * from './distribution.js';
