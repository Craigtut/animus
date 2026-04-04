import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CompactionManager,
  buildCompactionConfig,
} from '../../../src/compaction/index.js';
import type { AgentMessage } from '../../../src/context-manager.js';
import type { MicrocompactionConfig, PersistResultFn } from '../../../src/types.js';
import { estimateTokens } from '../../../src/token-estimator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUserMsg(content: string): AgentMessage {
  return { role: 'user', content };
}

function makeAssistantMsg(content: string): AgentMessage {
  return { role: 'assistant', content };
}

/**
 * Create a tool result message with multiple tool_result parts.
 * Each part has a text field and a name field.
 */
function makeMultiToolResultMsg(
  results: Array<{ text: string; name: string }>,
): AgentMessage {
  return {
    role: 'user',
    content: results.map(r => ({
      type: 'tool_result' as const,
      text: r.text,
      name: r.name,
    })),
  };
}

/**
 * Create a tool result message with a single tool_result part.
 */
function makeToolResultMsg(text: string, toolName: string): AgentMessage {
  return {
    role: 'user',
    content: [
      { type: 'tool_result', text, name: toolName },
    ],
  };
}

/**
 * Generate a string of approximately the given token count.
 * estimateTokens uses chars/4, so we generate chars = tokens * 4.
 */
function generateContent(targetTokens: number): string {
  const chars = targetTokens * 4;
  const words: string[] = [];
  let totalChars = 0;
  let i = 0;
  while (totalChars < chars) {
    const word = `word${i}`;
    words.push(word);
    totalChars += word.length + 1; // +1 for space
    i++;
  }
  return words.join(' ').slice(0, chars);
}

// ---------------------------------------------------------------------------
// Tests: Aggregate budgeting in CompactionManager.applyInsertionCap()
// ---------------------------------------------------------------------------

