/**
 * Schemas for observational memory (memory.db).
 *
 * Tables: observations
 */

import { z } from 'zod';
import { uuidSchema, timestampSchema } from './common.js';

// ============================================================================
// Stream Type
// ============================================================================

export const streamTypeSchema = z.enum(['messages', 'thoughts', 'experiences']);

// ============================================================================
// Observation
// ============================================================================

export const observationSchema = z.object({
  id: uuidSchema,
  contactId: uuidSchema.nullable(),
  stream: streamTypeSchema,
  content: z.string(),
  tokenCount: z.number().int().nonnegative(),
  generation: z.number().int().min(1).default(1),
  lastRawId: z.string().nullable(),
  lastRawTimestamp: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

// ============================================================================
// Observation Events (EventBus payloads)
// ============================================================================

export const observationStartedEventSchema = z.object({
  stream: streamTypeSchema,
  contactId: z.string().nullable(),
  batchTokens: z.number().int().nonnegative(),
  cycleId: z.string(),
});

export const observationCompletedEventSchema = z.object({
  stream: streamTypeSchema,
  contactId: z.string().nullable(),
  observedTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
  cycleId: z.string(),
});

export const observationFailedEventSchema = z.object({
  stream: streamTypeSchema,
  contactId: z.string().nullable(),
  error: z.string(),
  cycleId: z.string(),
});

export const reflectionStartedEventSchema = z.object({
  stream: streamTypeSchema,
  contactId: z.string().nullable(),
  inputTokens: z.number().int().nonnegative(),
  compressionLevel: z.number().int().min(0).max(2),
  cycleId: z.string(),
});

export const reflectionCompletedEventSchema = z.object({
  stream: streamTypeSchema,
  contactId: z.string().nullable(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  generation: z.number().int().min(1),
  durationMs: z.number().nonnegative(),
  cycleId: z.string(),
});

export const reflectionFailedEventSchema = z.object({
  stream: streamTypeSchema,
  contactId: z.string().nullable(),
  error: z.string(),
  cycleId: z.string(),
});
