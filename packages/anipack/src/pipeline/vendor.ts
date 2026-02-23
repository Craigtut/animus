/**
 * Vendor — Dependency vendoring step for the build pipeline.
 *
 * Checks for package.json with production dependencies and runs
 * npm install --production to vendor node_modules into the staging dir.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as logger from '../utils/logger.js';

const execFileAsync = promisify(execFile);

export interface VendorOptions {
  sourceDir: string;
  stagingDir: string;
  skip: boolean;
}

/**
 * Vendor production dependencies into the staging directory.
 * Returns true if vendoring ran, false if skipped.
 */
export async function vendor(options: VendorOptions): Promise<boolean> {
  if (options.skip) {
    return false;
  }

  const pkgJsonPath = path.join(options.sourceDir, 'package.json');
  let hasPkgJson = false;
  try {
    await fs.access(pkgJsonPath);
    hasPkgJson = true;
  } catch {
    // No package.json
  }

  if (!hasPkgJson) {
    return false;
  }

  const content = await fs.readFile(pkgJsonPath, 'utf-8');
  const pkg = JSON.parse(content) as Record<string, unknown>;
  const deps = pkg['dependencies'];

  if (deps == null || (typeof deps === 'object' && Object.keys(deps as object).length === 0)) {
    return false;
  }

  // Copy package.json to staging and run npm install --production
  const stagingPkgJson = path.join(options.stagingDir, 'package.json');
  await fs.copyFile(pkgJsonPath, stagingPkgJson);

  logger.info('Installing production dependencies...');
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  try {
    await execFileAsync(npmCmd, ['install', '--production', '--no-package-lock'], {
      cwd: options.stagingDir,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to vendor dependencies: ${message}`);
  }

  // Remove the copied package.json from staging (not part of the final package)
  await fs.unlink(stagingPkgJson);

  return true;
}
