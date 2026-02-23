/**
 * Package Manifest — Unified Zod schema for .anpk packages.
 *
 * A discriminated union on `packageType` that covers both plugins and channels
 * in a single manifest format. The `anipack` CLI normalizes plugin.json /
 * channel.json into this unified manifest.json at build time.
 *
 * See: animus-extensions/docs/architecture/package-format.md
 */

import { z } from 'zod';
import { channelCapabilitySchema, channelIdentitySchema } from './channel-packages.js';

// ============================================================================
// Shared Sub-Schemas
// ============================================================================

export const packageAuthorSchema = z.object({
  name: z.string().min(1),
  url: z.string().url().optional(),
});

/** Permissions declared by a package in the unified manifest. */
export const packagePermissionsSchema = z.object({
  tools: z.array(z.string()).default([]),
  network: z.union([z.array(z.string()), z.boolean()]).default(false),
  filesystem: z.enum(['none', 'read-only', 'read-write']).default('none'),
  contacts: z.boolean().default(false),
  memory: z.enum(['none', 'read-only', 'read-write']).default('none'),
});

export const packageStorePricingSchema = z.object({
  model: z.enum(['free', 'paid']).default('free'),
  price: z.number().nullable().default(null),
  currency: z.string().nullable().default(null),
});

export const packageStoreMetadataSchema = z.object({
  categories: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  pricing: packageStorePricingSchema.optional(),
  screenshots: z.array(z.string()).default([]),
  changelog: z.string().optional(),
});

export const packageDistributionSchema = z.object({
  buildDate: z.string(),
  buildTool: z.string(),
  sourceRepository: z.string().optional(),
  checksum: z.string().optional(),
  signedBy: z.string().optional(),
});

// ============================================================================
// Plugin Components (paths to component directories/files)
// ============================================================================

export const pluginComponentsSchema = z.object({
  skills: z.string().optional(),
  tools: z.string().optional(),
  context: z.string().optional(),
  hooks: z.string().optional(),
  decisions: z.string().optional(),
  triggers: z.string().optional(),
  agents: z.string().optional(),
});

export const pluginDependenciesSchema = z.object({
  plugins: z.array(z.string()).default([]),
  system: z.record(z.string()).default({}),
});

// ============================================================================
// Common Fields (shared by both plugin and channel manifests)
// ============================================================================

const packageManifestCommon = {
  formatVersion: z.number().int().positive().default(1),
  name: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/),
  displayName: z.string().min(1).optional(),
  version: z.string().regex(/^\d+\.\d+\.\d+/),
  description: z.string().max(200),
  author: packageAuthorSchema,
  license: z.string().optional(),
  icon: z.string().min(1),
  engineVersion: z.string().optional(),
  configSchema: z.string().optional(),
  permissions: packagePermissionsSchema.optional(),
  store: packageStoreMetadataSchema.optional(),
  distribution: packageDistributionSchema.optional(),
};

// ============================================================================
// Plugin Package Manifest
// ============================================================================

export const pluginPackageManifestSchema = z.object({
  ...packageManifestCommon,
  packageType: z.literal('plugin'),
  components: pluginComponentsSchema,
  dependencies: pluginDependenciesSchema.default({}),
  setup: z.string().optional(),
});

// ============================================================================
// Channel Package Manifest
// ============================================================================

export const channelPackageManifestSchema = z.object({
  ...packageManifestCommon,
  packageType: z.literal('channel'),
  channelType: z.string().min(1),
  adapter: z.string().min(1),
  identity: channelIdentitySchema,
  capabilities: z.array(channelCapabilitySchema),
  replyGuidance: z.string().optional(),
  skills: z.string().optional(),
});

// ============================================================================
// Discriminated Union
// ============================================================================

/** Unified package manifest — discriminated union on `packageType`. */
export const PackageManifestSchema = z.discriminatedUnion('packageType', [
  pluginPackageManifestSchema,
  channelPackageManifestSchema,
]);

// ============================================================================
// CHECKSUMS File Format
// ============================================================================

/** A single checksum entry: "sha256:<hex> <relative-path>" */
export const checksumEntrySchema = z.object({
  algorithm: z.literal('sha256'),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  path: z.string().min(1),
});

// ============================================================================
// SIGNATURE File Format
// ============================================================================

export const signatureFileSchema = z.object({
  formatVersion: z.number().int().positive().default(1),
  algorithm: z.literal('ed25519'),
  publicKey: z.string().min(1),
  signature: z.string().min(1),
  payload: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  signedAt: z.string(),
  signedBy: z.string().min(1),
});

// ============================================================================
// Signature Status
// ============================================================================

export const signatureStatusSchema = z.enum(['valid', 'invalid', 'unsigned']);

// ============================================================================
// Install Source (extends existing pluginSourceSchema)
// ============================================================================

export const installSourceSchema = z.enum([
  'built-in',
  'local',
  'git',
  'npm',
  'store',
  'package',
]);
