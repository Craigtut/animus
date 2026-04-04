import { describe, it, expect, beforeEach } from 'vitest';
import {
  MicrocompactionEngine,
  capToolResult,
  computeTrimState,
  applyTrimAction,
  applyBookend,
  getActiveThresholdIndex,
  extractTextContent,
  isToolResultMessage,
  isToolUseMessage,
  extractToolName,
  getToolCategory,
  MICROCOMPACTION_DEFAULTS,
} from '../../../src/compaction/microcompaction.js';
import type { AgentMessage } from '../../../src/context-manager.js';
import type { MicrocompactionConfig } from '../../../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUserMsg(content: string): AgentMessage {
  return { role: 'user', content };
}

function makeAssistantMsg(content: string): AgentMessage {
  return { role: 'assistant', content };
}

function makeToolResult(content: string, toolName?: string): AgentMessage {
  return {
    role: 'user',
    content: [
      { type: 'tool_result', text: content, ...(toolName ? { name: toolName } : {}) },
    ],
  };
}

function makeToolUse(toolName: string): AgentMessage {
  return {
    role: 'assistant',
    content: [
      { type: 'tool_use', name: toolName },
    ],
  };
}

function generateLargeContent(wordCount: number): string {
  const words: string[] = [];
  for (let i = 0; i < wordCount; i++) {
    words.push(`word${i}`);
  }
  return words.join(' ');
}

// ---------------------------------------------------------------------------
// Tests: Insertion-time cap
// ---------------------------------------------------------------------------

describe('capToolResult', () => {
  it('returns content unchanged when below maxResultTokens', () => {
    const content = 'small result';
    const result = capToolResult(content, { maxResultTokens: 50_000, bookendSize: 2000 });
    expect(result).toBe(content);
  });

  it('truncates content exceeding maxResultTokens to bookend format', () => {
    // Generate content that will exceed 50k tokens
    // estimateTokens: words * 1.3, so ~40000 words = ~52000 tokens
    const content = generateLargeContent(40_000);
    const result = capToolResult(content, { maxResultTokens: 50_000, bookendSize: 200 });

    expect(result).toContain('tokens trimmed at insertion');
    expect(result.length).toBeLessThan(content.length);
  });

  it('uses configurable bookendSize', () => {
    const content = generateLargeContent(40_000);
    const result = capToolResult(content, { maxResultTokens: 50_000, bookendSize: 100 });

    // The result should be shorter when bookendSize is small
    expect(result).toContain('tokens trimmed at insertion');
  });

  it('returns content unchanged when bookendSize exceeds content length', () => {
    const content = 'small';
    const result = capToolResult(content, { maxResultTokens: 1, bookendSize: 10_000 });
    expect(result).toBe(content);
  });
});

// ---------------------------------------------------------------------------
// Tests: Content extraction helpers
// ---------------------------------------------------------------------------

describe('extractTextContent', () => {
  it('extracts from string content', () => {
    const msg = makeUserMsg('hello world');
    expect(extractTextContent(msg)).toBe('hello world');
  });

  it('extracts from content array with text parts', () => {
    const msg: AgentMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'part1' },
        { type: 'text', text: ' part2' },
      ],
    };
    expect(extractTextContent(msg)).toBe('part1 part2');
  });

  it('extracts text from all parts including tool_result', () => {
    const msg: AgentMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'hello' },
        { type: 'tool_result', text: 'result' },
      ],
    };
    // extractTextContent extracts text from any part with a text field
    expect(extractTextContent(msg)).toBe('helloresult');
  });
});

describe('isToolResultMessage', () => {
  it('returns true for tool result messages', () => {
    expect(isToolResultMessage(makeToolResult('result'))).toBe(true);
  });

  it('returns false for string content messages', () => {
    expect(isToolResultMessage(makeUserMsg('hello'))).toBe(false);
  });

  it('returns false for content arrays without tool_result type', () => {
    const msg: AgentMessage = {
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
    };
    expect(isToolResultMessage(msg)).toBe(false);
  });
});

