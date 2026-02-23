/**
 * Compile — TypeScript compilation step for the build pipeline.
 *
 * Checks for a tsconfig.json in the source directory and runs tsc if found.
 * This compiles TypeScript source files in the extension (e.g., channel adapters)
 * before they are collected into the staging directory.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as logger from '../utils/logger.js';

const execFileAsync = promisify(execFile);

export interface CompileOptions {
  sourceDir: string;
  stagingDir: string;
  skip: boolean;
}

/**
 * Check for TypeScript config and compile if present.
 * Returns true if compilation ran, false if skipped.
 */
export async function compile(options: CompileOptions): Promise<boolean> {
  if (options.skip) {
    return false;
  }

  const tsconfigPath = path.join(options.sourceDir, 'tsconfig.json');
  let hasTsConfig = false;
  try {
    await fs.access(tsconfigPath);
    hasTsConfig = true;
  } catch {
    // No tsconfig.json
  }

  if (!hasTsConfig) {
    return false;
  }

  logger.info('Compiling TypeScript...');
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  try {
    await execFileAsync(npxCmd, ['tsc', '--project', tsconfigPath], {
      cwd: options.sourceDir,
    });
  } catch (err) {
    const message = err instanceof Error ? (err as Error & { stderr?: string }).stderr ?? err.message : String(err);
    throw new Error(`TypeScript compilation failed:\n${message}`);
  }

  return true;
}
