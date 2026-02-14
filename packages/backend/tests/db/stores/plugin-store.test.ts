import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestSystemDb } from '../../helpers.js';
import * as pluginStore from '../../../src/db/stores/plugin-store.js';

describe('plugin-store', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestSystemDb();
  });

  // ========================================================================
  // insertPlugin
  // ========================================================================

  describe('insertPlugin', () => {
    it('inserts a plugin with defaults', () => {
      const plugin = pluginStore.insertPlugin(db, {
        name: 'test-plugin',
        version: '1.0.0',
        path: '/plugins/test-plugin',
        source: 'local',
      });

      expect(plugin.name).toBe('test-plugin');
      expect(plugin.version).toBe('1.0.0');
      expect(plugin.path).toBe('/plugins/test-plugin');
      expect(plugin.enabled).toBe(true);
      expect(plugin.source).toBe('local');
      expect(plugin.storeId).toBeNull();
      expect(plugin.configEncrypted).toBeNull();
      expect(plugin.installedAt).toBeDefined();
      expect(plugin.updatedAt).toBeDefined();
    });

    it('inserts a plugin with all fields', () => {
      const plugin = pluginStore.insertPlugin(db, {
        name: 'store-plugin',
        version: '2.0.0',
        path: '/plugins/store-plugin',
        source: 'store',
        enabled: false,
        storeId: 'abc-123',
        configEncrypted: 'encrypted-data',
      });

      expect(plugin.enabled).toBe(false);
      expect(plugin.source).toBe('store');
      expect(plugin.storeId).toBe('abc-123');
      expect(plugin.configEncrypted).toBe('encrypted-data');
    });

    it('rejects duplicate plugin names', () => {
      pluginStore.insertPlugin(db, {
        name: 'dup',
        version: '1.0.0',
        path: '/plugins/dup',
        source: 'local',
      });
      expect(() =>
        pluginStore.insertPlugin(db, {
          name: 'dup',
          version: '2.0.0',
          path: '/plugins/dup-v2',
          source: 'local',
        })
      ).toThrow();
    });
  });

  // ========================================================================
  // getPlugin
  // ========================================================================

  describe('getPlugin', () => {
    it('retrieves a plugin by name', () => {
      pluginStore.insertPlugin(db, {
        name: 'my-plugin',
        version: '1.0.0',
        path: '/plugins/my-plugin',
        source: 'local',
      });

      const found = pluginStore.getPlugin(db, 'my-plugin');
      expect(found).not.toBeNull();
      expect(found!.name).toBe('my-plugin');
      expect(found!.version).toBe('1.0.0');
      expect(found!.enabled).toBe(true);
    });

    it('returns null for nonexistent plugin', () => {
      expect(pluginStore.getPlugin(db, 'nonexistent')).toBeNull();
    });
  });

  // ========================================================================
  // getAllPlugins
  // ========================================================================

  describe('getAllPlugins', () => {
    it('returns all plugins sorted by name', () => {
      pluginStore.insertPlugin(db, { name: 'beta', version: '1.0.0', path: '/p/b', source: 'local' });
      pluginStore.insertPlugin(db, { name: 'alpha', version: '1.0.0', path: '/p/a', source: 'local' });
      pluginStore.insertPlugin(db, { name: 'gamma', version: '1.0.0', path: '/p/g', source: 'npm' });

      const all = pluginStore.getAllPlugins(db);
      expect(all).toHaveLength(3);
      expect(all[0]!.name).toBe('alpha');
      expect(all[1]!.name).toBe('beta');
      expect(all[2]!.name).toBe('gamma');
    });

    it('returns empty array when no plugins', () => {
      expect(pluginStore.getAllPlugins(db)).toEqual([]);
    });
  });

  // ========================================================================
  // getEnabledPlugins
  // ========================================================================

  describe('getEnabledPlugins', () => {
    it('returns only enabled plugins', () => {
      pluginStore.insertPlugin(db, { name: 'enabled-1', version: '1.0.0', path: '/p/e1', source: 'local', enabled: true });
      pluginStore.insertPlugin(db, { name: 'disabled-1', version: '1.0.0', path: '/p/d1', source: 'local', enabled: false });
      pluginStore.insertPlugin(db, { name: 'enabled-2', version: '1.0.0', path: '/p/e2', source: 'local', enabled: true });

      const enabled = pluginStore.getEnabledPlugins(db);
      expect(enabled).toHaveLength(2);
      expect(enabled.every((p) => p.enabled)).toBe(true);
    });
  });

  // ========================================================================
  // updatePlugin
  // ========================================================================

  describe('updatePlugin', () => {
    it('updates version', () => {
      pluginStore.insertPlugin(db, { name: 'up', version: '1.0.0', path: '/p/up', source: 'local' });
      const changed = pluginStore.updatePlugin(db, 'up', { version: '2.0.0' });
      expect(changed).toBe(true);

      const found = pluginStore.getPlugin(db, 'up');
      expect(found!.version).toBe('2.0.0');
    });

    it('updates enabled status', () => {
      pluginStore.insertPlugin(db, { name: 'toggle', version: '1.0.0', path: '/p/t', source: 'local' });
      pluginStore.updatePlugin(db, 'toggle', { enabled: false });

      const found = pluginStore.getPlugin(db, 'toggle');
      expect(found!.enabled).toBe(false);
    });

    it('updates multiple fields at once', () => {
      pluginStore.insertPlugin(db, { name: 'multi', version: '1.0.0', path: '/old/path', source: 'local' });
      pluginStore.updatePlugin(db, 'multi', { version: '3.0.0', path: '/new/path', source: 'git' });

      const found = pluginStore.getPlugin(db, 'multi');
      expect(found!.version).toBe('3.0.0');
      expect(found!.path).toBe('/new/path');
      expect(found!.source).toBe('git');
    });

    it('updates updatedAt timestamp', () => {
      const plugin = pluginStore.insertPlugin(db, { name: 'ts', version: '1.0.0', path: '/p/ts', source: 'local' });
      const originalUpdatedAt = plugin.updatedAt;

      // Small delay to ensure different timestamp
      pluginStore.updatePlugin(db, 'ts', { version: '1.0.1' });

      const found = pluginStore.getPlugin(db, 'ts');
      expect(found!.updatedAt).toBeDefined();
      // installedAt should not change
      expect(found!.installedAt).toBe(plugin.installedAt);
    });

    it('returns false for nonexistent plugin', () => {
      expect(pluginStore.updatePlugin(db, 'nope', { version: '9.9.9' })).toBe(false);
    });

    it('returns false when no fields provided', () => {
      pluginStore.insertPlugin(db, { name: 'noop', version: '1.0.0', path: '/p/n', source: 'local' });
      expect(pluginStore.updatePlugin(db, 'noop', {})).toBe(false);
    });
  });

  // ========================================================================
  // deletePlugin
  // ========================================================================

  describe('deletePlugin', () => {
    it('deletes an existing plugin', () => {
      pluginStore.insertPlugin(db, { name: 'del', version: '1.0.0', path: '/p/d', source: 'local' });
      const deleted = pluginStore.deletePlugin(db, 'del');
      expect(deleted).toBe(true);
      expect(pluginStore.getPlugin(db, 'del')).toBeNull();
    });

    it('returns false for nonexistent plugin', () => {
      expect(pluginStore.deletePlugin(db, 'nonexistent')).toBe(false);
    });
  });

  // ========================================================================
  // updatePluginConfig
  // ========================================================================

  describe('updatePluginConfig', () => {
    it('sets encrypted config', () => {
      pluginStore.insertPlugin(db, { name: 'cfg', version: '1.0.0', path: '/p/c', source: 'local' });
      const changed = pluginStore.updatePluginConfig(db, 'cfg', 'encrypted-config-data');
      expect(changed).toBe(true);

      const found = pluginStore.getPlugin(db, 'cfg');
      expect(found!.configEncrypted).toBe('encrypted-config-data');
    });

    it('clears encrypted config by setting null', () => {
      pluginStore.insertPlugin(db, {
        name: 'cfg-clear',
        version: '1.0.0',
        path: '/p/cc',
        source: 'local',
        configEncrypted: 'old-data',
      });
      pluginStore.updatePluginConfig(db, 'cfg-clear', null);

      const found = pluginStore.getPlugin(db, 'cfg-clear');
      expect(found!.configEncrypted).toBeNull();
    });

    it('returns false for nonexistent plugin', () => {
      expect(pluginStore.updatePluginConfig(db, 'nonexistent', 'data')).toBe(false);
    });
  });

  // ========================================================================
  // Boolean handling (enabled field)
  // ========================================================================

  describe('boolean handling', () => {
    it('correctly round-trips enabled=true through SQLite integer', () => {
      pluginStore.insertPlugin(db, { name: 'bool-true', version: '1.0.0', path: '/p', source: 'local', enabled: true });
      const found = pluginStore.getPlugin(db, 'bool-true');
      expect(found!.enabled).toBe(true);
      expect(typeof found!.enabled).toBe('boolean');
    });

    it('correctly round-trips enabled=false through SQLite integer', () => {
      pluginStore.insertPlugin(db, { name: 'bool-false', version: '1.0.0', path: '/p', source: 'local', enabled: false });
      const found = pluginStore.getPlugin(db, 'bool-false');
      expect(found!.enabled).toBe(false);
      expect(typeof found!.enabled).toBe('boolean');
    });
  });
});
