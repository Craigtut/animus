# Cortex Upgrade Plan

**STATUS**: COMPLETE. Authored 2026-04-16, all phases landed 2026-04-22.

---

## Summary

Cortex picked up three major features (observational memory compaction, tool result persistence, deferred tool loading) plus a hardened tool contract. This plan tracks the Animus-side adoption work.

```
Phase 0  Foundations                          DONE
Phase 1  Tool contract fix                    DONE
Phase 2  Tool result persistence              DONE
Phase 3  Session threading + Cortex state     DONE (7 sub-phases)
Phase 4  (absorbed into Phase 3)
Phase 5  Docs reconciliation                  DONE
Phase 6  Optional Cortex features             DONE (deferred tool loading + watchdog)
Phase 7  Back-pressure items on Cortex        DONE
```

---

## Architectural decisions (settled)

These decisions were reached through iterative discussion and code research during phases 1-3. They are authoritative.

### Two observation systems, different purposes

Cortex's native observational memory handles **per-thread session compression**: it watches conversation history within a single (contact, channel) thread and compresses older turns when context fills up.

Animus's observational memory (thoughts, experiences, messages) handles **cross-channel relational memory and inner-life compression**: per-contact message summaries that span all channels, plus global thought/experience compression.

Both run. Not redundant. They observe different data for different purposes.

### Observer firing stays independent

Cortex's observer fires based on context window utilization (~90% threshold, buffered in ~4 async cycles). Animus's observers fire every tick during the EXECUTE phase, gated on per-stream token budgets (1.5K-4K tokens). The triggers, timing, data sources, and purposes are fundamentally different. Unifying them would either starve Animus's compression (Cortex fires too rarely) or add latency to the LLM prompt path (wrong timing).

### Per-(contact, channel) thread sessions

Each contact+channel pair maintains its own CortexAgent conversation history and observational state in `sessions.db`. Inner-life ticks (timer, scheduled tasks without an originating thread) start with empty history and do not persist.

Why per-(contact, channel) rather than per-contact: from inside a given channel, the user only sees that channel's thread. Turn history bleeding across channels would make Animus reference things the user didn't surface in the current context. Cross-channel awareness is preserved via the GATHER layer (message observations + working memory remain per-contact and channel-agnostic).

### sessions.db (8th database)

Conversation history and Cortex observational state live in `sessions.db`, not heartbeat.db or memory.db. Soft reset clears it (sessions are ephemeral working state). Full reset also clears it. Included in .animus save archives.

The `heartbeat_state.conversation_history` column (legacy single-session model) is deprecated; `loadSessionForTick` is the active path. The legacy `restoreConversationHistory` function remains for backward compatibility during migration.

### Recall callback over raw messages

Cortex's observational memory exposes a `recall` tool backed by `RecallConfig.search()`. Animus wires this to a `MessageEmbedder` that embeds messages into a LanceDB `message_embeddings` table on intake (`message:received` / `message:sent` events). Semantic search over raw messages lets the agent dig back into past conversations.

Long-term durable knowledge remains served by the `read_memory` tool over `long_term_memories`. The two are separate corpora for separate purposes.

---

## Phase 0 — Foundations (DONE)

- `af0602f refactor(db): rename session_token_count to context_token_count`
- `d3bfb49 fix(heartbeat): map loop_start and loop_end cortex events`

---

## Phase 1 — Tool contract fix (DONE)

Fixed `buildAnimusTools` execute signature from `(_toolCallId, params)` to `(params, _ctx?)`. Replaced local `AgentTool`/`AgentToolResult` type duplication with `CortexTool` import from `@animus-labs/cortex`.

- `da1cfee fix(cortex): align Animus tool wrapper with CortexTool contract`

---

## Phase 2 — Tool result persistence (DONE)

Implemented `PersistResultFn` callback writing to `data/tool-results/{tickNumber}/`. Two-layer GC: primary via `onObservation` hook (set-difference of compacted paths minus remaining history plus observation text), fallback via TTL sweep keyed to `agentLogRetentionDays`.

