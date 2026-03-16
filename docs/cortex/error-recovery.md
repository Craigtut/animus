# Error Recovery

> **STATUS: RESEARCH** - Not yet implemented.

How Cortex classifies, surfaces, and recovers from errors. Covers the error classifier module, auth failure detection, rate limit backoff, and integration with the 5-phase pipeline.

## Error Classification

Pi-ai surfaces all errors as plain `Error` objects with string messages. No error codes, no HTTP status codes, no structured types. The only structured detection pi-ai provides is `isContextOverflow()` (14+ provider-specific regex patterns).

Cortex implements a regex-based error classifier (`error-classifier.ts`) that maps error strings to actionable categories. This follows the same pattern pi-ai uses for context overflow detection, extended to cover other error types.

### Categories

Adapted from the existing `AgentErrorCategory` in `@animus-labs/agents`, simplified to categories that are actionable:

| Category | Severity | Description |
|----------|----------|-------------|
| `authentication` | fatal | Invalid API key, expired token, missing credentials |
| `rate_limit` | retry | Provider rate limit hit (429 equivalent) |
| `context_overflow` | recoverable | Context window exceeded. Handled by compaction. |
| `server_error` | retry | Provider 5xx or internal server error |
| `network` | retry | Connection failure, DNS resolution, timeout |
| `cancelled` | recoverable | Agent aborted by user or system |
| `unknown` | recoverable | Catch-all for unclassified errors |

Removed from the existing system (not actionable at the cortex level): `authorization`, `execution`, `resource_exhausted`, `not_found`, `invalid_input`, `unsupported`. These either don't apply to LLM calls or are too granular to classify from error strings.

### Classification Patterns

The classifier checks error strings against provider-specific regex patterns. Patterns are checked in priority order (first match wins).

**Authentication:**
```
/invalid.api.key/i
/unauthorized/i
/not.logged.in/i
/authentication.required/i
/expired.*token/i
/invalid.*credentials/i
/api.key.*invalid/i
/permission.denied.*key/i
/Could not resolve API key/i
```

**Rate Limit:**
```
/rate.limit/i
/too.many.requests/i
/429/
/rate_limit_exceeded/i
/throttl/i
/request.limit.reached/i
/quota.exceeded/i
```

**Context Overflow:**
Delegates to pi-ai's `isContextOverflow(message, contextWindow)` which already has 14+ patterns. Not duplicated in cortex.

**Server Error:**
```
/internal.server.error/i
/500/
/502.*bad.gateway/i
/503.*service.unavailable/i
/504.*gateway.timeout/i
/server.*error/i
/overloaded/i
```

**Network:**
```
/ECONNREFUSED/
/ENOTFOUND/
/ETIMEDOUT/
/ECONNRESET/
/network.*error/i
/fetch.failed/i
/socket.hang.up/i
/DNS.*resolution/i
```

**Cancelled:**
Detected by checking `agent.state.error` after abort, or `stopReason === "aborted"` on the response.

### Classifier API

```typescript
interface ClassifiedError {
  category: ErrorCategory;
  severity: 'fatal' | 'retry' | 'recoverable';
  originalMessage: string;
  suggestedAction?: string;
}

function classifyError(error: Error | string, contextWindow?: number): ClassifiedError;
```

The classifier is a pure function. It does not throw, does not modify state. It takes an error (or error string) and returns a classification.

**Suggested actions** per category:
- `authentication`: "Check your API key or re-authenticate in Settings."
- `rate_limit`: "Rate limit hit. The next tick will be delayed."
- `context_overflow`: "Context window exceeded. Compaction will run."
- `server_error`: "The provider is experiencing issues. Retrying."
- `network`: "Network error. Check your connection."
- `cancelled`: null (user-initiated, no action needed)
- `unknown`: null

## Error Event Flow

When a pi-ai call fails:

```
Pi-ai error (plain Error)
  → classifyError() produces ClassifiedError
  → CortexAgent emits onError(ClassifiedError) event
  → Consumer (backend) receives and routes:
      → Log the error (always)
      → EventBus 'system:error' (for auth, rate_limit, server_error)
      → Frontend receives via onSystemError tRPC subscription
      → SystemErrorCard rendered in conversation view
```

### CortexAgent Error Event

```typescript
cortexAgent.onError((error: ClassifiedError) => {
  // Consumer handles routing
});
```

