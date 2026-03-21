import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runCompaction,
  shouldCompact,
  partitionHistory,
  buildSummaryMessage,
  formatTurnsForSummarization,
  extractSummaryContent,
  COMPACTION_DEFAULTS,
} from '../../../src/compaction/compaction.js';
import type { CompleteFn } from '../../../src/compaction/compaction.js';
import type { AgentMessage } from '../../../src/context-manager.js';
import type { CompactionResult, CompactionTarget } from '../../../src/types.js';

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

function mockComplete(summary = 'This is a test summary.'): CompleteFn {
  return vi.fn().mockResolvedValue(summary);
}

// ---------------------------------------------------------------------------
// Tests: shouldCompact
// ---------------------------------------------------------------------------

describe('shouldCompact', () => {
  it('returns true when usage exceeds threshold', () => {
    expect(shouldCompact(75_000, 100_000, 0.70)).toBe(true);
  });

  it('returns false when usage is below threshold', () => {
    expect(shouldCompact(60_000, 100_000, 0.70)).toBe(false);
  });

  it('returns true at exactly the threshold', () => {
    expect(shouldCompact(70_000, 100_000, 0.70)).toBe(true);
  });

  it('returns false when contextWindow is 0', () => {
    expect(shouldCompact(100, 0, 0.70)).toBe(false);
  });

  it('returns false when contextWindow is negative', () => {
    expect(shouldCompact(100, -1, 0.70)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: partitionHistory
// ---------------------------------------------------------------------------

describe('partitionHistory', () => {
  it('splits history into target and preserved tail', () => {
    const history = buildHistory(10); // 20 messages
    const [target, preserved] = partitionHistory(history, 6);

    expect(target.length).toBe(14);
    expect(preserved.length).toBe(6);
    expect(target[0]).toBe(history[0]);
    expect(preserved[0]).toBe(history[14]);
  });

  it('returns empty target when history is smaller than preserveRecentTurns', () => {
    const history = buildHistory(2); // 4 messages
    const [target, preserved] = partitionHistory(history, 6);

    expect(target.length).toBe(0);
    expect(preserved.length).toBe(4);
  });

  it('returns empty target when history equals preserveRecentTurns', () => {
    const history = buildHistory(3); // 6 messages
    const [target, preserved] = partitionHistory(history, 6);

    expect(target.length).toBe(0);
    expect(preserved.length).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Tests: buildSummaryMessage
// ---------------------------------------------------------------------------

describe('buildSummaryMessage', () => {
  it('wraps summary in compaction-summary XML tags', () => {
    const msg = buildSummaryMessage('Test summary content', 10);

    expect(msg.role).toBe('user');
    expect(typeof msg.content).toBe('string');
    const content = msg.content as string;
    expect(content).toContain('<compaction-summary');
    expect(content).toContain('turns-summarized="10"');
    expect(content).toContain('Test summary content');
    expect(content).toContain('</compaction-summary>');
  });

  it('includes a generated timestamp', () => {
    const msg = buildSummaryMessage('Summary', 5);
    const content = msg.content as string;
    expect(content).toMatch(/generated="\d{4}-\d{2}-\d{2}T/);
  });
});

// ---------------------------------------------------------------------------
// Tests: formatTurnsForSummarization
// ---------------------------------------------------------------------------

describe('formatTurnsForSummarization', () => {
  it('formats turns with role labels and turn numbers', () => {
    const turns = [
      makeUserMsg('Hello'),
      makeAssistantMsg('Hi there'),
    ];

    const result = formatTurnsForSummarization(turns);
    expect(result).toContain('[Turn 1] user:');
    expect(result).toContain('Hello');
    expect(result).toContain('[Turn 2] assistant:');
    expect(result).toContain('Hi there');
  });

  it('preserves full turn content without truncation', () => {
    const longContent = 'x'.repeat(5000);
    const turns = [makeUserMsg(longContent)];

    const result = formatTurnsForSummarization(turns);
    expect(result).not.toContain('truncated for summarization');
    expect(result).toContain(longContent);
  });
});

// ---------------------------------------------------------------------------
// Tests: extractSummaryContent
// ---------------------------------------------------------------------------

describe('extractSummaryContent', () => {
  it('extracts content from <summary> tags', () => {
    const raw = '<analysis>thinking...</analysis>\n<summary>The actual summary</summary>';
    expect(extractSummaryContent(raw)).toBe('The actual summary');
  });

  it('handles multiline summary content', () => {
    const raw = '<analysis>notes</analysis>\n<summary>\n1. First point\n2. Second point\n</summary>';
    expect(extractSummaryContent(raw)).toBe('1. First point\n2. Second point');
  });

  it('falls back to full output when no summary tags present', () => {
    const raw = 'Just a plain summary without tags';
    expect(extractSummaryContent(raw)).toBe('Just a plain summary without tags');
  });

  it('strips analysis tags in fallback mode', () => {
    const raw = '<analysis>thinking...</analysis>\nThe summary without tags';
    expect(extractSummaryContent(raw)).toBe('The summary without tags');
  });

  it('handles empty summary tags', () => {
    const raw = '<analysis>thinking</analysis>\n<summary></summary>';
    // Empty summary falls back to stripping analysis
    const result = extractSummaryContent(raw);
    expect(result).not.toContain('analysis');
    expect(result).not.toContain('thinking');
  });
});

// ---------------------------------------------------------------------------
// Tests: runCompaction
// ---------------------------------------------------------------------------

describe('runCompaction', () => {
  let complete: CompleteFn;

  beforeEach(() => {
    complete = mockComplete('Generated summary of the conversation.');
  });

  it('generates a summary and replaces old history', async () => {
    const history = buildHistory(10); // 20 messages
    const config = { ...COMPACTION_DEFAULTS, preserveRecentTurns: 4 };

    const { newHistory, result } = await runCompaction(history, config, complete);

    // New history: 1 summary message + 4 preserved
    expect(newHistory.length).toBe(5);
    expect(typeof newHistory[0]!.content).toBe('string');
    expect((newHistory[0]!.content as string)).toContain('compaction-summary');

    // Result metrics
    expect(result.turnsCompacted).toBe(16);
    expect(result.turnsPreserved).toBe(4);
    expect(result.summary).toBe('Generated summary of the conversation.');
    expect(result.tokensBefore).toBeGreaterThan(0);
    expect(result.tokensAfter).toBeGreaterThan(0);
    expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
    // oldestPreservedIndex should be the split point (target.length)
    expect(result.oldestPreservedIndex).toBe(16);
    // No ISO timestamps in test messages, so timestamp should be null
    expect(result.oldestPreservedTimestamp).toBeNull();
  });

  it('calls the LLM complete function with the summarization prompt', async () => {
    const history = buildHistory(5);
    const config = { ...COMPACTION_DEFAULTS, preserveRecentTurns: 2 };

    await runCompaction(history, config, complete);

    expect(complete).toHaveBeenCalledOnce();
    const callArgs = (complete as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(callArgs[0]).toHaveProperty('systemPrompt');
    expect(callArgs[0]).toHaveProperty('messages');
  });

  it('uses custom prompt when provided', async () => {
    const history = buildHistory(5);
    const config = {
      ...COMPACTION_DEFAULTS,
      preserveRecentTurns: 2,
      customPrompt: 'Custom summarization instructions',
    };

    await runCompaction(history, config, complete);

    const callArgs = (complete as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(callArgs[0].systemPrompt).toBe('Custom summarization instructions');
  });

  it('throws when not enough history to compact', async () => {
    const history = buildHistory(2); // 4 messages, preserveRecentTurns=6

    await expect(
      runCompaction(history, COMPACTION_DEFAULTS, complete),
    ).rejects.toThrow('Not enough conversation history');
  });

  it('fires onBeforeCompaction handlers and awaits them', async () => {
    const history = buildHistory(5);
    const config = { ...COMPACTION_DEFAULTS, preserveRecentTurns: 2 };
    const beforeHandler = vi.fn().mockResolvedValue(undefined);

    await runCompaction(history, config, complete, {
      onBeforeCompaction: [beforeHandler],
    });

    expect(beforeHandler).toHaveBeenCalledOnce();
    const target = beforeHandler.mock.calls[0]![0] as CompactionTarget;
    expect(target.turnsToCompact).toBe(8);
    expect(target.estimatedTokens).toBeGreaterThan(0);
  });

  it('fires onPostCompaction handlers after completion', async () => {
    const history = buildHistory(5);
    const config = { ...COMPACTION_DEFAULTS, preserveRecentTurns: 2 };
    const postHandler = vi.fn();

    await runCompaction(history, config, complete, {
      onPostCompaction: [postHandler],
    });

    expect(postHandler).toHaveBeenCalledOnce();
    const result = postHandler.mock.calls[0]![0] as CompactionResult;
    expect(result.turnsCompacted).toBe(8);
    expect(result.summary).toBeTruthy();
  });

  it('fires onCompactionError and rethrows when LLM fails', async () => {
    const failingComplete: CompleteFn = vi.fn().mockRejectedValue(
      new Error('LLM API error'),
    );
    const history = buildHistory(5);
    const config = { ...COMPACTION_DEFAULTS, preserveRecentTurns: 2 };
    const errorHandler = vi.fn();

    await expect(
      runCompaction(history, config, failingComplete, {
        onCompactionError: [errorHandler],
      }),
    ).rejects.toThrow('LLM API error');

    expect(errorHandler).toHaveBeenCalledOnce();
    expect(errorHandler.mock.calls[0]![0]).toBeInstanceOf(Error);
  });

  it('handlers fire in registration order', async () => {
    const history = buildHistory(5);
    const config = { ...COMPACTION_DEFAULTS, preserveRecentTurns: 2 };
    const order: number[] = [];

    await runCompaction(history, config, complete, {
      onBeforeCompaction: [
        async () => { order.push(1); },
        async () => { order.push(2); },
      ],
      onPostCompaction: [
        () => { order.push(3); },
        () => { order.push(4); },
      ],
    });

    expect(order).toEqual([1, 2, 3, 4]);
  });

  it('preserved tail contains the most recent messages', async () => {
    const history = buildHistory(5); // 10 messages
    const config = { ...COMPACTION_DEFAULTS, preserveRecentTurns: 4 };

    const { newHistory } = await runCompaction(history, config, complete);

    // Last 4 messages should be preserved verbatim
    const preserved = newHistory.slice(1); // skip summary
    expect(preserved).toEqual(history.slice(-4));
  });

  it('oldestPreservedTimestamp returns ISO date when present in preserved messages', async () => {
    const history = [
      makeUserMsg('Early message'),
      makeAssistantMsg('Early response'),
      makeUserMsg('Middle message'),
      makeAssistantMsg('Middle response'),
      makeUserMsg('Message with timestamp 2026-03-15T10:30:00Z'),
      makeAssistantMsg('Final response'),
    ];
    const config = { ...COMPACTION_DEFAULTS, preserveRecentTurns: 2 };

    const { result } = await runCompaction(history, config, complete);

    expect(result.oldestPreservedTimestamp).toBe('2026-03-15T10:30:00');
    expect(result.oldestPreservedIndex).toBe(4);
  });

  it('oldestPreservedTimestamp is null when no ISO date in preserved messages', async () => {
    const history = buildHistory(5);
    const config = { ...COMPACTION_DEFAULTS, preserveRecentTurns: 2 };

    const { result } = await runCompaction(history, config, complete);

    expect(result.oldestPreservedTimestamp).toBeNull();
    // Index should be total messages - preserved turns
    expect(result.oldestPreservedIndex).toBe(8);
  });
});
