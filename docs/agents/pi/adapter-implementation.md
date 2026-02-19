# Pi Adapter Implementation Plan

> **Status**: Planning
> **Packages**: `@mariozechner/pi-ai` (LLM abstraction), `@mariozechner/pi-agent-core` (agent loop)
> **Provider Key**: `pi`

---

## 1. Overview

Pi is the fourth agent provider in Animus, joining Claude, Codex, and OpenCode. Unlike the other three providers which each target a single LLM vendor, Pi is a **meta-provider** — one adapter that unlocks 20+ LLM providers through a unified abstraction layer.

### Strategic Value

Adding Pi gives Animus access to:
- **Google Gemini** (Gemini 2.5 Pro, Flash, etc.)
- **xAI Grok** (Grok 3, Grok 3 Mini)
- **Groq** (ultra-fast inference)
- **Cerebras** (ultra-fast inference)
- **AWS Bedrock** (Claude, Llama, Mistral via AWS)
- **OpenRouter** (aggregator for 100+ models)
- **Ollama** (local models, zero API cost)
- **Anthropic**, **OpenAI**, **Mistral**, **DeepSeek**, and more

This means a user running Animus with Pi configured can switch between providers by changing a model string, with no adapter code changes. The breadth is comparable to OpenCode's 75+ provider support, but with a fundamentally different architecture: Pi runs in-process as a library rather than as a client/server system.

### Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     @animus/agents                           │
│                                                              │
│  ┌───────────┐                                               │
│  │ PiAdapter  │                                              │
│  │            │──→ createSession() ──→ PiSession             │
│  └───────────┘                          │                    │
│                                         │                    │
│                     ┌───────────────────┘                    │
│                     ▼                                        │
│            ┌──────────────────┐                              │
│            │    Pi Agent       │  (from @mariozechner/       │
│            │                  │   pi-agent-core)             │
│            │  • agent loop    │                              │
│            │  • tool dispatch │                              │
│            │  • steer()       │                              │
│            │  • abort()       │                              │
│            └────────┬─────────┘                              │
│                     │                                        │
│            ┌────────┴─────────┐                              │
│            │   pi-ai LLM      │  (from @mariozechner/       │
│            │                  │   pi-ai)                     │
│            │  • streaming     │                              │
│            │  • thinking      │                              │
│            │  • tool calling  │                              │
│            │  • 20+ providers │                              │
│            └──────────────────┘                              │
└──────────────────────────────────────────────────────────────┘
```

**Key difference from other adapters:** Claude, Codex, and OpenCode all spawn external processes (CLI subprocesses or server processes). Pi runs entirely in-process as imported libraries. This means:
- No subprocess management, no stdio/JSONL protocol, no server lifecycle
- Direct function calls and event subscriptions
- Lower latency (no IPC overhead)
- Simpler error handling (no process crash recovery)

### Two-Package Architecture

- **`@mariozechner/pi-ai`** — Low-level LLM abstraction. Provides `convertToLlm()` to create a provider-specific LLM instance from a model string. Handles streaming, tool calling, thinking/reasoning, caching, and provider normalization. Comparable to Vercel AI SDK's provider layer.
- **`@mariozechner/pi-agent-core`** — Agent loop built on top of pi-ai. Provides `Agent` class with `prompt()`, `steer()`, `abort()`, event subscriptions, state management, and the critical `transformContext` hook. This is what PiSession wraps.

---

## 2. Exposing `transformContext` in the Adapter Model

This is the most architecturally significant addition Pi brings to the agent abstraction layer.

### The Problem

In Claude, Codex, and OpenCode, the system prompt is set once when the session is created (cold start). On warm ticks, the orchestrator sends only the user message — the system prompt is already baked into the running session. This is the `CompiledContext { systemPrompt: string | null, userMessage: string }` pattern, where `systemPrompt` is `null` for warm sessions.

Pi's `transformContext` hook fires **before every LLM call** within the agent loop and allows reshaping the entire context: system prompt, message history, tools, and thinking level. This is fundamentally different — the system prompt is not immutable after session creation.

### The Opportunity

`transformContext` enables capabilities that are impossible with the other adapters:
- **Dynamic system prompt updates** on warm sessions without cold restart
- **Message history pruning** (remove stale context before each LLM call)
- **Tool set changes** mid-session (add/remove tools based on conversation state)
- **Thinking level adjustment** per turn (use extended thinking only when needed)

### Design: ContextTransformer Abstraction

Add an optional `ContextTransformer` concept to the agent abstraction layer. This is a new cross-cutting capability, not Pi-specific in its interface — other adapters could implement it in the future.

#### New Types in `types.ts`

```typescript
// ============================================================================
// Context Transformation (Optional Capability)
// ============================================================================

/**
 * The context that can be reshaped before each LLM call.
 *
 * This represents the full conversational context as the LLM will see it.
 * Transformers can modify any field to reshape the context dynamically.
 */
export interface TransformableContext {
  /** The system prompt / instructions */
  systemPrompt: string;

  /** The conversation history */
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;

  /** Available tools (name + description + parameters) */
  tools?: Array<{
    name: string;
    description: string;
    parameters: unknown;
  }>;

  /** Thinking/reasoning level (provider-specific semantics) */
  thinkingLevel?: string;
}

/**
 * A function that reshapes the LLM context before each call.
 *
 * Called before every LLM invocation within the agent loop. The transformer
 * receives the current context and returns a (potentially modified) version.
 * Can be synchronous or asynchronous.
 *
 * Use cases:
 * - Updating system prompt with fresh emotional state or memories
 * - Pruning old messages to manage context window
 * - Adjusting tool availability based on conversation state
 * - Changing thinking level based on task complexity
 */
export type ContextTransformer = (
  context: TransformableContext,
) => TransformableContext | Promise<TransformableContext>;
```

#### Extension to `IAgentSession`

```typescript
export interface IAgentSession {
  // ... existing methods ...

  /**
   * Register a context transformer that fires before each LLM call.
   *
   * Only available when the adapter's capabilities include
   * `supportsContextTransform: true`. Calling this on an adapter that
   * doesn't support it is a no-op with a debug log.
   *
   * Pi: Wired to the Pi Agent's `transformContext` option.
   * Claude/Codex/OpenCode: Not implemented (no-op).
   */
  setContextTransformer?(transformer: ContextTransformer): void;
}
```

#### Extension to `AdapterCapabilities`

```typescript
export interface AdapterCapabilities {
  // ... existing flags ...

