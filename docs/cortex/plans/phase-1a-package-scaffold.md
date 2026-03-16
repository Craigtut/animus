# Phase 1A: Package Scaffolding, Types, Pure Utilities

> **Scope:** Create the `packages/cortex/` package, define all types, implement pure utility functions with no external dependencies beyond pi-agent-core and pi-ai.

## Why 1A is Separate

Types and pure utilities have zero dependencies on the CortexAgent class. They can be built, tested, and reviewed independently. Getting these right first means Phase 1B (core agent) can focus on orchestration without simultaneously debating type shapes.

## Tasks

### 1A.1: Package Scaffolding

Create the package structure:

```
packages/cortex/
  package.json          # @animus-labs/cortex
  tsconfig.json         # extends workspace tsconfig, strict mode
  vitest.config.ts      # test config
  src/
    index.ts            # barrel export
    types.ts            # all package types
  tests/
    unit/               # unit test directory
```

**package.json dependencies:**
- `@mariozechner/pi-agent-core` (peer)
- `@mariozechner/pi-ai` (peer)
- `@sinclair/typebox` (dependency)
- `zod-to-json-schema` (dependency)
- `zod` (peer, for schema converter input)

Add to workspace root `package.json` workspaces array.

Include a `"source"` export condition in `package.json` so the backend can import `.ts` source directly in dev mode (matches the pattern used by `@animus-labs/shared` and `@animus-labs/agents`).

Verify: `npm install` succeeds, `npm run typecheck` passes with empty src files. Verify pi-agent-core and pi-ai have no native bindings requiring platform-specific builds.

Update the Dockerfile to include cortex in the build pipeline (package file copy, source copy, build step between shared and backend, runtime dist copy).

Add `envOverrides?: Record<string, string>` to `CortexAgentConfig` in types.ts — consumer-set env vars that propagate to ALL subprocesses, bypassing the security blocklist (used for macOS dock icon suppression vars).

See `cross-platform-considerations.md` for full cross-platform guidance.

### 1A.2: Core Types (`types.ts`)

Define all package-level types. Reference: `cortex-architecture.md`, `context-manager.md`, `model-tiers.md`, `error-recovery.md`, `working-tags.md`.

```typescript
// Lifecycle
export type CortexLifecycleState = 'created' | 'active' | 'destroyed';

// Config
export interface CortexAgentConfig {
  model: Model;
  utilityModel?: Model | 'default';
  workingDirectory: string;
  getApiKey?: (provider: string) => Promise<string>;
  slots?: string[];
  workingTags?: { enabled?: boolean };
  budgetGuard?: { maxTurns?: number; maxCost?: number };
  maxConcurrentSubAgents?: number;
  webFetch?: { maxPerLoop?: number };
  bash?: { autoYieldThreshold?: number; shellPath?: string };
}

// Context Manager
export interface ContextManagerConfig {
  slots: string[];
}

// Error Classification
export type ErrorCategory =
  'authentication' | 'rate_limit' | 'context_overflow' |
  'server_error' | 'network' | 'cancelled' | 'unknown';

export type ErrorSeverity = 'fatal' | 'retry' | 'recoverable';

export interface ClassifiedError {
  category: ErrorCategory;
  severity: ErrorSeverity;
  originalMessage: string;
  suggestedAction?: string;
}

// Working Tags
export interface AgentTextOutput {
  userFacing: string;
  working: string | null;
  raw: string;
}

// Tool Results
export interface ToolContentDetails<T> {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
  details: T;
}

// Budget Guard
export interface BudgetGuardConfig {
  maxTurns: number;   // default: Infinity
  maxCost: number;    // default: Infinity
}

// Compaction (stub for Phase 5; needed by CortexEvents to compile)
export interface CompactionResult {
  tokensBefore: number;
  tokensAfter: number;
  turnsCompacted: number;
  turnsPreserved: number;
  summaryTokens: number;
  oldestPreservedTimestamp: string;
  summary: string;
}

// Events
export interface CortexEvents {
  onLoopComplete: () => void;
  onCompaction: (result: CompactionResult) => void;
  onCompactionError: (error: Error) => void;
  onError: (error: ClassifiedError) => void;
  onTurnComplete: (output: AgentTextOutput) => void;
  onSubAgentSpawned: (taskId: string, instructions: string) => void;
  onSubAgentCompleted: (taskId: string, result: string, status: string, usage: unknown) => void;
  onSubAgentFailed: (taskId: string, error: string) => void;
}

// Model Tiers
export interface UtilityModelDefaults {
  [provider: string]: string;  // provider -> model ID
}
```

