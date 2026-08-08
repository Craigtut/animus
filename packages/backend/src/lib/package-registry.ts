/**
 * Package registry — install-time filesystem mechanics shared by channels and plugins.
 *
 * Channels and plugins are separate package types whose install, update, rollback,
 * and uninstall flows are mechanically identical: verify the .anpk, replace the
 * install directory, cache the archive for rollback. That code used to be
 * duplicated in ChannelManager and PluginManager, which is how both ended up
 * extracting into a single flat `data/packages/<name>/` namespace and deleting
 * each other's files.
 *
 * This module owns those mechanics once. The managers keep only what is genuinely
 * type-specific: process supervision for channels, component registration for plugins.
 *
 * The invariant that makes the collision impossible, independent of naming:
 * **never remove a directory this package cannot prove it owns.** Every install
 * stamps `.animus-package.json` into its directory, and every destructive
 * operation checks that stamp first.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import extractZip from 'extract-zip';
import type {
  PackageManifest,
  ChannelPackageManifest,
  PluginPackageManifest,
  VerificationResult,
} from '@animus-labs/shared';
import { verifyPackage } from '../services/package-verifier.js';
import { createLogger } from './logger.js';
import {
  type PackageKind,
  getPackageInstallDir,
  getPackageCacheDir,
  getPackageCachePath,
  migrateLegacyInstall,
  readPackageKind,
  findCachedPackage,
} from './package-paths.js';

const log = createLogger('PackageRegistry', 'server');

/** Ownership marker written into every install directory. */
export const STAMP_FILENAME = '.animus-package.json';

export interface PackageStamp {
  type: PackageKind;
  name: string;
  version: string;
  installedAt: string;
}

/**
 * Result of checking whether a directory belongs to a given package.
 *
 * - `owned`    — the directory is this package's, safe to replace
 * - `absent`   — nothing is there, safe to create
 * - `foreign`  — the directory holds a different package, must not be touched
 */
export type OwnershipVerdict =
  | { status: 'owned'; stamp: PackageStamp | null }
  | { status: 'absent' }
  | { status: 'foreign'; holder: string };

/** The concrete manifest type a given package kind carries. */
export type ManifestForKind<K extends PackageKind> = K extends 'channel'
  ? ChannelPackageManifest
  : PluginPackageManifest;

export interface StagedPackage<K extends PackageKind = PackageKind> {
  manifest: ManifestForKind<K>;
  verification: VerificationResult;
  anpkPath: string;
}

export interface MaterializedPackage {
  installDir: string;
  cachePath: string;
}

// ---------------------------------------------------------------------------
// Ownership stamps
// ---------------------------------------------------------------------------