describe('isToolUseMessage', () => {
  it('returns true for tool use messages', () => {
    expect(isToolUseMessage(makeToolUse('Read'))).toBe(true);
  });

  it('returns false for user messages', () => {
    expect(isToolUseMessage(makeUserMsg('hello'))).toBe(false);
  });

  it('returns false for assistant messages without tool_use', () => {
    expect(isToolUseMessage(makeAssistantMsg('thinking'))).toBe(false);
  });
});

describe('extractToolName', () => {
  it('extracts name from tool_use message', () => {
    expect(extractToolName(makeToolUse('Read'))).toBe('Read');
  });

  it('extracts name from tool_result message with name', () => {
    expect(extractToolName(makeToolResult('content', 'Glob'))).toBe('Glob');
  });

  it('returns null for string content messages', () => {
    expect(extractToolName(makeUserMsg('hello'))).toBeNull();
  });
});

describe('getToolCategory', () => {
  it('returns default category for built-in tools', () => {
    expect(getToolCategory('Read')).toBe('rereadable');
    expect(getToolCategory('Glob')).toBe('rereadable');
    expect(getToolCategory('Grep')).toBe('rereadable');
    expect(getToolCategory('WebFetch')).toBe('non-reproducible');
    expect(getToolCategory('Bash')).toBe('non-reproducible');
    expect(getToolCategory('SubAgent')).toBe('ephemeral');
  });

  it('returns custom category when provided', () => {
    const custom = { MyTool: 'rereadable' as const };
    expect(getToolCategory('MyTool', custom)).toBe('rereadable');
  });

  it('custom categories override defaults', () => {
    const custom = { Read: 'non-reproducible' as const };
    expect(getToolCategory('Read', custom)).toBe('non-reproducible');
  });

  it('returns undefined for unknown tools without custom categories', () => {
    expect(getToolCategory('UnknownTool')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: Threshold index
// ---------------------------------------------------------------------------

describe('getActiveThresholdIndex', () => {
  const config = MICROCOMPACTION_DEFAULTS;

  it('returns -1 below all thresholds', () => {
    expect(getActiveThresholdIndex(0.30, config)).toBe(-1);
  });

  it('returns 0 at 40% threshold', () => {
    expect(getActiveThresholdIndex(0.40, config)).toBe(0);
  });

  it('returns 1 at 50% threshold', () => {
    expect(getActiveThresholdIndex(0.50, config)).toBe(1);
  });

  it('returns 2 at 60% threshold', () => {
    expect(getActiveThresholdIndex(0.60, config)).toBe(2);
  });

  it('returns 2 above 60%', () => {
    expect(getActiveThresholdIndex(0.80, config)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Tests: Trim state computation
// ---------------------------------------------------------------------------

describe('computeTrimState', () => {
  const config: MicrocompactionConfig = {
    ...MICROCOMPACTION_DEFAULTS,
    preserveRecentTurns: 2,
    bookendSize: 100,
  };

  it('returns empty actions when no tool results exist', () => {
    const history: AgentMessage[] = [
      makeUserMsg('hello'),
      makeAssistantMsg('hi'),
      makeUserMsg('question'),
      makeAssistantMsg('answer'),
    ];

    const state = computeTrimState(history, 0, config);
    expect(state.actions.size).toBe(0);
  });

  it('preserves recent tool results', () => {
    // 3 assistant turns, preserveRecentTurns=2
    const history: AgentMessage[] = [
      makeToolUse('Read'),
      makeToolResult('old content', 'Read'),
      makeAssistantMsg('analysis of old'),
      makeToolUse('Read'),
      makeToolResult('middle content', 'Read'),
      makeAssistantMsg('analysis of middle'),
      makeToolUse('Read'),
      makeToolResult('recent content', 'Read'),
      makeAssistantMsg('analysis of recent'),
    ];

    const state = computeTrimState(history, 0, config);

    // The oldest tool result (index 1) should be trimmed
    expect(state.actions.has(1)).toBe(true);
    // The most recent tool results should be preserved
    expect(state.actions.has(7)).toBe(false);
  });

  it('assigns bookend action at threshold 0 (40%)', () => {
    const history: AgentMessage[] = [
      makeToolUse('Read'),
      makeToolResult('old content that is long enough', 'Read'),
      makeAssistantMsg('old analysis'),
      makeAssistantMsg('more analysis'),
      makeAssistantMsg('recent turn'),
    ];

    const state = computeTrimState(history, 0, config);

    // Index 1 is a tool result beyond the recency window
    const action = state.actions.get(1);
    expect(action).toBeDefined();
    if (action) {
      expect(action.kind).toBe('bookend');
    }
  });

  it('assigns placeholder action at threshold 1 (50%)', () => {
    const history: AgentMessage[] = [
      makeToolUse('Read'),
      makeToolResult('old content', 'Read'),
      makeAssistantMsg('old analysis'),
      makeAssistantMsg('more analysis'),
      makeAssistantMsg('recent turn'),
    ];

    const state = computeTrimState(history, 1, config);

    const action = state.actions.get(1);
    expect(action).toBeDefined();
    if (action) {
      expect(action.kind).toBe('placeholder');
    }
  });

  it('clears rereadable tools at threshold 2 (60%)', () => {
    const history: AgentMessage[] = [
      makeToolUse('Read'),
      makeToolResult('old content', 'Read'),
      makeAssistantMsg('old analysis'),
      makeAssistantMsg('more analysis'),
      makeAssistantMsg('recent turn'),
    ];

    const state = computeTrimState(history, 2, config);

    const action = state.actions.get(1);
    expect(action).toBeDefined();
    if (action) {
      expect(action.kind).toBe('clear');
    }
  });

  it('keeps non-reproducible tools in bookend at threshold 2 (60%)', () => {
    // Need enough assistant turns to push the tool result outside
    // the extended retention window (preserveRecentTurns * extendedRetentionMultiplier = 2 * 2 = 4).
    // With 6 assistant turns, the tool at position 0 has distance 5, which exceeds 4.
    const history: AgentMessage[] = [
      makeToolUse('Bash'),
      makeToolResult('bash output', 'Bash'),
      makeAssistantMsg('old analysis'),
      makeAssistantMsg('more analysis'),
      makeAssistantMsg('turn 3'),
      makeAssistantMsg('turn 4'),
      makeAssistantMsg('turn 5'),
      makeAssistantMsg('recent turn'),
    ];

    const state = computeTrimState(history, 2, config);

    const action = state.actions.get(1);
    expect(action).toBeDefined();
    if (action) {
      expect(action.kind).toBe('bookend');
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: Apply trim action
// ---------------------------------------------------------------------------

describe('applyTrimAction', () => {
  it('returns message unchanged for full action', () => {
    const msg = makeToolResult('content', 'Read');
    const result = applyTrimAction(msg, { kind: 'full' });
    expect(result).toBe(msg);
  });

  it('applies bookend format', () => {
    // Use string content for simpler extraction
    const content = 'A'.repeat(200) + 'B'.repeat(200);
    const msg: AgentMessage = {
      role: 'user',
      content,
    };
    const result = applyTrimAction(msg, {
      kind: 'bookend',
      headChars: 50,
      tailChars: 50,
      originalTokens: 100,
    });

    const text = extractTextContent(result);
    expect(text).toContain('tokens trimmed');
    expect(text.length).toBeLessThan(content.length);
  });

  it('applies placeholder format', () => {
    const msg = makeToolResult('content', 'Read');
    const result = applyTrimAction(msg, {
      kind: 'placeholder',
      toolName: 'Read',
      preview: 'file content preview',
    });

    const text = extractTextContent(result);
    expect(text).toContain('Tool result trimmed');
    expect(text).toContain('Read');
  });

  it('applies clear format', () => {
    const msg = makeToolResult('content', 'Read');
    const result = applyTrimAction(msg, { kind: 'clear' });

    const text = extractTextContent(result);
    expect(text).toBe('[Tool result cleared]');
  });
});

describe('applyBookend', () => {
  it('returns content unchanged when head+tail exceeds content length', () => {
    const result = applyBookend('short', 100, 100, 10);
    expect(result).toBe('short');
  });

  it('produces head + marker + tail format', () => {
    const content = 'START' + 'x'.repeat(500) + 'END';
    const result = applyBookend(content, 10, 10, 200);
    // First 10 chars = 'STARTxxxxx'
    expect(result.startsWith('START')).toBe(true);
    // Last 10 chars of original = 'xxxxxxxEND'
    expect(result).toContain('END');
    expect(result).toContain('tokens trimmed');
    expect(result.length).toBeLessThan(content.length);
  });
});

// ---------------------------------------------------------------------------
// Tests: MicrocompactionEngine
// ---------------------------------------------------------------------------

describe('MicrocompactionEngine', () => {
  let engine: MicrocompactionEngine;

  beforeEach(() => {
    engine = new MicrocompactionEngine({
      preserveRecentTurns: 2,
      bookendSize: 100,
    });
  });

  it('returns history unchanged below thresholds', async () => {
    const history: AgentMessage[] = [
      makeToolUse('Read'),
      makeToolResult('content', 'Read'),
      makeAssistantMsg('analysis'),
    ];

    // 30% usage, below 40% threshold
    const result = await engine.apply(history, 100_000, 30_000);
    expect(result).toEqual(history);
  });

  it('applies trimming at 40% threshold', async () => {
    // Content must be longer than 2 * bookendSize (200 chars) to actually be bookended
    const longContent = 'A'.repeat(300);
    const history: AgentMessage[] = [
      makeToolUse('Read'),
      makeToolResult(longContent, 'Read'),
      makeAssistantMsg('old analysis'),
      makeAssistantMsg('more recent'),
      makeAssistantMsg('most recent'),
    ];

    // 45% usage, above 40% threshold
    const result = await engine.apply(history, 100_000, 45_000);

    // The old tool result should be modified (bookended)
    const oldToolResult = extractTextContent(result[1]!);
    expect(oldToolResult).not.toBe(longContent);
    expect(oldToolResult).toContain('tokens trimmed');
  });

  it('caches trim state between threshold crossings', async () => {
    const history: AgentMessage[] = [
      makeToolUse('Read'),
      makeToolResult('content', 'Read'),
      makeAssistantMsg('analysis'),
      makeAssistantMsg('recent 1'),
      makeAssistantMsg('recent 2'),
    ];

    // First call at 45% triggers computation
    await engine.apply(history, 100_000, 45_000);
    const firstState = engine.getCachedState();
    expect(firstState).not.toBeNull();

    // Second call at 45% should reuse cache
    await engine.apply(history, 100_000, 45_000);
    const secondState = engine.getCachedState();
    expect(secondState).toBe(firstState);
  });

  it('recomputes when threshold advances', async () => {
    const history: AgentMessage[] = [
      makeToolUse('Read'),
      makeToolResult('content', 'Read'),
      makeAssistantMsg('analysis'),
      makeAssistantMsg('recent 1'),
      makeAssistantMsg('recent 2'),
    ];

    // First call at 45%
    await engine.apply(history, 100_000, 45_000);
    const firstLevel = engine.getCachedState()?.thresholdLevel;

    // Second call at 55% - should advance threshold
    await engine.apply(history, 100_000, 55_000);
    const secondLevel = engine.getCachedState()?.thresholdLevel;

    expect(secondLevel).toBeGreaterThan(firstLevel!);
  });

  it('returns empty array for empty history', async () => {
    const result = await engine.apply([], 100_000, 50_000);
    expect(result).toEqual([]);
  });

  it('returns history unchanged when contextWindow is 0', async () => {
    const history = [makeUserMsg('hello')];
    const result = await engine.apply(history, 0, 0);
    expect(result).toEqual(history);
  });

  it('resets cache on resetCache()', async () => {
    const history = [
      makeToolResult('content', 'Read'),
      makeAssistantMsg('analysis'),
      makeAssistantMsg('recent'),
    ];

    await engine.apply(history, 100_000, 45_000);
    expect(engine.getCachedState()).not.toBeNull();

    engine.resetCache();
    expect(engine.getCachedState()).toBeNull();
  });

  describe('capAtInsertion', () => {
    it('caps large content', () => {
      const large = generateLargeContent(40_000);
      const result = engine.capAtInsertion(large);
      expect(result.length).toBeLessThan(large.length);
      expect(result).toContain('tokens trimmed at insertion');
    });

    it('passes through small content', () => {
      const small = 'hello world';
      const result = engine.capAtInsertion(small);
      expect(result).toBe(small);
    });
  });
});
