# Frontend Implementation Feasibility Review

An audit of all 8 frontend spec files against the actual backend code (tRPC routes, stores, schemas, event bus, heartbeat system) and planned architecture docs. This identifies what can be built today, what needs backend work first, what needs design clarification, and what carries technical risk.

**Review date:** 2026-02-08
**Updated:** 2026-02-09 — Corrections after Sprint 1 backend-builder completed work.

**Files reviewed:**
- Frontend specs: `design-principles.md`, `onboarding.md`, `app-shell.md`, `presence.md`, `mind.md`, `people.md`, `settings.md`, `voice-mode.md`
- Backend code: `packages/backend/src/api/` (index.ts, trpc.ts, routers/auth.ts, routers/settings.ts, routers/heartbeat.ts, routers/messages.ts), `packages/backend/src/db/stores/` (all 5 stores), `packages/backend/src/heartbeat/` (index.ts, emotion-engine.ts, persona-compiler.ts, context-builder.ts, tick-queue.ts), `packages/backend/src/lib/event-bus.ts`
- Shared schemas: all files in `packages/shared/src/schemas/`
- Shared types: `packages/shared/src/types/index.ts`
- Event bus types: `packages/shared/src/event-bus.ts`

> **Post-Sprint 1 correction**: This review was written before the backend-builder teammate finished Sprint 1. The following is now **outdated**:
> - "Heartbeat is a stub" — **False.** The full 3-stage pipeline (Gather/Mind/Execute) is implemented, with emotion decay, persona compilation, context building, tick queue with priority/debouncing/coalescing, and EventBus event emissions. The mind query stage returns minimal output (pending agent session wiring), but all other stages are fully functional.
> - "Only 2 routers (auth, settings)" — **Now 4 routers**: auth, settings, heartbeat (with queries, mutations, and 2 subscriptions), messages (with send, list, getConversation, getRecent, and 1 subscription).
> - "0 of 7 tRPC subscriptions" — **3 now exist**: `heartbeat.onStateChange`, `heartbeat.onEmotionChange`, `messages.onMessage`.
> - The missing routes inventory below remains valid for routes that were NOT built in Sprint 1. Routes marked with ✅ below have been added.

---

## Ready to Build

These specs have sufficient backend support for frontend development to begin. Data contracts exist or the components are purely frontend-side.

### 1. Design Principles (`design-principles.md`)
This is a style guide, not a functional spec. No backend dependencies. Ready to implement as theme configuration, component library, and animation utilities.

### 2. App Shell — Structure & Navigation (`app-shell.md`)
The four-space navigation pill, space transitions, command palette, scroll behavior, and route structure are entirely frontend concerns.
- **Route guards** require `auth.status` (exists) and an onboarding completeness check (see Needs Backend Work for the onboarding state endpoint).
- **Connection status indicator** relies on tRPC WebSocket health, which is handled by the tRPC client library. No backend endpoint needed.
- **Command palette** fuzzy search is client-side. Backend data for searchable items (contacts, goals, settings sections) will come from existing queries once routers are built.

### 3. Authentication — Sign Up & Login (`onboarding.md`, Part 1)
Fully supported by existing backend code:
- `auth.status` query: returns `{ hasUser, isAuthenticated }` -- supports registration lock and login/signup routing.
- `auth.register` mutation: creates user, primary contact, web channel, sets JWT cookie. All fields the spec needs (`email`, `password`, `confirmPassword`) are validated by `registerInputSchema`.
- `auth.login` mutation: validates credentials, sets JWT cookie.
- `auth.logout` mutation: clears cookie.
- `auth.me` query: returns current user.

**Minor note:** The spec expects `auth.status` to return `{ registrationOpen, hasUser }`. The backend returns `{ hasUser, isAuthenticated }`. `registrationOpen` is simply `!hasUser`, so the frontend can derive it. No backend change required.

### 4. Onboarding Step 1: Welcome
No backend interaction. Pure UI.

