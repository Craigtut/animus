# Animus Tech Stack

This document provides a comprehensive overview of the technologies used in Animus and the rationale behind each choice.

## Overview

Animus is built as a self-contained, self-hosted application. The guiding principle is **zero external infrastructure** - everything runs within a single Node.js process with embedded databases.

## Frontend

### Core Framework

| Technology | Version | Purpose |
|------------|---------|---------|
| **Vite** | ^6.0 | Build tool and dev server |
| **React** | ^19.0 | UI framework |
| **TypeScript** | ^5.6 | Type safety |

**Why React 19?** Latest features including improved Suspense, automatic batching, and better concurrent rendering support.

**Why Vite?** Fast dev server with HMR, native ESM support, and excellent build optimization.

### Routing & State

| Technology | Version | Purpose |
|------------|---------|---------|
| **React Router** | ^7.1 | Client-side routing |
| **Zustand** | ^5.0 | Global state management |

**Why Zustand?** Minimal boilerplate, built-in persistence, and excellent TypeScript support. Perfect for single-user apps where Redux's complexity isn't needed.

### Styling

| Technology | Version | Purpose |
|------------|---------|---------|
| **Emotion** | ^11.13 | CSS-in-JS styling |
| **Phosphor Icons** | ^2.1 | Icon library |

**Why Emotion?** Powerful theming system, excellent TypeScript integration, and the `css` prop for inline styles without class name generation overhead.

### Animation

| Technology | Version | Purpose |
|------------|---------|---------|
| **Motion** | ^11.12 | Animation library |

**Why Motion (Framer Motion)?** Production-ready, declarative animations with excellent React integration.

### API Communication

| Technology | Version | Purpose |
|------------|---------|---------|
| **tRPC** | ^11.0 | Type-safe API client |
| **TanStack Query** | ^5.60 | Data fetching/caching |

**Why tRPC?** End-to-end type safety without code generation. Changes to backend procedures are immediately reflected in frontend types.

**Why tRPC over REST + OpenAPI?**
- No schema files to maintain
- Automatic type inference
- Built-in TanStack Query integration
- WebSocket subscriptions for real-time data

## Backend

### Server Framework

| Technology | Version | Purpose |
|------------|---------|---------|
| **Node.js** | ^24.0 | Runtime |
| **Fastify** | ^5.0 | HTTP server |
| **tRPC** | ^11.0 | API framework |

**Why Fastify?** High performance, excellent plugin ecosystem, native TypeScript support, and easy WebSocket integration.

### Databases

| Technology | Version | Purpose |
|------------|---------|---------|
| **better-sqlite3** | ^11.0 | SQLite driver |
| **LanceDB** | ^0.12 | Vector database |
| **Transformers.js** | ^3.0 | Local embedding model (BGE-small-en-v1.5) |

**Why SQLite?**
- Zero configuration
- Single file per database
- Excellent performance for single-user workloads
- ACID compliance
- WAL mode for concurrent reads

**Why five separate SQLite databases?**
1. **system.db** - Core config that should never be accidentally deleted (users, contacts, contact channels, settings, API keys)
2. **heartbeat.db** - AI state that might be reset for fresh start (thoughts, emotions, experiences, agent tasks)
3. **memory.db** - Accumulated knowledge: working memory (per-contact notepad), core self (agent self-knowledge), long-term memories (extracted knowledge metadata). Reset with heartbeat for full AI reset, or preserved independently for soft reset.
4. **messages.db** - Conversation history that persists across heartbeat resets (messages tagged with contact_id, conversations)
5. **agent_logs.db** - High-volume logs with aggressive TTL cleanup (sessions, events, usage)

**Why LanceDB?**
- Embedded (no external server)
- Optimized for AI/ML workloads
- Native vector similarity search
- Works with SQLite-like simplicity
- Built-in Transformers.js integration for automatic embedding

