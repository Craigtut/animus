/**
 * Tool Gate — unified permission enforcement for all tool types.
 *
 * This is the single source of truth for the "ask" mode approval flow.
 * Three enforcement points call this function:
 *
 *   1. canUseTool callback (mind-session.ts) — SDK built-in tools + plugin MCP (Codex)
 *   2. PreToolUse hook (mind-session.ts) — plugin MCP tools (Claude)
 *   3. checkToolPermission (registry.ts) — core Animus MCP tools (via bridge)
 *
 * Each caller handles its own entry-point-specific concerns (exempt checks,
 * tool-name-to-permKey mapping, security deny-list) then delegates here.
 *
 * See docs/architecture/tool-permissions.md
 */

import type Database from 'better-sqlite3';
import type { IEventBus, ToolPermissionMode } from '@animus-labs/shared';
import {
  getActiveApproval,
  getPendingApprovals,
  createApprovalRequest,
  consumeApproval,
  getHeartbeatState,
} from '../db/stores/heartbeat-store.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('ToolGate', 'heartbeat');

// ============================================================================
// Types
// ============================================================================

export interface ToolGateParams {
  /** heartbeat.db handle for approval CRUD */
  heartbeatDb: Database.Database;
  /** Permission lookup key (e.g., "Bash", "mcp__obsidian__vault", "send_message") */
  permKey: string;
  /** The current permission mode for this tool */
  mode: ToolPermissionMode;
  /** Human-readable display name from tool_permissions table */
  displayName: string;
  /** Tool source identifier (e.g., "sdk:claude", "plugin:obsidian", "animus:core") */
  toolSource: string;
  /** Contact making the request */
  contactId: string;
  /** Channel the request arrived on */
  sourceChannel: string;
  /** Active conversation ID */
  conversationId: string;
  /** Full tool name for log messages (may differ from permKey for plugin MCP) */
  toolName: string;
  /** The tool input parameters */
  toolInput: Record<string, unknown> | null;
  /** Who is calling: 'mind' or an agent task ID */
  originatingAgent: string;
  /** Event bus for emitting approval events */
  eventBus: IEventBus;
}

export type ToolGateResult =
  | { action: 'allow' }
  | { action: 'deny'; reason: string };

// ============================================================================
// Core gate function
// ============================================================================

/**
 * Evaluate whether a tool call should be allowed, denied, or needs approval.
 *
 * Callers must resolve the permission record and exempt checks before calling.
 * This function handles the three permission modes and the full approval lifecycle.
 */
export function resolveToolGate(params: ToolGateParams): ToolGateResult {
  const {
    heartbeatDb,
    permKey,
    mode,
    displayName,
    toolSource,
    contactId,
    sourceChannel,
    conversationId,
    toolName,
    toolInput,
    originatingAgent,
    eventBus,
  } = params;

  // ── Mode: off ──
  if (mode === 'off') {
    return { action: 'deny', reason: `Tool "${displayName}" is disabled.` };
  }

  // ── Mode: always_allow ──
  if (mode === 'always_allow') {
    return { action: 'allow' };
  }

  // ── Mode: ask ──

  // Check for an active (pre-approved) approval record
  const activeApproval = getActiveApproval(heartbeatDb, permKey, contactId);
  if (activeApproval) {
    consumeApproval(heartbeatDb, activeApproval.id);
    log.info(`Consumed approval ${activeApproval.id} for "${toolName}" (permKey=${permKey})`);
    return { action: 'allow' };
  }

  // Enforce one pending approval at a time per contact
  const pendingRequests = getPendingApprovals(heartbeatDb, contactId);
  if (pendingRequests.length > 0) {
    const existingTool = pendingRequests[0]!.toolName;
    if (existingTool !== permKey) {
      return {
        action: 'deny',
        reason: 'There is already a pending tool approval request. ' +
          'Wait for the user to respond to it before attempting any other gated tools.',
      };
    }
    // Same tool already pending
    return {
      action: 'deny',
      reason: `Tool "${displayName}" requires user approval. ` +
        'Tell the user what you want to do and why, then ask them to reply with "approve" or "deny". ' +
        'Do NOT attempt to call this tool again until the user has responded.',
    };
  }

  // No pending requests — create a new approval request
  const heartbeatState = getHeartbeatState(heartbeatDb);
  const approvalRequest = createApprovalRequest(heartbeatDb, {
    toolName: permKey,
    toolSource,
    contactId,
    channel: sourceChannel,
    tickNumber: heartbeatState.tickNumber,
    agentContext: {
      taskDescription: `Tool "${toolName}" invoked during tick ${heartbeatState.tickNumber}`,
      conversationSummary: `Conversation ${conversationId}`,
      pendingAction: `Execute tool "${toolName}"`,
    },
    toolInput,
    triggerSummary: `Agent wants to use "${displayName}"`,
    conversationId,
    originatingAgent,
  });

  eventBus.emit('tool:approval_requested', approvalRequest);
  log.info(`Created approval request ${approvalRequest.id} for "${toolName}" (permKey=${permKey})`);

  return {
    action: 'deny',
    reason: `Tool "${displayName}" requires user approval. ` +
      'Tell the user what you want to do and why, then ask them to reply with "approve" or "deny". ' +
      'Do NOT attempt to call this tool again until the user has responded.',
  };
}