### 5. Onboarding Step 3: Your Identity
Backend support exists:
- `systemStore.createContact()` with `isPrimary: true` -- already called during registration. The onboarding step needs to **update** the contact's `fullName`. `systemStore.updateContact()` exists and supports partial updates.
- **Missing tRPC route:** No `contacts.update` tRPC procedure exists yet. The store function is ready; only the router is missing (see Needs Backend Work).

### 6. Onboarding Step 4: About You
Backend support exists:
- `systemStore.updateContact()` supports updating `notes` field on the primary contact.
- Same missing tRPC route as Step 3.

---

## Needs Backend Work First

These specs require new tRPC routes, subscriptions, store functions, or other backend functionality that does not yet exist.

### Critical: tRPC Routes (Nearly All Specs Blocked)

The backend currently has only **2 routers**: `auth` and `settings`. The frontend specs collectively require approximately 15-20 additional routers or procedure groups. Here is the complete list of missing tRPC procedures grouped by spec:

#### Onboarding Routes
| Procedure | Type | Purpose | Store Functions |
|-----------|------|---------|-----------------|
| `onboarding.getState` | query | Get current onboarding step / completeness | **New store function needed** -- no `onboarding_state` table or tracking exists |
| `onboarding.updateStep` | mutation | Save step progress | New store function |
| `contacts.update` | mutation | Update primary contact name/notes (Steps 3-4) | `systemStore.updateContact()` exists |
| `contacts.getPrimary` | query | Get primary contact data | `systemStore.getPrimaryContact()` exists |
| `provider.validateKey` | mutation | Validate agent provider API key | **New** -- needs agent adapter integration |
| `provider.checkClaudeCredentials` | query | Check for Claude Code cached credentials | **New** |
| `apiKeys.save` | mutation | Save encrypted API key | `systemStore.setApiKey()` exists |
| `channels.configure` | mutation | Save channel config (SMS, Discord) | **New store** -- `channel_configs` table exists in schema but no store functions for CRUD |
| `channels.validate` | mutation | Test channel connection | **New** -- needs channel adapter integration |
| `persona.saveDraft` | mutation | Save partial persona during creation | **New** -- no `persona_draft` table or store |
| `persona.finalize` | mutation | Compile persona, compute baselines, start heartbeat | **New** -- requires persona compilation + emotion baseline computation |

#### Presence Routes
| Procedure | Type | Purpose | Store Functions |
|-----------|------|---------|-----------------|
| `heartbeat.getState` | query | Current heartbeat state | ✅ **EXISTS** — `heartbeatRouter.getState` |
| `heartbeat.onStateChange` | subscription | Real-time heartbeat state updates | ✅ **EXISTS** — bridges `heartbeat:state_change` EventBus event |
| `heartbeat.getEmotions` | query | All 12 emotion intensities + baselines | ✅ **EXISTS** — `heartbeatRouter.getEmotions` |
| `heartbeat.onEmotionChange` | subscription | Real-time emotion updates | ✅ **EXISTS** — bridges `emotion:updated` EventBus event |
| `heartbeat.getRecentThoughts` | query | Recent thoughts for thought stream | ✅ **EXISTS** — `heartbeatRouter.getRecentThoughts` |
| `thoughts.subscribe` / `onThoughts` | subscription | New thoughts in real-time | **New** -- EventBus has `thought:created` but no subscription |
| `goals.getActive` | query | Active goals with salience | **New store functions** -- goal store deferred to Sprint 2 |
| `goals.subscribe` / `onGoals` | subscription | Goal salience updates | **New** |
| `agents.getActive` | query | Running sub-agents | **New store functions** -- agent task store deferred |
| `agents.subscribe` / `onAgentStatus` | subscription | Agent state changes | **New** -- EventBus has `agent:spawned/completed/failed` |
| `messages.send` | mutation | Send a message from the user | ✅ **EXISTS** — `messagesRouter.send` (writes message + triggers heartbeat tick) |
| `messages.list` | query | Paginated message history | ✅ **EXISTS** — `messagesRouter.list` (by conversationId) |
| `messages.getRecent` | query | Recent messages for current user | ✅ **EXISTS** — `messagesRouter.getRecent` |
| `messages.onMessage` | subscription | Real-time inbound/outbound messages | ✅ **EXISTS** — bridges `message:received` + `message:sent` |
| `messages.subscribe` / `onReply` | subscription | Streaming reply text chunks | **New** -- this is the most complex subscription, requiring streaming from the mind agent |

