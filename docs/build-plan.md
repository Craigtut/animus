# Animus Build Plan

Master execution plan for building Animus from documentation to working system.

## Current State (as of Sprint 0 start)

- **Architecture**: 100% designed across 15+ detailed docs in `docs/`
- **Implementation**: ~5-10% (types, scaffolding, partial agent adapters)

### Existing Codebase Inventory

**`@animus/shared` (packages/shared/) — MOSTLY COMPLETE**
- `src/types/index.ts` (364 lines) — Core TypeScript interfaces for all entities: User, Session, HeartbeatState, Thought, Experience, EmotionState (12 emotions), Task, Channel, Conversation, Message, Contact, ContactChannel, Agent types, Settings
- `src/schemas/index.ts` (392 lines) — Zod schemas for all types above including auth, heartbeat, emotions, tasks, messages, contacts, channels, agent config
- `src/utils/index.ts` (90 lines) — Utilities: generateUUID, now, expiresIn, isExpired, sleep, clamp, safeJsonParse, omit, pick

**`@animus/agents` (packages/agents/) — INTERFACE COMPLETE, ADAPTERS STUBBED**
- `src/types.ts` (563 lines) — Full type definitions: IAgentAdapter, IAgentSession, AgentEvent, hooks, MCP config, session config
- `src/schemas.ts` (231 lines) — Zod validation with discriminated union for provider configs
- `src/errors.ts` (223 lines) — Error classes with category/severity mapping
- `src/logger.ts` (155 lines) — Logger interface and implementations
- `src/manager.ts` (343 lines) — AgentManager: adapter registration, session lifecycle, cleanup, signal handlers
- `src/capabilities.ts` (149 lines) — Per-provider capability constants and helpers
- `src/adapters/base.ts` (308 lines) — BaseAdapter and BaseSession abstract classes (fully implemented)
- `src/adapters/claude.ts` — **STUB** — extends base, implementation pending
- `src/adapters/codex.ts` — **STUB** — extends base, implementation pending
- `src/adapters/opencode.ts` — **STUB** — extends base, implementation pending
- `src/utils/` — retry logic, session ID parsing (implemented)
- `tests/` — Skeleton test files exist but are empty/minimal

**`@animus/backend` (packages/backend/) — SCAFFOLDING**
- `src/index.ts` (121 lines) — Fastify server entry point with CORS, cookies, WebSocket, static, tRPC, health check, SPA fallback, graceful shutdown
- `src/api/index.ts` (87 lines) — tRPC setup with context, public/protected procedures, appRouter with health check. Sub-routers commented out.
- `src/db/index.ts` (389 lines) — **4 SQLite databases** (system, heartbeat, messages, agent_logs) with full DDL schema, WAL mode, foreign keys. NOTE: docs specify 5 databases (adds memory.db) but current code only has 4.
- `src/heartbeat/index.ts` (264 lines) — Heartbeat skeleton with 7-phase pipeline structure, tick management, interval timer. **Phase handlers are all TODO stubs.**
- `src/utils/env.ts` (49 lines) — Zod-validated environment config

**`@animus/frontend` (packages/frontend/) — SCAFFOLDING**
- `src/App.tsx` (42 lines) — React app with tRPC provider, React Query, Emotion theme, routing
- `src/main.tsx` (16 lines) — React 19 bootstrap
- `src/store/index.ts` (73 lines) — Zustand stores: useAuthStore, useUIStore, useSettingsStore
- `src/pages/HomePage.tsx` (191 lines) — Landing page with animated hero and feature cards
- `src/pages/DashboardPage.tsx` (199 lines) — Dashboard with placeholder cards
- `src/pages/LoginPage.tsx` — Stub
- `src/pages/SettingsPage.tsx` — Stub
- `src/utils/trpc.ts` (57 lines) — tRPC client setup with HTTP + WebSocket split link
- `src/styles/theme.ts` (173 lines) — Full theme object (colors, typography, spacing, radii, shadows, breakpoints)

### Key Gaps in Existing Code vs Architecture Docs

1. **memory.db is missing** — docs specify 5 databases, code only creates 4. Sprint 0 must add memory.db.
2. **Heartbeat pipeline** — docs specify a 3-stage pipeline (Gather→Mind→Execute), code has a 7-phase stub. The code needs to be realigned to the documented 3-stage design.
3. **Shared types may need expansion** — existing types cover the basics but may not match all fields specified in the architecture docs. Audit needed.
4. **No database store layer** — schemas exist for creating tables, but there are no typed query/CRUD functions.
5. **No migration system** — tables are created inline in db/index.ts, not via versioned migrations.
6. **No shared abstractions** — DecayEngine, EventBus, EncryptionService, EmbeddingProvider don't exist yet.
7. **No auth module** — no argon2, no JWT auth middleware, no user registration/login logic.

