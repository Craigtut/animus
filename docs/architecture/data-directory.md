# Data Directory Architecture

All persistent Animus data lives under a single directory, resolved once at startup.

## Resolution

1. `ANIMUS_DATA_DIR` env var (Docker, Tauri, explicit override)
2. `./data/` relative to project root (dev default)

The resolved path is exported as `DATA_DIR` from `packages/backend/src/utils/env.ts`.

## Directory Structure

```
$ANIMUS_DATA_DIR/
  databases/              # All SQLite databases + vector store
    system.db             # Users, contacts, settings, API keys
    persona.db            # Personality settings (separate lifecycle)
    heartbeat.db          # Thoughts, experiences, emotions, goals, tasks
    memory.db             # Working memory, core self, long-term memories
    messages.db           # Conversations, messages, media
    agent_logs.db         # SDK logs, events, token usage
    lancedb/              # Vector embeddings (LanceDB)
  media/                  # User uploads + generated speech
    speech/               # TTS-generated audio files
  models/                 # STT/TTS ONNX models
  voices/                 # Voice references (builtin + custom)
  saves/                  # Snapshot/restore archives (.animus files)
  cache/                  # Ephemeral caches (model pricing data)
  logs/                   # Application logs (animus.log, rotated)
  packages/               # Installed channel + plugin packages
    .cache/               # .anpk cache for rollback
  runtime/                # Plugin runtime isolation
    providers/            # Per-provider skill deployments
  workspace/              # Agent working directory (reserved for future use)
  package-uploads/        # Temp staging for .anpk installs
  .secrets                # Auto-generated encryption key + JWT secret
  .restore-backup/        # Temporary rollback backup during restore
```

## Secrets Lifecycle

Secrets (encryption key + JWT secret) are managed by `packages/backend/src/lib/secrets-manager.ts`.

### Resolution Order

For each secret (encryption key, JWT secret):
1. Environment variable already set → use it
2. `.secrets` file in DATA_DIR → load from it
3. Legacy Tauri files (`.encryption_key`, `.jwt_secret`) → migrate
4. Generate via `crypto.randomBytes(32).toString('hex')`

### `.secrets` File Format

```json
{
  "encryptionKey": "64-char-hex",
  "jwtSecret": "64-char-hex",
  "_generated": "2026-02-23T...",
  "_version": 1
}
```

Written with `0o600` permissions (owner read/write only).

### Security Mitigations

- **process.env scrubbed** — After loading, `process.env.ANIMUS_ENCRYPTION_KEY` and `process.env.JWT_SECRET` are deleted. Agent bash tools using `env`/`printenv` won't see them.
- **File permissions** — `.secrets` is `0600`.
- **Not served** — `@fastify/static` only serves from `dist/public/`.
- **Future: tool-level deny list** — Agent file read/write tools should block access to `.secrets` and `.env`.

## Deployment Modes

| Mode | DATA_DIR Resolution |
|------|-------------------|
| Development | `./data/` relative to project root |
| Docker | `ANIMUS_DATA_DIR=/app/data` (set in Dockerfile) |
| Tauri (macOS) | `~/Library/Application Support/com.animus.desktop/` |
| Tauri (Linux) | `~/.local/share/animus/` |
| Tauri (Windows) | `%APPDATA%\Animus\` |
| Custom | Set `ANIMUS_DATA_DIR` to any absolute path |

## Migration from Previous Layout

Previously, data lived at `packages/backend/data/` and logs at `logs/` in the project root. The new layout consolidates everything under `data/` at the project root.

Individual `DB_*_PATH` and `LANCEDB_PATH` env vars are no longer supported. All paths are derived programmatically from `DATA_DIR`.
