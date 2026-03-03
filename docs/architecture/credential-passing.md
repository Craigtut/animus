# Secrets & Credential Architecture

> How API keys and secrets are encrypted at rest, stored, and securely injected at execution time — without the LLM ever seeing raw values.

**Status:** Implemented
**Last Updated:** 2026-03-02

---

## Table of Contents

1. [Core Principle](#core-principle)
2. [Encryption at Rest](#encryption-at-rest)
3. [Credential Storage Locations](#credential-storage-locations)
4. [Agent Provider Keys](#agent-provider-keys)
5. [Plugin Credentials](#plugin-credentials)
6. [Channel Credentials](#channel-credentials)
7. [Password Vault](#password-vault)
8. [The Agent-Blind Pattern](#the-agent-blind-pattern)
9. [Frontend Credential UI](#frontend-credential-ui)
10. [Security Boundaries & Threat Model](#security-boundaries--threat-model)
11. [Key Files Reference](#key-files-reference)

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

All secrets use the same encryption service with a single Data Encryption Key (DEK) per Animus instance.

### Key Management

The DEK is derived from the user's password using envelope encryption. The user's password wraps the DEK; the DEK encrypts all credentials. This means the encryption key exists only in process memory after the user authenticates, with no key material stored on the filesystem.

For the complete key management architecture, including the vault file format, sealed/unsealed server states, unlock paths, and threat model, see **`docs/architecture/encryption-architecture.md`**.

### Algorithm

| Parameter | Value |
|-----------|-------|
| Algorithm | AES-256-GCM (authenticated encryption) |
| Key | DEK (256-bit random, unwrapped from vault at unlock time) |
| IV | 16 bytes, randomly generated per encryption |
| Auth tag | 16 bytes |

### Ciphertext Format

```
{iv_base64}:{ciphertext_base64}:{authTag_base64}
```

Three colon-delimited base64 segments. A fresh random IV is generated for every `encrypt()` call, so encrypting the same value twice produces different ciphertext.

### Key Verification

On unseal, the vault sentinel (`'animus-key-ok'` encrypted with the DEK) is decrypted and verified. If the sentinel doesn't match, the unlock is rejected. This prevents silent data corruption from incorrect passwords.

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
isConfigured(): boolean               // Whether the vault is unsealed
verifyEncryptionKey(db): void         // Sentinel check — throws on mismatch
```

The DEK is cached in memory after unlock. Key derivation runs once per server start.

---

## Credential Storage Locations

Animus stores secrets in three places, each encrypted using the same `EncryptionService`:

| Location | Table | Column | Scope | Encryption |
|----------|-------|--------|-------|------------|
| Agent provider keys | `credentials` | `encrypted_data` | Per-credential row | Entire value encrypted |
| Plugin config | `plugins` | `config_encrypted` | Per-plugin blob | Entire JSON config encrypted as one blob |
| Channel config | `channel_packages` | `config` | Per-channel JSON | Individual `secret` fields encrypted within JSON |
| Password vault | `vault_entries` | `encrypted_password` | Per-entry password | Password value encrypted per row |

All four tables live in `system.db`.

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
1. loadVault()                      — read vault.json (or detect first run)
2. resolveUnlockPassword()          — check Docker secret / env var
3. If password: deriveAndUnwrap()   — Argon2id + AES-256-GCM unseal
4. initializeDatabases()            — open 7 DBs, run migrations
5. If unsealed: loadCredentialsIntoEnv(systemDb) — decrypt all → set process.env
6. Start Fastify server + heartbeat (full or degraded based on seal state)
```

See `docs/architecture/encryption-architecture.md` for the complete startup flow, including sealed-state behavior, first-run registration, and migration from legacy `.secrets` files.

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

**File:** `packages/backend/src/db/stores/credential-store.ts` (re-exported via `system-store.ts` barrel)

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

**File:** `packages/backend/src/plugins/plugin-manager.ts` — `getMcpConfigs()`

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

Same format as plugins. 

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

## Password Vault

The password vault is a user-managed credential store for accounts and services that the agent can use via `run_with_credentials`. Unlike plugin credentials (which are tied to a specific plugin's config schema), vault entries are standalone, user-created credentials for any service.

### Database Schema

**Migration:** `packages/backend/src/db/migrations/system/018_vault_entries.sql`

```sql
CREATE TABLE IF NOT EXISTS vault_entries (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  service TEXT NOT NULL,
  url TEXT,
  identity TEXT,
  encrypted_password TEXT NOT NULL,  -- AES-256-GCM encrypted
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Each entry represents a single service account. The `identity` field stores the username/email used to log in, and `notes` provides context for the agent.

### Store Layer

**File:** `packages/backend/src/db/stores/vault-store.ts`

| Method | Purpose |
|--------|---------|
| `createVaultEntry(db, input)` | Encrypt password, store entry, return metadata |
| `getVaultEntry(db, id)` | Decrypt and return full entry (including password) |
| `getVaultEntryMetadata(db, id)` | Return metadata with hint, no password |
| `updateVaultEntry(db, id, updates)` | Update fields, re-encrypt if password changed |
| `deleteVaultEntry(db, id)` | Remove entry |
| `listVaultEntries(db)` | Return all entries as metadata (sorted by service, label) |
| `getVaultEntryCount(db)` | Count entries |

Metadata includes a password `hint` (last 4 characters, e.g., `****word`). Short passwords (4 or fewer characters) show `****` only.

### Vault Refs

Vault entries are referenced using the `vault:<id>` format in `run_with_credentials`:

```
run_with_credentials({
  command: "curl -u user:$PASSWORD https://api.example.com/data",
  credentialRef: "vault:abc-123-def",
  envVar: "PASSWORD"
})
```

The handler resolves `vault:<id>` refs by looking up the entry in vault_entries and decrypting the password. Both `credentialRef` and `additionalCredentials[].credentialRef` support vault refs.

### Discovery via `list_vault_entries` Tool

**File:** `packages/backend/src/tools/handlers/list-vault-entries.ts`

The `list_vault_entries` tool lets the agent discover available vault entries without seeing passwords. It returns metadata including the vault ref for each entry:

```
Password vault: 2 entries

1. GitHub (github.com)
   identity: user@example.com
   vault: vault:abc-123 | password hint: ****word
   notes: Personal account

2. Gmail (google.com)
   identity: user@gmail.com
   vault: vault:def-456 | password hint: ****1234

Use run_with_credentials with the vault ref above.
```

Supports an optional `service` filter (case-insensitive, matches both service and label fields).

### Output Redaction

The `run_with_credentials` handler redacts credential values from subprocess output. If a command echoes or logs an injected credential value (e.g., `echo $PASSWORD`), the handler scans stdout and stderr for the raw value and replaces it with `[REDACTED]`. This prevents accidental credential exposure in tool results that the mind sees.

Only values of 4 or more characters are redacted to avoid false positives on short strings.

### Credential Audit Logging

**Migration:** `packages/backend/src/db/migrations/agent-logs/002_credential_audit.sql`

Every credential access through `run_with_credentials` is logged to `agent_logs.db`:

```sql
CREATE TABLE IF NOT EXISTS credential_access_log (
  id TEXT PRIMARY KEY,
  credential_type TEXT NOT NULL,  -- 'vault' | 'plugin' | 'channel'
  credential_ref TEXT NOT NULL,   -- 'vault:abc-123' or 'pluginName.KEY'
  tool_name TEXT NOT NULL,
  agent_context TEXT,
  accessed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**File:** `packages/backend/src/db/stores/credential-audit-store.ts`

This provides an audit trail of which credentials were accessed, when, and in what agent context (mind tick vs sub-agent task).

### Context Integration

During the GATHER phase, the heartbeat includes a vault summary in the credential manifest:

```
Password vault: 3 accounts stored. Use list_vault_entries to browse, then run_with_credentials with vault:<id> refs.
```

This is a lightweight count (not a full listing) to avoid context bloat. The agent uses `list_vault_entries` for on-demand discovery.

### tRPC API

**File:** `packages/backend/src/api/routers/vault.ts`

| Endpoint | Purpose | Returns |
|----------|---------|---------|
| `vault.list` | List all entries | `VaultEntryMetadata[]` (no passwords) |
| `vault.get` | Get single entry metadata | `VaultEntryMetadata \| null` |
| `vault.create` | Create new entry | `VaultEntryMetadata` |
| `vault.update` | Update entry fields | `VaultEntryMetadata \| null` |
| `vault.delete` | Delete entry | `{ success: boolean }` |

All read endpoints return metadata only (hint, not password). The tRPC layer never exposes decrypted passwords to the frontend.

---

## The Agent-Blind Pattern

### Credential Manifest

During the GATHER phase, the heartbeat builds a credential manifest from all enabled plugins with `secret` config fields.

**File:** `packages/backend/src/plugins/plugin-manager.ts` — `getCredentialManifest()`

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

Password vault: 3 accounts stored. Use list_vault_entries to browse,
then run_with_credentials with vault:<id> refs.

Usage: run_with_credentials({ command, credentialRef, envVar })
```

The vault summary is a lightweight count to avoid context bloat. The agent uses `list_vault_entries` for on-demand discovery of individual entries and their `vault:<id>` refs.

### Tool Definition

**File:** `packages/shared/src/tools/definitions.ts`

```typescript
run_with_credentials({
  command: string,        // Shell command to execute
  credentialRef: string,  // e.g. "nano-banana-pro.GEMINI_API_KEY" or "vault:abc-123"
  envVar: string,         // e.g. "GEMINI_API_KEY"
  additionalCredentials?: Array<{  // For plugins needing multiple credentials
    credentialRef: string,         // e.g. "trello.TRELLO_API_TOKEN" or "vault:def-456"
    envVar: string,                // e.g. "TRELLO_API_TOKEN"
  }>,
  cwd?: string            // Working directory
})
```

The mind calls this tool with a credential reference. The handler resolves the reference (and any additional credentials), injects the real values as env vars on the subprocess, and returns only stdout/stderr. Credential values never appear in the tool result (output is scanned for injected values and redacted). The `additionalCredentials` field supports plugins that need multiple secrets per API call (e.g., Trello's API key + token).

Two credential reference formats are supported:
- **Plugin refs:** `pluginName.CONFIG_KEY` resolves from the plugin's encrypted config
- **Vault refs:** `vault:<id>` resolves from the password vault (user-managed entries)

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
| `vault_entries` | `encrypted_password` | AES-256-GCM ciphertext of password |
| `credential_access_log` | `credential_ref` | Audit trail: ref name, type, tool, timestamp (no values) |
| `agent_logs` | events | Tool calls with `credentialRef`, never resolved values |

### Threat Model

| Threat | Mitigation |
|--------|-----------|
| **LLM sees raw key in prompt** | Agent-blind: mind only sees metadata and references |
| **Key in session transcript** | Only references appear in mind output; values never in agent events |
| **Key in agent_logs.db** | Tool call logs contain `credentialRef`, not the resolved value |
| **Malicious skill exfiltrates key** | Key never in LLM context; skill can't instruct mind to leak what it doesn't have |
| **Filesystem access to DB** | Encrypted at rest with AES-256-GCM |
| **Subprocess credential leakage** | Agent provider keys stripped from `run_with_credentials` child env. Output scanned for injected values and redacted. |
| **Plugin subprocess reads encryption key** | No key file on disk. DEK exists only in the parent process heap, inaccessible to child processes. |
| **Agent reads encryption key via tools** | DEK not in any file or environment variable. File deny list blocks access to `vault.json` and security-critical source files. See `docs/architecture/encryption-architecture.md` for the full threat model. |
| **Credential hint reduces entropy** | Last 4 chars exposed. Minimal brute-force advantage in practice. |

### Trust Assumptions

- **Self-hosted, single-user:** The user controls the machine, the data directory, and which plugins/channels are installed.
- **Password-derived encryption:** The DEK is derived from the user's password and exists only in process memory. No key material is stored on the filesystem. See `docs/architecture/encryption-architecture.md` for the complete encryption architecture.
- **Plugin trust:** Plugins run as subprocesses that cannot access the parent process heap. Plugin installation is a user-initiated, trusted action.
- **No remote storage:** All data is local SQLite. No network transmission of credentials except to the provider API for validation and to the intended third-party services.

---

## Key Files Reference

### Encryption & Core

| File | Purpose |
|------|---------|
| `packages/backend/src/lib/vault-manager.ts` | Sealed/unsealed state, DEK lifecycle, unlock flow |
| `packages/backend/src/lib/encryption-service.ts` | AES-256-GCM encrypt/decrypt, receives DEK from vault |
| `packages/backend/src/lib/secrets-manager.ts` | Legacy secrets resolution (migration support) |
| `packages/backend/src/utils/env.ts` | `DATA_DIR` resolution, derived database paths |
| `packages/backend/src/index.ts` | Startup order: vault load → unseal → migrations → credential load |

### Agent Provider Keys

| File | Purpose |
|------|---------|
| `packages/backend/src/services/credential-service.ts` | Save, validate, detect, load-into-env |
| `packages/backend/src/db/stores/credential-store.ts` | Credential CRUD (re-exported via `system-store.ts` barrel) |
| `packages/backend/src/db/migrations/system/003_credentials.sql` | Table schema |
| `packages/backend/src/db/migrations/system/008_encryption_key_check.sql` | Sentinel column |
| `packages/backend/src/api/routers/provider.ts` | tRPC endpoints |
| `packages/backend/src/api/routers/codex-auth.ts` | Codex OAuth device code flow |

### Plugin Credentials

| File | Purpose |
|------|---------|
| `packages/backend/src/plugins/plugin-manager.ts` | Config encrypt/decrypt, manifest, MCP resolution, handler execution |
| `packages/backend/src/db/stores/plugin-store.ts` | Plugin config persistence |
| `packages/backend/src/db/migrations/system/006_plugins.sql` | Table schema |
| `packages/backend/src/api/routers/plugins.ts` | tRPC endpoints (masked config) |
| `packages/backend/src/tools/handlers/run-with-credentials.ts` | Agent-blind tool handler (vault refs, output redaction, audit logging) |
| `packages/shared/src/tools/definitions.ts` | Tool definitions |
| `packages/backend/src/heartbeat/context-builder.ts` | Manifest in prompt |

### Password Vault

| File | Purpose |
|------|---------|
| `packages/backend/src/db/stores/vault-store.ts` | Vault entry CRUD with encrypt/decrypt |
| `packages/backend/src/db/stores/credential-audit-store.ts` | Credential access audit logging |
| `packages/backend/src/db/migrations/system/018_vault_entries.sql` | Vault entries table |
| `packages/backend/src/db/migrations/agent-logs/002_credential_audit.sql` | Credential audit log table |
| `packages/backend/src/tools/handlers/list-vault-entries.ts` | `list_vault_entries` tool handler |
| `packages/backend/src/api/routers/vault.ts` | tRPC endpoints for vault CRUD |
| `packages/backend/src/heartbeat/gather-context.ts` | Vault summary in credential manifest |

### Channel Credentials

| File | Purpose |
|------|---------|
| `packages/backend/src/channels/channel-manager.ts` | Config decryption, process lifecycle |
| `packages/backend/src/channels/process-host.ts` | IPC init with decrypted config |
| `packages/backend/src/channels/sdk/adapter-context.ts` | Child process bootstrap, config access |
| `packages/backend/src/channels/ipc/protocol.ts` | IPC message types (`init`, `config_update`) |
| `packages/backend/src/db/stores/channel-package-store.ts` | Channel config encrypt/decrypt (re-exported via `system-store.ts` barrel) |
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
| **Password vault** | `vault_entries.encrypted_password`, per-row encryption | `run_with_credentials` subprocess env var | Count + `list_vault_entries` tool (metadata only) |

All paths share the same AES-256-GCM encryption service, the same startup verification, and the same frontend masking pattern. The mind operates in a credential-blind environment where it can reference secrets by name but never access their values. All credential access through `run_with_credentials` is audit-logged to `agent_logs.db`.
