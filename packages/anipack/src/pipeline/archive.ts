/**
 * Archive — ZIP archive creation for .anpk packages.
 *
 * Uses the `archiver` package to create ZIP archives with DEFLATE compression.
 */

import * as fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import * as path from 'node:path';
import archiver from 'archiver';

/**
 * Create a ZIP archive from the staging directory.
 */
export async function createArchive(
  stagingDir: string,
  outputPath: string,
): Promise<void> {
  const outputDir = path.dirname(outputPath);
  await fs.mkdir(outputDir, { recursive: true });

  return new Promise<void>((resolve, reject) => {
    const output = createWriteStream(outputPath);
    const archive = archiver('zip', {
      zlib: { level: 6 },
    });

    output.on('close', () => resolve());
    archive.on('error', (err: Error) => reject(err));

    archive.pipe(output);
    archive.directory(stagingDir, false);
    void archive.finalize();
  });
}
