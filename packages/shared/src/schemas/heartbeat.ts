/**
 * Schemas for heartbeat.db entities.
 *
 * Tables: heartbeat_state, emotion_state, emotion_history,
 *         tick_decisions, goal_seeds, goals, plans, goal_salience_log,
 *         tasks, task_runs, agent_tasks
 */

import { z } from 'zod';
import {
  uuidSchema,
  timestampSchema,
  channelTypeSchema,
  agentProviderSchema,
} from './common.js';

// ============================================================================
// Heartbeat State
// ============================================================================

export const heartbeatStageSchema = z.enum([
  'idle',
  'gather',
  'mind',
  'execute',
]);

export const sessionStateSchema = z.enum(['cold', 'active', 'warm']);

export const triggerTypeSchema = z.enum([
  'interval',
  'message',
  'scheduled_task',
  'agent_complete',
  'plugin_trigger',
]);

export const heartbeatStateSchema = z.object({
  tickNumber: z.number().int().nonnegative(),
  currentStage: heartbeatStageSchema,
  sessionState: sessionStateSchema,
  triggerType: triggerTypeSchema.nullable(),
  triggerContext: z.string().nullable(), // JSON
  mindSessionId: z.string().nullable(),
  sessionTokenCount: z.number().int().nonnegative().default(0),
  startedAt: timestampSchema,
  lastTickAt: timestampSchema.nullable(),
  sessionWarmSince: timestampSchema.nullable(),
  isRunning: z.boolean(),
  // Energy system
  energyLevel: z.number().min(0).max(1).default(0.85),
  lastEnergyUpdate: timestampSchema.nullable().default(null),
});

// ============================================================================
// Emotions
// ============================================================================

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
// Energy
// ============================================================================

export const energyBandSchema = z.enum([
  'peak',
  'alert',
  'tired',
  'drowsy',
  'very_drowsy',
  'sleeping',
]);

export const energyHistoryEntrySchema = z.object({
  id: z.number().int(),
  tickNumber: z.number().int().nonnegative(),
  energyBefore: z.number().min(0).max(1),
  energyAfter: z.number().min(0).max(1),
  delta: z.number(),
  reasoning: z.string(),
  circadianBaseline: z.number().min(0).max(1),
  energyBand: energyBandSchema,
  createdAt: timestampSchema,
});

// ============================================================================
// Thoughts & Experiences
// ============================================================================

export const thoughtSchema = z.object({
  id: uuidSchema,
  tickNumber: z.number().int().nonnegative(),
  content: z.string(),
  importance: z.number().min(0).max(1),
  createdAt: timestampSchema,
  expiresAt: timestampSchema.nullable(),
});

export const experienceSchema = z.object({
  id: uuidSchema,
  tickNumber: z.number().int().nonnegative(),
  content: z.string(),
  importance: z.number().min(0).max(1),
  createdAt: timestampSchema,
  expiresAt: timestampSchema.nullable(),
});

// ============================================================================
// Tick Decisions
// ============================================================================

export const builtInDecisionTypeSchema = z.enum([
  'spawn_agent',
  'update_agent',
  'cancel_agent',
  'send_message',
  'update_goal',
  'propose_goal',
  'create_seed',
  'create_plan',
  'revise_plan',
  'schedule_task',
  'start_task',
  'complete_task',
  'cancel_task',
  'skip_task',
  'no_action',
]);

export const decisionTypeSchema = z.union([builtInDecisionTypeSchema, z.string()]);

export const decisionOutcomeSchema = z.enum(['executed', 'dropped', 'failed']);

export const tickDecisionSchema = z.object({
  id: uuidSchema,
  tickNumber: z.number().int().nonnegative(),
  type: decisionTypeSchema,
  description: z.string(),
  parameters: z.record(z.unknown()).nullable(),
  outcome: decisionOutcomeSchema,
  outcomeDetail: z.string().nullable(),
  createdAt: timestampSchema,
});

// ============================================================================
// Goal Seeds
// ============================================================================

export const seedStatusSchema = z.enum([
  'active',
  'graduating',
  'graduated',
  'declined',
  'decayed',
]);

export const seedSourceSchema = z.enum([
  'internal',
  'user_observation',
  'experience',
]);

export const goalSeedSchema = z.object({
  id: uuidSchema,
  content: z.string(),
  motivation: z.string().nullable(),
  strength: z.number().min(0).max(1),
  linkedEmotion: emotionNameSchema.nullable(),
  source: seedSourceSchema,
  reinforcementCount: z.number().int().nonnegative().default(0),
  status: seedStatusSchema,
  graduatedToGoalId: uuidSchema.nullable(),
  createdAt: timestampSchema,
  lastReinforcedAt: timestampSchema,
  decayedAt: timestampSchema.nullable(),
});

// ============================================================================
// Goals
// ============================================================================

export const goalOriginSchema = z.enum([
  'user_directed',
  'ai_internal',
  'collaborative',
]);

export const goalStatusSchema = z.enum([
  'proposed',
  'active',
  'paused',
  'completed',
  'abandoned',
]);

