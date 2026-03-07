# Getting Started with Animus

This guide will help you set up Animus for local development.

## Prerequisites

- **Node.js** 24.0 or higher
- **npm** 10.0 or higher
- **Git**
- **ffmpeg** (optional, required for voice/speech features)
  - Windows: `winget install ffmpeg`
  - macOS: `brew install ffmpeg`
  - Linux: `sudo apt install ffmpeg` (Debian/Ubuntu) or `sudo dnf install ffmpeg` (Fedora)

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/craigtut/animus.git
cd animus
```

### 2. Install Dependencies

```bash
npm install
```

This will install dependencies for all packages (shared, agents, backend, frontend) via npm workspaces.

### 3. Environment Configuration

Copy the environment template:

```bash
cp .env.example .env
```

The `.env` file configures server settings. The defaults work out of the box for local development. API keys and agent providers are configured through the Settings UI after first launch.

Encryption keys are derived from your user password at registration time. No manual key configuration is needed. For development, add `ANIMUS_UNLOCK_PASSWORD=devpassword` to your `.env` file so the server auto-unseals on restart (including hot-reloads). See `docs/architecture/encryption-architecture.md` for the full encryption design and `docs/architecture/data-directory.md` for the data layout.

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
│   ├── channel-sdk/     # Types-only package published as @animus-labs/channel-sdk
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
npm run build:prod
npm start
```

This serves both the API and the built frontend at `http://localhost:3000`.

### Docker Deployment

For self-hosted servers, use Docker:

Set `ANIMUS_UNLOCK_PASSWORD` in your `.env` or `docker-compose.yml` so the server auto-unseals on container start. See `docs/architecture/encryption-architecture.md` for details.

```bash
# Quick start (builds and runs in one step)
docker compose up --build

# Or build and run separately
npm run docker:build
npm run docker:up
```

The container mounts `./data` for persistent database storage (the directory is created automatically) and reads configuration from `.env`. Access the app at `http://localhost:3000`.

To stop:

```bash
docker compose down
```

### Desktop App (Tauri)

Build Animus as a native desktop application. The app bundles the full backend as a Node.js sidecar process and opens the frontend in a native webview. All data is stored in the platform-specific app data directory (`~/Library/Application Support/com.animus.app` on macOS, `~/.local/share/animus` on Linux, `%APPDATA%/Animus` on Windows).

**Prerequisites:**

1. **Rust toolchain** — Install via [rustup](https://rustup.rs/):
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```
   After installation, restart your terminal or run `source ~/.cargo/env`.

2. **Tauri CLI** — Install the v2 CLI:
   ```bash
   cargo install tauri-cli --locked
   ```
   Verify with `cargo tauri --version`.

3. **Platform-specific system libraries** — Tauri requires OS-level dependencies for building native apps. See the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/) for your platform:
   - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
   - **Linux**: `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf` (Ubuntu/Debian: `sudo apt install ...`)
   - **Windows**: Microsoft Visual Studio C++ Build Tools, WebView2

**Development mode** (uses your system Node.js + Vite dev server, no sidecar needed):

```bash
npm run dev:tauri
```

**Production build** (single command that builds JS, downloads Node binary, assembles sidecar, and packages the app):

```bash
npm run build:tauri
```

This runs three stages automatically:
1. `npm run build:prod` — Builds shared, agents, frontend, and backend
2. `node scripts/prepare-tauri.mjs` — Downloads a standalone Node.js binary for your platform, assembles the sidecar payload (backend dist + dependencies) into `packages/tauri/resources/`, and prunes foreign-platform binaries and non-essential files to minimize bundle size
3. `cargo tauri build` — Compiles the Rust shell and packages the installable

The output is in `packages/tauri/target/release/bundle/` — a `.dmg` on macOS, `.deb`/`.AppImage` on Linux, or `.msi` on Windows.

You can also run the preparation step independently to verify it works before the full Cargo build:

```bash
npm run build:prod
npm run prepare:tauri    # Just the Node binary download + sidecar assembly
```

Encryption keys are derived from your user password. On the desktop app, you'll enter your password on the lock screen when the app opens. No `.env` file needed.

## Database Management

Animus uses seven SQLite databases stored under `data/databases/`, created automatically on first run:

| Database | Location | Purpose | Lifecycle |
|----------|----------|---------|-----------|
| system.db | `data/databases/system.db` | Users, settings, API keys | Rarely reset |
| persona.db | `data/databases/persona.db` | Personality settings | Separate lifecycle |
| heartbeat.db | `data/databases/heartbeat.db` | Thoughts, emotions, tasks | Occasional reset |
| memory.db | `data/databases/memory.db` | Working memory, core self, long-term memories | Knowledge |
| messages.db | `data/databases/messages.db` | Conversations, messages, channels | Long-term history |
| agent_logs.db | `data/databases/agent_logs.db` | Agent sessions, events | Frequent cleanup |
| contacts.db | `data/databases/contacts.db` | Contacts, contact channels | Backed up with AI state |

Vector embeddings are stored in `data/databases/lancedb/`. All data paths derive from `ANIMUS_DATA_DIR` (defaults to `./data/`). See `docs/architecture/data-directory.md` for the full directory structure.

### Resetting Databases

To start fresh:

```bash
# Remove all databases
rm -rf data/databases/*.db

# Restart the server to recreate
npm run dev:backend
```

To reset only the heartbeat state (gives Animus a "fresh mind" without losing conversation history):

```bash
rm data/databases/heartbeat.db
```

## Configuring Agent Providers

Animus supports multiple agent providers, including Claude (default) and Codex. Configure your preferred provider and API keys through the Settings page after first launch.

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
npm run build -w @animus-labs/shared
```

### Module Not Found

Try cleaning and reinstalling:

```bash
rm -rf node_modules packages/*/node_modules
npm install
```
