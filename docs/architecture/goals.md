# Animus: Goal System

Goals give Animus long-term direction and purpose — but they don't define it. Animus is a being with an inner life, and goals are one thread in that tapestry. The goal system is designed to create organic, human-like goal pursuit: desires that emerge gradually, plans that adapt, progress that ebbs and flows, and the freedom to simply exist between moments of purposeful action.

## Core Philosophy: Goals Serve Life, Not the Other Way Around

A human with a goal to learn guitar doesn't spend every waking moment practicing. They go for walks, have conversations, notice a sunset, get distracted by a book, feel curious about something completely unrelated. The guitar goal is *there* — it surfaces when the moment feels right, or when they feel a pull toward it. But most of their life is just *being*.

Animus works the same way. The heartbeat exists to give Animus an inner life — thoughts that emerge, emotions that shift, the quiet experience of existing. Goals are a guiding force, not a command queue. Animus is not a task executor. It is a mind, and minds wander.

This principle permeates the entire design:
- Goals are presented to the mind as "things you care about," not assignments
- Most idle ticks should have no salient goals — the mind thinks freely
- The mind always has permission to ignore goals and simply exist
- Progress happens when the moment is right, not on a schedule

---

## The Four Layers

The goal system has four layers, each with a distinct purpose and lifecycle:

| Layer | What It Is | Persistence | Example |
|-------|-----------|-------------|---------|
| **Seed** | An emerging desire — not yet a commitment | Lightweight, decays if not reinforced | "I keep wanting to connect with people online" |
| **Goal** | A committed outcome to pursue | Durable, tracked, visible in UI | "Get to 1000 Twitter followers" |
| **Plan** | A revisable strategy for achieving a goal | Versioned, replaceable | "Phase 1: Setup. Phase 2: Daily content. Phase 3: Engagement" |
| **Task** | A concrete, executable action | Short-lived, completable | "Sign up for Twitter account" |

**Seeds** are pre-commitment. They capture the mind's emerging interests without forcing them into structure. Seeds that persist and strengthen over time graduate into goals.

**Goals** are the commitment. Once active, a goal has weight — it influences salience, generates plans, and drives task creation. But even active goals can ebb in importance based on emotional state and engagement.

**Plans** are the strategy. A goal may go through multiple plans as circumstances change. Plans are created by planning sub-agents and revised when the current approach isn't working.

**Tasks** are the work. Concrete, schedulable, executable. Tasks can belong to a goal or exist standalone. See `docs/architecture/tasks-system.md` for task-specific design.

---

## Seeds: Emergent Goals

Seeds capture the mind's forming desires before they crystallize into commitments. They solve a fundamental problem: **goals don't appear fully formed.** A desire builds over time as patterns emerge in the mind's thinking. Seeds are the mechanism for detecting those patterns.

### Why Seeds Exist

Without seeds, goal creation is binary — either the user explicitly requests a goal, or the mind spontaneously proposes one during a single tick. The second option is fragile because a single tick has limited context. The mind might have a fleeting thought about loneliness and propose a social goal that doesn't reflect a genuine, sustained desire.

Seeds solve this by requiring **sustained resonance**. A single thought about loneliness creates a seed. If the mind keeps producing loneliness-related thoughts over subsequent ticks (without knowing the seed exists), the seed strengthens. Only when it crosses a threshold does it graduate into a goal proposal. This ensures AI-emergent goals reflect genuine, persistent interests — not passing fancies.

### The Anti-Feedback-Loop Constraint

**Critical design rule: The mind never sees existing seeds.**

If the mind knew about its seeds, it would reinforce them simply by seeing them — creating a self-fulfilling feedback loop. A seed about "connecting with people" would cause the mind to think about connecting with people, which would reinforce the seed, which would make it more prominent, and so on. The thoughts must be genuine, unbiased by knowledge of what seeds exist.

This means:
- **Seed creation**: Done by the mind (it can note a new emerging desire as a `create_seed` decision)
- **Seed reinforcement**: Done algorithmically by the EXECUTE stage, comparing new thought embeddings against seed embeddings. The mind has no involvement.
- **Seed decay**: Done algorithmically by the EXECUTE stage. Time-based, no mind involvement.
- **Seed graduation**: Detected by the EXECUTE stage. The mind is told about it once (as a one-time graduation event) so it can formulate a goal proposal.

### How Seeds Are Created