**Why Transformers.js + BGE-small-en-v1.5?**
- Local inference (no API dependency, self-contained)
- 384-dim embeddings, 512-token context — sufficient for extracted memory text
- ~32 MB model (int8 quantized), ~50-60 MB RAM during inference
- 300-700ms for 20 passages on CPU — negligible within a 5-minute heartbeat cycle
- LanceDB has built-in support, enabling automatic embedding on insert and query
- OpenAI text-embedding-3-small available as an alternative for users who prefer API-based embedding

### Agent SDKs

| Technology | Purpose |
|------------|---------|
| **Claude Agent SDK** | Anthropic's agent framework (default) |
| **Codex SDK** | OpenAI's Codex agent |
| **OpenCode SDK** | OpenCode.ai agent |

All three will be wrapped in a unified abstraction layer in the `@animus/agents` package (`/packages/agents/`). This is a separate package from the backend to maintain clear boundaries.

**Status**: Interface types defined, implementation pending.

The abstraction layer will provide:
- Consistent interface across providers
- Normalized event streaming
- Token/cost tracking
- Session lifecycle management

### Authentication

| Technology | Version | Purpose |
|------------|---------|---------|
| **@fastify/jwt** | ^10.0 | JWT signing, verification, and route protection |
| **argon2** | latest | Password hashing (preferred over bcrypt for modern applications) |
| **@fastify/cookie** | latest | httpOnly cookie transport for JWT tokens |

**Approach: Roll your own** (~150-200 lines as a Fastify plugin).

**Why not Better Auth?** Better Auth is the dominant TypeScript auth framework (24k+ stars, Y Combinator-backed, absorbed Lucia and Auth.js). However, it creates and manages its own 4 tables (user, session, account, verification) with its own schema management — this conflicts with Animus's existing `system.db` user/contact model. Its Fastify integration also works by bridging to the Fetch API internally, bypassing Fastify's native plugin and hook model. For a single-user self-hosted app with email/password only, it brings framework-level complexity for a ~150-line problem.

**Why not Lucia?** Deprecated March 2025. Project archived. Official recommendation is to migrate to Better Auth.

**Implementation:**

```
packages/backend/src/plugins/auth.ts    # Fastify plugin (~150 lines)
```

The auth plugin provides:

1. **Password hashing** — argon2 for all password storage (hash on register, verify on login)
2. **JWT sessions** — Signed tokens with configurable expiry (default 7d), stored in httpOnly cookies for web UI and accepted as `Authorization: Bearer` headers for API channels
3. **Route protection** — `fastify.authenticate` decorator used as `onRequest` hook on protected routes
4. **First-user bootstrap** — When `SELECT COUNT(*) FROM users` returns 0, registration is open. After the first user is created, registration is locked (admin-only creation)

```typescript
// Conceptual structure (not final implementation)
export default fp(async (fastify) => {
  fastify.register(fastifyJwt, {
    secret: process.env.ANIMUS_JWT_SECRET!,
    sign: { expiresIn: '7d' },
    cookie: { cookieName: 'animus_session', signed: false },
  });

  fastify.register(fastifyCookie);

  fastify.decorate('authenticate', async (request, reply) => {
    try { await request.jwtVerify(); }
    catch { reply.code(401).send({ error: 'Unauthorized' }); }
  });
});

// Endpoints (registered on tRPC or Fastify routes):
// POST /auth/register  — argon2.hash(password), insert user, sign JWT, set cookie
// POST /auth/login     — argon2.verify(hash, password), sign JWT, set cookie
// POST /auth/logout    — clear cookie
// GET  /auth/me        — return user from JWT payload
```

**Security properties:**
- Passwords never stored in plaintext (argon2 with default cost)
- JWT secret from environment variable (`ANIMUS_JWT_SECRET`)
- httpOnly cookies prevent XSS-based token theft
- API channels use Bearer token (same JWT, different transport)
- No OAuth, social login, or 2FA needed (single-user, self-hosted, LAN)

## Development Tools

### Testing

| Technology | Version | Purpose |
|------------|---------|---------|
| **Vitest** | ^2.1 | Unit/integration testing |
| **Playwright** | (planned) | E2E testing |

