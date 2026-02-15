/**
 * Restore Service
 *
 * Restores Animus AI state from a save snapshot. This is the critical path
 * that swaps database files with a full shutdown/reinit sequence.
 *
 * The restore flow:
 *  1. Validate save exists
 *  2. Enter maintenance mode (503s all API requests)
 *  3. Stop heartbeat, channels, plugins, and in-flight operations
 *  4. Checkpoint and close all databases
 *  5. Create rollback backup, then swap database files
 *  6. Reopen databases (runs migrations to bring old schemas forward)
 *  7. Reinitialize heartbeat, channels, and start if persona is finalized
 *  8. Exit maintenance mode
 */

import path from 'path';
import fs from 'fs/promises';
import { env } from '../utils/env.js';
import { createLogger } from '../lib/logger.js';
import { setMaintenanceMode } from '../lib/maintenance.js';
import { operationInProgress } from './save-service.js';
import { getSave } from './save-service.js';

const log = createLogger('RestoreService', 'saves');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DATA_DIR = path.dirname(env.DB_SYSTEM_PATH);
const ROLLBACK_DIR = path.join(DATA_DIR, '.restore-backup');

const AI_DB_FILES = [
  { name: 'persona.db', envPath: env.DB_PERSONA_PATH },
  { name: 'heartbeat.db', envPath: env.DB_HEARTBEAT_PATH },
  { name: 'memory.db', envPath: env.DB_MEMORY_PATH },
  { name: 'messages.db', envPath: env.DB_MESSAGES_PATH },
];

// ---------------------------------------------------------------------------
// Concurrency guard — reuse save-service's flag via module reference
// ---------------------------------------------------------------------------

let restoreInProgress = false;

function acquireGuard(): void {
  if (operationInProgress || restoreInProgress) {
    throw new Error('A save or restore operation is already in progress');
  }
  restoreInProgress = true;
}

