# Cortex Upgrade Plan

**STATUS**: RESEARCH / IN PROGRESS. Authored 2026-04-16 after a Cortex research sprint (see commits `2eae19e`, `ac18100`, `640df68`, `67080a6`, `35ffdc1` in `cortex-mono`). This doc groups the required Animus work into coherent, isolated phases so each can be scoped and landed independently.

Each phase has: **Goal**, **Why now**, **Open questions**, **Affected files**, **Proposed changes**, **Success criteria**, **Depends on**. Open questions are the things we should answer before implementation starts.

---

## The shape of the work

Cortex has picked up three major features (observational memory compaction, tool result persistence, deferred tool loading) plus a hardened tool contract and a few smaller upgrades. Animus needs to adopt the new contract, wire the persistence hook, and decide what to do about the near-complete overlap between its own message-stream observational memory and Cortex's new native one. Animus's thought and experience streams remain unique; those should be preserved.

The work decomposes into **seven phases**, grouped by concern. Phases 1 and 2 are small and independent. Phase 3 (observational memory consolidation) is the architectural centerpiece and has the most open questions. Phase 4 (cross-contact continuity) only exists if we answer phase 3's questions a certain way. Phases 5–7 are polish / optional enhancements.

```
Phase 0  Foundations                          DONE (committed)
Phase 1  Tool contract fix                    small, unblocking, independent
Phase 2  Tool result persistence              medium, self-contained
Phase 3  Observational memory consolidation   large, architectural, highest priority
Phase 4  Cross-contact observation continuity depends on phase 3
Phase 5  Docs reconciliation                  depends on phases 1–4
Phase 6  Optional Cortex features             independent, deferrable
Phase 7  Back-pressure items on Cortex        coordination work on cortex-mono
```

---

## Phase 0 — Foundations (DONE)

Committed on `cortex-agent`:
- `af0602f refactor(db): rename session_token_count to context_token_count` (shared schema, heartbeat migration 007, store, router, tests)
- `d3bfb49 fix(heartbeat): map loop_start and loop_end cortex events` (cortex-log-bridge.ts event-name switch)

Tree is clean. Subsequent phases branch from here.

---

## Phase 1 — Tool contract fix

### Goal
Bring `buildAnimusTools` in line with the hardened `CortexTool` contract so every Animus tool call succeeds end-to-end.

### Why now
This is almost certainly causing tool failures right now. `cortex-mind.ts:333` declares `execute: (toolCallId, params) => ...`. Cortex's canonical contract is `execute: (params, context?) => ...`. When Cortex invokes, our `toolCallId` slot receives the validated `params` object and our `params` slot receives the `ToolExecuteContext`. Zod validation then fails on the context object. This is a latent shape bug, not just an arity issue; `assertValidCortexTool` will happen to allow arity 2 through, but the semantic is broken.

All 12 tool handlers (`packages/backend/src/tools/handlers/*.ts`) are already `(params, context)`-shaped. The fault is entirely in the `buildAnimusTools` wrapper.

### Open questions
- None major. The only judgment call is whether to also delete the local `AgentTool` / `AgentToolResult` duplication at `cortex-mind.ts:278-289` and import `CortexTool` from `@animus-labs/cortex` instead. Recommendation: yes, do it here since we're touching the same block.

### Affected files
- `packages/backend/src/heartbeat/cortex-mind.ts` (lines 278-289 types, 326-357 wrapper)

### Proposed changes
- Replace local `AgentTool` / `AgentToolResult` with `import { CortexTool } from '@animus-labs/cortex'` (and its associated result type).
- Change wrapper shape from `execute: async (_toolCallId, params)` to `execute: async (params, _ctx?)`.
- Keep the existing `executeTool(name, params, toolContext)` call — `toolContext` is Animus's own `ToolHandlerContext` threaded through `toolContextRef`, unrelated to Cortex's `ToolExecuteContext`.
- No handler-side changes required.