**Why Vitest?** Jest-compatible API, native ESM support, uses Vite's transform pipeline for speed.

### Code Quality

| Technology | Purpose |
|------------|---------|
| **ESLint** | Linting |
| **Prettier** | Formatting |
| **TypeScript** | Type checking |

### Monorepo

| Technology | Purpose |
|------------|---------|
| **npm workspaces** | Package management |

**Why npm workspaces over Turborepo/Nx?** Simplicity. For a project of this size, npm workspaces provide adequate functionality without additional complexity.

## Production Deployment

In production, the frontend is built and served by Fastify:

```
┌─────────────────────────────────────────┐
│              Fastify Server             │
├─────────────────────────────────────────┤
│  /api/trpc/*  →  tRPC HTTP handlers     │
│  /api/trpc    →  tRPC WebSocket         │
│  /*           →  Static files (React)   │
│  /* (404)     →  index.html (SPA)       │
└─────────────────────────────────────────┘
```

## Data Flow

```
┌──────────────┐     tRPC HTTP/WS     ┌──────────────┐
│   Frontend   │ ◄──────────────────► │   Backend    │
│   (React)    │                      │  (Fastify)   │
└──────────────┘                      └──────┬───────┘
                                             │
     ┌───────────────┬───────────────┬───────┼──────────┬───────────────┐
     │               │               │       │          │               │
┌────▼────┐   ┌──────▼──────┐  ┌─────▼────┐ │   ┌──────▼──────┐  ┌────▼───────┐
│system.db│   │heartbeat.db │  │memory.db │ │   │ messages.db │  │agent_logs  │
│         │   │             │  │          │ │   │             │  │   .db      │
│- Users  │   │ - Thoughts  │  │- Working │ │   │ - Messages  │  │ - Sessions │
│- Auth   │   │ - Emotions  │  │  memory  │ │   │ - Convos    │  │ - Events   │
│- Contacts│  │ - Tasks     │  │- Core    │ │   │ - Channels  │  │ - Usage    │
│- Settings│  │             │  │  self    │ │   │             │  │            │
└─────────┘   └─────────────┘  │- Long-   │ │   └─────────────┘  └────────────┘
                               │  term    │ │
                               │  memories│ │
                               └──────────┘ │
                                     ┌──────▼──────┐
                                     │   LanceDB   │
                                     │             │
                                     │ - Embeddings│
                                     │  (vectors)  │
                                     └─────────────┘
```

## Shared Abstractions

Eight cross-cutting concerns are formalized as abstractions to prevent duplication and ensure consistency across the codebase. Most live in `@animus/shared` (pure logic, no backend dependencies) or `@animus/backend` (requires database access).

### Embedding Provider (`@animus/shared`)

An abstraction over embedding model providers, used by the memory system (write pipeline, retrieval, seed resonance) and any future feature that needs vector similarity.

```typescript
interface IEmbeddingProvider {
  readonly dimensions: number;
  readonly maxTokens: number;
  readonly modelId: string;

  embed(texts: string[]): Promise<number[][]>;
  embedSingle(text: string): Promise<number[]>;
  isReady(): boolean;
  initialize(): Promise<void>;
}
```

**Implementations:**
| Provider | Package | Model | Dimensions | Latency | Notes |
|---|---|---|---|---|---|
| **Local** (default) | `@huggingface/transformers` | BGE-small-en-v1.5 | 384 | 300-700ms / 20 passages | ~32 MB model, no API dependency |
| **OpenAI** | `openai` | text-embedding-3-small | 1536 | 300-500ms / call | Requires API key |

The embedding model is configured at the system level (`embeddingModel` setting in `system.db`). Changing the model triggers a one-time re-embedding migration on startup because dimensions differ between providers. The provider exposes `dimensions` so the system can detect mismatches.

See `docs/architecture/memory.md` for how embeddings are used in the memory system.

---

### Context Builder (`@animus/backend`)

