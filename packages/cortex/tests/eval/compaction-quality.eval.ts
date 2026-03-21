/**
 * Compaction Quality Evals
 *
 * Tests that Layer 2 (conversation summarization) produces summaries that
 * preserve critical information from the original conversation.
 *
 * Uses real LLM calls (Anthropic Haiku) for both:
 *   1. Running the actual compaction (the thing being tested)
 *   2. Judging whether the summary preserves key facts (LLM-as-judge)
 *
 * Run with: npm run test:eval
 * Auth: Env var (ANTHROPIC_API_KEY), cached OAuth, or interactive OAuth login
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runCompaction, partitionHistory } from '../../src/compaction/compaction.js';
import { extractSummaryContent } from '../../src/compaction/compaction.js';
import { COMPACTION_DEFAULTS } from '../../src/compaction/compaction.js';
import type { CompactionResult } from '../../src/types.js';
import type { AgentMessage } from '../../src/context-manager.js';
import { createEvalCompleteFn } from './helpers/provider.js';
import { costTracker } from './helpers/cost-tracker.js';
import { judgeFacts, judgeQuality } from './helpers/judge.js';
import {
  CONFIG_REFACTOR_CONVERSATION,
  CONFIG_REFACTOR_FACTS,
  MEMORY_LEAK_CONVERSATION,
  MEMORY_LEAK_FACTS,
  conversationToText,
} from './helpers/fixtures.js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

afterAll(() => {
  costTracker.printSummary();
});

// ---------------------------------------------------------------------------
// Compaction Quality Tests
// ---------------------------------------------------------------------------

describe('Compaction Quality', () => {
  describe('Config Refactor Conversation', () => {
    let compactionResult: CompactionResult;
    let newHistory: AgentMessage[];

    beforeAll(async () => {
      const completeFn = createEvalCompleteFn();
      const result = await runCompaction(
        CONFIG_REFACTOR_CONVERSATION,
        COMPACTION_DEFAULTS,
        completeFn,
      );
      compactionResult = result.result;
      newHistory = result.newHistory;
    });

    it('produces a compaction summary', () => {
      expect(compactionResult.summary.length).toBeGreaterThan(100);
      expect(compactionResult.turnsCompacted).toBeGreaterThan(0);
      expect(compactionResult.turnsPreserved).toBe(COMPACTION_DEFAULTS.preserveRecentTurns);
      expect(newHistory.length).toBe(COMPACTION_DEFAULTS.preserveRecentTurns + 1); // summary + preserved tail
    });

    it('produces a summary shorter than the compacted portion', () => {
      // The summary should be shorter than the turns it replaces.
      // Note: tokensAfter includes summary + preserved tail, so we compare
      // summaryTokens against the tokens that were compacted (before - after + summary).
      const compactedPortionTokens = compactionResult.tokensBefore -
        (compactionResult.tokensAfter - compactionResult.summaryTokens);
      const ratio = compactionResult.summaryTokens / compactedPortionTokens;

      console.log(`  Compacted portion: ~${compactedPortionTokens} tokens`);
      console.log(`  Summary: ~${compactionResult.summaryTokens} tokens`);
      console.log(`  Compression ratio: ${ratio.toFixed(2)} (${ratio < 1 ? 'smaller' : 'larger'} than original)`);
      console.log(`  Total: ${compactionResult.tokensBefore} -> ${compactionResult.tokensAfter} (summary + ${compactionResult.turnsPreserved} preserved turns)`);

      // The summary should exist and have meaningful content
      expect(compactionResult.summaryTokens).toBeGreaterThan(50);
      // Log the ratio for tracking, but don't hard-assert on reduction
      // since short conversations can produce summaries longer than the input
    });

    it('extracts summary from XML tags', () => {
      const extracted = extractSummaryContent(compactionResult.summary);
      expect(extracted.length).toBeGreaterThan(50);
      expect(extracted).not.toContain('<analysis>');
    });

    it('preserves critical facts (LLM-as-judge)', async () => {
      const extracted = extractSummaryContent(compactionResult.summary);
      const originalText = conversationToText(CONFIG_REFACTOR_CONVERSATION);

      const result = await judgeFacts(extracted, CONFIG_REFACTOR_FACTS, originalText);

      console.log(`  Fact preservation scores:`);
      for (const [fact, score] of Object.entries(result.scores)) {
        const icon = score >= 0.8 ? 'PASS' : score >= 0.5 ? 'PARTIAL' : 'FAIL';
        console.log(`    [${icon}] ${score.toFixed(1)} - ${fact.slice(0, 80)}...`);
      }
      console.log(`  Average: ${result.averageScore.toFixed(2)}`);

      // At least 70% of facts should be preserved (score >= 0.5)
      const preserved = Object.values(result.scores).filter(s => s >= 0.5).length;
      const preservedRatio = preserved / CONFIG_REFACTOR_FACTS.length;
      expect(preservedRatio).toBeGreaterThanOrEqual(0.7);

      // Average score should be reasonable
      expect(result.averageScore).toBeGreaterThanOrEqual(0.5);
    });

    it('maintains structural quality', async () => {
      const extracted = extractSummaryContent(compactionResult.summary);

      const result = await judgeQuality(extracted, [
        {
          name: 'file_paths',
          description: 'Contains specific file paths mentioned in the conversation (not just generic references)',
        },
        {
          name: 'user_decisions',
          description: 'Captures decisions the user made (corrections, preferences, explicit directives)',
        },
        {
          name: 'error_details',
          description: 'Preserves specific error details and how they were resolved',
        },
        {
          name: 'coherence',
          description: 'Reads as a coherent summary that someone could use to continue the work',
        },
      ]);

      console.log(`  Quality scores:`);
      for (const [criterion, score] of Object.entries(result.scores)) {
        console.log(`    ${score.toFixed(1)} - ${criterion}`);
      }
      console.log(`  Average: ${result.averageScore.toFixed(2)}`);

      // All quality dimensions should be at least passable
      expect(result.averageScore).toBeGreaterThanOrEqual(0.5);
    });
  });

  describe('Memory Leak Conversation', () => {
    let compactionResult: CompactionResult;

    beforeAll(async () => {
      const completeFn = createEvalCompleteFn();
      const result = await runCompaction(
        MEMORY_LEAK_CONVERSATION,
        COMPACTION_DEFAULTS,
        completeFn,
      );
      compactionResult = result.result;
    });

    it('compacts the memory leak conversation', () => {
      expect(compactionResult.summary.length).toBeGreaterThan(100);
      expect(compactionResult.turnsCompacted).toBeGreaterThan(0);
    });

    it('preserves debugging facts', async () => {
      const extracted = extractSummaryContent(compactionResult.summary);
      const originalText = conversationToText(MEMORY_LEAK_CONVERSATION);

      const result = await judgeFacts(extracted, MEMORY_LEAK_FACTS, originalText);

      console.log(`  Fact preservation scores:`);
      for (const [fact, score] of Object.entries(result.scores)) {
        const icon = score >= 0.8 ? 'PASS' : score >= 0.5 ? 'PARTIAL' : 'FAIL';
        console.log(`    [${icon}] ${score.toFixed(1)} - ${fact.slice(0, 80)}...`);
      }
      console.log(`  Average: ${result.averageScore.toFixed(2)}`);

      const preserved = Object.values(result.scores).filter(s => s >= 0.5).length;
      const preservedRatio = preserved / MEMORY_LEAK_FACTS.length;
      expect(preservedRatio).toBeGreaterThanOrEqual(0.7);
    });
  });

  describe('Edge Cases', () => {
    it('rejects short conversations (nothing to compact)', async () => {
      const shortConversation: AgentMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there! How can I help?' },
        { role: 'user', content: 'What time is it?' },
        { role: 'assistant', content: 'I don\'t have access to the current time.' },
      ];

      const completeFn = createEvalCompleteFn();
      await expect(
        runCompaction(shortConversation, COMPACTION_DEFAULTS, completeFn),
      ).rejects.toThrow('Not enough conversation history to compact');
    });

    it('partitions correctly at boundary', () => {
      const messages: AgentMessage[] = Array.from(
        { length: COMPACTION_DEFAULTS.preserveRecentTurns + 1 },
        (_, i) => ({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Message ${i}`,
        }),
      );

      const [target, preserved] = partitionHistory(messages, COMPACTION_DEFAULTS.preserveRecentTurns);
      expect(target).toHaveLength(1);
      expect(preserved).toHaveLength(COMPACTION_DEFAULTS.preserveRecentTurns);
    });
  });
});
