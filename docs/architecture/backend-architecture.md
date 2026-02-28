# Backend Architecture: Modular Monolith

The Animus backend is a **modular monolith**: a single deployable package with clean internal boundaries between domain modules. This document codifies the architecture patterns, layering rules, and conventions that govern how backend code is structured.

## Why a Modular Monolith

Animus is a self-hosted, single-user application backed by SQLite. There is no need for distributed services, message queues, or separate deployment units. The monolith is the correct deployment model.

What we need is **internal structure**. Without it, a growing monolith becomes a tangle where every module can reach into every other module's internals. The modular monolith approach gives us:

- Module boundaries as clean as package boundaries, without the overhead of separate packages
- Independent testability of each domain module
- Clear dependency direction (no circular imports, no upward reaching)
- The ability to extract a module into its own package if the need ever arises

## Backend Module Map

```
packages/backend/src/
  lib/            Infrastructure (logger, event-bus, encryption, lifecycle manager)
  db/             Database connections, migrations, store modules
  utils/          Environment config, constants

  memory/         Memory system (MemoryManager, VectorStore, embeddings, observational memory)
  goals/          Goal system (GoalManager, SeedManager, salience, planning)
  tasks/          Task scheduling (TaskScheduler, TaskRunner, DeferredQueue)
  channels/       Channel isolation (ChannelManager, ProcessHost, IPC, routing)
  plugins/        Plugin system (PluginManager, lifecycle, registries)
  contacts/       Identity resolution, permission enforcement
  tools/          MCP tool registry, handlers, permission system
  speech/         STT/TTS engines, voice manager
  downloads/      Asset download manager

  heartbeat/      Tick pipeline orchestrator (gather, mind, execute, decisions)
  services/       Cross-cutting services (ContactService, TaskService, etc.)
  api/            tRPC routers and Fastify routes (transport layer)

  index.ts        Server entry point, composition root
```

## Dependency Layers

The backend is organized into four tiers. Each tier may import from tiers below it, never above.

```
Tier 4 (Transport)     api/routers/, api/routes/
                            |
Tier 3 (Orchestration)  heartbeat/
                            |
Tier 2 (Domain)         memory/, goals/, tasks/, channels/, plugins/,
                        contacts/, tools/, speech/, downloads/,
                        services/
                            |
Tier 1 (Infrastructure) lib/, db/, utils/
```

**Rules:**
- Tier 1 modules have no internal dependencies (only external packages)
- Tier 2 modules import from Tier 1 and from `@animus-labs/shared`. They do NOT import from each other unless through the event bus.
- Tier 3 (heartbeat) imports from Tier 2 and Tier 1. It is the only module allowed to coordinate across domain modules.
- Tier 4 (API) imports from services and the event bus. Routers delegate to services; they never contain business logic.

**Cross-module communication:** Use the typed `IEventBus` from `@animus-labs/shared` for lateral and upward communication. Direct imports are only valid within the same module or downward in the tier hierarchy.

## Store Architecture

Store files live in `packages/backend/src/db/stores/`. Each store is a **stateless pure-function module** covering a single domain entity group.

### Conventions

```typescript
// packages/backend/src/db/stores/goal-store.ts

import Database from 'better-sqlite3';
import { snakeToCamel } from '../utils.js';
import type { Goal } from '@animus-labs/shared';

// Every function takes `db` as its first argument.
// This makes stores testable (pass an in-memory DB) and explicit about which database they use.
export function createGoal(db: Database.Database, data: CreateGoalInput): Goal {
  // ...
}

export function getGoal(db: Database.Database, id: string): Goal | null {
  // ...
}
```

**Rules:**
- **One file per domain entity group.** A store file should cover closely related tables (e.g., `contacts` + `contact_channels`), not entire databases.
- **Target size: under 300 lines.** If a store exceeds this, look for natural split points along entity boundaries.
- **Stateless.** Stores hold no module-level state. They are pure functions that translate between SQLite rows and TypeScript types.
- **No business logic.** Stores do CRUD operations and snake_case/camelCase conversion. State machine transitions, cross-database joins, validation rules, and event emission belong in the service layer.
- **Shared helpers** (`snakeToCamel`, `intToBool`, `boolToInt`) live in `db/utils.ts` and are imported by each store.
- **Barrel re-exports.** When splitting a large store, the original filename becomes a barrel that re-exports from the new files. This preserves all existing call sites without modification.

### Database Handle Access

Database connections are managed in `db/index.ts` via lazy singleton getters (`getHeartbeatDb()`, `getSystemDb()`, etc.). These are initialized once at server startup and behave like constants thereafter. It is acceptable to call these getters inside function bodies; they are the one exception to the "no ambient singletons" rule because they are effectively infrastructure constants.

