/**
 * TypeScript types derived from Zod schemas via z.infer<>.
 *
 * DO NOT define types manually here — derive them from schemas.
 * The schemas in /schemas/ are the single source of truth.
 */

import { z } from 'zod';
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
  personalitySettingsSchema,
  onboardingStateSchema,
  existenceParadigmSchema,
  personalityDimensionsSchema,
  archetypeSchema,
  personaSchema,
  // Heartbeat
  heartbeatStageSchema,
  sessionStateSchema,
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
  milestoneSchema,
  planSchema,
  goalSalienceLogSchema,
  scheduleTypeSchema,
  taskStatusSchema,
  taskCreatedBySchema,
  taskSchema,
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
  PluginRecordSchema,
  AgentFrontmatterSchema,
  ContextSourceSchema,
  HookDefinitionSchema,
  DecisionTypeSchema,
  TriggerDefinitionSchema,
  PluginMcpServerSchema,
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
export type PersonalitySettings = z.infer<typeof personalitySettingsSchema>;
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
export type SessionState = z.infer<typeof sessionStateSchema>;
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
export type Milestone = z.infer<typeof milestoneSchema>;
export type Plan = z.infer<typeof planSchema>;

export type GoalSalienceLog = z.infer<typeof goalSalienceLogSchema>;

export type ScheduleType = z.infer<typeof scheduleTypeSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type TaskCreatedBy = z.infer<typeof taskCreatedBySchema>;
export type Task = z.infer<typeof taskSchema>;

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
export type PluginRecord = z.infer<typeof PluginRecordSchema>;
export type AgentFrontmatter = z.infer<typeof AgentFrontmatterSchema>;
export type ContextSource = z.infer<typeof ContextSourceSchema>;
export type HookDefinition = z.infer<typeof HookDefinitionSchema>;
export type DecisionTypeDefinition = z.infer<typeof DecisionTypeSchema>;
export type TriggerDefinition = z.infer<typeof TriggerDefinitionSchema>;
export type PluginMcpServer = z.infer<typeof PluginMcpServerSchema>;

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
  ConfigField,
  ConfigSchema,
  ChannelPackageStatus,
  ChannelPackage,
  ChannelInfo,
  IpcMessageType,
  IpcMessageBase,
  ChannelStatusEvent,
} from './channel-packages.js';

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
