/**
 * Shared .gitignore reading utility.
 *
 * Walks up the directory tree collecting .gitignore patterns.
 * Used by both Glob and Grep tools to respect .gitignore rules.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Default ignore patterns used when no .gitignore is present,
 * or merged with .gitignore patterns.
 */
export const DEFAULT_IGNORE_PATTERNS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '__pycache__',
  '.DS_Store',
  '.next',
  '.nuxt',
  'coverage',
  '.cache',
  '.parcel-cache',
  '.vite',
];

/**
 * Read and parse .gitignore files by walking up from `dir` to the filesystem root.
 * Returns an array of gitignore patterns (comments and empty lines stripped).
 */
export async function readGitignorePatterns(dir: string): Promise<string[]> {
  const patterns: string[] = [];

  let current = dir;
  const visited = new Set<string>();
  while (!visited.has(current)) {
    visited.add(current);
    const gitignorePath = path.join(current, '.gitignore');
    try {
      const content = await fs.promises.readFile(gitignorePath, 'utf8');
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        // Skip comments and empty lines
        if (trimmed && !trimmed.startsWith('#')) {
          patterns.push(trimmed);
        }
      }
    } catch {
      // No .gitignore at this level, continue
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return patterns;
}
