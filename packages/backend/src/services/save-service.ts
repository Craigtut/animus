/**
 * Save Service
 *
 * Creates, lists, exports, imports, and deletes save snapshots of Animus's
 * AI-related databases (persona, heartbeat, memory, messages) and LanceDB
 * vector store. System.db and agent_logs.db are excluded — they contain
 * user credentials and ephemeral logs, not AI state.
 *
 * Each save is a directory under `data/saves/{uuid}/` containing:
 *   - persona.db, heartbeat.db, memory.db, messages.db (SQLite backups)
 *   - lancedb/ (recursive copy of the vector store)
 *   - manifest.json (metadata, stats, schema versions)
 */

import path from 'path';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import archiver from 'archiver';
import extractZip from 'extract-zip';
import { saveManifestSchema } from '@animus/shared';
import type { SaveManifest, SaveInfo } from '@animus/shared';
import { env } from '../utils/env.js';
import { getPersonaDb, getHeartbeatDb, getMemoryDb, getMessagesDb } from '../db/index.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('SaveService', 'saves');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SAVES_DIR = path.join(path.dirname(env.DB_SYSTEM_PATH), 'saves');

const DB_NAMES = ['persona', 'heartbeat', 'memory', 'messages'] as const;
type DbName = (typeof DB_NAMES)[number];

/** Read root package.json version at import time. */
async function getAnimusVersion(): Promise<string> {
  try {
    const pkgPath = path.resolve(
      path.dirname(env.DB_SYSTEM_PATH),
      '..',
      'package.json',
    );
    const raw = await fs.readFile(pkgPath, 'utf-8');
    return JSON.parse(raw).version ?? '0.0.0';
  } catch {
    // Fallback: walk up from this file to find root package.json
    try {
      // services/ -> src/ -> backend/ -> packages/ -> root
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

async function getDirectorySize(dirPath: string): Promise<number> {
  let size = 0;
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isFile()) {
        const stat = await fs.stat(fullPath);
        size += stat.size;
      } else if (entry.isDirectory()) {
        size += await getDirectorySize(fullPath);
      }
    }
  } catch {
    // directory doesn't exist or unreadable
  }
  return size;
}

/**
 * Extract the numeric prefix from a migration version string.
 * E.g. "001_initial" -> 1, "002_energy_state" -> 2
 */
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

/** Map DB name to the live getter function. */
function getLiveDb(name: DbName): Database.Database {
  switch (name) {
    case 'persona':
      return getPersonaDb();
    case 'heartbeat':
      return getHeartbeatDb();
    case 'memory':
      return getMemoryDb();
    case 'messages':
      return getMessagesDb();
  }
}