#### Mind Routes
| Procedure | Type | Purpose | Store Functions |
|-----------|------|---------|-----------------|
| `emotions.getHistory` | query | Emotion history for sparklines/charts | `heartbeatStore.insertEmotionHistory()` exists for writing, **but no read function for history ranges** |
| `thoughts.list` | query | Paginated thought/experience log | `heartbeatStore.getRecentThoughts/Experiences()` exist but need pagination support |
| `memory.getCoreSelf` | query | Core self text | `memoryStore.getCoreSelf()` exists |
| `memory.getWorkingMemories` | query | All working memories | `memoryStore.getWorkingMemory()` exists (per-contact), **needs a `listAll` function** |
| `memory.searchLongTerm` | query | Semantic search of long-term memories | `memoryStore.searchLongTermMemories()` exists for basic filtering, **LanceDB semantic search not wired** |
| `goals.list` | query | All goals by status | **New** -- goal store deferred |
| `goals.getById` | query | Single goal detail with plans/tasks | **New** |
| `goals.approve` | mutation | Approve a proposed goal | **New** |
| `goals.decline` | mutation | Decline a proposed goal | **New** |
| `seeds.list` | query | Active seeds | **New** |
| `plans.getByGoal` | query | Plan history for a goal | **New** |
| `tasks.getByGoal` | query | Tasks for a goal | **New** |
| `salienceLog.getByGoal` | query | Salience history | **New** |
| `decisions.list` | query | Tick decisions log | `heartbeatStore.getTickDecisions()` exists per tick, **needs a broader query by time range or goal** |
| `agentTasks.list` | query | Active + recent agent tasks | **New** |
| `agentTasks.getById` | query | Single agent task detail | **New** |
| `agentEvents.getBySession` | query | Agent event log | `agentLogStore.getSessionEvents()` exists |
| `agentUsage.getBySession` | query | Token usage | `agentLogStore.getSessionUsage()` exists |

#### People Routes
| Procedure | Type | Purpose | Store Functions |
|-----------|------|---------|-----------------|
| `contacts.list` | query | All contacts sorted by last message | `systemStore.listContacts()` exists, **needs last-message enrichment from messages.db** |
| `contacts.getById` | query | Single contact detail | `systemStore.getContact()` exists |
| `contacts.create` | mutation | Add new contact | `systemStore.createContact()` exists |
| `contacts.update` | mutation | Update contact fields | `systemStore.updateContact()` exists |
| `contacts.delete` | mutation | Delete contact | **New** -- no delete function in system-store |
| `contactChannels.list` | query | Channels for a contact | `systemStore.getContactChannelsByContactId()` exists |
| `contactChannels.add` | mutation | Add channel to contact | `systemStore.createContactChannel()` exists |
| `contactChannels.remove` | mutation | Remove channel from contact | **New** -- no delete function |
| `messages.getByContact` | query | Messages for a contact across channels | `messageStore.getMessages()` exists per conversation, **needs a cross-conversation query by contactId** |
| `workingMemory.getByContact` | query | AI's working memory for a contact | `memoryStore.getWorkingMemory()` exists |
| `unknownMessages.list` | query | Unresolved inbound messages from unknown senders | **New** -- no table or store for this |
| `unknownMessages.dismiss` | mutation | Dismiss an unknown message | **New** |

