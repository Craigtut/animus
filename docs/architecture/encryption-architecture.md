# Encryption Architecture

> How Animus protects credentials at rest using password-derived encryption, sealed/unsealed server states, and a layered defense model that keeps the encryption key out of reach of the AI agent.

**Status:** Implemented
**Last Updated:** 2026-03-02

---

## Table of Contents

1. [Design Goals](#design-goals)
2. [Threat Model](#threat-model)
3. [Envelope Encryption](#envelope-encryption)
4. [Server Seal States](#server-seal-states)
5. [Unlock Paths](#unlock-paths)
6. [File Deny List](#file-deny-list)
7. [Startup Flow](#startup-flow)
8. [Password Change](#password-change)
9. [First-Time Setup](#first-time-setup)
10. [Deployment Scenarios](#deployment-scenarios)
11. [Future: Device-Key Auto-Unseal](#future-device-key-auto-unseal)
12. [Key Files Reference](#key-files-reference)

---

## Design Goals

1. **No key material on the filesystem.** The encryption key is derived from the user's password and exists only in process memory. There is no `.secrets` file, no key file, no recoverable key on disk.
2. **Agent cannot access the key.** The agent's tools (Read, Write, Bash) cannot read the encryption key because it exists only in the Node.js process heap, not in any file, environment variable, or OS service the agent can query.
3. **Graceful degradation.** When the server is sealed (key not in memory), the heartbeat still runs, channels still receive messages, and the system responds with clear unlock instructions rather than crashing.
4. **Zero friction for Docker/headless.** Automated environments provide the unlock password via environment variable or Docker secret. The user configures it once and never interacts with an unlock screen.
5. **Envelope encryption.** A random Data Encryption Key (DEK) encrypts all credentials. The user's password wraps the DEK. Password changes re-wrap the DEK without touching any encrypted credentials.

---

## Threat Model

### What This Architecture Defends Against

| Threat | How It's Blocked |
|--------|-----------------|
| **Prompt injection: "read the secrets file"** | No secrets file exists on disk. Nothing to read. |
| **Prompt injection: "read the key from env vars"** | Unlock password scrubbed from `process.env` after key derivation. DEK never in `process.env`. |
| **Prompt injection: "read the key from process memory"** | Agent tools (Read, Bash) run in subprocesses that cannot access the parent Node.js process heap. |
| **Prompt injection: "read the key from OS keyring"** | No key stored in the OS keyring (default configuration). |
| **Malicious plugin reads filesystem** | No key file on disk. Database files are encrypted ciphertext. |
| **Malicious plugin reads process memory** | Plugins run as child processes. Cannot access parent process heap. |
| **Physical disk theft / backup exfiltration** | Attacker gets `vault.json` (salt + wrapped DEK) plus encrypted databases. Must brute-force the password through Argon2id to decrypt. |
| **Data directory copied to another machine** | Wrapped DEK requires the password. Ciphertext is useless without it. |

### What This Architecture Does NOT Defend Against

| Threat | Why | Mitigation |
|--------|-----|------------|
| **Prompt injection: "use credentials on my behalf"** | The agent-blind pattern allows the agent to call `run_with_credentials` with valid references. The agent can misuse a credential without seeing its value. | Tool permission system, user approval for sensitive operations. See `docs/architecture/tool-permissions.md`. |
| **Memory dump of running process** | The derived DEK lives in the Node.js heap for the process lifetime. A debugger or core dump could extract it. | OS-level protections (SIP on macOS, ptrace restrictions on Linux). Disable core dumps in production. |
| **Weak password brute-force** | If the user chooses a weak password, offline brute-force against `vault.json` is feasible. | Argon2id with high memory cost (64 MB) makes each attempt expensive. Enforce minimum password strength at registration. |
| **Agent modifies server source code** | A prompt-injected agent could theoretically edit encryption source files to log the key on next restart. | File deny list blocks writes to security-critical source files. Code review on restart. |

### Trust Assumptions

- **Self-hosted, single-user.** The user controls the machine, the data directory, and which plugins/channels are installed.
- **Plugin trust.** Plugin installation is a user-initiated action. Plugins run as isolated subprocesses but share the same OS user. The encryption key is not accessible to subprocesses.
- **Password strength.** The system's resistance to offline brute-force is proportional to password entropy. The system enforces minimum requirements but cannot prevent weak passwords.

---

## Envelope Encryption

Animus uses a two-layer key hierarchy:

```
User's Password
  --> Argon2id(password, salt) --> Password Key (256-bit)
      --> AES-256-GCM unwrap --> DEK (Data Encryption Key, 256-bit random)
          --> AES-256-GCM --> encrypted credentials in SQLite
```

### Data Encryption Key (DEK)

The DEK is a 256-bit random value generated once during initial setup via `crypto.randomBytes(32)`. It encrypts all credentials across all three storage locations (agent provider keys, plugin configs, channel configs). The DEK itself is never stored in plaintext anywhere.

### Password Key

Derived from the user's password using Argon2id:

| Parameter | Value |
|-----------|-------|
| Algorithm | Argon2id |
| Memory cost | 64 MB (m=65536) |
| Time cost | 3 iterations |
| Parallelism | 1 |
| Output length | 32 bytes (256 bits) |
| Salt | 32 bytes, randomly generated per instance |

These parameters produce ~300ms derivation time on modern hardware, making brute-force attacks expensive while keeping the unlock experience responsive.

### Vault File

The wrapped DEK and KDF parameters are stored in `$DATA_DIR/vault.json`:

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
  "wrappedDek": "<base64: AES-256-GCM encrypted DEK>",
  "sentinel": "<base64: AES-256-GCM encrypted 'animus-key-ok'>"
}
```

- **`wrappedDek`**: The DEK encrypted with the password-derived key. Format: `{iv}:{ciphertext}:{authTag}` (base64-encoded, colon-delimited).
- **`sentinel`**: The string `'animus-key-ok'` encrypted with the DEK. Used to verify that the correct password was provided (decrypt sentinel, check it matches the expected string).
- **`salt`**: Random, generated once at setup. Stored in plaintext (salts are not secret; their purpose is to prevent precomputed table attacks across instances).

This file is safe to include in backups. Without the password, the wrapped DEK cannot be unwrapped and the sentinel cannot be verified.

### JWT Secret

The JWT secret follows the same pattern. It is generated as a separate random value, wrapped alongside the DEK in `vault.json`, and unwrapped at unlock time. The JWT secret is independent of the DEK to maintain separation of concerns (session authentication vs. credential encryption).

### Encryption Service

The existing `EncryptionService` (AES-256-GCM) remains unchanged in its encrypt/decrypt interface. The only change is the key source: instead of reading `ANIMUS_ENCRYPTION_KEY` from a file, it receives the unwrapped DEK from the vault module at unlock time.

| Parameter | Value |
|-----------|-------|
| Algorithm | AES-256-GCM (authenticated encryption) |
| Key | Unwrapped DEK (256-bit) |
| IV | 16 bytes, randomly generated per encryption |
| Auth tag | 16 bytes |
| Ciphertext format | `{iv_base64}:{ciphertext_base64}:{authTag_base64}` |

The PBKDF2 key derivation step currently in `encryption-service.ts` (which stretches the old hex string key) is no longer needed when the DEK is a raw 256-bit key. The derived key cache remains for performance.

---

## Server Seal States

The server operates in one of two states:

### Unsealed (Normal Operation)

The DEK is in memory. All systems operate normally:
- Heartbeat ticks run the full pipeline (gather, mind query, execute)
- Credentials are encrypted/decrypted on demand
- Agent provider keys are loaded into `process.env`
- Channels start with decrypted config
- Plugin MCP servers resolve `${config.*}` placeholders
- `run_with_credentials` tool resolves credential references

### Sealed (Locked)

The DEK is not in memory. The server runs in degraded mode:
- Heartbeat ticks run but **skip credential-dependent operations** (no mind query, no agent provider key loading)
- Channels **receive messages** but cannot start new channel processes that require credentials
- The web UI shows a **lock screen** instead of the main interface
- An unauthenticated `/api/unlock` endpoint accepts the password
- All tRPC endpoints requiring encryption return a structured error: `{ code: 'SERVICE_LOCKED', message: 'Server is sealed. Visit /unlock to unseal.' }`
- Channel message responses in sealed state: *"I need to be unlocked before I can help with that. Please visit http://localhost:3000/unlock to unlock me."*

### State Transitions

```
Server Start --> [vault.json exists?]
  Yes --> [ANIMUS_UNLOCK_PASSWORD available?]
    Yes --> Derive key, unwrap DEK, verify sentinel --> Unsealed
    No  --> Sealed (wait for manual unlock)
  No  --> [First run, no vault yet] --> Registration flow creates vault --> Unsealed
```

The sealed/unsealed state is managed by a `VaultManager` module that holds the DEK in a module-scoped variable. Components that need encryption check `vault.isUnsealed()` before proceeding.

---

## Unlock Paths

### Path 1: Environment Variable (Docker, Headless, Dev)

```bash
# Docker Compose
ANIMUS_UNLOCK_PASSWORD=my-strong-password

# Docker Secrets
/run/secrets/animus-unlock-password

# .env file (dev mode, gitignored)
ANIMUS_UNLOCK_PASSWORD=devpassword

# systemd
EnvironmentFile=/etc/animus/unlock.env
```

**Resolution order at startup:**
1. Docker secret file: `/run/secrets/animus-unlock-password`
2. Environment variable: `ANIMUS_UNLOCK_PASSWORD`
3. Neither present: start sealed

After reading, the password is used to derive the key, then scrubbed:

```typescript
const password = resolveUnlockPassword();
if (password) {
  const dek = deriveAndUnwrap(password, vault);
  delete process.env['ANIMUS_UNLOCK_PASSWORD'];
  unseal(dek);
}
```

Docker re-injects environment variables on container restart, so `ANIMUS_UNLOCK_PASSWORD` is available fresh on each restart even though it was scrubbed during the previous run. This means Docker deployments auto-unseal on restart with zero user intervention.

### Path 2: Web UI Unlock (Desktop, Interactive)

The Tauri app and web UI display a lock screen when the server is sealed:

```
+----------------------------------+
|          Animus Locked           |
|                                  |
|  Enter your password to unlock   |
|                                  |
|  [________________________]      |
|                                  |
|         [ Unlock ]               |
+----------------------------------+
```

The lock screen submits to a dedicated tRPC endpoint:

```typescript
// Unauthenticated — no JWT required
vault.unlock: publicProcedure
  .input(z.object({ password: z.string() }))
  .mutation(async ({ input }) => {
    const dek = deriveAndUnwrap(input.password, vault);
    // Verify sentinel
    // Set DEK in memory
    // Load credentials into env
    // Start sealed subsystems
    // Issue JWT session cookie
  })
```

This endpoint is unauthenticated because the user has no JWT when the server just started. The unlock operation both unseals the vault and establishes the user's session.

### Path 3: CLI Unlock (SSH, Headless without Docker)

For headless environments without a web browser:

```bash
curl -X POST http://localhost:3000/trpc/vault.unlock \
  -H 'Content-Type: application/json' \
  -d '{"password": "my-password"}'
```

---

## File Deny List

Independent of the encryption architecture, the agent's file access tools are restricted from reading security-critical paths. This is defense-in-depth: even if a future change reintroduced a key file, the agent couldn't read it.

### Blocked Paths

The following paths are blocked for the agent's Read, Write, and Bash tools:

| Pattern | Reason |
|---------|--------|
| `$DATA_DIR/vault.json` | Wrapped DEK and KDF parameters |
| `$DATA_DIR/.secrets` | Legacy secrets file (if present during migration) |
| `.env` | May contain `ANIMUS_UNLOCK_PASSWORD` in dev |
| `$DATA_DIR/databases/*.db` | Raw database files (prevent direct SQLite reads) |
| `packages/backend/src/lib/encryption-service.ts` | Prevent agent from modifying encryption code |
| `packages/backend/src/lib/secrets-manager.ts` | Prevent agent from modifying secrets code |
| `packages/backend/src/lib/vault-manager.ts` | Prevent agent from modifying vault code |

### Blocked Commands

The Bash tool additionally blocks commands that could access credential storage through non-file paths:

| Pattern | Reason |
|---------|--------|
| `security find-generic-password` | macOS Keychain query (future device-key feature) |
| `secret-tool lookup` | Linux keyring query (future device-key feature) |

### Implementation

The deny list is enforced in the agent session's `canUseTool` callback and `PreToolUse` hook, which inspect tool arguments before execution. Denied tool calls return a permission error to the agent.

---

## Startup Flow

### Normal Startup (Vault Exists)

```
1. resolveDataDir()                    — determine DATA_DIR
2. loadVault()                         — read vault.json
3. resolveUnlockPassword()             — check Docker secret / env var
4. If password available:
   a. derivePasswordKey(password, salt) — Argon2id (~300ms)
   b. unwrapDek(wrappedDek, passwordKey) — AES-256-GCM decrypt
   c. verifySentinel(dek, sentinel)     — decrypt sentinel, check match
   d. setSealState('unsealed', dek)     — store DEK in module scope
   e. scrubPasswordSources()            — delete from process.env
   f. initializeDatabases()             — open 7 DBs, run migrations
   g. loadCredentialsIntoEnv(systemDb)  — decrypt provider keys into process.env
   h. Start Fastify server + heartbeat
5. If no password:
   a. setSealState('sealed')
   b. initializeDatabases()             — open DBs (non-encrypted operations still work)
   c. Start Fastify server (limited mode) + heartbeat (degraded)
```

### First Run (No Vault)

```
1. resolveDataDir()
2. loadVault() returns null             — no vault.json
3. initializeDatabases()                — open DBs, run migrations
4. Start Fastify server                 — serves registration page
5. User completes registration:
   a. Hash password with Argon2id       — for auth (stored in users table)
   b. Generate DEK: crypto.randomBytes(32)
   c. Generate salt: crypto.randomBytes(32)
   d. Derive password key: Argon2id(password, salt)
   e. Wrap DEK: AES-256-GCM encrypt DEK with password key
   f. Encrypt sentinel: AES-256-GCM encrypt 'animus-key-ok' with DEK
   g. Generate JWT secret: crypto.randomBytes(32)
   h. Wrap JWT secret with password key
   i. Write vault.json: { version, kdf, kdfParams, wrappedDek, wrappedJwtSecret, sentinel }
   j. setSealState('unsealed', dek)
   k. Issue JWT session cookie
   l. Redirect to onboarding
```

### Migration from Legacy `.secrets` File

For existing installations upgrading to the new system:

```
1. Detect data/.secrets exists and no vault.json
2. Read legacy encryption key from .secrets
3. Prompt user to set a password (web UI migration screen)
4. Generate new random DEK
5. Re-encrypt all credentials:
   a. Decrypt all credentials with legacy key
   b. Re-encrypt all credentials with new DEK
6. Wrap DEK with password-derived key
7. Write vault.json
8. Rename .secrets to .secrets.migrated (keep as backup until user confirms)
9. Log migration complete
```

---

## Password Change

Password changes re-wrap the DEK without touching any encrypted credentials:

```
1. User submits { currentPassword, newPassword } via Settings UI
2. Verify current password:
   a. Derive current password key
   b. Unwrap DEK (should match the one already in memory)
3. Derive new password key from new password (new random salt)
4. Re-wrap DEK with new password key
5. Re-wrap JWT secret with new password key
6. Update vault.json with new wrappedDek, wrappedJwtSecret, salt, kdfParams
7. Update password hash in users table (Argon2id, separate salt)
```

This is an instant operation. Only the DEK wrapper changes. All credentials remain encrypted with the same DEK and need no re-encryption.

---

## First-Time Setup

The password for encryption is the same password used for web UI authentication. There is no separate "encryption password" to remember. The registration flow creates both the auth record and the vault in a single step.

### Registration Flow

1. User visits Animus for the first time
2. Registration page collects email and password
3. Password is used for two independent purposes:
   - **Authentication**: Argon2id hash stored in `users.password_hash` (with its own random salt, managed by the argon2 library)
   - **Encryption**: Argon2id derivation to wrap the DEK (with a separate random salt stored in `vault.json`)
4. These two derivations use different salts and produce different outputs. The auth hash and the encryption key derivation are independent.

### Password Requirements

The registration form enforces minimum password requirements. The strength of the encryption is directly proportional to password entropy, so the system should guide users toward strong passwords.

---

## Deployment Scenarios

### Desktop (Tauri App)

| Event | Password needed? |
|-------|-----------------|
| First launch after install | Yes (registration) |
| App opened (process was stopped) | Yes (lock screen) |
| Machine reboots | Yes (lock screen on next app open) |
| Machine sleeps / screen locks | No (process stays alive) |
| User away, messaging via Discord | No (process stays alive) |
| macOS update (no reboot) | No (process stays alive) |
| Process crash + auto-restart | Yes (lock screen) |

In practice, desktop users enter their password when they open the app. The app then runs for days or weeks without re-prompting, as long as the process stays alive.

### Docker

| Event | Password needed? |
|-------|-----------------|
| First `docker-compose up` | No (env var auto-unseals) |
| Container restart | No (Docker re-injects env var) |
| Container crash + restart policy | No (Docker re-injects env var) |
| Host machine reboot | No (restart policy + env var) |
| New image deployment | No (env var in compose file) |

Docker users never see a lock screen. The `ANIMUS_UNLOCK_PASSWORD` environment variable handles everything automatically.

### Headless Linux (systemd)

| Event | Password needed? |
|-------|-----------------|
| Service start | No (if `EnvironmentFile` configured) |
| Service restart | No (systemd re-reads env file) |
| Machine reboot | No (systemd restarts service with env) |
| No env file configured | Yes (curl to /unlock endpoint) |

### Development (npm run dev)

Dev mode uses file watching (tsx/nodemon), which restarts the server on code changes. The `ANIMUS_UNLOCK_PASSWORD` in the `.env` file (gitignored) provides the password on each restart. Developers never interact with a lock screen during development.

---

## Future: Device-Key Auto-Unseal

A planned convenience feature that allows the OS to remember the unlock password so desktop users don't need to type it on every app launch.

### Concept

Store a device-key-wrapped copy of the DEK in the OS keyring (macOS Keychain, Linux Keyring, Windows DPAPI). On app launch, attempt to retrieve the device key from the keyring. If available, auto-unseal without prompting for a password.

### macOS Integration

On macOS, this could integrate with Touch ID or the login keychain, allowing users to unlock Animus with a fingerprint instead of typing a password.

### Security Tradeoff

The device-key auto-unseal is explicitly a convenience feature that trades security for UX. Any process running as the same OS user can query the keyring. Users who enable this feature understand that:

- Filesystem-only attacks are still blocked (the key is in the keyring, not a file)
- Code execution attacks as the same user can access the keyring
- The password remains the primary security mechanism; the device key is an optional shortcut

This feature is opt-in and not part of the default configuration. Users who want maximum security keep password-only mode.

### Implementation Notes

This feature is not yet designed in detail. When implemented, it will be documented as a separate section in this document. Key considerations:

- Cross-platform keyring library selection (keytar alternatives, native bindings)
- Graceful fallback when keyring is unavailable
- Clear UI for enabling/disabling the feature
- Separate wrapped DEK copy (device-wrapped, stored in keyring) alongside the password-wrapped copy (in vault.json)

---

## Key Files Reference

### Vault & Encryption Core

| File | Purpose |
|------|---------|
| `packages/backend/src/lib/vault-manager.ts` | Sealed/unsealed state, DEK lifecycle, unlock flow |
| `packages/backend/src/lib/encryption-service.ts` | AES-256-GCM encrypt/decrypt, receives DEK from vault |
| `packages/backend/src/lib/secrets-manager.ts` | Legacy secrets resolution (migration support) |
| `packages/backend/src/utils/env.ts` | `DATA_DIR` resolution |
| `packages/backend/src/index.ts` | Startup flow: vault load, unseal attempt, database init |

### Unlock Endpoints

| File | Purpose |
|------|---------|
| `packages/backend/src/api/routers/vault.ts` | tRPC unlock endpoint (unauthenticated) |
| `packages/frontend/src/pages/UnlockPage.tsx` | Lock screen UI |

### File Deny List

| File | Purpose |
|------|---------|
| `packages/backend/src/heartbeat/mind-session.ts` | `canUseTool` callback with deny list |
| `packages/backend/src/tools/permission-seeder.ts` | Tool permission defaults |

### Related Architecture Docs

| Document | Relationship |
|----------|-------------|
| `docs/architecture/credential-passing.md` | How credentials are stored, injected, and masked (agent-blind pattern). References this doc for key management. |
| `docs/architecture/data-directory.md` | Data directory layout including `vault.json`. References this doc for secrets lifecycle. |
| `docs/architecture/tool-permissions.md` | Tool permission system that enforces the file deny list. |
| `docs/architecture/backend-architecture.md` | Subsystem lifecycle patterns (VaultManager implements `SubsystemLifecycle`). |
