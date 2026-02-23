/**
 * Compile — TypeScript compilation step for the build pipeline.
 *
 * Checks for TypeScript files in the source directory and compiles them.
 * Currently a stub that reports if TS files are found; actual compilation
 * can be added when needed.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as logger from '../utils/logger.js';

export interface CompileOptions {
  sourceDir: string;
  stagingDir: string;
  skip: boolean;
}

/**
 * Check for TypeScript files and compile them.
 * Returns true if compilation ran, false if skipped.
 */
export async function compile(options: CompileOptions): Promise<boolean> {
  if (options.skip) {
    return false;
  }

  // Check for adapter.ts (channels) or any .ts files that need compilation
  const adapterTs = path.join(options.sourceDir, 'adapter.ts');
  let hasTs = false;
  try {
    await fs.access(adapterTs);
    hasTs = true;
  } catch {
    // No adapter.ts found
  }

  if (!hasTs) {
    return false;
  }

  // TypeScript compilation would happen here using the TypeScript compiler API.
  // For now, we expect pre-compiled .js files to exist alongside .ts files.
  logger.warn(
    'TypeScript source files found. Ensure compiled .js files are present.',
  );
  return false;
}
