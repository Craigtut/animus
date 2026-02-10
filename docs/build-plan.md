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

## Sprint 1: Core Systems (Agent Team — 4 Teammates)

**Team composition**: `agent-sdk` + `backend-builder` + `product-designer` + `frontend-reviewer`

Each teammate owns a completely separate domain. Zero file conflicts.

**NOTE on existing work**: The Claude adapter in `packages/agents/src/adapters/claude.ts` is already substantially implemented (838 lines) — not a stub. It has session creation, prompt/streaming, tool call handling, hook integration, and abort support. The Codex and OpenCode adapters also have working implementations. The agent-sdk teammate should build on this existing work, not rewrite it.

**NOTE on design specs**: A product designer has already written comprehensive specs for all frontend pages in `docs/frontend/`. The specs cover: design-principles, onboarding, app-shell, presence (dashboard + chat), mind (emotions, thoughts, memories, goals, agents), people (contacts), settings, and voice-mode. These are detailed and implementation-ready. The product-designer and frontend-reviewer teammates are doing **review/audit** work, not creating new specs.

### agent-sdk Teammate Tasks

**Owns**: `packages/agents/`

1. **Validate & Harden Claude Adapter**
   - The adapter is largely implemented — test it against the actual Claude Agent SDK
   - Ensure structured output (JSON schema) works for MindOutput parsing
   - Verify streaming with normalized `AgentEvent` emissions is correct
   - Confirm token usage tracking produces accurate numbers
   - Fix any bugs found during integration testing
   - Add MCP tool support if not already working (in-process server)

2. **Validate Codex & OpenCode Adapters**
   - Verify existing implementations work against real providers
   - Mark unsupported features (sub-agents, cancel) clearly in code + docs
   - These don't need to be fully functional yet — Claude is the default

3. **Agent Manager Enhancements**
   - Session warmth tracking (warm/cooling/cold) — integrate with heartbeat session state
   - Crash recovery — resume or restart sessions from persisted state
   - Concurrency limits (configurable max sessions)

4. **Event Logging Integration**
   - Wire sessions to auto-log to agent_logs.db via the agent-log-store from Sprint 0
   - Session start/end, all inputs/outputs, tool calls, token usage, timing
   - Create a logging hook that can be attached to any session

5. **Tests**
   - Unit tests for all adapter logic (mocked SDK calls)
   - Integration test for Claude adapter (requires API key, can be skipped in CI)

### backend-builder Teammate Tasks

**Owns**: `packages/backend/src/` (excluding `db/`)

1. **Heartbeat Pipeline — Gather Stage**
   - Assemble tick context: trigger info, emotional state, recent thoughts, active goals, running sub-agents
   - Load contact context when trigger is a message
   - Respect token budgets per section (from system_settings.session_context_budget)

2. **Heartbeat Pipeline — Mind Stage**
   - Create/reuse agent session with compiled persona prompt
   - Send gathered context as structured prompt
   - Parse MindOutput (thoughts, experiences, emotion_deltas, decisions, reply)
   - Handle streaming with `llm-json-stream`

3. **Heartbeat Pipeline — Execute Stage**
   - Persist thoughts, experiences to heartbeat.db via heartbeat-store
   - Apply emotion deltas with decay (using DecayEngine from shared)
   - Execute decisions (send_reply, spawn_agent, create_task, update_agent)
   - Log tick decisions with outcomes via heartbeat-store
   - Cleanup expired entries (TTL-based) via heartbeat-store

4. **Tick Trigger System**
   - Interval timer (configurable, default 5 min)
   - Message-received trigger (debounced)
   - Scheduled-task trigger
   - Sub-agent completion trigger
   - Tick queue with priority ordering
   - Use EventBus for trigger coordination

5. **Emotion Engine**
   - 12 fixed emotions with current intensity and personality baseline
   - Delta-based updates from MindOutput
   - Exponential decay toward baselines between ticks (using DecayEngine)
   - Baseline computation from persona dimension sliders

6. **Persona Compilation**
   - Convert slider zones to behavioral text (non-neutral dimensions only)
   - Compile traits into personality texture
   - Compile ranked values into decision-making framework
   - Compile existence paradigm, identity, background, notes
   - Four compilation targets: mind system prompt, sub-agent prompt, context summary, self-description

