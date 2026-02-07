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
| **Node.js** | ^20.0 | Runtime |
| **Fastify** | ^5.0 | HTTP server |
| **tRPC** | ^11.0 | API framework |

**Why Fastify?** High performance, excellent plugin ecosystem, native TypeScript support, and easy WebSocket integration.

### Databases

| Technology | Version | Purpose |
|------------|---------|---------|
| **better-sqlite3** | ^11.0 | SQLite driver |
| **LanceDB** | ^0.12 | Vector database |

**Why SQLite?**
- Zero configuration
- Single file per database
- Excellent performance for single-user workloads
- ACID compliance
- WAL mode for concurrent reads

**Why four separate SQLite databases?**
1. **system.db** - Core config that should never be accidentally deleted (users, contacts, contact channels, settings, API keys)
2. **heartbeat.db** - AI state that might be reset for fresh start (thoughts, emotions, experiences, agent tasks)
3. **messages.db** - Conversation history that persists across heartbeat resets (messages tagged with contact_id, conversations)
4. **agent_logs.db** - High-volume logs with aggressive TTL cleanup (sessions, events, usage)

**Why LanceDB?**
- Embedded (no external server)
- Optimized for AI/ML workloads
- Native vector similarity search
- Works with SQLite-like simplicity

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
              ┌──────────────────────────────┼──────────────────────────────┐
              │                    │                        │               │
        ┌─────▼─────┐      ┌──────▼──────┐         ┌──────▼──────┐  ┌─────▼──────┐
        │ system.db │      │heartbeat.db │         │ messages.db │  │agent_logs  │
        │           │      │             │         │             │  │   .db      │
        │ - Users   │      │ - Thoughts  │         │ - Messages  │  │ - Sessions │
        │ - Auth    │      │ - Emotions  │         │ - Convos    │  │ - Events   │
        │ - Contacts│      │ - Tasks     │         │ - Channels  │  │ - Usage    │
        │ - Settings│      │             │         │             │  │            │
        └───────────┘      └─────────────┘         └─────────────┘  └────────────┘
                                  │
                           ┌──────▼──────┐
                           │   LanceDB   │
                           │             │
                           │ - Embeddings│
                           │ - Memories  │
                           └─────────────┘
```

## Security Considerations

- **Authentication**: Email/password with session cookies
- **API Keys**: Stored encrypted in system.db
- **CORS**: Configured for same-origin in production
- **Input Validation**: All tRPC inputs validated with Zod
- **SQL Injection**: Prevented by parameterized queries (better-sqlite3)
