# Animus: Task System

Tasks are the concrete units of work through which Animus makes progress — toward goals, in service of user requests, or driven by its own initiative. A task is a scheduled trigger with context: it fires at the right time, triggers a mind session, and gives the mind enough context to decide what to do. The mind always has judgment. A task is a prompt, not a command.

## Concept

Tasks bridge the gap between intent and action. Goals describe *what* to achieve. Plans describe *how* to approach it. Tasks are the *when and what specifically* — the next concrete thing to do.

Tasks come in two flavors based on timing:

- **Scheduled tasks** have a specific time to fire (one-shot or recurring via cron). They fire precisely at the scheduled time in their own fresh mind session, independent of the normal heartbeat rhythm. Multiple scheduled tasks can execute in parallel.

- **Deferred tasks** have no specific time. They represent work to pick up "when the moment is right." They surface during normal idle heartbeat ticks alongside salient goals, and the mind decides whether to take them on. Like goals, they don't enslave the mind — they're options, not obligations.

Both types follow the same philosophy: the mind experiences doing the task. Every task execution produces thoughts, experiences, and emotion deltas. The AI remembers doing its work.

---

## Two Execution Models

### Scheduled Tasks: Precision Timing, Parallel Sessions

Scheduled tasks fire at exact times via a dedicated task scheduler that runs independently of the heartbeat interval timer. When a task is due:

```
Task Scheduler detects task is due (9:01 PM)
    │
    ▼
Create fresh COLD mind session (separate from message session)
    │
    ▼
Full pipeline: GATHER CONTEXT → MIND QUERY → EXECUTE
    │
    ├── Mind produces thoughts, experiences, emotion deltas
    ├── Mind handles the task inline (simple: send a reminder)
    └── Mind delegates to sub-agent (complex: check YouTube stats)
           │
           ▼
       agent_complete → normal heartbeat tick
       Main mind processes result, messages user
```

**Key properties:**
- **Fresh session**: Scheduled tasks always create a new cold mind session. They don't reuse the warm session used for messages. This prevents task context from polluting conversational context, and vice versa.
- **Parallel execution**: Multiple scheduled tasks firing at the same time each get their own session and run concurrently. SQLite WAL mode handles concurrent writes (EXECUTE stages serialize naturally at the DB level).
- **Full cognitive output**: The mind produces thoughts, experiences, and emotion deltas during task ticks. The AI needs to *experience* doing the work — it should have memory of checking YouTube, sending a reminder, or posting a tweet.
- **Mind always decides**: The orchestrator controls sub-agents. The mind always decides whether to handle a task inline or delegate to a sub-agent. We never bypass the mind to spawn agents directly.

