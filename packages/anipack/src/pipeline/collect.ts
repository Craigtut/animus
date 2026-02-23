/**
 * Collect — File collection step for the build pipeline.
 *
 * Copies all runtime files from the source directory into a staging directory,
 * excluding development-only and sensitive files.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as logger from '../utils/logger.js';

/** Default exclusion patterns (applied if no .anipackignore exists). */
const DEFAULT_EXCLUDES = new Set([
  '.git',
  '.DS_Store',
  'Thumbs.db',
  '.env',
  '.env.local',
  '.env.production',
  'tsconfig.json',
  'package-lock.json',
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.json',
  '.prettierrc',
  '.prettierrc.js',
  '.prettierrc.json',
  'jest.config.js',
  'jest.config.ts',
  'vitest.config.ts',
  '.gitignore',
  'README.md',
  'CONTRIBUTING.md',
  'plugin.json',
  'channel.json',
]);

const DEFAULT_EXCLUDE_DIRS = new Set([
  '.git',
  'test',
  '__tests__',
  '.turbo',
  'node_modules',
]);

/** Patterns that trigger a warning about potential sensitive files. */
const SENSITIVE_PATTERNS = ['.env', 'credentials', 'private', '.key', '.pem'];

export interface CollectOptions {
  sourceDir: string;
  stagingDir: string;
  /** Extra files to include in staging root (e.g., manifest.json). */
  extraFiles?: Map<string, string>;
}

export interface CollectResult {
  fileCount: number;
  warnings: string[];
}

/**
 * Collect all files from the source directory into staging, applying exclusions.
 */
export async function collect(options: CollectOptions): Promise<CollectResult> {
  const { sourceDir, stagingDir, extraFiles } = options;
  const warnings: string[] = [];
  let fileCount = 0;

  // Load .anipackignore if it exists
  const customExcludes = await loadAnipackIgnore(sourceDir);

  // Write extra files (like manifest.json) directly to staging root
  if (extraFiles) {
    for (const [filename, content] of extraFiles) {
      await fs.writeFile(path.join(stagingDir, filename), content, 'utf-8');
      fileCount++;
    }
  }

  // Recursively copy files from source to staging
  fileCount += await copyDirectory(
    sourceDir,
    stagingDir,
    sourceDir,
    customExcludes,
    warnings,
  );

  return { fileCount, warnings };
}

async function copyDirectory(
  dir: string,
  stagingDir: string,
  sourceRoot: string,
  customExcludes: Set<string>,
  warnings: string[],
): Promise<number> {
  let count = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(dir, entry.name);
    const relativePath = path.relative(sourceRoot, sourcePath);

    // Resolve symlinks to determine the real type
    let isDir: boolean;
    if (entry.isSymbolicLink()) {
      try {
        const realStat = await fs.stat(sourcePath);
        isDir = realStat.isDirectory();
      } catch {
        // Broken symlink — skip
        continue;
      }
    } else {
      isDir = entry.isDirectory();
    }

    if (shouldExclude(entry.name, relativePath, isDir, customExcludes)) {
      continue;
    }

    const targetPath = path.join(stagingDir, relativePath);

    if (isDir) {
      await fs.mkdir(targetPath, { recursive: true });
      count += await copyDirectory(sourcePath, stagingDir, sourceRoot, customExcludes, warnings);
    } else {
      // Check for sensitive files
      const lower = entry.name.toLowerCase();
      for (const pattern of SENSITIVE_PATTERNS) {
        if (lower.includes(pattern)) {
          const msg = `Potentially sensitive file included: ${relativePath}`;
          warnings.push(msg);
          logger.warn(msg);
          break;
        }
      }

      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.copyFile(sourcePath, targetPath);
      count++;
    }
  }

  return count;
}

function shouldExclude(
  name: string,
  relativePath: string,
  isDir: boolean,
  customExcludes: Set<string>,
): boolean {
  if (isDir && DEFAULT_EXCLUDE_DIRS.has(name)) {
    return true;
  }
  if (!isDir && DEFAULT_EXCLUDES.has(name)) {
    return true;
  }
  if (customExcludes.has(name) || customExcludes.has(relativePath)) {
    return true;
  }
  return false;
}

async function loadAnipackIgnore(sourceDir: string): Promise<Set<string>> {
  const ignorePath = path.join(sourceDir, '.anipackignore');
  try {
    const content = await fs.readFile(ignorePath, 'utf-8');
    const patterns = content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
    return new Set(patterns);
  } catch {
    return new Set();
  }
}
