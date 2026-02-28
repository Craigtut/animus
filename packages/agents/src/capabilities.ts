/**
 * Capability constants for each provider.
 *
 * These define what features each SDK supports, allowing consumers
 * to query capabilities before using them.
 */

import type { AdapterCapabilities } from './types.js';

/**
 * Claude Agent SDK capabilities.
 *
 * Claude has the most comprehensive feature set:
 * - Full pre-execution hook support (can block and modify)
 * - Native subagent support via Task tool
 * - Session forking
 * - Extended thinking mode
 */
export const CLAUDE_CAPABILITIES: AdapterCapabilities = {
  canCancel: true,
  canBlockInPreToolUse: true,
  canModifyToolInput: true,
  supportsSubagents: true,
  supportsThinking: true,
  supportsVision: true,
  supportsStreaming: true,
  supportsResume: true,
  supportsFork: true,
  maxConcurrentSessions: null,
  supportedModels: [
    // Latest models
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-sonnet-4-5-20250929',
    'claude-haiku-4-5-20251001',
    // Previous generation
    'claude-opus-4-5-20251101',
    'claude-opus-4-1-20250805',
    'claude-sonnet-4-20250514',
    'claude-opus-4-20250514',
    'claude-3-7-sonnet-20250219',
    // Legacy models
    'claude-3-5-haiku-20241022',
    'claude-3-haiku-20240307',
  ],
};

/**
 * OpenAI Codex capabilities via App Server Protocol.
 *
 * Uses the `codex app-server` JSON-RPC protocol for a long-lived process,
 * enabling features not available through the per-turn SDK approach:
 * - Cancel via `turn/interrupt`
 * - Pre-execution blocking via approval request/response
 * - Session forking via `thread/fork`
 * - Mid-turn injection via `turn/steer`
 *
 * Remaining limitations:
 * - No input modification in pre-tool hooks (approval is accept/decline)
 * - No native subagent support (requires separate Agents SDK)
 */
export const CODEX_CAPABILITIES: AdapterCapabilities = {
  canCancel: true, // Via turn/interrupt
  canBlockInPreToolUse: true, // Via approval request/response
  canModifyToolInput: false, // Approval is accept/decline only
  supportsSubagents: false, // Requires separate Agents SDK
  supportsThinking: true, // Via reasoning items
  supportsVision: true,
  supportsStreaming: true,
  supportsResume: true,
  supportsFork: true, // Via thread/fork
  maxConcurrentSessions: null,
  supportedModels: [
    // Latest Codex models
    'gpt-5.3-codex',
    'gpt-5.2-codex',
    'gpt-5.1-codex',
    'gpt-5.1-codex-max',
    'gpt-5.1-codex-mini',
    'codex-mini-latest', // Default in Codex CLI
    // Frontier models
    'gpt-5.2',
    // Reasoning models
    'o3',
    'o4-mini',
    // GPT models
    'gpt-4.1',
    'gpt-4.1-mini',
  ],
};

/**
 * OpenCode SDK capabilities.
 *
 * Good feature support with client/server architecture:
 * - Can cancel via session.abort()
 * - Hooks can modify input but cannot block
 * - Subagent support via @mentions
 */
export const OPENCODE_CAPABILITIES: AdapterCapabilities = {
  canCancel: true,
  canBlockInPreToolUse: false, // Plugin hooks cannot block execution
  canModifyToolInput: true, // Plugin hooks can modify args
  supportsSubagents: true, // Via @mentions
  supportsThinking: true, // Via reasoning parts
  supportsVision: true,
  supportsStreaming: true,
  supportsResume: true,
  supportsFork: false,
  maxConcurrentSessions: null,
  // OpenCode supports 75+ providers - this is the subset we test with
  supportedModels: [
    'anthropic/claude-sonnet-4-5',
    'anthropic/claude-3-5-sonnet-20241022',
    'openai/gpt-4o',
    'openai/gpt-4-turbo',
    'google/gemini-2.0-flash',
  ],
};

/**
 * Get capabilities for a specific provider.
 */
export function getCapabilities(provider: 'claude' | 'codex' | 'opencode'): AdapterCapabilities {
  switch (provider) {
    case 'claude':
      return CLAUDE_CAPABILITIES;
    case 'codex':
      return CODEX_CAPABILITIES;
    case 'opencode':
      return OPENCODE_CAPABILITIES;
  }
}

/**
 * Check if a provider supports a specific capability.
 */
export function hasCapability(
  provider: 'claude' | 'codex' | 'opencode',
  capability: keyof AdapterCapabilities,
): boolean {
  const caps = getCapabilities(provider);
  const value = caps[capability];

  // Boolean capabilities
  if (typeof value === 'boolean') {
    return value;
  }

  // maxConcurrentSessions: null means unlimited (truthy)
  // Array capabilities: non-empty means supported
  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return value !== null;
}
