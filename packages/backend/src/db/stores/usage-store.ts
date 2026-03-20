/**
 * Usage Store -- data access for agent_usage and usage_daily_rollups tables
 * in agent_logs.db.
 *
 * Provides time-series queries, breakdown aggregations, cache statistics,
 * budget spend queries, daily rollups, pruning, and export.
 */

import type Database from 'better-sqlite3';
import { generateUUID, now } from '@animus-labs/shared';
import type { AgentUsage, UsageRecord } from '@animus-labs/shared';
import { snakeToCamel } from '../utils.js';

// ============================================================================
// Insert (enhanced with tick context and cache tokens)
// ============================================================================

export function insertUsage(
  db: Database.Database,
  data: {
    sessionId: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    totalTokens: number;
    costUsd?: number | null;
    model: string;
    tickNumber?: number | null;
    tickType?: string | null;
    pipelinePhase?: string | null;
    contactId?: string | null;
  },
): AgentUsage {
  const id = generateUUID();
  const timestamp = now();
  db.prepare(
    `INSERT INTO agent_usage (
      id, session_id, input_tokens, output_tokens,
      cache_read_tokens, cache_write_tokens,
      total_tokens, cost_usd, model,
      tick_number, tick_type, pipeline_phase, contact_id,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    data.sessionId,
    data.inputTokens,
    data.outputTokens,
    data.cacheReadTokens ?? 0,
    data.cacheWriteTokens ?? 0,
    data.totalTokens,
    data.costUsd ?? null,
    data.model,
    data.tickNumber ?? null,
    data.tickType ?? null,
    data.pipelinePhase ?? null,
    data.contactId ?? null,
    timestamp,
  );
  return {
    sessionId: data.sessionId,
    tickNumber: data.tickNumber ?? null,
    tickType: data.tickType ?? null,
    pipelinePhase: data.pipelinePhase ?? null,
    contactId: data.contactId ?? null,
    inputTokens: data.inputTokens,
    outputTokens: data.outputTokens,
    cacheReadTokens: data.cacheReadTokens ?? 0,
    cacheWriteTokens: data.cacheWriteTokens ?? 0,
    totalTokens: data.totalTokens,
    costUsd: data.costUsd ?? null,
    model: data.model,
    createdAt: timestamp,
  };
}

// ============================================================================
// Time Series
// ============================================================================

export interface UsageTimeSeriesResult {
  buckets: Array<{
    timestamp: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
    costUsd: number;
    tickCount: number;
  }>;
  totals: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
    costUsd: number;
    tickCount: number;
  };
}

export function getUsageTimeSeries(
  db: Database.Database,
  params: {
    start: string;
    end: string;
    bucketMinutes: number;
    tickType?: string;
    model?: string;
  },
): UsageTimeSeriesResult {
  const bucketSeconds = params.bucketMinutes * 60;

  const conditions = ['created_at >= ? AND created_at < ?'];
  const queryParams: unknown[] = [params.start, params.end];

  if (params.tickType) {
    conditions.push('tick_type = ?');
    queryParams.push(params.tickType);
  }
  if (params.model) {
    conditions.push('model = ?');
    queryParams.push(params.model);
  }

  const where = conditions.join(' AND ');

  // Bucket by dividing unix timestamp
  const bucketQuery = db.prepare(`
    SELECT
      datetime((CAST(strftime('%s', created_at) AS INTEGER) / ${bucketSeconds}) * ${bucketSeconds}, 'unixepoch') || 'Z' as bucket_ts,
      COALESCE(SUM(input_tokens), 0) as input_tokens,
      COALESCE(SUM(output_tokens), 0) as output_tokens,
      COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
      COALESCE(SUM(cache_write_tokens), 0) as cache_write_tokens,
      COALESCE(SUM(total_tokens), 0) as total_tokens,
      COALESCE(SUM(cost_usd), 0) as cost_usd,
      COUNT(DISTINCT tick_number) as tick_count
    FROM agent_usage
    WHERE ${where}
    GROUP BY bucket_ts
    ORDER BY bucket_ts
  `);

  const rows = bucketQuery.all(...queryParams) as Array<Record<string, unknown>>;

  const buckets = rows.map((row) => ({
    timestamp: row['bucket_ts'] as string,
    inputTokens: row['input_tokens'] as number,
    outputTokens: row['output_tokens'] as number,
    cacheReadTokens: row['cache_read_tokens'] as number,
    cacheWriteTokens: row['cache_write_tokens'] as number,
    totalTokens: row['total_tokens'] as number,
    costUsd: row['cost_usd'] as number,
    tickCount: row['tick_count'] as number,
  }));

  // Compute totals
  const totalsQuery = db.prepare(`
    SELECT
      COALESCE(SUM(input_tokens), 0) as input_tokens,
      COALESCE(SUM(output_tokens), 0) as output_tokens,
      COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
      COALESCE(SUM(cache_write_tokens), 0) as cache_write_tokens,
      COALESCE(SUM(total_tokens), 0) as total_tokens,
      COALESCE(SUM(cost_usd), 0) as cost_usd,
      COUNT(DISTINCT tick_number) as tick_count
    FROM agent_usage
    WHERE ${where}
  `);

  const totalsRow = totalsQuery.get(...queryParams) as Record<string, number>;

  return {
    buckets,
    totals: {
      inputTokens: totalsRow['input_tokens'] ?? 0,
      outputTokens: totalsRow['output_tokens'] ?? 0,
      cacheReadTokens: totalsRow['cache_read_tokens'] ?? 0,
      cacheWriteTokens: totalsRow['cache_write_tokens'] ?? 0,
      totalTokens: totalsRow['total_tokens'] ?? 0,
      costUsd: totalsRow['cost_usd'] ?? 0,
      tickCount: totalsRow['tick_count'] ?? 0,
    },
  };
}

// ============================================================================
// Breakdown
// ============================================================================

/** Map dimension names to the SQL column expression. */
const DIMENSION_COLUMN_MAP: Record<string, string> = {
  tick_type: 'tick_type',
  model: 'model',
  pipeline_phase: 'pipeline_phase',
  contact: 'contact_id',
};

export function getUsageBreakdown(
  db: Database.Database,
  params: {
    start: string;
    end: string;
    dimension: 'tick_type' | 'model' | 'pipeline_phase' | 'contact';
  },
): Array<{
  dimension: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd: number;
  tickCount: number;
  percentOfTotal: number;
}> {
  const column = DIMENSION_COLUMN_MAP[params.dimension];
  if (!column) throw new Error(`Unknown dimension: ${params.dimension}`);

  const rows = db
    .prepare(
      `SELECT
        COALESCE(${column}, 'unknown') as dim_value,
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
        COALESCE(SUM(cache_write_tokens), 0) as cache_write_tokens,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COALESCE(SUM(cost_usd), 0) as cost_usd,
        COUNT(DISTINCT tick_number) as tick_count
      FROM agent_usage
      WHERE created_at >= ? AND created_at < ?
      GROUP BY dim_value
      ORDER BY cost_usd DESC`,
    )
    .all(params.start, params.end) as Array<Record<string, unknown>>;

  // Compute grand total for percentage calculation
  const grandTotal = rows.reduce((sum, r) => sum + (r['cost_usd'] as number), 0);

  return rows.map((row) => ({
    dimension: row['dim_value'] as string,
    inputTokens: row['input_tokens'] as number,
    outputTokens: row['output_tokens'] as number,
    cacheReadTokens: row['cache_read_tokens'] as number,
    cacheWriteTokens: row['cache_write_tokens'] as number,
    totalTokens: row['total_tokens'] as number,
    costUsd: row['cost_usd'] as number,
    tickCount: row['tick_count'] as number,
    percentOfTotal: grandTotal > 0 ? (row['cost_usd'] as number) / grandTotal : 0,
  }));
}

// ============================================================================
// Cache Stats
// ============================================================================

export function getCacheStats(
  db: Database.Database,
  params: { start: string; end: string },
): {
  totalInputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheHitRate: number;
  estimatedSavingsUsd: number;
} {
  const row = db
    .prepare(
      `SELECT
        COALESCE(SUM(input_tokens), 0) as total_input_tokens,
        COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
        COALESCE(SUM(cache_write_tokens), 0) as cache_write_tokens,
        COUNT(*) as total_calls,
        SUM(CASE WHEN cache_read_tokens > 0 THEN 1 ELSE 0 END) as calls_with_cache_hit
      FROM agent_usage
      WHERE created_at >= ? AND created_at < ?`,
    )
    .get(params.start, params.end) as Record<string, number>;

  const totalInputTokens = row['total_input_tokens'] ?? 0;
  const cacheReadTokens = row['cache_read_tokens'] ?? 0;
  const cacheWriteTokens = row['cache_write_tokens'] ?? 0;

  // Cache hit rate: what fraction of LLM calls got any cache hit.
  // This is more honest than token-weighted metrics which can be inflated
  // by a single phase (e.g. agentic loop) that always hits cache.
  const totalCalls = row['total_calls'] ?? 0;
  const callsWithHit = row['calls_with_cache_hit'] ?? 0;
  const cacheHitRate = totalCalls > 0 ? callsWithHit / totalCalls : 0;

  // Estimated savings: cache reads cost ~$0.30/1M vs standard input ~$3/1M for Sonnet,
  // so savings = cacheReadTokens * ($3 - $0.30) / 1M = cacheReadTokens * $2.70 / 1M
  const estimatedSavingsUsd = (cacheReadTokens * 2.7) / 1_000_000;

  return {
    totalInputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    cacheHitRate,
    estimatedSavingsUsd,
  };
}

// ============================================================================
// Budget Queries
// ============================================================================

/**
 * Total spend (cost_usd) in a time range.
 */
export function getTotalSpend(
  db: Database.Database,
  params: { start: string; end: string },
): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) as total
       FROM agent_usage
       WHERE created_at >= ? AND created_at < ?`,
    )
    .get(params.start, params.end) as { total: number };
  return row.total;
}

