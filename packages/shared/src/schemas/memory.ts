/**
 * Schemas for memory.db entities.
 *
 * Tables: working_memory, core_self, long_term_memories
 */

import { z } from 'zod/v3';
import { uuidSchema, timestampSchema } from './common.js';

// ============================================================================
// Working Memory (per-contact notepad)
// ============================================================================

export const workingMemorySchema = z.object({
  contactId: uuidSchema, // PK
  content: z.string(),
  tokenCount: z.number().int().nonnegative().default(0),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

// ============================================================================
// Core Self (singleton)
// ============================================================================

export const coreSelfSchema = z.object({
  id: z.literal(1),
  content: z.string(),
  tokenCount: z.number().int().nonnegative().default(0),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

// ============================================================================
// Long-Term Memory
// ============================================================================

export const memoryTypeSchema = z.enum([
  'fact',
  'experience',
  'procedure',
  'outcome',
]);

export const memorySourceTypeSchema = z.enum([
  'thought',
  'experience',
  'conversation',
  'agent_result',
  'goal',
  'explicit',
]);

export const longTermMemorySchema = z.object({
  id: uuidSchema,
  content: z.string(),
  importance: z.number().min(0).max(1),
  memoryType: memoryTypeSchema,
  sourceType: memorySourceTypeSchema.nullable(),
  sourceId: uuidSchema.nullable(),
  contactId: uuidSchema.nullable(),
  keywords: z.array(z.string()),
  strength: z.number().int().positive().default(1),
  createdAt: timestampSchema,
  lastAccessedAt: timestampSchema,
  updatedAt: timestampSchema,
});

// ============================================================================
// Memory Candidate (mind output → write pipeline)
// ============================================================================

export const memoryCandidateSchema = z.object({
  content: z.string(),
  memoryType: memoryTypeSchema,
  importance: z.number().min(0).max(1),
  contactId: z.string().optional(),
  keywords: z.array(z.string()).optional(),
});
