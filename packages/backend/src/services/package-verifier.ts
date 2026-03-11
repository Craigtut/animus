/**
 * Package Verifier — 4-layer verification for .anpk packages.
 *
 * Verification chain:
 *   1. Format check  — valid ZIP, manifest.json at root, CHECKSUMS at root
 *   2. Signature      — Ed25519 verify using Animus Labs public key
 *   3. Manifest       — parse and validate against PackageManifestSchema
 *   4. Checksums      — SHA-256 verify each file against CHECKSUMS entries
 *
 * See docs/architecture/distribution-security.md for the full security model.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import extractZip from 'extract-zip';
import { createLogger } from '../lib/logger.js';
import {
  PackageManifestSchema,
  signatureFileSchema,
  ANIMUS_LABS_PUBLIC_KEY,
  SUPPORTED_FORMAT_VERSION,
} from '@animus-labs/shared';
import type {
  VerificationResult,
  PackageManifest,
  SignatureFile,
} from '@animus-labs/shared';

const log = createLogger('PackageVerifier', 'distribution');

/**
 * Verify a .anpk package file through 4 layers of verification.
 *
 * Returns a VerificationResult with all findings. The `valid` flag is true
 * only when all critical checks pass (format, manifest, checksums).
 * Signature failures produce warnings for unsigned packages, errors for
 * invalid signatures.
 */