/**
 * Average cost per hour over the most recent N hours.
 * Returns 0 if no data or zero spend.
 */
export function getRecentBurnRate(
  db: Database.Database,
  params: { hours: number },
): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) as total
       FROM agent_usage
       WHERE created_at >= datetime('now', '-' || ? || ' hours')`,
    )
    .get(params.hours) as { total: number };
  return params.hours > 0 ? row.total / params.hours : 0;
}

// ============================================================================
// Daily Rollups
// ============================================================================

export function insertDailyRollup(
  db: Database.Database,
  data: {
    date: string;
    tickType?: string | null;
    model?: string | null;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
    totalCostUsd: number;
    tickCount: number;
  },
): void {
  const id = generateUUID();
  const timestamp = now();
  db.prepare(
    `INSERT INTO usage_daily_rollups (
      id, date, tick_type, model,
      input_tokens, output_tokens,
      cache_read_tokens, cache_write_tokens,
      total_tokens, total_cost_usd, tick_count,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    data.date,
    data.tickType ?? null,
    data.model ?? null,
    data.inputTokens,
    data.outputTokens,
    data.cacheReadTokens,
    data.cacheWriteTokens,
    data.totalTokens,
    data.totalCostUsd,
    data.tickCount,
    timestamp,
  );
}

export function getDailyRollups(
  db: Database.Database,
  params: { start: string; end: string },
): Array<{
  id: string;
  date: string;
  tickType: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  tickCount: number;
  createdAt: string;
}> {
  const rows = db
    .prepare(
      `SELECT * FROM usage_daily_rollups
       WHERE date >= ? AND date <= ?
       ORDER BY date`,
    )
    .all(params.start, params.end) as Array<Record<string, unknown>>;

  return rows.map((row) => snakeToCamel(row));
}

// ============================================================================
// Pruning
// ============================================================================

/**
 * Delete raw agent_usage records older than retentionDays.
 * Returns the number of rows deleted.
 */
export function pruneRawUsage(db: Database.Database, retentionDays: number): number {
  const result = db
    .prepare(
      `DELETE FROM agent_usage
       WHERE created_at < datetime('now', '-' || ? || ' days')`,
    )
    .run(retentionDays);
  return result.changes;
}

// ============================================================================
// Export
// ============================================================================

/**
 * Export raw usage records for a time range.
 */
export function exportUsageRecords(
  db: Database.Database,
  params: { start: string; end: string },
): UsageRecord[] {
  const rows = db
    .prepare(
      `SELECT * FROM agent_usage
       WHERE created_at >= ? AND created_at < ?
       ORDER BY created_at`,
    )
    .all(params.start, params.end) as Array<Record<string, unknown>>;

  return rows.map((row) => snakeToCamel<UsageRecord>(row));
}
