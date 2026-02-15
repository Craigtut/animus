/**
 * run_with_credentials handler — executes a command with a plugin credential
 * injected as an environment variable.
 *
 * The credential is resolved from encrypted plugin config at execution time.
 * The LLM never sees the raw value — only the credential reference name.
 *
 * Works identically for mind and sub-agents since it resolves credentials
 * directly from the plugin manager singleton (not through tool context).
 *
 * See docs/architecture/credential-passing.md
 */

import { spawn } from 'node:child_process';
import type { z } from 'zod';
import type { ToolHandler, ToolResult } from '../types.js';
import { runWithCredentialsDef } from '@animus/shared';
import { getPluginManager } from '../../services/plugin-manager.js';
import { PROJECT_ROOT } from '../../utils/env.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('RunWithCredentials', 'heartbeat');

type RunWithCredentialsInput = z.infer<typeof runWithCredentialsDef.inputSchema>;

/** Keys to strip from child subprocess environment (agent provider credentials). */
const STRIPPED_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANIMUS_ENCRYPTION_KEY',
];

const TIMEOUT_MS = 120_000;

/**
 * Execute a shell command and return stdout, stderr, and exit code.
 */
function execCommand(
  command: string,
  options: { env: NodeJS.ProcessEnv; cwd: string; timeout: number },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn(command, [], {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: options.env,
      cwd: options.cwd,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill('SIGTERM');
        resolve({ stdout, stderr: stderr + '\n[Process timed out]', exitCode: 124 });
      }
    }, options.timeout);

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ stdout, stderr: `Spawn error: ${err.message}`, exitCode: 1 });
      }
    });

    proc.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    // Close stdin immediately (no input needed)
    proc.stdin?.end();
  });
}

/**
 * Format the subprocess output for the tool result.
 */
function formatOutput(stdout: string, stderr: string, exitCode: number): string {
  const parts: string[] = [];

  if (exitCode === 0) {
    parts.push(`Command completed successfully (exit code 0).`);
  } else {
    parts.push(`Command failed with exit code ${exitCode}.`);
  }

  if (stdout.trim()) {
    parts.push(`\nSTDOUT:\n${stdout.trim()}`);
  }

  if (stderr.trim()) {
    parts.push(`\nSTDERR:\n${stderr.trim()}`);
  }

  return parts.join('\n');
}

export const runWithCredentialsHandler: ToolHandler<RunWithCredentialsInput> = async (
  input,
  _context,
): Promise<ToolResult> => {
  const pm = getPluginManager();

  // 1. Parse credential ref: "pluginName.configKey"
  const dotIndex = input.credentialRef.indexOf('.');
  if (dotIndex === -1) {
    return {
      content: [{
        type: 'text',
        text: `Invalid credentialRef format: "${input.credentialRef}". Expected "pluginName.configKey" (e.g., "nano-banana-pro.GEMINI_API_KEY").`,
      }],
      isError: true,
    };
  }

  const pluginName = input.credentialRef.substring(0, dotIndex);
  const configKey = input.credentialRef.substring(dotIndex + 1);

  if (!pluginName || !configKey) {
    return {
      content: [{
        type: 'text',
        text: `Invalid credentialRef: plugin name and config key must both be non-empty.`,
      }],
      isError: true,
    };
  }

  // 2. Resolve from decrypted plugin config
  const config = pm.getPluginConfig(pluginName);
  if (!config) {
    return {
      content: [{
        type: 'text',
        text: `Plugin "${pluginName}" not found or has no configuration set. The user needs to configure this plugin in Settings > Plugins.`,
      }],
      isError: true,
    };
  }

  const value = config[configKey];
  if (typeof value !== 'string' || !value) {
    return {
      content: [{
        type: 'text',
        text: `Credential "${configKey}" is not set for plugin "${pluginName}". The user needs to configure this in Settings > Plugins.`,
      }],
      isError: true,
    };
  }

  // 3. Build child-only env (strip agent provider keys)
  const childEnv = { ...process.env, [input.envVar]: value };
  for (const key of STRIPPED_ENV_KEYS) {
    delete childEnv[key];
  }

  // 4. Spawn subprocess
  const cwd = input.cwd || PROJECT_ROOT;
  log.info(`Executing command with credential ${input.credentialRef} → ${input.envVar}`);

  const { stdout, stderr, exitCode } = await execCommand(input.command, {
    env: childEnv,
    cwd,
    timeout: TIMEOUT_MS,
  });

  // 5. Return output (never the credential value)
  const text = formatOutput(stdout, stderr, exitCode);

  return {
    content: [{ type: 'text', text }],
    ...(exitCode !== 0 ? { isError: true } : {}),
  };
};
