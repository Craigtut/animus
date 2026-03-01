/**
 * Process Diagnostics — lightweight production debugging for process tree visibility.
 *
 * Logs process identity, environment, spawn events, and exit events to both
 * the backend logger AND a dedicated process-tree.log file for easy grep-based analysis.
 *
 * Output format (one line per event, grep-friendly):
 *   [PROC] t=<epoch> ctx=<context> event=<type> key=value ...
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from '../utils/env.js';
import { createLogger } from './logger.js';

const __diag_dirname = path.dirname(fileURLToPath(import.meta.url));

const log = createLogger('ProcessDiag', 'server');

const LOG_FILE = path.join(DATA_DIR, 'logs', 'process-tree.log');
const MAX_LOG_SIZE = 2 * 1024 * 1024; // 2MB

// ============================================================================
// File Writer
// ============================================================================

let fileReady = false;

function ensureFile(): boolean {
  if (fileReady) return true;
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    // Rotate on first use if file is large
    try {
      const stats = fs.statSync(LOG_FILE);
      if (stats.size > MAX_LOG_SIZE) {
        try { fs.unlinkSync(LOG_FILE + '.1'); } catch { /* ok */ }
        fs.renameSync(LOG_FILE, LOG_FILE + '.1');
      }
    } catch { /* file doesn't exist yet */ }
    fileReady = true;
    return true;
  } catch {
    return false;
  }
}

function writeLine(line: string): void {
  if (!ensureFile()) return;
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch { /* never crash on log failure */ }
}

// ============================================================================
// Formatting Helpers
// ============================================================================

function ts(): number {
  return Math.floor(Date.now() / 1000);
}

function pad(ctx: string): string {
  return ctx.padEnd(20);
}

function summarizeEnvValue(key: string, value: string | undefined): string {
  if (!value) return 'unset';
  if (key === 'PATH') return value.substring(0, 80) + (value.length > 80 ? '...' : '');
  if (value.length > 100) return value.substring(0, 100) + '...';
  return value;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Log process identity on startup. Call once per process.
 */
export function logProcessIdentity(context: string): void {
  const line = `[PROC] t=${ts()} ctx=${pad(context)} event=identity pid=${process.pid} ppid=${process.ppid} execPath=${process.execPath} __dirname=${__diag_dirname}`;
  writeLine(line);
  log.info(`[PROC] identity: ctx=${context} pid=${process.pid} execPath=${process.execPath}`);

  // Log key environment variables
  const envKeys = [
    'PATH',
    'DYLD_INSERT_LIBRARIES',
    'NODE_OPTIONS',
    'ANIMUS_DOCK_SUPPRESS_ADDON',
    'ANIMUS_DATA_DIR',
    'NODE_ENV',
  ];
  const envParts = envKeys
    .map(k => `${k}=${summarizeEnvValue(k, process.env[k])}`)
    .join(' ');
  const envLine = `[PROC] t=${ts()} ctx=${pad(context)} event=env ${envParts}`;
  writeLine(envLine);
  log.debug(`[PROC] env: ctx=${context} DYLD=${process.env['DYLD_INSERT_LIBRARIES'] ? 'set' : 'unset'} NODE_OPTIONS=${process.env['NODE_OPTIONS'] ? 'set' : 'unset'}`);
}

/**
 * Log a process spawn event. Call before every spawn()/fork() call.
 */
export function logProcessSpawn(
  context: string,
  cmd: string,
  args: string[],
  env?: Record<string, string | undefined>,
): void {
  const dyld = env?.['DYLD_INSERT_LIBRARIES'] ?? process.env['DYLD_INSERT_LIBRARIES'];
  const nodeOpts = env?.['NODE_OPTIONS'] ?? process.env['NODE_OPTIONS'];
  const line = `[PROC] t=${ts()} ctx=${pad(context)} event=spawn cmd=${cmd} args=${args.join(',')} DYLD=${dyld ? 'set' : 'unset'} NODE_OPTIONS=${nodeOpts ? 'set' : 'unset'}`;
  writeLine(line);
  log.info(`[PROC] spawn: ctx=${context} cmd=${cmd} args=[${args.join(', ')}]`);
}

/**
 * Log a process exit event. Call on every child process exit.
 */
export function logProcessExit(
  context: string,
  pid: number,
  code: number | null,
  signal: string | null,
): void {
  const line = `[PROC] t=${ts()} ctx=${pad(context)} event=exit pid=${pid} code=${code} signal=${signal}`;
  writeLine(line);
  log.info(`[PROC] exit: ctx=${context} pid=${pid} code=${code} signal=${signal}`);
}

/**
 * Log an error event for a child process.
 */
export function logProcessError(
  context: string,
  error: Error,
): void {
  const line = `[PROC] t=${ts()} ctx=${pad(context)} event=error message=${error.message}`;
  writeLine(line);
  log.error(`[PROC] error: ctx=${context}`, error);
}
