/**
 * Decision Store — tick_decisions table
 */

import type Database from 'better-sqlite3';
import { generateUUID, now } from '@animus-labs/shared';
import type { TickDecision, DecisionType, DecisionOutcome } from '@animus-labs/shared';
import { snakeToCamel } from '../utils.js';

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
