# SDK Lifecycle Refactor: Moving SDK Management into the Agents Package

> STATUS: Planned. Implementation guide for consolidating SDK binary detection, installation, and authentication into `@animus-labs/agents`.

## Problem Statement

SDK lifecycle management (binary detection, installation, authentication, status checking) is currently spread across the backend:

| Concern | Current Location | Issue |
|---------|-----------------|-------|
| Binary path resolution | `backend/lib/cli-paths.ts` | Duplicated in `agents/adapters/codex-app-server.ts` |
| SDK installation | `backend/services/sdk-manager.ts` | SDK-specific logic doesn't belong in HTTP server |
| Claude OAuth flow | `backend/services/claude-oauth.ts` | Spawns binaries directly, bypassing agents package |
| Codex CLI auth flow | `backend/services/codex-cli-auth.ts` | Same issue |
| Codex device code flow | `backend/services/codex-oauth.ts` | Contains token refresh + session prep |
| Auth detection | `backend/services/credential-service.ts` | Spawns binaries, mixes DB and CLI concerns |
| Session env building | `backend/heartbeat/mind-session.ts` | Provider-specific auth prep logic |

This causes:
- **Testing difficulty**: The backend falls back to system-installed binaries via `which`/`where`, making it impossible to tell if our own bundled SDK works correctly
- **Leaky abstraction**: The backend reaches around the agents package to interact with SDK binaries directly
- **Provider coupling**: Adding a new provider requires changes to `credential-service.ts`, `cli-paths.ts`, `mind-session.ts`, and a new auth service

## Target Architecture

The agents package becomes the single owner of SDK lifecycle. The backend provides credential persistence (DB) and HTTP transport (tRPC) as thin wrappers.

```
┌─────────────────────────────────────────────────────────────┐
│  Backend (thin orchestration)                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ tRPC Routers │  │ Credential   │  │ mind-session.ts  │  │
│  │ (sdk, auth)  │  │ DB Store     │  │ (env merge only) │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                 │                    │            │
│         │    callbacks    │   CredentialStore   │            │
│         ▼        ▼        ▼        interface    ▼            │
├─────────────────────────────────────────────────────────────┤
│  @animus-labs/agents                                        │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  AgentManager                                         │  │
│  │  ├── SdkManager (install, status, binary resolution)  │  │
│  │  ├── ClaudeAdapter                                    │  │
│  │  │   ├── loadSDK()                                    │  │
│  │  │   ├── installNativeBinary()                        │  │
│  │  │   ├── initiateAuth() / logout()                    │  │
│  │  │   ├── getAuthStatus()                              │  │
│  │  │   ├── isConfigured() / isSdkInstalled()            │  │
│  │  │   └── createSession()                              │  │
│  │  ├── CodexAdapter                                     │  │
│  │  │   ├── resolveCodexBinary()                         │  │
│  │  │   ├── initiateAuth() / logout()                    │  │
│  │  │   ├── getAuthStatus()                              │  │
│  │  │   ├── isConfigured() / isSdkInstalled()            │  │
│  │  │   └── createSession()                              │  │
│  │  └── OpenCodeAdapter                                  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Design Principles

1. **No system binary fallbacks.** Never use `which`/`where`. Only use binaries we installed ourselves.
2. **Adapters own their SDK lifecycle.** Each adapter knows how to install, find, authenticate, and spawn its own SDK.
3. **Backend provides persistence, not logic.** Credential storage, env var loading, and tRPC transport stay in backend.
4. **Callback injection, not module imports.** The agents package never imports `better-sqlite3` or backend modules. DB operations are injected via typed callback interfaces.

## New Interface: `IAgentAdapter` Extensions

```typescript
// Added to IAgentAdapter (packages/agents/src/types.ts)
interface IAgentAdapter {
  // Existing
  readonly provider: AgentProvider;
  readonly capabilities: AdapterCapabilities;
  isConfigured(): boolean;
  createSession(config: AgentSessionConfig): Promise<IAgentSession>;
  resumeSession(sessionId: string): Promise<IAgentSession>;
  listModels(): Promise<ModelInfo[]>;

  // New: SDK lifecycle
  isSdkInstalled(): boolean;
  installSdk(options?: { version?: string; onProgress?: (event: SdkProgressEvent) => void }): Promise<void>;
  getAuthStatus(): Promise<ProviderAuthStatus>;
  initiateAuth(callbacks: AuthCallbacks): AuthSession;
  logout(callbacks: AuthCallbacks): Promise<boolean>;

  // New: session preparation (replaces provider-specific logic in mind-session.ts)
  prepareSessionEnv(baseEnv: Record<string, string>): Promise<Record<string, string>>;
}
```

## Callback Interfaces

These allow the agents package to trigger backend-side persistence without importing backend modules:

```typescript
// Injected into adapters at construction time via AdapterOptions
interface AuthCallbacks {
  onAuthSuccess(provider: AgentProvider): void;   // Backend: saveCliDetected(db, provider)
  onAuthFailure(provider: AgentProvider, error: string): void;
  onLogout(provider: AgentProvider): void;         // Backend: removeCredential(db, provider, 'cli_detected')
}

