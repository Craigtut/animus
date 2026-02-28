/**
 * Logger — NestJS-inspired colored logging with category filtering.
 *
 * Usage:
 *   const log = createLogger('Heartbeat', 'heartbeat');
 *   log.info('Starting tick #3 (interval)');
 *   log.warn('Session expired');
 *   log.error('Mind query failed:', err);
 *   log.debug('Context tokens: 4231');
 *
 * Output:
 *   [14:23:05] LOG   [Heartbeat] Starting tick #3 (interval)
 *   [14:23:05] WARN  [Heartbeat] Session expired
 *   [14:23:06] ERROR [Heartbeat] Mind query failed: Error: timeout
 */

import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import { env, DATA_DIR } from '../utils/env.js';

// ---------------------------------------------------------------------------
// Secret redaction
// ---------------------------------------------------------------------------

const REDACTION_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Anthropic API keys
  { pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/g, replacement: '[REDACTED:sk-ant-***]' },
  // OpenAI API keys
  { pattern: /sk-proj-[a-zA-Z0-9_-]{20,}/g, replacement: '[REDACTED:sk-proj-***]' },
  { pattern: /sk-[a-zA-Z0-9]{20,}/g, replacement: '[REDACTED:sk-***]' },
];

export function redactSecrets(text: string): string {
  let result = text;
  for (const { pattern, replacement } of REDACTION_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

// ---------------------------------------------------------------------------
// Level filtering (env-based hard floor)
// ---------------------------------------------------------------------------

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Padded + colored labels (5 chars each for alignment)
const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: pc.magenta('DEBUG'),
  info: pc.green('LOG  '),
  warn: pc.yellow('WARN '),
  error: pc.red('ERROR'),
};

function getMinLevel(): number {
  const l = env.LOG_LEVEL;
  if (l === 'trace' || l === 'debug') return LEVEL_PRIORITY.debug;
  if (l === 'info') return LEVEL_PRIORITY.info;
  if (l === 'warn') return LEVEL_PRIORITY.warn;
  return LEVEL_PRIORITY.error; // error | fatal
}

const MIN_LEVEL = getMinLevel();

// ---------------------------------------------------------------------------
// File Logging — always writes at debug level, plain text (no ANSI codes)
// ---------------------------------------------------------------------------

const LOG_DIR = path.join(DATA_DIR, 'logs');
/** Absolute path to the log file. Exported for external reference (e.g. MCP tools). */
export const LOG_FILE_PATH = path.join(LOG_DIR, 'animus.log');

const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB
let logFileReady = false;
let writeCounter = 0;

const PLAIN_LEVEL_LABELS: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'LOG  ',
  warn: 'WARN ',
  error: 'ERROR',
};

function ensureLogDir(): boolean {
  if (logFileReady) return true;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    // Rotate on startup: shift .1→.2, current→.1, start fresh.
    // Keeps two previous sessions max (animus.log, .1, .2).
    try {
      const exists = fs.statSync(LOG_FILE_PATH);
      if (exists.size > 0) {
        try { fs.unlinkSync(LOG_FILE_PATH + '.2'); } catch { /* ok */ }
        try { fs.renameSync(LOG_FILE_PATH + '.1', LOG_FILE_PATH + '.2'); } catch { /* ok */ }
        fs.renameSync(LOG_FILE_PATH, LOG_FILE_PATH + '.1');
      }
    } catch { /* no existing log file, nothing to rotate */ }
    logFileReady = true;
    return true;
  } catch {
    return false;
  }
}

function rotateIfNeeded(): void {
  try {
    const stats = fs.statSync(LOG_FILE_PATH);
    if (stats.size > MAX_LOG_SIZE) {
      try { fs.unlinkSync(LOG_FILE_PATH + '.2'); } catch { /* ok */ }
      try { fs.renameSync(LOG_FILE_PATH + '.1', LOG_FILE_PATH + '.2'); } catch { /* ok */ }
      fs.renameSync(LOG_FILE_PATH, LOG_FILE_PATH + '.1');
    }
  } catch { /* file doesn't exist yet */ }
}

function writeToLogFile(level: LogLevel, name: string, args: unknown[]): void {
  if (!ensureLogDir()) return;
  try {
    if (writeCounter++ % 100 === 0) rotateIfNeeded();

    const ts = new Date().toISOString();
    const msg = args
      .map((a) =>
        typeof a === 'string' ? a
        : a instanceof Error ? `${a.message}${a.stack ? '\n' + a.stack : ''}`
        : JSON.stringify(a)
      )
      .join(' ');

    const line = `[${ts}] ${PLAIN_LEVEL_LABELS[level]} [${name}] ${msg}\n`;
    fs.appendFileSync(LOG_FILE_PATH, redactSecrets(line));
  } catch { /* never crash on log write failure */ }
}

// ---------------------------------------------------------------------------
// Console suppression (for sandbox TUI mode)
// ---------------------------------------------------------------------------

let consoleSuppressed = false;

/** Suppress all console output from loggers. File logging continues. */
export function suppressConsole(): void {
  consoleSuppressed = true;
}

// ---------------------------------------------------------------------------
// Category filtering (DB-persisted, cached in memory)
// ---------------------------------------------------------------------------

let categoryCache: Record<string, boolean> = {};

/** Refresh the in-memory category cache (called after DB update). */
export function updateCategoryCache(categories: Record<string, boolean>): void {
  categoryCache = { ...categories };
}

/** Check if a category is enabled. Unknown categories default to ON. */
function isCategoryEnabled(category: string): boolean {
  return categoryCache[category] !== false;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return pc.dim(`[${h}:${m}:${s}]`);
}

function context(name: string): string {
  return pc.yellow(`[${name}]`);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a logger bound to a context name and category.
 *
 * @param name     Display name shown in brackets (e.g. "Heartbeat")
 * @param category Category key for DB filtering (defaults to lowercase name)
 */
export function createLogger(name: string, category?: string): Logger {
  const ctx = context(name);
  const cat = category ?? name.toLowerCase();

  function log(level: LogLevel, args: unknown[]): void {
    // Always write to file (captures everything regardless of level/category)
    writeToLogFile(level, name, args);

    // Console output respects level, category filters, and suppression
    if (consoleSuppressed) return;
    if (LEVEL_PRIORITY[level] < MIN_LEVEL) return;
    if (!isCategoryEnabled(cat)) return;

    const prefix = `${timestamp()} ${LEVEL_LABELS[level]} ${ctx}`;
    const method =
      level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    const redactedArgs = args.map(a => typeof a === 'string' ? redactSecrets(a) : a);
    method(prefix, ...redactedArgs);
  }

  return {
    debug: (...args) => log('debug', args),
    info: (...args) => log('info', args),
    warn: (...args) => log('warn', args),
    error: (...args) => log('error', args),
  };
}