function releaseGuard(): void {
  restoreInProgress = false;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Delete stale WAL and SHM files for the AI databases. */
async function deleteWalFiles(): Promise<void> {
  for (const { envPath } of AI_DB_FILES) {
    for (const suffix of ['-wal', '-shm']) {
      try {
        await fs.rm(envPath + suffix, { force: true });
      } catch {
        // File may not exist — that's fine
      }
    }
  }
}

/** Create rollback backup of current AI databases + LanceDB. */
async function createRollbackBackup(): Promise<void> {
  await fs.rm(ROLLBACK_DIR, { recursive: true, force: true });
  await fs.mkdir(ROLLBACK_DIR, { recursive: true });

  for (const { name, envPath } of AI_DB_FILES) {
    try {
      await fs.copyFile(envPath, path.join(ROLLBACK_DIR, name));
    } catch {
      // DB file may not exist if this is a fresh install
    }
  }

  // Backup LanceDB directory
  try {
    await fs.cp(env.LANCEDB_PATH, path.join(ROLLBACK_DIR, 'lancedb'), { recursive: true });
  } catch {
    // LanceDB may not exist yet
  }
}

/** Restore from rollback backup. */
async function restoreFromRollback(): Promise<void> {
  log.warn('Restoring from rollback backup...');

  for (const { name, envPath } of AI_DB_FILES) {
    const backupPath = path.join(ROLLBACK_DIR, name);
    try {
      await fs.copyFile(backupPath, envPath);
    } catch {
      log.error(`Could not restore ${name} from rollback backup`);
    }
  }

  // Restore LanceDB
  try {
    await fs.rm(env.LANCEDB_PATH, { recursive: true, force: true });
    await fs.cp(path.join(ROLLBACK_DIR, 'lancedb'), env.LANCEDB_PATH, { recursive: true });
  } catch {
    log.error('Could not restore LanceDB from rollback backup');
  }
}

/** Clean up rollback backup directory. */
async function cleanupRollback(): Promise<void> {
  try {
    await fs.rm(ROLLBACK_DIR, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check for orphaned rollback backup from a previous failed restore.
 * Called during startup from initializeDatabases().
 */
export async function checkForOrphanedRollback(): Promise<void> {
  try {
    await fs.access(ROLLBACK_DIR);
    log.warn(
      'Found .restore-backup directory from a previous incomplete restore. ' +
      'Manual investigation may be needed. The directory is at: ' + ROLLBACK_DIR
    );
  } catch {
    // No orphaned backup — normal case
  }
}

/**
 * Restore AI state from a save snapshot.
 *
 * This is a destructive operation that replaces all AI databases and LanceDB
 * with the contents of the save. The current state is backed up in case of
 * failure, but the backup is deleted after successful restore.
 */
export async function restoreFromSave(saveId: string): Promise<void> {
  acquireGuard();

  try {
    // 1. Validate save exists
    const save = await getSave(saveId);
    if (!save) {
      throw new Error(`Save "${saveId}" not found`);
    }

    const saveName = save.manifest.name;
    const savesDir = path.join(DATA_DIR, 'saves');
    const saveDir = path.join(savesDir, saveId);

    log.info(`Starting restore from save "${saveName}" (${saveId})`);

    // 2. Enter maintenance mode
    setMaintenanceMode(true, `Restoring from save "${saveName}"...`);

    // 3. Stop heartbeat (stops ticks, ends mind session, cancels sub-agents)
    const { stopHeartbeat } = await import('../heartbeat/index.js');
    await stopHeartbeat();
    log.info('Heartbeat stopped');

    // 4. Stop channels
    const { getChannelManager } = await import('../channels/channel-manager.js');
    const channelManager = getChannelManager();
    await channelManager.stopAll();
    log.info('Channels stopped');

    // 5. Stop plugin triggers
    const { getPluginManager } = await import('./plugin-manager.js');
    const pluginManager = getPluginManager();
    await pluginManager.stopTriggers();
    log.info('Plugin triggers stopped');

    // 6. Wait for in-flight observational memory
    const { waitForActiveOps } = await import('../memory/observational-memory/index.js');
    await waitForActiveOps();
    log.info('Observational memory operations complete');

    // 7. Checkpoint all AI databases (flush WAL into main file)
    const { getPersonaDb, getHeartbeatDb, getMemoryDb, getMessagesDb } = await import('../db/index.js');
    const dbs = [getPersonaDb(), getHeartbeatDb(), getMemoryDb(), getMessagesDb()];
    for (const db of dbs) {
      try {
        db.pragma('wal_checkpoint(TRUNCATE)');
      } catch {
        // DB might be in an odd state — checkpoint is best-effort
      }
    }
    log.info('Database WAL checkpoints complete');

    // 8. Close all database connections
    const { closeDatabases, initializeDatabases } = await import('../db/index.js');
    closeDatabases();
    log.info('All databases closed');

    // 9-11. Create rollback, swap files, cleanup
    try {
      // 9. Create rollback backup
      await createRollbackBackup();
      log.info('Rollback backup created');

      // 10. Copy save files over live files
      for (const { name, envPath } of AI_DB_FILES) {
        await fs.copyFile(path.join(saveDir, name), envPath);
      }

      // Copy LanceDB
      await fs.rm(env.LANCEDB_PATH, { recursive: true, force: true });
      const saveLanceDir = path.join(saveDir, 'lancedb');
      try {
        await fs.cp(saveLanceDir, env.LANCEDB_PATH, { recursive: true });
      } catch {
        // Save might have an empty lancedb or none at all
        await fs.mkdir(env.LANCEDB_PATH, { recursive: true });
      }

      // Delete stale WAL/SHM files (save DBs are clean, no WAL)
      await deleteWalFiles();

      log.info('Database files swapped');

      // 11. Clean up rollback backup
      await cleanupRollback();
      log.info('Rollback backup cleaned up');
    } catch (swapError) {
      // Swap failed — restore from rollback
      log.error('File swap failed, restoring from rollback:', swapError);
      await restoreFromRollback();
      await deleteWalFiles();

      // Reopen DBs so the server can continue operating
      await initializeDatabases();
      setMaintenanceMode(false, '');
      throw new Error(`Restore failed during file swap: ${swapError}`);
    }

    // 12. Reopen databases (runs migrations to bring old schemas forward)
    await initializeDatabases();
    log.info('Databases reopened and migrations applied');

    // 13. Reinitialize heartbeat
    const { initializeHeartbeat, startHeartbeat } = await import('../heartbeat/index.js');
    await initializeHeartbeat();
    log.info('Heartbeat reinitialized');

    // 14. Reload channels
    channelManager.registerBuiltIn('web', async () => {
      // No-op: web outbound is handled by message:sent event → tRPC subscription
    });
    await channelManager.loadAll();
    log.info('Channels reloaded');

    // 15. Start heartbeat if persona is finalized
    const { getPersonaDb: getRestoredPersonaDb } = await import('../db/index.js');
    const { getPersona } = await import('../db/stores/persona-store.js');
    const persona = getPersona(getRestoredPersonaDb());
    if (persona.isFinalized) {
      startHeartbeat();
      log.info('Heartbeat started');
    }

    // 16. Exit maintenance mode
    setMaintenanceMode(false, '');
    log.info(`Restore from save "${saveName}" complete`);
  } catch (err) {
    // Ensure maintenance mode is cleared even on unexpected errors
    setMaintenanceMode(false, '');
    log.error('Restore failed:', err);
    throw err;
  } finally {
    releaseGuard();
  }
}
