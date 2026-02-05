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

export const thoughtTypeSchema = z.enum([
  'observation',
  'reflection',
  'intention',
  'question',
  'insight',
]);

export const thoughtSchema = z.object({
  id: uuidSchema,
  tickNumber: z.number().int().nonnegative(),
  content: z.string(),
  type: thoughtTypeSchema,
  createdAt: timestampSchema,
  expiresAt: timestampSchema.nullable(),
});

export const createThoughtInputSchema = z.object({
  content: z.string().min(1),
  type: thoughtTypeSchema,
});

export const experienceSchema = z.object({
  id: uuidSchema,
  tickNumber: z.number().int().nonnegative(),
  description: z.string(),
  emotionalValence: z.number().min(-1).max(1),
  salience: z.number().min(0).max(1),
  createdAt: timestampSchema,
  expiresAt: timestampSchema.nullable(),
});

export const emotionSchema = z.object({
  id: uuidSchema,
  tickNumber: z.number().int().nonnegative(),
  name: z.string(),
  intensity: z.number().min(0).max(1),
  createdAt: timestampSchema,
  expiresAt: timestampSchema.nullable(),
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
  emotionRetentionDays: z.number().int().positive().default(7),
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
