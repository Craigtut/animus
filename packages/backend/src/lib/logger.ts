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

import pc from 'picocolors';
import { env } from '../utils/env.js';

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
    if (LEVEL_PRIORITY[level] < MIN_LEVEL) return;
    if (!isCategoryEnabled(cat)) return;

    const prefix = `${timestamp()} ${LEVEL_LABELS[level]} ${ctx}`;
    const method =
      level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    method(prefix, ...args);
  }

  return {
    debug: (...args) => log('debug', args),
    info: (...args) => log('info', args),
    warn: (...args) => log('warn', args),
    error: (...args) => log('error', args),
  };
}
