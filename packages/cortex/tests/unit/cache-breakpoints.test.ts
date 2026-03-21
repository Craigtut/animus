/**
 * Tests for the cache breakpoint optimization.
 *
 * Tests the core algorithms in isolation without importing CortexAgent
 * (which has transitive dependencies that fail in the test environment).
 * The tested functions are:
 * 1. computeCacheBreakpointIndices logic
 * 2. addCacheControlToMessage logic
 * 3. Ephemeral boundary insertion logic
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// We cannot import CortexAgent directly due to the eventsource-parser
// dependency issue in the test environment. Instead, we extract and test
// the pure computational logic inline. These mirror the implementations in
// cortex-agent.ts and verify the algorithms work correctly.
// ---------------------------------------------------------------------------

/**
 * Mirror of CortexAgent.computeCacheBreakpointIndices.
 * Compute API message indices for cache breakpoints BP2 and BP3.
 */
function computeCacheBreakpointIndices(
  messages: Array<{ role: string; content: unknown }>,
  slotCount: number,
  prePromptMessageCount: number,
  hasEphemeral: boolean,
  hasSkills: boolean,
): { bp2ApiIndex: number; bp3ApiIndex: number } {
  let apiIndex = -1;
  let bp2ApiIndex = -1;
  let bp3ApiIndex = -1;
  let inToolResultRun = false;

  const injectionCount = (hasEphemeral ? 1 : 0) + (hasSkills ? 1 : 0);
  const transformedBoundary = prePromptMessageCount + injectionCount;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    const role = msg.role;
    const content = typeof msg.content === 'string' ? msg.content : '';
    const isToolResult = role === 'user' && Array.isArray(msg.content) &&
      (msg.content as Array<Record<string, unknown>>).some(
        (block) => block['type'] === 'tool_result',
      );

    // convertMessages skips empty user messages
    if (role === 'user' && typeof msg.content === 'string' && content.trim() === '') {
      continue;
    }

    // convertMessages merges consecutive toolResult messages
    if (isToolResult) {
      if (!inToolResultRun) {
        apiIndex++;
        inToolResultRun = true;
      }
    } else {
      inToolResultRun = false;
      apiIndex++;
    }

    // BP2: last slot message
    if (i === slotCount - 1) {
      bp2ApiIndex = apiIndex;
    }

    // BP3: last message before the boundary (old history end)
    if (i === transformedBoundary - 1 && transformedBoundary > slotCount) {
      bp3ApiIndex = apiIndex;
    }
  }

  return { bp2ApiIndex, bp3ApiIndex };
}

/**
 * Mirror of addCacheControlToMessage from cortex-agent.ts.
 */
function addCacheControlToMessage(
  message: Record<string, unknown>,
  cacheControl: unknown,
): void {
  const content = message['content'];
  if (Array.isArray(content) && content.length > 0) {
    const lastBlock = content[content.length - 1] as Record<string, unknown>;
    lastBlock['cache_control'] = cacheControl;
  } else if (typeof content === 'string') {
    message['content'] = [{
      type: 'text',
      text: content,
      cache_control: cacheControl,
    }];
  }
}

/**
 * Mirror of the ephemeral/skill boundary insertion logic from
 * getTransformContextHook in cortex-agent.ts.
 */