---

## Agent Team Roster

All agents are defined in `.claude/agents/` and use Opus 4.6 with the `doc-explorer` skill.

| Agent | Role | Owns | Skills |
|-------|------|------|--------|
| `shared-foundation` | Types, schemas, DB, migrations, shared abstractions | `packages/shared/`, `packages/backend/src/db/` | doc-explorer |
| `backend-builder` | Heartbeat pipeline, emotions, persona, context builder, API routes | `packages/backend/src/` (excluding db/) | doc-explorer |
| `agent-sdk` | Agent SDK adapters, agent manager, orchestration | `packages/agents/` | doc-explorer |
| `feature-systems` | Memory, goals, tasks, contacts, channels, MCP tools | `packages/backend/src/` (feature modules) | doc-explorer |
| `product-designer` | UX flows, information hierarchy, interaction design, micro-interactions | `docs/frontend/specs/` (output only, no code) | doc-explorer |
| `frontend-builder` | React pages, components, stores, animations | `packages/frontend/` | doc-explorer, frontend-design |

---

## Sprint 0: Foundation (Single Session — No Team)

**Why single session**: Everything here touches `packages/shared` and `packages/backend/src/db/` — heavy file overlap, sequential dependencies. A team would cause constant conflicts.

**Goal**: Build the foundation that every other system imports from. When done, all databases exist, all stores are operational, shared abstractions work, auth works, and the server starts cleanly.

**IMPORTANT**: Before implementing anything, use `/doc-explorer` to load the relevant architecture docs. The docs are the source of truth.

### Step 0.1 — Audit & Expand Shared Types and Zod Schemas

**Start by reading**: `docs/architecture/tech-stack.md`, then each system's doc as you define its types.

The existing `packages/shared/src/types/index.ts` and `packages/shared/src/schemas/index.ts` have the basics but need to be audited against the architecture docs and expanded. Go system by system:

**system.db entities** (check against `docs/architecture/contacts.md`, `docs/architecture/persona.md`, `docs/architecture/channels.md`, `docs/architecture/tech-stack.md`):
- User (id, email, password_hash, created_at)
- Settings (key-value with typed values)
- Contact (id, name, is_primary, tier: primary/standard/unknown, notes, created_at, updated_at)
- ContactChannel (id, contact_id, channel: web/sms/discord/api, identifier, verified, created_at)
- ApiKey (id, provider: claude/codex/opencode, encrypted_key, created_at)
- Persona (full structure from persona.md: existence_paradigm, identity, dimensions (10 sliders), traits, ranked_values, background, personality_notes)
- PersonaDraft (same shape as Persona, stored during onboarding before finalization)
- OnboardingState (current_step, completed_steps[], is_complete)
- ChannelConfig (channel, config JSON — Twilio credentials, Discord bot token, etc.)

**heartbeat.db entities** (check against `docs/architecture/heartbeat.md`):
- HeartbeatState (tick_count, last_tick_at, status: running/paused/error, session_warmth: warm/cooling/cold, pipeline_progress for crash recovery)
- TickLog (id, tick_id, trigger: interval/message/scheduled_task/agent_complete, started_at, completed_at, stage, error)
- Thought (id, tick_id, content, type, created_at, expires_at — TTL-based)
- Experience (id, tick_id, content, emotional_tags[], created_at)
- EmotionState (one row per emotion × 12 fixed emotions, each with: emotion_name, intensity 0-1, baseline 0-1, last_updated)
- TickDecision (id, tick_id, decision_type: send_reply/spawn_agent/create_task/update_agent/dismiss, target, payload, outcome: executed/dropped/failed, reason)
- MindOutput schema (thoughts[], experiences[], emotion_deltas{}, decisions[], reply?) — this is NOT a DB table, it's the structured output from the mind agent. Define as a Zod schema.

**memory.db entities** (check against `docs/architecture/memory.md`):
- WorkingMemory (id, contact_id, content, updated_at) — per-contact AI-maintained notepad
- CoreSelf (singleton row — content, updated_at) — agent's self-knowledge
- LongTermMemory (id, content, importance 0-1, strength 0-1, source, tags[], created_at, last_accessed_at)
- NOTE: Vector embeddings are stored in LanceDB (separate from SQLite). LongTermMemory in SQLite stores metadata; LanceDB stores vectors with a foreign key back to the SQLite row.

