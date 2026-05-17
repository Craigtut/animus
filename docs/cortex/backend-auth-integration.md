# Backend Auth Integration

> **STATUS: IMPLEMENTED** - `CortexCredentialService` and `cortex-provider.ts` tRPC router are live.
>
> **Note:** This is an Animus-specific integration doc. Cortex framework documentation (architecture, tools, compaction, skills, providers) lives in the [cortex-mono](https://github.com/Craigtut/cortex-mono) repository.

How the Animus backend integrates with Cortex's `ProviderManager` and `CortexAgent` for authentication, credential management, and provider configuration. The backend owns all credential storage, encryption, and tRPC API surface. It never imports `@mariozechner/pi-ai` directly.

## Architecture Overview

```
Frontend (tRPC client)
    │
    ▼
cortex-provider.ts router (tRPC)
    │
    ├─── CortexCredentialService
    │       ├── EncryptionService (AES-256-GCM)
    │       ├── CredentialStore (system.db)
    │       └── ProviderManager (from @animus-labs/cortex)
    │
    └─── Agent Subsystem
            ├── CortexAgent (from @animus-labs/cortex)
            └── getApiKey callback (wires credential service to agent)
```

The backend imports two things from `@animus-labs/cortex`: `ProviderManager` and `CortexAgent`. Everything else (encryption, storage, API routing, onboarding state) is Animus-specific.

## Credential Storage

### Database Schema

Cortex provider credentials are stored in the existing `credentials` table in `system.db`. The current schema already supports the needed structure:

```sql
CREATE TABLE credentials (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  provider TEXT NOT NULL,
  credential_type TEXT NOT NULL,
  encrypted_data TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

**Column usage for Cortex credentials:**

| Column | Value | Notes |
|--------|-------|-------|
| `provider` | Pi-ai provider ID (e.g., `'anthropic'`, `'openai'`, `'github-copilot'`) | Cortex provider selected by onboarding or Settings |
| `credential_type` | `'cortex_api_key'`, `'cortex_oauth'`, `'cortex_custom'` | Prefixed with `cortex_` for unambiguous queries |
| `encrypted_data` | AES-256-GCM ciphertext (`{iv}:{ciphertext}:{authTag}`) | For API keys: the raw key. For OAuth: the serialized credential blob from ProviderManager. For custom: the optional API key. |
| `metadata` | JSON string | For OAuth: `OAuthMeta` from ProviderManager (displayName, expiresAt, refreshable). For custom: endpoint config (baseUrl, modelId, compat). |

**Why prefix with `cortex_`:** Older databases may still contain retired subprocess SDK credential rows. The backend no longer loads those rows into `process.env` or treats them as configured providers, so active provider credentials are selected by the `cortex_` prefix.

### Migration

```sql
-- system/0XX_cortex_settings.sql

-- Add Cortex provider settings to system_settings
ALTER TABLE system_settings ADD COLUMN cortex_provider TEXT DEFAULT NULL;
ALTER TABLE system_settings ADD COLUMN cortex_model TEXT DEFAULT NULL;
ALTER TABLE system_settings ADD COLUMN cortex_thinking_level TEXT DEFAULT 'off';
```

`cortex_provider` and `cortex_model` default to `NULL`, meaning no Cortex provider is configured. The onboarding flow sets these when the user authenticates.

No migration is needed for the `credentials` table itself; the new `cortex_*` credential types are just new values in the existing `credential_type` column.

## Types

### ProviderStatus

```typescript
interface ProviderStatus {
  connected: boolean;
  method: 'oauth' | 'api_key' | 'custom' | 'env_var' | null;
  meta: OAuthMeta | null;
}
```

### OAuthStatusEvent

Discriminated union for the `oauthStatus` tRPC subscription:

```typescript
type OAuthStatusEvent =
  | { type: 'auth_url'; url: string; instructions?: string; deviceCode?: string }
  | { type: 'progress'; message: string }
  | { type: 'prompt'; message: string }
  | { type: 'success'; meta: OAuthMeta }
  | { type: 'error'; message: string };
```

## CortexCredentialService

New service: `packages/backend/src/services/cortex-credential-service.ts`

This service mediates between the tRPC router, the credential store, the encryption service, and Cortex's ProviderManager. It is the single point of contact for all Cortex credential operations.

```typescript
import {
  ProviderManager,
  type OAuthCallbacks,
  type OAuthResult,
  type OAuthMeta,
  type CortexModel,
  type CustomModelConfig,
} from '@animus-labs/cortex';

class CortexCredentialService {
  private providerManager: ProviderManager;

  constructor(
    private credentialStore: typeof credentialStore,
    private encryptionService: EncryptionService,
    private db: Database,
  ) {
    this.providerManager = new ProviderManager();
  }

  // ── Provider Manager Delegation ──
  // These methods delegate directly to ProviderManager.
  // The router calls these; they don't involve credentials.

  listProviders() {
    return this.providerManager.listProviders();
  }

  listOAuthProviders() {
    return this.providerManager.listOAuthProviders();
  }

  listModels(provider: string) {
    return this.providerManager.listModels(provider);
  }

  resolveModel(provider: string, modelId: string): CortexModel {
    return this.providerManager.resolveModel(provider, modelId);
  }

  createCustomModel(config: CustomModelConfig): CortexModel {
    return this.providerManager.createCustomModel(config);
  }

  // ── OAuth ──

  async initiateOAuth(provider: string, callbacks: OAuthCallbacks): Promise<OAuthMeta> {
    const result = await this.providerManager.initiateOAuth(provider, callbacks);

    // Encrypt and store the credential blob
    const encrypted = this.encryptionService.encrypt(result.credentials);
    this.credentialStore.upsertCredential(this.db, {
      provider,
      credential_type: 'cortex_oauth',
      encrypted_data: encrypted,
      metadata: JSON.stringify(result.meta),
    });

    return result.meta;
  }

  cancelOAuth(): void {
    this.providerManager.cancelOAuth();
  }

  // ── API Key ──

  async saveApiKey(provider: string, apiKey: string): Promise<void> {
    const encrypted = this.encryptionService.encrypt(apiKey);
    this.credentialStore.upsertCredential(this.db, {
      provider,
      credential_type: 'cortex_api_key',
      encrypted_data: encrypted,
      metadata: null,
    });
  }

  async validateApiKey(provider: string, apiKey: string): Promise<boolean> {
    return this.providerManager.validateApiKey(provider, apiKey);
  }

  // ── Custom Endpoint ──

  async saveCustomEndpoint(config: CustomModelConfig): Promise<void> {
    const encrypted = this.encryptionService.encrypt(config.apiKey ?? '');
    this.credentialStore.upsertCredential(this.db, {
      provider: 'custom',
      credential_type: 'cortex_custom',
      encrypted_data: encrypted,
      metadata: JSON.stringify({
        baseUrl: config.baseUrl,
        modelId: config.modelId,
        contextWindow: config.contextWindow,
        compat: config.compat,
      }),
    });
  }

  // ── Credential Removal ──

  removeCredential(provider: string): void {
    this.credentialStore.deleteByProviderAndType(this.db, provider, 'cortex_api_key');
    this.credentialStore.deleteByProviderAndType(this.db, provider, 'cortex_oauth');
    if (provider === 'custom') {
      this.credentialStore.deleteByProviderAndType(this.db, 'custom', 'cortex_custom');
    }
  }

  // ── Status ──

  getProviderStatus(provider: string): ProviderStatus {
    const credential = this.credentialStore.getByProviderPrefix(this.db, provider, 'cortex_');
    if (!credential) {
      // Check environment variables as fallback
      const envKey = this.providerManager.checkEnvApiKey(provider);
      if (envKey) {
        return { connected: true, method: 'env_var', meta: null };
      }
      return { connected: false, method: null, meta: null };
    }

    const meta = credential.metadata ? JSON.parse(credential.metadata) as OAuthMeta : null;

    return {
      connected: true,
      method: credential.credential_type === 'cortex_oauth' ? 'oauth'
            : credential.credential_type === 'cortex_custom' ? 'custom'
            : 'api_key',
      meta,
    };
  }

  // ── The getApiKey Callback ──
  // This is the callback passed to CortexAgent.
  // It is called by pi-agent-core before every LLM call.

  async resolveApiKey(provider: string): Promise<string> {
    // 1. Try stored credentials
    const credential = this.credentialStore.getByProviderPrefix(this.db, provider, 'cortex_');

    if (credential) {
      const decrypted = this.encryptionService.decrypt(credential.encrypted_data);

      if (credential.credential_type === 'cortex_api_key') {
        return decrypted;
      }

      if (credential.credential_type === 'cortex_oauth') {
        const result = await this.providerManager.resolveOAuthApiKey(provider, decrypted);

        if (result.changed) {
          // Persist refreshed credentials
          const reEncrypted = this.encryptionService.encrypt(result.credentials);
          this.credentialStore.updateCredentialData(
            this.db,
            credential.id,
            reEncrypted,
            JSON.stringify(result.meta),
          );
        }

        return result.apiKey;
      }

      if (credential.credential_type === 'cortex_custom') {
        // Custom endpoints may not need a key; return empty or stored key
        return decrypted || '';
      }
    }

    // 2. Fallback to environment variables
    const envKey = this.providerManager.checkEnvApiKey(provider);
    if (envKey) return envKey;

    throw new Error(`No credentials configured for provider "${provider}"`);
  }
}
```

### Singleton Pattern

Following the existing backend convention (see `ContactService`, `TaskService`):

```typescript
let instance: CortexCredentialService | null = null;

export function getCortexCredentialService(): CortexCredentialService {
  if (!instance) {
    instance = new CortexCredentialService(
      credentialStore,
      getEncryptionService(),
      getSystemDb(),
    );
  }
  return instance;
}
```

## tRPC Router

New router: `packages/backend/src/api/routers/cortex-provider.ts`

```typescript
export const cortexProviderRouter = router({
  // ── Discovery ──

  listProviders: publicProcedure.query(({ ctx }) => {
    return getCortexCredentialService().listProviders();
  }),

  listModels: publicProcedure
    .input(z.object({ provider: z.string() }))
    .query(({ input }) => {
      return getCortexCredentialService().listModels(input.provider);
    }),

  // ── Status ──

  getStatus: publicProcedure.query(({ ctx }) => {
    const settings = settingsStore.getSystemSettings(getSystemDb());
    const status = settings.cortex_provider
      ? getCortexCredentialService().getProviderStatus(settings.cortex_provider)
      : { connected: false, method: null, meta: null };

    return {
      provider: settings.cortex_provider,
      model: settings.cortex_model,
      thinkingLevel: settings.cortex_thinking_level,
      ...status,
    };
  }),

  // ── OAuth ──

  initiateOAuth: publicProcedure
    .input(z.object({
      provider: z.string(),
    }))
    .mutation(async ({ input }) => {
      // OAuth callbacks are handled via the subscription below.
      // This mutation starts the flow and returns when complete.
      // For the real implementation, this will need to coordinate
      // with the oauthStatus subscription via an EventEmitter pattern
      // similar to the existing claude-auth.ts router.
    }),

  oauthStatus: publicProcedure.subscription(() => {
    return observable<OAuthStatusEvent>((emit) => {
      // Emit progress events during OAuth flow:
      // { type: 'auth_url', url, instructions? }
      // { type: 'progress', message }
      // { type: 'prompt', message }  (requires response via oauthRespond)
      // { type: 'success', meta }
      // { type: 'error', message }
    });
  }),

  oauthRespond: publicProcedure
    .input(z.object({ response: z.string() }))
    .mutation(({ input }) => {
      // Resolve the pending onPrompt callback with the user's response
    }),

  cancelOAuth: publicProcedure.mutation(() => {
    getCortexCredentialService().cancelOAuth();
  }),

  // ── API Key ──

  saveApiKey: publicProcedure
    .input(z.object({
      provider: z.string(),
      apiKey: z.string(),
    }))
    .mutation(async ({ input }) => {
      await getCortexCredentialService().saveApiKey(input.provider, input.apiKey);
    }),

  validateApiKey: publicProcedure
    .input(z.object({
      provider: z.string(),
      apiKey: z.string(),
    }))
    .mutation(async ({ input }) => {
      return getCortexCredentialService().validateApiKey(input.provider, input.apiKey);
    }),

  // ── Custom Endpoint ──

  saveCustomEndpoint: publicProcedure
    .input(z.object({
      baseUrl: z.string().url(),
      modelId: z.string(),
      contextWindow: z.number().optional(),
      apiKey: z.string().optional(),
      compat: z.object({
        supportsDeveloperRole: z.boolean().optional(),
        supportsReasoningEffort: z.boolean().optional(),
      }).optional(),
    }))
    .mutation(async ({ input }) => {
      await getCortexCredentialService().saveCustomEndpoint(input);
    }),

  testCustomEndpoint: publicProcedure
    .input(z.object({
      baseUrl: z.string().url(),
      modelId: z.string(),
      apiKey: z.string().optional(),
      compat: z.object({
        supportsDeveloperRole: z.boolean().optional(),
        supportsReasoningEffort: z.boolean().optional(),
      }).optional(),
    }))
    .mutation(async ({ input }) => {
      // Creates a temporary custom model via ProviderManager and
      // makes a minimal LLM call to verify connectivity.
      // Does NOT save credentials; that's a separate step.
      const svc = getCortexCredentialService();
      const model = svc.createCustomModel(input);
      // Use the underlying pi-ai complete with maxTokens: 1
      // via a dedicated testModel() method on ProviderManager
      return svc.testCustomModel(model, input.apiKey);
    }),

  // ── Provider/Model Selection ──

  setActiveProvider: publicProcedure
    .input(z.object({
      provider: z.string(),
      model: z.string(),
    }))
    .mutation(async ({ input }) => {
      const svc = getCortexCredentialService();

      // Verify credentials exist for this provider
      const status = svc.getProviderStatus(input.provider);
      if (!status.connected) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `No credentials configured for ${input.provider}`,
        });
      }

      // Update settings
      settingsStore.updateSystemSettings(getSystemDb(), {
        cortex_provider: input.provider,
        cortex_model: input.model,
      });

      // Notify agent subsystem to switch model
      eventBus.emit('cortex:provider-changed', {
        provider: input.provider,
        model: input.model,
      });
    }),

  setThinkingLevel: publicProcedure
    .input(z.object({
      level: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']),
    }))
    .mutation(({ input }) => {
      settingsStore.updateSystemSettings(getSystemDb(), {
        cortex_thinking_level: input.level,
      });

      eventBus.emit('cortex:thinking-level-changed', {
        level: input.level,
      });
    }),

  // ── Credential Management ──

  removeCredential: publicProcedure
    .input(z.object({ provider: z.string() }))
    .mutation(({ input }) => {
      getCortexCredentialService().removeCredential(input.provider);

      // If removing the active provider, clear settings
      const settings = settingsStore.getSystemSettings(getSystemDb());
      if (settings.cortex_provider === input.provider) {
        settingsStore.updateSystemSettings(getSystemDb(), {
          cortex_provider: null,
          cortex_model: null,
        });
        eventBus.emit('cortex:provider-removed');
      }
    }),

  // ── All Configured Providers ──

  listConfiguredProviders: publicProcedure.query(() => {
    const svc = getCortexCredentialService();
    const providers = svc.listProviders();

    return providers.map((p) => ({
      ...p,
      status: svc.getProviderStatus(p.id),
    }));
  }),
});
```

### Router Registration

Add to the main app router in `packages/backend/src/api/routers/index.ts`:

```typescript
import { cortexProviderRouter } from './cortex-provider.js';

