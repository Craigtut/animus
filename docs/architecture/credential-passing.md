# Secrets & Credential Architecture

> How API keys and secrets are encrypted at rest, stored, and securely injected at execution time — without the LLM ever seeing raw values.

**Status:** Implemented
**Last Updated:** 2026-02-15

---

## Table of Contents

1. [Core Principle](#core-principle)
2. [Encryption at Rest](#encryption-at-rest)
3. [Credential Storage Locations](#credential-storage-locations)
4. [Agent Provider Keys](#agent-provider-keys)
5. [Plugin Credentials](#plugin-credentials)
6. [Channel Credentials](#channel-credentials)
7. [The Agent-Blind Pattern](#the-agent-blind-pattern)
8. [Frontend Credential UI](#frontend-credential-ui)
9. [Security Boundaries & Threat Model](#security-boundaries--threat-model)
10. [Key Files Reference](#key-files-reference)

---

## Core Principle

**The LLM (mind) never sees raw credential values.** If the mind sees a key, it can end up in thoughts, transcripts, session logs, or be exfiltrated by a malicious prompt. Every credential path in Animus is designed so that:

1. Secrets are **encrypted at rest** in SQLite using AES-256-GCM.
2. Secrets are **decrypted only at the execution boundary** — after the mind has finished its turn.
3. The mind sees only **metadata** (reference names, provider labels, last-4-char hints) — never actual values.
4. Secrets reach executing code via **environment variables, IPC messages, or HTTP headers** — paths the mind cannot observe.

This is the "agent-blind" credential model, informed by the security failures documented in OpenClaw's plaintext credential leaks (Snyk research, 283 leaky skills) and their subsequent [Agent-Blind RFC](https://github.com/openclaw/openclaw/discussions/9676).

---

## Encryption at Rest

**File:** `packages/backend/src/lib/encryption-service.ts`

All secrets use the same encryption service. There is a single master encryption key per Animus instance.

### Algorithm

| Parameter | Value |
|-----------|-------|
| Algorithm | AES-256-GCM (authenticated encryption) |
| Key derivation | PBKDF2, SHA-256, 100,000 iterations |
| Key source | `ANIMUS_ENCRYPTION_KEY` environment variable (mandatory) |
| Salt | Static `'animus-encryption-salt'` (uniqueness from env var) |
| IV | 16 bytes, randomly generated per encryption |
| Auth tag | 16 bytes |

### Ciphertext Format

```
{iv_base64}:{ciphertext_base64}:{authTag_base64}
```

Three colon-delimited base64 segments. A fresh random IV is generated for every `encrypt()` call, so encrypting the same value twice produces different ciphertext.

### Key Verification at Startup

On server startup, `verifyEncryptionKey()` checks that the current `ANIMUS_ENCRYPTION_KEY` matches the key used to encrypt existing data:

1. **First run:** Encrypts the sentinel `'animus-key-ok'` and stores it in `system_settings.encryption_key_check`.
2. **Subsequent runs:** Decrypts the sentinel and verifies it matches.
3. **Mismatch:** Server refuses to start with a detailed error message. This prevents silent data corruption from key changes.

### Legacy Migration

The `decrypt()` function handles a `plain:` prefix for values stored before encryption was added:

```
plain:{base64_encoded_plaintext}
```

This allows upgrading from pre-encryption storage without a migration tool.

### Public API

```typescript
encrypt(plaintext: string): string    // Returns formatted ciphertext
decrypt(ciphertext: string): string   // Returns plaintext (handles legacy prefix)
isConfigured(): boolean               // Whether ANIMUS_ENCRYPTION_KEY is set
verifyEncryptionKey(db): void         // Sentinel check — throws on mismatch
```

The derived key is cached in memory after first derivation. PBKDF2 only runs once per server startup.

### Environment Requirement

**File:** `packages/backend/src/utils/env.ts`

```typescript
ANIMUS_ENCRYPTION_KEY: z.string().min(1,
  'ANIMUS_ENCRYPTION_KEY is required. Set any secret string to encrypt stored credentials.'
)
```

The server will not start without this environment variable. Zod validation runs before any database initialization.

---

## Credential Storage Locations

Animus stores secrets in three places, each encrypted using the same `EncryptionService`:

| Location | Table | Column | Scope | Encryption |
|----------|-------|--------|-------|------------|
| Agent provider keys | `credentials` | `encrypted_data` | Per-credential row | Entire value encrypted |
| Plugin config | `plugins` | `config_encrypted` | Per-plugin blob | Entire JSON config encrypted as one blob |
| Channel config | `channel_packages` | `config` | Per-channel JSON | Individual `secret` fields encrypted within JSON |

All three tables live in `system.db`.

---

## Agent Provider Keys

Agent provider keys (Anthropic, OpenAI) are stored in the `credentials` table and loaded into `process.env` at startup for SDK consumption.

### Database Schema

**Migration:** `packages/backend/src/db/migrations/system/003_credentials.sql`

```sql
CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  credential_type TEXT NOT NULL,
  encrypted_data TEXT NOT NULL,       -- AES-256-GCM encrypted
  metadata TEXT,                      -- Optional JSON (token type, account info)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_credentials_provider_type
  ON credentials(provider, credential_type);
```

One credential per `(provider, credential_type)` pair. Upsert on save.

### Credential Types

```typescript
type CredentialType = 'api_key' | 'oauth_token' | 'codex_oauth' | 'cli_detected';
```

Auto-detected from key prefix:

| Provider | Key Prefix | Inferred Type |
|----------|------------|---------------|
| Claude | `sk-ant-oat01-*` | `oauth_token` |
| Claude | `sk-ant-api03-*` or `sk-ant-*` | `api_key` |
| Codex | `sk-proj-*` | `api_key` |

### Environment Variable Mapping

**File:** `packages/backend/src/services/credential-service.ts`

```typescript
const ENV_MAP: Record<string, string> = {
  'claude:api_key':     'ANTHROPIC_API_KEY',
  'claude:oauth_token': 'CLAUDE_CODE_OAUTH_TOKEN',
  'codex:api_key':      'OPENAI_API_KEY',
};
```

### Startup Flow

**File:** `packages/backend/src/index.ts`

```
1. initializeDatabases()           — open 5 DBs, run migrations
2. verifyEncryptionKey(systemDb)   — sentinel check
3. loadCredentialsIntoEnv(systemDb) — decrypt all → set process.env
4. Start Fastify server + heartbeat
```

`loadCredentialsIntoEnv()` iterates all rows in `credentials`, decrypts each, and sets the corresponding `process.env` variable. Special handling:

- `codex_oauth`: Sets `CODEX_OAUTH_CONFIGURED='true'` sentinel
- `cli_detected`: Sets `CLAUDE_CLI_CONFIGURED` or `CODEX_CLI_CONFIGURED` sentinel

After this, agent SDKs (Claude Agent SDK, Codex SDK) read credentials from `process.env` automatically. The mind never touches these values — they're used by the SDK transport layer.

### Save Flow

When a user saves a key via the Settings UI:

```
Frontend: trpc.provider.saveKey.mutate({ provider, key })
  → credentialService.saveCredential(db, provider, key)
    → inferCredentialType(provider, key)  // auto-detect from prefix
    → systemStore.saveCredential(db, provider, type, key)
      → encrypt(key)  // AES-256-GCM
      → UPSERT into credentials table
    → process.env[ENV_MAP[...]] = key  // immediate effect, no restart needed
```

### Validation

Before saving, `validateCredential()` makes a real API call to the provider:

- **Claude:** `GET https://api.anthropic.com/v1/models` (403 counts as valid — key works, permissions limited)
- **Codex:** `GET https://api.openai.com/v1/models`

### Detection

`detectProviderAuth()` checks multiple sources:

1. `process.env` (direct environment variables)
2. `credentials` table (database)
3. Filesystem (`~/.claude/.credentials`, `~/.codex/auth.json`)
4. CLI binary in PATH (`claude`, `codex`)

Returns an array of detected methods per provider, used by the onboarding UI to guide setup.

### Store Methods

**File:** `packages/backend/src/db/stores/system-store.ts`

| Method | Purpose |
|--------|---------|
| `saveCredential(db, provider, type, data, metadata?)` | Encrypt and upsert |
| `getCredential(db, provider, type?)` | Decrypt and return |
| `getAllCredentials(db)` | Decrypt all (used at startup) |
| `deleteCredential(db, provider, type?)` | Remove one or all for provider |
| `getCredentialMetadata(db, provider)` | Metadata only — **no decryption** |

`getCredentialMetadata` deliberately excludes the `encrypted_data` column. Used by `hasKey` endpoint and detection logic to avoid unnecessary decryption.

---

## Plugin Credentials

Plugins declare configuration fields in `config.schema.json`. Fields with `type: "secret"` are treated as sensitive. The entire plugin config is encrypted as a single JSON blob.

### Config Schema

```json
{
  "fields": [
    {
      "key": "GEMINI_API_KEY",
      "label": "Gemini API Key",
      "type": "secret",
      "required": true,
      "helpText": "API key from Google AI Studio"
    },
    {
      "key": "outputDir",
      "label": "Output Directory",
      "type": "text",
      "required": false
    }
  ]
}
```

Field types: `text`, `secret`, `url`, `number`, `select`, `text-list`, `toggle`. Only `secret` fields receive masking and credential-manifest treatment.

### Storage

**Migration:** `packages/backend/src/db/migrations/system/006_plugins.sql`

```sql
CREATE TABLE IF NOT EXISTS plugins (
  name TEXT PRIMARY KEY,
  ...
  config_encrypted TEXT  -- AES-256-GCM encrypted JSON blob
);
```

The entire config object (secrets and non-secrets together) is JSON-stringified, then encrypted as one blob:

```typescript
// Save
const encrypted = encrypt(JSON.stringify(config));
pluginStore.updatePluginConfig(db, name, encrypted);

// Load
const decrypted = decrypt(record.configEncrypted);
return JSON.parse(decrypted);
```

### Three Credential Injection Paths

#### Path 1: MCP Servers — `${config.*}` Resolution

Plugins declare MCP servers in `tools.json` with placeholder syntax:

```json
{
  "ha": {
    "type": "http",
    "url": "${config.HA_URL}/api/mcp",
    "headers": {
      "Authorization": "Bearer ${config.HA_ACCESS_TOKEN}"
    }
  }
}
```

**File:** `packages/backend/src/services/plugin-manager.ts` — `getMcpConfigs()`

At MCP server spawn time, `PluginManager` decrypts the plugin config and resolves all `${config.KEY}` placeholders in `env`, `url`, and `headers` via regex replacement. The resolved config is passed to the agent SDK, which spawns the MCP server process with credentials already injected. The mind just calls MCP tools by name — it never touches the underlying credentials.

```
Plugin tools.json: "Authorization": "Bearer ${config.HA_ACCESS_TOKEN}"
  → PluginManager.getMcpConfigs()
    → getDecryptedConfig(pluginName)  // AES-256-GCM decrypt
    → regex replace ${config.*} with plaintext values
    → Return resolved MCP config to agent SDK
      → SDK spawns MCP server with injected env/headers
```

#### Path 2: Decision Handlers & Hooks — stdin Injection

Plugin decision handlers and hooks are subprocesses that receive decrypted config via stdin:

```
PluginManager.executeDecision() / fireHook()
  → getDecryptedConfig(pluginName)
  → executeHandler(command, { event: payload, config: decryptedConfig })
    → spawn(command)
    → proc.stdin.write(JSON.stringify({ event, config }))
    → proc.stdin.end()
    → Read JSON result from stdout
```

The subprocess reads `config.KEY` from the stdin JSON payload. Same pattern for context retrieval sources.

#### Path 3: `run_with_credentials` Tool — Subprocess Env Injection

This is the agent-facing tool for executing commands that need credentials. The mind references credentials by name; the handler resolves and injects the actual value.

**Flow:**

```
Mind sees manifest: "nano-banana-pro.GEMINI_API_KEY → GEMINI_API_KEY (hint: ...a1b2)"
  → Mind calls: run_with_credentials({
      command: "node scripts/generate-image.js",
      credentialRef: "nano-banana-pro.GEMINI_API_KEY",
      envVar: "GEMINI_API_KEY"
    })
  → Handler parses "nano-banana-pro.GEMINI_API_KEY"
    → pluginManager.getPluginConfig("nano-banana-pro")  // decrypt
    → value = config["GEMINI_API_KEY"]
    → childEnv = { ...process.env, GEMINI_API_KEY: value }
    → Strip ANTHROPIC_API_KEY, OPENAI_API_KEY, CLAUDE_CODE_OAUTH_TOKEN, ANIMUS_ENCRYPTION_KEY
    → spawn(command, { env: childEnv })
    → Return stdout/stderr/exitCode to mind (never the credential value)
```

**Critical security:** The handler strips agent provider keys and the encryption key from the child process environment (`STRIPPED_ENV_KEYS`). This prevents credential cross-contamination — the subprocess only gets the specific credential it was given.

---

## Channel Credentials

Channel packages (Discord, SMS, etc.) receive decrypted config via IPC, not environment variables. The mind never sees channel credentials.

### Config Schema

Same format as plugins. Example (`channels/discord/config.schema.json`):

```json
{
  "fields": [
    { "key": "botToken", "label": "Bot Token", "type": "secret", "required": true },
    { "key": "applicationId", "label": "Application ID", "type": "text", "required": true }
  ]
}
```

### Storage

**Migration:** `packages/backend/src/db/migrations/system/007_channel_packages.sql`

```sql
CREATE TABLE IF NOT EXISTS channel_packages (
  name TEXT PRIMARY KEY,
  ...
  config TEXT  -- JSON blob with individually encrypted secret fields
);
```

Unlike plugins (which encrypt the entire blob), channels encrypt **individual secret fields** within the JSON object:

```typescript
// Save: encrypt each secret field
for (const key of secretKeys) {
  if (typeof config[key] === 'string' && config[key]) {
    config[key] = encrypt(config[key]);
  }
}
db.prepare('UPDATE channel_packages SET config = ? WHERE name = ?')
  .run(JSON.stringify(config), name);

// Load: decrypt each secret field
const config = JSON.parse(row.config);
for (const key of secretKeys) {
  if (typeof config[key] === 'string' && config[key]) {
    config[key] = decrypt(config[key]);
  }
}
```

The `secretKeys` list is derived at runtime from the channel's `config.schema.json` (`type: "secret"` fields).

### Injection via IPC

When a channel starts, the Channel Manager decrypts the config and passes it to the Process Host:

```
ChannelManager.startProcess(pkg, manifest)
  → systemStore.getChannelPackageConfig(db, name, secretKeys)  // decrypt
  → new ChannelProcessHost({ decryptedConfig, ... })
    → fork('adapter-context.js', [pkgPath])
    → Send IPC: { type: 'init', config: decryptedConfig, channelType }
```

The child process (`adapter-context.ts`) stores the config in memory and exposes it via `AdapterContext.config`:

```typescript
// Child process
const initMsg = await waitForInitMessage();
currentConfig = { ...initMsg.config };

// Adapter reads config
const botToken = ctx.config['botToken'] as string;
```

Channel credentials are:
- **Not** added to environment variables
- **Not** written to disk by the child process
- Stored only in the child process memory
- Updatable at runtime via `config_update` IPC messages (hot-swap)

### What the Mind Sees

The mind sees **nothing** about channel credentials. It only sees:
- Incoming messages: `{ identifier, content, conversationId, ... }`
- Send results: `true` or `false` from `sendToChannel()`

The mind has no visibility into bot tokens, API keys, or channel configuration. Channels operate as opaque message transports.

---

## The Agent-Blind Pattern

### Credential Manifest

During the GATHER phase, the heartbeat builds a credential manifest from all enabled plugins with `secret` config fields.

**File:** `packages/backend/src/services/plugin-manager.ts` — `getCredentialManifest()`

```typescript
interface CredentialManifestEntry {
  ref: string;     // "nano-banana-pro.GEMINI_API_KEY"
  label: string;   // "Gemini API Key"
  plugin: string;  // "nano-banana-pro"
  envVar: string;  // "GEMINI_API_KEY"
  hint: string;    // "...a1b2" or "(not set)"
}
```

The manifest is generated by iterating enabled plugins, finding `type: "secret"` fields in their config schemas, and creating entries with the last 4 characters as a hint. The full value is never included.

### Context Injection

**File:** `packages/backend/src/heartbeat/context-builder.ts`

The manifest is included in the mind's prompt:

```
── AVAILABLE CREDENTIALS ──
These credentials are stored securely. Use run_with_credentials to
execute commands that need them. Reference by ref name — you never
see the actual values.

  nano-banana-pro.GEMINI_API_KEY → GEMINI_API_KEY (Gemini API Key, hint: ...a1b2)
  home-assistant.HA_ACCESS_TOKEN → HA_ACCESS_TOKEN (Long-Lived Access Token, hint: ...xyz9)

Usage: run_with_credentials({ command, credentialRef, envVar })
```

### Tool Definition

**File:** `packages/shared/src/tools/definitions.ts`

```typescript
run_with_credentials({
  command: string,        // Shell command to execute
  credentialRef: string,  // e.g. "nano-banana-pro.GEMINI_API_KEY"
  envVar: string,         // e.g. "GEMINI_API_KEY"
  cwd?: string            // Working directory
})
```

The mind calls this tool with a credential reference. The handler resolves the reference, injects the real value as an env var on the subprocess, and returns only stdout/stderr. The credential value never appears in the tool result.

### Permission Tiers

Both `primary` and `standard` contact tiers can use `run_with_credentials`. The tool is in the `system` category.

---

## Frontend Credential UI

### Consistent Pattern

All three credential types (providers, plugins, channels) follow the same UI pattern:

1. **Input:** Password-masked field with eye toggle
2. **Display:** Secret values shown as `••••••••` (never the real value)
3. **Update:** If user submits `••••••••`, the backend preserves the existing encrypted value
4. **Validation:** Provider keys validated via real API calls before storage
5. **Security indicators:** Shield icon with tooltip explaining encryption

### Provider Keys (Settings Page)

**File:** `packages/frontend/src/pages/SettingsPage.tsx`

- Provider cards (Claude, Codex) with expandable config panels
- Client-side prefix inference shows badge (API Key / OAuth Token)
- "Validate & Save" button makes API call to verify, then stores
- Codex OAuth device code flow with real-time WebSocket status updates

### Plugin Config

**File:** `packages/frontend/src/pages/SettingsPage.tsx` (Plugin Config Modal)

- Dynamic form generated from `config.schema.json`
- Secret fields rendered as password inputs
- Masked values show placeholder: `••••••••  (saved, enter new value to change)`
- Empty submission for a secret field preserves existing value

### Channel Config

**File:** `packages/frontend/src/pages/SettingsPage.tsx` (Channel Config Modal)

- Same dynamic form pattern as plugins
- Secret fields masked with Unicode bullets (`\u2022`)
- Existing values preserved when masked value submitted

### tRPC Endpoints

| Endpoint | Purpose | Returns |
|----------|---------|---------|
| `provider.validateKey` | Validate against provider API | `{ valid, message, credentialType }` |
| `provider.saveKey` | Encrypt and store | `{ success }` |
| `provider.hasKey` | Check existence (no decryption) | `{ hasKey, credentialType }` |
| `provider.removeKey` | Delete and clear env | `{ success }` |
| `provider.detect` | Multi-source detection | `ProviderAuthStatus[]` |
| `plugins.getConfig` | Return masked config | `{ values, schema }` |
| `plugins.setConfig` | Encrypt and store config | `{ success }` |
| `channels.getConfig` | Return masked config | `Record<string, unknown>` |
| `channels.configure` | Encrypt and store config | `{ success }` |

---

## Security Boundaries & Threat Model

### What the Mind CAN See

- Credential metadata: reference name, provider label, last-4-char hint
- That a credential exists and whether it's configured
- Tool definitions that accept credential references
- Tool execution results (stdout/stderr — never credential values)

### What the Mind CANNOT See

- Raw API key values
- Decrypted credential data
- Plugin config sensitive field values
- Channel bot tokens or auth credentials
- Agent provider API keys (Anthropic, OpenAI)
- The encryption key itself

### What Appears in Logs

- Credential references: "used nano-banana-pro.GEMINI_API_KEY"
- Tool call parameters with `credentialRef` (not the resolved value)
- Never raw credential values
- Session transcripts contain only references

### What Appears in the Database

| Table | Column | Content |
|-------|--------|---------|
| `credentials` | `encrypted_data` | AES-256-GCM ciphertext |
| `plugins` | `config_encrypted` | AES-256-GCM ciphertext of full config JSON |
| `channel_packages` | `config` | JSON with individually encrypted secret fields |
| `agent_logs` | events | Tool calls with `credentialRef`, never resolved values |

### Threat Model

| Threat | Mitigation |
|--------|-----------|
| **LLM sees raw key in prompt** | Agent-blind: mind only sees metadata and references |
| **Key in session transcript** | Only references appear in mind output; values never in agent events |
| **Key in agent_logs.db** | Tool call logs contain `credentialRef`, not the resolved value |
| **Malicious skill exfiltrates key** | Key never in LLM context; skill can't instruct mind to leak what it doesn't have |
| **Filesystem access to DB** | Encrypted at rest with AES-256-GCM |
| **Subprocess credential leakage** | Agent provider keys and encryption key stripped from `run_with_credentials` child env |
| **Plugin subprocess reads encryption key** | Decision/hook handlers inherit `process.env` including `ANIMUS_ENCRYPTION_KEY`. Mitigated by trust model: users install only vetted plugins. |
| **`ANIMUS_ENCRYPTION_KEY` compromised** | All credentials compromised — inherent to any single-key system. Mitigated by file permissions and never storing the key in DB. |
| **Credential hint reduces entropy** | Last 4 chars exposed. Minimal brute-force advantage in practice. |

### Trust Assumptions

- **Self-hosted, single-user:** The user controls the machine, the encryption key, and which plugins/channels are installed.
- **Plugin trust:** Plugins run as subprocesses with inherited `process.env`. A malicious plugin could theoretically read `ANIMUS_ENCRYPTION_KEY` and decrypt all credentials. This is acceptable because plugin installation is a user-initiated, trusted action.
- **No remote storage:** All data is local SQLite. No network transmission of credentials except to the provider API for validation and to the intended third-party services.

---

## Key Files Reference

### Encryption & Core

| File | Purpose |
|------|---------|
| `packages/backend/src/lib/encryption-service.ts` | AES-256-GCM encrypt/decrypt, key verification |
| `packages/backend/src/utils/env.ts` | `ANIMUS_ENCRYPTION_KEY` requirement |
| `packages/backend/src/index.ts` | Startup order: migrations → key verify → credential load |

### Agent Provider Keys

| File | Purpose |
|------|---------|
| `packages/backend/src/services/credential-service.ts` | Save, validate, detect, load-into-env |
| `packages/backend/src/db/stores/system-store.ts` | Credential CRUD (lines 448–553) |
| `packages/backend/src/db/migrations/system/003_credentials.sql` | Table schema |
| `packages/backend/src/db/migrations/system/008_encryption_key_check.sql` | Sentinel column |
| `packages/backend/src/api/routers/provider.ts` | tRPC endpoints |
| `packages/backend/src/api/routers/codex-auth.ts` | Codex OAuth device code flow |

### Plugin Credentials

| File | Purpose |
|------|---------|
| `packages/backend/src/services/plugin-manager.ts` | Config encrypt/decrypt, manifest, MCP resolution, handler execution |
| `packages/backend/src/db/stores/plugin-store.ts` | Plugin config persistence |
| `packages/backend/src/db/migrations/system/006_plugins.sql` | Table schema |
| `packages/backend/src/api/routers/plugins.ts` | tRPC endpoints (masked config) |
| `packages/backend/src/tools/handlers/run-with-credentials.ts` | Agent-blind tool handler |
| `packages/shared/src/tools/definitions.ts` | Tool definition (lines 154–173) |
| `packages/backend/src/heartbeat/context-builder.ts` | Manifest in prompt (lines 930–939) |

### Channel Credentials

| File | Purpose |
|------|---------|
| `packages/backend/src/channels/channel-manager.ts` | Config decryption, process lifecycle |
| `packages/backend/src/channels/process-host.ts` | IPC init with decrypted config |
| `packages/backend/src/channels/sdk/adapter-context.ts` | Child process bootstrap, config access |
| `packages/backend/src/channels/ipc/protocol.ts` | IPC message types (`init`, `config_update`) |
| `packages/backend/src/db/stores/system-store.ts` | Channel config encrypt/decrypt (lines 701–736) |
| `packages/backend/src/db/migrations/system/007_channel_packages.sql` | Table schema |
| `packages/backend/src/api/routers/channels.ts` | tRPC endpoints (masked config) |

### Frontend

| File | Purpose |
|------|---------|
| `packages/frontend/src/pages/SettingsPage.tsx` | Provider, plugin, channel credential UI |
| `packages/frontend/src/pages/onboarding/AgentProviderStep.tsx` | First-time setup flow |

---

## Summary

Animus implements a complete agent-blind credential system across three domains:

| Domain | Storage | Injection Method | Mind Visibility |
|--------|---------|------------------|-----------------|
| **Agent providers** | `credentials` table, per-row encryption | `process.env` at startup | None (SDK transport) |
| **Plugins** | `plugins.config_encrypted`, whole-blob encryption | MCP `${config.*}` resolution, stdin JSON, subprocess env var | Manifest only (ref + hint) |
| **Channels** | `channel_packages.config`, per-field encryption | IPC `init` message to child process | None |

All paths share the same AES-256-GCM encryption service, the same startup verification, and the same frontend masking pattern. The mind operates in a credential-blind environment where it can reference secrets by name but never access their values.
