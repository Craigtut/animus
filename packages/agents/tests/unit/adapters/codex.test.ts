/**
 * Unit tests for the Codex adapter.
 *
 * Uses mocked App Server client to test adapter logic without requiring API keys.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CodexAdapter } from '../../../src/adapters/codex.js';
import { createSilentLogger } from '../../../src/logger.js';

// Mock the CodexAppServerClient
vi.mock('../../../src/adapters/codex-app-server.js', () => {
  const EventEmitter = require('node:events').EventEmitter;
  return {
    CodexAppServerClient: vi.fn().mockImplementation(() => {
      const emitter = new EventEmitter();
      return Object.assign(emitter, {
        isRunning: false,
        start: vi.fn().mockImplementation(async function(this: any) { this.isRunning = true; }),
        stop: vi.fn().mockImplementation(async function(this: any) { this.isRunning = false; }),
        threadStart: vi.fn().mockResolvedValue({ threadId: 'test-thread-123' }),
        threadResume: vi.fn().mockResolvedValue({ threadId: 'resumed-thread' }),
        threadFork: vi.fn().mockResolvedValue({ threadId: 'forked-thread' }),
        turnStart: vi.fn().mockResolvedValue({ turnId: 'test-turn-1' }),
        turnSteer: vi.fn().mockResolvedValue({ turnId: 'steered-turn' }),
        turnInterrupt: vi.fn().mockResolvedValue(undefined),
        sendApprovalResponse: vi.fn(),
        skillsList: vi.fn().mockResolvedValue([]),
        skillsConfigWrite: vi.fn().mockResolvedValue(true),
      });
    }),
  };
});

describe('CodexAdapter', () => {
  let adapter: CodexAdapter;

  beforeEach(() => {
    adapter = new CodexAdapter({ logger: createSilentLogger() });
  });

  describe('provider', () => {
    it('is codex', () => {
      expect(adapter.provider).toBe('codex');
    });
  });

  describe('capabilities', () => {
    it('supports cancellation via turn/interrupt', () => {
      expect(adapter.capabilities.canCancel).toBe(true);
    });

    it('supports blocking in pre-tool-use hooks via approval', () => {
      expect(adapter.capabilities.canBlockInPreToolUse).toBe(true);
    });

    it('does NOT support modifying tool input', () => {
      expect(adapter.capabilities.canModifyToolInput).toBe(false);
    });

    it('does NOT support subagents natively', () => {
      expect(adapter.capabilities.supportsSubagents).toBe(false);
    });

    it('supports session forking via thread/fork', () => {
      expect(adapter.capabilities.supportsFork).toBe(true);
    });

    it('supports streaming', () => {
      expect(adapter.capabilities.supportsStreaming).toBe(true);
    });

    it('supports thinking via reasoning items', () => {
      expect(adapter.capabilities.supportsThinking).toBe(true);
    });

    it('supports resume', () => {
      expect(adapter.capabilities.supportsResume).toBe(true);
    });
  });

  describe('isConfigured', () => {
    it('returns true when OPENAI_API_KEY is set', () => {
      const original = process.env['OPENAI_API_KEY'];
      process.env['OPENAI_API_KEY'] = 'test-key';

      try {
        expect(adapter.isConfigured()).toBe(true);
      } finally {
        if (original) {
          process.env['OPENAI_API_KEY'] = original;
        } else {
          delete process.env['OPENAI_API_KEY'];
        }
      }
    });
  });

  describe('createSession', () => {
    it('throws MISSING_CREDENTIALS when not configured', async () => {
      const origKey = process.env['OPENAI_API_KEY'];
      delete process.env['OPENAI_API_KEY'];

      const unconfiguredAdapter = new CodexAdapter({ logger: createSilentLogger() });

      try {
        if (!unconfiguredAdapter.isConfigured()) {
          await expect(
            unconfiguredAdapter.createSession({ provider: 'codex' }),
          ).rejects.toThrow('credentials not configured');
        }
      } finally {
        if (origKey) process.env['OPENAI_API_KEY'] = origKey;
      }
    });

    it('throws on invalid config', async () => {
      await expect(
        adapter.createSession({ provider: 'claude' as any }),
      ).rejects.toThrow();
    });
  });

  describe('resumeSession', () => {
    it('throws on provider mismatch', async () => {
      await expect(adapter.resumeSession('claude:some-id')).rejects.toThrow();
    });
  });

  describe('syncSkill', () => {
    it('returns false when app-server is not running', async () => {
      const result = await adapter.syncSkill('/some/path/skill', true);
      expect(result).toBe(false);
    });
  });

  describe('listSkills', () => {
    it('returns empty array when app-server is not running', async () => {
      const skills = await adapter.listSkills();
      expect(skills).toEqual([]);
    });
  });

  describe('listModels', () => {
    it('returns models from capabilities when no API key or app-server', async () => {
      const originalKey = process.env['OPENAI_API_KEY'];
      delete process.env['OPENAI_API_KEY'];

      try {
        const models = await adapter.listModels();
        expect(models.length).toBeGreaterThan(0);
        expect(models[0]).toHaveProperty('id');
        expect(models[0]).toHaveProperty('name');
        expect(models.some((m) => m.id.includes('codex'))).toBe(true);
      } finally {
        if (originalKey !== undefined) {
          process.env['OPENAI_API_KEY'] = originalKey;
        }
      }
    });

    it('calls OpenAI REST API when API key is set', async () => {
      const originalFetch = globalThis.fetch;
      const originalKey = process.env['OPENAI_API_KEY'];
      process.env['OPENAI_API_KEY'] = 'test-openai-key';

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'gpt-5.3-codex', name: 'GPT 5.3 Codex' },
            { id: 'o3', name: 'O3' },
            { id: 'dall-e-3', name: 'DALL-E 3' }, // should be filtered out
          ],
        }),
      });

      try {
        const models = await adapter.listModels();
        expect(models).toHaveLength(2);
        expect(models.some((m) => m.id === 'gpt-5.3-codex')).toBe(true);
        expect(models.some((m) => m.id === 'o3')).toBe(true);
        expect(models.some((m) => m.id === 'dall-e-3')).toBe(false);
        // OpenAI REST API has no recommendation signals
        expect(models[0].recommended).toBeUndefined();
      } finally {
        globalThis.fetch = originalFetch;
        if (originalKey !== undefined) {
          process.env['OPENAI_API_KEY'] = originalKey;
        } else {
          delete process.env['OPENAI_API_KEY'];
        }
      }
    });

    it('falls back to static list on OpenAI API error', async () => {
      const originalFetch = globalThis.fetch;
      const originalKey = process.env['OPENAI_API_KEY'];
      process.env['OPENAI_API_KEY'] = 'test-openai-key';

      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      try {
        const models = await adapter.listModels();
        expect(models.length).toBeGreaterThan(0);
        expect(models.some((m) => m.id.includes('codex'))).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
        if (originalKey !== undefined) {
          process.env['OPENAI_API_KEY'] = originalKey;
        } else {
          delete process.env['OPENAI_API_KEY'];
        }
      }
    });
  });
});
