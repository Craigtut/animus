# The Heartbeat System & The Mind

The heartbeat is the foundational mechanism that gives Animus its "life." It's a continuous tick system that drives all internal processes, creating a persistent, thinking entity. The mind is the agent session that runs during each tick — the actual intelligence that thinks, feels, and decides.

Together, the heartbeat and the mind form a single unified system: the heartbeat determines *when* cognition happens, and the mind determines *what* cognition produces.

## Concept

Traditional AI assistants are stateless — they wake when called and sleep when dismissed. Animus is different. The heartbeat ensures Animus is always running, always thinking, always *being* — whether or not anyone is watching.

Think of it like a biological heart pumping blood in a steady rhythm. The heartbeat pumps *time* through Animus. Each tick triggers a cascade of cognition: thoughts form, experiences emerge, emotions shift, memories consolidate, and agency considers action.

## The Mind

The mind is a **persistent agent session** — a single, long-lived session using the `@animus-labs/agents` abstraction layer. It is not a series of disconnected LLM calls. It is one continuous conversation with the underlying agent SDK (Claude Agent SDK, Codex, or OpenCode), maintaining full conversational context across ticks.

The mind serves as the **top-level orchestrator**. It thinks, feels, decides, and replies — but it does not perform long-running work itself. When a complex task needs execution (research, multi-step workflows, code generation), the mind kicks off **sub-agents** to handle that work autonomously. The mind stays fast and responsive, never blocked by heavy operations.

### The Mind as Orchestrator

```
                    ┌─────────────────────────────┐
                    │         THE MIND             │
                    │   (Persistent Agent Session)  │
                    │                               │
                    │  Thinks, feels, decides,      │
                    │  replies, delegates            │
                    └──────────┬──────────────────┘
                               │
                    ┌──────────┼──────────────┐
                    ▼          ▼              ▼
              ┌──────────┐ ┌──────────┐ ┌──────────┐
              │ Sub-Agent│ │ Sub-Agent│ │ Sub-Agent│
              │ Research │ │ Code Gen │ │ Planning │
              │          │ │          │ │          │
              └──────────┘ └──────────┘ └──────────┘
                 Long-running, autonomous work
```

The mind should be thought of as consciousness — the quick, aware, responsive layer. Sub-agents are the hands and legs that go do the actual work.

## Tick Triggers

A heartbeat tick is not only driven by a timer. There are **four events** that trigger a tick:

### 1. Interval Tick (Heartbeat Timer)
The default rhythm. When no messages arrive and no tasks fire, the heartbeat ticks on a regular interval (default: 5 minutes, configurable via UI). This gives Animus its idle inner life — thoughts that emerge on their own, emotions that drift, goals that get reconsidered.

**Timer reset behavior:** The interval timer resets after *any* tick, regardless of trigger type. If the interval is 5 minutes and a message arrives at minute 3, the timer resets — the next interval tick won't fire until 5 minutes after that message-triggered tick completes. This prevents unnecessary interval ticks from piling up during periods of activity.

### 2. Message Received
When a contact sends a message through any channel (web, SMS, Discord, API), it triggers a tick — but only if the sender is a **known contact**. Unknown callers receive a canned response and do not trigger a tick (see `docs/architecture/contacts.md`).

The message is tagged with the contact's identity and permission tier during ingestion, before the tick fires. This context flows through the entire pipeline: GATHER CONTEXT loads only the triggering contact's message history, the mind receives the contact's permission constraints, and EXECUTE enforces decision boundaries based on the contact's tier.

Because the mind is a persistent agent session, a new message is simply another user input into the ongoing session — no new session is created.

### 3. Scheduled Task Fires
Tasks are scheduled jobs that activate at a later time (cron-like). When a task fires, it triggers a tick with the task details as context. The mind evaluates the task and decides how to handle it — it may respond directly, delegate to a sub-agent, or determine the task is no longer relevant.

### 4. Sub-Agent Completion
When a sub-agent finishes its work, the completion event triggers a new tick. The mind receives the results, processes them as part of its cognitive cycle, and may take follow-up actions — such as messaging the user with results, updating goals, or kicking off additional agents.

### Mind Session Lifecycle

The mind session is not truly permanent — it cycles through states to balance conversational continuity with context window management.

#### Session States

```
                 ┌──────────────────────────────────────────┐
                 │                                          │
  ┌────────┐    │    ┌────────┐    ┌────────┐    ┌────────┐│
  │  COLD  │────┼──→ │ ACTIVE │──→ │  WARM  │──→ │  COLD  ││
  │        │    │    │        │    │        │    │        ││
  └────────┘    │    └────────┘    └────────┘    └────────┘│
                │         ▲              │                  │
                │         └──────────────┘                  │
                │         (new trigger reactivates)         │
                └──────────────────────────────────────────┘
```

- **Cold** — No active agent session. The next trigger creates a new session with the full system prompt and GATHER CONTEXT injected as the first user message. This is the state on startup, after warmth expiry, or after context budget exhaustion.
- **Active** — A tick is currently being processed. The session is engaged in a MIND QUERY.
- **Warm** — The session completed its last tick and is idle, awaiting the next trigger. Prior conversational context is still in the session. GATHER CONTEXT is still injected on each tick (even warm ones) to ensure the mind has fresh state.

#### Warmth Window

When a session completes a tick, it enters the **warm** state with a configurable warmth window (default: 15 minutes). If a new trigger arrives within the window, the session is reused — the new GATHER CONTEXT and trigger are sent as the next user message into the existing session.

**Warmth extension rules:**
- **User-facing triggers** (message received, scheduled task, sub-agent completion) **reset** the warmth timer — the session stays warm as long as the user is actively engaged
- **Interval ticks** use a warm session if available but **do not extend** the warmth window — idle thinking shouldn't keep a session warm indefinitely

When the warmth window expires with no trigger, the session transitions to **cold** and the SDK session is released.

#### Context Budget

Even with warmth, sessions don't grow forever. A context budget (default: 70% of the model's context window) limits cumulative session size. When the accumulated tokens in a session exceed the budget, the session is ended after the current tick and transitions to cold. The next trigger creates a fresh session.

This prevents context degradation (where very old context crowds out recent, relevant information) while allowing conversational continuity during active engagement.

