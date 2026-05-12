import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      ANIMUS_ENCRYPTION_KEY: 'test-encryption-key-not-for-production',
    },
    setupFiles: ['./vitest.setup.ts'],
    include: ['packages/*/tests/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
    exclude: ['node_modules', 'dist', '**/tests/integration/**', '**/tests/speech/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules', 'dist', '**/*.d.ts', '**/*.test.ts'],
    },
  },
  resolve: {
    // Use explicit aliases instead of global conditions: ['source'] to prevent
    // the source condition from resolving TypeScript files in transitive deps.
    alias: {
      '@animus-labs/shared': path.resolve(__dirname, 'packages/shared/src'),
      '@animus-labs/agents': path.resolve(__dirname, 'packages/agents/src'),
    },
  },
});