interface CredentialStore {
  getCredential(provider: string, type: string): { data: string; metadata?: Record<string, unknown> } | null;
  saveCredential(provider: string, type: string, data: string, metadata?: Record<string, unknown>): void;
  removeCredential(provider: string, type: string): void;
  getCredentialMetadata(provider: string): Array<{ credentialType: string }>;
}
```

## Implementation Phases

### Phase 1: Binary Resolution Consolidation

**Goal:** Single source of truth for binary paths, no system fallbacks.

**Move to agents package:**
- `cli-paths.ts` logic into a new `packages/agents/src/lib/binary-resolver.ts`
- Remove `which`/`where` fallbacks entirely
- Remove well-known system paths (`/usr/local/bin`, `/opt/homebrew/bin`, `%APPDATA%\npm`)
- Each adapter gets a `resolveBinaryPaths()` method

**Changes:**
1. Create `packages/agents/src/lib/binary-resolver.ts` with parameterized `dataDir` (no `DATA_DIR` import)
2. `ClaudeAdapter` constructor receives `dataDir` and resolves:
   - SDK `cli.js`: `node_modules/@anthropic-ai/claude-agent-sdk/cli.js` or `dataDir/sdks/claude/node_modules/...`
   - Native binary: `dataDir/sdks/claude/claude/versions/*/claude` (installed by `cli.js install`)
3. `CodexAdapter` keeps existing `resolveCodexBinary()` in `codex-app-server.ts` (already self-contained, already in agents package), but removes the `which`/`where` fallback
4. Remove `backend/lib/cli-paths.ts` entirely
5. Backend callers that need binary info call `agentManager.getAdapter('claude').isSdkInstalled()` instead

**Backend changes:**
- `credential-service.ts`: Replace `checkSdkAvailable()` calls with `agentManager.getAdapter(provider).isSdkInstalled()`
- `agent-subsystem.ts`: Pass `dataDir` into `createAgentManager()` config

**Files to create:**
- `packages/agents/src/lib/binary-resolver.ts`

**Files to modify:**
- `packages/agents/src/types.ts` (add `isSdkInstalled()` to interface)
- `packages/agents/src/adapters/claude.ts` (integrate binary resolution)
- `packages/agents/src/adapters/codex-app-server.ts` (remove `which`/`where` fallback)
- `packages/agents/src/manager.ts` (pass `dataDir` to adapters)
- `packages/backend/src/services/credential-service.ts` (use adapter methods)
- `packages/backend/src/heartbeat/agent-subsystem.ts` (pass `dataDir`)

**Files to delete:**
- `packages/backend/src/lib/cli-paths.ts`

### Phase 2: SDK Installation in Agents Package

**Goal:** `SdkManager` logic moves into the agents package. The backend becomes a thin tRPC wrapper.

**Move to agents package:**
- `sdk-manager.ts` core logic (install, status, npm resolution)
- `sdk-constants.ts` (target version)

**New structure:**
```
packages/agents/src/
  sdk/
    sdk-manager.ts        # Install logic, no event bus dependency
    sdk-constants.ts      # Version constants
```

**Key change:** Replace `getEventBus().emit('sdk:install_progress', ...)` with an `onProgress` callback parameter:

```typescript
// Before (backend)
await getSdkManager().install(version);  // emits events via event bus

// After (agents)
await agentManager.installSdk('claude', {
  version,
  onProgress: (event) => getEventBus().emit('sdk:install_progress', event)
});
```

**Files to create:**
- `packages/agents/src/sdk/sdk-manager.ts`
- `packages/agents/src/sdk/sdk-constants.ts`

**Files to modify:**
- `packages/agents/src/manager.ts` (add `installSdk()` method)
- `packages/backend/src/api/routers/sdk.ts` (call `agentManager.installSdk()`)

**Files to delete:**
- `packages/backend/src/services/sdk-manager.ts`
- `packages/backend/src/lib/sdk-constants.ts`

### Phase 3: Auth Flows in Adapters

**Goal:** Each adapter owns its authentication flow. Backend provides persistence callbacks.

**Move to agents package:**
- `claude-oauth.ts` spawning and session management logic into `ClaudeAdapter`
- `codex-cli-auth.ts` spawning and session management logic into `CodexAdapter`
- `codex-oauth.ts` device code flow, token refresh, and session auth prep into `CodexAdapter`
- `ensureClaudeOnboardingFile()` from credential-service into Claude adapter

**New adapter methods:**

```typescript
// ClaudeAdapter
initiateAuth(callbacks: AuthCallbacks): AuthSession
// Spawns: node cli.js install (if needed), then native-binary auth login
// On success: calls callbacks.onAuthSuccess('claude')
// Returns session for status/cancel

getAuthStatus(): Promise<ProviderAuthStatus>
// Spawns: native-binary auth status --json
// Returns structured auth info

logout(callbacks: AuthCallbacks): Promise<boolean>
// Spawns: native-binary auth logout
// Calls callbacks.onLogout('claude')

prepareSessionEnv(baseEnv): Promise<Record<string, string>>
// Returns env with Claude-specific config (skill bridge handled elsewhere)

// CodexAdapter
initiateAuth(callbacks: AuthCallbacks): AuthSession
// Spawns: codex login (CLI auth path)

initiateDeviceCodeAuth(store: CredentialStore): DeviceCodeSession
// Runs device code flow against OpenAI auth endpoint (OAuth path)

prepareSessionEnv(baseEnv): Promise<Record<string, string>>
// Handles auth.json preparation:
//   - OAuth users: decrypt tokens from store, refresh if needed, write auth.json
//   - CLI users: copy ~/.codex/auth.json to session CODEX_HOME
```

**Backend becomes thin wrappers:**

```typescript
// claude-auth.ts router
initiate: protectedProcedure.mutation(({ ctx }) => {
  const adapter = agentManager.getAdapter('claude') as ClaudeAdapter;
  return adapter.initiateAuth({
    onAuthSuccess: (provider) => saveCliDetected(ctx.db, provider),
    onLogout: (provider) => removeCredential(ctx.db, provider, 'cli_detected'),
  });
}),
```

**mind-session.ts simplification:**

```typescript
// Before: provider-specific logic inline
if (provider === 'codex') {
  sessionEnv = await pluginMgr.buildCodexRuntimeEnv();
  if (process.env.CODEX_OAUTH_CONFIGURED) {
    sessionEnv = await prepareCodexSessionAuth(getSystemDb(), sessionEnv.CODEX_HOME);
  } else if (process.env.CODEX_CLI_CONFIGURED) {
    await copyCodexCliAuth(sessionEnv.CODEX_HOME);
  }
}

// After: adapter handles its own env prep
const adapter = agentManager.getAdapter(provider);
sessionEnv = await adapter.prepareSessionEnv(baseSessionEnv);
```

**Files to create:**
- `packages/agents/src/auth/auth-session.ts` (shared auth session management)
- `packages/agents/src/auth/types.ts` (AuthCallbacks, CredentialStore, AuthSession interfaces)

**Files to modify:**
- `packages/agents/src/types.ts` (add lifecycle methods to IAgentAdapter)
- `packages/agents/src/adapters/claude.ts` (add auth methods)
- `packages/agents/src/adapters/codex.ts` (add auth methods, session env prep)
- `packages/agents/src/manager.ts` (expose auth via manager)
- `packages/backend/src/api/routers/claude-auth.ts` (thin wrapper)
- `packages/backend/src/api/routers/codex-cli-auth.ts` (thin wrapper)
- `packages/backend/src/api/routers/codex-auth.ts` (thin wrapper)
- `packages/backend/src/services/credential-service.ts` (remove CLI spawning, keep DB ops)
- `packages/backend/src/heartbeat/mind-session.ts` (use adapter.prepareSessionEnv())

**Files to delete:**
- `packages/backend/src/services/claude-oauth.ts`
- `packages/backend/src/services/codex-cli-auth.ts`
- `packages/backend/src/services/codex-oauth.ts` (most of it; token refresh may stay as a utility)

### Phase 4: Auth Detection Consolidation

**Goal:** `detectProviderAuth()` moves to agents, with DB cleanup via callbacks.

**Move:**
- The CLI interrogation logic from `credential-service.ts`'s `detectClaudeAuth()` and `detectCodexAuth()` into each adapter's `getAuthStatus()` method
- `validateCredential()` (API key validation via network) into agents
- `inferCredentialType()` into agents
- `ensureClaudeOnboardingFile()` into Claude adapter

**Keep in backend:**
- `loadCredentialsIntoEnv()` (startup bootstrap, needs vault check)
- `saveCredential()` / `removeCredential()` (DB writes)
- `saveCliDetected()` (DB write + env var set)
- The ENV_MAP constant and env-var-setting side effects

**credential-service.ts becomes:**
- DB CRUD operations only
- Calls `adapter.getAuthStatus()` for live auth detection instead of spawning binaries itself
- No more `cli-paths.ts` imports

## Migration Strategy

- Phases can be implemented incrementally
- Each phase should have its own PR with full test coverage
- Phase 1 is the prerequisite; Phases 2-4 can potentially be parallelized
- All existing tests must be migrated alongside the code
- Backend tests that mock `cli-paths.ts` become agents package tests

## Risk Mitigation

- **Circular dependency risk**: The agents package must never import from backend. All backend dependencies flow in via constructor injection (callbacks, stores, config objects).
- **Process.env coupling**: The sentinel env vars (`CLAUDE_CLI_CONFIGURED`, etc.) are set by backend and read by adapters. This implicit contract continues to work as long as both packages run in the same Node.js process. Document it explicitly.
- **Windows spawning**: All `spawn`/`execFile` calls for `.cmd` files must use `shell: true` on Windows. This is handled in the agents package centrally, not scattered across backend services.

## Outcome

After all phases:
- `packages/agents/` is a self-contained SDK lifecycle manager
- `packages/backend/` has zero `spawn`/`execFile` calls for SDK binaries
- Binary resolution never touches system paths
- Adding a new provider means implementing one adapter class
- Testing is reliable because we control all binary paths