7. **tRPC Routes + Subscriptions**
   - Heartbeat state subscription (real-time tick updates via EventBus)
   - Emotion state subscription
   - Message send/receive routes (using message-store from Sprint 0)
   - Onboarding state routes

8. **Tests**
   - Unit tests for each pipeline stage (mocked agent sessions)
   - Unit tests for emotion engine, persona compilation
   - Integration test for full tick cycle

### product-designer Teammate Tasks

**Owns**: `docs/frontend/` (review + patches only, no new files)

The product designer has already written comprehensive specs in `docs/frontend/` covering all pages and flows. This teammate reviews and audits what exists rather than creating new specs.

1. **Spec Consistency Audit**
   - Read all 8 existing spec files: design-principles, onboarding, app-shell, presence, mind, people, settings, voice-mode
   - Check for internal consistency: do component names, animation timings, color references, and interaction patterns agree across specs?
   - Check for completeness: are there any UI states, error states, empty states, or loading states that are unspecified?
   - Check against architecture docs (`/doc-explorer` each relevant system) — do the specs assume data or behaviors that the architecture doesn't support?

2. **Gap Report**
   - Produce a structured report listing:
     - **Contradictions**: where specs disagree with each other
     - **Missing states**: unspecified loading, error, empty, offline states
     - **Architecture mismatches**: where specs assume backend capabilities that don't exist or work differently
     - **Ambiguities**: where specs are unclear enough that two developers could implement them differently
   - Write findings to `docs/frontend/spec-review.md`

3. **Spec Patches**
   - For any issues found, apply fixes directly to the existing spec files
   - Keep changes minimal and surgical — don't rewrite specs, just fill gaps and resolve conflicts

### frontend-reviewer Teammate Tasks

**Owns**: `docs/frontend/` (review report only, no code changes)

This teammate reviews the existing design specs from an **implementation feasibility** perspective — checking whether the backend architecture actually provides what the frontend specs expect.

1. **Data Contract Audit**
   - For each spec, enumerate every piece of data the UI needs (tRPC queries, subscriptions, mutations)
   - Cross-reference against:
     - Existing tRPC routes in `packages/backend/src/api/`
     - Database schemas in `packages/shared/src/schemas/`
     - Store functions in `packages/backend/src/db/stores/`
     - The heartbeat pipeline outputs (MindOutput schema)
   - Flag any data the specs expect that doesn't exist in the backend

2. **Real-Time Feasibility Check**
   - The specs reference several real-time elements (emotional field animation, thought stream, typing indicators, agent progress)
   - Verify which of these have corresponding tRPC subscriptions or EventBus events defined
   - Flag any real-time behaviors that have no backend mechanism to support them

3. **Component Complexity Assessment**
   - Identify the highest-complexity components (emotional field with gradient orbs, voice visualization SVG, persona dimension sliders, birth animation)
   - For each, note any technical risks or library dependencies needed
   - Flag anything that might need a prototype or spike before full implementation