/** Gather stats from backed-up database files. */
function gatherStats(
  saveDir: string,
): { tickCount: number; messageCount: number; memoryCount: number; personaName?: string } {
  const stats: { tickCount: number; messageCount: number; memoryCount: number; personaName?: string } = {
    tickCount: 0, messageCount: 0, memoryCount: 0,
  };

  // Tick count from heartbeat.db -> heartbeat_state
  const hbPath = path.join(saveDir, 'heartbeat.db');
  try {
    const db = new Database(hbPath, { readonly: true });
    try {
      const row = db.prepare('SELECT tick_number FROM heartbeat_state WHERE id = 1').get() as
        | { tick_number: number }
        | undefined;
      stats.tickCount = row?.tick_number ?? 0;
    } finally {
      db.close();
    }
  } catch {
    log.warn('Could not read tick count from heartbeat.db');
  }

  // Message count from messages.db
  const msgPath = path.join(saveDir, 'messages.db');
  try {
    const db = new Database(msgPath, { readonly: true });
    try {
      const row = db.prepare('SELECT COUNT(*) as cnt FROM messages').get() as { cnt: number };
      stats.messageCount = row.cnt;
    } finally {
      db.close();
    }
  } catch {
    log.warn('Could not read message count from messages.db');
  }

  // Memory count from memory.db
  const memPath = path.join(saveDir, 'memory.db');
  try {
    const db = new Database(memPath, { readonly: true });
    try {
      const row = db.prepare('SELECT COUNT(*) as cnt FROM long_term_memories').get() as { cnt: number };
      stats.memoryCount = row.cnt;
    } finally {
      db.close();
    }
  } catch {
    log.warn('Could not read memory count from memory.db');
  }

  // Persona name from persona.db
  const personaPath = path.join(saveDir, 'persona.db');
  try {
    const db = new Database(personaPath, { readonly: true });
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

async function readManifest(saveDir: string): Promise<SaveManifest | null> {
  try {
    const raw = await fs.readFile(path.join(saveDir, 'manifest.json'), 'utf-8');
    const parsed = saveManifestSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      log.warn('Invalid manifest in', saveDir, parsed.error.message);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a save snapshot of all AI databases.
 */
export async function createSave(name: string, description?: string): Promise<SaveInfo> {
  acquireGuard();
  try {
    const id = randomUUID();
    const saveDir = path.join(SAVES_DIR, id);
    await fs.mkdir(saveDir, { recursive: true });

    log.info(`Creating save "${name}" (${id})`);

    // Backup each database using better-sqlite3's safe backup API
    for (const dbName of DB_NAMES) {
      const destPath = path.join(saveDir, `${dbName}.db`);
      await getLiveDb(dbName).backup(destPath);
    }

    // Copy LanceDB directory
    try {
      await fs.cp(env.LANCEDB_PATH, path.join(saveDir, 'lancedb'), { recursive: true });
    } catch {
      // LanceDB might not exist yet if no embeddings have been created
      await fs.mkdir(path.join(saveDir, 'lancedb'), { recursive: true });
      log.warn('LanceDB directory not found, created empty directory');
    }

    // Read schema versions from backed-up DBs
    const schemaVersions: Record<string, number> = {};
    for (const dbName of DB_NAMES) {
      schemaVersions[dbName] = getSchemaVersion(path.join(saveDir, `${dbName}.db`));
    }

    // Gather stats
    const stats = gatherStats(saveDir);
    const animusVersion = await getAnimusVersion();

    // Write manifest
    const manifest: SaveManifest = {
      version: 1,
      name,
      description,
      createdAt: new Date().toISOString(),
      animusVersion,
      schemaVersions,
      stats,
    };
    await fs.writeFile(path.join(saveDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    const sizeBytes = await getDirectorySize(saveDir);

    log.info(`Save "${name}" created (${id}), ${(sizeBytes / 1024 / 1024).toFixed(1)} MB`);

    return { id, manifest, sizeBytes };
  } catch (err) {
    log.error('Failed to create save:', err);
    throw err;
  } finally {
    releaseGuard();
  }
}

/**
 * List all saves, sorted by creation date (newest first).
 */
export async function listSaves(): Promise<SaveInfo[]> {
  const saves: SaveInfo[] = [];

  let dirNames: string[];
  try {
    const entries = await fs.readdir(SAVES_DIR, { withFileTypes: true });
    dirNames = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    // saves directory doesn't exist yet
    return [];
  }

  for (const dirName of dirNames) {
    const saveDir = path.join(SAVES_DIR, dirName);
    const manifest = await readManifest(saveDir);
    if (!manifest) {
      log.warn(`Skipping save "${dirName}" — invalid or missing manifest`);
      continue;
    }

    const sizeBytes = await getDirectorySize(saveDir);
    saves.push({ id: dirName, manifest, sizeBytes });
  }

  // Sort newest first
  saves.sort((a, b) => b.manifest.createdAt.localeCompare(a.manifest.createdAt));

  return saves;
}

/**
 * Get a single save by ID.
 */
export async function getSave(saveId: string): Promise<SaveInfo | null> {
  const saveDir = path.join(SAVES_DIR, saveId);
  const manifest = await readManifest(saveDir);
  if (!manifest) return null;

  const sizeBytes = await getDirectorySize(saveDir);
  return { id: saveId, manifest, sizeBytes };
}

/**
 * Delete a save.
 */
export async function deleteSave(saveId: string): Promise<void> {
  const saveDir = path.join(SAVES_DIR, saveId);

  // Verify it exists
  try {
    await fs.access(saveDir);
  } catch {
    throw new Error(`Save "${saveId}" not found`);
  }

  await fs.rm(saveDir, { recursive: true, force: true });
  log.info(`Deleted save "${saveId}"`);
}

/**
 * Export a save as a zip buffer for download.
 */
export async function exportSave(saveId: string): Promise<{ buffer: Buffer; name: string }> {
  acquireGuard();
  try {
    const saveDir = path.join(SAVES_DIR, saveId);
    const manifest = await readManifest(saveDir);
    if (!manifest) {
      throw new Error(`Save "${saveId}" not found or has invalid manifest`);
    }

    log.info(`Exporting save "${manifest.name}" (${saveId})`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    const chunks: Buffer[] = [];

    const collectPromise = new Promise<Buffer>((resolve, reject) => {
      archive.on('data', (chunk: Buffer) => chunks.push(chunk));
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);
    });

    archive.directory(saveDir, false);
    await archive.finalize();

    const buffer = await collectPromise;
    const safeName = manifest.name.replace(/[^a-zA-Z0-9_-]/g, '_');

    log.info(`Export complete: ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);

    return { buffer, name: safeName };
  } finally {
    releaseGuard();
  }
}

/**
 * Import a save from a zip buffer.
 */
export async function importSave(fileBuffer: Buffer): Promise<SaveInfo> {
  acquireGuard();
  const tempDir = path.join(tmpdir(), `animus-import-${randomUUID()}`);

  try {
    await fs.mkdir(tempDir, { recursive: true });

    // Write buffer to temp zip
    const zipPath = path.join(tempDir, 'import.zip');
    await fs.writeFile(zipPath, fileBuffer);

    // Extract
    const extractDir = path.join(tempDir, 'extracted');
    await fs.mkdir(extractDir, { recursive: true });
    await extractZip(zipPath, { dir: extractDir });

    // Validate manifest
    const manifest = await readManifest(extractDir);
    if (!manifest) {
      throw new Error('Invalid or missing manifest.json in save archive');
    }

    // Verify expected DB files exist
    for (const dbName of DB_NAMES) {
      try {
        await fs.access(path.join(extractDir, `${dbName}.db`));
      } catch {
        throw new Error(`Missing required database file: ${dbName}.db`);
      }
    }

    // Ensure lancedb directory exists (create if not present in archive)
    const lanceDir = path.join(extractDir, 'lancedb');
    try {
      await fs.access(lanceDir);
    } catch {
      await fs.mkdir(lanceDir, { recursive: true });
    }

    // Assign new UUID and move to saves directory
    const id = randomUUID();
    const destDir = path.join(SAVES_DIR, id);
    await fs.mkdir(path.dirname(destDir), { recursive: true });
    await fs.rename(extractDir, destDir);

    const sizeBytes = await getDirectorySize(destDir);

    log.info(`Imported save "${manifest.name}" as ${id}`);

    return { id, manifest, sizeBytes };
  } catch (err) {
    log.error('Failed to import save:', err);
    throw err;
  } finally {
    // Cleanup temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
    releaseGuard();
  }
}