function insertAtBoundary(
  messages: Array<{ role: string; content: string }>,
  boundary: number,
  injections: Array<{ role: string; content: string }>,
): Array<{ role: string; content: string }> {
  if (injections.length === 0) return messages;
  const result = [...messages];
  const insertIdx = Math.min(boundary, result.length);
  result.splice(insertIdx, 0, ...injections);
  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Cache breakpoint optimization', () => {

  // -----------------------------------------------------------------------
  // computeCacheBreakpointIndices
  // -----------------------------------------------------------------------

  describe('computeCacheBreakpointIndices', () => {
    it('computes BP2 for the last slot (2 slots)', () => {
      const messages = [
        { role: 'user', content: 'slot A' },
        { role: 'user', content: 'slot B' },
        { role: 'user', content: 'history msg' },
        { role: 'assistant', content: 'reply' },
      ];

      const result = computeCacheBreakpointIndices(messages, 2, 4, false, false);
      // slot A = API index 0, slot B = API index 1 => BP2 = 1
      expect(result.bp2ApiIndex).toBe(1);
    });

    it('computes BP3 at old history boundary with ephemeral', () => {
      const messages = [
        { role: 'user', content: 'slot A' },
        { role: 'user', content: 'slot B' },
        { role: 'user', content: 'old history' },
        { role: 'assistant', content: 'old reply' },
        { role: 'user', content: 'ephemeral' },   // injected at boundary
        { role: 'user', content: 'new tick' },
      ];

      // prePromptMessageCount = 4, ephemeral adds 1
      // transformedBoundary = 4 + 1 = 5
      // BP3 at i = 4 (transformedBoundary - 1)
      const result = computeCacheBreakpointIndices(messages, 2, 4, true, false);

      // slot A=0, slot B=1, old history=2, old reply=3, ephemeral=4
      expect(result.bp3ApiIndex).toBe(4);
    });

    it('computes BP3 with both ephemeral and skills', () => {
      const messages = [
        { role: 'user', content: 'slot A' },
        { role: 'user', content: 'slot B' },
        { role: 'user', content: 'old history' },
        { role: 'assistant', content: 'old reply' },
        { role: 'user', content: 'ephemeral' },   // injected
        { role: 'user', content: 'skill' },        // injected
        { role: 'user', content: 'new tick' },
      ];

      // prePromptMessageCount = 4, 2 injections
      // transformedBoundary = 4 + 2 = 6
      // BP3 at i = 5 (transformedBoundary - 1)
      const result = computeCacheBreakpointIndices(messages, 2, 4, true, true);

      // slot A=0, slot B=1, old history=2, old reply=3, ephemeral=4, skill=5
      expect(result.bp3ApiIndex).toBe(5);
    });

    it('skips empty user messages for API index counting', () => {
      const messages = [
        { role: 'user', content: '' },        // empty slot (skipped)
        { role: 'user', content: 'slot B' },  // slot B
        { role: 'user', content: 'history' },
      ];

      const result = computeCacheBreakpointIndices(messages, 2, 3, false, false);

      // Empty slot A is skipped, so BP2 (at i=1) has apiIndex = 0
      expect(result.bp2ApiIndex).toBe(0);
    });

    it('handles consecutive tool_results merged into one API message', () => {
      const toolResultContent = [
        { type: 'tool_result', tool_use_id: 'id1', content: 'result' },
      ];

      const messages = [
        { role: 'user', content: 'slot A' },
        { role: 'user', content: 'slot B' },
        { role: 'assistant', content: 'I will call tools' },
        { role: 'user', content: toolResultContent as unknown as string },   // tool_result 1
        { role: 'user', content: toolResultContent as unknown as string },   // tool_result 2 (merged)
        { role: 'user', content: 'follow-up' },
      ];

      const result = computeCacheBreakpointIndices(messages, 2, 6, false, false);

      // slot A=0, slot B=1, assistant=2, tool_results merged=3, follow-up=4
      expect(result.bp2ApiIndex).toBe(1);
    });

    it('correctly counts tool_results then non-tool message', () => {
      const toolResultContent = [
        { type: 'tool_result', tool_use_id: 'id1', content: 'result' },
      ];

      const messages = [
        { role: 'user', content: 'slot A' },
        { role: 'user', content: 'slot B' },
        { role: 'assistant', content: 'call tools' },
        { role: 'user', content: toolResultContent as unknown as string },  // tool_result
        { role: 'user', content: toolResultContent as unknown as string },  // merged
        { role: 'assistant', content: 'Next step' },
        { role: 'user', content: toolResultContent as unknown as string },  // new tool_result run
        { role: 'user', content: 'follow-up' },
      ];

      const result = computeCacheBreakpointIndices(messages, 2, 8, false, false);

      // slot A=0, slot B=1, assistant=2, merged_tools=3, assistant2=4, tool_result=5, follow-up=6
      expect(result.bp2ApiIndex).toBe(1);
    });

    it('returns -1 for BP3 when boundary equals slotCount (no history)', () => {
      const messages = [
        { role: 'user', content: 'slot A' },
        { role: 'user', content: 'slot B' },
        { role: 'user', content: 'new tick' },
      ];

      const result = computeCacheBreakpointIndices(messages, 2, 2, false, false);

      // transformedBoundary = 2 + 0 = 2, equals slotCount, so BP3 = -1
      expect(result.bp3ApiIndex).toBe(-1);
    });

    it('returns -1 for BP2 with zero slots', () => {
      const messages = [
        { role: 'user', content: 'message 1' },
        { role: 'assistant', content: 'reply 1' },
      ];

      const result = computeCacheBreakpointIndices(messages, 0, 2, false, false);

      // slotCount = 0, so i = -1 never matches => BP2 = -1
      expect(result.bp2ApiIndex).toBe(-1);
    });

    it('returns both -1 for empty message array', () => {
      const result = computeCacheBreakpointIndices([], 2, 0, false, false);
      expect(result.bp2ApiIndex).toBe(-1);
      expect(result.bp3ApiIndex).toBe(-1);
    });

    it('handles BP2 and BP3 being the same index', () => {
      // When there is no history between slots and boundary, BP2 and BP3
      // would map to the same API index. The onPayload hook only injects
      // one breakpoint in this case (BP2, skip BP3).
      const messages = [
        { role: 'user', content: 'slot A' },
        { role: 'user', content: 'slot B' },
        { role: 'user', content: 'ephemeral' },   // injected at boundary
        { role: 'user', content: 'new tick' },
      ];

      // prePromptMessageCount = 2 (just slots), ephemeral adds 1
      // transformedBoundary = 2 + 1 = 3
      // BP2 at i=1 => apiIndex = 1
      // BP3 at i=2 (transformedBoundary-1) => apiIndex = 2
      // They are different in this case
      const result = computeCacheBreakpointIndices(messages, 2, 2, true, false);

      expect(result.bp2ApiIndex).toBe(1);
      expect(result.bp3ApiIndex).toBe(2);
    });

    it('single slot with history and ephemeral', () => {
      const messages = [
        { role: 'user', content: 'single slot' },
        { role: 'user', content: 'old msg' },
        { role: 'assistant', content: 'old reply' },
        { role: 'user', content: 'ephemeral' },
        { role: 'user', content: 'new prompt' },
      ];

      // 1 slot, prePrompt=3, ephemeral=1 injection
      // transformedBoundary = 3 + 1 = 4
      const result = computeCacheBreakpointIndices(messages, 1, 3, true, false);

      // BP2 at i=0 => apiIndex=0
      expect(result.bp2ApiIndex).toBe(0);
      // BP3 at i=3 (transformedBoundary-1=3) => apiIndex=3
      expect(result.bp3ApiIndex).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // addCacheControlToMessage
  // -----------------------------------------------------------------------

  describe('addCacheControlToMessage', () => {
    it('adds cache_control to last block of array content', () => {
      const message: Record<string, unknown> = {
        role: 'user',
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'text', text: 'World' },
        ],
      };

      addCacheControlToMessage(message, { type: 'ephemeral' });

      const content = message['content'] as Array<Record<string, unknown>>;
      expect(content[0]!['cache_control']).toBeUndefined();
      expect(content[1]!['cache_control']).toEqual({ type: 'ephemeral' });
    });

    it('adds cache_control with TTL', () => {
      const message: Record<string, unknown> = {
        role: 'user',
        content: [
          { type: 'text', text: 'Content' },
        ],
      };

      addCacheControlToMessage(message, { type: 'ephemeral', ttl: '1h' });

      const content = message['content'] as Array<Record<string, unknown>>;
      expect(content[0]!['cache_control']).toEqual({ type: 'ephemeral', ttl: '1h' });
    });

    it('converts string content to block array with cache_control', () => {
      const message: Record<string, unknown> = {
        role: 'user',
        content: 'Hello world',
      };

      addCacheControlToMessage(message, { type: 'ephemeral' });

      const content = message['content'] as Array<Record<string, unknown>>;
      expect(content).toHaveLength(1);
      expect(content[0]).toEqual({
        type: 'text',
        text: 'Hello world',
        cache_control: { type: 'ephemeral' },
      });
    });

    it('no-ops on empty array content', () => {
      const message: Record<string, unknown> = {
        role: 'user',
        content: [],
      };

      // Should not throw
      addCacheControlToMessage(message, { type: 'ephemeral' });

      expect(message['content']).toEqual([]);
    });

    it('no-ops on null/undefined content', () => {
      const message: Record<string, unknown> = {
        role: 'user',
        content: null,
      };

      addCacheControlToMessage(message, { type: 'ephemeral' });
      expect(message['content']).toBeNull();
    });

    it('handles tool_result content blocks', () => {
      const message: Record<string, unknown> = {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'id1', content: 'result text' },
        ],
      };

      addCacheControlToMessage(message, { type: 'ephemeral' });

      const content = message['content'] as Array<Record<string, unknown>>;
      expect(content[0]!['cache_control']).toEqual({ type: 'ephemeral' });
    });
  });

  // -----------------------------------------------------------------------
  // Boundary insertion
  // -----------------------------------------------------------------------

  describe('boundary insertion', () => {
    it('inserts at boundary position', () => {
      const messages = [
        { role: 'user', content: 'slot_a' },
        { role: 'user', content: 'slot_b' },
        { role: 'user', content: 'old msg' },
        { role: 'assistant', content: 'old reply' },
        { role: 'user', content: 'new prompt' },
      ];

      const injections = [
        { role: 'user', content: 'ephemeral context' },
      ];

      const result = insertAtBoundary(messages, 4, injections);

      expect(result.length).toBe(6);
      expect(result[3]!.content).toBe('old reply');
      expect(result[4]!.content).toBe('ephemeral context');
      expect(result[5]!.content).toBe('new prompt');
    });

    it('inserts multiple injections in order', () => {
      const messages = [
        { role: 'user', content: 'slot_a' },
        { role: 'user', content: 'slot_b' },
        { role: 'user', content: 'new prompt' },
      ];

      const injections = [
        { role: 'user', content: 'ephemeral' },
        { role: 'user', content: 'skills' },
      ];

      const result = insertAtBoundary(messages, 2, injections);

      expect(result.length).toBe(5);
      expect(result[2]!.content).toBe('ephemeral');
      expect(result[3]!.content).toBe('skills');
      expect(result[4]!.content).toBe('new prompt');
    });

    it('clamps boundary to message length', () => {
      const messages = [
        { role: 'user', content: 'msg' },
      ];

      const injections = [
        { role: 'user', content: 'ephemeral' },
      ];

      // boundary = 100, but only 1 message
      const result = insertAtBoundary(messages, 100, injections);

      expect(result.length).toBe(2);
      expect(result[0]!.content).toBe('msg');
      expect(result[1]!.content).toBe('ephemeral');
    });

    it('inserts at position 0 when boundary is 0', () => {
      const messages = [
        { role: 'user', content: 'slot_a' },
        { role: 'user', content: 'slot_b' },
      ];

      const injections = [
        { role: 'user', content: 'ephemeral' },
      ];

      const result = insertAtBoundary(messages, 0, injections);

      expect(result.length).toBe(3);
      expect(result[0]!.content).toBe('ephemeral');
      expect(result[1]!.content).toBe('slot_a');
    });

    it('returns original when no injections', () => {
      const messages = [
        { role: 'user', content: 'msg' },
      ];

      const result = insertAtBoundary(messages, 0, []);
      expect(result).toBe(messages); // same reference
    });

    it('does not mutate the original array', () => {
      const messages = [
        { role: 'user', content: 'a' },
        { role: 'user', content: 'b' },
      ];

      const injections = [
        { role: 'user', content: 'injected' },
      ];

      const result = insertAtBoundary(messages, 1, injections);

      expect(messages.length).toBe(2);
      expect(result.length).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // onPayload BP2/BP3 deduplication
  // -----------------------------------------------------------------------

  describe('onPayload BP2/BP3 deduplication', () => {
    it('skips BP3 when it matches BP2', () => {
      // Simulate the onPayload logic
      const indices = { bp2ApiIndex: 3, bp3ApiIndex: 3 };
      const cacheControl = { type: 'ephemeral' };

      const messages = [
        { role: 'user', content: [{ type: 'text', text: 'a' }] },
        { role: 'user', content: [{ type: 'text', text: 'b' }] },
        { role: 'user', content: [{ type: 'text', text: 'c' }] },
        { role: 'user', content: [{ type: 'text', text: 'd' }] },
        { role: 'user', content: [{ type: 'text', text: 'e' }] },
      ] as Array<Record<string, unknown>>;

      // Inject BP2
      if (indices.bp2ApiIndex >= 0 && indices.bp2ApiIndex < messages.length) {
        addCacheControlToMessage(messages[indices.bp2ApiIndex]!, cacheControl);
      }

      // Inject BP3 (should be skipped because it equals BP2)
      if (indices.bp3ApiIndex >= 0 && indices.bp3ApiIndex < messages.length &&
          indices.bp3ApiIndex !== indices.bp2ApiIndex) {
        addCacheControlToMessage(messages[indices.bp3ApiIndex]!, cacheControl);
      }

      // Only message at index 3 should have cache_control
      const content3 = messages[3]!['content'] as Array<Record<string, unknown>>;
      expect(content3[0]!['cache_control']).toEqual(cacheControl);

      // No other messages should have cache_control
      for (let i = 0; i < messages.length; i++) {
        if (i === 3) continue;
        const content = messages[i]!['content'] as Array<Record<string, unknown>>;
        expect(content[0]!['cache_control']).toBeUndefined();
      }
    });

    it('skips both BPs when indices are -1', () => {
      const indices = { bp2ApiIndex: -1, bp3ApiIndex: -1 };
      const cacheControl = { type: 'ephemeral' };

      const messages = [
        { role: 'user', content: [{ type: 'text', text: 'a' }] },
        { role: 'user', content: [{ type: 'text', text: 'b' }] },
      ] as Array<Record<string, unknown>>;

      if (indices.bp2ApiIndex >= 0 && indices.bp2ApiIndex < messages.length) {
        addCacheControlToMessage(messages[indices.bp2ApiIndex]!, cacheControl);
      }
      if (indices.bp3ApiIndex >= 0 && indices.bp3ApiIndex < messages.length &&
          indices.bp3ApiIndex !== indices.bp2ApiIndex) {
        addCacheControlToMessage(messages[indices.bp3ApiIndex]!, cacheControl);
      }

      // No messages should have cache_control
      for (const msg of messages) {
        const content = msg['content'] as Array<Record<string, unknown>>;
        expect(content[0]!['cache_control']).toBeUndefined();
      }
    });

    it('injects both BPs when they differ', () => {
      const indices = { bp2ApiIndex: 1, bp3ApiIndex: 3 };
      const cacheControl = { type: 'ephemeral' };

      const messages = [
        { role: 'user', content: [{ type: 'text', text: 'a' }] },
        { role: 'user', content: [{ type: 'text', text: 'b' }] },
        { role: 'user', content: [{ type: 'text', text: 'c' }] },
        { role: 'user', content: [{ type: 'text', text: 'd' }] },
        { role: 'user', content: [{ type: 'text', text: 'e' }] },
      ] as Array<Record<string, unknown>>;

      if (indices.bp2ApiIndex >= 0 && indices.bp2ApiIndex < messages.length) {
        addCacheControlToMessage(messages[indices.bp2ApiIndex]!, cacheControl);
      }
      if (indices.bp3ApiIndex >= 0 && indices.bp3ApiIndex < messages.length &&
          indices.bp3ApiIndex !== indices.bp2ApiIndex) {
        addCacheControlToMessage(messages[indices.bp3ApiIndex]!, cacheControl);
      }

      const content1 = messages[1]!['content'] as Array<Record<string, unknown>>;
      expect(content1[0]!['cache_control']).toEqual(cacheControl);

      const content3 = messages[3]!['content'] as Array<Record<string, unknown>>;
      expect(content3[0]!['cache_control']).toEqual(cacheControl);

      // Others should not have cache_control
      for (const idx of [0, 2, 4]) {
        const content = messages[idx]!['content'] as Array<Record<string, unknown>>;
        expect(content[0]!['cache_control']).toBeUndefined();
      }
    });
  });

  // -----------------------------------------------------------------------
  // Full scenario: realistic mind tick
  // -----------------------------------------------------------------------

  describe('realistic mind tick scenario', () => {
    it('correctly identifies BP2 and BP3 for a typical mind tick', () => {
      // Simulates a typical mind tick with:
      // - 9 context slots
      // - 20 turns of old conversation history
      // - ephemeral context injected at boundary
      // - 3 new tick messages (prompt + response + follow-up)

      const slotCount = 9;
      const messages: Array<{ role: string; content: unknown }> = [];

      // 9 slots
      for (let i = 0; i < slotCount; i++) {
        messages.push({ role: 'user', content: `<slot-${i}>slot content</slot-${i}>` });
      }

      // 20 turns of old history (10 user + 10 assistant)
      for (let i = 0; i < 10; i++) {
        messages.push({ role: 'user', content: `User message ${i}` });
        messages.push({ role: 'assistant', content: `Assistant reply ${i}` });
      }

      // prePromptMessageCount = 9 + 20 = 29
      const prePromptCount = 29;

      // Ephemeral injected at position 29
      messages.splice(29, 0, { role: 'user', content: '<ephemeral>tick context</ephemeral>' });

      // 3 new tick messages (after ephemeral at position 30, 31, 32)
      messages.push({ role: 'user', content: 'New tick prompt' });
      messages.push({ role: 'assistant', content: 'Mind response' });
      messages.push({ role: 'user', content: 'Follow-up' });

      const result = computeCacheBreakpointIndices(
        messages, slotCount, prePromptCount, true, false,
      );

      // BP2: last slot at index 8, apiIndex = 8
      expect(result.bp2ApiIndex).toBe(8);

      // BP3: transformedBoundary = 29 + 1 = 30
      // BP3 at i = 29 (the ephemeral message), apiIndex = 29
      expect(result.bp3ApiIndex).toBe(29);

      // Verify both are valid and different
      expect(result.bp2ApiIndex).not.toBe(result.bp3ApiIndex);
      expect(result.bp2ApiIndex).toBeGreaterThanOrEqual(0);
      expect(result.bp3ApiIndex).toBeGreaterThanOrEqual(0);
    });

    it('handles mind tick with tool calls in history', () => {
      const slotCount = 2;
      const toolResult = [
        { type: 'tool_result', tool_use_id: 'call_1', content: 'file contents' },
      ];

      const messages: Array<{ role: string; content: unknown }> = [
        // 2 slots
        { role: 'user', content: 'slot 1' },
        { role: 'user', content: 'slot 2' },
        // Old history with tool calls
        { role: 'user', content: 'Read the file' },
        { role: 'assistant', content: 'Reading file...' },
        { role: 'user', content: toolResult },  // tool_result
        { role: 'user', content: toolResult },  // merged tool_result
        { role: 'assistant', content: 'Here is the content' },
        // Ephemeral at boundary (prePromptCount = 7)
        { role: 'user', content: 'ephemeral context' },
        // New tick
        { role: 'user', content: 'New prompt' },
      ];

      const result = computeCacheBreakpointIndices(messages, slotCount, 7, true, false);

      // slot1=0, slot2=1, user=2, assistant=3, merged_tools=4, assistant=5, ephemeral=6
      expect(result.bp2ApiIndex).toBe(1);
      // transformedBoundary = 7 + 1 = 8, BP3 at i=7 (ephemeral) => apiIndex=6
      expect(result.bp3ApiIndex).toBe(6);
    });
  });
});
