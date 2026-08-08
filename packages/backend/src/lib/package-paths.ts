/**
 * Package install paths — one directory namespace per package type.
 *
 * Channels and plugins are distinct package types that may legitimately share
 * a name: the `home-assistant` *channel* lets Home Assistant talk to Animus,
 * while the `home-assistant` *plugin* lets Animus control Home Assistant.
 *
 * Both used to extract to a flat `data/packages/<name>/`, and each installer's
 * conflict check only looked at its own table. Installing one therefore ran
 * `rm -rf` over the other's files, leaving a dangling DB row pointing at a
 * directory holding the wrong package. Each type now owns a subdirectory:
 *
 *   data/packages/channels/<name>/     data/packages/plugins/<name>/
 *   data/packages/channels/.cache/     data/packages/plugins/.cache/
 *
 * Installs from before this split still live in the flat layout, so lookups
 * fall back to it and `migrateLegacyInstall()` relocates a legacy directory
 * the first time its owner loads — but only when the manifest on disk proves
 * the directory actually belongs to that type.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../utils/env.js';
import { createLogger } from './logger.js';

const log = createLogger('PackagePaths', 'server');

export type PackageKind = 'channel' | 'plugin';

/** Subdirectory that owns each package type. */
const KIND_DIR: Record<PackageKind, string> = {
  channel: 'channels',
  plugin: 'plugins',
};

/** Root of all installed packages: `data/packages`. */
export function getPackagesRoot(): string {
  return path.join(DATA_DIR, 'packages');
}

/** Namespace directory for a package type: `data/packages/channels`. */
export function getPackageTypeDir(kind: PackageKind): string {
  return path.join(getPackagesRoot(), KIND_DIR[kind]);
}

/** Install directory for a package: `data/packages/channels/discord`. */
export function getPackageInstallDir(kind: PackageKind, name: string): string {
  return path.join(getPackageTypeDir(kind), name);
}

/** Rollback cache directory for a package type. */
export function getPackageCacheDir(kind: PackageKind): string {
  return path.join(getPackageTypeDir(kind), '.cache');
}

/** Cached .anpk path for a specific package version. */
export function getPackageCachePath(kind: PackageKind, name: string, version: string): string {
  return path.join(getPackageCacheDir(kind), `${name}-${version}.anpk`);
}

/** Pre-split install location: `data/packages/<name>`. */
export function getLegacyInstallDir(name: string): string {
  return path.join(getPackagesRoot(), name);
}

/** Pre-split rollback cache: `data/packages/.cache`. */
export function getLegacyCacheDir(): string {
  return path.join(getPackagesRoot(), '.cache');
}

/**
 * Read `packageType` from a package directory's manifest.json.
 * Returns null when the directory has no readable manifest or an
 * unrecognized type.
 */
export function readPackageKind(dir: string): PackageKind | null {
  try {
    const raw = fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { packageType?: unknown };
    if (parsed.packageType === 'channel' || parsed.packageType === 'plugin') {
      return parsed.packageType;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve a package's install directory, relocating a pre-split flat install
 * into its type namespace on first sight.
 *
 * Returns the resolved directory, or null when nothing on disk belongs to this
 * package. A legacy directory is only claimed when its manifest names the same
 * package type — otherwise it belongs to the other type (the survivor of an old
 * flat-namespace collision) and moving it would just relocate the corruption.
 */
export function migrateLegacyInstall(kind: PackageKind, name: string): string | null {
  const target = getPackageInstallDir(kind, name);
  if (fs.existsSync(target)) return target;

  const legacy = getLegacyInstallDir(name);
  if (!fs.existsSync(legacy)) return null;

  const legacyKind = readPackageKind(legacy);
  if (legacyKind !== kind) {
    log.warn(
      `Legacy package directory ${legacy} holds a ${legacyKind ?? 'unrecognized'} package, ` +
        `not the ${kind} "${name}" — leaving it for its owner`,
    );
    return null;
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(legacy, target);
  log.info(`Migrated ${kind} package "${name}" to ${target}`);
  return target;
}

/**
 * Locate a cached .anpk for rollback, checking the type namespace first and
 * falling back to the pre-split shared cache.
 *
 * The legacy cache is keyed only by name and version, so a channel and a plugin
 * sharing both will collide there. Callers must verify `packageType` after
 * extracting rather than trusting the filename.
 */
export function findCachedPackage(
  kind: PackageKind,
  name: string,
  version: string,
): string | null {
  const namespaced = getPackageCachePath(kind, name, version);
  if (fs.existsSync(namespaced)) return namespaced;

  const legacy = path.join(getLegacyCacheDir(), `${name}-${version}.anpk`);
  if (fs.existsSync(legacy)) return legacy;

  return null;
}
