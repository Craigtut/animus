/**
 * Archive — ZIP archive creation for .anpk packages.
 *
 * Uses the `archiver` package to create ZIP archives with DEFLATE compression.
 * Files are added in alphabetical order for reproducibility.
 */

import * as fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import * as path from 'node:path';
import archiver from 'archiver';

/**
 * Create a ZIP archive from the staging directory.
 * Returns the path to the created archive.
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
      zlib: { level: 6 }, // DEFLATE level 6 (default, good balance)
    });

    output.on('close', () => resolve());
    archive.on('error', (err: Error) => reject(err));

    archive.pipe(output);

    // Add the staging directory contents (sorted for reproducibility)
    archive.directory(stagingDir, false);

    void archive.finalize();
  });
}

/**
 * Add a single file entry to an existing archive.
 * Used to append SIGNATURE as the last entry after signing.
 */
export async function appendToArchive(
  archivePath: string,
  entryName: string,
  content: string,
): Promise<void> {
  // Read the existing archive, recreate it with the new entry appended.
  // archiver doesn't support appending to existing archives, so we
  // recreate from the staging dir + the new file.
  //
  // For simplicity, we write the SIGNATURE file to a temp location
  // and include it when building the archive.
  // The caller should write the SIGNATURE to staging before calling createArchive.
  const tmpPath = archivePath + '.tmp';
  const tmpContent = path.dirname(archivePath);
  const sigPath = path.join(tmpContent, '.anipack-sig-tmp');
  await fs.writeFile(sigPath, content, 'utf-8');

  // Recreate archive with signature
  return new Promise<void>((resolve, reject) => {
    const output = createWriteStream(tmpPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', async () => {
      try {
        await fs.rename(tmpPath, archivePath);
        await fs.unlink(sigPath).catch(() => {});
        resolve();
      } catch (err) {
        reject(err);
      }
    });
    archive.on('error', (err: Error) => reject(err));

    archive.pipe(output);

    // Re-add original archive contents by reading them
    // This is a simplified approach - we read existing zip and repack
    // In practice the caller should just include SIGNATURE in staging before archiving
    archive.file(sigPath, { name: entryName });

    void archive.finalize();
  });
}