## Service Layer Pattern

Every API router delegates to a service. Services own the business logic that sits between the transport layer (routers) and the data layer (stores).

### Template

```typescript
// packages/backend/src/services/goal-service.ts

import { TRPCError } from '@trpc/server';
import { createLogger } from '../lib/logger.js';
import { getHeartbeatDb } from '../db/index.js';
import * as goalStore from '../db/stores/goal-store.js';
import { getEventBus } from '../lib/event-bus.js';
import type { Goal } from '@animus-labs/shared';

const log = createLogger('GoalService', 'heartbeat');

// Input/output types for the service's public API
export interface ActivateGoalInput { id: string; }

class GoalService {
  activateGoal(input: ActivateGoalInput): Goal {
    const db = getHeartbeatDb();
    const goal = goalStore.getGoal(db, input.id);
    if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });

    // Business logic: state machine guard
    if (goal.status !== 'proposed' && goal.status !== 'paused') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Goal cannot be activated' });
    }

    // Mutation + side effects
    goalStore.updateGoal(db, input.id, { status: 'active', activatedAt: now() });
    const updated = goalStore.getGoal(db, input.id)!;
    getEventBus().emit('goal:updated', updated);
    log.info(`Goal ${input.id} activated`);
    return updated;
  }
}

// Singleton accessor (matches existing ContactService/TaskService pattern)
let instance: GoalService | null = null;
export function getGoalService(): GoalService {
  if (!instance) instance = new GoalService();
  return instance;
}
```

### Router Pattern

```typescript
// packages/backend/src/api/routers/goals.ts

import { getGoalService } from '../../services/goal-service.js';

export const goalsRouter = router({
  activateGoal: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ input }) => getGoalService().activateGoal(input)),
});
```

**Rules:**
- Routers contain **zero business logic**. No store imports, no DB handle access, no event bus calls, no state machine checks.
- The only imports a router should need: its service getter, Zod for input validation, tRPC primitives, and `@animus-labs/shared` types.
- tRPC subscriptions (real-time via event bus) are transport concerns and may live in routers.
- If you find yourself importing a store or DB handle in a router, extract a service method first.

## Subsystem Lifecycle Pattern

Subsystems are independently constructable units of functionality that follow a consistent lifecycle interface. The heartbeat receives subsystems as dependencies; it does not construct them.

### Interface

```typescript
// packages/backend/src/lib/lifecycle.ts

export type SubsystemStatus = 'pending' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';

export interface SubsystemHealth {
  status: SubsystemStatus;
  error?: string;
  detail?: string;
}

export interface SubsystemLifecycle {
  /** Unique name for logging and health reporting */
  readonly name: string;
  /** Names of subsystems that must be running before this one starts */
  readonly dependsOn?: readonly string[];
  /** Initialize resources. Throw to signal failure (does not abort other subsystems). */
  start(): Promise<void>;
  /** Release resources. Should not throw. */
  stop(): Promise<void>;
  /** Optional health snapshot */
  healthCheck?(): SubsystemHealth;
}
```

### LifecycleManager

The `LifecycleManager` handles ordered startup, reverse shutdown, and health aggregation:

- `startAll()`: Topological sort on `dependsOn`. Failed subsystems are skipped; their dependents are also skipped and logged.
- `stopAll()`: Reverse registration order. Failures are caught and logged, never propagated.
- `health()`: Returns a status map for all registered subsystems.

### Creating a Subsystem

```typescript
// packages/backend/src/memory/memory-subsystem.ts

export class MemorySubsystem implements SubsystemLifecycle {
  readonly name = 'memory';

  embeddingProvider: LocalEmbeddingProvider | null = null;
  vectorStore: VectorStore | null = null;
  memoryManager: MemoryManager | null = null;

  async start(): Promise<void> {
    this.embeddingProvider = new LocalEmbeddingProvider();
    this.vectorStore = new VectorStore(LANCEDB_PATH, this.embeddingProvider.dimensions);
    await this.vectorStore.initialize();
    this.memoryManager = new MemoryManager(getMemoryDb(), this.vectorStore, this.embeddingProvider);
  }

  async stop(): Promise<void> {
    this.memoryManager = null;
    this.vectorStore = null;
    this.embeddingProvider = null;
  }
}
```

### Composition Root

The server entry point (`index.ts`) is the composition root where subsystems are constructed, registered, and wired together:

```typescript
const memorySub = new MemorySubsystem();
const goalSub = new GoalSubsystem(memorySub);    // dependsOn: ['memory']
const agentSub = new AgentSubsystem(onComplete);
const taskSub = new TaskSubsystem();

const lifecycle = new LifecycleManager();
lifecycle
  .register(memorySub)
  .register(goalSub)
  .register(agentSub)
  .register(taskSub)
  .register(heartbeatSub);  // always last

await lifecycle.startAll();
```

