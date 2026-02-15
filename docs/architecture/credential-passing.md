# Credential Passing Architecture

> How API keys and secrets flow from encrypted storage to skill/plugin execution — informed by OpenClaw's agent-blind credential RFC and Animus's existing infrastructure.

**Status:** Reference document for implementation
**Last Updated:** 2026-02-14

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [OpenClaw's Current Approach (What Not to Do)](#openclaws-current-approach)
3. [OpenClaw's Agent-Blind RFC (The Better Model)](#openclaws-agent-blind-rfc)
4. [Animus's Current Infrastructure](#animus-current-infrastructure)
5. [Recommended Architecture for Animus](#recommended-architecture)
6. [Credential Lifecycle](#credential-lifecycle)
7. [Skill & Plugin Credential Injection](#skill--plugin-credential-injection)
8. [Security Boundaries](#security-boundaries)
9. [Implementation Guidance](#implementation-guidance)

---

## Problem Statement

When a skill or plugin needs a third-party API key (Gemini, Stripe, a weather API, etc.), three questions must be answered:

1. **Storage:** Where does the key live and how is it protected at rest?
2. **Resolution:** How does the system know which key a skill needs?
3. **Injection:** How does the decrypted key reach the executing code without leaking?

The goal is: **the LLM (mind) should never see raw credential values.** If the mind sees a key, it can end up in thoughts, transcripts, session logs, or be exfiltrated by a malicious skill prompt. This is the core lesson from OpenClaw's security failures.

---

## OpenClaw's Current Approach

OpenClaw stores credentials in `~/.openclaw/agent/auth-profiles.json` as **plaintext JSON**. File permissions (`700` on the directory, `600` on files) are the only protection. There is no encryption at rest.

### How Skills Access Keys

When a skill runs, the credential resolution chain is:

1. Explicit `authProfileId` parameter on the call
2. Model-specific auth mode lookup
3. Default profile for the provider

The resolved key is passed to CLI tools via **arguments or stdin**. For agent-invoked tools, the key value flows through the LLM context window — the model sees the raw key.

### What Went Wrong

Snyk research found **283 skills (7.1% of the ClawHub marketplace)** with credential leaks:

- Skills instruct the agent to "save the API key to memory" — plaintext in `memory.jsonl`
- Keys pass through the LLM context window (model sees raw values)
- Keys appear verbatim in session transcripts (`sessions/*.jsonl`)
- Any process with filesystem access can read logs containing keys
- No encryption, no redaction, no separation between secrets and prompts

**Root cause:** The architecture treats the LLM as a trusted intermediary for secrets. It is not. Every piece of data the agent touches passes through the model provider's API.

### References

- [Snyk: 280+ Leaky Skills Research](https://snyk.io/blog/openclaw-skills-credential-leaks-research/)
- [The Register: OpenClaw Skills Security](https://www.theregister.com/2026/02/05/openclaw_skills_marketplace_leaky_security/)
- [OpenClaw Security Docs](https://docs.openclaw.ai/gateway/security)

---

## OpenClaw's Agent-Blind RFC

[RFC Discussion #9676](https://github.com/openclaw/openclaw/discussions/9676) proposes a fundamentally different model. Status: under discussion, not yet implemented.

### Core Principle

> "Credentials should be stored and used without the AI agent ever seeing their values."

The agent knows credentials *exist* via metadata, but only references them by identifier. A separate **Credential Broker** handles resolution and injection at execution time.

### What the Agent Sees (Metadata Only)

```json
{
  "stripe_api": {
    "type": "api_key",
    "provider": "stripe",
    "hint": "...4f2x",
    "capabilities": ["payments"]
  }
}
```

No `value` field. The agent gets a hint (last 4 chars) for disambiguation, plus metadata about what the credential is for — but never the secret itself.

### What the Agent Sends (References Only)

Old pattern (credential flows through agent):
```json
{ "url": "https://api.stripe.com/charges", "apiKey": "sk-live-xxx" }
```

New pattern (agent-blind):
```json
{
  "url": "https://api.stripe.com/charges",
  "credentialRef": "stripe_api",
  "credentialPlacement": {
    "type": "header",
    "key": "Authorization"
  }
}
```

The agent says *which* credential and *where* to put it. The Credential Broker resolves the actual value and injects it at the execution boundary — after the LLM has finished its turn.

### VaultBackend Abstraction

```typescript
interface VaultBackend {
  store(ref: string, value: string, metadata: CredentialMetadata): Promise<void>;
  resolve(ref: string): Promise<string | null>;  // Only Broker calls this
  list(): Promise<CredentialMetadata[]>;          // Metadata only, no values
}
```

Pluggable backends: system keychain, encrypted files, 1Password, Bitwarden, HashiCorp Vault, AWS Secrets Manager.

### Security Tiers

| Mode | Credential Visibility | 2FA | Use Case |
|------|-----------------------|-----|----------|
| `yolo` | Agent sees values (legacy) | None | Development/testing |
| `balanced` | Agent-blind, hint only | Sensitive actions | Default for new installs |
| `strict` | Agent-blind, hint only | All credential use | High-security deployments |

### 2FA Action Matrix

| Action | yolo | balanced | strict |
|--------|------|----------|--------|
| API call with credential | auto | auto | 2FA |
| Form fill (password field) | auto | 2FA | 2FA |
| View raw credential value | auto | 2FA | local only |
| Send credential via message | warn | 2FA | blocked |

### Key Takeaways for Animus

1. **Never pass raw keys through the LLM context.** The mind should reference credentials by name, not by value.
2. **Credential injection happens in the EXECUTE phase**, after the mind has finished thinking — this is a system-level operation, not an agent-level one.
3. **The agent only needs metadata** — provider name, credential type, a hint for disambiguation. This is enough for the mind to make decisions about *which* credential to use.
4. **Tool schemas should accept credential references**, not raw values. The execution layer resolves references to real values.
5. **Encryption at rest is necessary but not sufficient.** If you decrypt and hand the value to the LLM, you've just moved the plaintext from disk to a third-party API call.

---

## Animus Current Infrastructure

Animus already has solid foundations that OpenClaw lacks entirely.

### Encryption at Rest (Already Implemented)

**File:** `packages/backend/src/lib/encryption-service.ts`

- **Algorithm:** AES-256-GCM
- **Key derivation:** PBKDF2 with 100,000 iterations from `ANIMUS_ENCRYPTION_KEY` env var
- **Format:** `{iv}:{ciphertext}:{authTag}` (base64)
- **Verification:** Sentinel value check on startup — if the encryption key changes, the server refuses to start
- **Legacy migration:** Handles `plain:` prefix for migrating from unencrypted storage

### Credential Storage (Already Implemented)

**Table:** `credentials` in `system.db`

```sql
CREATE TABLE credentials (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  credential_type TEXT NOT NULL,
  encrypted_data TEXT NOT NULL,       -- AES-256-GCM encrypted
  metadata TEXT,                      -- Optional JSON (expiry, token type, etc.)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- Unique constraint: one credential per (provider, credential_type)
```

**Access layer:** `packages/backend/src/db/stores/system-store.ts`
- `saveCredential()` — encrypts and upserts
- `getCredential()` — decrypts and returns
- `getAllCredentials()` — decrypts all (used at startup)
- `deleteCredential()` — removes from DB

### Agent Provider Keys (Already Implemented)

**File:** `packages/backend/src/services/credential-service.ts`

At startup, `loadCredentialsIntoEnv()` decrypts agent provider keys and loads them into `process.env`:

| DB Key | Environment Variable |
|--------|---------------------|
| `claude:api_key` | `ANTHROPIC_API_KEY` |
| `claude:oauth_token` | `CLAUDE_CODE_OAUTH_TOKEN` |
| `codex:api_key` | `OPENAI_API_KEY` |

This works for agent SDK credentials because the SDKs read from `process.env` automatically. The LLM never sees these values — they're used by the SDK transport layer.

### Plugin Config Encryption (Already Implemented)

**File:** `packages/backend/src/services/plugin-manager.ts`

Plugin configuration (including sensitive fields) is stored as an encrypted JSON blob in `plugins.config_encrypted`. The plugin manifest declares which fields are sensitive:

```json
{
  "configSchema": {
    "properties": {
      "apiToken": { "type": "string", "sensitive": true },
      "pollingInterval": { "type": "number", "default": 60 }
    }
  }
}
```

- **Frontend:** Sees masked values (`'••••••••'`) for sensitive fields
- **Decision handlers/hooks:** Receive full decrypted config via stdin
- **MCP servers:** Do NOT yet receive credentials automatically (gap)

### What's Missing

| Gap | Description |
|-----|-------------|
| **Skill credential injection** | Skills (markdown instructions for the mind) have no mechanism to reference or use third-party API keys without the mind seeing them |
| **MCP server credential injection** | Plugin MCP servers can declare `env` in their manifest, but there's no auto-injection from encrypted plugin config into those env vars |
| **Credential references in tool schemas** | Tools accept raw values, not credential references |
| **Mind credential metadata** | The mind has no way to know what credentials are available without seeing their values |

---

## Recommended Architecture for Animus

### Design Principles

1. **Agent-blind by default.** The mind never sees raw credential values. It sees metadata: provider, type, hint, and a reference ID.
2. **Injection at the execution boundary.** Credentials are resolved and injected in the EXECUTE phase of the heartbeat pipeline — after the mind has finished its turn.
3. **Use what we have.** We already have AES-256-GCM encryption, a credentials table, and plugin config encryption. Build on these.
4. **Single-user simplicity.** Unlike OpenClaw's multi-user gateway, Animus is single-user. We don't need vault plugin abstractions or 2FA tiers yet. Our `EncryptionService` + SQLite is sufficient.

### Credential Metadata for the Mind

During the GATHER phase of the heartbeat, the context builder should include a **credential manifest** — a list of available credentials the mind can reference, with no secret values:

```typescript
interface CredentialManifest {
  ref: string;           // Reference ID (e.g., "gemini_api_key")
  provider: string;      // "google", "stripe", etc.
  type: string;          // "api_key", "oauth_token", etc.
  hint: string;          // Last 4 chars: "...a1b2"
  source: 'credential' | 'plugin';  // Where it's stored
  pluginName?: string;   // If source is 'plugin', which plugin owns it
}
```

The mind sees something like:
```
Available credentials: gemini_api_key (Google, ...x4f2), weather_api (OpenWeather, ...9k3m)
```

This is enough for the mind to decide which credential a skill needs and reference it by `ref` in decisions or tool calls.

### Credential Resolution in EXECUTE

When the EXECUTE phase processes a decision that needs a credential (e.g., running a skill that calls the Gemini API), the flow is:

```
Mind outputs: { credentialRef: "gemini_api_key", ... }
    ↓
EXECUTE phase: credentialService.resolve("gemini_api_key")
    ↓
Resolution: Look up in credentials table → decrypt → return raw value
    ↓
Injection: Pass to skill execution environment (env var, stdin, or HTTP header)
    ↓
Skill runs with the real key. Mind never saw it.
```

### Where Credentials Come From

Two sources feed the credential manifest:

1. **`credentials` table** — API keys saved via the Settings UI provider configuration. These already exist.

2. **Plugin config (sensitive fields)** — When a plugin declares `"sensitive": true` fields in its config schema, those become referenceable credentials. The plugin name + field key form the reference ID (e.g., `nano-banana-pro.geminiApiKey`).

Both are already encrypted at rest. The only new work is:
- Building the manifest (read metadata without decrypting values)
- Resolving references during EXECUTE
- Injecting values into the execution environment

### Injection Methods

Different execution contexts need different injection approaches:

| Execution Context | Injection Method |
|-------------------|-----------------|
| **MCP server (subprocess)** | Environment variables set before spawn |
| **Decision handler (subprocess)** | Included in stdin JSON payload (already done for plugin config) |
| **Hook (subprocess)** | Environment variables or stdin |
| **Sub-agent session** | Process.env (already done for provider keys) |
| **HTTP tool call** | Header injection by the execution layer |
| **Skill (mind-executed)** | Mind references credential; EXECUTE resolves and injects into the actual tool call |

### Plugin MCP Server Credential Injection

For plugin MCP servers specifically, the plugin manifest already supports `env` declarations:

```json
{
  "tools": {
    "mcp": {
      "servers": {
        "my-server": {
          "command": "node",
          "args": ["server.js"],
          "env": {
            "API_KEY": "${config.apiToken}"
          }
        }
      }
    }
  }
}
```

The `${config.apiToken}` syntax should resolve against the plugin's decrypted config at spawn time. The MCP server process gets the real value as an env var. The mind never touches it — it just invokes the MCP tool by name, and the tool's server process already has the key.

This is the simplest and most important injection path to implement.

---

## Credential Lifecycle

### 1. Creation (User Sets a Key)

```
User enters API key in Settings UI
    ↓
Frontend sends to provider.saveKey or plugins.setConfig
    ↓
Backend encrypts with EncryptionService (AES-256-GCM)
    ↓
Stored in credentials table or plugins.config_encrypted
    ↓
Credential manifest updated (emitted via EventBus)
```

### 2. Context Assembly (Mind Needs to Know What's Available)

```
Heartbeat GATHER phase
    ↓
ContextBuilder queries credential manifest
    ↓
Returns metadata only: ref, provider, hint — no values
    ↓
Included in mind's system prompt as available resources
```

### 3. Mind References a Credential

```
Mind decides to use a skill that needs an API key
    ↓
Mind outputs decision with credentialRef (NOT the raw key)
    ↓
Example: { action: "call_api", credentialRef: "gemini_api_key", ... }
```

### 4. EXECUTE Phase Resolves and Injects

```
EXECUTE reads credentialRef from decision
    ↓
credentialService.resolve("gemini_api_key")
    ↓
Decrypts from credentials table
    ↓
Injects into execution environment:
  - Subprocess: env var or stdin
  - HTTP call: header injection
  - MCP server: already running with env var from spawn
```

### 5. Rotation (User Updates a Key)

```
User updates key in Settings UI
    ↓
Old key overwritten (upsert pattern already in systemStore)
    ↓
Running MCP servers: restart required (hot-swap via plugin manager)
    ↓
Next heartbeat tick: manifest reflects updated hint
```

---

## Skill & Plugin Credential Injection

### Skills (Agent Skills / SKILL.md)

Skills are markdown instructions consumed by the mind. They don't directly execute code — the mind reads the skill and uses its tools to accomplish the task. For skills that need API keys:

**Pattern:** The skill instructions should reference credentials by name. The mind then includes the `credentialRef` in its tool call. The EXECUTE phase resolves the reference.

Example skill instruction:
```markdown
## Generate Image with Gemini
Use the `generate_image` tool with credentialRef "gemini_api_key" to authenticate.
```

The mind sees this, calls the tool with `credentialRef: "gemini_api_key"`, and the execution layer handles the rest. The mind never needs the actual key value.

### Plugin MCP Tools

This is the most common case. A plugin provides MCP tools via a subprocess server. The server needs API keys to function.

**Pattern:** Resolve `${config.*}` placeholders in the MCP server's `env` declaration at spawn time.

```
Plugin manifest declares: env.API_KEY = "${config.apiToken}"
    ↓
PluginManager spawns MCP server
    ↓
Decrypts plugin config, resolves ${config.apiToken} to real value
    ↓
Sets API_KEY env var on the child process
    ↓
MCP server reads process.env.API_KEY internally
    ↓
Mind calls tool by name, never sees the key
```

### Plugin Decision Handlers

Already implemented — handlers receive decrypted config via stdin JSON. No changes needed.

### Plugin Hooks

Same pattern as decision handlers — receive context via stdin. If a hook needs credentials, include them in the stdin payload from decrypted plugin config.

---

## Security Boundaries

### What the Mind CAN See

- Credential metadata (provider, type, hint)
- That a credential exists and is available
- Which tools/skills require which credentials (by reference)

### What the Mind CANNOT See

- Raw API key values
- Decrypted credential data
- Plugin config sensitive field values

### What Appears in Logs

- Credential references (e.g., "used gemini_api_key")
- Never raw values
- Session transcripts contain only references, not secrets

### What Appears in the Database

- `credentials.encrypted_data` — AES-256-GCM ciphertext (never plaintext)
- `plugins.config_encrypted` — AES-256-GCM ciphertext of full config JSON
- Agent logs — tool calls with credential references, never values

### Threat Model

| Threat | Mitigation |
|--------|-----------|
| LLM sees raw key in prompt | Agent-blind: mind only sees metadata/references |
| Key in session transcript | References only in mind output; real values never in agent events |
| Key in agent_logs.db | Tool call logs contain `credentialRef`, not the resolved value |
| Malicious skill exfiltrates key | Key never in LLM context; skill can't instruct mind to leak what it doesn't have |
| Filesystem access to DB | Encrypted at rest with AES-256-GCM |
| Env var leakage in subprocess | Subprocess env vars are per-process; cleared on exit |
| `ANIMUS_ENCRYPTION_KEY` compromised | All credentials compromised — but this is inherent to any single-key system. Mitigated by file permissions and never storing the encryption key in the DB. |

---

## Implementation Guidance

### Priority Order

1. **Plugin MCP server `${config.*}` env injection** — Highest impact, simplest to implement. Unblocks all plugin tools that need API keys. Just resolve placeholders from decrypted plugin config when spawning MCP server subprocesses.

2. **Credential manifest in context builder** — Let the mind know what credentials are available by including metadata in the GATHER phase. No new DB tables needed; query existing `credentials` and `plugins` tables for metadata.

3. **`credentialRef` support in tool execution** — When the mind's output includes a `credentialRef`, resolve it in EXECUTE before passing to the tool. This is the agent-blind pattern.

4. **Credential management UI for plugin-independent keys** — The Settings UI already has provider key management. Extend it to allow arbitrary credential creation (name, provider, key) for third-party services that aren't tied to a specific plugin.

### What We Do NOT Need (Yet)

- **Vault backend abstraction** — We're single-user with SQLite. Our EncryptionService + credentials table is equivalent to an encrypted file vault. No need for 1Password/Bitwarden/HashiCorp integrations.
- **2FA tiers** — Single-user app. The user already authenticated to access the UI.
- **Security mode selection** — We go agent-blind by default. No "yolo" mode.
- **Credential Broker as separate process** — In-process resolution in the EXECUTE phase is sufficient. No need for IPC overhead.
- **Migration tooling** — We're building this from the start, not migrating from plaintext.

### Key Files to Modify

| File | Change |
|------|--------|
| `packages/backend/src/services/plugin-manager.ts` | Resolve `${config.*}` in MCP server env at spawn time |
| `packages/backend/src/services/credential-service.ts` | Add `getCredentialManifest()` and `resolve(ref)` methods |
| `packages/backend/src/heartbeat/index.ts` | Include credential manifest in GATHER context |
| `packages/shared/src/schemas/` | Add `CredentialManifest` and `CredentialRef` types |
| `packages/backend/src/heartbeat/execute.ts` | Resolve `credentialRef` in decisions before execution |

---

## Comparison: OpenClaw vs Animus

| Aspect | OpenClaw (Current) | OpenClaw (RFC) | Animus (Recommended) |
|--------|--------------------|----------------|----------------------|
| Storage | Plaintext JSON files | Pluggable vault backends | AES-256-GCM encrypted SQLite |
| Encryption at rest | None (file perms only) | Backend-dependent | Always (mandatory encryption key) |
| Agent visibility | Sees raw values | Metadata + hints only | Metadata + hints only |
| Credential passing | Through LLM context | Broker injection post-LLM | EXECUTE phase injection post-mind |
| Key rotation | Manual file edit | CLI migration tool | UI update, auto re-encrypt |
| Multi-backend | No | Yes (keychain, 1Password, etc.) | No (not needed for single-user) |
| 2FA | No | Tiered (yolo/balanced/strict) | No (single-user, already authed) |
| Complexity | ~0 lines (no security) | ~800 lines estimated | Minimal — builds on existing encryption |

---

## Summary

The key insight from OpenClaw's failures and their proposed fix is simple: **never let the LLM see raw credential values.** Animus already has the hard part done (encryption at rest, credential storage, plugin config encryption). What's left is:

1. Resolving plugin config placeholders into MCP server env vars at spawn time
2. Building a credential manifest for the mind (metadata only)
3. Supporting `credentialRef` in tool/decision schemas
4. Resolving references in the EXECUTE phase, after the mind has finished

This keeps Animus's credential security ahead of OpenClaw's current state and aligned with their proposed future architecture — without the complexity overhead of vault abstractions, security tiers, or 2FA that a single-user self-hosted app doesn't need.
