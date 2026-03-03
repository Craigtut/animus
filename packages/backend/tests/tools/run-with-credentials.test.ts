/**
 * run_with_credentials Handler Tests
 *
 * Tests the credential resolution, env injection, subprocess execution,
 * vault ref support, output redaction, and audit logging of the
 * run_with_credentials tool handler.
 *
 * Subprocess execution is mocked since tests run in a sandbox.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ToolHandlerContext } from '../../src/tools/types.js';

// Mock the plugin manager before importing the handler
const mockGetPluginConfig = vi.fn();
vi.mock('../../src/plugins/index.js', () => ({
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

// Mock vault store
const mockGetVaultEntry = vi.fn();
vi.mock('../../src/db/stores/vault-store.js', () => ({
  getVaultEntry: (...args: unknown[]) => mockGetVaultEntry(...args),
}));

// Mock credential audit store
const mockLogCredentialAccess = vi.fn();
vi.mock('../../src/db/stores/credential-audit-store.js', () => ({
  logCredentialAccess: (...args: unknown[]) => mockLogCredentialAccess(...args),
}));

// Mock db/index
const mockSystemDb = {};
const mockAgentLogsDb = {};
vi.mock('../../src/db/index.js', () => ({
  getSystemDb: () => mockSystemDb,
  getAgentLogsDb: () => mockAgentLogsDb,
}));

// Track spawn calls so we can inspect env and command
interface SpawnCall {
  command: string;
  args: string[];
  options: { shell: boolean; env: Record<string, string | undefined>; cwd: string };
}

const spawnCalls: SpawnCall[] = [];

// Configurable spawn output
let nextSpawnOutput: { stdout: string; stderr: string; exitCode: number } | null = null;

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

    const output = nextSpawnOutput;
    nextSpawnOutput = null;

    queueMicrotask(() => {
      if (output) {
        if (output.stdout) stdout.emit('data', Buffer.from(output.stdout));
        if (output.stderr) stderr.emit('data', Buffer.from(output.stderr));
        proc.emit('exit', output.exitCode);
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
    nextSpawnOutput = null;
  });

  // --------------------------------------------------------------------------
  // Credential Reference Parsing
  // --------------------------------------------------------------------------

  describe('credential ref parsing', () => {
    it('should reject credentialRef without a dot separator or vault prefix', async () => {
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
  // Vault Credential References
  // --------------------------------------------------------------------------

  describe('vault credential refs', () => {
    it('should resolve vault:<id> references from the vault store', async () => {
      mockGetVaultEntry.mockReturnValue({
        id: 'vault-abc-123',
        label: 'GitHub',
        service: 'github.com',
        password: 'gh-vault-secret',
      });

      const result = await runWithCredentialsHandler(
        {
          command: 'git push',
          credentialRef: 'vault:vault-abc-123',
          envVar: 'GH_TOKEN',
        },
        createMockContext(),
      );

      expect(mockGetVaultEntry).toHaveBeenCalledWith(mockSystemDb, 'vault-abc-123');
      expect(result.isError).toBeFalsy();
      expect(spawnCalls).toHaveLength(1);
      expect(spawnCalls[0]!.options.env['GH_TOKEN']).toBe('gh-vault-secret');
    });

    it('should return error for nonexistent vault entry', async () => {
      mockGetVaultEntry.mockReturnValue(null);

      const result = await runWithCredentialsHandler(
        {
          command: 'echo test',
          credentialRef: 'vault:nonexistent-id',
          envVar: 'PASSWORD',
        },
        createMockContext(),
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('not found');
      expect(result.content[0]!.text).toContain('list_vault_entries');
      expect(spawnCalls).toHaveLength(0);
    });

    it('should return error for vault: with empty ID', async () => {
      const result = await runWithCredentialsHandler(
        {
          command: 'echo test',
          credentialRef: 'vault:',
          envVar: 'PASSWORD',
        },
        createMockContext(),
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('ID is empty');
      expect(spawnCalls).toHaveLength(0);
    });

    it('should support vault refs in additionalCredentials', async () => {
      mockGetPluginConfig.mockReturnValue({ API_KEY: 'plugin-key' });
      mockGetVaultEntry.mockReturnValue({
        id: 'vault-xyz',
        password: 'vault-password',
      });

      await runWithCredentialsHandler(
        {
          command: 'deploy.sh',
          credentialRef: 'deploy-plugin.API_KEY',
          envVar: 'DEPLOY_KEY',
          additionalCredentials: [
            { credentialRef: 'vault:vault-xyz', envVar: 'DB_PASSWORD' },
          ],
        },
        createMockContext(),
      );

      expect(spawnCalls).toHaveLength(1);
      const childEnv = spawnCalls[0]!.options.env;
      expect(childEnv['DEPLOY_KEY']).toBe('plugin-key');
      expect(childEnv['DB_PASSWORD']).toBe('vault-password');
    });
  });

  // --------------------------------------------------------------------------
  // Output Redaction
  // --------------------------------------------------------------------------

  describe('output redaction', () => {
    it('should redact credential values from stdout', async () => {
      const secret = 'my-super-secret-key-12345';
      mockGetPluginConfig.mockReturnValue({ API_KEY: secret });

      // Simulate command echoing the credential value
      nextSpawnOutput = {
        stdout: `Using key: ${secret}\nDone!\n`,
        stderr: '',
        exitCode: 0,
      };

      const result = await runWithCredentialsHandler(
        {
          command: 'echo $API_KEY',
          credentialRef: 'test-plugin.API_KEY',
          envVar: 'API_KEY',
        },
        createMockContext(),
      );

      // The raw secret should NOT appear in the output
      expect(result.content[0]!.text).not.toContain(secret);
      // It should be replaced with [REDACTED]
      expect(result.content[0]!.text).toContain('[REDACTED]');
      expect(result.content[0]!.text).toContain('Done!');
    });

    it('should redact credential values from stderr', async () => {
      const secret = 'secret-api-key-abcdef';
      mockGetPluginConfig.mockReturnValue({ KEY: secret });

      nextSpawnOutput = {
        stdout: '',
        stderr: `Error: invalid key ${secret}\n`,
        exitCode: 1,
      };

      const result = await runWithCredentialsHandler(
        {
          command: 'failing-cmd',
          credentialRef: 'test.KEY',
          envVar: 'MY_KEY',
        },
        createMockContext(),
      );

      expect(result.content[0]!.text).not.toContain(secret);
      expect(result.content[0]!.text).toContain('[REDACTED]');
    });

    it('should redact all injected credentials (primary + additional)', async () => {
      const secret1 = 'primary-secret-value';
      const secret2 = 'additional-secret-val';
      mockGetPluginConfig.mockReturnValue({
        KEY_A: secret1,
        KEY_B: secret2,
      });

      nextSpawnOutput = {
        stdout: `key1=${secret1}, key2=${secret2}\n`,
        stderr: '',
        exitCode: 0,
      };

      const result = await runWithCredentialsHandler(
        {
          command: 'show-keys',
          credentialRef: 'test.KEY_A',
          envVar: 'A',
          additionalCredentials: [
            { credentialRef: 'test.KEY_B', envVar: 'B' },
          ],
        },
        createMockContext(),
      );

      expect(result.content[0]!.text).not.toContain(secret1);
      expect(result.content[0]!.text).not.toContain(secret2);
    });

    it('should redact vault credential values from output', async () => {
      const vaultPass = 'vault-password-here!';
      mockGetVaultEntry.mockReturnValue({
        id: 'v1',
        password: vaultPass,
      });

      nextSpawnOutput = {
        stdout: `Password: ${vaultPass}\n`,
        stderr: '',
        exitCode: 0,
      };

      const result = await runWithCredentialsHandler(
        {
          command: 'echo $PW',
          credentialRef: 'vault:v1',
          envVar: 'PW',
        },
        createMockContext(),
      );

      expect(result.content[0]!.text).not.toContain(vaultPass);
      expect(result.content[0]!.text).toContain('[REDACTED]');
    });

    it('should not redact short secrets (less than 4 chars)', async () => {
      mockGetPluginConfig.mockReturnValue({ PIN: 'ab' });

      nextSpawnOutput = {
        stdout: 'ab is a common prefix\n',
        stderr: '',
        exitCode: 0,
      };

      const result = await runWithCredentialsHandler(
        {
          command: 'echo test',
          credentialRef: 'test.PIN',
          envVar: 'PIN',
        },
        createMockContext(),
      );

      // 'ab' is too short to redact (would cause false positives)
      expect(result.content[0]!.text).toContain('ab is a common prefix');
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

        expect(childEnv['ANTHROPIC_API_KEY']).toBeUndefined();
        expect(childEnv['OPENAI_API_KEY']).toBeUndefined();
        expect(childEnv['ANIMUS_ENCRYPTION_KEY']).toBeUndefined();
        expect(childEnv['CLAUDE_CODE_OAUTH_TOKEN']).toBeUndefined();
        expect(childEnv['MY_KEY']).toBe('secret');
      } finally {
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
      nextSpawnOutput = { stdout: '', stderr: 'error message\n', exitCode: 42 };
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
  // Audit Logging
  // --------------------------------------------------------------------------

  describe('audit logging', () => {
    it('should log plugin credential access', async () => {
      mockGetPluginConfig.mockReturnValue({ API_KEY: 'secret' });

      await runWithCredentialsHandler(
        {
          command: 'echo test',
          credentialRef: 'my-plugin.API_KEY',
          envVar: 'KEY',
        },
        createMockContext(),
      );

      expect(mockLogCredentialAccess).toHaveBeenCalledWith(
        mockAgentLogsDb,
        expect.objectContaining({
          credentialType: 'plugin',
          credentialRef: 'my-plugin.API_KEY',
          toolName: 'run_with_credentials',
        }),
      );
    });

    it('should log vault credential access', async () => {
      mockGetVaultEntry.mockReturnValue({ id: 'v1', password: 'pass' });

      await runWithCredentialsHandler(
        {
          command: 'echo test',
          credentialRef: 'vault:v1',
          envVar: 'PW',
        },
        createMockContext(),
      );

      expect(mockLogCredentialAccess).toHaveBeenCalledWith(
        mockAgentLogsDb,
        expect.objectContaining({
          credentialType: 'vault',
          credentialRef: 'vault:v1',
          toolName: 'run_with_credentials',
        }),
      );
    });

    it('should log additional credentials separately', async () => {
      mockGetPluginConfig.mockReturnValue({
        KEY_A: 'a-val',
        KEY_B: 'b-val',
      });

      await runWithCredentialsHandler(
        {
          command: 'echo test',
          credentialRef: 'test.KEY_A',
          envVar: 'A',
          additionalCredentials: [
            { credentialRef: 'test.KEY_B', envVar: 'B' },
          ],
        },
        createMockContext(),
      );

      // Should have logged both primary and additional
      expect(mockLogCredentialAccess).toHaveBeenCalledTimes(2);
    });

    it('should include agent context in audit log', async () => {
      mockGetPluginConfig.mockReturnValue({ KEY: 'val' });

      await runWithCredentialsHandler(
        {
          command: 'echo test',
          credentialRef: 'test.KEY',
          envVar: 'K',
        },
        createMockContext(),
      );

      expect(mockLogCredentialAccess).toHaveBeenCalledWith(
        mockAgentLogsDb,
        expect.objectContaining({
          agentContext: 'sub-agent:task-1',
        }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // Additional Credentials
  // --------------------------------------------------------------------------

  describe('additional credentials', () => {
    it('should inject additional credentials into child env', async () => {
      mockGetPluginConfig.mockReturnValue({
        API_KEY: 'key-value',
        API_TOKEN: 'token-value',
      });

      await runWithCredentialsHandler(
        {
          command: 'echo test',
          credentialRef: 'trello.API_KEY',
          envVar: 'TRELLO_API_KEY',
          additionalCredentials: [
            { credentialRef: 'trello.API_TOKEN', envVar: 'TRELLO_API_TOKEN' },
          ],
        },
        createMockContext(),
      );

      expect(spawnCalls).toHaveLength(1);
      const childEnv = spawnCalls[0]!.options.env;
      expect(childEnv['TRELLO_API_KEY']).toBe('key-value');
      expect(childEnv['TRELLO_API_TOKEN']).toBe('token-value');
    });

    it('should return error for invalid additional credentialRef', async () => {
      mockGetPluginConfig.mockReturnValue({ API_KEY: 'key-value' });

      const result = await runWithCredentialsHandler(
        {
          command: 'echo test',
          credentialRef: 'trello.API_KEY',
          envVar: 'TRELLO_API_KEY',
          additionalCredentials: [
            { credentialRef: 'no-dot', envVar: 'EXTRA' },
          ],
        },
        createMockContext(),
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('Invalid credentialRef');
      expect(spawnCalls).toHaveLength(0);
    });

    it('should return error when additional credential is not set', async () => {
      mockGetPluginConfig.mockReturnValue({ API_KEY: 'key-value' });

      const result = await runWithCredentialsHandler(
        {
          command: 'echo test',
          credentialRef: 'trello.API_KEY',
          envVar: 'TRELLO_API_KEY',
          additionalCredentials: [
            { credentialRef: 'trello.MISSING_TOKEN', envVar: 'TOKEN' },
          ],
        },
        createMockContext(),
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('not set');
      expect(result.content[0]!.text).toContain('MISSING_TOKEN');
      expect(spawnCalls).toHaveLength(0);
    });

    it('should work with no additional credentials (backwards compatible)', async () => {
      mockGetPluginConfig.mockReturnValue({ API_KEY: 'secret' });

      const result = await runWithCredentialsHandler(
        {
          command: 'echo test',
          credentialRef: 'test-plugin.API_KEY',
          envVar: 'MY_KEY',
        },
        createMockContext(),
      );

      expect(result.isError).toBeFalsy();
      expect(spawnCalls).toHaveLength(1);
    });

    it('should support multiple additional credentials', async () => {
      mockGetPluginConfig.mockImplementation((name: string) => {
        if (name === 'multi') return { KEY_A: 'a', KEY_B: 'b', KEY_C: 'c' };
        return null;
      });

      await runWithCredentialsHandler(
        {
          command: 'echo test',
          credentialRef: 'multi.KEY_A',
          envVar: 'ENV_A',
          additionalCredentials: [
            { credentialRef: 'multi.KEY_B', envVar: 'ENV_B' },
            { credentialRef: 'multi.KEY_C', envVar: 'ENV_C' },
          ],
        },
        createMockContext(),
      );

      expect(spawnCalls).toHaveLength(1);
      const childEnv = spawnCalls[0]!.options.env;
      expect(childEnv['ENV_A']).toBe('a');
      expect(childEnv['ENV_B']).toBe('b');
      expect(childEnv['ENV_C']).toBe('c');
    });
  });

  // --------------------------------------------------------------------------
  // Context Independence
  // --------------------------------------------------------------------------

  describe('context independence', () => {
    it('should not require ToolHandlerContext stores (uses plugin manager directly)', async () => {
      mockGetPluginConfig.mockReturnValue({ API_KEY: 'secret' });

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
