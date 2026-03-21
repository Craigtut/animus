/**
 * Test fixtures for eval tests.
 *
 * Provides realistic conversation histories with known facts
 * that can be verified after compaction.
 */

import type { AgentMessage } from '../../../src/context-manager.js';

// ---------------------------------------------------------------------------
// Conversation fixture: refactoring a config module
// ---------------------------------------------------------------------------

/**
 * A realistic 30-turn conversation about refactoring a configuration module.
 * Contains specific facts (file paths, function names, errors, decisions)
 * that should survive compaction.
 */
export const CONFIG_REFACTOR_CONVERSATION: AgentMessage[] = [
  { role: 'user', content: 'I need to refactor the config module in packages/backend/src/config/index.ts. It has grown to over 800 lines and mixes validation, defaults, and environment parsing.' },
  { role: 'assistant', content: 'Let me read the file to understand the current structure.\n\n[Reading packages/backend/src/config/index.ts]\n\nThe file has 847 lines with three main concerns mixed together:\n1. Environment variable parsing (lines 1-280)\n2. Default value definitions (lines 281-520)\n3. Zod schema validation (lines 521-847)\n\nI recommend splitting this into three files:\n- `env-parser.ts` for environment variable reading\n- `defaults.ts` for default configurations\n- `schemas.ts` for Zod validation schemas\n- `index.ts` becomes a thin re-export barrel' },
  { role: 'user', content: 'That sounds good. But make sure the DATABASE_URL parsing stays in env-parser.ts since it has the special fallback logic for SQLite paths.' },
  { role: 'assistant', content: 'Understood. The DATABASE_URL parser at line 45-78 has the SQLite path resolution logic that checks for both absolute and relative paths, falling back to `data/databases/` when relative. I\'ll keep that intact in env-parser.ts.\n\nLet me start by creating the new files.' },
  { role: 'user', content: 'Wait, before you start, what about the circular dependency with the logger? The config module imports from logger.ts but logger.ts also imports config for log level settings.' },
  { role: 'assistant', content: 'Good catch. There\'s a circular dependency:\n- `config/index.ts` imports `createLogger` from `lib/logger.ts` (line 12)\n- `lib/logger.ts` imports `getLogLevel` from `config/index.ts` (line 8)\n\nThe fix: extract `getLogLevel()` into a standalone `config/log-level.ts` that has zero imports from the config barrel. Logger imports only from that file. The main config can still use the logger for validation warnings.\n\nThis breaks the cycle cleanly.' },
  { role: 'user', content: 'Perfect. Do that.' },
  { role: 'assistant', content: 'Creating `config/log-level.ts`...\n\n```typescript\n// config/log-level.ts\nexport type LogLevel = \'debug\' | \'info\' | \'warn\' | \'error\';\n\nconst VALID_LEVELS: LogLevel[] = [\'debug\', \'info\', \'warn\', \'error\'];\n\nexport function getLogLevel(): LogLevel {\n  const raw = process.env.LOG_LEVEL?.toLowerCase();\n  if (raw && VALID_LEVELS.includes(raw as LogLevel)) {\n    return raw as LogLevel;\n  }\n  return \'info\';\n}\n```\n\nNow updating `lib/logger.ts` to import from the new file instead of config...' },
  { role: 'user', content: 'Good. Now create the env-parser.ts file.' },
  { role: 'assistant', content: 'Creating `config/env-parser.ts`...\n\nI\'ve moved the environment variable parsing functions (lines 1-280 from the original). Key functions:\n- `parsePort()` - PORT with fallback to 3000\n- `parseDatabaseUrl()` - DATABASE_URL with SQLite path resolution\n- `parseNodeEnv()` - NODE_ENV validation\n- `parseTickInterval()` - HEARTBEAT_TICK_INTERVAL_MS with min/max bounds (30000-3600000)\n- `parseBoolEnv()` - Generic boolean env parser\n\nThe DATABASE_URL fallback logic is preserved exactly as-is at lines 45-78.' },
  { role: 'assistant', content: 'I also found an issue while extracting: `parseTickInterval()` was silently clamping values below 30 seconds to 30 seconds without logging. Added a warning log when clamping occurs:\n\n```typescript\nif (parsed < MIN_TICK_MS) {\n  log.warn(`HEARTBEAT_TICK_INTERVAL_MS=${parsed}ms is below minimum (${MIN_TICK_MS}ms), clamping`);\n  return MIN_TICK_MS;\n}\n```' },
  { role: 'user', content: 'Hmm, don\'t log from env-parser. Remember we just broke the circular dependency. If env-parser imports logger, we might recreate it.' },
  { role: 'assistant', content: 'You\'re right. The logger depends on log-level.ts which is part of the config system. If env-parser imports logger, we risk a new cycle.\n\nI\'ll use `console.warn()` instead for this one case since it happens during startup before the logger is initialized anyway. This matches the existing pattern in `utils/env.ts` which also uses raw console for pre-logger warnings.' },
  { role: 'user', content: 'Yes, that\'s fine. Continue with defaults.ts.' },
  { role: 'assistant', content: 'Creating `config/defaults.ts`...\n\nThis file exports the `DEFAULT_CONFIG` object with all default values:\n\n```typescript\nexport const DEFAULT_CONFIG = {\n  port: 3000,\n  host: \'0.0.0.0\',\n  nodeEnv: \'development\' as const,\n  heartbeat: {\n    tickIntervalMs: 300_000, // 5 minutes\n    maxTickDurationMs: 120_000, // 2 minutes\n    enableAutoStart: true,\n  },\n  database: {\n    baseDir: \'data/databases\',\n    walMode: true,\n    busyTimeout: 5000,\n  },\n  memory: {\n    embeddingModel: \'Xenova/bge-small-en-v1.5\',\n    vectorDimensions: 384,\n    maxRetrievalResults: 20,\n  },\n  security: {\n    encryptionKeyLength: 32,\n    sessionTtlMs: 86_400_000, // 24 hours\n  },\n} as const;\n```\n\nMoved from lines 281-520 of the original.' },
  { role: 'assistant', content: 'Now creating `config/schemas.ts` with the Zod validation schemas...\n\nKey schemas extracted:\n- `PortSchema` - z.number().int().min(1).max(65535)\n- `HeartbeatConfigSchema` - tick interval, max duration, auto-start\n- `DatabaseConfigSchema` - base dir, WAL mode, busy timeout\n- `MemoryConfigSchema` - embedding model, vector dims, max results\n- `SecurityConfigSchema` - encryption key length, session TTL\n- `AppConfigSchema` - top-level composition of all sub-schemas\n\nI hit an issue: the original `AppConfigSchema` uses `.transform()` to apply defaults, but with defaults now in a separate file, I need to import from `defaults.ts`. That\'s fine since schemas importing defaults is a clean one-way dependency.' },
  { role: 'user', content: 'Looks good. Now update the barrel index.ts to re-export everything.' },
  { role: 'assistant', content: 'Updating `config/index.ts` to be a barrel re-export:\n\n```typescript\n// config/index.ts - Barrel re-export\nexport { getLogLevel } from \'./log-level.js\';\nexport type { LogLevel } from \'./log-level.js\';\nexport { parsePort, parseDatabaseUrl, parseNodeEnv, parseTickInterval, parseBoolEnv } from \'./env-parser.js\';\nexport { DEFAULT_CONFIG } from \'./defaults.js\';\nexport { PortSchema, HeartbeatConfigSchema, DatabaseConfigSchema, MemoryConfigSchema, SecurityConfigSchema, AppConfigSchema } from \'./schemas.js\';\nexport type { AppConfig, HeartbeatConfig, DatabaseConfig, MemoryConfig, SecurityConfig } from \'./schemas.js\';\n```\n\nAll 23 existing import sites across the codebase will continue to work since they import from `config/index.js` (the barrel).' },
  { role: 'user', content: 'Run the tests to make sure nothing is broken.' },
  { role: 'assistant', content: 'Running tests...\n\n```\nnpm run test:run\n```\n\nResults:\n- 142 tests passed\n- 3 tests failed:\n  1. `config.test.ts > validates tick interval bounds` - Expected error message changed\n  2. `config.test.ts > applies defaults for missing env vars` - Import path issue\n  3. `heartbeat.test.ts > respects config tick interval` - Type mismatch after refactor\n\nLet me fix these.' },
  { role: 'assistant', content: 'Fix 1: `config.test.ts > validates tick interval bounds`\nThe test expected the old error message "Invalid tick interval". After extraction, the Zod schema now throws "Number must be greater than or equal to 30000". Updated the test assertion.\n\nFix 2: `config.test.ts > applies defaults for missing env vars`\nThe test was importing `DEFAULT_CONFIG` from `config/index` but the barrel wasn\'t re-exporting the type. Added the missing type export.\n\nFix 3: `heartbeat.test.ts > respects config tick interval`\nThe `HeartbeatConfig` type changed from `{ tickInterval: number }` to `{ tickIntervalMs: number }` during extraction (I normalized the name). Updated the 4 references in heartbeat.test.ts.\n\nAll 145 tests now pass.' },
  { role: 'user', content: 'Actually, don\'t rename tickInterval to tickIntervalMs. That\'s a separate change and will require updating too many places. Revert that naming change.' },
  { role: 'assistant', content: 'You\'re right, mixing a rename into a refactor makes the diff harder to review. Reverted `tickIntervalMs` back to `tickInterval` in the schema and defaults. The 4 test references go back to their original names.\n\nAll 145 tests pass with the original naming.' },
  { role: 'user', content: 'Good. What\'s the final file count and line count?' },
  { role: 'assistant', content: 'Final structure:\n\n```\nconfig/\n  index.ts       - 18 lines (barrel re-export)\n  log-level.ts   - 14 lines (standalone, breaks circular dep)\n  env-parser.ts  - 156 lines (environment variable parsing)\n  defaults.ts    - 48 lines (default configuration values)\n  schemas.ts     - 245 lines (Zod validation schemas)\n```\n\nTotal: 481 lines across 5 files (down from 847 lines in 1 file). The reduction comes from removing duplicate comments and consolidating some redundant type definitions that were copy-pasted within the original monolith.\n\nThe circular dependency between config and logger is fully resolved.' },
  { role: 'user', content: 'Commit this with a good message.' },
  { role: 'assistant', content: 'Creating commit...\n\n```\ngit add packages/backend/src/config/\ngit add packages/backend/tests/config.test.ts\ngit add packages/backend/tests/heartbeat.test.ts\ngit add packages/backend/src/lib/logger.ts\ngit commit -m "refactor(backend): split config module into focused files"\n```\n\nCommitted as `refactor(backend): split config module into focused files`.' },
  { role: 'user', content: 'Now I want to add a new config option for the observational memory reflection interval. It should be configurable via OBSERVATION_REFLECT_INTERVAL_MS with a default of 600000 (10 minutes).' },
  { role: 'assistant', content: 'Adding the new config option across the refactored structure:\n\n1. `config/env-parser.ts`: Added `parseReflectInterval()` with bounds checking (60000-3600000ms)\n2. `config/defaults.ts`: Added to DEFAULT_CONFIG.memory: `reflectIntervalMs: 600_000`\n3. `config/schemas.ts`: Added `reflectIntervalMs` to MemoryConfigSchema with `.default(600_000)`\n4. `config/index.ts`: Re-exported `parseReflectInterval`\n\nAlso added a test case in `config.test.ts` for the new parser.' },
  { role: 'user', content: 'What is the valid range you set?' },
  { role: 'assistant', content: 'The valid range for OBSERVATION_REFLECT_INTERVAL_MS is:\n- Minimum: 60,000ms (1 minute)\n- Maximum: 3,600,000ms (1 hour)\n- Default: 600,000ms (10 minutes)\n\nValues below minimum are clamped with a console.warn (matching the pattern from parseTickInterval). Values above maximum are also clamped.' },
];

/**
 * Known facts that MUST survive compaction of the CONFIG_REFACTOR_CONVERSATION.
 * These are specific, verifiable details from the conversation.
 */
export const CONFIG_REFACTOR_FACTS = [
  'The original config file was packages/backend/src/config/index.ts with 847 lines',
  'A circular dependency existed between config/index.ts and lib/logger.ts',
  'The fix for the circular dependency was creating a standalone config/log-level.ts file',
  'The user explicitly said NOT to rename tickInterval to tickIntervalMs (revert the naming change)',
  'The DATABASE_URL parser has special SQLite path fallback logic (lines 45-78)',
  'env-parser.ts must NOT import from the logger (use console.warn instead)',
  'The embedding model used is Xenova/bge-small-en-v1.5 with 384 vector dimensions',
  'The OBSERVATION_REFLECT_INTERVAL_MS range is 60000-3600000ms with default 600000ms',
  'All 145 tests pass after the refactor',
  'The final structure has 5 files totaling 481 lines (down from 847)',
];

// ---------------------------------------------------------------------------
// Conversation fixture: debugging a memory leak
// ---------------------------------------------------------------------------

/**
 * A shorter 16-turn conversation about debugging a WebSocket memory leak.
 * Tests compaction with a different topic and error-recovery patterns.
 */
export const MEMORY_LEAK_CONVERSATION: AgentMessage[] = [
  { role: 'user', content: 'The backend is leaking memory. After running for 24 hours, RSS grows from 180MB to over 2GB. I suspect it\'s the WebSocket subscription handler.' },
  { role: 'assistant', content: 'Let me check the WebSocket subscription code.\n\n[Reading packages/backend/src/api/subscriptions.ts]\n\nI see a potential issue at line 89: the `onHeartbeat` subscription creates a new EventEmitter listener on each connection but never removes it on disconnect:\n\n```typescript\n// Line 89-95\nconst handler = (data: HeartbeatState) => emit.next(data);\neventBus.on(\'heartbeat:tick\', handler);\n// Missing: no cleanup on unsubscribe\n```\n\nEach client connection adds a listener that\'s never removed. Over 24 hours with reconnections, this accumulates thousands of dead listeners.' },
  { role: 'user', content: 'That would explain it. What\'s the fix?' },
  { role: 'assistant', content: 'Add cleanup in the subscription\'s return/unsubscribe handler:\n\n```typescript\nonHeartbeat: publicProcedure.subscription(() => {\n  return observable<HeartbeatState>((emit) => {\n    const handler = (data: HeartbeatState) => emit.next(data);\n    eventBus.on(\'heartbeat:tick\', handler);\n    \n    // Cleanup on unsubscribe\n    return () => {\n      eventBus.off(\'heartbeat:tick\', handler);\n    };\n  });\n});\n```\n\nThe `return () => { ... }` function is called by tRPC when the client disconnects or unsubscribes.' },
  { role: 'user', content: 'Apply that fix. Also check if there are other subscriptions with the same issue.' },
  { role: 'assistant', content: 'Fixed `onHeartbeat`. Scanning other subscriptions...\n\nFound 3 more with the same pattern (missing cleanup):\n1. `onAgentLog` (line 124) - EventBus listener for agent_log events\n2. `onEmotionUpdate` (line 156) - EventBus listener for emotion changes\n3. `onTaskProgress` (line 201) - EventBus listener for task status updates\n\nAll four now have proper cleanup functions. The pattern is consistent: each adds an EventBus listener and returns a cleanup function that calls `eventBus.off()`.' },
  { role: 'user', content: 'Good. Are there any other potential memory leak sources you can see?' },
  { role: 'assistant', content: 'Scanning for common Node.js memory leak patterns...\n\nFound one more issue in `packages/backend/src/heartbeat/mind-session.ts` at line 312:\n\n```typescript\n// Growing array that\'s never trimmed\nprivate thoughtHistory: Thought[] = [];\n```\n\nThis array accumulates every thought from every tick for the entire session lifetime. With a 5-minute tick interval, that\'s 288 thoughts/day, each potentially containing large tool result strings.\n\nRecommended fix: cap `thoughtHistory` to the most recent N entries (e.g., 50) and use a ring buffer pattern.' },
  { role: 'user', content: 'Add a cap of 100 thoughts. Use a simple slice, no need for a ring buffer.' },
  { role: 'assistant', content: 'Applied the cap:\n\n```typescript\nprivate static MAX_THOUGHT_HISTORY = 100;\n\naddThought(thought: Thought): void {\n  this.thoughtHistory.push(thought);\n  if (this.thoughtHistory.length > MindSession.MAX_THOUGHT_HISTORY) {\n    this.thoughtHistory = this.thoughtHistory.slice(-MindSession.MAX_THOUGHT_HISTORY);\n  }\n}\n```\n\nThis keeps the most recent 100 thoughts and discards older ones. The slice creates a new array which allows the old entries to be garbage collected.' },
  { role: 'user', content: 'Run the tests.' },
  { role: 'assistant', content: 'Running tests...\n\n```\nnpm run test:run\n```\n\nAll 145 tests pass. The subscription cleanup fix and thought history cap don\'t break any existing behavior since:\n1. Tests mock the EventBus and don\'t test cleanup lifecycle\n2. No tests assert on thoughtHistory length beyond 100 entries' },
  { role: 'user', content: 'We should add tests for the cleanup. Can you add a test that verifies listeners are removed on unsubscribe?' },
  { role: 'assistant', content: 'Added test in `packages/backend/tests/api/subscriptions.test.ts`:\n\n```typescript\ndescribe(\'subscription cleanup\', () => {\n  it(\'removes heartbeat listener on unsubscribe\', () => {\n    const mockBus = new EventEmitter();\n    expect(mockBus.listenerCount(\'heartbeat:tick\')).toBe(0);\n    \n    const cleanup = subscribeToHeartbeat(mockBus);\n    expect(mockBus.listenerCount(\'heartbeat:tick\')).toBe(1);\n    \n    cleanup();\n    expect(mockBus.listenerCount(\'heartbeat:tick\')).toBe(0);\n  });\n});\n```\n\nSimilar tests added for all 4 subscription endpoints. All 149 tests pass (4 new tests).' },
  { role: 'user', content: 'Good work. Commit everything.' },
  { role: 'assistant', content: 'Creating commit...\n\n```\ngit commit -m "fix(backend): plug WebSocket subscription memory leaks and cap thought history"\n```\n\nCommitted. The fix addresses:\n1. Four WebSocket subscription handlers missing EventBus listener cleanup\n2. Unbounded thoughtHistory array in MindSession (capped to 100)\n3. Added 4 new tests for subscription cleanup verification' },
];

/**
 * Known facts that MUST survive compaction of the MEMORY_LEAK_CONVERSATION.
 */
export const MEMORY_LEAK_FACTS = [
  'The memory leak was in packages/backend/src/api/subscriptions.ts at line 89',
  'Four subscription handlers were missing EventBus listener cleanup (onHeartbeat, onAgentLog, onEmotionUpdate, onTaskProgress)',
  'The fix pattern is returning a cleanup function that calls eventBus.off()',
  'A second leak was found in mind-session.ts line 312: unbounded thoughtHistory array',
  'The thoughtHistory was capped to 100 entries using slice (not a ring buffer)',
  'All 149 tests pass after the fixes (including 4 new cleanup tests)',
];

// ---------------------------------------------------------------------------
// Conversation fixture: auth system refactor (large, ~80K tokens)
// ---------------------------------------------------------------------------

/**
 * A large ~80K token conversation about refactoring an authentication system.
 * This is a realistic coding agent session where a developer asks the agent
 * to split a monolithic auth.ts into modular components. During the process
 * they discover a security vulnerability (MD5 hashing), fix a race condition
 * in session token refresh, add rate limiting, fix tests, and resolve a
 * circular dependency.
 *
 * The conversation uses structured tool_use / tool_result messages to
 * simulate real agent tool interactions with large file reads.
 */
export const AUTH_REFACTOR_CONVERSATION: AgentMessage[] = [
  // --- Turn 1: User kicks off the auth refactor ---
  { role: 'user', content: 'I need to refactor our authentication system. Right now everything is in a single file at /src/auth/index.ts that has grown to over 1,200 lines. It handles password hashing, session management, JWT tokens, rate limiting, OAuth integration, and middleware. I want to split it into separate modules. Can you start by reading the file?' },

  // --- Turn 2: Agent reads the monolithic auth file ---
  { role: 'assistant', content: [
    { type: 'text', text: 'Let me read the current auth file to understand its structure.' },
    { type: 'tool_use', name: 'Read', input: { path: '/src/auth/index.ts' } }
  ] },

  // --- Turn 3: Tool result with the full monolithic auth file (~500 lines) ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Read', text: `import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { db } from '../db/connection.js';
import { EventBus } from '../lib/event-bus.js';
import { createLogger } from '../lib/logger.js';
import { RateLimiter } from '../lib/rate-limiter.js';
import { OAuthClient } from '../lib/oauth-client.js';

const log = createLogger('Auth', 'auth');

// ============================================================================
// Types and Schemas
// ============================================================================

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  salt: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  failedLoginAttempts: number;
  lockedUntil: string | null;
  twoFactorEnabled: boolean;
  twoFactorSecret: string | null;
  emailVerified: boolean;
  emailVerificationToken: string | null;
}

export type UserRole = 'admin' | 'user' | 'moderator' | 'readonly';

export const LoginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  rememberMe: z.boolean().optional().default(false),
});

export const RegisterSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one digit')
    .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
  displayName: z.string().min(2).max(50),
});

export const ResetPasswordSchema = z.object({
  token: z.string().uuid(),
  newPassword: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one digit')
    .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one digit')
    .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
});

export interface Session {
  id: string;
  userId: string;
  token: string;
  refreshToken: string;
  expiresAt: string;
  refreshExpiresAt: string;
  createdAt: string;
  lastActivityAt: string;
  ipAddress: string;
  userAgent: string;
  isRevoked: boolean;
}

export interface TokenPayload {
  sub: string;
  email: string;
  role: UserRole;
  sessionId: string;
  iat: number;
  exp: number;
}

// ============================================================================
// Configuration Constants
// ============================================================================

const JWT_SECRET = process.env.JWT_SECRET || 'default-dev-secret-change-in-production';
const JWT_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const REMEMBER_ME_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX_REQUESTS = 100;
const LOGIN_RATE_LIMIT_MAX = 10;
const PASSWORD_RESET_RATE_LIMIT_MAX = 3;
const EMAIL_VERIFICATION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

// ============================================================================
// Password Hashing (VULNERABILITY: Using MD5)
// ============================================================================

export function hashPassword(password: string, salt: string): string {
  // WARNING: This uses MD5 which is cryptographically broken
  // This was the original implementation from 2019 and needs migration to bcrypt
  const hash = crypto.createHash('md5');
  hash.update(salt + password);
  return hash.digest('hex');
}

export function generateSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function verifyPassword(password: string, salt: string, hash: string): boolean {
  return hashPassword(password, salt) === hash;
}

// ============================================================================
// JWT Token Management
// ============================================================================

export function generateAccessToken(user: User, sessionId: string): string {
  const payload: Omit<TokenPayload, 'iat' | 'exp'> = {
    sub: user.id,
    email: user.email,
    role: user.role,
    sessionId,
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

export function generateRefreshToken(): string {
  return crypto.randomBytes(64).toString('hex');
}

export function verifyAccessToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      log.debug('Access token expired');
    } else if (error instanceof jwt.JsonWebTokenError) {
      log.warn('Invalid JWT token:', error.message);
    }
    return null;
  }
}

export function decodeTokenWithoutVerification(token: string): TokenPayload | null {
  try {
    return jwt.decode(token) as TokenPayload;
  } catch {
    return null;
  }
}

// ============================================================================
// Session Management
// ============================================================================

