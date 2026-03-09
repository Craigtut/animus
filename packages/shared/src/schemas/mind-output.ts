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
  thought: z.object({
    content: z.string(),
    importance: z.number().min(0).max(1),
  }),

  // Then speak
  reply: z
    .object({
      content: z.string(),
      contactId: z.string(),
      channel: channelTypeSchema,
      replyToMessageId: z.string().nullable(),
      tone: z.string().optional(),
      media: z.array(z.object({
        type: z.enum(['image', 'audio', 'video', 'file']),
        path: z.string(),
        filename: z.string().optional(),
      })).optional(),
    })
    .nullable(),

  // Then reflect
  experience: z.object({
    content: z.string(),
    importance: z.number().min(0).max(1),
  }),

  emotionDeltas: z.array(
    z.object({
      emotion: emotionNameSchema,
      delta: z.number(),
      reasoning: z.string(),
    }),
  ),

  // Energy
  energyDelta: z
    .object({
      delta: z.number(),
      reasoning: z.string(),
    })
    .optional(),

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
        type: memoryTypeSchema,
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
  thought: z.object({
    content: z.string(),
    importance: z.number().min(0).max(1),
  }),

  experience: z.object({
    content: z.string(),
    importance: z.number().min(0).max(1),
  }),

  emotionDeltas: z.array(
    z.object({
      emotion: emotionNameSchema,
      delta: z.number(),
      reasoning: z.string(),
    }),
  ),

  // Energy
  energyDelta: z
    .object({
      delta: z.number(),
      reasoning: z.string(),
    })
    .optional(),

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
        type: memoryTypeSchema,
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