export const goalSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  description: z.string().nullable(),
  motivation: z.string().nullable(),

  // Origin
  origin: goalOriginSchema,
  seedId: uuidSchema.nullable(),
  linkedEmotion: emotionNameSchema.nullable(),
  createdByContactId: uuidSchema.nullable(),

  // Status
  status: goalStatusSchema,

  // Priority & Salience
  basePriority: z.number().min(0).max(1).default(0.5),
  currentSalience: z.number().min(0).max(1).default(0.5),

  // Completion
  completionCriteria: z.string().nullable(),
  deadline: timestampSchema.nullable(),

  // Timestamps
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  activatedAt: timestampSchema.nullable(),
  completedAt: timestampSchema.nullable(),
  abandonedAt: timestampSchema.nullable(),
  abandonedReason: z.string().nullable(),
  lastProgressAt: timestampSchema.nullable(),
  lastUserMentionAt: timestampSchema.nullable(),
});

// ============================================================================
// Plans & Milestones
// ============================================================================

export const planStatusSchema = z.enum(['active', 'superseded', 'abandoned']);

export const milestoneStatusSchema = z.enum([
  'pending',
  'in_progress',
  'completed',
  'skipped',
]);

export const milestoneSchema = z.object({
  title: z.string(),
  description: z.string(),
  status: milestoneStatusSchema,
  completedAt: timestampSchema.optional(),
});

export const planSchema = z.object({
  id: uuidSchema,
  goalId: uuidSchema,
  version: z.number().int().positive(),
  status: planStatusSchema,
  strategy: z.string(),
  milestones: z.array(milestoneSchema).nullable(),
  createdBy: z.enum(['mind', 'planning_agent']),
  revisionReason: z.string().nullable(),
  createdAt: timestampSchema,
  supersededAt: timestampSchema.nullable(),
});

// ============================================================================
// Goal Salience Log
// ============================================================================

export const goalSalienceLogSchema = z.object({
  id: uuidSchema,
  goalId: uuidSchema,
  salience: z.number().min(0).max(1),
  basePriority: z.number(),
  emotionalResonance: z.number(),
  userEngagement: z.number(),
  progressMomentum: z.number(),
  urgency: z.number(),
  stalenessPenalty: z.number(),
  novelty: z.number(),
  computedAt: timestampSchema,
});

// ============================================================================
// Tasks (full model)
// ============================================================================

export const scheduleTypeSchema = z.enum([
  'one_shot',
  'recurring',
  'deferred',
]);

export const taskStatusSchema = z.enum([
  'pending',
  'scheduled',
  'in_progress',
  'completed',
  'failed',
  'cancelled',
  'paused',
]);

export const taskCreatedBySchema = z.enum([
  'mind',
  'planning_agent',
  'user',
]);

export const taskSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  description: z.string().nullable(),
  instructions: z.string().nullable(),

  // Scheduling
  scheduleType: scheduleTypeSchema,
  cronExpression: z.string().nullable(),
  scheduledAt: timestampSchema.nullable(),
  nextRunAt: timestampSchema.nullable(),

  // Goal linkage
  goalId: uuidSchema.nullable(),
  planId: uuidSchema.nullable(),
  milestoneIndex: z.number().int().nonnegative().nullable(),

  // Status
  status: taskStatusSchema,
  priority: z.number().min(0).max(1).default(0.5),

  // Execution tracking
  retryCount: z.number().int().nonnegative().default(0),
  lastError: z.string().nullable(),
  result: z.string().nullable(),

  // Origin & Contact
  createdBy: taskCreatedBySchema,
  contactId: uuidSchema.nullable(),

  // Timestamps
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  startedAt: timestampSchema.nullable(),
  completedAt: timestampSchema.nullable(),
});

// ============================================================================
// Task Runs (recurring task execution log)
// ============================================================================

export const taskRunStatusSchema = z.enum(['completed', 'failed', 'skipped']);

export const taskRunSchema = z.object({
  id: uuidSchema,
  taskId: uuidSchema,
  status: taskRunStatusSchema,
  result: z.string().nullable(),
  error: z.string().nullable(),
  agentTaskId: uuidSchema.nullable(),
  retryCount: z.number().int().nonnegative().default(0),
  startedAt: timestampSchema,
  completedAt: timestampSchema.nullable(),
});

// ============================================================================
// Agent Tasks (sub-agent tracking)
// ============================================================================

export const agentTaskStatusSchema = z.enum([
  'spawning',
  'running',
  'completed',
  'failed',
  'cancelled',
  'timed_out',
]);

export const agentTaskSchema = z.object({
  id: uuidSchema,
  tickNumber: z.number().int().nonnegative(),
  sessionId: z.string().nullable(),
  provider: agentProviderSchema,
  model: z.string().nullable(),
  status: agentTaskStatusSchema,

  // Task definition
  taskType: z.string(),
  taskDescription: z.string(),
  contactId: uuidSchema.nullable(),
  sourceChannel: channelTypeSchema.nullable(),

  // Progress tracking
  currentActivity: z.string().nullable(),

  // Results
  result: z.string().nullable(),
  error: z.string().nullable(),

  // Timing
  createdAt: timestampSchema,
  startedAt: timestampSchema.nullable(),
  completedAt: timestampSchema.nullable(),
  timeoutAt: timestampSchema.nullable(),

  // Cost tracking
  inputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
  totalCostUsd: z.number().nonnegative().default(0),
});