#### Settings Routes
| Procedure | Type | Purpose | Store Functions |
|-----------|------|---------|-----------------|
| `settings.getSystem` | query | System settings | `settingsRouter.getSystemSettings` **exists** |
| `settings.updateSystem` | mutation | Update system settings | `settingsRouter.updateSystemSettings` **exists** |
| `settings.getPersonality` | query | Personality settings | `settingsRouter.getPersonalitySettings` **exists** |
| `settings.updatePersonality` | mutation | Update personality | `settingsRouter.updatePersonalitySettings` **exists** |
| `persona.get` | query | Full persona data (existence, identity, dimensions, traits, values, background, notes) | **Personality settings schema is too limited** -- only has `name`, `traits`, `communicationStyle`, `values`. Missing: existence paradigm, location/world, gender, age, physical description, personality dimensions (10 sliders), background, personality notes |
| `persona.update` | mutation | Save full persona with recompilation | **New** -- needs persona compilation + emotion baseline recomputation |
| `heartbeat.pause` | mutation | Pause heartbeat | `stopHeartbeat()` function exists in heartbeat module, **no tRPC route** |
| `heartbeat.resume` | mutation | Resume heartbeat | `startHeartbeat()` function exists, **no tRPC route** |
| `heartbeat.subscribe` | subscription | Live heartbeat status for Settings | Same as Presence subscription |
| `provider.switch` | mutation | Change active agent provider | **New** -- needs to end mind session and restart |
| `data.softReset` | mutation | Clear heartbeat.db | **New** |
| `data.fullReset` | mutation | Clear heartbeat.db + memory.db | **New** |
| `data.clearConversations` | mutation | Clear messages.db | **New** |
| `data.export` | mutation/query | Export all databases | **New** |
| `auth.changePassword` | mutation | Change user password | **New** -- no update password store function |

#### Voice Mode Routes
| Procedure | Type | Purpose | Store Functions |
|-----------|------|---------|-----------------|
| `voice.getStatus` | query | STT/TTS model availability | **New** -- entire voice pipeline is unimplemented |
| `voice.transcribe` | mutation | Send audio for STT | **New** |
| `voice.subscribe` / `onVoiceReply` | subscription | Streaming TTS audio chunks | **New** |
| `voice.getConfig` | query | Voice settings (voice ID, speed, silence timeout) | **New** |
| `voice.updateConfig` | mutation | Update voice settings | **New** |

### Critical: Missing Database Schema / Store Functions

1. **Onboarding state tracking** -- No `onboarding_state` table or field exists in any database. The spec requires persisting current step and completed steps so the user can resume onboarding after closing the browser.

2. **Persona draft storage** -- No `persona_draft` table or JSON blob storage. The spec requires saving partial persona data during creation (8 sub-steps) before finalization.

3. **Full persona schema** -- The existing `personality_settings` table has only 4 columns: `name`, `traits`, `communication_style`, `values`. The persona spec requires 10+ fields: existence paradigm, location, world description, name, gender, age, physical description, 10 personality dimensions, traits (categorized), ranked values, background, personality notes. The table and schema need significant expansion.

4. **Goal/seed/plan/task store functions** -- Schema definitions exist in `packages/shared/src/schemas/heartbeat.ts` (goalSchema, goalSeedSchema, planSchema, taskSchema, etc.) and DB tables likely exist from migrations, but **all store functions for goals, seeds, plans, and tasks are deferred to Sprint 2** per the heartbeat-store comment.

5. **Unknown caller log** -- The People spec references a log of messages from unknown/unresolved senders. No table or store exists for tracking these.

6. **Contact delete function** -- `systemStore` has no `deleteContact()` function.

7. **Contact channel delete function** -- No `deleteContactChannel()` function.

8. **Emotion history range queries** -- `heartbeatStore` can insert emotion history and query by tick number, but the Mind spec needs queries by time range (24h, 7 days, 30 days) for sparklines and charts.

9. **Cross-contact message queries** -- `messageStore.getMessages()` queries by conversation ID. The People spec needs messages filtered by contact ID across all channels/conversations.