The centralized system for assembling all LLM prompts and context across Animus. Every place where the system constructs input for an LLM — the mind's system prompt, GATHER CONTEXT payloads, sub-agent prompts, task tick prompts — flows through the Context Builder.

Key responsibilities:
- **Persona compilation** — Converts slider values, traits, values, and backstory into behavioral prompt text
- **Context assembly** — Composes context sections (emotions, memories, goals, permissions) for each tick
- **Token budget management** — Allocates context window space across sections, truncates by priority when needed
- **Compilation targets** — Produces context for mind ticks, sub-agent sessions, task ticks, and cold session bootstraps

See `docs/architecture/context-builder.md` for the full design including interface, token budget allocation, and context section details.

---

### Decay Engine (`@animus/shared`)

A shared mathematical utility for exponential decay calculations. The same decay pattern appears in five systems with different parameters:

| System | What Decays | Toward | Rate | Reference |
|---|---|---|---|---|
| Emotions | Intensity | Personality-driven baseline | Per-emotion (0.192–1.151/hr) | `heartbeat.md` |
| Seeds | Strength | 0 | 0.027/hr (~7d full reset) | `goals.md` |
| Memory forgetting | Retention | 0 | Strength-modulated | `memory.md` |
| Memory retrieval recency | Recency score | 0 | 0.995^hours | `memory.md` |
| Deferred task staleness | Priority | N/A (boost, not decay) | Linear after 7d | `tasks-system.md` |

```typescript
interface DecayConfig {
  decayRate: number;
  baseline?: number;          // Decay toward this instead of 0 (emotions)
  strengthMultiplier?: number; // Modulate decay by access count (memories)
  minThreshold?: number;       // Below this, consider "decayed" (seeds, memories)
}

class DecayEngine {
  /** Compute decayed value given elapsed time */
  static compute(current: number, config: DecayConfig, elapsedHours: number): number;

  /** Compute retention score (0-1) for forgetting decisions */
  static computeRetention(config: DecayConfig, elapsedHours: number): number;

  /** Helper: hours elapsed since an ISO timestamp */
  static hoursSince(timestamp: string): number;
}
```

Centralizing this prevents formula bugs (getting the math wrong in one system) and makes decay behavior testable independently.

---

### Event Bus (`@animus/shared` interface, `@animus/backend` implementation)

A typed event emitter that decouples event producers from consumers. This is not a distributed message queue — it's a thin type-safe wrapper around Node.js `EventEmitter` that standardizes the event types flowing through the system.

**Problem it solves:** Multiple systems produce events that multiple consumers need:

| Producer | Events | Consumers |
|---|---|---|
| Heartbeat pipeline | Tick complete, stage changes | Frontend (tRPC subscription), logging |
| Emotion engine | Emotion state changes | Frontend visualization, logging |
| Mind session | Streaming output | Channel adapters (SSE, NDJSON, WebSocket, buffer) |
| Agent orchestrator | Agent spawned, completed, failed | Frontend, heartbeat trigger |
| Channel adapters | Message received, sent | Heartbeat pipeline, message storage |
| Goal system | Goal status changes | Frontend, logging |

Without a bus, each producer-consumer pair is a direct coupling. Adding a new consumer (e.g., webhook notifications, audit logging) requires changing the producer.

```typescript
interface IEventBus {
  emit<T extends AnimusEvent>(event: T): void;
  on<T extends AnimusEvent>(type: T['type'], handler: (event: T) => void): () => void;
  once<T extends AnimusEvent>(type: T['type'], handler: (event: T) => void): void;
}

type AnimusEvent =
  | { type: 'tick:complete'; tickNumber: number; trigger: string }
  | { type: 'emotion:changed'; changes: EmotionDelta[] }
  | { type: 'message:received'; message: IncomingMessage }
  | { type: 'message:sent'; contactId: string; channel: string; content: string }
  | { type: 'agent:spawned'; agentId: string; taskDescription: string }
  | { type: 'agent:completed'; agentId: string; status: string }
  | { type: 'goal:changed'; goalId: string; newStatus: string }
  | { type: 'task:changed'; taskId: string; newStatus: string }
  | { type: 'unknown_caller'; channel: string; identifier: string };
```

