# Frontend Spec Review

Gap analysis of all frontend design specs against architecture docs and data schemas. Covers contradictions, missing states, architecture mismatches, and ambiguities.

**Specs reviewed:** design-principles.md, onboarding.md, app-shell.md, presence.md, mind.md, people.md, settings.md, voice-mode.md

**Cross-referenced against:** heartbeat.md, persona.md, contacts.md, channel-packages.md, memory.md, goals.md, tasks-system.md, agent-orchestration.md, voice-channel.md, and all `packages/shared/src/schemas/*.ts`

---

## 1. Contradictions

### 1.1 Onboarding step count mismatch

**Location:** `onboarding.md`, Step 6 heading

The heading reads "Persona Creation (9 steps -- the soul)" but only 8 sub-steps are listed (6a through 6h). The progress indicator section also correctly says 8 persona sub-steps.

**Fix:** Change the heading to say "8 steps".

### 1.2 Voice channel type not in shared schema

**Location:** `voice-channel.md` vs `packages/shared/src/schemas/common.ts`

`voice-channel.md` says `ChannelType = 'web' | 'sms' | 'discord' | 'api' | 'voice'`, but the canonical `channelTypeSchema` in `common.ts` only has `['web', 'sms', 'discord', 'api']`. The `channel-packages.md` architecture doc also lists only 4 channels. Meanwhile `voice-mode.md` is a complete frontend spec that depends on voice being a channel type.

**Resolution:** This is intentional phasing. `voice-channel.md` is a future-facing spec. The current schema is correct for the initial build. However, the frontend specs should not reference voice as if it exists today. `voice-mode.md` should note that it depends on the voice channel type being added to the schema first.

### 1.3 Emotion categories in schema vs frontend

**Location:** `packages/shared/src/schemas/heartbeat.ts` vs `presence.md`

The schema defines `emotionCategorySchema = z.enum(['positive', 'negative', 'drive'])`. The `presence.md` emotion-to-color mapping groups curiosity and loneliness under "Drive & social" as a combined label. The heartbeat.md architecture doc calls the category "Drive & Social" for both curiosity and loneliness. The schema just uses `'drive'`. This is fine -- the schema stores the canonical value, and the UI can display a friendlier label. No actual contradiction, but the discrepancy should be noted for implementers.

### 1.4 PersonalitySettings schema vs persona architecture

**Location:** `packages/shared/src/schemas/system.ts` lines 126-131 vs `persona.md`

The `personalitySettingsSchema` has only 4 fields: `name`, `traits`, `communicationStyle`, `values`. The persona architecture defines 8 layers with many more fields: existence paradigm, location/worldDescription, gender, age, physicalDescription, 10 personality dimensions, background, personalityNotes. The schema is drastically incomplete relative to the spec.

**Fix needed:** The `personalitySettingsSchema` must be expanded to match the persona architecture. This is a backend task, not a spec issue, but frontend implementers should know the schema doesn't yet match what the settings persona section requires.

### 1.5 Discord config field mismatch

**Location:** `settings.md` vs `packages/shared/src/schemas/system.ts`

Settings spec says Discord configuration needs "Bot Token, Guild ID". The schema (`discordChannelConfigSchema`) has `botToken`, `applicationId`, and `allowedGuildIds` (array). The spec says "Guild ID" (singular) but the schema has `allowedGuildIds` (array) and adds `applicationId` which the settings spec doesn't mention.

**Fix:** Update settings.md Discord fields to: Bot Token, Application ID, Allowed Guild IDs (comma-separated or multi-input).

---

## 2. Missing States

### 2.1 Presence -- no error states for subscriptions

**Location:** `presence.md`

The spec defines 6 tRPC subscriptions (`onHeartbeatState`, `onEmotionState`, `onThoughts`, `onReply`, `onGoals`, `onAgentStatus`) but doesn't describe what happens when a subscription disconnects or errors. What does the emotional field show if `onEmotionState` drops? What happens to the thought stream if `onThoughts` fails?

**Recommendation:** Add a "Connection Degradation" section to presence.md describing: stale data indicator, reconnection behavior, and graceful degradation per subscription.

### 2.2 Mind -- no loading states for data-heavy sections

**Location:** `mind.md`

Memories section describes semantic search and long-term memory browsing, but no loading/skeleton states for: initial memory load, search-in-progress, emotion history chart loading, goal salience sparkline loading.

**Recommendation:** Add a brief "Loading States" subsection noting that all charts/sparklines show a breathing opacity placeholder, lists show skeleton rows, and search shows "Searching..." inline.

### 2.3 People -- no error state for contact creation

**Location:** `people.md`

The "Add Contact" modal describes fields and validation but no error handling for: duplicate contact name, invalid phone format, server error on save.

**Recommendation:** Add inline validation errors consistent with design-principles.md form patterns.

### 2.4 Settings -- no loading state for provider validation

**Location:** `settings.md`

The "Validate" button for provider credentials has no described loading/pending state. Validation may take several seconds for API calls.

