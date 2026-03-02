/**
 * Schemas for messages.db entities.
 *
 * Tables: conversations, messages, media_attachments
 */

import { z } from 'zod';
import { uuidSchema, timestampSchema, channelTypeSchema } from './common.js';

// ============================================================================
// Conversations
// ============================================================================

export const conversationSchema = z.object({
  id: uuidSchema,
  contactId: uuidSchema,
  channel: channelTypeSchema,
  startedAt: timestampSchema,
  lastMessageAt: timestampSchema.nullable(),
  isActive: z.boolean(),
});

// ============================================================================
// Media Attachments (stored in messages.db, linked to messages)
// ============================================================================

export const mediaAttachmentTypeSchema = z.enum([
  'image',
  'audio',
  'video',
  'file',
]);

export const storedMediaAttachmentSchema = z.object({
  id: uuidSchema,
  messageId: uuidSchema,
  type: mediaAttachmentTypeSchema,
  mimeType: z.string(),
  localPath: z.string(),
  originalFilename: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative(),
  createdAt: timestampSchema,
  expiresAt: timestampSchema.nullable(),
});

// ============================================================================
// Messages
// ============================================================================

export const messageDirectionSchema = z.enum(['inbound', 'outbound']);

export const deliveryStatusSchema = z.enum(['pending', 'sent', 'failed']);

export const messageSchema = z.object({
  id: uuidSchema,
  conversationId: uuidSchema,
  contactId: uuidSchema,
  direction: messageDirectionSchema,
  channel: channelTypeSchema,
  content: z.string(),
  metadata: z.record(z.unknown()).nullable(),
  tickNumber: z.number().int().nonnegative().nullable(),
  createdAt: timestampSchema,
  attachments: z.array(storedMediaAttachmentSchema).optional(),
  deliveryStatus: deliveryStatusSchema.nullable().optional(),
  externalId: z.string().nullable().optional(),
  deliveryError: z.string().nullable().optional(),
  mindNotified: z.boolean().nullable().optional(),
});

export const sendMessageInputSchema = z.object({
  conversationId: uuidSchema.optional(),
  channel: channelTypeSchema,
  content: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});
