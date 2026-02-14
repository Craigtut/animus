# Getting Started with Animus

This guide will help you set up Animus for local development.

## Prerequisites

- **Node.js** 24.0 or higher
- **npm** 10.0 or higher
- Git

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/animus.git
cd animus
```

### 2. Install Dependencies

```bash
npm install
```

This will install dependencies for all packages (shared, agents, backend, frontend) via npm workspaces.

### 3. Environment Configuration

Create a `.env` file in the root directory:

```bash
# Server
NODE_ENV=development
PORT=3000
HOST=0.0.0.0
LOG_LEVEL=info

# Database paths (relative to backend package)
DB_SYSTEM_PATH=./data/system.db
DB_HEARTBEAT_PATH=./data/heartbeat.db
DB_MESSAGES_PATH=./data/messages.db
DB_AGENT_LOGS_PATH=./data/agent_logs.db
LANCEDB_PATH=./data/lancedb

# Heartbeat
HEARTBEAT_INTERVAL_MS=300000

# Auth
JWT_SECRET=your-secret-key-change-in-production
SESSION_EXPIRY_DAYS=7

# Agent API Keys (optional for development)
ANTHROPIC_API_KEY=your-anthropic-key
OPENAI_API_KEY=your-openai-key
```

### 4. Start Development Servers

> **Note:** Before starting the servers, check if they are already running. During active development the backend and frontend are often already running in watch mode and will automatically pick up your latest changes. You can check with `lsof -i:3000` (backend) and `lsof -i:5173` (frontend). Only start them if nothing is listening on those ports.

Run both backend and frontend in development mode:

```bash
npm run dev
```

Or run them separately:

```bash
# Terminal 1: Backend (http://localhost:3000)
npm run dev:backend

# Terminal 2: Frontend (http://localhost:5173)
npm run dev:frontend
```

### 5. Open the Application

Visit [http://localhost:5173](http://localhost:5173) in your browser.

## Project Structure

```
animus/
├── packages/
│   ├── shared/          # Shared types, schemas, utilities
│   │   └── src/
│   │       ├── types/   # TypeScript interfaces
│   │       ├── schemas/ # Zod validation schemas
│   │       └── utils/   # Shared utilities
│   │
│   ├── agents/          # Agent SDK abstraction layer
│   │   └── src/
│   │       ├── index.ts # Package entry point
│   │       └── types.ts # Unified agent interfaces
│   │
│   ├── backend/         # Fastify + tRPC server
│   │   └── src/
│   │       ├── api/     # tRPC routers
│   │       ├── db/      # Database management
│   │       ├── heartbeat/ # Heartbeat system
│   │       └── utils/   # Backend utilities
│   │
│   ├── channel-sdk/     # Types-only package for channel adapter authors
│   │
│   └── frontend/        # Vite + React SPA
│       └── src/
│           ├── components/ # Reusable components
│           ├── pages/     # Page components
│           ├── hooks/     # Custom hooks
│           ├── store/     # Zustand stores
│           ├── styles/    # Theme and global styles
│           └── utils/     # Frontend utilities
│
├── channels/           # Reference channel packages (not part of the engine)
├── docs/               # Documentation
├── CLAUDE.md          # AI assistant context
└── package.json       # Root package with workspaces
```

## Development Workflow

### Running Tests

```bash
# Watch mode
npm run test

# Single run
npm run test:run

# With coverage
npm run test:coverage
```

### Type Checking

```bash
npm run typecheck
```

### Linting

```bash
# Check for issues
npm run lint

# Auto-fix
npm run lint:fix
```

### Building for Production

```bash
# Build all packages
npm run build

# Build frontend only
npm run build:frontend

# Build backend only
npm run build:backend
```

### Running Production Build

```bash
cd packages/backend
npm run start
```

This serves both the API and the built frontend at `http://localhost:3000`.

## Database Management

Animus uses four SQLite databases that are created automatically on first run:

| Database | Location | Purpose | Lifecycle |
|----------|----------|---------|-----------|
| system.db | `./data/system.db` | Users, settings, API keys | Rarely reset |
| heartbeat.db | `./data/heartbeat.db` | Thoughts, emotions, tasks | Occasional reset |
| messages.db | `./data/messages.db` | Conversations, messages, channels | Long-term history |
| agent_logs.db | `./data/agent_logs.db` | Agent sessions, events | Frequent cleanup |

### Resetting Databases

To start fresh:

```bash
# Remove all databases
rm -rf packages/backend/data/*.db

# Restart the server to recreate
npm run dev:backend
```

To reset only the heartbeat state (gives Animus a "fresh mind" without losing conversation history):

```bash
rm packages/backend/data/heartbeat.db
```

## Configuring Agent Providers

Animus supports three agent providers. Configure API keys in `.env` or through the Settings page.

### Claude (Default)

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

### Codex

```bash
OPENAI_API_KEY=sk-...
```

### OpenCode

OpenCode requires a running OpenCode server. See [OpenCode documentation](https://opencode.ai/docs/sdk/).

## Next Steps

1. **Create a user account** - Visit `/login` and sign up
2. **Configure settings** - Visit `/settings` to customize Animus
3. **Explore the dashboard** - Watch the heartbeat and agent activity
4. **Read the architecture docs** - Understand how Animus works

## Troubleshooting

### Port Already in Use

```bash
# Kill process on port 3000
lsof -ti:3000 | xargs kill -9

# Kill process on port 5173
lsof -ti:5173 | xargs kill -9
```

### Database Errors

If you see "database is locked" errors, ensure only one instance is running:

```bash
ps aux | grep node
```

### TypeScript Errors

After pulling new changes, rebuild the shared package:

```bash
npm run build -w @animus/shared
```

### Module Not Found

Try cleaning and reinstalling:

```bash
rm -rf node_modules packages/*/node_modules
npm install
```
