/**
 * Approval Phrases — deterministic text-based tool approval matching.
 *
 * When a user replies to a tool approval request via a text-only channel
 * (SMS, API, etc.), the system matches their message against these phrase
 * sets to resolve the approval without involving the LLM.
 *
 * Matching is exact (full message), case-insensitive, whitespace-trimmed.
 * Partial matches like "I approve of that" intentionally return null to
 * avoid false positives on regular conversation.
 *
 * See docs/architecture/tool-permissions.md
 */

/**
 * Phrases that approve a pending tool request.
 * All entries must be lowercase.
 */
export const APPROVAL_PHRASES = new Set([
  'approve',
  'approved',
  'yes',
  'yeah',
  'yep',
  'yup',
  'ok',
  'okay',
  'sure',
  'go ahead',
  'go for it',
  'do it',
  'allow',
  'allow it',
  'that\'s fine',
  'thats fine',
  'proceed',
  'confirmed',
  'confirm',
  'accepted',
  'accept',
]);

/**
 * Phrases that deny a pending tool request.
 * All entries must be lowercase.
 */
export const DENIAL_PHRASES = new Set([
  'deny',
  'denied',
  'no',
  'nope',
  'nah',
  'don\'t',
  'dont',
  'stop',
  'cancel',
  'reject',
  'block',
  'not allowed',
  'absolutely not',
  'no way',
  'decline',
  'declined',
]);

/**
 * Match a user message against known approval/denial phrases.
 *
 * @param message  Raw message content from the user
 * @returns 'approve' | 'deny' | null
 */
export function matchApprovalPhrase(message: string): 'approve' | 'deny' | null {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return null;

  if (APPROVAL_PHRASES.has(normalized)) return 'approve';
  if (DENIAL_PHRASES.has(normalized)) return 'deny';

  return null;
}