  /** Supports dynamic context transformation before each LLM call */
  supportsContextTransform: boolean;
}
```

### How It Changes the Context Builder Pattern

**Today (Claude/Codex/OpenCode):**
1. Cold start: Context Builder produces `CompiledContext { systemPrompt: "...", userMessage: "..." }`
2. Warm tick: Context Builder produces `CompiledContext { systemPrompt: null, userMessage: "..." }`
3. The system prompt is frozen in the warm session's context — stale persona, stale emotions, stale operational instructions

**With Pi (transformContext):**
1. Cold start: Context Builder produces `CompiledContext { systemPrompt: "...", userMessage: "..." }` (same as today)
2. Additionally, the Context Builder produces a `ContextTransformer` function
3. The orchestrator registers this transformer on the PiSession via `session.setContextTransformer(fn)`
4. On every warm tick, when Pi's agent loop makes an LLM call, the transformer fires and injects the latest system prompt, fresh emotional state, updated memories, etc.
5. The warm session gets fresh context every turn without a cold restart

**Coexistence:** The two approaches coexist. The orchestrator checks `hasCapability(provider, 'supportsContextTransform')`:
- If `true` (Pi): Register the transformer at session creation. The Context Builder still produces `CompiledContext` for the initial prompt, but the transformer handles subsequent context freshness.
- If `false` (Claude/Codex/OpenCode): Fall back to the existing cold/warm pattern. No behavioral change.

**Future migration path:** If Claude or other SDKs add context transformation support, the abstraction is ready. The orchestrator logic is capability-gated, not provider-gated.

### Context Builder Changes

The `IContextBuilder` interface gains a new method:

```typescript
interface IContextBuilder {
  // ... existing methods ...

  /**
   * Build a ContextTransformer function for providers that support it.
   *
   * The returned transformer, when called before each LLM invocation,
   * produces a fresh system prompt with current emotional state, recent
   * memories, and any other dynamic context. The message history and
   * tools are passed through unchanged (the agent loop manages those).
   *
   * Only called when the session's provider supports context transformation.
   */
  buildContextTransformer(params: MindContextParams): ContextTransformer;
}
```

The transformer function closes over the database access layer and fetches fresh state on each invocation. This means the system prompt is always current — no stale emotional state, no stale working memory.

---

## 3. Shared Schema Updates

### 3.1 `/packages/shared/src/schemas/common.ts`

Add `'pi'` to the `agentProviderSchema` enum:

```typescript
// Before
export const agentProviderSchema = z.enum(['claude', 'codex', 'opencode']);

// After
export const agentProviderSchema = z.enum(['claude', 'codex', 'opencode', 'pi']);
```

This propagates the `AgentProvider` type throughout the system (backend, frontend, agents package).

### 3.2 `/packages/agents/src/schemas.ts`

Add Pi-specific session configuration schema:

```typescript
/**
 * Pi-specific configuration options.
 *
 * Pi supports 20+ LLM providers through pi-ai's provider system.
 * The piProvider + piModel combination determines which LLM is used.
 */
export const piSessionConfigSchema = baseSessionConfigSchema.extend({
  provider: z.literal('pi'),

  /**
   * Pi provider identifier (e.g., 'google', 'xai', 'groq', 'cerebras',
   * 'openai', 'anthropic', 'bedrock', 'openrouter', 'ollama').
   * Maps to pi-ai's provider registry.
   */
  piProvider: z.string().optional(),

  /**
   * Pi model identifier within the provider (e.g., 'gemini-2.5-pro',
   * 'grok-3', 'llama-4-scout'). Combined with piProvider to form the
   * full model path: 'google/gemini-2.5-pro'.
   */
  piModel: z.string().optional(),

  /**
   * Thinking/reasoning level.
   * Pi normalizes thinking across providers into 5 levels.
   * Not all providers support all levels.
   */
  thinkingLevel: z.enum(['none', 'low', 'medium', 'high', 'max']).optional(),

  /**
   * Transport configuration for the LLM connection.
   * Most providers use 'fetch' (HTTP). Some support 'websocket'.
   */
  transport: z.enum(['fetch', 'websocket']).optional(),

  /**
   * Cache retention in seconds.
   * Controls how long cached prompts are retained (provider-dependent).
   */
  cacheRetention: z.number().positive().optional(),

  /**
   * Thinking token budgets per level.
   * Override the default thinking token allocation for each level.
   */
  thinkingBudgets: z.record(
    z.enum(['low', 'medium', 'high', 'max']),
    z.number().positive(),
  ).optional(),

  /** Session ID to resume (serialized agent state) */
  resume: z.string().optional(),
});
```

Add to the discriminated union:

```typescript
// Before
export const agentSessionConfigSchema = z.discriminatedUnion('provider', [
  claudeConfigSchema,
  codexConfigSchema,
  opencodeConfigSchema,
]);

// After
export const agentSessionConfigSchema = z.discriminatedUnion('provider', [
  claudeConfigSchema,
  codexConfigSchema,
  opencodeConfigSchema,
  piSessionConfigSchema,
]);
```

Add exported types:

```typescript
export type PiConfig = z.infer<typeof piSessionConfigSchema>;
```

### 3.3 `/packages/agents/src/types.ts`

Add Pi-specific fields to `AgentSessionConfig`:

```typescript
export interface AgentSessionConfig {
  // ... existing fields ...

  // Pi-specific
  /** Pi LLM provider (e.g., 'google', 'xai', 'groq') */
  piProvider?: string;
  /** Pi model within the provider (e.g., 'gemini-2.5-pro') */
  piModel?: string;
  /** Pi thinking level ('none' | 'low' | 'medium' | 'high' | 'max') */
  thinkingLevel?: string;
  /** Pi transport type ('fetch' | 'websocket') */
  transport?: string;
  /** Pi cache retention in seconds */
  cacheRetention?: number;
  /** Pi thinking token budgets per level */
  thinkingBudgets?: Record<string, number>;
}
```

Add the `ContextTransformer` types and `supportsContextTransform` capability (as detailed in section 2).

### 3.4 `/packages/agents/src/capabilities.ts`

Add `supportsContextTransform: false` to all existing capability constants, add `PI_CAPABILITIES`, and update `getCapabilities()` / `hasCapability()`.

See section 11 for the full `PI_CAPABILITIES` declaration.

---

## 4. PiAdapter Implementation

**File:** `/packages/agents/src/adapters/pi.ts`

```typescript
class PiAdapter extends BaseAdapter {
  readonly provider: AgentProvider = 'pi';
  readonly capabilities: AdapterCapabilities = PI_CAPABILITIES;

