import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const { tmpDir } = vi.hoisted(() => {
  const nodePath = require('node:path');
  const nodeOs = require('node:os');
  const tmpDir = nodePath.join(
    nodeOs.tmpdir(),
    `pkgreg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

// A .anpk in these tests is a JSON file describing what the archive holds.
// extract-zip is stubbed to expand that description onto disk, which keeps the
// tests focused on ownership and path logic rather than zip mechanics.
vi.mock('extract-zip', () => ({
  default: async (archivePath: string, opts: { dir: string }) => {
    const spec = JSON.parse(fs.readFileSync(archivePath, 'utf-8')) as {
      manifest: Record<string, unknown>;
      files?: Record<string, string>;
    };
    fs.mkdirSync(opts.dir, { recursive: true });
    fs.writeFileSync(
      path.join(opts.dir, 'manifest.json'),
      JSON.stringify(spec.manifest),
      'utf-8',
    );
    for (const [name, contents] of Object.entries(spec.files ?? {})) {
      fs.writeFileSync(path.join(opts.dir, name), contents, 'utf-8');
    }
  },
}));

vi.mock('../../services/package-verifier.js', () => ({
  verifyPackage: async (archivePath: string) => {
    const spec = JSON.parse(fs.readFileSync(archivePath, 'utf-8')) as {
      manifest: Record<string, unknown>;
    };
    return {
      valid: true,
      manifest: spec.manifest,
      errors: [],
      checksums: { verified: 1, total: 1 },
      signature: { status: 'unsigned' },
    };
  },
}));

import {
  readStamp,
  writeStamp,
  verifyOwnership,
  removeOwnedDir,
  stagePackage,
  materializePackage,
  restoreFromCache,
  resolveInstallDir,
  STAMP_FILENAME,
} from '../package-registry.js';
import {
  getPackageInstallDir,
  getPackageCachePath,
  getLegacyInstallDir,
} from '../package-paths.js';

/** Write a fake .anpk describing a package of the given type. */
function makeArchive(
  packageType: 'channel' | 'plugin',
  name: string,
  version: string,
  files: Record<string, string> = {},
): string {
  const dir = path.join(tmpDir, 'archives');
  fs.mkdirSync(dir, { recursive: true });
  const archivePath = path.join(dir, `${packageType}-${name}-${version}.anpk`);
  fs.writeFileSync(
    archivePath,
    JSON.stringify({ manifest: { name, version, packageType }, files }),
    'utf-8',
  );
  return archivePath;
}

describe('package-registry', () => {
  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('ownership stamps', () => {
    it('round-trips a stamp', async () => {
      const dir = path.join(tmpDir, 'stamped');
      fs.mkdirSync(dir, { recursive: true });
      await writeStamp(dir, 'channel', 'discord', '2.0.0');

      const stamp = readStamp(dir);
      expect(stamp).toMatchObject({ type: 'channel', name: 'discord', version: '2.0.0' });
    });

    it('returns null when no stamp is present', () => {
      const dir = path.join(tmpDir, 'bare');
      fs.mkdirSync(dir, { recursive: true });
      expect(readStamp(dir)).toBeNull();
    });
  });

  describe('verifyOwnership', () => {
    it('reports absent for a missing directory', () => {
      expect(verifyOwnership(path.join(tmpDir, 'gone'), 'plugin', 'x')).toEqual({
        status: 'absent',
      });
    });

    it('reports owned for a matching stamp', async () => {
      const dir = path.join(tmpDir, 'owned');
      fs.mkdirSync(dir, { recursive: true });
      await writeStamp(dir, 'plugin', 'weather', '1.1.0');

      expect(verifyOwnership(dir, 'plugin', 'weather').status).toBe('owned');
    });

    it('reports foreign when the stamp names another package type', async () => {
      const dir = path.join(tmpDir, 'foreign');
      fs.mkdirSync(dir, { recursive: true });
      await writeStamp(dir, 'plugin', 'home-assistant', '1.1.0');

      const verdict = verifyOwnership(dir, 'channel', 'home-assistant');
      expect(verdict.status).toBe('foreign');
    });

    it('falls back to the manifest for unstamped legacy installs', () => {
      const dir = path.join(tmpDir, 'legacy');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'manifest.json'),
        JSON.stringify({ name: 'home-assistant', version: '1.1.0', packageType: 'plugin' }),
        'utf-8',
      );

      expect(verifyOwnership(dir, 'channel', 'home-assistant').status).toBe('foreign');
      expect(verifyOwnership(dir, 'plugin', 'home-assistant').status).toBe('owned');
    });
  });

  describe('removeOwnedDir', () => {
    it('removes a directory it owns', async () => {
      const dir = path.join(tmpDir, 'mine');
      fs.mkdirSync(dir, { recursive: true });
      await writeStamp(dir, 'channel', 'discord', '2.0.0');

      await removeOwnedDir(dir, 'channel', 'discord');
      expect(fs.existsSync(dir)).toBe(false);
    });

    it('refuses to remove a directory owned by another package', async () => {
      const dir = path.join(tmpDir, 'theirs');
      fs.mkdirSync(dir, { recursive: true });
      await writeStamp(dir, 'channel', 'home-assistant', '1.0.0');

      await expect(removeOwnedDir(dir, 'plugin', 'home-assistant')).rejects.toThrow(
        /Refusing to remove/,
      );
      expect(fs.existsSync(dir)).toBe(true);
    });

    it('is a no-op for a missing directory', async () => {
      await expect(removeOwnedDir(path.join(tmpDir, 'nope'), 'plugin', 'x')).resolves.toBeUndefined();
    });
  });

  describe('stagePackage', () => {
    it('rejects an archive of the wrong package type', async () => {
      const archive = makeArchive('plugin', 'home-assistant', '1.1.0');
      await expect(stagePackage('channel', archive)).rejects.toThrow(
        /Expected channel package but got "plugin"/,
      );
    });
  });

  describe('materializePackage', () => {
    it('extracts into the type namespace and stamps ownership', async () => {
      const archive = makeArchive('channel', 'discord', '2.0.0', { 'adapter.js': '// x' });
      const staged = await stagePackage('channel', archive);

      const { installDir, cachePath } = await materializePackage('channel', staged);

      expect(installDir).toBe(getPackageInstallDir('channel', 'discord'));
      expect(fs.existsSync(path.join(installDir, 'adapter.js'))).toBe(true);
      expect(fs.existsSync(path.join(installDir, STAMP_FILENAME))).toBe(true);
      expect(cachePath).toBe(getPackageCachePath('channel', 'discord', '2.0.0'));
      expect(fs.existsSync(cachePath)).toBe(true);
    });

    // The regression test for the incident: installing the home-assistant
    // plugin used to rm -rf the home-assistant channel's install directory,
    // leaving the channel dead with a dangling DB row.
    it('does not disturb the same-named package of the other type', async () => {
      const channelArchive = makeArchive('channel', 'home-assistant', '1.0.0', {
        'adapter.js': '// channel adapter',
      });
      const channel = await materializePackage(
        'channel',
        await stagePackage('channel', channelArchive),
      );

      const pluginArchive = makeArchive('plugin', 'home-assistant', '1.1.0', {
        'tools.json': '{}',
      });
      const plugin = await materializePackage(
        'plugin',
        await stagePackage('plugin', pluginArchive),
      );

      expect(plugin.installDir).not.toBe(channel.installDir);

      // The channel survives the plugin install, intact.
      expect(fs.existsSync(path.join(channel.installDir, 'adapter.js'))).toBe(true);
      expect(fs.readFileSync(path.join(channel.installDir, 'adapter.js'), 'utf-8')).toBe(
        '// channel adapter',
      );
      expect(readStamp(channel.installDir)?.type).toBe('channel');

      // And the plugin lands in its own namespace.
      expect(fs.existsSync(path.join(plugin.installDir, 'tools.json'))).toBe(true);
      expect(readStamp(plugin.installDir)?.type).toBe('plugin');

      // Their rollback caches stay distinct too.
      expect(fs.existsSync(getPackageCachePath('channel', 'home-assistant', '1.0.0'))).toBe(true);
      expect(fs.existsSync(getPackageCachePath('plugin', 'home-assistant', '1.1.0'))).toBe(true);
    });

    it('refuses to overwrite a directory owned by another package', async () => {
      const installDir = getPackageInstallDir('plugin', 'home-assistant');
      fs.mkdirSync(installDir, { recursive: true });
      await writeStamp(installDir, 'channel', 'home-assistant', '1.0.0');

      const archive = makeArchive('plugin', 'home-assistant', '1.1.0');
      const staged = await stagePackage('plugin', archive);

      await expect(materializePackage('plugin', staged)).rejects.toThrow(/Refusing to remove/);
    });
  });

  describe('restoreFromCache', () => {
    it('restores a package from its namespaced cache', async () => {
      const archive = makeArchive('plugin', 'weather', '1.0.0', { 'tools.json': '{"v":1}' });
      await materializePackage('plugin', await stagePackage('plugin', archive));

      // Simulate an upgrade having replaced the files.
      const installDir = getPackageInstallDir('plugin', 'weather');
      fs.writeFileSync(path.join(installDir, 'tools.json'), '{"v":2}', 'utf-8');

      const { installDir: restored } = await restoreFromCache('plugin', 'weather', '1.0.0');

      expect(fs.readFileSync(path.join(restored, 'tools.json'), 'utf-8')).toBe('{"v":1}');
    });

    // On instances where a channel and a plugin shared a name *and* a version,
    // the pre-namespacing cache held only one archive for both. Rolling back
    // must fail loudly rather than install the wrong package type.
    it('rejects a cached archive holding the other package type', async () => {
      const legacyCache = path.join(tmpDir, 'packages', '.cache');
      fs.mkdirSync(legacyCache, { recursive: true });
      fs.writeFileSync(
        path.join(legacyCache, 'home-assistant-1.0.0.anpk'),
        JSON.stringify({
          manifest: { name: 'home-assistant', version: '1.0.0', packageType: 'channel' },
          files: { 'adapter.js': '// channel' },
        }),
        'utf-8',
      );

      await expect(restoreFromCache('plugin', 'home-assistant', '1.0.0')).rejects.toThrow(
        /Expected plugin package but got "channel"/,
      );
    });

    it('reports a missing cached archive', async () => {
      await expect(restoreFromCache('plugin', 'ghost', '9.9.9')).rejects.toThrow(
        /Cached package not found/,
      );
    });
  });

  describe('resolveInstallDir', () => {
    it('migrates a legacy install and back-fills its stamp', () => {
      const legacy = getLegacyInstallDir('discord');
      fs.mkdirSync(legacy, { recursive: true });
      fs.writeFileSync(
        path.join(legacy, 'manifest.json'),
        JSON.stringify({ name: 'discord', version: '2.0.0', packageType: 'channel' }),
        'utf-8',
      );

      const resolved = resolveInstallDir('channel', 'discord');

      expect(resolved).toBe(getPackageInstallDir('channel', 'discord'));
      expect(readStamp(resolved!)).toMatchObject({
        type: 'channel',
        name: 'discord',
        version: '2.0.0',
      });
    });

    it('returns null when the legacy dir belongs to the other type', () => {
      const legacy = getLegacyInstallDir('home-assistant');
      fs.mkdirSync(legacy, { recursive: true });
      fs.writeFileSync(
        path.join(legacy, 'manifest.json'),
        JSON.stringify({ name: 'home-assistant', version: '1.1.0', packageType: 'plugin' }),
        'utf-8',
      );

      expect(resolveInstallDir('channel', 'home-assistant')).toBeNull();
    });
  });
});
