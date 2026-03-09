/**
 * Schemas for the save/restore system.
 *
 * These are not tied to a specific database — they describe the
 * on-disk save archive format and the runtime save listing.
 */

import { z } from 'zod';
import { uuidSchema } from './common.js';

// ============================================================================
// Save Manifest (stored inside each save archive)
// ============================================================================

export const saveManifestSchema = z.object({
  version: z.literal(1),
  name: z.string(),
  description: z.string().optional(),
  createdAt: z.string(), // ISO 8601
  animusVersion: z.string(),
  schemaVersions: z.record(z.string(), z.number()), // db name -> migration version
  stats: z.object({
    tickCount: z.number(),
    messageCount: z.number(),
    memoryCount: z.number(),
    personaName: z.string().optional(),
  }),
  isAutosave: z.boolean().optional(),
});

// ============================================================================
// Save Info (runtime listing entry)
// ============================================================================

export const saveInfoSchema = z.object({
  id: uuidSchema,
  manifest: saveManifestSchema,
  sizeBytes: z.number(),
  isAutosave: z.boolean(),
});
