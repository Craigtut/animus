import { describe, it, expect } from 'vitest';
import {
  emergencyTruncate,
  shouldTruncate,
  isContextOverflow,
} from '../../../src/compaction/failsafe.js';
import type { AgentMessage } from '../../../src/context-manager.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUserMsg(content: string): AgentMessage {
  return { role: 'user', content };
}

function makeAssistantMsg(content: string): AgentMessage {
  return { role: 'assistant', content };
}

function makeToolUse(toolName: string): AgentMessage {
  return {
    role: 'assistant',
    content: [
      { type: 'tool_use', name: toolName },
    ],
  };
}

function makeToolResult(content: string, toolName?: string): AgentMessage {
  return {
    role: 'user',
    content: [
      { type: 'tool_result', text: content, ...(toolName ? { name: toolName } : {}) },
    ],
  };
}

/**
 * Generate a history that will use approximately targetTokens in total.
 * Each message is padded with words to reach the target.
 */
function buildLargeHistory(messageCount: number, wordsPerMessage: number): AgentMessage[] {
  const history: AgentMessage[] = [];
  for (let i = 0; i < messageCount; i++) {
    const words: string[] = [];
    for (let w = 0; w < wordsPerMessage; w++) {
      words.push(`word${w}`);
    }
    const content = words.join(' ');
    history.push(i % 2 === 0 ? makeUserMsg(content) : makeAssistantMsg(content));
  }
  return history;
}

// ---------------------------------------------------------------------------
// Tests: shouldTruncate
// ---------------------------------------------------------------------------

describe('shouldTruncate', () => {
  it('returns true when usage exceeds threshold', () => {
    expect(shouldTruncate(95_000, 100_000, 0.90)).toBe(true);
  });

  it('returns false when usage is below threshold', () => {
    expect(shouldTruncate(80_000, 100_000, 0.90)).toBe(false);
  });

  it('returns true at exactly the threshold', () => {
    expect(shouldTruncate(90_000, 100_000, 0.90)).toBe(true);
  });

  it('returns false when contextWindow is 0', () => {
    expect(shouldTruncate(100, 0, 0.90)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: emergencyTruncate
// ---------------------------------------------------------------------------

describe('emergencyTruncate', () => {
  it('preserves the last 3 turns', () => {
    const history: AgentMessage[] = [
      makeUserMsg('old1'),
      makeAssistantMsg('old2'),
      makeUserMsg('old3'),
      makeAssistantMsg('old4'),
      makeUserMsg('recent1'),
      makeAssistantMsg('recent2'),
      makeUserMsg('recent3'),
    ];

    // Force truncation by using a small context window
    const result = emergencyTruncate(history, 100, 0, 0.01);

    // Last 3 messages should always be preserved
    expect(result.newHistory.length).toBeGreaterThanOrEqual(3);
    const last3 = result.newHistory.slice(-3);
    expect(last3).toEqual(history.slice(-3));
  });

  it('drops oldest turns first', () => {
    // 10 messages, 200 words each = ~260 tokens each = ~2600 total
    // With contextWindow=500 and threshold=0.10, target=50 tokens
    // This forces aggressive truncation
    const history = buildLargeHistory(10, 200);

    const result = emergencyTruncate(history, 500, 0, 0.10);

    // Some turns should have been removed
    expect(result.turnsRemoved).toBeGreaterThan(0);
    expect(result.newHistory.length).toBeLessThan(history.length);

    // The remaining messages should be the tail of the original
    const lastMessages = history.slice(-result.newHistory.length);
    expect(result.newHistory).toEqual(lastMessages);
  });

  it('drops tool_use/tool_result pairs together', () => {
    const history: AgentMessage[] = [
      makeToolUse('Read'),           // 0
      makeToolResult('file content', 'Read'), // 1
      makeAssistantMsg('analysis'),  // 2
      makeUserMsg('recent1'),        // 3
      makeAssistantMsg('recent2'),   // 4
      makeUserMsg('recent3'),        // 5
    ];

    // Force truncation
    const result = emergencyTruncate(history, 100, 0, 0.01);

    // The tool_use and tool_result should both be dropped or both preserved
    const hasToolUse = result.newHistory.some(m =>
      m.role === 'assistant' && Array.isArray(m.content) &&
      m.content.some(p => p.type === 'tool_use'),
    );
    const hasToolResult = result.newHistory.some(m =>
      m.role === 'user' && Array.isArray(m.content) &&
      m.content.some(p => p.type === 'tool_result'),
    );

    // Either both exist or neither
    expect(hasToolUse).toBe(hasToolResult);
  });

  it('returns unchanged history when already below threshold', () => {
    const history: AgentMessage[] = [
      makeUserMsg('hello'),
      makeAssistantMsg('hi'),
    ];

    // Huge context window, should not truncate
    const result = emergencyTruncate(history, 1_000_000, 0, 0.90);

    expect(result.turnsRemoved).toBe(0);
    expect(result.newHistory).toEqual(history);
  });

  it('returns empty array for empty history', () => {
    const result = emergencyTruncate([], 100, 0, 0.90);

    expect(result.newHistory).toEqual([]);
    expect(result.turnsRemoved).toBe(0);
  });

  it('reports correct turnsRemoved count', () => {
    const history = buildLargeHistory(20, 100);

    const result = emergencyTruncate(history, 500, 0, 0.90);

    expect(result.turnsRemoved).toBe(
      history.length - result.newHistory.length,
    );
  });

  it('reports tokensAfter correctly', () => {
    const history = buildLargeHistory(10, 50);

    const result = emergencyTruncate(history, 500, 100, 0.90);

    // tokensAfter should include the slot tokens
    expect(result.tokensAfter).toBeGreaterThanOrEqual(100);
    // tokensAfter should be less than contextWindow * threshold if truncation happened
    if (result.turnsRemoved > 0) {
      expect(result.tokensAfter).toBeLessThanOrEqual(500 * 0.90 + 100);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: isContextOverflow
// ---------------------------------------------------------------------------

describe('isContextOverflow', () => {
  it('detects context_length_exceeded', () => {
    expect(isContextOverflow(new Error('context_length_exceeded'))).toBe(true);
  });

  it('detects "context window" error', () => {
    expect(isContextOverflow(new Error('Exceeded context window limit'))).toBe(true);
  });

  it('detects "maximum context length"', () => {
    expect(isContextOverflow(new Error('maximum context length exceeded'))).toBe(true);
  });

  it('detects "token limit"', () => {
    expect(isContextOverflow(new Error('token limit exceeded'))).toBe(true);
  });

  it('detects "too many tokens"', () => {
    expect(isContextOverflow(new Error('Request has too many tokens'))).toBe(true);
  });

  it('detects "request too large"', () => {
    expect(isContextOverflow(new Error('request too large'))).toBe(true);
  });

  it('detects "prompt is too long"', () => {
    expect(isContextOverflow(new Error('prompt is too long'))).toBe(true);
  });

  it('detects "input too long"', () => {
    expect(isContextOverflow(new Error('input too long for this model'))).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isContextOverflow(new Error('connection refused'))).toBe(false);
    expect(isContextOverflow(new Error('invalid API key'))).toBe(false);
    expect(isContextOverflow(new Error('rate limited'))).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isContextOverflow(new Error('CONTEXT_LENGTH_EXCEEDED'))).toBe(true);
    expect(isContextOverflow(new Error('Token Limit Exceeded'))).toBe(true);
  });
});
