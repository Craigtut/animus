/**
 * Schemas for agent_logs.db entities.
 *
 * Tables: agent_sessions, agent_events, agent_usage
 */

import { z } from 'zod';
import { uuidSchema, timestampSchema, agentProviderSchema } from './common.js';

// ============================================================================
// Agent Sessions
// ============================================================================

export const agentSessionStatusSchema = z.enum([
  'active',
  'completed',
  'error',
  'cancelled',
]);

export const agentSessionSchema = z.object({
  id: uuidSchema,
  provider: agentProviderSchema,
  model: z.string().nullable(),
  startedAt: timestampSchema,
  endedAt: timestampSchema.nullable(),
  status: agentSessionStatusSchema,
});

// ============================================================================
// Agent Events
// ============================================================================

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

export const agentEventSchema = z.object({
  id: uuidSchema,
  sessionId: uuidSchema,
  eventType: agentEventTypeSchema,
  data: z.record(z.unknown()),
  createdAt: timestampSchema,
});

// ============================================================================
// Agent Usage (token tracking)
// ============================================================================

export const agentUsageSchema = z.object({
  sessionId: uuidSchema,
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative().nullable(),
  model: z.string(),
  createdAt: timestampSchema,
});