**Recommendation:** Describe the button showing a spinner or "Validating..." text during the API call.

### 2.5 Onboarding -- no error recovery for failed persona save

**Location:** `onboarding.md`

Step 6h (Review) describes the "Bring to Life" action but no error handling if the backend save fails. The birth animation fires but what if the persona fails to persist?

**Recommendation:** Add error handling: if save fails, show an error banner above the button and do not fire the birth animation.

### 2.6 App shell -- no offline/disconnected state

**Location:** `app-shell.md`

The connection status indicator section describes connected/reconnecting/disconnected states for WebSocket but doesn't describe what happens to the navigation pill or space content when disconnected for an extended period.

**Recommendation:** This is adequately covered for an initial build. The connection indicator is documented. Detailed offline behavior can be added later.

---

## 3. Architecture Mismatches

### 3.1 Voice settings surface missing from settings.md

**Location:** `voice-mode.md` references "Settings > Channels > Voice"; `settings.md` has no voice channel card

`voice-mode.md` references voice configuration at "Settings > Channels > Voice" and also mentions "Settings > System" for TTS voice selection. The `settings.md` channel section only defines Web, SMS, Discord, and API cards. There is no voice channel card, no TTS speaker selection, no silence timeout configuration.

**Fix:** When voice channel is implemented, add a Voice channel card to settings.md Channels section with fields: TTS Voice (speaker ID selector), Speech Speed (slider 0.5-2.0x), Silence Timeout (number input, ms), Continuous Mode (toggle). For now, voice-mode.md should note this dependency.

### 3.2 Subscription names not aligned with heartbeat architecture

**Location:** `presence.md` vs `heartbeat.md`

Presence defines 6 specific subscriptions: `onHeartbeatState`, `onEmotionState`, `onThoughts`, `onReply`, `onGoals`, `onAgentStatus`. The heartbeat.md architecture doc only shows a single generic `onHeartbeat` subscription example. The mind.md data sources reference `onEmotionState`, `onThoughts`, `onGoals`, `onAgentStatus` matching presence.md.

**Resolution:** The frontend specs are more granular and correct for implementation. The heartbeat.md `onHeartbeat` is a simplified example. The actual backend should implement the 6 subscriptions as presence.md defines. No spec fix needed -- this is a backend implementation detail.

### 3.3 People Contact interface missing schema fields

**Location:** `people.md` PeopleState vs `packages/shared/src/schemas/system.ts` contactSchema

The PeopleState `Contact` interface in people.md has: `id`, `fullName`, `phoneNumber`, `email`, `isPrimary`, `permissionTier`, `notes`, `lastMessageAt`, `lastMessagePreview`. The canonical `contactSchema` has additional fields: `userId`, `createdAt`, `updatedAt`. The frontend interface is a projection (view model), which is valid, but the spec should note that `lastMessageAt` and `lastMessagePreview` are computed/joined fields not present in the contacts table -- they come from a join with messages.db.

**Recommendation:** Add a note in people.md Data Sources section: "lastMessageAt and lastMessagePreview are computed from the most recent message in messages.db, joined at query time."

### 3.4 Scheduled task ticks: queue bypass vs queue entry

**Location:** `heartbeat.md` vs `tasks-system.md`

`heartbeat.md` says scheduled task ticks "bypass the main queue entirely" and create their own cold sessions that run in parallel. `tasks-system.md` diagram shows the task scheduler feeding into a "tick queue". These descriptions may conflict.

**Resolution:** This is an architecture concern, not a frontend spec issue. The frontend (Mind > Agents section) just displays what the backend reports. No frontend spec fix needed, but flagging for the backend team.

### 3.5 SettingsState heartbeat config vs schema

**Location:** `settings.md` SettingsState vs `systemSettingsSchema`

Settings spec's `heartbeatConfig` has `intervalMs`, `sessionWarmthMs`, `sessionContextBudget`. The `systemSettingsSchema` has matching fields (`heartbeatIntervalMs`, `sessionWarmthMs`, `sessionContextBudget`) plus additional TTL fields (`thoughtRetentionDays`, `experienceRetentionDays`, `emotionHistoryRetentionDays`, `agentLogRetentionDays`). The settings UI does not expose these TTL fields anywhere.

**Recommendation:** The TTL fields are system-level defaults that don't need a UI surface for v1. This is acceptable. If users want to configure retention, add a "Data Retention" subsection to Settings > System later.

### 3.6 Goal seed display fields vs schema

**Location:** `mind.md` Goals section vs `goalSeedSchema`

Mind.md says seeds show: content, strength, linked emotion, reinforcement count, last reinforced time. The `goalSeedSchema` has all of these plus: `motivation`, `source`, `status`, `graduatedToGoalId`, `createdAt`, `decayedAt`. The frontend correctly shows a subset. No mismatch, just confirming alignment.

---

## 4. Ambiguities

### 4.1 tRPC subscription granularity undefined

**Location:** `presence.md`

