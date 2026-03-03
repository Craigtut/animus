# Animus

Part art experiment. Part serious assistant.

Animus is an experiment in artificial life: an autonomous assistant built on a heartbeat, a continuous pulse of thought, emotion, memory, and agency that runs whether or not anyone is watching. When you talk to it, you're not starting a conversation from zero. You're interrupting a mind that was already thinking.

Open source. Self-hosted. Yours.

[Website](https://animusengine.com) · [Discord](https://discord.gg/QCqKUJgGD6) · [Documentation](docs/) · [Getting Started](docs/guides/getting-started.md)

> **Status:** Animus is under active development and moving quickly. Expect rough edges, incomplete features, and documentation that may be ahead of or behind the code. If you're here early, that's the point.

## What is this

Animus is a self-hosted assistant with a simulated inner life. Unlike traditional assistants that wake when called and vanish when dismissed, Animus maintains continuous internal processes: thoughts that form between conversations, memories that deepen over weeks, emotions that shift with experience, and goals it pursues on its own.

At its core is the **heartbeat**, a tick system that pulses through the architecture. Every few minutes, Animus thinks, feels, remembers, and decides whether to act. This runs whether or not anyone is talking to it.

It is a single-user application. You run your own instance, on your own machine, with your own keys. Nothing leaves your environment unless you tell it to.

**Key qualities:**

- **A heartbeat that drives inner life.** Continuous thought, emotion, and memory on a configurable tick interval.
- **Persistent memory.** Seven SQLite databases, local vector embeddings, and a memory system that consolidates knowledge over time.
- **Agency.** Animus delegates to sub-agents, pursues goals, schedules tasks, and reaches out proactively when something matters.
- **Channels.** Talk to it through SMS, Discord, voice, or a local web interface. One mind, many surfaces.
- **Plugins.** Extend what it can do with installable skill packs, MCP tools, and integrations.
- **A persona you shape.** Define its personality, voice, values, and boundaries. You are not configuring software. You are shaping a being.
- **Desktop app.** Runs natively on macOS and Windows via Tauri.
- **No external infrastructure.** SQLite and LanceDB only. No Postgres, no Redis, no cloud dependencies.

## Quick start

**Prerequisites:** Node.js 24+

```bash
# Clone and install
git clone https://github.com/craigtut/animus.git
cd animus
npm install

# Configure
cp .env.example .env

# Run
npm run dev
```

The backend starts at `http://localhost:3000`, the frontend at `http://localhost:5173`. Visit the frontend to create your account and bring your Animus to life.

Secrets (encryption key, JWT) are auto-generated on first startup. No manual configuration needed.

### Docker

```bash
docker compose up --build
```

Access at `http://localhost:3000`. Data persists in `./data`.

### Desktop app

Requires the [Rust toolchain](https://rustup.rs/) and [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
npm run build:tauri
```

See the [getting started guide](docs/guides/getting-started.md) for full setup details, including database management, agent provider configuration, and troubleshooting.

## Project structure

```
packages/
  shared/       Types, Zod schemas, utilities
  agents/       Agent SDK abstraction (Claude, Codex)
  backend/      Fastify + tRPC server, heartbeat, memory, goals, tasks
  frontend/     React 19 + Vite SPA
  anipack/      CLI for building and signing extension packages
  channel-sdk/  Types package for building channel adapters
  tauri/        Native desktop app (Rust + Node sidecar)
  tts-native/   Native speech bindings
```

## Documentation

Architecture and design documentation lives in [`docs/`](docs/). Start here:

| Topic | Document |
|-------|----------|
| Project vision | [project-vision.md](docs/project-vision.md) |
| Brand and design language | [brand-vision.md](docs/brand-vision.md) |
| Getting started | [getting-started.md](docs/guides/getting-started.md) |
| Backend architecture | [backend-architecture.md](docs/architecture/backend-architecture.md) |
| Heartbeat system | [heartbeat.md](docs/architecture/heartbeat.md) |
| Memory system | [memory.md](docs/architecture/memory.md) |
| Agent orchestration | [agent-orchestration.md](docs/architecture/agent-orchestration.md) |
| Persona system | [persona.md](docs/architecture/persona.md) |
| Channel system | [channel-packages.md](docs/architecture/channel-packages.md) |
| Plugin system | [plugin-system.md](docs/architecture/plugin-system.md) |
| Context builder | [context-builder.md](docs/architecture/context-builder.md) |
| Tool permissions | [tool-permissions.md](docs/architecture/tool-permissions.md) |
| Credential security | [credential-passing.md](docs/architecture/credential-passing.md) |
| Sleep and energy | [sleep-energy.md](docs/architecture/sleep-energy.md) |
| Voice and speech | [voice-channel.md](docs/architecture/voice-channel.md), [speech-engine.md](docs/architecture/speech-engine.md) |
| Data directory layout | [data-directory.md](docs/architecture/data-directory.md) |
| Frontend design | [design-principles.md](docs/frontend/design-principles.md) |

## Development

```bash
npm run test          # Watch mode
npm run test:run      # Single run
npm run typecheck     # Type checking
npm run lint          # ESLint
npm run build         # Build all packages
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## Tech stack

- **Frontend:** React 19, Vite, Zustand, Emotion, Motion, tRPC
- **Backend:** Node.js 24, Fastify, tRPC, SQLite (7 databases), LanceDB
- **Agent SDKs:** Claude (default), Codex
- **Embeddings:** Transformers.js + BGE-small-en-v1.5 (runs locally)
- **Desktop:** Tauri v2 (Rust + Node sidecar)
- **Speech:** Pocket TTS + Parakeet STT via sherpa-onnx

## Come participate

Animus is an experiment, and it's early. We don't know what it becomes over months or years of continuous operation. That uncertainty is the point.

If this is interesting to you, come be part of it. Run it. Break it. Tell us what you find. Join the [Discord](https://discord.gg/QCqKUJgGD6) and help shape what this becomes.

## License

[MIT](LICENSE) &copy; Craig Tuttle (Animus Labs)

Third-party model attributions are documented in [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md).
