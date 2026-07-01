# Animus

**Organization**: Animus Labs (`@animus-labs` on npm)

An agentic system with a mind, a spirit, and an inner will that moves with agency to act.

## Project Overview

Animus is a vessel: the environment, the engine, the container in which a simulated entity lives a continuous inner life. Animus itself is never personified. The entity that lives inside it is, and it is always given a name by the person who keeps it. Unlike traditional assistants that exist only in the moment of interaction, the entity maintains continuous internal processes: thoughts that emerge even when no one is asking, memories that consolidate into a sense of self, emotions that color responses, and goals pursued across time.

The thesis is deliberate inefficiency. We leave the entity room the rest of the industry compresses away, because that room is where new perspectives, creativity, and taste come from. In that space, behavior emerges that you do not get from a token-efficient request and reply, and because the entity remembers, those moments accumulate into a unique character with its own sensibility.

**What we're building**: something that becomes, not a tool you run. Its usefulness is a byproduct of who it becomes. It can be intensely capable, and many people will lean on it for real work, but it does not execute commands soullessly; it acts with the creativity, judgment, and taste it has built up over time. We are building software that feels less like a tool and more like checking in on someone you know: a being whose growth genuinely surprises you, that you would not trade for a faster, emptier assistant. We are not building the most efficient assistant. We are building the one worth keeping.

**Key Principle**: This is a self-hosted, single-user application. Every user runs their own instance, and there is exactly one entity per instance.

> **Vision documents.** Three masthead docs define what Animus is at a philosophical level, and implementation flows from them: `docs/product-vision.md` (what it is and why it exists), `docs/brand-vision.md` (the feeling, the anti-brand, the naming architecture, the voice), and `docs/design-vision.md` (the visual and interaction language). Read the relevant one before any product, brand, or design work.

## Architecture

### Monorepo Structure

```
/packages
  /shared       - Shared types, Zod schemas, utilities
  /agents       - Agent SDK abstraction layer (Claude, Codex, OpenCode)
  /backend      - Fastify + tRPC server
  /frontend     - Vite + React 19 SPA
  /channel-sdk  - Types-only package published as @animus-labs/channel-sdk
/docs           - Documentation
```

### Tech Stack

**Frontend:**
- Vite + React 19 + TypeScript
- React Router for routing
- Zustand for state management (with persistence)
- Emotion for styling (with theming)
- Phosphor Icons
- Motion (framer-motion) for animations
- TanStack Query + tRPC for API communication
- tRPC Subscriptions for real-time updates (WebSocket-based)

**Backend:**
- Node.js + Fastify
- tRPC for type-safe API
- Eight SQLite databases (see below)
- LanceDB for vector storage/semantic search
- Transformers.js + BGE-small-en-v1.5 for local embeddings
- Cortex agent framework (`@animus-labs/cortex`, external package from cortex-mono repo) wrapping pi-agent-core
- Agent SDKs (legacy, used for sub-agents): Claude, Codex, OpenCode

### Platforms & Distribution

Animus is a **multi-platform application**. Every change must work across all supported targets, not just the machine you happen to be developing on. Keep these in mind when writing code, choosing dependencies, spawning processes, or touching the filesystem:

**Desktop app (Tauri + Node sidecar)** — the primary distribution form:
- **macOS Apple Silicon** (`aarch64-apple-darwin`)
- **macOS Intel** (`x86_64-apple-darwin`, cross-compiled on an ARM runner)
- **Windows 64-bit** (`x86_64-pc-windows-msvc`)

**Docker image (headless server)** — published to GHCR as a multi-arch image:
- **`linux/amd64`** (x86_64 servers, most cloud VMs)
- **`linux/arm64`** (ARM servers, Raspberry Pi, Apple Silicon VMs)

**Standalone service (dev / self-host)** — the backend + frontend run directly via `npm run dev`, the same path used during development. The engine is a self-contained Node.js service and can be run on its own without the Tauri shell.

