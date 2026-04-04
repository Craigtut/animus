import { describe, it, expect, vi } from 'vitest';
import {
  MicrocompactionEngine,
} from '../../../src/compaction/microcompaction.js';
import type { AgentMessage } from '../../../src/context-manager.js';
import type { MicrocompactionConfig, PersistResultFn } from '../../../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAssistantMsg(content: string): AgentMessage {
  return { role: 'assistant', content };
}

function makeToolResult(content: string, toolName: string): AgentMessage {
  return {
    role: 'user',
    content: [
      { type: 'tool_result', text: content, name: toolName },
    ],
  };
}

/**
 * Build history with a tool result at the start followed by enough
 * assistant turns to push it outside the recency/retention window.
 */
function buildHistoryWithOldToolResult(
  toolContent: string,
  toolName: string,
  assistantTurns: number,
): AgentMessage[] {
  const history: AgentMessage[] = [];
  history.push(makeToolResult(toolContent, toolName));
  for (let i = 0; i < assistantTurns; i++) {
    history.push(makeAssistantMsg(`Assistant turn ${i}`));
  }
  return history;
}

/**
 * Create a MicrocompactionEngine configured for testing.
 *
 * preserveRecentTurns=2, extendedRetentionMultiplier=2.
 * Non-reproducible retention window = 2 * 2 = 4.
 * At threshold 1 (50%), non-reproducible outside retentionWindow * 2 (= 8) gets placeholder.
 * At threshold 2 (60%), rereadable gets clear.
 */
function createEngine(persistResult?: PersistResultFn): MicrocompactionEngine {
  const config: Partial<MicrocompactionConfig> = {
    preserveRecentTurns: 2,
    bookendSize: 100,
    softTrimThreshold: 0.40,
    hardClearThreshold: 0.60,
    toolCategories: {
      WebFetch: 'non-reproducible',
      Bash: 'non-reproducible',
      Read: 'rereadable',
      Glob: 'rereadable',
      Grep: 'rereadable',
      SubAgent: 'ephemeral',
    },
    ...(persistResult ? { persistResult } : {}),
  };
  return new MicrocompactionEngine(config);
}

// ---------------------------------------------------------------------------
// Tests: Disk persistence in MicrocompactionEngine (maybePersistBeforeTrim)
// ---------------------------------------------------------------------------

