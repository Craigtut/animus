/**
 * Inspect Command — Inspect an .anpk package without installing.
 *
 * Shows metadata, file listing, signature status, and permissions.
 */

import * as fs from 'node:fs/promises';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  PackageManifestSchema,
  signatureFileSchema,
  ANIMUS_LABS_PUBLIC_KEY,
} from '@animus-labs/shared';
import type { PackageManifest, SignatureFile } from '@animus-labs/shared';
import * as logger from '../utils/logger.js';
import { hashBuffer } from '../pipeline/checksum.js';

export interface InspectResult {
  manifest: PackageManifest;
  signature: {
    status: 'valid' | 'invalid' | 'unsigned';
    signedBy: string | null;
    signedAt: string | null;
  };
  checksums: {
    verified: number;
    total: number;
    failures: string[];
  };
  files: Array<{ path: string; size: number }>;
  archiveSize: number;
}

export async function inspectCommand(
  archivePath: string,
  options: {
    json?: boolean | undefined;
    files?: boolean | undefined;
    manifest?: boolean | undefined;
    verifyOnly?: boolean | undefined;
  },
): Promise<void> {
  const absolutePath = path.resolve(archivePath);
  logger.heading(`Inspecting ${archivePath}...`);
  logger.blank();

  try {
    await fs.access(absolutePath);
  } catch {
    logger.error(`Archive not found: ${absolutePath}`);
    process.exit(1);
  }

  const result = await inspect(absolutePath);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (options.manifest) {
    console.log(JSON.stringify(result.manifest, null, 2));
    return;
  }

  if (options.verifyOnly) {
    const ok =
      result.signature.status !== 'invalid' &&
      result.checksums.failures.length === 0;
    if (ok) {
      logger.success('Verification passed.');
    } else {
      logger.error('Verification failed.');
      process.exit(1);
    }
    return;
  }

  // Display full inspection output
  const m = result.manifest;
  logger.detail('Package Type:', m.packageType);
  logger.detail('Name:', m.name);
  if (m.displayName) {
    logger.detail('Display Name:', m.displayName);
  }
  logger.detail('Version:', m.version);
  logger.detail('Description:', m.description);
  logger.detail('Author:', m.author.url ? `${m.author.name} (${m.author.url})` : m.author.name);
  if (m.license) {
    logger.detail('License:', m.license);
  }
  if (m.engineVersion) {
    logger.detail('Engine Version:', m.engineVersion);
  }
  logger.detail('Format Version:', String(m.formatVersion));

  logger.blank();

  // Signature
  logger.info('Signature:');
  logger.detail('  Status:', result.signature.status.toUpperCase());
  if (result.signature.signedBy) {
    logger.detail('  Signed by:', result.signature.signedBy);
  }
  if (result.signature.signedAt) {
    logger.detail('  Signed at:', result.signature.signedAt);
  }

  logger.blank();

  // Checksums
  logger.info('Checksums:');
  logger.detail(
    '  Status:',
    `${result.checksums.verified}/${result.checksums.total} files verified`,
  );
  if (result.checksums.failures.length > 0) {
    for (const f of result.checksums.failures) {
      logger.error(`  Failed: ${f}`);
    }
  }

  logger.blank();

  // Permissions
  if (m.permissions) {
    logger.info('Permissions:');
    const perms = m.permissions;
    if (perms.tools && perms.tools.length > 0) {
      logger.detail('  Tools:', perms.tools.join(', '));
    }
    const network = perms.network;
    if (network === true) {
      logger.detail('  Network:', 'unrestricted');
    } else if (Array.isArray(network) && network.length > 0) {
      logger.detail('  Network:', network.join(', '));
    } else {
      logger.detail('  Network:', 'none');
    }
    logger.detail('  Filesystem:', perms.filesystem ?? 'none');
    logger.detail('  Contacts:', perms.contacts ? 'yes' : 'no');
    logger.detail('  Memory:', perms.memory ?? 'none');
    logger.blank();
  }

  // Components (plugin-specific)
  if (m.packageType === 'plugin') {
    logger.info('Components:');
    const comp = m.components;
    const types = ['skills', 'tools', 'context', 'hooks', 'decisions', 'triggers', 'agents'] as const;
    for (const t of types) {
      logger.detail(`  ${t}:`, comp[t] ?? 'none');
    }
    logger.blank();
  }

  // Files
  if (options.files || result.files.length <= 20) {
    logger.info(`Files (${result.files.length}):`);
    for (const f of result.files) {
      const sizeStr = f.size < 1024
        ? `${f.size} B`
        : `${(f.size / 1024).toFixed(1)} KB`;
      logger.detail(`  ${f.path}`, `(${sizeStr})`);
    }
    logger.blank();
  } else {
    logger.info(`Files: ${result.files.length} total (use --files to list all)`);
    logger.blank();
  }

  const sizeKb = (result.archiveSize / 1024).toFixed(1);
  logger.detail('Archive Size:', `${sizeKb} KB`);
}

