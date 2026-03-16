import { describe, it, expect, beforeEach } from 'vitest';
import { ContextManager } from '../../src/context-manager.js';
import type { AgentStateAccessor, AgentContext } from '../../src/context-manager.js';

/**
 * Create a mock agent with an empty messages array.
 */
function createMockAgent(): AgentStateAccessor {
  return {
    state: {
      messages: [],
    },
  };
}

describe('ContextManager', () => {
  let agent: AgentStateAccessor;

  beforeEach(() => {
    agent = createMockAgent();
  });

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  describe('construction', () => {
    it('initializes slot positions in the messages array', () => {
      const cm = new ContextManager(agent, {
        slots: ['credentials', 'contacts', 'goals'],
      });

      expect(agent.state.messages.length).toBe(3);
      expect(cm.slotCount).toBe(3);
    });

    it('creates slots with empty content', () => {
      const cm = new ContextManager(agent, {
        slots: ['a', 'b'],
      });

      expect(cm.getSlot('a')).toBe('');
      expect(cm.getSlot('b')).toBe('');
    });

    it('returns slot names as frozen array', () => {
      const cm = new ContextManager(agent, {
        slots: ['x', 'y', 'z'],
      });

      expect(cm.slots).toEqual(['x', 'y', 'z']);
      expect(Object.isFrozen(cm.slots)).toBe(true);
    });

    it('throws on duplicate slot names', () => {
      expect(() => {
        new ContextManager(agent, {
          slots: ['a', 'b', 'a'],
        });
      }).toThrow('Duplicate slot name: "a"');
    });

    it('handles zero slots', () => {
      const cm = new ContextManager(agent, {
        slots: [],
      });

      expect(cm.slotCount).toBe(0);
      expect(agent.state.messages.length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // setSlot
  // -----------------------------------------------------------------------

  describe('setSlot', () => {
    it('updates the correct position in the messages array', () => {
      const cm = new ContextManager(agent, {
        slots: ['first', 'second', 'third'],
      });

      cm.setSlot('second', 'Hello from second slot');

      expect(agent.state.messages[1]).toEqual({
        role: 'user',
        content: 'Hello from second slot',
      });
    });

    it('updates position 0 for the first slot', () => {
      const cm = new ContextManager(agent, {
        slots: ['alpha', 'beta'],
      });

      cm.setSlot('alpha', 'First slot content');

      expect(agent.state.messages[0]).toEqual({
        role: 'user',
        content: 'First slot content',
      });
    });

    it('overwrites previous content when called multiple times', () => {
      const cm = new ContextManager(agent, {
        slots: ['data'],
      });

      cm.setSlot('data', 'version 1');
      expect(cm.getSlot('data')).toBe('version 1');

      cm.setSlot('data', 'version 2');
      expect(cm.getSlot('data')).toBe('version 2');
    });

    it('throws for unknown slot names', () => {
      const cm = new ContextManager(agent, {
        slots: ['known'],
      });

      expect(() => {
        cm.setSlot('unknown', 'content');
      }).toThrow('Unknown slot name: "unknown"');
    });

    it('preserves ordering when multiple slots are set', () => {
      const cm = new ContextManager(agent, {
        slots: ['a', 'b', 'c'],
      });

      cm.setSlot('c', 'third');
      cm.setSlot('a', 'first');
      cm.setSlot('b', 'second');

      expect(agent.state.messages[0]!.content).toBe('first');
      expect(agent.state.messages[1]!.content).toBe('second');
      expect(agent.state.messages[2]!.content).toBe('third');
    });

    it('does not affect conversation history after slots', () => {
      const cm = new ContextManager(agent, {
        slots: ['slot1'],
      });

      // Simulate conversation history added by pi-agent-core
      agent.state.messages.push(
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      );

      // Update slot should not touch conversation history
      cm.setSlot('slot1', 'updated slot');

      expect(agent.state.messages.length).toBe(3);
      expect(agent.state.messages[0]!.content).toBe('updated slot');
      expect(agent.state.messages[1]!.content).toBe('Hello');
      expect(agent.state.messages[2]!.content).toBe('Hi there!');
    });
  });

  // -----------------------------------------------------------------------
  // getSlot
  // -----------------------------------------------------------------------

  describe('getSlot', () => {
    it('reads back set content', () => {
      const cm = new ContextManager(agent, {
        slots: ['test'],
      });

      cm.setSlot('test', 'my content');
      expect(cm.getSlot('test')).toBe('my content');
    });

    it('returns empty string for unset slots (initialized)', () => {
      const cm = new ContextManager(agent, {
        slots: ['empty'],
      });

      expect(cm.getSlot('empty')).toBe('');
    });

    it('throws for unknown slot names', () => {
      const cm = new ContextManager(agent, {
        slots: ['known'],
      });

      expect(() => {
        cm.getSlot('nope');
      }).toThrow('Unknown slot name: "nope"');
    });

    it('handles content array messages', () => {
      const cm = new ContextManager(agent, {
        slots: ['rich'],
      });

      // Simulate a content array message (e.g., from manual manipulation)
      agent.state.messages[0] = {
        role: 'user',
        content: [
          { type: 'text', text: 'Part one. ' },
          { type: 'text', text: 'Part two.' },
        ],
      };

      expect(cm.getSlot('rich')).toBe('Part one. Part two.');
    });
  });

  // -----------------------------------------------------------------------
  // Ephemeral context
  // -----------------------------------------------------------------------

  describe('ephemeral context', () => {
    it('stores and retrieves ephemeral content', () => {
      const cm = new ContextManager(agent, {
        slots: [],
      });

      cm.setEphemeral('tick context data');
      expect(cm.getEphemeral()).toBe('tick context data');
    });

    it('clears ephemeral content with null', () => {
      const cm = new ContextManager(agent, {
        slots: [],
      });

      cm.setEphemeral('temporary');
      cm.setEphemeral(null);
      expect(cm.getEphemeral()).toBeNull();
    });

    it('starts with null ephemeral content', () => {
      const cm = new ContextManager(agent, {
        slots: [],
      });

      expect(cm.getEphemeral()).toBeNull();
    });

    it('overwrites previous ephemeral content', () => {
      const cm = new ContextManager(agent, {
        slots: [],
      });

      cm.setEphemeral('first');
      cm.setEphemeral('second');
      expect(cm.getEphemeral()).toBe('second');
    });
  });

  // -----------------------------------------------------------------------
  // transformContext hook
  // -----------------------------------------------------------------------

  describe('getTransformContextHook', () => {
    function createContext(messages: Array<{ role: string; content: string }>): AgentContext {
      return {
        systemPrompt: 'test prompt',
        model: {},
        messages: messages as AgentContext['messages'],
        tools: [],
        thinkingLevel: 'medium',
      };
    }

    it('returns a function', () => {
      const cm = new ContextManager(agent, {
        slots: [],
      });

      const hook = cm.getTransformContextHook();
      expect(typeof hook).toBe('function');
    });

    it('passes through context unchanged when no ephemeral content', () => {
      const cm = new ContextManager(agent, {
        slots: [],
      });

      const hook = cm.getTransformContextHook();
      const context = createContext([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
      ]);

      const result = hook(context);
      expect(result).toBe(context); // Same reference (no copy needed)
    });

    it('appends ephemeral content as a user message at the end', () => {
      const cm = new ContextManager(agent, {
        slots: [],
      });

      cm.setEphemeral('Current emotional state: calm');

      const hook = cm.getTransformContextHook();
      const context = createContext([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
      ]);

      const result = hook(context);

      expect(result.messages.length).toBe(3);
      expect(result.messages[2]).toEqual({
        role: 'user',
        content: 'Current emotional state: calm',
      });
    });

    it('ephemeral content appears AFTER conversation history', () => {
      const cm = new ContextManager(agent, {
        slots: ['slot1'],
      });

      cm.setSlot('slot1', 'Slot content');
      cm.setEphemeral('Ephemeral data');

      const hook = cm.getTransformContextHook();
      const context = createContext([
        { role: 'user', content: 'Slot content' },
        { role: 'user', content: 'User message' },
        { role: 'assistant', content: 'Response' },
      ]);

      const result = hook(context);

      // Ephemeral should be the last message
      const lastMessage = result.messages[result.messages.length - 1]!;
      expect(lastMessage.content).toBe('Ephemeral data');
    });

    it('does not modify the original context messages array', () => {
      const cm = new ContextManager(agent, {
        slots: [],
      });

      cm.setEphemeral('Injected');

      const hook = cm.getTransformContextHook();
      const originalMessages = [
        { role: 'user' as const, content: 'Hello' },
      ];
      const context = createContext(originalMessages);

      const result = hook(context);

      // Original should be untouched
      expect(context.messages.length).toBe(1);
      // Result should have the extra message
      expect(result.messages.length).toBe(2);
    });

    it('preserves other context properties (systemPrompt, model, tools, thinkingLevel)', () => {
      const cm = new ContextManager(agent, {
        slots: [],
      });

      cm.setEphemeral('Some context');

      const hook = cm.getTransformContextHook();
      const context: AgentContext = {
        systemPrompt: 'my prompt',
        model: { name: 'test-model' },
        messages: [],
        tools: [{ name: 'read' }],
        thinkingLevel: 'high',
      };

      const result = hook(context);

      expect(result.systemPrompt).toBe('my prompt');
      expect(result.model).toEqual({ name: 'test-model' });
      expect(result.tools).toEqual([{ name: 'read' }]);
      expect(result.thinkingLevel).toBe('high');
    });

    it('is composable with other hooks', () => {
      const cm = new ContextManager(agent, {
        slots: [],
      });

      cm.setEphemeral('Ephemeral');

      const hook = cm.getTransformContextHook();

      // A second hook that adds a tool
      const secondHook = (ctx: AgentContext): AgentContext => ({
        ...ctx,
        tools: [...ctx.tools, { name: 'extra-tool' }],
      });

      // Compose: ephemeral first, then tool addition
      const composed = (ctx: AgentContext): AgentContext => {
        return secondHook(hook(ctx));
      };

      const context = createContext([]);
      const result = composed(context);

      expect(result.messages.length).toBe(1); // ephemeral added
      expect(result.tools.length).toBe(1); // tool added
    });
  });

  // -----------------------------------------------------------------------
  // Slot ordering
  // -----------------------------------------------------------------------

  describe('slot ordering', () => {
    it('matches definition order in the messages array', () => {
      const cm = new ContextManager(agent, {
        slots: ['credentials', 'contacts', 'core-self', 'working-memory', 'goals', 'tasks'],
      });

      cm.setSlot('credentials', 'creds');
      cm.setSlot('contacts', 'contacts');
      cm.setSlot('core-self', 'self');
      cm.setSlot('working-memory', 'memory');
      cm.setSlot('goals', 'goals');
      cm.setSlot('tasks', 'tasks');

      expect(agent.state.messages[0]!.content).toBe('creds');
      expect(agent.state.messages[1]!.content).toBe('contacts');
      expect(agent.state.messages[2]!.content).toBe('self');
      expect(agent.state.messages[3]!.content).toBe('memory');
      expect(agent.state.messages[4]!.content).toBe('goals');
      expect(agent.state.messages[5]!.content).toBe('tasks');
    });
  });
});
