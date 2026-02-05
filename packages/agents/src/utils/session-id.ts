/**
 * Session ID utilities for the agent abstraction layer.
 *
 * Session IDs follow the format: {provider}:{native_id}
 * This allows routing to the correct adapter when resuming sessions.
 */

import type { AgentProvider } from '@animus/shared';

/**
 * Parsed session ID components.
 */
export interface ParsedSessionId {
  provider: AgentProvider;
  nativeId: string;
}

/**
 * Create a unified session ID from provider and native ID.
 *
 * @param provider - The agent provider
 * @param nativeId - The provider's native session ID
 * @returns Formatted session ID: "{provider}:{nativeId}"
 */
export function createSessionId(provider: AgentProvider, nativeId: string): string {
  if (!nativeId) {
    throw new Error('Native session ID cannot be empty');
  }

  return `${provider}:${nativeId}`;
}

/**
 * Parse a unified session ID into its components.
 *
 * @param sessionId - The unified session ID to parse
 * @returns Parsed components with provider and native ID
 * @throws Error if the session ID format is invalid
 */
export function parseSessionId(sessionId: string): ParsedSessionId {
  if (!sessionId) {
    throw new Error('Session ID cannot be empty');
  }

  const colonIndex = sessionId.indexOf(':');

  if (colonIndex === -1) {
    throw new Error(`Invalid session ID format: "${sessionId}". Expected "{provider}:{nativeId}"`);
  }

  const provider = sessionId.slice(0, colonIndex);
  const nativeId = sessionId.slice(colonIndex + 1);

  if (!isValidProvider(provider)) {
    throw new Error(`Invalid provider in session ID: "${provider}". Expected "claude", "codex", or "opencode"`);
  }

  if (!nativeId) {
    throw new Error(`Invalid session ID: native ID is empty`);
  }

  return {
    provider: provider as AgentProvider,
    nativeId,
  };
}

/**
 * Check if a string is a valid provider name.
 */
function isValidProvider(value: string): value is AgentProvider {
  return value === 'claude' || value === 'codex' || value === 'opencode';
}

/**
 * Extract the provider from a session ID without full parsing.
 *
 * @param sessionId - The unified session ID
 * @returns The provider name
 * @throws Error if the provider cannot be extracted
 */
export function getProviderFromSessionId(sessionId: string): AgentProvider {
  const colonIndex = sessionId.indexOf(':');

  if (colonIndex === -1) {
    throw new Error(`Invalid session ID format: "${sessionId}"`);
  }

  const provider = sessionId.slice(0, colonIndex);

  if (!isValidProvider(provider)) {
    throw new Error(`Invalid provider in session ID: "${provider}"`);
  }

  return provider;
}

/**
 * Generate a temporary session ID for sessions that haven't received
 * their native ID yet.
 *
 * @param provider - The agent provider
 * @returns A temporary session ID
 */
export function createPendingSessionId(provider: AgentProvider): string {
  return `${provider}:pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Check if a session ID is a pending/temporary ID.
 *
 * @param sessionId - The session ID to check
 * @returns True if this is a pending session ID
 */
export function isPendingSessionId(sessionId: string): boolean {
  const { nativeId } = parseSessionId(sessionId);
  return nativeId.startsWith('pending-');
}
