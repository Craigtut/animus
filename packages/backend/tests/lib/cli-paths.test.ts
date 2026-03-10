/**
 * Tests for CLI path resolution module.
 *
 * This is a thin re-export from @animus-labs/agents. These tests verify
 * the re-export wiring and the async wrapper.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the agents package exports
vi.mock('@animus-labs/agents', () => ({
  resolveClaudeCliPaths: vi.fn().mockReturnValue({ bundledCliJs: null, nativeBinary: null }),
  getClaudeNativeBinary: vi.fn().mockReturnValue(null),
  resolveCodexCliPaths: vi.fn().mockReturnValue({ bundledBinary: null }),
  getCodexBundledBinary: vi.fn().mockReturnValue(null),
  checkSdkAvailable: vi.fn().mockReturnValue(false),
  _resetSdkCache: vi.fn(),
}));

import {
  resolveClaudeCliPaths,
  resolveCodexCliPaths,
  getClaudeNativeBinary,
  getClaudeNativeBinaryAsync,
  getCodexBundledBinary,
  checkSdkAvailable,
  _resetCache,
} from '../../src/lib/cli-paths.js';

import {
  resolveClaudeCliPaths as agentResolveClaudeCliPaths,
  getClaudeNativeBinary as agentGetNativeBinary,
  resolveCodexCliPaths as agentResolveCodexCliPaths,
  getCodexBundledBinary as agentGetCodexBinary,
  checkSdkAvailable as agentCheckSdkAvailable,
  _resetSdkCache,
} from '@animus-labs/agents';

describe('cli-paths (re-exports from @animus-labs/agents)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('resolveClaudeCliPaths', () => {
    it('should delegate to agents package', () => {
      const expected = { bundledCliJs: '/some/cli.js', nativeBinary: '/some/claude' };
      vi.mocked(agentResolveClaudeCliPaths).mockReturnValue(expected);

      const result = resolveClaudeCliPaths();

      expect(result).toBe(expected);
      expect(agentResolveClaudeCliPaths).toHaveBeenCalled();
    });
  });

  describe('getClaudeNativeBinary', () => {
    it('should delegate to agents package', () => {
      vi.mocked(agentGetNativeBinary).mockReturnValue('/data/sdks/claude/claude/versions/1.0/claude');

      const result = getClaudeNativeBinary();

      expect(result).toBe('/data/sdks/claude/claude/versions/1.0/claude');
    });

    it('should return null when native binary not found', () => {
      vi.mocked(agentGetNativeBinary).mockReturnValue(null);

      expect(getClaudeNativeBinary()).toBeNull();
    });
  });

  describe('getClaudeNativeBinaryAsync', () => {
    it('should return the same result as the sync version', async () => {
      vi.mocked(agentGetNativeBinary).mockReturnValue('/data/sdks/claude/claude/versions/1.0/claude');

      const result = await getClaudeNativeBinaryAsync();

      expect(result).toBe('/data/sdks/claude/claude/versions/1.0/claude');
    });

    it('should return null when native binary not found', async () => {
      vi.mocked(agentGetNativeBinary).mockReturnValue(null);

      const result = await getClaudeNativeBinaryAsync();

      expect(result).toBeNull();
    });
  });

  describe('resolveCodexCliPaths', () => {
    it('should delegate to agents package', () => {
      const expected = { bundledBinary: '/some/codex' };
      vi.mocked(agentResolveCodexCliPaths).mockReturnValue(expected);

      const result = resolveCodexCliPaths();

      expect(result).toBe(expected);
    });
  });

  describe('getCodexBundledBinary', () => {
    it('should delegate to agents package', () => {
      vi.mocked(agentGetCodexBinary).mockReturnValue('/some/codex');

      expect(getCodexBundledBinary()).toBe('/some/codex');
    });
  });

  describe('checkSdkAvailable', () => {
    it('should delegate to agents package for claude', () => {
      vi.mocked(agentCheckSdkAvailable).mockReturnValue(true);

      expect(checkSdkAvailable('claude')).toBe(true);
      expect(agentCheckSdkAvailable).toHaveBeenCalledWith('claude');
    });

    it('should delegate to agents package for codex', () => {
      vi.mocked(agentCheckSdkAvailable).mockReturnValue(false);

      expect(checkSdkAvailable('codex')).toBe(false);
      expect(agentCheckSdkAvailable).toHaveBeenCalledWith('codex');
    });
  });

  describe('_resetCache', () => {
    it('should delegate to _resetSdkCache from agents package', () => {
      _resetCache();

      expect(_resetSdkCache).toHaveBeenCalled();
    });
  });
});
