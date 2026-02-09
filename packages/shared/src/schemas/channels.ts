/**
 * Channel adapter runtime schemas.
 *
 * These are not stored in any database — they represent the normalized
 * runtime types used by the channel adapter layer and heartbeat pipeline.
 */

import { z } from 'zod';
import { uuidSchema, timestampSchema, channelTypeSchema, permissionTierSchema } from './common.js';
import { mediaAttachmentTypeSchema } from './messages.js';

// ============================================================================
// Resolved Contact (identity resolution result)
// ============================================================================

export const resolvedContactSchema = z.object({
  id: uuidSchema,
  fullName: z.string(),
  permissionTier: permissionTierSchema,
});

// ============================================================================
// Media Attachment (runtime, before DB persistence)
// ============================================================================

export const mediaAttachmentSchema = z.object({
  id: uuidSchema,
  type: mediaAttachmentTypeSchema,
  mimeType: z.string(),
  localPath: z.string(),
  originalFilename: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative(),
});

// ============================================================================
// Incoming Message (normalized from any channel)
// ============================================================================

export const incomingMessageSchema = z.object({
  channel: channelTypeSchema,
  channelIdentifier: z.string(),
  contact: resolvedContactSchema.nullable(),
  conversationId: z.string().nullable(),
  content: z.string(),
  media: z.array(mediaAttachmentSchema).optional(),
  rawMetadata: z.record(z.unknown()),
  receivedAt: timestampSchema,
});
