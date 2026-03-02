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

**Note**: Channel adapters and plugins live in the separate [animus-extensions](https://github.com/craigtut/animus-extensions) repository.

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

# IMPORTANT: Check if servers are already running before starting them.
# During development, the backend and frontend are often already running
# in watch mode and will automatically pick up your changes.
# Check with: lsof -i:3000 (backend) and lsof -i:5173 (frontend)

# Start development (backend + frontend)
npm run dev            # Runs backend + frontend in parallel

# Or run separately:
npm run dev:backend   # http://localhost:3000
npm run dev:frontend  # http://localhost:5173

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

### Writing Style

- **Never use em dashes** (`—`) when writing copy. Use alternative punctuation (commas, colons, semicolons, parentheses, or separate sentences) instead.

### Code Style

- Use TypeScript strict mode
- Validate all external input with Zod schemas
- Keep functions small and focused
- Prefer composition over inheritance
- Use meaningful variable names
- Add comments only for non-obvious logic

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

The `@animus-labs/agents` package provides a unified interface for all agent SDKs.

**Status**: Types defined, implementation pending.

```typescript
import { IAgentSession, AgentSessionConfig } from '@animus-labs/agents';

// Future API (not yet implemented):
const session = await adapter.createSession({
  provider: 'claude',  // or 'codex', 'opencode'
  systemPrompt: '...',
});

session.onEvent((event) => {
  // Handle normalized streaming events
});

const response = await session.prompt('...');
```

The agents package is separate from backend to maintain clear boundaries and allow independent iteration.

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

**IMPORTANT: Before implementing any feature, fixing any bug, or making any non-trivial change, you MUST use `/doc-explorer <topic>` to load the relevant documentation context first.** This is not optional. The `/docs` folder contains critical design decisions, architectural patterns, and constraints that must be followed. Implementing without reading the docs risks building something inconsistent with the project's design. After creating new documents you need to make sure that they are referenced in the Doc Explorer. 

Detailed project documentation lives in `/docs`. Use `/doc-explorer <topic>` to explore documentation for a specific area, or invoke it without arguments to see all available topics.

**Available documentation areas:**
- **Vision & Identity**: `docs/project-vision.md`, `docs/brand-vision.md`
- **Architecture**: `docs/architecture/heartbeat.md`, `docs/architecture/agent-orchestration.md`, `docs/architecture/contacts.md`, `docs/architecture/persona.md`, `docs/architecture/tech-stack.md`
- **Architecture**: `docs/architecture/goals.md` (goal system, seeds, plans, salience), `docs/architecture/tasks-system.md` (scheduled & deferred tasks, task ticks)
- **Architecture**: `docs/architecture/memory.md` (four memory layers, memory.db, embeddings, write pipeline, consolidation)
- **Architecture**: `docs/architecture/context-builder.md` (context assembly, prompt compilation, token budgets, persona compilation)
- **Architecture**: `docs/architecture/channel-packages.md` (channel system — protocol, packaging, child process isolation, IPC streaming, AdapterContext, manifests, Channel Manager, hot-swap, dynamic types, security, channel reference specs)
- **Architecture**: `docs/architecture/mcp-tools.md` (cross-provider MCP tool architecture, tool definitions, handlers, registry, permission filtering)
- **Architecture**: `docs/architecture/tool-permissions.md` (tool permission & approval system, three permission states, risk tiers, two-tick approval pattern, canUseTool, trust ramp, sub-agent filtering)
- **Architecture**: `docs/architecture/voice-channel.md` (voice channel — Parakeet TDT v3 STT + Pocket TTS, both via sherpa-onnx, frontend voice mode, audio pipeline)
- **Architecture**: `docs/architecture/speech-engine.md` (shared STT/TTS engines, Pocket TTS, Parakeet STT, voice system, voice manager)
- **Architecture**: `docs/architecture/sleep-energy.md` (sleep & energy system, circadian rhythm, energy bands, wake-up mechanics, accelerated emotional decay)
- **Architecture**: `docs/architecture/plugin-system.md` (plugin system — skills-first philosophy, 7 component types, manifest format, config schemas, credential handling, MCP tools, hooks, decision types, triggers, hot-swap lifecycle, security model, plugin gallery)
- **Architecture**: `docs/architecture/credential-passing.md` (secrets & credentials — AES-256-GCM encryption at rest, agent-blind model, three storage locations, credential manifest, plugin `${config.*}` resolution, `run_with_credentials` tool, channel IPC injection, frontend masking, threat model)
- **Architecture**: `docs/architecture/observational-memory.md` (observational memory — three-stream compression, Observer/Reflector agents, token-based thresholds, async processing, memory.db schema)
- **Architecture**: `docs/architecture/reflex-system.md` (reflex fast-response layer — Vercel AI SDK, dual-path voice architecture, lightweight context, heartbeat integration, provider configuration)
- **Architecture**: `docs/architecture/tts-licensing-and-distribution.md` (TTS model licensing, CC-BY-4.0 redistribution, weight bundling approach, voice cloning consent flow, attribution requirements)
- **Architecture**: `docs/architecture/data-directory.md` (data directory layout, `ANIMUS_DATA_DIR` resolution, secrets lifecycle, deployment modes)
- **Architecture**: `docs/architecture/package-installation.md` (package distribution — .anpk install flow, verification chain, rollback, update checking, config migration, store browser UI, AI self-management MCP tools)
- **Architecture**: `docs/architecture/backend-architecture.md` (modular monolith patterns, store/service/lifecycle/pipeline conventions, anti-patterns)
- **Open Questions**: `docs/architecture/open-questions.md` (all 7 resolved)
- **Open Concerns**: `docs/architecture/open-concerns.md` (known acceptable concerns)
- **Frontend Design**: `docs/frontend/design-principles.md`, `docs/frontend/onboarding.md`
- **Frontend Specs**: `docs/frontend/app-shell.md` (navigation, transitions, routes), `docs/frontend/presence.md` (main space), `docs/frontend/mind.md` (inner life detail), `docs/frontend/people.md` (contacts), `docs/frontend/settings.md` (configuration), `docs/frontend/voice-mode.md` (voice interaction)
- **Guides**: `docs/guides/getting-started.md`
- **Agent SDKs**: `docs/agents/` (per-provider folders: claude/, codex/, opencode/, pi/ + architecture overview + plugin/extension systems)

**When to use `/doc-explorer`:**
- Starting work on any feature → `/doc-explorer` with the relevant topic
- Working on frontend/UI → `/doc-explorer design` and `/doc-explorer brand`
- Working on contacts/identity/permissions → `/doc-explorer contacts`
- Working on channels/SMS/Discord/API → `/doc-explorer channels`
- Working on channel packages/installation/isolation → `/doc-explorer channel-packages`
- Working on persona/personality system → `/doc-explorer persona`
- Working on the heartbeat system → `/doc-explorer heartbeat`
- Working on memory/knowledge/embeddings → `/doc-explorer memory`
- Working on observational memory/compression/observer/reflector → `/doc-explorer observational-memory`
- Working on context assembly/prompt building → `/doc-explorer context-builder`
- Working on shared abstractions (embedding, decay, encryption, auth, migrations) → `/doc-explorer tech-stack`
- Working on secrets/credentials/encryption/API keys → `/doc-explorer credential-passing`
- Working on data directory layout/paths/env vars/secrets → `/doc-explorer data-directory`
- Working on MCP tools/custom tools → `/doc-explorer mcp-tools`
- Working on tool permissions/approval flow/trust ramp → `/doc-explorer tool-permissions`
- Working on voice/speech/STT/TTS/audio → `/doc-explorer voice` and `/doc-explorer speech-engine`
- Working on speech/STT/TTS/voice synthesis/voice management → `/doc-explorer speech-engine`
- Working on reflex/fast-response/voice-latency → `/doc-explorer reflex`
- Working on TTS licensing/model distribution/voice cloning consent → `/doc-explorer tts-licensing`
- Working on sleep/energy/circadian rhythm → `/doc-explorer sleep-energy`
- Working on agent SDKs → `/doc-explorer agents`
- Working on Pi adapter/transformContext → `/doc-explorer pi`
- Building a new plugin → see the `build-plugin` skill in the `animus-extensions` repo; for architecture context use `/doc-explorer plugin-system`
- Working on package distribution/packaging/.anpk format → `/doc-explorer package-installation` and see `docs/architecture/distribution-system.md` (workspace root) for the master overview
- Working on backend architecture/stores/services/new modules → `/doc-explorer backend-architecture`
- Working on backend/API → `/doc-explorer architecture`
- Unsure about project conventions → `/doc-explorer` (no args, see everything)

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