export const appRouter = router({
  // ... existing routers
  cortexProvider: cortexProviderRouter,
});
```

## Wiring to CortexAgent

In the agent subsystem (where the CortexAgent is created during heartbeat startup):

```typescript
// packages/backend/src/heartbeat/agent-subsystem.ts

import { CortexAgent, ProviderManager } from '@animus-labs/cortex';

function createCortexAgent(settings: SystemSettings): CortexAgent {
  const credService = getCortexCredentialService();

  // Resolve model from settings
  let model: CortexModel;
  if (settings.cortex_provider === 'custom') {
    const meta = getCustomEndpointMeta();
    model = credService.createCustomModel(meta);
  } else {
    model = credService.resolveModel(settings.cortex_provider, settings.cortex_model);
  }

  // Create agent with getApiKey callback
  const agent = await CortexAgent.create({
    model,
    getApiKey: (provider) => credService.resolveApiKey(provider),
    // ... tools, budgetGuards, etc.
  });

  // Listen for provider changes from settings UI
  eventBus.on('cortex:provider-changed', ({ provider, model: modelId }) => {
    const newModel = credService.resolveModel(provider, modelId);
    agent.setModel(newModel);
  });

  eventBus.on('cortex:thinking-level-changed', ({ level }) => {
    agent.setThinkingLevel(level);
  });

  return agent;
}
```

### Environment Variable Fallback

For technical users running the project locally, environment variables continue to work as a zero-config option. The `resolveApiKey` callback in `CortexCredentialService` checks env vars as a fallback after the credential store. This means a user can set `ANTHROPIC_API_KEY` in their `.env` file and skip the onboarding auth step entirely.

The onboarding flow should detect this: if `resolveApiKey` succeeds for a provider without stored credentials, the provider is marked as "connected via environment variable" in the UI. The user can still go through the full auth flow to store credentials explicitly.

### No Startup Credential Loading

Cortex does not load stored provider credentials into `process.env` at startup. Pi-agent-core's `getApiKey` callback provides credentials dynamically per call, so `CortexCredentialService.resolveApiKey()` decrypts or refreshes credentials on demand. This is more secure, keeps stored credentials scoped to the active request, and supports OAuth token refresh without restarting the process.

The old `loadCredentialsIntoEnv()` path has been removed from the backend startup and unlock flows.

### Vault Sealed State

The `CortexCredentialService` depends on the `EncryptionService`, which requires the vault to be unsealed (DEK available). If the vault is sealed:

- `resolveApiKey` will throw when trying to decrypt. The heartbeat should not tick until the vault is unsealed.
- `saveApiKey` and `initiateOAuth` will throw when trying to encrypt. The onboarding/settings UI should check vault status before offering auth flows.
- `getProviderStatus` does not decrypt, so it works regardless of vault state. It reads the `metadata` column (plaintext JSON) to report connection status.
- `checkEnvApiKey` also works regardless of vault state since it reads environment variables directly.

The heartbeat waits for the vault to be unsealed before running full Cortex mind ticks that require stored credentials.

## OAuth Flow Coordination

The OAuth flow involves asynchronous coordination between the tRPC router (which the frontend calls) and the ProviderManager (which drives the OAuth login). An EventEmitter bridges async login callbacks to tRPC subscriptions.

### Flow Sequence

```
Frontend                    Backend Router              CortexCredentialService    ProviderManager
   │                            │                              │                        │
   │ initiateOAuth('anthropic') │                              │                        │
   │ ──────────────────────────>│                              │                        │
   │                            │ initiateOAuth('anthropic',   │                        │
   │                            │   callbacks)                 │                        │
   │                            │ ────────────────────────────>│                        │
   │                            │                              │ initiateOAuth(         │
   │                            │                              │   'anthropic',         │
   │                            │                              │   callbacks)           │
   │                            │                              │ ──────────────────────>│
   │                            │                              │                        │
   │                            │                              │     onAuth(url)        │
   │                            │                              │ <──────────────────────│
   │                            │       emit('auth_url', url)  │                        │
   │                            │ <────────────────────────────│                        │
   │  oauthStatus: auth_url     │                              │                        │
   │ <──────────────────────────│                              │                        │
   │                            │                              │                        │
   │  (user completes browser   │                              │                        │
   │   auth flow)               │                              │                        │
   │                            │                              │                        │
   │                            │                              │  credentials returned  │
   │                            │                              │ <──────────────────────│
   │                            │                              │                        │
   │                            │  (encrypt + store + return   │                        │
   │                            │   meta)                      │                        │
   │                            │ <────────────────────────────│                        │
   │  oauthStatus: success      │                              │                        │
   │ <──────────────────────────│                              │                        │