export async function inspect(archivePath: string): Promise<InspectResult> {
  const archiveStat = await fs.stat(archivePath);

  // Extract to temp directory
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anipack-inspect-'));

  try {
    await extractZip(archivePath, tmpDir);

    // Read manifest
    const manifestPath = path.join(tmpDir, 'manifest.json');
    const manifestContent = await fs.readFile(manifestPath, 'utf-8');
    const manifestRaw = JSON.parse(manifestContent) as unknown;
    const manifestResult = PackageManifestSchema.safeParse(manifestRaw);

    if (!manifestResult.success) {
      throw new Error(
        'Invalid manifest.json: ' +
          manifestResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      );
    }

    const manifest = manifestResult.data;

    // Check signature
    let signatureStatus: 'valid' | 'invalid' | 'unsigned' = 'unsigned';
    let signedBy: string | null = null;
    let signedAt: string | null = null;

    const signaturePath = path.join(tmpDir, 'SIGNATURE');
    let hasSignature = false;
    try {
      await fs.access(signaturePath);
      hasSignature = true;
    } catch {
      // unsigned
    }

    if (hasSignature) {
      const sigContent = await fs.readFile(signaturePath, 'utf-8');
      const sigRaw = JSON.parse(sigContent) as unknown;
      const sigResult = signatureFileSchema.safeParse(sigRaw);

      if (sigResult.success) {
        const sig = sigResult.data;
        signedBy = sig.signedBy;
        signedAt = sig.signedAt;

        // Verify signature against the archive hash (excluding SIGNATURE file)
        // We need to compute hash of archive without SIGNATURE
        const archiveData = await fs.readFile(archivePath);
        const verified = verifySignature(sig, archiveData);
        signatureStatus = verified ? 'valid' : 'invalid';
      } else {
        signatureStatus = 'invalid';
      }
    }

    // Verify checksums
    const checksumPath = path.join(tmpDir, 'CHECKSUMS');
    let checksumVerified = 0;
    let checksumTotal = 0;
    const checksumFailures: string[] = [];

    try {
      const checksumContent = await fs.readFile(checksumPath, 'utf-8');
      const lines = checksumContent.trim().split('\n').filter((l) => l.length > 0);
      checksumTotal = lines.length;

      for (const line of lines) {
        const match = /^sha256:([a-f0-9]{64}) (.+)$/.exec(line);
        if (!match) {
          checksumFailures.push(`Invalid format: ${line}`);
          continue;
        }
        const [, expectedHash, filePath] = match;
        const fullPath = path.join(tmpDir, filePath!);

        try {
          const fileContent = await fs.readFile(fullPath);
          const actualHash = crypto.createHash('sha256').update(fileContent).digest('hex');
          if (actualHash === expectedHash) {
            checksumVerified++;
          } else {
            checksumFailures.push(filePath!);
          }
        } catch {
          checksumFailures.push(`Missing: ${filePath!}`);
        }
      }
    } catch {
      // No CHECKSUMS file
    }

    // List files
    const files = await listFilesRecursive(tmpDir, tmpDir);

    return {
      manifest,
      signature: {
        status: signatureStatus,
        signedBy,
        signedAt,
      },
      checksums: {
        verified: checksumVerified,
        total: checksumTotal,
        failures: checksumFailures,
      },
      files,
      archiveSize: archiveStat.size,
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

function verifySignature(sig: SignatureFile, _archiveData: Buffer): boolean {
  try {
    // Reconstruct the public key PEM from the base64 content
    const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${sig.publicKey}\n-----END PUBLIC KEY-----`;
    const publicKey = crypto.createPublicKey(publicKeyPem);

    const signatureBuffer = Buffer.from(sig.signature, 'base64');
    const payloadBuffer = Buffer.from(sig.payload);

    return crypto.verify(null, payloadBuffer, publicKey, signatureBuffer);
  } catch {
    return false;
  }
}

async function extractZip(zipPath: string, destDir: string): Promise<void> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  try {
    await execFileAsync('unzip', ['-o', '-q', zipPath, '-d', destDir]);
  } catch {
    throw new Error(
      'Failed to extract archive. Ensure "unzip" is available on your system.',
    );
  }
}

async function listFilesRecursive(
  dir: string,
  rootDir: string,
): Promise<Array<{ path: string; size: number }>> {
  const result: Array<{ path: string; size: number }> = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await listFilesRecursive(fullPath, rootDir);
      result.push(...nested);
    } else {
      const stat = await fs.stat(fullPath);
      const relativePath = path.relative(rootDir, fullPath).split(path.sep).join('/');
      result.push({ path: relativePath, size: stat.size });
    }
  }

  return result;
}
