# Implementation Plan: Goal Planning Prompts

> **Status:** Complete
> **Last updated:** Feb 23, 2026
> **Purpose:** Guide an external agent to complete the goal planning prompt feature

## Overview

When a goal becomes active but has no plan, the system should inject escalating prompts into the mind's context, reminding it to create a plan. This preserves agency (the mind decides *how* to plan) while ensuring goals don't sit planless indefinitely.

## What's Already Done

### 1. Constants & Types (`packages/backend/src/goals/index.ts`)

The following have been added:

```typescript
// Tick thresholds for escalating planning prompts
export const GOAL_PLANNING_PROMPT_STRONGER_TICKS = 3;
export const GOAL_PLANNING_PROMPT_FORCEFUL_TICKS = 10;

// Type for planning prompt urgency levels
export type PlanningPromptUrgency = 'soft' | 'stronger' | 'forceful';

// Prompt messages for each urgency level
export const PLANNING_PROMPT_MESSAGES: Record<PlanningPromptUrgency, string> = {
  soft: 'Your goal "{title}" has no plan yet. You might consider how you\'d approach it.',
  stronger: 'Your goal "{title}" still lacks a strategy. It would help to sketch out an approach — even a simple one.',
  forceful: 'Your goal "{title}" needs a plan. Take a moment now to outline how you\'d pursue it — whether that\'s a simple strategy you create directly, or delegating to a planning agent for something more complex.'
};
```

### 2. Database Migration (`packages/backend/src/db/migrations/heartbeat/004_goal_planning_prompts.sql`)

Migration adds two columns to the `goals` table:

```sql
ALTER TABLE goals ADD COLUMN activated_at_tick INTEGER;
ALTER TABLE goals ADD COLUMN plan_prompt_urgency TEXT DEFAULT 'soft';
```

### 3. Documentation (4 files updated)

- `docs/architecture/goals.md` — Data model, Plan Creation section, GATHER CONTEXT code, EXECUTE steps, config constants
- `docs/architecture/context-builder.md` — Planning prompt spec added to Session Notes section
- `docs/architecture/agent-orchestration.md` — Clarification that planning agents aren't auto-spawned
- `docs/architecture/heartbeat.md` — Bullet point added to GATHER CONTEXT stage

## What Still Needs to Be Done

### 1. Goal Manager (`packages/backend/src/goals/goal-manager.ts`)

When a goal is activated (status changes to 'active'), set `activated_at_tick` to the current tick number.

**Find:** The `activateGoal()` method or wherever goal status is updated to 'active'

**Add:**
```typescript
// When activating a goal, record the tick number for planning prompt escalation
await db.run(
  `UPDATE goals SET status = 'active', activated_at_tick = ?, updated_at = ? WHERE id = ?`,
  [currentTickNumber, now, goalId]
);
```

**Note:** You'll need to pass `currentTickNumber` into the activation function, or retrieve it from heartbeat state.

### 2. Goal Context (`packages/backend/src/goals/goal-context.ts`)

Add a function to compute planning prompts for active goals without plans.

**Add a new function:**
```typescript
import {
  GOAL_PLANNING_PROMPT_STRONGER_TICKS,
  GOAL_PLANNING_PROMPT_FORCEFUL_TICKS,
  PLANNING_PROMPT_MESSAGES,
  PlanningPromptUrgency
} from './index';

function computePlanningPromptUrgency(ticksSinceActivation: number): PlanningPromptUrgency {
  if (ticksSinceActivation >= GOAL_PLANNING_PROMPT_FORCEFUL_TICKS) {
    return 'forceful';
  } else if (ticksSinceActivation >= GOAL_PLANNING_PROMPT_STRONGER_TICKS) {
    return 'stronger';
  }
  return 'soft';
}

export function generatePlanningPrompts(
  goals: Array<{ id: string; title: string; activated_at_tick: number | null; has_plan: boolean }>,
  currentTickNumber: number
): Array<{ goalId: string; goalTitle: string; urgency: PlanningPromptUrgency; message: string }> {
  const prompts = [];

  for (const goal of goals) {
    // Only generate prompts for active goals without plans
    if (goal.has_plan || goal.activated_at_tick === null) continue;

    const ticksSinceActivation = currentTickNumber - goal.activated_at_tick;
    const urgency = computePlanningPromptUrgency(ticksSinceActivation);
    const message = PLANNING_PROMPT_MESSAGES[urgency].replace('{title}', goal.title);

    prompts.push({
      goalId: goal.id,
      goalTitle: goal.title,
      urgency,
      message
    });
  }

  return prompts;
}
```

**Also:** Update the goal query to include `activated_at_tick` and whether a plan exists for each goal.

### 3. Context Builder (`packages/backend/src/heartbeat/context-builder.ts`)

Inject planning prompts into the session notes section of the context.

**Find:** The section where session notes are built (look for seed graduation prompts, proposed goal prompts, etc.)

**Add:** After computing planning prompts via `generatePlanningPrompts()`:
```typescript
// Add planning prompts for active goals without plans
const planningPrompts = generatePlanningPrompts(activeGoals, currentTickNumber);

for (const prompt of planningPrompts) {
  sessionNotes.push(`── NOTE ──\n${prompt.message}`);
}
```

**Import:** Add import for `generatePlanningPrompts` from goals module.

## Testing

After implementation:

1. Create a goal and activate it
2. Verify `activated_at_tick` is set in the database
3. On subsequent ticks, verify the planning prompt appears in context
4. Wait for 3+ ticks and verify prompt escalates to "stronger"
5. Wait for 10+ ticks and verify prompt escalates to "forceful"
6. Create a plan for the goal and verify prompts stop appearing

## File Summary

| File | Status | Changes Needed |
|------|--------|----------------|
| `goals/index.ts` | ✅ Done | Constants, types, messages added |
| `db/migrations/heartbeat/004_goal_planning_prompts.sql` | ✅ Done | Migration created |
| `docs/architecture/goals.md` | ✅ Done | Documentation updated |
| `docs/architecture/context-builder.md` | ✅ Done | Documentation updated |
| `docs/architecture/agent-orchestration.md` | ✅ Done | Documentation updated |
| `docs/architecture/heartbeat.md` | ✅ Done | Documentation updated |
| `goals/planning.ts` | ✅ Done | Constants extracted to avoid circular imports |
| `goals/goal-manager.ts` | ✅ Done | Set activated_at_tick on activation/resume/create |
| `goals/goal-context.ts` | ✅ Done | generatePlanningPrompts + buildGoalContext integration |
| `heartbeat/context-builder.ts` | ✅ Done | planningPromptsContext rendered after PENDING GOALS |
| `heartbeat/gather-context.ts` | ✅ Done | Passes tickNumber to buildGoalContext |
| `heartbeat/index.ts` | ✅ Done | Passes planningPromptsSection through pipeline |
| `shared/schemas/heartbeat.ts` | ✅ Done | activatedAtTick + planPromptUrgency on Goal type |
| `db/stores/heartbeat-store.ts` | ✅ Done | activatedAtTick in updateGoal + createGoal |
| `api/routers/goals.ts` | ✅ Done | Sets activatedAtTick on activate/resume |
| `tests/helpers.ts` | ✅ Done | Includes 004 migration |
| `tests/goals/goal-manager.test.ts` | ✅ Done | 10 new tests for planning prompts |

## Philosophy Note

The key design principle: **guide without forcing**. The system should remind the mind about planless goals with increasing urgency, but never automatically spawn planning agents or create plans on behalf of the mind. The mind retains full agency over *how* it responds to these prompts.