export async function createSession(
  userId: string,
  ipAddress: string,
  userAgent: string,
  rememberMe: boolean = false
): Promise<Session> {
  const sessionId = crypto.randomUUID();
  const token = generateRefreshToken();
  const refreshToken = generateRefreshToken();
  const now = new Date();
  const expiryMs = rememberMe ? REMEMBER_ME_EXPIRY_MS : REFRESH_TOKEN_EXPIRY_MS;
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000); // Access token expiry
  const refreshExpiresAt = new Date(now.getTime() + expiryMs);

  const session: Session = {
    id: sessionId,
    userId,
    token,
    refreshToken,
    expiresAt: expiresAt.toISOString(),
    refreshExpiresAt: refreshExpiresAt.toISOString(),
    createdAt: now.toISOString(),
    lastActivityAt: now.toISOString(),
    ipAddress,
    userAgent,
    isRevoked: false,
  };

  await db.run(\`
    INSERT INTO sessions (id, user_id, token, refresh_token, expires_at,
      refresh_expires_at, created_at, last_activity_at, ip_address, user_agent, is_revoked)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  \`, [session.id, session.userId, session.token, session.refreshToken,
    session.expiresAt, session.refreshExpiresAt, session.createdAt,
    session.lastActivityAt, session.ipAddress, session.userAgent]);

  EventBus.emit('session:created', { sessionId, userId });
  log.info(\`Session created for user \${userId}\`);
  return session;
}

export async function refreshSession(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  session: Session;
} | null> {
  // BUG: Race condition - two concurrent refresh requests can both succeed
  // because there's no locking between the SELECT and UPDATE
  const session = await db.get<Session>(
    'SELECT * FROM sessions WHERE refresh_token = ? AND is_revoked = 0',
    [refreshToken]
  );

  if (!session) {
    log.warn('Refresh attempt with invalid/revoked token');
    return null;
  }

  if (new Date(session.refreshExpiresAt) < new Date()) {
    log.info('Refresh token expired, revoking session');
    await revokeSession(session.id);
    return null;
  }

  const user = await db.get<User>(
    'SELECT * FROM users WHERE id = ?',
    [session.userId]
  );

  if (!user) {
    log.error(\`User \${session.userId} not found for session \${session.id}\`);
    await revokeSession(session.id);
    return null;
  }

  // Generate new tokens
  const newRefreshToken = generateRefreshToken();
  const newAccessToken = generateAccessToken(user, session.id);
  const now = new Date();

  // BUG: No transaction wrapping this update - another request could read
  // the old refresh token between this UPDATE and the response
  await db.run(
    'UPDATE sessions SET refresh_token = ?, last_activity_at = ? WHERE id = ?',
    [newRefreshToken, now.toISOString(), session.id]
  );

  const updatedSession: Session = {
    ...session,
    refreshToken: newRefreshToken,
    lastActivityAt: now.toISOString(),
  };

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    session: updatedSession,
  };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await db.run(
    'UPDATE sessions SET is_revoked = 1 WHERE id = ?',
    [sessionId]
  );
  EventBus.emit('session:revoked', { sessionId });
  log.info(\`Session \${sessionId} revoked\`);
}

export async function revokeAllUserSessions(userId: string): Promise<number> {
  const result = await db.run(
    'UPDATE sessions SET is_revoked = 1 WHERE user_id = ? AND is_revoked = 0',
    [userId]
  );
  const count = result.changes || 0;
  EventBus.emit('session:revoked_all', { userId, count });
  log.info(\`Revoked \${count} sessions for user \${userId}\`);
  return count;
}

export async function getActiveSessions(userId: string): Promise<Session[]> {
  return db.all<Session>(
    'SELECT * FROM sessions WHERE user_id = ? AND is_revoked = 0 AND refresh_expires_at > ? ORDER BY last_activity_at DESC',
    [userId, new Date().toISOString()]
  );
}

export async function cleanupExpiredSessions(): Promise<number> {
  const result = await db.run(
    'DELETE FROM sessions WHERE refresh_expires_at < ? OR is_revoked = 1',
    [new Date().toISOString()]
  );
  const count = result.changes || 0;
  if (count > 0) {
    log.info(\`Cleaned up \${count} expired/revoked sessions\`);
  }
  return count;
}

// Session cleanup interval
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startSessionCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(cleanupExpiredSessions, SESSION_CLEANUP_INTERVAL_MS);
  log.info('Session cleanup started');
}

export function stopSessionCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
    log.info('Session cleanup stopped');
  }
}

// ============================================================================
// Login / Registration
// ============================================================================

export async function login(
  email: string,
  password: string,
  ipAddress: string,
  userAgent: string,
  rememberMe: boolean = false
): Promise<{ user: User; accessToken: string; session: Session } | { error: string; code: string }> {
  const user = await db.get<User>(
    'SELECT * FROM users WHERE email = ? AND email_verified = 1',
    [email.toLowerCase()]
  );

  if (!user) {
    return { error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' };
  }

  // Check account lockout
  if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
    const remainingMs = new Date(user.lockedUntil).getTime() - Date.now();
    const remainingMin = Math.ceil(remainingMs / 60000);
    log.warn(\`Login attempt for locked account: \${email}\`);
    return {
      error: \`Account locked. Try again in \${remainingMin} minutes.\`,
      code: 'ACCOUNT_LOCKED',
    };
  }

  // Verify password
  if (!verifyPassword(password, user.salt, user.passwordHash)) {
    const attempts = user.failedLoginAttempts + 1;
    const updates: Record<string, unknown> = { failedLoginAttempts: attempts };

    if (attempts >= MAX_FAILED_ATTEMPTS) {
      const lockUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
      updates.lockedUntil = lockUntil.toISOString();
      log.warn(\`Account \${email} locked after \${attempts} failed attempts\`);
    }

    await db.run(
      'UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?',
      [updates.failedLoginAttempts, updates.lockedUntil || null, user.id]
    );

    return { error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' };
  }

  // Reset failed attempts on successful login
  await db.run(
    'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?',
    [new Date().toISOString(), user.id]
  );

  // Create session
  const session = await createSession(user.id, ipAddress, userAgent, rememberMe);
  const accessToken = generateAccessToken(user, session.id);

  EventBus.emit('auth:login', { userId: user.id, email: user.email });
  log.info(\`User \${email} logged in successfully\`);

  return { user, accessToken, session };
}

export async function register(
  email: string,
  password: string,
  displayName: string
): Promise<{ user: User; verificationToken: string } | { error: string; code: string }> {
  const existing = await db.get<{ id: string }>(
    'SELECT id FROM users WHERE email = ?',
    [email.toLowerCase()]
  );

  if (existing) {
    return { error: 'Email already registered', code: 'EMAIL_EXISTS' };
  }

  const salt = generateSalt();
  const passwordHash = hashPassword(password, salt);
  const userId = crypto.randomUUID();
  const verificationToken = crypto.randomUUID();
  const now = new Date().toISOString();

  const user: User = {
    id: userId,
    email: email.toLowerCase(),
    passwordHash,
    salt,
    displayName,
    role: 'user',
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
    failedLoginAttempts: 0,
    lockedUntil: null,
    twoFactorEnabled: false,
    twoFactorSecret: null,
    emailVerified: false,
    emailVerificationToken: verificationToken,
  };

  await db.run(\`
    INSERT INTO users (id, email, password_hash, salt, display_name, role,
      created_at, updated_at, last_login_at, failed_login_attempts, locked_until,
      two_factor_enabled, two_factor_secret, email_verified, email_verification_token)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  \`, [user.id, user.email, user.passwordHash, user.salt, user.displayName,
    user.role, user.createdAt, user.updatedAt, user.lastLoginAt,
    user.failedLoginAttempts, user.lockedUntil, user.twoFactorEnabled ? 1 : 0,
    user.twoFactorSecret, user.emailVerified ? 1 : 0, user.emailVerificationToken]);

  EventBus.emit('auth:register', { userId, email: user.email });
  log.info(\`User registered: \${email}\`);

  return { user, verificationToken };
}

export async function verifyEmail(token: string): Promise<boolean> {
  const result = await db.run(
    'UPDATE users SET email_verified = 1, email_verification_token = NULL, updated_at = ? WHERE email_verification_token = ? AND email_verified = 0',
    [new Date().toISOString(), token]
  );
  return (result.changes || 0) > 0;
}

export async function requestPasswordReset(email: string): Promise<string | null> {
  const user = await db.get<User>(
    'SELECT * FROM users WHERE email = ? AND email_verified = 1',
    [email.toLowerCase()]
  );

  if (!user) return null;

  const resetToken = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_EXPIRY_MS).toISOString();

  await db.run(
    'INSERT OR REPLACE INTO password_resets (user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?)',
    [user.id, resetToken, expiresAt, new Date().toISOString()]
  );

  log.info(\`Password reset requested for \${email}\`);
  return resetToken;
}

export async function resetPassword(token: string, newPassword: string): Promise<boolean> {
  const reset = await db.get<{ user_id: string; expires_at: string }>(
    'SELECT user_id, expires_at FROM password_resets WHERE token = ?',
    [token]
  );

  if (!reset || new Date(reset.expires_at) < new Date()) {
    return false;
  }

  const salt = generateSalt();
  const passwordHash = hashPassword(newPassword, salt);

  await db.run(
    'UPDATE users SET password_hash = ?, salt = ?, updated_at = ? WHERE id = ?',
    [passwordHash, salt, new Date().toISOString(), reset.user_id]
  );

  await db.run('DELETE FROM password_resets WHERE user_id = ?', [reset.user_id]);
  await revokeAllUserSessions(reset.user_id);

  log.info(\`Password reset completed for user \${reset.user_id}\`);
  return true;
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  const user = await db.get<User>('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) return { success: false, error: 'User not found' };

  if (!verifyPassword(currentPassword, user.salt, user.passwordHash)) {
    return { success: false, error: 'Current password is incorrect' };
  }

  const salt = generateSalt();
  const passwordHash = hashPassword(newPassword, salt);

  await db.run(
    'UPDATE users SET password_hash = ?, salt = ?, updated_at = ? WHERE id = ?',
    [passwordHash, salt, new Date().toISOString(), userId]
  );

  // Revoke all sessions except current
  await revokeAllUserSessions(userId);
  log.info(\`Password changed for user \${userId}\`);

  return { success: true };
}

// ============================================================================
// OAuth Integration
// ============================================================================

const oauthProviders: Record<string, OAuthClient> = {};

export function registerOAuthProvider(
  provider: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  scopes: string[]
): void {
  oauthProviders[provider] = new OAuthClient({
    provider,
    clientId,
    clientSecret,
    redirectUri,
    scopes,
  });
  log.info(\`OAuth provider registered: \${provider}\`);
}

export async function initiateOAuthFlow(provider: string): Promise<string> {
  const client = oauthProviders[provider];
  if (!client) {
    throw new Error(\`Unknown OAuth provider: \${provider}\`);
  }

  const state = crypto.randomBytes(32).toString('hex');
  const nonce = crypto.randomBytes(16).toString('hex');

  await db.run(
    'INSERT INTO oauth_states (state, nonce, provider, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    [state, nonce, provider, new Date().toISOString(),
     new Date(Date.now() + 10 * 60 * 1000).toISOString()]
  );

  return client.getAuthorizationUrl(state, nonce);
}

export async function handleOAuthCallback(
  provider: string,
  code: string,
  state: string
): Promise<{ user: User; accessToken: string; session: Session; isNewUser: boolean } | { error: string }> {
  const oauthState = await db.get<{ nonce: string; expires_at: string }>(
    'SELECT nonce, expires_at FROM oauth_states WHERE state = ? AND provider = ?',
    [state, provider]
  );

  if (!oauthState || new Date(oauthState.expires_at) < new Date()) {
    return { error: 'Invalid or expired OAuth state' };
  }

  await db.run('DELETE FROM oauth_states WHERE state = ?', [state]);

  const client = oauthProviders[provider];
  if (!client) {
    return { error: \`Unknown OAuth provider: \${provider}\` };
  }

  try {
    const tokenResponse = await client.exchangeCode(code);
    const profile = await client.getUserProfile(tokenResponse.access_token);

    let user = await db.get<User>(
      'SELECT u.* FROM users u JOIN oauth_accounts oa ON u.id = oa.user_id WHERE oa.provider = ? AND oa.provider_user_id = ?',
      [provider, profile.id]
    );

    let isNewUser = false;

    if (!user) {
      // Check if email exists
      user = await db.get<User>(
        'SELECT * FROM users WHERE email = ?',
        [profile.email.toLowerCase()]
      );

      if (user) {
        // Link OAuth to existing user
        await db.run(
          'INSERT INTO oauth_accounts (user_id, provider, provider_user_id, created_at) VALUES (?, ?, ?, ?)',
          [user.id, provider, profile.id, new Date().toISOString()]
        );
      } else {
        // Create new user
        const userId = crypto.randomUUID();
        const now = new Date().toISOString();
        user = {
          id: userId,
          email: profile.email.toLowerCase(),
          passwordHash: '',
          salt: '',
          displayName: profile.name || profile.email.split('@')[0],
          role: 'user' as UserRole,
          createdAt: now,
          updatedAt: now,
          lastLoginAt: now,
          failedLoginAttempts: 0,
          lockedUntil: null,
          twoFactorEnabled: false,
          twoFactorSecret: null,
          emailVerified: true,
          emailVerificationToken: null,
        };

        await db.run(\`
          INSERT INTO users (id, email, password_hash, salt, display_name, role,
            created_at, updated_at, last_login_at, failed_login_attempts, locked_until,
            two_factor_enabled, two_factor_secret, email_verified, email_verification_token)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        \`, [user.id, user.email, user.passwordHash, user.salt, user.displayName,
          user.role, user.createdAt, user.updatedAt, user.lastLoginAt,
          user.failedLoginAttempts, user.lockedUntil, 0, null, 1, null]);

        await db.run(
          'INSERT INTO oauth_accounts (user_id, provider, provider_user_id, created_at) VALUES (?, ?, ?, ?)',
          [user.id, provider, profile.id, new Date().toISOString()]
        );

        isNewUser = true;
      }
    }

    const session = await createSession(user.id, '0.0.0.0', 'oauth', false);
    const accessToken = generateAccessToken(user, session.id);

    return { user, accessToken, session, isNewUser };
  } catch (error) {
    log.error(\`OAuth callback error for \${provider}:\`, error);
    return { error: 'OAuth authentication failed' };
  }
}

// ============================================================================
// Middleware
// ============================================================================

export function authMiddleware(requiredRole?: UserRole) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }

    const token = authHeader.substring(7);
    const payload = verifyAccessToken(token);

    if (!payload) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Check session is still valid
    const session = await db.get<Session>(
      'SELECT * FROM sessions WHERE id = ? AND is_revoked = 0',
      [payload.sessionId]
    );

    if (!session) {
      return res.status(401).json({ error: 'Session revoked or expired' });
    }

    // Check role if required
    if (requiredRole && payload.role !== requiredRole && payload.role !== 'admin') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Attach user info to request
    (req as any).user = payload;
    (req as any).sessionId = payload.sessionId;

    // Update session activity
    await db.run(
      'UPDATE sessions SET last_activity_at = ? WHERE id = ?',
      [new Date().toISOString(), payload.sessionId]
    );

    next();
  };
}

export function rateLimitMiddleware(
  maxRequests: number = RATE_LIMIT_MAX_REQUESTS,
  windowMs: number = RATE_LIMIT_WINDOW_MS
) {
  const limiter = new RateLimiter(maxRequests, windowMs);

  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || 'unknown';
    const result = limiter.check(key);

    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', result.resetAt);

    if (!result.allowed) {
      log.warn(\`Rate limit exceeded for \${key}\`);
      return res.status(429).json({
        error: 'Too many requests',
        retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
      });
    }

    next();
  };
}

// ============================================================================
// Route Handlers
// ============================================================================

export async function handleLogin(req: Request, res: Response): Promise<void> {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { email, password, rememberMe } = parsed.data;
  const ip = req.ip || '0.0.0.0';
  const ua = req.headers['user-agent'] || 'unknown';

  const result = await login(email, password, ip, ua, rememberMe);

  if ('error' in result) {
    const statusCode = result.code === 'ACCOUNT_LOCKED' ? 423 : 401;
    res.status(statusCode).json({ error: result.error, code: result.code });
    return;
  }

  res.json({
    user: { id: result.user.id, email: result.user.email, displayName: result.user.displayName, role: result.user.role },
    accessToken: result.accessToken,
    refreshToken: result.session.refreshToken,
    expiresAt: result.session.expiresAt,
  });
}

export async function handleRegister(req: Request, res: Response): Promise<void> {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { email, password, displayName } = parsed.data;
  const result = await register(email, password, displayName);

  if ('error' in result) {
    res.status(409).json({ error: result.error, code: result.code });
    return;
  }

  res.status(201).json({
    message: 'Registration successful. Please verify your email.',
    userId: result.user.id,
  });
}

export async function handleRefresh(req: Request, res: Response): Promise<void> {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    res.status(400).json({ error: 'Missing refresh token' });
    return;
  }

  const result = await refreshSession(refreshToken);
  if (!result) {
    res.status(401).json({ error: 'Invalid or expired refresh token' });
    return;
  }

  res.json({
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresAt: result.session.expiresAt,
  });
}

export async function handleLogout(req: Request, res: Response): Promise<void> {
  const sessionId = (req as any).sessionId;
  if (sessionId) {
    await revokeSession(sessionId);
  }
  res.json({ message: 'Logged out successfully' });
}

export async function handlePasswordReset(req: Request, res: Response): Promise<void> {
  const parsed = ResetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const success = await resetPassword(parsed.data.token, parsed.data.newPassword);
  if (!success) {
    res.status(400).json({ error: 'Invalid or expired reset token' });
    return;
  }

  res.json({ message: 'Password reset successful' });
}

export async function handleChangePassword(req: Request, res: Response): Promise<void> {
  const parsed = ChangePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const userId = (req as any).user.sub;
  const result = await changePassword(userId, parsed.data.currentPassword, parsed.data.newPassword);

  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.json({ message: 'Password changed successfully' });
}

// ============================================================================
// Initialization
// ============================================================================

export function initializeAuth(): void {
  startSessionCleanup();

  // Register default OAuth providers from env
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    registerOAuthProvider('google',
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback',
      ['openid', 'email', 'profile']
    );
  }

  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    registerOAuthProvider('github',
      process.env.GITHUB_CLIENT_ID,
      process.env.GITHUB_CLIENT_SECRET,
      process.env.GITHUB_REDIRECT_URI || 'http://localhost:3000/auth/github/callback',
      ['read:user', 'user:email']
    );
  }

  log.info('Auth system initialized');
}` }
  ] },

  // --- Turn 4: Agent analyzes the file ---
  { role: 'assistant', content: 'I have read the full file. It is 1,247 lines long and mixes six major concerns:\n\n1. **Types and Schemas** (lines 1-95): User interface, session interface, Zod schemas for login/register/reset/change password\n2. **Password Hashing** (lines 97-115): Uses MD5, which is a critical security vulnerability\n3. **JWT Token Management** (lines 117-160): Token generation, verification, decoding\n4. **Session Management** (lines 162-340): Create, refresh, revoke, cleanup sessions\n5. **Login/Registration** (lines 342-550): Login flow with lockout, registration with email verification, password reset/change\n6. **OAuth Integration** (lines 552-700): Provider registration, OAuth flow, callback handling\n7. **Middleware** (lines 702-790): Auth middleware, rate limit middleware\n8. **Route Handlers** (lines 792-920): Express request handlers\n9. **Initialization** (lines 922-960): Setup function\n\nI also found two critical issues:\n\n**SECURITY VULNERABILITY (line 103):** Password hashing uses `crypto.createHash(\'md5\')`. MD5 is cryptographically broken and unsuitable for password hashing. This needs to be migrated to bcrypt or argon2.\n\n**RACE CONDITION (lines 220-260):** The `refreshSession` function has a time-of-check to time-of-use (TOCTOU) race condition. Two concurrent refresh requests with the same token can both read the old token, both generate new tokens, and both succeed. The second request\'s token would overwrite the first\'s, potentially invalidating a legitimately refreshed session.\n\nHere is my proposed module structure:\n```\n/src/auth/\n  index.ts           - Barrel re-exports\n  types.ts           - Interfaces and Zod schemas\n  password.ts        - Password hashing (migrate to bcrypt)\n  tokens.ts          - JWT token management\n  sessions.ts        - Session CRUD and cleanup\n  login.ts           - Login, registration, password reset\n  oauth.ts           - OAuth provider integration\n  middleware.ts      - Auth and rate limit middleware\n  handlers.ts        - Express route handlers\n  init.ts            - Initialization logic\n```\n\nShall I proceed with this structure?' },

  // --- Turn 5: User agrees but with a correction ---
  { role: 'user', content: 'Yes, that structure looks good. But first, let\'s fix the MD5 vulnerability before splitting. I want to use bcrypt, not argon2. And please use camelCase for all file names and exports - no snake_case anywhere in the auth module.' },

  // --- Turn 6: Agent searches for bcrypt usage ---
  { role: 'assistant', content: [
    { type: 'text', text: 'Good call, fixing the security issue first makes sense. Let me check if bcrypt is already in the dependencies.' },
    { type: 'tool_use', name: 'Bash', input: { command: 'cat /src/package.json | grep -A2 -B2 bcrypt' } }
  ] },

  // --- Turn 7: Bash result ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Bash', text: `    "bcrypt": "^5.1.1",
    "@types/bcrypt": "^5.0.2",` }
  ] },

  // --- Turn 8: Agent checks existing bcrypt usage ---
  { role: 'assistant', content: [
    { type: 'text', text: 'bcrypt is already a dependency. Let me check if it is used anywhere else in the codebase.' },
    { type: 'tool_use', name: 'Grep', input: { pattern: 'bcrypt', path: '/src' } }
  ] },

  // --- Turn 9: Grep results ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Grep', text: `/src/auth/index.ts:1:import crypto from 'crypto';
/src/auth/index.ts:103:  // WARNING: This uses MD5 which is cryptographically broken
/src/auth/index.ts:104:  // This was the original implementation from 2019 and needs migration to bcrypt
/src/utils/test-helpers.ts:3:import bcrypt from 'bcrypt';
/src/utils/test-helpers.ts:15:export async function hashTestPassword(password: string): Promise<string> {
/src/utils/test-helpers.ts:16:  return bcrypt.hash(password, 10);
/src/utils/test-helpers.ts:17:}` }
  ] },

  // --- Turn 10: Agent explains the fix ---
  { role: 'assistant', content: 'Interesting: bcrypt is already used in the test helpers but not in the actual auth module. The test helpers use a cost factor of 10 for bcrypt.\n\nHere is the plan for the password hashing fix:\n\n1. Replace `hashPassword()` to use `bcrypt.hash()` with a cost factor of 12 (stronger than the test helper\'s 10)\n2. Replace `verifyPassword()` to use `bcrypt.compare()`\n3. Remove the separate `generateSalt()` function since bcrypt handles salting internally\n4. Add a `needsRehash()` function to detect old MD5 hashes so existing users can be migrated on next login\n5. Update `login()` to check for MD5 hashes and transparently rehash with bcrypt on successful login\n\nThe migration strategy: old MD5 hashes are 32 hex characters. bcrypt hashes start with `$2b$`. We can detect which format a stored hash uses and handle both during the transition.\n\nLet me implement this.' },

  // --- Turn 11: Agent writes the new password module ---
  { role: 'assistant', content: [
    { type: 'text', text: 'Creating the new password module with bcrypt and MD5 migration support.' },
    { type: 'tool_use', name: 'Write', input: { path: '/src/auth/password.ts', content: `import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { createLogger } from '../lib/logger.js';

const log = createLogger('AuthPassword', 'auth');

/**
 * Cost factor for bcrypt hashing.
 * 12 is a good balance between security and performance.
 * At cost 12, hashing takes ~250ms on modern hardware.
 */
const BCRYPT_COST_FACTOR = 12;

/**
 * Hash a password using bcrypt.
 * bcrypt handles salt generation internally.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST_FACTOR);
}

/**
 * Verify a password against a bcrypt hash.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Check if a stored hash is a legacy MD5 hash that needs migration.
 * MD5 hashes are 32 hex characters. bcrypt hashes start with '$2b$' or '$2a$'.
 */
export function isLegacyMd5Hash(hash: string): boolean {
  return /^[a-f0-9]{32}$/.test(hash);
}

/**
 * Verify a password against a legacy MD5 hash.
 * Used during migration from MD5 to bcrypt.
 */
export function verifyLegacyPassword(password: string, salt: string, hash: string): boolean {
  const md5 = crypto.createHash('md5');
  md5.update(salt + password);
  return md5.digest('hex') === hash;
}

/**
 * Check if a password needs rehashing (e.g., cost factor changed).
 */
export function needsRehash(hash: string): boolean {
  if (isLegacyMd5Hash(hash)) return true;

  // Check if bcrypt cost factor has changed
  const match = hash.match(/^\\$2[ab]\\$(\\d+)\\$/);
  if (!match) return true;
  const currentCost = parseInt(match[1], 10);
  return currentCost < BCRYPT_COST_FACTOR;
}

/**
 * Migrate a user's password hash from MD5 to bcrypt.
 * Returns the new bcrypt hash, or null if the legacy password didn't verify.
 */
export async function migratePasswordHash(
  password: string,
  legacySalt: string,
  legacyHash: string
): Promise<string | null> {
  if (!verifyLegacyPassword(password, legacySalt, legacyHash)) {
    return null;
  }

  log.info('Migrating password hash from MD5 to bcrypt');
  return hashPassword(password);
}` } }
  ] },

  // --- Turn 12: Tool result for write ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Write', text: 'File written: /src/auth/password.ts (67 lines)' }
  ] },

  // --- Turn 13: Agent creates the types module ---
  { role: 'assistant', content: [
    { type: 'text', text: 'Now creating the types module with all interfaces and Zod schemas.' },
    { type: 'tool_use', name: 'Write', input: { path: '/src/auth/types.ts', content: `import { z } from 'zod';

// ============================================================================
// User Types
// ============================================================================

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  salt: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  failedLoginAttempts: number;
  lockedUntil: string | null;
  twoFactorEnabled: boolean;
  twoFactorSecret: string | null;
  emailVerified: boolean;
  emailVerificationToken: string | null;
}

export type UserRole = 'admin' | 'user' | 'moderator' | 'readonly';

export interface UserPublic {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
}

export function toPublicUser(user: User): UserPublic {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
  };
}

// ============================================================================
// Session Types
// ============================================================================

export interface Session {
  id: string;
  userId: string;
  token: string;
  refreshToken: string;
  expiresAt: string;
  refreshExpiresAt: string;
  createdAt: string;
  lastActivityAt: string;
  ipAddress: string;
  userAgent: string;
  isRevoked: boolean;
}

export interface TokenPayload {
  sub: string;
  email: string;
  role: UserRole;
  sessionId: string;
  iat: number;
  exp: number;
}

// ============================================================================
// Auth Result Types
// ============================================================================

export interface LoginSuccess {
  user: User;
  accessToken: string;
  session: Session;
}

export interface LoginError {
  error: string;
  code: 'INVALID_CREDENTIALS' | 'ACCOUNT_LOCKED' | 'EMAIL_NOT_VERIFIED';
}

export type LoginResult = LoginSuccess | LoginError;

export interface RegisterSuccess {
  user: User;
  verificationToken: string;
}

export interface RegisterError {
  error: string;
  code: 'EMAIL_EXISTS' | 'VALIDATION_ERROR';
}

export type RegisterResult = RegisterSuccess | RegisterError;

export interface OAuthResult {
  user: User;
  accessToken: string;
  session: Session;
  isNewUser: boolean;
}

export interface OAuthError {
  error: string;
}

// ============================================================================
// Configuration Constants
// ============================================================================

export const AuthConfig = {
  jwtSecret: process.env.JWT_SECRET || 'default-dev-secret-change-in-production',
  jwtExpiry: '15m' as const,
  refreshTokenExpiryMs: 7 * 24 * 60 * 60 * 1000,       // 7 days
  rememberMeExpiryMs: 30 * 24 * 60 * 60 * 1000,        // 30 days
  maxFailedAttempts: 5,
  lockoutDurationMs: 15 * 60 * 1000,                     // 15 minutes
  sessionCleanupIntervalMs: 60 * 60 * 1000,              // 1 hour
  rateLimitWindowMs: 15 * 60 * 1000,                      // 15 minutes
  rateLimitMaxRequests: 100,
  loginRateLimitMax: 10,
  passwordResetRateLimitMax: 3,
  emailVerificationExpiryMs: 24 * 60 * 60 * 1000,        // 24 hours
} as const;

// ============================================================================
// Validation Schemas
// ============================================================================

const passwordSchema = z.string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[0-9]/, 'Password must contain at least one digit')
  .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character');

export const LoginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  rememberMe: z.boolean().optional().default(false),
});

export const RegisterSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: passwordSchema,
  displayName: z.string().min(2).max(50),
});

export const ResetPasswordSchema = z.object({
  token: z.string().uuid(),
  newPassword: passwordSchema,
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: passwordSchema,
});

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export const EmailVerificationSchema = z.object({
  token: z.string().uuid(),
});

export const OAuthCallbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});` } }
  ] },

  // --- Turn 14: Tool result for types write ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Write', text: 'File written: /src/auth/types.ts (165 lines)' }
  ] },

  // --- Turn 15: Agent creates tokens module ---
  { role: 'assistant', content: [
    { type: 'text', text: 'Creating the JWT token management module.' },
    { type: 'tool_use', name: 'Write', input: { path: '/src/auth/tokens.ts', content: `import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { createLogger } from '../lib/logger.js';
import { AuthConfig, type User, type TokenPayload } from './types.js';

const log = createLogger('AuthTokens', 'auth');

/**
 * Generate a JWT access token for the given user and session.
 * The token contains the user's ID, email, role, and session ID.
 * It expires after the configured JWT expiry time (default: 15 minutes).
 */
export function generateAccessToken(user: User, sessionId: string): string {
  const payload: Omit<TokenPayload, 'iat' | 'exp'> = {
    sub: user.id,
    email: user.email,
    role: user.role,
    sessionId,
  };
  return jwt.sign(payload, AuthConfig.jwtSecret, { expiresIn: AuthConfig.jwtExpiry });
}

/**
 * Generate a cryptographically secure refresh token.
 * Returns a 128-character hex string (64 random bytes).
 */
export function generateRefreshToken(): string {
  return crypto.randomBytes(64).toString('hex');
}

/**
 * Verify and decode a JWT access token.
 * Returns the decoded payload if valid, or null if expired/invalid.
 */
export function verifyAccessToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, AuthConfig.jwtSecret) as TokenPayload;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      log.debug('Access token expired');
    } else if (error instanceof jwt.JsonWebTokenError) {
      log.warn('Invalid JWT token:', error.message);
    }
    return null;
  }
}

/**
 * Decode a JWT token without verifying its signature.
 * Useful for extracting claims from expired tokens during refresh flows.
 * WARNING: Do not trust the contents of an unverified token for authorization.
 */
export function decodeTokenUnsafe(token: string): TokenPayload | null {
  try {
    return jwt.decode(token) as TokenPayload;
  } catch {
    return null;
  }
}

/**
 * Generate a short-lived opaque token for email verification or password reset.
 * Returns a UUID v4 string.
 */
export function generateVerificationToken(): string {
  return crypto.randomUUID();
}

/**
 * Generate a cryptographically secure state parameter for OAuth flows.
 * Returns a 64-character hex string (32 random bytes).
 */
export function generateOAuthState(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate a nonce for OAuth flows.
 * Returns a 32-character hex string (16 random bytes).
 */
export function generateOAuthNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}` } }
  ] },

  // --- Turn 16: Tool result ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Write', text: 'File written: /src/auth/tokens.ts (82 lines)' }
  ] },

  // --- Turn 17: Agent creates sessions module ---
  { role: 'assistant', content: [
    { type: 'text', text: 'Now creating the sessions module. This is where I will fix the race condition in refreshSession by wrapping the read-update in a transaction with a serializable isolation level.' },
    { type: 'tool_use', name: 'Write', input: { path: '/src/auth/sessions.ts', content: `import { db } from '../db/connection.js';
import { EventBus } from '../lib/event-bus.js';
import { createLogger } from '../lib/logger.js';
import {
  AuthConfig,
  type User,
  type Session,
} from './types.js';
import { generateAccessToken, generateRefreshToken } from './tokens.js';

const log = createLogger('AuthSessions', 'auth');

// ============================================================================
// Session CRUD
// ============================================================================

/**
 * Create a new session for a user after successful authentication.
 * The session includes both an access token reference and a refresh token.
 * rememberMe extends the refresh token expiry from 7 days to 30 days.
 */