The tRPC subscription layer becomes a consumer of the event bus rather than being tightly coupled to each producing system.

---

### Encryption Service (`@animus/shared`)

Centralizes all symmetric encryption for secrets stored in the database — channel credentials, API keys, and any future encrypted configuration.

```typescript
interface IEncryptionService {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
  isConfigured(): boolean;
}
```

**Implementation details:**
- Algorithm: AES-256-GCM (authenticated encryption)
- Key source: `ANIMUS_ENCRYPTION_KEY` environment variable
- Key derivation: PBKDF2 from the env var value
- IV: Random per-encryption, prepended to ciphertext
- Format: `{iv}:{ciphertext}:{authTag}` (base64-encoded)

If the encryption key is not set, the service should log a warning on startup and fall back to storing secrets as plaintext (acceptable for local development but not production). The `isConfigured()` method lets the UI warn users about unencrypted storage.

Used by the channel configuration system (see `docs/architecture/channel-packages.md`) and API key storage in `system.db`.

---

### Database Stores (`@animus/backend`)

Typed data access modules that encapsulate all SQL operations, organized by database. These are not a full ORM or repository pattern — they're simple functional modules that keep raw SQL centralized and out of business logic code.

**Why not raw SQL everywhere?** SQL scattered across heartbeat pipeline code, GATHER CONTEXT code, and EXECUTE code makes the system hard to test (need a real database for every test) and hard to refactor (schema changes require hunting across the codebase).

**Why not a full ORM?** Drizzle, Kysely, and similar tools add dependencies and abstractions that aren't necessary for SQLite with better-sqlite3. The queries are simple enough that typed functions suffice.

**Structure:** One module per database, exporting typed functions. The database connection is a parameter for testability.

```
/packages/backend/src/db/
  stores/
    system.ts          # Users, contacts, contact channels, settings, API keys
    heartbeat.ts       # Heartbeat state, thoughts, experiences, emotions, agent tasks, goals, seeds, plans, tasks
    memory.ts          # Working memory, core self, long-term memories
    messages.ts        # Conversations, messages
    agent-logs.ts      # Sessions, events, usage
  connections.ts       # Database connection setup (WAL mode, pragmas)
  migrations/          # Schema versioning
```

```typescript
// Example: stores/heartbeat.ts
import type { Database } from 'better-sqlite3';

export function getRecentThoughts(db: Database, limit: number): Thought[] { ... }
export function insertThought(db: Database, thought: NewThought): void { ... }
export function getEmotionState(db: Database): EmotionState[] { ... }
export function updateEmotionIntensity(db: Database, emotion: string, intensity: number): void { ... }
export function cleanupExpired(db: Database, retentionDays: number): void { ... }
```

Each function accepts the database instance as its first parameter. In production, the real database connection is passed. In tests, an in-memory SQLite database (`:memory:`) with the same schema can be used.

**Cross-database references:** Contacts live in `system.db` but are referenced by `heartbeat.db`, `memory.db`, and `messages.db` via `contact_id` string fields (not SQLite foreign keys, since they cross database boundaries). Store functions accept the relevant database instance — a function that needs data from two databases accepts both.

---

### Database Migrations (`@animus/backend`)

A lightweight, custom migration system for managing schema changes across all five SQLite databases. Zero external dependencies — just ~50 lines of migration runner code.

**Why not an ORM migration tool (Drizzle, Kysely, Knex)?** Animus uses raw SQL by design (no ORM). Adding an ORM's migration runner purely for migrations introduces a heavy dependency for a narrow use case. The five separate databases also make ORM migration tools awkward — they typically assume a single database connection.

**Why not Umzug?** Viable option, but for SQLite with better-sqlite3, the migration problem is simple enough that a dependency isn't justified. Our runner is ~50 lines.

**How it works:**

