/**
 * Schemas for the Usage & Budget system.
 *
 * Covers enriched usage records, time-series aggregation,
 * breakdown queries, cache statistics, and budget configuration.
 */

import { z } from 'zod/v3';

// ============================================================================
// Enums & Constants
// ============================================================================

export const tickTypeSchema = z.enum([
  'interval',
  'message',
  'scheduled_task',
  'agent_complete',
  'plugin_trigger',
]);

export const pipelinePhaseSchema = z.enum(['thought', 'agentic_loop', 'reflect']);

export const timeWindowSchema = z.enum(['1h', '12h', '24h', '7d', '30d', '90d']);

export const breakdownDimensionSchema = z.enum([
  'tick_type',
  'model',
  'pipeline_phase',
  'contact',
]);

// ============================================================================
// Usage Records
// ============================================================================

export const usageRecordSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  tickNumber: z.number().nullable().optional(),
  tickType: tickTypeSchema.nullable().optional(),
  pipelinePhase: pipelinePhaseSchema.nullable().optional(),
  contactId: z.string().nullable().optional(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number().default(0),
  cacheWriteTokens: z.number().default(0),
  totalTokens: z.number(),
  costUsd: z.number().nullable(),
  model: z.string(),
  createdAt: z.string(),
});

// ============================================================================
// Time Series
// ============================================================================

export const usageTimeSeriesBucketSchema = z.object({
  timestamp: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  totalTokens: z.number(),
  costUsd: z.number(),
  tickCount: z.number(),
});

export const usageTotalsSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  totalTokens: z.number(),
  costUsd: z.number(),
  tickCount: z.number(),
});

export const usageTimeSeriesSchema = z.object({
  buckets: z.array(usageTimeSeriesBucketSchema),
  totals: usageTotalsSchema,
});

// ============================================================================
// Breakdown
// ============================================================================

export const usageBreakdownRowSchema = z.object({
  dimension: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  totalTokens: z.number(),
  costUsd: z.number(),
  tickCount: z.number(),
  percentOfTotal: z.number(),
});

// ============================================================================
// Cache Stats
// ============================================================================

export const cacheStatsSchema = z.object({
  totalInputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  cacheHitRate: z.number(),
  estimatedSavingsUsd: z.number(),
});

// ============================================================================
// Budget
// ============================================================================

export const budgetConfigSchema = z.object({
  weeklyBudgetUsd: z.number().min(0),
  budgetStartDate: z.string().nullable(),
  throttleEnabled: z.boolean(),
});

export const budgetStatusSchema = z.object({
  config: budgetConfigSchema,
  currentSpendUsd: z.number(),
  remainingUsd: z.number(),
  percentUsed: z.number(),
  throttleFactor: z.number(),
  effectiveIntervalMs: z.number(),
  estimatedHoursRemaining: z.number().nullable(),
  isHardStopped: z.boolean(),
  currentWindowStart: z.string(),
  currentWindowEnd: z.string(),
});

// ============================================================================
// Budget Alert (for ephemeral context injection)
// ============================================================================

export const budgetAlertSchema = z.object({
  threshold: z.number(),
  spentUsd: z.number(),
  limitUsd: z.number(),
  percentUsed: z.number(),
  message: z.string(),
});
