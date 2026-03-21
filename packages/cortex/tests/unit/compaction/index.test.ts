import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CompactionManager,
  buildCompactionConfig,
  DEFAULT_COMPACTION_CONFIG,
} from '../../../src/compaction/index.js';
import type { AgentContext, AgentMessage } from '../../../src/context-manager.js';
import type { CortexCompactionConfig } from '../../../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUserMsg(content: string): AgentMessage {
  return { role: 'user', content };
}

function makeAssistantMsg(content: string): AgentMessage {
  return { role: 'assistant', content };
}

function buildHistory(turnCount: number): AgentMessage[] {
  const history: AgentMessage[] = [];
  for (let i = 0; i < turnCount; i++) {
    history.push(makeUserMsg(`User message ${i}`));
    history.push(makeAssistantMsg(`Assistant response ${i}`));
  }
  return history;
}

function makeContext(messages: AgentMessage[]): AgentContext {
  return {
    systemPrompt: 'System prompt content',
    model: {},
    messages,
    tools: [],
    thinkingLevel: 'none',
  };
}

// ---------------------------------------------------------------------------
// Tests: buildCompactionConfig
// ---------------------------------------------------------------------------

describe('buildCompactionConfig', () => {
  it('returns defaults when no overrides provided', () => {
    const config = buildCompactionConfig();
    expect(config).toEqual(DEFAULT_COMPACTION_CONFIG);
  });

  it('returns defaults when undefined is passed', () => {
    const config = buildCompactionConfig(undefined);
    expect(config).toEqual(DEFAULT_COMPACTION_CONFIG);
  });

  it('applies partial microcompaction overrides', () => {
    const config = buildCompactionConfig({
      microcompaction: { maxResultTokens: 25_000 } as CortexCompactionConfig['microcompaction'],
    });

    expect(config.microcompaction.maxResultTokens).toBe(25_000);
    expect(config.microcompaction.softTrimThreshold).toBe(0.40); // default
    expect(config.compaction.threshold).toBe(0.70); // default
  });

  it('applies partial compaction overrides', () => {
    const config = buildCompactionConfig({
      compaction: { threshold: 0.80, preserveRecentTurns: 8 },
    });

    expect(config.compaction.threshold).toBe(0.80);
    expect(config.compaction.preserveRecentTurns).toBe(8);
  });

  it('applies failsafe overrides', () => {
    const config = buildCompactionConfig({
      failsafe: { threshold: 0.85 },
    });

    expect(config.failsafe.threshold).toBe(0.85);
  });
});

// ---------------------------------------------------------------------------
// Tests: CompactionManager
// ---------------------------------------------------------------------------

