import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSubAgentTool, SUB_AGENT_TOOL_NAME } from '../../../src/tools/sub-agent.js';
import type { SubAgentToolConfig } from '../../../src/tools/sub-agent.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockConfig(overrides?: Partial<SubAgentToolConfig>): SubAgentToolConfig {
  return {
    spawnSubAgent: overrides?.spawnSubAgent ?? vi.fn().mockResolvedValue({
      taskId: 'task-123',
      output: 'Sub-agent result text',
      status: 'completed',
      usage: { turns: 3, cost: 0.05, durationMs: 5000 },
    }),
    spawnBackgroundSubAgent: overrides?.spawnBackgroundSubAgent ?? vi.fn().mockResolvedValue({
      taskId: 'bg-task-456',
    }),
    canSpawn: overrides?.canSpawn ?? vi.fn().mockReturnValue(true),
    getConcurrencyInfo: overrides?.getConcurrencyInfo ?? vi.fn().mockReturnValue({ active: 1, limit: 4 }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SubAgent tool', () => {
  describe('metadata', () => {
    it('has the correct name', () => {
      const tool = createSubAgentTool(createMockConfig());
      expect(tool.name).toBe(SUB_AGENT_TOOL_NAME);
      expect(tool.name).toBe('SubAgent');
    });

    it('has a description', () => {
      const tool = createSubAgentTool(createMockConfig());
      expect(tool.description).toContain('sub-agent');
    });
  });

  describe('foreground mode (default)', () => {
    it('spawns a sub-agent and returns the result', async () => {
      const spawnSubAgent = vi.fn().mockResolvedValue({
        taskId: 'task-1',
        output: 'The analysis is complete.',
        status: 'completed',
        usage: { turns: 5, cost: 0.10, durationMs: 8000 },
      });

      const tool = createSubAgentTool(createMockConfig({ spawnSubAgent }));
      const result = await tool.execute({
        instructions: 'Analyze this codebase',
      });

      expect(spawnSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          instructions: 'Analyze this codebase',
        }),
      );

      const text = result as string;
      expect(text).toContain('completed successfully');
      expect(text).toContain('The analysis is complete.');
      expect(text).toContain('5 turns');
    });

    it('includes status for non-completed results', async () => {
      const spawnSubAgent = vi.fn().mockResolvedValue({
        taskId: 'task-1',
        output: '',
        status: 'failed',
        usage: { turns: 1, cost: 0.01, durationMs: 500 },
      });

      const tool = createSubAgentTool(createMockConfig({ spawnSubAgent }));
      const result = await tool.execute({ instructions: 'Do something' });

      const text = result as string;
      expect(text).toContain('status: failed');
    });

    it('handles empty output', async () => {
      const spawnSubAgent = vi.fn().mockResolvedValue({
        taskId: 'task-1',
        output: '',
        status: 'completed',
        usage: { turns: 1, cost: 0.01, durationMs: 100 },
      });

      const tool = createSubAgentTool(createMockConfig({ spawnSubAgent }));
      const result = await tool.execute({ instructions: 'Think quietly' });

      const text = result as string;
      expect(text).toContain('No output was produced');
    });
  });

  describe('background mode', () => {
    it('spawns a background sub-agent and returns task ID', async () => {
      const spawnBackgroundSubAgent = vi.fn().mockResolvedValue({
        taskId: 'bg-task-789',
      });

      const tool = createSubAgentTool(createMockConfig({ spawnBackgroundSubAgent }));
      const result = await tool.execute({
        instructions: 'Research this topic',
        background: true,
      });

      expect(spawnBackgroundSubAgent).toHaveBeenCalled();
      const text = result as string;
      expect(text).toContain('bg-task-789');
      expect(text).toContain('background');
    });
  });

  describe('concurrency limit', () => {
    it('returns error when limit is reached', async () => {
      const canSpawn = vi.fn().mockReturnValue(false);
      const getConcurrencyInfo = vi.fn().mockReturnValue({ active: 4, limit: 4 });

      const tool = createSubAgentTool(createMockConfig({
        canSpawn,
        getConcurrencyInfo,
      }));

      const result = await tool.execute({ instructions: 'Do something' });

      const text = result as string;
      expect(text).toContain('concurrency limit reached');
      expect(text).toContain('4/4');
    });
  });

  describe('parameter forwarding', () => {
    it('passes tools parameter to foreground spawn', async () => {
      const spawnSubAgent = vi.fn().mockResolvedValue({
        taskId: 'task-1',
        output: 'done',
        status: 'completed',
        usage: { turns: 1, cost: 0, durationMs: 100 },
      });

      const tool = createSubAgentTool(createMockConfig({ spawnSubAgent }));
      await tool.execute({
        instructions: 'Do something',
        tools: ['Read', 'Write'],
      });

      expect(spawnSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: ['Read', 'Write'],
        }),
      );
    });

    it('passes systemPrompt parameter', async () => {
      const spawnSubAgent = vi.fn().mockResolvedValue({
        taskId: 'task-1',
        output: 'done',
        status: 'completed',
        usage: { turns: 1, cost: 0, durationMs: 100 },
      });

      const tool = createSubAgentTool(createMockConfig({ spawnSubAgent }));
      await tool.execute({
        instructions: 'Custom context',
        systemPrompt: 'You are a specialized researcher.',
      });

      expect(spawnSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: 'You are a specialized researcher.',
        }),
      );
    });

    it('passes budget parameters', async () => {
      const spawnSubAgent = vi.fn().mockResolvedValue({
        taskId: 'task-1',
        output: 'done',
        status: 'completed',
        usage: { turns: 1, cost: 0, durationMs: 100 },
      });

      const tool = createSubAgentTool(createMockConfig({ spawnSubAgent }));
      await tool.execute({
        instructions: 'Quick task',
        maxTurns: 5,
        maxCost: 0.10,
      });

      expect(spawnSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          maxTurns: 5,
          maxCost: 0.10,
        }),
      );
    });
  });
});
