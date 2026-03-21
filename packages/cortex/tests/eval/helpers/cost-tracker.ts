/**
 * Global cost tracker for eval test runs.
 *
 * Accumulates token usage and cost across all LLM calls in a test run.
 * Prints a summary table at the end via the printSummary() method,
 * which should be called from a global afterAll() hook.
 */

import type { CortexUsage } from '../../../src/types.js';

interface CostEntry {
  timestamp: number;
  usage: CortexUsage;
  label?: string;
}

class CostTracker {
  private entries: CostEntry[] = [];

  /**
   * Record a usage entry from an LLM call.
   */
  record(usage: CortexUsage, label?: string): void {
    this.entries.push({
      timestamp: Date.now(),
      usage,
      label,
    });
  }

  /**
   * Get total calls made.
   */
  get totalCalls(): number {
    return this.entries.length;
  }

  /**
   * Get aggregated totals.
   */
  get totals(): {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
    totalCost: number;
  } {
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;
    let totalTokens = 0;
    let totalCost = 0;

    for (const entry of this.entries) {
      inputTokens += entry.usage.input;
      outputTokens += entry.usage.output;
      cacheReadTokens += entry.usage.cacheRead;
      cacheWriteTokens += entry.usage.cacheWrite;
      totalTokens += entry.usage.totalTokens;
      totalCost += entry.usage.cost.total;
    }

    return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalTokens, totalCost };
  }

  /**
   * Print a formatted summary to stdout.
   * Call this from afterAll() in your eval suite.
   */
  printSummary(): void {
    const t = this.totals;

    console.log('\n' + '='.repeat(60));
    console.log('  EVAL COST SUMMARY');
    console.log('='.repeat(60));
    console.log(`  LLM Calls:        ${this.totalCalls}`);
    console.log(`  Input Tokens:      ${t.inputTokens.toLocaleString()}`);
    console.log(`  Output Tokens:     ${t.outputTokens.toLocaleString()}`);
    console.log(`  Cache Read:        ${t.cacheReadTokens.toLocaleString()}`);
    console.log(`  Cache Write:       ${t.cacheWriteTokens.toLocaleString()}`);
    console.log(`  Total Tokens:      ${t.totalTokens.toLocaleString()}`);
    console.log('-'.repeat(60));
    console.log(`  Total Cost:        $${t.totalCost.toFixed(4)}`);
    console.log('='.repeat(60) + '\n');
  }

  /**
   * Reset all tracked data (useful between test suites if needed).
   */
  reset(): void {
    this.entries = [];
  }
}

/**
 * Global singleton cost tracker.
 * Shared across all eval test files in a single run.
 */
export const costTracker = new CostTracker();
