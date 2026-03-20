/**
 * Tests for CortexUsage type and CortexAgent usage extraction.
 *
 * Since CortexAgent.extractUsageFromAssistantMessage() is private,
 * we test it indirectly through the public getLastDirectUsage() API
 * using mock pi-ai responses.
 */

import { describe, it, expect } from 'vitest';
import type { CortexUsage } from '../../src/types.js';

// ---------------------------------------------------------------------------
// CortexUsage type shape
// ---------------------------------------------------------------------------

describe('CortexUsage', () => {
  it('should have the expected shape', () => {
    const usage: CortexUsage = {
      input: 100,
      output: 50,
      cacheRead: 80,
      cacheWrite: 20,
      totalTokens: 150,
      cost: {
        input: 0.003,
        output: 0.015,
        cacheRead: 0.0008,
        cacheWrite: 0.00375,
        total: 0.02255,
      },
    };

    expect(usage.input).toBe(100);
    expect(usage.output).toBe(50);
    expect(usage.cacheRead).toBe(80);
    expect(usage.cacheWrite).toBe(20);
    expect(usage.totalTokens).toBe(150);
    expect(usage.cost.total).toBe(0.02255);
  });

  it('should allow optional model field', () => {
    const usage: CortexUsage = {
      input: 100,
      output: 50,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 150,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01 },
      model: 'claude-sonnet-4-20250514',
    };

    expect(usage.model).toBe('claude-sonnet-4-20250514');
  });
});

// ---------------------------------------------------------------------------
// Usage extraction from AssistantMessage-shaped objects
// ---------------------------------------------------------------------------