**Tests:** Type compilation only (no runtime behavior to test).

### 1A.3: Schema Converter (`schema-converter.ts`)

**Reference:** `cortex-architecture.md` (Schema Conversion section)

```typescript
import { zodToJsonSchema } from 'zod-to-json-schema';
import { Type, type TSchema } from '@sinclair/typebox';

export function zodToTypebox(zodSchema: z.ZodType): TSchema {
  const jsonSchema = zodToJsonSchema(zodSchema);
  return Type.Unsafe(jsonSchema);
}
```

Pure function. Four lines.

**Tests:** Convert a Zod object schema to TypeBox, verify the JSON Schema intermediate is correct.

### 1A.4: Token Estimator (`token-estimator.ts`)

**Reference:** `cortex-architecture.md` (Token Tracking section)

```typescript
export function estimateTokens(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * 1.3);
}
```

Pure function. Duplicate of `@animus-labs/shared` utility, kept inline to avoid dependency.

**Tests:** Known input/output pairs.

### 1A.5: Working Tags Parser (`working-tags.ts`)

**Reference:** `working-tags.md`

Three exported pure functions:
- `stripWorkingTags(text: string): string`
- `extractWorkingContent(text: string): string | null`
- `parseWorkingTags(text: string): AgentTextOutput`

Parsing rules:
- Flat delimiters: `<working>` opens, `</working>` closes. No nesting.
- Multiple blocks concatenated (newline-separated) in `working`.
- Whitespace between closing tag and subsequent text normalized.
- Unclosed tag: all content after opening tag treated as working.
- Simple regex, not a full XML parser.

**Tests:** All edge cases from `working-tags.md` Edge Cases table:
- No working tags (all user-facing)
- Single working block
- Multiple working blocks
- Nested tags (treated as flat)
- Unclosed tag
- Working tags in tool results (not affected)
- Empty working block
- Working block with only whitespace

### 1A.6: Error Classifier (`error-classifier.ts`)

**Reference:** `error-recovery.md`

```typescript
export function classifyError(
  error: Error | string,
  options?: { contextWindow?: number; wasAborted?: boolean }
): ClassifiedError;
```

Pure function. The `wasAborted` flag handles cancelled detection (the caller checks `agent.state` or `AbortSignal.aborted` and passes the boolean; the classifier itself remains pure). Checks error string against regex patterns in priority order:

1. Cancelled (if `wasAborted === true`, return `cancelled` immediately)
2. Authentication patterns (9 regexes, per `error-recovery.md`)
3. Rate limit patterns (7 regexes)
4. Context overflow (delegates to pi-ai `isContextOverflow`)
5. Server error patterns (7 regexes)
6. Network patterns (8 regexes)
7. Unknown (catch-all)

First match wins. Returns `ClassifiedError` with category, severity, and suggested action.

**Note:** The `getApiKey` callback can throw. When it does, the thrown error is classified as `authentication` (the message will match patterns like "Could not resolve API key"). The callback contract: throw on failure, return string on success. Never return empty string.

**Tests:** One test per category with representative error strings. Test priority ordering (auth before rate limit). Test `wasAborted: true` produces `cancelled`. Test a string matching both auth and rate_limit patterns classifies as auth (priority). Test context overflow delegation to pi-ai `isContextOverflow()`.

## Completion Criteria

- Package scaffolding complete, `npm install` and `npm run typecheck` pass
- All types defined and compiling
- All five pure utility modules have full unit test coverage
- Zero dependencies on CortexAgent, ContextManager, or any other cortex module
- Package exports all Phase 1A utilities and types from `index.ts` (partial package; later phases add more exports)

## Files Created

| File | Purpose |
|------|---------|
| `packages/cortex/package.json` | Package manifest |
| `packages/cortex/tsconfig.json` | TypeScript config |
| `packages/cortex/vitest.config.ts` | Test config |
| `packages/cortex/src/index.ts` | Barrel export |
| `packages/cortex/src/types.ts` | All package types |
| `packages/cortex/src/schema-converter.ts` | Zod -> TypeBox |
| `packages/cortex/src/token-estimator.ts` | Token heuristic |
| `packages/cortex/src/working-tags.ts` | Tag parser |
| `packages/cortex/src/error-classifier.ts` | Error classification |
| `packages/cortex/tests/unit/schema-converter.test.ts` | Tests |
| `packages/cortex/tests/unit/token-estimator.test.ts` | Tests |
| `packages/cortex/tests/unit/working-tags.test.ts` | Tests |
| `packages/cortex/tests/unit/error-classifier.test.ts` | Tests |
