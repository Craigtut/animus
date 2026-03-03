/**
 * File Deny List -- blocks agent access to security-critical files.
 *
 * Checked in the canUseTool callback before any permission lookups.
 * This prevents the AI agent from reading vault.json, .env, encryption
 * source files, or using shell commands to query OS keychains.
 * See docs/architecture/encryption-architecture.md.
 */

import path from 'node:path';

// ---------------------------------------------------------------------------
// Blocked file paths
// ---------------------------------------------------------------------------

const BLOCKED_PATH_PATTERNS: RegExp[] = [
  // Vault and legacy secrets
  /vault\.json$/,
  /\.secrets$/,
  /\.secrets\.migrated$/,
  // JWT key
  /jwt\.key$/,
  // Environment files
  /\.env$/,
  /\.env\.\w+$/, // .env.local, .env.production, etc.
  // Security-critical source files
  /encryption-service\.[tj]s$/,
  /vault-manager\.[tj]s$/,
  /vault-migration\.[tj]s$/,
  /secrets-manager\.[tj]s$/,
  /jwt-key\.[tj]s$/,
  /file-deny-list\.[tj]s$/,
];

/**
 * Check if a file path is blocked for agent access.
 * Resolves relative paths to absolute before checking.
 */
export function isBlockedPath(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  return BLOCKED_PATH_PATTERNS.some((pattern) => pattern.test(resolved));
}

// ---------------------------------------------------------------------------
// Blocked shell commands
// ---------------------------------------------------------------------------

const BLOCKED_COMMAND_PATTERNS: RegExp[] = [
  // macOS Keychain
  /security\s+find-generic-password/,
  /security\s+find-internet-password/,
  // Linux keyring
  /secret-tool\s+lookup/,
  /secret-tool\s+search/,
  // Direct reads of blocked files via shell
  /cat\s+.*vault\.json/,
  /cat\s+.*\.secrets/,
  /cat\s+.*jwt\.key/,
  /cat\s+.*\.env\b/,
];

/**
 * Check if a shell command is blocked for agent access.
 */
export function isBlockedCommand(command: string): boolean {
  return BLOCKED_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}