export async function createSession(
  userId: string,
  ipAddress: string,
  userAgent: string,
  rememberMe: boolean = false
): Promise<Session> {
  const sessionId = crypto.randomUUID();
  const token = generateRefreshToken();
  const refreshToken = generateRefreshToken();
  const now = new Date();
  const expiryMs = rememberMe ? AuthConfig.rememberMeExpiryMs : AuthConfig.refreshTokenExpiryMs;
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);
  const refreshExpiresAt = new Date(now.getTime() + expiryMs);

  const session: Session = {
    id: sessionId,
    userId,
    token,
    refreshToken,
    expiresAt: expiresAt.toISOString(),
    refreshExpiresAt: refreshExpiresAt.toISOString(),
    createdAt: now.toISOString(),
    lastActivityAt: now.toISOString(),
    ipAddress,
    userAgent,
    isRevoked: false,
  };

  await db.run(\`
    INSERT INTO sessions (id, user_id, token, refresh_token, expires_at,
      refresh_expires_at, created_at, last_activity_at, ip_address, user_agent, is_revoked)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  \`, [session.id, session.userId, session.token, session.refreshToken,
    session.expiresAt, session.refreshExpiresAt, session.createdAt,
    session.lastActivityAt, session.ipAddress, session.userAgent]);

  EventBus.emit('session:created', { sessionId, userId });
  log.info(\`Session created for user \${userId}\`);
  return session;
}

/**
 * Refresh a session using a refresh token.
 *
 * RACE CONDITION FIX: This function uses a database transaction with
 * IMMEDIATE locking to prevent the TOCTOU race where two concurrent
 * refresh requests could both succeed with the same old token.
 *
 * The transaction:
 * 1. BEGIN IMMEDIATE (acquires write lock immediately)
 * 2. SELECT the session by refresh token
 * 3. UPDATE the refresh token atomically
 * 4. COMMIT
 *
 * If a second request arrives while the first holds the lock, it will
 * wait for the lock, then find the old refresh token no longer matches.
 */
export async function refreshSession(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  session: Session;
} | null> {
  return db.transaction(async () => {
    const session = await db.get<Session>(
      'SELECT * FROM sessions WHERE refresh_token = ? AND is_revoked = 0',
      [refreshToken]
    );

    if (!session) {
      log.warn('Refresh attempt with invalid/revoked token');
      return null;
    }

    if (new Date(session.refreshExpiresAt) < new Date()) {
      log.info('Refresh token expired, revoking session');
      await revokeSession(session.id);
      return null;
    }

    const user = await db.get<User>(
      'SELECT * FROM users WHERE id = ?',
      [session.userId]
    );

    if (!user) {
      log.error(\`User \${session.userId} not found for session \${session.id}\`);
      await revokeSession(session.id);
      return null;
    }

    // Generate new tokens atomically within the transaction
    const newRefreshToken = generateRefreshToken();
    const newAccessToken = generateAccessToken(user, session.id);
    const now = new Date();

    await db.run(
      'UPDATE sessions SET refresh_token = ?, last_activity_at = ? WHERE id = ?',
      [newRefreshToken, now.toISOString(), session.id]
    );

    const updatedSession: Session = {
      ...session,
      refreshToken: newRefreshToken,
      lastActivityAt: now.toISOString(),
    };

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      session: updatedSession,
    };
  });
}

/**
 * Revoke a specific session by ID.
 * The session remains in the database but is marked as revoked.
 */
export async function revokeSession(sessionId: string): Promise<void> {
  await db.run(
    'UPDATE sessions SET is_revoked = 1 WHERE id = ?',
    [sessionId]
  );
  EventBus.emit('session:revoked', { sessionId });
  log.info(\`Session \${sessionId} revoked\`);
}

/**
 * Revoke all active sessions for a user.
 * Returns the number of sessions revoked.
 * Used after password change/reset to invalidate all existing sessions.
 */
export async function revokeAllUserSessions(userId: string): Promise<number> {
  const result = await db.run(
    'UPDATE sessions SET is_revoked = 1 WHERE user_id = ? AND is_revoked = 0',
    [userId]
  );
  const count = result.changes || 0;
  EventBus.emit('session:revoked_all', { userId, count });
  log.info(\`Revoked \${count} sessions for user \${userId}\`);
  return count;
}

/**
 * Get all active (non-revoked, non-expired) sessions for a user.
 * Ordered by most recent activity first.
 */
export async function getActiveSessions(userId: string): Promise<Session[]> {
  return db.all<Session>(
    'SELECT * FROM sessions WHERE user_id = ? AND is_revoked = 0 AND refresh_expires_at > ? ORDER BY last_activity_at DESC',
    [userId, new Date().toISOString()]
  );
}

/**
 * Update the last activity timestamp for a session.
 * Called by the auth middleware on each authenticated request.
 */
export async function touchSession(sessionId: string): Promise<void> {
  await db.run(
    'UPDATE sessions SET last_activity_at = ? WHERE id = ?',
    [new Date().toISOString(), sessionId]
  );
}

/**
 * Delete expired and revoked sessions from the database.
 * Returns the number of sessions cleaned up.
 */
export async function cleanupExpiredSessions(): Promise<number> {
  const result = await db.run(
    'DELETE FROM sessions WHERE refresh_expires_at < ? OR is_revoked = 1',
    [new Date().toISOString()]
  );
  const count = result.changes || 0;
  if (count > 0) {
    log.info(\`Cleaned up \${count} expired/revoked sessions\`);
  }
  return count;
}

// ============================================================================
// Session Cleanup Timer
// ============================================================================

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the periodic session cleanup job.
 * Runs every hour by default (configurable via AuthConfig.sessionCleanupIntervalMs).
 */
export function startSessionCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(cleanupExpiredSessions, AuthConfig.sessionCleanupIntervalMs);
  log.info('Session cleanup started');
}

/**
 * Stop the periodic session cleanup job.
 * Should be called during graceful shutdown.
 */
export function stopSessionCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
    log.info('Session cleanup stopped');
  }
}

/**
 * Get a session by ID, including revoked sessions.
 * Used by the auth middleware to check session validity.
 */
export async function getSessionById(sessionId: string): Promise<Session | null> {
  return db.get<Session>(
    'SELECT * FROM sessions WHERE id = ?',
    [sessionId]
  ) || null;
}

/**
 * Count active sessions for a user.
 * Useful for enforcing max session limits.
 */
export async function countActiveSessions(userId: string): Promise<number> {
  const result = await db.get<{ count: number }>(
    'SELECT COUNT(*) as count FROM sessions WHERE user_id = ? AND is_revoked = 0 AND refresh_expires_at > ?',
    [userId, new Date().toISOString()]
  );
  return result?.count || 0;
}` } }
  ] },

  // --- Turn 18: Tool result ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Write', text: 'File written: /src/auth/sessions.ts (214 lines)' }
  ] },

  // --- Turn 19: Agent creates login module ---
  { role: 'assistant', content: [
    { type: 'text', text: 'Creating the login and registration module. This integrates with the new password module for MD5 migration.' },
    { type: 'tool_use', name: 'Write', input: { path: '/src/auth/login.ts', content: `import crypto from 'crypto';
import { db } from '../db/connection.js';
import { EventBus } from '../lib/event-bus.js';
import { createLogger } from '../lib/logger.js';
import {
  AuthConfig,
  type User,
  type LoginResult,
  type RegisterResult,
} from './types.js';
import {
  hashPassword,
  verifyPassword,
  isLegacyMd5Hash,
  migratePasswordHash,
} from './password.js';
import { generateAccessToken } from './tokens.js';
import { createSession, revokeAllUserSessions } from './sessions.js';

const log = createLogger('AuthLogin', 'auth');

// ============================================================================
// Login
// ============================================================================

/**
 * Authenticate a user with email and password.
 *
 * This function handles:
 * - Account lockout after too many failed attempts (5 attempts, 15 min lockout)
 * - Transparent migration from legacy MD5 hashes to bcrypt
 * - Session creation with optional "remember me" extended expiry
 * - Failed attempt tracking and reset on success
 *
 * Returns either a LoginSuccess or LoginError discriminated union.
 */
export async function login(
  email: string,
  password: string,
  ipAddress: string,
  userAgent: string,
  rememberMe: boolean = false
): Promise<LoginResult> {
  const user = await db.get<User>(
    'SELECT * FROM users WHERE email = ? AND email_verified = 1',
    [email.toLowerCase()]
  );

  if (!user) {
    return { error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' };
  }

  // Check account lockout
  if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
    const remainingMs = new Date(user.lockedUntil).getTime() - Date.now();
    const remainingMin = Math.ceil(remainingMs / 60000);
    log.warn(\`Login attempt for locked account: \${email}\`);
    return {
      error: \`Account locked. Try again in \${remainingMin} minutes.\`,
      code: 'ACCOUNT_LOCKED',
    };
  }

  // Verify password, handling both legacy MD5 and modern bcrypt hashes
  let passwordValid = false;
  let needsMigration = false;

  if (isLegacyMd5Hash(user.passwordHash)) {
    // Legacy MD5 hash detected - verify with old method
    const migrated = await migratePasswordHash(password, user.salt, user.passwordHash);
    if (migrated) {
      passwordValid = true;
      needsMigration = true;
      // Update to bcrypt hash
      await db.run(
        'UPDATE users SET password_hash = ?, salt = ?, updated_at = ? WHERE id = ?',
        [migrated, '', new Date().toISOString(), user.id]
      );
      log.info(\`Migrated password hash for user \${email} from MD5 to bcrypt\`);
    }
  } else {
    // Modern bcrypt hash
    passwordValid = await verifyPassword(password, user.passwordHash);
  }

  if (!passwordValid) {
    const attempts = user.failedLoginAttempts + 1;
    let lockedUntil: string | null = null;

    if (attempts >= AuthConfig.maxFailedAttempts) {
      lockedUntil = new Date(Date.now() + AuthConfig.lockoutDurationMs).toISOString();
      log.warn(\`Account \${email} locked after \${attempts} failed attempts\`);
    }

    await db.run(
      'UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?',
      [attempts, lockedUntil, user.id]
    );

    return { error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' };
  }

  // Reset failed attempts on successful login
  await db.run(
    'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?',
    [new Date().toISOString(), user.id]
  );

  // Create session and access token
  const session = await createSession(user.id, ipAddress, userAgent, rememberMe);
  const accessToken = generateAccessToken(user, session.id);

  EventBus.emit('auth:login', { userId: user.id, email: user.email });
  log.info(\`User \${email} logged in successfully\`);

  return { user, accessToken, session };
}

// ============================================================================
// Registration
// ============================================================================

/**
 * Register a new user account.
 *
 * The password is hashed with bcrypt (cost factor 12).
 * A verification token is generated for email confirmation.
 * The user cannot log in until their email is verified.
 *
 * Returns either a RegisterSuccess or RegisterError discriminated union.
 */
export async function register(
  email: string,
  password: string,
  displayName: string
): Promise<RegisterResult> {
  const existing = await db.get<{ id: string }>(
    'SELECT id FROM users WHERE email = ?',
    [email.toLowerCase()]
  );

  if (existing) {
    return { error: 'Email already registered', code: 'EMAIL_EXISTS' };
  }

  const passwordHash = await hashPassword(password);
  const userId = crypto.randomUUID();
  const verificationToken = crypto.randomUUID();
  const now = new Date().toISOString();

  const user: User = {
    id: userId,
    email: email.toLowerCase(),
    passwordHash,
    salt: '', // bcrypt handles salting internally
    displayName,
    role: 'user',
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
    failedLoginAttempts: 0,
    lockedUntil: null,
    twoFactorEnabled: false,
    twoFactorSecret: null,
    emailVerified: false,
    emailVerificationToken: verificationToken,
  };

  await db.run(\`
    INSERT INTO users (id, email, password_hash, salt, display_name, role,
      created_at, updated_at, last_login_at, failed_login_attempts, locked_until,
      two_factor_enabled, two_factor_secret, email_verified, email_verification_token)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  \`, [user.id, user.email, user.passwordHash, user.salt, user.displayName,
    user.role, user.createdAt, user.updatedAt, user.lastLoginAt,
    user.failedLoginAttempts, user.lockedUntil, user.twoFactorEnabled ? 1 : 0,
    user.twoFactorSecret, user.emailVerified ? 1 : 0, user.emailVerificationToken]);

  EventBus.emit('auth:register', { userId, email: user.email });
  log.info(\`User registered: \${email}\`);

  return { user, verificationToken };
}

// ============================================================================
// Email Verification
// ============================================================================

/**
 * Verify a user's email address using the verification token.
 * Returns true if the token was valid and the email was verified.
 */
export async function verifyEmail(token: string): Promise<boolean> {
  const result = await db.run(
    'UPDATE users SET email_verified = 1, email_verification_token = NULL, updated_at = ? WHERE email_verification_token = ? AND email_verified = 0',
    [new Date().toISOString(), token]
  );
  return (result.changes || 0) > 0;
}

// ============================================================================
// Password Reset
// ============================================================================

/**
 * Request a password reset for the given email address.
 * Returns the reset token if the email exists, or null if not found.
 * The token expires after 24 hours.
 *
 * NOTE: Always return a success response to the client regardless of whether
 * the email exists, to prevent email enumeration attacks.
 */
export async function requestPasswordReset(email: string): Promise<string | null> {
  const user = await db.get<User>(
    'SELECT * FROM users WHERE email = ? AND email_verified = 1',
    [email.toLowerCase()]
  );

  if (!user) return null;

  const resetToken = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + AuthConfig.emailVerificationExpiryMs).toISOString();

  await db.run(
    'INSERT OR REPLACE INTO password_resets (user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?)',
    [user.id, resetToken, expiresAt, new Date().toISOString()]
  );

  log.info(\`Password reset requested for \${email}\`);
  return resetToken;
}

/**
 * Reset a user's password using a valid reset token.
 * Revokes all existing sessions after a successful reset.
 * Returns true if the reset was successful.
 */
export async function resetPassword(token: string, newPassword: string): Promise<boolean> {
  const reset = await db.get<{ user_id: string; expires_at: string }>(
    'SELECT user_id, expires_at FROM password_resets WHERE token = ?',
    [token]
  );

  if (!reset || new Date(reset.expires_at) < new Date()) {
    return false;
  }

  const passwordHash = await hashPassword(newPassword);

  await db.run(
    'UPDATE users SET password_hash = ?, salt = ?, updated_at = ? WHERE id = ?',
    [passwordHash, '', new Date().toISOString(), reset.user_id]
  );

  await db.run('DELETE FROM password_resets WHERE user_id = ?', [reset.user_id]);
  await revokeAllUserSessions(reset.user_id);

  log.info(\`Password reset completed for user \${reset.user_id}\`);
  return true;
}

/**
 * Change a user's password after verifying their current password.
 * Revokes all existing sessions after a successful change.
 */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  const user = await db.get<User>('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) return { success: false, error: 'User not found' };

  let currentValid = false;

  if (isLegacyMd5Hash(user.passwordHash)) {
    const migrated = await migratePasswordHash(currentPassword, user.salt, user.passwordHash);
    currentValid = migrated !== null;
  } else {
    currentValid = await verifyPassword(currentPassword, user.passwordHash);
  }

  if (!currentValid) {
    return { success: false, error: 'Current password is incorrect' };
  }

  const passwordHash = await hashPassword(newPassword);

  await db.run(
    'UPDATE users SET password_hash = ?, salt = ?, updated_at = ? WHERE id = ?',
    [passwordHash, '', new Date().toISOString(), userId]
  );

  await revokeAllUserSessions(userId);
  log.info(\`Password changed for user \${userId}\`);

  return { success: true };
}` } }
  ] },

  // --- Turn 20: Tool result ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Write', text: 'File written: /src/auth/login.ts (244 lines)' }
  ] },

  // --- Turn 21: Agent creates OAuth module ---
  { role: 'assistant', content: [
    { type: 'text', text: 'Creating the OAuth integration module.' },
    { type: 'tool_use', name: 'Write', input: { path: '/src/auth/oauth.ts', content: `import { db } from '../db/connection.js';
import { createLogger } from '../lib/logger.js';
import { OAuthClient } from '../lib/oauth-client.js';
import {
  type User,
  type UserRole,
  type OAuthResult,
  type OAuthError,
} from './types.js';
import { generateAccessToken, generateOAuthState, generateOAuthNonce } from './tokens.js';
import { createSession } from './sessions.js';

const log = createLogger('AuthOAuth', 'auth');

// ============================================================================
// Provider Registry
// ============================================================================

const oauthProviders: Record<string, OAuthClient> = {};

/**
 * Register an OAuth provider with its client credentials.
 * Providers are stored in-memory and must be re-registered on startup.
 */
export function registerOAuthProvider(
  provider: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  scopes: string[]
): void {
  oauthProviders[provider] = new OAuthClient({
    provider,
    clientId,
    clientSecret,
    redirectUri,
    scopes,
  });
  log.info(\`OAuth provider registered: \${provider}\`);
}

/**
 * Get the list of registered OAuth provider names.
 */
export function getRegisteredProviders(): string[] {
  return Object.keys(oauthProviders);
}

/**
 * Check if a specific OAuth provider is registered.
 */
export function isProviderRegistered(provider: string): boolean {
  return provider in oauthProviders;
}

// ============================================================================
// OAuth Flow
// ============================================================================

/**
 * Initiate an OAuth authorization flow for the given provider.
 * Generates a state parameter and nonce, stores them in the database,
 * and returns the authorization URL the client should redirect to.
 *
 * The state parameter expires after 10 minutes.
 */
export async function initiateOAuthFlow(provider: string): Promise<string> {
  const client = oauthProviders[provider];
  if (!client) {
    throw new Error(\`Unknown OAuth provider: \${provider}\`);
  }

  const state = generateOAuthState();
  const nonce = generateOAuthNonce();

  await db.run(
    'INSERT INTO oauth_states (state, nonce, provider, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    [state, nonce, provider, new Date().toISOString(),
     new Date(Date.now() + 10 * 60 * 1000).toISOString()]
  );

  return client.getAuthorizationUrl(state, nonce);
}

/**
 * Handle the OAuth callback after the user authorizes with the provider.
 *
 * This function:
 * 1. Validates the state parameter against the stored state
 * 2. Exchanges the authorization code for tokens
 * 3. Fetches the user profile from the provider
 * 4. Links the OAuth account to an existing user (by email) or creates a new one
 * 5. Creates a session and returns the auth result
 *
 * Returns either an OAuthResult or OAuthError.
 */
export async function handleOAuthCallback(
  provider: string,
  code: string,
  state: string
): Promise<OAuthResult | OAuthError> {
  // Validate state
  const oauthState = await db.get<{ nonce: string; expires_at: string }>(
    'SELECT nonce, expires_at FROM oauth_states WHERE state = ? AND provider = ?',
    [state, provider]
  );

  if (!oauthState || new Date(oauthState.expires_at) < new Date()) {
    return { error: 'Invalid or expired OAuth state' };
  }

  // Delete used state (single-use)
  await db.run('DELETE FROM oauth_states WHERE state = ?', [state]);

  const client = oauthProviders[provider];
  if (!client) {
    return { error: \`Unknown OAuth provider: \${provider}\` };
  }

  try {
    // Exchange code for tokens
    const tokenResponse = await client.exchangeCode(code);
    const profile = await client.getUserProfile(tokenResponse.access_token);

    // Look up existing OAuth account
    let user = await db.get<User>(
      'SELECT u.* FROM users u JOIN oauth_accounts oa ON u.id = oa.user_id WHERE oa.provider = ? AND oa.provider_user_id = ?',
      [provider, profile.id]
    );

    let isNewUser = false;

    if (!user) {
      // Check if a user with this email already exists
      user = await db.get<User>(
        'SELECT * FROM users WHERE email = ?',
        [profile.email.toLowerCase()]
      );

      if (user) {
        // Link OAuth account to existing user
        await db.run(
          'INSERT INTO oauth_accounts (user_id, provider, provider_user_id, created_at) VALUES (?, ?, ?, ?)',
          [user.id, provider, profile.id, new Date().toISOString()]
        );
        log.info(\`Linked \${provider} OAuth account to existing user \${user.email}\`);
      } else {
        // Create a new user from the OAuth profile
        const userId = crypto.randomUUID();
        const now = new Date().toISOString();
        user = {
          id: userId,
          email: profile.email.toLowerCase(),
          passwordHash: '',
          salt: '',
          displayName: profile.name || profile.email.split('@')[0],
          role: 'user' as UserRole,
          createdAt: now,
          updatedAt: now,
          lastLoginAt: now,
          failedLoginAttempts: 0,
          lockedUntil: null,
          twoFactorEnabled: false,
          twoFactorSecret: null,
          emailVerified: true, // OAuth-verified email
          emailVerificationToken: null,
        };

        await db.run(\`
          INSERT INTO users (id, email, password_hash, salt, display_name, role,
            created_at, updated_at, last_login_at, failed_login_attempts, locked_until,
            two_factor_enabled, two_factor_secret, email_verified, email_verification_token)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        \`, [user.id, user.email, user.passwordHash, user.salt, user.displayName,
          user.role, user.createdAt, user.updatedAt, user.lastLoginAt,
          user.failedLoginAttempts, user.lockedUntil, 0, null, 1, null]);

        await db.run(
          'INSERT INTO oauth_accounts (user_id, provider, provider_user_id, created_at) VALUES (?, ?, ?, ?)',
          [user.id, provider, profile.id, new Date().toISOString()]
        );

        isNewUser = true;
        log.info(\`Created new user from \${provider} OAuth: \${user.email}\`);
      }
    }

    // Create session
    const session = await createSession(user.id, '0.0.0.0', \`oauth:\${provider}\`, false);
    const accessToken = generateAccessToken(user, session.id);

    return { user, accessToken, session, isNewUser };
  } catch (error) {
    log.error(\`OAuth callback error for \${provider}:\`, error);
    return { error: 'OAuth authentication failed' };
  }
}` } }
  ] },

  // --- Turn 22: Tool result ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Write', text: 'File written: /src/auth/oauth.ts (174 lines)' }
  ] },

  // --- Turn 23: Agent creates middleware module ---
  { role: 'assistant', content: [
    { type: 'text', text: 'Creating the middleware module with auth verification and rate limiting.' },
    { type: 'tool_use', name: 'Write', input: { path: '/src/auth/middleware.ts', content: `import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../lib/logger.js';
import { RateLimiter } from '../lib/rate-limiter.js';
import { AuthConfig, type UserRole, type TokenPayload, type Session } from './types.js';
import { verifyAccessToken } from './tokens.js';
import { getSessionById, touchSession } from './sessions.js';

const log = createLogger('AuthMiddleware', 'auth');

// ============================================================================
// Type Augmentation
// ============================================================================

/**
 * Extend the Express Request type to include auth context.
 * After the authMiddleware runs, req.authUser and req.authSessionId are set.
 */
declare global {
  namespace Express {
    interface Request {
      authUser?: TokenPayload;
      authSessionId?: string;
    }
  }
}

// ============================================================================
// Authentication Middleware
// ============================================================================

/**
 * Express middleware that verifies JWT access tokens.
 *
 * Extracts the Bearer token from the Authorization header, verifies it,
 * checks the associated session is still valid (not revoked), and attaches
 * the decoded token payload to the request as req.authUser.
 *
 * Optionally enforces a minimum role requirement. Admins bypass role checks.
 *
 * Also updates the session's lastActivityAt timestamp on each request.
 *
 * @param requiredRole - If specified, the user must have this role (or be admin)
 */
export function authMiddleware(requiredRole?: UserRole) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }

    const token = authHeader.substring(7);
    const payload = verifyAccessToken(token);

    if (!payload) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Check session is still valid (not revoked)
    const session = await getSessionById(payload.sessionId);

    if (!session || session.isRevoked) {
      return res.status(401).json({ error: 'Session revoked or expired' });
    }

    // Check role if required
    if (requiredRole && payload.role !== requiredRole && payload.role !== 'admin') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Attach user info to request using typed properties
    req.authUser = payload;
    req.authSessionId = payload.sessionId;

    // Update session activity (fire-and-forget, don't block the request)
    touchSession(payload.sessionId).catch((err) => {
      log.warn('Failed to update session activity:', err);
    });

    next();
  };
}

// ============================================================================
// Rate Limiting Middleware
// ============================================================================

/**
 * Express middleware for rate limiting requests by IP address.
 *
 * Uses a sliding window algorithm. The rate limit state is stored in-memory
 * (not persisted), so it resets on server restart.
 *
 * Sets standard rate limit headers:
 * - X-RateLimit-Limit: Maximum requests in the window
 * - X-RateLimit-Remaining: Requests remaining in the current window
 * - X-RateLimit-Reset: Timestamp when the window resets (ms since epoch)
 *
 * Returns 429 Too Many Requests when the limit is exceeded, with a
 * retryAfter field indicating seconds until the limit resets.
 *
 * @param maxRequests - Maximum requests per window (default: 100)
 * @param windowMs - Window duration in milliseconds (default: 15 minutes)
 */
export function rateLimitMiddleware(
  maxRequests: number = AuthConfig.rateLimitMaxRequests,
  windowMs: number = AuthConfig.rateLimitWindowMs
) {
  const limiter = new RateLimiter(maxRequests, windowMs);

  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || 'unknown';
    const result = limiter.check(key);

    // Always set rate limit headers
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', result.resetAt);

    if (!result.allowed) {
      log.warn(\`Rate limit exceeded for \${key}\`);
      return res.status(429).json({
        error: 'Too many requests',
        retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
      });
    }

    next();
  };
}

/**
 * Create a login-specific rate limiter with stricter limits.
 * Default: 10 attempts per 15-minute window.
 */
export function loginRateLimitMiddleware() {
  return rateLimitMiddleware(
    AuthConfig.loginRateLimitMax,
    AuthConfig.rateLimitWindowMs
  );
}

/**
 * Create a password-reset-specific rate limiter with very strict limits.
 * Default: 3 attempts per 15-minute window.
 */
export function passwordResetRateLimitMiddleware() {
  return rateLimitMiddleware(
    AuthConfig.passwordResetRateLimitMax,
    AuthConfig.rateLimitWindowMs
  );
}` } }
  ] },

  // --- Turn 24: Tool result ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Write', text: 'File written: /src/auth/middleware.ts (138 lines)' }
  ] },

  // --- Turn 25: Agent creates handlers module ---
  { role: 'assistant', content: [
    { type: 'text', text: 'Creating the route handlers module. These are the Express request handlers that wire up to the router.' },
    { type: 'tool_use', name: 'Write', input: { path: '/src/auth/handlers.ts', content: `import { Request, Response } from 'express';
import { createLogger } from '../lib/logger.js';
import {
  LoginSchema,
  RegisterSchema,
  ResetPasswordSchema,
  ChangePasswordSchema,
  RefreshTokenSchema,
  EmailVerificationSchema,
  toPublicUser,
} from './types.js';
import { login, register, verifyEmail, requestPasswordReset, resetPassword, changePassword } from './login.js';
import { refreshSession, revokeSession } from './sessions.js';

const log = createLogger('AuthHandlers', 'auth');

/**
 * POST /auth/login
 * Authenticate a user with email and password.
 * Returns the user profile, access token, and refresh token.
 */
export async function handleLogin(req: Request, res: Response): Promise<void> {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { email, password, rememberMe } = parsed.data;
  const ip = req.ip || '0.0.0.0';
  const ua = req.headers['user-agent'] || 'unknown';

  const result = await login(email, password, ip, ua, rememberMe);

  if ('error' in result) {
    const statusCode = result.code === 'ACCOUNT_LOCKED' ? 423 : 401;
    res.status(statusCode).json({ error: result.error, code: result.code });
    return;
  }

  res.json({
    user: toPublicUser(result.user),
    accessToken: result.accessToken,
    refreshToken: result.session.refreshToken,
    expiresAt: result.session.expiresAt,
  });
}

/**
 * POST /auth/register
 * Register a new user account.
 * Returns the user ID and a message to verify their email.
 */
export async function handleRegister(req: Request, res: Response): Promise<void> {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { email, password, displayName } = parsed.data;
  const result = await register(email, password, displayName);

  if ('error' in result) {
    res.status(409).json({ error: result.error, code: result.code });
    return;
  }

  res.status(201).json({
    message: 'Registration successful. Please verify your email.',
    userId: result.user.id,
  });
}

/**
 * POST /auth/refresh
 * Refresh an access token using a refresh token.
 * Returns a new access token and refresh token.
 */
export async function handleRefresh(req: Request, res: Response): Promise<void> {
  const parsed = RefreshTokenSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const result = await refreshSession(parsed.data.refreshToken);
  if (!result) {
    res.status(401).json({ error: 'Invalid or expired refresh token' });
    return;
  }

  res.json({
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresAt: result.session.expiresAt,
  });
}

/**
 * POST /auth/logout
 * Revoke the current session.
 * Requires authentication (Bearer token).
 */
export async function handleLogout(req: Request, res: Response): Promise<void> {
  const sessionId = req.authSessionId;
  if (sessionId) {
    await revokeSession(sessionId);
  }
  res.json({ message: 'Logged out successfully' });
}

/**
 * POST /auth/verify-email
 * Verify a user's email address using the verification token.
 */
export async function handleVerifyEmail(req: Request, res: Response): Promise<void> {
  const parsed = EmailVerificationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const verified = await verifyEmail(parsed.data.token);
  if (!verified) {
    res.status(400).json({ error: 'Invalid or expired verification token' });
    return;
  }

  res.json({ message: 'Email verified successfully' });
}

/**
 * POST /auth/request-reset
 * Request a password reset email.
 * Always returns 200 regardless of whether the email exists (prevents enumeration).
 */
export async function handleRequestReset(req: Request, res: Response): Promise<void> {
  const { email } = req.body;
  if (!email || typeof email !== 'string') {
    res.status(400).json({ error: 'Email is required' });
    return;
  }

  // The result is intentionally not communicated to the client
  await requestPasswordReset(email);

  res.json({ message: 'If the email exists, a password reset link has been sent.' });
}

/**
 * POST /auth/reset-password
 * Reset a user's password using a valid reset token.
 */
export async function handlePasswordReset(req: Request, res: Response): Promise<void> {
  const parsed = ResetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const success = await resetPassword(parsed.data.token, parsed.data.newPassword);
  if (!success) {
    res.status(400).json({ error: 'Invalid or expired reset token' });
    return;
  }

  res.json({ message: 'Password reset successful' });
}

/**
 * POST /auth/change-password
 * Change the authenticated user's password.
 * Requires authentication (Bearer token).
 */
export async function handleChangePassword(req: Request, res: Response): Promise<void> {
  const parsed = ChangePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const userId = req.authUser?.sub;
  if (!userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const result = await changePassword(userId, parsed.data.currentPassword, parsed.data.newPassword);

  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.json({ message: 'Password changed successfully' });
}` } }
  ] },

  // --- Turn 26: Tool result ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Write', text: 'File written: /src/auth/handlers.ts (178 lines)' }
  ] },

  // --- Turn 27: Agent creates init and barrel modules ---
  { role: 'assistant', content: [
    { type: 'text', text: 'Creating the initialization module and the barrel re-export index.' },
    { type: 'tool_use', name: 'Write', input: { path: '/src/auth/init.ts', content: `import { createLogger } from '../lib/logger.js';
import { registerOAuthProvider } from './oauth.js';
import { startSessionCleanup, stopSessionCleanup } from './sessions.js';

const log = createLogger('AuthInit', 'auth');

/**
 * Initialize the authentication system.
 *
 * This function:
 * 1. Starts the periodic session cleanup job
 * 2. Registers OAuth providers from environment variables
 *
 * Should be called once during server startup.
 */
export function initializeAuth(): void {
  startSessionCleanup();

  // Register Google OAuth if configured
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    registerOAuthProvider('google',
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback',
      ['openid', 'email', 'profile']
    );
  }

  // Register GitHub OAuth if configured
  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    registerOAuthProvider('github',
      process.env.GITHUB_CLIENT_ID,
      process.env.GITHUB_CLIENT_SECRET,
      process.env.GITHUB_REDIRECT_URI || 'http://localhost:3000/auth/github/callback',
      ['read:user', 'user:email']
    );
  }

  log.info('Auth system initialized');
}

/**
 * Shut down the authentication system gracefully.
 * Stops the session cleanup timer.
 */
export function shutdownAuth(): void {
  stopSessionCleanup();
  log.info('Auth system shut down');
}` } }
  ] },

  // --- Turn 28: Tool result ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Write', text: 'File written: /src/auth/init.ts (50 lines)' }
  ] },

  // --- Turn 29: Agent creates the barrel index ---
  { role: 'assistant', content: [
    { type: 'text', text: 'Creating the barrel re-export index file.' },
    { type: 'tool_use', name: 'Write', input: { path: '/src/auth/index.ts', content: `// /src/auth/index.ts - Barrel re-export
// All auth module exports are accessible through this single entry point.

// Types and schemas
export type { User, UserRole, UserPublic, Session, TokenPayload } from './types.js';
export type { LoginResult, LoginSuccess, LoginError } from './types.js';
export type { RegisterResult, RegisterSuccess, RegisterError } from './types.js';
export type { OAuthResult, OAuthError } from './types.js';
export { AuthConfig, LoginSchema, RegisterSchema, ResetPasswordSchema, ChangePasswordSchema, RefreshTokenSchema, EmailVerificationSchema, OAuthCallbackSchema, toPublicUser } from './types.js';

// Password hashing
export { hashPassword, verifyPassword, isLegacyMd5Hash, needsRehash, migratePasswordHash } from './password.js';

// JWT tokens
export { generateAccessToken, generateRefreshToken, verifyAccessToken, decodeTokenUnsafe, generateVerificationToken, generateOAuthState, generateOAuthNonce } from './tokens.js';

// Session management
export { createSession, refreshSession, revokeSession, revokeAllUserSessions, getActiveSessions, touchSession, cleanupExpiredSessions, startSessionCleanup, stopSessionCleanup, getSessionById, countActiveSessions } from './sessions.js';

// Login, registration, password management
export { login, register, verifyEmail, requestPasswordReset, resetPassword, changePassword } from './login.js';

// OAuth
export { registerOAuthProvider, getRegisteredProviders, isProviderRegistered, initiateOAuthFlow, handleOAuthCallback } from './oauth.js';

// Middleware
export { authMiddleware, rateLimitMiddleware, loginRateLimitMiddleware, passwordResetRateLimitMiddleware } from './middleware.js';

// Route handlers
export { handleLogin, handleRegister, handleRefresh, handleLogout, handleVerifyEmail, handleRequestReset, handlePasswordReset, handleChangePassword } from './handlers.js';

// Initialization
export { initializeAuth, shutdownAuth } from './init.js';` } }
  ] },

  // --- Turn 30: Tool result ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Write', text: 'File written: /src/auth/index.ts (35 lines)' }
  ] },

  // --- Turn 31: Agent summarizes the structure ---
  { role: 'assistant', content: 'All modules have been created. Here is the final file structure:\n\n```\n/src/auth/\n  index.ts       - 35 lines  (barrel re-export)\n  types.ts       - 165 lines (interfaces, Zod schemas, config constants)\n  password.ts    - 67 lines  (bcrypt hashing, MD5 migration)\n  tokens.ts      - 82 lines  (JWT generation, verification, OAuth tokens)\n  sessions.ts    - 214 lines (session CRUD, cleanup, race condition fix)\n  login.ts       - 244 lines (login, registration, password reset/change)\n  oauth.ts       - 174 lines (OAuth provider registration, flow, callback)\n  middleware.ts  - 138 lines (auth middleware, rate limiting)\n  handlers.ts    - 178 lines (Express route handlers)\n  init.ts        - 50 lines  (startup/shutdown)\n```\n\nTotal: 1,347 lines across 10 files (up slightly from 1,247 lines in the original because of added JSDoc comments, the MD5 migration logic, the race condition fix, and the `shutdownAuth` function).\n\nKey changes from the original:\n1. **MD5 vulnerability fixed**: Passwords now use bcrypt with cost factor 12. Legacy MD5 hashes are detected and transparently migrated on next login.\n2. **Race condition fixed**: `refreshSession()` now wraps the SELECT and UPDATE in a `db.transaction()` with IMMEDIATE locking.\n3. **Rate limiting extracted**: Three tiers available (general 100/15min, login 10/15min, password reset 3/15min).\n4. **Type safety improved**: Discriminated unions for LoginResult and RegisterResult. Express Request augmented with typed `authUser` and `authSessionId` properties.\n5. **camelCase naming** throughout as requested.\n\nLet me run the tests to verify everything works.' },

  // --- Turn 31b: Agent reads the rate limiter to verify the interface ---
  { role: 'assistant', content: [
    { type: 'text', text: 'Before we run tests, let me verify that the RateLimiter interface matches what the middleware expects. Let me read the rate limiter implementation.' },
    { type: 'tool_use', name: 'Read', input: { path: '/src/lib/rate-limiter.ts' } }
  ] },

  // --- Turn 31c: Rate limiter source ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Read', text: `import { createLogger } from './logger.js';

const log = createLogger('RateLimiter', 'server');

/**
 * Result of a rate limit check.
 */
export interface RateLimitResult {
  /** Whether the request is allowed. */
  allowed: boolean;
  /** Number of requests remaining in the current window. */
  remaining: number;
  /** Timestamp (ms since epoch) when the window resets. */
  resetAt: number;
  /** Total number of requests made in the current window. */
  count: number;
}

/**
 * Entry tracking requests from a single key (typically an IP address).
 */
interface WindowEntry {
  /** Timestamps of requests within the current window. */
  timestamps: number[];
  /** When this entry was last accessed (for cleanup). */
  lastAccess: number;
}

/**
 * In-memory sliding window rate limiter.
 *
 * Uses a sliding window algorithm where each request timestamp is stored
 * and expired timestamps are pruned on each check. This provides more
 * accurate rate limiting than fixed windows, as there are no boundary
 * effects where a burst of requests at the end of one window and the
 * start of the next could exceed the intended limit.
 *
 * State is stored in-memory and is not persisted, so rate limits reset
 * on server restart. For a distributed system, this would need to be
 * backed by Redis or similar.
 *
 * Periodic cleanup removes stale entries to prevent memory growth from
 * IP addresses that stop making requests.
 *
 * @example
 * \x60\x60\x60typescript
 * const limiter = new RateLimiter(100, 15 * 60 * 1000); // 100 req / 15 min
 * const result = limiter.check('192.168.1.1');
 * if (!result.allowed) {
 *   res.status(429).json({ retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000) });
 * }
 * \x60\x60\x60
 */
export class RateLimiter {
  private windows: Map<string, WindowEntry> = new Map();
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  private static readonly STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

  /**
   * Create a new rate limiter.
   *
   * @param maxRequests - Maximum number of requests allowed per window.
   * @param windowMs - Duration of the sliding window in milliseconds.
   */
  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.startCleanup();
  }

  /**
   * Check if a request from the given key is allowed.
   *
   * This method:
   * 1. Gets or creates the window entry for the key
   * 2. Prunes timestamps outside the current window
   * 3. Checks if adding a new request would exceed the limit
   * 4. Records the request timestamp if allowed
   * 5. Returns the result with remaining count and reset time
   *
   * @param key - The identifier for the requester (typically IP address).
   * @returns The rate limit check result.
   */
  check(key: string): RateLimitResult {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    // Get or create entry
    let entry = this.windows.get(key);
    if (!entry) {
      entry = { timestamps: [], lastAccess: now };
      this.windows.set(key, entry);
    }

    // Prune expired timestamps (outside current window)
    entry.timestamps = entry.timestamps.filter(ts => ts > windowStart);
    entry.lastAccess = now;

    // Calculate remaining requests
    const count = entry.timestamps.length;
    const remaining = Math.max(0, this.maxRequests - count);

    // Calculate when the earliest timestamp in the window will expire
    const resetAt = entry.timestamps.length > 0
      ? entry.timestamps[0] + this.windowMs
      : now + this.windowMs;

    // Check if allowed
    if (count >= this.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetAt,
        count,
      };
    }

    // Record this request
    entry.timestamps.push(now);

    return {
      allowed: true,
      remaining: remaining - 1, // -1 because we just used one
      resetAt,
      count: count + 1,
    };
  }

  /**
   * Reset the rate limit for a specific key.
   * Useful for admin overrides or after a successful CAPTCHA verification.
   *
   * @param key - The identifier to reset.
   */
  reset(key: string): void {
    this.windows.delete(key);
  }

  /**
   * Reset all rate limits.
   * Useful for testing or emergency situations.
   */
  resetAll(): void {
    this.windows.clear();
  }

  /**
   * Get the current request count for a key without recording a new request.
   * Useful for monitoring and debugging.
   *
   * @param key - The identifier to check.
   * @returns The number of requests in the current window, or 0 if no requests.
   */
  getCount(key: string): number {
    const entry = this.windows.get(key);
    if (!entry) return 0;

    const windowStart = Date.now() - this.windowMs;
    return entry.timestamps.filter(ts => ts > windowStart).length;
  }

  /**
   * Get the number of unique keys being tracked.
   * Useful for monitoring memory usage.
   */
  getTrackedKeyCount(): number {
    return this.windows.size;
  }

  /**
   * Start periodic cleanup of stale entries.
   * Entries that haven't been accessed in STALE_THRESHOLD_MS are removed
   * to prevent unbounded memory growth.
   */
  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      let cleaned = 0;

      for (const [key, entry] of this.windows) {
        if (now - entry.lastAccess > RateLimiter.STALE_THRESHOLD_MS) {
          this.windows.delete(key);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        log.debug(\`Rate limiter cleanup: removed \${cleaned} stale entries, \${this.windows.size} remaining\`);
      }
    }, RateLimiter.CLEANUP_INTERVAL_MS);

    // Don't prevent Node.js from exiting
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Stop the cleanup timer.
   * Should be called during graceful shutdown.
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.windows.clear();
  }
}

/**
 * Create a rate limiter for a specific use case with sensible defaults.
 */
export function createApiRateLimiter(): RateLimiter {
  return new RateLimiter(100, 15 * 60 * 1000); // 100 requests per 15 minutes
}

export function createLoginRateLimiter(): RateLimiter {
  return new RateLimiter(10, 15 * 60 * 1000); // 10 attempts per 15 minutes
}

export function createPasswordResetRateLimiter(): RateLimiter {
  return new RateLimiter(3, 15 * 60 * 1000); // 3 requests per 15 minutes
}

export function createRegistrationRateLimiter(): RateLimiter {
  return new RateLimiter(5, 60 * 60 * 1000); // 5 registrations per hour
}` }
  ] },

  // --- Turn 31d: Agent confirms rate limiter compatibility ---
  { role: 'assistant', content: 'The RateLimiter interface is compatible. The `check()` method returns a `RateLimitResult` with `allowed`, `remaining`, `resetAt`, and `count` properties, which matches exactly what the middleware expects. The factory functions at the bottom (`createLoginRateLimiter`, etc.) use the same limits I configured in AuthConfig.\n\nLet me also check the database connection module to verify the `transaction()` method signature.' },

  // --- Turn 31e: Agent reads the db connection ---
  { role: 'assistant', content: [
    { type: 'text', text: 'Reading the database connection module to verify transaction support.' },
    { type: 'tool_use', name: 'Read', input: { path: '/src/db/connection.ts' } }
  ] },

  // --- Turn 31f: Database connection source ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Read', text: `import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { createLogger } from '../lib/logger.js';

const log = createLogger('Database', 'database');

/**
 * Result of a database write operation (INSERT, UPDATE, DELETE).
 */
export interface RunResult {
  /** Number of rows changed by the operation. */
  changes: number;
  /** The rowid of the last row inserted (for INSERT operations). */
  lastInsertRowid: number | bigint;
}

/**
 * Database connection wrapper providing a simplified async-style API
 * over better-sqlite3's synchronous operations.
 *
 * While better-sqlite3 is synchronous, this wrapper provides an async
 * interface for consistency with the rest of the application and to
 * allow future migration to an async driver if needed.
 *
 * Features:
 * - WAL mode for concurrent reads
 * - Busy timeout for lock contention
 * - IMMEDIATE transactions for write safety
 * - Prepared statement caching
 * - Schema migration support
 * - Connection health checking
 */
export class DatabaseConnection {
  private db: Database.Database;
  private readonly dbPath: string;
  private statementCache: Map<string, Database.Statement> = new Map();
  private static readonly MAX_CACHE_SIZE = 100;
  private isDestroyed = false;

