/**
 * SDK Path Resolution -- finds SDK-bundled and native CLI binaries.
 *
 * Both the Claude Agent SDK and Codex SDK are subprocess wrappers that spawn
 * CLI binaries. This module provides a single source of truth for locating
 * those binaries.
 *
 * Resolution strategy:
 *   - Uses `createRequire` to locate SDK packages in node_modules (works in
 *     dev monorepo, Tauri production bundle, and Docker).
 *   - For Claude native binary: searches a controlled install path under
 *     dataDir (installed via `node cli.js install`).
 *   - For Codex: builds path from `vendor/{targetTriple}/codex/codex` relative
 *     to the SDK package location.
 *
 * No system PATH fallbacks (`which`/`where`) are used. All binaries are
 * resolved from known, deterministic locations.
 */

import { createRequire } from 'node:module';
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { platform, arch } from 'node:os';
import { createTaggedLogger, type Logger } from '../logger.js';

let log: Logger = createTaggedLogger('SdkResolver');

// ============================================================================
// Configuration
// ============================================================================

let _dataDir: string | null = null;

export interface SdkResolverConfig {
  /** Base data directory (e.g., `data/sdks`). Used to locate runtime-installed SDKs. */
  dataDir?: string;
  /** Custom logger instance. */
  logger?: Logger;
}

/**
 * Configure the SDK resolver with the application's data directory.
 * Must be called before resolution functions if runtime SDK paths are needed.
 */
export function configureSdkResolver(config: SdkResolverConfig): void {
  if (config.dataDir) {
    _dataDir = config.dataDir;
  }
  if (config.logger) {
    log = config.logger;
  }
  // Reset caches when reconfigured
  _resetCache();
}

// ============================================================================
// Cache
// ============================================================================

let _claudeCache: { bundledCliJs: string | null; nativeBinary: string | null } | null = null;
let _codexCache: { bundledBinary: string | null } | null = null;

// ============================================================================
// Claude CLI Paths
// ============================================================================

/**
 * Resolve paths for Claude CLI binaries.
 *
 * - `bundledCliJs`: The SDK-bundled `cli.js` (agent execution engine only,
 *   no auth subcommands). Found via createRequire.
 * - `nativeBinary`: The native Claude Code binary installed via
 *   `node cli.js install` to `dataDir/claude/versions/`. Has auth commands.
 */
