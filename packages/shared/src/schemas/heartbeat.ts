/**
 * Schemas for heartbeat.db entities.
 *
 * Tables: heartbeat_state, emotion_state, emotion_history,
 *         tick_decisions, goal_seeds, goals, plans, goal_salience_log,
 *         tasks, task_journals, task_runs, agent_tasks
 */

import { z } from 'zod/v3';
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
  triggerType: triggerTypeSchema.nullable(),
  triggerContext: z.string().nullable(), // JSON
  contextTokenCount: z.number().int().nonnegative().default(0),
  startedAt: timestampSchema,
  lastTickAt: timestampSchema.nullable(),
  nextTickAt: timestampSchema.nullable().default(null),
  isRunning: z.boolean(),
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
  'update_agent',
  'cancel_agent',
  'send_message',
  'send_reaction',
  'update_goal',
  'propose_goal',
  'create_seed',
  'create_plan',
  'revise_plan',
  'create_plan_version',
  'update_milestone',
  'update_goal_snapshot',
  'queue_goal_review',
  'resolve_goal_review',
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

  // Planning prompt escalation
  activatedAtTick: z.number().nullable().default(null),
  planPromptUrgency: z.string().nullable().default(null),
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
  'blocked',
]);

export const goalMilestoneEvidenceSchema = z.object({
  label: z.string(),
  ref: z.string(),
  context: z.string(),
});

export const milestoneSchema = z.object({
  id: uuidSchema,
  goalId: uuidSchema,
  planId: uuidSchema,
  position: z.number().int().nonnegative(),
  title: z.string(),
  description: z.string().nullable(),
  acceptanceCriteria: z.string().nullable(),
  status: milestoneStatusSchema,
  confidence: z.number().min(0).max(1).default(0.5),
  evidence: z.array(goalMilestoneEvidenceSchema).default([]),
  blockerNotes: z.string().nullable(),
  completionRationale: z.string().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  completedAt: timestampSchema.nullable(),
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
  reasonCreated: z.string().nullable().default(null),
  assumptions: z.array(z.string()).default([]),
  supersedesPlanId: uuidSchema.nullable().default(null),
  createdAt: timestampSchema,
  supersededAt: timestampSchema.nullable(),
});

export const goalEventSourceSchema = z.enum([
  'system',
  'mind',
  'user',
  'task',
  'agent',
]);

export const goalEventTypeSchema = z.enum([
  'goal.created',
  'goal.activated',
  'goal.paused',
  'goal.resumed',
  'goal.completed',
  'goal.abandoned',
  'plan.created',
  'plan.superseded',
  'milestone.started',
  'milestone.updated',
  'milestone.completed',
  'milestone.blocked',
  'task.created',
  'task.started',
  'task.completed',
  'task.cancelled',
  'task.skipped',
  'task.failed',
  'review.requested',
  'review.resolved',
  'snapshot.updated',
]);

export const goalEventSchema = z.object({
  id: uuidSchema,
  goalId: uuidSchema,
  tickNumber: z.number().int().nonnegative().nullable(),
  type: goalEventTypeSchema,
  summary: z.string(),
  source: goalEventSourceSchema,
  taskId: uuidSchema.nullable(),
  planId: uuidSchema.nullable(),
  milestoneId: uuidSchema.nullable(),
  data: z.record(z.unknown()).default({}),
  createdAt: timestampSchema,
});

export const goalSnapshotUpdatedBySchema = z.enum(['system', 'mind']);

export const goalSnapshotSchema = z.object({
  goalId: uuidSchema,
  summary: z.string(),
  currentPlanId: uuidSchema.nullable(),
  currentMilestoneId: uuidSchema.nullable(),
  recentProgress: z.string(),
  knownBlockers: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
  nextBestMove: z.string(),
  planConfidence: z.number().min(0).max(1).default(0.5),
  completionConfidence: z.number().min(0).max(1).default(0),
  updatedFromEventId: uuidSchema.nullable(),
  updatedBy: goalSnapshotUpdatedBySchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const goalReviewScopeSchema = z.enum([
  'plan_missing',
  'milestone_acceptance',
  'plan_revision',
  'blocker',
  'next_tasks',
  'user_alignment',
  'completion_check',
]);

export const goalReviewStatusSchema = z.enum([
  'pending',
  'resolved',
  'dismissed',
]);

export const goalReviewUrgencySchema = z.enum([
  'low',
  'normal',
  'high',
]);

export const goalReviewRequestedBySchema = z.enum([
  'system',
  'mind',
]);

export const goalReviewRequestSchema = z.object({
  id: uuidSchema,
  goalId: uuidSchema,
  scope: goalReviewScopeSchema,
  status: goalReviewStatusSchema,
  urgency: goalReviewUrgencySchema,
  reason: z.string(),
  evidenceRefs: z.array(z.string()).default([]),
  requestedBy: goalReviewRequestedBySchema,
  createdTickNumber: z.number().int().nonnegative().nullable(),
  resolvedTickNumber: z.number().int().nonnegative().nullable(),
  resolution: z.string().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  resolvedAt: timestampSchema.nullable(),
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
  milestoneId: uuidSchema.nullable().default(null),
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
// Task Journals (continuity notes for task-scoped work)
// ============================================================================

export const taskJournalStatusSchema = z.enum([
  'not_started',
  'in_progress',
  'blocked',
  'ready_to_complete',
  'complete',
]);

export const taskJournalArtifactTypeSchema = z.enum([
  'file',
  'url',
  'tool_result',
  'database',
  'log',
  'note',
  'other',
]);

export const taskJournalArtifactSchema = z.object({
  label: z.string(),
  type: taskJournalArtifactTypeSchema.default('other'),
  ref: z.string(),
  context: z.string(),
});

export const taskJournalSchema = z.object({
  taskId: uuidSchema,
  status: taskJournalStatusSchema,
  handoff: z.string(),
  summary: z.string(),
  learned: z.array(z.string()),
  decisions: z.array(z.string()),
  artifacts: z.array(taskJournalArtifactSchema),
  openQuestions: z.array(z.string()),
  nextSteps: z.array(z.string()),
  tokenCount: z.number().int().nonnegative().default(0),
  updatedTickNumber: z.number().int().nonnegative().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const taskJournalUpdateSchema = z.object({
  taskId: z.string(),
  status: taskJournalStatusSchema,
  handoff: z.string(),
  summary: z.string(),
  learned: z.array(z.string()),
  decisions: z.array(z.string()),
  artifacts: z.array(taskJournalArtifactSchema),
  openQuestions: z.array(z.string()),
  nextSteps: z.array(z.string()),
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
  parentTaskId: uuidSchema.nullable(),
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
