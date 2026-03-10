/**
 * CLI Path Resolution -- thin re-export from @animus-labs/agents.
 *
 * All resolution logic now lives in the agents package. This file exists
 * to preserve backend import paths during the migration.
 */

export {
  resolveClaudeCliPaths,
  getClaudeNativeBinary,
  resolveCodexCliPaths,
  getCodexBundledBinary,
  checkSdkAvailable,
  _resetSdkCache as _resetCache,
} from '@animus-labs/agents';

/**
 * Find the Claude native binary asynchronously.
 * Now delegates to the sync version (no `which` fallback).
 */
export async function getClaudeNativeBinaryAsync(): Promise<string | null> {
  const { getClaudeNativeBinary: getNative } = await import('@animus-labs/agents');
  return getNative();
}
