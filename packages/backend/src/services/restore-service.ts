/**
 * Restore Service
 *
 * Restores Animus AI state from a .animus save archive. This is the critical
 * path that extracts database files and swaps them with a full shutdown/reinit.
 *
 * The restore flow:
 *  1. Validate save exists
 *  2. Extract .animus zip to temp directory
 *  3. Enter maintenance mode (503s all API requests)
 *  4. Stop heartbeat, channels, plugins, and in-flight operations
 *  5. Checkpoint and close all databases
 *  6. Create rollback backup, then swap database files from extracted save
 *  7. Reopen databases (runs migrations to bring old schemas forward)
 *  8. Reinitialize heartbeat, channels, and start if persona and provider are ready
 *  9. Exit maintenance mode
 *  10. Clean up temp directory
 */

import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { DATA_DIR, LANCEDB_PATH } from '../utils/env.js';
import { createLogger } from '../lib/logger.js';
import { setMaintenanceMode } from '../lib/maintenance.js';
import { operationInProgress, getSave, extractArchive, getArchivePath } from './save-service.js';
import {
  SAVE_ARCHIVE_DATABASES,
  planArchiveDatabaseRestore,
} from './save-archive-registry.js';

const log = createLogger('RestoreService', 'saves');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------


const ROLLBACK_DIR = path.join(DATA_DIR, '.restore-backup');

// ---------------------------------------------------------------------------
// Concurrency guard
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
  for (const { envPath } of SAVE_ARCHIVE_DATABASES) {
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

  for (const { fileName, envPath } of SAVE_ARCHIVE_DATABASES) {
    try {
      await fs.copyFile(envPath, path.join(ROLLBACK_DIR, fileName));
    } catch {
      // DB file may not exist if this is a fresh install
    }
  }

  try {
    await fs.cp(LANCEDB_PATH, path.join(ROLLBACK_DIR, 'lancedb'), { recursive: true });
  } catch {
    // LanceDB may not exist yet
  }
}

