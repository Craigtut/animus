/**
 * Build Command — Build an .anpk package from a source directory.
 *
 * Pipeline: validate -> normalize -> compile -> vendor -> collect -> checksum -> archive
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as logger from '../utils/logger.js';
import { loadSourceManifest } from '../utils/manifest.js';
import { validate } from './validate.js';
import { normalizeManifest } from '../pipeline/normalize.js';
import { compile } from '../pipeline/compile.js';
import { vendor } from '../pipeline/vendor.js';
import { collect } from '../pipeline/collect.js';
import { computeChecksums, hashFile } from '../pipeline/checksum.js';
import { createArchive } from '../pipeline/archive.js';
import { signPackage } from './sign.js';

export interface BuildOptions {
  output?: string | undefined;
  sign?: boolean | undefined;
  key?: string | undefined;
  signer?: string | undefined;
  noVendor?: boolean | undefined;
  noCompile?: boolean | undefined;
  verbose?: boolean | undefined;
}

export async function buildCommand(
  sourceDir: string,
  options: BuildOptions,
): Promise<void> {
  const absoluteDir = path.resolve(sourceDir);
  const startTime = Date.now();

  // Step 1: Validate
  logger.heading(`Building from ${sourceDir}...`);
  logger.blank();

  const validationResult = await validate(absoluteDir);
  if (!validationResult.valid) {
    for (const e of validationResult.errors) {
      logger.error(e);
    }
    logger.blank();
    logger.error('Build failed: validation errors.');
    process.exit(1);
  }
  logger.info('Validating manifest...  done');

  // Step 2: Load and normalize manifest
  const loaded = await loadSourceManifest(absoluteDir);
  const manifest = normalizeManifest(loaded);

  const packageName = `${manifest.name}-${manifest.version}.anpk`;
  const outputPath = options.output
    ? path.resolve(options.output)
    : path.resolve(process.cwd(), packageName);

  logger.detail('Source:', absoluteDir);
  logger.detail('Type:', manifest.packageType);
  logger.detail('Version:', manifest.version);
  logger.blank();

  // Create staging directory
  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anipack-'));

  try {
    // Step 3: Compile (if applicable)
    const compiled = await compile({
      sourceDir: absoluteDir,
      stagingDir,
      skip: options.noCompile === true,
    });
    if (compiled) {
      logger.info('Compiling TypeScript... done');
    }

    // Step 4: Vendor dependencies (if applicable)
    const vendored = await vendor({
      sourceDir: absoluteDir,
      stagingDir,
      skip: options.noVendor === true,
    });
    if (vendored) {
      logger.info('Vendoring deps...      done');
    }

    // Step 5: Collect files
    const manifestJson = JSON.stringify(manifest, null, 2);
    const { fileCount, warnings } = await collect({
      sourceDir: absoluteDir,
      stagingDir,
      extraFiles: new Map([['manifest.json', manifestJson]]),
    });
    logger.info(`Collecting files...     ${fileCount} files`);

    for (const w of warnings) {
      logger.warn(w);
    }

    // Step 6: Compute checksums
    const checksumsContent = await computeChecksums(stagingDir);
    await fs.writeFile(path.join(stagingDir, 'CHECKSUMS'), checksumsContent, 'utf-8');
    logger.info('Computing checksums...  done');

    // Step 7: Create archive
    await createArchive(stagingDir, outputPath);
    logger.info('Creating archive...     done');

    // Step 8: Sign (if requested)
    if (options.sign) {
      const keyPath = options.key ?? process.env['ANIPACK_SIGNING_KEY'];
      if (!keyPath) {
        logger.error(
          'Signing key not found. Provide --key or set ANIPACK_SIGNING_KEY.',
        );
        process.exit(1);
      }
      const signerIdentity = options.signer ?? 'animus-labs';

      await signPackage(outputPath, keyPath, signerIdentity);
      logger.info(`Signing package...      done (signed by ${signerIdentity})`);
    }

    // Step 9: Output summary
    const finalStat = await fs.stat(outputPath);
    const sizeKb = (finalStat.size / 1024).toFixed(1);
    const archiveHash = await hashFile(outputPath);

    logger.blank();
    logger.detail('Output:', outputPath);
    logger.detail('Size:', `${sizeKb} KB`);
    logger.detail('Files:', String(fileCount));
    logger.detail('Signed:', options.sign ? 'yes' : 'no');
    logger.detail('SHA-256:', archiveHash);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.blank();
    logger.success(`Build complete in ${elapsed}s.`);
  } finally {
    // Cleanup staging directory
    await fs.rm(stagingDir, { recursive: true, force: true });
  }
}
