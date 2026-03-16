# Model Tiers

> **STATUS: RESEARCH** - Not yet implemented.

Cortex uses two model tiers: a **primary model** for all consumer-facing work and a **utility model** for internal operations the user never directly sees.

## Tiers

### Primary Model

The main model configured by the consumer. Used for:
- The agentic loop (tool use, reasoning, replies)
- THOUGHT phase (in the Animus mind)
- REFLECT phase (in the Animus mind)
- Any direct `agent.prompt()` calls

The consumer chooses this model based on their quality/cost preferences.

### Utility Model

A cheap, fast model for internal operations. Used for:
- WebFetch page summarization (the secondary LLM call)
- Auto-mode safety classifier (bash command classification)

Note: Compaction summarization uses the **primary model**, not the utility model. Conversation history summaries are the only record of what happened during agentic loops (tool calls, decisions, reasoning chains). Quality matters significantly here. See `compaction-strategy.md` for the rationale.

The user never sees utility model output directly. It powers behind-the-scenes operations where speed and cost matter more than peak quality.

## Configuration

```typescript
const agent = new CortexAgent({
  model: getModel('anthropic', 'claude-sonnet-4-6'),       // primary
  utilityModel: 'default',                                  // use provider default
  // or: utilityModel: getModel('anthropic', 'claude-haiku-4-5'),  // explicit
});
```

### `utilityModel` options:

- **`'default'`**: Cortex selects from a built-in mapping based on the primary model's provider. This is the recommended setting.
- **Explicit `Model` object**: The consumer specifies exactly which model to use. Must be from the same provider as the primary model (avoids needing multiple API keys).

### Provider Default Mapping

Cortex maintains a small mapping of recommended utility models per provider. This is updated as providers release new models.

| Provider | Default Utility Model | Notes |
|----------|----------------------|-------|
| Anthropic | Claude Haiku (latest) | Cheapest Anthropic model, strong for summarization |
| OpenAI | GPT-4o Mini | Cheapest capable OpenAI model |
| Google | Gemini Flash (latest) | Cheapest Google model, very fast |
| Groq | Cheapest available | Fast inference, low cost |
| Cerebras | Cheapest available | Fast inference, low cost |
| Mistral | Mistral Small | Cheapest Mistral model |
| *Others* | Same as primary | No known cheaper option; utility calls still work, just at full price |

For providers without a mapping (Ollama, OpenRouter, custom endpoints, etc.), the primary model is used as the utility model. This means utility calls cost the same as primary calls, but everything still works.

### Same-Provider Constraint

The utility model must be from the same provider as the primary model. This is enforced at construction time. Reason: using a different provider would require a separate API key and authentication, adding complexity. If the consumer needs cross-provider utility calls, they can configure the API keys for both providers and explicitly set the utility model.

## Accessing the Utility Model

Cortex exposes the utility model for internal use:

```typescript
// Internal to cortex (used by WebFetch, classifier, compaction)
const result = await cortexAgent.utilityComplete(context);

// Or access the raw model for direct pi-ai calls
const utilityModel = cortexAgent.getUtilityModel();
const result = await complete(utilityModel, context);
```

The `utilityComplete()` method is a convenience wrapper that uses the utility model with the same API key resolution as the primary model.

## Frontend Configuration (Animus-specific)

The Animus frontend settings UI needs to expose both model selections:

### Settings Page

Under the existing provider/model configuration:

- **Primary Model**: The main model selector (already exists as "Default Model" in current UI)
- **Utility Model**: A secondary model selector, defaulting to "Recommended" (which maps to `'default'`). The dropdown shows available models from the same provider, sorted by cost (cheapest first). "Recommended" is the first option and pre-selected.

### UI Behavior

- When the user changes the primary model's provider (e.g., switches from Anthropic to OpenAI), the utility model resets to "Recommended" for the new provider.
- The utility model dropdown only shows models from the same provider as the primary model.
- A brief description explains what the utility model is used for: "A smaller model used for internal operations like web page summarization and safety checks. Does not affect the quality of the agent's main responses."

### Backend Storage

Both models are stored in `system_settings`:
- `defaultModel`: Primary model ID (already exists)
- `utilityModel`: Utility model ID, or `'default'` for provider mapping. New setting.

On startup, the backend resolves `'default'` to the actual model ID using the provider mapping, then passes both models to the `CortexAgent` constructor.