10. **Working memory list-all** -- `memoryStore.getWorkingMemory()` takes a single contactId. The Mind spec needs all working memories across all contacts.

### Critical: tRPC Subscriptions (Real-Time)

The frontend specs reference 7 distinct tRPC subscriptions. **3 are now implemented** (updated 2026-02-09), plus 1 additional message subscription.

| Subscription | EventBus Events | Spec | Status |
|-------------|-----------------|------|--------|
| `heartbeat.onStateChange` | `heartbeat:state_change` | Presence, Settings | ✅ **EXISTS** |
| `heartbeat.onEmotionChange` | `emotion:updated` | Presence, Mind | ✅ **EXISTS** |
| `messages.onMessage` | `message:received`, `message:sent` | Presence | ✅ **EXISTS** |
| `onThoughts` | `thought:created` | Presence, Mind | **Missing** — EventBus event exists, needs subscription |
| `onReply` | **No event** -- requires streaming from mind agent output | Presence | **Missing** — most complex, needs agent wiring |
| `onGoals` | **No event** -- goal salience updates not in EventBus | Presence, Mind | **Missing** — needs goal system first |
| `onAgentStatus` | `agent:spawned`, `agent:completed`, `agent:failed` | Presence, Mind | **Missing** — needs agent orchestration |
| `onVoiceReply` | **No event** -- voice pipeline not designed | Voice Mode | **Missing** — future sprint |

**Missing EventBus events:**
- `goal:salience_updated` or similar for real-time goal state changes
- `reply:chunk` or similar for streaming reply text during mind query
- `voice:audio_chunk` for streaming TTS output

### ~~Critical: Heartbeat Pipeline (Stub)~~ — RESOLVED in Sprint 1

> **Updated 2026-02-09**: The heartbeat pipeline is now fully implemented with:
> - ✅ Gather stage: loads emotions (with decay), thoughts, experiences, messages, contact context, previous decisions
> - ✅ Mind stage: builds context via context-builder + persona-compiler (agent session stubbed — returns minimal MindOutput pending @animus-labs/agents wiring)
> - ✅ Execute stage: atomic transaction for thoughts/experiences/emotion deltas/decisions, reply send with error handling, TTL cleanup, EventBus emissions
> - ✅ Tick queue: 4-level priority, per-contact debouncing, interval coalescing, overflow management
> - ✅ Emotion engine: 12 emotions, decay toward baselines, delta application, intensity descriptions
> - ✅ Persona compiler: all 10 dimensions, traits, values, existence frame, identity
> - ✅ EventBus events emitted: `heartbeat:tick_start`, `heartbeat:tick_end`, `heartbeat:state_change`, `heartbeat:stage_change`, `thought:created`, `experience:created`, `emotion:updated`, `decision:made`, `message:sent`
>
> **Remaining gap**: The mind query returns minimal output — real agent session wiring (via @animus-labs/agents Claude adapter) is needed for thoughts, emotions, and replies to be AI-generated rather than placeholder text.

---

## Needs Design Clarification

### 1. Onboarding State Persistence Model
The spec says "Progress is persisted to `system.db`" but does not specify the exact storage mechanism. Options:
- A dedicated `onboarding_state` table with `current_step` and `completed_steps` columns
- A JSON blob in the `system_settings` table
- The persona draft as a separate table vs. JSON in settings

**Decision needed:** Which approach? The simplest is adding `onboarding_step` and `onboarding_complete` columns to `system_settings`.

### 2. Persona Draft vs. Final Persona Schema
The spec describes a `persona_draft` that exists during onboarding and is "finalized" on "Bring to Life." The current `personality_settings` schema is insufficient for either. Questions:
- Should there be one `persona` table that stores both draft and final state (with an `is_finalized` flag)?
- Or separate `persona_draft` and `persona` tables?
- The Settings spec allows editing the persona post-creation -- the draft/final distinction may not be needed if there is only one table.

**Recommendation:** A single `persona` table with all fields, plus `is_finalized` boolean. Onboarding writes to it progressively; "Bring to Life" sets `is_finalized = true`.