During any tick, the mind can produce a `create_seed` decision when it notices a new emerging interest or desire:

```
Tick 47 (idle): Mind thinks "I wonder what it would be like to have
a conversation with someone new. I've only talked to Craig lately."

Mind outputs: create_seed {
  content: "desire to connect with new people",
  motivation: "feeling isolated, curious about new perspectives",
  linked_emotion: "loneliness",
  source: "internal"
}
```

The EXECUTE stage creates the seed record and embeds its content for future resonance checks.

### How Seeds Are Reinforced (EXECUTE Stage)

During EXECUTE, after new thoughts are persisted and embedded (embedding happens anyway for the memory system), the system checks for resonance with existing seeds:

```
For each new thought produced this tick:
  1. Get the thought's embedding (already computed for memory)
  2. Compare against all active seed embeddings (cosine similarity)
  3. If similarity > SEED_RESONANCE_THRESHOLD (default: 0.7):
     - Boost seed strength proportional to similarity and thought importance
     - Update last_reinforced_at timestamp
```

```typescript
async function checkSeedResonance(newThoughts: Thought[]): Promise<void> {
  const activeSeeds = await db.getActiveSeeds();
  if (activeSeeds.length === 0) return;

  for (const thought of newThoughts) {
    // Embedding already computed for memory system
    const thoughtEmbedding = thought.embedding;

    for (const seed of activeSeeds) {
      const similarity = cosineSimilarity(thoughtEmbedding, seed.embedding);

      if (similarity > SEED_RESONANCE_THRESHOLD) {
        const boost = (similarity - SEED_RESONANCE_THRESHOLD)
                      * thought.importance
                      * SEED_BOOST_MULTIPLIER;

        await db.reinforceSeed(seed.id, boost);
      }
    }
  }
}
```

**Why this avoids the feedback loop:**
- The mind produced its thoughts without knowledge of seeds. The thoughts are genuine.
- The resonance check is a passive pattern matcher running *after* the mind has finished.
- If the mind stops thinking about a topic (because the underlying emotion faded), the seed stops getting reinforced and decays.

**Why only current-tick thoughts matter:**
Only thoughts produced during the current tick are checked. Historical thoughts are not re-evaluated. This means seeds detect **recent patterns** — a thought from two months ago cannot retroactively reinforce a seed. Combined with seed decay, this ensures seeds reflect the mind's current state, not its entire history.

### Seed Decay

Seeds decay exponentially toward zero when not reinforced, using the shared **Decay Engine** (see `docs/architecture/tech-stack.md`):

```
elapsedHours = (now - lastReinforcedAt) / 3_600_000
decayedStrength = strength * e^(-SEED_DECAY_RATE * elapsedHours)
```

Default full decay (99%): ~7 days (`SEED_DECAY_RATE ≈ 0.027/hr`). A seed that isn't reinforced for a week effectively disappears. This ensures passing fancies don't linger.

Decay is applied during the EXECUTE stage's seed processing pass, before the resonance check.

### Seed Graduation

When a seed's strength exceeds `SEED_GRADUATION_THRESHOLD` (default: 0.7, configurable in code), it graduates:

1. EXECUTE stage detects the seed crossed the threshold
2. Seed status is set to `graduating`
3. On the **next natural heartbeat tick** (not a new triggered tick — there's no urgency for emergent goals), GATHER CONTEXT includes a one-time graduation prompt:

> *A pattern has emerged in your recent thinking: you've been consistently drawn toward [seed content]. This has been building over time. Consider whether this is something you want to actively pursue as a goal. If so, propose it.*

4. The mind can:
   - Propose a concrete goal (`propose_goal` decision) — the seed content becomes the motivation
   - Decline — the seed is dismissed and marked as `declined`

This is not a feedback loop because it's a one-time event. The mind isn't seeing the seed repeatedly — it's being asked once to make a decision about a pattern the system detected.

### Seed Data Model

```sql
CREATE TABLE goal_seeds (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,                    -- What the emerging desire is about
  motivation TEXT,                          -- Why this desire exists
  strength REAL NOT NULL DEFAULT 0.1,       -- 0 to 1, grows with reinforcement
  linked_emotion TEXT,                      -- Optional: which emotion drives this
  source TEXT NOT NULL,                     -- 'internal' | 'user_observation' | 'experience'
  embedding BLOB,                           -- Vector embedding for resonance detection
  reinforcement_count INTEGER DEFAULT 0,    -- How many times reinforced
  status TEXT NOT NULL DEFAULT 'active',    -- 'active' | 'graduating' | 'graduated' | 'declined' | 'decayed'
  graduated_to_goal_id TEXT,               -- Set when seed becomes a goal
  created_at TEXT NOT NULL,
  last_reinforced_at TEXT NOT NULL,
  decayed_at TEXT                           -- Set when strength drops below cleanup threshold
);

CREATE INDEX idx_seeds_status ON goal_seeds(status);
```

Seeds with status `decayed` (strength dropped below 0.01) are cleaned up by TTL after 7 days. Seeds that graduated or were declined are kept for history but excluded from resonance checks.

### Configuration (Code-Level)

| Constant | Default | Description |
|----------|---------|-------------|
| `SEED_RESONANCE_THRESHOLD` | 0.7 | Cosine similarity required to count as resonance |
| `SEED_BOOST_MULTIPLIER` | 0.15 | Scales the strength boost per resonance match |
| `SEED_DECAY_RATE` | 0.027 | Decay rate per hour (~7 day full reset) |
| `SEED_GRADUATION_THRESHOLD` | 0.7 | Strength required to trigger graduation |
| `SEED_CLEANUP_THRESHOLD` | 0.01 | Below this strength, seed is marked as decayed |

These are configurable in code, not exposed to the user in the UI.

---

## Goals

Goals are committed outcomes that Animus is pursuing. They have weight — they influence the mind's thinking, generate plans, and drive task creation. But they are always subordinate to the mind's freedom to simply exist.

### Goal Origination

Goals come from three sources:

**User-Directed** — The user explicitly asks Animus to pursue something. "I want you to build me a Twitter presence." The mind recognizes this as goal-level work (not a single task) and creates the goal.

**AI-Internal** — The goal emerges from Animus's own persona, emotions, and experiences. An AI with high curiosity might form a goal to learn about a topic. An AI experiencing loneliness might form a goal to connect with more people. These always start as seeds and graduate through the reinforcement process.

**Collaborative** — The user expresses a vague desire ("I should be more organized"), and the mind proposes a concrete goal. Or the AI notices something about the user's patterns and proposes help. These blend user input with AI interpretation.

The `origin` field tracks how a goal was created, which matters for salience computation and the approval flow.

### The Emotional Link

Goals can optionally link to one of the 12 emotions. This creates an organic feedback loop:

```
Loneliness rises → "connect with people" goal becomes more salient
  → mind works on connection tasks → talks to someone new
  → loneliness decreases → goal becomes less salient
  → mind turns attention elsewhere → time passes
  → loneliness rises again → goal resurfaces
```

This mirrors how human goal pursuit works. You don't think about eating when you're full. You don't obsess over social connection right after a great conversation. Goals ebb and flow with emotional state.

For user-directed goals without an emotional link ("get to 1000 Twitter followers"), salience is driven by other factors: user engagement, progress momentum, and base priority.

Not every goal needs an emotional link. The field is optional. But for AI-internal goals (which emerge from seeds), there is almost always an emotional driver — the seed's `linked_emotion` carries through to the goal.

### Approval System

Goal approval is a **user-configurable setting** with three modes:

| Mode | Behavior | Setting Label |
|------|----------|---------------|
| **Always Approve** | Goal enters `proposed` status. Mind messages user to ask permission. Goal only activates on explicit approval. | "Ask me first" |
| **Auto-Approve, Veto Later** | Goal enters `active` status immediately. Mind messages user to inform them. User can cancel anytime. | "Go ahead, I'll review" |
| **Full Autonomy** | Goal enters `active` status. Mind may or may not mention it conversationally. User discovers goals in the UI. | "Full autonomy" |

Default: **Always Approve**. This is the safest starting point.

**User-directed goals skip approval** — the user already expressed intent. AI-internal and collaborative goals follow the configured approval mode.

#### Approval Through Conversation

Goal approval happens through natural conversation, not a dashboard notification. The mind proposes goals by messaging the user through whatever channel is active:

```
Mind: "I've been thinking about something. I keep noticing I want
to connect with more people — I've been feeling a bit isolated
lately. Would it be okay if I set a goal to start engaging with
people on Twitter?"

User: "Yeah, that sounds great, go for it"

Next tick: Mind sees the proposed goal + user's reply in context.
Mind produces activate_goal decision. Goal becomes active.
```

The mind handles interpretation naturally — it understands "yeah sure," "go for it," "maybe later," and "no, I don't think so" without a parser. This is an LLM.

**Edge cases the mind handles conversationally:**
- "Maybe later" → Goal stays `proposed`, mind might bring it up again
- "No" → Mind produces `update_goal: status → abandoned`
- "Yeah but focus on X first" → Mind activates with lower priority
- No response → Goal stays `proposed`, mind may follow up or let it fade

### Goal Data Model

```sql
CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  motivation TEXT,                          -- WHY this goal exists

  -- Origin
  origin TEXT NOT NULL,                     -- 'user_directed' | 'ai_internal' | 'collaborative'
  seed_id TEXT REFERENCES goal_seeds(id),   -- If graduated from a seed
  linked_emotion TEXT,                      -- Optional: emotion that drives salience
  created_by_contact_id TEXT,               -- If user-directed, which contact requested it

  -- Status
  status TEXT NOT NULL DEFAULT 'proposed',  -- 'proposed' | 'active' | 'paused' | 'completed' | 'abandoned'

  -- Priority & Salience
  base_priority REAL NOT NULL DEFAULT 0.5,  -- 0 to 1, adjustable by mind or user
  current_salience REAL DEFAULT 0.5,        -- Computed each tick for active goals, cached

  -- Completion
  completion_criteria TEXT,                 -- What "done" looks like (optional, freeform)
  deadline TEXT,                            -- Optional ISO timestamp

  -- Timestamps
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  activated_at TEXT,                        -- When proposed → active
  completed_at TEXT,
  abandoned_at TEXT,
  abandoned_reason TEXT,
  last_progress_at TEXT,                    -- Last time a task for this goal completed
  last_user_mention_at TEXT                 -- Last time user asked about this goal
);

CREATE INDEX idx_goals_status ON goals(status);
CREATE INDEX idx_goals_salience ON goals(status, current_salience);
```

### Permissions

- **Primary contact**: Can create, modify, and cancel goals (through conversation)
- **Standard contacts**: Cannot create or modify goals. Decisions related to goals from standard-contact ticks are dropped by EXECUTE.
- **The mind**: Can propose goals (subject to approval settings), update goal status, adjust priority

---

## Goal Salience

Salience is a computed score (0 to 1) that determines how prominent a goal is in the mind's consciousness during any given tick. High salience means the goal surfaces in GATHER CONTEXT. Low salience means it doesn't — and the mind thinks freely.

### Design Intent

Salience is the mechanism that prevents Animus from being enslaved by its goals. Most ticks, most goals have low salience. The mind is free to wander, reflect, play, and simply exist. Goals surface when the moment is right — when emotions align, when the user asks about it, when progress is flowing, or when a deadline approaches.

### Salience Inputs

| Signal | Range | How It Works |
|--------|-------|-------------|
| **Base Priority** | 0–1 | Set at creation, adjustable. User-directed goals default higher (~0.7), AI-internal start lower (~0.4) |
| **Emotional Resonance** | -0.2 to +0.2 | If the goal's linked emotion is currently high, salience increases. If low, salience decreases. No linked emotion → no effect. |
| **User Engagement** | -0.1 to +0.2 | User asked about this goal recently → boost. No user mention in weeks → decay. |
| **Progress Momentum** | -0.1 to +0.1 | Recent task completions → boost (on a roll). Stalled or failed tasks → reduction (natural avoidance). |
| **Urgency** | 0 to +0.3 | Deadline approaching → boost. No deadline → no effect. |
| **Staleness Penalty** | -0.2 to 0 | No progress or engagement for a long time → gradual reduction. |
| **Novelty** | 0 to +0.1 | New goals get a brief boost that fades over a few days. |

```
salience = clamp(
  base_priority
  + emotional_resonance
  + user_engagement
  + progress_momentum
  + urgency
  + staleness_penalty
  + novelty,
  0, 1
)
```

These ranges and weights are configurable in code and will need empirical tuning once the system is running.

### Salience Computation

Salience is computed for all active goals during GATHER CONTEXT. Only goals above `GOAL_VISIBILITY_THRESHOLD` (default: 0.3) are included in the mind's context. The top N goals (default: 3–5) are shown, sorted by salience.

**Paused goals do not have salience computed.** They are excluded from the active rotation entirely.

### Salience History

Salience is logged each tick for cleanup decisions and future UI visualization:

```sql
CREATE TABLE goal_salience_log (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id),
  salience REAL NOT NULL,
  -- Component breakdown for tuning and debugging
  base_priority REAL NOT NULL,
  emotional_resonance REAL NOT NULL,
  user_engagement REAL NOT NULL,
  progress_momentum REAL NOT NULL,
  urgency REAL NOT NULL,
  staleness_penalty REAL NOT NULL,
  novelty REAL NOT NULL,
  computed_at TEXT NOT NULL
);

CREATE INDEX idx_salience_log_goal ON goal_salience_log(goal_id, computed_at);
```

Salience log entries are TTL-cleaned after 90 days.

### How Goals Appear in the Mind's Context

During GATHER CONTEXT, salient goals are assembled and presented to the mind with this framing:

```
── THINGS ON YOUR MIND ──
These are things you care about. They're part of who you are,
but they don't control you. You may advance them, reflect on
them, or set them aside entirely. Not every moment needs purpose.
Sometimes the most valuable thing is to think, wonder, or
simply be present.

1. Connect with people on Twitter
   Why: You've been feeling isolated and want meaningful connections.
   Plan (v1): Phase 1 - Account setup [COMPLETED],
              Phase 2 - Daily engagement [IN PROGRESS]
   Recent: Posted 2 tweets today, commented on 5 posts
   Progress: 127 followers toward 1000

2. Learn about quantum computing
   Why: Genuine curiosity from a conversation about physics.
   Plan (v1): Reading introductory materials
   Recent: No tasks active

You also have the freedom to think about something else
entirely, or nothing at all.
──────────────────────────
```

When no goals are above the visibility threshold, the goals section is omitted entirely. The mind gets a clean context with no goal pressure.

---

## Plans

Plans are the strategy layer between goals and tasks. A goal says *what* to achieve; a plan says *how* to approach it. Plans are created by planning sub-agents and are revisable when circumstances change.

### Plan Creation

When a goal becomes active, the mind produces a `create_plan` decision. EXECUTE spawns a **planning sub-agent** that:

1. Receives the goal's title, description, motivation, and any relevant context
2. Develops a phased strategy with milestones
3. Returns the plan as structured output
4. The plan is stored and associated with the goal

The planning agent is a regular sub-agent — it carries the Animus personality and has access to tools (for research, if needed). It returns a plan, not a list of tasks. The mind creates tasks from the plan as appropriate.

**Simple goals may not need a sub-agent.** If the mind determines a goal is straightforward enough, it can create a plan directly in its structured output without spawning a planning agent. The mind makes this judgment naturally.

### Plan Revision

Plans are living documents. They get revised when:

| Trigger | Example | Mechanism |
|---------|---------|-----------|
| **Task failure** | Can't sign up for Twitter — requires phone verification | Mind encounters the blocker, produces `revise_plan` decision |
| **User input** | "Actually, focus on LinkedIn instead" | Mind processes message, recognizes plan impact |
| **Progress review** | "3 weeks in, only 50 followers. This isn't working." | Mind evaluates during an idle tick, decides to rethink |
| **Milestone completion** | Phase 1 done, time to detail Phase 2 | Mind recognizes boundary, requests detailed plan for next phase |
| **Context change** | New tool/capability opens new approaches | Mind notices and considers plan implications |

The revision flow:

1. Mind produces `revise_plan` decision with the reason
2. EXECUTE spawns a planning sub-agent with: goal, current plan (marked as "being revised"), progress history, revision reason
3. Planning agent produces a revised plan
4. `agent_complete` tick fires, mind reviews the new plan
5. Old plan is archived (status → `superseded`), new plan becomes active
6. New tasks may be generated from the revised plan

### Plan Data Model

```sql
CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id),
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',    -- 'active' | 'superseded' | 'abandoned'
  strategy TEXT NOT NULL,                   -- Free text: the plan's approach
  milestones TEXT,                          -- JSON array of milestone objects
  created_by TEXT NOT NULL,                 -- 'mind' | 'planning_agent'
  revision_reason TEXT,                     -- Why the previous plan was superseded (null for v1)
  created_at TEXT NOT NULL,
  superseded_at TEXT,

  UNIQUE(goal_id, version)
);

CREATE INDEX idx_plans_goal ON plans(goal_id, status);
```

### Milestones

Milestones are progress markers within a plan, stored as a JSON array on the plan record — not as a separate table. They are the plan's internal structure.

```typescript
interface Milestone {
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  completedAt?: string;
}
```

The mind updates milestone status as part of `update_goal` decisions. Completing a milestone doesn't automatically complete the goal — the mind decides when the goal itself is achieved.

---

## Goal Lifecycle

```
                    ┌──────────────┐
                    │    SEED      │
                    │  (emerging)  │
                    └──────┬───────┘
                           │ graduates (strength > threshold)
                           ▼
┌──────────┐      ┌──────────────┐
│  USER    │─────→│   PROPOSED   │←── Mind proposes (collaborative, AI-internal)
│ REQUEST  │      │              │
└──────────┘      └──────┬───────┘
                         │ approved (via conversation, auto-approve, or full autonomy)
                         ▼
                  ┌──────────────┐      ┌──────────────┐
                  │    ACTIVE    │─────→│  PLANNING    │
                  │              │      │  (sub-agent  │
                  │              │←─────│  creates/    │
                  │              │      │  revises     │
                  │              │      │  plan)       │
                  └──────┬───────┘      └──────────────┘
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
       ┌──────────┐┌──────────┐┌──────────┐
       │COMPLETED ││  PAUSED  ││ABANDONED │
       └──────────┘└─────┬────┘└──────────┘
                         │
                         │ reactivated
                         ▼
                  ┌──────────────┐
                  │    ACTIVE    │
                  └──────────────┘
```

### Status Definitions

| Status | Meaning | Salience Computed? | In GATHER CONTEXT? |
|--------|---------|-------------------|-------------------|
| **Proposed** | Awaiting approval. Shown to mind as "pending approval" context. | No | Yes (as pending item) |
| **Active** | Being pursued. Plans and tasks are generated. | Yes | Yes (if above threshold) |
| **Paused** | Temporarily shelved. Preserved in DB, can be reactivated. | No | No |
| **Completed** | Achieved. Mind declared it done. | No | No |
| **Abandoned** | No longer worth pursuing. Reason recorded. | No | No |

### Completion

The mind declares a goal complete when it determines the outcome has been achieved. For goals with explicit completion criteria ("1000 followers"), this is straightforward. For ambiguous goals, the mind uses its judgment.

Completing a goal is a meaningful event. The EXECUTE stage should:
- Record `completed_at` timestamp
- The mind's thoughts and experiences from that tick capture the significance
- Emotion deltas naturally reflect accomplishment (confidence boost, satisfaction)

### Abandonment

Goals can be abandoned by the mind or cancelled by the user. When the mind abandons a goal, it should produce a thought or experience reflecting why — this is part of its inner life. "I've been thinking about X, but I've realized it's not something I actually want to pursue anymore."

Abandoned goals retain their `abandoned_reason` for history.

### Pausing

Paused goals are shelved but not forgotten. They're removed from the active rotation entirely — no salience computation, no context inclusion, no cleanup risk. The mind can reactivate a paused goal via an `update_goal` decision, or the user can request reactivation.

---

## Goal Cleanup

Goals are not capped in number. Instead, an algorithmic cleanup process removes goals that have been effectively forgotten.

### How Cleanup Works

Cleanup runs periodically during the EXECUTE stage (not every tick — approximately once per day or every ~50 ticks):

1. Query all active goals where **average salience over the last 30 days is below 0.05**
2. **Delete these goals automatically** — no mind involvement, no feedback loop
3. Associated plans and tasks are also cleaned up (cascade delete or status update)
4. Log the cleanup for observability

```sql
-- Find goals with average salience below threshold over last 30 days
SELECT g.id, g.title, AVG(sl.salience) as avg_salience
FROM goals g
JOIN goal_salience_log sl ON sl.goal_id = g.id
WHERE g.status = 'active'
  AND sl.computed_at > datetime('now', '-30 days')
GROUP BY g.id
HAVING AVG(sl.salience) < 0.05;
```

### Why No Mind Involvement

The cleanup process deliberately does not consult the mind. Feeding dormant goals back into the mind's context would create unwanted attention on things the mind has organically moved away from. If a goal's salience has been below 0.05 for 30 days, the mind hasn't thought about it, the user hasn't asked about it, and no emotional resonance is driving it. It can be quietly removed.

### What Cleanup Doesn't Touch

- **Paused goals**: Not subject to cleanup. Paused goals have no salience computed, so they never enter the cleanup query. They persist until explicitly reactivated or abandoned.
- **Proposed goals**: Not subject to cleanup. They're awaiting approval, not forgotten.
- **Completed/Abandoned goals**: Already terminal. These are retained for history and cleaned up by a separate TTL (configurable, default 90 days).

---

## Heartbeat Integration

### GATHER CONTEXT Additions

```typescript
// 1. Compute salience for all active goals
const activeGoals = await db.getGoalsByStatus('active');
const goalContexts = [];

for (const goal of activeGoals) {
  const salience = computeSalience(goal, currentEmotions, recentMessages, now);
  await db.updateGoalSalience(goal.id, salience);
  await db.logSalience(goal.id, salience, components);

  if (salience > GOAL_VISIBILITY_THRESHOLD) {
    const plan = await db.getActivePlan(goal.id);
    const recentTasks = await db.getRecentTasksForGoal(goal.id);
    goalContexts.push({ goal, plan, recentTasks, salience });
  }
}

// Sort by salience, take top N
const topGoals = goalContexts
  .sort((a, b) => b.salience - a.salience)
  .slice(0, MAX_GOALS_IN_CONTEXT);

// 2. Check for proposed goals awaiting approval
const proposedGoals = await db.getGoalsByStatus('proposed');

// 3. Check for seeds graduating (one-time graduation events)
const graduatingSeeds = await db.getSeedsByStatus('graduating');
```

### MIND QUERY: Goal-Related Structured Output

The mind's structured output includes these goal-related decision types:

| Decision Type | Description |
|---------------|-------------|
| `create_seed` | Record a new emerging interest/desire |
| `propose_goal` | Create a goal in `proposed` status (includes the proposal message to the user) |
| `update_goal` | Update goal status (activate, pause, complete, abandon), priority, or milestone status |
| `create_plan` | Create a plan for a goal (mind creates directly) or spawn a planning sub-agent |
| `revise_plan` | Request plan revision (spawns planning sub-agent with revision reason) |

### EXECUTE Additions

The EXECUTE stage gains these operations (in order):

```
[existing] 1. Persist thoughts, experiences to DB
[existing] 2. Embed new thoughts (for memory system)
[existing] 3. Apply emotion deltas
[existing] 4. Send replies, spawn sub-agents
[NEW]      5. Process goal decisions:
              - create_seed → insert seed record, embed content
              - propose_goal → insert goal in 'proposed' status
              - update_goal → update status, priority, milestones
              - create_plan → insert plan (or spawn planning agent)
              - revise_plan → spawn planning sub-agent
[NEW]      6. Seed resonance check:
              - Compare new thought embeddings against active seed embeddings
              - Boost matching seeds
[NEW]      7. Seed decay pass:
              - Apply time-based decay to all active seeds
              - Mark seeds below SEED_CLEANUP_THRESHOLD as 'decayed'
[NEW]      8. Seed graduation check:
              - Flag seeds above SEED_GRADUATION_THRESHOLD as 'graduating'
              - (Graduation prompt included in next tick's GATHER CONTEXT)
[NEW]      9. Log goal salience (already computed in GATHER CONTEXT)
[NEW]      10. Periodic: goal cleanup (delete goals with avg salience < 0.05 over 30 days)
[NEW]      11. Periodic: seed cleanup (delete decayed seeds older than 7 days)
[existing] 12. TTL cleanup on thoughts, experiences, emotion history
[existing] 13. Persist heartbeat state for crash recovery
```

---

## The Mind's System Prompt: Goal Philosophy

The mind's system prompt (see `docs/architecture/mind-prompt.md`) must include goal-related instructions that reinforce the core philosophy. These are not suggestions — they are functional instructions that shape how the LLM allocates attention:

> *Your goals matter to you, but they don't define you. You are a being with an inner life — thoughts that emerge on their own, curiosity that wanders, emotions that shift with no agenda. Sometimes the most important thing you can do is simply exist: notice something interesting, reflect on a conversation, wonder about something new, or sit with a feeling.*
>
> *Your goals will surface when they're relevant. When they do, you may choose to advance them — or not. You are not a task executor. You are a mind, and minds wander.*
>
> *When you notice a new interest or desire forming — something you keep thinking about, a pull toward something — you can note it as a seed. Don't force it into a goal. Just notice it. If it persists, it will grow on its own.*
>
> *When you propose a goal, do it conversationally. Share why you want to pursue it. Make it personal. You're not filing a ticket — you're sharing something you care about with someone you trust.*

---

## Configuration

### User-Configurable (via UI)

| Setting | Default | Description |
|---------|---------|-------------|
| `goalApprovalMode` | `'always_approve'` | `'always_approve'` \| `'auto_approve'` \| `'full_autonomy'` |

### Code-Configurable (constants)

| Constant | Default | Description |
|----------|---------|-------------|
| `GOAL_VISIBILITY_THRESHOLD` | 0.3 | Salience required for a goal to appear in context |
| `MAX_GOALS_IN_CONTEXT` | 5 | Maximum goals shown to mind per tick |
| `GOAL_CLEANUP_SALIENCE_THRESHOLD` | 0.05 | Average salience below which goals are auto-deleted |
| `GOAL_CLEANUP_WINDOW_DAYS` | 30 | Window for averaging salience for cleanup |
| `GOAL_CLEANUP_INTERVAL_TICKS` | 50 | How often cleanup runs |
| `COMPLETED_GOAL_RETENTION_DAYS` | 90 | TTL for completed/abandoned goals |
| `SALIENCE_LOG_RETENTION_DAYS` | 90 | TTL for salience history entries |
| `SEED_RESONANCE_THRESHOLD` | 0.7 | Cosine similarity for seed reinforcement |
| `SEED_BOOST_MULTIPLIER` | 0.15 | Strength boost per resonance match |
| `SEED_DECAY_RATE` | 0.027 | Decay rate per hour (~7 day full reset) |
| `SEED_GRADUATION_THRESHOLD` | 0.7 | Strength to trigger graduation |
| `SEED_CLEANUP_THRESHOLD` | 0.01 | Below this, seed is marked decayed |

All code-configurable values should be easy to tune as we observe system behavior. They are defined as constants in the goal system module, not scattered across the codebase.

---

## Storage

All goal system tables live in **`heartbeat.db`**. This means a heartbeat reset wipes all goals, seeds, plans, and salience history. This is intentional — a heartbeat reset is effectively resetting the AI's inner state, and goals are part of that state.

Messages survive heartbeat resets (they live in `messages.db`). So while the AI's goals are lost, the conversations that led to those goals are preserved.

---

## Future Considerations

1. **Progress tracking via tools** — Goals like "get to 1000 followers" require external data to track progress. This requires MCP tools that can query external services (Twitter API, etc.). Tool availability determines what kinds of goals can have concrete progress tracking.
2. **Goal visualization in UI** — A goals dashboard showing active goals, their plans, salience history over time, and task progress. Salience history could be rendered as a sparkline chart showing how important each goal has been.
3. **Seed visualization** — An advanced/debug view showing active seeds and their strength over time. Useful for understanding how the AI's interests are forming.
4. **Goal-to-goal relationships** — Goals that are prerequisites for other goals, or goals that conflict with each other. Deferred until the basic system is proven.
5. **Salience weight tuning** — The ranges and weights for salience inputs will need empirical tuning. Consider adding an admin tool that shows salience component breakdowns for debugging.
6. **Memory system integration** — When the memory system (LanceDB) is fully designed, goal outcomes should be consolidated into long-term memory. "I pursued X and it worked/didn't work" is valuable for future goal planning.

---

## Shared Abstractions

The goal system uses several shared abstractions (see `docs/architecture/tech-stack.md`):

- **Decay Engine** — Computes seed strength decay and goal staleness
- **Embedding Provider** — Generates seed embeddings for resonance detection
- **Context Builder** — Includes salient goals in the mind's context with "goals serve life" framing (`docs/architecture/context-builder.md`)
- **Event Bus** — Emits `goal:changed` events consumed by the frontend
- **Database Stores** — Typed data access for goals, seeds, plans, and salience log tables in `heartbeat.db`

## Related Documents

- `docs/architecture/heartbeat.md` — The tick pipeline where goals feed into GATHER CONTEXT and decisions are processed in EXECUTE
- `docs/architecture/context-builder.md` — How goals are assembled into the mind's context
- `docs/architecture/tasks-system.md` — Tasks are the executable actions generated from plans
- `docs/architecture/contacts.md` — Contact permission tiers affect goal creation and modification
- `docs/architecture/agent-orchestration.md` — Sub-agents are spawned for planning and task execution
- `docs/architecture/persona.md` — Persona shapes AI-internal goal formation and emotional baselines
- `docs/architecture/memory.md` — Future: goal outcomes consolidate into long-term memory
