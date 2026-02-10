/**
 * Contacts Module — barrel export
 *
 * Provides identity resolution, permission enforcement, and contact context.
 * See docs/architecture/contacts.md
 */

export {
  resolveContact,
  resolveToResolvedContact,
  resolveWebUser,
  createContactForChannel,
  type ResolveResult,
} from './identity-resolver.js';

export {
  canPerform,
  canPerformByTier,
  isDecisionAllowed,
  filterAllowedDecisions,
  getAvailableToolTypes,
  type ContactAction,
} from './permission-enforcer.js';

export {
  buildContactContext,
  formatContactContextBlock,
  type ContactContext,
} from './contact-context.js';