### 3. Message Send Flow
The Presence spec shows the user sending a message and the being replying. The data flow is:
1. User sends message via tRPC mutation
2. Backend persists message to `messages.db`
3. Backend triggers a heartbeat tick with `trigger_type: 'message'`
4. Mind processes the message and produces a reply
5. Reply streams back via `onReply` subscription

This requires tight integration between the message router, heartbeat system, and mind agent -- none of which are wired together yet. The exact API contract for triggering a message-based tick needs to be defined.

### 4. Voice Channel in Channel List
The Settings and Onboarding specs list 4 channels: Web, SMS, Discord, API. The Voice Mode spec references voice as a mode within Presence, not a separate channel. However, the Voice Mode spec mentions a `voice.getConfig` endpoint and voice settings under Settings > Channels > Voice. This implies voice configuration lives alongside channel configs, but voice is not in the `channelTypeSchema` enum (`web | sms | discord | api`). Clarify whether voice is a channel, a Presence mode, or both.

### 5. Unknown Caller Log Lifetime
The People spec shows an "Unknown messages" section with "Dismiss" and "Add as contact" actions. It says dismissed messages "remain in the database for audit" but the message is removed from the log. This implies a separate tracking table (not just the messages table). The exact schema for this tracking needs design.

### 6. Contact Last Message Enrichment
The People spec shows contacts sorted by last message with a preview. The `contacts` table is in `contacts.db` while messages are in `messages.db`. Cross-database joins are not possible with separate SQLite files. The backend needs either:
- A denormalized `last_message_at` and `last_message_preview` on the contacts table (updated on each message)
- Or a composite query that fetches contacts from contacts.db and enriches with last-message data from messages.db

### 7. Auth Status and Onboarding Redirect
The spec says login should redirect to "where they left off in onboarding" if onboarding is incomplete. The `auth.status` query returns `{ hasUser, isAuthenticated }` but nothing about onboarding state. Either `auth.status` needs an `onboardingComplete` field, or the frontend needs a separate `onboarding.getState` query after auth.

---

## High-Risk Components

### 1. Emotional Field Visualization (Presence)
**Risk: High**
The spec describes 3-4 overlapping gradient orbs with animated positions, opacities, and scales driven by 12 emotion intensities. This requires:
- Mapping 12 emotion values to orb parameters (color, size, opacity, position)
- Continuous GPU-composited animation at 60fps
- Responsive to real-time data updates (emotion state changes)
- Performance on low-power devices (reduced orbs, reduced blur)
- Parallax scrolling integration
- Disconnection desaturation behavior
- `prefers-reduced-motion` support

**Recommendation:** Build a standalone prototype/spike first. Test on target devices before integrating.

### 2. Birth Animation (Onboarding)
**Risk: High**
A 15-20 second multi-phase animation that:
- Must coordinate with the first heartbeat tick (async backend operation)
- Transitions from empty canvas to gathering warmth to orb to name + first thought
- Must not feel like it is stalling if the tick takes longer than expected
- Must seamlessly transition into the main app shell at the end
- Involves particle effects, gradient animation, and text fade-ins

**Recommendation:** This is essentially a mini animation director. Prototype the timing coordination between the animation phases and the async heartbeat tick separately.

### 3. Voice Visualization SVG (Voice Mode)
**Risk: Medium-High**
An SVG/canvas bezier path with 8-12 control points driven by real-time audio amplitude data at 60fps. Requirements:
- `AudioWorklet` or `AnalyserNode` integration for mic input amplitude
- Separate `AnalyserNode` on TTS playback output for response visualization
- Directional ripple propagation (outward for user speech, inward for being speech)
- 30ms amplitude smoothing window
- Performance target: 60fps without blocking audio processing
- Reduced-motion alternative (single line with opacity changes)

**Recommendation:** Prototype the audio-to-visualization pipeline independently. Test on mobile Safari (known to have AudioContext quirks).

