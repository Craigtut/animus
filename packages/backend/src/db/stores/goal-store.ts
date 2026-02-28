/**
 * Goal Store — goal_seeds, goals, plans, goal_salience_log tables
 */

import type Database from 'better-sqlite3';
import { generateUUID, now } from '@animus-labs/shared';
import type { EmotionName, GoalSeed, Goal, Plan, GoalSalienceLog } from '@animus-labs/shared';
import { snakeToCamel } from '../utils.js';

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
// Plans
// ============================================================================

export function createPlan(
  db: Database.Database,
  data: {
    goalId: string;
    strategy: string;
    milestones?: Array<{ title: string; description: string; status: 'pending' | 'in_progress' | 'completed' | 'skipped'; completedAt?: string }> | null;
    createdBy: 'mind' | 'planning_agent';
    revisionReason?: string | null;
  }
): Plan {
  const id = generateUUID();
  const timestamp = now();
  const versionRow = db.prepare('SELECT MAX(version) as maxV FROM plans WHERE goal_id = ?').get(data.goalId) as { maxV: number | null } | undefined;
  const version = (versionRow?.maxV ?? 0) + 1;
  db.prepare(
    `INSERT INTO plans (id, goal_id, version, status, strategy, milestones, created_by, revision_reason, created_at)
     VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)`
  ).run(id, data.goalId, version, data.strategy, data.milestones ? JSON.stringify(data.milestones) : null, data.createdBy, data.revisionReason ?? null, timestamp);
  return {
    id, goalId: data.goalId, version, status: 'active', strategy: data.strategy,
    milestones: data.milestones ?? null, createdBy: data.createdBy,
    revisionReason: data.revisionReason ?? null, createdAt: timestamp, supersededAt: null,
  };
}

export function getPlan(db: Database.Database, id: string): Plan | null {
  const row = db.prepare('SELECT * FROM plans WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  const plan = snakeToCamel<Plan>(row);
  return { ...plan, milestones: typeof plan.milestones === 'string' ? JSON.parse(plan.milestones) : plan.milestones };
}

export function getPlansByGoal(db: Database.Database, goalId: string): Plan[] {
  const rows = db.prepare('SELECT * FROM plans WHERE goal_id = ? ORDER BY version DESC').all(goalId) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const plan = snakeToCamel<Plan>(row);
    return { ...plan, milestones: typeof plan.milestones === 'string' ? JSON.parse(plan.milestones) : plan.milestones };
  });
}

export function getActivePlan(db: Database.Database, goalId: string): Plan | null {
  const row = db.prepare("SELECT * FROM plans WHERE goal_id = ? AND status = 'active' ORDER BY version DESC LIMIT 1").get(goalId) as Record<string, unknown> | undefined;
  if (!row) return null;
  const plan = snakeToCamel<Plan>(row);
  return { ...plan, milestones: typeof plan.milestones === 'string' ? JSON.parse(plan.milestones) : plan.milestones };
}

export function updatePlan(
  db: Database.Database,
  id: string,
  data: Partial<Pick<Plan, 'status' | 'strategy' | 'milestones' | 'supersededAt'>>
): void {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }
  if (data.strategy !== undefined) { fields.push('strategy = ?'); values.push(data.strategy); }
  if (data.milestones !== undefined) { fields.push('milestones = ?'); values.push(JSON.stringify(data.milestones)); }
  if (data.supersededAt !== undefined) { fields.push('superseded_at = ?'); values.push(data.supersededAt); }
  if (fields.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE plans SET ${fields.join(', ')} WHERE id = ?`).run(...values);
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
