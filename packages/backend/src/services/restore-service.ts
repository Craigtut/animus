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
 *  8. Reinitialize heartbeat, channels, and start if persona is finalized
 *  9. Exit maintenance mode
 *  10. Clean up temp directory
 */

import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { DATA_DIR, DB_PERSONA_PATH, DB_HEARTBEAT_PATH, DB_MEMORY_PATH, DB_MESSAGES_PATH, DB_AGENT_LOGS_PATH, DB_CONTACTS_PATH, LANCEDB_PATH } from '../utils/env.js';
import { createLogger } from '../lib/logger.js';
import { setMaintenanceMode } from '../lib/maintenance.js';
import { operationInProgress, getSave, extractArchive } from './save-service.js';

const log = createLogger('RestoreService', 'saves');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SAVES_DIR = path.join(DATA_DIR, 'saves');
const ROLLBACK_DIR = path.join(DATA_DIR, '.restore-backup');

const AI_DB_FILES = [
  { name: 'persona.db', envPath: DB_PERSONA_PATH },
  { name: 'heartbeat.db', envPath: DB_HEARTBEAT_PATH },
  { name: 'memory.db', envPath: DB_MEMORY_PATH },
  { name: 'messages.db', envPath: DB_MESSAGES_PATH },
  { name: 'agent_logs.db', envPath: DB_AGENT_LOGS_PATH },
  { name: 'contacts.db', envPath: DB_CONTACTS_PATH },
];

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

  try {
    await fs.cp(LANCEDB_PATH, path.join(ROLLBACK_DIR, 'lancedb'), { recursive: true });
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

  try {
    // 1. Validate save exists
    const save = await getSave(saveId);
    if (!save) {
      throw new Error(`Save "${saveId}" not found`);
    }

    const saveName = save.manifest.name;
    const animusPath = path.join(SAVES_DIR, `${saveId}.animus`);

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
    const { getPluginManager } = await import('./plugin-manager.js');
    const pluginManager = getPluginManager();
    await pluginManager.stopTriggers();
    log.info('Plugin triggers stopped');

    // 7. Wait for in-flight observational memory
    const { waitForActiveOps } = await import('../memory/observational-memory/index.js');
    await waitForActiveOps();
    log.info('Observational memory operations complete');

    // 8. Checkpoint all AI databases (flush WAL into main file)
    const { getPersonaDb, getHeartbeatDb, getMemoryDb, getMessagesDb, getAgentLogsDb, getContactsDb } = await import('../db/index.js');
    const dbs = [getPersonaDb(), getHeartbeatDb(), getMemoryDb(), getMessagesDb(), getAgentLogsDb(), getContactsDb()];
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
      log.info('Rollback backup created');

      // Copy extracted DB files over live files (contacts.db may not exist in old archives)
      for (const { name, envPath } of AI_DB_FILES) {
        const extractedPath = path.join(extractDir, name);
        try {
          await fs.access(extractedPath);
          await fs.copyFile(extractedPath, envPath);
        } catch {
          if (name === 'contacts.db') {
            log.info('contacts.db not found in archive (old save format), skipping');
            continue;
          }
          throw new Error(`Missing required database file in archive: ${name}`);
        }
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

      await cleanupRollback();
      log.info('Rollback backup cleaned up');
    } catch (swapError) {
      log.error('File swap failed, restoring from rollback:', swapError);
      await restoreFromRollback();
      await deleteWalFiles();
      await initializeDatabases();
      setMaintenanceMode(false, '');
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

    // 14. Reinitialize subsystems and heartbeat
    const { initializeHeartbeat, startHeartbeat, handleAgentComplete, handleScheduledTask } = await import('../heartbeat/index.js');
    const { MemorySubsystem } = await import('../memory/memory-subsystem.js');
    const { GoalSubsystem } = await import('../goals/goal-subsystem.js');
    const { AgentSubsystem } = await import('../heartbeat/agent-subsystem.js');
    const { TaskSubsystem } = await import('../tasks/task-subsystem.js');
    const { LifecycleManager } = await import('../lib/lifecycle.js');

    const memSub = new MemorySubsystem();
    const goalSub = new GoalSubsystem(memSub);
    const agentSub = new AgentSubsystem(handleAgentComplete);
    const taskSub = new TaskSubsystem(handleScheduledTask);

    const lifecycle = new LifecycleManager();
    lifecycle.register(memSub).register(goalSub).register(agentSub).register(taskSub);
    await lifecycle.startAll();

    await initializeHeartbeat({ memory: memSub, goals: goalSub, agents: agentSub });
    log.info('Heartbeat reinitialized');

    // 15. Reload channels
    channelManager.registerBuiltIn('web', async () => {
      // No-op: web outbound is handled by message:sent event → tRPC subscription
    });
    await channelManager.loadAll();
    log.info('Channels reloaded');

    // 16. Start heartbeat if persona is finalized
    const { getPersonaDb: getRestoredPersonaDb } = await import('../db/index.js');
    const { getPersona } = await import('../db/stores/persona-store.js');
    const persona = getPersona(getRestoredPersonaDb());
    if (persona.isFinalized) {
      startHeartbeat();
      log.info('Heartbeat started');
    }

    // 17. Exit maintenance mode
    setMaintenanceMode(false, '');
    log.info(`Restore from save "${saveName}" complete`);
  } catch (err) {
    setMaintenanceMode(false, '');
    log.error('Restore failed:', err);
    throw err;
  } finally {
    // Clean up extracted temp directory
    await fs.rm(extractDir, { recursive: true, force: true }).catch(() => {});
    releaseGuard();
  }
}
