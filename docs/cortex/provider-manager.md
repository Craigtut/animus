# Provider Manager

> **STATUS: RESEARCH** - Not yet implemented.

The `ProviderManager` is a standalone class in `@animus-labs/cortex` that wraps `pi-ai`'s provider registry, model resolution, and OAuth flows into a clean, typed API. It is the sole boundary through which consumers interact with pi-ai's provider ecosystem. Consumers never import `@mariozechner/pi-ai` directly.

## Why It Exists

Pi-ai provides powerful multi-provider support: 20+ providers, automatic model discovery, OAuth login flows, token refresh, custom model creation, and environment variable detection. But pi-ai is a low-level library with multiple entry points (`@mariozechner/pi-ai`, `@mariozechner/pi-ai/oauth`), provider-specific login functions, and raw credential objects.

ProviderManager wraps all of this into a single, typed interface that:

- Gives consumers one import for all provider concerns
- Normalizes pi-ai's provider-specific types into Cortex's own stable types
- Keeps pi-ai as an internal implementation detail of Cortex
- Provides an interface (`IProviderManager`) for testing and alternative implementations

## Relationship to CortexAgent

ProviderManager and CortexAgent are **fully independent**. Neither knows about the other. They exist as separate exports from `@animus-labs/cortex`.

```
@animus-labs/cortex
├── ProviderManager    (discovery, auth, model resolution)
├── CortexAgent        (agentic loop, tools, context, skills)
└── pi-ai / pi-agent-core (internal, not exposed)
```

**Why independent:**

1. **Lifecycle mismatch.** ProviderManager is needed during onboarding (before any agent exists) for provider discovery and OAuth flows. CortexAgent is created later, after credentials are confirmed and persona is set up. They have different creation times.

2. **The consumer wires them.** The consumer creates both, uses ProviderManager for auth/discovery, and provides a `getApiKey` callback to CortexAgent. The callback is the only connection, and the consumer owns it.

3. **Testability.** Each can be tested and mocked independently.

## Interface

```typescript
// packages/cortex/src/types.ts

interface IProviderManager {
  // ── Discovery ──
  listProviders(): ProviderInfo[];
  listOAuthProviders(): string[];
  listModels(provider: string): ModelInfo[];

  // ── OAuth ──
  initiateOAuth(provider: string, callbacks: OAuthCallbacks): Promise<OAuthResult>;
  cancelOAuth(): void;
  resolveOAuthApiKey(provider: string, credentials: string): Promise<OAuthRefreshResult>;

  // ── API Key ──
  validateApiKey(provider: string, apiKey: string): Promise<boolean>;
  checkEnvApiKey(provider: string): string | null;

  // ── Model Resolution ──
  resolveModel(provider: string, modelId: string): CortexModel;
  createCustomModel(config: CustomModelConfig): CortexModel;
}
```

## Types

### Provider Discovery

```typescript
type AuthMethod = 'oauth' | 'api_key';

interface ProviderInfo {
  /** Provider identifier (e.g., 'anthropic', 'openai', 'google') */
  id: string;
  /** Human-readable name (e.g., 'Anthropic', 'OpenAI') */
  name: string;
  /** Supported authentication methods */
  authMethods: AuthMethod[];
  /** Environment variable name for API key (e.g., 'ANTHROPIC_API_KEY') */
  envVar?: string;
  /** API key prefix for client-side type inference (e.g., 'sk-ant-') */
  keyPrefix?: string;
  /** URL where users obtain API keys */
  keyUrl?: string;
}
```

Provider metadata is assembled from pi-ai's registry and augmented with UX-relevant fields (keyPrefix, keyUrl) that pi-ai doesn't provide. These are maintained in a static map within ProviderManager.

### Model Discovery

```typescript
interface ModelInfo {
  /** Model identifier (e.g., 'claude-sonnet-4-20250514') */
  id: string;
  /** Human-readable name (e.g., 'Claude Sonnet 4') */
  name: string;
  /** Context window size in tokens */
  contextWindow: number;
  /** Whether the model supports extended thinking */
  supportsThinking: boolean;
  /** Whether the model supports image input */
  supportsImages: boolean;
  /** Pricing per million tokens (if available) */
  pricing?: { input: number; output: number };
}
```

