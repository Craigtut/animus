/**
 * Heartbeat Store — data access for heartbeat.db
 *
 * Tables: heartbeat_state, emotion_state, emotion_history,
 *         thoughts, experiences, tick_decisions,
 *         goal_seeds, goals, plans, goal_salience_log
 */

import type Database from 'better-sqlite3';
import { generateUUID, now } from '@animus/shared';
import type {
  HeartbeatState,
  HeartbeatStage,
  SessionState,
  TriggerType,
  EmotionState,
  EmotionName,
  EmotionHistoryEntry,
  Thought,
  Experience,
  TickDecision,
  DecisionType,
  DecisionOutcome,
  GoalSeed,
  Goal,
  Plan,
  GoalSalienceLog,
  EnergyBand,
  EnergyHistoryEntry,
} from '@animus/shared';
import { snakeToCamel, intToBool } from '../utils.js';

// ============================================================================
// Heartbeat State (singleton)
// ============================================================================

export function getHeartbeatState(db: Database.Database): HeartbeatState {
  const row = db
    .prepare(
      `SELECT tick_number, current_stage, session_state, trigger_type,
              trigger_context, mind_session_id, session_token_count,
              started_at, last_tick_at, session_warm_since, is_running
       FROM heartbeat_state WHERE id = 1`
    )
    .get() as Record<string, unknown>;
  const state = snakeToCamel<HeartbeatState & { isRunning: number }>(row);
  return { ...state, isRunning: intToBool(state.isRunning as unknown as number) };
}

