import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Must use vi.hoisted so the variable is available when vi.mock factories run.
const { tmpDir } = vi.hoisted(() => {
  const nodePath = require('node:path');
  const nodeOs = require('node:os');
  const tmpDir = nodePath.join(
    nodeOs.tmpdir(),
    `pkgpaths-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  return { tmpDir };
});

vi.mock('../../utils/env.js', () => ({ DATA_DIR: tmpDir }));

vi.mock('../logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  getPackagesRoot,
  getPackageInstallDir,
  getPackageCacheDir,
  getPackageCachePath,
  getLegacyInstallDir,
  getLegacyCacheDir,
  readPackageKind,
  migrateLegacyInstall,
  findCachedPackage,
} from '../package-paths.js';

function writeManifest(dir: string, packageType: string, name: string, version = '1.0.0'): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ name, version, packageType }),
    'utf-8',
  );
}

describe('package-paths', () => {
  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('namespacing', () => {
    it('gives a channel and a plugin of the same name different install dirs', () => {
      const channelDir = getPackageInstallDir('channel', 'home-assistant');
      const pluginDir = getPackageInstallDir('plugin', 'home-assistant');

      expect(channelDir).not.toBe(pluginDir);
      expect(channelDir).toBe(path.join(getPackagesRoot(), 'channels', 'home-assistant'));
      expect(pluginDir).toBe(path.join(getPackagesRoot(), 'plugins', 'home-assistant'));
    });

    it('gives each package type its own rollback cache', () => {
      expect(getPackageCacheDir('channel')).not.toBe(getPackageCacheDir('plugin'));
      expect(getPackageCachePath('channel', 'home-assistant', '1.0.0')).not.toBe(
        getPackageCachePath('plugin', 'home-assistant', '1.0.0'),
      );
    });
  });

  describe('readPackageKind', () => {
    it('reads packageType from a manifest', () => {
      const dir = path.join(tmpDir, 'some-pkg');
      writeManifest(dir, 'channel', 'discord');
      expect(readPackageKind(dir)).toBe('channel');
    });

    it('returns null for a missing or unreadable manifest', () => {
      expect(readPackageKind(path.join(tmpDir, 'nope'))).toBeNull();
    });

    it('returns null for an unrecognized packageType', () => {
      const dir = path.join(tmpDir, 'weird');
      writeManifest(dir, 'widget', 'weird');
      expect(readPackageKind(dir)).toBeNull();
    });
  });

  describe('migrateLegacyInstall', () => {
    it('relocates a legacy flat install into its type namespace', () => {
      const legacy = getLegacyInstallDir('discord');
      writeManifest(legacy, 'channel', 'discord');
      fs.writeFileSync(path.join(legacy, 'adapter.js'), '// adapter', 'utf-8');

      const result = migrateLegacyInstall('channel', 'discord');

      expect(result).toBe(getPackageInstallDir('channel', 'discord'));
      expect(fs.existsSync(path.join(result!, 'adapter.js'))).toBe(true);
      expect(fs.existsSync(legacy)).toBe(false);
    });

    it('refuses to claim a legacy dir belonging to the other package type', () => {
      // Exactly the post-collision state: the flat dir holds the plugin's files
      // while the channel record still points at it.
      const legacy = getLegacyInstallDir('home-assistant');
      writeManifest(legacy, 'plugin', 'home-assistant', '1.1.0');

      const result = migrateLegacyInstall('channel', 'home-assistant');

      expect(result).toBeNull();
      expect(fs.existsSync(legacy)).toBe(true);
      expect(fs.existsSync(getPackageInstallDir('channel', 'home-assistant'))).toBe(false);
    });

    it('prefers an existing namespaced install over the legacy dir', () => {
      const namespaced = getPackageInstallDir('channel', 'discord');
      writeManifest(namespaced, 'channel', 'discord', '2.0.0');
      const legacy = getLegacyInstallDir('discord');
      writeManifest(legacy, 'channel', 'discord', '1.0.0');

      expect(migrateLegacyInstall('channel', 'discord')).toBe(namespaced);
      expect(fs.existsSync(legacy)).toBe(true);
    });

    it('returns null when nothing is on disk', () => {
      expect(migrateLegacyInstall('plugin', 'ghost')).toBeNull();
    });
  });

  describe('findCachedPackage', () => {
    it('prefers the type-namespaced cache', () => {
      const namespaced = getPackageCachePath('channel', 'home-assistant', '1.0.0');
      fs.mkdirSync(path.dirname(namespaced), { recursive: true });
      fs.writeFileSync(namespaced, 'ns', 'utf-8');

      const legacy = path.join(getLegacyCacheDir(), 'home-assistant-1.0.0.anpk');
      fs.mkdirSync(path.dirname(legacy), { recursive: true });
      fs.writeFileSync(legacy, 'legacy', 'utf-8');

      expect(findCachedPackage('channel', 'home-assistant', '1.0.0')).toBe(namespaced);
    });

    it('falls back to the legacy shared cache', () => {
      const legacy = path.join(getLegacyCacheDir(), 'discord-2.0.0.anpk');
      fs.mkdirSync(path.dirname(legacy), { recursive: true });
      fs.writeFileSync(legacy, 'legacy', 'utf-8');

      expect(findCachedPackage('channel', 'discord', '2.0.0')).toBe(legacy);
    });

    it('returns null when no cached archive exists', () => {
      expect(findCachedPackage('plugin', 'ghost', '9.9.9')).toBeNull();
    });
  });
});
