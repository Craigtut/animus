/**
 * run_with_credentials Handler Tests
 *
 * Tests the credential resolution, env injection, and subprocess execution
 * of the run_with_credentials tool handler.
 *
 * Subprocess execution is mocked since tests run in a sandbox.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ToolHandlerContext } from '../../src/tools/types.js';

// Mock the plugin manager before importing the handler
const mockGetPluginConfig = vi.fn();
vi.mock('../../src/services/plugin-manager.js', () => ({
  getPluginManager: () => ({
    getPluginConfig: mockGetPluginConfig,
  }),
}));

// Mock the logger
vi.mock('../../src/lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock the env module
vi.mock('../../src/utils/env.js', () => ({
  PROJECT_ROOT: '/tmp/animus-test',
  DATA_DIR: '/tmp/animus-test/data',
}));

// Track spawn calls so we can inspect env and command
interface SpawnCall {
  command: string;
  args: string[];
  options: { shell: boolean; env: Record<string, string | undefined>; cwd: string };
}

const spawnCalls: SpawnCall[] = [];

// Flag to simulate failure in the next spawn call
let nextSpawnFailure: { exitCode: number; stderr: string } | null = null;

// Mock child_process.spawn
vi.mock('node:child_process', () => ({
  spawn: (command: string, args: string[], options: any) => {
    spawnCalls.push({ command, args, options });

    const proc = new EventEmitter() as any;
    const stdin = new EventEmitter() as any;
    stdin.end = vi.fn();
    proc.stdin = stdin;

    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    proc.stdout = stdout;
    proc.stderr = stderr;
    proc.kill = vi.fn();

    const failure = nextSpawnFailure;
    nextSpawnFailure = null;

    queueMicrotask(() => {
      if (failure) {
        stderr.emit('data', Buffer.from(failure.stderr));
        proc.emit('exit', failure.exitCode);
      } else {
        stdout.emit('data', Buffer.from('command output\n'));
        proc.emit('exit', 0);
      }
    });

    return proc;
  },
}));

import { runWithCredentialsHandler } from '../../src/tools/handlers/run-with-credentials.js';

// ============================================================================
// Test Helpers
// ============================================================================

function createMockContext(): ToolHandlerContext {
  return {
    agentTaskId: 'task-1',
    contactId: 'contact-1',
    sourceChannel: 'web',
    conversationId: 'conv-1',
    stores: {
      messages: { createMessage: () => ({ id: 'msg-1' }) },
      heartbeat: {},
      memory: { retrieveRelevant: async () => [] },
    },
    eventBus: { on: () => {}, off: () => {}, emit: () => {}, once: () => {} },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('run_with_credentials handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spawnCalls.length = 0;
    nextSpawnFailure = null;
  });

  // --------------------------------------------------------------------------
  // Credential Reference Parsing
  // --------------------------------------------------------------------------

  describe('credential ref parsing', () => {
    it('should reject credentialRef without a dot separator', async () => {
      const result = await runWithCredentialsHandler(
        {
          command: 'echo hello',
          credentialRef: 'no-dot-here',
          envVar: 'API_KEY',
        },
        createMockContext(),
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('Invalid credentialRef format');
      expect(result.content[0]!.text).toContain('pluginName.configKey');
      // Should NOT have spawned any subprocess
      expect(spawnCalls).toHaveLength(0);
    });

    it('should reject credentialRef with empty plugin name', async () => {
      const result = await runWithCredentialsHandler(
        {
          command: 'echo hello',
          credentialRef: '.SOME_KEY',
          envVar: 'API_KEY',
        },
        createMockContext(),
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('non-empty');
      expect(spawnCalls).toHaveLength(0);
    });

    it('should reject credentialRef with empty config key', async () => {
      const result = await runWithCredentialsHandler(
        {
          command: 'echo hello',
          credentialRef: 'my-plugin.',
          envVar: 'API_KEY',
        },
        createMockContext(),
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('non-empty');
      expect(spawnCalls).toHaveLength(0);
    });

    it('should handle credentialRef with multiple dots correctly', async () => {
      // "plugin.name.with.dots" → pluginName = "plugin", configKey = "name.with.dots"
      mockGetPluginConfig.mockReturnValue({ 'name.with.dots': 'secret-value' });

      const result = await runWithCredentialsHandler(
        {
          command: 'echo test',
          credentialRef: 'plugin.name.with.dots',
          envVar: 'API_KEY',
        },
        createMockContext(),
      );

      expect(mockGetPluginConfig).toHaveBeenCalledWith('plugin');
      expect(result.isError).toBeFalsy();
    });
  });

  // --------------------------------------------------------------------------
  // Plugin Config Resolution
  // --------------------------------------------------------------------------

  describe('plugin config resolution', () => {
    it('should return error when plugin is not found', async () => {
      mockGetPluginConfig.mockReturnValue(null);

      const result = await runWithCredentialsHandler(
        {
          command: 'echo hello',
          credentialRef: 'nonexistent-plugin.API_KEY',
          envVar: 'API_KEY',
        },
        createMockContext(),
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('not found or has no configuration');
      expect(result.content[0]!.text).toContain('nonexistent-plugin');
      expect(spawnCalls).toHaveLength(0);
    });

    it('should return error when credential key is not set', async () => {
      mockGetPluginConfig.mockReturnValue({ OTHER_KEY: 'value' });

      const result = await runWithCredentialsHandler(
        {
          command: 'echo hello',
          credentialRef: 'my-plugin.MISSING_KEY',
          envVar: 'API_KEY',
        },
        createMockContext(),
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('not set');
      expect(result.content[0]!.text).toContain('MISSING_KEY');
      expect(spawnCalls).toHaveLength(0);
    });

    it('should return error when credential value is empty string', async () => {
      mockGetPluginConfig.mockReturnValue({ API_KEY: '' });

      const result = await runWithCredentialsHandler(
        {
          command: 'echo hello',
          credentialRef: 'my-plugin.API_KEY',
          envVar: 'API_KEY',
        },
        createMockContext(),
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('not set');
      expect(spawnCalls).toHaveLength(0);
    });

    it('should return error when credential value is not a string', async () => {
      mockGetPluginConfig.mockReturnValue({ API_KEY: 12345 });

      const result = await runWithCredentialsHandler(
        {
          command: 'echo hello',
          credentialRef: 'my-plugin.API_KEY',
          envVar: 'API_KEY',
        },
        createMockContext(),
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('not set');
      expect(spawnCalls).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // Subprocess Execution
  // --------------------------------------------------------------------------

  describe('subprocess execution', () => {
    it('should spawn subprocess with the command in shell mode', async () => {
      mockGetPluginConfig.mockReturnValue({ GEMINI_API_KEY: 'sk-test-key-12345' });

      const result = await runWithCredentialsHandler(
        {
          command: 'node scripts/generate.js --prompt "test"',
          credentialRef: 'nano-banana-pro.GEMINI_API_KEY',
          envVar: 'GEMINI_API_KEY',
        },
        createMockContext(),
      );

      expect(spawnCalls).toHaveLength(1);
      expect(spawnCalls[0]!.command).toBe('node scripts/generate.js --prompt "test"');
      expect(spawnCalls[0]!.options.shell).toBe(true);
      expect(result.isError).toBeFalsy();
      expect(result.content[0]!.text).toContain('exit code 0');
    });

    it('should inject credential as the specified env var', async () => {
      mockGetPluginConfig.mockReturnValue({ API_KEY: 'my-secret-value' });

      await runWithCredentialsHandler(
        {
          command: 'echo test',
          credentialRef: 'test-plugin.API_KEY',
          envVar: 'MY_CUSTOM_ENV',
        },
        createMockContext(),
      );

      expect(spawnCalls).toHaveLength(1);
      const childEnv = spawnCalls[0]!.options.env;
      expect(childEnv['MY_CUSTOM_ENV']).toBe('my-secret-value');
    });

    it('should strip agent provider keys from child env', async () => {
      // Temporarily set provider keys in process.env
      const originalAnthropicKey = process.env['ANTHROPIC_API_KEY'];
      const originalOpenAIKey = process.env['OPENAI_API_KEY'];
      const originalEncryptionKey = process.env['ANIMUS_ENCRYPTION_KEY'];
      process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test';
      process.env['OPENAI_API_KEY'] = 'sk-oai-test';
      process.env['ANIMUS_ENCRYPTION_KEY'] = 'encryption-key';

      mockGetPluginConfig.mockReturnValue({ API_KEY: 'secret' });

      try {
        await runWithCredentialsHandler(
          {
            command: 'echo test',
            credentialRef: 'test-plugin.API_KEY',
            envVar: 'MY_KEY',
          },
          createMockContext(),
        );

        expect(spawnCalls).toHaveLength(1);
        const childEnv = spawnCalls[0]!.options.env;

        // These should be stripped
        expect(childEnv['ANTHROPIC_API_KEY']).toBeUndefined();
        expect(childEnv['OPENAI_API_KEY']).toBeUndefined();
        expect(childEnv['ANIMUS_ENCRYPTION_KEY']).toBeUndefined();
        expect(childEnv['CLAUDE_CODE_OAUTH_TOKEN']).toBeUndefined();

        // The injected key should be present
        expect(childEnv['MY_KEY']).toBe('secret');
      } finally {
        // Restore
        if (originalAnthropicKey !== undefined) process.env['ANTHROPIC_API_KEY'] = originalAnthropicKey;
        else delete process.env['ANTHROPIC_API_KEY'];
        if (originalOpenAIKey !== undefined) process.env['OPENAI_API_KEY'] = originalOpenAIKey;
        else delete process.env['OPENAI_API_KEY'];
        if (originalEncryptionKey !== undefined) process.env['ANIMUS_ENCRYPTION_KEY'] = originalEncryptionKey;
        else delete process.env['ANIMUS_ENCRYPTION_KEY'];
      }
    });

    it('should use PROJECT_ROOT as default cwd', async () => {
      mockGetPluginConfig.mockReturnValue({ API_KEY: 'secret' });

      await runWithCredentialsHandler(
        {
          command: 'echo test',
          credentialRef: 'test-plugin.API_KEY',
          envVar: 'MY_KEY',
        },
        createMockContext(),
      );

      expect(spawnCalls[0]!.options.cwd).toBe('/tmp/animus-test');
    });

    it('should use custom cwd when provided', async () => {
      mockGetPluginConfig.mockReturnValue({ API_KEY: 'secret' });

      await runWithCredentialsHandler(
        {
          command: 'echo test',
          credentialRef: 'test-plugin.API_KEY',
          envVar: 'MY_KEY',
          cwd: '/custom/directory',
        },
        createMockContext(),
      );

      expect(spawnCalls[0]!.options.cwd).toBe('/custom/directory');
    });

    it('should report exit code on command failure', async () => {
      nextSpawnFailure = { exitCode: 42, stderr: 'error message\n' };
      mockGetPluginConfig.mockReturnValue({ API_KEY: 'secret' });

      const result = await runWithCredentialsHandler(
        {
          command: 'failing-command',
          credentialRef: 'test-plugin.API_KEY',
          envVar: 'MY_KEY',
        },
        createMockContext(),
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('exit code 42');
      expect(result.content[0]!.text).toContain('STDERR');
      expect(result.content[0]!.text).toContain('error message');
    });
  });

  // --------------------------------------------------------------------------
  // Output Format
  // --------------------------------------------------------------------------

  describe('output formatting', () => {
    it('should format successful output with stdout', async () => {
      mockGetPluginConfig.mockReturnValue({ API_KEY: 'secret' });

      const result = await runWithCredentialsHandler(
        {
          command: 'echo "output line"',
          credentialRef: 'test-plugin.API_KEY',
          envVar: 'MY_KEY',
        },
        createMockContext(),
      );

      expect(result.isError).toBeFalsy();
      expect(result.content[0]!.text).toContain('successfully');
      expect(result.content[0]!.text).toContain('exit code 0');
      expect(result.content[0]!.text).toContain('STDOUT');
      expect(result.content[0]!.text).toContain('command output');
    });

    it('should not include raw credential value in formatted output', async () => {
      const secretValue = 'super-secret-api-key-that-must-not-appear';
      mockGetPluginConfig.mockReturnValue({ API_KEY: secretValue });

      const result = await runWithCredentialsHandler(
        {
          command: 'echo "safe output"',
          credentialRef: 'test-plugin.API_KEY',
          envVar: 'MY_KEY',
        },
        createMockContext(),
      );

      // The credential should not appear in the tool result text
      // (it's in the env but we don't serialize the env in the output)
      expect(result.content[0]!.text).not.toContain(secretValue);
    });
  });

  // --------------------------------------------------------------------------
  // Context Independence
  // --------------------------------------------------------------------------

  describe('context independence', () => {
    it('should not require ToolHandlerContext stores (uses plugin manager directly)', async () => {
      mockGetPluginConfig.mockReturnValue({ API_KEY: 'secret' });

      // Even with minimal context (no stores), should work
      const minimalContext: ToolHandlerContext = {
        agentTaskId: 'task-1',
        contactId: '',
        sourceChannel: 'web',
        conversationId: '',
        stores: {
          messages: { createMessage: () => ({ id: '' }) },
          heartbeat: {},
          memory: { retrieveRelevant: async () => [] },
        },
        eventBus: { on: () => {}, off: () => {}, emit: () => {}, once: () => {} },
      };

      const result = await runWithCredentialsHandler(
        {
          command: 'echo test',
          credentialRef: 'test-plugin.API_KEY',
          envVar: 'MY_KEY',
        },
        minimalContext,
      );

      expect(result.isError).toBeFalsy();
    });
  });
});