  constructor(dbPath: string, options: DatabaseOptions = {}) {
    this.dbPath = dbPath;

    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath, {
      verbose: options.verbose ? (msg) => log.debug(\`SQL: \${msg}\`) : undefined,
    });

    // Configure pragmas for performance and safety
    this.db.pragma('journal_mode = WAL');
    this.db.pragma(\`busy_timeout = \${options.busyTimeout || 5000}\`);
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = -64000'); // 64MB cache
    this.db.pragma('temp_store = MEMORY');

    log.info(\`Database opened: \${dbPath} (WAL mode, busy_timeout=\${options.busyTimeout || 5000}ms)\`);
  }

  /**
   * Execute a SQL statement that modifies data (INSERT, UPDATE, DELETE).
   * Returns the number of rows changed and the last inserted rowid.
   */
  async run(sql: string, params: unknown[] = []): Promise<RunResult> {
    this.ensureOpen();
    try {
      const stmt = this.getStatement(sql);
      const result = stmt.run(...params);
      return {
        changes: result.changes,
        lastInsertRowid: result.lastInsertRowid,
      };
    } catch (error) {
      log.error(\`SQL error in run(): \${(error as Error).message}\`);
      log.debug(\`SQL: \${sql}\`);
      log.debug(\`Params: \${JSON.stringify(params)}\`);
      throw error;
    }
  }

  /**
   * Execute a SQL query that returns a single row.
   * Returns the row as an object, or undefined if no rows match.
   */
  async get<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    this.ensureOpen();
    try {
      const stmt = this.getStatement(sql);
      return stmt.get(...params) as T | undefined;
    } catch (error) {
      log.error(\`SQL error in get(): \${(error as Error).message}\`);
      log.debug(\`SQL: \${sql}\`);
      throw error;
    }
  }

  /**
   * Execute a SQL query that returns multiple rows.
   * Returns an array of row objects (empty array if no rows match).
   */
  async all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    this.ensureOpen();
    try {
      const stmt = this.getStatement(sql);
      return stmt.all(...params) as T[];
    } catch (error) {
      log.error(\`SQL error in all(): \${(error as Error).message}\`);
      log.debug(\`SQL: \${sql}\`);
      throw error;
    }
  }

  /**
   * Execute multiple SQL statements within a transaction.
   *
   * Uses BEGIN IMMEDIATE to acquire a write lock at the start of the
   * transaction, preventing the TOCTOU race condition where another
   * connection could modify data between a read and a write.
   *
   * If the callback throws, the transaction is rolled back automatically.
   * If it succeeds, the transaction is committed.
   *
   * @param fn - Async function containing the transaction logic.
   *             All db operations within this function are atomic.
   * @returns The return value of the callback function.
   *
   * @example
   * \x60\x60\x60typescript
   * const result = await db.transaction(async () => {
   *   const user = await db.get('SELECT * FROM users WHERE id = ?', [id]);
   *   if (!user) return null;
   *   await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [amount, id]);
   *   return { newBalance: user.balance - amount };
   * });
   * \x60\x60\x60
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    this.ensureOpen();

    // BEGIN IMMEDIATE acquires a write lock immediately, not deferred
    this.db.exec('BEGIN IMMEDIATE');

    try {
      const result = await fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      log.error(\`Transaction rolled back: \${(error as Error).message}\`);
      throw error;
    }
  }

  /**
   * Execute raw SQL. Use with caution; prefer run/get/all for parameterized queries.
   * Useful for DDL statements (CREATE TABLE, etc.) and pragmas.
   */
  exec(sql: string): void {
    this.ensureOpen();
    this.db.exec(sql);
  }

  /**
   * Run a series of SQL migration files against the database.
   * Each migration is run in a transaction. If a migration fails,
   * it is rolled back but previously applied migrations remain.
   *
   * Migrations are tracked in a _migrations table.
   */
  async migrate(migrationDir: string): Promise<{ applied: string[]; skipped: string[] }> {
    this.ensureOpen();

    // Create migrations tracking table if it doesn't exist
    this.db.exec(\`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    \`);

    // Get already-applied migrations
    const applied = this.db.prepare('SELECT name FROM _migrations ORDER BY id').all() as { name: string }[];
    const appliedSet = new Set(applied.map(m => m.name));

    // Read migration files
    if (!fs.existsSync(migrationDir)) {
      log.warn(\`Migration directory not found: \${migrationDir}\`);
      return { applied: [], skipped: [] };
    }

    const files = fs.readdirSync(migrationDir)
      .filter(f => f.endsWith('.sql'))
      .sort(); // Lexicographic sort ensures order

    const newlyApplied: string[] = [];
    const skipped: string[] = [];

    for (const file of files) {
      if (appliedSet.has(file)) {
        skipped.push(file);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationDir, file), 'utf-8');

      try {
        this.db.exec('BEGIN');
        this.db.exec(sql);
        this.db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
        this.db.exec('COMMIT');
        newlyApplied.push(file);
        log.info(\`Applied migration: \${file}\`);
      } catch (error) {
        this.db.exec('ROLLBACK');
        log.error(\`Migration failed: \${file} - \${(error as Error).message}\`);
        throw new Error(\`Migration \${file} failed: \${(error as Error).message}\`);
      }
    }

    return { applied: newlyApplied, skipped };
  }

  /**
   * Get or create a cached prepared statement.
   * Prepared statements are cached for performance; the cache is bounded
   * to MAX_CACHE_SIZE entries with LRU eviction.
   */
  private getStatement(sql: string): Database.Statement {
    let stmt = this.statementCache.get(sql);
    if (stmt) return stmt;

    stmt = this.db.prepare(sql);
    this.statementCache.set(sql, stmt);

    // Evict oldest entries if cache is too large
    if (this.statementCache.size > DatabaseConnection.MAX_CACHE_SIZE) {
      const firstKey = this.statementCache.keys().next().value;
      if (firstKey) this.statementCache.delete(firstKey);
    }

    return stmt;
  }

  /**
   * Check that the database connection is still open.
   */
  private ensureOpen(): void {
    if (this.isDestroyed) {
      throw new Error(\`Database connection to \${this.dbPath} is closed\`);
    }
  }

  /**
   * Check database health by running a simple query.
   * Returns true if the database is responsive.
   */
  isHealthy(): boolean {
    try {
      this.db.prepare('SELECT 1').get();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get database file size in bytes.
   */
  getFileSize(): number {
    try {
      const stats = fs.statSync(this.dbPath);
      return stats.size;
    } catch {
      return 0;
    }
  }

  /**
   * Get WAL file size in bytes.
   */
  getWalSize(): number {
    try {
      const walPath = this.dbPath + '-wal';
      const stats = fs.statSync(walPath);
      return stats.size;
    } catch {
      return 0;
    }
  }

  /**
   * Checkpoint the WAL file to merge it into the main database.
   * This is usually done automatically by SQLite, but can be triggered
   * manually to reduce WAL file size.
   */
  checkpoint(): void {
    this.db.pragma('wal_checkpoint(TRUNCATE)');
    log.info(\`WAL checkpoint completed for \${this.dbPath}\`);
  }

  /**
   * Close the database connection and release all resources.
   * After calling destroy(), no further operations can be performed.
   */
  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.statementCache.clear();
    this.db.close();
    log.info(\`Database closed: \${this.dbPath}\`);
  }
}

/**
 * Options for creating a database connection.
 */
export interface DatabaseOptions {
  /** Log all SQL statements at debug level. */
  verbose?: boolean;
  /** Timeout in ms when waiting for a write lock (default: 5000). */
  busyTimeout?: number;
}

// ============================================================================
// Singleton database instance
// ============================================================================

let _db: DatabaseConnection | null = null;

/**
 * Get the singleton database connection.
 * Creates it on first access using the DATABASE_URL environment variable.
 */
export function getDb(): DatabaseConnection {
  if (!_db) {
    const dbPath = process.env.DATABASE_URL || path.join(process.cwd(), 'data', 'databases', 'app.db');
    _db = new DatabaseConnection(dbPath);
  }
  return _db;
}

/**
 * The default database instance.
 * Exported as a convenience; equivalent to getDb().
 */
export const db = new Proxy({} as DatabaseConnection, {
  get(_target, prop) {
    return (getDb() as any)[prop];
  },
});

/**
 * Close the singleton database connection.
 * Called during graceful shutdown.
 */
export function closeDb(): void {
  if (_db) {
    _db.destroy();
    _db = null;
  }
}` }
  ] },

  // --- Turn 31g: Agent confirms transaction support ---
  { role: 'assistant', content: 'The database connection module confirms that `db.transaction()` is available and uses `BEGIN IMMEDIATE` as I expected. The JSDoc even mentions the TOCTOU race condition prevention. The method signature is:\n\n```typescript\nasync transaction<T>(fn: () => Promise<T>): Promise<T>\n```\n\nThis wraps the callback in `BEGIN IMMEDIATE` / `COMMIT` with automatic `ROLLBACK` on error. This is exactly what `refreshSession()` needs.\n\nLet me also check the EventBus to make sure the event names match what the auth module emits.' },

  // --- Turn 31h: Agent reads the EventBus ---
  { role: 'assistant', content: [
    { type: 'text', text: 'Reading the EventBus implementation to verify event name conventions.' },
    { type: 'tool_use', name: 'Read', input: { path: '/src/lib/event-bus.ts' } }
  ] },

  // --- Turn 31i: EventBus source ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Read', text: `import { EventEmitter } from 'events';
import { createLogger } from './logger.js';

const log = createLogger('EventBus', 'server');

/**
 * Type-safe event definitions for the application event bus.
 *
 * Each key is an event name and the value is the payload type.
 * Events follow the convention: <domain>:<action>
 *
 * Examples:
 * - auth:login - User logged in
 * - session:created - New session created
 * - heartbeat:tick - Heartbeat tick occurred
 */
export interface EventMap {
  // Authentication events
  'auth:login': { userId: string; email: string };
  'auth:logout': { userId: string; sessionId: string };
  'auth:register': { userId: string; email: string };
  'auth:password_changed': { userId: string };
  'auth:password_reset': { userId: string };
  'auth:email_verified': { userId: string; email: string };
  'auth:failed_login': { email: string; attempts: number; locked: boolean };
  'auth:account_locked': { email: string; lockedUntil: string };

  // Session events
  'session:created': { sessionId: string; userId: string };
  'session:revoked': { sessionId: string };
  'session:revoked_all': { userId: string; count: number };
  'session:expired': { sessionId: string; userId: string };
  'session:refreshed': { sessionId: string; userId: string };
  'session:activity': { sessionId: string; userId: string; path: string };

  // Heartbeat events
  'heartbeat:tick': { tickId: string; timestamp: string; phase: string };
  'heartbeat:started': { tickInterval: number };
  'heartbeat:stopped': { reason: string };
  'heartbeat:error': { error: string; tickId: string };

  // Agent events
  'agent:thinking': { tickId: string; thought: string };
  'agent:decision': { tickId: string; type: string; data: unknown };
  'agent:tool_call': { tickId: string; tool: string; input: unknown };
  'agent:response': { tickId: string; response: string; channel: string };
  'agent:error': { tickId: string; error: string };

  // Memory events
  'memory:observation': { content: string; importance: number; source: string };
  'memory:reflection': { content: string; connectionCount: number };
  'memory:consolidation': { consolidated: number; remaining: number };
  'memory:working_update': { contactId: string; content: string };
  'memory:core_self_update': { field: string; content: string };

  // Goal events
  'goal:created': { goalId: string; title: string };
  'goal:completed': { goalId: string; title: string };
  'goal:failed': { goalId: string; reason: string };
  'goal:progress': { goalId: string; progress: number };

  // Task events
  'task:created': { taskId: string; title: string; assignee: string };
  'task:completed': { taskId: string; title: string };
  'task:failed': { taskId: string; error: string };
  'task:progress': { taskId: string; status: string; progress: number };

  // Contact events
  'contact:created': { contactId: string; name: string };
  'contact:updated': { contactId: string; fields: string[] };
  'contact:linked': { contactId: string; channel: string; channelUserId: string };

  // Channel events
  'channel:connected': { channelId: string; type: string };
  'channel:disconnected': { channelId: string; reason: string };
  'channel:message_received': { channelId: string; messageId: string; contactId: string };
  'channel:message_sent': { channelId: string; messageId: string; contactId: string };
  'channel:error': { channelId: string; error: string };

  // Plugin events
  'plugin:installed': { pluginId: string; name: string; version: string };
  'plugin:removed': { pluginId: string; name: string };
  'plugin:enabled': { pluginId: string };
  'plugin:disabled': { pluginId: string };
  'plugin:error': { pluginId: string; error: string };

  // System events
  'system:startup': { version: string; environment: string };
  'system:shutdown': { reason: string };
  'system:error': { error: string; source: string };
  'system:config_changed': { key: string; oldValue: unknown; newValue: unknown };
}

/**
 * Type-safe application event bus.
 *
 * Provides a centralized pub/sub mechanism for decoupled communication
 * between application components. All events are defined in the EventMap
 * interface for type safety.
 *
 * Usage:
 * \x60\x60\x60typescript
 * // Emit an event
 * EventBus.emit('auth:login', { userId: '123', email: 'user@example.com' });
 *
 * // Listen for an event
 * EventBus.on('auth:login', (payload) => {
 *   // payload is typed as { userId: string; email: string }
 *   console.log(payload.email);
 * });
 *
 * // Listen once
 * EventBus.once('system:startup', (payload) => {
 *   console.log(\`Started v\${payload.version}\`);
 * });
 *
 * // Remove a listener
 * const handler = (payload) => { ... };
 * EventBus.on('heartbeat:tick', handler);
 * EventBus.off('heartbeat:tick', handler);
 * \x60\x60\x60
 */
class TypedEventBus {
  private emitter = new EventEmitter();
  private listenerCounts: Map<string, number> = new Map();

  constructor() {
    // Increase max listeners to avoid warnings in large applications
    this.emitter.setMaxListeners(100);
  }

  /**
   * Emit a typed event.
   */
  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    log.debug(\`Event: \${String(event)}\`);
    this.emitter.emit(String(event), payload);
  }

  /**
   * Register a listener for a typed event.
   */
  on<K extends keyof EventMap>(event: K, handler: (payload: EventMap[K]) => void): void {
    this.emitter.on(String(event), handler);
    this.trackListener(String(event), 1);
  }

  /**
   * Register a one-time listener for a typed event.
   */
  once<K extends keyof EventMap>(event: K, handler: (payload: EventMap[K]) => void): void {
    this.emitter.once(String(event), handler);
  }

  /**
   * Remove a listener for a typed event.
   */
  off<K extends keyof EventMap>(event: K, handler: (payload: EventMap[K]) => void): void {
    this.emitter.off(String(event), handler);
    this.trackListener(String(event), -1);
  }

  /**
   * Remove all listeners for a specific event, or all events if none specified.
   */
  removeAllListeners(event?: keyof EventMap): void {
    if (event) {
      this.emitter.removeAllListeners(String(event));
      this.listenerCounts.delete(String(event));
    } else {
      this.emitter.removeAllListeners();
      this.listenerCounts.clear();
    }
  }

  /**
   * Get the number of listeners for a specific event.
   */
  listenerCount(event: keyof EventMap): number {
    return this.emitter.listenerCount(String(event));
  }

  /**
   * Get all registered event names.
   */
  eventNames(): string[] {
    return this.emitter.eventNames() as string[];
  }

  /**
   * Track listener counts for monitoring.
   */
  private trackListener(event: string, delta: number): void {
    const current = this.listenerCounts.get(event) || 0;
    const updated = Math.max(0, current + delta);
    if (updated === 0) {
      this.listenerCounts.delete(event);
    } else {
      this.listenerCounts.set(event, updated);
    }
  }

  /**
   * Get listener count statistics for all events.
   * Useful for debugging and monitoring.
   */
  getStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const [event, count] of this.listenerCounts) {
      stats[event] = count;
    }
    return stats;
  }
}

/**
 * The singleton event bus instance.
 * All application components should use this instance.
 */
export const EventBus = new TypedEventBus();` }
  ] },

  // --- Turn 31j: Agent confirms EventBus compatibility ---
  { role: 'assistant', content: 'The EventBus event names match what the auth modules emit. I can see the defined events:\n- `auth:login`, `auth:register` in the auth domain\n- `session:created`, `session:revoked`, `session:revoked_all` in the session domain\n\nAll of these are emitted by the auth modules. The EventMap interface is well-typed, so TypeScript will catch any mismatched event names or payload shapes at compile time.\n\nNow let me also read the OAuthClient implementation to confirm the interface expected by oauth.ts.' },

  // --- Turn 31k: Agent reads OAuth client ---
  { role: 'assistant', content: [
    { type: 'text', text: 'Reading the OAuth client library to verify the interface contract.' },
    { type: 'tool_use', name: 'Read', input: { path: '/src/lib/oauth-client.ts' } }
  ] },

  // --- Turn 31l: OAuth client source ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Read', text: `import { createLogger } from './logger.js';

const log = createLogger('OAuthClient', 'auth');

/**
 * Configuration for an OAuth 2.0 provider.
 */
export interface OAuthConfig {
  /** Provider identifier (e.g., 'google', 'github'). */
  provider: string;
  /** OAuth client ID. */
  clientId: string;
  /** OAuth client secret. */
  clientSecret: string;
  /** Redirect URI for the authorization callback. */
  redirectUri: string;
  /** OAuth scopes to request. */
  scopes: string[];
  /** Optional custom authorization endpoint URL. */
  authorizationUrl?: string;
  /** Optional custom token endpoint URL. */
  tokenUrl?: string;
  /** Optional custom user profile endpoint URL. */
  userProfileUrl?: string;
}

/**
 * OAuth token response from the provider.
 */
export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
}

/**
 * Normalized user profile from an OAuth provider.
 */
export interface OAuthUserProfile {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  raw: Record<string, unknown>;
}

/**
 * Known OAuth provider configurations.
 * These define the standard endpoints for common providers.
 */
const PROVIDER_CONFIGS: Record<string, {
  authorizationUrl: string;
  tokenUrl: string;
  userProfileUrl: string;
}> = {
  google: {
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userProfileUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
  },
  github: {
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userProfileUrl: 'https://api.github.com/user',
  },
  discord: {
    authorizationUrl: 'https://discord.com/api/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    userProfileUrl: 'https://discord.com/api/users/@me',
  },
  microsoft: {
    authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    userProfileUrl: 'https://graph.microsoft.com/v1.0/me',
  },
};

/**
 * OAuth 2.0 client for managing authorization flows.
 *
 * Supports the Authorization Code Grant flow:
 * 1. Generate authorization URL with state parameter
 * 2. User authorizes in browser
 * 3. Exchange authorization code for access token
 * 4. Fetch user profile with access token
 *
 * Supports Google, GitHub, Discord, and Microsoft out of the box.
 * Custom providers can be used by specifying endpoint URLs in the config.
 *
 * @example
 * \x60\x60\x60typescript
 * const client = new OAuthClient({
 *   provider: 'google',
 *   clientId: process.env.GOOGLE_CLIENT_ID!,
 *   clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
 *   redirectUri: 'http://localhost:3000/auth/google/callback',
 *   scopes: ['openid', 'email', 'profile'],
 * });
 *
 * // Step 1: Generate auth URL
 * const url = client.getAuthorizationUrl(state, nonce);
 * // Redirect user to url...
 *
 * // Step 2: Handle callback
 * const tokens = await client.exchangeCode(code);
 * const profile = await client.getUserProfile(tokens.access_token);
 * \x60\x60\x60
 */
export class OAuthClient {
  private config: Required<OAuthConfig>;

  constructor(config: OAuthConfig) {
    const providerDefaults = PROVIDER_CONFIGS[config.provider];

    this.config = {
      ...config,
      authorizationUrl: config.authorizationUrl || providerDefaults?.authorizationUrl || '',
      tokenUrl: config.tokenUrl || providerDefaults?.tokenUrl || '',
      userProfileUrl: config.userProfileUrl || providerDefaults?.userProfileUrl || '',
    };

    if (!this.config.authorizationUrl || !this.config.tokenUrl) {
      throw new Error(
        \`Unknown OAuth provider "\${config.provider}" and no custom endpoints provided. \\n\` +
        \`Known providers: \${Object.keys(PROVIDER_CONFIGS).join(', ')}\`
      );
    }

    log.info(\`OAuth client initialized for provider: \${config.provider}\`);
  }

  /**
   * Generate the authorization URL that the user should be redirected to.
   *
   * @param state - CSRF protection state parameter (stored server-side)
   * @param nonce - Replay protection nonce (for OpenID Connect)
   * @returns The full authorization URL
   */
  getAuthorizationUrl(state: string, nonce: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: this.config.scopes.join(' '),
      state,
      nonce,
      access_type: 'offline', // Request refresh token
      prompt: 'consent',      // Force consent screen to get refresh token
    });

    return \`\${this.config.authorizationUrl}?\${params.toString()}\`;
  }

  /**
   * Exchange an authorization code for access and refresh tokens.
   *
   * @param code - The authorization code from the callback
   * @returns The token response including access_token and optional refresh_token
   */
  async exchangeCode(code: string): Promise<OAuthTokenResponse> {
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: this.config.redirectUri,
    });

    const response = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      log.error(\`OAuth token exchange failed: \${response.status} \${errorBody}\`);
      throw new Error(\`OAuth token exchange failed: \${response.status}\`);
    }

    const data = await response.json();
    return data as OAuthTokenResponse;
  }

  /**
   * Refresh an access token using a refresh token.
   *
   * @param refreshToken - The refresh token from a previous token exchange
   * @returns New token response with a fresh access_token
   */
  async refreshAccessToken(refreshToken: string): Promise<OAuthTokenResponse> {
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    const response = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      log.error(\`OAuth token refresh failed: \${response.status} \${errorBody}\`);
      throw new Error(\`OAuth token refresh failed: \${response.status}\`);
    }

    return await response.json() as OAuthTokenResponse;
  }

  /**
   * Fetch the authenticated user's profile from the provider.
   *
   * Normalizes the provider-specific response into a common OAuthUserProfile
   * structure. The original response data is preserved in the 'raw' field.
   *
   * @param accessToken - A valid access token for the provider
   * @returns Normalized user profile
   */
  async getUserProfile(accessToken: string): Promise<OAuthUserProfile> {
    const response = await fetch(this.config.userProfileUrl, {
      headers: {
        'Authorization': \`Bearer \${accessToken}\`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      log.error(\`OAuth profile fetch failed: \${response.status} \${errorBody}\`);
      throw new Error(\`Failed to fetch user profile: \${response.status}\`);
    }

    const data = await response.json() as Record<string, unknown>;
    return this.normalizeProfile(data);
  }

  /**
   * Normalize a provider-specific user profile into the common format.
   * Each provider returns data in a different shape.
   */
  private normalizeProfile(data: Record<string, unknown>): OAuthUserProfile {
    switch (this.config.provider) {
      case 'google':
        return {
          id: String(data.id),
          email: String(data.email),
          name: String(data.name || data.email),
          avatar: data.picture as string | undefined,
          raw: data,
        };

      case 'github':
        return {
          id: String(data.id),
          email: String(data.email || ''),
          name: String(data.name || data.login || ''),
          avatar: data.avatar_url as string | undefined,
          raw: data,
        };

      case 'discord':
        return {
          id: String(data.id),
          email: String(data.email || ''),
          name: String(data.username || ''),
          avatar: data.avatar
            ? \`https://cdn.discordapp.com/avatars/\${data.id}/\${data.avatar}.png\`
            : undefined,
          raw: data,
        };

      case 'microsoft':
        return {
          id: String(data.id),
          email: String(data.mail || data.userPrincipalName || ''),
          name: String(data.displayName || ''),
          avatar: undefined, // Microsoft Graph requires a separate call for photos
          raw: data,
        };

      default:
        // Generic normalization for unknown providers
        return {
          id: String(data.id || data.sub || ''),
          email: String(data.email || ''),
          name: String(data.name || data.displayName || data.username || ''),
          avatar: (data.avatar || data.picture || data.avatar_url) as string | undefined,
          raw: data,
        };
    }
  }

  /**
   * Revoke an access or refresh token.
   * Not all providers support token revocation.
   */
  async revokeToken(token: string): Promise<boolean> {
    const revokeUrls: Record<string, string> = {
      google: 'https://oauth2.googleapis.com/revoke',
      github: \`https://api.github.com/applications/\${this.config.clientId}/token\`,
    };

    const revokeUrl = revokeUrls[this.config.provider];
    if (!revokeUrl) {
      log.warn(\`Token revocation not supported for provider: \${this.config.provider}\`);
      return false;
    }

    try {
      const response = await fetch(revokeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: \`token=\${encodeURIComponent(token)}\`,
      });

      return response.ok;
    } catch (error) {
      log.error(\`Token revocation failed for \${this.config.provider}:\`, error);
      return false;
    }
  }

  /**
   * Get the provider name.
   */
  getProvider(): string {
    return this.config.provider;
  }

  /**
   * Get the configured scopes.
   */
  getScopes(): string[] {
    return [...this.config.scopes];
  }
}` }
  ] },

  // --- Turn 31m: Agent confirms OAuth client compatibility ---
  { role: 'assistant', content: 'The OAuthClient interface is fully compatible with what `oauth.ts` expects:\n- `getAuthorizationUrl(state, nonce)` returns a URL string\n- `exchangeCode(code)` returns `OAuthTokenResponse` with `access_token`\n- `getUserProfile(accessToken)` returns `OAuthUserProfile` with `id`, `email`, `name`\n\nThe `normalizeProfile()` method handles provider-specific differences (Google uses `picture`, GitHub uses `avatar_url`, Discord constructs the avatar URL from the CDN, Microsoft does not include avatar). The oauth.ts module only uses `id`, `email`, and `name` from the profile, which are always present.\n\nI also notice the OAuthClient supports 4 providers out of the box: Google, GitHub, Discord, and Microsoft. The auth init only registers Google and GitHub from environment variables. Discord and Microsoft could be added later.\n\nNow let me also read the existing routes file to see how the old auth handlers were wired up, so we can verify backward compatibility.' },

  // --- Turn 31n: Agent reads the routes file ---
  { role: 'assistant', content: [
    { type: 'text', text: 'Reading the existing routes file to verify backward compatibility.' },
    { type: 'tool_use', name: 'Read', input: { path: '/src/routes/index.ts' } }
  ] },

  // --- Turn 31o: Routes file ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Read', text: `import { Router } from 'express';
import { createLogger } from '../lib/logger.js';
import {
  handleLogin,
  handleRegister,
  handleRefresh,
  handleLogout,
  handlePasswordReset,
  handleChangePassword,
  authMiddleware,
  rateLimitMiddleware,
} from '../auth/index.js';

const log = createLogger('Routes', 'server');

// ============================================================================
// Auth Routes
// ============================================================================

const authRouter = Router();

// Public auth endpoints
authRouter.post('/login', rateLimitMiddleware(10, 15 * 60 * 1000), handleLogin);
authRouter.post('/register', rateLimitMiddleware(5, 60 * 60 * 1000), handleRegister);
authRouter.post('/refresh', handleRefresh);
authRouter.post('/reset-password', rateLimitMiddleware(3, 15 * 60 * 1000), handlePasswordReset);

// Protected auth endpoints
authRouter.post('/logout', authMiddleware(), handleLogout);
authRouter.post('/change-password', authMiddleware(), handleChangePassword);

// ============================================================================
// User Routes
// ============================================================================

const userRouter = Router();

userRouter.get('/me', authMiddleware(), async (req, res) => {
  const userId = (req as any).user?.sub;
  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // Fetch user profile
  const { db } = await import('../db/connection.js');
  const user = await db.get(
    'SELECT id, email, display_name, role, created_at, last_login_at FROM users WHERE id = ?',
    [userId]
  );

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json(user);
});

userRouter.get('/sessions', authMiddleware(), async (req, res) => {
  const userId = (req as any).user?.sub;
  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { getActiveSessions } = await import('../auth/index.js');
  const sessions = await getActiveSessions(userId);

  // Don't expose tokens in the response
  const sanitized = sessions.map(s => ({
    id: s.id,
    createdAt: s.createdAt,
    lastActivityAt: s.lastActivityAt,
    ipAddress: s.ipAddress,
    userAgent: s.userAgent,
  }));

  res.json(sanitized);
});

userRouter.delete('/sessions/:sessionId', authMiddleware(), async (req, res) => {
  const userId = (req as any).user?.sub;
  const targetSessionId = req.params.sessionId;
  const currentSessionId = (req as any).sessionId;

  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // Prevent revoking own session via this endpoint (use /logout instead)
  if (targetSessionId === currentSessionId) {
    return res.status(400).json({ error: 'Use /auth/logout to revoke your current session' });
  }

  const { revokeSession, getSessionById } = await import('../auth/index.js');
  const session = await getSessionById(targetSessionId);

  if (!session || session.userId !== userId) {
    return res.status(404).json({ error: 'Session not found' });
  }

  await revokeSession(targetSessionId);
  res.json({ message: 'Session revoked' });
});

// ============================================================================
// Health Routes
// ============================================================================

const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

healthRouter.get('/health/detailed', async (_req, res) => {
  const { db } = await import('../db/connection.js');
  const dbHealthy = db.isHealthy ? db.isHealthy() : true;

  res.json({
    status: dbHealthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    database: {
      healthy: dbHealthy,
      fileSize: db.getFileSize ? db.getFileSize() : 'unknown',
      walSize: db.getWalSize ? db.getWalSize() : 'unknown',
    },
  });
});

// ============================================================================
// Admin Routes
// ============================================================================

const adminRouter = Router();

adminRouter.use(authMiddleware('admin'));

adminRouter.get('/users', async (_req, res) => {
  const { db } = await import('../db/connection.js');
  const users = await db.all(
    'SELECT id, email, display_name, role, created_at, last_login_at, failed_login_attempts, locked_until, email_verified FROM users ORDER BY created_at DESC'
  );
  res.json(users);
});

adminRouter.post('/users/:userId/unlock', async (req, res) => {
  const { db } = await import('../db/connection.js');
  const result = await db.run(
    'UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?',
    [req.params.userId]
  );

  if (result.changes === 0) {
    return res.status(404).json({ error: 'User not found' });
  }

  log.info(\`Admin unlocked user \${req.params.userId}\`);
  res.json({ message: 'User account unlocked' });
});

adminRouter.post('/users/:userId/role', async (req, res) => {
  const { role } = req.body;
  const validRoles = ['admin', 'user', 'moderator', 'readonly'];

  if (!role || !validRoles.includes(role)) {
    return res.status(400).json({
      error: \`Invalid role. Must be one of: \${validRoles.join(', ')}\`,
    });
  }

  const { db } = await import('../db/connection.js');
  const result = await db.run(
    'UPDATE users SET role = ?, updated_at = ? WHERE id = ?',
    [role, new Date().toISOString(), req.params.userId]
  );

  if (result.changes === 0) {
    return res.status(404).json({ error: 'User not found' });
  }

  log.info(\`Admin changed role for user \${req.params.userId} to \${role}\`);
  res.json({ message: 'Role updated' });
});

adminRouter.delete('/users/:userId/sessions', async (req, res) => {
  const { revokeAllUserSessions } = await import('../auth/index.js');
  const count = await revokeAllUserSessions(req.params.userId);
  log.info(\`Admin revoked \${count} sessions for user \${req.params.userId}\`);
  res.json({ message: \`Revoked \${count} sessions\`, count });
});

// ============================================================================
// Mount all routers
// ============================================================================

export function createRouter(): Router {
  const router = Router();

  router.use('/auth', authRouter);
  router.use('/user', userRouter);
  router.use('/', healthRouter);
  router.use('/admin', adminRouter);

  log.info('Routes initialized');
  return router;
}` }
  ] },

  // --- Turn 31o2: Agent also reads the server entry point ---
  { role: 'assistant', content: [
    { type: 'text', text: 'Let me also verify the server entry point to understand the full middleware chain and how auth is initialized.' },
    { type: 'tool_use', name: 'Read', input: { path: '/src/server.ts' } }
  ] },

  // --- Turn 31o3: Server source ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Read', text: `import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { createLogger } from './lib/logger.js';
import { EventBus } from './lib/event-bus.js';
import { createRouter } from './routes/index.js';
import { initializeAuth, shutdownAuth } from './auth/index.js';
import { closeDb, getDb } from './db/connection.js';
import { closeLogFile } from './lib/logger.js';

const log = createLogger('Server', 'server');

// ============================================================================
// Server Configuration
// ============================================================================

export interface ServerOptions {
  port?: number;
  host?: string;
  corsOrigins?: string[];
  trustProxy?: boolean;
}

const DEFAULT_OPTIONS: Required<ServerOptions> = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173').split(','),
  trustProxy: process.env.TRUST_PROXY === 'true',
};

// ============================================================================
// Request ID Middleware
// ============================================================================

/**
 * Adds a unique request ID to each incoming request.
 * The ID is set in the X-Request-ID response header and can be used
 * for correlating logs across the request lifecycle.
 */
function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = req.headers['x-request-id'] as string || crypto.randomUUID();
  res.setHeader('X-Request-ID', requestId);
  (req as any).requestId = requestId;
  next();
}

// ============================================================================
// Request Logging Middleware
// ============================================================================

/**
 * Logs incoming requests and their response times.
 * Uses the logger's debug level for non-error responses and warn for 4xx/5xx.
 */
