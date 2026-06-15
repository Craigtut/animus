/**
 * Package settings surfaces.
 *
 * These schemas describe ongoing package management UI. They are separate from
 * setup config, which remains responsible for credentials and required setup.
 */

import { z } from 'zod/v3';
import { configSchemaSchema } from './channel-packages.js';

export const packageTypeSchema = z.enum(['plugin', 'channel']);

export const packageSettingsActionSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  timeoutMs: z.number().int().positive().max(60_000).default(15_000),
});

export const packageSettingsSurfaceTypeSchema = z.enum([
  'form',
  'entity-picker',
  'remote-collection',
  'status',
]);

export const packageSettingsSurfaceSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9][a-z0-9_-]*$/),
  label: z.string().min(1),
  description: z.string().optional(),
  type: packageSettingsSurfaceTypeSchema,
  settingsKey: z.string().min(1).optional(),
  configSchema: configSchemaSchema.optional(),
  actions: z.record(packageSettingsActionSchema).default({}),
});

export const packageSettingsManifestSchema = z.object({
  surfaces: z.array(packageSettingsSurfaceSchema).default([]),
});