Model metadata is derived from pi-ai's model registry. Pi-ai auto-discovers models from provider APIs and maintains a generated model list with specs.

### CortexModel (Opaque)

```typescript
/**
 * Opaque model handle. The consumer receives this from ProviderManager
 * and passes it to CortexAgent. The consumer never inspects its internals.
 *
 * Internally, this wraps pi-ai's Model<T> type.
 */
type CortexModel = {
  /** @internal */
  readonly __brand: 'CortexModel';
  /** Provider identifier */
  readonly provider: string;
  /** Model identifier */
  readonly modelId: string;
  /** Context window size */
  readonly contextWindow: number;
};
```

The consumer can read `provider`, `modelId`, and `contextWindow` for display and configuration purposes. The underlying pi-ai `Model` object is accessed internally by CortexAgent when constructing the pi-agent-core Agent.

### OAuth

```typescript
interface OAuthCallbacks {
  /**
   * Called when the user needs to visit a URL to authorize.
   * The consumer should open the URL in a browser or display it to the user.
   * @param url - The authorization URL
   * @param instructions - Optional human-readable instructions (e.g., "Enter code: ABCD")
   */
  onAuth: (url: string, instructions?: string) => void;

  /**
   * Called when the OAuth flow needs user input (e.g., a prompt).
   * The consumer should display the prompt and return the user's response.
   */
  onPrompt: (prompt: { message: string }) => Promise<string>;

  /**
   * Called with progress messages during the flow.
   */
  onProgress: (message: string) => void;
}

interface OAuthResult {
  /**
   * Serialized credential payload. The consumer stores this (encrypted)
   * and passes it back to resolveOAuthApiKey() for refresh.
   *
   * This is a JSON string. The consumer should treat it as an opaque blob:
   * encrypt it, store it, decrypt it, pass it back. Never parse or inspect.
   */
  credentials: string;

  /**
   * Display-safe metadata extracted at login time.
   * The consumer can store this unencrypted for UI display
   * (e.g., "Connected as craig@example.com", "Expires in 4 hours").
   */
  meta: OAuthMeta;
}

interface OAuthMeta {
  /** Provider identifier */
  provider: string;
  /** Display name, email, or account identifier (if available from the provider) */
  displayName?: string;
  /** When the access token expires (Unix timestamp ms). Null if non-expiring. */
  expiresAt?: number;
  /** Whether the credential supports automatic refresh */
  refreshable: boolean;
}

interface OAuthRefreshResult {
  /** The API key to use for LLM calls */
  apiKey: string;

  /**
   * Credential payload (may be updated if refresh occurred).
   * Same format as OAuthResult.credentials.
   */
  credentials: string;

  /** Updated metadata */
  meta: OAuthMeta;

  /** Whether the credentials were actually refreshed (true) or reused as-is (false) */
  changed: boolean;
}
```

### Custom Models

```typescript
interface CustomModelConfig {
  /** Base URL of the OpenAI-compatible API (e.g., 'http://localhost:11434/v1') */
  baseUrl: string;
  /** Model identifier to send in API requests */
  modelId: string;
  /** Context window size (default: 128,000) */
  contextWindow?: number;
  /** Optional API key (some local servers don't require one) */
  apiKey?: string;
  /** Compatibility settings for non-standard servers */
  compat?: {
    /** Whether the server supports the 'developer' role (default: true) */
    supportsDeveloperRole?: boolean;
    /** Whether the server supports reasoning_effort (default: true) */
    supportsReasoningEffort?: boolean;
  };
}
```

## Implementation

### Default Implementation

