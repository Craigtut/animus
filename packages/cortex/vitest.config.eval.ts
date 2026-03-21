import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for LLM evaluation tests.
 *
 * These tests hit real LLM providers and cost real money.
 * Run with: npm run test:eval
 *
 * Requirements:
 *   - ANTHROPIC_API_KEY environment variable set
 *   - Tests are skipped gracefully if no API key is available
 *
 * Cost expectations:
 *   - Uses Claude Haiku (cheapest Anthropic model)
 *   - Full suite: ~$0.05-$0.20 per run
 *   - Cost summary printed after each run
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/eval/**/*.eval.ts'],
    testTimeout: 60_000, // LLM calls can be slow
    hookTimeout: 60_000, // beforeAll hooks also make LLM calls
    // Run sequentially to avoid rate limits and make cost tracking accurate
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/index.ts'],
    },
  },
});