### Success criteria
- `npm run typecheck` clean.
- `npm run test:run` clean.
- Manual smoke: one tick that exercises `send_message` and `read_memory`; verify tool calls complete and results surface in tick detail.

### Depends on
Nothing.

---

## Phase 2 — Tool result persistence

### Goal
Implement a `persistResult` callback so Cortex writes oversized tool results to disk and inserts a Read-able path reference into context instead of truncating.

### Why now
Without a persistor, any tool call whose output exceeds Cortex's per-tool threshold (default 25K, 7.5K for Bash) becomes lossy bookend-only truncation. This will hit Bash and WebFetch heavy work first and MCP tool responses later. Disk-backed persistence is cheap to add and matches the pattern the cortex-code reference uses.

### Open questions
1. **Tick ID vs session ID for directory scoping.** `tickNumber` (persistent, monotonic, DB-backed singleton) is the right key over `QueuedTick.id` (in-memory counter, resets on restart). Confirmed by the data-dir research. But: one mind session spans many ticks; a tool result from tick N might be read by tick N+3. Tick-scoped dirs are simpler to garbage-collect, but mean cross-tick references require the agent to remember the earlier tick. **Recommendation**: tick-scoped (`data/tool-results/{tickNumber}/...`). The agent references results via full paths Cortex inserts into context, so the tick number is already encoded in the path and doesn't need to be remembered separately.
2. **Should tool result files be included in `.animus` save archives?** Excluded: saves stay small, tool results die with the process. Included: restored archives retain historical tool output for later reference. **Recommendation**: excluded. They are ephemeral by nature and the context already carries bookend previews. Gitignored `data/` placement handles this automatically.
3. **What's the TTL?** Aligned with `settings.agentLogRetentionDays` (the existing retention knob for tick-level artifacts) or a separate `toolResultRetentionDays`? **Recommendation**: reuse `agentLogRetentionDays`; these artifacts pair naturally with agent logs. Expose a separate setting only if we hear a specific need.
4. **Threshold tuning per MCP tool**. Defaults (25K, 7.5K Bash) are reasonable starters. Plugin MCP tools may need per-tool overrides in `toolResultThresholds`. Defer until we see evidence.

### Affected files
- `packages/backend/src/utils/env.ts` — add `TOOL_RESULTS_DIR = path.join(DATA_DIR, 'tool-results')` export next to `LANCEDB_PATH`.
- New file `packages/backend/src/heartbeat/tool-result-persistor.ts` — implementation of the `PersistResultFn` callback.
- `packages/backend/src/heartbeat/cortex-mind.ts:434-447` — pass `persistResult` in `CortexAgent.create` config.
- `packages/backend/src/heartbeat/execute-output.ts:519-527` — add `cleanupOldToolResults(days)` call alongside existing cleanups.

### Proposed changes
- Persistor writes to `data/tool-results/{tickNumber}/{toolName}-{toolCallId}.md` on the proactive path, `data/tool-results/{tickNumber}/{toolName}-msg{messageIndex}-{sha8}.md` on the reactive path (matches cortex-code's filename scheme for portability).
- Each file is markdown with a small header (tick number, tool name, timestamp, char/token counts) and the raw content below. Header makes files self-describing when you `less` one during debugging.
- Cleanup sweeps `data/tool-results/` and deletes tick directories whose `mtime` is older than the retention window.
- Persistor factory takes a `getTickNumber()` accessor (closure over the cortex-mind state) so it can resolve the current tick at call time.

### Success criteria
- Trigger a Bash call that produces >20K of output; confirm `data/tool-results/{N}/Bash-{id}.md` exists and context shows `[Result persisted: {path} (...)]` with bookend preview.
- Confirm the agent can follow up with `Read` on that path and recover full content.
- After 8+ days of ticks, confirm old tick directories are pruned.
- Save/restore a `.animus` archive; confirm `data/tool-results/` is NOT in the archive.

### Depends on
Nothing. Fully independent of the observational memory changes.

---

## Phase 3 — Observational memory consolidation

### Goal
Delete Animus's message-stream observational memory (redundant with Cortex's new native strategy) and persist/restore Cortex's `ObservationalMemoryState` across process restarts. Keep the thought and experience streams intact — they are NOT conversation turns and Cortex does not compress them.

