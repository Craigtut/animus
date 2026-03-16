# Phase 5: Compaction

> **Scope:** Implement the full three-layer compaction strategy for managing context window growth. After this phase, the agent can run indefinitely without hitting context limits.

## Dependencies

- Phase 2A complete (heartbeat integration, conversation history growing across ticks)

## Tasks

### 5.1: Token Tracking Infrastructure

Add running token tracking to CortexAgent:

- After each LLM call, accumulate `inputTokens + outputTokens` from pi-ai's `AssistantMessage.usage`
- Store as `sessionTokenCount` on the CortexAgent instance
- Compare against `model.contextWindow` from pi-ai's Model object
- Use `estimateTokens()` heuristic for pre-first-call sizing

### 5.2: Layer 1 — Microcompaction (`compaction/microcompaction.ts`)

**Reference:** `compaction-strategy.md`

Trim tool result content in conversation history to reduce token usage without losing information structure.

**Two sub-mechanisms:**

**Insertion-time cap (Tier 1):** At the point tool results enter the conversation (during the agentic loop), any tool result exceeding `maxResultTokens` (default: 50,000 tokens) is truncated to head + tail bookend format. This runs at insertion time, NOT in `transformContext`. Requires wiring into the tool result handling in `CortexAgent.prompt()`.

**Threshold-triggered batch processing (Tier 2-4):** Runs in `transformContext` (in-memory only, never modifies `agent.state.messages`). Three threshold crossings, each triggering a batch re-evaluation:

- **40% of context window**: Trim `rereadable` tool results to bookend format (first + last N chars). Cache the trim state.
- **50% of context window**: Second pass: advance bookend-trimmed results to placeholder-only (just tool name + status). Cache.
- **60% of context window**: Clear `rereadable` results entirely. Clear `ephemeral` results. Keep `non-reproducible` in bookend format.

Between threshold crossings, the previously computed trim state is replayed identically (no recomputation). This preserves prefix caching.

- Preserve recent turns (last 5 by default, configurable)
- Extended retention for `non-reproducible` tools (2x the preservation window)
- Tool categories registered by consumer: `rereadable` (Read, Glob, Grep, WebFetch), `non-reproducible` (Bash output), `ephemeral` (SubAgent results), `computational` (search results)

**Tests:** Insertion-time cap on large tool results, 40% threshold trim, 50% threshold advancement, 60% threshold clear, recent turn preservation, category-aware trimming, cached trim state replayed between crossings.

### 5.3: Layer 2 — Conversation Summarization (`compaction/compaction.ts`)

**Reference:** `compaction-strategy.md`

Replace old conversation turns with an LLM-generated summary:

- Triggers at 70% of context window (configurable)
- Uses the **primary model** (not utility) for summarization quality
- Preserves recent turns (last 6 by default)
- Summarization prompt focuses on: decisions made, tools used, key findings, user requests, unresolved threads
- Consumer hooks: `onBeforeCompaction` (awaited, lets consumer flush observational memory) and `onPostCompaction` (consumer re-seeds from messages.db)
- Emits `onCompaction` event

**Re-seeding flow (consumer-owned, triggered by `onPostCompaction`):**
1. Query `messages.db` for post-watermark messages
2. Format as agent messages
3. Inject after the compaction summary via `restoreConversationHistory()`
4. Result: `[compaction summary] + [re-seeded recent messages]`

**Tests:** Trigger at threshold, summary generation (mock LLM), recent turn preservation, consumer hooks fire in order, re-seeding flow.

### 5.4: Layer 3 — Emergency Truncation (`compaction/failsafe.ts`)

**Reference:** `compaction-strategy.md`

Last-resort truncation when Layer 2 fails or context is still too large:

- Triggers at 90% of context window
- Drops oldest conversation turns (entire turns, not partial)
- Preserves context slots (never truncated)
- Preserves recent turns (last 3)
- No LLM call, purely mechanical truncation
- Logs a warning when triggered

Also: reactive detection via pi-ai's `isContextOverflow()` on error responses. If an overflow error is received, trigger emergency truncation immediately.

