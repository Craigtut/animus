/**
 * Schemas for agent_logs.db entities.
 *
 * Tables: agent_sessions, agent_events, agent_usage
 */

import { z } from 'zod/v3';
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
  'turn_end',
  'error',
  'compaction',
  'compaction_error',
  'tick_input',
  'tick_output',
  'message_injected',
  // Cortex pipeline phase events
  'thought_start',
  'thought_end',
  'thought_failed',
  'agentic_start',
  'agentic_end',
  'reflect_start',
  'reflect_end',
  'reflect_failed',
  // Context snapshot events
  'phase_context_snapshot',
  // Execute phase observability events
  'execute_start',
  'execute_reply_sent',
  'execute_transaction_complete',
  'execute_decisions_complete',
  'execute_memory_complete',
  'execute_complete',
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
  tickNumber: z.number().int().nonnegative().nullable().optional(),
  tickType: z.string().nullable().optional(),
  pipelinePhase: z.string().nullable().optional(),
  contactId: uuidSchema.nullable().optional(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative().default(0),
  cacheWriteTokens: z.number().int().nonnegative().default(0),
  totalTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative().nullable(),
  model: z.string(),
  createdAt: timestampSchema,
});