### Why now
Two parallel systems are doing the same compression work over the same corpus. The symptoms that follow are predictable: drift between the two summaries, doubled token spend on observer runs, a complicated reseed-after-compaction dance in `cortex-mind.ts:767-894` whose only job is reconciling Animus's watermark with Cortex's compaction tail. Collapsing to one pipeline removes all of that.

### Open questions
1. **Cross-tick observation continuity.** Cortex's `ObservationalMemoryState` is session-scoped. Animus wants per-contact durability ("Mom prefers concise answers" persists across all SMS and web ticks with Mom). Options:
   - **A. Single global state.** Persist one blob on `heartbeat_state`. Simple. Mixes contacts in the observation text.
   - **B. Per-contact states.** Persist one blob per contact in memory.db. Swap in the right one at tick start based on triggering contact. Timer-tick (no contact) uses a "global" slot or most-recent.
   - **C. Hybrid.** Global state for session continuity + per-contact durability fed via the `recall` callback.
   - **Leaning**: B for correctness, with C as a sophistication we add later if needed. B fits the existing `observations(contact_id, stream)` model directly; we'd repurpose the `stream='messages'` rows to store serialized `ObservationalMemoryState` blobs per contact instead of the Animus-observer XML output.
2. **What do we do with the existing `observations` table rows for `stream='messages'`?** Two paths:
   - **Drop them in a migration** and start fresh with Cortex's state format.
   - **Keep the rows** as a historical archive, stop writing new ones, and let them age out naturally.
   - **Recommendation**: drop them. The content is already reconstructible from messages.db if needed, and the format is incompatible with Cortex's state blob. Leaving them invites future confusion.