```typescript
// packages/cortex/src/provider-manager.ts

import { getModel, createModel, getModels, getEnvApiKey } from '@mariozechner/pi-ai';
import {
  loginAnthropic,
  loginOpenAICodex,
  loginGitHubCopilot,
  loginGeminiCli,
  loginAntigravity,
  refreshOAuthToken,
  getOAuthApiKey,
  type OAuthProvider,
} from '@mariozechner/pi-ai/oauth';

class ProviderManager implements IProviderManager {
  private activeOAuthAbort: AbortController | null = null;

  listProviders(): ProviderInfo[] {
    // Combines pi-ai's provider registry with static UX metadata
    return PROVIDER_REGISTRY;
  }

  listOAuthProviders(): string[] {
    return ['anthropic', 'openai-codex', 'github-copilot', 'google-gemini-cli', 'google-antigravity'];
  }

  listModels(provider: string): ModelInfo[] {
    // Delegates to pi-ai's getModels(), maps to ModelInfo
    const models = getModels(provider);
    return models.map(mapToModelInfo);
  }

  async initiateOAuth(provider: string, callbacks: OAuthCallbacks): Promise<OAuthResult> {
    const loginFn = LOGIN_FUNCTIONS[provider as OAuthProvider];
    if (!loginFn) throw new Error(`Provider "${provider}" does not support OAuth`);

    this.activeOAuthAbort = new AbortController();

    const rawCredentials = await loginFn({
      onAuth: callbacks.onAuth,
      onPrompt: callbacks.onPrompt,
      onProgress: callbacks.onProgress,
      signal: this.activeOAuthAbort.signal,
    });

    this.activeOAuthAbort = null;

    // Serialize credentials (opaque to consumer)
    const credentials = JSON.stringify(rawCredentials);

    // Extract display-safe metadata
    const meta: OAuthMeta = {
      provider,
      displayName: extractDisplayName(rawCredentials),
      expiresAt: rawCredentials.expiresAt ?? undefined,
      refreshable: !!rawCredentials.refreshToken,
    };

    return { credentials, meta };
  }

  cancelOAuth(): void {
    this.activeOAuthAbort?.abort();
    this.activeOAuthAbort = null;
  }

  async resolveOAuthApiKey(provider: string, credentials: string): Promise<OAuthRefreshResult> {
    const rawCredentials = JSON.parse(credentials);
    const credMap = { [provider]: { type: 'oauth' as const, ...rawCredentials } };

    const result = await getOAuthApiKey(provider as OAuthProvider, credMap);
    if (!result) throw new Error(`OAuth resolution failed for provider "${provider}"`);

    const changed = result.newCredentials !== rawCredentials;
    const newCredentials = changed ? JSON.stringify(result.newCredentials) : credentials;

    const meta: OAuthMeta = {
      provider,
      displayName: extractDisplayName(result.newCredentials),
      expiresAt: result.newCredentials.expiresAt ?? undefined,
      refreshable: !!result.newCredentials.refreshToken,
    };

    return { apiKey: result.apiKey, credentials: newCredentials, meta, changed };
  }

  async validateApiKey(provider: string, apiKey: string): Promise<boolean> {
    // Makes a minimal LLM call to verify the key works
    try {
      const model = getModel(provider, this.getSmallestModel(provider));
      await completeSimple(model, {
        messages: [{ role: 'user', content: 'hi' }],
      }, { apiKey, maxTokens: 1 });
      return true;
    } catch {
      return false;
    }
  }

  checkEnvApiKey(provider: string): string | null {
    return getEnvApiKey(provider) ?? null;
  }

  resolveModel(provider: string, modelId: string): CortexModel {
    const piModel = getModel(provider, modelId);
    return wrapModel(piModel, provider, modelId);
  }

  createCustomModel(config: CustomModelConfig): CortexModel {
    const piModel = createModel({
      baseUrl: config.baseUrl,
      modelId: config.modelId,
      contextWindow: config.contextWindow ?? 128_000,
      compat: config.compat,
    });
    return wrapModel(piModel, 'custom', config.modelId);
  }
}
```

### Provider Registry (Static Metadata)

Pi-ai provides provider and model information programmatically, but some UX-relevant metadata (key prefixes, documentation URLs) is not available from the library. ProviderManager maintains a static registry for this:

```typescript
const PROVIDER_REGISTRY: ProviderInfo[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    authMethods: ['oauth', 'api_key'],
    envVar: 'ANTHROPIC_API_KEY',
    keyPrefix: 'sk-ant-',
    keyUrl: 'console.anthropic.com/settings/keys',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    authMethods: ['api_key'],
    envVar: 'OPENAI_API_KEY',
    keyPrefix: 'sk-proj-',
    keyUrl: 'platform.openai.com/api-keys',
  },
  {
    id: 'openai-codex',
    name: 'OpenAI Codex',
    authMethods: ['oauth'],
    // No API key; requires ChatGPT Plus/Pro subscription OAuth
  },
  {
    id: 'google',
    name: 'Google',
    authMethods: ['api_key'],
    envVar: 'GEMINI_API_KEY',
    keyUrl: 'aistudio.google.com/apikey',
  },
  {
    id: 'google-gemini-cli',
    name: 'Google Gemini',
    authMethods: ['oauth'],
    // Free tier or paid subscription OAuth
  },
  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    authMethods: ['oauth'],
    // Copilot subscription OAuth
  },
  {
    id: 'mistral',
    name: 'Mistral',
    authMethods: ['api_key'],
    envVar: 'MISTRAL_API_KEY',
    keyUrl: 'console.mistral.ai/api-keys',
  },
  {
    id: 'groq',
    name: 'Groq',
    authMethods: ['api_key'],
    envVar: 'GROQ_API_KEY',
    keyUrl: 'console.groq.com/keys',
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    authMethods: ['api_key'],
    envVar: 'CEREBRAS_API_KEY',
    keyUrl: 'cloud.cerebras.ai',
  },
  {
    id: 'xai',
    name: 'xAI',
    authMethods: ['api_key'],
    envVar: 'XAI_API_KEY',
    keyUrl: 'console.x.ai',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    authMethods: ['api_key'],
    envVar: 'OPENROUTER_API_KEY',
    keyUrl: 'openrouter.ai/keys',
  },
  // Additional providers can be added as needed
];
```

This registry is maintained manually. When pi-ai adds a new provider, a corresponding entry is added here. Providers not in the registry can still be used via `resolveModel()` and `createCustomModel()` with direct API keys; they just won't appear in the discovery UI.

### OAuth Login Functions Map

```typescript
const LOGIN_FUNCTIONS: Record<string, (opts: any) => Promise<any>> = {
  'anthropic': loginAnthropic,
  'openai-codex': loginOpenAICodex,
  'github-copilot': loginGitHubCopilot,
  'google-gemini-cli': loginGeminiCli,
  'google-antigravity': loginAntigravity,
};
```

### Display Name Extraction

Different OAuth providers include different identity information in their credentials. ProviderManager extracts the best available display name:

```typescript
function extractDisplayName(credentials: Record<string, unknown>): string | undefined {
  // Try common fields across providers
  if (typeof credentials.email === 'string') return credentials.email;
  if (typeof credentials.accountId === 'string') return credentials.accountId;
  if (typeof credentials.idToken === 'string') {
    // JWT id_token may contain email in payload
    try {
      const payload = JSON.parse(atob(credentials.idToken.split('.')[1]));
      if (payload.email) return payload.email;
    } catch { /* ignore malformed tokens */ }
  }
  return undefined;
}
```

## CortexAgent Integration

CortexAgent receives a `CortexModel` and an optional `getApiKey` callback. The callback is the consumer's responsibility to implement; ProviderManager is not involved.

```typescript
// packages/cortex/src/cortex-agent.ts

interface CortexAgentConfig {
  /** Model handle from ProviderManager.resolveModel() */
  model: CortexModel;

  /**
   * Dynamic API key resolver. Called before every LLM call.
   * Enables OAuth token refresh without session teardown.
   * If omitted, pi-ai falls back to environment variables.
   */
  getApiKey?: (provider: string) => Promise<string>;

  // ... tools, contextManager, budgetGuards, etc.
}
```

Internally, CortexAgent unwraps the `CortexModel` to get the pi-ai `Model` and passes `getApiKey` through to pi-agent-core:

```typescript
const agent = await CortexAgent.create({
  model,
  getApiKey: (provider) => credService.resolveApiKey(provider),
  initialBasePrompt: 'You are the application agent.',
});

  /**
   * Switch to a different model at runtime.
   * Conversation history is preserved. The getApiKey callback
   * handles the new provider automatically.
   */
agent.setModel(model);
```

