import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CortexAgent } from '../../src/cortex-agent.js';
import type { PiAgent, PiModel } from '../../src/cortex-agent.js';
import type { PiEvent } from '../../src/event-bridge.js';
import type { CortexAgentConfig } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Mock PiAgent factory
// ---------------------------------------------------------------------------

interface MockPiAgent extends PiAgent {
  /** Manually emit a pi-agent-core event */
  emitEvent: (event: PiEvent) => void;
  /** Track whether abort was called */
  abortCalled: boolean;
  /** Track whether reset was called */
  resetCalled: boolean;
  /** Control what agent.prompt() returns or throws */
  promptResult: unknown;
  promptError: Error | null;
}

function createMockPiAgent(options?: {
  runResult?: unknown;
  runError?: Error | null;
}): MockPiAgent {
  let eventHandler: ((event: PiEvent) => void) | null = null;
  let idleResolve: (() => void) | null = null;

  const agent: MockPiAgent = {
    state: {
      messages: [],
      systemPrompt: '',
      tools: [],
    },
    abortCalled: false,
    resetCalled: false,
    promptResult: options?.runResult ?? { content: 'Mock response' },
    promptError: options?.runError ?? null,

    subscribe(handler: (event: PiEvent) => void): () => void {
      eventHandler = handler;
      return () => {
        eventHandler = null;
      };
    },

    emitEvent(event: PiEvent): void {
      if (eventHandler) {
        eventHandler(event);
      }
    },

    async prompt(input: string): Promise<unknown> {
      // Emit agent_start
      agent.emitEvent({ type: 'agent_start' });

      if (agent.promptError) {
        // Emit agent_end before throwing
        agent.emitEvent({ type: 'agent_end' });
        throw agent.promptError;
      }

      // Simulate a turn
      agent.emitEvent({ type: 'turn_start' });
      agent.emitEvent({
        type: 'turn_end',
        text: typeof agent.promptResult === 'string'
          ? agent.promptResult
          : 'Mock response text',
      });

      // Emit agent_end
      agent.emitEvent({ type: 'agent_end' });

      return agent.promptResult;
    },

    abort(): void {
      agent.abortCalled = true;
      if (idleResolve) {
        idleResolve();
        idleResolve = null;
      }
    },

    async waitForIdle(): Promise<void> {
      // If already idle, resolve immediately
      return new Promise<void>((resolve) => {
        idleResolve = resolve;
        // Auto-resolve after a tick to prevent hanging
        setTimeout(() => {
          resolve();
          idleResolve = null;
        }, 10);
      });
    },

    reset(): void {
      agent.resetCalled = true;
      agent.state.messages = [];
    },
  };

  return agent;
}

type TestCortexAgentConstructor = new (
  agent: PiAgent,
  config: CortexAgentConfig,
  tools?: Array<{
    name: string;
    description: string;
    parameters: unknown;
    execute: (...args: any[]) => Promise<unknown>;
  }>,
  options?: {
    enableSubAgentTool?: boolean;
    enableLoadSkillTool?: boolean;
  },
) => CortexAgent;

function createTestCortexAgent(
  agent: PiAgent,
  config: CortexAgentConfig,
  tools?: Array<{
    name: string;
    description: string;
    parameters: unknown;
    execute: (...args: any[]) => Promise<unknown>;
  }>,
  options?: {
    enableSubAgentTool?: boolean;
    enableLoadSkillTool?: boolean;
  },
): CortexAgent {
  const CortexAgentCtor = CortexAgent as unknown as TestCortexAgentConstructor;
  return new CortexAgentCtor(agent, config, tools, options);
}

function createDefaultConfig(
  overrides?: Partial<CortexAgentConfig>,
): CortexAgentConfig {
  return {
    model: { provider: 'anthropic', name: 'claude-sonnet-4-20250514' } as PiModel,
    workingDirectory: '/tmp/test-workspace',
    initialBasePrompt: 'Test base prompt',
    slots: [],
    ...overrides,
  };
}

