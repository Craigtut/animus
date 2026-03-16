# Phase 1D: Provider Manager, System Prompt, Model Tiers

> **Scope:** Implement provider/model management, multi-provider authentication, model tier resolution, and system prompt assembly. After this phase, cortex can authenticate with any pi-ai provider and assemble a complete system prompt.

## Dependencies

- Phase 1B complete (CortexAgent exists)
- Can run in parallel with Phase 1C (tools)

## Tasks

### 1D.1: Provider Registry (`provider-registry.ts`)

**Reference:** `provider-manager.md`

Static data: known providers with their auth methods, env var names, key prefixes.

```typescript
export const PROVIDER_REGISTRY: ProviderInfo[] = [
  { id: 'anthropic', name: 'Anthropic', authMethods: ['oauth', 'api_key'], envVar: 'ANTHROPIC_API_KEY', keyPrefix: 'sk-ant-' },
  { id: 'openai', name: 'OpenAI', authMethods: ['api_key'], envVar: 'OPENAI_API_KEY', keyPrefix: 'sk-' },
  { id: 'google', name: 'Google', authMethods: ['oauth', 'api_key'], envVar: 'GOOGLE_API_KEY' },
  // ... all providers from pi-ai
];

export const LOGIN_FUNCTIONS: Record<string, LoginFn> = {
  anthropic: loginAnthropic,
  'github-copilot': loginGitHubCopilot,
  // ...
};
```

Also: `UTILITY_MODEL_DEFAULTS` map for model tier resolution.

**Tests:** Registry contains expected providers, login functions mapped correctly.

### 1D.2: Model Wrapper (`model-wrapper.ts`)

**Reference:** `provider-manager.md`

Branded type `CortexModel` that wraps pi-ai's `Model<any>`:

```typescript
export type CortexModel = Model<any> & { readonly __brand: 'CortexModel' };
export function wrapModel(model: Model<any>): CortexModel;
export function unwrapModel(cortexModel: CortexModel): Model<any>;
```

Prevents consumers from accidentally passing raw pi-ai models where cortex models are expected.

**Tests:** Wrap/unwrap round-trip, brand check.

### 1D.3: Provider Manager (`provider-manager.ts`)

**Reference:** `provider-manager.md`

The main class for provider/model management:

```typescript
class ProviderManager implements IProviderManager {
  listProviders(): ProviderInfo[];
  listOAuthProviders(): string[];
  listModels(provider: string): ModelInfo[];
  initiateOAuth(provider: string, callbacks: OAuthCallbacks): Promise<OAuthResult>;
  cancelOAuth(): void;
  resolveOAuthApiKey(provider: string, credentials: string): Promise<OAuthRefreshResult>;
  validateApiKey(provider: string, apiKey: string): Promise<boolean>;
  checkEnvApiKey(provider: string): string | null;
  resolveModel(provider: string, modelId: string): CortexModel;
  createCustomModel(config: CustomModelConfig): CortexModel;
}
```

Key implementation:
- `listProviders()`: returns `PROVIDER_REGISTRY`
- `listModels()`: calls pi-ai `getModels(provider)`, wraps each as `ModelInfo`
- `initiateOAuth()`: calls pi-ai login function for the provider, bridges callbacks
- `validateApiKey()`: makes a minimal LLM call (`complete()` with `maxTokens: 1`) to verify the key works
- `resolveOAuthApiKey()`: calls pi-ai `getOAuthApiKey()`, handles token refresh
- `cancelOAuth()`: aborts the running OAuth flow (manual promise rejection if pi-ai doesn't support AbortSignal)

**Tests:** List providers, list models (mock pi-ai), validate API key (mock LLM call), OAuth flow (mock login function), custom model creation.

### 1D.4: Model Tier Resolution

**Reference:** `model-tiers.md`

Add to CortexAgent constructor:
- If `utilityModel === 'default'`: look up `UTILITY_MODEL_DEFAULTS[primaryModel.provider]`, resolve via `getModel()`
- If `utilityModel` is a `Model`: validate same provider as primary, use directly
- If provider not in defaults map: fall back to primary model (utility calls at full price)

Add to CortexAgent:
- `getUtilityModel(): Model` — returns the resolved utility model
- `utilityComplete(context)` — convenience wrapper using utility model

**Tests:** Default resolution for each known provider, explicit model override, same-provider constraint violation (error), unknown provider fallback.

### 1D.5: System Prompt Assembly

**Reference:** `system-prompt.md`

This was spec'd in Phase 1B.4 but depends on ProviderManager for platform detection details. Finalize here:

- Ensure `buildSystemPrompt()` uses auto-detected platform/shell/working directory
- Verify PowerShell discovery chain on Windows
- Verify `rebuildSystemPrompt()` preserves conversation history and slots

**Tests:** Cross-platform prompt assembly (mock `process.platform`), rebuild preserves state.

## Completion Criteria

- ProviderManager can list providers, models, initiate OAuth, validate API keys
- Model tiers resolve correctly (default mapping, explicit override, fallback)
- CortexModel branded type enforced at the type level
- System prompt assembles correctly with platform-specific environment section
- All modules have unit test coverage

## Files Created

| File | Purpose |
|------|---------|
| `src/provider-registry.ts` | Static provider data + utility model defaults |
| `src/model-wrapper.ts` | CortexModel branded type |
| `src/provider-manager.ts` | IProviderManager implementation |
| `tests/unit/provider-manager.test.ts` | Tests |
| `tests/unit/model-wrapper.test.ts` | Tests |