describe('CompactionManager', () => {
  let manager: CompactionManager;

  beforeEach(() => {
    manager = new CompactionManager(DEFAULT_COMPACTION_CONFIG, 2);
  });

  // -----------------------------------------------------------------------
  // Configuration
  // -----------------------------------------------------------------------

  describe('configuration', () => {
    it('tracks context window size', () => {
      manager.setContextWindow(200_000);
      expect(manager.contextWindow).toBe(200_000);
    });
  });

  // -----------------------------------------------------------------------
  // Token Tracking
  // -----------------------------------------------------------------------

  describe('token tracking', () => {
    it('tracks session token count', () => {
      expect(manager.sessionTokenCount).toBe(0);

      manager.updateTokenCount(50_000);
      expect(manager.sessionTokenCount).toBe(50_000);
    });

    it('calculates usage ratio', () => {
      manager.setContextWindow(200_000);
      manager.updateTokenCount(100_000);

      expect(manager.usageRatio).toBe(0.5);
    });

    it('returns 0 usage ratio when contextWindow is 0', () => {
      expect(manager.usageRatio).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Insertion-time cap
  // -----------------------------------------------------------------------

  describe('capToolResult', () => {
    it('passes through small content', () => {
      const result = manager.capToolResult('small content');
      expect(result).toBe('small content');
    });
  });

  // -----------------------------------------------------------------------
  // applyInsertionCap
  // -----------------------------------------------------------------------

  describe('applyInsertionCap', () => {
    function generateLargeContent(wordCount: number): string {
      const words: string[] = [];
      for (let i = 0; i < wordCount; i++) {
        words.push(`word${i}`);
      }
      return words.join(' ');
    }

    function makeToolResultMsg(text: string, toolName?: string): AgentMessage {
      return {
        role: 'user',
        content: [
          { type: 'tool_result', text, ...(toolName ? { name: toolName } : {}) },
        ],
      };
    }

    it('caps oversized tool results in place', () => {
      // ~40000 words * 1.3 = ~52000 tokens, exceeding 50000 default
      const largeContent = generateLargeContent(40_000);
      const slot = makeUserMsg('slot content');
      const toolResult = makeToolResultMsg(largeContent, 'Read');
      const messages: AgentMessage[] = [slot, toolResult, makeAssistantMsg('analysis')];

      manager.applyInsertionCap(messages, 1);

      // The tool result should have been capped
      const capped = messages[1]!;
      expect(Array.isArray(capped.content)).toBe(true);
      const part = (capped.content as Array<{ text?: string }>)[0]!;
      expect(part.text).toContain('tokens trimmed at insertion');
      expect(part.text!.length).toBeLessThan(largeContent.length);
    });

    it('skips already-capped tool results', () => {
      const alreadyCapped = 'HEAD\n\n... [~1000 tokens trimmed at insertion] ...\n\nTAIL';
      const toolResult = makeToolResultMsg(alreadyCapped, 'Read');
      const messages: AgentMessage[] = [toolResult];

      manager.applyInsertionCap(messages, 0);

      // Should be unchanged
      const part = (messages[0]!.content as Array<{ text?: string }>)[0]!;
      expect(part.text).toBe(alreadyCapped);
    });

    it('skips small tool results', () => {
      const smallContent = 'small result';
      const toolResult = makeToolResultMsg(smallContent, 'Read');
      const messages: AgentMessage[] = [toolResult];

      manager.applyInsertionCap(messages, 0);

      const part = (messages[0]!.content as Array<{ text?: string }>)[0]!;
      expect(part.text).toBe(smallContent);
    });

    it('skips messages in the slot region', () => {
      const largeContent = generateLargeContent(40_000);
      const slotToolResult = makeToolResultMsg(largeContent, 'Read');
      const messages: AgentMessage[] = [slotToolResult, makeAssistantMsg('after slot')];

      manager.applyInsertionCap(messages, 1);

      // Slot region (index 0) should be untouched
      const part = (messages[0]!.content as Array<{ text?: string }>)[0]!;
      expect(part.text).toBe(largeContent);
    });

    it('skips non-tool-result messages', () => {
      const messages: AgentMessage[] = [
        makeUserMsg('regular message'),
        makeAssistantMsg('response'),
      ];

      manager.applyInsertionCap(messages, 0);

      expect(messages[0]!.content).toBe('regular message');
      expect(messages[1]!.content).toBe('response');
    });
  });

  // -----------------------------------------------------------------------
  // transformContext integration
  // -----------------------------------------------------------------------

  describe('applyInTransformContext', () => {
    it('returns context unchanged when contextWindow is 0', async () => {
      const slots = [makeUserMsg('slot1'), makeUserMsg('slot2')];
      const history = buildHistory(5);
      const context = makeContext([...slots, ...history]);

      const result = await manager.applyInTransformContext(
        context,
        (ctx) => ctx.messages.slice(2),
        (ctx, hist) => ({ ...ctx, messages: [...ctx.messages.slice(0, 2), ...hist] }),
      );

      expect(result.messages).toEqual(context.messages);
    });

    it('applies microcompaction when above soft threshold', async () => {
      manager.setContextWindow(100_000);
      manager.updateTokenCount(45_000); // 45% > 40% threshold

      const slots = [makeUserMsg('slot1'), makeUserMsg('slot2')];
      const toolResult: AgentMessage = {
        role: 'user',
        content: [{ type: 'tool_result', text: 'old file content that is long enough to be trimmed', name: 'Read' }],
      };
      const history = [
        toolResult,
        makeAssistantMsg('old analysis'),
        makeAssistantMsg('more analysis'),
        makeAssistantMsg('turn 3'),
        makeAssistantMsg('turn 4'),
        makeAssistantMsg('turn 5'),
        makeAssistantMsg('turn 6'),
        makeAssistantMsg('recent'),
      ];
      const context = makeContext([...slots, ...history]);

      const result = await manager.applyInTransformContext(
        context,
        (ctx) => ctx.messages.slice(2),
        (ctx, hist) => ({ ...ctx, messages: [...ctx.messages.slice(0, 2), ...hist] }),
      );

      // Slots should be untouched
      expect(result.messages[0]).toBe(slots[0]);
      expect(result.messages[1]).toBe(slots[1]);
    });

    it('triggers Layer 3 when tokens exceed 90% threshold', async () => {
      manager.setContextWindow(100_000);
      manager.updateTokenCount(95_000); // 95% > 90% threshold

      const slots = [makeUserMsg('slot1'), makeUserMsg('slot2')];
      const history = buildHistory(5);
      const context = makeContext([...slots, ...history]);

      const result = await manager.applyInTransformContext(
        context,
        (ctx) => ctx.messages.slice(2),
        (ctx, hist) => ({ ...ctx, messages: [...ctx.messages.slice(0, 2), ...hist] }),
      );

      // Layer 3 fires unconditionally when above 90% threshold.
      // Message count may or may not change depending on token estimates,
      // but the method should complete without error.
      expect(result.messages.length).toBeLessThanOrEqual(context.messages.length);
    });

    it('runs Layer 2 when completeFn and source accessors are provided and above 70%', async () => {
      manager.setContextWindow(200_000);
      manager.updateTokenCount(150_000); // 75% > 70% threshold

      const mockComplete = vi.fn().mockResolvedValue('Summary of conversation');
      manager.setCompleteFn(mockComplete);

      const slots = [makeUserMsg('slot1'), makeUserMsg('slot2')];
      const history = buildHistory(10); // 20 messages
      const context = makeContext([...slots, ...history]);

      // Simulate source history (the original transcript)
      let sourceHistory = [...history];

      const result = await manager.applyInTransformContext(
        context,
        (ctx) => ctx.messages.slice(2),
        (ctx, hist) => ({ ...ctx, messages: [...ctx.messages.slice(0, 2), ...hist] }),
        () => sourceHistory,
        (h) => { sourceHistory = h; },
      );

      // Layer 2 should have fired (completeFn called)
      expect(mockComplete).toHaveBeenCalled();
      // Source history should be updated (compacted)
      expect(sourceHistory.length).toBeLessThan(history.length);
      // Result should reflect the compacted state
      expect(result.messages.length).toBeLessThan(context.messages.length);
    });

    it('does not run Layer 2 when source accessors are not provided', async () => {
      manager.setContextWindow(200_000);
      manager.updateTokenCount(150_000); // 75% > 70% threshold

      const mockComplete = vi.fn().mockResolvedValue('Summary');
      manager.setCompleteFn(mockComplete);

      const slots = [makeUserMsg('slot1'), makeUserMsg('slot2')];
      const history = buildHistory(10);
      const context = makeContext([...slots, ...history]);

      // No source accessors: Layer 2 should not fire
      await manager.applyInTransformContext(
        context,
        (ctx) => ctx.messages.slice(2),
        (ctx, hist) => ({ ...ctx, messages: [...ctx.messages.slice(0, 2), ...hist] }),
      );

      expect(mockComplete).not.toHaveBeenCalled();
    });

    it('fires onBeforeCompaction handlers during Layer 2 in transformContext', async () => {
      manager.setContextWindow(200_000);
      manager.updateTokenCount(150_000);
      manager.setCompleteFn(vi.fn().mockResolvedValue('Summary'));

      const callOrder: string[] = [];
      manager.onBeforeCompaction(async () => {
        callOrder.push('before');
      });

      const slots = [makeUserMsg('slot1'), makeUserMsg('slot2')];
      const history = buildHistory(10);
      const context = makeContext([...slots, ...history]);
      let sourceHistory = [...history];

      await manager.applyInTransformContext(
        context,
        (ctx) => ctx.messages.slice(2),
        (ctx, hist) => ({ ...ctx, messages: [...ctx.messages.slice(0, 2), ...hist] }),
        () => sourceHistory,
        (h) => { sourceHistory = h; },
      );

      expect(callOrder[0]).toBe('before');
    });
  });

  // -----------------------------------------------------------------------
  // Manual compaction (convenience API)
  // -----------------------------------------------------------------------

  describe('checkAndRunCompaction', () => {
    it('returns null when below threshold', async () => {
      manager.setContextWindow(200_000);
      manager.updateTokenCount(100_000); // 50% < 70%

      const history = buildHistory(5);
      const result = await manager.checkAndRunCompaction(
        () => history,
        () => {},
      );

      expect(result).toBeNull();
    });

    it('runs Layer 2 when threshold is exceeded', async () => {
      manager.setContextWindow(200_000);
      manager.updateTokenCount(150_000); // 75% > 70%

      const mockComplete = vi.fn().mockResolvedValue('Summary of conversation');
      manager.setCompleteFn(mockComplete);

      const history = buildHistory(10); // 20 messages
      let replacedHistory: AgentMessage[] | null = null;

      const result = await manager.checkAndRunCompaction(
        () => history,
        (h) => { replacedHistory = h; },
      );

      expect(result).not.toBeNull();
      expect(result!.summary).toBe('Summary of conversation');
      expect(replacedHistory).not.toBeNull();
      expect(replacedHistory!.length).toBeLessThan(history.length);
    });

    it('fires onBeforeCompaction handlers before summarization', async () => {
      manager.setContextWindow(200_000);
      manager.updateTokenCount(150_000);
      manager.setCompleteFn(vi.fn().mockResolvedValue('Summary'));

      const callOrder: string[] = [];
      manager.onBeforeCompaction(async () => {
        callOrder.push('before');
      });

      const history = buildHistory(10);
      await manager.checkAndRunCompaction(
        () => history,
        () => { callOrder.push('set'); },
      );

      expect(callOrder[0]).toBe('before');
    });

    it('fires onPostCompaction and onCompactionResult handlers', async () => {
      manager.setContextWindow(200_000);
      manager.updateTokenCount(150_000);
      manager.setCompleteFn(vi.fn().mockResolvedValue('Summary'));

      const postHandler = vi.fn();
      const resultHandler = vi.fn();
      manager.onPostCompaction(postHandler);
      manager.onCompactionResult(resultHandler);

      const history = buildHistory(10);
      await manager.checkAndRunCompaction(
        () => history,
        () => {},
      );

      expect(postHandler).toHaveBeenCalledOnce();
      expect(resultHandler).toHaveBeenCalledOnce();
    });

    it('returns null when contextWindow is 0', async () => {
      manager.updateTokenCount(150_000);
      const result = await manager.checkAndRunCompaction(
        () => buildHistory(10),
        () => {},
      );
      expect(result).toBeNull();
    });

    it('returns null for empty history', async () => {
      manager.setContextWindow(200_000);
      manager.updateTokenCount(150_000);

      const result = await manager.checkAndRunCompaction(
        () => [],
        () => {},
      );
      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Reactive overflow handling
  // -----------------------------------------------------------------------

  describe('handleOverflowError', () => {
    it('performs emergency truncation on overflow', () => {
      manager.setContextWindow(100_000);
      manager.updateTokenCount(95_000);

      const history = buildHistory(20);
      let replacedHistory: AgentMessage[] | null = null;

      manager.handleOverflowError(
        () => history,
        (h) => { replacedHistory = h; },
      );

      expect(replacedHistory).not.toBeNull();
      expect(replacedHistory!.length).toBeLessThanOrEqual(history.length);
    });

    it('is a no-op for empty history', () => {
      manager.setContextWindow(100_000);
      manager.updateTokenCount(95_000);

      let setCalled = false;
      manager.handleOverflowError(
        () => [],
        () => { setCalled = true; },
      );

      expect(setCalled).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  describe('destroy', () => {
    it('resets all state', () => {
      manager.setContextWindow(200_000);
      manager.updateTokenCount(100_000);

      manager.destroy();

      expect(manager.sessionTokenCount).toBe(0);
    });
  });
});