export function resolveClaudeCliPaths(): { bundledCliJs: string | null; nativeBinary: string | null } {
  if (_claudeCache) return _claudeCache;

  let bundledCliJs: string | null = null;
  let nativeBinary: string | null = null;

  // Find SDK-bundled cli.js via createRequire
  try {
    const require = createRequire(import.meta.url);
    const sdkPkgPath = require.resolve('@anthropic-ai/claude-agent-sdk/package.json');
    const sdkDir = dirname(sdkPkgPath);
    const cliJsPath = join(sdkDir, 'cli.js');
    if (existsSync(cliJsPath)) {
      bundledCliJs = cliJsPath;
      log.debug(`Found Claude SDK cli.js at ${cliJsPath}`);
    }
  } catch {
    log.debug('Claude Agent SDK package not found in node_modules');
  }

  // Fallback: check runtime-installed SDK (Tauri production)
  if (!bundledCliJs && _dataDir) {
    const runtimeCliJs = join(_dataDir, 'claude', 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js');
    if (existsSync(runtimeCliJs)) {
      bundledCliJs = runtimeCliJs;
      log.debug(`Found Claude SDK cli.js at runtime path ${runtimeCliJs}`);
    }
  }

  // Find native binary installed via `node cli.js install`
  // Located at dataDir/claude/claude/versions/*/claude[.exe]
  if (_dataDir) {
    nativeBinary = findClaudeNativeBinaryInDataDir(_dataDir);
  }

  _claudeCache = { bundledCliJs, nativeBinary };
  return _claudeCache;
}

/**
 * Find the most recent Claude native binary in the controlled data directory.
 * Scans dataDir/claude/claude/versions/{version}/claude[.exe].
 */
function findClaudeNativeBinaryInDataDir(dataDir: string): string | null {
  const isWindows = platform() === 'win32';
  const binaryName = isWindows ? 'claude.exe' : 'claude';
  const versionsDir = join(dataDir, 'claude', 'claude', 'versions');

  if (!existsSync(versionsDir)) return null;

  try {
    const entries = readdirSync(versionsDir, { withFileTypes: true }).sort((a, b) =>
      b.name.localeCompare(a.name),
    );
    for (const entry of entries) {
      if (entry.isFile()) {
        // SDK v0.2+: binary is the version file itself (e.g., versions/2.1.72)
        const binaryPath = join(versionsDir, entry.name);
        log.debug(`Found Claude native binary at ${binaryPath}`);
        return binaryPath;
      }
      if (entry.isDirectory()) {
        // SDK v0.1.x: binary inside version subdirectory (e.g., versions/2.0.77/claude)
        const binaryPath = join(versionsDir, entry.name, binaryName);
        if (existsSync(binaryPath)) {
          log.debug(`Found Claude native binary at ${binaryPath}`);
          return binaryPath;
        }
      }
    }
  } catch {
    log.debug('Could not scan Claude versions directory');
  }

  return null;
}

/**
 * Synchronous convenience for getting the Claude native binary path.
 * Only checks the controlled data directory (no system PATH fallback).
 */
export function getClaudeNativeBinary(): string | null {
  return resolveClaudeCliPaths().nativeBinary;
}

// ============================================================================
// Codex CLI Paths
// ============================================================================

/**
 * Map platform + arch to Codex SDK vendor target triple.
 */
function getCodexTargetTriple(): string | null {
  const p = platform();
  const a = arch();

  const map: Record<string, string> = {
    'darwin-arm64': 'aarch64-apple-darwin',
    'darwin-x64': 'x86_64-apple-darwin',
    'linux-arm64': 'aarch64-unknown-linux-musl',
    'linux-x64': 'x86_64-unknown-linux-musl',
    'win32-arm64': 'aarch64-pc-windows-msvc',
    'win32-x64': 'x86_64-pc-windows-msvc',
  };

  return map[`${p}-${a}`] ?? null;
}

/**
 * Resolve the path to the Codex SDK-bundled native binary.
 *
 * The Codex SDK bundles a complete native binary with ALL subcommands
 * (login, logout, status, etc.) at `vendor/{targetTriple}/codex/codex`.
 */
export function resolveCodexCliPaths(): { bundledBinary: string | null } {
  if (_codexCache) return _codexCache;

  let bundledBinary: string | null = null;

  try {
    // The Codex SDK's exports field only has an "import" condition (no "require"),
    // so createRequire().resolve() fails. Instead, use resolve.paths to get the
    // node_modules search directories, then check each for the package directly.
    const require = createRequire(import.meta.url);
    const searchPaths = require.resolve.paths('@openai/codex-sdk') ?? [];
    let sdkDir: string | null = null;
    for (const searchPath of searchPaths) {
      const candidate = join(searchPath, '@openai', 'codex-sdk');
      if (existsSync(join(candidate, 'package.json'))) {
        sdkDir = candidate;
        break;
      }
    }
    if (!sdkDir) throw new Error('Codex SDK not found');

    const triple = getCodexTargetTriple();
    if (triple) {
      const binaryName = platform() === 'win32' ? 'codex.exe' : 'codex';
      const binaryPath = join(sdkDir, 'vendor', triple, 'codex', binaryName);
      if (existsSync(binaryPath)) {
        bundledBinary = binaryPath;
        log.debug(`Found Codex bundled binary at ${binaryPath}`);
      } else {
        log.debug(`Codex binary not found at expected path: ${binaryPath}`);
      }
    } else {
      log.debug(`No Codex target triple mapping for ${platform()}-${arch()}`);
    }
  } catch {
    log.debug('Codex SDK package not found in node_modules');
  }

  _codexCache = { bundledBinary };
  return _codexCache;
}

/**
 * Convenience for getting the Codex bundled binary path.
 */
export function getCodexBundledBinary(): string | null {
  return resolveCodexCliPaths().bundledBinary;
}

// ============================================================================
// SDK Availability Check
// ============================================================================

/**
 * Check whether the SDK for a provider is available (bundled CLI exists).
 */
export function checkSdkAvailable(provider: 'claude' | 'codex'): boolean {
  if (provider === 'claude') {
    const { bundledCliJs } = resolveClaudeCliPaths();
    return bundledCliJs !== null;
  }
  if (provider === 'codex') {
    const { bundledBinary } = resolveCodexCliPaths();
    return bundledBinary !== null;
  }
  return false;
}

// ============================================================================
// Testing Helpers
// ============================================================================

/** @internal -- Reset caches for testing or reconfiguration */
export function _resetCache(): void {
  _claudeCache = null;
  _codexCache = null;
}