**messages.db entities** (check against `docs/architecture/channels.md`):
- Conversation (id, contact_id, channel, started_at, last_message_at, metadata)
- Message (id, conversation_id, role: user/assistant/system, content, channel, contact_id, created_at)

**agent_logs.db entities** (check against `docs/architecture/agent-orchestration.md`):
- AgentSession (id, provider, model, purpose, parent_session_id nullable, started_at, ended_at, total_tokens, prompt_tokens, completion_tokens, estimated_cost)
- AgentEvent (id, session_id, event_type, data JSON, timestamp)
- ToolCallLog (id, session_id, event_id, tool_name, input JSON, output JSON, error, duration_ms, timestamp)

**Pattern**: Define Zod schemas first, derive TypeScript types with `z.infer<>`. Group by database. Export everything from barrel files.

### Step 0.2 — Migration System

**Read**: `docs/architecture/tech-stack.md` (migrations section)

Build a simple custom migration system (~50 lines):

```
packages/backend/src/db/
  migrations/
    system/
      001_initial.sql
    heartbeat/
      001_initial.sql
    memory/
      001_initial.sql
    messages/
      001_initial.sql
    agent_logs/
      001_initial.sql
  migrate.ts          # The migration runner
```

**How it works**:
- Each database has a `_migrations` table: `(version INTEGER, applied_at TEXT)`
- On startup, for each database: read all `.sql` files, check which versions are already applied, run unapplied ones in order
- Each `.sql` file contains the DDL for that version
- Idempotent — safe to run repeatedly
- Replace the current inline DDL in `src/db/index.ts` with migration files

**IMPORTANT**: The current `src/db/index.ts` creates only 4 databases. The migration system must create **5 databases** (add memory.db). Move all existing DDL from the inline code into `001_initial.sql` files.

### Step 0.3 — Database Store Layer

Create typed store classes for each database:

```
packages/backend/src/db/
  stores/
    system-store.ts     # Users, contacts, settings, api_keys, persona, onboarding
    heartbeat-store.ts  # Tick state, thoughts, experiences, emotions, decisions
    memory-store.ts     # Working memory, core self, long-term memories
    message-store.ts    # Conversations, messages
    agent-log-store.ts  # Sessions, events, tool calls
  index.ts              # Re-exports, DB connection management
```

**Pattern for each store**:
```typescript
export class SystemStore {
  constructor(private db: Database) {}

  // Users
  createUser(data: CreateUserInput): User { /* validate with Zod, insert, return typed */ }
  getUserByEmail(email: string): User | null { /* query, parse, return */ }

  // Contacts
  createContact(data: CreateContactInput): Contact { /* ... */ }
  getContact(id: string): Contact | null { /* ... */ }
  getPrimaryContact(): Contact | null { /* ... */ }
  // ... etc
}
```

- Constructor takes a `better-sqlite3` Database instance
- All inputs validated with Zod before writing
- All outputs parsed through Zod schemas to ensure type safety
- Methods return typed objects (not raw rows)
- Use prepared statements for performance

### Step 0.4 — Shared Abstractions

**Read**: `docs/architecture/tech-stack.md` (shared abstractions section), `docs/architecture/memory.md` (for decay/embedding details)

Build in `packages/shared/src/` or `packages/backend/src/lib/` (decide based on whether agents package needs them — if only backend uses them, keep in backend):

1. **DecayEngine** (`decay-engine.ts`)
   - `calculateRetention(hours: number, strength: number): number` → `e^(-hours / (strength * 720))`
   - `shouldPrune(retention: number, importance: number): boolean` → `retention < 0.1 && importance < 0.3`
   - `decayEmotion(current: number, baseline: number, hoursSinceUpdate: number): number` — exponential decay toward baseline
   - Pure functions, no side effects, easy to test

2. **EventBus** (`event-bus.ts`)
   - Type-safe event emitter
   - Define an `EventMap` type that maps event names to payload types
   - Methods: `on(event, handler)`, `off(event, handler)`, `emit(event, payload)`, `once(event, handler)`
   - Used for heartbeat events, message events, agent events across the backend

