# Animus: Task System

> **Status: Under Construction** — This document outlines the design questions and requirements for the task system. Detailed design is pending.

## Overview

Tasks are discrete, actionable units of work that Animus can schedule and execute. They differ from goals in scope and specificity — a goal is an outcome to pursue ("learn about the user's music preferences"), while a task is a concrete action to perform ("check the news at 9am every morning"). Tasks can exist standalone or be created in service of a goal.

Tasks also serve as one of the four heartbeat tick triggers — when a scheduled task fires, it triggers a tick so the mind can act on it.

## Design Questions

### Scheduling Mechanism

- Cron-like scheduling (recurring tasks) vs. one-shot future execution vs. both
- How scheduling precision interacts with the heartbeat interval (task fires at 9:00am but heartbeat interval is 5 min)
- Time zone handling for scheduled tasks
- Whether tasks can be scheduled relative to events ("30 minutes after my last message")

### Task Data Model

- Fields: title, description, schedule/trigger, status, goal_id (optional), result
- Task lifecycle states (pending → scheduled → triggered → completed / failed / cancelled)
- Whether tasks carry instructions for the mind or are just triggers with context
- Retry behavior for failed tasks

### Heartbeat Integration

- How scheduled task triggers are detected (polling on each interval tick, or separate timer)
- How task context is included in GATHER CONTEXT when a task triggers a tick
- How the mind reports task completion in its structured output
- Whether multiple tasks can fire in the same tick

### Goal Relationship

- Tasks can optionally belong to a goal
- The mind can create tasks to advance a goal (e.g., "research X" spawns a sub-agent task)
- Completing all tasks for a goal doesn't necessarily complete the goal — the mind decides
- Standalone tasks (no goal) are valid — e.g., recurring reminders, scheduled checks

### Permissions

- Primary contact can create and cancel tasks
- Standard contacts cannot create tasks (per contact permission tiers)
- Can the mind create tasks autonomously?
- How user-requested tasks ("remind me to X") are translated into the task system

## Data Model (Preliminary)

To be designed. Likely stored in `heartbeat.db`. Fields might include:

- `id`, `title`, `description`
- `status` (pending, scheduled, triggered, completed, failed, cancelled)
- `schedule` (cron expression or ISO timestamp for one-shot)
- `goal_id` (nullable — links to parent goal)
- `created_by` (mind or contact_id)
- `next_run_at` (computed from schedule)
- `last_run_at`, `created_at`

## Related Documents

- `docs/architecture/heartbeat.md` — Tasks are one of four tick triggers
- `docs/architecture/goals.md` — Tasks can serve goals
- `docs/architecture/contacts.md` — Contact permission tiers affect task creation
