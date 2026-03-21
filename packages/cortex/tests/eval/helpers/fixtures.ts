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