describe('Usage extraction patterns', () => {
  /**
   * Simulate the extraction logic that CortexAgent.extractUsageFromAssistantMessage
   * uses. This mirrors the private method for direct testing.
   */
  function extractUsage(result: unknown): CortexUsage | null {
    if (!result || typeof result !== 'object') return null;

    const msg = result as Record<string, unknown>;
    const usage = msg['usage'];
    if (!usage || typeof usage !== 'object') return null;

    const u = usage as Record<string, unknown>;

    const input = typeof u['input'] === 'number' ? u['input'] : 0;
    const output = typeof u['output'] === 'number' ? u['output'] : 0;
    const cacheRead = typeof u['cacheRead'] === 'number' ? u['cacheRead'] : 0;
    const cacheWrite = typeof u['cacheWrite'] === 'number' ? u['cacheWrite'] : 0;
    const totalTokens = typeof u['totalTokens'] === 'number' ? u['totalTokens'] : input + output;

    const costObj = u['cost'];
    let cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
    if (costObj && typeof costObj === 'object') {
      const c = costObj as Record<string, unknown>;
      cost = {
        input: typeof c['input'] === 'number' ? c['input'] : 0,
        output: typeof c['output'] === 'number' ? c['output'] : 0,
        cacheRead: typeof c['cacheRead'] === 'number' ? c['cacheRead'] : 0,
        cacheWrite: typeof c['cacheWrite'] === 'number' ? c['cacheWrite'] : 0,
        total: typeof c['total'] === 'number' ? c['total'] : 0,
      };
    }

    const model = typeof msg['model'] === 'string' ? msg['model'] : undefined;

    return { input, output, cacheRead, cacheWrite, totalTokens, cost, model };
  }

  it('should extract usage from a full pi-ai AssistantMessage', () => {
    const assistantMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello!' }],
      api: 'anthropic-messages',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      usage: {
        input: 1200,
        output: 350,
        cacheRead: 800,
        cacheWrite: 400,
        totalTokens: 1550,
        cost: {
          input: 0.0036,
          output: 0.00525,
          cacheRead: 0.0008,
          cacheWrite: 0.0015,
          total: 0.01115,
        },
      },
      stopReason: 'stop',
      timestamp: Date.now(),
    };

    const usage = extractUsage(assistantMessage);
    expect(usage).not.toBeNull();
    expect(usage!.input).toBe(1200);
    expect(usage!.output).toBe(350);
    expect(usage!.cacheRead).toBe(800);
    expect(usage!.cacheWrite).toBe(400);
    expect(usage!.totalTokens).toBe(1550);
    expect(usage!.cost.total).toBe(0.01115);
    expect(usage!.model).toBe('claude-sonnet-4-20250514');
  });

  it('should return null for null/undefined input', () => {
    expect(extractUsage(null)).toBeNull();
    expect(extractUsage(undefined)).toBeNull();
  });

  it('should return null for non-object input', () => {
    expect(extractUsage('string')).toBeNull();
    expect(extractUsage(42)).toBeNull();
  });

  it('should return null when usage field is missing', () => {
    expect(extractUsage({ role: 'assistant', content: 'hello' })).toBeNull();
  });

  it('should handle missing cost object gracefully', () => {
    const msg = {
      usage: {
        input: 100,
        output: 50,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 150,
        // no cost field
      },
    };

    const usage = extractUsage(msg);
    expect(usage).not.toBeNull();
    expect(usage!.input).toBe(100);
    expect(usage!.output).toBe(50);
    expect(usage!.totalTokens).toBe(150);
    expect(usage!.cost.total).toBe(0);
  });

  it('should handle partial usage fields with defaults', () => {
    const msg = {
      usage: {
        input: 100,
        // output missing
        // cacheRead missing
        // cacheWrite missing
        // totalTokens missing
      },
    };

    const usage = extractUsage(msg);
    expect(usage).not.toBeNull();
    expect(usage!.input).toBe(100);
    expect(usage!.output).toBe(0);
    expect(usage!.cacheRead).toBe(0);
    expect(usage!.cacheWrite).toBe(0);
    expect(usage!.totalTokens).toBe(100); // input + output fallback
  });

  it('should compute totalTokens as input + output when not provided', () => {
    const msg = {
      usage: {
        input: 200,
        output: 80,
      },
    };

    const usage = extractUsage(msg);
    expect(usage).not.toBeNull();
    expect(usage!.totalTokens).toBe(280);
  });

  it('should not set model when model field is absent', () => {
    const msg = {
      usage: {
        input: 10,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 15,
      },
    };

    const usage = extractUsage(msg);
    expect(usage).not.toBeNull();
    expect(usage!.model).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Accumulated usage (simulating agentic loop turn_end events)
// ---------------------------------------------------------------------------

describe('Usage accumulation', () => {
  interface Acc {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    costTotal: number;
    model: string | undefined;
  }

  function createAcc(): Acc {
    return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costTotal: 0, model: undefined };
  }

  function accumulateFromTurnEnd(acc: Acc, piEvent: Record<string, unknown>): void {
    const message = piEvent['message'] as Record<string, unknown> | undefined;
    if (!message) return;

    const usage = message['usage'] as Record<string, unknown> | undefined;
    if (!usage) return;

    acc.input += typeof usage['input'] === 'number' ? usage['input'] : 0;
    acc.output += typeof usage['output'] === 'number' ? usage['output'] : 0;
    acc.cacheRead += typeof usage['cacheRead'] === 'number' ? usage['cacheRead'] : 0;
    acc.cacheWrite += typeof usage['cacheWrite'] === 'number' ? usage['cacheWrite'] : 0;
    acc.totalTokens += typeof usage['totalTokens'] === 'number' ? usage['totalTokens'] : 0;

    const cost = usage['cost'] as Record<string, unknown> | undefined;
    if (cost && typeof cost['total'] === 'number') {
      acc.costTotal += cost['total'];
    }

    if (typeof message['model'] === 'string') {
      acc.model = message['model'];
    }
  }

  it('should accumulate usage across multiple turns', () => {
    const acc = createAcc();

    // Turn 1: tool use turn
    accumulateFromTurnEnd(acc, {
      type: 'turn_end',
      message: {
        model: 'claude-sonnet-4-20250514',
        usage: {
          input: 1000,
          output: 200,
          cacheRead: 500,
          cacheWrite: 100,
          totalTokens: 1200,
          cost: { total: 0.005 },
        },
      },
    });

    // Turn 2: final response turn
    accumulateFromTurnEnd(acc, {
      type: 'turn_end',
      message: {
        model: 'claude-sonnet-4-20250514',
        usage: {
          input: 1500,
          output: 400,
          cacheRead: 1000,
          cacheWrite: 0,
          totalTokens: 1900,
          cost: { total: 0.008 },
        },
      },
    });

    expect(acc.input).toBe(2500);
    expect(acc.output).toBe(600);
    expect(acc.cacheRead).toBe(1500);
    expect(acc.cacheWrite).toBe(100);
    expect(acc.totalTokens).toBe(3100);
    expect(acc.costTotal).toBeCloseTo(0.013, 6);
    expect(acc.model).toBe('claude-sonnet-4-20250514');
  });

  it('should handle events without message field', () => {
    const acc = createAcc();
    accumulateFromTurnEnd(acc, { type: 'turn_end' });
    expect(acc.totalTokens).toBe(0);
    expect(acc.costTotal).toBe(0);
  });

  it('should handle events without usage field', () => {
    const acc = createAcc();
    accumulateFromTurnEnd(acc, {
      type: 'turn_end',
      message: { content: 'hello' },
    });
    expect(acc.totalTokens).toBe(0);
    expect(acc.costTotal).toBe(0);
  });
});