3. **EncryptionService** (`encryption-service.ts`)
   - AES-256-GCM using Node.js `crypto`
   - Constructor takes an app secret (from env `JWT_SECRET` or a separate `ENCRYPTION_KEY`)
   - Methods: `encrypt(plaintext: string): string` (returns base64), `decrypt(ciphertext: string): string`
   - Used for API key storage in system.db

4. **EmbeddingProvider** (`embedding-provider.ts`)
   - Lazy-loads Transformers.js with BGE-small-en-v1.5 model
   - Method: `embed(text: string): Promise<Float32Array>`, `embedBatch(texts: string[]): Promise<Float32Array[]>`
   - First call downloads/caches the model, subsequent calls are fast
   - This can be a later Sprint 0 item since it's only needed for memory system (Sprint 2). Include the interface now, implementation can be deferred.

### Step 0.5 — Auth Module

**Read**: `docs/architecture/tech-stack.md` (auth section), `docs/frontend/onboarding.md` (auth screens section)

Build auth as a Fastify plugin + tRPC middleware:

```
packages/backend/src/auth/
  index.ts      # Fastify plugin that registers JWT + cookie
  middleware.ts  # tRPC middleware for protected procedures
```

**Requirements**:
- `@fastify/jwt` for token generation/verification
- `argon2` for password hashing
- `@fastify/cookie` for HTTP-only cookie transport
- First-user bootstrap: registration is open ONLY until the first user is created, then locked
- JWT stored in HTTP-only secure cookie, 7-day expiry (configurable via `SESSION_EXPIRY_DAYS`)
- tRPC `protectedProcedure` middleware that verifies JWT and injects user into context
- Auth status endpoint: `GET /auth/status` → `{ registrationOpen: boolean, hasUser: boolean }`

### Step 0.6 — Server Integration

**Update the existing `packages/backend/src/index.ts`** to:
- Initialize all 5 database connections (add memory.db)
- Run migrations on startup
- Register auth plugin
- Initialize stores and make them available in tRPC context
- Add auth tRPC routes (signup, login, logout, status)
- Add basic settings routes
- Add onboarding state routes
- Keep WebSocket support for future subscriptions
- Health check returns database connectivity status

### Acceptance Criteria (Definition of Done for Sprint 0)

All of the following must be true before moving to Sprint 1:

- [ ] `npm run typecheck` passes with zero errors across all packages
- [ ] `npm run test:run` passes — unit tests for all stores, all shared abstractions, auth module
- [ ] `npm run dev:backend` starts the server successfully
- [ ] All 5 SQLite databases are created via migrations on first startup
- [ ] A user can register (first user only), log in, and receive an auth cookie
- [ ] Registration is locked after first user is created
- [ ] Auth status endpoint correctly reports registration state
- [ ] All database stores can CRUD their entities (verified by tests)
- [ ] EncryptionService can encrypt/decrypt API keys (verified by tests)
- [ ] DecayEngine calculates retention and prune thresholds correctly (verified by tests)
- [ ] EventBus emits and receives typed events (verified by tests)
- [ ] No lint errors (`npm run lint`)
- [ ] All existing frontend code still works (`npm run dev:frontend` starts without errors)

---

## Sprint 1: Core Systems (Agent Team — 3 Teammates)

**Team composition**: `agent-sdk` + `backend-builder` + `product-designer`

Each teammate owns a completely separate directory. Zero file conflicts.

### agent-sdk Teammate Tasks

1. **Complete Claude Adapter**
   - Full `IAgentAdapter` implementation using `@anthropic-ai/claude-agent-sdk`
   - Session creation with system prompt, structured output (JSON schema)
   - Streaming with normalized `AgentEvent` emissions
   - Token usage tracking per session
   - MCP tool support (in-process server)

2. **Stub Codex & OpenCode Adapters**
   - Implement `IAgentAdapter` interface with basic prompt/response
   - Mark unsupported features (sub-agents, cancel) clearly
   - These don't need to be fully functional yet — Claude is the default

3. **Agent Manager Enhancements**
   - Session warmth tracking (warm/cooling/cold)
   - Crash recovery — resume or restart sessions from persisted state
   - Concurrency limits (configurable max sessions)

4. **Event Logging Integration**
   - All sessions auto-log to agent_logs.db via AgentLogStore
   - Session start/end, all inputs/outputs, tool calls, token usage, timing

### backend-builder Teammate Tasks

1. **Heartbeat Pipeline — Gather Stage**
   - Assemble tick context: trigger info, emotional state, recent thoughts, active goals, running sub-agents
   - Load contact context when trigger is a message
   - Respect token budgets per section