function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();
  const requestId = (req as any).requestId || 'unknown';

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;
    const method = req.method;
    const path = req.path;
    const contentLength = res.getHeader('content-length') || 0;

    const message = \`\${method} \${path} \${statusCode} \${duration}ms \${contentLength}b [rid:\${requestId}]\`;

    if (statusCode >= 500) {
      log.error(message);
    } else if (statusCode >= 400) {
      log.warn(message);
    } else {
      log.debug(message);
    }
  });

  next();
}

// ============================================================================
// Error Handling Middleware
// ============================================================================

/**
 * Global error handler for unhandled errors in route handlers.
 * Returns a sanitized error response in production and a detailed
 * error response in development.
 */
function errorHandlerMiddleware(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const requestId = (req as any).requestId || 'unknown';
  log.error(\`Unhandled error [rid:\${requestId}]: \${err.message}\\n\${err.stack}\`);

  const isDev = process.env.NODE_ENV === 'development';

  res.status(500).json({
    error: isDev ? err.message : 'Internal server error',
    requestId,
    ...(isDev && { stack: err.stack }),
  });
}

// ============================================================================
// Server Factory
// ============================================================================

/**
 * Create and configure the Express server.
 *
 * Middleware stack (in order):
 * 1. Trust proxy (if enabled)
 * 2. CORS
 * 3. Helmet security headers
 * 4. Compression
 * 5. JSON body parser (limit: 10mb)
 * 6. Request ID
 * 7. Request logging
 * 8. Application routes
 * 9. 404 handler
 * 10. Global error handler
 *
 * @param options - Server configuration options
 * @returns The HTTP server instance
 */
export function createServer(options: ServerOptions = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const app = express();

  // Security and performance middleware
  if (config.trustProxy) {
    app.set('trust proxy', 1);
  }

  app.use(cors({
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    exposedHeaders: ['X-Request-ID', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  }));

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
    crossOriginEmbedderPolicy: false, // Allow embedding from other origins
  }));

  app.use(compression());
  app.use(express.json({ limit: '10mb' }));

  // Request lifecycle middleware
  app.use(requestIdMiddleware);
  app.use(requestLoggingMiddleware);

  // Initialize auth system (session cleanup, OAuth providers)
  initializeAuth();

  // Mount application routes
  const router = createRouter();
  app.use('/api', router);

  // Serve static frontend in production
  if (process.env.NODE_ENV === 'production') {
    const staticPath = new URL('../frontend/dist', import.meta.url).pathname;
    app.use(express.static(staticPath));
    app.get('*', (_req, res) => {
      res.sendFile('index.html', { root: staticPath });
    });
  }

  // 404 handler for unmatched API routes
  app.use('/api/*', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'Endpoint not found' });
  });

  // Global error handler
  app.use(errorHandlerMiddleware);

  // Start listening
  const server = app.listen(config.port, config.host, () => {
    log.info(\`Server started on \${config.host}:\${config.port} (env: \${process.env.NODE_ENV || 'development'})\`);
    EventBus.emit('system:startup', {
      version: process.env.npm_package_version || 'unknown',
      environment: process.env.NODE_ENV || 'development',
    });
  });

  // Graceful shutdown handler
  const shutdown = async (signal: string) => {
    log.info(\`Received \${signal}, starting graceful shutdown...\`);

    // Stop accepting new connections
    server.close(() => {
      log.info('HTTP server closed');
    });

    try {
      // Shutdown in order
      shutdownAuth();
      closeDb();
      closeLogFile();

      EventBus.emit('system:shutdown', { reason: signal });
      log.info('Graceful shutdown complete');
      process.exit(0);
    } catch (error) {
      log.error('Error during shutdown:', error);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Unhandled rejection and exception handlers
  process.on('unhandledRejection', (reason, promise) => {
    log.error('Unhandled Rejection at:', promise, 'reason:', reason);
  });

  process.on('uncaughtException', (error) => {
    log.error('Uncaught Exception:', error);
    shutdown('uncaughtException');
  });

  return server;
}

// ============================================================================
// Health monitoring
// ============================================================================

/**
 * Get server health status.
 * Used by the /health and /health/detailed endpoints.
 */
export function getServerHealth(): {
  status: 'ok' | 'degraded' | 'down';
  uptime: number;
  memory: NodeJS.MemoryUsage;
  database: { healthy: boolean; fileSize: number; walSize: number };
} {
  const db = getDb();
  const dbHealthy = db.isHealthy();

  return {
    status: dbHealthy ? 'ok' : 'degraded',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    database: {
      healthy: dbHealthy,
      fileSize: db.getFileSize(),
      walSize: db.getWalSize(),
    },
  };
}

// ============================================================================
// Main entry point
// ============================================================================

if (process.env.NODE_ENV !== 'test') {
  // Only start the server if not in test mode
  // (tests create their own server instances with random ports)
  const { db } = await import('./db/connection.js');
  log.info('Running database migrations...');
  const { applied, skipped } = await db.migrate('src/db/migrations');
  if (applied.length > 0) {
    log.info(\`Applied \${applied.length} migrations: \${applied.join(', ')}\`);
  }
  if (skipped.length > 0) {
    log.debug(\`Skipped \${skipped.length} already-applied migrations\`);
  }

  createServer();
}` }
  ] },

  // --- Turn 31o4: Agent confirms server compatibility ---
  { role: 'assistant', content: 'The server entry point confirms the full integration:\n\n1. It imports `initializeAuth` and `shutdownAuth` from `./auth/index.js`, which validates that our barrel exports are correct.\n2. `initializeAuth()` is called during server startup, before routes are mounted.\n3. `shutdownAuth()` is called during graceful shutdown, in the correct order (before database close).\n4. The middleware chain is: trust proxy, CORS, helmet, compression, JSON parser, request ID, request logging, routes, 404 handler, error handler.\n5. The CORS configuration exposes the rate limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`) which is needed for the frontend to show rate limit feedback.\n6. In production mode, the server serves the frontend static files with a catch-all route for SPA routing.\n\nEverything looks correct. The auth module is fully integrated into the server lifecycle.' },

  // --- Turn 31p: Agent identifies backward compatibility issue ---
  { role: 'assistant', content: 'I found a backward compatibility issue in the routes file. The user routes at lines 56-86 still use the old property names:\n\n```typescript\nconst userId = (req as any).user?.sub;  // OLD - should be req.authUser?.sub\nconst currentSessionId = (req as any).sessionId;  // OLD - should be req.authSessionId\n```\n\nThese need to be updated to match the new typed properties. There are 4 occurrences across the user routes and 1 in the session deletion route.\n\nAlso, the auth router already uses `rateLimitMiddleware(10, 15 * 60 * 1000)` for login, which matches the `loginRateLimitMiddleware` factory. We could replace it with the factory for consistency, but it is functionally equivalent.\n\nI will fix the property name references in the routes file.' },

  { role: 'assistant', content: [
    { type: 'text', text: 'Updating the routes file to use the new typed property names.' },
    { type: 'tool_use', name: 'Edit', input: {
      path: '/src/routes/index.ts',
      old_content: `const userId = (req as any).user?.sub;`,
      new_content: `const userId = req.authUser?.sub;`
    } }
  ] },

  // --- Turn 31q: Tool result ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Edit', text: 'File edited: /src/routes/index.ts (3 occurrences replaced)' }
  ] },

  { role: 'assistant', content: [
    { type: 'text', text: 'Now fixing the sessionId reference.' },
    { type: 'tool_use', name: 'Edit', input: {
      path: '/src/routes/index.ts',
      old_content: `const currentSessionId = (req as any).sessionId;`,
      new_content: `const currentSessionId = req.authSessionId;`
    } }
  ] },

  // --- Turn 31r: Tool result ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Edit', text: 'File edited: /src/routes/index.ts (1 occurrence replaced)' }
  ] },

  // --- Turn 31s: Agent reads test helpers to check bcrypt usage ---
  { role: 'assistant', content: [
    { type: 'text', text: 'The original file mentioned test helpers that already use bcrypt. Let me read them to make sure the test helpers are consistent with the new password module.' },
    { type: 'tool_use', name: 'Read', input: { path: '/src/utils/test-helpers.ts' } }
  ] },

  // --- Turn 31t: Test helpers source ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Read', text: `import crypto from 'crypto';
import { EventEmitter } from 'events';
import bcrypt from 'bcrypt';
import { createLogger } from '../lib/logger.js';

const log = createLogger('TestHelpers', 'server');

/**
 * Hash a password using bcrypt for test data seeding.
 * Uses a lower cost factor (10) than production (12) for faster tests.
 */
export async function hashTestPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

/**
 * Generate a random UUID for test entities.
 */
export function testUuid(): string {
  return crypto.randomUUID();
}

/**
 * Generate a random email for test users.
 */
export function testEmail(prefix: string = 'test'): string {
  const random = crypto.randomBytes(4).toString('hex');
  return \`\${prefix}-\${random}@example.com\`;
}

/**
 * Create a mock database object for unit testing.
 * Implements the same interface as DatabaseConnection but stores
 * everything in-memory using Maps.
 */
export function createMockDb() {
  const tables = new Map<string, Map<string, Record<string, unknown>>>();

  function getTable(name: string): Map<string, Record<string, unknown>> {
    if (!tables.has(name)) {
      tables.set(name, new Map());
    }
    return tables.get(name)!;
  }

  return {
    run: async (sql: string, params: unknown[] = []): Promise<{ changes: number; lastInsertRowid: number }> => {
      // Simple SQL parsing for common operations
      const insertMatch = sql.match(/INSERT INTO (\\w+)/i);
      if (insertMatch) {
        const table = getTable(insertMatch[1]);
        const id = params[0] as string || crypto.randomUUID();
        table.set(id, { id, ...Object.fromEntries(params.map((p, i) => [\`col_\${i}\`, p])) });
        return { changes: 1, lastInsertRowid: table.size };
      }

      const updateMatch = sql.match(/UPDATE (\\w+)/i);
      if (updateMatch) {
        return { changes: 1, lastInsertRowid: 0 };
      }

      const deleteMatch = sql.match(/DELETE FROM (\\w+)/i);
      if (deleteMatch) {
        return { changes: 1, lastInsertRowid: 0 };
      }

      return { changes: 0, lastInsertRowid: 0 };
    },

    get: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | undefined> => {
      return undefined;
    },

    all: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => {
      return [];
    },

    transaction: async <T>(fn: () => Promise<T>): Promise<T> => {
      return fn();
    },

    exec: (sql: string) => {},

    isHealthy: () => true,
    getFileSize: () => 0,
    getWalSize: () => 0,
    destroy: () => {},
  };
}

/**
 * Create a mock EventBus for testing.
 * Records all emitted events for assertion.
 */
export function createMockEventBus() {
  const emittedEvents: Array<{ event: string; payload: unknown }> = [];
  const emitter = new EventEmitter();

  return {
    emit: (event: string, payload: unknown) => {
      emittedEvents.push({ event, payload });
      emitter.emit(event, payload);
    },
    on: (event: string, handler: (...args: unknown[]) => void) => {
      emitter.on(event, handler);
    },
    off: (event: string, handler: (...args: unknown[]) => void) => {
      emitter.off(event, handler);
    },
    once: (event: string, handler: (...args: unknown[]) => void) => {
      emitter.once(event, handler);
    },
    removeAllListeners: (event?: string) => {
      if (event) emitter.removeAllListeners(event);
      else emitter.removeAllListeners();
    },
    listenerCount: (event: string) => emitter.listenerCount(event),

    // Test utilities
    getEmittedEvents: () => [...emittedEvents],
    getEventsOfType: (type: string) => emittedEvents.filter(e => e.event === type),
    clearEvents: () => { emittedEvents.length = 0; },
    wasEmitted: (type: string) => emittedEvents.some(e => e.event === type),
  };
}

/**
 * Create a mock request object for Express middleware testing.
 */
export function createMockRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    headers: {},
    body: {},
    params: {},
    query: {},
    ip: '127.0.0.1',
    method: 'GET',
    path: '/',
    get: (name: string) => {
      const headers = overrides.headers || {};
      return (headers as Record<string, string>)[name.toLowerCase()];
    },
    ...overrides,
  };
}

/**
 * Create a mock response object for Express middleware testing.
 * Captures the response status, headers, and body for assertions.
 */
export function createMockResponse() {
  const response: Record<string, unknown> = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: null as unknown,

    status(code: number) {
      response.statusCode = code;
      return response;
    },

    json(data: unknown) {
      response.body = data;
      return response;
    },

    send(data: unknown) {
      response.body = data;
      return response;
    },

    setHeader(name: string, value: string) {
      (response.headers as Record<string, string>)[name] = value;
      return response;
    },

    getHeader(name: string) {
      return (response.headers as Record<string, string>)[name];
    },

    end() {
      return response;
    },

    redirect(url: string) {
      response.statusCode = 302;
      (response.headers as Record<string, string>)['Location'] = url;
      return response;
    },
  };

  return response;
}

/**
 * Wait for a specified number of milliseconds.
 * Useful for testing async operations with timeouts.
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a test user object with optional overrides.
 */
export function createTestUser(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: testUuid(),
    email: testEmail(),
    passwordHash: '$2b$10$MockBcryptHashForTestingPurposesOnly000000000000000',
    salt: '',
    displayName: 'Test User',
    role: 'user',
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
    failedLoginAttempts: 0,
    lockedUntil: null,
    twoFactorEnabled: false,
    twoFactorSecret: null,
    emailVerified: true,
    emailVerificationToken: null,
    ...overrides,
  };
}

/**
 * Seed test data into a mock or real database.
 */
export async function seedTestData(db: ReturnType<typeof createMockDb>): Promise<{
  users: Record<string, unknown>[];
  sessions: Record<string, unknown>[];
}> {
  const adminUser = createTestUser({
    email: 'admin@example.com',
    displayName: 'Admin User',
    role: 'admin',
  });

  const regularUser = createTestUser({
    email: 'user@example.com',
    displayName: 'Regular User',
    role: 'user',
  });

  const lockedUser = createTestUser({
    email: 'locked@example.com',
    displayName: 'Locked User',
    failedLoginAttempts: 5,
    lockedUntil: new Date(Date.now() + 900000).toISOString(),
  });

  const unverifiedUser = createTestUser({
    email: 'unverified@example.com',
    displayName: 'Unverified User',
    emailVerified: false,
    emailVerificationToken: testUuid(),
  });

  return {
    users: [adminUser, regularUser, lockedUser, unverifiedUser],
    sessions: [],
  };
}` }
  ] },

  // --- Turn 31u: Agent notes the bcrypt cost difference ---
  { role: 'assistant', content: 'Important finding: the test helpers use bcrypt cost factor 10, while the production password module uses cost factor 12. This is intentional since the comment says "Uses a lower cost factor (10) than production (12) for faster tests." This is a good pattern since bcrypt is intentionally slow and using cost 12 in tests would slow down the test suite.\n\nThe `createMockDb` function already has a `transaction` method that simply calls the function directly without locking, which is fine for unit tests. The `createTestUser` helper generates users with bcrypt-format hashes (starting with `$2b$10$`), which is consistent with the new password module.\n\nLet me also verify the database schema to make sure the auth tables match what the code expects.' },

  // --- Turn 31v: Agent reads database migration ---
  { role: 'assistant', content: [
    { type: 'text', text: 'Reading the auth-related database migrations to verify the schema.' },
    { type: 'tool_use', name: 'Bash', input: { command: 'cat /src/db/migrations/001_initial.sql /src/db/migrations/005_sessions.sql /src/db/migrations/008_oauth.sql /src/db/migrations/012_password_resets.sql' } }
  ] },

  // --- Turn 31w: Migration SQL files ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Bash', text: `-- /src/db/migrations/001_initial.sql
-- Initial schema creation for the application database.
-- Creates the users table with all authentication-related fields.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL DEFAULT '',
  salt TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user', 'moderator', 'readonly')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  two_factor_enabled INTEGER NOT NULL DEFAULT 0,
  two_factor_secret TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  email_verification_token TEXT
);

-- Index for email lookups during login
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Index for email verification token lookups
CREATE INDEX IF NOT EXISTS idx_users_email_verification_token ON users(email_verification_token);

-- Index for role-based queries (admin panel)
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Index for locked accounts (cleanup queries)
CREATE INDEX IF NOT EXISTS idx_users_locked_until ON users(locked_until) WHERE locked_until IS NOT NULL;

-- Application settings table
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  description TEXT
);

-- Insert default settings
INSERT OR IGNORE INTO settings (key, value, description) VALUES
  ('app.name', 'Application', 'Application display name'),
  ('app.version', '1.0.0', 'Current application version'),
  ('auth.max_sessions_per_user', '10', 'Maximum active sessions per user'),
  ('auth.require_email_verification', 'true', 'Require email verification before login'),
  ('auth.allow_registration', 'true', 'Allow new user registration'),
  ('auth.password_min_length', '8', 'Minimum password length'),
  ('auth.lockout_attempts', '5', 'Failed attempts before account lockout'),
  ('auth.lockout_duration_minutes', '15', 'Account lockout duration in minutes'),
  ('auth.session_expiry_days', '7', 'Session expiry in days'),
  ('auth.remember_me_expiry_days', '30', 'Remember-me session expiry in days');

-- /src/db/migrations/005_sessions.sql
-- Add sessions table for token-based authentication.
-- Sessions support both access tokens (short-lived) and refresh tokens (long-lived).

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  token TEXT NOT NULL,
  refresh_token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  refresh_expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_activity_at TEXT NOT NULL DEFAULT (datetime('now')),
  ip_address TEXT NOT NULL DEFAULT '0.0.0.0',
  user_agent TEXT NOT NULL DEFAULT 'unknown',
  is_revoked INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Index for refresh token lookups (token refresh flow)
CREATE INDEX IF NOT EXISTS idx_sessions_refresh_token ON sessions(refresh_token) WHERE is_revoked = 0;

-- Index for user's active sessions (session management UI)
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id) WHERE is_revoked = 0;

-- Index for cleanup of expired/revoked sessions
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(refresh_expires_at);

-- Index for session lookups by ID (auth middleware)
CREATE INDEX IF NOT EXISTS idx_sessions_id_revoked ON sessions(id, is_revoked);

-- Trigger to enforce max sessions per user
CREATE TRIGGER IF NOT EXISTS enforce_max_sessions
AFTER INSERT ON sessions
BEGIN
  -- Delete oldest sessions beyond the limit (keep most recent N)
  DELETE FROM sessions
  WHERE user_id = NEW.user_id
    AND is_revoked = 0
    AND id NOT IN (
      SELECT id FROM sessions
      WHERE user_id = NEW.user_id AND is_revoked = 0
      ORDER BY created_at DESC
      LIMIT (SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'auth.max_sessions_per_user')
    );
END;

-- /src/db/migrations/008_oauth.sql
-- Add tables for OAuth provider integration.
-- Supports linking multiple OAuth accounts to a single user.

CREATE TABLE IF NOT EXISTS oauth_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(provider, provider_user_id)
);

-- Index for looking up user by OAuth provider account
CREATE INDEX IF NOT EXISTS idx_oauth_accounts_provider ON oauth_accounts(provider, provider_user_id);

-- Index for finding all OAuth accounts for a user
CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user_id ON oauth_accounts(user_id);

-- OAuth state table for CSRF protection during OAuth flows
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY NOT NULL,
  nonce TEXT NOT NULL,
  provider TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  -- Optional: store additional data needed after callback
  redirect_url TEXT,
  scopes TEXT
);

-- Index for cleanup of expired states
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states(expires_at);

-- Trigger to clean up expired OAuth states (older than 10 minutes)
CREATE TRIGGER IF NOT EXISTS cleanup_expired_oauth_states
AFTER INSERT ON oauth_states
BEGIN
  DELETE FROM oauth_states WHERE expires_at < datetime('now');
END;

-- /src/db/migrations/012_password_resets.sql
-- Add password_resets table for the password recovery flow.
-- Reset tokens are single-use and expire after 24 hours.

CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  used_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Index for token lookups during password reset
CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token);

-- Index for user-based lookups (to replace existing reset requests)
CREATE INDEX IF NOT EXISTS idx_password_resets_user_id ON password_resets(user_id);

-- Index for cleanup of expired tokens
CREATE INDEX IF NOT EXISTS idx_password_resets_expires ON password_resets(expires_at);

-- Trigger to ensure only one active reset per user
-- When a new reset is created, delete any existing unused resets for that user
CREATE TRIGGER IF NOT EXISTS single_active_reset
AFTER INSERT ON password_resets
BEGIN
  DELETE FROM password_resets
  WHERE user_id = NEW.user_id
    AND id != NEW.id
    AND used_at IS NULL;
END;

-- Trigger to clean up expired reset tokens
CREATE TRIGGER IF NOT EXISTS cleanup_expired_resets
AFTER INSERT ON password_resets
BEGIN
  DELETE FROM password_resets WHERE expires_at < datetime('now') AND used_at IS NULL;
END;` }
  ] },

  // --- Turn 31x: Agent also reads the package.json for dependency audit ---
  { role: 'assistant', content: [
    { type: 'text', text: 'Let me also check the package.json to verify all auth-related dependencies are present.' },
    { type: 'tool_use', name: 'Read', input: { path: '/src/package.json' } }
  ] },

  // --- Turn 31y: Package.json ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Read', text: `{
  "name": "project",
  "version": "1.0.0",
  "description": "Full-stack application with authentication, real-time features, and admin panel",
  "type": "module",
  "engines": {
    "node": ">=20.0.0"
  },
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "test": "vitest",
    "test:run": "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:integration": "vitest run tests/integration/",
    "lint": "eslint src/ tests/ --ext .ts,.tsx",
    "lint:fix": "eslint src/ tests/ --ext .ts,.tsx --fix",
    "typecheck": "tsc --noEmit",
    "db:migrate": "tsx src/db/migrate.ts",
    "db:seed": "tsx src/db/seed.ts",
    "db:reset": "rm -rf data/databases/*.db && npm run db:migrate && npm run db:seed",
    "clean": "rm -rf dist coverage data/databases/*.db data/logs/*.log"
  },
  "dependencies": {
    "@types/bcrypt": "^5.0.2",
    "@types/compression": "^1.7.5",
    "@types/cors": "^2.8.17",
    "@types/express": "^5.0.0",
    "@types/jsonwebtoken": "^9.0.7",
    "bcrypt": "^5.1.1",
    "better-sqlite3": "^11.6.0",
    "compression": "^1.8.0",
    "cors": "^2.8.5",
    "express": "^5.0.1",
    "helmet": "^8.0.0",
    "jsonwebtoken": "^9.0.2",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "@types/node": "^22.10.1",
    "@vitest/coverage-v8": "^2.1.8",
    "eslint": "^9.16.0",
    "eslint-config-prettier": "^9.1.0",
    "eslint-plugin-import": "^2.31.0",
    "prettier": "^3.4.2",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  },
  "prettier": {
    "singleQuote": true,
    "trailingComma": "all",
    "printWidth": 100,
    "tabWidth": 2,
    "semi": true
  }
}` }
  ] },

  // --- Turn 31z: Agent confirms dependencies ---
  { role: 'assistant', content: 'All auth-related dependencies are present:\n\n- `bcrypt` ^5.1.1 with `@types/bcrypt` ^5.0.2 (for password hashing)\n- `jsonwebtoken` ^9.0.2 with `@types/jsonwebtoken` ^9.0.7 (for JWT tokens)\n- `express` ^5.0.1 with `@types/express` ^5.0.0 (for middleware and route handlers)\n- `zod` ^3.24.1 (for input validation schemas)\n- `better-sqlite3` ^11.6.0 (for database operations including transactions)\n- `helmet` ^8.0.0 (for security headers)\n- `cors` ^2.8.5 (for CORS configuration, needed for rate limit header exposure)\n- `compression` ^1.8.0 (for response compression)\n\nNo missing dependencies. The project uses Node.js 20+ which is required for the `crypto.randomUUID()` calls used throughout the auth module.\n\nThe vitest ^2.1.8 dev dependency confirms the test runner version, which supports the `vi.mock()` module mocking pattern used in all the auth test files.' },

  // --- Turn 31z2: Agent confirms schema compatibility ---
  { role: 'assistant', content: 'The database schema matches perfectly with what the auth code expects:\n\n1. **users table**: All 15 columns match the User interface (id, email, password_hash, salt, display_name, role, created_at, updated_at, last_login_at, failed_login_attempts, locked_until, two_factor_enabled, two_factor_secret, email_verified, email_verification_token)\n\n2. **sessions table**: All 11 columns match the Session interface. The refresh_token has a UNIQUE constraint and a partial index on non-revoked sessions, which supports the race condition fix since the transaction lock prevents duplicate refresh tokens.\n\n3. **oauth_accounts table**: Supports the `UNIQUE(provider, provider_user_id)` constraint, which prevents linking the same OAuth account to multiple users.\n\n4. **oauth_states table**: Single-use state tokens with automatic cleanup of expired states via a trigger.\n\n5. **password_resets table**: Has a trigger ensuring only one active reset per user, which aligns with the `INSERT OR REPLACE` pattern in the `requestPasswordReset` function.\n\nThe `enforce_max_sessions` trigger limits active sessions per user to 10 by default (configurable via settings). This is a defense in depth against session accumulation that complements the periodic cleanup job.\n\nOne note: the column names use snake_case (e.g., `password_hash`, `display_name`) while the TypeScript interfaces use camelCase (e.g., `passwordHash`, `displayName`). The database layer handles this mapping. The SQL queries in the auth modules use the snake_case column names correctly.\n\nLet me also run the type checker to make sure there are no TypeScript errors in the new modules.' },

  // --- Turn 31z3: Agent runs typecheck ---
  { role: 'assistant', content: [
    { type: 'text', text: 'Running TypeScript type checking across the entire project.' },
    { type: 'tool_use', name: 'Bash', input: { command: 'cd /src && npx tsc --noEmit 2>&1' } }
  ] },

  // --- Turn 31z4: Typecheck output with some errors ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Bash', text: `src/auth/sessions.ts(7,10): error TS2305: Module '"./types.js"' has no exported member 'User'.
  The import of 'User' in sessions.ts is unused. The User type is only
  needed in the refreshSession function to type the db.get result, but
  TypeScript resolves the generic parameter from the SQL query context.

src/auth/middleware.ts(4,65): error TS2305: Module '"./types.js"' has no exported member 'Session'.
  The import of 'Session' in middleware.ts is unused. The middleware does
  not directly reference the Session type; it only checks session.isRevoked
  which is inferred from the getSessionById return type.

src/auth/handlers.ts(2,10): error TS6133: 'createLogger' is declared but its value is never read.
  The handlers module imports createLogger but never uses it. The log
  variable was planned for future error logging but is not yet used.

src/routes/index.ts(56,37): error TS2339: Property 'authUser' does not exist on type 'Request<ParamsDictionary, any, any, ParsedQs, Record<string, any>>'.
  The Express Request augmentation is declared in middleware.ts using
  'declare global { namespace Express { ... } }' but TypeScript cannot
  see this declaration from routes/index.ts because middleware.ts is not
  directly imported in the routes file.

src/routes/index.ts(70,37): error TS2339: Property 'authUser' does not exist on type 'Request<...>'.
  Same issue at a different location in routes/index.ts.

src/routes/index.ts(79,42): error TS2339: Property 'authSessionId' does not exist on type 'Request<...>'.
  Same issue for authSessionId.

src/routes/index.ts(83,42): error TS2339: Property 'authUser' does not exist on type 'Request<...>'.
  Same issue at another location.

Found 7 errors in 4 files.

Errors  Files
     1  src/auth/sessions.ts
     1  src/auth/middleware.ts
     1  src/auth/handlers.ts
     4  src/routes/index.ts` }
  ] },

  // --- Turn 31z5: Agent fixes the typecheck errors ---
  { role: 'assistant', content: 'There are 7 TypeScript errors in 4 files. Let me categorize and fix them:\n\n**Category 1: Unused imports (3 errors)**\n- `sessions.ts` line 7: Remove unused `User` import\n- `middleware.ts` line 4: Remove unused `Session` import\n- `handlers.ts` line 2: Remove unused `createLogger` import\n\n**Category 2: Missing type augmentation (4 errors)**\n- `routes/index.ts` lines 56, 70, 79, 83: The `authUser` and `authSessionId` properties are not visible because the `declare global` in `middleware.ts` is only picked up when `middleware.ts` is imported.\n\nThe fix for category 2: Move the Express Request augmentation from `middleware.ts` to `types.ts`. Since `types.ts` is a leaf node with no internal imports, and routes/index.ts imports from the auth barrel which re-exports types.ts, the augmentation will be visible everywhere the auth module is used.' },

  { role: 'assistant', content: [
    { type: 'text', text: 'Moving the Express Request augmentation from middleware.ts to types.ts.' },
    { type: 'tool_use', name: 'Edit', input: {
      path: '/src/auth/types.ts',
      old_content: `import { z } from 'zod';`,
      new_content: `import { z } from 'zod';\n\n// Express Request augmentation for auth context\n// Placed in types.ts so it is visible to all consumers of the auth module\ndeclare global {\n  namespace Express {\n    interface Request {\n      authUser?: import('./types.js').TokenPayload;\n      authSessionId?: string;\n    }\n  }\n}`
    } }
  ] },

  // --- Turn 31z6: Tool result ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Edit', text: 'File edited: /src/auth/types.ts' }
  ] },

  { role: 'assistant', content: [
    { type: 'text', text: 'Removing the declare global from middleware.ts and fixing the unused imports.' },
    { type: 'tool_use', name: 'Bash', input: { command: 'cd /src && npx tsc --noEmit 2>&1' } }
  ] },

  // --- Turn 31z7: Clean typecheck ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Bash', text: `No errors found.

Checked 47 source files in 2.3s.` }
  ] },

  // --- Turn 31z8: Agent reports clean typecheck ---
  { role: 'assistant', content: 'TypeScript type checking passes cleanly with 0 errors across 47 source files. The fixes applied:\n\n1. Moved the Express Request augmentation (`declare global { namespace Express { ... } }`) from `middleware.ts` to `types.ts`. This ensures the augmentation is visible wherever the auth barrel is imported, not just in files that directly import middleware.\n2. Removed unused `User` import from `sessions.ts`.\n3. Removed unused `Session` import from `middleware.ts`.\n4. Removed unused `createLogger` import from `handlers.ts`.\n\nNote: The `TokenPayload` type reference in the augmentation uses `import(\'./types.js\').TokenPayload` to avoid a circular reference, since the augmentation is in the same file that defines `TokenPayload`. This is a TypeScript pattern for self-referencing type imports in declaration merging.\n\nNow everything compiles cleanly. Let me run the tests.' },

  // --- Turn 32: User notes an issue ---
  { role: 'user', content: 'Wait, before running tests. I see you used `req.authUser` and `req.authSessionId` in the middleware. But the route handlers in handlers.ts were using `(req as any).user` and `(req as any).sessionId` in the original. Did you update the handlers to use the new property names?' },

  // --- Turn 33: Agent confirms ---
  { role: 'assistant', content: 'Yes, I updated the handlers to use the typed properties. In `handlers.ts`:\n\n- `handleLogout` uses `req.authSessionId` (line 97) instead of `(req as any).sessionId`\n- `handleChangePassword` uses `req.authUser?.sub` (line 165) instead of `(req as any).user.sub`\n\nThis is type-safe thanks to the `declare global` augmentation in `middleware.ts` that adds `authUser` and `authSessionId` to Express\'s Request interface. No more `as any` casts.\n\nThe `auth` prefix distinguishes these from any other middleware that might also add a `user` property to the request.' },

  // --- Turn 34: User asks to run tests ---
  { role: 'user', content: 'Good, that\'s cleaner. Now run the tests.' },

  // --- Turn 35: Agent runs tests ---
  { role: 'assistant', content: [
    { type: 'text', text: 'Running the full test suite.' },
    { type: 'tool_use', name: 'Bash', input: { command: 'cd /src && npm run test:run 2>&1' } }
  ] },

  // --- Turn 36: Test output (large, verbose) ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Bash', text: `> project@1.0.0 test:run
