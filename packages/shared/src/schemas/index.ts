/**
 * Zod schemas for runtime validation
 *
 * These schemas validate data at runtime and can be used with tRPC
 * for automatic input/output validation.
 */

import { z } from 'zod';

// ============================================================================
// Base Schemas
// ============================================================================

export const uuidSchema = z.string().uuid();
export const timestampSchema = z.string().datetime();

// ============================================================================
// Auth Schemas
// ============================================================================

export const loginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const registerInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  confirmPassword: z.string().min(8),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

export const userSchema = z.object({
  id: uuidSchema,
  email: z.string().email(),
  contactId: uuidSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

// ============================================================================
// Heartbeat Schemas
// ============================================================================

export const heartbeatPhaseSchema = z.enum([
  'idle',
  'perceive',
  'think',
  'feel',
  'decide',
  'act',
  'reflect',
  'consolidate',
]);

export const heartbeatStateSchema = z.object({
  tickNumber: z.number().int().nonnegative(),
  currentPhase: heartbeatPhaseSchema,
  pipelineProgress: z.array(heartbeatPhaseSchema),
  startedAt: timestampSchema,
  lastTickAt: timestampSchema.nullable(),
  isRunning: z.boolean(),
});

export const thoughtSchema = z.object({
  id: uuidSchema,
  tickNumber: z.number().int().nonnegative(),
  content: z.string(),
  importance: z.number().min(0).max(1),
  createdAt: timestampSchema,
  expiresAt: timestampSchema.nullable(),
});

export const createThoughtInputSchema = z.object({
  content: z.string().min(1),
  importance: z.number().min(0).max(1).default(0.5),
});

export const experienceSchema = z.object({
  id: uuidSchema,
  tickNumber: z.number().int().nonnegative(),
  content: z.string(),
  importance: z.number().min(0).max(1),
  createdAt: timestampSchema,
  expiresAt: timestampSchema.nullable(),
});

export const emotionNameSchema = z.enum([
  'joy',
  'contentment',
  'excitement',
  'gratitude',
  'confidence',
  'stress',
  'anxiety',
  'frustration',
  'sadness',
  'boredom',
  'curiosity',
  'loneliness',
]);

export const emotionCategorySchema = z.enum(['positive', 'negative', 'drive']);

export const emotionStateSchema = z.object({
  emotion: emotionNameSchema,
  category: emotionCategorySchema,
  intensity: z.number().min(0).max(1),
  baseline: z.number().min(0).max(1),
  lastUpdatedAt: timestampSchema,
});

export const emotionDeltaSchema = z.object({
  emotion: emotionNameSchema,
  delta: z.number(),
  reasoning: z.string(),
});

export const emotionHistoryEntrySchema = z.object({
  id: uuidSchema,
  tickNumber: z.number().int().nonnegative(),
  emotion: emotionNameSchema,
  delta: z.number(),
  reasoning: z.string(),
  intensityBefore: z.number().min(0).max(1),
  intensityAfter: z.number().min(0).max(1),
  createdAt: timestampSchema,
});

// ============================================================================
// Task Schemas
// ============================================================================

export const taskStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'cancelled']);
export const taskPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);

export const taskSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  description: z.string().nullable(),
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  dueAt: timestampSchema.nullable(),
  completedAt: timestampSchema.nullable(),
});

export const createTaskInputSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  priority: taskPrioritySchema.default('medium'),
  dueAt: timestampSchema.optional(),
});

export const updateTaskInputSchema = z.object({
  id: uuidSchema,
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  dueAt: timestampSchema.nullable().optional(),
});

// ============================================================================
// Message & Channel Schemas
// ============================================================================

export const channelTypeSchema = z.enum(['web', 'sms', 'discord', 'api']);
export const permissionTierSchema = z.enum(['primary', 'standard']);
export const messageDirectionSchema = z.enum(['inbound', 'outbound']);
export const messageSenderSchema = z.enum(['user', 'animus', 'sub_agent']);

