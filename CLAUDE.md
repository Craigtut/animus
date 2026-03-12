# Animus

**Organization**: Animus Labs (`@animus-labs` on npm)

An agentic system with a mind, a spirit, and an inner will that moves with agency to act.

## Project Overview

Animus is an autonomous AI assistant designed to be genuinely helpful while maintaining its own simulated inner life. Unlike traditional assistants that exist only in the moment of interaction, Animus maintains continuous internal processes: thoughts that emerge even when no one is asking, memories that consolidate, emotions that color responses, and goals pursued across time.

**Key Principle**: This is a self-hosted, single-user application. Every user runs their own instance. The goal is eventual self-building capability where Animus can modify its own code.

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
- Seven SQLite databases (see below)
- LanceDB for vector storage/semantic search
- Transformers.js + BGE-small-en-v1.5 for local embeddings
- Agent SDKs: Claude (default), Codex, OpenCode

### Database Architecture

Seven separate SQLite databases with distinct purposes and lifecycles, all stored under `data/databases/`:

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

### The Heartbeat System & The Mind

The heartbeat is the core tick system that drives Animus's inner life. The mind is a persistent agent session that runs during each tick — the orchestrator that thinks, feels, decides, and replies.

**Tick Triggers** — Four events can trigger a tick:
1. **Interval timer** — Regular heartbeat (default 5 min, configurable via UI)
2. **Message received** — User sends a message through any channel
3. **Scheduled task fires** — A cron-like task activates
4. **Sub-agent completion** — A delegated agent finishes its work

**Pipeline** — Each tick runs three stages:
1. **Gather Context** (system) — Assemble inputs: trigger context, emotional state, recent thoughts, active goals, running sub-agent status
2. **Mind Query** (agent session) — Single structured output covering thoughts, experiences, emotion analysis, decisions, and contextually message replies
3. **Execute** (system) — Persist data, send replies, spawn sub-agents, cleanup expired entries

The mind is a top-level orchestrator. It does not perform long-running work — it delegates to sub-agents for complex tasks (research, multi-step workflows, code generation). Sub-agents are independent agent sessions managed by a custom orchestration layer. They carry the full Animus personality and can message the user directly. The mind can forward new information to running sub-agents via `update_agent` decisions. See `docs/architecture/agent-orchestration.md` for the full design. Pipeline state is persisted to SQLite for crash recovery.

### The Agents Package (`@animus-labs/agents`)

A separate package providing a unified abstraction over multiple agent SDKs:

| SDK | Provider | Purpose |
|-----|----------|---------|
| Claude Agent SDK | Anthropic | Default provider, full-featured agent capabilities |
| Codex SDK | OpenAI | Alternative provider |
| OpenCode SDK | OpenCode.ai | Alternative provider |

**Why a separate package?**
- Clean separation from backend HTTP/database concerns
- Can be tested independently
- Allows heavy iteration without touching backend code
- Clear interface boundaries for each SDK adapter

**Key interfaces** (in `/packages/agents/src/types.ts`):
- `IAgentAdapter` - Interface each SDK adapter must implement
- `IAgentSession` - Active session with prompt/streaming methods
- `AgentEvent` - Normalized event type across all providers

**Status**: Interface types defined, SDK adapter implementations pending.

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
# This means changes to shared/agents source are picked up immediately —
# no need to rebuild their dist. The dist is only used for production builds.
# If you need dist for any reason: npm run build -w @animus-labs/shared
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
`heartbeat`, `memory`, `agents`, `channels`, `plugins`, `contacts`, `goals`, `tasks`, `persona`, `frontend`, `backend`, `shared`, `tauri`, `api`, `db`, `auth`, `ci`, `release`

**Rules:**
- Commit early and often. Small, focused commits are preferred over large batches.
- Each commit should be one logical change.
- Write in imperative mood: "add feature" not "added feature".
- Keep the first line under 100 characters.
- Always use `git commit -m "..."` with a single-line message.