Each database has a `_migrations` table that tracks which migrations have been applied:

```sql
CREATE TABLE IF NOT EXISTS _migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Migration files are plain `.sql` files organized by database:

```
packages/backend/src/db/
  migrations/
    system/
      001_initial.sql
      002_add_api_keys.sql
    heartbeat/
      001_initial.sql
      002_add_tick_decisions.sql
    memory/
      001_initial.sql
    messages/
      001_initial.sql
    agent-logs/
      001_initial.sql
```

**Migration runner** (runs at startup, before any other initialization):

```typescript
function runMigrations(db: Database, migrationsDir: string): void {
  // 1. Ensure _migrations table exists
  // 2. Read all .sql files from migrationsDir, sorted by version number
  // 3. Query _migrations for already-applied versions
  // 4. For each unapplied migration (in order):
  //    a. Read the .sql file
  //    b. Execute it within a transaction
  //    c. Insert a row into _migrations
  // 5. Log summary: "system.db: applied 2 new migrations (003, 004)"
}
```

**Rules:**
- Migration files are **append-only** — never edit or delete an applied migration
- Each migration runs in a **transaction** — if it fails, nothing is applied (SQLite DDL is transactional)
- Version numbers are extracted from the filename prefix (e.g., `001`, `002`)
- The runner processes each of the five databases independently
- Migrations are **forward-only** — no rollback support (if needed, write a new migration that reverses the change)

**Startup sequence:**
```
1. Open all 5 database connections (WAL mode, pragmas)
2. Run migrations for each database
3. Initialize services (auth, heartbeat, channels, etc.)
4. Start HTTP server
```

This approach is robust for long-term use: as the schema evolves, new `.sql` files are added to the appropriate directory and automatically applied on the next startup. The version-tracking table provides a clear audit trail of what's been applied.

---

## Security Considerations

- **Authentication**: Email/password with argon2 hashing, JWT in httpOnly cookies (web) or Bearer tokens (API). See Authentication section above.
- **API Keys**: Stored encrypted in system.db via the Encryption Service
- **Channel Credentials**: Encrypted in system.db via the Encryption Service (Twilio keys, Discord tokens, etc.)
- **CORS**: Configured for same-origin in production
- **Input Validation**: All tRPC inputs validated with Zod
- **SQL Injection**: Prevented by parameterized queries (better-sqlite3)

---

## Distribution Paths

Animus supports three deployment methods:

### 1. Bare Node.js

The simplest path — clone, install, build, and run directly:

```bash
git clone https://github.com/your-username/animus.git
cd animus
npm install
npm run build:prod
npm start
```

The production build compiles shared → agents → frontend → backend in dependency order. The backend serves both the API and the built frontend SPA on port 3000.

### 2. Docker

For self-hosted servers, a multi-stage Docker build produces a slim production image:

```bash
docker compose up --build
```

The `docker-compose.yml` mounts `./data` for database persistence and reads configuration from `.env`. The image is based on `node:24-slim` and exposes port 3000.

See `Dockerfile`, `docker-compose.yml`, and `.dockerignore` in the repo root.

### 3. Desktop App (Tauri)

A native desktop app using [Tauri](https://tauri.app/) with a Node.js sidecar. The full backend runs as a permanent child process — not a bridge to a Rust migration.

```bash
npm run dev:tauri    # Development (uses system node)
npm run build:tauri  # Production bundle
```

The scaffold is at `/packages/tauri/`. See the "Desktop Packaging" section below for architecture details.

---

## Desktop Packaging (Tauri)

### Prerequisites

- **Rust toolchain**: Install via [rustup](https://rustup.rs/)
- **Tauri CLI**: `cargo install tauri-cli --version "^2.0.0" --locked`
- **Platform-specific deps**: See [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

### Approach: Node.js Sidecar (Permanent)

Tauri provides first-class [sidecar support](https://tauri.app/develop/sidecar/) for bundling and lifecycle-managing external processes. The Animus backend will run as a permanent Node.js sidecar — **not** a temporary bridge to a Rust migration. The full Fastify server, agent SDKs, database layer, and all backend logic stay in Node.js.

```
┌──────────────────────────────────────┐
│           Tauri App (Rust)           │
│  ┌────────────────────────────────┐  │
│  │   Webview (React frontend)    │  │
│  │       ↕ HTTP / WebSocket      │  │
│  └────────────────────────────────┘  │
│  ┌────────────────────────────────┐  │
│  │   Node.js sidecar process     │  │
│  │   (Fastify + tRPC + agents)   │  │
│  │   All backend code, as-is     │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