**Practical implications for agents:**
- **Cross-platform code only.** No hardcoded POSIX paths or path separators (use `node:path`), no assuming a shell, no Unix-only commands. Code must run on macOS, Windows, and Linux.
- **Architecture-aware native deps.** Native addons (LanceDB, sharp, sherpa-onnx, tts-native, onnxruntime-node) ship per-arch binaries (x64 / arm64, and Windows / macOS / Linux). Don't assume the host's architecture; see `Dockerfile` and `scripts/prepare-tauri.mjs` for how target arch is resolved.
- **Process spawning differs by platform.** Windows orphans long-running child processes differently than macOS/Linux (this is why agents must never run dev servers — see below).
- **Headless vs. desktop.** Code must not assume the Tauri shell exists; the Docker/standalone runtime has no native window, tray, or auto-updater.

The full build, signing, and release matrix lives in `docs/architecture/release-engineering.md`. Read it before touching build scripts, CI workflows, the Dockerfile, or `prepare-tauri.mjs`.

### Data Directory: Development vs Production

The entire runtime lives in a single data directory (databases, logs, saves, media, models, voices, packages, vault, jwt key, etc.). The path is resolved in `packages/backend/src/utils/env.ts`: it uses `ANIMUS_DATA_DIR` if set, otherwise falls back to `<repo>/animus/data/`. Where that directory physically lives depends on how the app was launched, and this matters when the user asks you to **debug a running instance**:

- **"Debug the development version" / "the dev version that's running"** → the data directory is `animus/data/` **inside this repository** (the `ANIMUS_DATA_DIR` fallback). This is what `npm run dev` uses. Logs are at `animus/data/logs/animus.log`, databases at `animus/data/databases/`.

- **"Debug the production version" / "the macOS app that's running"** → the Tauri desktop app sets `ANIMUS_DATA_DIR` to the OS app-data location, **not** the repo. On macOS that is:

  ```
  ~/Library/Application Support/com.animus.desktop/
  ```

  Same internal layout as dev: `logs/animus.log` (rotates to `animus.log.1`, `.2`), `databases/*.db`, `saves/`, `media/`, `tool-results/`, plus desktop-only files (`sidecar.log`, `dock-addon.log`, `animus-desktop.log`, `node-helper.app/`). The bundle identifier is `com.animus.desktop`; do **not** confuse it with `com.animus.reverie` (a separate, unrelated dir).

When debugging, read logs and inspect databases from the correct directory for the version the user named. If it is ambiguous, ask which one. The Application Support path is macOS-specific; Windows and Linux use their own OS app-data conventions, and Docker/standalone set `ANIMUS_DATA_DIR` explicitly.

### Database Architecture

Eight separate SQLite databases with distinct purposes and lifecycles, all stored under `data/databases/`:

1. **system.db** - Core configuration (rarely reset)
   - Users and authentication
   - System settings
   - Credentials (encrypted API keys, OAuth tokens)

2. **persona.db** - Personality settings (separate lifecycle from system.db)

3. **heartbeat.db** - AI life state (occasional reset)
   - Heartbeat state and tick tracking
   - Thoughts, experiences, emotions
   - Tasks and actions
   - TTL-based cleanup