## Package Structure

```
packages/cortex/
  src/
    provider-manager.ts       # ProviderManager class (IProviderManager implementation)
    provider-registry.ts      # Static provider metadata (PROVIDER_REGISTRY)
    model-wrapper.ts          # CortexModel wrapping/unwrapping utilities
    types.ts                  # Add: IProviderManager, ProviderInfo, ModelInfo,
                              #   CortexModel, OAuthCallbacks, OAuthResult,
                              #   OAuthMeta, OAuthRefreshResult, CustomModelConfig
```

## Supported Providers

### OAuth Providers

These providers authenticate via browser-based OAuth flows. The user signs in with their existing subscription (Claude Pro/Max, ChatGPT Plus/Pro, GitHub Copilot, Google account). No API keys needed.

| Provider | Pi-ai ID | Login Function | Subscription Required |
|----------|----------|---------------|----------------------|
| Anthropic (Claude) | `anthropic` | `loginAnthropic` | Claude Pro or Max |
| OpenAI Codex | `openai-codex` | `loginOpenAICodex` | ChatGPT Plus or Pro |
| GitHub Copilot | `github-copilot` | `loginGitHubCopilot` | Copilot subscription |
| Google Gemini CLI | `google-gemini-cli` | `loginGeminiCli` | Free tier or paid |
| Antigravity | `google-antigravity` | `loginAntigravity` | Varies |

### API Key Providers

These providers authenticate with a static API key obtained from the provider's console.

| Provider | Pi-ai ID | Environment Variable |
|----------|----------|---------------------|
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY` |
| OpenAI | `openai` | `OPENAI_API_KEY` |
| Google (Gemini) | `google` | `GEMINI_API_KEY` |
| Mistral | `mistral` | `MISTRAL_API_KEY` |
| Groq | `groq` | `GROQ_API_KEY` |
| Cerebras | `cerebras` | `CEREBRAS_API_KEY` |
| xAI | `xai` | `XAI_API_KEY` |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` |
| Vercel AI Gateway | `vercel-ai-gateway` | `VERCEL_AI_GATEWAY_API_KEY` |
| MiniMax | `minimax` | `MINIMAX_API_KEY` |
| OpenCode Zen | `opencode-zen` | `OPENCODE_ZEN_API_KEY` |
| OpenCode Go | `opencode-go` | `OPENCODE_GO_API_KEY` |
| Kimi For Coding | `kimi-for-coding` | `KIMI_API_KEY` |

Note: Anthropic supports both OAuth and API key. It appears in both tables.

### Custom Endpoints

Any OpenAI-compatible API (Ollama, vLLM, LM Studio, etc.) can be configured via `createCustomModel()`. These require a base URL, model ID, and optional API key.

### Deferred Providers

These providers require complex credential configurations beyond a single API key:

- **Amazon Bedrock**: Requires AWS access key, secret key, region, and optional session token. Deferred due to complexity and enterprise-focused audience.
- **Azure OpenAI**: Requires resource name, deployment name, API version, and API key. May be supported under API key entry with additional fields in a future iteration.
- **Google Vertex AI**: Requires project ID, location, and either an API key or Application Default Credentials. May be supported in a future iteration.

## Open Questions

1. **Model list caching**: Should `listModels()` cache results? Pi-ai's model list is generated at build time, not fetched live. If it's static, caching is unnecessary. If pi-ai adds live model discovery, caching would matter.

2. **Provider-specific OAuth notes**: Some providers have quirks (e.g., GitHub Copilot requires enabling models in VS Code first). Should ProviderManager surface these as structured data, or leave them to consumer documentation?

3. **Validation cost**: `validateApiKey()` makes a real LLM call (with `maxTokens: 1`). This costs a tiny amount. Should there be a cheaper validation path, or is this acceptable?

4. **OAuth cancellation**: Pi-ai's login functions may or may not support `AbortSignal`. If they don't, `cancelOAuth()` would need to track and reject the pending promise manually.
