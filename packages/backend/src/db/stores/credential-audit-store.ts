/**
 * Credential Audit Store — credential_access_log table
 *
 * Logs every credential access for security auditing.
 * Lives in agent_logs.db alongside agent session/event data.
 */

import type Database from 'better-sqlite3';
import { generateUUID } from '@animus-labs/shared';

export interface CredentialAccessLogEntry {
  id: string;
  credentialType: 'vault' | 'plugin' | 'channel';
  credentialRef: string;
  toolName: string;
  agentContext: string | null;
  accessedAt: string;
}

/**
 * Log a credential access event.
 */
export function logCredentialAccess(
  db: Database.Database,
  data: {
    credentialType: 'vault' | 'plugin' | 'channel';
    credentialRef: string;
    toolName: string;
    agentContext?: string | null;
  }
): void {
  db.prepare(
    `INSERT INTO credential_access_log (id, credential_type, credential_ref, tool_name, agent_context)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    generateUUID(),
    data.credentialType,
    data.credentialRef,
    data.toolName,
    data.agentContext ?? null
  );
}

/**
 * Get recent credential access log entries.
 */
export function getRecentCredentialAccess(
  db: Database.Database,
  limit = 50
): CredentialAccessLogEntry[] {
  const rows = db
    .prepare(
      `SELECT id, credential_type, credential_ref, tool_name, agent_context, accessed_at
       FROM credential_access_log ORDER BY accessed_at DESC LIMIT ?`
    )
    .all(limit) as Array<{
      id: string;
      credential_type: string;
      credential_ref: string;
      tool_name: string;
      agent_context: string | null;
      accessed_at: string;
    }>;

  return rows.map((row) => ({
    id: row.id,
    credentialType: row.credential_type as 'vault' | 'plugin' | 'channel',
    credentialRef: row.credential_ref,
    toolName: row.tool_name,
    agentContext: row.agent_context,
    accessedAt: row.accessed_at,
  }));
}