2. **Heartbeat Pipeline — Mind Stage**
   - Create/reuse agent session with compiled persona prompt
   - Send gathered context as structured prompt
   - Parse MindOutput (thoughts, experiences, emotion_deltas, decisions, reply)
   - Handle streaming with `llm-json-stream`

3. **Heartbeat Pipeline — Execute Stage**
   - Persist thoughts, experiences to heartbeat.db
   - Apply emotion deltas with decay
   - Execute decisions (send_reply, spawn_agent, create_task, update_agent)
   - Log tick decisions with outcomes
   - Cleanup expired entries (TTL-based)

4. **Tick Trigger System**
   - Interval timer (configurable, default 5 min)
   - Message-received trigger (debounced)
   - Scheduled-task trigger
   - Sub-agent completion trigger
   - Tick queue with priority ordering

5. **Emotion Engine**
   - 12 fixed emotions with current intensity and personality baseline
   - Delta-based updates from MindOutput
   - Exponential decay toward baselines between ticks
   - Baseline computation from persona dimension sliders

6. **Persona Compilation**
   - Convert slider zones to behavioral text (non-neutral dimensions only)
   - Compile traits into personality texture
   - Compile ranked values into decision-making framework
   - Compile existence paradigm, identity, background, notes
   - Four compilation targets: mind system prompt, sub-agent prompt, context summary, self-description

7. **tRPC Routes + Subscriptions**
   - Heartbeat state subscription (real-time tick updates)
   - Emotion state subscription
   - Message send/receive routes
   - Settings CRUD
   - Onboarding state routes

### product-designer Teammate Tasks

1. **Main Dashboard Spec** — `docs/frontend/specs/dashboard.md`
   - The primary view after onboarding. What does the user see?
   - Heartbeat visualization (the "alive" indicator)
   - Current emotional state display
   - Recent thoughts/activity feed
   - Quick message input

2. **Chat Interface Spec** — `docs/frontend/specs/chat.md`
   - Conversation view with Animus
   - Message history, real-time incoming messages
   - Typing/thinking indicators
   - Multi-channel awareness

3. **Settings Page Spec** — `docs/frontend/specs/settings.md`
   - Agent provider configuration
   - Heartbeat interval control
   - Channel management
   - Persona editing (re-access onboarding persona steps)
   - Contact management

**Deliverable**: The heartbeat can tick, the mind can think, emotions decay, persona compiles into prompts, Claude adapter streams responses, and we have design specs ready for the frontend.

---

## Sprint 2: Feature Systems (Agent Team — 4-5 Teammates)

**Team composition**: `feature-systems` (split across 2-3 teammates by subsystem) + `frontend-builder` + `product-designer`

This is the highest-parallelism sprint. Each feature module is independent.

### feature-systems Teammate(s) Tasks

Split into sub-assignments to avoid file conflicts:

**Teammate A — Memory + Goals:**

