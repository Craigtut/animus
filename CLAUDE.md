# Animus

An agentic system with a mind, a spirit, and an inner will that moves with agency to act.

## Project Overview

Animus is an autonomous AI assistant designed to be genuinely helpful while maintaining its own simulated inner life. Unlike traditional assistants that exist only in the moment of interaction, Animus maintains continuous internal processes: thoughts that emerge even when no one is asking, memories that consolidate, emotions that color responses, and goals pursued across time.

**Key Principle**: This is a self-hosted, single-user application. Every user runs their own instance. The goal is eventual self-building capability where Animus can modify its own code.

## Architecture

### Monorepo Structure

```
/packages
  /shared     - Shared types, Zod schemas, utilities
  /agents     - Agent SDK abstraction layer (Claude, Codex, OpenCode)
  /backend    - Fastify + tRPC server
  /frontend   - Vite + React 19 SPA
/docs         - Documentation
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
- Three SQLite databases (see below)
- LanceDB for vector storage/semantic search
- Agent SDKs: Claude (default), Codex, OpenCode

### Database Architecture

Three separate SQLite databases with distinct purposes:

1. **system.db** - Core configuration (rarely reset)
   - Users and authentication
   - System settings
   - Personality configuration
   - API keys (encrypted)

2. **heartbeat.db** - AI life state (occasional reset)
   - Heartbeat state and tick tracking
   - Thoughts, experiences, emotions
   - Tasks and actions
   - TTL-based cleanup

3. **agent_logs.db** - SDK logs (frequent cleanup)
   - Agent sessions
   - Events (input, thinking, tool calls, responses)
   - Token usage and costs
   - Tool call logs

### The Heartbeat System

The heartbeat is the core tick system that drives Animus's inner life. It runs every 5 minutes by default and executes a sequential pipeline:

1. **perceive** - Gather inputs, check messages, observe environment
2. **think** - Process information, generate thoughts
3. **feel** - Evaluate emotional responses
4. **decide** - Determine if action is needed
5. **act** - Execute decided actions
6. **reflect** - Review what happened
7. **consolidate** - Update memories, cleanup expired entries

Pipeline state is persisted to SQLite, allowing recovery from crashes mid-tick.

### The Agents Package (`@animus/agents`)

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
# Prerequisites: Node.js 20+

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Start development (backend + frontend)
npm run dev            # Runs all packages in parallel

# Or run separately:
npm run dev:backend   # http://localhost:3000
npm run dev:frontend  # http://localhost:5173
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

### Code Style

- Use TypeScript strict mode
- Validate all external input with Zod schemas
- Keep functions small and focused
- Prefer composition over inheritance
- Use meaningful variable names
- Add comments only for non-obvious logic

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

The `@animus/agents` package provides a unified interface for all agent SDKs.

**Status**: Types defined, implementation pending.

```typescript
import { IAgentSession, AgentSessionConfig } from '@animus/agents';

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
