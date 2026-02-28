/**
 * Energy Store — heartbeat_state (energy columns) and energy_history table
 */

import type Database from 'better-sqlite3';
import { now } from '@animus-labs/shared';
import type { EnergyBand, EnergyHistoryEntry } from '@animus-labs/shared';
import { snakeToCamel } from '../utils.js';

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
