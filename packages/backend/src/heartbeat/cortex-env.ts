/**
 * Cortex environment overrides.
 *
 * Cortex sanitizes child-process environments for safety. In Tauri builds,
 * Animus intentionally sets a small set of macOS dock-suppression variables
 * that must survive that sanitization so child processes do not flash dock
 * icons. Only propagate values that match that narrow Tauri pattern.
 */

const PRELOAD_MARKER = 'preload-bg-policy.js';

export function buildCortexEnvOverrides(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> | undefined {
  const overrides: Record<string, string> = {};
  const dockSuppressAddon = env['ANIMUS_DOCK_SUPPRESS_ADDON'];

  if (dockSuppressAddon) {
    overrides['ANIMUS_DOCK_SUPPRESS_ADDON'] = dockSuppressAddon;
    overrides['DYLD_INSERT_LIBRARIES'] = dockSuppressAddon;
  }

  const nodeOptions = env['NODE_OPTIONS'];
  if (nodeOptions?.includes(PRELOAD_MARKER)) {
    overrides['NODE_OPTIONS'] = nodeOptions;
  }

  return Object.keys(overrides).length > 0 ? overrides : undefined;
}
