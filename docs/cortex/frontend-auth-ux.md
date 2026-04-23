# Frontend Auth UX

> **STATUS: IMPLEMENTED** - Provider settings and onboarding UI are live.
>
> **Note:** This is an Animus-specific integration doc. Cortex framework documentation (architecture, tools, compaction, skills, providers) lives in the [cortex-mono](https://github.com/Craigtut/cortex-mono) repository.

The frontend UX for Cortex provider authentication, covering both the onboarding flow and the settings page. Designed around **progressive disclosure**: OAuth sign-in is the primary path for non-technical users, with API key entry and custom endpoint configuration available for power users at increasing depth.

## Design Principles

These principles are derived from the Animus brand vision and design principles:

- **Warm, not clinical.** The auth step should feel like a welcome, not a configuration screen.
- **Clarity over cleverness.** Non-technical users should never encounter jargon (tokens, endpoints, environment variables) unless they go looking for it.
- **Progressive disclosure.** Three layers of complexity, each hidden behind the previous. Most users only see Layer 1.
- **Quiet confidence.** No warning walls, no anxiety-inducing security language. The system handles complexity; the user just signs in.

## Progressive Disclosure: Three Layers

### Layer 1: OAuth Sign-In (Default, Visible)

The primary experience. Non-technical users see provider cards with "Sign In" buttons. Clicking opens a browser for OAuth authorization. No API keys, no tokens, no terminal.

**Providers shown:** Anthropic (Claude), OpenAI (ChatGPT), Google (Gemini), GitHub Copilot.

Each card shows the provider name, a brief description of what subscription is needed, and a sign-in button. Only providers that support OAuth appear at this level.

### Layer 2: API Key Entry (One Click Deeper)

A collapsed section: "Use an API key instead". Expanding reveals a provider dropdown and API key input. This is for developers who have API keys from provider consoles.

**Providers shown:** All pi-ai providers that accept API keys (Anthropic, OpenAI, Google, Mistral, Groq, Cerebras, xAI, OpenRouter, and others). The dropdown is populated from `cortexProvider.listProviders()` filtered to those with `api_key` in their `authMethods`.

### Layer 3: Custom Endpoint (Deepest)

A collapsed section below Layer 2: "Configure a custom endpoint". For self-hosted models (Ollama, vLLM, LM Studio) or custom OpenAI-compatible APIs. Shows base URL, optional API key, and model ID inputs.

## Onboarding Flow

### Current Flow

```
Welcome → Agent Provider (Claude/Codex CLI auth) → Identity → About You → Persona (8 steps)
```

### New Flow

```
Welcome → Cortex Provider (3-layer progressive disclosure) → Identity → About You → Persona (8 steps)
```

The step is renamed from "Agent Provider" to a user-friendly label (e.g., "Connect Your AI" or "Choose Your AI"). The internal step tracking updates from the existing `AgentProviderStep` to a new `CortexProviderStep`.

### CortexProviderStep Component

**File:** `packages/frontend/src/pages/onboarding/CortexProviderStep.tsx`

#### Layout

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│  Connect your AI                                     │
│                                                      │
│  Sign in with your existing subscription.            │
│  No API keys needed.                                 │
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │  ◉ Anthropic (Claude)                        │    │
│  │    Use your Claude Pro or Max subscription    │    │
│  │    [Sign In with Claude]                      │    │
│  └──────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────┐    │
│  │  ○ OpenAI (ChatGPT)                          │    │
│  │    Use your ChatGPT Plus or Pro subscription  │    │
│  │    [Sign In with ChatGPT]                     │    │
│  └──────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────┐    │
│  │  ○ Google (Gemini)                           │    │
│  │    Sign in with your Google account           │    │
│  │    [Sign In with Google]                      │    │
│  └──────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────┐    │
│  │  ○ GitHub Copilot                            │    │
│  │    Use your GitHub Copilot subscription       │    │
│  │    [Sign In with GitHub]                      │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│  ▸ Use an API key instead                            │
│                                                      │
│  ▸ Configure a custom endpoint                       │
│                                                      │
│                                        [Continue]    │
│                                                      │
└──────────────────────────────────────────────────────┘
```

#### Provider Card States

Each provider card has four visual states:

1. **Default**: Provider name, description, sign-in button.
2. **Authenticating**: Sign-in button replaced with a waiting indicator and cancel button. Shows auth URL for headless environments.
3. **Connected**: Checkmark icon, "Connected as [displayName]" text, provider card highlighted. Sign-in button replaced with "Sign Out" link.
4. **Error**: Error message below the card (e.g., "Authentication failed. Try again."). Sign-in button remains available.

#### OAuth Sign-In Flow

When the user clicks "Sign In":

1. Frontend calls `cortexProvider.initiateOAuth({ provider })` mutation.
2. Frontend subscribes to `cortexProvider.oauthStatus` for real-time updates.
3. Backend starts the OAuth flow via ProviderManager.
4. Backend emits `auth_url` event via the subscription.
5. Frontend transitions the card to "Authenticating" state.

**Browser environment (desktop app, local dev):**

The backend opens the auth URL in the system browser automatically. The frontend shows:

```
┌──────────────────────────────────────────────┐
│  ◉ Anthropic (Claude)                        │
│                                              │
│    A browser window has opened.              │
│    Complete the sign-in there.               │
│                                              │
│    ○ ○ ○  Waiting for authorization...       │
│                                              │
│    [Cancel]                                  │
└──────────────────────────────────────────────┘
```

**Headless environment (Docker, SSH, no display):**

The backend cannot open a browser. The URL and optional device code are sent to the frontend. The frontend shows:

```
┌──────────────────────────────────────────────┐
│  ◉ Anthropic (Claude)                        │
│                                              │
│    Open this URL on any device:              │
│    https://console.anthropic.com/oauth/...   │
│    [Copy URL]                                │
│                                              │
│    Enter code: ABCD-1234                     │
│                                              │
│    ○ ○ ○  Waiting for authorization...       │
│                                              │
│    [Cancel]                                  │
└──────────────────────────────────────────────┘
```

**On success:**

The subscription emits a `success` event with `OAuthMeta`. The card transitions to "Connected" state:

```
┌──────────────────────────────────────────────┐
│  ◉ Anthropic (Claude)             Connected ✓│
│    craig@example.com                         │
│    Auto-refreshing                           │
│                                    [Sign Out]│
└──────────────────────────────────────────────┘
```

The "Continue" button at the bottom becomes enabled.

#### API Key Layer

Expanding "Use an API key instead":

```
┌──────────────────────────────────────────────┐
│  ▾ Use an API key instead                    │
│                                              │
│  Provider                                    │
│  [Anthropic                              ▾]  │
│                                              │
│  API Key                                     │
│  [sk-ant-•••••••••••••••••••••••••••••]      │
│                                              │
│  Get your API key from                       │
│  console.anthropic.com/settings/keys         │
│                                              │
│  [Validate & Save]                           │
│                                              │
└──────────────────────────────────────────────┘
```

**Provider dropdown:** Populated from `cortexProvider.listProviders()`, filtered to providers with `api_key` in `authMethods`. Each provider shows its `name` field.

**Dynamic helper text:** When the provider selection changes, the helper text and key URL update to match the selected provider's `keyUrl` from `ProviderInfo`.

**Key prefix inference:** If the provider has a `keyPrefix` (e.g., `sk-ant-` for Anthropic), the input can display a visual hint or auto-detect which provider the pasted key belongs to.

**Validation flow:**
1. User pastes key and clicks "Validate & Save".
2. Frontend calls `cortexProvider.validateApiKey({ provider, apiKey })`.
3. On success: calls `cortexProvider.saveApiKey({ provider, apiKey })`.
4. UI transitions to connected state with provider and "API Key" as the method.
5. On failure: shows inline error "Invalid API key. Check that you copied the full key."

#### Custom Endpoint Layer

Expanding "Configure a custom endpoint":

```
┌──────────────────────────────────────────────┐
│  ▾ Configure a custom endpoint               │
│                                              │
│  For self-hosted models (Ollama, vLLM,       │
│  LM Studio) or custom OpenAI-compatible APIs │
│                                              │
│  Base URL                                    │
│  [http://localhost:11434/v1            ]      │
│                                              │
│  Model ID                                    │
│  [llama-3.3-70b                       ]      │
│                                              │
│  API Key (optional)                          │
│  [                                    ]      │
│                                              │
│  [Test Connection]                           │
│                                              │
└──────────────────────────────────────────────┘
```

**Test Connection:** Calls `cortexProvider.testCustomEndpoint({ baseUrl, modelId, apiKey, compat })` which makes a minimal LLM call without saving credentials. On success, calls `cortexProvider.saveCustomEndpoint()` to persist, then shows connected state. On failure, shows inline error with the server's error message.

#### Environment Variable Detection

On component mount, the frontend calls `cortexProvider.getStatus()`. If the backend reports `method: 'env_var'` for any provider, the UI shows that provider as pre-connected:

```
┌──────────────────────────────────────────────┐
│  ◉ Anthropic (Claude)             Connected ✓│
│    Detected from environment variable        │
│    ANTHROPIC_API_KEY                         │
└──────────────────────────────────────────────┘
```

The "Continue" button is immediately enabled. The user can proceed without any auth interaction.

#### On Continue

When the user clicks "Continue":

1. Frontend calls `cortexProvider.setActiveProvider({ provider, model })` with the selected provider and a sensible default model (first model in the provider's list, or a curated default per provider).
2. Frontend calls `settings.updateSystemSettings` to update onboarding step.
3. Navigation advances to the Identity step.

The model selection happens at the provider level with a sensible default. Detailed model selection is available in the settings page after onboarding.

## Settings Page

### New Section: "AI Provider"

This section replaces the current "Agent Provider" section as the primary provider configuration UI. It appears near the top of the settings page.

#### Connected State

```
┌───────────────────────────────────────────────────────┐
│  AI Provider                                           │
│                                                       │
│  ┌─────────────────────────────────────────────────┐  │
│  │  Anthropic (Claude)               Connected ✓   │  │
│  │  craig@example.com (OAuth)                      │  │
│  │  Auto-refreshing · Expires in 4h                │  │
│  │                                                  │  │
│  │  Model                                           │  │
│  │  [Claude Sonnet 4                           ▾]   │  │
│  │                                                  │  │
│  │  200K context · $3/$15 per 1M tokens             │  │
│  │  Tool use · Images · Extended thinking           │  │
│  │                                                  │  │
│  │  [Sign Out]           [Switch Provider]          │  │
│  └─────────────────────────────────────────────────┘  │
│                                                       │
│  ▸ Advanced                                           │
│                                                       │
└───────────────────────────────────────────────────────┘
```

**Connected status line:** Shows the display name from `OAuthMeta` and the auth method. For OAuth, shows refresh status and expiry. For API key, shows "API Key" as the method. For env var, shows the variable name.

**Model picker:** Dropdown populated from `cortexProvider.listModels(provider)`. Each option shows the model name with specs below the dropdown (context window, pricing, capabilities).

**Switch Provider:** Opens a modal with the same three-layer picker from onboarding. Allows adding credentials for a new provider or switching to an already-configured one.

#### Credential Failure State

If an OAuth token refresh fails permanently (e.g., user revoked access on the provider's side, subscription expired), the heartbeat's `getApiKey` callback will throw. The backend should catch this and surface it via a `cortex:auth-failed` event. The settings page shows:

```
┌───────────────────────────────────────────────────────┐
│  AI Provider                                           │
│                                                       │
│  ┌─────────────────────────────────────────────────┐  │
│  │  Anthropic (Claude)             Disconnected ⚠  │  │
│  │  Authentication expired or revoked              │  │
│  │                                                  │  │
│  │  [Reconnect]          [Switch Provider]          │  │
│  └─────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────┘
```

"Reconnect" initiates the OAuth flow again for the same provider. The heartbeat pauses while the provider is disconnected.

For API key failures (invalid or revoked key), the same pattern applies but with messaging like "API key is invalid or has been revoked."

#### Not Connected State

If no Cortex provider is configured (e.g., fresh install without completing onboarding):

```
┌───────────────────────────────────────────────────────┐
│  AI Provider                                           │
│                                                       │
│  No AI provider configured.                           │
│                                                       │
│  [Set Up Provider]                                    │
│                                                       │
└───────────────────────────────────────────────────────┘
```

"Set Up Provider" opens the same three-layer modal.

#### Advanced Section

Expanding "Advanced" shows:

```
┌─────────────────────────────────────────────────────┐
│  ▾ Advanced                                         │
│                                                     │
│  Thinking Level                                     │
│  [Off ▾]                                            │
│  Controls how much the model reasons before         │
│  responding. Higher levels use more tokens.         │
│                                                     │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│                                                     │
│  Additional Providers                               │
│  You can configure multiple providers and switch    │
│  between them at any time.                          │
│                                                     │
│  Anthropic    Connected (OAuth)         [Manage]    │
│  OpenAI       Connected (API Key)       [Manage]    │
│  Groq         Not configured            [Add]       │
│                                                     │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│                                                     │
│  Custom Endpoint                                    │
│  [Configure]                                        │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Thinking Level:** Dropdown with options: Off, Minimal, Low, Medium, High, Extra High. Only shown when the active model supports thinking (from `ModelInfo.supportsThinking`). Calls `cortexProvider.setThinkingLevel()` on change.

**Additional Providers:** Lists all providers from `cortexProvider.listConfiguredProviders()` with their connection status. "Manage" opens a panel for that provider (sign out, switch API key, etc.). "Add" opens the auth flow for that provider.

**Custom Endpoint:** Opens the custom endpoint configuration form.

### Legacy Section: "Legacy Agent SDKs"

The existing Claude CLI and Codex CLI configuration moves to a collapsed section below the AI Provider section:

```
┌───────────────────────────────────────────────────────┐
│  ▸ Legacy Agent SDKs (Claude CLI / Codex CLI)         │
│    Used for sub-agents. Will be deprecated in a       │
│    future release.                                    │
└───────────────────────────────────────────────────────┘
```

Expanding reveals the existing provider settings UI (credential status, CLI auth, API key input, model selection) unchanged. This section is hidden entirely once the agents package is fully deprecated.

## State Management

### tRPC Queries and Mutations

| Hook | Type | Purpose |
|------|------|---------|
| `cortexProvider.listProviders` | query | List all supported providers with auth methods |
| `cortexProvider.listModels` | query | List models for a provider |
| `cortexProvider.getStatus` | query | Active provider, model, connection status, meta |
| `cortexProvider.listConfiguredProviders` | query | All providers with their connection status |
| `cortexProvider.initiateOAuth` | mutation | Start OAuth flow for a provider |
| `cortexProvider.oauthStatus` | subscription | Real-time OAuth flow progress |
| `cortexProvider.oauthRespond` | mutation | Respond to OAuth prompt |
| `cortexProvider.cancelOAuth` | mutation | Cancel active OAuth flow |
| `cortexProvider.saveApiKey` | mutation | Save an API key for a provider |
| `cortexProvider.validateApiKey` | mutation | Validate an API key |
| `cortexProvider.saveCustomEndpoint` | mutation | Save custom endpoint config |
| `cortexProvider.testCustomEndpoint` | mutation | Test custom endpoint without saving |
| `cortexProvider.setActiveProvider` | mutation | Set the active provider and model |
| `cortexProvider.setThinkingLevel` | mutation | Set thinking level |
| `cortexProvider.removeCredential` | mutation | Remove credentials for a provider |

### Component State

The `CortexProviderStep` component manages local state for the interactive flow:

```typescript
interface CortexProviderState {
  // Which provider is selected/being configured
  selectedProvider: string | null;

  // OAuth flow state
  oauthState: 'idle' | 'authenticating' | 'success' | 'error';
  oauthAuthUrl: string | null;
  oauthDeviceCode: string | null;
  oauthError: string | null;

  // API key input state
  apiKeyProvider: string | null;
  apiKeyValue: string;
  apiKeyValidation: 'idle' | 'validating' | 'success' | 'error';
  apiKeyError: string | null;

  // Custom endpoint state
  customBaseUrl: string;
  customModelId: string;
  customApiKey: string;
  customValidation: 'idle' | 'validating' | 'success' | 'error';

  // Which layers are expanded
  apiKeyExpanded: boolean;
  customEndpointExpanded: boolean;

  // Connected providers (may have multiple)
  connectedProviders: Map<string, { method: string; meta: OAuthMeta | null }>;
}
```

This is local component state (React `useState` or `useReducer`), not Zustand. The connected providers map is populated from `cortexProvider.getStatus()` and `cortexProvider.listConfiguredProviders()` on mount.

### Onboarding Store Changes

The existing `onboarding-store.ts` (Zustand with localStorage persistence) needs minimal changes:

```typescript
interface OnboardingStore {
  // ... existing fields ...

  // Replace agentProvider with cortexProvider
  cortexProvider: string | null;     // Selected provider ID
  cortexModel: string | null;        // Selected model ID (may be null until set)
}
```

## Visual Design Notes

### Provider Cards

- Use the monochromatic card style from the existing UI (warm white background in light mode, warm dark in dark mode).
- Provider names in Outfit semibold. Descriptions in Outfit regular, secondary text color.
- Connected checkmark uses the semantic green.
- OAuth waiting animation: three breathing dots (not a spinner), following the "breathing over blinking" principle.
- Error messages in semantic red, inline below the card.

### Transitions

- Layer expansion uses smooth height animation (Motion/framer-motion).
- OAuth state transitions use cross-fade (200ms).
- Connected state slides in from the right with a subtle spring.
- All animations follow the "alive, not animated" principle: subtle, organic, never attention-seeking.

### Responsive Considerations

- Provider cards stack vertically on all screen sizes.
- On narrow viewports (mobile, small window), the cards take full width with comfortable padding.
- The three-layer progressive disclosure works naturally on mobile since collapsed sections take minimal space.

## Platform-Specific Behavior

### Desktop App (Tauri)

- OAuth opens the system browser via Tauri's shell API.
- The backend's `onAuth` callback can reliably open a browser.
- Device code display is a fallback, not the primary path.

### Web App (Local Dev)

- OAuth opens a new browser tab via `window.open()` or the backend opens the system browser.
- Same flow as desktop.

### Web App (Docker / Remote)

- Backend detects headless environment.
- OAuth shows URL + device code for cross-device auth.
- The frontend adapts based on the subscription events (if `auth_url` event includes `instructions` or `deviceCode`, show the headless variant).

### Multiple Provider Cards Connected

Users can authenticate with multiple providers. The UI shows all connected providers with the active one highlighted. Switching is instant (just changes the `cortex_provider` setting).

## Migration from Current Onboarding

### What Changes

| Aspect | Current | New |
|--------|---------|-----|
| Step name | "Agent Provider" | "Connect Your AI" (or similar) |
| Component | `AgentProviderStep.tsx` | `CortexProviderStep.tsx` |
| Auth methods | CLI detection, CLI OAuth, device code, API key | OAuth sign-in, API key, custom endpoint |
| Providers | Claude, Codex (2) | Anthropic, OpenAI, Google, GitHub Copilot, + 10 API key providers (20+) |
| Default path | CLI detection (auto-connect if CLI installed) | OAuth sign-in (browser-based) |
| Store fields | `agentProvider: 'claude' \| 'codex'` | `cortexProvider: string, cortexModel: string` |
| Backend router | `provider.ts`, `claude-auth.ts`, `codex-auth.ts` | `cortex-provider.ts` |

### What Stays

- The overall onboarding flow structure (Welcome -> Auth -> Identity -> About You -> Persona)
- The progress indicator in `OnboardingLayout`
- The onboarding state tracking in `system_settings` (`onboarding_step`, `onboarding_complete`)
- The Zustand persistence pattern for client-side draft state

### What's Removed

- CLI binary detection (`claude`, `codex` CLI checks)
- CLI-based OAuth (`claude auth login`, `codex login` subprocess spawning)
- The `@animus-labs/agents` auth providers (`ClaudeAuthProvider`, `CodexAuthProvider`) from the onboarding path (they remain for legacy settings)

## Open Questions

1. **Default model selection**: When a user connects via OAuth, what default model should be selected? Options: (a) the provider's most capable model, (b) the provider's most cost-effective model, (c) a curated default per provider. Recommendation: curated defaults (e.g., Claude Sonnet 4 for Anthropic, GPT-4o for OpenAI) that balance capability and cost.

2. **Model picker in onboarding**: Should the onboarding step include model selection, or just provider selection with a sensible default? Model selection can always happen later in settings. Recommendation: provider only in onboarding, model selection in settings. Keeps onboarding simple.

3. **Provider ordering**: Should the OAuth provider cards be ordered by preference (e.g., Anthropic first because it's the best-supported), or alphabetically? Recommendation: curated order based on quality of Animus experience with that provider.

4. **"Already have credentials" shortcut**: Should the API key section auto-expand if the user appears to be a developer (e.g., arrived from a CLI setup, or running in a dev environment)? Or always start collapsed?

5. **Multiple connected providers UX**: In the settings page, if a user has 3+ providers configured, should the "Additional Providers" list be paginated, searchable, or always shown fully? With the current provider count (~15), a full list is manageable.
