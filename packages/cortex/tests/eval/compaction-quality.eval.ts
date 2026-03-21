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
import { estimateTokens } from '../../src/token-estimator.js';
import { extractTextContent } from '../../src/compaction/microcompaction.js';
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
  AUTH_REFACTOR_CONVERSATION,
  AUTH_REFACTOR_FACTS,
  conversationToText,
} from './helpers/fixtures.js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

afterAll(() => {
  costTracker.printSummary();
});

// ---------------------------------------------------------------------------
// Large Conversation Compaction (Auth Refactor - ~80K tokens)
// ---------------------------------------------------------------------------

describe('Compaction Quality', () => {
  describe('Auth Refactor (large, ~80K tokens)', () => {
    let compactionResult: CompactionResult;
    let newHistory: AgentMessage[];
    let inputTokenEstimate: number;

    beforeAll(async () => {
      // Estimate input size
      inputTokenEstimate = estimateTokens(
        AUTH_REFACTOR_CONVERSATION.map(m => extractTextContent(m)).join('\n'),
      );
      console.log(`  Input conversation: ${AUTH_REFACTOR_CONVERSATION.length} turns, ~${inputTokenEstimate} tokens`);

      const completeFn = createEvalCompleteFn();
      const result = await runCompaction(
        AUTH_REFACTOR_CONVERSATION,
        COMPACTION_DEFAULTS,
        completeFn,
      );
      compactionResult = result.result;
      newHistory = result.newHistory;
    });

    it('produces a compaction summary from large input', () => {
      expect(compactionResult.summary.length).toBeGreaterThan(500);
      expect(compactionResult.turnsCompacted).toBeGreaterThan(10);
      expect(compactionResult.turnsPreserved).toBe(COMPACTION_DEFAULTS.preserveRecentTurns);
      expect(newHistory.length).toBe(COMPACTION_DEFAULTS.preserveRecentTurns + 1);
      console.log(`  Turns compacted: ${compactionResult.turnsCompacted}, preserved: ${compactionResult.turnsPreserved}`);
    });

    it('achieves meaningful token reduction on large input', () => {
      // With 80K+ tokens of input, the summary MUST be significantly smaller
      const ratio = compactionResult.tokensAfter / compactionResult.tokensBefore;
      console.log(`  Token reduction: ${compactionResult.tokensBefore} -> ${compactionResult.tokensAfter} (${((1 - ratio) * 100).toFixed(1)}% reduction)`);
      console.log(`  Summary tokens: ${compactionResult.summaryTokens}`);

      // Large conversations should achieve at least 50% reduction
      expect(ratio).toBeLessThan(0.5);
    });

    it('extracts summary from XML tags', () => {
      const extracted = extractSummaryContent(compactionResult.summary);
      expect(extracted.length).toBeGreaterThan(200);
      expect(extracted).not.toContain('<analysis>');
    });

    it('preserves critical facts from large conversation (LLM-as-judge)', async () => {
      const extracted = extractSummaryContent(compactionResult.summary);

      // For the large conversation, we don't pass the original text as context
      // to the judge (it would exceed the judge's own context window). The judge
      // evaluates the summary standalone, which is the realistic scenario.
      const result = await judgeFacts(extracted, AUTH_REFACTOR_FACTS);

      console.log(`  Fact preservation scores (${AUTH_REFACTOR_FACTS.length} facts):`);
      for (const [fact, score] of Object.entries(result.scores)) {
        const icon = score >= 0.8 ? 'PASS' : score >= 0.5 ? 'PARTIAL' : 'FAIL';
        console.log(`    [${icon}] ${score.toFixed(1)} - ${fact.slice(0, 80)}...`);
      }
      console.log(`  Average: ${result.averageScore.toFixed(2)}`);

      // For large conversations, fact preservation is harder. Require at least 60%.
      const preserved = Object.values(result.scores).filter(s => s >= 0.5).length;
      const preservedRatio = preserved / AUTH_REFACTOR_FACTS.length;
      console.log(`  Facts preserved (>= 0.5): ${preserved}/${AUTH_REFACTOR_FACTS.length} (${(preservedRatio * 100).toFixed(0)}%)`);
      expect(preservedRatio).toBeGreaterThanOrEqual(0.6);
      expect(result.averageScore).toBeGreaterThanOrEqual(0.4);
    });

    it('maintains structural quality on large conversation', async () => {
      const extracted = extractSummaryContent(compactionResult.summary);

      const result = await judgeQuality(extracted, [
        {
          name: 'file_paths',
          description: 'Contains specific file paths mentioned in the conversation (not just generic references like "the auth file")',
        },
        {
          name: 'security_details',
          description: 'Preserves specific security findings (MD5 vulnerability, bcrypt cost factor, race condition details)',
        },
        {
          name: 'user_corrections',
          description: 'Captures the user\'s naming convention correction (camelCase, req.authUser not req.user)',
        },
        {
          name: 'test_outcomes',
          description: 'Mentions test results, broken tests, and their fixes',
        },
        {
          name: 'coherence',
          description: 'Reads as a coherent, useful summary that someone could use to continue the work without re-reading the original conversation',
        },
      ]);

      console.log(`  Quality scores:`);
      for (const [criterion, score] of Object.entries(result.scores)) {
        console.log(`    ${score.toFixed(1)} - ${criterion}`);
      }
      console.log(`  Average: ${result.averageScore.toFixed(2)}`);

      expect(result.averageScore).toBeGreaterThanOrEqual(0.5);
    });
  });

  // ---------------------------------------------------------------------------
  // Small Conversation Tests (existing, kept for fast feedback)
  // ---------------------------------------------------------------------------

  describe('Config Refactor (small)', () => {
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
    });

    it('preserves critical facts (LLM-as-judge)', async () => {
      const extracted = extractSummaryContent(compactionResult.summary);
      const originalText = conversationToText(CONFIG_REFACTOR_CONVERSATION);
      const result = await judgeFacts(extracted, CONFIG_REFACTOR_FACTS, originalText);

      console.log(`  Fact preservation: ${result.averageScore.toFixed(2)} avg`);
      const preserved = Object.values(result.scores).filter(s => s >= 0.5).length;
      expect(preserved / CONFIG_REFACTOR_FACTS.length).toBeGreaterThanOrEqual(0.7);
    });
  });

  describe('Memory Leak (small)', () => {
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

    it('compacts and preserves debugging facts', async () => {
      expect(compactionResult.summary.length).toBeGreaterThan(100);
      const extracted = extractSummaryContent(compactionResult.summary);
      const originalText = conversationToText(MEMORY_LEAK_CONVERSATION);
      const result = await judgeFacts(extracted, MEMORY_LEAK_FACTS, originalText);

      console.log(`  Fact preservation: ${result.averageScore.toFixed(2)} avg`);
      const preserved = Object.values(result.scores).filter(s => s >= 0.5).length;
      expect(preserved / MEMORY_LEAK_FACTS.length).toBeGreaterThanOrEqual(0.7);
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
