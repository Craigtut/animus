/**
 * Shared environment sanitization for child processes.
 *
 * Used by both the Bash tool (safety.ts) and MCP client (mcp-client.ts)
 * to strip dangerous environment variables before spawning subprocesses.
 */

// ---------------------------------------------------------------------------
// Blocked variables
// ---------------------------------------------------------------------------

const BLOCKED_ENV_PREFIXES = ['LD_', 'DYLD_', 'BASH_FUNC_'];

const BLOCKED_ENV_VARS = new Set([
  // Runtime loaders
  'NODE_OPTIONS', 'NODE_PATH',
  'PYTHONPATH', 'PYTHONHOME',
  'PERL5LIB', 'PERL5OPT',
  'RUBYLIB', 'RUBYOPT',
  // Shell startup injection
  'BASH_ENV', 'ENV', 'SHELLOPTS', 'PS4', 'IFS', 'PROMPT_COMMAND', 'ZDOTDIR',
  // Git execution
  'GIT_EXTERNAL_DIFF', 'GIT_EXEC_PATH', 'GIT_SSH_COMMAND',
  // Security-sensitive
  'SSLKEYLOGFILE', 'GCONV_PATH', 'OPENSSL_CONF', 'CURL_HOME', 'WGETRC',
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a safe environment for child processes by stripping dangerous variables.
 *
 * @param parentEnv - The source environment (typically process.env or a consumer-supplied map)
 * @param marker - Optional context marker added as CORTEX_SHELL. Pass undefined to skip.
 * @param overrides - Optional key-value pairs merged ON TOP of the sanitized env, bypassing
 *   the blocklist. Used for consumer-set variables that must propagate (e.g., macOS dock
 *   icon suppression vars like DYLD_INSERT_LIBRARIES).
 * @returns A new object with dangerous variables removed and overrides applied
 */
export function buildSafeEnv(
  parentEnv: NodeJS.ProcessEnv | Record<string, string>,
  marker?: string | undefined,
  overrides?: Record<string, string> | undefined,
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(parentEnv)) {
    if (value === undefined) continue;

    // Check exact match
    if (BLOCKED_ENV_VARS.has(key)) continue;

    // Check prefix match
    let blocked = false;
    for (const prefix of BLOCKED_ENV_PREFIXES) {
      if (key.startsWith(prefix)) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;

    env[key] = value;
  }

  if (marker !== undefined) {
    env['CORTEX_SHELL'] = marker;
  }

  // Merge overrides ON TOP of the sanitized env, bypassing the blocklist.
  // This allows consumers to restore specific blocked variables (e.g.,
  // DYLD_INSERT_LIBRARIES for macOS dock icon suppression).
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      env[key] = value;
    }
  }

  return env;
}