```

### Headless / Docker Detection

When the backend is running without a display server (headless), the OAuth flow's `onAuth` callback cannot open a browser automatically. Instead, the URL and instructions are sent to the frontend via the subscription, and the frontend displays them for the user to visit on another device.

Detection uses environment heuristics:

```typescript
function isHeadless(): boolean {
  // Docker detection
  if (process.env.DOCKER === '1' || existsSync('/.dockerenv')) return true;
  // No display on Linux
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return true;
  // SSH session
  if (process.env.SSH_CLIENT || process.env.SSH_TTY) return true;
  return false;
}
```

In headless mode, the `onAuth` callback emits the URL to the frontend rather than calling `open()`. The frontend adapts its UI accordingly (see `frontend-auth-ux.md`).

## System Settings Schema

The following columns are added to `system_settings`:

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `cortex_provider` | TEXT | NULL | Active Cortex provider ID (e.g., `'anthropic'`, `'openai'`) |
| `cortex_model` | TEXT | NULL | Active model ID (e.g., `'claude-sonnet-4-20250514'`) |
| `cortex_thinking_level` | TEXT | `'off'` | Thinking/reasoning level for the active model |

These are the active provider settings for the mind and Cortex sub-agents.

## Credential Store Additions

The existing `credential-store.ts` may need minor additions for Cortex-specific queries:

```typescript
// Lookup by provider and credential_type prefix
getByProviderPrefix(db: Database, provider: string, prefix: string): CredentialRow | null;

