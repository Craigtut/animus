import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string };

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node24',
  outDir: 'dist',
  clean: true,
  splitting: false,
  banner: {
    js: '#!/usr/bin/env node',
  },
  define: {
    __ANIPACK_VERSION__: JSON.stringify(pkg.version),
  },
  // Bundle @animus-labs/shared (monorepo-local, not published to npm).
  // Its transitive dependency on zod is kept external and listed in dependencies.
  noExternal: ['@animus-labs/shared'],
  // Use Rollup tree-shaking (more aggressive than esbuild's default) to ensure
  // only the schemas/constants anipack actually uses from shared are included.
  treeshake: true,
});
