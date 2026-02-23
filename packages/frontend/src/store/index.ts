/**
 * Store Barrel
 *
 * Re-exports all Zustand stores for convenient imports.
 * Individual stores live in their own files for maintainability.
 */

export { useAuthStore } from './auth-store.js';
export { useShellStore, type SpaceName } from './ui-store.js';
export { useSettingsStore } from './settings-store.js';
export { useOnboardingStore, type OnboardingStep } from './onboarding-store.js';
export {
  useHeartbeatStore,
  selectEmotionsArray,
  selectEmotion,
  selectHasRunningAgents,
  type AgentStatusEvent,
  type SubAgentEventEntry,
  type ReplyStreamState,
} from './heartbeat-store.js';
export { useMessagesStore } from './messages-store.js';
