# Phase 2B: Auth Integration

> **Scope:** Backend auth service (`CortexCredentialService`), tRPC router (`cortexProvider`), and frontend auth UX (onboarding + settings). After this phase, users can configure AI providers through the UI.

## Dependencies

- Phase 1D complete (ProviderManager exists)
- Phase 2A complete (CortexAgent wired into heartbeat)

## Tasks

### 2B.0: Credential Store Prerequisites

**Reference:** `backend-auth-integration.md`

Before building the credential service, the credential store needs four new functions (if not already added in Phase 0.3):
- `getByProviderPrefix(db, prefix)` — find credentials by `cortex_` prefix
- `upsertCredential(db, type, provider, data, metadata)` — insert or update
- `updateCredentialData(db, type, provider, newData)` — update encrypted blob
- `deleteByProviderAndType(db, provider, type)` — remove credential

These are prerequisite functions that `CortexCredentialService` calls directly.

### 2B.1: CortexCredentialService (`services/cortex-credential-service.ts`)

**Reference:** `backend-auth-integration.md`

New backend service that bridges ProviderManager to the credential store:

```typescript
class CortexCredentialService {
  resolveApiKey(provider: string): Promise<string>;
  getProviderStatus(): ProviderStatus;
  // ... other methods from backend-auth-integration.md
}
```

Key behaviors:
- `resolveApiKey`: try stored credential (decrypt on demand), fallback to env vars, OAuth refresh if token changed and re-persist
- Vault sealed: throw if vault sealed (heartbeat should not tick until unsealed). `getProviderStatus()` still works without decrypting (reads plaintext metadata column).
- Credential types prefixed with `cortex_` to coexist with legacy credentials
- Headless/Docker detection: `isHeadless()` function with 4 heuristics (DOCKER env, Linux + no DISPLAY, SSH_CLIENT set, CI env). Headless mode emits auth URL to frontend instead of opening browser.

### OAuth Flow Coordination

The `initiateOAuth` mutation and `oauthStatus` subscription must be coordinated via an EventEmitter bridge (same pattern as current `claude-auth.ts`):

- `initiateOAuth` calls `providerManager.initiateOAuth(provider, callbacks)` where `callbacks.onAuth` emits `auth_url` on the EventEmitter, `callbacks.onPrompt` emits `prompt`, `callbacks.onProgress` emits `progress`
- `oauthStatus` subscription listens to the EventEmitter and pushes `OAuthStatusEvent` variants to the client
- On success: store credentials, emit `success` event, emit `cortex:provider-changed` on EventBus
- On error: emit `error` event, clean up

### EventBus Events (3 total)

- `cortex:provider-changed { provider, model }` — agent subsystem calls `agent.setModel()`
- `cortex:thinking-level-changed { level }` — agent subsystem calls `agent.setThinkingLevel()`
- `cortex:provider-removed {}` — agent subsystem pauses heartbeat, clears agent reference

### 2B.2: Cortex Provider tRPC Router (`api/routers/cortex-provider.ts`)

**Reference:** `backend-auth-integration.md`

15 endpoints on the `cortexProvider` router:
- Queries: `listProviders`, `listModels`, `getStatus`, `listConfiguredProviders`
- Mutations: `initiateOAuth`, `oauthRespond`, `cancelOAuth`, `saveApiKey`, `validateApiKey`, `saveCustomEndpoint`, `testCustomEndpoint`, `setActiveProvider`, `setThinkingLevel`, `removeCredential`
- Subscription: `oauthStatus` (discriminated union events)

EventBus integration:
- `cortex:provider-changed` -> agent subsystem calls `agent.setModel()`
- `cortex:thinking-level-changed` -> agent subsystem calls `agent.setThinkingLevel()`

### 2B.3: Frontend Onboarding Step (`CortexProviderStep.tsx`)

**Reference:** `frontend-auth-ux.md`

Replace the current `AgentProviderStep` with the new progressive disclosure UX:
- Layer 1: OAuth provider cards (Anthropic, OpenAI, Google, GitHub Copilot)
- Layer 2: API key input (collapsed)
- Layer 3: Custom endpoint (collapsed)

OAuth flow, API key validation, custom endpoint testing as described in the frontend doc.

### 2B.4: Frontend Settings Page Updates

**Reference:** `frontend-auth-ux.md`

Add "AI Provider" section to settings:
- Connected status card with model picker
- Utility model picker (defaults to "Recommended")
- Thinking level dropdown
- OAuth refresh/expiry status
- Sign Out / Switch Provider buttons
- Demote legacy provider section to collapsed "Legacy Agent SDKs"

### 2B.5: Onboarding Store Updates

**Modify:** `packages/frontend/src/store/onboarding-store.ts`

Replace `agentProvider: 'claude' | 'codex'` with:
- `cortexProvider: string | null`
- `cortexModel: string | null`

### 2B.6: Docker OAuth Compatibility Verification

**Reference:** `cross-platform-considerations.md` (OAuth in Docker)

Before building the OAuth UI, verify each pi-ai login function's flow type:
- Read the source code for `loginAnthropic`, `loginOpenAICodex`, `loginGitHubCopilot`, `loginGeminiCli`, `loginAntigravity`
- Determine: does it use device code flow (works in Docker) or authorization code flow with localhost callback (doesn't work in Docker)?
- Document results in `backend-auth-integration.md` as a "Docker OAuth Compatibility Matrix"
- For providers using authorization code flow: note that Docker users must use API key auth

### 2B.7: Custom Endpoint Docker Help Text

Add help text in the custom endpoint UI form: "Running in Docker? Use `http://host.docker.internal:PORT` instead of `localhost`."

Optionally: detect Docker in the backend (reuse `isHeadless()` detection) and auto-suggest the correct hostname.

## Completion Criteria

- Users can authenticate via OAuth, API key, or custom endpoint through the UI
- Onboarding flow works for new users
- Settings page shows connected status, model picker, thinking level
- Credential storage uses `cortex_` prefixed types in existing credentials table
- Backend resolves API keys at runtime via `getApiKey` callback
- Provider changes hot-swap the model without restarting the agent

## Files Created/Modified

| File | Change |
|------|--------|
| `backend/src/services/cortex-credential-service.ts` | New |
| `backend/src/api/routers/cortex-provider.ts` | New |
| `backend/src/api/routers/index.ts` | Register new router |
| `backend/src/heartbeat/agent-subsystem.ts` | Wire EventBus listeners for provider changes |
| `frontend/src/pages/onboarding/CortexProviderStep.tsx` | New (replaces AgentProviderStep) |
| `frontend/src/pages/SettingsPage.tsx` | Add AI Provider section |
| `frontend/src/store/onboarding-store.ts` | Update store shape |