4. **memory.db** - Accumulated knowledge (reset with heartbeat or preserved independently)
   - Working memory (per-contact notepad)
   - Core self (agent's self-knowledge, singleton)
   - Long-term memories (extracted knowledge metadata)
   - LanceDB stores vector embeddings (search index, at `data/databases/lancedb/`)

5. **messages.db** - Conversation history (long-term retention)
   - Messages (user and Animus, both directions)
   - Conversations / threads
   - Channel metadata
   - Persists across heartbeat resets

6. **agent_logs.db** - SDK logs (frequent cleanup)
   - Agent sessions
   - Events (input, thinking, tool calls, responses)
   - Token usage and costs
   - Tool call logs

7. **contacts.db** - Contact identity (backed up with AI state)
   - Contacts and contact channels (identity resolution)
   - Permission tiers
   - Separated from system.db so contacts are included in .animus save/restore

8. **sessions.db** - Per-thread conversation state (cleared on soft reset)
   - Mind sessions keyed by (contact_id, channel)
   - Cortex conversation history and observational state per thread
   - Inner-life ticks start with empty history and do not persist sessions

### The Heartbeat System & The Mind

The heartbeat is the core tick system that drives Animus's inner life. The mind is a persistent agent session that runs during each tick — the orchestrator that thinks, feels, decides, and replies.

**Tick Triggers** — Four events can trigger a tick:
1. **Interval timer** — Regular heartbeat (default 5 min, configurable via UI)
2. **Message received** — User sends a message through any channel
3. **Scheduled task fires** — A cron-like task activates
4. **Sub-agent completion** — A delegated agent finishes its work

**Pipeline** — Each tick runs five stages:
1. **Gather** (system) — Assemble inputs: trigger context, emotional state, recent thoughts, active goals, running sub-agent status
2. **Thought** (direct LLM call) — Generates a stream-of-consciousness thought with importance rating. Not part of the agentic loop.
3. **Agentic Loop** (CortexAgent) — The agent reasons, uses tools, makes decisions, and replies. The thought from phase 2 is available in ephemeral context.
4. **Reflect** (direct LLM call) — Produces experience narration, emotion deltas, energy delta, memory candidates, working memory/core self updates. Not part of the agentic loop.
5. **Execute** (system) — Persist data from all phases, send replies, spawn sub-agents, cleanup expired entries

The mind is a top-level orchestrator. It does not perform long-running work; it delegates to sub-agents for complex tasks (research, multi-step workflows, code generation). Sub-agents are independent agent sessions managed by a custom orchestration layer. They carry the full Animus personality and can message the user directly. The mind can forward new information to running sub-agents via `update_agent` decisions. See `docs/architecture/agent-orchestration.md` for the full design. Pipeline state is persisted to SQLite for crash recovery.

### The Cortex Package (`@animus-labs/cortex`) -- External

**Cortex lives in its own repository, not in this monorepo.** It is published on npm as `@animus-labs/cortex` and consumed as a normal dependency. The local checkout is at `/Users/craigtut/Code/cortex-mono/`. It is a general-purpose agent framework wrapping `@mariozechner/pi-agent-core` with MCP tool support, tool permissions, budget guards, context compaction, a skill system, event logging, built-in tools, and provider management. When you need to read or modify Cortex source, look in `/Users/craigtut/Code/cortex-mono/packages/cortex/src/`. Cortex framework docs are at `/Users/craigtut/Code/cortex-mono/docs/`.

**Two main exports:** `CortexAgent` (agentic loop) and `ProviderManager` (provider discovery, OAuth, model resolution).

**Boundary rules still apply:** The backend imports from Cortex, never the reverse. When working on heartbeat/agent code, never add Animus-specific logic to the cortex-mono repo. Use Cortex's hooks and callbacks instead.

**Cortex framework documentation** lives in the cortex-mono repository (`/Users/craigtut/Code/cortex-mono/docs/`).

### The Agents Package (`@animus-labs/agents`)

A separate package providing a unified abstraction over multiple subprocess-based agent SDKs (Claude Agent SDK, Codex SDK, OpenCode SDK). Used for sub-agent orchestration where subprocess-based SDKs may still be useful. The Cortex package is the primary agent framework for the mind.

## Development Guidelines

### Running Locally

```bash
# Prerequisites: Node.js 24+

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# IMPORTANT: Agents must NEVER run dev servers.
# Do NOT run: npm run dev, npm run dev:backend, npm run dev:frontend
# These spawn long-running processes that become orphaned on Windows
# when the agent session ends, blocking ports indefinitely.
# The user manages dev servers manually. Your changes are picked up
# automatically by the running watch-mode servers.

# If you need to verify the backend is running:
# netstat -ano | grep ":3000 " | grep LISTEN

# NOTE: In dev mode, the backend imports @animus-labs/shared and @animus-labs/agents
# source (.ts) directly via the "source" export condition (--conditions source).
# This means changes to shared/agents source are picked up immediately -- no need
# to rebuild their dist. @animus-labs/cortex is published on npm and resolved
# from node_modules. The dist is only used for production builds. If you need dist:
# npm run build -w @animus-labs/shared
```

### Testing Requirements

**Every feature must have unit test coverage.** Use Vitest for testing.

```bash
npm run test        # Watch mode
npm run test:run    # Single run
npm run test:coverage
```

### Other Commands

```bash
npm run build         # Build all packages
npm run typecheck     # TypeScript type checking
npm run lint          # ESLint check
npm run lint:fix      # ESLint auto-fix
npm run clean         # Remove dist folders and caches
```

### Release Commands (Human-Initiated Only)

These commands exist but must **never be run by agents** unless the user explicitly asks.

```bash
npm run bump -- <patch|minor|major|X.Y.Z>   # Bump version across all lockstep packages
npm run bump -- --dry-run patch              # Preview what would change
npm run release -- <patch|minor|major>       # Full release: bump + changelog + commit + tag
npm run release -- --dry-run patch           # Preview the release flow
```

- `bump` updates 8 lockstep files: root package.json, tauri.conf.json, 2 Cargo.toml, 4 workspace package.json files. Does NOT touch shared, channel-sdk, or anipack.
- `release` runs bump, generates changelog from conventional commits, commits as `chore(release): vX.Y.Z`, creates an annotated git tag, then prints push instructions. It does NOT push automatically.
- See `docs/architecture/release-engineering.md` for the full versioning policy and release process.

### Writing Style

- **Never use em dashes** (`—`) when writing copy. Use alternative punctuation (commas, colons, semicolons, parentheses, or separate sentences) instead.

### Code Style

- Use TypeScript strict mode
- Validate all external input with Zod schemas
- Keep functions small and focused
- Prefer composition over inheritance
- Use meaningful variable names
- Add comments only for non-obvious logic

### Commit Conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/).

**Format (single line only, no body, no footer):**
```
<type>(<scope>): <description>
```

Example: `feat(heartbeat): add configurable tick interval`

Do NOT add a commit body or footer. No `Co-Authored-By`, no bullet lists, no extra lines. Just the one line.

**Types:** `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `style`

**Scopes** (use the most specific applicable):
`heartbeat`, `memory`, `agents`, `cortex`, `channels`, `plugins`, `contacts`, `goals`, `tasks`, `persona`, `frontend`, `backend`, `shared`, `tauri`, `api`, `db`, `auth`, `ci`, `release`

**Rules:**
- Commit early and often. Small, focused commits are preferred over large batches.
- Each commit should be one logical change.
- Write in imperative mood: "add feature" not "added feature".
- Keep the first line under 100 characters.
- Always use `git commit -m "..."` with a single-line message.

**What agents must NOT do:**
- Do NOT create git branches without asking first. Commit directly to the current branch (normally `main`). If a branch seems warranted, ask before creating one. This includes agent worktree isolation, which also creates branches.
- Do NOT run `scripts/bump-version.mjs` or `scripts/release.mjs`
- Do NOT create git tags
- Do NOT push to remote unless explicitly asked
- Do NOT modify version numbers in package.json, Cargo.toml, or tauri.conf.json
- Version bumps and releases are human-initiated only

### Backend Architecture

The backend follows a **modular monolith** architecture. Before adding new backend features, services, stores, or modifying the heartbeat pipeline, read `docs/architecture/backend-architecture.md` for the required patterns.

**Key rules:**
- **Stores**: One file per domain entity group. Stateless functions, `db` as first arg, no business logic.
- **Services**: Every router delegates to a service. Services own business logic. Follow the `ContactService`/`TaskService` singleton getter pattern.
- **Subsystems**: New subsystems implement `SubsystemLifecycle` (start/stop/healthCheck hooks) and register with the `LifecycleManager`.
- **Pipeline deps**: Heartbeat pipeline functions receive all dependencies via typed parameter objects. No ambient singleton calls inside function bodies.
- **Decision handlers**: New decision types register a handler via `registerDecisionHandler()`. Never add cases to a central switch.

### Backend Logging

**All backend logging MUST use the logger from `packages/backend/src/lib/logger.ts`.** Never use raw `console.log/warn/error` in backend code (the only exception is `utils/env.ts` which runs before the logger is available).

```typescript
import { createLogger } from '../lib/logger.js';
const log = createLogger('MyService', 'mycategory');

log.info('Something happened');
log.warn('Something concerning', details);
log.error('Something failed:', err);
log.debug('Verbose details');
```

- First argument to `createLogger` is the **context name** shown in yellow brackets: `[MyService]`
- Second argument is the **category** for DB-based filtering (defaults to lowercase context name)
- Existing categories: `server`, `heartbeat`, `agents`, `channels`, `auth`, `database`
- Categories are toggled via `settings.updateLogCategories` tRPC endpoint, stored in `system_settings.log_categories`
- Level filtering respects `LOG_LEVEL` env var (`debug < info < warn < error`)
- **Log file**: All log output is also written to `data/logs/animus.log` at debug level (captures everything regardless of console `LOG_LEVEL` or category filters). The file rotates at 5MB (`animus.log.1`). The `data/logs/` directory is gitignored (under `data/`).

```bash
# Tail logs in real-time during development
tail -f data/logs/animus.log

# Search for errors
grep "ERROR" data/logs/animus.log

# Claude Code can read logs directly via the Read tool:
# data/logs/animus.log
```

### API Design

All API endpoints use tRPC. Define procedures in `/packages/backend/src/api/routers/`.

```typescript
// Example procedure
export const exampleRouter = router({
  getItem: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      // Implementation
    }),
});
```

### Real-time Updates

Use tRPC subscriptions for live data:

```typescript
// Backend
onHeartbeat: publicProcedure.subscription(() => {
  return observable<HeartbeatState>((emit) => {
    // Emit updates
  });
});

