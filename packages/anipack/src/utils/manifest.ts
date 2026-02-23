/**
 * Manifest utilities — Load and detect plugin.json / channel.json from a directory.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { PluginManifestSchema, channelManifestSchema } from '@animus-labs/shared';
import type { z } from 'zod';

export type ManifestType = 'plugin' | 'channel';

export interface LoadedManifest {
  type: ManifestType;
  filePath: string;
  raw: Record<string, unknown>;
  parsed: z.infer<typeof PluginManifestSchema> | z.infer<typeof channelManifestSchema>;
}

/**
 * Detect and load plugin.json or channel.json from a source directory.
 * Returns the parsed manifest and its type.
 */
export async function loadSourceManifest(sourceDir: string): Promise<LoadedManifest> {
  const pluginPath = path.join(sourceDir, 'plugin.json');
  const channelPath = path.join(sourceDir, 'channel.json');

  const [hasPlugin, hasChannel] = await Promise.all([
    fileExists(pluginPath),
    fileExists(channelPath),
  ]);

  if (hasPlugin && hasChannel) {
    throw new Error(
      'Directory contains both plugin.json and channel.json. Only one is allowed.',
    );
  }

  if (!hasPlugin && !hasChannel) {
    throw new Error(
      'Directory must contain either plugin.json or channel.json.',
    );
  }

  const manifestPath = hasPlugin ? pluginPath : channelPath;
  const type: ManifestType = hasPlugin ? 'plugin' : 'channel';

  const content = await fs.readFile(manifestPath, 'utf-8');
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new Error(`Failed to parse ${path.basename(manifestPath)}: invalid JSON.`);
  }

  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${path.basename(manifestPath)} must be a JSON object.`);
  }

  const schema = type === 'plugin' ? PluginManifestSchema : channelManifestSchema;
  const result = schema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Manifest validation failed:\n${issues}`,
    );
  }

  return {
    type,
    filePath: manifestPath,
    raw: raw as Record<string, unknown>,
    parsed: result.data,
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export { fileExists };
