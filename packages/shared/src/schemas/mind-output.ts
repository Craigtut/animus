/**
 * MindOutput structured output schema.
 *
 * This is the canonical schema for the mind's structured output per tick.
 * Defined in docs/architecture/heartbeat.md — do not duplicate the source
 * of truth elsewhere. This file IS the Zod implementation of that spec.
 *
 * Field ordering matters for streaming:
 *   thoughts → reply → experiences → emotionDeltas → decisions → memory
 */

import { z } from 'zod';
import { channelTypeSchema } from './common.js';
import { emotionNameSchema, decisionTypeSchema } from './heartbeat.js';
import { memoryTypeSchema } from './memory.js';

// ============================================================================
// MindOutput (message-triggered and interval ticks)
// ============================================================================

export const mindOutputSchema = z.object({
  // Think first
  thoughts: z.array(
    z.object({
      content: z.string(),
      importance: z.number().min(0).max(1),
    }),
  ),

  // Then speak
  reply: z
    .object({
      content: z.string(),
      contactId: z.string(),
      channel: channelTypeSchema,
      replyToMessageId: z.string(),
      tone: z.string().optional(),
    })
    .nullable(),

  // Then reflect
  experiences: z.array(
    z.object({
      content: z.string(),
      importance: z.number().min(0).max(1),
    }),
  ),

  emotionDeltas: z.array(
    z.object({
      emotion: emotionNameSchema,
      delta: z.number(),
      reasoning: z.string(),
    }),
  ),

  // Agency
  decisions: z.array(
    z.object({
      type: decisionTypeSchema,
      description: z.string(),
      parameters: z.record(z.unknown()),
    }),
  ),

  // Memory management
  workingMemoryUpdate: z.string().nullable(),
  coreSelfUpdate: z.string().nullable(),
  memoryCandidate: z
    .array(
      z.object({
        content: z.string(),
        memoryType: memoryTypeSchema,
        importance: z.number().min(0).max(1),
        contactId: z.string().optional(),
        keywords: z.array(z.string()).optional(),
      }),
    )
    .optional(),
});

// ============================================================================
// TaskTickOutput (scheduled/deferred task ticks)
// ============================================================================

export const taskResultOutcomeSchema = z.enum([
  'completed',
  'delegated',
  'skipped',
  'failed',
]);

export const taskTickOutputSchema = z.object({
  // Always produced (same as normal ticks)
  thoughts: z.array(
    z.object({
      content: z.string(),
      importance: z.number().min(0).max(1),
    }),
  ),

  experiences: z.array(
    z.object({
      content: z.string(),
      importance: z.number().min(0).max(1),
    }),
  ),

  emotionDeltas: z.array(
    z.object({
      emotion: emotionNameSchema,
      delta: z.number(),
      reasoning: z.string(),
    }),
  ),

  // Agency
  decisions: z.array(
    z.object({
      type: decisionTypeSchema,
      description: z.string(),
      parameters: z.record(z.unknown()),
    }),
  ),

  // Memory management
  workingMemoryUpdate: z.string().nullable().optional(),
  coreSelfUpdate: z.string().nullable().optional(),
  memoryCandidate: z
    .array(
      z.object({
        content: z.string(),
        memoryType: memoryTypeSchema,
        importance: z.number().min(0).max(1),
        contactId: z.string().optional(),
        keywords: z.array(z.string()).optional(),
      }),
    )
    .optional(),

  // Task-specific (replaces reply from MindOutput)
  taskResult: z.object({
    taskId: z.string(),
    outcome: taskResultOutcomeSchema,
    result: z.string().optional(),
    skipReason: z.string().optional(),
    failureReason: z.string().optional(),
    messageToUser: z.string().optional(),
  }),
});