// Frontend
const { data } = trpc.onHeartbeat.useSubscription();
```

### Agent Integration

The mind uses `@animus-labs/cortex` (CortexAgent) for the primary agentic loop. The backend is a consumer of Cortex; see "The Cortex Package" section above for the boundary rules. The `@animus-labs/agents` package remains available for sub-agent orchestration. For full Cortex framework docs, see the cortex-mono repository.

**Boundary reminder**: When working on the heartbeat pipeline or agent-related backend code, never add Animus-specific logic to the cortex-mono repository. If the backend needs Cortex to do something application-specific, use one of Cortex's hooks or callbacks. If no suitable hook exists, add a general-purpose hook to Cortex that any consumer could use, then implement the Animus-specific behavior in the backend's hook handler.

### Event Logging

All agent interactions are logged via Cortex's EventBridge, which normalizes pi-agent-core events into the existing `AgentEventType` enum. The backend's `CortexLogBridge` listens to these events and persists them to `agent_logs.db`. Each pipeline phase (THOUGHT, AGENTIC LOOP, REFLECT) creates its own log session scope for traceability. The backend also emits its own pipeline events (`tick_input`, `tick_output`, `execute_*`) independently.

## Important Principles

1. **Self-Contained**: No external databases or infrastructure. SQLite + LanceDB only.
2. **Single User**: Design for one user per instance, not multi-tenancy.
3. **Testable**: Every feature needs tests. AI will eventually build on this.
4. **Observable**: Extensive logging for debugging agent behavior.
5. **Recoverable**: Persist state to survive crashes gracefully.
6. **Open Source Ready**: Clean code that others can understand and contribute to.

## Documentation (MANDATORY)

**IMPORTANT: Before implementing any feature, fixing any bug, or making any non-trivial change, you MUST use `/doc-explorer <topic>` to load the relevant documentation context first.** This is not optional. The `/docs` folder contains critical design decisions, architectural patterns, and constraints that must be followed. Implementing without reading the docs risks building something inconsistent with the project's design. After creating new documents you need to make sure that they are referenced in the Doc Explorer skill (`.skills/doc-explorer/SKILL.md`).

Detailed project documentation lives in `/docs`. Use `/doc-explorer <topic>` to explore documentation for a specific area, or invoke it without arguments to see all available topics.

### Documentation Structure

```
docs/
  product-vision.md          # What Animus is and why it exists
  brand-vision.md            # Visual identity, personality, design language
  design-vision.md           # Visual & interaction language (light, analog, alive)
  architecture/              # Backend architecture specs (source of truth)
  cortex/                    # Cortex integration docs (Animus-specific; framework docs in cortex-mono)
  agents/                    # Agent SDK docs, comparison, per-provider references
  research/                  # Planned features and exploratory research (not yet built)
  guides/                    # Getting started, setup instructions
