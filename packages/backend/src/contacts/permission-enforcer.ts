/**
 * Permission Enforcer
 *
 * Enforces tier-based permissions for contacts.
 * Primary contacts have full access; standard contacts are restricted.
 *
 * See docs/architecture/contacts.md — "Permission Tiers"
 */

import type { Contact, PermissionTier, DecisionType } from '@animus-labs/shared';

// ============================================================================
// Actions
// ============================================================================

export type ContactAction =
  | 'trigger_tick'
  | 'receive_reply'
  | 'spawn_agent'
  | 'schedule_task'
  | 'update_goal'
  | 'cancel_agent'
  | 'access_tools'
  | 'access_config'
  | 'send_message';

// ============================================================================
// Permission Map
// ============================================================================

const PERMISSIONS: Record<PermissionTier, Set<ContactAction>> = {
  primary: new Set([
    'trigger_tick',
    'receive_reply',
    'spawn_agent',
    'schedule_task',
    'update_goal',
    'cancel_agent',
    'access_tools',
    'access_config',
    'send_message',
  ]),
  standard: new Set([
    'trigger_tick',
    'receive_reply',
    'send_message',
  ]),
};

/**
 * Allowed decision types per tier.
 * Decisions not in this set are dropped by EXECUTE with a warning.
 */
const ALLOWED_DECISIONS: Record<PermissionTier, Set<DecisionType>> = {
  primary: new Set([
    'spawn_agent',
    'update_agent',
    'cancel_agent',
    'send_message',
    'update_goal',
    'propose_goal',
    'create_seed',
    'create_plan',
    'revise_plan',
    'schedule_task',
    'start_task',
    'complete_task',
    'cancel_task',
    'skip_task',
    'no_action',
  ]),
  standard: new Set([
    'send_message',
    'no_action',
  ]),
};

// ============================================================================
// Enforcement Functions
// ============================================================================

/**
 * Check if a contact can perform a specific action.
 */
export function canPerform(contact: Contact, action: ContactAction): boolean {
  const tier = contact.isPrimary ? 'primary' : contact.permissionTier;
  return PERMISSIONS[tier]?.has(action) ?? false;
}

/**
 * Check if a contact can perform an action by tier directly.
 */
export function canPerformByTier(
  tier: PermissionTier,
  action: ContactAction
): boolean {
  return PERMISSIONS[tier]?.has(action) ?? false;
}

/**
 * Check if a decision type is allowed for a given permission tier.
 */
export function isDecisionAllowed(
  tier: PermissionTier,
  decisionType: DecisionType
): boolean {
  return ALLOWED_DECISIONS[tier]?.has(decisionType) ?? false;
}

/**
 * Filter a list of decision types to only those allowed for the tier.
 */
export function filterAllowedDecisions(
  tier: PermissionTier,
  decisions: DecisionType[]
): { allowed: DecisionType[]; dropped: DecisionType[] } {
  const allowed: DecisionType[] = [];
  const dropped: DecisionType[] = [];

  for (const d of decisions) {
    if (isDecisionAllowed(tier, d)) {
      allowed.push(d);
    } else {
      dropped.push(d);
    }
  }

  return { allowed, dropped };
}

/**
 * Get the set of available tools for a given tier.
 * Primary gets full access, standard gets limited tools.
 */
export function getAvailableToolTypes(tier: PermissionTier): string[] {
  if (tier === 'primary') {
    return [
      'send_message',
      'spawn_agent',
      'calendar_lookup',
      'read_memory',
      'schedule_task',
      'update_goal',
      'system_config',
    ];
  }
  return ['send_message', 'read_memory'];
}