#### Tick Queuing & Concurrency

Ticks are processed **sequentially** — only one tick runs at a time through the main tick queue. This eliminates all race conditions around state mutations (emotion deltas, thoughts, decisions). A priority queue manages pending triggers.

**Exception: Scheduled task ticks** bypass the main queue entirely. They create their own fresh cold sessions and can run in parallel (multiple tasks firing at the same time each get their own session). SQLite WAL mode handles concurrent writes — EXECUTE stages serialize naturally at the DB level. See `docs/architecture/tasks-system.md` for details. The main tick queue handles `message`, `interval`, and `agent_complete` triggers only.

```
  Interval Timer ─────┐
                       │     ┌──────────────────┐
  User Message ────────┼──→  │  Priority Queue   │ ──→ Agent Session (The Mind) ──→ Structured Output
                       │     │  (serialized)     │
  Scheduled Task ──────┤     └──────────────────┘
                       │
  Sub-Agent Done ──────┘
```

##### Priority Order

When multiple triggers are queued, higher-priority triggers run first:

| Priority | Trigger | Rationale |
|---|---|---|
| 1 (highest) | `message` | User-facing, latency matters |
| 2 | `agent_complete` | User is waiting for results |
| 3 | `scheduled_task` | Timed work, but not user-blocking |
| 4 (lowest) | `interval` | Background processing, can wait |

Same-priority triggers maintain FIFO order within the queue.

##### Message Coalescing (Same-Contact Rapid Messages)

The warm session model allows rapid messages from the same contact to be gathered into a single tick naturally, avoiding unnecessary queueing:

1. **Immediate write**: Messages are written to `messages.db` the instant they arrive (before any tick processing)
2. **Debounce window**: Message triggers are debounced **per-contact** (~1.5 seconds). If Contact A sends 3 messages in rapid succession, only one tick trigger is created after the debounce expires
3. **GATHER CONTEXT gathers all**: When the tick fires, GATHER CONTEXT loads all unprocessed messages for that contact from `messages.db` — picking up everything that arrived during the debounce window
4. **Same-contact deduplication**: If a tick trigger for Contact A is already in the queue, a new message from Contact A does NOT add another queue entry — the existing queued tick will gather the new message when it runs
5. **Same-contact during active tick**: If a tick is currently running for Contact A and a new message arrives, queue ONE follow-up tick for Contact A (the running tick has already passed GATHER CONTEXT). When that follow-up tick fires, the session is still warm — full conversational continuity, no cold start

```
Contact A sends 3 messages in 1 second:

  msg1 ──→ write to messages.db, start 1.5s debounce
  msg2 ──→ write to messages.db, reset debounce
  msg3 ──→ write to messages.db, reset debounce
              ... 1.5s ...
  debounce expires ──→ ONE tick trigger fires
  GATHER CONTEXT ──→ loads msg1, msg2, msg3 together
  MIND QUERY ──→ processes all three as one conversation turn
```

##### Cross-Contact Messages

Different contacts produce separate tick triggers. If Contact A and Contact B both message simultaneously:

- Both messages write to `messages.db` immediately
- Two separate tick triggers are created (one per contact, each debounced independently)
- They queue and run sequentially — Contact A's tick first (or B's, depending on arrival order within the same priority level)
- Each tick loads only its contact's message history (message isolation preserved)

##### Interval Tick Coalescing

Interval ticks coalesce — if an interval tick is queued and another interval timer fires before it runs, collapse them into one. There's never a reason to process two consecutive idle ticks. This prevents queue bloat during periods where higher-priority triggers keep running ahead of interval ticks.

##### No Preemption

Running ticks are NOT preemptable. A message arriving during an interval tick does not interrupt it — the message tick simply runs next (it has higher priority than any other queued interval ticks). Preemption adds significant complexity for minimal gain: ticks are short (one LLM call + DB writes), so the wait is acceptable.

##### Queue Depth & Overflow

