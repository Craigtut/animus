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
import type Database from 'better-sqlite3';
import { DATA_DIR } from '../utils/env.js';
import { createLogger } from '../lib/logger.js';
import { setMaintenanceMode } from '../lib/maintenance.js';
import { acquireOperationGuard, releaseOperationGuard, getSave, extractArchive, getArchivePath } from './save-service.js';
import {
  SAVE_ARCHIVE_DATABASES,
  planArchiveDatabaseRestore,
} from './save-archive-registry.js';
import { SAVE_ARCHIVE_DIRECTORIES, type SaveArchiveDirectory } from './save-archive-assets.js';

const log = createLogger('RestoreService', 'saves');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------


const ROLLBACK_DIR = path.join(DATA_DIR, '.restore-backup');

// ---------------------------------------------------------------------------
// Concurrency guard
// ---------------------------------------------------------------------------

function acquireGuard(): void {
  acquireOperationGuard();
}

function releaseGuard(): void {
  releaseOperationGuard();
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

/** Create rollback backup of current AI databases + file-backed archive assets. */
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

  for (const asset of SAVE_ARCHIVE_DIRECTORIES) {
    try {
      await fs.cp(asset.livePath, path.join(ROLLBACK_DIR, asset.entryName), { recursive: true });
    } catch {
      // Directory may not exist if this is a fresh install
    }
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

  for (const asset of SAVE_ARCHIVE_DIRECTORIES) {
    const backupPath = path.join(ROLLBACK_DIR, asset.entryName);
    try {
      await fs.rm(asset.livePath, { recursive: true, force: true });
      await fs.cp(backupPath, asset.livePath, { recursive: true });
    } catch {
      if (asset.missingFromOlderArchives === 'create-empty') {
        await fs.mkdir(asset.livePath, { recursive: true }).catch(() => {});
      }
      log.error(`Could not restore ${asset.entryName} from rollback backup`);
    }
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

async function restoreArchiveDirectories(
  extractDir: string,
  archiveEntries: Iterable<string>,
): Promise<void> {
  const topLevelEntries = new Set(archiveEntries);

  for (const asset of SAVE_ARCHIVE_DIRECTORIES) {
    const extractedPath = path.join(extractDir, asset.entryName);

    if (topLevelEntries.has(asset.entryName)) {
      await fs.rm(asset.livePath, { recursive: true, force: true });
      await fs.cp(extractedPath, asset.livePath, { recursive: true });
      continue;
    }

    if (asset.missingFromOlderArchives === 'create-empty') {
      await fs.rm(asset.livePath, { recursive: true, force: true });
      await fs.mkdir(asset.livePath, { recursive: true });
      log.info(`Archive missing ${asset.entryName}; restore created an empty directory.`);
      continue;
    }

    log.info(`Archive missing ${asset.entryName}; restore preserved the current directory.`);
  }
}

export function remapDataSubdirPath(
  value: string,
  subdir: SaveArchiveDirectory['entryName'],
  currentDataDir: string = DATA_DIR,
  fallbackToBasename = false,
): string {
  const normalized = value.replace(/\\/g, '/');
  const marker = `/${subdir}/`;
  let suffix: string | null = null;

  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex >= 0) {
    suffix = normalized.slice(markerIndex + marker.length);
  } else if (normalized === subdir) {
    suffix = '';
  } else if (normalized.startsWith(`${subdir}/`)) {
    suffix = normalized.slice(subdir.length + 1);
  } else if (fallbackToBasename) {
    const base = path.basename(value);
    suffix = base || null;
  }

  if (suffix === null) return value;
  const parts = suffix.split('/').filter(Boolean);
  return path.join(currentDataDir, subdir, ...parts);
}

const PERSISTED_PATH_MARKER = /\[Result persisted: (.+?) \(/g;

function remapPersistedPathMarkers(value: string, currentDataDir: string = DATA_DIR): string {
  return value.replace(PERSISTED_PATH_MARKER, (match, persistedPath: string) => {
    const remapped = remapDataSubdirPath(persistedPath, 'tool-results', currentDataDir);
    return match.replace(persistedPath, remapped);
  });
}

export function remapSavedJsonPaths(value: unknown, currentDataDir: string = DATA_DIR): unknown {
  if (typeof value === 'string') {
    return remapPersistedPathMarkers(value, currentDataDir);
  }

  if (Array.isArray(value)) {
    return value.map((item) => remapSavedJsonPaths(item, currentDataDir));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if ((key === 'localPath' || key === 'local_path') && typeof child === 'string') {
      out[key] = remapDataSubdirPath(child, 'media', currentDataDir, true);
    } else {
      out[key] = remapSavedJsonPaths(child, currentDataDir);
    }
  }
  return out;
}

function remapJsonText(text: string, currentDataDir: string = DATA_DIR): string {
  try {
    return JSON.stringify(remapSavedJsonPaths(JSON.parse(text), currentDataDir));
  } catch {
    return remapPersistedPathMarkers(text, currentDataDir);
  }
}

function remapMediaAttachmentPaths(db: Database.Database): number {
  const rows = db
    .prepare('SELECT id, local_path FROM media_attachments')
    .all() as Array<{ id: string; local_path: string }>;

  let changed = 0;
  const update = db.prepare('UPDATE media_attachments SET local_path = ? WHERE id = ?');
  const tx = db.transaction(() => {
    for (const row of rows) {
      const remapped = remapDataSubdirPath(row.local_path, 'media', DATA_DIR, true);
      if (remapped === row.local_path) continue;
      update.run(remapped, row.id);
      changed++;
    }
  });
  tx();
  return changed;
}

function remapMessageMetadataPaths(db: Database.Database): number {
  const rows = db
    .prepare('SELECT id, metadata FROM messages WHERE metadata IS NOT NULL')
    .all() as Array<{ id: string; metadata: string }>;

  let changed = 0;
  const update = db.prepare('UPDATE messages SET metadata = ? WHERE id = ?');
  const tx = db.transaction(() => {
    for (const row of rows) {
      const remapped = remapJsonText(row.metadata);
      if (remapped === row.metadata) continue;
      update.run(remapped, row.id);
      changed++;
    }
  });
  tx();
  return changed;
}

function remapSessionPaths(db: Database.Database): number {
  const rows = db
    .prepare('SELECT contact_id, channel, conversation_history, cortex_observational_state FROM mind_sessions')
    .all() as Array<{
      contact_id: string;
      channel: string;
      conversation_history: string | null;
      cortex_observational_state: string | null;
    }>;

  let changed = 0;
  const update = db.prepare(
    `UPDATE mind_sessions
     SET conversation_history = ?, cortex_observational_state = ?
     WHERE contact_id = ? AND channel = ?`,
  );
  const tx = db.transaction(() => {
    for (const row of rows) {
      const history = row.conversation_history ? remapJsonText(row.conversation_history) : null;
      const obsState = row.cortex_observational_state ? remapJsonText(row.cortex_observational_state) : null;
      if (history === row.conversation_history && obsState === row.cortex_observational_state) continue;
      update.run(history, obsState, row.contact_id, row.channel);
      changed++;
    }
  });
  tx();
  return changed;
}

function remapAgentLogPaths(db: Database.Database): number {
  const rows = db
    .prepare('SELECT id, data FROM agent_events WHERE data IS NOT NULL')
    .all() as Array<{ id: string; data: string }>;

  let changed = 0;
  const update = db.prepare('UPDATE agent_events SET data = ? WHERE id = ?');
  const tx = db.transaction(() => {
    for (const row of rows) {
      const remapped = remapJsonText(row.data);
      if (remapped === row.data) continue;
      update.run(remapped, row.id);
      changed++;
    }
  });
  tx();
  return changed;
}

function remapMemoryTextPaths(db: Database.Database): number {
  let changed = 0;
  const tables = [
    { table: 'observations', column: 'content' },
    { table: 'long_term_memories', column: 'content' },
  ];

  for (const { table, column } of tables) {
    const rows = db
      .prepare(`SELECT id, ${column} AS value FROM ${table}`)
      .all() as Array<{ id: string; value: string }>;
    const update = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`);
    const tx = db.transaction(() => {
      for (const row of rows) {
        const remapped = remapPersistedPathMarkers(row.value);
        if (remapped === row.value) continue;
        update.run(remapped, row.id);
        changed++;
      }
    });
    tx();
  }

  return changed;
}

async function remapRestoredFileReferences(): Promise<void> {
  const { getMessagesDb, getSessionsDb, getAgentLogsDb, getMemoryDb } = await import('../db/index.js');
  const mediaPathCount = remapMediaAttachmentPaths(getMessagesDb());
  const messageMetadataCount = remapMessageMetadataPaths(getMessagesDb());
  const sessionCount = remapSessionPaths(getSessionsDb());
  const agentLogCount = remapAgentLogPaths(getAgentLogsDb());
  const memoryTextCount = remapMemoryTextPaths(getMemoryDb());

  const total = mediaPathCount + messageMetadataCount + sessionCount + agentLogCount + memoryTextCount;
  if (total > 0) {
    log.info(
      `Remapped restored file references: media=${mediaPathCount}, metadata=${messageMetadataCount}, ` +
      `sessions=${sessionCount}, agentLogs=${agentLogCount}, memoryText=${memoryTextCount}`,
    );
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

      // Restore file-backed assets referenced by the saved databases.
      await restoreArchiveDirectories(extractDir, archiveEntries);

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

    // 13a. Remap portable file references for media and persisted tool results
    // when an archive is restored into a different DATA_DIR.
    await remapRestoredFileReferences();

    try {
      const { getSpeechService } = await import('../speech/speech-service.js');
      await getSpeechService().voices.initialize();
      log.info('Speech voices reloaded');
    } catch (err) {
      log.debug('Speech voice reload skipped:', err);
    }

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