export const channelSchema = z.object({
  id: uuidSchema,
  type: channelTypeSchema,
  name: z.string(),
  config: z.record(z.unknown()),
  isActive: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const conversationSchema = z.object({
  id: uuidSchema,
  channelId: uuidSchema,
  title: z.string().nullable(),
  startedAt: timestampSchema,
  lastMessageAt: timestampSchema,
  messageCount: z.number().int().nonnegative(),
});

export const messageSchema = z.object({
  id: uuidSchema,
  conversationId: uuidSchema,
  direction: messageDirectionSchema,
  sender: messageSenderSchema,
  content: z.string(),
  channelType: channelTypeSchema,
  tickNumber: z.number().int().nonnegative().nullable(),
  agentTaskId: uuidSchema.nullable(),
  metadata: z.record(z.unknown()).nullable(),
  createdAt: timestampSchema,
});

export const sendMessageInputSchema = z.object({
  conversationId: uuidSchema.optional(),
  channelType: channelTypeSchema,
  content: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});

// ============================================================================
// Contact Schemas
// ============================================================================

export const contactSchema = z.object({
  id: uuidSchema,
  fullName: z.string(),
  phoneNumber: z.string().nullable(),
  email: z.string().email().nullable(),
  isPrimary: z.boolean(),
  permissionTier: permissionTierSchema,
  notes: z.string().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const contactChannelSchema = z.object({
  id: uuidSchema,
  contactId: uuidSchema,
  channel: channelTypeSchema,
  identifier: z.string(),
  displayName: z.string().nullable(),
  isVerified: z.boolean(),
  createdAt: timestampSchema,
});

// ============================================================================
// Channel Adapter Schemas
// ============================================================================

export const mediaAttachmentTypeSchema = z.enum(['image', 'audio', 'video', 'file']);

export const mediaAttachmentSchema = z.object({
  id: uuidSchema,
  type: mediaAttachmentTypeSchema,
  mimeType: z.string(),
  localPath: z.string(),
  originalFilename: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative(),
});

export const resolvedContactSchema = z.object({
  id: uuidSchema,
  fullName: z.string(),
  permissionTier: permissionTierSchema,
});

export const incomingMessageSchema = z.object({
  channel: channelTypeSchema,
  channelIdentifier: z.string(),
  contact: resolvedContactSchema.nullable(),
  conversationId: z.string().nullable(),
  content: z.string(),
  media: z.array(mediaAttachmentSchema).optional(),
  rawMetadata: z.record(z.unknown()),
  receivedAt: timestampSchema,
});

// ============================================================================
// Channel Configuration Schemas
// ============================================================================

export const channelConfigTypeSchema = z.enum(['sms', 'discord', 'openai_api', 'ollama_api']);

export const smsChannelConfigSchema = z.object({
  accountSid: z.string().min(1),
  authToken: z.string().min(1),
  phoneNumber: z.string().min(1),
  webhookUrl: z.string().url(),
});

export const discordChannelConfigSchema = z.object({
  botToken: z.string().min(1),
  applicationId: z.string().min(1),
  allowedGuildIds: z.array(z.string()).default([]),
});

export const openaiApiChannelConfigSchema = z.object({});

export const ollamaApiChannelConfigSchema = z.object({});

export const channelConfigSchema = z.object({
  id: uuidSchema,
  channelType: channelConfigTypeSchema,
  isEnabled: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

// ============================================================================
// Agent Schemas
// ============================================================================

export const agentProviderSchema = z.enum(['claude', 'codex', 'opencode']);

export const agentEventTypeSchema = z.enum([
  'session_start',
  'session_end',
  'input_received',
  'thinking_start',
  'thinking_end',
  'tool_call_start',
  'tool_call_end',
  'tool_error',
  'response_start',
  'response_chunk',
  'response_end',
  'error',
]);

export const agentSessionSchema = z.object({
  id: uuidSchema,
  provider: agentProviderSchema,
  startedAt: timestampSchema,
  endedAt: timestampSchema.nullable(),
  status: z.enum(['active', 'completed', 'error', 'cancelled']),
});

export const agentEventSchema = z.object({
  id: uuidSchema,
  sessionId: uuidSchema,
  eventType: agentEventTypeSchema,
  data: z.record(z.unknown()),
  createdAt: timestampSchema,
});

export const agentUsageSchema = z.object({
  sessionId: uuidSchema,
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative().nullable(),
  model: z.string(),
  createdAt: timestampSchema,
});

// ============================================================================
// Settings Schemas
// ============================================================================

export const systemSettingsSchema = z.object({
  heartbeatIntervalMs: z.number().int().positive().default(300000), // 5 minutes
  thoughtRetentionDays: z.number().int().positive().default(30),
  experienceRetentionDays: z.number().int().positive().default(30),
  emotionHistoryRetentionDays: z.number().int().positive().default(30),
  agentLogRetentionDays: z.number().int().positive().default(14),
  defaultAgentProvider: agentProviderSchema.default('claude'),
});

export const personalitySettingsSchema = z.object({
  name: z.string().min(1),
  traits: z.array(z.string()),
  communicationStyle: z.string(),
  values: z.array(z.string()),
});

export const updateSystemSettingsInputSchema = systemSettingsSchema.partial();
export const updatePersonalitySettingsInputSchema = personalitySettingsSchema.partial();

// ============================================================================
// Pagination Schemas
// ============================================================================

export const paginationInputSchema = z.object({
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(100).default(20),
});

export function createPaginatedResponseSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    hasMore: z.boolean(),
  });
}
