/**
 * Tests for CLI path resolution module.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock node:fs
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

// Mock node:child_process
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

// Mock node:module
vi.mock('node:module', () => ({
  createRequire: vi.fn(),
}));

// Mock logger
vi.mock('../../src/lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  resolveClaudeCliPaths,
  resolveCodexCliPaths,
  getClaudeNativeBinary,
  getClaudeNativeBinaryAsync,
  getCodexBundledBinary,
  checkSdkAvailable,
  _resetCache,
} from '../../src/lib/cli-paths.js';

const mockExistsSync = vi.mocked(existsSync);
const mockExecFile = vi.mocked(execFile);
const mockCreateRequire = vi.mocked(createRequire);

describe('cli-paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetCache();
  });

  describe('resolveClaudeCliPaths', () => {
    it('should find bundled cli.js when SDK is installed', () => {
      const mockRequire = {
        resolve: vi.fn().mockReturnValue('/project/node_modules/@anthropic-ai/claude-agent-sdk/package.json'),
      };
      mockCreateRequire.mockReturnValue(mockRequire as unknown as NodeRequire);
      mockExistsSync.mockImplementation((p) => {
        if (String(p).endsWith('cli.js')) return true;
        return false;
      });

      const result = resolveClaudeCliPaths();

      expect(result.bundledCliJs).toBe(
        '/project/node_modules/@anthropic-ai/claude-agent-sdk/cli.js'
      );
    });

    it('should return null for bundledCliJs when SDK is not installed', () => {
      const mockRequire = {
        resolve: vi.fn().mockImplementation(() => {
          throw new Error('Cannot find module');
        }),
      };
      mockCreateRequire.mockReturnValue(mockRequire as unknown as NodeRequire);
      mockExistsSync.mockReturnValue(false);

      const result = resolveClaudeCliPaths();

      expect(result.bundledCliJs).toBeNull();
    });

    it('should find native binary in well-known paths', () => {
      const mockRequire = {
        resolve: vi.fn().mockImplementation(() => {
          throw new Error('Cannot find module');
        }),
      };
      mockCreateRequire.mockReturnValue(mockRequire as unknown as NodeRequire);

      mockExistsSync.mockImplementation((p) => {
        const pathStr = String(p);
        if (pathStr.includes('.local/bin/claude')) return true;
        return false;
      });

      const result = resolveClaudeCliPaths();

      expect(result.nativeBinary).toContain('.local/bin/claude');
    });

    it('should return null for nativeBinary when not found in well-known paths', () => {
      const mockRequire = {
        resolve: vi.fn().mockImplementation(() => {
          throw new Error('Cannot find module');
        }),
      };
      mockCreateRequire.mockReturnValue(mockRequire as unknown as NodeRequire);
      mockExistsSync.mockReturnValue(false);

      const result = resolveClaudeCliPaths();

      expect(result.nativeBinary).toBeNull();
    });

    it('should cache results on subsequent calls', () => {
      const mockRequire = {
        resolve: vi.fn().mockImplementation(() => {
          throw new Error('Cannot find module');
        }),
      };
      mockCreateRequire.mockReturnValue(mockRequire as unknown as NodeRequire);
      mockExistsSync.mockReturnValue(false);

      const first = resolveClaudeCliPaths();
      const second = resolveClaudeCliPaths();

      expect(first).toBe(second); // Same reference (cached)
      expect(mockCreateRequire).toHaveBeenCalledTimes(1); // Only called once
    });

    it('should return fresh results after _resetCache', () => {
      const mockRequire = {
        resolve: vi.fn().mockImplementation(() => {
          throw new Error('Cannot find module');
        }),
      };
      mockCreateRequire.mockReturnValue(mockRequire as unknown as NodeRequire);
      mockExistsSync.mockReturnValue(false);

      resolveClaudeCliPaths();
      _resetCache();
      resolveClaudeCliPaths();

      expect(mockCreateRequire).toHaveBeenCalledTimes(2);
    });
  });

  describe('getClaudeNativeBinaryAsync', () => {
    it('should return cached native binary without calling which', async () => {
      const mockRequire = {
        resolve: vi.fn().mockImplementation(() => {
          throw new Error('Cannot find module');
        }),
      };
      mockCreateRequire.mockReturnValue(mockRequire as unknown as NodeRequire);

      mockExistsSync.mockImplementation((p) => {
        if (String(p).includes('.local/bin/claude')) return true;
        return false;
      });

      const result = await getClaudeNativeBinaryAsync();

      expect(result).toContain('.local/bin/claude');
      expect(mockExecFile).not.toHaveBeenCalled();
    });

    it('should fall back to which when not found in well-known paths', async () => {
      const mockRequire = {
        resolve: vi.fn().mockImplementation(() => {
          throw new Error('Cannot find module');
        }),
      };
      mockCreateRequire.mockReturnValue(mockRequire as unknown as NodeRequire);
      mockExistsSync.mockReturnValue(false);

      mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
        if (typeof callback === 'function') {
          callback(null, '/custom/path/claude\n', '');
        }
        return {} as ReturnType<typeof execFile>;
      });

      const result = await getClaudeNativeBinaryAsync();

      expect(result).toBe('/custom/path/claude');
    });

    it('should return null when which also fails', async () => {
      const mockRequire = {
        resolve: vi.fn().mockImplementation(() => {
          throw new Error('Cannot find module');
        }),
      };
      mockCreateRequire.mockReturnValue(mockRequire as unknown as NodeRequire);
      mockExistsSync.mockReturnValue(false);

      mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
        if (typeof callback === 'function') {
          callback(new Error('not found'), '', '');
        }
        return {} as ReturnType<typeof execFile>;
      });

      const result = await getClaudeNativeBinaryAsync();

      expect(result).toBeNull();
    });
  });

  describe('getClaudeNativeBinary', () => {
    it('should return synchronous result from well-known paths', () => {
      const mockRequire = {
        resolve: vi.fn().mockImplementation(() => {
          throw new Error('Cannot find module');
        }),
      };
      mockCreateRequire.mockReturnValue(mockRequire as unknown as NodeRequire);

      mockExistsSync.mockImplementation((p) => {
        if (String(p).includes('/usr/local/bin/claude')) return true;
        return false;
      });

      expect(getClaudeNativeBinary()).toBe('/usr/local/bin/claude');
    });
  });

  describe('resolveCodexCliPaths', () => {
    function mockCodexRequire(searchPaths: string[]) {
      const resolveFn = vi.fn() as ReturnType<typeof vi.fn> & { paths: ReturnType<typeof vi.fn> };
      resolveFn.paths = vi.fn().mockReturnValue(searchPaths);
      const mockRequire = { resolve: resolveFn };
      mockCreateRequire.mockReturnValue(mockRequire as unknown as NodeRequire);
    }

    it('should find bundled binary when SDK is installed', () => {
      mockCodexRequire(['/project/node_modules']);

      mockExistsSync.mockImplementation((p) => {
        const pathStr = String(p);
        // Match the package.json check for finding the SDK directory
        if (pathStr === '/project/node_modules/@openai/codex-sdk/package.json') return true;
        // Match the vendor binary check
        if (pathStr.includes('vendor/') && pathStr.endsWith('/codex/codex')) return true;
        return false;
      });

      const result = resolveCodexCliPaths();

      expect(result.bundledBinary).toBeTruthy();
      expect(result.bundledBinary).toContain('vendor/');
    });

    it('should return null when SDK is not installed', () => {
      mockCodexRequire(['/project/node_modules']);
      mockExistsSync.mockReturnValue(false);

      const result = resolveCodexCliPaths();

      expect(result.bundledBinary).toBeNull();
    });

    it('should cache results on subsequent calls', () => {
      mockCodexRequire(['/project/node_modules']);
      mockExistsSync.mockReturnValue(false);

      const first = resolveCodexCliPaths();
      const second = resolveCodexCliPaths();

      expect(first).toBe(second);
      expect(mockCreateRequire).toHaveBeenCalledTimes(1);
    });
  });

  describe('getCodexBundledBinary', () => {
    it('should return the bundled binary path', () => {
      const resolveFn = vi.fn() as ReturnType<typeof vi.fn> & { paths: ReturnType<typeof vi.fn> };
      resolveFn.paths = vi.fn().mockReturnValue(['/project/node_modules']);
      mockCreateRequire.mockReturnValue({ resolve: resolveFn } as unknown as NodeRequire);

      mockExistsSync.mockImplementation((p) => {
        const pathStr = String(p);
        if (pathStr === '/project/node_modules/@openai/codex-sdk/package.json') return true;
        if (pathStr.includes('vendor/') && (pathStr.endsWith('/codex/codex') || pathStr.endsWith('/codex/codex.exe'))) return true;
        return false;
      });

      const result = getCodexBundledBinary();

      expect(result).toBeTruthy();
    });
  });

  describe('checkSdkAvailable', () => {
    it('should return true for claude when SDK cli.js exists', () => {
      const mockRequire = {
        resolve: vi.fn().mockReturnValue('/project/node_modules/@anthropic-ai/claude-agent-sdk/package.json'),
      };
      mockCreateRequire.mockReturnValue(mockRequire as unknown as NodeRequire);
      mockExistsSync.mockImplementation((p) => {
        if (String(p).endsWith('cli.js')) return true;
        return false;
      });

      expect(checkSdkAvailable('claude')).toBe(true);
    });

    it('should return false for claude when SDK is missing', () => {
      const mockRequire = {
        resolve: vi.fn().mockImplementation(() => {
          throw new Error('Cannot find module');
        }),
      };
      mockCreateRequire.mockReturnValue(mockRequire as unknown as NodeRequire);
      mockExistsSync.mockReturnValue(false);

      expect(checkSdkAvailable('claude')).toBe(false);
    });

    it('should return true for codex when bundled binary exists', () => {
      const resolveFn = vi.fn() as ReturnType<typeof vi.fn> & { paths: ReturnType<typeof vi.fn> };
      resolveFn.paths = vi.fn().mockReturnValue(['/project/node_modules']);
      // Claude tests also call createRequire, so set up both
      resolveFn.mockImplementation((spec: string) => {
        if (spec.includes('claude-agent-sdk')) throw new Error('Not found');
        throw new Error('Not found');
      });
      mockCreateRequire.mockReturnValue({ resolve: resolveFn } as unknown as NodeRequire);

      mockExistsSync.mockImplementation((p) => {
        const pathStr = String(p);
        if (pathStr === '/project/node_modules/@openai/codex-sdk/package.json') return true;
        if (pathStr.includes('vendor/') && (pathStr.endsWith('/codex/codex') || pathStr.endsWith('/codex/codex.exe'))) return true;
        return false;
      });

      expect(checkSdkAvailable('codex')).toBe(true);
    });

    it('should return false for codex when SDK is missing', () => {
      const resolveFn = vi.fn() as ReturnType<typeof vi.fn> & { paths: ReturnType<typeof vi.fn> };
      resolveFn.paths = vi.fn().mockReturnValue(['/project/node_modules']);
      resolveFn.mockImplementation(() => { throw new Error('Not found'); });
      mockCreateRequire.mockReturnValue({ resolve: resolveFn } as unknown as NodeRequire);
      mockExistsSync.mockReturnValue(false);

      expect(checkSdkAvailable('codex')).toBe(false);
    });
  });
});
