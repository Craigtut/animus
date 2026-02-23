/**
 * Channel Packages — Zod schemas for installable channel adapters.
 *
 * Covers: channel.json manifests, config schema definitions,
 * package DB records, IPC message types, and frontend channel info.
 */

import { z } from 'zod';

// ============================================================================
// Channel Manifest (from channel.json)
// ============================================================================

export const channelManifestAuthorSchema = z.object({
  name: z.string().min(1),
  url: z.string().url().optional(),
});

export const channelIdentitySchema = z.object({
  identifierLabel: z.string().min(1),
  identifierPlaceholder: z.string().optional(),
  identifierValidation: z.string().optional(), // regex pattern
  identifierHelpText: z.string().optional(),
});

export const channelCapabilitySchema = z.enum([
  'text',
  'media-inbound',
  'media-outbound',
  'markdown',
  'embeds',
  'reactions',
  'typing-indicator',
  'voice-messages',
  'conversation-history',
]);

export const channelPermissionsSchema = z.object({
  network: z.array(z.string()).default([]),
  env: z.array(z.string()).default([]),
});

export const channelStoreMetadataSchema = z.object({
  categories: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
});

export const channelManifestSchema = z.object({
  $schema: z.string().optional(),
  name: z.string().min(1).regex(/^[a-z0-9-]+$/), // lowercase, hyphens
  type: z.string().min(1), // channel type string
  displayName: z.string().min(1),
  description: z.string().min(1),
  version: z.string().min(1), // semver
  author: channelManifestAuthorSchema,
  license: z.string().optional(),
  engine: z.string().optional(), // minimum engine version
  icon: z.string().min(1), // relative path
  adapter: z.string().min(1), // relative path to adapter.js
  identity: channelIdentitySchema,
  capabilities: z.array(channelCapabilitySchema),
  replyGuidance: z.string().min(1),
  permissions: channelPermissionsSchema.optional(),
  store: channelStoreMetadataSchema.optional(),
  skills: z.string().optional(),
});

// ============================================================================
// Config Schema (from config.schema.json)
// ============================================================================

export const configFieldTypeSchema = z.enum([
  'text',
  'secret',
  'url',
  'number',
  'select',
  'text-list',
  'toggle',
]);

export const configFieldOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
});

export const configFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: configFieldTypeSchema,
  required: z.boolean().default(false),
  placeholder: z.string().optional(),
  helpText: z.string().optional(),
  validation: z.string().optional(), // regex pattern
  options: z.array(configFieldOptionSchema).optional(), // for 'select' type
  default: z.unknown().optional(),
  min: z.number().optional(), // for 'number' type
  max: z.number().optional(), // for 'number' type
});

export const setupGuideLinkSchema = z.object({
  url: z.string().url(),
  label: z.string().min(1),
});

export const setupGuideStepSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  link: setupGuideLinkSchema.optional(),
  manifest: z.string().optional(), // code block content (e.g., YAML manifest to copy)
});

export const setupGuideSchema = z.object({
  description: z.string().optional(),
  steps: z.array(setupGuideStepSchema),
});

export const configSchemaSchema = z.object({
  setupGuide: setupGuideSchema.optional(),
  fields: z.array(configFieldSchema),
});

// ============================================================================
// Channel Package Status & DB Record
// ============================================================================

export const channelPackageStatusSchema = z.enum([
  'disabled',
  'unconfigured',
  'starting',
  'connected',
  'error',
  'failed',
]);

export const channelPackageSchema = z.object({
  name: z.string().min(1),
  channelType: z.string().min(1),
  version: z.string().min(1),
  path: z.string().min(1),
  enabled: z.boolean(),
  config: z.record(z.unknown()).nullable(),
  installedAt: z.string(),
  updatedAt: z.string(),
  checksum: z.string().min(1),
  status: channelPackageStatusSchema,
  lastError: z.string().nullable(),
  installedFrom: z.enum(['local', 'package']).default('local'),
});

// ============================================================================
// Channel Info (frontend display)
// ============================================================================

export const channelInfoSchema = z.object({
  name: z.string(),
  channelType: z.string(),
  displayName: z.string(),
  description: z.string(),
  version: z.string(),
  author: channelManifestAuthorSchema,
  icon: z.string(),
  capabilities: z.array(channelCapabilitySchema),
  identity: channelIdentitySchema,
  enabled: z.boolean(),
  status: channelPackageStatusSchema,
  lastError: z.string().nullable(),
  installedAt: z.string(),
  installedFrom: z.enum(['local', 'package']).default('local'),
});

// ============================================================================
// IPC Message Types (parent <-> child communication)
// ============================================================================

export const ipcMessageTypeSchema = z.enum([
  // Main -> Child
  'init',
  'send',
  'stop',
  'route_request',
  'resolve_contact_response',
  'media_download_response',
  'config_update',
  'ping',
  'get_history',
  // Child -> Main
  'ready',
  'incoming',
  'send_response',
  'route_response',
  'route_response_stream_start',
  'route_response_chunk',
  'route_response_end',
  'resolve_contact',
  'media_download',
  'log',
  'route_register',
  'error',
  'stop_ack',
  'pong',
  'history_response',
]);

export const ipcMessageBaseSchema = z.object({
  type: ipcMessageTypeSchema,
  id: z.string().optional(), // correlation ID for request/response pairs
});

// ============================================================================
// Channel Status Event (tRPC subscription)
// ============================================================================

export const channelStatusEventSchema = z.object({
  name: z.string(),
  channelType: z.string(),
  status: channelPackageStatusSchema,
  lastError: z.string().nullable(),
});