This fires for any error during the agentic loop (LLM call failures, not tool execution errors; those are handled by pi-agent-core internally and don't crash the loop).

### Backend Routing (Animus-specific)

The backend's error handler expands beyond the current auth-only check:

```typescript
cortexAgent.onError((error) => {
  log.error(`Agent error [${error.category}]:`, error.originalMessage);

  if (error.category === 'authentication') {
    eventBus.emit('system:error', {
      category: 'authentication',
      message: error.originalMessage,
      recoverable: false,
      suggestedAction: error.suggestedAction,
    });
  }

  if (error.category === 'rate_limit') {
    eventBus.emit('system:error', {
      category: 'rate_limit',
      message: error.originalMessage,
      recoverable: true,
      suggestedAction: error.suggestedAction,
    });
    tickQueue.delayNext(backoffMs);  // see Rate Limit Backoff below
  }

  if (error.category === 'server_error') {
    eventBus.emit('system:error', {
      category: 'server_error',
      message: error.originalMessage,
      recoverable: true,
      suggestedAction: error.suggestedAction,
    });
  }
});
```

This is a significant expansion from the current system, which only surfaces `authentication` errors to the UI and silently drops everything else.

## Auth Failure Detection

Two detection points:

### Pre-Call (Credential Resolution)

The `CortexCredentialService.resolveApiKey()` callback (provided to pi-ai via `getApiKey`) throws if:
- No API key is configured for the provider
- The encrypted key cannot be decrypted (vault locked)

These throw before the LLM call happens. The `CortexAgent` catches them and classifies as `authentication` / `fatal`.

### Post-Call (Provider Rejection)

The LLM call fails with an auth error string (e.g., "Invalid API key"). The error classifier detects this via regex patterns.

### Auth Event

Both detection points result in the same consumer event. The backend emits `system:error` with `category: 'authentication'`, which the frontend renders as a SystemErrorCard with the suggested action to check API keys.

## Rate Limit Backoff

When a `rate_limit` error is classified:

### Mechanism

The consumer (backend) delays the next tick using a backoff strategy:

1. **First rate limit**: Delay next tick by 30 seconds.
2. **Consecutive rate limits**: Exponential backoff: 30s, 60s, 120s, 240s (max 5 minutes).
3. **Successful tick after backoff**: Reset the backoff counter to zero.

### Implementation

The backoff state lives in the backend (not cortex, since cortex doesn't know about ticks):

```typescript
// In the heartbeat pipeline
let rateLimitBackoffMs = 0;
let consecutiveRateLimits = 0;

cortexAgent.onError((error) => {
  if (error.category === 'rate_limit') {
    consecutiveRateLimits++;
    rateLimitBackoffMs = Math.min(
      30000 * Math.pow(2, consecutiveRateLimits - 1),
      300000  // max 5 minutes
    );
    tickQueue.delayNext(rateLimitBackoffMs);
  }
});

// On successful tick completion
consecutiveRateLimits = 0;
rateLimitBackoffMs = 0;
```

### User Visibility

The `system:error` event with `category: 'rate_limit'` tells the user what happened. The suggested action includes the delay: "Rate limit hit. Next tick delayed by {backoffMs/1000}s."

## Integration with the 5-Phase Pipeline

Each phase of the pipeline (THOUGHT, AGENTIC LOOP, REFLECT) can fail independently. The error classifier runs on any failure. The per-phase failure handling (defined in `mind-migration.md`) sits above the classifier:

| Phase | On Error | Classification Used For |
|-------|----------|------------------------|
| THOUGHT | Skip thought, continue to agentic loop with no thought in context | Log + surface to UI. Auth errors halt the tick. |
| AGENTIC LOOP | Check if any turns completed. If yes, use partial results. If no, use safe fallback output. | Log + surface to UI. Auth/rate limit trigger their specific handlers. |
| REFLECT | Retry up to 3 times. If all fail, skip reflection (emotions/decisions for this tick are lost). | Log + surface to UI. Auth errors halt the tick. |
| Any phase | If `authentication`: halt the tick entirely, surface to UI, do not retry. | Auth is always fatal. |

### Context Overflow During Agentic Loop

Detected via pi-ai's `isContextOverflow()`. Handled by the compaction system (see `compaction-strategy.md`):
1. Reactive compaction triggers
2. The loop retries with the compacted context
3. If compaction fails, the emergency truncation layer fires