export function readStamp(dir: string): PackageStamp | null {
  try {
    const raw = fs.readFileSync(path.join(dir, STAMP_FILENAME), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PackageStamp>;
    if (
      (parsed.type === 'channel' || parsed.type === 'plugin') &&
      typeof parsed.name === 'string' &&
      typeof parsed.version === 'string'
    ) {
      return {
        type: parsed.type,
        name: parsed.name,
        version: parsed.version,
        installedAt: parsed.installedAt ?? '',
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function writeStamp(
  dir: string,
  kind: PackageKind,
  name: string,
  version: string,
): Promise<void> {
  const stamp: PackageStamp = {
    type: kind,
    name,
    version,
    installedAt: new Date().toISOString(),
  };
  await fsp.writeFile(path.join(dir, STAMP_FILENAME), JSON.stringify(stamp, null, 2), 'utf-8');
}

/**
 * Determine whether `dir` belongs to the named package.
 *
 * Prefers the ownership stamp. Directories installed before stamping existed
 * fall back to the manifest's `packageType`, which is enough to tell a channel
 * from a plugin. A directory with neither is treated as owned, since only this
 * package's own record can point at it.
 */
export function verifyOwnership(dir: string, kind: PackageKind, name: string): OwnershipVerdict {
  if (!fs.existsSync(dir)) return { status: 'absent' };

  const stamp = readStamp(dir);
  if (stamp) {
    if (stamp.type === kind && stamp.name === name) return { status: 'owned', stamp };
    return { status: 'foreign', holder: `${stamp.type} "${stamp.name}"` };
  }

  const manifestKind = readPackageKind(dir);
  if (manifestKind && manifestKind !== kind) {
    return { status: 'foreign', holder: `a ${manifestKind} package` };
  }

  return { status: 'owned', stamp: null };
}

/**
 * Remove a package's install directory, refusing if it holds a different package.
 *
 * This is the guard that the old `fs.rm(extractDir, { recursive: true, force: true })`
 * lacked: it could not tell its own leftovers from another package's live install.
 */
export async function removeOwnedDir(
  dir: string,
  kind: PackageKind,
  name: string,
): Promise<void> {
  const verdict = verifyOwnership(dir, kind, name);
  if (verdict.status === 'absent') return;
  if (verdict.status === 'foreign') {
    throw new Error(
      `Refusing to remove ${dir}: it holds ${verdict.holder}, not the ${kind} "${name}". ` +
        `This usually means two packages share an install path.`,
    );
  }
  await fsp.rm(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Install mechanics
// ---------------------------------------------------------------------------

/**
 * Verify a .anpk and confirm it is the expected package type.
 * Performs no filesystem mutation.
 */
export async function stagePackage<K extends PackageKind>(
  kind: K,
  anpkPath: string,
): Promise<StagedPackage<K>> {
  const verification = await verifyPackage(anpkPath);
  if (!verification.valid || !verification.manifest) {
    throw new Error(`Package verification failed: ${verification.errors.join('; ')}`);
  }

  const manifest = verification.manifest;
  if (manifest.packageType !== kind) {
    throw new Error(`Expected ${kind} package but got "${manifest.packageType}"`);
  }

  return { manifest: manifest as ManifestForKind<K>, verification, anpkPath };
}

/**
 * Replace a package's install directory with the contents of its .anpk, stamp
 * ownership, and cache the archive for rollback.
 *
 * Refuses to touch a directory owned by another package. On extraction failure
 * the partial directory is cleaned up before rethrowing.
 */
export async function materializePackage<K extends PackageKind>(
  kind: K,
  staged: StagedPackage<K>,
): Promise<MaterializedPackage> {
  const { manifest, anpkPath } = staged;
  const installDir = getPackageInstallDir(kind, manifest.name);

  await removeOwnedDir(installDir, kind, manifest.name);
  await fsp.mkdir(installDir, { recursive: true });

  try {
    await extractZip(anpkPath, { dir: installDir });
  } catch (err) {
    await fsp.rm(installDir, { recursive: true, force: true });
    throw new Error(
      `Failed to extract package: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  await writeStamp(installDir, kind, manifest.name, manifest.version);

  const cacheDir = getPackageCacheDir(kind);
  await fsp.mkdir(cacheDir, { recursive: true });
  const cachePath = getPackageCachePath(kind, manifest.name, manifest.version);
  await fsp.copyFile(anpkPath, cachePath);

  return { installDir, cachePath };
}

/**
 * Restore a package from a cached .anpk (rollback).
 *
 * The pre-namespacing cache was keyed on name and version alone, so a channel
 * and a plugin sharing both collide there. The archive's manifest is therefore
 * re-checked after extraction rather than trusting the filename.
 */
export async function restoreFromCache(
  kind: PackageKind,
  name: string,
  version: string,
): Promise<MaterializedPackage> {
  const cachePath = findCachedPackage(kind, name, version);
  if (!cachePath) {
    throw new Error(`Cached package not found for ${name} v${version}`);
  }

  const staged = await stagePackage(kind, cachePath);
  if (staged.manifest.name !== name) {
    throw new Error(
      `Cached archive at ${cachePath} contains "${staged.manifest.name}", not "${name}"`,
    );
  }

  const installDir = getPackageInstallDir(kind, name);
  await removeOwnedDir(installDir, kind, name);
  await fsp.mkdir(installDir, { recursive: true });
  await extractZip(cachePath, { dir: installDir });
  await writeStamp(installDir, kind, name, version);

  return { installDir, cachePath };
}

/**
 * Resolve a package's install directory, migrating a pre-namespacing flat
 * install and back-filling its ownership stamp on first sight.
 *
 * Returns null when nothing on disk belongs to this package.
 */
export function resolveInstallDir(kind: PackageKind, name: string): string | null {
  const dir = migrateLegacyInstall(kind, name);
  if (!dir) return null;

  if (!readStamp(dir)) {
    const manifestKind = readPackageKind(dir);
    if (manifestKind === kind) {
      try {
        const raw = fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8');
        const version = (JSON.parse(raw) as { version?: string }).version ?? '0.0.0';
        fs.writeFileSync(
          path.join(dir, STAMP_FILENAME),
          JSON.stringify({ type: kind, name, version, installedAt: '' } satisfies PackageStamp, null, 2),
          'utf-8',
        );
        log.debug(`Back-filled ownership stamp for ${kind} "${name}"`);
      } catch {
        // Stamping is best-effort; verifyOwnership falls back to the manifest.
      }
    }
  }

  return dir;
}
