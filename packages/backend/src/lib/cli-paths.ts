/**
 * CLI Path Resolution -- finds SDK-bundled and native CLI binaries.
 *
 * Both the Claude Agent SDK and Codex SDK are subprocess wrappers that spawn
 * CLI binaries. This module provides a single source of truth for locating
 * those binaries, avoiding reliance on the system PATH (which is minimal
 * when Tauri launches from Finder/Spotlight/Dock).
 *
 * Resolution strategy:
 *   - Uses `createRequire` to locate SDK packages in node_modules (works in
 *     dev monorepo, Tauri production bundle, and Docker).
 *   - For Claude native binary: searches well-known install paths, then falls
 *     back to async `which` as last resort.
 *   - For Codex: builds path from `vendor/{targetTriple}/codex/codex` relative
 *     to the SDK package location.
 */

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { join, dirname } from 'node:path';
import { homedir, platform, arch } from 'node:os';
import { createLogger } from './logger.js';
import { DATA_DIR } from '../utils/env.js';

const log = createLogger('CliPaths', 'server');

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
 * - `nativeBinary`: The separately-installed native Claude Code binary
 *   (has auth login/logout/status). Searched in well-known paths.
 */
export function resolveClaudeCliPaths(): { bundledCliJs: string | null; nativeBinary: string | null } {
  if (_claudeCache) return _claudeCache;

  let bundledCliJs: string | null = null;
  let nativeBinary: string | null = null;

  // Find SDK-bundled cli.js
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
  if (!bundledCliJs) {
    const runtimeCliJs = join(DATA_DIR, 'sdks', 'claude', 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js');
    if (existsSync(runtimeCliJs)) {
      bundledCliJs = runtimeCliJs;
      log.debug(`Found Claude SDK cli.js at runtime path ${runtimeCliJs}`);
    }
  }

  // Find native binary in well-known locations
  const home = homedir();
  const wellKnownPaths = [
    join(home, '.local', 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ];

  for (const p of wellKnownPaths) {
    if (existsSync(p)) {
      nativeBinary = p;
      log.debug(`Found Claude native binary at ${p}`);
      break;
    }
  }

  _claudeCache = { bundledCliJs, nativeBinary };
  return _claudeCache;
}

/**
 * Find the Claude native binary asynchronously.
 * First checks cached well-known paths, then falls back to `which`.
 */
export async function getClaudeNativeBinaryAsync(): Promise<string | null> {
  const { nativeBinary } = resolveClaudeCliPaths();
  if (nativeBinary) return nativeBinary;

  // Fall back to `which` for non-standard install locations
  try {
    const result = await whichBinary('claude');
    if (result) {
      // Update cache
      _claudeCache = { bundledCliJs: _claudeCache?.bundledCliJs ?? null, nativeBinary: result };
      log.debug(`Found Claude native binary via which: ${result}`);
    }
    return result;
  } catch {
    return null;
  }
}

/**
 * Synchronous convenience for getting the Claude native binary path.
 * Only checks well-known paths (no `which` fallback).
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
 * This replaces the old `checkBinaryExists(name)` PATH-based detection.
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
// Helpers
// ============================================================================

/**
 * Locate a binary using `which` (async, with timeout).
 */
function whichBinary(name: string): Promise<string | null> {
  return new Promise((resolve) => {
    const cmd = platform() === 'win32' ? 'where' : 'which';
    execFile(cmd, [name], { timeout: 2000 }, (err, stdout) => {
      if (err) {
        resolve(null);
        return;
      }
      const result = stdout.trim().split('\n')[0]?.trim();
      resolve(result || null);
    });
  });
}

// ============================================================================
// Testing Helpers
// ============================================================================

/** @internal -- Reset caches for testing */
export function _resetCache(): void {
  _claudeCache = null;
  _codexCache = null;
}
