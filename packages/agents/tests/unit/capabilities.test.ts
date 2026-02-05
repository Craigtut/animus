/**
 * Tests for capability constants.
 */

import { describe, it, expect } from 'vitest';
import {
  CLAUDE_CAPABILITIES,
  CODEX_CAPABILITIES,
  OPENCODE_CAPABILITIES,
  getCapabilities,
  hasCapability,
} from '../../src/capabilities.js';

describe('CLAUDE_CAPABILITIES', () => {
  it('supports cancellation', () => {
    expect(CLAUDE_CAPABILITIES.canCancel).toBe(true);
  });

  it('supports blocking in pre-tool-use hooks', () => {
    expect(CLAUDE_CAPABILITIES.canBlockInPreToolUse).toBe(true);
  });

  it('supports modifying tool input', () => {
    expect(CLAUDE_CAPABILITIES.canModifyToolInput).toBe(true);
  });

  it('supports subagents', () => {
    expect(CLAUDE_CAPABILITIES.supportsSubagents).toBe(true);
  });

  it('supports thinking', () => {
    expect(CLAUDE_CAPABILITIES.supportsThinking).toBe(true);
  });

  it('supports session forking', () => {
    expect(CLAUDE_CAPABILITIES.supportsFork).toBe(true);
  });

  it('has supported models', () => {
    expect(CLAUDE_CAPABILITIES.supportedModels.length).toBeGreaterThan(0);
    expect(CLAUDE_CAPABILITIES.supportedModels).toContain('claude-sonnet-4-5-20250514');
  });
});

describe('CODEX_CAPABILITIES', () => {
  it('does NOT support cancellation', () => {
    expect(CODEX_CAPABILITIES.canCancel).toBe(false);
  });

  it('does NOT support blocking in pre-tool-use hooks', () => {
    expect(CODEX_CAPABILITIES.canBlockInPreToolUse).toBe(false);
  });

  it('does NOT support modifying tool input', () => {
    expect(CODEX_CAPABILITIES.canModifyToolInput).toBe(false);
  });

  it('does NOT support subagents natively', () => {
    expect(CODEX_CAPABILITIES.supportsSubagents).toBe(false);
  });

  it('supports thinking via reasoning items', () => {
    expect(CODEX_CAPABILITIES.supportsThinking).toBe(true);
  });

  it('does NOT support session forking', () => {
    expect(CODEX_CAPABILITIES.supportsFork).toBe(false);
  });

  it('has supported models', () => {
    expect(CODEX_CAPABILITIES.supportedModels.length).toBeGreaterThan(0);
  });
});

describe('OPENCODE_CAPABILITIES', () => {
  it('supports cancellation', () => {
    expect(OPENCODE_CAPABILITIES.canCancel).toBe(true);
  });

  it('does NOT support blocking in pre-tool-use hooks', () => {
    expect(OPENCODE_CAPABILITIES.canBlockInPreToolUse).toBe(false);
  });

  it('supports modifying tool input', () => {
    expect(OPENCODE_CAPABILITIES.canModifyToolInput).toBe(true);
  });

  it('supports subagents via @mentions', () => {
    expect(OPENCODE_CAPABILITIES.supportsSubagents).toBe(true);
  });

  it('supports thinking via reasoning parts', () => {
    expect(OPENCODE_CAPABILITIES.supportsThinking).toBe(true);
  });

  it('does NOT support session forking', () => {
    expect(OPENCODE_CAPABILITIES.supportsFork).toBe(false);
  });

  it('has supported models', () => {
    expect(OPENCODE_CAPABILITIES.supportedModels.length).toBeGreaterThan(0);
  });
});

describe('getCapabilities', () => {
  it('returns Claude capabilities', () => {
    expect(getCapabilities('claude')).toBe(CLAUDE_CAPABILITIES);
  });

  it('returns Codex capabilities', () => {
    expect(getCapabilities('codex')).toBe(CODEX_CAPABILITIES);
  });

  it('returns OpenCode capabilities', () => {
    expect(getCapabilities('opencode')).toBe(OPENCODE_CAPABILITIES);
  });
});

describe('hasCapability', () => {
  it('returns true for supported boolean capability', () => {
    expect(hasCapability('claude', 'canCancel')).toBe(true);
  });

  it('returns false for unsupported boolean capability', () => {
    expect(hasCapability('codex', 'canCancel')).toBe(false);
  });

  it('returns true for non-empty array capability', () => {
    expect(hasCapability('claude', 'supportedModels')).toBe(true);
  });

  it('handles null maxConcurrentSessions', () => {
    // null means unlimited, hasCapability returns false for null
    // (because it's asking "does this capability have a limit?")
    expect(hasCapability('claude', 'maxConcurrentSessions')).toBe(false);
  });
});