// Upsert: insert or update by provider + credential_type
upsertCredential(db: Database, credential: NewCredential): void;

// Update encrypted data and metadata for an existing credential
updateCredentialData(db: Database, id: string, encryptedData: string, metadata?: string): void;

// Delete by provider and credential_type
deleteByProviderAndType(db: Database, provider: string, credentialType: string): void;
```

These follow the existing store patterns (stateless functions, `db` as first arg, no business logic).

## Event Bus Events

New events emitted by the backend for Cortex provider changes:

| Event | Payload | Emitter | Listener |
|-------|---------|---------|----------|
| `cortex:provider-changed` | `{ provider: string, model: string }` | `cortex-provider.ts` router | Agent subsystem (calls `agent.setModel()`) |
| `cortex:thinking-level-changed` | `{ level: string }` | `cortex-provider.ts` router | Agent subsystem (calls `agent.setThinkingLevel()`) |
| `cortex:provider-removed` | `{}` | `cortex-provider.ts` router | Agent subsystem (pauses heartbeat) |

## Implementation Sequence

This work can be broken into phases that align with the broader Cortex migration:

### Phase 0: Backend Infrastructure (Before Cortex Package Exists)

These items can land on the current codebase:

1. **Migration**: Add `cortex_provider`, `cortex_model`, `cortex_thinking_level` to `system_settings`
2. **Settings store**: Add getters/setters for the new columns
3. **Credential store**: Add `upsertCredential`, `getByProviderPrefix`, `deleteByProviderAndType`

### Phase 1: With Cortex Package (After ProviderManager Is Built)

4. **CortexCredentialService**: Full implementation with ProviderManager delegation
5. **cortex-provider.ts router**: All endpoints
6. **OAuth flow coordination**: EventEmitter bridge pattern
7. **Headless detection**: Environment heuristics
8. **Agent subsystem wiring**: `createCortexAgent` with getApiKey callback, event listeners

### Phase 2: Onboarding Migration

9. **Onboarding router updates**: Add Cortex provider step state tracking
10. **Settings router updates**: Cortex provider status in system settings response

## Docker OAuth Compatibility Matrix

Each pi-ai provider uses a different OAuth flow type. This determines whether OAuth login works inside a Docker container where `localhost` refers to the container, not the host machine.

**Source**: Verified by reading `@mariozechner/pi-ai/dist/utils/oauth/*.js` source code.

| Provider | OAuth Function | Flow Type | Callback Port | Docker Compatible | Notes |
|----------|---------------|-----------|:---:|:---:|-------|
| Anthropic (Claude) | `loginAnthropic` | Authorization Code + PKCE | `localhost:53692` | No | Spins up `http.createServer` on `127.0.0.1:53692/callback`. Browser redirects to localhost which is unreachable inside Docker. Falls back to manual paste of the redirect URL or authorization code. |
| OpenAI (ChatGPT/Codex) | `loginOpenAICodex` | Authorization Code + PKCE | `localhost:1455` | No | Spins up `http.createServer` on `127.0.0.1:1455/auth/callback`. Same localhost problem as Anthropic. Falls back to manual paste via `onPrompt`. |
| GitHub Copilot | `loginGitHubCopilot` | Device Code | None | Yes | Uses device code polling (`/login/device/code` on github.com). No localhost callback server. User visits a URL on any device and enters a code. Fully Docker-compatible. |
| Google Gemini CLI | `loginGeminiCli` | Authorization Code + PKCE | `localhost:8085` | No | Spins up `http.createServer` on `127.0.0.1:8085/oauth2callback`. Falls back to manual paste. |
| Google Antigravity | `loginAntigravity` | Authorization Code + PKCE | `localhost:51121` | No | Spins up `http.createServer` on `127.0.0.1:51121/oauth-callback`. Falls back to manual paste. |

### Docker-Specific Guidance

**For providers that use authorization code flow (Anthropic, OpenAI, Gemini CLI, Antigravity):**

All four providers support a manual paste fallback. When the callback server is unreachable (Docker, SSH, headless), pi-ai calls the `onManualCodeInput` or `onPrompt` callback, prompting the user to paste the redirect URL or authorization code from their browser. The Animus frontend relays this prompt via the `oauthStatus` tRPC subscription and the `oauthRespond` mutation.

This means OAuth login technically works in Docker, but requires the user to manually copy-paste the redirect URL. The `isHeadless()` detection in the backend can surface this in the UI: show the authorization URL prominently and add a paste input field for the redirect URL.

**For Docker users who want zero manual steps:** Use API key authentication (Layer 2 in the progressive disclosure) or environment variables. Only GitHub Copilot's device code flow works seamlessly in Docker without any paste step.

**Recommendation:** The `isHeadless()` detection should reorder the auth UI in Docker/headless mode: show API key input prominently, with OAuth as a secondary option that includes "you will need to paste the redirect URL" guidance.

## Open Questions

1. **Credential rotation/expiry monitoring**: Should the backend proactively check OAuth token expiry (e.g., on a timer) and refresh before it's needed? Or is lazy refresh (on the next `getApiKey` call) sufficient? Lazy refresh is simpler but means the first tick after expiry pays a refresh latency cost.

2. **Multiple stored providers**: The current design supports storing credentials for multiple providers simultaneously (e.g., Anthropic OAuth + OpenAI API key). Should there be a UI for managing all stored credentials, or just the active one?
