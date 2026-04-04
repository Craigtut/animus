import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CompactionManager,
  buildCompactionConfig,
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

/**
 * Create a CompactionManager configured to trigger Layer 2 compaction.
 * Sets context window and token count so the 70% threshold is exceeded.
 */
function createManagerForLayer2(
  overrides?: Partial<CortexCompactionConfig>,
): CompactionManager {
  const config = buildCompactionConfig({
    compaction: {
      threshold: 0.70,
      preserveRecentTurns: 4,
      maxRetries: 3,
      retryDelayMs: 0, // no delay in tests
      ...overrides?.compaction,
    },
    failsafe: {
      threshold: 0.90,
      ...overrides?.failsafe,
    },
    adaptive: {
      enabled: false, // disable adaptive for predictable thresholds
      recentWindowMs: 300_000,
      idleWindowMs: 1_800_000,
      recentReduction: 0,
      moderateReduction: 0,
      idleReduction: 0,
      ...overrides?.adaptive,
    },
    microcompaction: overrides?.microcompaction,
  });

  const manager = new CompactionManager(config, 2);
  return manager;
}

// ---------------------------------------------------------------------------
// Tests: Circuit breaker in CompactionManager
// ---------------------------------------------------------------------------

describe('CompactionManager circuit breaker', () => {
  let manager: CompactionManager;
  let slots: AgentMessage[];
  let history: AgentMessage[];
  let sourceHistory: AgentMessage[];

  beforeEach(() => {
    manager = createManagerForLayer2();
    manager.setContextWindow(200_000);
    manager.updateTokenCount(150_000); // 75% > 70% threshold

    slots = [makeUserMsg('slot1'), makeUserMsg('slot2')];
    history = buildHistory(10); // 20 messages
    sourceHistory = [...history];
  });

  function runCompaction(completeFn: ReturnType<typeof vi.fn>) {
    manager.setCompleteFn(completeFn);
    const context = makeContext([...slots, ...history]);

    return manager.applyInTransformContext(
      context,
      (ctx) => ctx.messages.slice(2),
      (ctx, hist) => ({ ...ctx, messages: [...ctx.messages.slice(0, 2), ...hist] }),
      () => sourceHistory,
      (h) => { sourceHistory = h; },
    );
  }

  // -----------------------------------------------------------------------
  // Test 1: Layer 2 fails once, retries, succeeds on second attempt
  // -----------------------------------------------------------------------

  it('retries on Layer 2 failure and succeeds on second attempt', async () => {
    const mockComplete = vi.fn()
      .mockRejectedValueOnce(new Error('LLM transient error'))
      .mockResolvedValue('Summary of conversation');

    await runCompaction(mockComplete);

    // completeFn should have been called twice: first attempt fails, second succeeds
    expect(mockComplete).toHaveBeenCalledTimes(2);

    // Source history should be compacted (summarized)
    expect(sourceHistory.length).toBeLessThan(history.length);
  });

  // -----------------------------------------------------------------------
  // Test 2: Layer 2 fails 3 times, falls to Layer 3, onCompactionDegraded emitted
  // -----------------------------------------------------------------------

  it('emits onCompactionDegraded when Layer 2 exhausts retries and Layer 3 fires', async () => {
    // Set up a high token count so Layer 3 (90% of model context) will fire
    manager.setContextWindow(200_000);
    manager.setModelContextWindow(200_000);
    manager.updateTokenCount(185_000); // 92.5% > 90% failsafe

    const mockComplete = vi.fn().mockRejectedValue(new Error('LLM always fails'));

    const degradedHandler = vi.fn();
    manager.onCompactionDegraded(degradedHandler);

    await runCompaction(mockComplete);

    // completeFn called 3 times (maxRetries default)
    expect(mockComplete).toHaveBeenCalledTimes(3);

    // Layer 3 should have fired and emitted degraded
    expect(degradedHandler).toHaveBeenCalledOnce();
    const info = degradedHandler.mock.calls[0]![0];
    expect(info.layer2Failures).toBe(3);
    expect(info.turnsDropped).toBeGreaterThanOrEqual(0);
  });

  // -----------------------------------------------------------------------
  // Test 3: Layer 2 fails 3 times AND Layer 3 can't help, onCompactionExhausted emitted
  // -----------------------------------------------------------------------

  it('emits onCompactionExhausted when Layer 2 fails and Layer 3 threshold not reached', async () => {
    // Set tokens above Layer 2 threshold (70%) but below Layer 3 threshold (90%)
    // This means Layer 2 should fire but Layer 3 won't trigger
    manager.setContextWindow(200_000);
    manager.setModelContextWindow(200_000);
    manager.updateTokenCount(150_000); // 75% > 70% L2 but < 90% L3

    const mockComplete = vi.fn().mockRejectedValue(new Error('LLM always fails'));

    const exhaustedHandler = vi.fn();
    const degradedHandler = vi.fn();
    manager.onCompactionExhausted(exhaustedHandler);
    manager.onCompactionDegraded(degradedHandler);

    await runCompaction(mockComplete);

    // completeFn called 3 times
    expect(mockComplete).toHaveBeenCalledTimes(3);

    // Layer 3 should NOT have fired (below 90%)
    expect(degradedHandler).not.toHaveBeenCalled();

    // Exhausted should have fired since we're still over Layer 2 budget
    expect(exhaustedHandler).toHaveBeenCalledOnce();
    const info = exhaustedHandler.mock.calls[0]![0];
    expect(info.layer2Failures).toBe(3);
    expect(info.error).toBeInstanceOf(Error);
  });

  // -----------------------------------------------------------------------
  // Test 4: Successful compaction resets failure counter
  // -----------------------------------------------------------------------

  it('resets failure counter after a successful compaction', async () => {
    // First episode: fail once then succeed (counter goes to 1, then resets to 0)
    const failThenSucceed = vi.fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue('Summary');

    await runCompaction(failThenSucceed);
    expect(failThenSucceed).toHaveBeenCalledTimes(2);

    // Reset state for second episode
    sourceHistory = buildHistory(10);
    manager.updateTokenCount(150_000);

    // Second episode: fail 3 times
    // If counter wasn't reset, we'd have 4 failures total, but the degraded
    // handler should report only 3 (from this episode).
    const alwaysFail = vi.fn().mockRejectedValue(new Error('persistent'));

    // Set up for Layer 3 to fire so degraded is emitted
    manager.setModelContextWindow(200_000);
    manager.updateTokenCount(185_000);

    const degradedHandler = vi.fn();
    manager.onCompactionDegraded(degradedHandler);

    manager.setCompleteFn(alwaysFail);
    const context2 = makeContext([...slots, ...sourceHistory]);
    await manager.applyInTransformContext(
      context2,
      (ctx) => ctx.messages.slice(2),
      (ctx, hist) => ({ ...ctx, messages: [...ctx.messages.slice(0, 2), ...hist] }),
      () => sourceHistory,
      (h) => { sourceHistory = h; },
    );

    expect(alwaysFail).toHaveBeenCalledTimes(3);
    expect(degradedHandler).toHaveBeenCalledOnce();
    // Should report exactly 3 failures from this episode, not 4
    expect(degradedHandler.mock.calls[0]![0].layer2Failures).toBe(3);
  });

  // -----------------------------------------------------------------------
  // Test 5: Configurable retry count
  // -----------------------------------------------------------------------

  it('respects configurable maxRetries setting', async () => {
    const singleRetryManager = createManagerForLayer2({
      compaction: {
        threshold: 0.70,
        preserveRecentTurns: 4,
        maxRetries: 1,
        retryDelayMs: 0,
      },
    });
    singleRetryManager.setContextWindow(200_000);
    singleRetryManager.setModelContextWindow(200_000);
    singleRetryManager.updateTokenCount(150_000);

    const mockComplete = vi.fn().mockRejectedValue(new Error('always fails'));
    singleRetryManager.setCompleteFn(mockComplete);

    const exhaustedHandler = vi.fn();
    singleRetryManager.onCompactionExhausted(exhaustedHandler);

    const context = makeContext([...slots, ...history]);
    let src = [...history];

    await singleRetryManager.applyInTransformContext(
      context,
      (ctx) => ctx.messages.slice(2),
      (ctx, hist) => ({ ...ctx, messages: [...ctx.messages.slice(0, 2), ...hist] }),
      () => src,
      (h) => { src = h; },
    );

    // Only 1 attempt (maxRetries: 1)
    expect(mockComplete).toHaveBeenCalledTimes(1);

    // Exhausted should fire with 1 failure
    expect(exhaustedHandler).toHaveBeenCalledOnce();
    expect(exhaustedHandler.mock.calls[0]![0].layer2Failures).toBe(1);
  });
});