**System prompt for task ticks:** Task ticks use a modified system prompt that includes:
- Full Animus personality (same as always)
- Task context (title, description, instructions, goal/plan if linked)
- Current emotional state (decayed)
- Recent thoughts and experiences (for continuity)
- The mind's judgment instruction: "You are executing a scheduled task. You have full agency to decide how to handle it — complete it directly, delegate to a sub-agent, or determine it's no longer relevant and skip it."
- Output schema tailored for task execution (see [Structured Output](#structured-output))

**The system prompt does NOT include:** message history from the conversational session. Task sessions are focused on the task, not on ongoing conversations.

### Deferred Tasks: Idle Tick Pickup

Deferred tasks have no scheduled time. They surface during normal idle heartbeat ticks, presented in GATHER CONTEXT alongside salient goals:

```
── PENDING TASKS ──
Things you could work on when you're ready.
These are not urgent — pick them up when it feels right.

1. [priority: 0.7] Research best practices for indoor gardening
   From: Craig mentioned wanting to start a garden (3 days ago)
   For goal: Help Craig with hobbies

2. [priority: 0.4] Look into new TypeScript features
   From: Your own curiosity (1 week ago)
   No associated goal

You don't have to work on any of these right now.
──────────────────
```

The mind may pick up a deferred task, advance a goal, or do neither. Deferred tasks follow the same "goals serve life" philosophy — they are options, not assignments.

**Deferred task pickup:**
1. GATHER CONTEXT includes the top N deferred tasks sorted by priority
2. Mind decides whether to take on a task during this tick
3. If yes, mind produces a `start_task` decision
4. EXECUTE marks the task as `in_progress`
5. Mind handles the task inline or spawns a sub-agent
6. When complete, task is marked `completed`

### Deferred Task Staleness

Deferred tasks that sit pending for too long need attention:

- **Soft urgency boost**: After 7 days pending, priority gently increases (small daily boost)
- **Auto-cancellation**: After 30 days pending with no progress, the task is automatically cancelled. No mind involvement — purely algorithmic, same as goal cleanup.
- **Mind dismissal**: The mind can explicitly dismiss a deferred task at any time: "I've decided not to do this" → task cancelled.

---

## Task Types

### One-Shot Scheduled

Fire once at a specific time. "At 9pm tonight, check my YouTube video."

- `schedule_type`: `'one_shot'`
- `scheduled_at`: ISO 8601 timestamp
- Fires once, then status → `completed` or `failed`
- If missed (server was down), fire immediately on startup

### Recurring

Fire on a cron schedule. "Every morning at 8am, check the news."

- `schedule_type`: `'recurring'`
- `cron_expression`: Full cron expression (e.g., `0 8 * * *`)
- `next_run_at`: Computed from cron, updated after each run
- Each run is tracked in `task_runs` table
- Keeps firing until cancelled, paused, or parent goal completed/abandoned

### Deferred

No specific time. "When you get a chance, research indoor gardening."

- `schedule_type`: `'deferred'`
- No `scheduled_at` or `cron_expression`
- Surfaced in GATHER CONTEXT during idle ticks
- Priority determines visibility order

---

## Task Creation

Tasks come from four sources:

### User Conversation

User says "remind me at 9pm to take my pills." The mind produces a `schedule_task` decision during the normal heartbeat tick:

```typescript
{
  type: 'schedule_task',
  task: {
    title: 'Remind Craig to take pills',
    instructions: 'Send Craig a reminder message to take his pills.',
    scheduleType: 'recurring',
    cronExpression: '0 21 * * *',  // 9pm daily
    priority: 0.8,
  }
}
```

The mind handles natural language → cron translation. "Every weekday at 9am" becomes `0 9 * * 1-5`. EXECUTE validates the cron expression (see [Cron Validation](#cron-validation)).

### Planning Agent

When a planning sub-agent creates a plan for a goal, it also creates tasks for the first milestone:

```typescript
interface PlanningAgentOutput {
  plan: {
    strategy: string;
    milestones: Milestone[];
  };
  initialTasks: TaskDefinition[];
}

interface TaskDefinition {
  title: string;
  description: string;
  instructions: string;
  milestoneIndex: number;       // Which milestone this serves
  scheduleType: 'one_shot' | 'recurring' | 'deferred';
  cronExpression?: string;      // For recurring
  scheduledAt?: string;         // For one-shot
  priority: number;             // 0-1
}
```

**Only tasks for the current milestone are created.** When a milestone completes (all its tasks done), the mind can spawn another planning session to detail the next milestone's tasks, or create them directly if the next steps are obvious.

### Mind Initiative

During any tick, the mind can create tasks from its own thinking:

- "I should follow up with Craig about the garden project tomorrow" → one-shot task
- "I want to check on this research topic periodically" → recurring task
- "I should look into this when I have time" → deferred task

### Sub-Agent Results → Mind Creates Follow-Up Tasks

Sub-agents do NOT create tasks directly. When a sub-agent discovers that follow-up work is needed (e.g., "this data updates weekly, check back in 7 days"), it includes this recommendation in its result. When the mind processes the result via the `agent_complete` tick, it can create the follow-up task itself via a `schedule_task` decision.

This keeps the mind as the single authority over task creation and scheduling. Sub-agents are executors, not planners — they recommend, the mind decides.

---

## Task Scheduler

The task scheduler is a system-level component that runs independently of the heartbeat interval timer. It manages scheduled and recurring tasks with precise timing.

### Implementation

```
┌────────────────────────────────────────────────────────┐
│                   TASK SCHEDULER                        │
│                                                        │
│  • Loads all scheduled/recurring tasks on startup      │
│  • Sets precise timers for each task's next_run_at     │
│  • When a task fires:                                  │
│    1. Triggers a fresh cold heartbeat tick              │
│    2. Computes next_run_at (for recurring)              │
│    3. Sets next timer                                  │
│  • Handles missed tasks on startup                     │
│  • Pauses when heartbeat is paused                     │
│  • Clears all timers on heartbeat reset                │
│                                                        │
│  Runs alongside:                                       │
│  ┌──────────────┐  ┌──────────────┐                    │
│  │  Heartbeat   │  │    Task      │                    │
│  │  Interval    │  │  Scheduler   │                    │
│  │  Timer       │  │              │                    │
│  │  (5 min)     │  │  (precise)   │                    │
│  └──────────────┘  └──────────────┘                    │
│        │                  │                            │
│        └────────┬─────────┘                            │
│                 ▼                                      │
│          ┌────────────┐                                │
│          │ Tick Queue  │                                │
│          │ (FIFO)      │                                │
│          └────────────┘                                │
│                                                        │
│  Note: Scheduled task ticks create their own sessions  │
│  and can run in parallel. They don't block the main    │
│  tick queue for message processing.                    │
└────────────────────────────────────────────────────────┘
```

### Startup Behavior

On server start:

1. Load all tasks with status `scheduled` or `recurring` and `is_active = true`
2. For each, check `next_run_at`:
   - If in the future → set timer
   - If in the past (missed while server was down) → fire immediately
3. For recurring tasks with multiple missed runs, fire only once (catch-up). Don't spam N missed runs.

### Pause/Resume

When the heartbeat is paused (via UI or pre-onboarding):
- Task scheduler stops. No tasks fire.
- Timers are suspended, not cleared.
- On resume, recalculate `next_run_at` for all tasks and set timers.

### Heartbeat Reset

When heartbeat.db is reset:
- All tasks are deleted (they live in heartbeat.db)
- Task scheduler clears all timers
- Fresh start with no scheduled work

---

## Task Lifecycle

```
┌──────────┐
│ PENDING  │ ← Created, not yet scheduled/active
└────┬─────┘
     │ (scheduled_at set, or cron computed, or deferred ready)
     ▼
┌──────────┐
│SCHEDULED │ ← Timer set, waiting to fire (or deferred, waiting for pickup)
└────┬─────┘
     │ (timer fires, or mind picks up deferred task)
     ▼
┌──────────────┐
│ IN_PROGRESS  │ ← Mind session active, possibly sub-agent running
└────┬─────────┘
     │
     ├──→ COMPLETED  (task done successfully)
     ├──→ FAILED     (execution failed, may retry)
     └──→ CANCELLED  (user or mind cancelled, or parent goal abandoned)

For recurring tasks:
     COMPLETED/FAILED → status stays 'scheduled', next_run_at updated
     (individual runs tracked in task_runs table)

Additional states:
     PAUSED ← task suspended (parent goal paused, or explicit pause)
             → can be resumed back to SCHEDULED
```

### Status Definitions

| Status | Meaning |
|--------|---------|
| **pending** | Created but not yet active. Brief transitional state during EXECUTE processing. |
| **scheduled** | Timer set (or deferred task ready for pickup). Actively waiting. |
| **in_progress** | Currently being executed — mind session active or sub-agent running. |
| **completed** | Successfully finished (one-shot). For recurring, individual runs complete but the task stays scheduled. |
| **failed** | Execution failed. May retry if under retry limit. |
| **cancelled** | No longer needed. User cancelled, mind dismissed, or parent goal abandoned. |
| **paused** | Temporarily suspended. Parent goal paused, or explicitly paused. Can resume. |

---

## Goal-Task Lifecycle Coupling

When a goal's status changes, associated tasks must cascade:

| Goal Event | Effect on Tasks |
|-----------|----------------|
| Goal **paused** | All pending/scheduled tasks for this goal → `paused`. Recurring tasks stop firing. Running sub-agents continue to completion. |
| Goal **abandoned** | All pending/scheduled tasks → `cancelled`. Running sub-agents continue to completion (don't kill in-progress work). |
| Goal **completed** | All remaining pending/scheduled tasks → `cancelled`. The goal is achieved; remaining tasks are irrelevant. |
| Plan **superseded** | Tasks from old plan → `cancelled`. New plan generates new tasks for the current milestone. |

This cascading happens in the EXECUTE stage when a `update_goal` decision changes the goal's status. The task scheduler is notified to clear/update timers for affected tasks.

---

## Structured Output

Task ticks produce a modified structured output compared to normal message ticks. The core cognitive output (thoughts, experiences, emotion deltas) is always present. The task-specific output replaces the message reply:

### Task Tick Output

```typescript
// TaskTickOutput is a variant of MindOutput (see docs/architecture/heartbeat.md)
// that replaces `reply` with `taskResult`. All other fields are shared.
interface TaskTickOutput {
  // Always produced (same as normal ticks)
  thoughts: Thought[];
  experiences: Experience[];
  emotionDeltas: EmotionDelta[];

  // Decisions (same pool as normal ticks)
  decisions: Decision[];          // May include spawn_agent, schedule_task, etc.

  // Memory management (same as normal ticks — the mind should maintain
  // memory during task execution, not just during conversations)
  workingMemoryUpdate?: string | null;
  coreSelfUpdate?: string | null;
  memoryCandidate?: MemoryCandidate[];

  // Task-specific (replaces `reply` from MindOutput)
  taskResult: {
    taskId: string;
    outcome: 'completed' | 'delegated' | 'skipped' | 'failed';
    result?: string;              // What was accomplished (for completed)
    skipReason?: string;          // Why the task was skipped
    failureReason?: string;       // What went wrong (for failed)
    messageToUser?: string;       // Optional message to send to the task's contact
  };
}
```

**Outcome meanings:**
- `completed`: Task handled inline. Result contains what was done.
- `delegated`: Mind spawned a sub-agent. Task stays `in_progress` until agent completes.
- `skipped`: Mind determined the task is no longer relevant. Includes reason.
- `failed`: Mind attempted the task but couldn't complete it. May retry.

### Normal Tick Output (for comparison)

Normal message-triggered or interval ticks produce the standard `MindOutput` with `MessageReply` instead of `TaskResult`. The cognitive output (thoughts, experiences, emotion deltas, decisions) uses the same schema.

---

## Task Context in GATHER CONTEXT

### For Scheduled Task Ticks

When a scheduled task fires and creates a fresh mind session, GATHER CONTEXT assembles:

```
── TASK EXECUTION ──
You have a scheduled task to execute.

Task: Check Craig's YouTube video performance
Instructions: Look up the latest video's view count, likes,
and comments. Report the stats to Craig.
Scheduled: Daily at 9:00 PM
Created: 3 days ago by Craig

Goal: Help Craig grow his YouTube channel
Plan: Phase 2 - Daily monitoring and engagement
Milestone: Track video performance [IN PROGRESS]

You have full agency. Handle this directly if you can,
delegate to a sub-agent for complex work, or skip it
if it's no longer relevant. Explain your reasoning.
──────────────────────

── CURRENT STATE ──
[Emotional state, recent thoughts, recent experiences —
 same as normal ticks, for cognitive continuity]
──────────────────
```

**Not included:** Conversational message history. Task sessions are focused on the task.

### For Deferred Tasks During Idle Ticks

Deferred tasks appear in the normal idle tick context alongside salient goals:

```
── THINGS ON YOUR MIND ──
[Salient goals as described in goals.md]

── PENDING TASKS ──
Things you could work on when you're ready.
These are not urgent — pick them up when it feels right.

1. [priority: 0.7] Research indoor gardening best practices
   From: Craig mentioned wanting to start a garden (3 days ago)
   For goal: Help Craig with hobbies

2. [priority: 0.4] Look into new TypeScript features
   From: Your own curiosity (1 week ago)
   No associated goal

You don't have to work on any of these right now.
──────────────────
```

Only the top N deferred tasks are shown (sorted by priority, default N=5). The mind may pick one up or ignore them all.

---

## Retries

Failed tasks can be retried up to a configurable limit (default: 3, configured in code).

### One-Shot and Deferred Tasks

```
Run fails → retry_count incremented
  → If retry_count < MAX_TASK_RETRIES:
      One-shot: reschedule for ~5 minutes from now
      Deferred: leave as pending (mind can try again on next pickup)
  → If retry_count >= MAX_TASK_RETRIES:
      Status → 'failed'
      Result delivered to mind in next tick for awareness
      Mind decides: inform user, try different approach, or accept failure
```

### Recurring Tasks

A failed run does not count against the task's overall retry limit. Each run gets its own retry tracking:

```
Run 1 fails → retry up to MAX_TASK_RETRIES times
  → If all retries fail: log the failed run in task_runs, move on
  → Next scheduled run fires normally (fresh retry count)
```

If a recurring task fails N consecutive runs (configurable, default: 5), the task is paused and the mind is informed: "This recurring task has failed 5 times in a row. Consider revising the approach or cancelling it."

---

## Cron Validation

When the mind translates natural language to a cron expression in a `schedule_task` decision, EXECUTE validates it:

1. Parse the cron expression to verify it's syntactically valid
2. Compute the next 3 fire times to verify they're reasonable
3. If valid: create the task, set the timer
4. If invalid: create the task in `failed` status with error "invalid cron expression: [expression]". The mind sees this failure in the next tick and can correct the expression.

This catches cases where the mind generates a malformed cron expression without silently creating a task that never fires.

---

## Timezone Handling

Animus is a single-user, self-hosted system. Timezone is handled simply:

- A `timezone` setting in `system.db` (e.g., `'America/Los_Angeles'`)
- Set automatically during onboarding based on the user's browser timezone
- Editable in settings
- **All cron expressions are evaluated in the configured timezone**
- All internal timestamps remain UTC
- Timezone conversion happens at two points: cron evaluation and UI display

```sql
-- In system.db settings
INSERT INTO settings (key, value) VALUES ('timezone', 'America/New_York');
```

---

## Data Model

### Tasks Table

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  instructions TEXT,                     -- What to do when this fires

  -- Scheduling
  schedule_type TEXT NOT NULL,           -- 'one_shot' | 'recurring' | 'deferred'
  cron_expression TEXT,                  -- For recurring (evaluated in configured timezone)
  scheduled_at TEXT,                     -- For one-shot (ISO 8601 UTC)
  next_run_at TEXT,                      -- Computed: when this task fires next (null for deferred)

  -- Goal linkage
  goal_id TEXT REFERENCES goals(id),     -- Nullable: standalone tasks have no goal
  plan_id TEXT REFERENCES plans(id),     -- Nullable: which plan generated this task
  milestone_index INTEGER,               -- Which milestone this task serves (nullable)

  -- Status
  status TEXT NOT NULL DEFAULT 'pending', -- See lifecycle diagram
  priority REAL NOT NULL DEFAULT 0.5,    -- 0-1, affects deferred task ordering

  -- Execution tracking
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  result TEXT,                           -- Final output/result for one-shot tasks

  -- Origin & Contact
  created_by TEXT NOT NULL,              -- 'mind' | 'planning_agent' | 'user'
  contact_id TEXT,                       -- FK reference to system.db contacts.id
                                         -- Who this task is for / who gets result messages
                                         -- User-created: the requesting contact (always primary)
                                         -- Mind-created: primary contact
                                         -- Planning agent: inherited from parent goal's created_by_contact_id

  -- Timestamps
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,                       -- When last execution began
  completed_at TEXT                      -- When task completed (one-shot) or was cancelled
);

CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_goal ON tasks(goal_id);
CREATE INDEX idx_tasks_next_run ON tasks(next_run_at) WHERE status = 'scheduled';
CREATE INDEX idx_tasks_deferred ON tasks(status, priority) WHERE schedule_type = 'deferred';
```

### Task Runs Table (Recurring Tasks)

Each execution of a recurring task is logged:

```sql
CREATE TABLE task_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  status TEXT NOT NULL,                  -- 'completed' | 'failed' | 'skipped'
  result TEXT,                           -- What was accomplished
  error TEXT,                            -- Error details (for failed runs)
  agent_task_id TEXT,                    -- FK to agent_tasks if a sub-agent was spawned
  retry_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX idx_task_runs_task ON task_runs(task_id, started_at);
```

**TTL cleanup:** Task runs older than 30 days are deleted during periodic EXECUTE cleanup. This prevents unbounded growth from long-running recurring tasks.

---

## Permissions

Consistent with the contact permission tier system (see `docs/architecture/contacts.md`):

- **Primary contact**: Can request task creation through conversation. Mind translates to `schedule_task` decisions.
- **Standard contacts**: Cannot create tasks. `schedule_task` decisions from standard-contact ticks are dropped by EXECUTE.
- **The mind**: Can create tasks autonomously (from idle thinking, from goal planning).
- **Sub-agents**: Cannot create tasks directly. They include follow-up recommendations in their results, and the mind creates tasks from those recommendations.
- **Planning agents**: Return initial tasks as part of their structured output (`PlanningAgentOutput.initialTasks`). The orchestrator processes these — the planning agent doesn't write to the DB directly.

---

## Heartbeat Integration

### Tick Triggers (Updated)

The four tick triggers, updated for the task system:

1. **Interval timer** — Regular heartbeat rhythm (default 5 min)
2. **Message received** — Contact sends a message
3. **Scheduled task fires** — Task scheduler triggers a fresh cold session. Multiple tasks can fire in parallel, each in their own session.
4. **Sub-agent completion** — Includes both mind-spawned and task-spawned agents

Deferred tasks are NOT a trigger. They are surfaced during idle interval ticks via GATHER CONTEXT.

### GATHER CONTEXT Additions

For **normal/interval ticks**, add to existing context assembly:

```typescript
// Load deferred tasks for idle tick context
const deferredTasks = await db.getTasksByTypeAndStatus('deferred', 'scheduled');
const topDeferredTasks = deferredTasks
  .sort((a, b) => b.priority - a.priority)
  .slice(0, MAX_DEFERRED_TASKS_IN_CONTEXT);
```

For **task-triggered ticks**, build a task-specific context:

```typescript
// Load the firing task and its goal/plan context
const task = await db.getTask(triggerContext.taskId);
const goal = task.goalId ? await db.getGoal(task.goalId) : null;
const plan = task.planId ? await db.getActivePlan(task.goalId) : null;

// Also load emotional state and recent thoughts/experiences
// (for cognitive continuity — the AI needs to feel like itself)
const emotions = await loadAndDecayEmotions();
const recentThoughts = await db.getRecentThoughts(10);
const recentExperiences = await db.getRecentExperiences(10);
```

### MIND QUERY: Task-Related Decision Types

| Decision Type | Description |
|---------------|-------------|
| `schedule_task` | Create a new task (any type) |
| `start_task` | Pick up a deferred task to work on (changes status to in_progress) |
| `complete_task` | Mark a task as completed with result |
| `cancel_task` | Cancel a pending/scheduled task |
| `skip_task` | Skip a scheduled task this run (with reason) |

### EXECUTE Additions

```
[existing] 1-4. Persist cognitive output, send replies, spawn agents

[NEW]      5. Process task decisions:
              - schedule_task → validate cron, create task, register with scheduler
              - start_task → mark deferred task as in_progress
              - complete_task → mark completed, update goal progress
              - cancel_task → mark cancelled, clear scheduler timer
              - skip_task → log skip reason, update next_run_at for recurring

[NEW]      6. Goal-task cascade:
              - If a goal was paused/abandoned/completed, cascade to its tasks
              - If a plan was superseded, cancel old plan's tasks

[NEW]      7. Deferred task staleness:
              - Boost priority for deferred tasks older than 7 days
              - Auto-cancel deferred tasks older than 30 days

[existing] 8+. Seed processing, goal salience, cleanup, etc.
```

---

## Configuration

### Code-Configurable (Constants)

| Constant | Default | Description |
|----------|---------|-------------|
| `MAX_TASK_RETRIES` | 3 | Retries per task (per run for recurring) |
| `MAX_CONSECUTIVE_FAILURES` | 5 | Recurring task auto-pause after N consecutive failed runs |
| `MAX_DEFERRED_TASKS_IN_CONTEXT` | 5 | Deferred tasks shown to mind during idle ticks |
| `DEFERRED_STALENESS_BOOST_DAYS` | 7 | Days before deferred task priority starts boosting |
| `DEFERRED_STALENESS_BOOST_RATE` | 0.02 | Priority boost per day after staleness threshold |
| `DEFERRED_AUTO_CANCEL_DAYS` | 30 | Days before deferred task is auto-cancelled |
| `TASK_RUN_RETENTION_DAYS` | 30 | TTL for task run history |
| `MISSED_TASK_CATCHUP` | `'fire_once'` | On startup, missed recurring tasks fire once (not N times) |

---

## Storage

All task system tables live in **`heartbeat.db`**, consistent with goals, thoughts, emotions, and other AI state. A heartbeat reset wipes all tasks, task runs, and scheduler state.

---

## Future Considerations

1. **Task dependencies** — Tasks that depend on other tasks completing first. Currently handled at the plan level (milestones sequence the work). If needed, explicit task-to-task dependencies could be added later.
2. **Task priority inheritance** — Deferred tasks linked to high-salience goals could inherit the goal's salience as a priority boost. Currently, task priority is static.
3. **Relative scheduling** — "30 minutes after my last message" or "the morning after this event." Requires event-relative scheduling logic.
4. **Task templates** — Reusable task definitions for common recurring patterns. "Check YouTube stats" could be a template that users configure once.
5. **Task cost tracking** — Linking task execution to token/cost tracking in agent_logs.db. Helps users understand the cost of their recurring tasks.
6. **Sub-agent task feedback** — When a sub-agent is executing a task and discovers the task needs modification, a mechanism for the sub-agent to suggest task updates (via MCP tool) rather than just completing or failing.

---

## Shared Abstractions

The task system uses several shared abstractions (see `docs/architecture/tech-stack.md`):

- **Context Builder** — Assembles task tick context (task details, goal/plan context, emotional state) via `buildTaskContext()` (`docs/architecture/context-builder.md`)
- **Event Bus** — Emits `task:changed` events consumed by the frontend and task scheduler
- **Database Stores** — Typed data access for tasks and task_runs tables in `heartbeat.db`

## Related Documents

- `docs/architecture/heartbeat.md` — The tick pipeline, session lifecycle, and tick triggers
- `docs/architecture/context-builder.md` — Context assembly for task ticks and deferred task presentation
- `docs/architecture/goals.md` — Goals, plans, seeds, and salience that drive task creation
- `docs/architecture/agent-orchestration.md` — Sub-agents spawned to execute complex tasks
- `docs/architecture/contacts.md` — Permission tiers affect task creation
- `docs/architecture/channel-packages.md` — Task result messages routed through channel adapters