4. **Implementation Readiness Report**
   - Write findings to `docs/frontend/implementation-review.md`
   - Structure as:
     - **Ready to build**: specs with full backend support, clear data contracts
     - **Needs backend work first**: specs that require new tRPC routes, subscriptions, or store functions (list exactly what's missing)
     - **Needs design clarification**: specs where implementation details are ambiguous
     - **High-risk components**: components that need spikes or prototyping

**Deliverable**: The heartbeat can tick, the mind can think, emotions decay, persona compiles into prompts, Claude adapter streams responses, and we have reviewed/validated design specs with clear gap reports for frontend implementation.

---

## Sprint 2: Feature Systems + Frontend Foundation (Agent Team — 5 Teammates)

**Team composition**: `backend-routes` + `memory-goals` + `mind-integration` + `frontend-builder` + `tasks-channels`

This sprint has the highest parallelism. Each teammate owns a separate domain with zero file conflicts. The product-designer role is no longer needed — all 8 frontend specs exist and have been reviewed (see `docs/frontend/spec-review.md` and `docs/frontend/implementation-review.md`).

**Sprint 1 actuals that change Sprint 2 scope**: The heartbeat pipeline (gather/mind/execute), emotion engine, persona compiler, context builder, tick queue, and 4 tRPC routers (auth, settings, heartbeat, messages) with 3 subscriptions are already built. Sprint 2 does NOT need to build these — it builds on top of them.

### backend-routes Teammate Tasks

**Owns**: `packages/backend/src/api/routers/` (new routers), `packages/backend/src/db/` (schema expansion + new store functions), `packages/shared/src/schemas/` (schema updates)

The frontend-builder is blocked on ~15 missing tRPC routers. This teammate's job is to unblock the frontend by building all the routes and supporting infrastructure.

1. **Expand Persona Schema** (migration 002)
   - The current `personality_settings` table has only 4 columns (name, traits, communication_style, values). The persona spec requires 10+ fields.
   - Create migration `system/002_persona_expansion.sql` that either expands `personality_settings` or replaces it with a proper `persona` table
   - Fields needed: existence_paradigm, world_description, gender, age, physical_description, personality_dimensions (JSON with 10 sliders), traits (JSON array), values (JSON array), background, personality_notes, is_finalized (boolean)
   - Add `onboarding_step` and `onboarding_complete` columns to `system_settings` for onboarding state tracking
   - Update `packages/shared/src/schemas/system.ts` with expanded persona schema + onboarding state schema
   - Update `packages/backend/src/db/stores/system-store.ts` with persona CRUD + onboarding state functions

2. **Build Missing tRPC Routers**

   **Contacts Router** (`routers/contacts.ts`):
   - `getPrimary` query, `getById` query, `list` query (with last-message enrichment from messages.db)
   - `create` mutation, `update` mutation, `delete` mutation
   - `getChannels` query, `addChannel` mutation, `removeChannel` mutation
   - Store functions needed: `deleteContact()`, `deleteContactChannel()`, cross-DB contact-message enrichment

   **Onboarding Router** (`routers/onboarding.ts`):
   - `getState` query — returns current step + completion status
   - `updateStep` mutation — saves step progress
   - Uses the new onboarding columns on `system_settings`

   **Persona Router** (`routers/persona.ts`):
   - `get` query — returns full persona data
   - `saveDraft` mutation — saves partial persona during onboarding (progressive save)
   - `finalize` mutation — compiles persona, computes emotion baselines, starts heartbeat
   - `update` mutation — updates persona post-creation, triggers recompilation + baseline recomputation

   **Channels Config Router** (`routers/channels.ts`):
   - `getConfigs` query — all channel configs
   - `configure` mutation — save channel config (SMS, Discord, API)
   - `validate` mutation — test channel connection (stub for now, real validation when adapters are built)
   - Store functions needed: `getChannelConfigs()`, `upsertChannelConfig()` for `channel_configs` table

   **Data Management Router** (`routers/data.ts`):
   - `softReset` mutation — clear heartbeat.db
   - `fullReset` mutation — clear heartbeat.db + memory.db
   - `clearConversations` mutation — clear messages.db
   - `export` query — export all databases as JSON

   **Provider Router** (`routers/provider.ts`):
   - `validateKey` mutation — validate agent provider API key (calls adapter.isConfigured())
   - `saveKey` mutation — save encrypted API key (uses existing systemStore.setApiKey)

3. **Add Missing Store Functions**
   - `deleteContact()`, `deleteContactChannel()` in system-store
   - `getEmotionHistory(db, options: { emotion?, since?, limit? })` — range queries for sparklines/charts
   - `getMessagesByContact(db, contactId, options?)` — cross-conversation query
   - `listAllWorkingMemories(db)` — all working memories across contacts
   - `getChannelConfigs(db)`, `upsertChannelConfig(db, data)` for channel_configs table

4. **Add Missing Subscriptions**
   - `onThoughts` subscription on heartbeat router — bridges `thought:created` EventBus event
   - `onAgentStatus` subscription — bridges `agent:spawned/completed/failed` events
   - Add `onExperience` subscription — bridges `experience:created` event

5. **Tests**
   - Unit tests for all new store functions
   - Unit tests for all new routers (mocked stores)

### memory-goals Teammate Tasks

**Owns**: `packages/backend/src/memory/`, `packages/backend/src/goals/`

1. **Memory System** — `packages/backend/src/memory/`
   - LanceDB integration for vector storage
   - Embedding pipeline (text → BGE-small-en-v1.5 → vector via Transformers.js)
   - Short-term memory (recent context, in-memory buffer)
   - Working memory CRUD (per-contact notepad, AI-maintained)
   - Core self (singleton, agent's self-knowledge)
   - Long-term memory write pipeline: dedup → embed → store
   - Retrieval scoring: `0.4 * relevance + 0.3 * importance + 0.3 * recency`
   - Forgetting: `retention = e^(-hours / (strength * 720))`, prune when < 0.1 AND importance < 0.3
   - Memory consolidation (periodic merge of similar memories)
   - Wire into context builder (add long-term memory section to `buildMindContext`)

2. **Goal System** — `packages/backend/src/goals/`
   - Seeds with transient in-memory embeddings
   - Seed-to-goal promotion based on resonance across ticks
   - Goal lifecycle (active, paused, completed, abandoned)
   - Plans as ordered step sequences
   - Salience scoring for goal prioritization in context
   - Emotional resonance: `clamp((intensity - baseline) * 0.4, -0.2, 0.2)`
   - Goal/seed/plan store functions (deferred from Sprint 0 — the DB tables exist from migrations)
   - Wire into context builder (add goals & tasks section to `buildMindContext`)

3. **Tests**
   - Unit tests for memory pipeline (embedding, retrieval, forgetting)
   - Unit tests for goal system (seed promotion, salience scoring)

### mind-integration Teammate Tasks

**Owns**: `packages/backend/src/heartbeat/index.ts` (mind query section only), `packages/backend/src/heartbeat/agent-orchestrator.ts` (new)

This is the single most critical blocker for the system being functional. The mind query currently returns placeholder output — it needs to call the real Claude adapter.

1. **Wire Mind Query to Agent Session**
   - Replace the stub in `packages/backend/src/heartbeat/index.ts` (lines 128-183) with real agent session calls
   - Import `AgentManager` from `@animus/agents`
   - Create/reuse session based on warmth state (warm = reuse, cold = new session with system prompt)
   - Send compiled context as prompt via `session.promptStreaming()`
   - Parse structured MindOutput via `llm-json-stream` (install: `npm install llm-json-stream -w packages/backend`)
   - Validate output with `MindOutputSchema.parse()`
   - Handle partial/malformed output gracefully

2. **Streaming Reply Subscription**
   - Add `onReply` tRPC subscription that streams reply.content chunks in real-time
   - Bridge from the streaming agent response to the subscription via EventBus
   - Add `reply:chunk` and `reply:complete` event types to EventBus

3. **Agent Log Store Adapter**
   - Write the currying wrapper that bridges `agentLogStore` functions (which take `db` as first param) to the `AgentLogStore` interface expected by the logging hook
   - Attach logging to mind sessions via `attachSessionLogging()`

4. **Agent Orchestration Layer** (`agent-orchestrator.ts`)
   - Handle `spawn_agent` decisions from MindOutput — create sub-agent sessions
   - Handle `update_agent` decisions — forward new info to running sub-agents
   - Handle `cancel_agent` decisions — abort running sub-agents
   - Track sub-agent sessions in `agent_tasks` table via heartbeat-store
   - Route `agent_complete` triggers back to the tick queue

5. **Tests**
   - Unit tests for mind query integration (mocked agent session)
   - Unit tests for agent orchestration (mocked sessions)
   - Integration test for streaming reply pipeline

### frontend-builder Teammate Tasks

**Owns**: `packages/frontend/`

The frontend-builder can start immediately with auth + app shell (no backend dependency), then move to onboarding (depends on backend-routes completing persona/onboarding routes) and presence (depends on existing heartbeat/messages routes).

See `docs/frontend/implementation-review.md` for the detailed data contract audit and `docs/frontend/spec-review.md` for spec corrections.

1. **Design System & Component Library**
   - Implement the design primitives from `docs/frontend/design-principles.md`
   - Button variants, input fields, cards, modals, transitions, theme tokens
   - Use Emotion for styling, Motion for animations, Phosphor Icons

2. **Auth Flow**
   - Login page and registration page (from `docs/frontend/onboarding.md`)
   - Route guards (redirect unauthenticated to login, redirect authenticated to app)
   - Session management via tRPC `auth.status` + `auth.me` queries
   - All backend routes exist: `auth.register`, `auth.login`, `auth.logout`, `auth.status`, `auth.me`

3. **App Shell**
   - Navigation pill (4 spaces: Presence, Mind, People, Settings)
   - Space transitions with `AnimatePresence`
   - Connection status indicator (WebSocket health)
   - Command palette (Cmd+K) — navigation commands only for v1
   - Responsive layout with scroll behavior per `docs/frontend/app-shell.md`

4. **Onboarding Flow** (from `docs/frontend/onboarding.md`)
   - All 8 steps: Welcome → Provider Setup → Your Identity → About You → Channels → Persona (8 sub-steps) → Review & Birth → First Conversation
   - Persona creation: existence paradigm, identity, dimensions (10 sliders), traits, values, background, notes, review
   - Birth animation (high-risk — see implementation-review.md)
   - **Depends on**: `onboarding.*`, `persona.*`, `contacts.update`, `provider.*`, `channels.*` routes from backend-routes teammate

5. **Presence Page** (from `docs/frontend/presence.md`)
   - Emotional field visualization (high-risk — start with simplified version)
   - Thought stream (recent thoughts/experiences with opacity fading)
   - Chat interface (message input, message list, streaming replies)
   - Agent activity sidebar
   - Real-time subscriptions: `heartbeat.onStateChange`, `heartbeat.onEmotionChange`, `messages.onMessage`
   - **Depends on**: existing heartbeat + messages routes. `onThoughts` subscription from backend-routes.

6. **Tests**
   - Component tests for auth flow
   - Component tests for onboarding steps

### tasks-channels Teammate Tasks

**Owns**: `packages/backend/src/tasks/`, `packages/backend/src/channels/`, `packages/backend/src/contacts/`

1. **Task System** — `packages/backend/src/tasks/`
   - Scheduled tasks with cron expressions (use `cron-parser` library), recurring support
   - Deferred tasks (execute on idle ticks)
   - Task lifecycle: pending → running → completed/failed/cancelled
   - `contact_id` routing for task results
   - Parallel execution with configurable concurrency
   - Wire into tick queue: scheduled tasks fire `scheduled_task` trigger

2. **Contact System Enrichments** — `packages/backend/src/contacts/`
   - Multi-channel identity resolution (resolve unknown sender → existing contact)
   - Permission tier enforcement helpers
   - Contact notes vs working memory distinction
   - Message isolation by contact (non-primary contacts can't see other conversations)

3. **Channel Adapters** — `packages/backend/src/channels/`
   - Channel router: routes inbound messages from any channel to `handleIncomingMessage()`
   - Web channel (finalize — mostly done via messages router)
   - SMS adapter (Twilio) — stub with inbound webhook handler
   - Discord adapter — stub with bot event handler
   - API adapter (OpenAI/Ollama compatible) — stub with REST endpoint

4. **Tests**
   - Unit tests for task scheduling (cron parsing, lifecycle)
   - Unit tests for channel routing
   - Unit tests for contact resolution

**Deliverable**: Mind connected to real AI agent, all tRPC routes for frontend exist, memory system operational, goal system operational, auth + onboarding + presence pages built, task scheduling and channel adapters stubbed.

---

## Sprint 3: Frontend Completion + Polish (Agent Team — 3 Teammates)

**Team composition**: `backend-polish` + `frontend-builder` + `frontend-builder-2`

Sprint 1's design spec review revealed comprehensive specs for all pages. Sprint 2 builds the backend infrastructure and the first frontend pages. Sprint 3 completes the remaining frontend pages and polishes the integration.

**Sprint 2 actuals that change Sprint 3 scope**: The context builder already wires in long-term memories, goals, and agent status with token budget tracking. The agent orchestrator handles spawn/update/cancel. All 10 tRPC routers and 7 subscriptions exist. PresencePage is fully wired with real-time subscriptions. However, the Mind page needs query endpoints for memories, goals, and agent logs that don't have tRPC routes yet (store functions exist but aren't exposed). Settings, People, and Mind pages are still placeholders/shells.

### backend-polish Teammate Tasks

**Owns**: `packages/backend/src/` (integration work, MCP tools, missing routes)

1. **MCP Tool System** — `packages/backend/src/tools/`
   - Tool registry with tool definitions
   - Handler implementations for sub-agent tools: `send_message`, `update_progress`, `read_memory`
   - Hybrid transport (in-process + stdio)
   - Permission filtering by contact tier
   - Tool call logging to agent_logs.db

2. **Missing Query Routes for Mind Page** (unblocks frontend-builder-2)
   - **Memory router** (`routers/memory.ts`): `getWorkingMemories` (all contacts), `getCoreSelf`, `searchLongTermMemories` (text query → vector search)
   - **Goals router** (`routers/goals.ts`): `getGoals` (by status), `getSeeds` (by status), `getPlans` (by goal ID)
   - **Agent logs router** (`routers/agent-logs.ts`): `getSessions` (recent, paginated), `getSessionEvents` (by session ID), `getUsage` (aggregate stats)
   - **Extend heartbeat router**: `getRecentDecisions` query (all recent decisions across ticks, not just by single tick number)
   - NOTE: All underlying store functions already exist — this is tRPC wrapper work, not new business logic

3. **Context Builder Audit**
   - Verify context builder completeness (long-term memories, goals, agent status already wired in Sprint 2)
   - Verify token budget tracking and enforcement works correctly
   - Verify memory flush warning when budget reaches ~85%
   - Fix any gaps found during audit

4. **End-to-End Pipeline Test**
   - Full tick cycle: message → gather → mind (real agent) → execute → reply
   - Crash recovery test: kill at every stage, verify clean recovery
   - Sub-agent lifecycle test: spawn → progress → complete → mind receives results

### frontend-builder Teammate Tasks

**Owns**: `packages/frontend/src/pages/` (Settings, People)

4. **Settings Page** (from `docs/frontend/settings.md`)
   - Persona editor (dimensions, traits, values, identity, background)
   - Provider configuration (API key validation, provider switching)
   - Channel configuration (Web, SMS, Discord, API)
   - Heartbeat settings (interval, warmth window, context budget)
   - Data management (soft reset, full reset, clear conversations, export)
   - Password change

5. **People Page** (from `docs/frontend/people.md`)
   - Contact list with last-message enrichment
   - Contact detail view with message history, channels, working memory
   - Add contact modal with channel assignment
   - Primary contact shared conversation with Presence
   - Unknown messages section (if backend supports it)

6. **Real-time Subscription Wiring**
   - Wire all tRPC subscriptions into Zustand stores
   - Handle reconnection and stale data gracefully

### frontend-builder-2 Teammate Tasks

**Owns**: `packages/frontend/src/pages/` (Mind)

**Depends on**: backend-polish completing task #2 (Missing Query Routes) for memories, goals, and agent logs endpoints. Emotions, thoughts, experiences, and decisions can be built immediately using existing heartbeat router endpoints.

7. **Mind Page** (from `docs/frontend/mind.md`)
   - Emotions section: current states, history sparklines/charts (24h/7d/30d) — uses existing `heartbeat.getEmotions`, `heartbeat.getEmotionHistory`, `heartbeat.onEmotionChange`
   - Thoughts & Experiences section: paginated log, importance badges — uses existing `heartbeat.getRecentThoughts`, `heartbeat.getRecentExperiences`, `heartbeat.onThoughts`, `heartbeat.onExperience`
   - Memories section: working memory list, core self viewer, long-term memory search — **needs `memory.*` routes from backend-polish**
   - Goals section: active goals, seeds, plans, salience visualization — **needs `goals.*` routes from backend-polish**
   - Agents section: running agents, recent completions, event logs, usage stats — **needs `agentLogs.*` routes from backend-polish**, uses existing `heartbeat.onAgentStatus` subscription
   - Decisions section: tick decision log — uses existing `heartbeat.getTickDecisions`, **needs `heartbeat.getRecentDecisions` from backend-polish**

**Deliverable**: All frontend pages built and connected to real backend data, MCP tool system operational, end-to-end pipeline tested.

---

## Sprint 4: Hardening & Voice (Single Session or Small Team)

**Why smaller team**: Integration testing, bug fixing, voice implementation, and refinement — more sequential by nature.

1. **Voice Mode** (from `docs/frontend/voice-mode.md`)
   - Parakeet TDT v3 (STT) + Kokoro (TTS) via sherpa-onnx npm
   - Voice tRPC routes: `voice.getStatus`, `voice.transcribe`, `voice.subscribe`
   - Voice visualization SVG (high-risk component)
   - Streaming reply + simultaneous TTS pipeline

2. **Error handling audit** — verify all 4 tiers (Retryable, Recoverable, Critical, Fatal)
3. **Crash recovery testing** — kill at every pipeline stage, verify clean recovery
4. **Performance** — heartbeat tick timing, UI responsiveness, subscription throughput
5. **Security audit** — API key encryption, auth flow, route guards, permission enforcement
6. **Test coverage** — fill gaps in unit and integration tests
7. **Documentation** — update any docs that diverged during implementation

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
