/**
 * Goal Store — goal seeds, goals, plan versions, milestones, events,
 * snapshots, review requests, and salience logs.
 */

import type Database from 'better-sqlite3';
import { generateUUID, now } from '@animus-labs/shared';
import type {
  EmotionName,
  Goal,
  GoalEvent,
  GoalEventSource,
  GoalEventType,
  GoalMilestoneEvidence,
  GoalReviewRequest,
  GoalReviewRequestedBy,
  GoalReviewScope,
  GoalReviewUrgency,
  GoalSalienceLog,
  GoalSeed,
  GoalSnapshot,
  GoalSnapshotUpdatedBy,
  Milestone,
  MilestoneStatus,
  Plan,
} from '@animus-labs/shared';
import { snakeToCamel } from '../utils.js';

type MilestoneDraft = {
  title: string;
  description?: string | null;
  acceptanceCriteria?: string | null;
  status?: MilestoneStatus;
  confidence?: number;
  evidence?: GoalMilestoneEvidence[];
  blockerNotes?: string | null;
  completionRationale?: string | null;
  completedAt?: string | null;
};

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value as T;
  if (value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToMilestone(row: Record<string, unknown>): Milestone {
  const m = snakeToCamel<Milestone>(row);
  return {
    ...m,
    evidence: parseJson<GoalMilestoneEvidence[]>(m.evidence, []),
  };
}

function rowToPlan(db: Database.Database, row: Record<string, unknown>): Plan {
  const plan = snakeToCamel<Plan>(row);
  return {
    ...plan,
    assumptions: parseJson<string[]>(plan.assumptions, []),
    milestones: getMilestonesByPlan(db, plan.id),
  };
}

function rowToGoalEvent(row: Record<string, unknown>): GoalEvent {
  const event = snakeToCamel<GoalEvent>(row);
  return {
    ...event,
    data: parseJson<Record<string, unknown>>(event.data, {}),
  };
}

function rowToGoalSnapshot(row: Record<string, unknown>): GoalSnapshot {
  const snapshot = snakeToCamel<GoalSnapshot>(row);
  return {
    ...snapshot,
    knownBlockers: parseJson<string[]>(snapshot.knownBlockers, []),
    openQuestions: parseJson<string[]>(snapshot.openQuestions, []),
  };
}

function rowToGoalReviewRequest(row: Record<string, unknown>): GoalReviewRequest {
  const request = snakeToCamel<GoalReviewRequest>(row);
  return {
    ...request,
    evidenceRefs: parseJson<string[]>(request.evidenceRefs, []),
  };
}

// ============================================================================
// Goal Seeds
// ============================================================================

export function createSeed(
  db: Database.Database,
  data: {
    content: string;
    motivation?: string | null;
    strength?: number;
    linkedEmotion?: EmotionName | null;
    source: 'internal' | 'user_observation' | 'experience';
  }
): GoalSeed {
  const id = generateUUID();
  const timestamp = now();
  const strength = data.strength ?? 0.1;
  db.prepare(
    `INSERT INTO goal_seeds (id, content, motivation, strength, linked_emotion, source, reinforcement_count, status, created_at, last_reinforced_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 'active', ?, ?)`
  ).run(id, data.content, data.motivation ?? null, strength, data.linkedEmotion ?? null, data.source, timestamp, timestamp);
  return {
    id, content: data.content, motivation: data.motivation ?? null,
    strength, linkedEmotion: data.linkedEmotion ?? null, source: data.source,
    reinforcementCount: 0, status: 'active', graduatedToGoalId: null,
    createdAt: timestamp, lastReinforcedAt: timestamp, decayedAt: null,
  };
}

export function getSeed(db: Database.Database, id: string): GoalSeed | null {
  const row = db.prepare('SELECT * FROM goal_seeds WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? snakeToCamel<GoalSeed>(row) : null;
}

export function getActiveSeeds(db: Database.Database): GoalSeed[] {
  const rows = db.prepare("SELECT * FROM goal_seeds WHERE status = 'active' ORDER BY strength DESC").all() as Array<Record<string, unknown>>;
  return rows.map((row) => snakeToCamel<GoalSeed>(row));
}

export function getSeedsByStatus(db: Database.Database, status: string): GoalSeed[] {
  const rows = db.prepare('SELECT * FROM goal_seeds WHERE status = ? ORDER BY created_at DESC').all(status) as Array<Record<string, unknown>>;
  return rows.map((row) => snakeToCamel<GoalSeed>(row));
}

export function updateSeed(
  db: Database.Database,
  id: string,
  data: Partial<Pick<GoalSeed, 'strength' | 'status' | 'reinforcementCount' | 'lastReinforcedAt' | 'graduatedToGoalId' | 'decayedAt'>>
): void {
  const fields: string[] = [];
  const values: unknown[] = [];
  const mapping: Record<string, string> = {
    strength: 'strength', status: 'status',
    reinforcementCount: 'reinforcement_count', lastReinforcedAt: 'last_reinforced_at',
    graduatedToGoalId: 'graduated_to_goal_id', decayedAt: 'decayed_at',
  };
  for (const [camelKey, snakeKey] of Object.entries(mapping)) {
    const value = (data as Record<string, unknown>)[camelKey];
    if (value !== undefined) { fields.push(`${snakeKey} = ?`); values.push(value); }
  }
  if (fields.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE goal_seeds SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteSeed(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM goal_seeds WHERE id = ?').run(id);
}

export function reinforceSeed(db: Database.Database, id: string, boost: number): void {
  db.prepare(
    `UPDATE goal_seeds SET strength = MIN(strength + ?, 1.0), reinforcement_count = reinforcement_count + 1, last_reinforced_at = ? WHERE id = ?`
  ).run(boost, now(), id);
}

// ============================================================================
// Goals
// ============================================================================

export function createGoal(
  db: Database.Database,
  data: {
    title: string;
    description?: string | null;
    motivation?: string | null;
    origin: 'user_directed' | 'ai_internal' | 'collaborative';
    seedId?: string | null;
    linkedEmotion?: EmotionName | null;
    createdByContactId?: string | null;
    status?: 'proposed' | 'active';
    basePriority?: number;
    completionCriteria?: string | null;
    deadline?: string | null;
    activatedAtTick?: number | null;
  }
): Goal {
  const id = generateUUID();
  const timestamp = now();
  const status = data.status ?? 'proposed';
  const basePriority = data.basePriority ?? 0.5;
  const activatedAtTick = status === 'active' ? (data.activatedAtTick ?? null) : null;
  db.prepare(
    `INSERT INTO goals (id, title, description, motivation, origin, seed_id, linked_emotion, created_by_contact_id, status, base_priority, current_salience, completion_criteria, deadline, created_at, updated_at, activated_at, activated_at_tick)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, data.title, data.description ?? null, data.motivation ?? null,
    data.origin, data.seedId ?? null, data.linkedEmotion ?? null,
    data.createdByContactId ?? null, status, basePriority, basePriority,
    data.completionCriteria ?? null, data.deadline ?? null,
    timestamp, timestamp, status === 'active' ? timestamp : null,
    activatedAtTick
  );
  return {
    id, title: data.title, description: data.description ?? null,
    motivation: data.motivation ?? null, origin: data.origin,
    seedId: data.seedId ?? null, linkedEmotion: data.linkedEmotion ?? null,
    createdByContactId: data.createdByContactId ?? null, status,
    basePriority, currentSalience: basePriority,
    completionCriteria: data.completionCriteria ?? null,
    deadline: data.deadline ?? null, createdAt: timestamp, updatedAt: timestamp,
    activatedAt: status === 'active' ? timestamp : null,
    completedAt: null, abandonedAt: null, abandonedReason: null,
    lastProgressAt: null, lastUserMentionAt: null,
    activatedAtTick, planPromptUrgency: null,
  };
}

export function getGoal(db: Database.Database, id: string): Goal | null {
  const row = db.prepare('SELECT * FROM goals WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? snakeToCamel<Goal>(row) : null;
}

export function getGoalsByStatus(db: Database.Database, status: string): Goal[] {
  const rows = db.prepare('SELECT * FROM goals WHERE status = ? ORDER BY current_salience DESC').all(status) as Array<Record<string, unknown>>;
  return rows.map((row) => snakeToCamel<Goal>(row));
}

export function getActiveGoals(db: Database.Database, limit: number = 10): Goal[] {
  const rows = db.prepare("SELECT * FROM goals WHERE status = 'active' ORDER BY current_salience DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>;
  return rows.map((row) => snakeToCamel<Goal>(row));
}

export function updateGoal(
  db: Database.Database,
  id: string,
  data: Partial<Pick<Goal, 'title' | 'description' | 'motivation' | 'status' | 'basePriority' | 'currentSalience' | 'completionCriteria' | 'deadline' | 'activatedAt' | 'completedAt' | 'abandonedAt' | 'abandonedReason' | 'lastProgressAt' | 'lastUserMentionAt' | 'activatedAtTick'>>
): void {
  const fields: string[] = ['updated_at = ?'];
  const values: unknown[] = [now()];
  const mapping: Record<string, string> = {
    title: 'title', description: 'description', motivation: 'motivation',
    status: 'status', basePriority: 'base_priority', currentSalience: 'current_salience',
    completionCriteria: 'completion_criteria', deadline: 'deadline',
    activatedAt: 'activated_at', completedAt: 'completed_at',
    abandonedAt: 'abandoned_at', abandonedReason: 'abandoned_reason',
    lastProgressAt: 'last_progress_at', lastUserMentionAt: 'last_user_mention_at',
    activatedAtTick: 'activated_at_tick',
  };
  for (const [camelKey, snakeKey] of Object.entries(mapping)) {
    const value = (data as Record<string, unknown>)[camelKey];
    if (value !== undefined) { fields.push(`${snakeKey} = ?`); values.push(value); }
  }
  values.push(id);
  db.prepare(`UPDATE goals SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

// ============================================================================
// Plan Versions & Milestones
// ============================================================================

export function createPlan(
  db: Database.Database,
  data: {
    goalId: string;
    strategy: string;
    milestones?: MilestoneDraft[] | null;
    createdBy: 'mind' | 'planning_agent';
    revisionReason?: string | null;
    reasonCreated?: string | null;
    assumptions?: string[] | null;
    supersedesPlanId?: string | null;
  }
): Plan {
  const id = generateUUID();
  const timestamp = now();
  const versionRow = db.prepare('SELECT MAX(version) as maxV FROM plans WHERE goal_id = ?').get(data.goalId) as { maxV: number | null } | undefined;
  const version = (versionRow?.maxV ?? 0) + 1;
  db.prepare(
    `INSERT INTO plans (id, goal_id, version, status, strategy, milestones, created_by, revision_reason, reason_created, assumptions, supersedes_plan_id, created_at)
     VALUES (?, ?, ?, 'active', ?, NULL, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.goalId,
    version,
    data.strategy,
    data.createdBy,
    data.revisionReason ?? null,
    data.reasonCreated ?? null,
    JSON.stringify(data.assumptions ?? []),
    data.supersedesPlanId ?? null,
    timestamp,
  );

  const milestones = (data.milestones ?? []).map((milestone, index) =>
    createMilestone(db, {
      goalId: data.goalId,
      planId: id,
      position: index,
      title: milestone.title,
      description: milestone.description ?? null,
      acceptanceCriteria: milestone.acceptanceCriteria ?? null,
      status: milestone.status ?? 'pending',
      confidence: milestone.confidence ?? 0.5,
      evidence: milestone.evidence ?? [],
      blockerNotes: milestone.blockerNotes ?? null,
      completionRationale: milestone.completionRationale ?? null,
      completedAt: milestone.completedAt ?? null,
    })
  );

  return {
    id,
    goalId: data.goalId,
    version,
    status: 'active',
    strategy: data.strategy,
    milestones,
    createdBy: data.createdBy,
    revisionReason: data.revisionReason ?? null,
    reasonCreated: data.reasonCreated ?? null,
    assumptions: data.assumptions ?? [],
    supersedesPlanId: data.supersedesPlanId ?? null,
    createdAt: timestamp,
    supersededAt: null,
  };
}

export function getPlan(db: Database.Database, id: string): Plan | null {
  const row = db.prepare('SELECT * FROM plans WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToPlan(db, row) : null;
}

export function getPlansByGoal(db: Database.Database, goalId: string): Plan[] {
  const rows = db.prepare('SELECT * FROM plans WHERE goal_id = ? ORDER BY version DESC').all(goalId) as Array<Record<string, unknown>>;
  return rows.map((row) => rowToPlan(db, row));
}

export function getActivePlan(db: Database.Database, goalId: string): Plan | null {
  const row = db.prepare("SELECT * FROM plans WHERE goal_id = ? AND status = 'active' ORDER BY version DESC LIMIT 1").get(goalId) as Record<string, unknown> | undefined;
  return row ? rowToPlan(db, row) : null;
}

export function updatePlan(
  db: Database.Database,
  id: string,
  data: Partial<Pick<Plan, 'status' | 'strategy' | 'supersededAt' | 'reasonCreated' | 'assumptions' | 'supersedesPlanId'>>
): void {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }
  if (data.strategy !== undefined) { fields.push('strategy = ?'); values.push(data.strategy); }
  if (data.supersededAt !== undefined) { fields.push('superseded_at = ?'); values.push(data.supersededAt); }
  if (data.reasonCreated !== undefined) { fields.push('reason_created = ?'); values.push(data.reasonCreated); }
  if (data.assumptions !== undefined) { fields.push('assumptions = ?'); values.push(JSON.stringify(data.assumptions)); }
  if (data.supersedesPlanId !== undefined) { fields.push('supersedes_plan_id = ?'); values.push(data.supersedesPlanId); }
  if (fields.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE plans SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function createMilestone(
  db: Database.Database,
  data: {
    goalId: string;
    planId: string;
    position: number;
    title: string;
    description?: string | null;
    acceptanceCriteria?: string | null;
    status?: MilestoneStatus;
    confidence?: number;
    evidence?: GoalMilestoneEvidence[];
    blockerNotes?: string | null;
    completionRationale?: string | null;
    completedAt?: string | null;
  }
): Milestone {
  const id = generateUUID();
  const timestamp = now();
  const status = data.status ?? 'pending';
  db.prepare(
    `INSERT INTO goal_milestones (
       id, goal_id, plan_id, position, title, description, acceptance_criteria,
       status, confidence, evidence, blocker_notes, completion_rationale,
       created_at, updated_at, completed_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.goalId,
    data.planId,
    data.position,
    data.title,
    data.description ?? null,
    data.acceptanceCriteria ?? null,
    status,
    data.confidence ?? 0.5,
    JSON.stringify(data.evidence ?? []),
    data.blockerNotes ?? null,
    data.completionRationale ?? null,
    timestamp,
    timestamp,
    data.completedAt ?? (status === 'completed' ? timestamp : null),
  );

  return {
    id,
    goalId: data.goalId,
    planId: data.planId,
    position: data.position,
    title: data.title,
    description: data.description ?? null,
    acceptanceCriteria: data.acceptanceCriteria ?? null,
    status,
    confidence: data.confidence ?? 0.5,
    evidence: data.evidence ?? [],
    blockerNotes: data.blockerNotes ?? null,
    completionRationale: data.completionRationale ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: data.completedAt ?? (status === 'completed' ? timestamp : null),
  };
}

export function getMilestone(db: Database.Database, id: string): Milestone | null {
  const row = db.prepare('SELECT * FROM goal_milestones WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToMilestone(row) : null;
}

export function getMilestonesByPlan(db: Database.Database, planId: string): Milestone[] {
  const rows = db.prepare('SELECT * FROM goal_milestones WHERE plan_id = ? ORDER BY position ASC').all(planId) as Array<Record<string, unknown>>;
  return rows.map(rowToMilestone);
}

export function getMilestonesByGoal(db: Database.Database, goalId: string): Milestone[] {
  const rows = db.prepare('SELECT * FROM goal_milestones WHERE goal_id = ? ORDER BY created_at DESC, position ASC').all(goalId) as Array<Record<string, unknown>>;
  return rows.map(rowToMilestone);
}

export function getMilestoneByPlanPosition(db: Database.Database, planId: string, position: number): Milestone | null {
  const row = db.prepare('SELECT * FROM goal_milestones WHERE plan_id = ? AND position = ?').get(planId, position) as Record<string, unknown> | undefined;
  return row ? rowToMilestone(row) : null;
}

export function getCurrentMilestone(db: Database.Database, goalId: string): Milestone | null {
  const activePlan = getActivePlan(db, goalId);
  if (!activePlan) return null;
  const row = db.prepare(
    `SELECT * FROM goal_milestones
     WHERE plan_id = ?
       AND status IN ('in_progress', 'pending', 'blocked')
     ORDER BY
       CASE status WHEN 'in_progress' THEN 0 WHEN 'blocked' THEN 1 ELSE 2 END,
       position ASC
     LIMIT 1`
  ).get(activePlan.id) as Record<string, unknown> | undefined;
  return row ? rowToMilestone(row) : null;
}

export function updateMilestone(
  db: Database.Database,
  id: string,
  data: Partial<Pick<Milestone, 'title' | 'description' | 'acceptanceCriteria' | 'status' | 'confidence' | 'evidence' | 'blockerNotes' | 'completionRationale' | 'completedAt'>>
): void {
  const fields: string[] = ['updated_at = ?'];
  const values: unknown[] = [now()];
  const mapping: Record<string, string> = {
    title: 'title',
    description: 'description',
    acceptanceCriteria: 'acceptance_criteria',
    status: 'status',
    confidence: 'confidence',
    blockerNotes: 'blocker_notes',
    completionRationale: 'completion_rationale',
    completedAt: 'completed_at',
  };

  for (const [camelKey, snakeKey] of Object.entries(mapping)) {
    const value = (data as Record<string, unknown>)[camelKey];
    if (value !== undefined) {
      fields.push(`${snakeKey} = ?`);
      values.push(value);
    }
  }
  if (data.evidence !== undefined) {
    fields.push('evidence = ?');
    values.push(JSON.stringify(data.evidence));
  }
  values.push(id);
  db.prepare(`UPDATE goal_milestones SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

// ============================================================================
// Goal Events, Snapshots, Review Requests
// ============================================================================

export function createGoalEvent(
  db: Database.Database,
  data: {
    goalId: string;
    tickNumber?: number | null;
    type: GoalEventType;
    summary: string;
    source?: GoalEventSource;
    taskId?: string | null;
    planId?: string | null;
    milestoneId?: string | null;
    data?: Record<string, unknown>;
  }
): GoalEvent {
  const id = generateUUID();
  const timestamp = now();
  db.prepare(
    `INSERT INTO goal_events (id, goal_id, tick_number, type, summary, source, task_id, plan_id, milestone_id, data, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.goalId,
    data.tickNumber ?? null,
    data.type,
    data.summary,
    data.source ?? 'system',
    data.taskId ?? null,
    data.planId ?? null,
    data.milestoneId ?? null,
    JSON.stringify(data.data ?? {}),
    timestamp,
  );
  return {
    id,
    goalId: data.goalId,
    tickNumber: data.tickNumber ?? null,
    type: data.type,
    summary: data.summary,
    source: data.source ?? 'system',
    taskId: data.taskId ?? null,
    planId: data.planId ?? null,
    milestoneId: data.milestoneId ?? null,
    data: data.data ?? {},
    createdAt: timestamp,
  };
}

export function getRecentGoalEvents(db: Database.Database, goalId: string, limit: number = 8): GoalEvent[] {
  const rows = db
    .prepare('SELECT * FROM goal_events WHERE goal_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(goalId, limit) as Array<Record<string, unknown>>;
  return rows.map(rowToGoalEvent);
}

export function getGoalSnapshot(db: Database.Database, goalId: string): GoalSnapshot | null {
  const row = db.prepare('SELECT * FROM goal_snapshots WHERE goal_id = ?').get(goalId) as Record<string, unknown> | undefined;
  return row ? rowToGoalSnapshot(row) : null;
}

export function upsertGoalSnapshot(
  db: Database.Database,
  data: {
    goalId: string;
    summary?: string;
    currentPlanId?: string | null;
    currentMilestoneId?: string | null;
    recentProgress?: string;
    knownBlockers?: string[];
    openQuestions?: string[];
    nextBestMove?: string;
    planConfidence?: number;
    completionConfidence?: number;
    updatedFromEventId?: string | null;
    updatedBy?: GoalSnapshotUpdatedBy;
  }
): GoalSnapshot {
  const existing = getGoalSnapshot(db, data.goalId);
  const timestamp = now();

  if (!existing) {
    db.prepare(
      `INSERT INTO goal_snapshots (
         goal_id, summary, current_plan_id, current_milestone_id,
         recent_progress, known_blockers, open_questions, next_best_move,
         plan_confidence, completion_confidence, updated_from_event_id,
         updated_by, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      data.goalId,
      data.summary ?? '',
      data.currentPlanId ?? null,
      data.currentMilestoneId ?? null,
      data.recentProgress ?? '',
      JSON.stringify(data.knownBlockers ?? []),
      JSON.stringify(data.openQuestions ?? []),
      data.nextBestMove ?? '',
      data.planConfidence ?? 0.5,
      data.completionConfidence ?? 0,
      data.updatedFromEventId ?? null,
      data.updatedBy ?? 'system',
      timestamp,
      timestamp,
    );
  } else {
    db.prepare(
      `UPDATE goal_snapshots SET
         summary = ?,
         current_plan_id = ?,
         current_milestone_id = ?,
         recent_progress = ?,
         known_blockers = ?,
         open_questions = ?,
         next_best_move = ?,
         plan_confidence = ?,
         completion_confidence = ?,
         updated_from_event_id = ?,
         updated_by = ?,
         updated_at = ?
       WHERE goal_id = ?`
    ).run(
      data.summary ?? existing.summary,
      data.currentPlanId !== undefined ? data.currentPlanId : existing.currentPlanId,
      data.currentMilestoneId !== undefined ? data.currentMilestoneId : existing.currentMilestoneId,
      data.recentProgress ?? existing.recentProgress,
      JSON.stringify(data.knownBlockers ?? existing.knownBlockers),
      JSON.stringify(data.openQuestions ?? existing.openQuestions),
      data.nextBestMove ?? existing.nextBestMove,
      data.planConfidence ?? existing.planConfidence,
      data.completionConfidence ?? existing.completionConfidence,
      data.updatedFromEventId !== undefined ? data.updatedFromEventId : existing.updatedFromEventId,
      data.updatedBy ?? existing.updatedBy,
      timestamp,
      data.goalId,
    );
  }

  const snapshot = getGoalSnapshot(db, data.goalId);
  if (!snapshot) throw new Error(`Failed to upsert snapshot for goal ${data.goalId}`);
  return snapshot;
}

export const ensureGoalSnapshot = upsertGoalSnapshot;
export const updateGoalSnapshot = upsertGoalSnapshot;

export function createGoalReviewRequest(
  db: Database.Database,
  data: {
    goalId: string;
    scope: GoalReviewScope;
    urgency?: GoalReviewUrgency;
    reason: string;
    evidenceRefs?: string[];
    requestedBy?: GoalReviewRequestedBy;
    createdTickNumber?: number | null;
  }
): GoalReviewRequest {
  const existing = db.prepare(
    `SELECT * FROM goal_review_requests
     WHERE goal_id = ? AND scope = ? AND status = 'pending'
     ORDER BY created_at DESC LIMIT 1`
  ).get(data.goalId, data.scope) as Record<string, unknown> | undefined;

  if (existing) {
    const existingRequest = rowToGoalReviewRequest(existing);
    const urgency = data.urgency ?? existingRequest.urgency;
    const shouldEscalate = urgencyRank(urgency) > urgencyRank(existingRequest.urgency);
    updateGoalReviewRequest(db, existingRequest.id, {
      reason: data.reason,
      evidenceRefs: data.evidenceRefs ?? existingRequest.evidenceRefs,
      ...(shouldEscalate ? { urgency } : {}),
    });
    return getGoalReviewRequest(db, existingRequest.id)!;
  }

  const id = generateUUID();
  const timestamp = now();
  db.prepare(
    `INSERT INTO goal_review_requests (
       id, goal_id, scope, status, urgency, reason, evidence_refs,
       requested_by, created_tick_number, created_at, updated_at
     )
     VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.goalId,
    data.scope,
    data.urgency ?? 'normal',
    data.reason,
    JSON.stringify(data.evidenceRefs ?? []),
    data.requestedBy ?? 'system',
    data.createdTickNumber ?? null,
    timestamp,
    timestamp,
  );
  return getGoalReviewRequest(db, id)!;
}

function urgencyRank(urgency: GoalReviewUrgency): number {
  switch (urgency) {
    case 'high': return 3;
    case 'normal': return 2;
    case 'low': return 1;
  }
}

export function getGoalReviewRequest(db: Database.Database, id: string): GoalReviewRequest | null {
  const row = db.prepare('SELECT * FROM goal_review_requests WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToGoalReviewRequest(row) : null;
}

export function getPendingGoalReviewRequests(db: Database.Database, goalId: string): GoalReviewRequest[] {
  const rows = db.prepare(
    `SELECT * FROM goal_review_requests
     WHERE goal_id = ? AND status = 'pending'
     ORDER BY CASE urgency WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, created_at ASC`
  ).all(goalId) as Array<Record<string, unknown>>;
  return rows.map(rowToGoalReviewRequest);
}

export function updateGoalReviewRequest(
  db: Database.Database,
  id: string,
  data: Partial<Pick<GoalReviewRequest, 'status' | 'urgency' | 'reason' | 'evidenceRefs' | 'resolvedTickNumber' | 'resolution' | 'resolvedAt'>>
): void {
  const fields: string[] = ['updated_at = ?'];
  const values: unknown[] = [now()];
  const mapping: Record<string, string> = {
    status: 'status',
    urgency: 'urgency',
    reason: 'reason',
    resolvedTickNumber: 'resolved_tick_number',
    resolution: 'resolution',
    resolvedAt: 'resolved_at',
  };
  for (const [camelKey, snakeKey] of Object.entries(mapping)) {
    const value = (data as Record<string, unknown>)[camelKey];
    if (value !== undefined) {
      fields.push(`${snakeKey} = ?`);
      values.push(value);
    }
  }
  if (data.evidenceRefs !== undefined) {
    fields.push('evidence_refs = ?');
    values.push(JSON.stringify(data.evidenceRefs));
  }
  values.push(id);
  db.prepare(`UPDATE goal_review_requests SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function resolveGoalReviewRequest(
  db: Database.Database,
  id: string,
  data: {
    resolvedTickNumber?: number | null;
    resolution?: string | null;
    status?: 'resolved' | 'dismissed';
  } = {},
): void {
  updateGoalReviewRequest(db, id, {
    status: data.status ?? 'resolved',
    resolvedTickNumber: data.resolvedTickNumber ?? null,
    resolution: data.resolution ?? null,
    resolvedAt: now(),
  });
}

// ============================================================================
// Goal Salience Log
// ============================================================================

export function logSalience(
  db: Database.Database,
  data: {
    goalId: string;
    salience: number;
    basePriority: number;
    emotionalResonance: number;
    userEngagement: number;
    progressMomentum: number;
    urgency: number;
    stalenessPenalty: number;
    novelty: number;
  }
): GoalSalienceLog {
  const id = generateUUID();
  const timestamp = now();
  db.prepare(
    `INSERT INTO goal_salience_log (id, goal_id, salience, base_priority, emotional_resonance, user_engagement, progress_momentum, urgency, staleness_penalty, novelty, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, data.goalId, data.salience, data.basePriority, data.emotionalResonance, data.userEngagement, data.progressMomentum, data.urgency, data.stalenessPenalty, data.novelty, timestamp);
  return { id, ...data, computedAt: timestamp };
}
