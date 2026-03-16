# Phase 0: Backend Prep Refactors

> **Scope:** Preparatory refactors on the current codebase. No cortex package exists yet. These changes land on main and reduce migration risk by decoupling concerns ahead of time.

## Why Phase 0 Exists

Several current backend patterns are tightly coupled to the Claude SDK's warm/cold session model and monolithic context builder. Breaking these apart now means Phase 2A (heartbeat integration) can focus on wiring cortex in rather than simultaneously refactoring backend code.

## Tasks

### 0.1: Database Migration — Add `conversation_history` Column

**File:** New migration `packages/backend/src/db/migrations/heartbeat/00X_add_conversation_history.sql`

Add `conversation_history TEXT` column to `heartbeat_state` table. This will store serialized cortex conversation history for crash recovery.

Deprecate (do not remove yet):
- `session_state` column (currently stores `'cold'`/`'warm'` string)
- `session_warm_since` column

**Modify:** `packages/backend/src/db/stores/heartbeat-state-store.ts`
- Add `getConversationHistory()` and `updateConversationHistory()` functions
- Keep existing `getSessionState()` for backward compatibility during migration

**Tests:** Verify migration runs, new column is read/writable, old columns still function.

### 0.2: Database Migration — Add Cortex Settings Columns

**File:** New migration `packages/backend/src/db/migrations/system/0XX_cortex_settings.sql`

Add to `system_settings`:
- `cortex_provider TEXT` (active provider ID)
- `cortex_model TEXT` (active model ID)
- `cortex_thinking_level TEXT DEFAULT 'off'`
- `utility_model TEXT DEFAULT 'default'`

**Modify:** `packages/backend/src/db/stores/settings-store.ts`
- Add getters/setters for all four new columns

**Tests:** Verify migration, read/write for each new setting.

### 0.3: Credential Store Additions

**Modify:** `packages/backend/src/db/stores/credential-store.ts`

Add four new functions for cortex credential management:
- `getByProviderPrefix(db, prefix)` — find credentials by `cortex_` prefix
- `upsertCredential(db, type, provider, data, metadata)` — insert or update
- `updateCredentialData(db, type, provider, newData)` — update encrypted blob
- `deleteByProviderAndType(db, provider, type)` — remove credential

These use the existing `credentials` table. No schema change needed. Cortex credentials use `credential_type` values prefixed with `cortex_` (e.g., `cortex_api_key`, `cortex_oauth`).

**Tests:** CRUD operations for cortex-prefixed credentials.

### 0.4: Split `buildShortTermMemorySection()`

**Modify:** `packages/backend/src/heartbeat/context-builder.ts`

The current `buildShortTermMemorySection()` bundles thoughts, experiences, and messages into a single string. Split into three independent builders:

- `buildThoughtObservationContext(thoughtContext, recentThoughts, timezone)` — observation block + raw thoughts
- `buildExperienceObservationContext(experienceContext, recentExperiences, timezone)` — observation block + raw experiences
- `buildMessageObservationContext(messageContext, recentMessages, contactName, timezone)` — observation block + raw messages

Keep `buildShortTermMemorySection()` as a wrapper that calls all three (backward compatible). The new functions are what cortex slots will use independently.

**Tests:** Verify the wrapper produces the same output as before. Verify each sub-builder works independently.

### 0.5: Strip `(current)` Marker from Contacts Context

**Modify:** `packages/backend/src/heartbeat/context-builder.ts` — `buildContactsSection()`

Remove the `(current)` marker that annotates the triggering contact in the contacts list. The active contact identity will move to ephemeral context in the cortex model, so the contacts slot should be stable regardless of which contact triggered the tick.

**Tests:** Verify contacts section output no longer includes `(current)`.

### 0.6: Extract Tick-Interval Magnitude from Energy Guidance

**Modify:** `packages/backend/src/heartbeat/context-builder.ts` — `buildEnergyGuidance()`

Currently the energy guidance section includes magnitude calibration that depends on `tickIntervalMs`, which changes during sleep transitions. Split into:

- `buildEnergyGuidance()` — static band descriptions (goes in system prompt, doesn't change)
- `buildEnergyMagnitudeCalibration(tickIntervalMs)` — dynamic magnitude table (goes in ephemeral context)

**Tests:** Verify both outputs, verify the combined output matches the current behavior.

### 0.7: Remove Warm/Cold Session Logic

**Modify multiple files:**

- `packages/backend/src/heartbeat/gather-context.ts`: Remove `determineSessionState()`. Remove all `sessionState: 'cold' | 'warm'` references.
- `packages/backend/src/heartbeat/context-builder.ts`: Remove `SESSION_AWARENESS` section from system prompt. Remove conditional system prompt skipping for warm sessions (always emit system prompt).
- `packages/backend/src/heartbeat/index.ts`: Remove warmth tracking (`state.warmSince`), remove context budget checks that trigger cold transitions.
- `packages/backend/src/heartbeat/mind-session.ts`: Simplify `getOrCreateMindSession()` to always reuse the existing session (no cold/warm branching).
- `packages/frontend/src/pages/PresencePage.tsx` (or wherever warm/cold state is displayed): Remove session state indicators from the Mind page.

**This is the largest Phase 0 task.** It touches many files but each change is a removal/simplification, not new logic.

**Tests:** Existing heartbeat tests should pass after removing warmth logic. Frontend should render without session state indicators.

### 0.8: Remove `COGNITIVE_PROCEDURE` from System Prompt

**Modify:** `packages/backend/src/heartbeat/context-builder.ts`

Remove the `COGNITIVE_PROCEDURE` constant and its inclusion in `buildSystemPromptManifest()`. In the cortex model, THOUGHT and REFLECT are programmatic phases, not tool calls the agent is instructed to make.

**Note:** This must be coordinated with the actual cortex switchover. If done in Phase 0, the current system (which relies on the agent calling `record_thought` and `record_cognitive_state`) will break. **Option A:** Do this in Phase 0 only if the heartbeat is paused during migration. **Option B:** Defer to Phase 2A when the pipeline is actually rewired. Recommend Option B.

## Completion Criteria

- All migrations run cleanly on existing databases
- All new store functions have unit tests
- Context builder refactors produce identical output for the current pipeline (no behavioral change)
- Warm/cold session logic removed from backend and frontend
- No cortex package code exists yet; these are pure backend prep changes

## Estimated File Changes

| File | Change Type |
|------|------------|
| `db/migrations/heartbeat/00X_add_conversation_history.sql` | New |
| `db/migrations/system/0XX_cortex_settings.sql` | New |
| `db/stores/heartbeat-state-store.ts` | Modify |
| `db/stores/settings-store.ts` | Modify |
| `db/stores/credential-store.ts` | Modify |
| `heartbeat/context-builder.ts` | Modify (0.4, 0.5, 0.6). Task 0.8 deferred to Phase 2A. |
| `heartbeat/gather-context.ts` | Modify (0.7) |
| `heartbeat/index.ts` | Modify (0.7) |
| `heartbeat/mind-session.ts` | Modify (0.7) |
| Frontend warm/cold UI files | Modify (0.7) |