Decisions:
- Tick-scoped directories with current tick at persistence time
- Markdown files on disk (agent uses built-in Read tool to recover content)
- Excluded from .animus archives (ephemeral)
- Unified filename: `{toolName}-{toolCallId}.md` when ID present, `{toolName}-{sha8}.md` fallback
- Observation text scanned as an additional "still referenced" source

Commits:
- `b218200 feat(cortex): persist oversized tool results to disk with observation GC`
- `afbcde4 feat(cortex): treat observation text as a live reference source for tool-result GC`

---

## Phase 3 — Session threading + Cortex state (DONE)

The largest phase. Seven sub-phases landed as independent commits.

### 3A: sessions.db infrastructure

New 8th database. `mind_sessions` table with composite PK `(contact_id, channel)`, columns for `conversation_history`, `cortex_observational_state`, `context_token_count`. Integrated into save/restore (optional in old archives), soft reset, full reset, factory reset.

Also fixed reset bugs caught by audit:
- `DELETE FROM observations` added to full reset (orphaned summaries of deleted data)
- `DELETE FROM tool_approval_requests` added to soft reset (stale references)

- `bd3d7fe feat(db): add sessions.db as 8th database for per-thread conversation state`
- `fd9c2f3 docs: update database count to 8 (sessions.db)`

### 3B: Session threading

`loadSessionForTick()` called at the start of every `cortexMindQuery`. Thread ticks load from sessions.db by `(contactId, channel)`. Inner-life ticks get empty history and `activeSession = null`. `saveActiveSession()` called from `onLoopComplete` writes back for thread ticks only.

- `9c46ca1 feat(heartbeat): implement per-(contact, channel) session threading`

### 3C: Cortex observational state persistence

`ObservationalMemoryState` saved alongside conversation history per session in `onLoopComplete`, restored alongside history in `loadSessionForTick`. Treated as opaque JSON.

- `1d36b67 feat(heartbeat): persist Cortex observational memory state per session`

### 3D: Dead code deletion

