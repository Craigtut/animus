/**
 * Tool Registry Tests
 */

import { describe, it, expect } from 'vitest';
import {
  ANIMUS_TOOL_DEFS,
  getAllowedTools,
  isToolAllowed,
  TOOL_PERMISSIONS,
} from '@animus/shared';
import { getToolsForTier, getTool, getToolNames, executeTool } from '../../src/tools/registry.js';
import type { ToolHandlerContext } from '../../src/tools/types.js';

// ============================================================================
// Shared Definitions Tests
// ============================================================================

describe('Tool Definitions', () => {
  it('should have 3 tool definitions', () => {
    expect(Object.keys(ANIMUS_TOOL_DEFS)).toHaveLength(3);
  });

  it('should define send_message', () => {
    expect(ANIMUS_TOOL_DEFS.send_message.name).toBe('send_message');
    expect(ANIMUS_TOOL_DEFS.send_message.category).toBe('messaging');
  });

  it('should define update_progress', () => {
    expect(ANIMUS_TOOL_DEFS.update_progress.name).toBe('update_progress');
    expect(ANIMUS_TOOL_DEFS.update_progress.category).toBe('progress');
  });

  it('should define read_memory', () => {
    expect(ANIMUS_TOOL_DEFS.read_memory.name).toBe('read_memory');
    expect(ANIMUS_TOOL_DEFS.read_memory.category).toBe('memory');
  });
});

// ============================================================================
// Permission Tests
// ============================================================================

describe('Tool Permissions', () => {
  it('should allow all tools for primary tier', () => {
    const allowed = getAllowedTools('primary');
    expect(allowed).toContain('send_message');
    expect(allowed).toContain('update_progress');
    expect(allowed).toContain('read_memory');
    expect(allowed).toHaveLength(3);
  });

  it('should restrict tools for standard tier', () => {
    const allowed = getAllowedTools('standard');
    expect(allowed).toContain('send_message');
    expect(allowed).toContain('read_memory');
    expect(allowed).not.toContain('update_progress');
    expect(allowed).toHaveLength(2);
  });

  it('isToolAllowed should work correctly', () => {
    expect(isToolAllowed('send_message', 'primary')).toBe(true);
    expect(isToolAllowed('update_progress', 'primary')).toBe(true);
    expect(isToolAllowed('update_progress', 'standard')).toBe(false);
    expect(isToolAllowed('read_memory', 'standard')).toBe(true);
  });
});

// ============================================================================
// Registry Tests
// ============================================================================

describe('Tool Registry', () => {
  it('should return all tool names', () => {
    const names = getToolNames();
    expect(names).toEqual(['send_message', 'update_progress', 'read_memory']);
  });

  it('should get a tool by name', () => {
    const tool = getTool('send_message');
    expect(tool).toBeDefined();
    expect(tool!.name).toBe('send_message');
    expect(tool!.handler).toBeTypeOf('function');
  });

  it('should return undefined for unknown tool', () => {
    const tool = getTool('nonexistent' as any);
    expect(tool).toBeUndefined();
  });

  it('should filter tools by tier', () => {
    const primaryTools = getToolsForTier('primary');
    expect(primaryTools).toHaveLength(3);

    const standardTools = getToolsForTier('standard');
    expect(standardTools).toHaveLength(2);
    expect(standardTools.map((t) => t.name)).not.toContain('update_progress');
  });
});

// ============================================================================
// Handler Execution Tests
// ============================================================================

function createMockContext(overrides?: Partial<ToolHandlerContext>): ToolHandlerContext {
  return {
    agentTaskId: 'task-1',
    contactId: 'contact-1',
    sourceChannel: 'web',
    conversationId: 'conv-1',
    stores: {
      messages: {
        createMessage: () => ({ id: 'msg-1' }),
      },
      heartbeat: {
        updateAgentTaskProgress: () => {},
      },
      memory: {
        retrieveRelevant: async () => [],
      },
    },
    eventBus: {
      on: () => {},
      off: () => {},
      emit: () => {},
      once: () => {},
    },
    ...overrides,
  };
}

describe('Tool Handlers', () => {
  describe('send_message', () => {
    it('should send a message and return success', async () => {
      const ctx = createMockContext();
      const result = await executeTool(
        'send_message',
        { content: 'Hello!', priority: 'normal' },
        ctx
      );
      expect(result.isError).toBeFalsy();
      expect(result.content[0]!.text).toContain('Message sent successfully');
    });

    it('should validate input schema', async () => {
      const ctx = createMockContext();
      const result = await executeTool('send_message', { invalid: true }, ctx);
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('Tool error');
    });
  });

  describe('update_progress', () => {
    it('should update progress and return success', async () => {
      const ctx = createMockContext();
      const result = await executeTool(
        'update_progress',
        { activity: 'Researching...', percentComplete: 50 },
        ctx
      );
      expect(result.isError).toBeFalsy();
      expect(result.content[0]!.text).toBe('Progress updated.');
    });
  });

  describe('read_memory', () => {
    it('should return no memories when empty', async () => {
      const ctx = createMockContext();
      const result = await executeTool(
        'read_memory',
        { query: 'test query', limit: 5 },
        ctx
      );
      expect(result.isError).toBeFalsy();
      expect(result.content[0]!.text).toContain('No relevant memories');
    });

    it('should format returned memories', async () => {
      const ctx = createMockContext({
        stores: {
          messages: { createMessage: () => ({ id: 'msg-1' }) },
          heartbeat: {},
          memory: {
            retrieveRelevant: async () => [
              { content: 'User likes coffee', memoryType: 'fact', importance: 0.8 },
              { content: 'We debugged React', memoryType: 'experience', importance: 0.6 },
            ],
          },
        },
      });
      const result = await executeTool(
        'read_memory',
        { query: 'preferences', limit: 5 },
        ctx
      );
      expect(result.isError).toBeFalsy();
      expect(result.content[0]!.text).toContain('Found 2 relevant memories');
      expect(result.content[0]!.text).toContain('User likes coffee');
    });

    it('should filter by memory type', async () => {
      const ctx = createMockContext({
        stores: {
          messages: { createMessage: () => ({ id: 'msg-1' }) },
          heartbeat: {},
          memory: {
            retrieveRelevant: async () => [
              { content: 'User likes coffee', memoryType: 'fact', importance: 0.8 },
              { content: 'We debugged React', memoryType: 'experience', importance: 0.6 },
            ],
          },
        },
      });
      const result = await executeTool(
        'read_memory',
        { query: 'test', limit: 5, types: ['fact'] },
        ctx
      );
      expect(result.content[0]!.text).toContain('Found 1 relevant memories');
      expect(result.content[0]!.text).toContain('User likes coffee');
      expect(result.content[0]!.text).not.toContain('debugged React');
    });
  });

  describe('executeTool', () => {
    it('should return error for unknown tool', async () => {
      const ctx = createMockContext();
      const result = await executeTool('nonexistent' as any, {}, ctx);
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('Unknown tool');
    });
  });
});
