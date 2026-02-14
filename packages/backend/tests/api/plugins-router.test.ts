/**
 * Tests for the plugins tRPC router.
 *
 * We test the router procedures by mocking the PluginManager singleton
 * and verifying correct delegation and error handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Mock the plugin-manager module before importing the router
vi.mock('../../src/services/plugin-manager.js', () => {
  const mockManager = {
    getAllPlugins: vi.fn(),
    getPlugin: vi.fn(),
    install: vi.fn(),
    uninstall: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    getPluginConfig: vi.fn(),
    setPluginConfig: vi.fn(),
  };
  return {
    getPluginManager: () => mockManager,
    __mockManager: mockManager,
  };
});

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type PluginManagerModule = typeof import('../../src/services/plugin-manager.js') & {
  __mockManager: {
    getAllPlugins: ReturnType<typeof vi.fn>;
    getPlugin: ReturnType<typeof vi.fn>;
    install: ReturnType<typeof vi.fn>;
    uninstall: ReturnType<typeof vi.fn>;
    enable: ReturnType<typeof vi.fn>;
    disable: ReturnType<typeof vi.fn>;
    getPluginConfig: ReturnType<typeof vi.fn>;
    setPluginConfig: ReturnType<typeof vi.fn>;
  };
};

import { pluginsRouter } from '../../src/api/routers/plugins.js';
import { router } from '../../src/api/trpc.js';
import { initTRPC } from '@trpc/server';
import type { TRPCContext } from '../../src/api/trpc.js';

// Access mock manager
const { __mockManager: mockManager } = await import('../../src/services/plugin-manager.js') as PluginManagerModule;

// Create a test caller using tRPC's createCallerFactory
const testRouter = router({ plugins: pluginsRouter });

const t = initTRPC.context<TRPCContext>().create();
const createCaller = t.createCallerFactory(testRouter);

function getAuthedCaller() {
  return createCaller({
    req: {} as any,
    res: {} as any,
    userId: 'test-user-id',
  });
}

function getUnauthCaller() {
  return createCaller({
    req: {} as any,
    res: {} as any,
    userId: null,
  });
}

// ============================================================================
// Sample data
// ============================================================================

const sampleManifest = {
  name: 'test-plugin',
  version: '1.0.0',
  description: 'A test plugin',
  author: { name: 'Test Author' },
  components: {
    skills: 'skills/',
  },
  dependencies: { plugins: [], system: {} },
  permissions: {
    tools: [],
    network: false,
    filesystem: 'none' as const,
    contacts: false,
    memory: 'none' as const,
  },
};

const sampleLoaded = {
  manifest: sampleManifest,
  absolutePath: '/path/to/plugin',
  source: 'local' as const,
  enabled: true,
  skills: [{ name: 'my-skill', absolutePath: '/path/to/plugin/skills/my-skill' }],
  mcpServers: { 'my-server': { command: 'node', args: ['server.js'], env: {} } },
  contextSources: [{ name: 'my-ctx', description: 'test', type: 'static' as const, maxTokens: 500, priority: 5 }],
  hooks: [{ event: 'preTick' as const, handler: { type: 'command' as const, command: 'echo hi' } }],
  decisionTypes: [{ name: 'custom_action', description: 'test', payloadSchema: {}, handler: { type: 'command' as const, command: 'echo' }, contactTier: 'primary' as const }],
  triggers: [{ name: 'my-trigger', description: 'test', type: 'http' as const, config: { path: '/test', methods: ['POST'] } }],
  agents: [{ frontmatter: { name: 'my-agent', description: 'test', tools: [] }, prompt: 'Hello' }],
};

// ============================================================================
// Tests
// ============================================================================

describe('plugins router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // Auth guard
  // --------------------------------------------------------------------------

  describe('auth guard', () => {
    it('should reject unauthenticated calls', async () => {
      const caller = getUnauthCaller();
      await expect(caller.plugins.list()).rejects.toThrow('UNAUTHORIZED');
    });
  });

  // --------------------------------------------------------------------------
  // list
  // --------------------------------------------------------------------------

  describe('list', () => {
    it('should return empty array when no plugins loaded', async () => {
      mockManager.getAllPlugins.mockReturnValue([]);
      const caller = getAuthedCaller();

      const result = await caller.plugins.list();
      expect(result).toEqual([]);
    });

    it('should return plugin summaries with component counts', async () => {
      mockManager.getAllPlugins.mockReturnValue([
        { name: 'test-plugin', manifest: sampleManifest, source: 'local', enabled: true },
      ]);
      mockManager.getPlugin.mockReturnValue(sampleLoaded);

      const caller = getAuthedCaller();
      const result = await caller.plugins.list();

      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe('test-plugin');
      expect(result[0]!.version).toBe('1.0.0');
      expect(result[0]!.enabled).toBe(true);
      expect(result[0]!.components.skills).toBe(1);
      expect(result[0]!.components.tools).toBe(1);
      expect(result[0]!.components.contextSources).toBe(1);
      expect(result[0]!.components.hooks).toBe(1);
      expect(result[0]!.components.decisionTypes).toBe(1);
      expect(result[0]!.components.triggers).toBe(1);
      expect(result[0]!.components.agents).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // get
  // --------------------------------------------------------------------------

  describe('get', () => {
    it('should return full plugin details', async () => {
      mockManager.getPlugin.mockReturnValue(sampleLoaded);

      const caller = getAuthedCaller();
      const result = await caller.plugins.get({ name: 'test-plugin' });

      expect(result.name).toBe('test-plugin');
      expect(result.manifest).toEqual(sampleManifest);
      expect(result.components.skills).toEqual(['my-skill']);
      expect(result.components.tools).toEqual(['my-server']);
      expect(result.components.agents).toEqual(['my-agent']);
    });

    it('should throw NOT_FOUND for unknown plugin', async () => {
      mockManager.getPlugin.mockReturnValue(undefined);

      const caller = getAuthedCaller();
      await expect(caller.plugins.get({ name: 'nope' })).rejects.toThrow('not found');
    });
  });

  // --------------------------------------------------------------------------
  // install
  // --------------------------------------------------------------------------

  describe('install', () => {
    it('should call pm.install and return manifest', async () => {
      mockManager.install.mockResolvedValue(sampleManifest);

      const caller = getAuthedCaller();
      const result = await caller.plugins.install({ source: 'local', path: '/tmp/my-plugin' });

      expect(mockManager.install).toHaveBeenCalledWith({ type: 'local', path: '/tmp/my-plugin' });
      expect(result.name).toBe('test-plugin');
    });

    it('should throw BAD_REQUEST when install fails', async () => {
      mockManager.install.mockRejectedValue(new Error('Already installed'));

      const caller = getAuthedCaller();
      await expect(
        caller.plugins.install({ source: 'local', path: '/tmp/bad' })
      ).rejects.toThrow('Already installed');
    });
  });

  // --------------------------------------------------------------------------
  // uninstall
  // --------------------------------------------------------------------------

  describe('uninstall', () => {
    it('should call pm.uninstall', async () => {
      mockManager.uninstall.mockResolvedValue(undefined);

      const caller = getAuthedCaller();
      const result = await caller.plugins.uninstall({ name: 'test-plugin' });

      expect(mockManager.uninstall).toHaveBeenCalledWith('test-plugin');
      expect(result).toEqual({ success: true });
    });

    it('should throw BAD_REQUEST when uninstall fails', async () => {
      mockManager.uninstall.mockRejectedValue(new Error('Cannot uninstall built-in'));

      const caller = getAuthedCaller();
      await expect(
        caller.plugins.uninstall({ name: 'core' })
      ).rejects.toThrow('Cannot uninstall built-in');
    });
  });

  // --------------------------------------------------------------------------
  // enable / disable
  // --------------------------------------------------------------------------

  describe('enable', () => {
    it('should call pm.enable', async () => {
      mockManager.enable.mockResolvedValue(undefined);

      const caller = getAuthedCaller();
      const result = await caller.plugins.enable({ name: 'test-plugin' });

      expect(mockManager.enable).toHaveBeenCalledWith('test-plugin');
      expect(result).toEqual({ success: true });
    });
  });

  describe('disable', () => {
    it('should call pm.disable', async () => {
      mockManager.disable.mockResolvedValue(undefined);

      const caller = getAuthedCaller();
      const result = await caller.plugins.disable({ name: 'test-plugin' });

      expect(mockManager.disable).toHaveBeenCalledWith('test-plugin');
      expect(result).toEqual({ success: true });
    });
  });

  // --------------------------------------------------------------------------
  // getConfig / setConfig
  // --------------------------------------------------------------------------

  describe('getConfig', () => {
    it('should return config from plugin manager', async () => {
      mockManager.getPlugin.mockReturnValue(sampleLoaded);
      mockManager.getPluginConfig.mockReturnValue({ apiKey: '***', region: 'us-east-1' });

      const caller = getAuthedCaller();
      const result = await caller.plugins.getConfig({ name: 'test-plugin' });

      expect(result).toEqual({ apiKey: '***', region: 'us-east-1' });
    });

    it('should throw NOT_FOUND when plugin does not exist', async () => {
      mockManager.getPlugin.mockReturnValue(undefined);

      const caller = getAuthedCaller();
      await expect(caller.plugins.getConfig({ name: 'nope' })).rejects.toThrow('not found');
    });
  });

  describe('setConfig', () => {
    it('should call pm.setPluginConfig', async () => {
      mockManager.getPlugin.mockReturnValue(sampleLoaded);

      const caller = getAuthedCaller();
      const result = await caller.plugins.setConfig({
        name: 'test-plugin',
        config: { apiKey: 'new-key' },
      });

      expect(mockManager.setPluginConfig).toHaveBeenCalledWith('test-plugin', { apiKey: 'new-key' });
      expect(result).toEqual({ success: true });
    });

    it('should throw NOT_FOUND when plugin does not exist', async () => {
      mockManager.getPlugin.mockReturnValue(undefined);

      const caller = getAuthedCaller();
      await expect(
        caller.plugins.setConfig({ name: 'nope', config: {} })
      ).rejects.toThrow('not found');
    });
  });

  // --------------------------------------------------------------------------
  // validatePath
  // --------------------------------------------------------------------------

  describe('validatePath', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'animus-test-'));
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('should return valid for a correct plugin.json', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'plugin.json'),
        JSON.stringify(sampleManifest),
      );

      const caller = getAuthedCaller();
      const result = await caller.plugins.validatePath({ path: tmpDir });

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.manifest.name).toBe('test-plugin');
      }
    });

    it('should return invalid for missing plugin.json', async () => {
      const caller = getAuthedCaller();
      const result = await caller.plugins.validatePath({ path: tmpDir });

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should return invalid for malformed manifest', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'plugin.json'),
        JSON.stringify({ name: 123 }), // invalid — name must be string
      );

      const caller = getAuthedCaller();
      const result = await caller.plugins.validatePath({ path: tmpDir });

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
