/**
 * Common base schemas used across all domains.
 */

import { z } from 'zod';

// ============================================================================
// Primitives
// ============================================================================

export const uuidSchema = z.string().uuid();
export const timestampSchema = z.string().datetime();

// ============================================================================
// Shared Enums
// ============================================================================

/** Supported communication channels — dynamic string (packages add new types) */
export const channelTypeSchema = z.string().min(1);

/** Built-in channel type (always available) */
export const BUILT_IN_CHANNELS = ['web'] as const;

/** Known channel types (built-in + first-party packages) */
export const KNOWN_CHANNEL_TYPES = ['web', 'sms', 'discord', 'api', 'voice'] as const;

/** Contact permission tier */
export const permissionTierSchema = z.enum(['primary', 'standard']);

/** Supported agent SDK providers */
export const agentProviderSchema = z.enum(['claude', 'codex', 'opencode']);

// ============================================================================
// Pagination
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
