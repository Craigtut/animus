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
    system.db             # Users, settings, API keys
    persona.db            # Personality settings (separate lifecycle)
    heartbeat.db          # Thoughts, experiences, emotions, goals, tasks
    memory.db             # Working memory, core self, long-term memories
    messages.db           # Conversations, messages, media
    agent_logs.db         # SDK logs, events, token usage
    contacts.db           # Contacts, contact channels (backed up with AI state)
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
  vault.json              # Password-wrapped DEK + KDF parameters (see encryption-architecture.md)
  .restore-backup/        # Temporary rollback backup during restore
```

## Secrets Lifecycle

The encryption key (DEK) is derived from the user's password and exists only in process memory. No key material is stored on the filesystem. For the complete encryption architecture, see **`docs/architecture/encryption-architecture.md`**.

### Vault File

`vault.json` stores the password-wrapped DEK and key derivation parameters:

```json
{
  "version": 2,
  "kdf": "argon2id",
  "kdfParams": {
    "memoryCost": 65536,
    "timeCost": 3,
    "parallelism": 1,
    "salt": "<32-byte-base64>"
  },
  "wrappedDek": "<AES-256-GCM encrypted DEK>",
  "wrappedJwtSecret": "<AES-256-GCM encrypted JWT secret>",
  "sentinel": "<AES-256-GCM encrypted 'animus-key-ok'>"
}
```

This file is safe to include in backups. Without the user's password, the wrapped DEK cannot be unwrapped.

### Unlock Flow

On server start, the vault must be unsealed before credential operations work:

1. `ANIMUS_UNLOCK_PASSWORD` env var or Docker secret file provides the password (automated environments)
2. If no password available, server starts in sealed mode and waits for manual unlock via web UI or CLI
3. Password is used to derive a key via Argon2id, which unwraps the DEK
4. After unlock, the password source is scrubbed from `process.env`

### Security Protections

- **No key on disk** -- The DEK exists only in the Node.js process heap after unlock.
- **process.env scrubbed** -- `ANIMUS_UNLOCK_PASSWORD` is deleted from `process.env` after key derivation.
- **File deny list** -- Agent file read/write tools block access to `vault.json`, `.env`, and security-critical source files.
- **Not served** -- `@fastify/static` only serves from `dist/public/`.

### Legacy Migration

Existing installations with a `data/.secrets` file are migrated to the vault system on upgrade. See `docs/architecture/encryption-architecture.md` for the migration flow.

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