- **Maximum queue depth: 10** entries
- If the queue reaches capacity, the oldest **interval ticks** are dropped first (they're the least important and can be regenerated by the timer)
- If the queue is full of non-interval ticks (extremely unlikely in practice), the oldest entry is dropped and a warning is logged
- Queue overflow should essentially never happen — it indicates either a system problem or an extreme burst of concurrent activity

## The Pipeline

Each tick executes a pipeline with three stages. The key insight is that the cognitive work (thinking, feeling, deciding, replying) happens in a **single agent query** that produces structured output for each concern simultaneously.

```
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  GATHER CONTEXT  │ →  │    MIND QUERY    │ →  │     EXECUTE      │
│    (System)      │    │  (Agent Session) │    │    (System)      │
└──────────────────┘    └──────────────────┘    └──────────────────┘
```

### Stage 1: GATHER CONTEXT (System)

A system-level operation that assembles the input for the mind query. No LLM inference happens here. Context assembly is handled by the **Context Builder** — see `docs/architecture/context-builder.md` for the full design of how context sections are composed and token budgets are managed.

- Collect the trigger context (message content, task details, sub-agent results, or nothing for interval ticks)
- If message-triggered: resolve contact identity and permission tier (see `docs/architecture/contacts.md`)
- Load current emotional state and **apply decay** based on elapsed time since last update (see [The Emotion Engine](#the-emotion-engine))
- Load recent thoughts (last ~10, timestamped)
- Load recent experiences (last ~10, timestamped)
- Load recent conversation messages — **filtered to the triggering contact only** (last ~10, from messages.db)
- Load active goals and pending tasks
- Generate escalating **planning prompts** for active goals without plans, based on ticks elapsed since activation (see `docs/architecture/goals.md`)
- Load information about running sub-agents (status, current activity)
- Load any environmental context (time of day, pending calendar events, etc.)
- Load outcomes from previous tick's decisions (what was decided, what actually happened)
- Assemble the contact's permission block (available tools, allowed decision types, privacy instructions)

For message-triggered ticks, the mind also receives an explicit permission and identity block describing who it's talking to and what it can/cannot do for this contact. See `docs/architecture/contacts.md` for the full permission tier system.

This stage replaces the old PERCEIVE phase. The difference: perceive was an LLM call that "observed" the environment. Now, context gathering is pure data retrieval that feeds into the mind.

### Stage 2: MIND QUERY (Agent Session)

A single prompt to the persistent agent session that produces **structured output** covering all cognitive concerns at once. The mind thinks, feels, decides, and (if applicable) replies — all in one inference.

The structured output includes:

#### Always Produced
- **Thoughts** — Observations, intentions, insights, questions that arise from the current context
- **Experiences** — Notable events or realizations worth recording
- **Emotion Deltas** — Per-emotion intensity changes with reasoning (see [The Emotion Engine](#the-emotion-engine))
- **Decisions** — Actions to take, sub-agents to spawn, goals to update

#### Contextually Produced
- **Message Reply** — When triggered by a user message, the reply to send back
- **Task Response** — When triggered by a scheduled task, the outcome/actions taken
- **Sub-Agent Follow-up** — When triggered by sub-agent completion, next steps

This replaces the old sequential THINK → FEEL → DECIDE → REFLECT pipeline. The model handles all of these concerns holistically in a single pass, which is both faster and more natural — a human mind doesn't think, then feel, then decide sequentially. It all happens together.

The mind's output is enforced via **structured output** (JSON schema). The `@animus-labs/agents` abstraction layer exposes an `outputSchema` option that maps to each SDK's native mechanism (Claude's `outputFormat`, Codex's `outputSchema`, or prompt injection + validation for providers without native support). The MindOutput schema is defined as a Zod schema in the shared package and compiled to JSON Schema for SDK consumption. See `docs/architecture/open-questions.md` for open questions about structured output reliability across providers.

### Stage 3: EXECUTE (System)

A system-level operation that processes the structured output from the mind query.

- **Validate decisions against contact permission tier** — drop disallowed decisions (e.g., `spawn_agent` for non-primary contacts) and log warnings
- Persist new thoughts and experiences to the database
- Apply emotion deltas to emotion state (clamp to [0, 1]) and log changes to emotion history
- Send message replies through the appropriate channel to the triggering contact
- Spawn sub-agents for delegated tasks (primary contact only)
- Update goals and task states (primary contact only)
- Store messages in messages.db tagged with `contact_id`
- Run TTL cleanup on expired data (thoughts, experiences, emotions)
- **Log agent events to agent_logs.db** — the backend orchestrator subscribes to the mind session's event stream via `session.onEvent()` and writes selected events to `agent_logs.db`. This is non-blocking (fire-and-forget with error logging). Not all events are stored — `session_start`, `session_end`, `tool_call`, `thinking`, `turn_end`, and `error` events are persisted; individual `response_chunk` events are skipped to avoid excessive write volume. The session row in `agent_logs.db` is created before the SDK session starts, ensuring we have a record even if the session fails immediately.
- Log the tick for observability
- Persist heartbeat state for crash recovery

This stage combines the old ACT and CONSOLIDATE phases into one system operation. It also serves as the **hard enforcement layer** for contact permissions — even if the mind produces a disallowed decision, EXECUTE rejects it. See `docs/architecture/contacts.md` for the full enforcement model.

## Initial State: Paused Until Persona Exists

On a fresh Animus instance, the heartbeat starts in a **paused/stopped state**. There is no persona yet, no compiled system prompt, no identity for the mind to inhabit — the mind has nothing to *be*. The heartbeat remains paused through the entire onboarding flow and is only started when the user completes persona creation ("Bring to Life"). This is the moment the engine ignites and the first tick fires.

See `docs/frontend/onboarding.md` for the full first-startup flow.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `heartbeatIntervalMs` | 300000 (5 min) | Time between interval ticks (configurable via UI) |
| `sessionWarmthMs` | 900000 (15 min) | How long a mind session stays warm after its last tick |
| `sessionContextBudget` | 0.7 | Fraction of model's context window before forcing a new session |
| `thoughtRetentionDays` | 30 | How long thoughts persist before TTL cleanup |
| `experienceRetentionDays` | 30 | How long experiences persist |
| `emotionHistoryRetentionDays` | 30 | How long emotion history entries persist before TTL cleanup |

The heartbeat interval is configurable via the frontend UI, allowing the user to tune how "active" Animus's idle inner life is. A shorter interval means more frequent thoughts and emotional shifts; a longer interval is more contemplative (and cheaper).

## The Emotion Engine

Animus has a fixed set of 12 emotions that evolve continuously through the heartbeat system. Unlike thoughts and experiences (which are created per-tick and eventually expire), emotions are **persistent state** — they exist at all times, shifting in intensity based on what Animus thinks, experiences, and encounters.

### The 12 Emotions

Emotions are grouped into three categories for higher-level UI visualization (e.g., showing whether the overall emotional state is positive, negative, or socially driven):

| Category | Emotions |
|---|---|
| **Positive** | Joy, Contentment, Excitement, Gratitude, Confidence |
| **Negative** | Stress, Anxiety, Frustration, Sadness, Boredom |
| **Drive & Social** | Curiosity, Loneliness |

These categories are a static mapping in code — they don't live in the database. The database stores each emotion's current intensity.

### Delta-Based Updates

The mind does not set emotion intensities directly. Instead, during each tick's MIND QUERY, the mind outputs **deltas** — how much each emotion should shift based on what happened this tick.

```
Mind outputs:  { emotion: "joy", delta: +0.05, reasoning: "The user shared good news about their project" }
               { emotion: "curiosity", delta: +0.08, reasoning: "Interesting technical problem to think about" }

EXECUTE stage: joy: 0.12 + 0.05 → 0.17 (clamped to [0, 1])
               curiosity: 0.20 + 0.08 → 0.28
```

This approach makes emotions feel organic — they accumulate and shift gradually rather than jumping to arbitrary values. The mind only needs to reason about "how did this make me feel?" rather than "what should my absolute emotional state be?"

#### Delta Magnitude Guidance

The mind's system prompt includes guidance on delta scale, calibrated to the current tick interval:

| Tick Interval | Typical Delta Range | Interpretation |
|---|---|---|
| 1–2 min | ±0.005–0.03 | Very small shifts per tick (high frequency) |
| 5 min (default) | ±0.01–0.05 | Standard range for most events |
| 15–30 min | ±0.03–0.15 | Larger shifts to account for elapsed time |

Within any tick, exceptional events can produce larger deltas:

| Magnitude | Meaning |
|---|---|
| ±0.01–0.05 | Subtle shift (a nice message, a minor frustration) |
| ±0.05–0.15 | Noticeable change (meaningful conversation, a failed task) |
| ±0.15–0.30 | Significant event (major accomplishment, serious problem) |
| > ±0.30 | Rare — only for extraordinary events |

The GATHER CONTEXT stage includes the current tick interval so the mind can scale its deltas appropriately.

### Emotion Decay

Emotions don't hold their intensity forever. In the absence of reinforcing input, they **decay exponentially toward their baseline** over time. This creates natural emotional dynamics — excitement fades, stress dissipates, loneliness grows if no one talks to Animus.

#### Formula

Decay is applied during the GATHER CONTEXT stage, before the mind sees the current emotional state. The decay calculation uses the shared **Decay Engine** utility (see `docs/architecture/tech-stack.md`, Shared Abstractions) which centralizes exponential decay math across the system:

```
elapsedHours = (now - lastUpdatedAt) / 3_600_000
decayedIntensity = baseline + (previousIntensity - baseline) * e^(-decayRate * elapsedHours)
```

This is **time-based**, not tick-based. If a burst of messages triggers 10 ticks in 2 minutes, emotions barely decay between them. If 6 hours pass with no activity, emotions decay substantially. This prevents tick frequency from distorting the emotional timeline.

#### Per-Emotion Decay Rates

Different emotions decay at different rates. Negative emotions are generally stickier (negativity bias), with situational exceptions:

| Emotion | Category | Full Reset (99%) | Decay Rate/hr | Rationale |
|---|---|---|---|---|
| Joy | Positive | 12h | 0.384 | Standard — happy feelings fade at a moderate pace |
| Contentment | Positive | 16h | 0.288 | Slow — background satisfaction is a stable state |
| Excitement | Positive | 6h | 0.767 | Fast — excitement is inherently hard to sustain |
| Gratitude | Positive | 10h | 0.461 | Moderate — appreciation fades naturally |
| Confidence | Positive | 18h | 0.256 | Slow — takes time to build, slow to erode |
| Stress | Negative | 18h | 0.256 | Sticky — lingers even after the source is gone |
| Anxiety | Negative | 24h | 0.192 | Very sticky — anxiety is hard to shake |
| Frustration | Negative | 8h | 0.576 | Moderate — dissipates once the irritant is gone |
| Sadness | Negative | 24h | 0.192 | Very sticky — sadness takes time to process |
| Boredom | Negative | 4h | 1.151 | Very fast — vanishes the moment something interesting happens |
| Curiosity | Drive | 12h | 0.384 | Standard — interest fades at a moderate pace |
| Loneliness | Social | 20h | 0.230 | Sticky — social needs don't resolve on their own |

"Full reset" means 99% decay from peak back to baseline. These rates are defined as constants in code, not stored in the database. They can be tuned as we observe the system's behavior.

### Baseline Values

Each emotion has a **baseline intensity** — the resting state it decays toward when not being reinforced. Baselines are **derived from the persona's personality dimensions** (see `docs/architecture/persona.md`). A neutral personality (all sliders at 0.5) produces zero baselines. Distinctive personality configurations push baselines up, capped at 0.25.

#### Formula

```
baseline(emotion) = clamp(Σ weight × (dimension - 0.5) × 2, 0, 0.25)
```

- `dimension` is a personality slider value (0–1, where 0.5 is neutral)
- `(dimension - 0.5) × 2` normalizes to a -1 to +1 range centered on neutral
- Positive weights mean higher dimension value → higher baseline
- Negative weights mean higher dimension value → lower baseline (inverse correlation)
- The 0.25 cap ensures baselines stay modest regardless of personality extremes

#### Personality Dimension → Emotion Baseline Mapping

| Emotion | Dimension | Weight | Reasoning |
|---|---|---|---|
| **Joy** | Optimism | +0.10 | Optimists have higher resting happiness |
| | Extroversion | +0.05 | Extroverts report higher positive affect |
| **Contentment** | Optimism | +0.08 | Naturally satisfied outlook |
| | Patience | +0.05 | Patient people are more at peace |
| **Excitement** | Extroversion | +0.08 | Seek and experience stimulation |
| | Cautious | -0.05 | Risk-takers excite more easily |
| | Patience | -0.05 | Impulsive people ride excitement waves |
| **Gratitude** | Empathy | +0.08 | Empathetic people appreciate others |
| | Altruism | +0.05 | Service-oriented → grateful |
| **Confidence** | Confident | +0.12 | Direct mapping |
| | Leadership | +0.05 | Leaders carry higher self-assurance |
| **Stress** | Confident | -0.08 | Insecurity → chronic stress |
| | Cautious | +0.05 | Overcautious → worry about risk |
| **Anxiety** | Confident | -0.10 | Insecurity → anxiety |
| | Optimism | -0.08 | Pessimism → anticipatory anxiety |
| **Frustration** | Patience | -0.10 | Impatience → easily frustrated |
| | Orderly | +0.05 | Orderly people frustrated by disorder |
| **Sadness** | Optimism | -0.08 | Pessimism → melancholy |
| | Confident | -0.05 | Insecurity → sadness |
| **Boredom** | Extroversion | +0.08 | Extroverts bore when unstimulated |
| | Patience | -0.05 | Impatient people bore quickly |
| **Curiosity** | Cautious | -0.05 | Risk-tolerance → openness to explore |
| | Extroversion | +0.05 | Outgoing → curiosity about the world |
| **Loneliness** | Extroversion | +0.10 | Extroverts feel absence more acutely |
| | Empathy | +0.05 | Connection-oriented → need for others |
| | Trust | -0.03 | Suspicious → isolation |

#### Examples

**Extroverted (0.9) + Optimistic (0.7) persona:**
- Joy: 0.10×(0.7−0.5)×2 + 0.05×(0.9−0.5)×2 = 0.04 + 0.04 = **0.08**
- Loneliness: 0.10×(0.9−0.5)×2 = **0.08**
- Higher resting joy *and* higher resting loneliness when alone — feels right for an extrovert

**Pessimistic (optimism=0.2) + Insecure (confident=0.2) persona:**
- Anxiety: (−0.10)×(0.2−0.5)×2 + (−0.08)×(0.2−0.5)×2 = 0.06 + 0.048 = **0.11**
- Noticeable resting anxiety — feels right for an insecure pessimist

**All neutral (every slider at 0.5):**
- All baselines = **0** — no distinctive emotional tendencies

#### Recomputation

Baselines are recomputed whenever the persona's personality dimensions change. The recomputed baselines are written to the `emotion_state` table and take effect on the next heartbeat tick. If the current intensity of an emotion is below the new baseline, it begins decaying *up* toward the baseline (the exponential decay formula works in both directions).

### Pipeline Integration

Here's how emotions flow through each tick:

```
GATHER CONTEXT                    MIND QUERY                    EXECUTE
┌─────────────────────┐          ┌────────────────────┐        ┌─────────────────────────┐
│                     │          │                    │        │                         │
│ 1. Read emotion     │          │ 3. Mind sees       │        │ 5. Apply deltas to      │
│    state from DB    │          │    decayed state   │        │    decayed state         │
│                     │          │    + context        │        │                         │
│ 2. Apply time-based │    ──→   │                    │  ──→   │ 6. Clamp all intensities │
│    decay to each    │          │ 4. Outputs deltas  │        │    to [0, 1]             │
│    emotion          │          │    + reasoning     │        │                         │
│                     │          │                    │        │ 7. Write to emotion_state│
│                     │          │                    │        │                         │
│                     │          │                    │        │ 8. Log to emotion_history│
└─────────────────────┘          └────────────────────┘        └─────────────────────────┘
```

### Storage

Emotions use two tables in `heartbeat.db`:

**`emotion_state`** — 12 fixed rows, one per emotion. Updated in place each tick.

```sql
CREATE TABLE emotion_state (
  emotion TEXT PRIMARY KEY,       -- 'joy', 'contentment', etc.
  category TEXT NOT NULL,         -- 'positive', 'negative', 'drive'
  intensity REAL NOT NULL DEFAULT 0,
  baseline REAL NOT NULL DEFAULT 0,
  last_updated_at TEXT NOT NULL
);
```

**`emotion_history`** — Append-only log of every emotion change, for UI visualization and observability.

```sql
CREATE TABLE emotion_history (
  id TEXT PRIMARY KEY,
  tick_number INTEGER NOT NULL,
  emotion TEXT NOT NULL,
  delta REAL NOT NULL,               -- The delta applied
  reasoning TEXT NOT NULL,           -- Why the mind made this change
  intensity_before REAL NOT NULL,    -- State before delta (after decay)
  intensity_after REAL NOT NULL,     -- State after delta + clamp
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_emotion_history_tick ON emotion_history(tick_number);
CREATE INDEX idx_emotion_history_emotion ON emotion_history(emotion);
CREATE INDEX idx_emotion_history_created ON emotion_history(created_at);
```

The `emotion_state` table is seeded on first startup with all 12 emotions at their baseline intensity.

---

## Structured Output Schemas

Each tick produces structured data. These schemas define what the mind outputs.

### Thoughts
```typescript
interface Thought {
  id: UUID;
  tickNumber: number;
  content: string;
  importance: number;  // 0 to 1 (how significant this thought is)
  createdAt: Timestamp;
  expiresAt: Timestamp | null;
}
```

### Experiences
```typescript
interface Experience {
  id: UUID;
  tickNumber: number;
  content: string;
  importance: number;  // 0 to 1 (how significant this experience is)
  createdAt: Timestamp;
  expiresAt: Timestamp | null;
}
```

### Emotion Deltas
```typescript
interface EmotionDelta {
  emotion: EmotionName;    // Which of the 12 fixed emotions
  delta: number;           // Change in intensity (e.g., +0.05, -0.03)
  reasoning: string;       // Why this emotion shifted
}
```

The mind outputs emotion deltas, not absolute values. See [The Emotion Engine](#the-emotion-engine) for the full system design.

### Decisions
```typescript
interface Decision {
  id: UUID;
  tickNumber: number;
  type: 'spawn_agent' | 'update_agent' | 'cancel_agent' | 'send_message' | 'update_goal' | 'schedule_task' | 'no_action';
  description: string;
  parameters: Record<string, unknown>;  // Type-specific details
  createdAt: Timestamp;
}
```

### Decisions

Decisions are the mind's action outputs — they tell the EXECUTE stage what to do. Each decision is logged for debugging, observability, and "previous tick outcomes" in GATHER CONTEXT.

```typescript
interface Decision {
  type: DecisionType;
  description: string;             // Why the mind is making this decision
  parameters: Record<string, unknown>;  // Type-specific details
}

type DecisionType =
  | 'spawn_agent' | 'update_agent' | 'cancel_agent'
  | 'send_message'
  | 'update_goal' | 'propose_goal' | 'create_seed'
  | 'create_plan' | 'revise_plan'
  | 'schedule_task' | 'start_task' | 'complete_task' | 'cancel_task' | 'skip_task'
  | 'no_action';
```

#### Decisions Log (heartbeat.db)

```sql
CREATE TABLE tick_decisions (
  id TEXT PRIMARY KEY,
  tick_number INTEGER NOT NULL,
  type TEXT NOT NULL,                -- DecisionType
  description TEXT NOT NULL,
  parameters TEXT,                   -- JSON
  outcome TEXT NOT NULL,             -- 'executed' | 'dropped' | 'failed'
  outcome_detail TEXT,               -- Why dropped (permission) or error detail
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_tick_decisions_tick ON tick_decisions(tick_number);
```

TTL cleanup alongside thoughts/experiences (30 days). This table enables:
- **Previous tick outcomes** in GATHER CONTEXT — the mind sees what it decided last tick and what happened
- **Permission enforcement visibility** — dropped decisions (e.g., `spawn_agent` for standard contacts) are logged with reason
- **Debugging and observability** — understand AI behavior patterns

### Message Reply (contextual)
```typescript
interface MessageReply {
  content: string;
  contactId: string;       // Which contact to reply to
  channel: ChannelType;    // Which channel to reply on
  replyToMessageId: string;
  tone?: string;           // Emotional coloring of the response
}
```

### Combined MindOutput Schema

The mind captures structured cognitive state via **cognitive MCP tools** — two in-process tools that bracket every response. The model calls `record_thought` first, speaks naturally (reply streams to the user), then calls `record_cognitive_state` last to capture experience, emotions, decisions, and memory updates.

Internally, the tool outputs are accumulated into a `CognitiveSnapshot` and converted to a `MindOutput` type for the EXECUTE stage via `snapshotToMindOutput()`.

```typescript
// Internal type assembled from CognitiveSnapshot + reply context
interface MindOutput {
  thought: { content: string; importance: number };   // Last thought from the tick
  reply: {
    content: string;           // Accumulated natural language from reply phase
    contactId: string;         // From trigger context
    channel: ChannelType;      // From trigger context
    replyToMessageId: string | null;
  } | null;
  experience: { content: string; importance: number };
  emotionDeltas: Array<{ emotion: EmotionName; delta: number; reasoning: string }>;
  energyDelta?: { delta: number; reasoning: string };
  decisions: Array<{ type: DecisionType; description: string; parameters: Record<string, unknown> }>;
  workingMemoryUpdate: string | null;
  coreSelfUpdate: string | null;
  memoryCandidate: Array<{
    type: 'fact' | 'experience' | 'procedure' | 'outcome';
    content: string;
    importance: number;
    contactId?: string;
    keywords?: string[];
  }>;
}
```

**Why Think, Speak, Reflect:** The cognitive tools enforce a natural order — the model thinks (via `record_thought`), then speaks naturally (reply streams to user), then reflects on the full experience (via `record_cognitive_state`). This mirrors how humans process: internal thought shapes what you say, and reflection follows action. The model's experience narration can include the act of having replied.

---

## Cognitive MCP Tools & Reply Streaming

Instead of forcing the entire mind output into a single JSON blob, the mind uses **cognitive MCP tools** to capture structured cognitive state while speaking naturally. This approach eliminates JSON parsing failures, enables natural reply streaming, and lets the model think and speak like a person rather than a JSON generator.

### The Two Tools

**`record_thought`** — Called FIRST, before any reply or other tool use.
- Captures the model's inner monologue for this moment
- Sets the streaming phase to `'replying'` — text after this tool call streams to the user
- Accumulates into an array (supports multiple thoughts per tick via mid-tick re-entry)

**`record_cognitive_state`** — Called LAST, after the reply is complete.
- Captures experience, emotion deltas, energy delta, decisions, memory candidates, working memory, and core self updates
- Sets the streaming phase to `'done'` — text after this is filtered out
- Uses Zod-validated schemas for each field (no JSON parsing needed)

### Phase-Based Reply Streaming

The cognitive tools manage a phase state machine that controls which text streams to the user:

```
                     ┌─────────────────────────────────────────────────┐
                     │         (mid-tick re-entry)                     │
                     │                                                 │
pre-thought ──[record_thought]──► replying ──[record_cognitive_state]──► done
  (filtered)                      (STREAMS)                             (filtered)
```

- **`pre-thought`**: Any text before `record_thought` is filtered (not sent to user)
- **`replying`**: Natural language streams to the frontend via `reply:chunk` events
- **`done`**: Any text after `record_cognitive_state` is filtered

The `onChunk` callback in `mindQuery()` checks the phase before emitting:

```typescript
state.cognitiveServer.resetSnapshot();
let replyAccumulated = '';

await session.promptStreaming(
  context.userMessage,
  (chunk: string) => {
    if (cogServer.getPhase() === 'replying') {
      replyAccumulated += chunk;
      eventBus.emit('reply:chunk', { content: chunk, accumulated: replyAccumulated });
    }
  },
);

const snapshot = cogServer.getSnapshot();
const output = snapshotToMindOutput(snapshot, replyAccumulated, gathered);
```

### Architecture

```
┌──────────────────────┐
│   @animus-labs/agents     │   Adapter streams text chunks via
│   (SDK Adapter)      │   promptStreaming() onChunk callback
└──────────┬───────────┘
           │ text chunks + tool calls (MCP)
           ▼
┌──────────────────────────────────────┐
│   @animus-labs/backend (Mind Query Stage) │
│                                      │
│   ┌─────────────────────────┐        │
│   │ Cognitive MCP Server    │        │
│   │ (in-process, Claude SDK)│        │
│   │                         │        │
│   │ record_thought ────────►│ phase = 'replying'
│   │                         │        │
│   │ (natural language) ─────┼──────► reply:chunk events → tRPC → frontend
│   │                         │        │
│   │ record_cognitive_state ─│──────► CognitiveSnapshot accumulated
│   └─────────────────────────┘        │
│                                      │
│   snapshotToMindOutput() ───────────► MindOutput → EXECUTE stage
└──────────────────────────────────────┘
```

**The cognitive tools live in `@animus-labs/backend`** (`heartbeat/cognitive-tools.ts`), built as an in-process MCP server via the Claude SDK's `createSdkMcpServer()`. The agents package remains a stateless SDK abstraction — it doesn't know about cognitive state or `MindOutput`.

### Three-Layer Prompt Architecture

The cognitive tools use a three-layer design for guiding model behavior:

| Layer | Location | Purpose |
|-------|----------|---------|
| System prompt | `context-builder.ts` → `COGNITIVE_PROCEDURE` | **When** to call tools, in what **order** |
| Tool descriptions | `cognitive-tools.ts` → `sdk.tool()` name/description | **How important** each call is, when to stop |
| Schema `.describe()` | `cognitive-tools.ts` → Zod schema descriptions | **What** to write in each field |

This separation prevents redundancy and lets each layer focus on its purpose.

### Mid-Tick Re-Entry (Multiple Cycles)

When a message is injected mid-tick (e.g., user sends a follow-up while the model is responding), the model may run multiple thought→reply→state cycles within a single prompt. The phase state machine is re-entrant:

- `record_thought` **always** resets phase to `'replying'` (even from `'done'`)
- `record_cognitive_state` **always** sets phase to `'done'`
- Accumulated state uses **accumulation semantics**:

| Field | Accumulation |
|-------|-------------|
| `thoughts` | Array — every call pushes |
| `emotionDeltas` | Array — every call appends |
| `decisions` | Array — every call appends |
| `memoryCandidate` | Array — every call appends |
| `experience` | Overwrite — latest wins (narrative progresses forward) |
| `energyDelta` | Sum — deltas add together |
| `workingMemoryUpdate` | Overwrite — latest wins |
| `coreSelfUpdate` | Overwrite — latest wins |

The `snapshotToMindOutput()` converter takes the **last** thought as `MindOutput.thought`. The EXECUTE stage persists **all** thoughts via the `allThoughts` option.

### Turn-Aware Streaming in the Agents Layer

The `@animus-labs/agents` abstraction layer tracks **turns** within a single prompt call. When the agent uses tools, the SDK produces multiple assistant turns — each with its own streamed text. The agents layer exposes this via:

- **`StreamChunkMeta`** on `onChunk` callbacks — includes `turnIndex` so consumers know which turn a chunk belongs to
- **`turn_end` events** — emitted when an assistant turn completes (before `tool_call_start`), carrying the full turn text and metadata
- **`AgentResponse.turns`** — after completion, the full per-turn breakdown is available

For the **heartbeat mind session**, the turn structure maps directly to the cognitive tool phases: turn 1 is the `record_thought` tool call, turn 2 is the natural language reply, turn 3 is the `record_cognitive_state` tool call. For **sub-agent sessions** (which use tools heavily), intermediate turn text represents meaningful user-facing content.

See `docs/agents/architecture-overview.md` → [Turn-Aware Streaming] for the full interface definitions.

### Validation Strategy

Structured data is validated at the **tool call level**, not via post-hoc JSON parsing:

1. **Tool inputs**: Validated by Zod schemas registered with the MCP server. Invalid tool calls are rejected by the SDK before reaching the handler.
2. **snapshotToMindOutput()**: Converts validated tool data to `MindOutput`. Provides fallback defaults for missing thoughts/experience.
3. **safeMindOutput()**: Fallback when the agent session fails entirely — produces a minimal valid `MindOutput` from trigger context.
4. **No JSON parsing**: The model never outputs raw JSON. All structured data flows through Zod-validated MCP tool inputs.

### Cross-Provider Behavior

Cognitive MCP tools use the Claude SDK's in-process MCP server pattern (`createSdkMcpServer()`). Provider support:

- **Claude**: Full support. In-process MCP server attaches to the agent session. Tools are Zod-validated.
- **Pi**: Full support planned. Pi's in-process architecture supports MCP tool registration natively.
- **Codex / OpenCode**: Not yet supported. These providers fall back to `safeMindOutput()` (minimal valid output). Future work may bridge cognitive tools via provider-specific mechanisms.

The cognitive tools are built once per process lifetime and cached. The `CognitiveSnapshot` is reset before each tick via `resetSnapshot()`.

## Error Handling Strategy

Errors in the heartbeat pipeline follow a four-tier strategy that prioritizes resilience without hiding failures.

### Tier 1 — Retryable (auto-retry, log warning)

Transient failures that should be retried automatically with exponential backoff:
- LLM API transient errors (429 rate limit, 500/503 server errors)
- Embedding computation failures (Transformers.js / OpenAI API)
- MCP tool execution failures (timeout, network)
- Network timeouts on external APIs

Max retries: 3 per operation, with 1s / 2s / 4s backoff.

### Tier 2 — Recoverable (log error, graceful degradation)

Failures that don't crash the tick but result in degraded output:
- **Structured output validation failure** → retry the tick once. If second attempt also fails, extract whatever valid fields exist (thoughts, emotions) and skip the rest. Log the malformed output for debugging.
- **Sub-agent failure** → mind is informed via the next `agent_complete` tick with `status: 'failed'`. Mind decides to retry, try a different approach, or inform the user.
- **Channel send failure** (outbound message) → log the error with full context. Do NOT auto-retry (avoid message duplication). Other EXECUTE operations continue.
- **Memory write failure** (LanceDB, memory.db) → log, continue. Memory is non-critical to the current tick's output.
- **Seed/goal processing failure** → log, skip. These are background operations.

### Tier 3 — Critical (log error, notify user via reply)

Failures that must be surfaced to the user because they affect the user's experience:
- **Mind session creation failure** → surface to user on next message: "I'm having trouble thinking right now. My system may need attention."
- **Database write failure in EXECUTE** (transaction rollback) → the tick's side effects are lost. Surface to user if they're waiting for a reply.
- **All retries exhausted during an active conversation** → tell the user something went wrong rather than silently failing.
- **Recurring task failing 5+ consecutive times** → notify primary contact.

### Tier 4 — Fatal (log, don't crash, require manual intervention)

System-level failures that prevent normal operation:
- **Database corruption** → log critical error, pause the heartbeat. Do not attempt to continue with corrupted state.
- **Missing encryption key** (`ANIMUS_ENCRYPTION_KEY`) → refuse to start channel adapters that need credentials. Log clear error message.
- **Agent SDK authentication failure** → disable that provider, log error. If it's the configured provider, pause the heartbeat and notify on next web UI visit.

### General Principles

- **Never crash the server** — catch at the top level, log, continue where possible
- **Never lose messages** — inbound messages are written to `messages.db` at ingestion time, before any tick processing
- **Transaction rollback on partial EXECUTE failures** — atomic all-or-nothing for tick side effects
- **Structured logging with correlation IDs** — every log entry includes tick number, contact ID, and session ID for traceability
- **The frontend logs errors to the console** — web UI error handling is standard React error boundaries. Backend errors that affect the user are surfaced via reply messages, not UI alerts.

---

## Crash Recovery

The heartbeat system persists state to survive crashes gracefully. The design prioritizes **safe recovery** over perfect recovery — losing a single tick is not catastrophic because the next tick observes current state and thinks fresh.

### How It Works

1. Before each stage, progress is persisted to SQLite:
   ```sql
   UPDATE heartbeat_state SET
     tick_number = ?,
     current_stage = ?,
     trigger_type = ?,
     trigger_context = ?   -- JSON: message content, task details, etc.
   WHERE id = 1;
   ```

2. **EXECUTE stage is wrapped in a single SQLite transaction.** All writes — thoughts, experiences, emotion updates, decisions — are committed atomically. If the process dies mid-EXECUTE, the transaction rolls back and the tick's side effects never happened. This is the primary crash safety mechanism.

3. **On startup, discard incomplete ticks.** If a tick is found with `current_stage != 'idle'`, mark it as `failed` and move on. The next tick will naturally observe the current state and re-think. Replaying incomplete ticks adds complexity with minimal benefit — the mind is designed to be resilient to missed ticks.

4. **Messages are safe regardless.** Inbound messages are written to `messages.db` at ingestion time (before tick processing), not during EXECUTE. A crash never loses messages — they'll be picked up by the next tick's GATHER CONTEXT.

5. **Sub-agent re-check on startup.** The orchestrator queries SQLite for tasks with `status = 'running'` and checks each against the agent SDK:
   - If the session completed during downtime: store results, trigger an `agent_complete` tick
   - If the session died: mark as `failed`, let the mind learn about it on the next tick
   - If the session is still running: re-attach event handlers and continue tracking

6. The mind's agent session is resumable via the `@animus-labs/agents` session resume capability (`{provider}:{native_id}` format). On crash recovery, the warm session is lost — the next tick starts cold. This is acceptable; cold starts just inject the full system prompt and GATHER CONTEXT.

### State Schema

```sql
CREATE TABLE heartbeat_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),  -- Singleton
  tick_number INTEGER NOT NULL DEFAULT 0,
  current_stage TEXT NOT NULL DEFAULT 'idle',  -- 'idle' | 'gather' | 'mind' | 'execute'
  session_state TEXT NOT NULL DEFAULT 'cold',  -- 'cold' | 'active' | 'warm'
  trigger_type TEXT,                            -- 'interval' | 'message' | 'task' | 'agent_complete'
  trigger_context TEXT,                         -- JSON
  mind_session_id TEXT,                         -- Agent session ID for resume
  session_token_count INTEGER DEFAULT 0,        -- Cumulative tokens in current session (for context budget)
  started_at TEXT NOT NULL,
  last_tick_at TEXT,
  session_warm_since TEXT,                      -- When the current warm window started
  is_running INTEGER NOT NULL DEFAULT 0         -- 0 = paused (pre-onboarding or stopped), 1 = running
);
```

## TTL and Cleanup

Expired data is cleaned up during the EXECUTE stage of each tick:

```typescript
async function cleanupExpiredEntries(): Promise<void> {
  const now = new Date().toISOString();

  db.prepare(`
    DELETE FROM thoughts WHERE expires_at IS NOT NULL AND expires_at < ?
  `).run(now);

  db.prepare(`
    DELETE FROM experiences WHERE expires_at IS NOT NULL AND expires_at < ?
  `).run(now);

  db.prepare(`
    DELETE FROM emotion_history WHERE created_at < datetime('now', '-' || ? || ' days')
  `).run(emotionHistoryRetentionDays);
}
```

Note: The `emotion_state` table (12 fixed rows) is never cleaned up — it's persistent state. Only `emotion_history` has TTL-based cleanup.

## API

### Control

```typescript
// Start the heartbeat timer
startHeartbeat(): void

// Stop the heartbeat timer (does not end the mind session)
stopHeartbeat(): void

// Manually trigger a tick (for testing/debugging)
triggerTick(trigger?: TriggerContext): Promise<TickResult>

// Process an incoming message (resolves contact, triggers a tick)
// Returns null for unknown callers (canned response handled internally)
handleMessage(message: IncomingMessage): Promise<MessageReply | null>

// Process a scheduled task (triggers a tick)
handleTask(task: ScheduledTask): Promise<void>

// Process sub-agent completion (triggers a tick)
handleAgentComplete(result: AgentResult): Promise<void>
```

### Query

```typescript
getHeartbeatState(): HeartbeatState

interface HeartbeatState {
  tickNumber: number;
  currentStage: 'idle' | 'gather' | 'mind' | 'execute';
  triggerType: 'interval' | 'message' | 'task' | 'agent_complete' | null;
  mindSessionId: string | null;
  startedAt: Timestamp;
  lastTickAt: Timestamp | null;
  isRunning: boolean;
}
```

## Real-time Monitoring

The frontend can subscribe to heartbeat updates via tRPC subscriptions:

```typescript
// Backend
onHeartbeat: publicProcedure.subscription(() => {
  return observable<HeartbeatState>((emit) => {
    const onTick = () => emit.next(getHeartbeatState());
    heartbeatEmitter.on('tick', onTick);
    return () => heartbeatEmitter.off('tick', onTick);
  });
});

// Frontend
const { data: heartbeat } = trpc.onHeartbeat.useSubscription();
```

## Shared Abstractions

The heartbeat system uses several shared abstractions (see `docs/architecture/tech-stack.md` for full details):

- **Context Builder** — Assembles the mind's system prompt and GATHER CONTEXT payload each tick (`docs/architecture/context-builder.md`)
- **Decay Engine** — Computes emotion decay toward baselines between ticks
- **Event Bus** — Emits tick lifecycle events (`tick:complete`, `emotion:changed`) consumed by the frontend and logging systems
- **Database Stores** — Typed data access for `heartbeat.db` (thoughts, experiences, emotions, heartbeat state)

## Future Considerations

1. **Variable Tick Rate** — Adjust heartbeat interval based on activity level (faster when engaged, slower when idle)
2. **Sleep Mode** — Reduced tick rate during quiet hours. During sleep, emotion decay should accelerate or snap to baseline, serving as the primary emotion reset mechanism
3. **Context Window Management** — As the mind session grows, the agent SDK handles auto-compaction, but we may want to proactively summarize older context
4. **Multi-Model Mind** — Use a cheaper/faster model for idle interval ticks, a more capable model when processing messages or complex tasks
5. **Sub-Agent Orchestration** — See `docs/architecture/agent-orchestration.md` for the full design of how the mind delegates to sub-agents, tracks their lifecycle, forwards updates, and processes results
6. **Contact System** — See `docs/architecture/contacts.md` for the full design of identity resolution, permission tiers, message isolation, and cross-contact information boundaries