```

- **Architecture docs** describe implemented systems. They are authoritative.
- **Research docs** describe planned or exploratory work. They are marked with STATUS headers.
- **Frontend page specs have been removed.** The code in `packages/frontend/src/` is the authoritative source for frontend implementation. Only `design-vision.md` remains as a design guideline doc.
- **Agent SDK research docs** are reference material. See `docs/agents/sdk-comparison.md` for the consolidated overview.

### Key docs by area

- **Vision & Identity**: `docs/product-vision.md`, `docs/brand-vision.md`, `docs/design-vision.md`
- **Heartbeat & Pipeline**: `docs/architecture/heartbeat.md`, `docs/architecture/context-builder.md`
- **Features**: `docs/architecture/memory.md`, `docs/architecture/goals.md`, `docs/architecture/tasks-system.md`, `docs/architecture/contacts.md`, `docs/architecture/observational-memory.md`
- **Persona**: `docs/architecture/persona.md`
- **Channels & Plugins**: `docs/architecture/channel-packages.md`, `docs/architecture/channels.md`, `docs/architecture/plugin-system.md`
- **Tools & Permissions**: `docs/architecture/mcp-tools.md`, `docs/architecture/tool-permissions.md`
- **Voice/Speech**: `docs/architecture/voice-channel.md`, `docs/architecture/speech-engine.md`, `docs/architecture/tts-licensing-and-distribution.md`
- **Security**: `docs/architecture/encryption-architecture.md`, `docs/architecture/credential-passing.md`
- **Telemetry**: `docs/architecture/telemetry.md`
- **Infrastructure**: `docs/architecture/data-directory.md`, `docs/architecture/backend-architecture.md`, `docs/architecture/tech-stack.md`, `docs/architecture/sleep-energy.md`, `docs/architecture/release-engineering.md`
- **Cortex Integration**: framework docs are in the cortex-mono repository (`/Users/craigtut/Code/cortex-mono/docs/`)
- **Agent SDKs (legacy)**: `docs/agents/sdk-comparison.md`, `docs/agents/architecture-overview.md`, plus per-provider docs in `docs/agents/claude/`, `docs/agents/codex/`, `docs/agents/opencode/`
- **Planned (not built)**: `docs/research/reflex-system.md`, `docs/research/voice-mode.md`

Use `/doc-explorer <topic>` for the full index and keyword guide. Examples:
- `/doc-explorer heartbeat` for the tick system
- `/doc-explorer memory` for the memory architecture
- `/doc-explorer agents` for SDK comparison
- `/doc-explorer` (no args) to see everything

## File Locations

- Types: `/packages/shared/src/types/`
- Schemas: `/packages/shared/src/schemas/`
- Agent abstractions (legacy): `/packages/agents/src/`
- API routes: `/packages/backend/src/api/routers/`
- Database: `/packages/backend/src/db/`
- Heartbeat: `/packages/backend/src/heartbeat/`
- Frontend pages: `/packages/frontend/src/pages/`
- Components: `/packages/frontend/src/components/`
- Stores: `/packages/frontend/src/store/`
- Theme: `/packages/frontend/src/styles/theme.ts`