  // Dynamic imports — Pi packages are optional peer dependencies
  private piAi: typeof import('@mariozechner/pi-ai') | null = null;
  private piAgentCore: typeof import('@mariozechner/pi-agent-core') | null = null;

  constructor(options?: AdapterOptions) {
    super(options);
    this.initLogger(options);
  }

  /**
   * Check if Pi is configured with valid credentials for ANY provider.
   *
   * Pi supports many LLM providers, each with its own auth. We check
   * for common environment variables across providers. If any provider
   * has credentials, Pi is considered configured.
   */
  isConfigured(): boolean {
    const envKeys = [
      'ANTHROPIC_API_KEY',       // Anthropic (Claude via Pi)
      'OPENAI_API_KEY',          // OpenAI
      'GEMINI_API_KEY',          // Google Gemini
      'GOOGLE_API_KEY',          // Google (alternative)
      'XAI_API_KEY',             // xAI (Grok)
      'GROQ_API_KEY',            // Groq
      'CEREBRAS_API_KEY',        // Cerebras
      'MISTRAL_API_KEY',         // Mistral
      'DEEPSEEK_API_KEY',        // DeepSeek
      'OPENROUTER_API_KEY',      // OpenRouter
      'AWS_ACCESS_KEY_ID',       // AWS Bedrock
    ];

    // Any provider with credentials means Pi is usable
    const hasApiKey = envKeys.some(key => !!process.env[key]);
    if (hasApiKey) return true;

    // Ollama doesn't need API keys — check if it's reachable
    // (deferred to runtime, assume configured if OLLAMA_BASE_URL is set)
    if (process.env['OLLAMA_BASE_URL'] || process.env['OLLAMA_HOST']) {
      return true;
    }

    this.logger.debug('Pi not configured — no provider credentials found');
    return false;
  }