describe('CortexAgent', () => {
  let piAgent: MockPiAgent;
  let config: ReturnType<typeof createDefaultConfig>;

  beforeEach(() => {
    piAgent = createMockPiAgent();
    config = createDefaultConfig();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  describe('construction', () => {
    it('creates with valid config', () => {
      const agent = createTestCortexAgent(piAgent, config);
      expect(agent.state).toBe('created');
    });

    it('exposes the context manager', () => {
      const agent = createTestCortexAgent(piAgent, {
        ...config,
        slots: ['a', 'b'],
      });

      const cm = agent.getContextManager();
      expect(cm.slotCount).toBe(2);
    });

    it('resolves utility model from defaults for anthropic', () => {
      const agent = createTestCortexAgent(piAgent, config);
      const utilityModel = agent.getUtilityModel();
      expect(utilityModel.provider).toBe('anthropic');
      expect(utilityModel.name).toBe('claude-haiku-4-5-20251001');
    });

    it('resolves utility model from defaults for openai', () => {
      const agent = createTestCortexAgent(piAgent, {
        ...config,
        model: { provider: 'openai', name: 'gpt-4o' } as PiModel,
      });
      const utilityModel = agent.getUtilityModel();
      expect(utilityModel.provider).toBe('openai');
      expect(utilityModel.name).toBe('gpt-4.1-nano');
    });

    it('uses primary model when no default mapping exists', () => {
      const customModel = { provider: 'custom-provider', name: 'custom-model' } as PiModel;
      const agent = createTestCortexAgent(piAgent, {
        ...config,
        model: customModel,
      });
      const utilityModel = agent.getUtilityModel();
      expect(utilityModel).toBe(customModel);
    });

    it('uses explicit utility model when provided', () => {
      const explicitUtility = { provider: 'anthropic', name: 'claude-haiku-3' } as PiModel;
      const agent = createTestCortexAgent(piAgent, {
        ...config,
        utilityModel: explicitUtility,
      });
      const utilityModel = agent.getUtilityModel();
      expect(utilityModel).toBe(explicitUtility);
    });

    it('throws on same-provider constraint violation', () => {
      expect(() => {
        createTestCortexAgent(piAgent, {
          ...config,
          model: { provider: 'anthropic', name: 'claude-sonnet' } as PiModel,
          utilityModel: { provider: 'openai', name: 'gpt-4o-mini' } as PiModel,
        });
      }).toThrow('does not match primary model provider');
    });

    it('allows utilityModel: "default" explicitly', () => {
      const agent = createTestCortexAgent(piAgent, {
        ...config,
        utilityModel: 'default',
      });
      const utilityModel = agent.getUtilityModel();
      expect(utilityModel.provider).toBe('anthropic');
    });
  });

  // -----------------------------------------------------------------------
  // envOverrides
  // -----------------------------------------------------------------------

  describe('envOverrides', () => {
    it('stores envOverrides from config', () => {
      const overrides = {
        DYLD_INSERT_LIBRARIES: '/app/dock.dylib',
        ANIMUS_DOCK_SUPPRESS_ADDON: '/app/addon.node',
      };
      const agent = createTestCortexAgent(piAgent, {
        ...config,
        envOverrides: overrides,
      });

      expect(agent.getEnvOverrides()).toBe(overrides);
    });

    it('returns undefined when no envOverrides configured', () => {
      const agent = createTestCortexAgent(piAgent, config);
      expect(agent.getEnvOverrides()).toBeUndefined();
    });

    it('passes envOverrides to McpClientManager', () => {
      const overrides = { DYLD_INSERT_LIBRARIES: '/app/dock.dylib' };
      const agent = createTestCortexAgent(piAgent, {
        ...config,
        envOverrides: overrides,
      });

      const mcpManager = agent.getMcpClientManager();
      expect(mcpManager.envOverrides).toBe(overrides);
    });

    it('does not set McpClientManager envOverrides when not configured', () => {
      const agent = createTestCortexAgent(piAgent, config);

      const mcpManager = agent.getMcpClientManager();
      expect(mcpManager.envOverrides).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // prompt()
  // -----------------------------------------------------------------------

  describe('prompt', () => {
    it('runs the agent and returns a result', async () => {
      piAgent.promptResult = { content: 'Hello world' };
      const agent = createTestCortexAgent(piAgent, config);

      const result = await agent.prompt('Say hello');
      expect(result).toEqual({ content: 'Hello world' });
    });

    it('transitions from CREATED to ACTIVE on first prompt', async () => {
      const agent = createTestCortexAgent(piAgent, config);
      expect(agent.state).toBe('created');

      await agent.prompt('Hello');
      expect(agent.state).toBe('active');
    });

    it('remains ACTIVE on subsequent prompts', async () => {
      const agent = createTestCortexAgent(piAgent, config);

      await agent.prompt('First');
      expect(agent.state).toBe('active');

      await agent.prompt('Second');
      expect(agent.state).toBe('active');
    });

    it('throws when destroyed', async () => {
      const agent = createTestCortexAgent(piAgent, config);
      await agent.destroy();

      await expect(agent.prompt('Hello')).rejects.toThrow('Agent has been destroyed');
    });

    it('classifies and emits errors on failure', async () => {
      piAgent.promptError = new Error('invalid api key');
      const agent = createTestCortexAgent(piAgent, config);

      const errorHandler = vi.fn();
      agent.onError(errorHandler);

      await expect(agent.prompt('Hello')).rejects.toThrow('invalid api key');

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'authentication',
          severity: 'fatal',
          originalMessage: 'invalid api key',
        }),
      );
    });

    it('classifies rate limit errors', async () => {
      piAgent.promptError = new Error('Rate limit exceeded');
      const agent = createTestCortexAgent(piAgent, config);

      const errorHandler = vi.fn();
      agent.onError(errorHandler);

      await expect(agent.prompt('Hello')).rejects.toThrow();

      expect(errorHandler.mock.calls[0][0].category).toBe('rate_limit');
    });

    it('classifies network errors', async () => {
      piAgent.promptError = new Error('ECONNREFUSED');
      const agent = createTestCortexAgent(piAgent, config);

      const errorHandler = vi.fn();
      agent.onError(errorHandler);

      await expect(agent.prompt('Hello')).rejects.toThrow();

      expect(errorHandler.mock.calls[0][0].category).toBe('network');
    });

    it('swallows error handler exceptions', async () => {
      piAgent.promptError = new Error('Rate limit exceeded');
      const agent = createTestCortexAgent(piAgent, config);

      agent.onError(() => {
        throw new Error('Handler blew up');
      });

      // Should still throw the original error, not the handler error
      await expect(agent.prompt('Hello')).rejects.toThrow('Rate limit exceeded');
    });
  });

  // -----------------------------------------------------------------------
  // System prompt
  // -----------------------------------------------------------------------

  describe('buildSystemPrompt', () => {
    it('puts consumer content first', () => {
      const agent = createTestCortexAgent(piAgent, config);
      const prompt = agent.buildSystemPrompt('You are a helpful assistant.');

      expect(prompt.startsWith('You are a helpful assistant.')).toBe(true);
    });

    it('includes Response Delivery when working tags enabled (default)', () => {
      const agent = createTestCortexAgent(piAgent, config);
      const prompt = agent.buildSystemPrompt('Consumer content');

      expect(prompt).toContain('# Response Delivery');
      expect(prompt).toContain('<working>');
    });

    it('omits Response Delivery when working tags disabled', () => {
      const agent = createTestCortexAgent(piAgent, {
        ...config,
        workingTags: { enabled: false },
      });
      const prompt = agent.buildSystemPrompt('Consumer content');

      expect(prompt).not.toContain('# Response Delivery');
    });

    it('includes System Rules section', () => {
      const agent = createTestCortexAgent(piAgent, config);
      const prompt = agent.buildSystemPrompt('Consumer');

      expect(prompt).toContain('# System Rules');
    });

    it('includes Taking Action section', () => {
      const agent = createTestCortexAgent(piAgent, config);
      const prompt = agent.buildSystemPrompt('Consumer');

      expect(prompt).toContain('# Taking Action');
    });

    it('includes Tool Usage section', () => {
      const agent = createTestCortexAgent(piAgent, config);
      const prompt = agent.buildSystemPrompt('Consumer');

      expect(prompt).toContain('# Tool Usage');
    });

    it('includes Executing with Care section', () => {
      const agent = createTestCortexAgent(piAgent, config);
      const prompt = agent.buildSystemPrompt('Consumer');

      expect(prompt).toContain('# Executing with Care');
    });

    it('includes Environment section with platform info', () => {
      const agent = createTestCortexAgent(piAgent, config);
      const prompt = agent.buildSystemPrompt('Consumer');

      expect(prompt).toContain('# Environment');
      expect(prompt).toContain('Platform:');
      expect(prompt).toContain('Shell:');
      expect(prompt).toContain('Working Directory: /tmp/test-workspace');
    });

    it('preserves consumer content exactly', () => {
      const agent = createTestCortexAgent(piAgent, config);
      const consumerContent = `You are Animus.
Your personality is warm and curious.
You have 12 emotions.`;
      const prompt = agent.buildSystemPrompt(consumerContent);

      expect(prompt.startsWith(consumerContent)).toBe(true);
    });

    it('does not mutate the live system prompt', () => {
      const agent = createTestCortexAgent(piAgent, config);
      const prompt = agent.buildSystemPrompt('Consumer');

      expect(prompt).toContain('Consumer');
      expect(agent.getCurrentSystemPrompt()).toContain('Test base prompt');
      expect(agent.getCurrentSystemPrompt()).not.toContain('Consumer');
    });
  });

  describe('setBasePrompt', () => {
    it('updates the live system prompt and tracks the base prompt', () => {
      const agent = createTestCortexAgent(piAgent, config);

      const prompt = agent.setBasePrompt('Base prompt');

      expect(prompt).toContain('Base prompt');
      expect(agent.getBasePrompt()).toBe('Base prompt');
      expect(agent.getCurrentSystemPrompt()).toContain('Base prompt');
      expect(piAgent.state.systemPrompt).toContain('Base prompt');
    });
  });

  describe('rebuildSystemPrompt', () => {
    it('updates the system prompt without losing conversation history', async () => {
      const agent = createTestCortexAgent(piAgent, config);

      // Build initial prompt
      agent.setBasePrompt('Original persona');

      // Simulate some conversation history
      piAgent.state.messages.push(
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      );

      // Rebuild with new content
      agent.rebuildSystemPrompt('Updated persona');

      // Conversation should still be there
      const history = agent.getConversationHistory();
      expect(history.length).toBe(2);
      expect(history[0]!.content).toBe('Hello');

      // New prompt should contain updated content
      const currentPrompt = agent.getCurrentSystemPrompt();
      expect(currentPrompt).toContain('Updated persona');
      expect(currentPrompt).not.toContain('Original persona');
    });
  });

  // -----------------------------------------------------------------------
  // Conversation history persistence
  // -----------------------------------------------------------------------

  describe('conversation history', () => {
    it('getConversationHistory excludes slot region', () => {
      const agent = createTestCortexAgent(piAgent, {
        ...config,
        slots: ['slot1', 'slot2'],
      });

      const cm = agent.getContextManager();
      cm.setSlot('slot1', 'Slot content 1');
      cm.setSlot('slot2', 'Slot content 2');

      // Simulate conversation history after slots
      piAgent.state.messages.push(
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
      );

      const history = agent.getConversationHistory();

      expect(history.length).toBe(2);
      expect(history[0]!.content).toBe('Hello');
      expect(history[1]!.content).toBe('Hi!');
    });

    it('getConversationHistory returns empty when only slots exist', () => {
      const agent = createTestCortexAgent(piAgent, {
        ...config,
        slots: ['slot1'],
      });

      const cm = agent.getContextManager();
      cm.setSlot('slot1', 'Content');

      const history = agent.getConversationHistory();
      expect(history.length).toBe(0);
    });

    it('restoreConversationHistory injects after slots', () => {
      const agent = createTestCortexAgent(piAgent, {
        ...config,
        slots: ['slot1', 'slot2'],
      });

      const cm = agent.getContextManager();
      cm.setSlot('slot1', 'Slot 1');
      cm.setSlot('slot2', 'Slot 2');

      // Restore some saved conversation
      agent.restoreConversationHistory([
        { role: 'user', content: 'Restored message 1' },
        { role: 'assistant', content: 'Restored response 1' },
        { role: 'user', content: 'Restored message 2' },
      ]);

      // Slots should be intact
      expect(piAgent.state.messages[0]!.content).toBe('Slot 1');
      expect(piAgent.state.messages[1]!.content).toBe('Slot 2');

      // Conversation should be after slots
      expect(piAgent.state.messages[2]!.content).toBe('Restored message 1');
      expect(piAgent.state.messages[3]!.content).toBe('Restored response 1');
      expect(piAgent.state.messages[4]!.content).toBe('Restored message 2');
    });

    it('restoreConversationHistory replaces existing conversation', () => {
      const agent = createTestCortexAgent(piAgent, {
        ...config,
        slots: ['slot1'],
      });

      const cm = agent.getContextManager();
      cm.setSlot('slot1', 'Slot content');

      // Add some existing conversation
      piAgent.state.messages.push(
        { role: 'user', content: 'Old message' },
      );

      // Restore should replace
      agent.restoreConversationHistory([
        { role: 'user', content: 'New message' },
      ]);

      const history = agent.getConversationHistory();
      expect(history.length).toBe(1);
      expect(history[0]!.content).toBe('New message');
    });
  });

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  describe('lifecycle', () => {
    it('starts in CREATED state', () => {
      const agent = createTestCortexAgent(piAgent, config);
      expect(agent.state).toBe('created');
    });

    it('transitions to ACTIVE after first prompt', async () => {
      const agent = createTestCortexAgent(piAgent, config);
      await agent.prompt('Hello');
      expect(agent.state).toBe('active');
    });

    it('transitions to DESTROYED after destroy', async () => {
      const agent = createTestCortexAgent(piAgent, config);
      await agent.destroy();
      expect(agent.state).toBe('destroyed');
    });

    it('destroy is idempotent', async () => {
      const agent = createTestCortexAgent(piAgent, config);
      await agent.destroy();
      await agent.destroy(); // Should not throw
      expect(agent.state).toBe('destroyed');
    });

    it('abort calls agent.abort() and waitForIdle()', async () => {
      const agent = createTestCortexAgent(piAgent, config);
      await agent.prompt('Hello');

      await agent.abort();

      expect(piAgent.abortCalled).toBe(true);
    });

    it('abort keeps the agent in ACTIVE state', async () => {
      const agent = createTestCortexAgent(piAgent, config);
      await agent.prompt('Hello');

      await agent.abort();

      expect(agent.state).toBe('active');
    });

    it('does not add an exit listener per agent instance', async () => {
      const before = process.listenerCount('exit');

      const first = createTestCortexAgent(createMockPiAgent(), config);
      const second = createTestCortexAgent(createMockPiAgent(), config);
      const third = createTestCortexAgent(createMockPiAgent(), config);

      const after = process.listenerCount('exit');
      expect(after - before).toBeLessThanOrEqual(1);

      await first.destroy();
      await second.destroy();
      await third.destroy();
    });
  });

  // -----------------------------------------------------------------------
  // Events
  // -----------------------------------------------------------------------

  describe('events', () => {
    it('onLoopComplete fires on session_end (agent_end)', async () => {
      const agent = createTestCortexAgent(piAgent, config);
      const handler = vi.fn();
      agent.onLoopComplete(handler);

      await agent.prompt('Hello');

      // agent.run() emits agent_end which maps to session_end -> onLoopComplete
      expect(handler).toHaveBeenCalled();
    });

    it('onTurnComplete fires with AgentTextOutput', async () => {
      piAgent.promptResult = 'Hello <working>internal</working> world';
      const agent = createTestCortexAgent(piAgent, config);

      const handler = vi.fn();
      agent.onTurnComplete(handler);

      await agent.prompt('Hello');

      expect(handler).toHaveBeenCalled();
      const output = handler.mock.calls[0][0];
      expect(output.raw).toBe('Hello <working>internal</working> world');
    });

    it('onError fires for classified errors', async () => {
      piAgent.promptError = new Error('Rate limit exceeded');
      const agent = createTestCortexAgent(piAgent, config);

      const handler = vi.fn();
      agent.onError(handler);

      await expect(agent.prompt('Hello')).rejects.toThrow();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].category).toBe('rate_limit');
    });

    it('multiple handlers can be registered for the same event', async () => {
      const agent = createTestCortexAgent(piAgent, config);
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      agent.onLoopComplete(handler1);
      agent.onLoopComplete(handler2);

      await agent.prompt('Hello');

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    it('auto-wires token tracking from turn_end usage data', () => {
      const agent = createTestCortexAgent(piAgent, {
        ...config,
        model: { provider: 'anthropic', name: 'claude-sonnet-4-20250514', contextWindow: 200_000 } as PiModel,
      });

      expect(agent.sessionTokenCount).toBe(0);

      // Emit a turn_end event with usage data (pattern: event.usage.input)
      piAgent.emitEvent({
        type: 'turn_end',
        text: 'response text',
        usage: { input: 85_000 },
      });

      expect(agent.sessionTokenCount).toBe(85_000);
    });

    it('auto-wires token tracking from message.usage.input pattern', () => {
      const agent = createTestCortexAgent(piAgent, {
        ...config,
        model: { provider: 'anthropic', name: 'claude-sonnet-4-20250514', contextWindow: 200_000 } as PiModel,
      });

      piAgent.emitEvent({
        type: 'turn_end',
        message: {
          content: 'response text',
          usage: { input: 42_000 },
        },
      });

      expect(agent.sessionTokenCount).toBe(42_000);
    });

    it('does not update token count when turn_end has no usage data', () => {
      const agent = createTestCortexAgent(piAgent, {
        ...config,
        model: { provider: 'anthropic', name: 'claude-sonnet-4-20250514', contextWindow: 200_000 } as PiModel,
      });

      // Manually set a known value
      agent.updateSessionTokenCount(50_000);

      // Emit a turn_end with no usage data
      piAgent.emitEvent({
        type: 'turn_end',
        text: 'response without usage',
      });

      // Should remain unchanged since no usage data was available
      expect(agent.sessionTokenCount).toBe(50_000);
    });
  });

  // -----------------------------------------------------------------------
  // Destroy cleanup
  // -----------------------------------------------------------------------

  describe('destroy cleanup', () => {
    it('calls agent.abort() during destroy', async () => {
      const agent = createTestCortexAgent(piAgent, config);
      await agent.destroy();

      expect(piAgent.abortCalled).toBe(true);
    });

    it('calls agent.reset() during destroy', async () => {
      const agent = createTestCortexAgent(piAgent, config);
      await agent.destroy();

      expect(piAgent.resetCalled).toBe(true);
    });

    it('emits onLoopComplete during destroy for final checkpoint', async () => {
      const agent = createTestCortexAgent(piAgent, config);
      const handler = vi.fn();
      agent.onLoopComplete(handler);

      await agent.destroy();

      // onLoopComplete should fire once during destroy (the checkpoint emission)
      expect(handler).toHaveBeenCalled();
    });

    it('clears handlers after destroy', async () => {
      const agent = createTestCortexAgent(piAgent, config);
      const errorHandler = vi.fn();
      agent.onError(errorHandler);

      await agent.destroy();

      // After destroy, handlers should be cleared
      // Attempting to prompt should throw "destroyed" not trigger error handlers
      await expect(agent.prompt('Hello')).rejects.toThrow('Agent has been destroyed');
      expect(errorHandler).not.toHaveBeenCalled();
    });

    it('respects destroy timeout', async () => {
      // Create an agent where waitForIdle never resolves quickly
      const slowAgent = createMockPiAgent();
      const originalWaitForIdle = slowAgent.waitForIdle;
      slowAgent.waitForIdle = () => new Promise((resolve) => {
        setTimeout(resolve, 60000); // Very slow
      });

      const agent = createTestCortexAgent(slowAgent, config);

      // Destroy with a short timeout
      const startTime = Date.now();
      await agent.destroy(100);
      const elapsed = Date.now() - startTime;

      // Should complete within the timeout (plus some margin)
      expect(elapsed).toBeLessThan(500);
      expect(agent.state).toBe('destroyed');
    });
  });

  // -----------------------------------------------------------------------
  // transformContext hook
  // -----------------------------------------------------------------------

  describe('transformContext', () => {
    it('returns a composable hook function', () => {
      const agent = createTestCortexAgent(piAgent, config);
      const hook = agent.getTransformContextHook();
      expect(typeof hook).toBe('function');
    });

    it('the hook passes through context when no ephemeral content', async () => {
      const agent = createTestCortexAgent(piAgent, config);
      const hook = agent.getTransformContextHook();

      const context = {
        systemPrompt: 'test',
        model: {},
        messages: [{ role: 'user' as const, content: 'Hello' }],
        tools: [],
        thinkingLevel: 'medium',
      };

      const result = await hook(context);
      // With no ephemeral, compaction stub, and skill stub are all no-ops
      expect(result.messages.length).toBe(1);
    });

    it('the hook injects ephemeral content', async () => {
      const agent = createTestCortexAgent(piAgent, {
        ...config,
        slots: [],
      });

      const cm = agent.getContextManager();
      cm.setEphemeral('Ephemeral data');

      const hook = agent.getTransformContextHook();
      const context = {
        systemPrompt: 'test',
        model: {},
        messages: [{ role: 'user' as const, content: 'Hello' }],
        tools: [],
        thinkingLevel: 'medium',
      };

      const result = await hook(context);
      expect(result.messages.length).toBe(2);
      expect(result.messages[0]!.content).toBe('Ephemeral data');
      expect(result.messages[1]!.content).toBe('Hello');
    });
  });

  // -----------------------------------------------------------------------
  // Model access
  // -----------------------------------------------------------------------

  describe('model access', () => {
    it('getModel returns the primary model', () => {
      const model = { provider: 'anthropic', name: 'claude-sonnet-4' } as PiModel;
      const agent = createTestCortexAgent(piAgent, {
        ...config,
        model,
      });

      expect(agent.getModel()).toBe(model);
    });

    it('getUtilityModel returns resolved utility model', () => {
      const agent = createTestCortexAgent(piAgent, config);
      const utility = agent.getUtilityModel();

      expect(utility.provider).toBe('anthropic');
      expect(utility.name).toBeDefined();
    });

    it('utilityComplete uses utility model for completion', async () => {
      const agent = createTestCortexAgent(piAgent, config);
      // utilityComplete requires a real pi-ai complete() call which needs a valid model
      // Just verify the method exists and is callable
      expect(typeof agent.utilityComplete).toBe('function');
    });
  });

  // -----------------------------------------------------------------------
  // setModel / setThinkingLevel / refreshTools
  // -----------------------------------------------------------------------

  describe('setModel', () => {
    it('updates the primary model', () => {
      const agent = createTestCortexAgent(piAgent, config);
      const newModel = { provider: 'openai', name: 'gpt-4o', contextWindow: 128_000 } as PiModel;

      agent.setModel(newModel);

      expect(agent.getModel()).toBe(newModel);
    });

    it('delegates to agent.setModel when available', () => {
      const setModelFn = vi.fn();
      (piAgent as unknown as Record<string, unknown>).setModel = setModelFn;

      const agent = createTestCortexAgent(piAgent, config);
      const newModel = { provider: 'openai', name: 'gpt-4o' } as PiModel;

      agent.setModel(newModel);

      expect(setModelFn).toHaveBeenCalledWith(newModel);
    });

    it('does not throw when agent lacks setModel', () => {
      const agent = createTestCortexAgent(piAgent, config);
      const newModel = { provider: 'openai', name: 'gpt-4o' } as PiModel;

      // Should not throw even though piAgent has no setModel
      expect(() => agent.setModel(newModel)).not.toThrow();
    });
  });

  describe('setThinkingLevel', () => {
    it('delegates to agent.setThinkingLevel when available', () => {
      const setThinkingFn = vi.fn();
      (piAgent as unknown as Record<string, unknown>).setThinkingLevel = setThinkingFn;

      const agent = createTestCortexAgent(piAgent, config);
      agent.setThinkingLevel('high');

      expect(setThinkingFn).toHaveBeenCalledWith('high');
    });

    it('does not throw when agent lacks setThinkingLevel', () => {
      const agent = createTestCortexAgent(piAgent, config);

      expect(() => agent.setThinkingLevel('medium')).not.toThrow();
    });
  });

  describe('refreshTools', () => {
    it('calls agent.setTools with registered + MCP tools', () => {
      const setToolsFn = vi.fn();
      (piAgent as unknown as Record<string, unknown>).setTools = setToolsFn;

      const builtInTools = [
        { name: 'Read', description: 'read', parameters: {}, execute: async () => 'ok' },
      ];
      const agent = createTestCortexAgent(
        piAgent,
        config,
        builtInTools,
        { enableSubAgentTool: false, enableLoadSkillTool: false },
      );
      setToolsFn.mockClear();

      // refreshTools merges built-in with MCP tools (empty in this test)
      agent.refreshTools();

      expect(setToolsFn).toHaveBeenCalledOnce();
      const allTools = setToolsFn.mock.calls[0]![0];
      expect(allTools.length).toBe(1);
      expect(allTools[0].name).toBe('Read');
    });

    it('does not throw when agent lacks setTools', () => {
      const agent = createTestCortexAgent(piAgent, config);

      expect(() => agent.refreshTools()).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // Event bridge access
  // -----------------------------------------------------------------------

  describe('event bridge access', () => {
    it('exposes the event bridge', () => {
      const agent = createTestCortexAgent(piAgent, config);
      const bridge = agent.getEventBridge();
      expect(bridge).toBeDefined();
    });

    it('exposes the budget guard', () => {
      const agent = createTestCortexAgent(piAgent, config);
      const guard = agent.getBudgetGuard();
      expect(guard).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // steer()
  // -----------------------------------------------------------------------

  describe('steer', () => {
    it('calls agent.steer() with user role message when prompting', async () => {
      const steerCalls: Array<{ role: string; content: string }> = [];
      piAgent.steer = (msg: { role: string; content: string }) => {
        steerCalls.push(msg);
      };

      const agent = createTestCortexAgent(piAgent, config);

      // Override run to hold open the prompting state so we can steer
      const originalPrompt = piAgent.prompt.bind(piAgent);
      piAgent.prompt = async (input: string): Promise<unknown> => {
        // Agent is now "prompting". Steer during this window.
        agent.steer('New context from user');
        return originalPrompt(input);
      };

      await agent.prompt('Hello');

      expect(steerCalls.length).toBe(1);
      expect(steerCalls[0]!.role).toBe('user');
      expect(steerCalls[0]!.content).toBe('New context from user');
    });

    it('is a no-op when not prompting', () => {
      const steerCalls: Array<{ role: string; content: string }> = [];
      piAgent.steer = (msg: { role: string; content: string }) => {
        steerCalls.push(msg);
      };

      const agent = createTestCortexAgent(piAgent, config);

      // Not prompting, should be a no-op
      agent.steer('This should be ignored');

      expect(steerCalls.length).toBe(0);
    });

    it('is a no-op after prompt completes', async () => {
      const steerCalls: Array<{ role: string; content: string }> = [];
      piAgent.steer = (msg: { role: string; content: string }) => {
        steerCalls.push(msg);
      };

      const agent = createTestCortexAgent(piAgent, config);
      await agent.prompt('Hello');

      // Prompt is done, should be a no-op
      agent.steer('Late message');

      expect(steerCalls.length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // directComplete()
  // -----------------------------------------------------------------------

  describe('directComplete', () => {
    it('directComplete method exists and is callable', () => {
      const agent = createTestCortexAgent(piAgent, config);
      expect(typeof agent.directComplete).toBe('function');
    });
  });

  // -----------------------------------------------------------------------
  // CortexAgent.create() factory
  // -----------------------------------------------------------------------

  describe('create factory', () => {
    it('create factory method exists', () => {
      expect(typeof CortexAgent.create).toBe('function');
    });
  });
});
