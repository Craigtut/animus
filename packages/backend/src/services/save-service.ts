/**
 * Save Service
 *
 * Creates, lists, exports, imports, and deletes save snapshots of Animus's
 * AI-related databases (persona, heartbeat, memory, messages, agent_logs)
 * and LanceDB vector store. System.db is excluded — it contains user
 * credentials and engine infrastructure, not AI state.
 *
 * Each save is stored in `data/saves/` as:
 *   {uuid}.animus  — zip archive (DBs + lancedb/ + manifest.json)
 *   {uuid}.json    — sidecar manifest cache (for fast listing without unzipping)
 */

import path from 'path';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import archiver from 'archiver';
import extractZip from 'extract-zip';
import { saveManifestSchema } from '@animus-labs/shared';
import type { SaveManifest, SaveInfo } from '@animus-labs/shared';
import { DATA_DIR, LANCEDB_PATH } from '../utils/env.js';
import { getPersonaDb, getHeartbeatDb, getMemoryDb, getMessagesDb, getAgentLogsDb } from '../db/index.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('SaveService', 'saves');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SAVES_DIR = path.join(DATA_DIR, 'saves');

const DB_NAMES = ['persona', 'heartbeat', 'memory', 'messages', 'agent_logs'] as const;
type DbName = (typeof DB_NAMES)[number];

/** Read root package.json version. */
async function getAnimusVersion(): Promise<string> {
  try {
    const pkgPath = path.resolve(DATA_DIR, '..', 'package.json');
    const raw = await fs.readFile(pkgPath, 'utf-8');
    return JSON.parse(raw).version ?? '0.0.0';
  } catch {
    try {
      const thisDir = path.dirname(fileURLToPath(import.meta.url));
      const rootPkg = path.resolve(thisDir, '..', '..', '..', '..', 'package.json');
      const raw = await fs.readFile(rootPkg, 'utf-8');
      return JSON.parse(raw).version ?? '0.0.0';
    } catch {
      return '0.0.0';
    }
  }
}

// ---------------------------------------------------------------------------
// Concurrency guard (shared with restore-service)
// ---------------------------------------------------------------------------

export let operationInProgress = false;

function acquireGuard(): void {
  if (operationInProgress) {
    throw new Error('A save or restore operation is already in progress');
  }
  operationInProgress = true;
}

function releaseGuard(): void {
  operationInProgress = false;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSchemaVersion(dbPath: string): number {
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .prepare('SELECT version FROM _migrations ORDER BY version DESC LIMIT 1')
      .all() as { version: string }[];
    const first = rows[0];
    if (!first) return 0;
    const prefix = first.version.split('_')[0] ?? '0';
    return parseInt(prefix, 10);
  } catch {
    return 0;
  } finally {
    db.close();
  }
}

function getLiveDb(name: DbName): Database.Database {
  switch (name) {
    case 'persona': return getPersonaDb();
    case 'heartbeat': return getHeartbeatDb();
    case 'memory': return getMemoryDb();
    case 'messages': return getMessagesDb();
    case 'agent_logs': return getAgentLogsDb();
  }
}

/** Gather stats from backed-up database files in a staging directory. */
function gatherStats(
  stageDir: string,
): { tickCount: number; messageCount: number; memoryCount: number; personaName?: string } {
  const stats: { tickCount: number; messageCount: number; memoryCount: number; personaName?: string } = {
    tickCount: 0, messageCount: 0, memoryCount: 0,
  };

  const queries: { file: string; sql: string; key: keyof typeof stats }[] = [
    { file: 'heartbeat.db', sql: 'SELECT tick_number FROM heartbeat_state WHERE id = 1', key: 'tickCount' },
    { file: 'messages.db', sql: 'SELECT COUNT(*) as cnt FROM messages', key: 'messageCount' },
    { file: 'memory.db', sql: 'SELECT COUNT(*) as cnt FROM long_term_memories', key: 'memoryCount' },
  ];

  for (const { file, sql, key } of queries) {
    try {
      const db = new Database(path.join(stageDir, file), { readonly: true });
      try {
        const row = db.prepare(sql).get() as Record<string, number | string> | undefined;
        if (row) (stats as Record<string, string | number>)[key] = (row['tick_number'] ?? row['cnt'] ?? 0) as number;
      } finally {
        db.close();
      }
    } catch {
      log.warn(`Could not read ${key} from ${file}`);
    }
  }

  try {
    const db = new Database(path.join(stageDir, 'persona.db'), { readonly: true });
    try {
      const row = db.prepare('SELECT name FROM personality_settings WHERE id = 1').get() as
        | { name: string }
        | undefined;
      if (row) stats.personaName = row.name;
    } finally {
      db.close();
    }
  } catch {
    log.warn('Could not read persona name from persona.db');
  }

  return stats;
}