**What agents must NOT do:**
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

The `@animus-labs/agents` package provides a unified interface for all agent SDKs. Claude and Codex adapters are fully implemented and integrated. The OpenCode adapter is built but not yet wired into the backend/frontend. See `docs/agents/sdk-comparison.md` for provider comparison and `docs/agents/architecture-overview.md` for the abstraction layer design.

### Event Logging

All agent interactions must be logged. The agent abstraction layer handles this automatically, but ensure:

- Session start/end events
- All inputs and outputs
- Tool calls with inputs, outputs, and errors
- Token usage and costs
- Timing information

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
  design-principles.md       # UI/UX design philosophy and component guidelines
  architecture/              # Backend architecture specs (source of truth)
  agents/                    # Agent SDK docs, comparison, per-provider references
  research/                  # Planned features and exploratory research (not yet built)
  guides/                    # Getting started, setup instructions
```

- **Architecture docs** describe implemented systems. They are authoritative.
- **Research docs** describe planned or exploratory work. They are marked with STATUS headers.
- **Frontend page specs have been removed.** The code in `packages/frontend/src/` is the authoritative source for frontend implementation. Only `design-principles.md` remains as a design guideline doc.
- **Agent SDK research docs** are reference material. See `docs/agents/sdk-comparison.md` for the consolidated overview.

### Key docs by area

- **Vision & Identity**: `docs/product-vision.md`, `docs/brand-vision.md`, `docs/design-principles.md`
- **Heartbeat & Pipeline**: `docs/architecture/heartbeat.md`, `docs/architecture/context-builder.md`
- **Features**: `docs/architecture/memory.md`, `docs/architecture/goals.md`, `docs/architecture/tasks-system.md`, `docs/architecture/contacts.md`, `docs/architecture/observational-memory.md`
- **Persona**: `docs/architecture/persona.md`
- **Channels & Plugins**: `docs/architecture/channel-packages.md`, `docs/architecture/channels.md`, `docs/architecture/plugin-system.md`
- **Tools & Permissions**: `docs/architecture/mcp-tools.md`, `docs/architecture/tool-permissions.md`
- **Voice/Speech**: `docs/architecture/voice-channel.md`, `docs/architecture/speech-engine.md`, `docs/architecture/tts-licensing-and-distribution.md`
- **Security**: `docs/architecture/encryption-architecture.md`, `docs/architecture/credential-passing.md`
- **Telemetry**: `docs/architecture/telemetry.md`
- **Infrastructure**: `docs/architecture/data-directory.md`, `docs/architecture/backend-architecture.md`, `docs/architecture/tech-stack.md`, `docs/architecture/sleep-energy.md`, `docs/architecture/release-engineering.md`
- **Agent SDKs**: `docs/agents/sdk-comparison.md`, `docs/agents/architecture-overview.md`, plus per-provider docs in `docs/agents/claude/`, `docs/agents/codex/`, `docs/agents/opencode/`
- **Planned (not built)**: `docs/research/reflex-system.md`, `docs/research/voice-mode.md`, `docs/agents/pi/research/`

Use `/doc-explorer <topic>` for the full index and keyword guide. Examples:
- `/doc-explorer heartbeat` for the tick system
- `/doc-explorer memory` for the memory architecture
- `/doc-explorer agents` for SDK comparison
- `/doc-explorer` (no args) to see everything

## File Locations

- Types: `/packages/shared/src/types/`
- Schemas: `/packages/shared/src/schemas/`
- Agent abstractions: `/packages/agents/src/`
- API routes: `/packages/backend/src/api/routers/`
- Database: `/packages/backend/src/db/`
- Heartbeat: `/packages/backend/src/heartbeat/`
- Frontend pages: `/packages/frontend/src/pages/`
- Components: `/packages/frontend/src/components/`
- Stores: `/packages/frontend/src/store/`
- Theme: `/packages/frontend/src/styles/theme.ts`