3. **Recall callback corpus.** Cortex's observer can call a `recall({query, timeRange?})` to dig back into raw history. Candidate corpora:
   - LanceDB over messages.db contents (semantic recall over raw messages).
   - LanceDB over `long_term_memories` (Animus's own extracted knowledge).
   - Both, with the observer choosing by intent.
   - **Leaning**: start with messages.db for this callback's purpose; `read_memory` already exposes long-term memory to the agent separately.
4. **Do we preserve the per-contact scoping for messages at all?** If Cortex's state is session-scoped and each mind session runs per-tick with a specific triggering contact, then in practice observations ARE per-contact already (one state per tick, swapped by triggering contact on load). Option B above is effectively "swap in the right blob at tick start and let Cortex take over from there."
5. **Serialization format.** `ObservationalMemoryState` returned by `getObservationalMemoryState()` is a Cortex-internal type. We should treat it as opaque JSON and not try to parse or migrate its contents; round-trip it byte-for-byte between SQLite and Cortex.

### Affected files
Removed / cleaned:
- `packages/backend/src/memory/observational-memory/index.ts` — drop messages branch from `processAllStreams` (:424-426); drop `messages` and `contactId` params once no caller needs them.
- `packages/backend/src/memory/observational-memory/observer.ts` — drop `STREAM_INSTRUCTIONS.messages` (:53-66) and narrow `StreamType` to `'thoughts' | 'experiences'`.
- `packages/backend/src/heartbeat/cortex-mind.ts:767-894` — delete `reseedMessagesAfterCompaction` and `injectMessagesIntoHistory` entirely.
- `packages/backend/src/heartbeat/cortex-mind.ts:605-635` (`onBeforeCompaction`) — either delete or re-purpose to flush only thoughts/experiences (they still pre-compact for slot coherence).
- `packages/backend/src/heartbeat/cortex-mind.ts:643-666` (`onPostCompaction`) — drop the reseed call; keep only the `logCompactionEvent` + event emission.
- `packages/backend/src/heartbeat/gather-context.ts:286-308` — drop the entire `if (resolvedContactId)` block for `messageContext` loading; drop `messageContext` from `GatherResult` (:91).
- `packages/backend/src/heartbeat/execute-output.ts:498-513` — drop `messages` arg from the `processAllStreams` call.
- `packages/backend/src/context/context-builder.ts:746-780` — delete `buildMessageObservationContext`; drop the caller in `buildShortTermMemorySection` (:807-810), `stmParams` plumbing (:1181, :793, :122).
- `packages/backend/src/config/observational-memory.config.ts:36-39` — remove `streams.messages` entry.
- `packages/backend/src/db/stores/memory-store.ts:336-362` — remove `getObservationsForContact` / `deleteObservations(contactId)` if nothing else uses them after the message branch goes away.
- Tests: `packages/backend/tests/memory/observational-memory/processor.test.ts`, `observer.test.ts`, `reflector.test.ts` — strip message-stream cases; keep thought/experience coverage.
- DB migration `packages/backend/src/db/migrations/memory/003_drop_message_observations.sql` — `DELETE FROM observations WHERE stream='messages'`.

Added:
- `packages/backend/src/db/migrations/heartbeat/008_add_observational_memory_state.sql` — `ALTER TABLE heartbeat_state ADD COLUMN observational_memory_state TEXT` (follows the `conversation_history` precedent from migration 006).
- `packages/backend/src/db/stores/heartbeat-state-store.ts` — `getObservationalMemoryState()` + `updateObservationalMemoryState(json)` helpers.
- Hook in `cortex-mind.ts` near `onLoopComplete`: checkpoint `getObservationalMemoryState()` alongside `getConversationHistory()` in the same transaction.
- Hook in `cortex-mind.ts` restoration path (:1337-1357): after `restoreConversationHistory`, call `restoreObservationalMemoryState(state)` if present.
- `packages/backend/src/heartbeat/cortex-mind.ts` `CortexAgent.create` config: `onObservation` handler that extracts `compactedMessages` and ensures they're in messages.db (defensive; should be redundant since channels already persist messages), and `onReflection` logging.
- `packages/backend/src/heartbeat/cortex-mind.ts` `compaction.observational.recall` callback that searches LanceDB over messages.db.

Optional branch for "per-contact state" (Option B from Q1):
- `observations` table: keep the row shape but use it to store opaque Cortex state per contact for messages. Or preferable: a new `cortex_observational_states(contact_id TEXT PRIMARY KEY, state_json TEXT, updated_at TEXT)` table in memory.db, and swap the state in at tick start based on triggering contact.

### Proposed changes
High-level flow after consolidation:

1. **Tick start**:
   - Load `ObservationalMemoryState` from heartbeat.db (and, in Option B, overlay per-contact state from memory.db based on triggering contact).
   - Call `cortexAgent.restoreObservationalMemoryState(state)`.
   - Restore conversation history as today.
2. **During agentic loop**:
   - Cortex's native observer compresses messages in-context. No Animus action.
   - Thought and experience streams remain populated into the `short_term_memory` slot via the existing `gather-context.ts` path (minus the messages sub-block).
3. **After loop**:
   - `onObservation` event fires. We log it for debugging and (Option B) attribute it to the triggering contact in the per-contact state table.
   - `onLoopComplete` checkpoints the current `ObservationalMemoryState` into heartbeat.db.
4. **Thought / experience compression**:
   - Continues to run out-of-band in EXECUTE phase, exactly as today, minus the `onBeforeCompaction` trigger (which only existed to flush the messages branch before Cortex compacted).

### Success criteria
- Delete ~300 lines of message-branch code without changing thought/experience behavior.
- `npm run typecheck`, `npm run test:run` clean.
- End-to-end smoke: start fresh, have a multi-turn conversation with one contact, let Cortex compact mid-conversation, confirm the agent still has coherent memory of earlier turns post-compaction.
- Restart smoke: kill process mid-conversation, restart, confirm `ObservationalMemoryState` restores and the agent picks up coherently.
- Cross-tick smoke: timer tick after a message tick — confirm observations don't vanish between the two.

### Depends on
Phase 0. Independent of phases 1 and 2, but landing phase 1 first gives a stable tool foundation for verifying phase 3 changes.

---

## Phase 4 — Cross-contact observation continuity

### Goal
Ensure per-contact knowledge accumulated in Cortex observations (e.g. "Mom prefers concise answers") persists across ticks with that contact, and doesn't bleed into or get erased by ticks with other contacts.

### Why now
Only a "why now" if we chose Option A in Phase 3 Q1 (single global state). If we chose B (per-contact states) or C (hybrid), this is the implementation of that choice. If Option A is deemed sufficient for MVP, this phase can be deferred until we see concrete evidence of contact bleed.

### Open questions
1. **Merge strategy for multi-contact situations.** A tick triggered by contact X might still need context about contact Y (e.g. "send Y's address to X"). Can per-contact observation states coexist in the same loop?
2. **Timer ticks (no contact context).** What state loads? The most recent? A general-purpose one? None?
3. **Group channels.** If a channel has multiple participants, per-contact scoping gets weird.

### Affected files
To be determined by choice; indicative files under Option B:
- New table `cortex_observational_states(contact_id, state_json, updated_at)` in memory.db.
- `packages/backend/src/heartbeat/cortex-mind.ts` — load/swap state logic at tick start, save at tick end.
- `packages/backend/src/heartbeat/gather-context.ts` — expose triggering contact to the state loader.

### Proposed changes
Hold until Phase 3's open questions are resolved.

### Success criteria
- Alternate ticks between two contacts with strong identities; confirm no knowledge bleed and each contact's observations stay coherent.

### Depends on
Phase 3 completion and decision on Q1.

---

## Phase 5 — Docs reconciliation

### Goal
Bring `animus/docs/cortex/` and `animus/docs/architecture/observational-memory.md` in line with reality after phases 1–4.

### Why now
All five files in `animus/docs/cortex/` are marked `STATUS: RESEARCH` but describe implemented systems. `cortex-integration-patterns.md` is materially stale (describes an `animus-mcp-server` stdio bridge that no longer exists). `observational-memory.md` will need substantial rewrite once the messages branch is gone.

### Affected files
- `animus/docs/cortex/mind-migration.md` — reclassify as architecture / implemented, trim completed sections.
- `animus/docs/cortex/pi-agent-core-migration.md` — archive (Cortex is now external, this migration is history).
- `animus/docs/cortex/backend-auth-integration.md` — reclassify, verify against `CortexCredentialService` + `cortex-provider.ts` router.
- `animus/docs/cortex/frontend-auth-ux.md` — reclassify after verifying the onboarding flow.
- `animus/docs/cortex/cortex-integration-patterns.md` — full rewrite or delete; MCP stdio bridge is gone.
- `animus/docs/architecture/observational-memory.md` — rewrite the messages section to point to Cortex's native strategy; keep thoughts/experiences content.
- `animus/CLAUDE.md` — no changes likely; reference updates if doc paths change.
- `.skills/doc-explorer/SKILL.md` — update references if any doc is renamed/moved.

### Proposed changes
Each doc either: reclassified with a refreshed STATUS header and a quick content review, or archived (moved to `docs/research/archive/` or deleted), or rewritten.

### Success criteria
- No doc claims something inconsistent with code.
- `/doc-explorer cortex` returns accurate, current information.

### Depends on
Phases 1–4 landing, since the docs describe the target state.

---

## Phase 6 — Optional Cortex features

### Goal
Opt into the remaining new Cortex features on a value-driven basis.

### Deferred tool loading
`deferredTools.enabled: true, deferMcp: true`. High value once plugin packs ship multiple MCP tools with large schemas. Low value today with only Animus's 12 built-in tools plus a handful of core Cortex tools. Defer until plugin activity justifies it.

### Prompt watchdog diagnostics
`diagnostics.promptWatchdog.enabled: true` plumbing through settings. Enable behind a debug flag for now; do not default on (writes heartbeat logs).

### Per-tool threshold tuning
`toolResultThresholds` overrides for specific MCP tools (Playwright snapshot, etc.) once we see patterns in tick detail.

### Depends on
Phase 2 at minimum (persistor). Otherwise independent.

---

## Phase 7 — Back-pressure items on Cortex

### Goal
A set of hacks / casts in Animus that exist because Cortex doesn't expose the right hook. Track them so they go away when cortex-mono can support a cleaner API.

### Items
1. **`process.env.PI_CACHE_RETENTION` env swap around `prompt()` calls** (`cortex-pipeline.ts:600-684`). Ask Cortex for a per-call `cacheRetention` option on `prompt(input, { cacheRetention })` and `structuredComplete(input, { cacheRetention })`.
2. **`(cortexAgent as unknown as { agent: { state: { error } } }).agent.state.error`** (`cortex-pipeline.ts:615-639`). Brittle cast to recover silent errors pi-agent-core swallows. Ask Cortex for an `onSilentError` hook or a `getLastError()` accessor.
3. **Provider label hardcoded as `'claude'` in agent_logs** (`heartbeat/index.ts:246,267`). Widen the `AgentProvider` DB column type to accept any Cortex provider string so this can be accurate.
4. **Injection splice index assumption** (`cortex-mind.ts:877`, becomes moot after Phase 3). Reseed logic assumes compaction summary is at index 1. This goes away when the reseed is deleted.
5. **Tool permission changes don't refresh tools** (`cortex-mind.ts:298-316`). Plugin lifecycle is wired; tool-permission toggles are not. Add a tool-refresh listener.

### Depends on
Nothing in Animus; some items depend on Cortex-side changes that would need a separate cortex-mono PR.

---

## Summary of dependencies and ordering

```
Phase 0  ────┐
             │
Phase 1 ◄────┘  (independent, low risk, do first)
             │
Phase 2 ◄────┤  (independent, low risk, can overlap with 1)
             │
Phase 3 ◄────┤  (architectural, highest value)
             │
             ├──► Phase 4  (depends on phase 3 Q1 answer)
             │
             └──► Phase 5  (docs; depends on phases 1–4 landing)

Phase 6  (any time after phase 2, low priority)
Phase 7  (coordination with cortex-mono, any time)
```

Recommended ordering: **1 → 2 → 3 → (4 if we chose B or C) → 5 → 6 → 7**. Phases 1 and 2 are scoped small enough to commit as soon as they're done; phase 3 should land as one coherent PR because its surface touches many files in interlocking ways.

---

## Appendix: open questions by phase

| Phase | Question | Default |
|---|---|---|
| 2 | Tick vs session scoping for tool-results dirs? | tick (`data/tool-results/{tickNumber}/`) |
| 2 | Include tool results in `.animus` archives? | no (ephemeral) |
| 2 | Separate retention setting? | reuse `agentLogRetentionDays` |
| 3 | Cross-tick observation continuity model? | B (per-contact) with eventual move to C (hybrid + recall) |
| 3 | Drop vs keep existing `observations` rows for `stream='messages'`? | drop via migration |
| 3 | Recall callback corpus? | messages.db via LanceDB |
| 3 | Preserve per-contact scoping for messages? | yes, via swapped state at tick start |
| 4 | Multi-contact merge semantics? | TBD |
| 4 | Timer-tick state? | TBD |

Each of these is a deliberate decision point before that phase starts.