### Development vs Production

**Development** (`cargo tauri dev`): The Tauri `beforeDevCommand` starts both the Vite dev server (frontend HMR) and the Node.js backend via `npm run dev`. The webview connects to the Vite dev server for hot reloading. No sidecar binary is needed — it uses your system Node.js.

**Production** (`cargo tauri build`): The app bundle includes a Node.js binary (placed in `packages/tauri/binaries/` with the target triple suffix) and the built JS resources. On launch, the Rust shell spawns Node.js as a sidecar process running the backend, picks a free port, and points the webview at the sidecar's URL for same-origin serving of both the API and the frontend SPA.

**App icons**: Use `cargo tauri icon <source-image>` to generate all required icon sizes from a single source image (at least 1024x1024 PNG recommended). This produces icons for all platforms in `packages/tauri/icons/`.

### Why This Works Today (No Blockers)

The existing architecture is already well-suited for desktop packaging:

- **Self-contained**: SQLite + LanceDB, no external infrastructure to bundle
- **Single-user**: One instance per user is the desktop app model
- **Configurable paths**: Data directory paths are set via environment variables (`DB_SYSTEM_PATH`, etc.) — Tauri's Rust shell resolves `app_data_dir()` and passes them to the sidecar
- **Configurable binding**: `HOST` and `PORT` env vars allow switching to `127.0.0.1:{dynamic_port}` at launch
- **Frontend is a standard SPA**: Vite-built React app loads in Tauri's webview with no changes

### What Gets Wired Up Later (When Packaging)

These are all configuration-level concerns, not architectural changes:

1. **Data directory** — Tauri resolves the platform-specific app data path (e.g., `~/Library/Application Support/com.animus.app/` on macOS) and passes it to the sidecar via env vars
2. **Localhost binding** — Sidecar binds to `127.0.0.1` with a dynamic port (not `0.0.0.0:3000`)
3. **Backend URL** — Tauri passes the sidecar's port to the webview so the frontend knows where to connect
4. **Process lifecycle** — Tauri starts the sidecar on launch and sends a graceful shutdown signal on quit

### Why Not Electron

Tauri is preferred over Electron for:
- Smaller bundle size (~10-20 MB vs ~200 MB)
- Lower memory footprint (native webview vs bundled Chromium)
- Rust-based security model
- Better fit for the project's self-hosted ethos

Since Animus requires a Node.js sidecar regardless (for agent SDKs), Electron's advantage of native Node.js support is less relevant — both approaches end up bundling Node.js.

### Sidecar Approach: Ship Node.js Binary (Option D)

The simplest sidecar strategy: bundle the Node.js binary and JS resources directly in the app. No compile-to-binary tricks (pkg, bun compile, Node.js SEA). This is the most debuggable approach — the JS files are plain text, the Node.js binary is standard.

The Tauri scaffold at `/packages/tauri/` implements this:
- `src/main.rs` — Picks a free port, spawns `node backend/index.js`, waits for health check, opens the webview
- `tauri.conf.json` — Configures the bundle (external bin, resources, CSP, window)
- `binaries/` — Place the Node.js binary here with the correct target triple suffix
- `capabilities/` — Shell permissions for spawning the sidecar

**Future optimizations** (not implemented):
- Bundle size reduction via `bun compile` or Node.js SEA (single executable)
- macOS code signing and notarization
- Windows signal handling (SIGTERM alternative)
- Auto-update via Tauri's updater plugin
