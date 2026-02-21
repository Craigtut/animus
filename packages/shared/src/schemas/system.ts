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
// Settings
// ============================================================================

export const systemSettingsSchema = z.object({
  heartbeatIntervalMs: z.number().int().positive().default(300000),
  sessionWarmthMs: z.number().int().positive().default(900000),
  sessionContextBudget: z.number().positive().max(1).default(0.7),
  thoughtRetentionDays: z.number().int().positive().default(14),
  experienceRetentionDays: z.number().int().positive().default(14),
  emotionHistoryRetentionDays: z.number().int().positive().default(14),
  agentLogRetentionDays: z.number().int().positive().default(7),
  taskRunRetentionDays: z.number().int().positive().default(7),
  defaultAgentProvider: agentProviderSchema.default('claude'),
  defaultModel: z.string().optional(),
  goalApprovalMode: z
    .enum(['always_approve', 'auto_approve', 'full_autonomy'])
    .default('always_approve'),
  timezone: z.string().default('UTC'),
  // Sleep & energy system
  energySystemEnabled: z.boolean().default(true),
  sleepStartHour: z.number().int().min(0).max(23).default(22),
  sleepEndHour: z.number().int().min(0).max(23).default(7),
  sleepTickIntervalMs: z.number().int().positive().default(1800000),
});

export const updateSystemSettingsInputSchema = systemSettingsSchema.partial();

// ============================================================================
// Onboarding
// ============================================================================

export const onboardingStateSchema = z.object({
  currentStep: z.number().int().min(0).max(8),
  isComplete: z.boolean(),
});

// ============================================================================
// Persona (expanded personality settings)
// ============================================================================

export const existenceParadigmSchema = z.enum(['simulated_life', 'digital_consciousness']);

export const personalityDimensionsSchema = z.object({
  extroversion: z.number().min(0).max(1).default(0.5),
  trust: z.number().min(0).max(1).default(0.5),
  leadership: z.number().min(0).max(1).default(0.5),
  optimism: z.number().min(0).max(1).default(0.5),
  confidence: z.number().min(0).max(1).default(0.5),
  empathy: z.number().min(0).max(1).default(0.5),
  cautious: z.number().min(0).max(1).default(0.5),
  patience: z.number().min(0).max(1).default(0.5),
  orderly: z.number().min(0).max(1).default(0.5),
  altruism: z.number().min(0).max(1).default(0.5),
});

export const archetypeSchema = z.enum([
  'scholar',
  'companion',
  'maverick',
  'sage',
  'guardian',
  'spark',
  'challenger',
  'dreamer',
]);

export const personaSchema = z.object({
  name: z.string().min(1),
  existenceParadigm: existenceParadigmSchema,
  location: z.string().nullable(),
  worldDescription: z.string().nullable(),
  gender: z.string().nullable(),
  age: z.number().int().positive().nullable(),
  physicalDescription: z.string().nullable(),
  personalityDimensions: personalityDimensionsSchema,
  traits: z.array(z.string()),
  values: z.array(z.string()),
  background: z.string().nullable(),
  personalityNotes: z.string().nullable(),
  archetype: archetypeSchema.nullable(),
  voiceId: z.string().nullable(),
  voiceSpeed: z.number().min(0.5).max(2.0).default(1.0),
  isFinalized: z.boolean(),
  // Legacy field for backwards compat with old personalitySettings reads
  communicationStyle: z.string().optional(),
});

export const personaDraftInputSchema = personaSchema
  .omit({ isFinalized: true, communicationStyle: true })
  .partial()
  .extend({ name: z.string().min(1).optional() });

export const personaUpdateInputSchema = personaSchema
  .omit({ isFinalized: true, communicationStyle: true })
  .partial();

/** @deprecated Use personaSchema. Kept for backwards compat with old settings router. */
export const personalitySettingsSchema = z.object({
  name: z.string().min(1),
  traits: z.array(z.string()),
  communicationStyle: z.string(),
  values: z.array(z.string()),
});

export const updatePersonalitySettingsInputSchema =
  personalitySettingsSchema.partial();