Removed 341 lines: `reseedMessagesAfterCompaction`, `injectMessagesIntoHistory`, `onBeforeCompaction` handler, `onPostCompaction` handler, `MutableCompactionContext` interface, `updateCompactionContext`/`clearCompactionContext` functions and all call sites. These were dead in observational mode (Cortex's default), and the reseed dance was fundamentally incompatible with session threading.

Kept: `onCompactionError` handler (always useful) and debug logging.

- `5457461 refactor(heartbeat): remove dead compaction reseed dance and context threading`

### 3E: Reset bug fixes

Landed with 3A (see above).

### 3F: agent_tasks origin tracking

Already implemented. `agent_tasks` table has `contact_id` and `source_channel` columns, populated by the orchestrator during sub-agent spawning. `gather-context.ts` reads them for `agent_complete` trigger routing. No new work needed.

### 3G: Message embedding + recall callback

`MessageEmbedder` class embeds messages into a LanceDB `message_embeddings` table. Listens to `message:received` / `message:sent` events on startup (fire-and-forget, non-blocking). Recall callback wired into `CortexAgent.create` via `compaction.observational.recall`. `getMessageById` added to message store. Message embeddings cleared on full reset.

- `f7cc661 feat(memory): add message embedding with LanceDB and recall callback for Cortex`

---

## Phase 4 — (Absorbed into Phase 3)

Cross-contact observation continuity is handled by session threading (3B). Each (contact, channel) pair has its own conversation history and Cortex observational state. Cross-channel per-contact knowledge lives in Animus's existing `observations` table (memory.db) and `working_memory`, which are loaded per-contact in the GATHER layer regardless of channel.

---

## Phase 5 — Docs reconciliation (PENDING)

### Goal

Bring `animus/docs/cortex/` and `animus/docs/architecture/observational-memory.md` in line with reality after phases 0-3.

### Affected files

- `docs/cortex/mind-migration.md` -- reclassify as architecture / implemented, trim completed sections, document session threading model.
- `docs/cortex/pi-agent-core-migration.md` -- archive or delete (Cortex is external, migration is history).
- `docs/cortex/backend-auth-integration.md` -- reclassify, verify against `CortexCredentialService` + `cortex-provider.ts` router.
- `docs/cortex/frontend-auth-ux.md` -- reclassify after verifying the onboarding flow.
- `docs/cortex/cortex-integration-patterns.md` -- full rewrite or delete; MCP stdio bridge is gone.
- `docs/architecture/observational-memory.md` -- update to reflect dual-system architecture (Cortex session compression + Animus relational memory), document session threading, add recall callback.
- `docs/architecture/data-directory.md` -- add sessions.db, update database count.
- `docs/architecture/tech-stack.md` -- update "seven databases" references.
- `.skills/doc-explorer/SKILL.md` -- update references if any doc is renamed/moved.

### Success criteria

- No doc claims something inconsistent with code.
- `/doc-explorer cortex` returns accurate, current information.
- Session threading model is documented.

---

## Phase 6 — Optional Cortex features (DONE)

### Deferred tool loading

`deferredTools: { enabled: true, deferMcp: true }` enabled by default. All plugin MCP tools deferred (schemas loaded via ToolSearch on demand). Animus built-in tools and Cortex built-in tools load eagerly.

### Prompt watchdog diagnostics

Gated by `cortexDiagnostics` boolean in system_settings (default false). Logs prompt lifecycle events when enabled.

### Per-tool threshold tuning

Deferred. Using Cortex defaults (25K general, 7.5K Bash) until evidence warrants tuning.

- `2c91aee feat(cortex): enable deferred MCP tool loading and prompt watchdog diagnostics`

---

## Phase 7 — Back-pressure items (DONE)

All four items resolved. Two required Cortex changes (committed to cortex-mono), two were Animus-only.

1. **Per-call cache retention**: Added `options?: { cacheRetention? }` to Cortex's `prompt()` method. Animus's env var swap hack deleted, replaced with clean per-call option.
2. **Silent error recovery**: The cast was dead code. Cortex already surfaces silent errors by throwing from `prompt()` (cortex-agent.ts:735-741). Dead code deleted from Animus.
3. **Provider label**: Added `'cortex'` to the `AgentProvider` enum. Hardcoded `'claude'` cast removed.
4. **Dynamic tool permission refresh**: Added `addConsumerTool()`/`removeConsumerTool()` to Cortex's `CortexAgent`. Animus now listens to `tool:permission_changed` events and hot-swaps tools without restart.

Cortex commit: `6e228b7 feat(cortex): add per-call cache retention on prompt() and dynamic tool add/remove`

Animus commits:
- `3e1319c fix(heartbeat): remove dead silent-error check, add cortex to AgentProvider`
- `60b0f7f refactor(cortex): use per-call cache retention and wire dynamic tool permission refresh`

---

## Commit log (full)

### Animus (`cortex-agent` branch)

```
af0602f refactor(db): rename session_token_count to context_token_count
d3bfb49 fix(heartbeat): map loop_start and loop_end cortex events
da1cfee fix(cortex): align Animus tool wrapper with CortexTool contract
f18ae4f docs(cortex): add 7-phase upgrade plan
b218200 feat(cortex): persist oversized tool results to disk with observation GC
afbcde4 feat(cortex): treat observation text as a live reference source for tool-result GC
bd3d7fe feat(db): add sessions.db as 8th database for per-thread conversation state
fd9c2f3 docs: update database count to 8 (sessions.db)
9c46ca1 feat(heartbeat): implement per-(contact, channel) session threading
1d36b67 feat(heartbeat): persist Cortex observational memory state per session
5457461 refactor(heartbeat): remove dead compaction reseed dance and context threading
f7cc661 feat(memory): add message embedding with LanceDB and recall callback for Cortex
98edeb9 docs(cortex): update upgrade plan with completed phases and architectural decisions
063620d docs: reconcile cortex docs with implemented state, remove stale files
2c91aee feat(cortex): enable deferred MCP tool loading and prompt watchdog diagnostics
3e1319c fix(heartbeat): remove dead silent-error check, add cortex to AgentProvider
60b0f7f refactor(cortex): use per-call cache retention and wire dynamic tool permission refresh
```

### Cortex (`main` branch in cortex-mono)

```
6e228b7 feat(cortex): add per-call cache retention on prompt() and dynamic tool add/remove
```