export async function verifyPackage(anpkPath: string): Promise<VerificationResult> {
  const result: VerificationResult = {
    valid: false,
    manifest: null,
    signature: {
      status: 'unsigned',
      signedBy: null,
      signedAt: null,
    },
    checksums: {
      verified: 0,
      total: 0,
      failures: [],
    },
    errors: [],
    warnings: [],
  };

  // ── Layer 1: Format Check ────────────────────────────────────────────
  log.debug(`Verifying package format: ${anpkPath}`);

  if (!fs.existsSync(anpkPath)) {
    result.errors.push(`Package file not found: ${anpkPath}`);
    return result;
  }

  // Extract to a temporary directory for inspection
  const tempDir = path.join(
    path.dirname(anpkPath),
    `.anpk-verify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );

  try {
    await fsp.mkdir(tempDir, { recursive: true });

    try {
      await extractZip(anpkPath, { dir: tempDir });
    } catch (err) {
      result.errors.push(`Invalid package format: not a valid ZIP archive (${err instanceof Error ? err.message : String(err)})`);
      return result;
    }

    // Check for required files at root
    const manifestPath = path.join(tempDir, 'manifest.json');
    const checksumsPath = path.join(tempDir, 'CHECKSUMS');

    if (!fs.existsSync(manifestPath)) {
      result.errors.push('Invalid package format: manifest.json not found at archive root');
      return result;
    }

    if (!fs.existsSync(checksumsPath)) {
      result.errors.push('Invalid package format: CHECKSUMS not found at archive root');
      return result;
    }

    log.debug('Format check passed');

    // ── Layer 2: Signature Verification ──────────────────────────────────
    const signaturePath = path.join(tempDir, 'SIGNATURE');

    if (fs.existsSync(signaturePath)) {
      log.debug('SIGNATURE file found, verifying...');

      try {
        const sigRaw = await fsp.readFile(signaturePath, 'utf-8');
        const sigJson = JSON.parse(sigRaw);
        const sigFile: SignatureFile = signatureFileSchema.parse(sigJson);

        // Compute SHA-256 of all archive contents EXCEPT the SIGNATURE file
        const archiveHash = await computeArchiveHash(tempDir, 'SIGNATURE');
        const expectedPayload = `sha256:${archiveHash}`;

        if (sigFile.payload !== expectedPayload) {
          result.errors.push(
            `Signature payload mismatch: expected ${expectedPayload}, got ${sigFile.payload}`,
          );
          result.signature.status = 'invalid';
          return result;
        }

        // Verify Ed25519 signature
        const signatureBuffer = Buffer.from(sigFile.signature, 'base64');
        const payloadBuffer = Buffer.from(sigFile.payload, 'utf-8');

        const isValid = crypto.verify(
          null, // Ed25519 doesn't use a separate hash algorithm
          payloadBuffer,
          ANIMUS_LABS_PUBLIC_KEY,
          signatureBuffer,
        );

        if (!isValid) {
          result.errors.push('Package signature is invalid. This package may have been tampered with.');
          result.signature.status = 'invalid';
          return result;
        }

        result.signature.status = 'valid';
        result.signature.signedBy = sigFile.signedBy;
        result.signature.signedAt = sigFile.signedAt;
        log.debug(`Signature valid (signed by: ${sigFile.signedBy})`);
      } catch (err) {
        if (result.signature.status === 'invalid') {
          // Already set an error above
          return result;
        }
        result.errors.push(`Signature verification failed: ${err instanceof Error ? err.message : String(err)}`);
        result.signature.status = 'invalid';
        return result;
      }
    } else {
      result.warnings.push('Package is not signed. It may not be from a trusted publisher.');
      result.signature.status = 'unsigned';
      log.debug('No SIGNATURE file found — package is unsigned');
    }

    // ── Layer 3: Manifest Validation ─────────────────────────────────────
    log.debug('Validating manifest...');

    let manifest: PackageManifest;
    try {
      const manifestRaw = await fsp.readFile(manifestPath, 'utf-8');
      const manifestJson = JSON.parse(manifestRaw);
      manifest = PackageManifestSchema.parse(manifestJson);
    } catch (err) {
      result.errors.push(`Invalid package manifest: ${err instanceof Error ? err.message : String(err)}`);
      return result;
    }

    result.manifest = manifest;

    // Check format version compatibility
    if (manifest.formatVersion > SUPPORTED_FORMAT_VERSION) {
      result.errors.push(
        `Unsupported package format version ${manifest.formatVersion}. This engine supports format version ${SUPPORTED_FORMAT_VERSION}. Please update the engine.`,
      );
      return result;
    }

    // Check engine version compatibility
    if (manifest.engineVersion) {
      const compatible = checkEngineVersionCompatibility(manifest.engineVersion);
      if (!compatible.ok) {
        result.errors.push(compatible.error!);
        return result;
      }
      if (compatible.warning) {
        result.warnings.push(compatible.warning);
      }
    }

    log.debug(`Manifest valid: ${manifest.name} v${manifest.version} (${manifest.packageType})`);

    // ── Layer 4: Checksum Verification ───────────────────────────────────
    log.debug('Verifying file checksums...');

    const checksumsRaw = await fsp.readFile(checksumsPath, 'utf-8');
    const checksumEntries = parseChecksums(checksumsRaw);

    result.checksums.total = checksumEntries.length;

    for (const entry of checksumEntries) {
      const filePath = path.join(tempDir, entry.path);

      if (!fs.existsSync(filePath)) {
        result.checksums.failures.push(entry.path);
        result.errors.push(`Checksum verification failed: file missing — ${entry.path}`);
        continue;
      }

      const fileHash = await computeFileHash(filePath);
      if (fileHash !== entry.digest) {
        result.checksums.failures.push(entry.path);
        result.errors.push(`Checksum verification failed: ${entry.path} has been modified`);
      } else {
        result.checksums.verified++;
      }
    }

    if (result.checksums.failures.length > 0) {
      return result;
    }

    log.debug(`All ${result.checksums.verified} checksums verified`);

    // ── All checks passed ────────────────────────────────────────────────
    result.valid = true;
    log.info(`Package verified: ${manifest.name} v${manifest.version} (signature: ${result.signature.status})`);
  } finally {
    // Clean up temp directory
    try {
      await fsp.rm(tempDir, { recursive: true, force: true });
    } catch {
      log.warn(`Failed to clean up temp verification directory: ${tempDir}`);
    }
  }

  return result;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Compute SHA-256 of all files in a directory, excluding a specific file.
 * Produces a deterministic hash by sorting file paths alphabetically
 * and hashing "sha256:<file_hash> <relative_path>\n" lines.
 */
async function computeArchiveHash(dir: string, excludeFile: string): Promise<string> {
  const files = await collectFiles(dir);
  // Normalize to forward slashes so the hash matches across platforms.
  // Packages are signed with forward-slash paths; Windows path.relative uses backslashes.
  const relativePaths = files
    .map(f => path.relative(dir, f).replaceAll('\\', '/'))
    .filter(p => p !== excludeFile)
    .sort();

  const hash = crypto.createHash('sha256');
  for (const relPath of relativePaths) {
    const fileHash = await computeFileHash(path.join(dir, relPath));
    hash.update(`sha256:${fileHash} ${relPath}\n`);
  }

  return hash.digest('hex');
}

/** Compute SHA-256 hash of a single file. */
async function computeFileHash(filePath: string): Promise<string> {
  const content = await fsp.readFile(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/** Recursively collect all file paths in a directory. */
async function collectFiles(dir: string): Promise<string[]> {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectFiles(fullPath);
      files.push(...nested);
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Parse the CHECKSUMS file format.
 * Each line: "sha256:<hex-digest> <relative-path>"
 */
function parseChecksums(content: string): Array<{ digest: string; path: string }> {
  const entries: Array<{ digest: string; path: string }> = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(/^sha256:([a-f0-9]{64})\s+(.+)$/);
    if (!match || !match[1] || !match[2]) {
      log.warn(`Invalid CHECKSUMS entry: ${trimmed}`);
      continue;
    }

    entries.push({ digest: match[1], path: match[2] });
  }

  return entries;
}

/**
 * Check engine version compatibility.
 * Returns { ok: true } if compatible, { ok: false, error } if not.
 */
function checkEngineVersionCompatibility(
  requiredVersion: string,
): { ok: boolean; error?: string; warning?: string } {
  const required = parseVersion(requiredVersion);
  if (!required) {
    return { ok: true, warning: `Could not parse engine version requirement: ${requiredVersion}` };
  }

  const current = getCurrentEngineVersion();
  if (!current) {
    return { ok: true, warning: 'Could not determine current engine version' };
  }

  if (compareVersions(current, required) < 0) {
    return {
      ok: false,
      error: `Package requires engine version >=${requiredVersion} but current version is ${current.join('.')}`,
    };
  }

  return { ok: true };
}

function getCurrentEngineVersion(): [number, number, number] | null {
  try {
    let dir = path.dirname(new URL(import.meta.url).pathname);
    // On Windows, URL.pathname has a leading slash before the drive letter (/C:/...)
    // which is not a valid Windows path. Strip it.
    if (process.platform === 'win32' && dir.startsWith('/') && /^\/[A-Za-z]:/.test(dir)) {
      dir = dir.slice(1);
    }
    for (let i = 0; i < 6; i++) {
      const pkgPath = path.join(dir, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.workspaces) {
          return parseVersion(pkg.version as string);
        }
      }
      dir = path.dirname(dir);
    }
  } catch {
    // ignore
  }
  return null;
}

function parseVersion(ver: string): [number, number, number] | null {
  const cleaned = ver.replace(/^[>=~^]+/, '');
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match || !match[1] || !match[2] || !match[3]) return null;
  return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
}

function compareVersions(a: [number, number, number], b: [number, number, number]): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] - b[2];
}