### 4. Streaming Reply + Simultaneous TTS (Voice Mode)
**Risk: High**
The voice mode requires:
- Text streaming via `onReply` subscription
- Backend buffering text to sentence boundaries
- Pocket TTS synthesis per sentence (sub-300ms target)
- Audio chunk streaming via `onVoiceReply` subscription
- Frontend queuing and seamless playback with crossfading
- Barge-in interruption (stop playback, discard queue, start listening)
- Echo cancellation to prevent TTS from being re-captured
- VAD suppression during playback

This is the most complex real-time pipeline in the entire app. The backend voice pipeline (`docs/architecture/voice-channel.md`) is designed but **completely unimplemented**.

**Recommendation:** Voice mode should be the last feature built. Spike the audio pipeline early but don't integrate until presence/heartbeat are stable.

### 5. Archetype Carousel (Onboarding)
**Risk: Medium**
The spec references Swiper.js for a horizontal carousel of 8 archetype cards with infinite loop, keyboard navigation, swipe gestures, and dot indicators. Swiper.js is a mature library, but integrating it with Emotion (CSS-in-JS) styling, the warm design language, and the specific selection animation (1.02x scale, rim lighting) will require custom styling work.

**Recommendation:** Low risk technically, but needs design polish time. Consider a simpler card grid if Swiper integration proves fussy.

### 6. Persona Dimension Sliders (Onboarding + Settings)
**Risk: Medium**
10 custom sliders with:
- Bipolar labels at ends
- Warm gradient track that shifts with thumb position
- Ghost marker at 0.5 neutral zone
- "Neutral" label when in 0.45-0.55 range
- Pre-filled from archetype presets
- No numeric value display

Standard range inputs won't suffice. This needs a custom slider component. Libraries like `@radix-ui/react-slider` can help but still need significant custom styling.

### 7. Command Palette (App Shell)
**Risk: Medium**
Requires:
- Global keyboard shortcut (`Cmd/Ctrl+K`) registration
- Fuzzy text matching across multiple entity types
- Real-time filtering with keyboard navigation
- Data from multiple backend sources (contacts, goals, settings)

Libraries like `cmdk` (paletro) handle most of this. Integration with the Animus design language is the main effort.

### 8. Semantic Memory Search (Mind > Memories)
**Risk: Medium**
The Mind spec's memory search uses semantic search via LanceDB. This requires:
- Embedding the search query on the backend (via Transformers.js / BGE-small-en-v1.5)
- Querying LanceDB vector index
- Combining semantic relevance with importance and recency scoring
- The LanceDB integration and embedding pipeline are designed but **not yet implemented**

---

## Summary: Implementation Order Recommendation

Based on backend readiness, the recommended build order is:

1. **Design system / component library** -- No backend dependencies. Build theme, animation utilities, card/button/input components, typography.
2. **Auth pages (Login/Signup)** -- Backend fully supports this today.
3. **App Shell (navigation pill, route structure, error boundaries)** -- Mostly frontend. Needs `onboarding.getState` for route guards.
4. **Onboarding Steps 1-4** -- Needs onboarding state tracking, contact update route, and persona draft storage.
5. **Onboarding Steps 5-6** -- Needs channel config routes and full persona schema.
6. **Settings** -- Needs persona expansion, heartbeat control routes, provider/channel routes.
7. **Presence** -- Blocked on heartbeat pipeline, all 6 real-time subscriptions, message send/receive flow.
8. **Mind** -- Blocked on goal/seed/plan/task stores, emotion history queries, memory search.
9. **People** -- Needs contact CRUD routes, cross-contact message queries, unknown caller tracking.
10. **Voice Mode** -- Blocked on entire voice pipeline (STT/TTS models, audio streaming infrastructure).

Items 1-3 can begin immediately. Items 4-6 can begin as soon as onboarding state + persona schema expansion are implemented (small backend tasks). Items 7-9 depend on the heartbeat pipeline being functional. Item 10 should be last.