/** Restore from rollback backup. */
async function restoreFromRollback(): Promise<void> {
  log.warn('Restoring from rollback backup...');

  for (const { fileName, envPath } of SAVE_ARCHIVE_DATABASES) {
    const backupPath = path.join(ROLLBACK_DIR, fileName);
    try {
      await fs.copyFile(backupPath, envPath);
    } catch {
      log.error(`Could not restore ${fileName} from rollback backup`);
    }
  }

  try {
    await fs.rm(LANCEDB_PATH, { recursive: true, force: true });
    await fs.cp(path.join(ROLLBACK_DIR, 'lancedb'), LANCEDB_PATH, { recursive: true });
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

/** Restore the pre-restore backup and reopen databases. */
async function recoverFromRollback(): Promise<void> {
  const { closeDatabases, initializeDatabases } = await import('../db/index.js');
  closeDatabases();
  await restoreFromRollback();
  await deleteWalFiles();
  await initializeDatabases();
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
 * Restore AI state from a .animus save archive.
 *
 * Extracts the archive to a temp directory, then swaps the database files
 * through a full shutdown/reinit cycle. The current state is backed up
 * for rollback in case of failure.
 */
export async function restoreFromSave(saveId: string): Promise<void> {
  acquireGuard();
  const extractDir = path.join(tmpdir(), `animus-restore-${randomUUID()}`);
  let rollbackAvailable = false;
  let restoreComplete = false;

  try {
    // 1. Validate save exists
    const save = await getSave(saveId);
    if (!save) {
      throw new Error(`Save "${saveId}" not found`);
    }

    const saveName = save.manifest.name;
    const animusPath = await getArchivePath(saveId);
    if (!animusPath) {
      throw new Error(`Save archive "${saveId}" not found on disk`);
    }

    log.info(`Starting restore from save "${saveName}" (${saveId})`);

    // 2. Extract .animus archive to temp directory
    await extractArchive(animusPath, extractDir);
    log.info('Archive extracted to temp directory');

    // 3. Enter maintenance mode
    setMaintenanceMode(true, `Restoring from save "${saveName}"...`);

    // 4. Stop heartbeat (stops ticks, ends mind session, cancels sub-agents)
    const { stopHeartbeat } = await import('../heartbeat/index.js');
    await stopHeartbeat();
    log.info('Heartbeat stopped');

    // 5. Stop channels
    const { getChannelManager } = await import('../channels/channel-manager.js');
    const channelManager = getChannelManager();
    await channelManager.stopAll();
    log.info('Channels stopped');

    // 6. Stop plugin triggers
    const { getPluginManager } = await import('../plugins/plugin-manager.js');
    const pluginManager = getPluginManager();
    await pluginManager.stopTriggers();
    log.info('Plugin triggers stopped');

    // 7. Wait for in-flight observational memory
    const { waitForActiveOps } = await import('../memory/observational-memory/index.js');
    await waitForActiveOps();
    log.info('Observational memory operations complete');

    // 8. Checkpoint all AI databases (flush WAL into main file)
    const { getPersonaDb, getHeartbeatDb, getMemoryDb, getMessagesDb, getAgentLogsDb, getContactsDb, getSessionsDb } = await import('../db/index.js');
    const dbs = [
      getPersonaDb(),
      getHeartbeatDb(),
      getMemoryDb(),
      getMessagesDb(),
      getAgentLogsDb(),
      getContactsDb(),
      getSessionsDb(),
    ];
    for (const db of dbs) {
      try {
        db.pragma('wal_checkpoint(TRUNCATE)');
      } catch {
        // DB might be in an odd state — checkpoint is best-effort
      }
    }
    log.info('Database WAL checkpoints complete');

    // 9. Close all database connections
    const { closeDatabases, initializeDatabases } = await import('../db/index.js');
    closeDatabases();
    log.info('All databases closed');

    // 10-12. Create rollback, swap files from extracted archive, cleanup
    try {
      await createRollbackBackup();
      rollbackAvailable = true;
      log.info('Rollback backup created');

      // Normalize the extracted archive into the current database topology.
      const archiveEntries = await fs.readdir(extractDir);
      const restorePlan = planArchiveDatabaseRestore(save.manifest, archiveEntries);
      for (const item of restorePlan) {
        const { database } = item;
        const extractedPath = path.join(extractDir, database.fileName);

        if (item.action === 'copy') {
          await fs.copyFile(extractedPath, database.envPath);
          continue;
        }

        if (item.action === 'create-empty') {
          await fs.rm(database.envPath, { force: true });
          log.info(
            `Archive missing ${database.fileName}; restore will create a fresh database. ` +
            (item.reason ?? ''),
          );
          continue;
        }

        log.info(
          `Archive missing ${database.fileName}; restore will preserve the current database. ` +
          (item.reason ?? ''),
        );
      }

      // Copy LanceDB
      await fs.rm(LANCEDB_PATH, { recursive: true, force: true });
      try {
        await fs.cp(path.join(extractDir, 'lancedb'), LANCEDB_PATH, { recursive: true });
      } catch {
        await fs.mkdir(LANCEDB_PATH, { recursive: true });
      }

      // Delete stale WAL/SHM files (save DBs are clean, no WAL)
      await deleteWalFiles();

      log.info('Database files swapped');
    } catch (swapError) {
      log.error('File swap failed:', swapError);
      throw new Error(`Restore failed during file swap: ${swapError}`);
    }

    // 13. Reopen databases (runs migrations to bring old schemas forward)
    await initializeDatabases();
    log.info('Databases reopened and migrations applied');

    // 13b. Post-restore remap: link restored primary contact to current user
    try {
      const { getSystemDb: getSysDb, getContactsDb: getCtcDb } = await import('../db/index.js');
      const sysDb = getSysDb();
      const ctcDb = getCtcDb();

      // Find the primary contact in the restored contacts.db
      const primaryRow = ctcDb
        .prepare('SELECT id FROM contacts WHERE is_primary = 1 LIMIT 1')
        .get() as { id: string } | undefined;

      // Get the current user from system.db
      const userRow = sysDb
        .prepare('SELECT id FROM users LIMIT 1')
        .get() as { id: string } | undefined;

      if (primaryRow && userRow) {
        // Update users.contact_id to point at the restored primary contact
        sysDb.prepare('UPDATE users SET contact_id = ? WHERE id = ?')
          .run(primaryRow.id, userRow.id);

        // Update the restored contact's user_id to point at the current user
        ctcDb.prepare('UPDATE contacts SET user_id = ? WHERE id = ?')
          .run(userRow.id, primaryRow.id);

        log.info(`Remapped primary contact ${primaryRow.id} to user ${userRow.id}`);
      } else {
        log.warn('Could not remap primary contact: ' +
          (primaryRow ? '' : 'no primary contact in restored contacts.db; ') +
          (userRow ? '' : 'no user in system.db'));
      }
    } catch (err) {
      log.error('Post-restore contact remap failed (non-fatal):', err);
    }

    restoreComplete = true;
    await cleanupRollback();
    rollbackAvailable = false;
    log.info('Rollback backup cleaned up');

    // 14. Reinitialize subsystems and heartbeat
    const { initializeHeartbeat, startHeartbeat, handleAgentComplete, handleScheduledTask } = await import('../heartbeat/index.js');
    const { MemorySubsystem } = await import('../memory/memory-subsystem.js');
    const { GoalSubsystem } = await import('../goals/goal-subsystem.js');
    const { AgentSubsystem } = await import('../heartbeat/agent-subsystem.js');
    const { TaskSubsystem } = await import('../tasks/task-subsystem.js');
    const { LifecycleManager } = await import('../lib/lifecycle.js');

    const { getAutosaveSubsystem } = await import('./autosave-subsystem.js');

    const memSub = new MemorySubsystem();
    const goalSub = new GoalSubsystem(memSub);
    const agentSub = new AgentSubsystem(handleAgentComplete);
    const taskSub = new TaskSubsystem(handleScheduledTask);

    const lifecycle = new LifecycleManager();
    lifecycle.register(memSub).register(goalSub).register(agentSub).register(taskSub)
      .register(getAutosaveSubsystem());
    await lifecycle.startAll();

    await initializeHeartbeat({ memory: memSub, goals: goalSub, agents: agentSub });
    log.info('Heartbeat reinitialized');

    // 15. Reload channels
    channelManager.registerBuiltIn('web', async () => {
      // No-op: web outbound is handled by message:sent event → tRPC subscription
    });
    await channelManager.loadAll();
    log.info('Channels reloaded');

    // 16. Start heartbeat only if persona is finalized and this instance has
    // its own AI provider configured. Save archives exclude system.db, so a
    // brand new restored instance still needs provider setup before thinking.
    const { getPersonaDb: getRestoredPersonaDb } = await import('../db/index.js');
    const { getPersona } = await import('../db/stores/persona-store.js');
    const { getCortexCredentialService } = await import('./cortex-credential-service.js');
    const persona = getPersona(getRestoredPersonaDb());
    const providerReadiness = getCortexCredentialService().getActiveProviderReadiness();
    if (persona.isFinalized && providerReadiness.ready) {
      startHeartbeat();
      log.info('Heartbeat started');
    } else if (persona.isFinalized) {
      log.info(
        'Heartbeat remains paused after restore: ' +
        (providerReadiness.message ?? 'AI provider is not configured'),
      );
    }

    // 17. Exit maintenance mode
    setMaintenanceMode(false, '');
    log.info(`Restore from save "${saveName}" complete`);
  } catch (err) {
    if (rollbackAvailable && !restoreComplete) {
      log.warn('Restore failed after file swap, restoring from rollback backup...');
      try {
        await recoverFromRollback();
        await cleanupRollback();
        rollbackAvailable = false;
        log.info('Rollback restore complete');
      } catch (rollbackErr) {
        log.error('Rollback restore failed:', rollbackErr);
      }
    }
    setMaintenanceMode(false, '');
    log.error('Restore failed:', err);
    throw err;
  } finally {
    // Clean up extracted temp directory
    await fs.rm(extractDir, { recursive: true, force: true }).catch(() => {});
    releaseGuard();
  }
}
