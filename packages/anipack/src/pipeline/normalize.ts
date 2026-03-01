/**
 * Normalize — Convert plugin.json / channel.json into unified manifest.json.
 *
 * Takes the source manifest (either format) and produces the unified
 * PackageManifest format used inside .anpk archives.
 */

import type { PackageManifest } from '@animus-labs/shared';
import { SUPPORTED_FORMAT_VERSION } from '@animus-labs/shared';
import type { LoadedManifest } from '../utils/manifest.js';

/** Version of this build tool, injected at build time via tsup define. */
const BUILD_TOOL_VERSION = __ANIPACK_VERSION__;

export interface NormalizeOptions {
  sourceRepository?: string | undefined;
}

/**
 * Convert a loaded source manifest into the unified PackageManifest format.
 */
export function normalizeManifest(
  loaded: LoadedManifest,
  options?: NormalizeOptions,
): PackageManifest {
  const { type, raw } = loaded;
  const now = new Date().toISOString();

  // Common fields shared by both types
  const common = {
    formatVersion: SUPPORTED_FORMAT_VERSION,
    name: raw['name'] as string,
    displayName: (raw['displayName'] as string | undefined) ?? undefined,
    version: raw['version'] as string,
    description: raw['description'] as string,
    author: raw['author'] as { name: string; url?: string },
    license: (raw['license'] as string | undefined) ?? undefined,
    icon: raw['icon'] as string,
    engineVersion: (raw['engine'] as string | undefined) ?? undefined,
    configSchema: (raw['configSchema'] as string | undefined) ?? undefined,
    permissions: raw['permissions'] != null
      ? raw['permissions'] as PackageManifest['permissions']
      : undefined,
    store: raw['store'] != null
      ? raw['store'] as PackageManifest['store']
      : undefined,
    distribution: {
      buildDate: now,
      buildTool: `anipack/${BUILD_TOOL_VERSION}`,
      sourceRepository: options?.sourceRepository,
    },
  };

  if (type === 'plugin') {
    return {
      ...common,
      packageType: 'plugin' as const,
      components: (raw['components'] ?? {}) as PackageManifest & { packageType: 'plugin' } extends { components: infer C } ? C : never,
      dependencies: raw['dependencies'] != null
        ? raw['dependencies'] as PackageManifest & { packageType: 'plugin' } extends { dependencies: infer D } ? D : never
        : { plugins: [], system: {} },
      setup: (raw['setup'] as string | undefined) ?? undefined,
    };
  }

  // Channel
  return {
    ...common,
    packageType: 'channel' as const,
    channelType: (raw['type'] as string) ?? (raw['channelType'] as string),
    adapter: raw['adapter'] as string,
    identity: raw['identity'] as PackageManifest & { packageType: 'channel' } extends { identity: infer I } ? I : never,
    capabilities: raw['capabilities'] as PackageManifest & { packageType: 'channel' } extends { capabilities: infer C } ? C : never,
    replyGuidance: (raw['replyGuidance'] as string | undefined) ?? undefined,
    skills: (raw['skills'] as string | undefined) ?? undefined,
  };
}