1. **Memory System** — `packages/backend/src/memory/`
   - LanceDB integration for vector storage
   - Embedding pipeline (text → BGE-small-en-v1.5 → vector)
   - Short-term memory (recent context, in-memory buffer)
   - Working memory CRUD (per-contact notepad, AI-maintained)
   - Core self (singleton, agent's self-knowledge)
   - Long-term memory write pipeline: dedup → embed → store
   - Retrieval scoring: `0.4 * relevance + 0.3 * importance + 0.3 * recency`
   - Forgetting: `retention = e^(-hours / (strength * 720))`, prune when < 0.1 AND importance < 0.3
   - Memory consolidation (periodic merge of similar memories)

2. **Goal System** — `packages/backend/src/goals/`
   - Seeds with transient in-memory embeddings
   - Seed-to-goal promotion based on resonance across ticks
   - Goal lifecycle (active, paused, completed, abandoned)
   - Plans as ordered step sequences
   - Salience scoring for goal prioritization in context
   - Emotional resonance: `clamp((intensity - baseline) * 0.4, -0.2, 0.2)`

**Teammate B — Tasks + Contacts + Channels:**

3. **Task System** — `packages/backend/src/tasks/`
   - Scheduled tasks with cron expressions, recurring support
   - Deferred tasks (execute on idle ticks)
   - Task lifecycle, `contact_id` routing, parallel execution

4. **Contact System** — `packages/backend/src/contacts/`
   - Multi-channel identity resolution, permission tiers, contact notes vs working memory, message isolation

5. **Channel Adapters** — `packages/backend/src/channels/`
   - Web (finalize), SMS (Twilio), Discord, API (OpenAI/Ollama compatible), channel router

**Teammate C — MCP Tools:**

6. **MCP Tool System** — `packages/backend/src/tools/`
   - Tool registry, handlers, hybrid transport, permission filtering, tool call logging

### product-designer Teammate Tasks

7. **Memory Browser Spec** — `docs/frontend/specs/memory-browser.md`
8. **Goal & Task Viewer Spec** — `docs/frontend/specs/goals-tasks.md`
9. **Inner Life Visualization Spec** — `docs/frontend/specs/inner-life.md`

### frontend-builder Teammate Tasks

10. **Auth Flow** — Sign up, login, route guards, session management
11. **Onboarding Flow** (from `docs/frontend/onboarding.md`) — All steps including persona creation and birth animation
12. **Main Dashboard** (from Sprint 1 design spec)

**Deliverable**: All feature systems operational, auth + onboarding + dashboard implemented in frontend.

---

## Sprint 3: Integration & Polish (Agent Team — 3 Teammates)

**Team composition**: `backend-builder` + `frontend-builder` + `product-designer`

### backend-builder Tasks

1. **Context Builder Integration** — Wire all systems into prompt assembly with token budgets
2. **Sub-Agent Orchestration** — Delegation, progress tracking, result delivery, update forwarding
3. **End-to-End Pipeline Test** — Full tick cycle, message flow, crash recovery

### frontend-builder Tasks

4. **Chat Interface** (from Sprint 1 design spec)
5. **Settings Page** (from Sprint 1 design spec)
6. **Memory Browser** (from Sprint 2 design spec)
7. **Goal & Task Viewer** (from Sprint 2 design spec)
8. **Inner Life Visualization** (from Sprint 2 design spec)
9. **Real-time Subscriptions** — wire all tRPC subscriptions for live updates

### product-designer Tasks

10. **Contact Management Spec** — `docs/frontend/specs/contacts.md`
11. **Agent Logs Viewer Spec** — `docs/frontend/specs/agent-logs.md`
12. **Final Polish Pass** — review all implemented screens against design principles

---

## Sprint 4: Hardening (Single Session)

**Why single session**: Integration testing, bug fixing, and refinement — sequential by nature.

1. **Error handling audit** — verify all 4 tiers (Retryable, Recoverable, Critical, Fatal)
2. **Crash recovery testing** — kill at every pipeline stage, verify clean recovery
3. **Performance** — heartbeat tick timing, UI responsiveness
4. **Security audit** — API key encryption, auth flow, route guards, permission enforcement
5. **Test coverage** — fill gaps in unit and integration tests
6. **Documentation** — update any docs that diverged during implementation

---

## Execution Notes

### Before Starting Any Sprint

1. Read this build plan
2. Use `/doc-explorer` to load architecture docs for the relevant systems
3. Ensure `npm run typecheck` passes
4. Ensure `npm run test:run` passes (if tests exist)
5. Commit the current state before starting new work

### Team Ground Rules

- **File ownership is sacred** — never edit files outside your domain without coordinating
- **Types are contracts** — if you need a type change in `packages/shared`, request it from the lead; don't modify it yourself
- **Test what you build** — every module needs unit tests
- **Read the docs first** — always `/doc-explorer` before implementing
- **Product designer runs before frontend** — design specs must exist before code is written
- **Frontend builder uses `frontend-design` skill** — always invoke it when building UI

### When to Use Teams vs Single Session

| Situation | Approach |
|-----------|----------|
| Building shared types/schemas | Single session |
| Independent modules across packages | Agent team |
| Iterating on the same file | Single session |
| Bug fixing | Single session |
| Feature modules with clear boundaries | Agent team |
| Integration/wiring | Single session |

### Key Documentation References

All architecture docs live in `docs/`. Use `/doc-explorer <topic>` to load them. The most critical for each sprint:

- **Sprint 0**: `tech-stack.md`, `contacts.md`, `persona.md`, `heartbeat.md`, `memory.md`, `channels.md`
- **Sprint 1**: `heartbeat.md`, `agent-orchestration.md`, `context-builder.md`, `persona.md`
- **Sprint 2**: `memory.md`, `goals.md`, `tasks-system.md`, `contacts.md`, `channels.md`, `mcp-tools.md`, `onboarding.md`, `design-principles.md`
- **Sprint 3**: `context-builder.md`, `agent-orchestration.md`, `design-principles.md`, `brand-vision.md`