/** Read and validate a manifest from a sidecar JSON file. */
async function readSidecar(sidecarPath: string): Promise<SaveManifest | null> {
  try {
    const raw = await fs.readFile(sidecarPath, 'utf-8');
    const parsed = saveManifestSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      log.warn('Invalid sidecar manifest at', sidecarPath, parsed.error.message);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

/** Zip a staging directory into an .animus archive. */
async function zipDirectory(stageDir: string, destPath: string): Promise<void> {
  const archive = archiver('zip', { zlib: { level: 6 } });
  const chunks: Buffer[] = [];

  const collectPromise = new Promise<Buffer>((resolve, reject) => {
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
  });

  archive.directory(stageDir, false);
  await archive.finalize();

  const buffer = await collectPromise;
  await fs.writeFile(destPath, buffer);
}

/** Extract an .animus archive to a directory using extract-zip. */
export async function extractArchive(archivePath: string, destDir: string): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });
  await extractZip(archivePath, { dir: destDir });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a save snapshot of all AI databases.
 *
 * 1. Backup DBs to a temp staging directory
 * 2. Copy LanceDB
 * 3. Gather stats + schema versions
 * 4. Write manifest.json into staging dir
 * 5. Zip staging dir → {uuid}.animus
 * 6. Write {uuid}.json sidecar
 * 7. Clean up staging dir
 */