export function updateHeartbeatState(
  db: Database.Database,
  data: Partial<
    Pick<
      HeartbeatState,
      | 'tickNumber'
      | 'currentStage'
      | 'sessionState'
      | 'triggerType'
      | 'triggerContext'
      | 'mindSessionId'
      | 'sessionTokenCount'
      | 'lastTickAt'
      | 'sessionWarmSince'
      | 'isRunning'
    >
  >
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  const mapping: Record<string, string> = {
    tickNumber: 'tick_number',
    currentStage: 'current_stage',
    sessionState: 'session_state',
    triggerType: 'trigger_type',
    triggerContext: 'trigger_context',
    mindSessionId: 'mind_session_id',
    sessionTokenCount: 'session_token_count',
    lastTickAt: 'last_tick_at',
    sessionWarmSince: 'session_warm_since',
    isRunning: 'is_running',
  };

  for (const [camelKey, snakeKey] of Object.entries(mapping)) {
    const value = (data as Record<string, unknown>)[camelKey];
    if (value !== undefined) {
      fields.push(`${snakeKey} = ?`);
      values.push(camelKey === 'isRunning' ? (value ? 1 : 0) : value);
    }
  }

  if (fields.length === 0) return;
  values.push(1); // WHERE id = 1
  db.prepare(`UPDATE heartbeat_state SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

// ============================================================================
// Emotions
// ============================================================================

export function getEmotionStates(db: Database.Database): EmotionState[] {
  const rows = db.prepare('SELECT * FROM emotion_state').all() as Array<Record<string, unknown>>;
  return rows.map((row) => snakeToCamel<EmotionState>(row));
}

export function updateEmotionIntensity(
  db: Database.Database,
  emotion: EmotionName,
  intensity: number
): void {
  db.prepare(
    'UPDATE emotion_state SET intensity = ?, last_updated_at = ? WHERE emotion = ?'
  ).run(intensity, now(), emotion);
}

export function insertEmotionHistory(
  db: Database.Database,
  data: {
    tickNumber: number;
    emotion: EmotionName;
    delta: number;
    reasoning: string;
    intensityBefore: number;
    intensityAfter: number;
  }
): EmotionHistoryEntry {
  const id = generateUUID();
  const timestamp = now();
  db.prepare(
    `INSERT INTO emotion_history (id, tick_number, emotion, delta, reasoning, intensity_before, intensity_after, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.tickNumber,
    data.emotion,
    data.delta,
    data.reasoning,
    data.intensityBefore,
    data.intensityAfter,
    timestamp
  );
  return { id, ...data, createdAt: timestamp };
}

// ============================================================================
// Thoughts
// ============================================================================

export function insertThought(
  db: Database.Database,
  data: { tickNumber: number; content: string; importance: number; expiresAt?: string | null }
): Thought {
  const id = generateUUID();
  const timestamp = now();
  db.prepare(
    `INSERT INTO thoughts (id, tick_number, content, importance, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, data.tickNumber, data.content, data.importance, timestamp, data.expiresAt ?? null);
  return {
    id,
    tickNumber: data.tickNumber,
    content: data.content,
    importance: data.importance,
    createdAt: timestamp,
    expiresAt: data.expiresAt ?? null,
  };
}

export function getRecentThoughts(db: Database.Database, limit: number = 20): Thought[] {
  const rows = db
    .prepare('SELECT * FROM thoughts ORDER BY created_at DESC LIMIT ?')
    .all(limit) as Array<Record<string, unknown>>;
  return rows.map((row) => snakeToCamel<Thought>(row));
}

/**
 * Get all thoughts since a given timestamp (exclusive), newest first.
 * Used by the observation pipeline to load all unsummarized items
 * beyond what the fixed-count limit would return.
 */
export function getThoughtsSince(db: Database.Database, since: string, limit: number = 2000): Thought[] {
  const rows = db
    .prepare('SELECT * FROM thoughts WHERE created_at > ? ORDER BY created_at DESC LIMIT ?')
    .all(since, limit) as Array<Record<string, unknown>>;
  return rows.map((row) => snakeToCamel<Thought>(row));
}

export function getThoughtsPaginated(
  db: Database.Database,
  limit: number = 20,
  cursor?: string,
  importantOnly?: boolean
): Thought[] {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (cursor) {
    conditions.push('created_at < ?');
    params.push(cursor);
  }
  if (importantOnly) {
    conditions.push('importance > 0.7');
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);
  const rows = db
    .prepare(`SELECT * FROM thoughts ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...params) as Array<Record<string, unknown>>;
  return rows.map((row) => snakeToCamel<Thought>(row));
}

// ============================================================================
// Experiences
// ============================================================================

export function insertExperience(
  db: Database.Database,
  data: { tickNumber: number; content: string; importance: number; expiresAt?: string | null }
): Experience {
  const id = generateUUID();
  const timestamp = now();
  db.prepare(
    `INSERT INTO experiences (id, tick_number, content, importance, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, data.tickNumber, data.content, data.importance, timestamp, data.expiresAt ?? null);
  return {
    id,
    tickNumber: data.tickNumber,
    content: data.content,
    importance: data.importance,
    createdAt: timestamp,
    expiresAt: data.expiresAt ?? null,
  };
}

export function getRecentExperiences(db: Database.Database, limit: number = 20): Experience[] {
  const rows = db
    .prepare('SELECT * FROM experiences ORDER BY created_at DESC LIMIT ?')
    .all(limit) as Array<Record<string, unknown>>;
  return rows.map((row) => snakeToCamel<Experience>(row));
}

/**
 * Get all experiences since a given timestamp (exclusive), newest first.
 * Used by the observation pipeline to load all unsummarized items.
 */
export function getExperiencesSince(db: Database.Database, since: string, limit: number = 2000): Experience[] {
  const rows = db
    .prepare('SELECT * FROM experiences WHERE created_at > ? ORDER BY created_at DESC LIMIT ?')
    .all(since, limit) as Array<Record<string, unknown>>;
  return rows.map((row) => snakeToCamel<Experience>(row));
}

export function getExperiencesPaginated(
  db: Database.Database,
  limit: number = 20,
  cursor?: string,
  importantOnly?: boolean
): Experience[] {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (cursor) {
    conditions.push('created_at < ?');
    params.push(cursor);
  }
  if (importantOnly) {
    conditions.push('importance > 0.7');
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);
  const rows = db
    .prepare(`SELECT * FROM experiences ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...params) as Array<Record<string, unknown>>;
  return rows.map((row) => snakeToCamel<Experience>(row));
}

// ============================================================================
// Tick Decisions
// ============================================================================

export function insertTickDecision(
  db: Database.Database,
  data: {
    tickNumber: number;
    type: DecisionType;
    description: string;
    parameters?: Record<string, unknown> | null;
    outcome: DecisionOutcome;
    outcomeDetail?: string | null;
  }
): TickDecision {
  const id = generateUUID();
  const timestamp = now();
  db.prepare(
    `INSERT INTO tick_decisions (id, tick_number, type, description, parameters, outcome, outcome_detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.tickNumber,
    data.type,
    data.description,
    data.parameters ? JSON.stringify(data.parameters) : null,
    data.outcome,
    data.outcomeDetail ?? null,
    timestamp
  );
  return {
    id,
    tickNumber: data.tickNumber,
    type: data.type,
    description: data.description,
    parameters: data.parameters ?? null,
    outcome: data.outcome,
    outcomeDetail: data.outcomeDetail ?? null,
    createdAt: timestamp,
  };
}

export function getTickDecisions(
  db: Database.Database,
  tickNumber: number
): TickDecision[] {
  const rows = db
    .prepare('SELECT * FROM tick_decisions WHERE tick_number = ? ORDER BY created_at')
    .all(tickNumber) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const d = snakeToCamel<TickDecision>(row);
    return {
      ...d,
      parameters: typeof d.parameters === 'string' ? JSON.parse(d.parameters) : d.parameters,
    };
  });
}

/**
 * Get recent decisions across all ticks (for the Mind page).
 */
export function getRecentDecisions(
  db: Database.Database,
  options: { limit?: number; since?: string } = {}
): TickDecision[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.since) {
    conditions.push('created_at >= ?');
    params.push(options.since);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options.limit ?? 50;

  const rows = db
    .prepare(
      `SELECT * FROM tick_decisions ${where} ORDER BY created_at DESC LIMIT ?`
    )
    .all(...params, limit) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const d = snakeToCamel<TickDecision>(row);
    return {
      ...d,
      parameters: typeof d.parameters === 'string' ? JSON.parse(d.parameters) : d.parameters,
    };
  });
}

// ============================================================================
// Emotion History Queries
// ============================================================================

export function getEmotionHistory(
  db: Database.Database,
  options: { emotion?: EmotionName; since?: string; limit?: number } = {}
): EmotionHistoryEntry[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.emotion) {
    conditions.push('emotion = ?');
    params.push(options.emotion);
  }
  if (options.since) {
    conditions.push('created_at >= ?');
    params.push(options.since);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options.limit ?? 100;

  const rows = db
    .prepare(`SELECT * FROM emotion_history ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...params, limit) as Array<Record<string, unknown>>;
  return rows.map((row) => snakeToCamel<EmotionHistoryEntry>(row));
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
  }
): Goal {
  const id = generateUUID();
  const timestamp = now();
  const status = data.status ?? 'proposed';
  const basePriority = data.basePriority ?? 0.5;
  db.prepare(
    `INSERT INTO goals (id, title, description, motivation, origin, seed_id, linked_emotion, created_by_contact_id, status, base_priority, current_salience, completion_criteria, deadline, created_at, updated_at, activated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, data.title, data.description ?? null, data.motivation ?? null,
    data.origin, data.seedId ?? null, data.linkedEmotion ?? null,
    data.createdByContactId ?? null, status, basePriority, basePriority,
    data.completionCriteria ?? null, data.deadline ?? null,
    timestamp, timestamp, status === 'active' ? timestamp : null
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
  data: Partial<Pick<Goal, 'title' | 'description' | 'motivation' | 'status' | 'basePriority' | 'currentSalience' | 'completionCriteria' | 'deadline' | 'activatedAt' | 'completedAt' | 'abandonedAt' | 'abandonedReason' | 'lastProgressAt' | 'lastUserMentionAt'>>
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

// ============================================================================
// Agent Tasks
// ============================================================================

export function insertAgentTask(
  db: Database.Database,
  data: {
    id: string;
    tickNumber: number;
    sessionId: string | null;
    provider: string;
    status: string;
    taskType: string;
    taskDescription: string;
    contactId: string | null;
    sourceChannel: string | null;
    createdAt: string;
  }
): void {
  db.prepare(
    `INSERT INTO agent_tasks (id, tick_number, session_id, provider, status, task_type, task_description, contact_id, source_channel, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.id, data.tickNumber, data.sessionId, data.provider,
    data.status, data.taskType, data.taskDescription,
    data.contactId, data.sourceChannel, data.createdAt
  );
}

export function updateAgentTask(
  db: Database.Database,
  id: string,
  data: Partial<{
    sessionId: string | null;
    status: string;
    currentActivity: string | null;
    result: string | null;
    error: string | null;
    startedAt: string | null;
    completedAt: string | null;
    inputTokens: number;
    outputTokens: number;
    totalCostUsd: number;
  }>
): void {
  const fields: string[] = [];
  const values: unknown[] = [];
  const mapping: Record<string, string> = {
    sessionId: 'session_id',
    status: 'status',
    currentActivity: 'current_activity',
    result: 'result',
    error: 'error',
    startedAt: 'started_at',
    completedAt: 'completed_at',
    inputTokens: 'input_tokens',
    outputTokens: 'output_tokens',
    totalCostUsd: 'total_cost_usd',
  };
  for (const [camelKey, snakeKey] of Object.entries(mapping)) {
    const value = (data as Record<string, unknown>)[camelKey];
    if (value !== undefined) { fields.push(`${snakeKey} = ?`); values.push(value); }
  }
  if (fields.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE agent_tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function getAgentTask(db: Database.Database, id: string): Record<string, unknown> | null {
  const row = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? snakeToCamel<Record<string, unknown>>(row) : null;
}

export function getRunningAgentTasks(db: Database.Database): Array<Record<string, unknown>> {
  const rows = db.prepare(
    "SELECT * FROM agent_tasks WHERE status IN ('spawning', 'running') ORDER BY created_at"
  ).all() as Array<Record<string, unknown>>;
  return rows.map((row) => snakeToCamel<Record<string, unknown>>(row));
}

export function getRecentAgentTasks(db: Database.Database, limit: number = 20): Array<Record<string, unknown>> {
  const rows = db.prepare(
    'SELECT * FROM agent_tasks ORDER BY created_at DESC LIMIT ?'
  ).all(limit) as Array<Record<string, unknown>>;
  return rows.map((row) => snakeToCamel<Record<string, unknown>>(row));
}

/**
 * Mark orphaned agent tasks (status='running' or 'spawning') as 'failed'.
 * Called during startup recovery to clean up tasks from a previous crash.
 */
export function markOrphanedAgentTasks(db: Database.Database): number {
  const timestamp = now();
  const result = db.prepare(
    "UPDATE agent_tasks SET status = 'failed', error = 'Orphaned on restart', completed_at = ? WHERE status IN ('running', 'spawning')"
  ).run(timestamp);
  return result.changes;
}

// ============================================================================
// Energy
// ============================================================================

export function getEnergyLevel(db: Database.Database): { energyLevel: number; lastEnergyUpdate: string | null } {
  const row = db
    .prepare('SELECT energy_level, last_energy_update FROM heartbeat_state WHERE id = 1')
    .get() as { energy_level: number; last_energy_update: string | null };
  return {
    energyLevel: row.energy_level,
    lastEnergyUpdate: row.last_energy_update,
  };
}

export function updateEnergyLevel(db: Database.Database, energy: number): void {
  db.prepare(
    'UPDATE heartbeat_state SET energy_level = ?, last_energy_update = ? WHERE id = 1'
  ).run(energy, now());
}

export function insertEnergyHistory(
  db: Database.Database,
  data: {
    tickNumber: number;
    energyBefore: number;
    energyAfter: number;
    delta: number;
    reasoning: string;
    circadianBaseline: number;
    energyBand: EnergyBand;
  }
): EnergyHistoryEntry {
  const timestamp = now();
  const result = db.prepare(
    `INSERT INTO energy_history (tick_number, energy_before, energy_after, delta, reasoning, circadian_baseline, energy_band, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.tickNumber,
    data.energyBefore,
    data.energyAfter,
    data.delta,
    data.reasoning,
    data.circadianBaseline,
    data.energyBand,
    timestamp
  );
  return {
    id: result.lastInsertRowid as number,
    tickNumber: data.tickNumber,
    energyBefore: data.energyBefore,
    energyAfter: data.energyAfter,
    delta: data.delta,
    reasoning: data.reasoning,
    circadianBaseline: data.circadianBaseline,
    energyBand: data.energyBand,
    createdAt: timestamp,
  };
}

export function getEnergyHistory(
  db: Database.Database,
  options: { limit?: number } = {}
): EnergyHistoryEntry[] {
  const limit = options.limit ?? 100;
  const rows = db
    .prepare('SELECT * FROM energy_history ORDER BY created_at DESC LIMIT ?')
    .all(limit) as Array<Record<string, unknown>>;
  return rows.map((row) => snakeToCamel<EnergyHistoryEntry>(row));
}

export function cleanupEnergyHistory(db: Database.Database, retentionDays: number): number {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const result = db
    .prepare('DELETE FROM energy_history WHERE created_at < ?')
    .run(cutoff);
  return result.changes;
}

// ============================================================================
// Cleanup
// ============================================================================

export function cleanupExpiredEntries(db: Database.Database): {
  thoughts: number;
  experiences: number;
} {
  const timestamp = now();
  const thoughtsResult = db
    .prepare('DELETE FROM thoughts WHERE expires_at IS NOT NULL AND expires_at < ?')
    .run(timestamp);
  const experiencesResult = db
    .prepare('DELETE FROM experiences WHERE expires_at IS NOT NULL AND expires_at < ?')
    .run(timestamp);
  return {
    thoughts: thoughtsResult.changes,
    experiences: experiencesResult.changes,
  };
}