  /**
   * Load Pi packages dynamically.
   */
  private async loadSDKs(): Promise<void> {
    if (this.piAi && this.piAgentCore) return;

    try {
      this.piAi = await import('@mariozechner/pi-ai');
    } catch (error) {
      throw new AgentError({
        code: 'SDK_LOAD_FAILED',
        message: 'Failed to load @mariozechner/pi-ai. Is it installed?',
        category: 'invalid_input',
        severity: 'fatal',
        provider: 'pi',
        cause: error instanceof Error ? error : undefined,
      });
    }

    try {
      this.piAgentCore = await import('@mariozechner/pi-agent-core');
    } catch (error) {
      throw new AgentError({
        code: 'SDK_LOAD_FAILED',
        message: 'Failed to load @mariozechner/pi-agent-core. Is it installed?',
        category: 'invalid_input',
        severity: 'fatal',
        provider: 'pi',
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  /**
   * Create a new Pi session.
   */
  async createSession(config: AgentSessionConfig): Promise<IAgentSession> {
    this.validateConfig(config);

    if (config.provider !== this.provider) {
      throw new AgentError({
        code: 'PROVIDER_MISMATCH',
        message: `Config provider "${config.provider}" does not match adapter provider "${this.provider}"`,
        category: 'invalid_input',
        severity: 'fatal',
        provider: this.provider,
      });
    }

    if (!this.isConfigured()) {
      throw new AgentError({
        code: 'MISSING_CREDENTIALS',
        message: 'No Pi provider credentials configured. Set an API key for at least one provider.',
        category: 'authentication',
        severity: 'fatal',
        provider: 'pi',
      });
    }

    await this.loadSDKs();

    // 1. Resolve the model string: "provider/model" format
    //    from piProvider + piModel config or model field
    // 2. Create the pi-ai LLM instance via convertToLlm()
    // 3. Convert MCP tools from Zod schemas to Pi's AgentTool format
    // 4. Create Pi Agent instance with tools, transformContext wiring
    // 5. Return new PiSession wrapping the agent

    const session = new PiSession(
      this.piAi!,
      this.piAgentCore!,
      config,
      this.logger,
    );

    const initialId = session.id;
    this.trackSession(session);

    session.onEvent(async (event) => {
      if (event.type === 'session_end') {
        this.untrackSession(session.id);
        this.untrackSession(initialId);
      }
    });

    return session;
  }

  /**
   * List available models from pi-ai's provider registry.
   */
  async listModels(): Promise<ModelInfo[]> {
    await this.loadSDKs();

    // Use pi-ai's getProviders() and getModels() to enumerate
    // available models across all configured providers.
    // Return as ModelInfo[] with provider prefix: "google/gemini-2.5-pro"
    const providers = this.piAi!.getProviders();
    const models: ModelInfo[] = [];

    for (const provider of providers) {
      const providerModels = this.piAi!.getModels(provider.id);
      for (const model of providerModels) {
        models.push({
          id: `${provider.id}/${model.id}`,
          name: model.name ?? `${provider.name} ${model.id}`,
        });
      }
    }

    return models;
  }
}
```

---

## 5. PiSession Implementation

```typescript
class PiSession extends BaseSession {
  readonly provider: AgentProvider = 'pi';

  private piAi: typeof import('@mariozechner/pi-ai');
  private piAgentCore: typeof import('@mariozechner/pi-agent-core');
  private agent: Agent | null = null;  // from pi-agent-core
  private contextTransformer?: ContextTransformer;
  private sessionId: string;
  private abortController: AbortController | null = null;
  private verbose: boolean;

  constructor(
    piAi: typeof import('@mariozechner/pi-ai'),
    piAgentCore: typeof import('@mariozechner/pi-agent-core'),
    config: AgentSessionConfig,
    logger: Logger,
  ) {
    super(config, logger);
    this.piAi = piAi;
    this.piAgentCore = piAgentCore;
    this.sessionId = generateUUID();
    this.verbose = config.verbose ?? false;
  }

  get id(): string {
    return `pi:${this.sessionId}`;
  }

  /**
   * Register a context transformer.
   * Wired to Pi Agent's transformContext option.
   */
  setContextTransformer(transformer: ContextTransformer): void {
    this.contextTransformer = transformer;
    this.logger.debug('Context transformer registered', { sessionId: this.id });
  }

  /**
   * Initialize the Pi Agent lazily on first prompt.
   */
  private async ensureAgent(): Promise<Agent> {
    if (this.agent) return this.agent;

    // 1. Resolve model from config
    const modelPath = this.resolveModelPath();

    // 2. Create LLM instance via pi-ai
    const llm = this.piAi.convertToLlm(modelPath, {
      thinkingLevel: this.config.thinkingLevel,
      cacheRetention: this.config.cacheRetention,
      thinkingBudgets: this.config.thinkingBudgets,
    });

    // 3. Convert MCP tools to Pi AgentTool format
    const tools = this.bridgeMcpTools();

    // 4. Create the Agent
    this.agent = new this.piAgentCore.Agent({
      llm,
      systemPrompt: this.resolveSystemPrompt(),
      tools,
      transformContext: this.contextTransformer
        ? async (ctx) => {
            const transformed = await this.contextTransformer!(ctx);
            return transformed;
          }
        : undefined,
      abortSignal: this.abortController?.signal,
    });

    // 5. Subscribe to agent events
    this.subscribeToAgentEvents();

    return this.agent;
  }

  /**
   * Send a prompt and get a response.
   */
  async prompt(input: string, options?: PromptOptions): Promise<AgentResponse> {
    this.assertActive();

    const timeout = options?.timeoutMs ?? this.config.timeoutMs ?? 300000;
    this.abortController = new AbortController();

    const timer = setTimeout(() => {
      this.abortController?.abort();
    }, timeout);

    const startTime = Date.now();

    try {
      const agent = await this.ensureAgent();

      await this.emit(
        this.createEvent('input_received', { content: input, type: 'text' }),
      );

      // Pi's agent.prompt() runs the full agent loop:
      // LLM call → tool execution → LLM call → ... → final response
      const result = await agent.prompt(input);

      const totalMs = Date.now() - startTime;

      // Build response from agent state
      return this.buildResponse(result, totalMs);
    } catch (error) {
      if (this.abortController?.signal.aborted) {
        throw new AgentError({
          code: 'TIMEOUT',
          message: `Prompt timed out after ${timeout}ms`,
          category: 'timeout',
          severity: 'retry',
          provider: 'pi',
          sessionId: this.id,
        });
      }
      throw wrapError(error, 'pi', this.id);
    } finally {
      clearTimeout(timer);
      this.abortController = null;
    }
  }

  /**
   * Send a prompt with streaming response.
   */
  async promptStreaming(
    input: string,
    onChunk: (chunk: string, meta: StreamChunkMeta) => void,
    options?: PromptOptions,
  ): Promise<AgentResponse> {
    this.assertActive();

    const timeout = options?.timeoutMs ?? this.config.timeoutMs ?? 300000;
    this.abortController = new AbortController();

    const timer = setTimeout(() => {
      this.abortController?.abort();
    }, timeout);

    const startTime = Date.now();
    let accumulated = '';
    let turnIndex = 0;
    const turns: TurnResult[] = [];

    try {
      const agent = await this.ensureAgent();

      await this.emit(
        this.createEvent('input_received', { content: input, type: 'text' }),
      );
      await this.emit(this.createEvent('response_start', {}));

      // Subscribe to streaming events from the agent
      // Pi emits events via its EventEmitter-style interface
      const eventUnsubscribe = agent.on('event', async (event) => {
        switch (event.type) {
          case 'message_update': {
            if (event.delta?.type === 'text_delta') {
              const chunk = event.delta.text ?? '';
              accumulated += chunk;
              onChunk(chunk, { turnIndex });

              await this.emit(
                this.createEvent('response_chunk', {
                  content: chunk,
                  accumulated,
                }),
              );
            }
            break;
          }

          case 'message_end': {
            turns.push({
              turnIndex,
              text: event.text ?? '',
              hasToolCalls: event.toolCalls?.length > 0,
              hasThinking: event.hasThinking ?? false,
              toolNames: event.toolCalls?.map(t => t.name) ?? [],
            });

            await this.emit(
              this.createEvent('turn_end', {
                turnIndex,
                text: event.text ?? '',
                hasToolCalls: event.toolCalls?.length > 0,
                hasThinking: event.hasThinking ?? false,
                toolNames: event.toolCalls?.map(t => t.name) ?? [],
              }),
            );
            turnIndex++;
            break;
          }

          case 'tool_execution_start': {
            await this.emit(
              this.createEvent('tool_call_start', {
                toolName: event.toolName,
                toolInput: event.toolInput ?? {},
                toolCallId: event.toolCallId ?? generateUUID(),
              }),
            );
            break;
          }

          case 'tool_execution_end': {
            await this.emit(
              this.createEvent('tool_call_end', {
                toolCallId: event.toolCallId ?? '',
                toolName: event.toolName,
                output: event.output,
                durationMs: event.durationMs ?? 0,
              }),
            );
            break;
          }
        }
      });

      // Run the agent prompt
      const result = await agent.prompt(input);

      // Clean up event subscription
      eventUnsubscribe();

      const totalMs = Date.now() - startTime;
      const response = this.buildResponse(result, totalMs, turns);

      await this.emit(
        this.createEvent('response_end', {
          content: response.content,
          finishReason: response.finishReason,
        }),
      );

      return response;
    } catch (error) {
      if (this.abortController?.signal.aborted) {
        throw new AgentError({
          code: 'TIMEOUT',
          message: `Prompt timed out after ${timeout}ms`,
          category: 'timeout',
          severity: 'retry',
          provider: 'pi',
          sessionId: this.id,
        });
      }
      throw wrapError(error, 'pi', this.id);
    } finally {
      clearTimeout(timer);
      this.abortController = null;
    }
  }

  /**
   * Cancel the current operation.
   */
  async cancel(): Promise<void> {
    this.logger.info('Cancelling session', { sessionId: this.id });
    this.abortController?.abort();
    // Pi Agent supports abort via AbortController
  }

  /**
   * End the session.
   */
  async end(): Promise<void> {
    if (!this._isActive) return;

    this.logger.info('Ending session', { sessionId: this.id });

    await this.cancel();
    this._isActive = false;
    this.agent = null;

    await this.emit(
      this.createEvent('session_end', {
        reason: 'completed',
        totalDurationMs: this.getDurationMs(),
      }),
    );

    if (this.hooks.onSessionEnd) {
      await this.hooks.onSessionEnd({
        sessionId: this.id,
        reason: 'completed',
        totalDurationMs: this.getDurationMs(),
      });
    }
  }

  /**
   * Inject a message into a running prompt via Pi's steer() method.
   *
   * steer() is superior to Claude's injectMessage() for update_agent
   * because it explicitly interrupts tool execution and forces the
   * model to acknowledge the update.
   */
  injectMessage(content: string): void {
    if (!this.agent) {
      this.logger.warn('Cannot inject message — no active agent');
      return;
    }

    this.logger.info('Steering agent with injected message', {
      contentPreview: content.substring(0, 80),
    });

    this.agent.steer(content);
  }

  // ... private helper methods (resolveModelPath, resolveSystemPrompt,
  //     bridgeMcpTools, buildResponse, subscribeToAgentEvents) ...
}
```

---

## 6. Event Mapping

Map Pi's event types to our normalized `AgentEvent` types:

| Pi Event | Animus AgentEvent Type | Notes |
|---|---|---|
| `agent_start` | `session_start` | Emit with provider `'pi'`, model, config |
| `message_start` (role=assistant) | `response_start` | Beginning of an assistant message |
| `message_update` with `text_delta` | `response_chunk` | Call `onChunk` callback, accumulate text |
| `message_update` with `thinking_delta` | `thinking_start` / `thinking_end` | Track thinking state with a boolean flag. Emit `thinking_start` on first thinking delta, `thinking_end` when text deltas resume. |
| `message_end` (role=assistant) | `turn_end` | Include turnIndex, text, toolNames. Emit before tool_call_start events for consistency with Claude adapter behavior. |
| `tool_execution_start` | `tool_call_start` | Map `toolName`, `toolInput`, `toolCallId` |
| `tool_execution_end` (success) | `tool_call_end` | Map output, durationMs |
| `tool_execution_end` (error) | `tool_error` | Map error message, set `isRetryable` based on error type |
| `turn_end` | `turn_end` | Aggregate turnIndex, text, toolNames used in this turn |
| `agent_end` | (internal) | Resolve the `prompt()` / `promptStreaming()` promise. Do not emit as a public event — the session may continue. |
| `error` | `error` | Map to `AgentError` via `wrapError()`. Classify by error type (see section 12). |

### Thinking State Machine

Pi's thinking events require state tracking because the SDK emits deltas rather than discrete start/end events:

```
idle ──(thinking_delta)──→ thinking ──(text_delta)──→ idle
                              │                          │
                              └──(thinking_delta)────────┘
                                    (still thinking)
```

When transitioning from `idle` to `thinking`: emit `thinking_start`.
When transitioning from `thinking` to `idle` (first `text_delta` after `thinking_delta`s): emit `thinking_end` with `thinkingDurationMs` and accumulated thinking content if available.

---

## 7. MCP Tool Bridging

Pi's agent loop uses its own `AgentTool` format based on TypeBox schemas. Our MCP tools use Zod schemas. A bridge layer converts between them.

### Conversion Strategy

Pi depends on `zod-to-json-schema` internally (it's a transitive dependency of pi-ai). We can leverage this for the conversion chain:

```
Zod Schema → JSON Schema (via zod-to-json-schema) → TypeBox (via Type.Unsafe())
```

### Bridge Function

```typescript
import { Type } from '@sinclair/typebox';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Bridge an MCP tool definition to Pi's AgentTool format.
 *
 * MCP tools are defined with Zod schemas for input validation.
 * Pi's agent loop expects TypeBox schemas for tool parameters.
 * Tool execution routes through the MCP server handler.
 */
function bridgeMcpToolToPiTool(
  mcpTool: McpToolDefinition,
  mcpServer: McpServerInterface,
): AgentTool {
  // Convert Zod → JSON Schema
  const jsonSchema = zodToJsonSchema(mcpTool.inputSchema, {
    target: 'openApi3',
  });

  // Wrap JSON Schema as TypeBox (Type.Unsafe preserves the schema as-is)
  const typeboxSchema = Type.Unsafe(jsonSchema);

  return {
    name: mcpTool.name,
    label: mcpTool.name,
    description: mcpTool.description,
    parameters: typeboxSchema,
    execute: async (args: unknown, update?: (msg: string) => void) => {
      // Route execution through the MCP server handler
      const result = await mcpServer.callTool(mcpTool.name, args);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    },
  };
}
```

### Key Considerations

- **The MCP server lifecycle is managed by the backend**, not the adapter. The adapter receives tool definitions and wraps them as Pi AgentTools. Tool execution goes through the backend's MCP server handler.
- **Error handling in tool execution** is handled by Pi's agent loop — if `execute` throws, the error is returned to the LLM as a tool error result, and the agent loop continues. This matches our existing behavior for other adapters.
- **Tool filtering by contact permission tier** happens before tools are passed to the adapter. The adapter receives only the tools the current contact is allowed to use.

---

## 8. Structured Output Strategy

Pi has no native structured output enforcement (no equivalent to Claude's `outputFormat` or Codex's `outputSchema`). This is not a gap because we use cognitive MCP tools instead of native structured output.

### Current Approach: Cognitive MCP Tools

The mind session uses two in-process MCP tools (`record_thought` and `record_cognitive_state`) to capture structured cognitive state while the model speaks naturally. The model never outputs raw JSON — all structured data flows through Zod-validated MCP tool inputs.

### Strategy for Pi

1. **MCP tool registration** — Pi's in-process architecture supports MCP tool registration natively. The cognitive MCP server (`createSdkMcpServer()`) can be attached to Pi sessions the same way it attaches to Claude sessions.
2. **Phase-based streaming** — Reply text streams naturally between tool calls. The `onChunk` callback checks the cognitive phase (`'replying'`) before emitting to the frontend.
3. **Validation** — Tool inputs are Zod-validated at call time. No post-hoc JSON parsing or fallback chains needed. On agent failure, `safeMindOutput()` provides a minimal valid output.
4. **No adapter-level changes** — The Pi adapter does not need to know about cognitive state or MindOutput. It handles MCP tool calls via the standard SDK mechanism, and the backend's cognitive tool handlers accumulate state.

---

## 9. Warm Session Semantics

Pi warm sessions work differently from Claude, and the difference is an advantage.

### Claude Warm Sessions

- CLI subprocess persists with full conversation in its context window
- System prompt set once on cold start, immutable thereafter
- Warm ticks append user messages — stale context accumulates
- No way to reshape the conversation history or update the system prompt

### Pi Warm Sessions

- Agent instance persists in memory with messages in `agent.state.messages`
- `transformContext` fires before every LLM call, allowing full context reshaping
- The system prompt can be updated, messages can be pruned, tools can be adjusted
- No stale accumulation — every LLM call sees fresh context

### Implementation

For the PiSession warm session lifecycle:

| Phase | Behavior |
|---|---|
| **Cold start** | Create new Agent with system prompt from Context Builder. Register `transformContext` if available. Run first prompt. |
| **Warm tick** | Call `agent.prompt(userMessage)` on the existing Agent. The agent adds the message to its history. `transformContext` fires before the LLM call, injecting fresh system prompt, emotions, memories. |
| **Session warmth tracking** | Works identically to other adapters. The AgentManager tracks last activity time and warmth window (default 15 min). |
| **Context budget** | When accumulated tokens exceed the budget (70% of context window), the orchestrator ends the session. Next trigger creates a fresh cold session. However, Pi's `transformContext` could also prune messages proactively, potentially extending session lifetime. |
| **Cold restart** | Agent is set to `null`, garbage collected. New Agent created on next prompt. |

### Orchestrator Behavior

The orchestrator sends `systemPrompt: null` for warm ticks (same as Claude). The PiSession internally holds the full system prompt and either:
- Passes it to the Agent on cold start, or
- Injects it via `transformContext` on every LLM call (keeping it fresh)

This is hidden from the orchestrator — from its perspective, Pi warm sessions work identically to Claude warm sessions.

---

## 10. Sub-Agent Support

Our custom orchestration layer manages sub-agent lifecycle independently of the SDK. Pi sub-agents work identically to Claude/Codex/OpenCode sub-agents from the orchestrator's perspective.

### Lifecycle

| Step | Implementation |
|---|---|
| **Spawn** | `orchestrator.spawnAgent()` calls `manager.createSession({ provider: 'pi', ... })`. PiAdapter creates a PiSession wrapping a new Agent instance. |
| **Prompt** | `session.prompt(instructions)` — Pi Agent runs its loop, executes tools, returns result. |
| **Update** | `session.injectMessage(context)` maps to `agent.steer(message)`. Pi's `steer()` explicitly interrupts tool execution and forces the model to acknowledge the update. This is better than Claude's approach for `update_agent`. |
| **Cancel** | `session.cancel()` calls `agent.abort()` via AbortController. Clean cancellation. |
| **Complete** | Agent finishes naturally. Orchestrator stores result, triggers heartbeat tick. |

### No Native Sub-Agent Spawning

Pi does not have a native sub-agent mechanism. This is fine — our orchestrator handles all sub-agent coordination (same as Codex and OpenCode). The one code path for all providers principle holds.

### `steer()` Advantage

Pi's `steer()` is actually the best `update_agent` implementation across all four adapters:
- **Claude**: `injectMessage()` pushes a user message into the async iterable. The message is queued and processed when the CLI's `stream_input` task reads it. There is no explicit interruption of in-progress tool execution.
- **Pi**: `steer()` explicitly interrupts the current turn, injects the message, and forces the model to acknowledge the new information before continuing. This guarantees the update is processed promptly.

---

## 11. Capabilities Declaration

```typescript
export const PI_CAPABILITIES: AdapterCapabilities = {
  /** Pi Agent supports abort via AbortController */
  canCancel: true,

  /** No pre-tool-use hook mechanism in Pi */
  canBlockInPreToolUse: false,

  /** No tool input modification hooks in Pi */
  canModifyToolInput: false,

  /** No native sub-agents — our orchestrator handles it */
  supportsSubagents: false,

  /** Pi normalizes thinking across providers (5 levels) */
  supportsThinking: true,

  /** Provider-dependent, but many Pi providers support vision */
  supportsVision: true,

  /** Full streaming support via pi-ai's streaming layer */
  supportsStreaming: true,

  /** Via Agent.state.messages serialization/deserialization */
  supportsResume: true,

  /** No fork mechanism in Pi */
  supportsFork: false,

  /** NEW — Pi's transformContext hook */
  supportsContextTransform: true,

  /** Unlimited by Pi itself — limited by provider rate limits */
  maxConcurrentSessions: null,

  /** Dynamic — populated from pi-ai's model registry at runtime */
  supportedModels: [],
};
```

### Updating Existing Capabilities

All existing capability constants need `supportsContextTransform: false`:

```typescript
// In CLAUDE_CAPABILITIES:
supportsContextTransform: false,

// In CODEX_CAPABILITIES:
supportsContextTransform: false,

// In OPENCODE_CAPABILITIES:
supportsContextTransform: false,
```

### Updating `getCapabilities()` and `hasCapability()`

```typescript
export function getCapabilities(
  provider: 'claude' | 'codex' | 'opencode' | 'pi',
): AdapterCapabilities {
  switch (provider) {
    case 'claude':   return CLAUDE_CAPABILITIES;
    case 'codex':    return CODEX_CAPABILITIES;
    case 'opencode': return OPENCODE_CAPABILITIES;
    case 'pi':       return PI_CAPABILITIES;
  }
}

export function hasCapability(
  provider: 'claude' | 'codex' | 'opencode' | 'pi',
  capability: keyof AdapterCapabilities,
): boolean {
  // ... same implementation, just with updated provider type
}
```

---

## 12. Error Handling

Map Pi errors to our `AgentError` system following the four-tier strategy from `docs/architecture/heartbeat.md`.

### Error Classification

| Pi Error Condition | AgentError Code | Category | Severity | Handling |
|---|---|---|---|---|
| Context window overflow (`isContextOverflow()`) | `CONTEXT_OVERFLOW` | `resource_exhausted` | `retry` | Tier 1: Force cold restart, retry with fresh context |
| Rate limit (429) | `RATE_LIMITED` | `rate_limit` | `retry` | Tier 1: Auto-retry with exponential backoff |
| Network/connection error | `NETWORK_ERROR` | `network` | `retry` | Tier 1: Auto-retry |
| Provider API error (5xx) | `API_ERROR` | `server_error` | `retry` | Tier 1: Auto-retry |
| Authentication failure (401/403) | `AUTH_FAILED` | `authentication` | `fatal` | Tier 4: Disable provider, log error |
| Tool execution error | (handled by Pi agent loop) | — | — | Pi returns error to LLM, agent continues |
| AbortController abort | `CANCELLED` | `cancelled` | `recoverable` | Normal cancellation flow |
| SDK load failure | `SDK_LOAD_FAILED` | `invalid_input` | `fatal` | Tier 4: Pi unavailable |
| Invalid model/provider | `INVALID_MODEL` | `invalid_input` | `fatal` | Immediate failure |
| Unknown/unexpected error | `UNKNOWN_ERROR` | `unknown` | `recoverable` | Wrap via `wrapError()` |

### Context Overflow Detection

Pi provides `isContextOverflow()` utility. When detected:
1. Wrap as `AgentError` with category `resource_exhausted`, severity `retry`
2. The orchestrator catches this and forces a cold restart of the mind session
3. The next tick creates a fresh session with full context budget

This is better than Claude's behavior where context overflow is only detected when the session hits the limit. Pi can detect it proactively via `transformContext`.

---

## 13. Session ID Lifecycle

Pi does not have native session IDs like Claude (which gets them from the CLI subprocess's `system.init` message). We generate our own.

### ID Lifecycle

| Phase | ID Format | Notes |
|---|---|---|
| **createSession()** returns | `pi:pending-{uuid}` | Standard pending ID pattern (matches Claude/Codex/OpenCode) |
| **First prompt** | `pi:{uuid}` | Stabilized. The UUID is generated by us, not by Pi. |
| **Subsequent prompts** | `pi:{uuid}` | Same ID for session lifetime |
| **Resume** | `pi:{uuid}` | Reconstruct Agent from serialized `agent.state.messages` |

### Resume Implementation

Pi Agent state can be serialized via `agent.state.messages`. For crash recovery:

1. Before each tick's EXECUTE stage, serialize `agent.state.messages` to `heartbeat_state.mind_session_state` (JSON column in `heartbeat.db`)
2. On crash recovery, if `mind_session_id` starts with `pi:`, deserialize the messages and reconstruct the Agent
3. The reconstructed Agent has full conversation history but loses any in-flight tool execution state

This is acceptable for the heartbeat system — the mind session is designed to handle cold restarts gracefully.

---

## 14. Registration and Exports

### Files to Create

| File | Contents |
|---|---|
| `/packages/agents/src/adapters/pi.ts` | `PiAdapter` class + `PiSession` class + Pi SDK type declarations + MCP tool bridging helpers |

### Files to Modify

| File | Changes |
|---|---|
| `/packages/shared/src/schemas/common.ts` | Add `'pi'` to `agentProviderSchema` z.enum |
| `/packages/agents/src/schemas.ts` | Add `piSessionConfigSchema`, add to discriminated union, export `PiConfig` type |
| `/packages/agents/src/types.ts` | Add Pi config fields to `AgentSessionConfig`, add `TransformableContext` and `ContextTransformer` types, add optional `setContextTransformer` to `IAgentSession`, add `supportsContextTransform` to `AdapterCapabilities` |
| `/packages/agents/src/capabilities.ts` | Add `PI_CAPABILITIES`, add `supportsContextTransform: false` to existing constants, update `getCapabilities()` and `hasCapability()` signatures and implementation |
| `/packages/agents/src/manager.ts` | Import `PiAdapter`, add to `registerDefaultAdapters()` |
| `/packages/agents/src/index.ts` | Export `PiAdapter`, `PI_CAPABILITIES`, `piSessionConfigSchema`, `PiConfig` |
| `/packages/agents/src/errors.ts` | No changes — existing error types cover Pi's error cases |
| `/packages/backend/src/heartbeat/mind-session.ts` | Add Pi-specific session creation path: check `hasCapability(provider, 'supportsContextTransform')`, if true call `session.setContextTransformer(contextBuilder.buildContextTransformer(params))` |
| `/packages/backend/src/heartbeat/agent-orchestrator.ts` | Add Pi-specific sub-agent creation: bridge MCP tools directly as AgentTools instead of passing MCP server configs |

### Manager Registration

```typescript
// In manager.ts registerDefaultAdapters():
private registerDefaultAdapters(logger?: Logger): void {
  this.registerAdapter(new ClaudeAdapter({ logger }));
  this.registerAdapter(new CodexAdapter({ logger }));
  this.registerAdapter(new OpenCodeAdapter({ logger }));
  this.registerAdapter(new PiAdapter({ logger }));   // NEW
}
```

### Package Exports

```typescript
// In index.ts:

// Adapters
export { PiAdapter } from './adapters/pi.js';

// Capabilities
export { PI_CAPABILITIES } from './capabilities.js';

// Schemas
export { piSessionConfigSchema, type PiConfig } from './schemas.js';
```

---

## 15. Testing Strategy

### Unit Tests

| Test Suite | File | Coverage |
|---|---|---|
| PiAdapter | `adapters/pi.test.ts` | `isConfigured()` with various env vars, `createSession()` validation, `listModels()` with mock pi-ai |
| PiSession | `adapters/pi-session.test.ts` | `prompt()`, `promptStreaming()`, `cancel()`, `end()`, `injectMessage()`, `setContextTransformer()` |
| Event mapping | `adapters/pi-events.test.ts` | Each Pi event type maps correctly to Animus event type. Thinking state machine transitions. |
| MCP tool bridging | `adapters/pi-tools.test.ts` | Zod-to-TypeBox conversion, tool execution routing, error handling in tool execution |
| Capabilities | `capabilities.test.ts` | Update existing tests for `supportsContextTransform`, add Pi provider |
| Schemas | `schemas.test.ts` | `piSessionConfigSchema` validation (valid/invalid configs), discriminated union with all 4 providers |

### Integration Tests

| Test | Description |
|---|---|
| Full session lifecycle | Create session, prompt, stream, cancel, end — with mock Pi Agent |
| Context transformer flow | Register transformer, verify it fires before each LLM call, verify context is reshaped |
| Warm session behavior | Multiple prompts on same session, verify agent state accumulates |
| Event emission ordering | Verify events emit in correct order (session_start before input_received, turn_end before tool_call_start, etc.) |
| Error recovery | Simulate context overflow, network errors, abort — verify correct AgentError classification |

### E2E Tests (Requires Real Provider)

| Test | Description |
|---|---|
| Ollama local | Full prompt/stream cycle against a local Ollama instance (no API key needed) |
| Google Gemini | Full prompt/stream cycle against Gemini API |
| Multi-provider | Switch between providers within the same test run |

### Mocking Strategy

Pi's packages can be mocked at the dynamic import boundary:

```typescript
// In tests, mock the dynamic imports
vi.mock('@mariozechner/pi-ai', () => ({
  convertToLlm: vi.fn().mockReturnValue(mockLlm),
  getProviders: vi.fn().mockReturnValue([...]),
  getModels: vi.fn().mockReturnValue([...]),
}));

vi.mock('@mariozechner/pi-agent-core', () => ({
  Agent: vi.fn().mockImplementation(() => mockAgent),
}));
```

---

## 16. Dependencies

### New Dependencies

```json
{
  "@mariozechner/pi-ai": "^0.53.0",
  "@mariozechner/pi-agent-core": "^0.53.0"
}
```

These are **optional peer dependencies** in `@animus/agents`, dynamically imported on first use (same pattern as `@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk`, and `@opencode-ai/sdk`).

### Package.json Changes

In `/packages/agents/package.json`:

```json
{
  "peerDependencies": {
    "@anthropic-ai/claude-agent-sdk": "...",
    "@openai/codex-sdk": "...",
    "@opencode-ai/sdk": "...",
    "@mariozechner/pi-ai": "^0.53.0",
    "@mariozechner/pi-agent-core": "^0.53.0"
  },
  "peerDependenciesMeta": {
    "@mariozechner/pi-ai": { "optional": true },
    "@mariozechner/pi-agent-core": { "optional": true }
  }
}
```

### Transitive Dependencies

Pi's packages bring their own dependencies (TypeBox, provider-specific SDKs, etc.). These are managed by pi-ai/pi-agent-core and do not need to be declared in our package.json. The key transitive dependency is:
- `zod-to-json-schema` — already a pi-ai dependency, used for our MCP tool bridging

---

## 17. Build Sequence

Implementation should proceed in this order, with each step building on the previous:

| Step | Scope | Description |
|---|---|---|
| **1** | Schema updates | Add `'pi'` to `agentProviderSchema` (shared), add `piSessionConfigSchema` (agents) |
| **2** | Types and interfaces | Add Pi config fields to `AgentSessionConfig`, add `ContextTransformer` types, add `supportsContextTransform` to `AdapterCapabilities`, add optional `setContextTransformer` to `IAgentSession` |
| **3** | Capabilities | Add `PI_CAPABILITIES`, add `supportsContextTransform: false` to existing constants, update `getCapabilities()` and `hasCapability()` |
| **4** | PiAdapter + PiSession | Core implementation — the adapter, session, SDK type declarations |
| **5** | Event mapping | Map Pi events to Animus events, implement thinking state machine |
| **6** | MCP tool bridging | Zod-to-TypeBox conversion, tool execution routing |
| **7** | Manager + exports | Add to `registerDefaultAdapters()`, export from index.ts |
| **8** | Backend integration | Update `mind-session.ts` (context transformer wiring), update `agent-orchestrator.ts` (Pi sub-agent creation) |
| **9** | Unit tests | Full test coverage for adapter, session, events, tools, capabilities, schemas |
| **10** | Integration tests | Mock-based full lifecycle tests |

### Estimated Effort

- Steps 1-3 (schema/types/capabilities): Small, mechanical changes across multiple files
- Steps 4-6 (core adapter): Bulk of the work — PiSession is the most complex piece
- Steps 7-8 (registration/backend): Moderate — requires understanding of heartbeat pipeline
- Steps 9-10 (tests): Substantial — following the project's testing requirements

---

## Comparison to Existing Adapters

| Aspect | Claude | Codex | OpenCode | Pi |
|---|---|---|---|---|
| **Architecture** | CLI subprocess | CLI subprocess (Rust) | Client/Server (REST) | In-process library |
| **Providers** | Anthropic only | OpenAI only | 75+ via AI SDK | 20+ via pi-ai |
| **Streaming** | Async generator | Event iterator | SSE subscription | Event emitter |
| **Session Model** | ID from CLI init | Thread-based | Server-side | In-memory Agent state |
| **Cancel** | AbortController | Not supported | session.abort() | AbortController |
| **Context Transform** | Not supported | Not supported | Not supported | transformContext hook |
| **Message Injection** | AsyncIterable push | Not supported | Not supported | agent.steer() (best) |
| **Structured Output** | outputFormat (unreliable) | outputSchema | Prompt injection | Prompt injection |
| **Sub-agents** | Task tool (native) | Not native | @mentions | Not native |
| **Resume** | Session ID | Thread ID | Session ID | Serialized messages |
| **Thinking** | maxThinkingTokens | Reasoning items | Reasoning parts | 5-level normalization |

---

## Related Documents

- `docs/agents/architecture-overview.md` — SDK comparison and adapter design principles
- `docs/architecture/heartbeat.md` — The tick pipeline that uses the adapter
- `docs/architecture/context-builder.md` — Context assembly, token budgets, persona compilation
- `docs/architecture/agent-orchestration.md` — Sub-agent lifecycle and prompt templates
- `docs/architecture/mcp-tools.md` — MCP tool definitions and permission filtering
- `docs/agents/plugin-extension-systems.md` — Plugin and extension systems across SDKs
