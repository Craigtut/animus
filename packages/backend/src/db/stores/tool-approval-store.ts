/**
 * Tool Approval Store — tool_approval_requests table
 */

import type Database from 'better-sqlite3';
import { generateUUID, now } from '@animus-labs/shared';
import type {
  ToolApprovalRequest,
  ToolApprovalAgentContext,
  ToolApprovalStatus,
} from '@animus-labs/shared';

function rowToApprovalRequest(row: Record<string, unknown>): ToolApprovalRequest {
  return {
    id: row['id'] as string,
    toolName: row['tool_name'] as string,
    toolSource: row['tool_source'] as string,
    contactId: row['contact_id'] as string,
    channel: row['channel'] as string,
    tickNumber: row['tick_number'] as number,
    agentContext: JSON.parse(row['agent_context'] as string) as ToolApprovalAgentContext,
    toolInput: row['tool_input'] ? JSON.parse(row['tool_input'] as string) as Record<string, unknown> : null,
    triggerSummary: row['trigger_summary'] as string,
    conversationId: (row['conversation_id'] as string) ?? null,
    originatingAgent: row['originating_agent'] as string,
    status: row['status'] as ToolApprovalStatus,
    scope: (row['scope'] as 'once') ?? null,
    batchId: (row['batch_id'] as string) ?? null,
    createdAt: row['created_at'] as string,
    resolvedAt: (row['resolved_at'] as string) ?? null,
    expiresAt: row['expires_at'] as string,
  };
}

export function createApprovalRequest(
  db: Database.Database,
  data: {
    toolName: string;
    toolSource: string;
    contactId: string;
    channel: string;
    tickNumber: number;
    agentContext: ToolApprovalAgentContext;
    toolInput?: Record<string, unknown> | null;
    triggerSummary: string;
    conversationId?: string | null;
    originatingAgent: string;
    batchId?: string | null;
    expiresInMs?: number;
  }
): ToolApprovalRequest {
  const id = generateUUID();
  const timestamp = now();
  const expiresMs = data.expiresInMs ?? 24 * 60 * 60 * 1000; // 24h default
  // Use SQLite-compatible datetime format (matches datetime('now') output)
  const expiresDate = new Date(Date.now() + expiresMs);
  const expiresAt = expiresDate.toISOString().replace('T', ' ').replace('Z', '').replace(/\.\d{3}$/, '');

  db.prepare(
    `INSERT INTO tool_approval_requests
     (id, tool_name, tool_source, contact_id, channel, tick_number,
      agent_context, tool_input, trigger_summary, conversation_id,
      originating_agent, batch_id, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.toolName,
    data.toolSource,
    data.contactId,
    data.channel,
    data.tickNumber,
    JSON.stringify(data.agentContext),
    data.toolInput ? JSON.stringify(data.toolInput) : null,
    data.triggerSummary,
    data.conversationId ?? null,
    data.originatingAgent,
    data.batchId ?? null,
    timestamp,
    expiresAt
  );

  return {
    id,
    toolName: data.toolName,
    toolSource: data.toolSource,
    contactId: data.contactId,
    channel: data.channel,
    tickNumber: data.tickNumber,
    agentContext: data.agentContext,
    toolInput: data.toolInput ?? null,
    triggerSummary: data.triggerSummary,
    conversationId: data.conversationId ?? null,
    originatingAgent: data.originatingAgent,
    status: 'pending',
    scope: null,
    batchId: data.batchId ?? null,
    createdAt: timestamp,
    resolvedAt: null,
    expiresAt,
  };
}

export function getActiveApproval(
  db: Database.Database,
  toolName: string,
  contactId: string
): ToolApprovalRequest | null {
  const row = db
    .prepare(
      `SELECT * FROM tool_approval_requests
       WHERE tool_name = ? AND contact_id = ? AND status = 'approved'
         AND (scope = 'once') AND expires_at > datetime('now')
       ORDER BY resolved_at DESC LIMIT 1`
    )
    .get(toolName, contactId) as Record<string, unknown> | undefined;
  return row ? rowToApprovalRequest(row) : null;
}

export function getPendingApprovals(
  db: Database.Database,
  contactId?: string
): ToolApprovalRequest[] {
  let rows: Array<Record<string, unknown>>;
  if (contactId) {
    rows = db
      .prepare(
        `SELECT * FROM tool_approval_requests
         WHERE status = 'pending' AND contact_id = ? AND expires_at > datetime('now')
         ORDER BY created_at DESC`
      )
      .all(contactId) as Array<Record<string, unknown>>;
  } else {
    rows = db
      .prepare(
        `SELECT * FROM tool_approval_requests
         WHERE status = 'pending' AND expires_at > datetime('now')
         ORDER BY created_at DESC`
      )
      .all() as Array<Record<string, unknown>>;
  }
  return rows.map(rowToApprovalRequest);
}

export function getPendingApprovalsByBatch(
  db: Database.Database,
  batchId: string
): ToolApprovalRequest[] {
  const rows = db
    .prepare(
      `SELECT * FROM tool_approval_requests
       WHERE batch_id = ? AND status = 'pending'
       ORDER BY created_at`
    )
    .all(batchId) as Array<Record<string, unknown>>;
  return rows.map(rowToApprovalRequest);
}

export function resolveApproval(
  db: Database.Database,
  id: string,
  status: 'approved' | 'denied',
  scope?: 'once'
): void {
  db.prepare(
    `UPDATE tool_approval_requests
     SET status = ?, scope = ?, resolved_at = ?
     WHERE id = ?`
  ).run(status, scope ?? null, now(), id);
}

export function consumeApproval(db: Database.Database, id: string): void {
  db.prepare(
    `UPDATE tool_approval_requests SET status = 'expired', resolved_at = ? WHERE id = ?`
  ).run(now(), id);
}

export function expirePendingApprovals(db: Database.Database): number {
  const result = db
    .prepare(
      `UPDATE tool_approval_requests
       SET status = 'expired', resolved_at = datetime('now')
       WHERE status = 'pending' AND expires_at < datetime('now')`
    )
    .run();
  return result.changes;
}

export function getApprovalStats(
  db: Database.Database,
  toolName: string,
  days: number
): { approved: number; denied: number } {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const approved = db
    .prepare(
      `SELECT COUNT(*) as count FROM tool_approval_requests
       WHERE tool_name = ? AND status = 'approved' AND created_at > ?`
    )
    .get(toolName, cutoff) as { count: number };
  const denied = db
    .prepare(
      `SELECT COUNT(*) as count FROM tool_approval_requests
       WHERE tool_name = ? AND status = 'denied' AND created_at > ?`
    )
    .get(toolName, cutoff) as { count: number };
  return { approved: approved.count, denied: denied.count };
}

export function cleanupOldApprovals(db: Database.Database, retentionDays: number): number {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const result = db
    .prepare(
      `DELETE FROM tool_approval_requests
       WHERE status IN ('approved', 'denied', 'expired') AND created_at < ?`
    )
    .run(cutoff);
  return result.changes;
}

export function getApprovalRequest(
  db: Database.Database,
  id: string
): ToolApprovalRequest | null {
  const row = db
    .prepare('SELECT * FROM tool_approval_requests WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToApprovalRequest(row) : null;
}

export function getRecentApprovals(
  db: Database.Database,
  limit: number = 20
): ToolApprovalRequest[] {
  const rows = db
    .prepare(
      `SELECT * FROM tool_approval_requests
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(limit) as Array<Record<string, unknown>>;
  return rows.map(rowToApprovalRequest);
}