**Tests:** Trigger at threshold, preserves slots and recent turns, reactive detection from error response.

### 5.5: Compaction Composition in transformContext

Wire all three layers into the `transformContext` composition chain:

```
transformContext pipeline:
  1. ContextManager ephemeral injection
  2. Skill buffer injection (Phase 4)
  3. Microcompaction threshold-triggered batch processing — replays cached trim state, recomputes on threshold crossing
  4. Check if Layer 2/3 needed:
     a. End-of-tick (preferred): If sessionTokenCount > 70% → trigger Layer 2
     b. Mid-loop safety valve: If sessionTokenCount > 90% during agentic loop → trigger Layer 3 (emergency truncation only, NO Layer 2 summarization mid-loop, NO onBeforeCompaction event)
```

**End-of-tick compaction (Layer 2):** Preferred trigger point. Fires after EXECUTE, before the next tick. Emits `onBeforeCompaction` (awaited, consumer does observational memory flush) and `onPostCompaction` (consumer re-seeds from messages.db). Uses `CompactionResult.oldestPreservedTimestamp` for the re-seeding gap query.

**Mid-loop safety valve (Layer 3):** Fires inside `transformContext` when estimated token count exceeds 90% during the agentic loop. Emergency truncation only (drop oldest turns). Does NOT emit `onBeforeCompaction` (no observational memory processing mid-loop). Does NOT call Layer 2 summarization. This prevents context overflow crashes during long agentic loops.

**Phase flag:** A `pipelinePhase` flag on CortexAgent prevents Layer 2 from firing between THOUGHT and AGENTIC LOOP, or between AGENTIC LOOP and REFLECT. Only fires at end-of-tick or as the Layer 3 mid-loop safety valve.

### 5.6: Compaction Coordination with Observational Memory

Wire `onBeforeCompaction` to trigger synchronous observational memory processing:

```typescript
cortexAgent.onBeforeCompaction(async () => {
  await processAllStreams(gathered, agentManager, stores);
});
```

This ensures raw items in the conversation history are compressed by the observer before they're discarded by compaction.

### 5.7: Adaptive Threshold

Optional: flex the compaction threshold based on user interaction recency:

- If no user interaction for N ticks, lower the threshold (compact more aggressively to reduce idle costs)
- Consumer signals via a method like `cortexAgent.setInteractionRecency(lastInteractionMs)`

This is a refinement that can be deferred within Phase 5 if time is short.

## Completion Criteria

- Token tracking works (post-hoc from usage + heuristic estimation)
- Insertion-time cap truncates tool results exceeding 50K tokens at insertion
- Microcompaction batch processing fires at 40%/50%/60% thresholds with cached state replay between crossings
- Conversation summarization triggers at 70% and produces a quality summary using the **primary model**
- Summarization prompt includes cumulative "Key Decisions" carry-forward from previous compaction summary
- Emergency truncation triggers at 90% as a safety net (both end-of-tick and mid-loop)
- Reactive overflow detection via pi-ai's `isContextOverflow()`
- Consumer hooks fire correctly: `onBeforeCompaction` (awaited), `onPostCompaction`, `onCompactionError`
- `CompactionResult.oldestPreservedTimestamp` is correct for re-seeding gap queries
- Observational memory coordination works via `onBeforeCompaction`
- End-of-tick compaction (Layer 2) fires only at end of tick, not between pipeline phases
- Mid-loop compaction (Layer 3) fires as safety valve without emitting `onBeforeCompaction`
- Conversation history checkpoints reflect compacted state
- Sub-agents inherit parent's compaction config (always active)

## Files Created

| File | Purpose |
|------|---------|
| `src/compaction/index.ts` | Composition of all three layers |
| `src/compaction/microcompaction.ts` | Layer 1: tool result trimming |
| `src/compaction/compaction.ts` | Layer 2: conversation summarization |
| `src/compaction/failsafe.ts` | Layer 3: emergency truncation |
| `tests/unit/compaction/*.test.ts` | Tests for each layer |