> vitest run --reporter=verbose

 RUN  v2.1.8 /src

 ✓ tests/utils/test-helpers.test.ts (4 tests) 12ms
   ✓ hashTestPassword > hashes password with bcrypt cost 10 (4ms)
   ✓ testUuid > generates valid UUID v4 (0ms)
   ✓ createMockDb > supports run/get/all operations (3ms)
   ✓ createMockEventBus > records emitted events (1ms)

 ✓ tests/db/connection.test.ts (8 tests) 45ms
   ✓ DatabaseConnection > opens database with WAL mode (10ms)
   ✓ DatabaseConnection > sets busy timeout from options (2ms)
   ✓ DatabaseConnection > run returns changes count (5ms)
   ✓ DatabaseConnection > get returns single row (4ms)
   ✓ DatabaseConnection > all returns array of rows (5ms)
   ✓ DatabaseConnection > transaction commits on success (7ms)
   ✓ DatabaseConnection > transaction rolls back on error (6ms)
   ✓ DatabaseConnection > isHealthy returns true for open db (1ms)

 ✓ tests/db/migrations.test.ts (3 tests) 120ms
   ✓ migrate > applies new migrations in order (50ms)
   ✓ migrate > skips already-applied migrations (40ms)
   ✓ migrate > rolls back failed migration (30ms)

 ✓ tests/lib/event-bus.test.ts (6 tests) 8ms
   ✓ TypedEventBus > emits events with correct payload (1ms)
   ✓ TypedEventBus > on registers persistent listener (1ms)
   ✓ TypedEventBus > once fires listener only once (1ms)
   ✓ TypedEventBus > off removes specific listener (1ms)
   ✓ TypedEventBus > removeAllListeners clears event (1ms)
   ✓ TypedEventBus > getStats returns listener counts (1ms)

 ✓ tests/lib/rate-limiter.test.ts (12 tests) 15ms
   ✓ RateLimiter > allows requests under limit (1ms)
   ✓ RateLimiter > blocks requests at limit (1ms)
   ✓ RateLimiter > returns correct remaining count (1ms)
   ✓ RateLimiter > different keys have independent limits (1ms)
   ✓ RateLimiter > sliding window expires old timestamps (2ms)
   ✓ RateLimiter > reset clears a single key (0ms)
   ✓ RateLimiter > resetAll clears all keys (0ms)
   ✓ RateLimiter > getCount returns without recording (1ms)
   ✓ RateLimiter > getTrackedKeyCount reflects unique keys (1ms)
   ✓ RateLimiter > cleanup removes stale entries (2ms)
   ✓ RateLimiter > destroy stops cleanup timer (1ms)
   ✓ RateLimiter > factory functions create correct limits (1ms)

 ✓ tests/lib/logger.test.ts (5 tests) 10ms
   ✓ createLogger > creates logger with context name (2ms)
   ✓ createLogger > respects LOG_LEVEL filtering (2ms)
   ✓ createLogger > formats output with timestamp and context (2ms)
   ✓ createLogger > writes to log file at debug level (3ms)
   ✓ createLogger > rotates log file at 5MB (1ms)
 ✗ tests/auth/password.test.ts (7 tests | 2 failed) 890ms
   ✓ hashPassword > generates a bcrypt hash (38ms)
   ✓ hashPassword > generates different hashes for same password (35ms)
   ✓ verifyPassword > verifies correct password (30ms)
   ✓ verifyPassword > rejects incorrect password (27ms)
   ✓ isLegacyMd5Hash > detects MD5 hashes (0ms)
   ✗ migratePasswordHash > migrates valid MD5 hash to bcrypt
     → Error: Cannot find module '../lib/logger.js'
       Require stack:
       - /src/auth/password.ts:3:1
       - /src/tests/auth/password.test.ts:8:1
       The password.ts module imports createLogger from ../lib/logger.js
       but the test does not mock this dependency. The mock for bcrypt
       is set up correctly but the logger import fails before the
       migratePasswordHash function can execute.

       Call stack:
         at Module._resolveFilename (node:internal/modules/cjs/loader:1145:15)
         at Module._load (node:internal/modules/cjs/loader:986:27)
         at Module.require (node:internal/modules/cjs/loader:1233:19)
         at require (node:internal/modules/helpers:179:18)
         at Object.<anonymous> (/src/auth/password.ts:3:1)
   ✗ needsRehash > detects old cost factor
     → Error: Cannot find module '../lib/logger.js'
       Same root cause as migratePasswordHash test above.
       The logger module is imported at the top of password.ts and
       the test file does not provide a vi.mock for this import.

 ✗ tests/auth/login.test.ts (15 tests | 15 failed) 2ms
   ✗ login > succeeds with valid credentials
     → Error: Cannot find module './password.js'
   ✗ login > rejects invalid password
     → Error: Cannot find module './password.js'
   ✗ login > rejects non-existent email
     → Error: Cannot find module './password.js'
   ✗ login > rejects locked account
     → Error: Cannot find module './password.js'
   ✗ login > migrates MD5 hash to bcrypt on successful login
     → Error: Cannot find module './password.js'
   ✗ login > increments failed attempts on bad password
     → Error: Cannot find module './password.js'
   ✗ login > resets failed attempts on success
     → Error: Cannot find module './password.js'
   ✗ register > creates a new user
     → Error: Cannot find module './password.js'
   ✗ register > rejects duplicate email
     → Error: Cannot find module './password.js'
   ✗ register > uses bcrypt for password hash
     → Error: Cannot find module './password.js'
   ✗ verifyEmail > returns true for valid token
     → Error: Cannot find module './password.js'
   ✗ requestPasswordReset > returns token for existing user
     → Error: Cannot find module './password.js'
   ✗ requestPasswordReset > returns null for non-existent email
     → Error: Cannot find module './password.js'
   ✗ resetPassword > resets password with valid token
     → Error: Cannot find module './password.js'
   ✗ resetPassword > rejects invalid token
     → Error: Cannot find module './password.js'
   All 15 tests fail with the same root cause: login.ts imports
   from ./password.js but the password.ts file was not yet written
   to disk when the test runner started. Vitest resolves the real
   module path before applying vi.mock() overrides.
     Require stack:
     - /src/auth/login.ts:10:1
     - /src/tests/auth/login.test.ts:8:1

 ✗ tests/auth/sessions.test.ts (12 tests | 4 failed) 340ms
   ✓ createSession > creates a session with correct fields (5ms)
   ✓ createSession > sets extended expiry for rememberMe (4ms)
   ✓ revokeSession > marks session as revoked (3ms)
   ✓ revokeAllUserSessions > revokes all active sessions (5ms)
   ✓ getActiveSessions > returns only non-revoked sessions (4ms)
   ✓ cleanupExpiredSessions > deletes expired sessions (3ms)
   ✓ startSessionCleanup > starts cleanup interval (1ms)
   ✓ stopSessionCleanup > stops cleanup interval (1ms)
   ✗ refreshSession > refreshes tokens atomically
     → AssertionError: expected null to not be null

     The refreshSession function now calls db.transaction() to wrap
     the SELECT and UPDATE in an atomic transaction, but the mock
     database object does not define a transaction() method.

     When refreshSession calls db.transaction(async () => { ... }),
     the function throws TypeError because transaction is undefined.
     The inner callback never executes, so the function returns null.

     Fix: Add a transaction() mock that simply executes the callback:
       transaction: vi.fn(async (fn) => fn())

     - Expected: { accessToken: ..., refreshToken: ..., session: ... }
     + Received: null

   ✗ refreshSession > rejects expired refresh token
     → TypeError: db.transaction is not a function
       at refreshSession (/src/auth/sessions.ts:84:15)
       at Object.<anonymous> (/src/tests/auth/sessions.test.ts:138:28)
   ✗ refreshSession > rejects revoked session token
     → TypeError: db.transaction is not a function
       at refreshSession (/src/auth/sessions.ts:84:15)
       at Object.<anonymous> (/src/tests/auth/sessions.test.ts:147:28)
   ✗ refreshSession > returns null for unknown token
     → TypeError: db.transaction is not a function
       at refreshSession (/src/auth/sessions.ts:84:15)
       at Object.<anonymous> (/src/tests/auth/sessions.test.ts:153:28)

 ✗ tests/auth/middleware.test.ts (9 tests | 3 failed) 55ms
   ✓ authMiddleware > returns 401 for missing header (1ms)
   ✓ authMiddleware > returns 401 for invalid token (1ms)
   ✓ authMiddleware > returns 403 for insufficient role (2ms)
   ✓ rateLimitMiddleware > allows requests under limit (1ms)
   ✓ rateLimitMiddleware > blocks requests over limit (2ms)
   ✓ rateLimitMiddleware > sets rate limit headers (1ms)
   ✗ authMiddleware > attaches authUser to request
     → AssertionError: expected undefined to be defined

     The test asserts (req as any).user is defined, but the
     middleware now sets req.authUser instead of req.user.
     The property name was changed to avoid conflicts with
     other middleware that might also set req.user.

     - Expected: req.user to be defined
     + Actual: req.user is undefined, req.authUser is defined

     Fix: Change assertion from req.user to req.authUser

   ✗ authMiddleware > updates session activity
     → AssertionError: expected mock to have been called

     The mock for sessions.js was set up to export touchSession,
     but the middleware also calls getSessionById before calling
     touchSession. Since getSessionById was not in the original
     mock return value, it returned undefined, causing the
     middleware to return 401 before reaching the touchSession call.

     Fix: Ensure getSessionById is mocked to return a valid session

   ✗ authMiddleware > calls touchSession fire-and-forget
     → TypeError: touchSession is not a function

     Same root cause as above: the sessions mock does not export
     touchSession correctly because of the import path mismatch.
     The test imports from '../../auth/sessions.js' but the mock
     path resolution differs in the test environment.

     Fix: Verify mock path matches the import path in middleware.ts

 ✓ tests/auth/tokens.test.ts (8 tests) 25ms
   ✓ generateAccessToken > creates valid JWT (3ms)
   ✓ generateAccessToken > includes correct payload fields (2ms)
   ✓ generateRefreshToken > generates 128-char hex string (1ms)
   ✓ verifyAccessToken > returns payload for valid token (2ms)
   ✓ verifyAccessToken > returns null for expired token (9ms)
   ✓ verifyAccessToken > returns null for invalid token (1ms)
   ✓ decodeTokenUnsafe > decodes without verification (1ms)
   ✓ generateVerificationToken > returns UUID (0ms)

 ✓ tests/auth/handlers.test.ts (10 tests) 180ms
   ✓ handleLogin > returns user and tokens on success (25ms)
   ✓ handleLogin > returns 400 for invalid input (1ms)
   ✓ handleLogin > returns 401 for invalid credentials (20ms)
   ✓ handleLogin > returns 423 for locked account (1ms)
   ✓ handleRegister > returns 201 on success (18ms)
   ✓ handleRegister > returns 409 for duplicate email (15ms)
   ✓ handleRefresh > returns new tokens on success (20ms)
   ✓ handleRefresh > returns 401 for invalid refresh token (1ms)
   ✓ handleLogout > revokes session (10ms)
   ✓ handleChangePassword > changes password on success (16ms)

 ✗ tests/auth/oauth.test.ts (6 tests | 1 failed) 45ms
   ✓ registerOAuthProvider > stores provider (1ms)
   ✓ getRegisteredProviders > lists providers (0ms)
   ✓ initiateOAuthFlow > generates authorization URL (6ms)
   ✓ handleOAuthCallback > creates session for new user (14ms)
   ✓ handleOAuthCallback > links to existing user by email (10ms)
   ✗ handleOAuthCallback > rejects expired state
     → AssertionError: expected { error: 'Invalid or expired OAuth state' }
       to deep equal { error: 'OAuth state expired' }

       The error message text was changed during the refactor.
       The original auth/index.ts returned 'OAuth state expired'
       but the new oauth.ts returns 'Invalid or expired OAuth state'
       which is a more descriptive message covering both cases
       (invalid state and expired state).

       Fix: Update the test assertion to match the new message text

 ✗ tests/auth/init.test.ts (3 tests | 1 failed) 8ms
   ✓ initializeAuth > starts session cleanup (2ms)
   ✓ initializeAuth > registers OAuth providers from env (3ms)
   ✗ shutdownAuth > stops session cleanup
     → Error: shutdownAuth is not exported from '../auth/index.js'

     The test uses a dynamic import to get shutdownAuth:
       const { shutdownAuth } = await import('../../auth/index.js');
     But Vitest's module mock system does not properly resolve
     dynamic imports when the module has already been statically
     imported and mocked. The barrel file does export shutdownAuth
     but the dynamic import creates a new module instance that
     does not pick up the mocks.

     Fix: Add shutdownAuth to the static import at line 2

 ✓ tests/routes/health.test.ts (2 tests) 5ms
   ✓ health > returns ok status (2ms)
   ✓ health/detailed > includes memory and db info (3ms)

 ✓ tests/routes/users.test.ts (8 tests) 95ms
   ✓ GET /user/me > returns current user profile (14ms)
   ✓ GET /user/me > returns 401 without auth (1ms)
   ✓ GET /user/sessions > lists active sessions (18ms)
   ✓ GET /user/sessions > sanitizes token fields (10ms)
   ✓ DELETE /user/sessions/:id > revokes other session (14ms)
   ✓ DELETE /user/sessions/:id > prevents revoking own session (2ms)
   ✓ DELETE /user/sessions/:id > returns 404 for unknown session (2ms)
   ✓ DELETE /user/sessions/:id > returns 404 for other user session (2ms)

 Test Files  6 failed | 8 passed | 14 total
 Tests       26 failed | 72 passed | 98 total
 Duration    1.92s

 FAIL  Tests failed. Check the output above for details.` }
  ] },

  // --- Turn 37: Agent analyzes failures ---
  { role: 'assistant', content: 'There are 26 test failures across 6 test files. Let me categorize them:\n\n**Category 1: Module resolution (16 failures)**\n- `tests/auth/password.test.ts` (2 failures): The `password.ts` module imports from `../lib/logger.js` but the test environment resolves paths differently. The test mocks need updating.\n- `tests/auth/login.test.ts` (15 failures): Cannot find `./password.js` because the test setup needs to mock the new module structure.\n\n**Category 2: Missing db.transaction() (4 failures)**\n- `tests/auth/sessions.test.ts` (4 failures): The test uses an in-memory DB mock that does not have a `transaction()` method. I need to add a `transaction` method to the test DB mock.\n\n**Category 3: Property name changes (3 failures)**\n- `tests/auth/middleware.test.ts` (3 failures): Tests check for `req.user` instead of `req.authUser`, and do not mock `getSessionById` and `touchSession` correctly.\n\n**Category 4: Error message changes (1 failure)**\n- `tests/auth/oauth.test.ts` (1 failure): Expected `\'OAuth state expired\'` but got `\'Invalid or expired OAuth state\'`.\n\n**Category 5: Missing export (1 failure)**\n- `tests/auth/init.test.ts` (1 failure): `shutdownAuth` is not re-exported from the barrel. I need to check the barrel.\n\nLet me fix these one group at a time. Let me start by reading the test files.' },

  // --- Turn 38: Agent reads session tests ---
  { role: 'assistant', content: [
    { type: 'text', text: 'Let me read the session test file to understand the mock DB setup.' },
    { type: 'tool_use', name: 'Read', input: { path: '/src/tests/auth/sessions.test.ts' } }
  ] },

  // --- Turn 39: Sessions test file ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Read', text: `import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createSession,
  refreshSession,
  revokeSession,
  revokeAllUserSessions,
  getActiveSessions,
  cleanupExpiredSessions,
  startSessionCleanup,
  stopSessionCleanup,
} from '../../auth/sessions.js';

// Mock the database
vi.mock('../../db/connection.js', () => {
  const sessions = new Map<string, any>();
  const users = new Map<string, any>();

  // Seed a test user
  users.set('user-1', {
    id: 'user-1',
    email: 'test@example.com',
    passwordHash: '$2b$12$abcdefghijklmnopqrstuuFakeHashForTesting123456789012345',
    salt: '',
    displayName: 'Test User',
    role: 'user',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    lastLoginAt: null,
    failedLoginAttempts: 0,
    lockedUntil: null,
    twoFactorEnabled: false,
    twoFactorSecret: null,
    emailVerified: true,
    emailVerificationToken: null,
  });

  return {
    db: {
      run: vi.fn(async (sql: string, params: any[]) => {
        if (sql.includes('INSERT INTO sessions')) {
          const session = {
            id: params[0],
            userId: params[1],
            token: params[2],
            refreshToken: params[3],
            expiresAt: params[4],
            refreshExpiresAt: params[5],
            createdAt: params[6],
            lastActivityAt: params[7],
            ipAddress: params[8],
            userAgent: params[9],
            isRevoked: false,
          };
          sessions.set(session.id, session);
          return { changes: 1 };
        }
        if (sql.includes('UPDATE sessions SET is_revoked')) {
          for (const [key, session] of sessions) {
            if (sql.includes('WHERE id = ?') && session.id === params[params.length - 1]) {
              session.isRevoked = true;
            } else if (sql.includes('WHERE user_id = ?') && session.userId === params[0]) {
              session.isRevoked = true;
            }
          }
          return { changes: 1 };
        }
        if (sql.includes('UPDATE sessions SET refresh_token')) {
          const session = [...sessions.values()].find(s => s.id === params[2]);
          if (session) {
            session.refreshToken = params[0];
            session.lastActivityAt = params[1];
          }
          return { changes: 1 };
        }
        if (sql.includes('DELETE FROM sessions')) {
          let count = 0;
          for (const [key, session] of sessions) {
            if (session.isRevoked || new Date(session.refreshExpiresAt) < new Date()) {
              sessions.delete(key);
              count++;
            }
          }
          return { changes: count };
        }
        return { changes: 0 };
      }),
      get: vi.fn(async (sql: string, params: any[]) => {
        if (sql.includes('FROM sessions WHERE refresh_token')) {
          return [...sessions.values()].find(s => s.refreshToken === params[0] && !s.isRevoked) || null;
        }
        if (sql.includes('FROM sessions WHERE id')) {
          return sessions.get(params[0]) || null;
        }
        if (sql.includes('FROM users WHERE id')) {
          return users.get(params[0]) || null;
        }
        return null;
      }),
      all: vi.fn(async (sql: string, params: any[]) => {
        if (sql.includes('FROM sessions WHERE user_id')) {
          return [...sessions.values()].filter(s =>
            s.userId === params[0] && !s.isRevoked
          );
        }
        return [];
      }),
    },
  };
});

// Mock EventBus
vi.mock('../../lib/event-bus.js', () => ({
  EventBus: { emit: vi.fn() },
}));

// Mock logger
vi.mock('../../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock tokens
vi.mock('../../auth/tokens.js', () => ({
  generateAccessToken: vi.fn(() => 'mock-access-token'),
  generateRefreshToken: vi.fn(() => 'mock-refresh-token-' + Math.random().toString(36).slice(2)),
}));

describe('sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createSession', () => {
    it('creates a session with correct fields', async () => {
      const session = await createSession('user-1', '192.168.1.1', 'TestAgent/1.0');
      expect(session).toBeDefined();
      expect(session.userId).toBe('user-1');
      expect(session.ipAddress).toBe('192.168.1.1');
      expect(session.userAgent).toBe('TestAgent/1.0');
      expect(session.isRevoked).toBe(false);
    });

    it('sets extended expiry for rememberMe', async () => {
      const session = await createSession('user-1', '192.168.1.1', 'TestAgent/1.0', true);
      const refreshExpiry = new Date(session.refreshExpiresAt);
      const now = new Date();
      const diffDays = (refreshExpiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThan(25); // ~30 days for rememberMe
    });
  });

  describe('refreshSession', () => {
    it('refreshes tokens atomically', async () => {
      const session = await createSession('user-1', '192.168.1.1', 'TestAgent/1.0');
      const result = await refreshSession(session.refreshToken);
      expect(result).not.toBeNull();
      expect(result!.accessToken).toBeDefined();
      expect(result!.refreshToken).not.toBe(session.refreshToken);
    });

    it('rejects expired refresh token', async () => {
      // This test creates a session with expired refreshExpiresAt
      const session = await createSession('user-1', '192.168.1.1', 'TestAgent/1.0');
      // Manually expire the session in the mock
      // (would need mock update to simulate expired token)
      // For now, testing with unknown token
      const result = await refreshSession('nonexistent-token');
      expect(result).toBeNull();
    });

    it('rejects revoked session token', async () => {
      const session = await createSession('user-1', '192.168.1.1', 'TestAgent/1.0');
      await revokeSession(session.id);
      const result = await refreshSession(session.refreshToken);
      expect(result).toBeNull();
    });

    it('returns null for unknown token', async () => {
      const result = await refreshSession('completely-unknown-token');
      expect(result).toBeNull();
    });
  });

  describe('revokeSession', () => {
    it('marks session as revoked', async () => {
      const session = await createSession('user-1', '192.168.1.1', 'TestAgent/1.0');
      await revokeSession(session.id);
      // The session should now be revoked
    });
  });

  describe('revokeAllUserSessions', () => {
    it('revokes all active sessions', async () => {
      await createSession('user-1', '192.168.1.1', 'TestAgent/1.0');
      await createSession('user-1', '192.168.1.2', 'TestAgent/2.0');
      const count = await revokeAllUserSessions('user-1');
      expect(count).toBeGreaterThan(0);
    });
  });

  describe('getActiveSessions', () => {
    it('returns only non-revoked sessions', async () => {
      await createSession('user-1', '192.168.1.1', 'TestAgent/1.0');
      const session2 = await createSession('user-1', '192.168.1.2', 'TestAgent/2.0');
      await revokeSession(session2.id);

      const active = await getActiveSessions('user-1');
      expect(active.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('cleanupExpiredSessions', () => {
    it('deletes expired sessions', async () => {
      const count = await cleanupExpiredSessions();
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  describe('startSessionCleanup', () => {
    it('starts cleanup interval', () => {
      const spy = vi.spyOn(global, 'setInterval');
      startSessionCleanup();
      expect(spy).toHaveBeenCalled();
      stopSessionCleanup(); // cleanup
    });
  });

  describe('stopSessionCleanup', () => {
    it('stops cleanup interval', () => {
      const spy = vi.spyOn(global, 'clearInterval');
      startSessionCleanup();
      stopSessionCleanup();
      expect(spy).toHaveBeenCalled();
    });
  });
});` }
  ] },

  // --- Turn 40: Agent fixes the session tests ---
  { role: 'assistant', content: 'I see the problem. The mock DB does not have a `transaction` method. The `refreshSession` function now calls `db.transaction()` for the race condition fix. I need to add a `transaction` method to the mock.\n\nHere is the fix for the mock DB:' },

  { role: 'assistant', content: [
    { type: 'text', text: 'Adding the transaction method to the mock DB and fixing the other test issues.' },
    { type: 'tool_use', name: 'Edit', input: {
      path: '/src/tests/auth/sessions.test.ts',
      old_content: `    },
  };
});`,
      new_content: `      // Transaction support for refreshSession race condition fix
      transaction: vi.fn(async (fn: () => Promise<any>) => {
        // In-memory mock: just execute the function directly
        // (no actual locking needed in tests)
        return fn();
      }),
    },
  };
});`
    } }
  ] },

  // --- Turn 41: Tool result ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Edit', text: 'File edited: /src/tests/auth/sessions.test.ts' }
  ] },

  // --- Turn 42: Agent reads middleware tests ---
  { role: 'assistant', content: [
    { type: 'text', text: 'Now let me read and fix the middleware tests for the property name changes.' },
    { type: 'tool_use', name: 'Read', input: { path: '/src/tests/auth/middleware.test.ts' } }
  ] },

  // --- Turn 43: Middleware test file ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Read', text: `import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { authMiddleware, rateLimitMiddleware } from '../../auth/middleware.js';

// Mock tokens
vi.mock('../../auth/tokens.js', () => ({
  verifyAccessToken: vi.fn((token: string) => {
    if (token === 'valid-token') {
      return { sub: 'user-1', email: 'test@example.com', role: 'user', sessionId: 'session-1' };
    }
    if (token === 'admin-token') {
      return { sub: 'admin-1', email: 'admin@example.com', role: 'admin', sessionId: 'session-2' };
    }
    return null;
  }),
}));

// Mock sessions
vi.mock('../../auth/sessions.js', () => ({
  getSessionById: vi.fn(async (id: string) => {
    if (id === 'session-1' || id === 'session-2') {
      return { id, isRevoked: false };
    }
    return null;
  }),
  touchSession: vi.fn(async () => {}),
}));

// Mock logger
vi.mock('../../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    ip: '127.0.0.1',
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response & { statusCode: number; body: any } {
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: any) {
      res.body = data;
      return res;
    },
    setHeader: vi.fn(),
  };
  return res;
}

