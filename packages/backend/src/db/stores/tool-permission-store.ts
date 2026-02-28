/**
 * Tool Permission Store — tool_permissions table
 */

import type Database from 'better-sqlite3';
import { now } from '@animus-labs/shared';
import type { ToolPermission, RiskTier, ToolPermissionMode } from '@animus-labs/shared';

function rowToToolPermission(row: Record<string, unknown>): ToolPermission {
  return {
    toolName: row['tool_name'] as string,
    toolSource: row['tool_source'] as string,
    displayName: row['display_name'] as string,
    description: row['description'] as string,
    riskTier: row['risk_tier'] as RiskTier,
    mode: row['mode'] as ToolPermissionMode,
    isDefault: (row['is_default'] as number) === 1,
    usageCount: row['usage_count'] as number,
    lastUsedAt: (row['last_used_at'] as string) ?? null,
    trustRampDismissedAt: (row['trust_ramp_dismissed_at'] as string) ?? null,
    updatedAt: row['updated_at'] as string,
  };
}

export function getToolPermissions(db: Database.Database): ToolPermission[] {
  const rows = db
    .prepare('SELECT * FROM tool_permissions ORDER BY tool_source, tool_name')
    .all() as Array<Record<string, unknown>>;
  return rows.map(rowToToolPermission);
}

export function getToolPermission(
  db: Database.Database,
  toolName: string
): ToolPermission | null {
  const row = db
    .prepare('SELECT * FROM tool_permissions WHERE tool_name = ?')
    .get(toolName) as Record<string, unknown> | undefined;
  return row ? rowToToolPermission(row) : null;
}

export function upsertToolPermission(
  db: Database.Database,
  data: {
    toolName: string;
    toolSource: string;
    displayName: string;
    description: string;
    riskTier: RiskTier;
    mode: ToolPermissionMode;
    isDefault?: boolean;
  }
): void {
  const timestamp = now();
  db.prepare(
    `INSERT INTO tool_permissions (tool_name, tool_source, display_name, description, risk_tier, mode, is_default, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tool_name) DO UPDATE SET
       tool_source = CASE WHEN is_default = 1 THEN excluded.tool_source ELSE tool_source END,
       display_name = CASE WHEN is_default = 1 THEN excluded.display_name ELSE display_name END,
       description = CASE WHEN is_default = 1 THEN excluded.description ELSE description END,
       risk_tier = CASE WHEN is_default = 1 THEN excluded.risk_tier ELSE risk_tier END,
       mode = CASE WHEN is_default = 1 THEN excluded.mode ELSE mode END,
       updated_at = excluded.updated_at`
  ).run(
    data.toolName,
    data.toolSource,
    data.displayName,
    data.description,
    data.riskTier,
    data.mode,
    data.isDefault !== undefined ? (data.isDefault ? 1 : 0) : 1,
    timestamp
  );
}

export function updateToolPermissionMode(
  db: Database.Database,
  toolName: string,
  mode: ToolPermissionMode
): void {
  db.prepare(
    'UPDATE tool_permissions SET mode = ?, is_default = 0, updated_at = ? WHERE tool_name = ?'
  ).run(mode, now(), toolName);
}

export function updateGroupPermissionMode(
  db: Database.Database,
  source: string,
  mode: ToolPermissionMode
): void {
  db.prepare(
    'UPDATE tool_permissions SET mode = ?, is_default = 0, updated_at = ? WHERE tool_source = ?'
  ).run(mode, now(), source);
}

export function incrementToolUsage(db: Database.Database, toolName: string): void {
  db.prepare(
    'UPDATE tool_permissions SET usage_count = usage_count + 1, last_used_at = ?, updated_at = ? WHERE tool_name = ?'
  ).run(now(), now(), toolName);
}

export function setTrustRampDismissed(db: Database.Database, toolName: string): void {
  db.prepare(
    'UPDATE tool_permissions SET trust_ramp_dismissed_at = ?, updated_at = ? WHERE tool_name = ?'
  ).run(now(), now(), toolName);
}

export function getToolsEligibleForTrustRamp(db: Database.Database): ToolPermission[] {
  const rows = db
    .prepare(
      `SELECT tp.* FROM tool_permissions tp
       WHERE tp.mode = 'ask'
         AND (tp.trust_ramp_dismissed_at IS NULL
              OR tp.trust_ramp_dismissed_at < datetime('now', '-30 days'))
       ORDER BY tp.tool_name`
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map(rowToToolPermission);
}
