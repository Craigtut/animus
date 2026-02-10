/**
 * Tool Permission Map — maps contact permission tiers to allowed tool sets.
 *
 * This is a compile-time constant. The backend uses it to filter
 * tool lists before session creation.
 *
 * See docs/architecture/mcp-tools.md
 */

import type { PermissionTier } from '../types/index.js';
import type { AnimusToolName } from './definitions.js';

/**
 * Maps contact permission tiers to allowed tool sets.
 *
 * - primary: Full permissions (sub-agents, tasks, goals, tools)
 * - standard: Can message and get replies. No sub-agents, tasks, goals, or personal tools.
 */
export const TOOL_PERMISSIONS: Record<PermissionTier, readonly AnimusToolName[]> = {
  primary: ['send_message', 'update_progress', 'read_memory'],
  standard: ['send_message', 'read_memory'],
} as const;

/**
 * Check if a tool is allowed for a given permission tier.
 */
export function isToolAllowed(tool: AnimusToolName, tier: PermissionTier): boolean {
  return TOOL_PERMISSIONS[tier].includes(tool);
}

/**
 * Get the list of allowed tools for a permission tier.
 */
export function getAllowedTools(tier: PermissionTier): readonly AnimusToolName[] {
  return TOOL_PERMISSIONS[tier];
}
