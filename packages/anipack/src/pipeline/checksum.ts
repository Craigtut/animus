/**
 * Checksum — SHA-256 checksum generation for all files in the staging directory.
 *
 * Produces the CHECKSUMS file in the format:
 *   sha256:<64-char-hex> <relative-path>
 *
 * Sorted alphabetically by path, LF line endings.
 */

import * as fs from 'node:fs/promises';
import * as crypto from 'node:crypto';
import * as path from 'node:path';

/**
 * Compute SHA-256 checksums for all files in the staging directory.
 * Returns the CHECKSUMS file content as a string.
 *
 * Excludes CHECKSUMS and SIGNATURE files from the listing.
 */
export async function computeChecksums(stagingDir: string): Promise<string> {
  const files = await listAllFiles(stagingDir, stagingDir);

  // Sort alphabetically by relative path
  files.sort((a, b) => a.localeCompare(b));

  const lines: string[] = [];
  for (const relativePath of files) {
    // Skip CHECKSUMS and SIGNATURE — they cannot checksum themselves
    if (relativePath === 'CHECKSUMS' || relativePath === 'SIGNATURE') {
      continue;
    }

    const fullPath = path.join(stagingDir, relativePath);
    const digest = await hashFile(fullPath);
    // Use forward slashes regardless of platform
    const normalizedPath = relativePath.split(path.sep).join('/');
    lines.push(`sha256:${digest} ${normalizedPath}`);
  }

  // LF only
  return lines.join('\n') + '\n';
}

/**
 * Compute SHA-256 hash of a single file.
 */
export async function hashFile(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Compute SHA-256 hash of a buffer.
 */
export function hashBuffer(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Recursively list all files in a directory relative to the root.
 */
async function listAllFiles(dir: string, rootDir: string): Promise<string[]> {
  const result: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await listAllFiles(fullPath, rootDir);
      result.push(...nested);
    } else {
      result.push(path.relative(rootDir, fullPath));
    }
  }

  return result;
}