export async function createSave(name: string, description?: string): Promise<SaveInfo> {
  acquireGuard();
  const stageDir = path.join(tmpdir(), `animus-save-${randomUUID()}`);

  try {
    const id = randomUUID();
    await fs.mkdir(SAVES_DIR, { recursive: true });
    await fs.mkdir(stageDir, { recursive: true });

    log.info(`Creating save "${name}" (${id})`);

    // Backup each database using better-sqlite3's safe backup API
    for (const dbName of DB_NAMES) {
      await getLiveDb(dbName).backup(path.join(stageDir, `${dbName}.db`));
    }

    // Copy LanceDB directory
    try {
      await fs.cp(LANCEDB_PATH, path.join(stageDir, 'lancedb'), { recursive: true });
    } catch {
      await fs.mkdir(path.join(stageDir, 'lancedb'), { recursive: true });
      log.warn('LanceDB directory not found, created empty directory');
    }

    // Read schema versions from backed-up DBs
    const schemaVersions: Record<string, number> = {};
    for (const dbName of DB_NAMES) {
      schemaVersions[dbName] = getSchemaVersion(path.join(stageDir, `${dbName}.db`));
    }

    // Build manifest
    const stats = gatherStats(stageDir);
    const manifest: SaveManifest = {
      version: 1,
      name,
      description,
      createdAt: new Date().toISOString(),
      animusVersion: await getAnimusVersion(),
      schemaVersions,
      stats,
    };

    // Write manifest into staging dir (included in the zip)
    await fs.writeFile(path.join(stageDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    // Zip staging dir → .animus file
    const animusPath = path.join(SAVES_DIR, `${id}.animus`);
    await zipDirectory(stageDir, animusPath);

    // Write sidecar JSON (for fast listing)
    await fs.writeFile(path.join(SAVES_DIR, `${id}.json`), JSON.stringify(manifest, null, 2));

    const stat = await fs.stat(animusPath);
    const sizeBytes = stat.size;

    log.info(`Save "${name}" created (${id}), ${(sizeBytes / 1024 / 1024).toFixed(1)} MB`);

    return { id, manifest, sizeBytes };
  } catch (err) {
    log.error('Failed to create save:', err);
    throw err;
  } finally {
    await fs.rm(stageDir, { recursive: true, force: true }).catch(() => {});
    releaseGuard();
  }
}

/**
 * List all saves, sorted by creation date (newest first).
 * Reads from sidecar .json files for speed.
 */
export async function listSaves(): Promise<SaveInfo[]> {
  const saves: SaveInfo[] = [];

  let entries: string[];
  try {
    entries = await fs.readdir(SAVES_DIR);
  } catch {
    return [];
  }

  // Find all .animus files and pair with their .json sidecars
  const animusFiles = entries.filter((e) => e.endsWith('.animus'));

  for (const file of animusFiles) {
    const id = file.replace('.animus', '');
    const sidecarPath = path.join(SAVES_DIR, `${id}.json`);
    const animusPath = path.join(SAVES_DIR, file);

    const manifest = await readSidecar(sidecarPath);
    if (!manifest) {
      log.warn(`Skipping save "${id}" — missing or invalid sidecar`);
      continue;
    }

    try {
      const stat = await fs.stat(animusPath);
      saves.push({ id, manifest, sizeBytes: stat.size });
    } catch {
      log.warn(`Skipping save "${id}" — cannot stat .animus file`);
    }
  }

  saves.sort((a, b) => b.manifest.createdAt.localeCompare(a.manifest.createdAt));
  return saves;
}

/**
 * Get a single save by ID.
 */
export async function getSave(saveId: string): Promise<SaveInfo | null> {
  const sidecarPath = path.join(SAVES_DIR, `${saveId}.json`);
  const animusPath = path.join(SAVES_DIR, `${saveId}.animus`);

  const manifest = await readSidecar(sidecarPath);
  if (!manifest) return null;

  try {
    const stat = await fs.stat(animusPath);
    return { id: saveId, manifest, sizeBytes: stat.size };
  } catch {
    return null;
  }
}

/**
 * Delete a save (both .animus and .json sidecar).
 */
export async function deleteSave(saveId: string): Promise<void> {
  const animusPath = path.join(SAVES_DIR, `${saveId}.animus`);
  const sidecarPath = path.join(SAVES_DIR, `${saveId}.json`);

  try {
    await fs.access(animusPath);
  } catch {
    throw new Error(`Save "${saveId}" not found`);
  }

  await fs.rm(animusPath, { force: true });
  await fs.rm(sidecarPath, { force: true });
  log.info(`Deleted save "${saveId}"`);
}

/**
 * Export a save — returns the .animus file buffer directly.
 * The .animus file IS the export format; no extra zipping needed.
 */
export async function exportSave(saveId: string): Promise<{ buffer: Buffer; name: string }> {
  const animusPath = path.join(SAVES_DIR, `${saveId}.animus`);
  const sidecarPath = path.join(SAVES_DIR, `${saveId}.json`);

  const manifest = await readSidecar(sidecarPath);
  if (!manifest) {
    throw new Error(`Save "${saveId}" not found or has invalid manifest`);
  }

  log.info(`Exporting save "${manifest.name}" (${saveId})`);

  const buffer = await fs.readFile(animusPath);
  const safeName = manifest.name.replace(/[^a-zA-Z0-9_-]/g, '_');

  return { buffer, name: safeName };
}

/**
 * Import a save from an .animus file buffer.
 *
 * 1. Write buffer to temp .animus file
 * 2. Extract to temp dir to validate manifest + required files
 * 3. Copy .animus to saves dir with new UUID
 * 4. Write sidecar .json
 * 5. Clean up temp
 */
export async function importSave(fileBuffer: Buffer): Promise<SaveInfo> {
  acquireGuard();
  const tempDir = path.join(tmpdir(), `animus-import-${randomUUID()}`);

  try {
    await fs.mkdir(tempDir, { recursive: true });

    // Write buffer to temp file for extraction
    const tempAnimusPath = path.join(tempDir, 'import.animus');
    await fs.writeFile(tempAnimusPath, fileBuffer);

    // Extract to validate contents
    const extractDir = path.join(tempDir, 'extracted');
    await extractArchive(tempAnimusPath, extractDir);

    // Validate manifest
    const manifestPath = path.join(extractDir, 'manifest.json');
    let manifest: SaveManifest;
    try {
      const raw = await fs.readFile(manifestPath, 'utf-8');
      const parsed = saveManifestSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        throw new Error(`Invalid manifest: ${parsed.error.message}`);
      }
      manifest = parsed.data;
    } catch (err) {
      throw new Error(`Invalid or missing manifest.json in save archive: ${err}`);
    }

    // Verify expected DB files exist
    for (const dbName of DB_NAMES) {
      try {
        await fs.access(path.join(extractDir, `${dbName}.db`));
      } catch {
        throw new Error(`Missing required database file: ${dbName}.db`);
      }
    }

    // Assign new UUID, copy .animus to saves dir
    const id = randomUUID();
    await fs.mkdir(SAVES_DIR, { recursive: true });
    await fs.copyFile(tempAnimusPath, path.join(SAVES_DIR, `${id}.animus`));

    // Write sidecar JSON
    await fs.writeFile(path.join(SAVES_DIR, `${id}.json`), JSON.stringify(manifest, null, 2));

    const stat = await fs.stat(path.join(SAVES_DIR, `${id}.animus`));

    log.info(`Imported save "${manifest.name}" as ${id}`);

    return { id, manifest, sizeBytes: stat.size };
  } catch (err) {
    log.error('Failed to import save:', err);
    throw err;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    releaseGuard();
  }
}
