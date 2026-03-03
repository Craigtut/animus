/**
 * run_with_credentials handler — executes a command with credentials
 * injected as environment variables.
 *
 * Supports two credential reference formats:
 * - "pluginName.configKey" — resolved from encrypted plugin config
 * - "vault:<id>" — resolved from the password vault (system.db)
 *
 * Security features:
 * - Output redaction: stdout/stderr are scanned for injected credential
 *   values and any matches are replaced with [REDACTED] before returning
 *   to the LLM.
 * - Audit logging: every credential access is logged to agent_logs.db.
 * - Agent provider keys are stripped from the subprocess environment.
 *
 * See docs/architecture/credential-passing.md
 */

import { spawn } from 'node:child_process';
import type { z } from 'zod';
import type { ToolHandler, ToolResult } from '../types.js';
import { runWithCredentialsDef } from '@animus-labs/shared';
import { getPluginManager } from '../../plugins/index.js';
import { getSystemDb, getAgentLogsDb } from '../../db/index.js';
import * as vaultStore from '../../db/stores/vault-store.js';
import { logCredentialAccess } from '../../db/stores/credential-audit-store.js';
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
 * Redact all occurrences of credential values from output text.
 * Protects against echo $VAR or accidental credential exposure in stdout/stderr.
 */
function redactCredentials(text: string, secrets: string[]): string {
  let result = text;
  for (const secret of secrets) {
    // Only redact non-trivial secrets (at least 4 chars)
    if (secret.length >= 4) {
      // Use split+join for literal replacement (no regex escaping needed)
      result = result.split(secret).join('[REDACTED]');
    }
  }
  return result;
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

/**
 * Resolve a credential reference. Returns the value or an error result.
 *
 * Supports:
 * - "vault:<id>" — password from vault_entries table
 * - "pluginName.configKey" — value from plugin encrypted config
 */
interface ResolvedCredential {
  value: string;
  type: 'vault' | 'plugin';
}

function isResolved(result: ResolvedCredential | ToolResult): result is ResolvedCredential {
  return 'value' in result;
}

async function resolveCredentialRef(
  ref: string,
  pm: ReturnType<typeof getPluginManager>,
): Promise<ResolvedCredential | ToolResult> {
  // Check for vault: prefix
  if (ref.startsWith('vault:')) {
    const vaultId = ref.substring(6);
    if (!vaultId) {
      return {
        content: [{ type: 'text', text: 'Invalid vault reference: ID is empty. Expected "vault:<id>".' }],
        isError: true,
      };
    }

    try {
      const db = getSystemDb();
      const entry = vaultStore.getVaultEntry(db, vaultId);
      if (!entry) {
        return {
          content: [{
            type: 'text',
            text: `Vault entry "${vaultId}" not found. Use list_vault_entries to see available credentials.`,
          }],
          isError: true,
        };
      }
      return { value: entry.password, type: 'vault' };
    } catch (err) {
      return {
        content: [{
          type: 'text',
          text: `Failed to resolve vault credential: ${String(err)}`,
        }],
        isError: true,
      };
    }
  }

  // Plugin credential: "pluginName.configKey"
  const dotIndex = ref.indexOf('.');
  if (dotIndex === -1) {
    return {
      content: [{
        type: 'text',
        text: `Invalid credentialRef format: "${ref}". Expected "pluginName.configKey" or "vault:<id>".`,
      }],
      isError: true,
    };
  }

  const pluginName = ref.substring(0, dotIndex);
  const configKey = ref.substring(dotIndex + 1);

  if (!pluginName || !configKey) {
    return {
      content: [{
        type: 'text',
        text: `Invalid credentialRef: plugin name and config key must both be non-empty.`,
      }],
      isError: true,
    };
  }

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

  // Handle OAuth token objects
  if (
    typeof value === 'object' &&
    value !== null &&
    '__oauth' in (value as Record<string, unknown>) &&
    (value as Record<string, unknown>)['__oauth'] === true
  ) {
    const oauthData = value as Record<string, unknown>;
    const expiresAt = oauthData['expires_at'] as number | undefined;
    const fiveMinutes = 5 * 60 * 1000;

    let credentialValue: string;

    if (expiresAt && expiresAt - Date.now() < fiveMinutes) {
      try {
        const { refreshTokens } = await import('../../services/plugin-oauth.js');
        await refreshTokens(pluginName, configKey);
        const refreshedConfig = pm.getPluginConfig(pluginName);
        const refreshedOAuth = refreshedConfig?.[configKey] as Record<string, unknown> | undefined;
        credentialValue = (refreshedOAuth?.['access_token'] as string) ?? '';
      } catch (err) {
        log.warn(`OAuth token refresh failed for ${ref}, using existing token:`, err);
        credentialValue = (oauthData['access_token'] as string) ?? '';
      }
    } else {
      credentialValue = (oauthData['access_token'] as string) ?? '';
    }

    if (!credentialValue) {
      return {
        content: [{
          type: 'text',
          text: `OAuth token for "${configKey}" in plugin "${pluginName}" has no access_token. The user may need to re-authenticate in Settings > Plugins.`,
        }],
        isError: true,
      };
    }

    return { value: credentialValue, type: 'plugin' };
  }

  if (typeof value !== 'string' || !value) {
    return {
      content: [{
        type: 'text',
        text: `Credential "${configKey}" is not set for plugin "${pluginName}". The user needs to configure this in Settings > Plugins.`,
      }],
      isError: true,
    };
  }

  return { value, type: 'plugin' };
}

export const runWithCredentialsHandler: ToolHandler<RunWithCredentialsInput> = async (
  input,
  _context,
): Promise<ToolResult> => {
  const pm = getPluginManager();

  // Collect all credential values for redaction
  const injectedSecrets: string[] = [];

  // 1. Resolve primary credential
  const primary = await resolveCredentialRef(input.credentialRef, pm);
  if (!isResolved(primary)) return primary;

  injectedSecrets.push(primary.value);

  // 2. Build child-only env
  const childEnv: Record<string, string | undefined> = {
    ...process.env,
    [input.envVar]: primary.value,
  };

  // 3. Resolve additional credentials
  if (input.additionalCredentials) {
    for (const extra of input.additionalCredentials) {
      const resolved = await resolveCredentialRef(extra.credentialRef, pm);
      if (!isResolved(resolved)) return resolved;

      injectedSecrets.push(resolved.value);
      childEnv[extra.envVar] = resolved.value;

      // Audit log additional credentials
      try {
        const logsDb = getAgentLogsDb();
        logCredentialAccess(logsDb, {
          credentialType: resolved.type,
          credentialRef: extra.credentialRef,
          toolName: 'run_with_credentials',
          agentContext: _context.agentTaskId ? `sub-agent:${_context.agentTaskId}` : 'mind',
        });
      } catch {
        // Non-critical
      }
    }
  }

  // Strip agent provider keys
  for (const key of STRIPPED_ENV_KEYS) {
    delete childEnv[key];
  }

  // 4. Audit log primary credential access
  try {
    const logsDb = getAgentLogsDb();
    logCredentialAccess(logsDb, {
      credentialType: primary.type,
      credentialRef: input.credentialRef,
      toolName: 'run_with_credentials',
      agentContext: _context.agentTaskId ? `sub-agent:${_context.agentTaskId}` : 'mind',
    });
  } catch {
    // Non-critical
  }

  // 5. Spawn subprocess
  const cwd = input.cwd || PROJECT_ROOT;
  log.info(`Executing command with credential ${input.credentialRef} → ${input.envVar}`);

  const { stdout, stderr, exitCode } = await execCommand(input.command, {
    env: childEnv,
    cwd,
    timeout: TIMEOUT_MS,
  });

  // 6. Redact credential values from output before returning to LLM
  const redactedStdout = redactCredentials(stdout, injectedSecrets);
  const redactedStderr = redactCredentials(stderr, injectedSecrets);

  const text = formatOutput(redactedStdout, redactedStderr, exitCode);

  return {
    content: [{ type: 'text', text }],
    ...(exitCode !== 0 ? { isError: true } : {}),
  };
};
