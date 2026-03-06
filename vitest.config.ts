import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      ANIMUS_ENCRYPTION_KEY: 'test-encryption-key-not-for-production',
    },
    include: ['packages/*/tests/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
    exclude: ['node_modules', 'dist', '**/tests/integration/**', '**/tests/speech/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules', 'dist', '**/*.d.ts', '**/*.test.ts'],
    },
  },
  resolve: {
    alias: {
      '@animus/shared': path.resolve(__dirname, 'packages/shared/src'),
      '@animus/agents': path.resolve(__dirname, 'packages/agents/src'),
      '@animus/backend': path.resolve(__dirname, 'packages/backend/src'),
      '@animus/frontend': path.resolve(__dirname, 'packages/frontend/src'),
    },
  },
});