describe('CompactionManager.applyInsertionCap aggregate budget', () => {

  // -----------------------------------------------------------------------
  // Test 1: Over budget - largest results bookended
  // -----------------------------------------------------------------------

  it('bookends the largest result when aggregate exceeds budget', async () => {
    const config = buildCompactionConfig({
      microcompaction: {
        maxResultTokens: 100_000, // high individual cap so Phase 1 doesn't interfere
        maxAggregateTurnTokens: 150_000,
        bookendSize: 200,
      } as MicrocompactionConfig,
    });
    const manager = new CompactionManager(config, 0);

    // 3 tool results at ~60K tokens each = 180K total > 150K budget
    const content1 = generateContent(60_000);
    const content2 = generateContent(60_000);
    const content3 = generateContent(60_000);

    const msg = makeMultiToolResultMsg([
      { text: content1, name: 'Read' },
      { text: content2, name: 'Bash' },
      { text: content3, name: 'WebFetch' },
    ]);

    const messages: AgentMessage[] = [msg];

    await manager.applyInsertionCap(messages, 0);

    // At least one result should have been bookended (trimmed)
    const parts = messages[0]!.content as Array<{ type: string; text?: string }>;
    const bookended = parts.filter(p => p.text?.includes('tokens trimmed'));
    expect(bookended.length).toBeGreaterThanOrEqual(1);

    // The original total was ~180K. After capping, aggregate should be reduced.
    const totalAfter = parts.reduce((sum, p) => {
      if (p.type === 'tool_result' && typeof p.text === 'string') {
        return sum + estimateTokens(p.text);
      }
      return sum;
    }, 0);
    expect(totalAfter).toBeLessThan(180_000);
  });

  // -----------------------------------------------------------------------
  // Test 2: Under budget - no change
  // -----------------------------------------------------------------------

  it('leaves messages unchanged when aggregate is under budget', async () => {
    const config = buildCompactionConfig({
      microcompaction: {
        maxResultTokens: 100_000,
        maxAggregateTurnTokens: 150_000,
        bookendSize: 200,
      } as MicrocompactionConfig,
    });
    const manager = new CompactionManager(config, 0);

    // 3 results at ~30K each = 90K < 150K budget
    const content1 = generateContent(30_000);
    const content2 = generateContent(30_000);
    const content3 = generateContent(30_000);

    const msg = makeMultiToolResultMsg([
      { text: content1, name: 'Read' },
      { text: content2, name: 'Bash' },
      { text: content3, name: 'WebFetch' },
    ]);

    const messages: AgentMessage[] = [msg];
    const originalTexts = (msg.content as Array<{ text?: string }>).map(p => p.text);

    await manager.applyInsertionCap(messages, 0);

    // All parts should be unchanged
    const parts = messages[0]!.content as Array<{ text?: string }>;
    parts.forEach((p, idx) => {
      expect(p.text).toBe(originalTexts[idx]);
    });
  });

  // -----------------------------------------------------------------------
  // Test 3: With persist callback
  // -----------------------------------------------------------------------

  it('invokes persist callback and includes path when over aggregate budget', async () => {
    const persistResult: PersistResultFn = vi.fn()
      .mockResolvedValue('/tmp/compaction/agg-result.txt');

    const config = buildCompactionConfig({
      microcompaction: {
        maxResultTokens: 100_000,
        maxAggregateTurnTokens: 150_000,
        bookendSize: 200,
        persistResult,
      } as MicrocompactionConfig,
    });
    const manager = new CompactionManager(config, 0);

    // 3 results at ~60K each = 180K > 150K
    const content1 = generateContent(60_000);
    const content2 = generateContent(60_000);
    const content3 = generateContent(60_000);

    const msg = makeMultiToolResultMsg([
      { text: content1, name: 'Read' },
      { text: content2, name: 'Bash' },
      { text: content3, name: 'WebFetch' },
    ]);

    const messages: AgentMessage[] = [msg];

    await manager.applyInsertionCap(messages, 0);

    // Persist callback should have been invoked for the largest capped result(s)
    expect(persistResult).toHaveBeenCalled();

    // The bookended part should include the persisted path
    const parts = messages[0]!.content as Array<{ type: string; text?: string }>;
    const withPath = parts.filter(p => p.text?.includes('/tmp/compaction/agg-result.txt'));
    expect(withPath.length).toBeGreaterThanOrEqual(1);
    // The path reference should mention "persisted" or "Read"
    expect(withPath[0]!.text).toContain('persisted');
  });

  // -----------------------------------------------------------------------
  // Test 4: No double-cap
  // -----------------------------------------------------------------------

  it('does not re-cap results already at individual cap threshold', async () => {
    const config = buildCompactionConfig({
      microcompaction: {
        maxResultTokens: 100_000,
        maxAggregateTurnTokens: 150_000,
        bookendSize: 200,
      } as MicrocompactionConfig,
    });
    const manager = new CompactionManager(config, 0);

    // Create a result at exactly maxResultTokens/2 = 50K tokens.
    // The guard `info.tokens <= config.maxResultTokens / 2` should prevent
    // aggregate capping on this result.
    const smallContent = generateContent(50_000); // exactly at the guard
    // Create a large result at 120K to push total above budget
    const largeContent = generateContent(120_000);

    const msg = makeMultiToolResultMsg([
      { text: smallContent, name: 'Read' },
      { text: largeContent, name: 'Bash' },
    ]);

    const messages: AgentMessage[] = [msg];

    await manager.applyInsertionCap(messages, 0);

    const parts = messages[0]!.content as Array<{ type: string; text?: string }>;

    // The small result (50K, at the guard boundary) should NOT be capped by aggregate logic.
    // The guard is `info.tokens <= config.maxResultTokens / 2` which is `<= 50000`.
    // Since the sorted loop breaks when it hits a result at or below this threshold,
    // the 50K result should be preserved.
    const smallPart = parts[0]!;
    expect(smallPart.text).toBe(smallContent);

    // The large result (120K) should have been bookended by aggregate logic
    const largePart = parts[1]!;
    expect(largePart.text).not.toBe(largeContent);
    expect(largePart.text).toContain('tokens trimmed');
  });
});