Six subscriptions are named but their exact payload shapes are not specified. For example, does `onEmotionState` emit all 12 emotions on every update, or only the emotions that changed? Does `onThoughts` emit a single new thought or an array?

**Recommendation:** Define subscription payloads explicitly. Suggested:
- `onHeartbeatState` -> `HeartbeatState` (full state object, emitted on every tick stage change)
- `onEmotionState` -> `EmotionState[]` (all 12 emotions, emitted after EXECUTE stage)
- `onThoughts` -> `Thought` (single new thought, emitted as streamed from mind)
- `onReply` -> `{ chunk: string } | { complete: Message }` (streaming text chunks, then complete message)
- `onGoals` -> `Goal[]` (all active goals with updated salience, emitted after EXECUTE)
- `onAgentStatus` -> `AgentTask` (single agent update, emitted on status change)

### 4.2 Message input -- which conversation does web channel use?

**Location:** `presence.md`

The message input sends via tRPC mutation but doesn't specify how the conversation is resolved. Does the web channel always use a single long-running conversation per primary contact? Is a new conversation created per session? The `conversationSchema` has `isActive` -- when does a conversation become inactive?

**Recommendation:** Clarify: the web channel uses a single persistent conversation for the primary contact. A conversation becomes inactive only if the contact is deleted or the channel is disabled. The frontend should pass `conversationId` if known, or let the backend resolve/create.

### 4.3 Presence thought stream -- how many thoughts visible?

**Location:** `presence.md`

Says "the last few thoughts and experiences" but doesn't specify a count. The opacity treatment implies recency-based fading, but the exact number of visible items affects layout.

**Recommendation:** Specify: show the 5 most recent thoughts/experiences. Older items are hidden (not just faded to zero).

### 4.4 Mind memories search -- debounce timing undefined

**Location:** `mind.md`

The memory search input performs semantic search via the backend (embedding query). No debounce timing is specified. Without debounce, every keystroke could trigger an expensive embedding + LanceDB search.

**Recommendation:** 500ms debounce on the search input. Show "Searching..." indicator during the backend call.

### 4.5 Settings persona -- trait count validation mismatch

**Location:** `settings.md` vs `persona.md`

Settings says validation requires "at least 5 traits selected". Persona.md says "5-8 chips" (minimum 5, maximum 8). These are consistent on the minimum, but settings.md doesn't mention the maximum of 8.

**Fix:** Update settings.md validation to: "5-8 traits required".

### 4.6 People -- primary contact conversation parity with Presence

**Location:** `people.md`

Says the primary contact detail view shows a message input "identical to the Presence input" and "Messages sent from here appear in the Presence conversation as well (they are the same conversation)." This implies shared state between Presence and People spaces. The Zustand store design should ensure a single source of truth for the primary contact's messages.

**Recommendation:** Add a note that both Presence and People > Primary Contact share the same message subscription and mutation endpoints. The store should not duplicate message state.

### 4.7 App shell -- command palette scope undefined

**Location:** `app-shell.md`

The command palette (Cmd+K) lists command categories (Navigation, Actions, Quick Settings, Search) but doesn't enumerate specific commands. What actions are available? What settings are "quick"?

**Recommendation:** This is acceptable for v1 -- the command palette can be built incrementally. Initial scope: navigation commands only (Go to Presence, Go to Mind, etc.). Actions and quick settings added as features mature.

---

## 5. Summary of Required Spec Patches

| # | File | Issue | Severity | Patch |
|---|------|-------|----------|-------|
| 1 | `onboarding.md` | Step count says 9, should be 8 | Low | Fix heading text |
| 2 | `settings.md` | Discord config fields incomplete | Medium | Add Application ID and pluralize Guild IDs |
| 3 | `settings.md` | Trait validation missing max count | Low | Add "5-8 traits" instead of "at least 5" |
| 4 | `voice-mode.md` | References settings surface that doesn't exist | Medium | Add dependency note at top |
| 5 | `people.md` | lastMessageAt/Preview are computed, not noted | Low | Add data source note |
| 6 | `presence.md` | No subscription error/degradation handling | Medium | Defer -- not blocking for implementation |
| 7 | `mind.md` | No loading states described | Low | Defer -- follows design-principles patterns |

---

## 6. Schema Gaps (for backend team)

These are not frontend spec issues but schema gaps that will block frontend implementation:

1. **personalitySettingsSchema** is a stub -- needs full persona fields (existence paradigm, dimensions, identity, background, notes, etc.)
2. **channelTypeSchema** will need `'voice'` when voice channel is built
3. **No persona draft schema** -- settings.md defines a `PersonaDraft` interface in its Zustand store, but there's no corresponding Zod schema for the tRPC mutation input
4. **No onboarding state schema** -- onboarding.md defines progress persistence but no schema for the partial onboarding state
5. **permissionTierSchema** has `['primary', 'standard']` but contacts.md also discusses `unknown` tier for unknown callers. The unknown tier is handled differently (not stored as a contact), so the schema is correct, but this should be documented clearly.
