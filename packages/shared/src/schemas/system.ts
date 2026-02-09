/**
 * Schemas for system.db entities.
 *
 * Tables: users, contacts, contact_channels, channel_configs, settings
 */

import { z } from 'zod';
import {
  uuidSchema,
  timestampSchema,
  channelTypeSchema,
  permissionTierSchema,
  agentProviderSchema,
} from './common.js';

// ============================================================================
// Auth
// ============================================================================

export const loginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const registerInputSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8),
    confirmPassword: z.string().min(8),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const userSchema = z.object({
  id: uuidSchema,
  email: z.string().email(),
  contactId: uuidSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

// ============================================================================
// Contacts
// ============================================================================

export const contactSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema.nullable(), // FK → users.id (null for contacts without web UI accounts)
  fullName: z.string(),
  phoneNumber: z.string().nullable(),
  email: z.string().email().nullable(),
  isPrimary: z.boolean(),
  permissionTier: permissionTierSchema, // Derived from isPrimary, explicit for clarity
  notes: z.string().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const contactChannelSchema = z.object({
  id: uuidSchema,
  contactId: uuidSchema,
  channel: channelTypeSchema,
  identifier: z.string(),
  displayName: z.string().nullable(),
  isVerified: z.boolean(),
  createdAt: timestampSchema,
});

// ============================================================================
// Channel Configuration
// ============================================================================

export const channelConfigTypeSchema = z.enum([
  'sms',
  'discord',
  'openai_api',
  'ollama_api',
]);

export const smsChannelConfigSchema = z.object({
  accountSid: z.string().min(1),
  authToken: z.string().min(1),
  phoneNumber: z.string().min(1),
  webhookUrl: z.string().url(),
});

export const discordChannelConfigSchema = z.object({
  botToken: z.string().min(1),
  applicationId: z.string().min(1),
  allowedGuildIds: z.array(z.string()).default([]),
});

export const openaiApiChannelConfigSchema = z.object({});

export const ollamaApiChannelConfigSchema = z.object({});

export const channelConfigSchema = z.object({
  id: uuidSchema,
  channelType: channelConfigTypeSchema,
  isEnabled: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

// ============================================================================
// Settings
// ============================================================================

export const systemSettingsSchema = z.object({
  heartbeatIntervalMs: z.number().int().positive().default(300000),
  sessionWarmthMs: z.number().int().positive().default(900000),
  sessionContextBudget: z.number().positive().max(1).default(0.7),
  thoughtRetentionDays: z.number().int().positive().default(30),
  experienceRetentionDays: z.number().int().positive().default(30),
  emotionHistoryRetentionDays: z.number().int().positive().default(30),
  agentLogRetentionDays: z.number().int().positive().default(14),
  defaultAgentProvider: agentProviderSchema.default('claude'),
  goalApprovalMode: z
    .enum(['always_approve', 'auto_approve', 'full_autonomy'])
    .default('always_approve'),
  timezone: z.string().default('UTC'),
});

export const personalitySettingsSchema = z.object({
  name: z.string().min(1),
  traits: z.array(z.string()),
  communicationStyle: z.string(),
  values: z.array(z.string()),
});

export const updateSystemSettingsInputSchema = systemSettingsSchema.partial();
export const updatePersonalitySettingsInputSchema =
  personalitySettingsSchema.partial();