describe('MicrocompactionEngine disk persistence', () => {

  // -----------------------------------------------------------------------
  // Test 1: Non-reproducible result persisted via callback
  //
  // At threshold 1 (50%), non-reproducible tools outside the extended
  // retention window (retentionWindow * 2 = 8) receive a `placeholder`
  // action, which is destructive and triggers maybePersistBeforeTrim.
  // -----------------------------------------------------------------------

  it('persists non-reproducible results via callback and includes path in placeholder', async () => {
    const persistResult = vi.fn().mockResolvedValue('/tmp/compaction/result-0.txt');
    const engine = createEngine(persistResult);

    const toolContent = 'WebFetch result content that is substantial enough to test persistence behavior';
    // Need 9+ assistant turns so the tool result at index 0 has distance >= 8
    // (retentionWindow * 2 = 2 * 2 * 2 = 8 at threshold 1 for non-reproducible)
    const history = buildHistoryWithOldToolResult(toolContent, 'WebFetch', 9);

    // 55% usage: above 50% midpoint threshold, triggers threshold index 1
    const contextWindow = 100_000;
    const currentTokens = 55_000;

    const result = await engine.apply(history, contextWindow, currentTokens);

    // The persist callback should have been invoked for the non-reproducible WebFetch result
    expect(persistResult).toHaveBeenCalledOnce();
    const [content, metadata] = persistResult.mock.calls[0]!;
    expect(content).toBe(toolContent);
    expect(metadata.toolName).toBe('WebFetch');
    expect(metadata.messageIndex).toBe(0);
    expect(metadata.category).toBe('non-reproducible');

    // The replacement message should include the file path
    const replaced = result[0]!;
    expect(typeof replaced.content).toBe('string');
    expect(replaced.content as string).toContain('/tmp/compaction/result-0.txt');
    expect(replaced.content as string).toContain('Tool result persisted');
  });

  // -----------------------------------------------------------------------
  // Test 2: Rereadable result cleared without callback
  //
  // At threshold 2 (60%), rereadable tools get a `clear` action. This is
  // destructive, but maybePersistBeforeTrim explicitly skips rereadable
  // category (only persists non-reproducible and computational).
  // -----------------------------------------------------------------------

  it('does not invoke persist callback for rereadable results', async () => {
    const persistResult = vi.fn().mockResolvedValue('/tmp/compaction/result-0.txt');
    const engine = createEngine(persistResult);

    const toolContent = 'Read file content that can be re-read from disk';
    // 6 assistant turns: distance = 6 > preserveRecentTurns (2) for rereadable
    const history = buildHistoryWithOldToolResult(toolContent, 'Read', 6);

    // 65% usage: above 60% threshold, triggers threshold index 2 (hard clear)
    const contextWindow = 100_000;
    const currentTokens = 65_000;

    const result = await engine.apply(history, contextWindow, currentTokens);

    // Persist callback should NOT be invoked for rereadable category
    expect(persistResult).not.toHaveBeenCalled();

    // The result should be cleared with standard text
    const replaced = result[0]!;
    expect(typeof replaced.content).toBe('string');
    expect(replaced.content as string).toBe('[Tool result cleared]');
  });

  // -----------------------------------------------------------------------
  // Test 3: No callback set = standard behavior
  //
  // Without a persistResult callback, maybePersistBeforeTrim falls through
  // to the standard applyTrimAction. A non-reproducible tool at threshold 1
  // with enough distance gets a placeholder action (standard placeholder text).
  // -----------------------------------------------------------------------

  it('uses standard placeholder when no persist callback is configured', async () => {
    const engine = createEngine(); // no persistResult

    const toolContent = 'WebFetch result with no persistence configured on this engine';
    // 9 assistant turns: distance = 9 >= retentionWindow * 2 = 8 at threshold 1
    const history = buildHistoryWithOldToolResult(toolContent, 'WebFetch', 9);

    // 55% usage: threshold index 1 (50%)
    const contextWindow = 100_000;
    const currentTokens = 55_000;

    const result = await engine.apply(history, contextWindow, currentTokens);

    // Without persist callback, should use standard placeholder format
    const replaced = result[0]!;
    expect(typeof replaced.content).toBe('string');
    const text = replaced.content as string;
    expect(text).toContain('Tool result trimmed');
    expect(text).toContain('WebFetch');
    // Should NOT contain any file path reference
    expect(text).not.toContain('persisted');
  });

  // -----------------------------------------------------------------------
  // Test 4: Callback error = graceful fallback
  //
  // When the persist callback throws, maybePersistBeforeTrim catches the
  // error and falls back to the standard trim action (placeholder).
  // No error should propagate.
  // -----------------------------------------------------------------------

  it('falls back to standard trim when persist callback throws', async () => {
    const persistResult = vi.fn().mockRejectedValue(new Error('disk full'));
    const engine = createEngine(persistResult);

    const toolContent = 'WebFetch result that fails to persist to disk due to error';
    // 9 assistant turns: distance = 9 >= 8 so placeholder action at threshold 1
    const history = buildHistoryWithOldToolResult(toolContent, 'WebFetch', 9);

    // 55% usage: threshold index 1 (50%)
    const contextWindow = 100_000;
    const currentTokens = 55_000;

    const result = await engine.apply(history, contextWindow, currentTokens);

    // Persist was attempted
    expect(persistResult).toHaveBeenCalledOnce();

    // Should fall back to standard placeholder without propagating error
    const replaced = result[0]!;
    expect(typeof replaced.content).toBe('string');
    const text = replaced.content as string;
    // Standard placeholder format (from applyTrimAction)
    expect(text).toContain('Tool result trimmed');
    expect(text).toContain('WebFetch');
    // Should NOT contain any file path since persist failed
    expect(text).not.toContain('persisted');
  });
});
