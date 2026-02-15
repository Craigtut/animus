import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestSystemDb } from '../helpers.js';

// ============================================================================
// Mocks
// ============================================================================

let mockSysDb: Database.Database;

vi.mock('../../src/db/index.js', () => ({
  getSystemDb: () => mockSysDb,
}));

vi.mock('../../src/lib/event-bus.js', () => ({
  getEventBus: () => ({
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  }),
}));

vi.mock('../../src/lib/encryption-service.js', () => ({
  encrypt: (v: string) => `enc:${v}`,
  decrypt: (v: string) => v.startsWith('enc:') ? v.slice(4) : v,
}));

// Mock fs for controlled filesystem operations
const mockReaddir = vi.fn();
const mockReadFile = vi.fn();
const mockAccess = vi.fn();
const mockMkdir = vi.fn();
const mockSymlink = vi.fn();
const mockRm = vi.fn();

vi.mock('fs/promises', () => ({
  default: {
    readdir: (...args: unknown[]) => mockReaddir(...args),
    readFile: (...args: unknown[]) => mockReadFile(...args),
    access: (...args: unknown[]) => mockAccess(...args),
    mkdir: (...args: unknown[]) => mockMkdir(...args),
    symlink: (...args: unknown[]) => mockSymlink(...args),
    rm: (...args: unknown[]) => mockRm(...args),
  },
  readdir: (...args: unknown[]) => mockReaddir(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  access: (...args: unknown[]) => mockAccess(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  symlink: (...args: unknown[]) => mockSymlink(...args),
  rm: (...args: unknown[]) => mockRm(...args),
}));

// Mock child_process.spawn
const mockSpawn = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

// Import after mocks
const { getPluginManager, resetPluginManager } = await import(
  '../../src/services/plugin-manager.js'
);
import * as pluginStore from '../../src/db/stores/plugin-store.js';

// ============================================================================
// Helpers
// ============================================================================

const VALID_MANIFEST = {
  name: 'test-plugin',
  displayName: 'Test Plugin',
  version: '1.0.0',
  description: 'A test plugin',
  author: { name: 'Test Author' },
  components: {
    skills: './skills/',
    tools: './tools/mcp.json',
    hooks: './hooks/hooks.json',
    decisions: './decisions/decisions.json',
    triggers: './triggers/triggers.json',
    agents: './agents/',
    context: './context/context.json',
  },
};

const MINIMAL_MANIFEST = {
  name: 'minimal-plugin',
  displayName: 'Minimal Plugin',
  version: '0.1.0',
  description: 'A minimal plugin',
  author: { name: 'Test' },
  components: {},
};

function createMockProcess() {
  const proc = {
    stdin: { write: vi.fn(), end: vi.fn() },
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
  };
  return proc;
}

// ============================================================================
// Tests
// ============================================================================

describe('PluginManager', () => {
  beforeEach(() => {
    mockSysDb = createTestSystemDb();
    resetPluginManager();

    // Reset all fs mocks
    mockReaddir.mockReset();
    mockReadFile.mockReset();
    mockAccess.mockReset();
    mockMkdir.mockResolvedValue(undefined);
    mockSymlink.mockResolvedValue(undefined);
    mockRm.mockResolvedValue(undefined);
    mockSpawn.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================================================
  // Manifest Validation
  // ========================================================================

  describe('manifest validation', () => {
    it('accepts a valid manifest during loadAll', async () => {
      // scanDirectory finds one plugin with a valid manifest
      mockReaddir.mockImplementation(async (dir: string) => {
        if (dir.endsWith('backend/plugins') || dir.endsWith('.animus/plugins')) {
          return [{ name: 'test-plugin', isDirectory: () => true, isFile: () => false }];
        }
        return [];
      });
      mockReadFile.mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('plugin.json')) {
          return JSON.stringify(MINIMAL_MANIFEST);
        }
        throw new Error('File not found');
      });

      const pm = getPluginManager();
      await pm.loadAll();

      const all = pm.getAllPlugins();
      expect(all.length).toBeGreaterThanOrEqual(1);
      expect(all.find(p => p.name === 'minimal-plugin')).toBeDefined();
    });

    it('rejects manifest with invalid name', async () => {
      mockReaddir.mockImplementation(async (dir: string) => {
        if (dir.endsWith('backend/plugins') || dir.endsWith('.animus/plugins')) {
          return [{ name: 'bad', isDirectory: () => true, isFile: () => false }];
        }
        return [];
      });
      mockReadFile.mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('plugin.json')) {
          return JSON.stringify({
            ...MINIMAL_MANIFEST,
            name: 'INVALID NAME!!!',
          });
        }
        throw new Error('File not found');
      });

      const pm = getPluginManager();
      await pm.loadAll();

      // Should not have loaded the invalid plugin
      expect(pm.getAllPlugins().find(p => p.name === 'INVALID NAME!!!')).toBeUndefined();
    });

    it('skips directories without plugin.json', async () => {
      mockReaddir.mockImplementation(async (dir: string) => {
        if (dir.includes('plugins')) {
          return [{ name: 'no-manifest', isDirectory: () => true, isFile: () => false }];
        }
        return [];
      });
      mockReadFile.mockRejectedValue(new Error('ENOENT'));

      const pm = getPluginManager();
      await pm.loadAll();

      expect(pm.getAllPlugins()).toHaveLength(0);
    });
  });

  // ========================================================================
  // Skill Deployment
  // ========================================================================

  describe('skill deployment', () => {
    it('creates symlinks for skills to provider discovery path', async () => {
      // Setup a plugin with a skill
      mockReaddir.mockImplementation(async (dir: string) => {
        // Top-level scan directories — only return plugin from built-in path
        if (dir.endsWith('backend/plugins')) {
          return [{ name: 'skill-plugin', isDirectory: () => true, isFile: () => false }];
        }
        // The skill subdirectory scan
        if (dir.includes('skill-plugin') && dir.endsWith('skills')) {
          return [{ name: 'my-skill', isDirectory: () => true, isFile: () => false }];
        }
        return [];
      });

      mockReadFile.mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('plugin.json')) {
          return JSON.stringify({
            name: 'skill-plugin',
            displayName: 'Skill Plugin',
            version: '1.0.0',
            description: 'Has skills',
            author: { name: 'Test' },
            components: { skills: './skills/' },
          });
        }
        throw new Error('File not found');
      });

      mockAccess.mockResolvedValue(undefined); // SKILL.md exists

      const pm = getPluginManager();
      await pm.loadAll();

      // Verify symlink was created
      expect(mockSymlink).toHaveBeenCalled();
      const symlinkCall = mockSymlink.mock.calls.find(
        (call: unknown[]) => typeof call[1] === 'string' && (call[1] as string).includes('my-skill')
      );
      expect(symlinkCall).toBeDefined();
      // Target should be in .claude/skills/ using skill name directly (Agent Skills spec compliant)
      expect(symlinkCall![1]).toContain('.claude/skills/my-skill');
    });

    it('cleans up skills on cleanupSkills()', async () => {
      // Setup: deploy a skill first
      mockReaddir.mockImplementation(async (dir: string) => {
        if (dir.endsWith('backend/plugins')) {
          return [{ name: 'cleanup-test', isDirectory: () => true, isFile: () => false }];
        }
        if (dir.includes('cleanup-test') && dir.endsWith('skills')) {
          return [{ name: 'doomed', isDirectory: () => true, isFile: () => false }];
        }
        return [];
      });

      mockReadFile.mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('plugin.json')) {
          return JSON.stringify({
            name: 'cleanup-test',
            displayName: 'Cleanup Test',
            version: '1.0.0',
            description: 'Cleanup test',
            author: { name: 'Test' },
            components: { skills: './skills/' },
          });
        }
        throw new Error('File not found');
      });

      mockAccess.mockResolvedValue(undefined);

      const pm = getPluginManager();
      await pm.loadAll();

      // Reset rm mock to track cleanup calls
      mockRm.mockClear();
      await pm.cleanupSkills();

      expect(mockRm).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Decision Type Registration
  // ========================================================================

  describe('decision type registry', () => {
    it('registers decision types from plugins', async () => {
      mockReaddir.mockImplementation(async (dir: string) => {
        if (dir.endsWith('backend/plugins')) {
          return [{ name: 'decision-plugin', isDirectory: () => true, isFile: () => false }];
        }
        return [];
      });

      mockReadFile.mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('plugin.json')) {
          return JSON.stringify({
            name: 'decision-plugin',
            displayName: 'Decision Plugin',
            version: '1.0.0',
            description: 'Has decisions',
            author: { name: 'Test' },
            components: { decisions: './decisions/decisions.json' },
          });
        }
        if (filePath.endsWith('decisions.json')) {
          return JSON.stringify({
            types: [
              {
                name: 'control_device',
                description: 'Control a smart home device',
                payloadSchema: {
                  type: 'object',
                  properties: {
                    deviceId: { type: 'string' },
                    action: { type: 'string', enum: ['turn_on', 'turn_off'] },
                  },
                },
                handler: { type: 'command', command: '${PLUGIN_ROOT}/handlers/control.sh' },
                contactTier: 'primary',
              },
            ],
          });
        }
        throw new Error('File not found');
      });

      const pm = getPluginManager();
      await pm.loadAll();

      const types = pm.getDecisionTypes();
      expect(types).toHaveLength(1);
      expect(types[0]!.name).toBe('control_device');
    });

    it('generates formatted decision descriptions', async () => {
      mockReaddir.mockImplementation(async (dir: string) => {
        if (dir.endsWith('backend/plugins')) {
          return [{ name: 'desc-plugin', isDirectory: () => true, isFile: () => false }];
        }
        return [];
      });

      mockReadFile.mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('plugin.json')) {
          return JSON.stringify({
            name: 'desc-plugin',
            displayName: 'Description Plugin',
            version: '1.0.0',
            description: 'Has descriptions',
            author: { name: 'Test' },
            components: { decisions: './decisions/decisions.json' },
          });
        }
        if (filePath.endsWith('decisions.json')) {
          return JSON.stringify({
            types: [
              {
                name: 'send_push',
                description: 'Send a push notification',
                payloadSchema: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    body: { type: 'string' },
                  },
                },
                handler: { type: 'command', command: 'echo' },
              },
            ],
          });
        }
        throw new Error('File not found');
      });

      const pm = getPluginManager();
      await pm.loadAll();

      const desc = pm.getDecisionDescriptions();
      expect(desc).toContain('send_push');
      expect(desc).toContain('Send a push notification');
      expect(desc).toContain('title: string');
      expect(desc).toContain('body: string');
    });

    it('detects decision type name collisions', async () => {
      mockReaddir.mockImplementation(async (dir: string) => {
        if (dir.endsWith('backend/plugins')) {
          return [
            { name: 'plugin-a', isDirectory: () => true, isFile: () => false },
            { name: 'plugin-b', isDirectory: () => true, isFile: () => false },
          ];
        }
        return [];
      });

      const decisionJson = JSON.stringify({
        types: [{
          name: 'duplicate_action',
          description: 'Does something',
          payloadSchema: { type: 'object', properties: {} },
          handler: { type: 'command', command: 'echo' },
        }],
      });

      mockReadFile.mockImplementation(async (filePath: string) => {
        if (filePath.includes('plugin-a') && filePath.endsWith('plugin.json')) {
          return JSON.stringify({
            name: 'plugin-a',
            displayName: 'Plugin A',
            version: '1.0.0',
            description: 'Plugin A',
            author: { name: 'Test' },
            components: { decisions: './decisions/decisions.json' },
          });
        }
        if (filePath.includes('plugin-b') && filePath.endsWith('plugin.json')) {
          return JSON.stringify({
            name: 'plugin-b',
            displayName: 'Plugin B',
            version: '1.0.0',
            description: 'Plugin B',
            author: { name: 'Test' },
            components: { decisions: './decisions/decisions.json' },
          });
        }
        if (filePath.endsWith('decisions.json')) {
          return decisionJson;
        }
        throw new Error('File not found');
      });

      const pm = getPluginManager();
      await pm.loadAll();

      // Only one should be registered (first wins)
      const types = pm.getDecisionTypes();
      expect(types).toHaveLength(1);
    });
  });

  // ========================================================================
  // Hook Firing
  // ========================================================================

  describe('hook firing', () => {
    it('runs blocking hooks sequentially and blocks on failure', async () => {
      mockReaddir.mockImplementation(async (dir: string) => {
        if (dir.endsWith('backend/plugins')) {
          return [{ name: 'hook-plugin', isDirectory: () => true, isFile: () => false }];
        }
        return [];
      });

      mockReadFile.mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('plugin.json')) {
          return JSON.stringify({
            name: 'hook-plugin',
            displayName: 'Hook Plugin',
            version: '1.0.0',
            description: 'Has hooks',
            author: { name: 'Test' },
            components: { hooks: './hooks/hooks.json' },
          });
        }
        if (filePath.endsWith('hooks.json')) {
          return JSON.stringify({
            hooks: [{
              event: 'preDecision',
              handler: { type: 'command', command: 'node block.js' },
            }],
          });
        }
        throw new Error('File not found');
      });

      // Mock spawn for the handler — simulate exit code 1 (failure = block)
      mockSpawn.mockImplementation(() => {
        const proc = createMockProcess();
        // Simulate immediate exit with code 1
        setTimeout(() => {
          const exitHandler = proc.on.mock.calls.find(
            (c: unknown[]) => c[0] === 'exit'
          );
          if (exitHandler) (exitHandler[1] as (code: number) => void)(1);
        }, 0);
        return proc;
      });

      const pm = getPluginManager();
      await pm.loadAll();

      const result = await pm.fireHook('preDecision', { type: 'test' });
      expect(result.blocked).toBe(true);
    });

    it('does not block for non-blocking hooks', async () => {
      mockReaddir.mockImplementation(async (dir: string) => {
        if (dir.endsWith('backend/plugins')) {
          return [{ name: 'post-hook', isDirectory: () => true, isFile: () => false }];
        }
        return [];
      });

      mockReadFile.mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('plugin.json')) {
          return JSON.stringify({
            name: 'post-hook',
            displayName: 'Post Hook',
            version: '1.0.0',
            description: 'Post hook',
            author: { name: 'Test' },
            components: { hooks: './hooks/hooks.json' },
          });
        }
        if (filePath.endsWith('hooks.json')) {
          return JSON.stringify({
            hooks: [{
              event: 'postTick',
              handler: { type: 'command', command: 'echo done' },
            }],
          });
        }
        throw new Error('File not found');
      });

      // Mock spawn — successful execution
      mockSpawn.mockImplementation(() => {
        const proc = createMockProcess();
        setTimeout(() => {
          const stdoutHandler = proc.stdout.on.mock.calls.find(
            (c: unknown[]) => c[0] === 'data'
          );
          if (stdoutHandler) (stdoutHandler[1] as (chunk: Buffer) => void)(Buffer.from('{"success": true}\n'));

          const exitHandler = proc.on.mock.calls.find(
            (c: unknown[]) => c[0] === 'exit'
          );
          if (exitHandler) (exitHandler[1] as (code: number) => void)(0);
        }, 0);
        return proc;
      });

      const pm = getPluginManager();
      await pm.loadAll();

      const result = await pm.fireHook('postTick', { tickNumber: 1 });
      expect(result.blocked).toBe(false);
    });

    it('returns not blocked when no hooks registered', async () => {
      mockReaddir.mockResolvedValue([]);

      const pm = getPluginManager();
      await pm.loadAll();

      const result = await pm.fireHook('preTick', {});
      expect(result.blocked).toBe(false);
    });
  });

  // ========================================================================
  // Config Encrypt/Decrypt
  // ========================================================================

  describe('config management', () => {
    it('encrypts and decrypts config round-trip', async () => {
      mockReaddir.mockResolvedValue([]);

      // Manually insert a plugin in the DB
      pluginStore.insertPlugin(mockSysDb, {
        name: 'config-test',
        version: '1.0.0',
        path: '/test',
        source: 'local',
      });

      const pm = getPluginManager();
      await pm.loadAll();

      const config = { apiKey: 'secret-123', url: 'http://example.com' };
      pm.setPluginConfig('config-test', config);

      const record = pluginStore.getPlugin(mockSysDb, 'config-test');
      // Should be encrypted (our mock prepends "enc:")
      expect(record!.configEncrypted).toContain('enc:');
      expect(record!.configEncrypted).not.toBe(JSON.stringify(config));

      // Decrypt via getPluginConfig
      const decrypted = pm.getPluginConfig('config-test');
      expect(decrypted).toEqual(config);
    });

    it('returns null for plugin with no config', async () => {
      mockReaddir.mockResolvedValue([]);

      pluginStore.insertPlugin(mockSysDb, {
        name: 'no-config',
        version: '1.0.0',
        path: '/test',
        source: 'local',
      });

      const pm = getPluginManager();
      await pm.loadAll();

      expect(pm.getPluginConfig('no-config')).toBeNull();
    });
  });

  // ========================================================================
  // Install / Uninstall
  // ========================================================================

  describe('install and uninstall', () => {
    it('installs a plugin from path', async () => {
      // First loadAll with empty dirs
      mockReaddir.mockResolvedValue([]);
      const pm = getPluginManager();
      await pm.loadAll();

      // Now mock the manifest read for install
      mockReadFile.mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('plugin.json')) {
          return JSON.stringify({
            name: 'installed-plugin',
            displayName: 'Installed Plugin',
            version: '2.0.0',
            description: 'Freshly installed',
            author: { name: 'Test' },
            components: {},
          });
        }
        throw new Error('File not found');
      });

      const manifest = await pm.install({ type: 'local', path: '/path/to/installed-plugin' });
      expect(manifest.name).toBe('installed-plugin');
      expect(manifest.version).toBe('2.0.0');

      // Should be in DB
      const record = pluginStore.getPlugin(mockSysDb, 'installed-plugin');
      expect(record).not.toBeNull();
      expect(record!.enabled).toBe(true);

      // Should be in plugins map
      expect(pm.getAllPlugins().find(p => p.name === 'installed-plugin')).toBeDefined();
    });

    it('rejects duplicate install', async () => {
      mockReaddir.mockResolvedValue([]);
      const pm = getPluginManager();
      await pm.loadAll();

      pluginStore.insertPlugin(mockSysDb, {
        name: 'dup',
        version: '1.0.0',
        path: '/old',
        source: 'local',
      });

      mockReadFile.mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('plugin.json')) {
          return JSON.stringify({
            name: 'dup',
            displayName: 'Duplicate',
            version: '2.0.0',
            description: 'Duplicate',
            author: { name: 'Test' },
            components: {},
          });
        }
        throw new Error('File not found');
      });

      await expect(pm.install({ type: 'local', path: '/new' })).rejects.toThrow('already installed');
    });

    it('uninstalls a non-built-in plugin', async () => {
      mockReaddir.mockResolvedValue([]);
      const pm = getPluginManager();
      await pm.loadAll();

      // Install first
      mockReadFile.mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('plugin.json')) {
          return JSON.stringify({
            name: 'removable',
            displayName: 'Removable',
            version: '1.0.0',
            description: 'Can be removed',
            author: { name: 'Test' },
            components: {},
          });
        }
        throw new Error('File not found');
      });

      await pm.install({ type: 'local', path: '/removable' });
      expect(pm.getAllPlugins().find(p => p.name === 'removable')).toBeDefined();

      await pm.uninstall('removable');
      expect(pm.getAllPlugins().find(p => p.name === 'removable')).toBeUndefined();
      expect(pluginStore.getPlugin(mockSysDb, 'removable')).toBeNull();
    });

    it('refuses to uninstall built-in plugins', async () => {
      // Setup a built-in plugin
      mockReaddir.mockImplementation(async (dir: string) => {
        if (dir.endsWith('backend/plugins')) {
          return [{ name: 'core-plugin', isDirectory: () => true, isFile: () => false }];
        }
        return [];
      });

      mockReadFile.mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('plugin.json')) {
          return JSON.stringify({
            name: 'core-plugin',
            displayName: 'Core Plugin',
            version: '1.0.0',
            description: 'Built-in',
            author: { name: 'Test' },
            components: {},
          });
        }
        throw new Error('File not found');
      });

      const pm = getPluginManager();
      await pm.loadAll();

      await expect(pm.uninstall('core-plugin')).rejects.toThrow('Cannot uninstall built-in');
    });
  });

  // ========================================================================
  // Enable / Disable
  // ========================================================================

  describe('enable and disable', () => {
    it('disables and re-enables a plugin', async () => {
      mockReaddir.mockResolvedValue([]);
      const pm = getPluginManager();
      await pm.loadAll();

      // Install
      mockReadFile.mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('plugin.json')) {
          return JSON.stringify({
            name: 'toggle-plugin',
            displayName: 'Toggle Plugin',
            version: '1.0.0',
            description: 'Toggleable',
            author: { name: 'Test' },
            components: {},
          });
        }
        throw new Error('File not found');
      });

      await pm.install({ type: 'local', path: '/toggle' });

      // Disable
      await pm.disable('toggle-plugin');
      const disabled = pm.getAllPlugins().find(p => p.name === 'toggle-plugin');
      expect(disabled!.enabled).toBe(false);

      const dbRecord = pluginStore.getPlugin(mockSysDb, 'toggle-plugin');
      expect(dbRecord!.enabled).toBe(false);

      // Re-enable
      await pm.enable('toggle-plugin');
      const enabled = pm.getAllPlugins().find(p => p.name === 'toggle-plugin');
      expect(enabled!.enabled).toBe(true);
    });
  });

  // ========================================================================
  // MCP Config Collection
  // ========================================================================

  describe('MCP config collection', () => {
    it('collects and namespaces MCP configs', async () => {
      mockReaddir.mockImplementation(async (dir: string) => {
        if (dir.endsWith('backend/plugins')) {
          return [{ name: 'mcp-plugin', isDirectory: () => true, isFile: () => false }];
        }
        return [];
      });

      mockReadFile.mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('plugin.json')) {
          return JSON.stringify({
            name: 'mcp-plugin',
            displayName: 'MCP Plugin',
            version: '1.0.0',
            description: 'MCP test',
            author: { name: 'Test' },
            components: { tools: './tools/mcp.json' },
          });
        }
        if (filePath.endsWith('mcp.json')) {
          return JSON.stringify({
            'analysis-server': {
              command: 'node',
              args: ['${PLUGIN_ROOT}/server.js'],
              env: {},
              description: 'Analysis',
            },
          });
        }
        throw new Error('File not found');
      });

      const pm = getPluginManager();
      await pm.loadAll();

      const configs = pm.getMcpConfigs();
      expect(configs['mcp-plugin__analysis-server']).toBeDefined();
      expect(configs['mcp-plugin__analysis-server']!.command).toBe('node');
      // ${PLUGIN_ROOT} should be substituted
      expect(configs['mcp-plugin__analysis-server']!.args[0]).not.toContain('${PLUGIN_ROOT}');
    });
  });

  // ========================================================================
  // Agent Templates
  // ========================================================================

  describe('agent templates', () => {
    it('loads agent catalog from .md files', async () => {
      mockReaddir.mockImplementation(async (dir: string) => {
        if (dir.endsWith('backend/plugins')) {
          return [{ name: 'agent-plugin', isDirectory: () => true, isFile: () => false }];
        }
        if (dir.includes('agent-plugin') && dir.endsWith('agents')) {
          return [
            { name: 'reviewer.md', isDirectory: () => false, isFile: () => true },
          ];
        }
        return [];
      });

      mockReadFile.mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('plugin.json')) {
          return JSON.stringify({
            name: 'agent-plugin',
            displayName: 'Agent Plugin',
            version: '1.0.0',
            description: 'Has agents',
            author: { name: 'Test' },
            components: { agents: './agents/' },
          });
        }
        if (filePath.endsWith('reviewer.md')) {
          return `---
name: security-reviewer
description: Reviews code for security issues
tools:
  - read
  - grep
maxTurns: 15
---

You are a security reviewer.

Check all code for vulnerabilities.`;
        }
        throw new Error('File not found');
      });

      const pm = getPluginManager();
      await pm.loadAll();

      const catalog = pm.getAgentCatalog();
      expect(catalog).toHaveLength(1);
      expect(catalog[0]!.name).toBe('security-reviewer');
      expect(catalog[0]!.description).toBe('Reviews code for security issues');

      const template = pm.getAgentTemplate('security-reviewer');
      expect(template).toBeDefined();
      expect(template!.tools).toEqual(['read', 'grep']);
      expect(template!.maxTurns).toBe(15);
      expect(template!.prompt).toContain('You are a security reviewer.');
    });

    it('returns undefined for unknown agent', async () => {
      mockReaddir.mockResolvedValue([]);
      const pm = getPluginManager();
      await pm.loadAll();

      expect(pm.getAgentTemplate('nonexistent')).toBeUndefined();
    });
  });

  // ========================================================================
  // loadAll with mock filesystem
  // ========================================================================

  describe('loadAll', () => {
    it('handles empty plugin directories gracefully', async () => {
      mockReaddir.mockRejectedValue(new Error('ENOENT'));

      const pm = getPluginManager();
      await pm.loadAll();

      expect(pm.getAllPlugins()).toHaveLength(0);
    });

    it('loads multiple plugins from different sources', async () => {
      mockReaddir.mockImplementation(async (dir: string) => {
        if (dir.endsWith('backend/plugins')) {
          return [
            { name: 'built-in-a', isDirectory: () => true, isFile: () => false },
          ];
        }
        if (dir.includes('.animus/plugins')) {
          return [
            { name: 'downloaded-b', isDirectory: () => true, isFile: () => false },
          ];
        }
        return [];
      });

      mockReadFile.mockImplementation(async (filePath: string) => {
        if (filePath.includes('built-in-a') && filePath.endsWith('plugin.json')) {
          return JSON.stringify({
            name: 'built-in-a',
            displayName: 'Built-in A',
            version: '1.0.0',
            description: 'Built-in A',
            author: { name: 'Test' },
            components: {},
          });
        }
        if (filePath.includes('downloaded-b') && filePath.endsWith('plugin.json')) {
          return JSON.stringify({
            name: 'downloaded-b',
            displayName: 'Downloaded B',
            version: '2.0.0',
            description: 'Downloaded B',
            author: { name: 'Test' },
            components: {},
          });
        }
        throw new Error('File not found');
      });

      const pm = getPluginManager();
      await pm.loadAll();

      const all = pm.getAllPlugins();
      expect(all).toHaveLength(2);
      expect(all.find(p => p.name === 'built-in-a')).toBeDefined();
      expect(all.find(p => p.name === 'downloaded-b')).toBeDefined();
    });
  });
});