describe('authMiddleware', () => {
  it('returns 401 for missing header', async () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    await authMiddleware()(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for invalid token', async () => {
    const req = mockReq({ headers: { authorization: 'Bearer bad-token' } });
    const res = mockRes();
    const next = vi.fn();

    await authMiddleware()(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 for insufficient role', async () => {
    const req = mockReq({ headers: { authorization: 'Bearer valid-token' } });
    const res = mockRes();
    const next = vi.fn();

    await authMiddleware('admin')(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('attaches authUser to request', async () => {
    const req = mockReq({ headers: { authorization: 'Bearer valid-token' } });
    const res = mockRes();
    const next = vi.fn();

    await authMiddleware()(req, res, next);
    expect(next).toHaveBeenCalled();
    expect((req as any).user).toBeDefined();
    expect((req as any).user.sub).toBe('user-1');
  });

  it('updates session activity', async () => {
    const { touchSession } = await import('../../auth/sessions.js');
    const req = mockReq({ headers: { authorization: 'Bearer valid-token' } });
    const res = mockRes();
    const next = vi.fn();

    await authMiddleware()(req, res, next);
    expect(touchSession).toHaveBeenCalledWith('session-1');
  });

  it('calls touchSession fire-and-forget', async () => {
    const { touchSession } = await import('../../auth/sessions.js');
    const req = mockReq({ headers: { authorization: 'Bearer valid-token' } });
    const res = mockRes();
    const next = vi.fn();

    await authMiddleware()(req, res, next);
    // touchSession should have been called but not awaited
    expect(touchSession).toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('allows admin to access any role', async () => {
    const req = mockReq({ headers: { authorization: 'Bearer admin-token' } });
    const res = mockRes();
    const next = vi.fn();

    await authMiddleware('moderator')(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects revoked session', async () => {
    const { getSessionById } = await import('../../auth/sessions.js');
    (getSessionById as any).mockResolvedValueOnce({ id: 'session-1', isRevoked: true });

    const req = mockReq({ headers: { authorization: 'Bearer valid-token' } });
    const res = mockRes();
    const next = vi.fn();

    await authMiddleware()(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('rateLimitMiddleware', () => {
  it('allows requests under limit', () => {
    const middleware = rateLimitMiddleware(5, 60000);
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('blocks requests over limit', () => {
    const middleware = rateLimitMiddleware(2, 60000);

    for (let i = 0; i < 3; i++) {
      const req = mockReq();
      const res = mockRes();
      const next = vi.fn();
      middleware(req, res, next);
      if (i < 2) {
        expect(next).toHaveBeenCalled();
      } else {
        expect(res.statusCode).toBe(429);
      }
    }
  });

  it('sets rate limit headers', () => {
    const middleware = rateLimitMiddleware(100, 60000);
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    middleware(req, res, next);
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 100);
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', expect.any(Number));
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Reset', expect.any(Number));
  });
});` }
  ] },

  // --- Turn 44: Agent fixes the middleware test ---
  { role: 'assistant', content: 'The middleware test on line 101 checks for `(req as any).user` but the middleware now sets `req.authUser`. Let me fix that.' },

  { role: 'assistant', content: [
    { type: 'text', text: 'Fixing the property name assertion in the middleware test.' },
    { type: 'tool_use', name: 'Edit', input: {
      path: '/src/tests/auth/middleware.test.ts',
      old_content: `    expect((req as any).user).toBeDefined();
    expect((req as any).user.sub).toBe('user-1');`,
      new_content: `    expect((req as any).authUser).toBeDefined();
    expect((req as any).authUser.sub).toBe('user-1');`
    } }
  ] },

  // --- Turn 45: Tool result ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Edit', text: 'File edited: /src/tests/auth/middleware.test.ts' }
  ] },

  // --- Turn 46: Agent reads the password test to fix import issues ---
  { role: 'assistant', content: [
    { type: 'text', text: 'Now let me read the password test to fix the logger import issue.' },
    { type: 'tool_use', name: 'Read', input: { path: '/src/tests/auth/password.test.ts' } }
  ] },

  // --- Turn 47: Password test file ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Read', text: `import { describe, it, expect, vi } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  isLegacyMd5Hash,
  verifyLegacyPassword,
  needsRehash,
  migratePasswordHash,
} from '../../auth/password.js';

// Mock bcrypt to avoid slow hashing in tests
vi.mock('bcrypt', () => ({
  default: {
    hash: vi.fn(async (password: string, cost: number) => {
      return \`$2b$\${String(cost).padStart(2, '0')}$MockBcryptHash_\${password.slice(0, 10)}\`;
    }),
    compare: vi.fn(async (password: string, hash: string) => {
      // Simple mock: check if the hash contains the password prefix
      return hash.includes(password.slice(0, 10));
    }),
  },
}));

describe('password', () => {
  describe('hashPassword', () => {
    it('generates a bcrypt hash', async () => {
      const hash = await hashPassword('MySecureP@ss1');
      expect(hash).toMatch(/^\\$2b\\$12\\$/);
    });

    it('generates different hashes for same password', async () => {
      const hash1 = await hashPassword('MySecureP@ss1');
      const hash2 = await hashPassword('MySecureP@ss1');
      // With the mock they'll be identical, but in production bcrypt
      // generates different salts each time
      expect(hash1).toBeDefined();
      expect(hash2).toBeDefined();
    });
  });

  describe('verifyPassword', () => {
    it('verifies correct password', async () => {
      const hash = await hashPassword('MySecureP@ss1');
      const valid = await verifyPassword('MySecureP@ss1', hash);
      expect(valid).toBe(true);
    });

    it('rejects incorrect password', async () => {
      const hash = await hashPassword('MySecureP@ss1');
      const valid = await verifyPassword('WrongPassword!1', hash);
      expect(valid).toBe(false);
    });
  });

  describe('isLegacyMd5Hash', () => {
    it('detects MD5 hashes', () => {
      expect(isLegacyMd5Hash('5d41402abc4b2a76b9719d911017c592')).toBe(true);
      expect(isLegacyMd5Hash('$2b$12$something')).toBe(false);
      expect(isLegacyMd5Hash('short')).toBe(false);
    });
  });

  describe('migratePasswordHash', () => {
    it('migrates valid MD5 hash to bcrypt', async () => {
      // Create an actual MD5 hash for testing
      const crypto = await import('crypto');
      const salt = 'test-salt';
      const password = 'OldPassword1!';
      const md5 = crypto.createHash('md5').update(salt + password).digest('hex');

      const newHash = await migratePasswordHash(password, salt, md5);
      expect(newHash).toBeDefined();
      expect(newHash).toMatch(/^\\$2b\\$12\\$/);
    });
  });

  describe('needsRehash', () => {
    it('detects old cost factor', () => {
      expect(needsRehash('5d41402abc4b2a76b9719d911017c592')).toBe(true); // MD5
      expect(needsRehash('$2b$10$SomeOldCostFactorHash')).toBe(true); // cost 10 < 12
      expect(needsRehash('$2b$12$CurrentCostFactorHash')).toBe(false); // cost 12 = 12
    });
  });
});` }
  ] },

  // --- Turn 48: Agent fixes password test ---
  { role: 'assistant', content: 'The password test needs a logger mock. The `migratePasswordHash` and `needsRehash` functions import the logger. Let me add the logger mock.' },

  { role: 'assistant', content: [
    { type: 'text', text: 'Adding the logger mock to the password test file.' },
    { type: 'tool_use', name: 'Edit', input: {
      path: '/src/tests/auth/password.test.ts',
      old_content: `// Mock bcrypt to avoid slow hashing in tests`,
      new_content: `// Mock logger (password.ts imports it for migration logging)
vi.mock('../../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock bcrypt to avoid slow hashing in tests`
    } }
  ] },

  // --- Turn 49: Tool result ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Edit', text: 'File edited: /src/tests/auth/password.test.ts' }
  ] },

  // --- Turn 50: Agent fixes the OAuth test and init test ---
  { role: 'assistant', content: [
    { type: 'text', text: 'Now fixing the OAuth test error message and the init test missing export. Let me read the OAuth test first.' },
    { type: 'tool_use', name: 'Read', input: { path: '/src/tests/auth/oauth.test.ts' } }
  ] },

  // --- Turn 51: OAuth test file ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Read', text: `import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  registerOAuthProvider,
  getRegisteredProviders,
  isProviderRegistered,
  initiateOAuthFlow,
  handleOAuthCallback,
} from '../../auth/oauth.js';

// Mock database
vi.mock('../../db/connection.js', () => ({
  db: {
    run: vi.fn(async () => ({ changes: 1 })),
    get: vi.fn(async (sql: string, params: any[]) => {
      if (sql.includes('oauth_states') && params[0] === 'valid-state') {
        return {
          nonce: 'test-nonce',
          expires_at: new Date(Date.now() + 600000).toISOString(),
        };
      }
      if (sql.includes('oauth_states') && params[0] === 'expired-state') {
        return {
          nonce: 'test-nonce',
          expires_at: new Date(Date.now() - 600000).toISOString(),
        };
      }
      return null;
    }),
    all: vi.fn(async () => []),
  },
}));

// Mock logger
vi.mock('../../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock OAuthClient
vi.mock('../../lib/oauth-client.js', () => ({
  OAuthClient: vi.fn().mockImplementation(({ provider }) => ({
    getAuthorizationUrl: vi.fn((state, nonce) => \`https://\${provider}.example.com/auth?state=\${state}&nonce=\${nonce}\`),
    exchangeCode: vi.fn(async () => ({ access_token: 'mock-access-token' })),
    getUserProfile: vi.fn(async () => ({
      id: 'provider-user-123',
      email: 'oauth@example.com',
      name: 'OAuth User',
    })),
  })),
}));

// Mock tokens
vi.mock('../../auth/tokens.js', () => ({
  generateAccessToken: vi.fn(() => 'mock-jwt'),
  generateOAuthState: vi.fn(() => 'generated-state'),
  generateOAuthNonce: vi.fn(() => 'generated-nonce'),
  generateRefreshToken: vi.fn(() => 'mock-refresh-token'),
}));

// Mock sessions
vi.mock('../../auth/sessions.js', () => ({
  createSession: vi.fn(async () => ({
    id: 'mock-session-id',
    userId: 'user-1',
    refreshToken: 'mock-refresh-token',
    expiresAt: new Date(Date.now() + 900000).toISOString(),
  })),
}));

describe('oauth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('registerOAuthProvider', () => {
    it('stores provider', () => {
      registerOAuthProvider('google', 'client-id', 'client-secret', 'http://localhost/callback', ['openid']);
      expect(getRegisteredProviders()).toContain('google');
      expect(isProviderRegistered('google')).toBe(true);
    });
  });

  describe('getRegisteredProviders', () => {
    it('lists providers', () => {
      registerOAuthProvider('github', 'gh-id', 'gh-secret', 'http://localhost/gh/callback', ['user']);
      const providers = getRegisteredProviders();
      expect(providers).toContain('github');
    });
  });

  describe('initiateOAuthFlow', () => {
    it('generates authorization URL', async () => {
      registerOAuthProvider('test-provider', 'tp-id', 'tp-secret', 'http://localhost/tp/callback', ['email']);
      const url = await initiateOAuthFlow('test-provider');
      expect(url).toContain('test-provider.example.com');
    });
  });

  describe('handleOAuthCallback', () => {
    it('creates session for new user', async () => {
      registerOAuthProvider('test-provider', 'tp-id', 'tp-secret', 'http://localhost/tp/callback', ['email']);
      const result = await handleOAuthCallback('test-provider', 'auth-code', 'valid-state');
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.user).toBeDefined();
        expect(result.isNewUser).toBe(true);
      }
    });

    it('links to existing user by email', async () => {
      // This would need the mock to return an existing user by email
      // Simplified for fixture purposes
    });

    it('rejects expired state', async () => {
      registerOAuthProvider('test-provider', 'tp-id', 'tp-secret', 'http://localhost/tp/callback', ['email']);
      const result = await handleOAuthCallback('test-provider', 'auth-code', 'expired-state');
      expect(result).toEqual({ error: 'OAuth state expired' });
    });
  });
});` }
  ] },

  // --- Turn 52: Agent fixes the OAuth test assertion ---
  { role: 'assistant', content: [
    { type: 'text', text: 'The test expects the old error message "OAuth state expired". The new code returns "Invalid or expired OAuth state". Updating the assertion.' },
    { type: 'tool_use', name: 'Edit', input: {
      path: '/src/tests/auth/oauth.test.ts',
      old_content: `      expect(result).toEqual({ error: 'OAuth state expired' });`,
      new_content: `      expect(result).toEqual({ error: 'Invalid or expired OAuth state' });`
    } }
  ] },

  // --- Turn 53: Tool result ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Edit', text: 'File edited: /src/tests/auth/oauth.test.ts' }
  ] },

  // --- Turn 54: Agent checks the barrel export ---
  { role: 'assistant', content: [
    { type: 'text', text: 'Now let me check the barrel file for the missing shutdownAuth export.' },
    { type: 'tool_use', name: 'Read', input: { path: '/src/auth/index.ts' } }
  ] },

  // --- Turn 55: Barrel file content ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Read', text: `// /src/auth/index.ts - Barrel re-export
// All auth module exports are accessible through this single entry point.

// Types and schemas
export type { User, UserRole, UserPublic, Session, TokenPayload } from './types.js';
export type { LoginResult, LoginSuccess, LoginError } from './types.js';
export type { RegisterResult, RegisterSuccess, RegisterError } from './types.js';
export type { OAuthResult, OAuthError } from './types.js';
export { AuthConfig, LoginSchema, RegisterSchema, ResetPasswordSchema, ChangePasswordSchema, RefreshTokenSchema, EmailVerificationSchema, OAuthCallbackSchema, toPublicUser } from './types.js';

// Password hashing
export { hashPassword, verifyPassword, isLegacyMd5Hash, needsRehash, migratePasswordHash } from './password.js';

// JWT tokens
export { generateAccessToken, generateRefreshToken, verifyAccessToken, decodeTokenUnsafe, generateVerificationToken, generateOAuthState, generateOAuthNonce } from './tokens.js';

// Session management
export { createSession, refreshSession, revokeSession, revokeAllUserSessions, getActiveSessions, touchSession, cleanupExpiredSessions, startSessionCleanup, stopSessionCleanup, getSessionById, countActiveSessions } from './sessions.js';

// Login, registration, password management
export { login, register, verifyEmail, requestPasswordReset, resetPassword, changePassword } from './login.js';

// OAuth
export { registerOAuthProvider, getRegisteredProviders, isProviderRegistered, initiateOAuthFlow, handleOAuthCallback } from './oauth.js';

// Middleware
export { authMiddleware, rateLimitMiddleware, loginRateLimitMiddleware, passwordResetRateLimitMiddleware } from './middleware.js';

// Route handlers
export { handleLogin, handleRegister, handleRefresh, handleLogout, handleVerifyEmail, handleRequestReset, handlePasswordReset, handleChangePassword } from './handlers.js';

// Initialization
export { initializeAuth, shutdownAuth } from './init.js';` }
  ] },

  // --- Turn 56: Agent finds the issue ---
  { role: 'assistant', content: 'The barrel file does include `shutdownAuth` on the last line: `export { initializeAuth, shutdownAuth } from \'./init.js\';`. So the init test must be importing from the wrong path. Let me check.' },

  { role: 'assistant', content: [
    { type: 'text', text: 'Reading the init test to verify its import path.' },
    { type: 'tool_use', name: 'Read', input: { path: '/src/tests/auth/init.test.ts' } }
  ] },

  // --- Turn 57: Init test file ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Read', text: `import { describe, it, expect, vi } from 'vitest';
import { initializeAuth } from '../../auth/index.js';

// The test file was only importing initializeAuth, not shutdownAuth

// Mock dependencies
vi.mock('../../auth/sessions.js', () => ({
  startSessionCleanup: vi.fn(),
  stopSessionCleanup: vi.fn(),
}));

vi.mock('../../auth/oauth.js', () => ({
  registerOAuthProvider: vi.fn(),
}));

vi.mock('../../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('auth initialization', () => {
  it('starts session cleanup', () => {
    initializeAuth();
    const { startSessionCleanup } = require('../../auth/sessions.js');
    expect(startSessionCleanup).toHaveBeenCalled();
  });

  it('registers OAuth providers from env', () => {
    process.env.GOOGLE_CLIENT_ID = 'test-google-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';

    initializeAuth();

    const { registerOAuthProvider } = require('../../auth/oauth.js');
    expect(registerOAuthProvider).toHaveBeenCalledWith(
      'google',
      'test-google-id',
      'test-google-secret',
      expect.any(String),
      expect.arrayContaining(['openid', 'email', 'profile'])
    );

    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  it('stops session cleanup on shutdown', async () => {
    const { shutdownAuth } = await import('../../auth/index.js');
    shutdownAuth();
    const { stopSessionCleanup } = require('../../auth/sessions.js');
    expect(stopSessionCleanup).toHaveBeenCalled();
  });
});` }
  ] },

  // --- Turn 58: Agent identifies the actual issue ---
  { role: 'assistant', content: 'The problem is that the test uses `await import(\'../../auth/index.js\')` as a dynamic import to get `shutdownAuth`, but Vitest\'s module mock system may not properly resolve dynamic imports the same way. The fix is simpler: just add `shutdownAuth` to the static import at the top of the file.' },

  { role: 'assistant', content: [
    { type: 'text', text: 'Fixing the init test to use a static import for shutdownAuth.' },
    { type: 'tool_use', name: 'Edit', input: {
      path: '/src/tests/auth/init.test.ts',
      old_content: `import { initializeAuth } from '../../auth/index.js';`,
      new_content: `import { initializeAuth, shutdownAuth } from '../../auth/index.js';`
    } }
  ] },

  // --- Turn 59: Tool result ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Edit', text: 'File edited: /src/tests/auth/init.test.ts' }
  ] },

  // --- Turn 60: Agent also updates the test body ---
  { role: 'assistant', content: [
    { type: 'text', text: 'Also updating the test body to use the static import instead of dynamic import.' },
    { type: 'tool_use', name: 'Edit', input: {
      path: '/src/tests/auth/init.test.ts',
      old_content: `  it('stops session cleanup on shutdown', async () => {
    const { shutdownAuth } = await import('../../auth/index.js');
    shutdownAuth();`,
      new_content: `  it('stops session cleanup on shutdown', () => {
    shutdownAuth();`
    } }
  ] },

  // --- Turn 61: Tool result ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Edit', text: 'File edited: /src/tests/auth/init.test.ts' }
  ] },

  // --- Turn 62: Agent addresses the login test failures ---
  { role: 'assistant', content: [
    { type: 'text', text: 'Now the login tests are failing because they cannot find ./password.js from login.ts. The tests need to mock the password module. Let me read the login test.' },
    { type: 'tool_use', name: 'Read', input: { path: '/src/tests/auth/login.test.ts' } }
  ] },

  // --- Turn 63: Login test file (large) ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Read', text: `import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  login,
  register,
  verifyEmail,
  requestPasswordReset,
  resetPassword,
  changePassword,
} from '../../auth/login.js';

// Mock database
vi.mock('../../db/connection.js', () => {
  const users = new Map<string, any>();

  // Seed a test user with MD5 hash
  users.set('user-1', {
    id: 'user-1',
    email: 'existing@example.com',
    passwordHash: '5d41402abc4b2a76b9719d911017c592', // MD5 of 'test-salt' + 'hello'
    salt: 'test-salt',
    displayName: 'Existing User',
    role: 'user',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    lastLoginAt: null,
    failedLoginAttempts: 0,
    lockedUntil: null,
    twoFactorEnabled: false,
    twoFactorSecret: null,
    emailVerified: true,
    emailVerificationToken: null,
  });

  // A locked user
  users.set('locked-user', {
    id: 'locked-user',
    email: 'locked@example.com',
    passwordHash: '$2b$12$LockedUserBcryptHashValue',
    salt: '',
    displayName: 'Locked User',
    role: 'user',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    lastLoginAt: null,
    failedLoginAttempts: 5,
    lockedUntil: new Date(Date.now() + 900000).toISOString(), // Locked for 15 more minutes
    twoFactorEnabled: false,
    twoFactorSecret: null,
    emailVerified: true,
    emailVerificationToken: null,
  });

  return {
    db: {
      run: vi.fn(async (sql: string, params: any[]) => {
        if (sql.includes('INSERT INTO users')) {
          const user = {
            id: params[0],
            email: params[1],
            passwordHash: params[2],
            salt: params[3],
            displayName: params[4],
            role: params[5],
            createdAt: params[6],
            updatedAt: params[7],
            lastLoginAt: params[8],
            failedLoginAttempts: params[9],
            lockedUntil: params[10],
            twoFactorEnabled: !!params[11],
            twoFactorSecret: params[12],
            emailVerified: !!params[13],
            emailVerificationToken: params[14],
          };
          users.set(user.id, user);
          return { changes: 1 };
        }
        if (sql.includes('UPDATE users SET failed_login_attempts')) {
          const user = users.get(params[2]);
          if (user) {
            user.failedLoginAttempts = params[0];
            user.lockedUntil = params[1];
          }
          return { changes: 1 };
        }
        if (sql.includes('UPDATE users SET password_hash')) {
          const user = [...users.values()].find(u => u.id === params[3]);
          if (user) {
            user.passwordHash = params[0];
            user.salt = params[1];
          }
          return { changes: 1 };
        }
        if (sql.includes('UPDATE users SET email_verified')) {
          for (const user of users.values()) {
            if (user.emailVerificationToken === params[1]) {
              user.emailVerified = true;
              user.emailVerificationToken = null;
              return { changes: 1 };
            }
          }
          return { changes: 0 };
        }
        if (sql.includes('INSERT OR REPLACE INTO password_resets')) {
          return { changes: 1 };
        }
        if (sql.includes('DELETE FROM password_resets')) {
          return { changes: 1 };
        }
        return { changes: 0 };
      }),
      get: vi.fn(async (sql: string, params: any[]) => {
        if (sql.includes('FROM users WHERE email')) {
          const email = params[0].toLowerCase();
          return [...users.values()].find(u => u.email === email) || null;
        }
        if (sql.includes('FROM users WHERE id')) {
          return users.get(params[0]) || null;
        }
        if (sql.includes('SELECT id FROM users WHERE email')) {
          const email = params[0].toLowerCase();
          const user = [...users.values()].find(u => u.email === email);
          return user ? { id: user.id } : null;
        }
        if (sql.includes('FROM password_resets WHERE token') && params[0] === 'valid-reset-token') {
          return {
            user_id: 'user-1',
            expires_at: new Date(Date.now() + 86400000).toISOString(),
          };
        }
        return null;
      }),
    },
  };
});

// Mock EventBus
vi.mock('../../lib/event-bus.js', () => ({
  EventBus: { emit: vi.fn() },
}));

// Mock logger
vi.mock('../../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock password module
vi.mock('../../auth/password.js', () => ({
  hashPassword: vi.fn(async (password: string) => \`$2b$12$MockHash_\${password.slice(0, 8)}\`),
  verifyPassword: vi.fn(async (password: string, hash: string) => {
    return hash.includes(password.slice(0, 8));
  }),
  isLegacyMd5Hash: vi.fn((hash: string) => /^[a-f0-9]{32}$/.test(hash)),
  migratePasswordHash: vi.fn(async (password: string, salt: string, hash: string) => {
    // Simulate successful migration
    const crypto = await import('crypto');
    const md5 = crypto.createHash('md5').update(salt + password).digest('hex');
    if (md5 === hash) {
      return \`$2b$12$Migrated_\${password.slice(0, 8)}\`;
    }
    return null;
  }),
}));

// Mock tokens
vi.mock('../../auth/tokens.js', () => ({
  generateAccessToken: vi.fn(() => 'mock-access-token'),
  generateRefreshToken: vi.fn(() => 'mock-refresh-token'),
}));

// Mock sessions
vi.mock('../../auth/sessions.js', () => ({
  createSession: vi.fn(async (userId: string) => ({
    id: 'mock-session-id',
    userId,
    token: 'mock-session-token',
    refreshToken: 'mock-refresh-token',
    expiresAt: new Date(Date.now() + 900000).toISOString(),
    refreshExpiresAt: new Date(Date.now() + 604800000).toISOString(),
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    ipAddress: '0.0.0.0',
    userAgent: 'test',
    isRevoked: false,
  })),
  revokeAllUserSessions: vi.fn(async () => 1),
}));

describe('login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('login()', () => {
    it('succeeds with valid credentials', async () => {
      // The seeded user has an MD5 hash, so migration should be triggered
      const result = await login('existing@example.com', 'hello', '127.0.0.1', 'TestAgent');
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.user.email).toBe('existing@example.com');
        expect(result.accessToken).toBe('mock-access-token');
        expect(result.session).toBeDefined();
      }
    });

    it('rejects invalid password', async () => {
      const result = await login('existing@example.com', 'wrong-password', '127.0.0.1', 'TestAgent');
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.code).toBe('INVALID_CREDENTIALS');
      }
    });

    it('rejects non-existent email', async () => {
      const result = await login('nobody@example.com', 'any-password', '127.0.0.1', 'TestAgent');
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.code).toBe('INVALID_CREDENTIALS');
      }
    });

    it('rejects locked account', async () => {
      const result = await login('locked@example.com', 'any-password', '127.0.0.1', 'TestAgent');
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.code).toBe('ACCOUNT_LOCKED');
        expect(result.error).toMatch(/Try again in \\d+ minutes/);
      }
    });

    it('migrates MD5 hash to bcrypt on successful login', async () => {
      const { migratePasswordHash } = await import('../../auth/password.js');
      await login('existing@example.com', 'hello', '127.0.0.1', 'TestAgent');
      expect(migratePasswordHash).toHaveBeenCalled();
    });

    it('increments failed attempts on bad password', async () => {
      const { db } = await import('../../db/connection.js');
      await login('existing@example.com', 'wrong-password', '127.0.0.1', 'TestAgent');
      expect(db.run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users SET failed_login_attempts'),
        expect.arrayContaining([1])
      );
    });

    it('resets failed attempts on success', async () => {
      const { db } = await import('../../db/connection.js');
      await login('existing@example.com', 'hello', '127.0.0.1', 'TestAgent');
      expect(db.run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users SET failed_login_attempts = 0'),
        expect.any(Array)
      );
    });
  });

  describe('register()', () => {
    it('creates a new user', async () => {
      const result = await register('new@example.com', 'SecureP@ss1', 'New User');
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.user.email).toBe('new@example.com');
        expect(result.user.displayName).toBe('New User');
        expect(result.verificationToken).toBeDefined();
      }
    });

    it('rejects duplicate email', async () => {
      const result = await register('existing@example.com', 'SecureP@ss1', 'Duplicate');
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.code).toBe('EMAIL_EXISTS');
      }
    });

    it('uses bcrypt for password hash', async () => {
      const { hashPassword } = await import('../../auth/password.js');
      await register('bcrypt-test@example.com', 'SecureP@ss1', 'Bcrypt Test');
      expect(hashPassword).toHaveBeenCalledWith('SecureP@ss1');
    });
  });

  describe('verifyEmail()', () => {
    it('returns true for valid token', async () => {
      // Would need a user with a pending verification token in the mock
      // For the fixture, we test the false case
      const result = await verifyEmail('nonexistent-token');
      expect(result).toBe(false);
    });
  });

  describe('requestPasswordReset()', () => {
    it('returns token for existing user', async () => {
      const token = await requestPasswordReset('existing@example.com');
      expect(token).toBeDefined();
    });

    it('returns null for non-existent email', async () => {
      const token = await requestPasswordReset('nobody@example.com');
      expect(token).toBeNull();
    });
  });

  describe('resetPassword()', () => {
    it('resets password with valid token', async () => {
      const result = await resetPassword('valid-reset-token', 'NewSecureP@ss1');
      expect(result).toBe(true);
    });

    it('rejects invalid token', async () => {
      const result = await resetPassword('invalid-token', 'NewSecureP@ss1');
      expect(result).toBe(false);
    });
  });

  describe('changePassword()', () => {
    it('changes password with correct current password', async () => {
      const result = await changePassword('user-1', 'hello', 'NewSecureP@ss1');
      expect(result.success).toBe(true);
    });
  });
});` }
  ] },

  // --- Turn 64: Agent identifies login test issue ---
  { role: 'assistant', content: 'The login test file already has the mock for `../../auth/password.js`, but the error said "Cannot find module \'./password.js\'". This means the mock resolution path is not matching. The test mocks `../../auth/password.js` but login.ts imports `./password.js` (relative to itself in the auth directory).\n\nVitest should resolve both to the same module. The actual issue is likely that the test runner cannot find the new `password.ts` file because it has not been written to disk yet, since we only \"wrote\" it inside this conversation fixture.\n\nWait, I realize the issue: the error in the test output was `Cannot find module \'./password.js\'` with `Require stack: /src/auth/login.ts`. This means Vitest is resolving the real module first before applying the mock. This happens when the mock path does not match exactly.\n\nThe fix: the mock should use a path relative to the test file that matches the real module path. The mock at `vi.mock(\'../../auth/password.js\')` should resolve correctly since the test is at `tests/auth/login.test.ts` and the module is at `auth/password.ts`. Let me verify the test output error more carefully.\n\nActually, looking at the output again: the 15 failures in login.test.ts all show the same error `Cannot find module \'./password.js\'`. This is because the login.ts module was not created yet when the tests ran. The file exists now, so re-running the tests should resolve this. Let me re-run.' },

  // --- Turn 65: User clarifies ---
  { role: 'user', content: 'The files are all created now. Just re-run the tests.' },

  // --- Turn 66: Agent re-runs tests ---
  { role: 'assistant', content: [
    { type: 'text', text: 'Re-running the full test suite now that all files are in place.' },
    { type: 'tool_use', name: 'Bash', input: { command: 'cd /src && npm run test:run 2>&1' } }
  ] },

  // --- Turn 67: Test output (second run, verbose) ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Bash', text: `> project@1.0.0 test:run
> vitest run --reporter=verbose

 RUN  v2.1.8 /src

 ✓ tests/utils/test-helpers.test.ts (4 tests) 11ms
   ✓ hashTestPassword > hashes password with bcrypt cost 10 (3ms)
   ✓ testUuid > generates valid UUID v4 (0ms)
   ✓ createMockDb > supports run/get/all operations (2ms)
   ✓ createMockEventBus > records emitted events (1ms)

 ✓ tests/db/connection.test.ts (8 tests) 42ms
   ✓ DatabaseConnection > opens database with WAL mode (8ms)
   ✓ DatabaseConnection > sets busy timeout from options (2ms)
   ✓ DatabaseConnection > run returns changes count (4ms)
   ✓ DatabaseConnection > get returns single row (3ms)
   ✓ DatabaseConnection > all returns array of rows (4ms)
   ✓ DatabaseConnection > transaction commits on success (6ms)
   ✓ DatabaseConnection > transaction rolls back on error (5ms)
   ✓ DatabaseConnection > isHealthy returns true for open db (1ms)

 ✓ tests/db/migrations.test.ts (3 tests) 115ms
   ✓ migrate > applies new migrations in order (45ms)
   ✓ migrate > skips already-applied migrations (38ms)
   ✓ migrate > rolls back failed migration (32ms)

 ✓ tests/lib/event-bus.test.ts (6 tests) 7ms
   ✓ TypedEventBus > emits events with correct payload (1ms)
   ✓ TypedEventBus > on registers persistent listener (1ms)
   ✓ TypedEventBus > once fires listener only once (1ms)
   ✓ TypedEventBus > off removes specific listener (1ms)
   ✓ TypedEventBus > removeAllListeners clears event (1ms)
   ✓ TypedEventBus > getStats returns listener counts (1ms)

 ✓ tests/lib/rate-limiter.test.ts (12 tests) 14ms
   ✓ RateLimiter > allows requests under limit (1ms)
   ✓ RateLimiter > blocks requests at limit (1ms)
   ✓ RateLimiter > returns correct remaining count (1ms)
   ✓ RateLimiter > different keys have independent limits (1ms)
   ✓ RateLimiter > sliding window expires old timestamps (2ms)
   ✓ RateLimiter > reset clears a single key (0ms)
   ✓ RateLimiter > resetAll clears all keys (0ms)
   ✓ RateLimiter > getCount returns without recording (1ms)
   ✓ RateLimiter > getTrackedKeyCount reflects unique keys (1ms)
   ✓ RateLimiter > cleanup removes stale entries (2ms)
   ✓ RateLimiter > destroy stops cleanup timer (1ms)
   ✓ RateLimiter > factory functions create correct limits (1ms)

 ✓ tests/lib/logger.test.ts (5 tests) 9ms
   ✓ createLogger > creates logger with context name (1ms)
   ✓ createLogger > respects LOG_LEVEL filtering (2ms)
   ✓ createLogger > formats output with timestamp and context (2ms)
   ✓ createLogger > writes to log file at debug level (3ms)
   ✓ createLogger > rotates log file at 5MB (1ms)

 ✓ tests/auth/password.test.ts (7 tests) 145ms
   ✓ hashPassword > generates a bcrypt hash (35ms)
   ✓ hashPassword > generates different hashes for same password (32ms)
   ✓ verifyPassword > verifies correct password (28ms)
   ✓ verifyPassword > rejects incorrect password (25ms)
   ✓ isLegacyMd5Hash > detects MD5 hashes (0ms)
   ✓ migratePasswordHash > migrates valid MD5 hash to bcrypt (18ms)
   ✓ needsRehash > detects old cost factor (0ms)

 ✓ tests/auth/login.test.ts (15 tests) 320ms
   ✓ login > succeeds with valid credentials (42ms)
   ✓ login > rejects invalid password (38ms)
   ✓ login > rejects non-existent email (2ms)
   ✓ login > rejects locked account (1ms)
   ✓ login > migrates MD5 hash to bcrypt on successful login (45ms)
   ✓ login > increments failed attempts on bad password (35ms)
   ✓ login > resets failed attempts on success (40ms)
   ✓ register > creates a new user (28ms)
   ✓ register > rejects duplicate email (2ms)
   ✓ register > uses bcrypt for password hash (25ms)
   ✓ verifyEmail > returns true for valid token (1ms)
   ✓ requestPasswordReset > returns token for existing user (15ms)
   ✓ requestPasswordReset > returns null for non-existent email (1ms)
   ✓ resetPassword > resets password with valid token (22ms)
   ✓ resetPassword > rejects invalid token (1ms)

 ✓ tests/auth/sessions.test.ts (12 tests) 285ms
   ✓ createSession > creates a session with correct fields (5ms)
   ✓ createSession > sets extended expiry for rememberMe (4ms)
   ✓ refreshSession > refreshes tokens atomically (42ms)
   ✓ refreshSession > rejects expired refresh token (3ms)
   ✓ refreshSession > rejects revoked session token (8ms)
   ✓ refreshSession > returns null for unknown token (1ms)
   ✓ revokeSession > marks session as revoked (3ms)
   ✓ revokeAllUserSessions > revokes all active sessions (6ms)
   ✓ getActiveSessions > returns only non-revoked sessions (5ms)
   ✓ cleanupExpiredSessions > deletes expired sessions (4ms)
   ✓ startSessionCleanup > starts cleanup interval (1ms)
   ✓ stopSessionCleanup > stops cleanup interval (1ms)

 ✓ tests/auth/middleware.test.ts (9 tests) 48ms
   ✓ authMiddleware > returns 401 for missing header (1ms)
   ✓ authMiddleware > returns 401 for invalid token (1ms)
   ✓ authMiddleware > returns 403 for insufficient role (2ms)
   ✓ authMiddleware > attaches authUser to request (4ms)
   ✓ authMiddleware > updates session activity (5ms)
   ✓ authMiddleware > calls touchSession fire-and-forget (3ms)
   ✓ authMiddleware > allows admin to access any role (2ms)
   ✓ authMiddleware > rejects revoked session (4ms)
   ✓ rateLimitMiddleware > allows requests under limit (1ms)
   ✓ rateLimitMiddleware > blocks requests over limit (2ms)
   ✓ rateLimitMiddleware > sets rate limit headers (1ms)

 ✓ tests/auth/tokens.test.ts (8 tests) 22ms
   ✓ generateAccessToken > creates valid JWT (3ms)
   ✓ generateAccessToken > includes correct payload fields (2ms)
   ✓ generateRefreshToken > generates 128-char hex string (0ms)
   ✓ verifyAccessToken > returns payload for valid token (2ms)
   ✓ verifyAccessToken > returns null for expired token (8ms)
   ✓ verifyAccessToken > returns null for invalid token (1ms)
   ✓ decodeTokenUnsafe > decodes without verification (1ms)
   ✓ generateVerificationToken > returns UUID (0ms)

 ✓ tests/auth/handlers.test.ts (10 tests) 165ms
   ✓ handleLogin > returns user and tokens on success (22ms)
   ✓ handleLogin > returns 400 for invalid input (1ms)
   ✓ handleLogin > returns 401 for invalid credentials (18ms)
   ✓ handleLogin > returns 423 for locked account (1ms)
   ✓ handleRegister > returns 201 on success (15ms)
   ✓ handleRegister > returns 409 for duplicate email (12ms)
   ✓ handleRefresh > returns new tokens on success (18ms)
   ✓ handleRefresh > returns 401 for invalid refresh token (1ms)
   ✓ handleLogout > revokes session (8ms)
   ✓ handleChangePassword > changes password on success (14ms)

 ✓ tests/auth/oauth.test.ts (6 tests) 38ms
   ✓ registerOAuthProvider > stores provider (1ms)
   ✓ getRegisteredProviders > lists providers (0ms)
   ✓ initiateOAuthFlow > generates authorization URL (5ms)
   ✓ handleOAuthCallback > creates session for new user (12ms)
   ✓ handleOAuthCallback > links to existing user by email (8ms)
   ✓ handleOAuthCallback > rejects expired state (2ms)

 ✓ tests/auth/init.test.ts (3 tests) 6ms
   ✓ initializeAuth > starts session cleanup (2ms)
   ✓ initializeAuth > registers OAuth providers from env (2ms)
   ✓ shutdownAuth > stops session cleanup (1ms)

 ✓ tests/routes/health.test.ts (2 tests) 4ms
   ✓ health > returns ok status (2ms)
   ✓ health/detailed > includes memory and db info (2ms)

 ✓ tests/routes/users.test.ts (8 tests) 88ms
   ✓ GET /user/me > returns current user profile (12ms)
   ✓ GET /user/me > returns 401 without auth (1ms)
   ✓ GET /user/sessions > lists active sessions (15ms)
   ✓ GET /user/sessions > sanitizes token fields (8ms)
   ✓ DELETE /user/sessions/:id > revokes other session (12ms)
   ✓ DELETE /user/sessions/:id > prevents revoking own session (2ms)
   ✓ DELETE /user/sessions/:id > returns 404 for unknown session (2ms)
   ✓ DELETE /user/sessions/:id > returns 404 for other user session (2ms)

 Test Files  0 failed | 16 passed | 16 total
 Tests       0 failed | 98 passed | 98 total
 Duration    1.45s

 PASS  All tests passed!` }
  ] },

  // --- Turn 67b: Agent reads the logger module ---
  { role: 'assistant', content: [
    { type: 'text', text: 'All tests pass. Let me also verify the logger module to make sure the auth modules use it correctly.' },
    { type: 'tool_use', name: 'Read', input: { path: '/src/lib/logger.ts' } }
  ] },

  // --- Turn 67c: Logger source ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Read', text: `import fs from 'fs';
import path from 'path';
import { getLogLevel, type LogLevel } from '../config/log-level.js';

// ============================================================================
// Configuration
// ============================================================================

const LOG_FILE_DIR = path.join(process.cwd(), 'data', 'logs');
const LOG_FILE_PATH = path.join(LOG_FILE_DIR, 'app.log');
const LOG_FILE_ROTATED_PATH = path.join(LOG_FILE_DIR, 'app.log.1');
const MAX_LOG_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ============================================================================
// Color codes for terminal output
// ============================================================================

const COLORS = {
  reset: '\\x1b[0m',
  dim: '\\x1b[2m',
  red: '\\x1b[31m',
  yellow: '\\x1b[33m',
  blue: '\\x1b[34m',
  cyan: '\\x1b[36m',
  white: '\\x1b[37m',
  brightRed: '\\x1b[91m',
  brightYellow: '\\x1b[93m',
  brightCyan: '\\x1b[96m',
} as const;

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: COLORS.dim,
  info: COLORS.cyan,
  warn: COLORS.brightYellow,
  error: COLORS.brightRed,
};

const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO ',
  warn: 'WARN ',
  error: 'ERROR',
};

// ============================================================================
// Category-based filtering
// ============================================================================

/**
 * Active log categories. If empty, all categories are active.
 * Categories are loaded from the database on startup and can be
 * updated at runtime via the settings API.
 */
let activeCategories: Set<string> = new Set();
let allCategoriesEnabled = true;

/**
 * Set the active log categories.
 * If categories is empty or null, all categories are enabled.
 */
export function setLogCategories(categories: string[] | null): void {
  if (!categories || categories.length === 0) {
    activeCategories.clear();
    allCategoriesEnabled = true;
  } else {
    activeCategories = new Set(categories);
    allCategoriesEnabled = false;
  }
}

/**
 * Check if a category is currently active.
 */
function isCategoryActive(category: string): boolean {
  return allCategoriesEnabled || activeCategories.has(category);
}

/**
 * Get the current active categories.
 */
export function getActiveCategories(): string[] {
  return allCategoriesEnabled ? [] : [...activeCategories];
}

// ============================================================================
// File logging
// ============================================================================

let logFileStream: fs.WriteStream | null = null;
let currentLogFileSize = 0;

/**
 * Ensure the log directory exists and open the log file stream.
 */
function ensureLogFile(): void {
  if (logFileStream) return;

  try {
    if (!fs.existsSync(LOG_FILE_DIR)) {
      fs.mkdirSync(LOG_FILE_DIR, { recursive: true });
    }

    // Get current file size if it exists
    if (fs.existsSync(LOG_FILE_PATH)) {
      currentLogFileSize = fs.statSync(LOG_FILE_PATH).size;
    }

    logFileStream = fs.createWriteStream(LOG_FILE_PATH, { flags: 'a' });
    logFileStream.on('error', (err) => {
      console.error('Log file write error:', err);
      logFileStream = null;
    });
  } catch (err) {
    console.error('Failed to open log file:', err);
  }
}

/**
 * Rotate the log file if it exceeds the maximum size.
 * Moves the current log file to .log.1 (overwriting any existing rotation).
 */
function rotateLogFileIfNeeded(): void {
  if (currentLogFileSize < MAX_LOG_FILE_SIZE) return;

  try {
    if (logFileStream) {
      logFileStream.end();
      logFileStream = null;
    }

    // Rotate: app.log -> app.log.1
    if (fs.existsSync(LOG_FILE_PATH)) {
      fs.renameSync(LOG_FILE_PATH, LOG_FILE_ROTATED_PATH);
    }

    currentLogFileSize = 0;

    // Re-open the stream for the new file
    logFileStream = fs.createWriteStream(LOG_FILE_PATH, { flags: 'a' });
  } catch (err) {
    console.error('Log rotation failed:', err);
  }
}

/**
 * Write a log entry to the file.
 * Always writes at debug level (captures everything) regardless of
 * the console LOG_LEVEL or category filters.
 */
function writeToFile(timestamp: string, level: string, context: string, message: string): void {
  ensureLogFile();
  if (!logFileStream) return;

  const line = \`\${timestamp} [\${level}] [\${context}] \${message}\\n\`;
  logFileStream.write(line);
  currentLogFileSize += Buffer.byteLength(line);
  rotateLogFileIfNeeded();
}

// ============================================================================
// Logger interface
// ============================================================================

/**
 * Logger instance with context name and category.
 */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * Format a log message with optional additional arguments.
 * Objects are JSON-stringified, errors include the stack trace.
 */
function formatMessage(message: string, args: unknown[]): string {
  if (args.length === 0) return message;

  const parts = [message];
  for (const arg of args) {
    if (arg instanceof Error) {
      parts.push(\`\${arg.message}\\n\${arg.stack || ''}\`);
    } else if (typeof arg === 'object' && arg !== null) {
      try {
        parts.push(JSON.stringify(arg, null, 2));
      } catch {
        parts.push(String(arg));
      }
    } else {
      parts.push(String(arg));
    }
  }

  return parts.join(' ');
}

/**
 * Get a formatted timestamp string for log output.
 */
function getTimestamp(): string {
  const now = new Date();
  return now.toISOString().replace('T', ' ').replace('Z', '');
}

/**
 * Create a logger instance for a specific component.
 *
 * @param contextName - The component name shown in brackets (e.g., 'AuthLogin')
 * @param category - The category for DB-based filtering (e.g., 'auth')
 *
 * @example
 * \x60\x60\x60typescript
 * const log = createLogger('AuthLogin', 'auth');
 * log.info('User logged in');
 * // Output: 2024-01-15 10:30:00.000 [INFO ] [AuthLogin] User logged in
 * \x60\x60\x60
 *
 * Categories:
 * - server: Server startup, routing, middleware
 * - auth: Authentication, sessions, OAuth
 * - database: Database operations, migrations
 * - heartbeat: Heartbeat ticks, mind pipeline
 * - agents: Agent SDK operations, sub-agent management
 * - channels: Channel operations, message routing
 * - memory: Memory observations, reflections, consolidation
 * - goals: Goal tracking, progress updates
 * - tasks: Task management, scheduling
 * - plugins: Plugin lifecycle, tools, skills
 */
export function createLogger(contextName: string, category: string = contextName.toLowerCase()): Logger {
  const configuredLevel = getLogLevel();
  const configuredPriority = LOG_LEVEL_PRIORITY[configuredLevel];

  function shouldLog(level: LogLevel): boolean {
    // Always write to file regardless of level/category
    // But for console output, check both level and category
    return LOG_LEVEL_PRIORITY[level] >= configuredPriority && isCategoryActive(category);
  }

  function logToConsole(level: LogLevel, message: string, args: unknown[]): void {
    const timestamp = getTimestamp();
    const formatted = formatMessage(message, args);
    const label = LEVEL_LABELS[level];
    const color = LEVEL_COLORS[level];

    // Always write to file at debug level
    writeToFile(timestamp, label, contextName, formatted);

    // Only write to console if level and category pass filters
    if (!shouldLog(level)) return;

    const prefix = \`\${COLORS.dim}\${timestamp}\${COLORS.reset} \${color}\${label}\${COLORS.reset} \${COLORS.yellow}[\${contextName}]\${COLORS.reset}\`;
    console.log(\`\${prefix} \${formatted}\`);
  }

  return {
    debug(message: string, ...args: unknown[]) {
      logToConsole('debug', message, args);
    },
    info(message: string, ...args: unknown[]) {
      logToConsole('info', message, args);
    },
    warn(message: string, ...args: unknown[]) {
      logToConsole('warn', message, args);
    },
    error(message: string, ...args: unknown[]) {
      logToConsole('error', message, args);
    },
  };
}

/**
 * Close the log file stream.
 * Call during graceful shutdown.
 */
export function closeLogFile(): void {
  if (logFileStream) {
    logFileStream.end();
    logFileStream = null;
  }
}

/**
 * Get the current log file path.
 */
export function getLogFilePath(): string {
  return LOG_FILE_PATH;
}

/**
 * Read the last N lines of the log file.
 * Useful for the admin UI log viewer.
 */
export function readRecentLogs(lines: number = 100): string[] {
  try {
    if (!fs.existsSync(LOG_FILE_PATH)) return [];
    const content = fs.readFileSync(LOG_FILE_PATH, 'utf-8');
    const allLines = content.split('\\n').filter(Boolean);
    return allLines.slice(-lines);
  } catch {
    return [];
  }
}

/**
 * Search log file for entries matching a pattern.
 */
export function searchLogs(pattern: string, maxResults: number = 50): string[] {
  try {
    if (!fs.existsSync(LOG_FILE_PATH)) return [];
    const content = fs.readFileSync(LOG_FILE_PATH, 'utf-8');
    const allLines = content.split('\\n').filter(Boolean);
    const regex = new RegExp(pattern, 'i');
    return allLines.filter(line => regex.test(line)).slice(-maxResults);
  } catch {
    return [];
  }
}` }
  ] },

  // --- Turn 67d: Agent verifies logger compatibility ---
  { role: 'assistant', content: 'The logger module confirms several important things:\n\n1. It imports `getLogLevel` from `../config/log-level.js`, not from the config barrel. This is the fix we discussed for the circular dependency.\n2. The `createLogger(contextName, category)` interface matches how all auth modules use it: `createLogger(\'AuthLogin\', \'auth\')`.\n3. All auth events log to the \'auth\' category, which means they can be filtered independently via `setLogCategories`.\n4. The log file always captures at debug level regardless of the console LOG_LEVEL setting, which is useful for debugging auth issues in production.\n5. Log file rotates at 5MB with a single rotation (app.log -> app.log.1).\n\nLet me also verify the integration test file to make sure the auth endpoints are tested end-to-end.' },

  // --- Turn 67e: Agent reads the integration test ---
  { role: 'assistant', content: [
    { type: 'text', text: 'Reading the auth integration test to verify end-to-end coverage.' },
    { type: 'tool_use', name: 'Read', input: { path: '/src/tests/integration/auth-flow.test.ts' } }
  ] },

  // --- Turn 67f: Integration test ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Read', text: `import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer } from '../../server.js';
import { closeDb } from '../../db/connection.js';
import { hashTestPassword, testEmail, delay } from '../../utils/test-helpers.js';

/**
 * Integration tests for the complete auth flow.
 *
 * These tests run against a real in-memory SQLite database with the full
 * Express server stack. They test the complete request/response cycle
 * including middleware, validation, and database operations.
 *
 * Test database is created fresh for each test suite and destroyed after.
 */

let server: ReturnType<typeof createServer>;
let baseUrl: string;

beforeAll(async () => {
  process.env.DATABASE_URL = ':memory:';
  process.env.JWT_SECRET = 'test-secret-for-integration-tests-only';
  process.env.NODE_ENV = 'test';

  server = createServer({ port: 0 }); // Random port
  const address = server.address();
  baseUrl = \`http://localhost:\${typeof address === 'object' ? address?.port : address}\`;

  // Run migrations
  const { db } = await import('../../db/connection.js');
  await db.migrate('src/db/migrations');
});

afterAll(async () => {
  if (server) server.close();
  closeDb();
});

async function request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const url = \`\${baseUrl}\${path}\`;
  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  const response = await fetch(url, options);
  const data = await response.json().catch(() => null);
  return { status: response.status, data, headers: response.headers };
}

describe('Auth Integration Flow', () => {
  let userToken: string;
  let userRefreshToken: string;
  let userId: string;

  describe('Registration', () => {
    it('registers a new user', async () => {
      const { status, data } = await request('POST', '/auth/register', {
        email: 'integration@example.com',
        password: 'SecureP@ss123',
        displayName: 'Integration Test User',
      });

      expect(status).toBe(201);
      expect(data.message).toContain('verify your email');
      expect(data.userId).toBeDefined();
      userId = data.userId;
    });

    it('rejects duplicate registration', async () => {
      const { status, data } = await request('POST', '/auth/register', {
        email: 'integration@example.com',
        password: 'AnotherP@ss123',
        displayName: 'Duplicate User',
      });

      expect(status).toBe(409);
      expect(data.code).toBe('EMAIL_EXISTS');
    });

    it('validates password requirements', async () => {
      const { status, data } = await request('POST', '/auth/register', {
        email: 'weak-password@example.com',
        password: 'weak',
        displayName: 'Weak Password User',
      });

      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    });

    it('validates email format', async () => {
      const { status } = await request('POST', '/auth/register', {
        email: 'not-an-email',
        password: 'SecureP@ss123',
        displayName: 'Bad Email User',
      });

      expect(status).toBe(400);
    });
  });

  describe('Email Verification', () => {
    it('verifies email with valid token', async () => {
      // Directly verify in DB for testing (normally done via email link)
      const { db } = await import('../../db/connection.js');
      const user = await db.get('SELECT email_verification_token FROM users WHERE id = ?', [userId]);
      expect(user).toBeDefined();

      const { status, data } = await request('POST', '/auth/verify-email', {
        token: user!.email_verification_token,
      });

      expect(status).toBe(200);
      expect(data.message).toContain('verified');
    });

    it('rejects invalid verification token', async () => {
      const { status } = await request('POST', '/auth/verify-email', {
        token: '00000000-0000-0000-0000-000000000000',
      });

      expect(status).toBe(400);
    });
  });

  describe('Login', () => {
    it('logs in with valid credentials', async () => {
      const { status, data } = await request('POST', '/auth/login', {
        email: 'integration@example.com',
        password: 'SecureP@ss123',
      });

      expect(status).toBe(200);
      expect(data.user.email).toBe('integration@example.com');
      expect(data.user.displayName).toBe('Integration Test User');
      expect(data.user.role).toBe('user');
      expect(data.accessToken).toBeDefined();
      expect(data.refreshToken).toBeDefined();
      expect(data.expiresAt).toBeDefined();

      userToken = data.accessToken;
      userRefreshToken = data.refreshToken;
    });

    it('rejects invalid password', async () => {
      const { status, data } = await request('POST', '/auth/login', {
        email: 'integration@example.com',
        password: 'WrongP@ss123',
      });

      expect(status).toBe(401);
      expect(data.code).toBe('INVALID_CREDENTIALS');
    });

    it('rejects non-existent email', async () => {
      const { status, data } = await request('POST', '/auth/login', {
        email: 'nobody@example.com',
        password: 'AnyP@ss123',
      });

      expect(status).toBe(401);
      expect(data.code).toBe('INVALID_CREDENTIALS');
    });

    it('locks account after 5 failed attempts', async () => {
      for (let i = 0; i < 5; i++) {
        await request('POST', '/auth/login', {
          email: 'integration@example.com',
          password: 'WrongP@ss' + i,
        });
      }

      const { status, data } = await request('POST', '/auth/login', {
        email: 'integration@example.com',
        password: 'SecureP@ss123', // Even correct password should fail
      });

      expect(status).toBe(423);
      expect(data.code).toBe('ACCOUNT_LOCKED');
      expect(data.error).toMatch(/Try again in \\d+ minutes/);
    });
  });

  describe('Token Refresh', () => {
    beforeEach(async () => {
      // Unlock and re-login for fresh tokens
      const { db } = await import('../../db/connection.js');
      await db.run('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE email = ?', ['integration@example.com']);

      const { data } = await request('POST', '/auth/login', {
        email: 'integration@example.com',
        password: 'SecureP@ss123',
      });
      userToken = data.accessToken;
      userRefreshToken = data.refreshToken;
    });

    it('refreshes tokens with valid refresh token', async () => {
      const { status, data } = await request('POST', '/auth/refresh', {
        refreshToken: userRefreshToken,
      });

      expect(status).toBe(200);
      expect(data.accessToken).toBeDefined();
      expect(data.refreshToken).toBeDefined();
      expect(data.refreshToken).not.toBe(userRefreshToken); // New token generated
      expect(data.expiresAt).toBeDefined();

      // Update tokens for subsequent tests
      userToken = data.accessToken;
      userRefreshToken = data.refreshToken;
    });

    it('rejects used refresh token (rotation)', async () => {
      const oldRefreshToken = userRefreshToken;

      // First refresh succeeds
      const { data } = await request('POST', '/auth/refresh', {
        refreshToken: oldRefreshToken,
      });
      expect(data.refreshToken).toBeDefined();

      // Second refresh with same token should fail (token was rotated)
      const { status: status2 } = await request('POST', '/auth/refresh', {
        refreshToken: oldRefreshToken,
      });
      expect(status2).toBe(401);
    });

    it('rejects invalid refresh token', async () => {
      const { status } = await request('POST', '/auth/refresh', {
        refreshToken: 'completely-invalid-token',
      });

      expect(status).toBe(401);
    });
  });

  describe('Protected Routes', () => {
    it('accesses /user/me with valid token', async () => {
      const { status, data } = await request('GET', '/user/me', undefined, {
        Authorization: \`Bearer \${userToken}\`,
      });

      expect(status).toBe(200);
      expect(data.email).toBe('integration@example.com');
    });

    it('rejects /user/me without token', async () => {
      const { status } = await request('GET', '/user/me');
      expect(status).toBe(401);
    });

    it('rejects /user/me with invalid token', async () => {
      const { status } = await request('GET', '/user/me', undefined, {
        Authorization: 'Bearer invalid-token',
      });
      expect(status).toBe(401);
    });

    it('lists active sessions', async () => {
      const { status, data } = await request('GET', '/user/sessions', undefined, {
        Authorization: \`Bearer \${userToken}\`,
      });

      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      // Verify tokens are not exposed
      expect(data[0].token).toBeUndefined();
      expect(data[0].refreshToken).toBeUndefined();
      // Verify session metadata is present
      expect(data[0].id).toBeDefined();
      expect(data[0].ipAddress).toBeDefined();
      expect(data[0].userAgent).toBeDefined();
      expect(data[0].lastActivityAt).toBeDefined();
    });
  });

  describe('Password Change', () => {
    it('changes password with correct current password', async () => {
      const { status, data } = await request('POST', '/auth/change-password', {
        currentPassword: 'SecureP@ss123',
        newPassword: 'NewSecureP@ss456',
      }, {
        Authorization: \`Bearer \${userToken}\`,
      });

      expect(status).toBe(200);
      expect(data.message).toContain('changed');
    });

    it('rejects password change with wrong current password', async () => {
      // Re-login with new password first
      const { data: loginData } = await request('POST', '/auth/login', {
        email: 'integration@example.com',
        password: 'NewSecureP@ss456',
      });
      userToken = loginData.accessToken;

      const { status } = await request('POST', '/auth/change-password', {
        currentPassword: 'WrongCurrentP@ss',
        newPassword: 'AnotherNewP@ss789',
      }, {
        Authorization: \`Bearer \${userToken}\`,
      });

      expect(status).toBe(400);
    });
  });

  describe('Password Reset', () => {
    it('requests password reset (always 200)', async () => {
      const { status, data } = await request('POST', '/auth/request-reset', {
        email: 'integration@example.com',
      });

      expect(status).toBe(200);
      expect(data.message).toContain('If the email exists');
    });

    it('returns 200 even for non-existent email (prevents enumeration)', async () => {
      const { status, data } = await request('POST', '/auth/request-reset', {
        email: 'nonexistent@example.com',
      });

      expect(status).toBe(200);
      expect(data.message).toContain('If the email exists');
    });

    it('resets password with valid token', async () => {
      // Get the reset token from DB directly
      const { db } = await import('../../db/connection.js');
      await request('POST', '/auth/request-reset', { email: 'integration@example.com' });
      const reset = await db.get('SELECT token FROM password_resets WHERE user_id = ?', [userId]);

      if (reset) {
        const { status, data } = await request('POST', '/auth/reset-password', {
          token: reset.token,
          newPassword: 'ResetP@ss789',
        });

        expect(status).toBe(200);
        expect(data.message).toContain('reset successful');

        // Verify login with new password works
        const { status: loginStatus } = await request('POST', '/auth/login', {
          email: 'integration@example.com',
          password: 'ResetP@ss789',
        });
        expect(loginStatus).toBe(200);
      }
    });
  });

  describe('Logout', () => {
    it('logs out and revokes session', async () => {
      // Login to get a fresh session
      const { data: loginData } = await request('POST', '/auth/login', {
        email: 'integration@example.com',
        password: 'ResetP@ss789',
      });

      const { status, data } = await request('POST', '/auth/logout', undefined, {
        Authorization: \`Bearer \${loginData.accessToken}\`,
      });

      expect(status).toBe(200);
      expect(data.message).toContain('Logged out');

      // Verify the token is now invalid (session revoked)
      // Note: the JWT itself is still valid until expiry, but the session
      // check in authMiddleware will reject it
      const { status: meStatus } = await request('GET', '/user/me', undefined, {
        Authorization: \`Bearer \${loginData.accessToken}\`,
      });
      // This might still be 200 if authMiddleware only checks JWT validity
      // and doesn't check session revocation on every request
    });
  });

  describe('Rate Limiting', () => {
    it('enforces login rate limit (10 per 15 min)', async () => {
      // Make 11 login attempts rapidly
      const results = [];
      for (let i = 0; i < 11; i++) {
        const result = await request('POST', '/auth/login', {
          email: \`ratelimit-test-\${i}@example.com\`,
          password: 'AnyP@ss123',
        });
        results.push(result);
      }

      // The 11th request should be rate limited
      const lastResult = results[results.length - 1];
      expect(lastResult.status).toBe(429);
      expect(lastResult.data.retryAfter).toBeDefined();
    });

    it('sets rate limit headers', async () => {
      const result = await request('POST', '/auth/login', {
        email: 'header-test@example.com',
        password: 'AnyP@ss123',
      });

      expect(result.headers.get('x-ratelimit-limit')).toBeDefined();
      expect(result.headers.get('x-ratelimit-remaining')).toBeDefined();
      expect(result.headers.get('x-ratelimit-reset')).toBeDefined();
    });
  });
});` }
  ] },

  // --- Turn 67g: Agent notes integration test coverage ---
  { role: 'assistant', content: 'The integration test file provides excellent end-to-end coverage of the auth flow:\n\n1. Registration with validation (email format, password strength, duplicate detection)\n2. Email verification\n3. Login with credential validation and account lockout (5 attempts)\n4. Token refresh with rotation (used tokens are rejected)\n5. Protected route access with Bearer token\n6. Password change and password reset flows\n7. Logout with session revocation\n8. Rate limiting enforcement (10 per 15 min for login)\n\nThe test uses a real in-memory SQLite database with the full Express server stack, which validates that all the module boundaries work correctly in a real deployment scenario.\n\nThe rate limit test at the end confirms that the `loginRateLimitMiddleware` with its 10 request limit is enforced correctly.' },

  // --- Turn 68: All tests pass ---
  { role: 'assistant', content: 'All 98 tests pass across 16 test files, with 0 failures. The test fixes were:\n\n1. **sessions.test.ts**: Added `transaction` method to the mock DB so `refreshSession` can use `db.transaction()`.\n2. **middleware.test.ts**: Updated assertion from `req.user` to `req.authUser` to match the renamed property.\n3. **password.test.ts**: Added logger mock since `password.ts` imports the logger for migration logging.\n4. **oauth.test.ts**: Updated expected error message from `\'OAuth state expired\'` to `\'Invalid or expired OAuth state\'`.\n5. **init.test.ts**: Changed `shutdownAuth` from dynamic import to static import.\n6. **login.test.ts**: Tests passed after the password.ts file was created on disk (module resolution issue).\n\nThe total test count is 98 tests across 16 files.' },

  // --- Turn 69: User discovers a circular dependency ---
  { role: 'user', content: 'Wait, I just noticed something. The login.ts module imports from sessions.ts, and sessions.ts imports from tokens.ts. But tokens.ts imports from types.ts which re-exports AuthConfig. And init.ts imports from oauth.ts and sessions.ts. Is there a circular dependency anywhere in this graph?' },

  // --- Turn 70: Agent analyzes the dependency graph ---
  { role: 'assistant', content: [
    { type: 'text', text: 'Let me map the dependency graph by checking all imports.' },
    { type: 'tool_use', name: 'Grep', input: { pattern: 'from \'\\./.*\\.js\'', path: '/src/auth' } }
  ] },

  // --- Turn 71: Grep results ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Grep', text: `/src/auth/password.ts:3:import { createLogger } from '../lib/logger.js';
/src/auth/tokens.ts:2:import crypto from 'crypto';
/src/auth/tokens.ts:3:import { createLogger } from '../lib/logger.js';
/src/auth/tokens.ts:4:import { AuthConfig, type User, type TokenPayload } from './types.js';
/src/auth/sessions.ts:1:import { db } from '../db/connection.js';
/src/auth/sessions.ts:2:import { EventBus } from '../lib/event-bus.js';
/src/auth/sessions.ts:3:import { createLogger } from '../lib/logger.js';
/src/auth/sessions.ts:4:import { AuthConfig, type User, type Session } from './types.js';
/src/auth/sessions.ts:9:import { generateAccessToken, generateRefreshToken } from './tokens.js';
/src/auth/login.ts:1:import crypto from 'crypto';
/src/auth/login.ts:2:import { db } from '../db/connection.js';
/src/auth/login.ts:3:import { EventBus } from '../lib/event-bus.js';
/src/auth/login.ts:4:import { createLogger } from '../lib/logger.js';
/src/auth/login.ts:5:import { AuthConfig, type User, type LoginResult, type RegisterResult } from './types.js';
/src/auth/login.ts:10:import { hashPassword, verifyPassword, isLegacyMd5Hash, migratePasswordHash } from './password.js';
/src/auth/login.ts:15:import { generateAccessToken } from './tokens.js';
/src/auth/login.ts:16:import { createSession, revokeAllUserSessions } from './sessions.js';
/src/auth/oauth.ts:1:import { db } from '../db/connection.js';
/src/auth/oauth.ts:2:import { createLogger } from '../lib/logger.js';
/src/auth/oauth.ts:3:import { OAuthClient } from '../lib/oauth-client.js';
/src/auth/oauth.ts:4:import { type User, type UserRole, type OAuthResult, type OAuthError } from './types.js';
/src/auth/oauth.ts:9:import { generateAccessToken, generateOAuthState, generateOAuthNonce } from './tokens.js';
/src/auth/oauth.ts:10:import { createSession } from './sessions.js';
/src/auth/middleware.ts:1:import { Request, Response, NextFunction } from 'express';
/src/auth/middleware.ts:2:import { createLogger } from '../lib/logger.js';
/src/auth/middleware.ts:3:import { RateLimiter } from '../lib/rate-limiter.js';
/src/auth/middleware.ts:4:import { AuthConfig, type UserRole, type TokenPayload, type Session } from './types.js';
/src/auth/middleware.ts:5:import { verifyAccessToken } from './tokens.js';
/src/auth/middleware.ts:6:import { getSessionById, touchSession } from './sessions.js';
/src/auth/handlers.ts:1:import { Request, Response } from 'express';
/src/auth/handlers.ts:2:import { createLogger } from '../lib/logger.js';
/src/auth/handlers.ts:3:import { LoginSchema, RegisterSchema, ResetPasswordSchema, ChangePasswordSchema, RefreshTokenSchema, EmailVerificationSchema, toPublicUser } from './types.js';
/src/auth/handlers.ts:8:import { login, register, verifyEmail, requestPasswordReset, resetPassword, changePassword } from './login.js';
/src/auth/handlers.ts:9:import { refreshSession, revokeSession } from './sessions.js';
/src/auth/init.ts:1:import { createLogger } from '../lib/logger.js';
/src/auth/init.ts:2:import { registerOAuthProvider } from './oauth.js';
/src/auth/init.ts:3:import { startSessionCleanup, stopSessionCleanup } from './sessions.js';` }
  ] },

  // --- Turn 72: Agent draws the dependency graph ---
  { role: 'assistant', content: 'Here is the full internal dependency graph for the auth module:\n\n```\ntypes.ts       <- (no internal deps, leaf node)\npassword.ts    <- (no internal deps, only external: logger)\ntokens.ts      <- types.ts\nsessions.ts    <- types.ts, tokens.ts\nlogin.ts       <- types.ts, password.ts, tokens.ts, sessions.ts\noauth.ts       <- types.ts, tokens.ts, sessions.ts\nmiddleware.ts  <- types.ts, tokens.ts, sessions.ts\nhandlers.ts    <- types.ts, login.ts, sessions.ts\ninit.ts        <- oauth.ts, sessions.ts\nindex.ts       <- (barrel, re-exports everything)\n```\n\nThe dependency graph is a **directed acyclic graph (DAG)**, meaning there are **no circular dependencies**. The flow is strictly one-directional:\n\n`types.ts` and `password.ts` are leaf nodes (no internal imports). `tokens.ts` depends only on `types.ts`. `sessions.ts` depends on `types.ts` and `tokens.ts`. Higher-level modules (`login.ts`, `oauth.ts`, `middleware.ts`, `handlers.ts`) depend on lower-level ones but never the reverse.\n\nThe key design decision that prevents cycles: `sessions.ts` imports from `tokens.ts` for token generation, but `tokens.ts` never imports from `sessions.ts`. Similarly, `login.ts` imports from `sessions.ts` and `password.ts`, but neither of those import from `login.ts`.\n\nNo circular dependencies exist in this module structure.' },

  // --- Turn 73: User is satisfied ---
  { role: 'user', content: 'Great analysis. One more thing: I want to add dedicated rate limiting specifically for the login endpoint. The general rate limiter allows 100 requests per 15 minutes, but login should be limited to 10 attempts per 15 minutes per IP. And password reset should be limited to 3 per 15 minutes. I see you already created loginRateLimitMiddleware and passwordResetRateLimitMiddleware in middleware.ts. Can you show me how to wire them into the Express router?' },

  // --- Turn 74: Agent shows the wiring ---
  { role: 'assistant', content: 'The rate limit middleware factories are already defined in `middleware.ts`. Here is how to wire them into the Express router:\n\n```typescript\n// /src/routes/auth.ts\nimport { Router } from \'express\';\nimport {\n  handleLogin,\n  handleRegister,\n  handleRefresh,\n  handleLogout,\n  handleVerifyEmail,\n  handleRequestReset,\n  handlePasswordReset,\n  handleChangePassword,\n  authMiddleware,\n  rateLimitMiddleware,\n  loginRateLimitMiddleware,\n  passwordResetRateLimitMiddleware,\n} from \'../auth/index.js\';\n\nconst router = Router();\n\n// Public routes with specific rate limits\nrouter.post(\'/login\', loginRateLimitMiddleware(), handleLogin);\nrouter.post(\'/register\', rateLimitMiddleware(20, 60 * 60 * 1000), handleRegister); // 20/hour\nrouter.post(\'/refresh\', rateLimitMiddleware(), handleRefresh);\nrouter.post(\'/verify-email\', handleVerifyEmail);\nrouter.post(\'/request-reset\', passwordResetRateLimitMiddleware(), handleRequestReset);\nrouter.post(\'/reset-password\', passwordResetRateLimitMiddleware(), handlePasswordReset);\n\n// Protected routes (require valid JWT)\nrouter.post(\'/logout\', authMiddleware(), handleLogout);\nrouter.post(\'/change-password\', authMiddleware(), handleChangePassword);\n\nexport { router as authRouter };\n```\n\nThe rate limit tiers:\n- **Login**: 10 requests per 15 minutes (via `loginRateLimitMiddleware`)\n- **Password reset/request**: 3 requests per 15 minutes (via `passwordResetRateLimitMiddleware`)\n- **Registration**: Custom 20 requests per 1 hour\n- **Token refresh**: General 100 requests per 15 minutes\n- **Protected routes**: No rate limit beyond what the general API middleware applies\n\nThe `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers are set by all rate limit middleware, so clients can show appropriate feedback.' },

  // --- Turn 75: User asks for final summary ---
  { role: 'user', content: 'Excellent. Let me know the final summary: file count, total lines, all the bugs found and fixed, and the test count.' },

  // --- Turn 76: Agent provides final summary ---
  { role: 'assistant', content: 'Here is the complete summary of the auth system refactor:\n\n**File Structure (10 files, 1,347 total lines):**\n```\n/src/auth/\n  index.ts       -   35 lines  (barrel re-export)\n  types.ts       -  165 lines  (interfaces, Zod schemas, AuthConfig constants)\n  password.ts    -   67 lines  (bcrypt hashing, MD5 detection, migration)\n  tokens.ts      -   82 lines  (JWT generation, verification, OAuth tokens)\n  sessions.ts    -  214 lines  (session CRUD, transaction-safe refresh, cleanup)\n  login.ts       -  244 lines  (login with lockout, registration, password reset/change)\n  oauth.ts       -  174 lines  (OAuth provider registration, flow, callback)\n  middleware.ts  -  138 lines  (auth verification, 3-tier rate limiting)\n  handlers.ts    -  178 lines  (Express route handlers with Zod validation)\n  init.ts        -   50 lines  (startup/shutdown lifecycle)\n```\n\n**Bugs Found and Fixed:**\n1. **CRITICAL - MD5 Password Hashing (line 103 of original):** Passwords were hashed with `crypto.createHash(\'md5\')`. Migrated to bcrypt with cost factor 12. Added transparent migration: legacy MD5 hashes are detected by their 32-char hex format and automatically rehashed with bcrypt on next successful login.\n\n2. **HIGH - Race Condition in Session Refresh (lines 220-260 of original):** `refreshSession()` had a TOCTOU race where two concurrent requests could both read the same refresh token, both generate new tokens, and both succeed. Fixed by wrapping the SELECT and UPDATE in `db.transaction()` with IMMEDIATE locking, so the second request waits for the lock and then finds the old token no longer matches.\n\n3. **MEDIUM - No Dedicated Login Rate Limiting:** The original had only a general rate limiter (100 req/15min). Added three tiers: login (10/15min), password reset (3/15min), and general (100/15min).\n\n**No Circular Dependencies:** The module dependency graph is a clean DAG with `types.ts` and `password.ts` as leaf nodes.\n\n**User Preferences Applied:**\n- camelCase naming throughout (no snake_case)\n- `req.authUser` and `req.authSessionId` instead of `(req as any).user` and `(req as any).sessionId`\n- Typed Express Request augmentation via `declare global`\n\n**Test Results:**\n- 98 tests across 16 test files\n- All 98 pass\n- 6 test fixes were required:\n  1. Added `transaction` mock to session tests\n  2. Updated `req.user` to `req.authUser` in middleware tests\n  3. Added logger mock to password tests\n  4. Updated error message assertion in OAuth tests\n  5. Fixed `shutdownAuth` import in init tests\n  6. Login tests resolved after password.ts was on disk\n\n**Bcrypt Configuration:**\n- Cost factor: 12 (generates hash in ~250ms)\n- Legacy MD5 detection: regex `/^[a-f0-9]{32}$/`\n- Bcrypt hashes start with `$2b$`\n- `needsRehash()` detects both MD5 hashes and bcrypt hashes with cost factor below 12\n\n**Rate Limiting Configuration:**\n- Login: 10 requests per 15-minute window per IP\n- Password reset: 3 requests per 15-minute window per IP\n- General API: 100 requests per 15-minute window per IP\n- Account lockout: 5 failed login attempts triggers 15-minute lockout' },

  // --- Turn 77: User approves commit ---
  { role: 'user', content: 'This is thorough. Commit the whole thing.' },

  // --- Turn 78: Agent commits ---
  { role: 'assistant', content: [
    { type: 'text', text: 'Creating the commit for the complete auth refactor.' },
    { type: 'tool_use', name: 'Bash', input: { command: 'cd /src && git add src/auth/ tests/auth/ && git commit -m "refactor(auth): split monolithic auth into modular files, fix MD5 vulnerability and session refresh race condition"' } }
  ] },

  // --- Turn 79: Commit result ---
  { role: 'user', content: [
    { type: 'tool_result', name: 'Bash', text: `[main abc1234] refactor(auth): split monolithic auth into modular files, fix MD5 vulnerability and session refresh race condition
 14 files changed, 1589 insertions(+), 1247 deletions(-)
 create mode 100644 src/auth/handlers.ts
 create mode 100644 src/auth/init.ts
 create mode 100644 src/auth/login.ts
 create mode 100644 src/auth/middleware.ts
 create mode 100644 src/auth/oauth.ts
 create mode 100644 src/auth/password.ts
 create mode 100644 src/auth/sessions.ts
 create mode 100644 src/auth/tokens.ts
 create mode 100644 src/auth/types.ts
 rewrite src/auth/index.ts (98%)` }
  ] },

  // --- Turn 80: Final confirmation ---
  { role: 'assistant', content: 'Committed as `refactor(auth): split monolithic auth into modular files, fix MD5 vulnerability and session refresh race condition`.\n\nThe commit changed 14 files: 9 new files created in `src/auth/`, the original `src/auth/index.ts` rewritten as a barrel, and 4 test files updated. Total: 1,589 insertions, 1,247 deletions (net +342 lines from added JSDoc, migration logic, and the race condition fix).' },
];

/**
 * Known facts that MUST survive compaction of the AUTH_REFACTOR_CONVERSATION.
 * These are specific, verifiable details from the conversation that a compaction
 * summary must preserve for the agent to remain useful.
 */
export const AUTH_REFACTOR_FACTS = [
  // Security vulnerability
  'The original auth file /src/auth/index.ts used MD5 for password hashing (crypto.createHash("md5") at line 103), which is a critical security vulnerability. It was replaced with bcrypt at cost factor 12.',

  // Race condition
  'The refreshSession function (lines 220-260 of original) had a TOCTOU race condition where two concurrent refresh requests could both succeed with the same old refresh token. Fixed by wrapping the SELECT and UPDATE in db.transaction() with IMMEDIATE locking.',

  // User preference: naming convention
  'The user explicitly requested camelCase naming throughout the auth module, no snake_case. The middleware sets req.authUser and req.authSessionId (not req.user or req.sessionId).',

  // File structure
  'The refactored auth module has 10 files totaling 1,347 lines: index.ts (35), types.ts (165), password.ts (67), tokens.ts (82), sessions.ts (214), login.ts (244), oauth.ts (174), middleware.ts (138), handlers.ts (178), init.ts (50).',

  // MD5 migration strategy
  'Legacy MD5 hashes are detected by the regex /^[a-f0-9]{32}$/ (32 hex chars). Bcrypt hashes start with $2b$. On successful login with an MD5 hash, the password is transparently rehashed with bcrypt and the salt field is set to empty string.',

  // Rate limiting tiers
  'Three rate limiting tiers: login at 10 requests per 15 minutes, password reset at 3 requests per 15 minutes, general API at 100 requests per 15 minutes. All per-IP using sliding window.',

  // Test count
  'All 98 tests pass across 16 test files after the refactor. Six test files needed fixes: sessions (transaction mock), middleware (authUser property name), password (logger mock), oauth (error message text), init (shutdownAuth static import), login (module resolution).',

  // Dependency graph
  'The auth module has no circular dependencies. types.ts and password.ts are leaf nodes with no internal imports. The graph is a DAG: types <- tokens <- sessions <- login/oauth/middleware <- handlers, and init <- oauth + sessions.',

  // Account lockout
  'Account lockout triggers after 5 failed login attempts (AuthConfig.maxFailedAttempts) and lasts 15 minutes (AuthConfig.lockoutDurationMs). Failed attempts are reset to 0 on successful login.',

  // Original file size
  'The original monolithic /src/auth/index.ts was 1,247 lines long and mixed 9 concerns: types/schemas, password hashing, JWT tokens, session management, login/registration, OAuth, middleware, route handlers, and initialization.',

  // bcrypt specifics
  'The bcrypt cost factor is 12, producing hashes in approximately 250ms. The needsRehash() function detects both legacy MD5 hashes and bcrypt hashes with a cost factor below 12.',

  // Session configuration
  'JWT access tokens expire after 15 minutes (AuthConfig.jwtExpiry). Refresh tokens expire after 7 days by default, or 30 days with rememberMe enabled. Session cleanup runs every 1 hour.',

  // Commit details
  'The commit changed 14 files with 1,589 insertions and 1,247 deletions. 9 new files were created and the original index.ts was rewritten as a barrel re-export.',

  // Password reset security
  'The handleRequestReset endpoint always returns HTTP 200 regardless of whether the email exists, to prevent email enumeration attacks. The reset token expires after 24 hours.',

  // Session refresh fix details
  'The race condition fix uses db.transaction() which issues BEGIN IMMEDIATE to acquire a write lock. A second concurrent refresh request will wait for the lock, then find the old refresh token no longer matches and return null.',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a conversation fixture as plain text (for judge context).
 */
export function conversationToText(messages: AgentMessage[]): string {
  return messages
    .map((m, i) => `[Turn ${i + 1}] ${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
    .join('\n\n---\n\n');
}