## Pipeline Dependencies Pattern

The heartbeat pipeline (gather -> mind -> execute) receives all external dependencies via typed parameter objects. No ambient singleton calls inside pipeline function bodies (except DB handle getters, which are infrastructure constants).

### Why This Matters

When a function grabs dependencies from module-level singletons inside its body, the function's type signature becomes a lie. It says "I need X and Y" but actually needs X, Y, and 8 hidden things. This makes it:

- **Untestable** without module-level mocking
- **Opaque** (must read the entire body to know what it depends on)
- **Inflexible** (can't run in alternative contexts like the sandbox)

### Structure

Each pipeline stage has its own deps type. Deps are assembled once per tick in `executeTick()`.

```typescript
// gather-context.ts
export interface GatherDeps {
  tickQueue: TickQueue;
  memoryManager: MemoryManager | null;
  seedManager: SeedManager | null;
  goalManager: GoalManager | null;
  agentOrchestrator: AgentOrchestrator | null;
  eventBus: IEventBus;
  pluginManager: PluginManager;
  channelManager: ChannelManager;
  deferredQueue: DeferredQueue;
  sessionInvalidated: boolean;
  clearSessionInvalidation: () => void;
}

export async function gatherContext(trigger: TriggerContext, deps: GatherDeps): Promise<GatherResult> {
  // All dependencies come from deps. No getPluginManager(), getChannelManager(), etc.
  const { pluginManager, channelManager, memoryManager } = deps;
  // ...
}
```

**Rules:**
- Per-stage deps types (not one mega-type). Each file's contract stays local and readable.
- Nullable fields for optional subsystems. Handlers must guard on null (graceful degradation).
- Assembly happens in `executeTick()` only. This is the single place where ambient getters are called for the pipeline.

## Decision Handler Pattern

Decision execution uses a registry-based dispatch. Each domain module registers its own handlers for the decision types it owns.

### Registry

```typescript
// packages/backend/src/heartbeat/decision-registry.ts

export type DecisionHandler = (
  params: Record<string, unknown>,
  decision: TickDecision,
  ctx: DecisionHandlerContext,
) => Promise<void>;

const handlers = new Map<string, DecisionHandler>();

export function registerDecisionHandler(type: string, handler: DecisionHandler): void;
export function getDecisionHandler(type: string): DecisionHandler | undefined;
```

### Domain Handler Registration

```typescript
// packages/backend/src/goals/decision-handlers.ts

import { registerDecisionHandler } from '../heartbeat/decision-registry.js';

registerDecisionHandler('create_seed', async (params, _decision, ctx) => {
  if (!ctx.seedManager) return;
  await ctx.seedManager.createSeed({ /* ... */ });
});

registerDecisionHandler('propose_goal', async (params, decision, ctx) => {
  // ...
});
```

**Rules:**
- One handler file per domain module (goals, tasks, channels, agents)
- Handlers are 20-50 lines each, focused on one decision type
- Registration is via side-effect imports in `decision-executor.ts`
- Plugin decisions bypass the registry and route through `pluginManager.executeDecision()` (they are dynamic, not built-in)
- Adding a new decision type requires: (1) create a handler function, (2) call `registerDecisionHandler()`, (3) add the type to `builtInDecisionTypeSchema` in shared. Zero changes to the executor.

## Anti-Patterns

These patterns should be avoided in backend code. Each one has a corresponding correct pattern described above.

| Anti-Pattern | Why It's Harmful | Correct Pattern |
|-------------|-----------------|-----------------|
| **God stores** (>300 lines, multiple entity groups) | Hard to navigate, unclear ownership | One store file per entity group |
| **Business logic in routers** (state machines, cross-db joins) | Mixes transport and domain concerns | Service layer owns logic; routers delegate |
| **Reaching through modules** (router -> heartbeat -> memoryManager) | Creates invisible coupling and startup dependencies | Independent subsystem lifecycle; services expose domain capabilities |
| **Ambient singletons in function bodies** | Hides real dependencies, prevents testing | Pipeline deps pattern; explicit parameter objects |
| **Central switch-case dispatch** | Violates open/closed; grows unbounded | Decision handler registry; domain modules register their own handlers |
| **Raw SQL in routers** (`db.exec('DELETE FROM ...')`) | Bypasses store abstraction; fragile to schema changes | Store functions for all DB operations |
| **Cross-database operations in stores** | Stores should own one database's tables | Service layer coordinates cross-db operations |
