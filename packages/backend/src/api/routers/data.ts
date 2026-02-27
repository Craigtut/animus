/**
 * Data Management Router — tRPC procedures for data reset operations.
 *
 * Provides soft reset, full reset, and factory reset (complete wipe).
 */

import fs from 'node:fs';
import path from 'node:path';
import { router, protectedProcedure } from '../trpc.js';
import {
  getHeartbeatDb,
  getMemoryDb,
  getMessagesDb,
  closeDatabases,
} from '../../db/index.js';
import { stopHeartbeat, getVectorStore } from '../../heartbeat/index.js';
import * as heartbeatStore from '../../db/stores/heartbeat-store.js';
import { MEDIA_DIR } from '../routes/media.js';
import { DATA_DIR } from '../../utils/env.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('DataRouter', 'server');

/**
 * Delete all files in the media directory.
 * Called during resets that clear messages/media_attachments.
 */
function clearMediaFiles(): void {
  try {
    if (!fs.existsSync(MEDIA_DIR)) return;
    const files = fs.readdirSync(MEDIA_DIR);
    for (const file of files) {
      try {
        fs.unlinkSync(fs.realpathSync(`${MEDIA_DIR}/${file}`));
      } catch {
        // Skip files that can't be deleted
      }
    }
    log.info(`Cleared ${files.length} media files from disk`);
  } catch (err) {
    log.warn('Failed to clear media directory:', err);
  }
}

export const dataRouter = router({
  /**
   * Soft reset — clear heartbeat.db (thoughts, experiences, emotions, decisions,
   * goals, plans, seeds, tasks). Preserves messages, memory, and system config.
   */
  softReset: protectedProcedure.mutation(async () => {
    await stopHeartbeat();
    const hbDb = getHeartbeatDb();

    hbDb.transaction(() => {
      hbDb.exec('DELETE FROM thoughts');
      hbDb.exec('DELETE FROM experiences');
      hbDb.exec('DELETE FROM emotion_history');
      hbDb.exec('DELETE FROM tick_decisions');
      hbDb.exec('DELETE FROM goal_seeds');
      hbDb.exec('DELETE FROM goal_salience_log');
      hbDb.exec('DELETE FROM plans');
      hbDb.exec('DELETE FROM goals');
      hbDb.exec('DELETE FROM task_runs');
      hbDb.exec('DELETE FROM agent_tasks');
      hbDb.exec('DELETE FROM tasks');

      // Reset heartbeat state to initial values
      heartbeatStore.updateHeartbeatState(hbDb, {
        tickNumber: 0,
        currentStage: 'idle',
        sessionState: 'cold',
        triggerType: null,
        triggerContext: null,
        mindSessionId: null,
        sessionTokenCount: 0,
        sessionWarmSince: null,
        isRunning: false,
      });

      // Re-seed emotion state to baselines
      hbDb.exec('UPDATE emotion_state SET intensity = baseline');
    })();

    return { success: true, cleared: 'heartbeat' };
  }),

  /**
   * Full reset — clear heartbeat.db + memory.db + messages.db + LanceDB vectors.
   * Preserves system config (persona, contacts, API keys, channels).
   */
  fullReset: protectedProcedure.mutation(async () => {
    await stopHeartbeat();
    const hbDb = getHeartbeatDb();
    const memDb = getMemoryDb();
    const msgDb = getMessagesDb();

    // Clear heartbeat (same as soft reset)
    hbDb.transaction(() => {
      hbDb.exec('DELETE FROM thoughts');
      hbDb.exec('DELETE FROM experiences');
      hbDb.exec('DELETE FROM emotion_history');
      hbDb.exec('DELETE FROM tick_decisions');
      hbDb.exec('DELETE FROM goal_seeds');
      hbDb.exec('DELETE FROM goal_salience_log');
      hbDb.exec('DELETE FROM plans');
      hbDb.exec('DELETE FROM goals');
      hbDb.exec('DELETE FROM task_runs');
      hbDb.exec('DELETE FROM agent_tasks');
      hbDb.exec('DELETE FROM tasks');

      heartbeatStore.updateHeartbeatState(hbDb, {
        tickNumber: 0,
        currentStage: 'idle',
        sessionState: 'cold',
        triggerType: null,
        triggerContext: null,
        mindSessionId: null,
        sessionTokenCount: 0,
        sessionWarmSince: null,
        isRunning: false,
      });

      hbDb.exec('UPDATE emotion_state SET intensity = baseline');
    })();

    // Clear memory
    memDb.transaction(() => {
      memDb.exec('DELETE FROM working_memory');
      memDb.exec('DELETE FROM long_term_memories');
      // Reset core_self to empty
      memDb.exec("UPDATE core_self SET content = '' WHERE id = 1");
    })();

    // Clear LanceDB vector embeddings
    const vectorStore = getVectorStore();
    if (vectorStore?.isReady()) {
      await vectorStore.deleteAll();
    }

    // Clear messages, conversations, and media files
    msgDb.transaction(() => {
      msgDb.exec('DELETE FROM media_attachments');
      msgDb.exec('DELETE FROM messages');
      msgDb.exec('DELETE FROM conversations');
    })();
    clearMediaFiles();

    return { success: true, cleared: 'heartbeat+memory+messages' };
  }),

  /**
   * Factory reset — wipe all application data and reinitialize in place.
   *
   * Gracefully shuts down every background service, then deletes all user
   * data (databases, media, logs, installed packages, cache, etc.) and
   * re-opens fresh empty databases. The server stays running throughout;
   * no process restart needed.
   *
   * Preserves system resources that are expensive to re-acquire:
   *   - .secrets  (JWT + encryption keys, so the running server stays valid)
   *   - models/   (STT/TTS model weights, ~900 MB)
   *   - voices/   (builtin + custom voice files)
   *   - saves/    (user backup snapshots)
   *
   * After this, the user will go through registration and onboarding again.
   */
  factoryReset: protectedProcedure.mutation(async () => {
    log.warn('Factory reset initiated — wiping application data');

    // Enter maintenance mode so concurrent requests get 503 during the wipe
    const { setMaintenanceMode } = await import('../../lib/maintenance.js');
    setMaintenanceMode(true, 'Factory reset in progress...');

    try {
      // 1. Wait for in-flight observational memory operations
      const { waitForActiveOps } = await import('../../memory/observational-memory/index.js');
      await waitForActiveOps(10_000);

      // 2. Stop heartbeat (ends mind session, cancels sub-agents, stops task scheduler)
      await stopHeartbeat();

      // 3. Stop all channel child processes
      const { getChannelManager } = await import('../../channels/channel-manager.js');
      const channelManager = getChannelManager();
      await channelManager.stopAll();

      // 4. Stop plugin trigger watchers and clean up skill symlinks
      const { getPluginManager } = await import('../../services/plugin-manager.js');
      const pluginManager = getPluginManager();
      await pluginManager.stopTriggers();
      await pluginManager.cleanupSkills();

      // 5. Cancel any in-progress downloads
      const { getDownloadManager } = await import('../../downloads/index.js');
      try {
        getDownloadManager().cancelAll();
      } catch {
        // Download manager may not be initialized
      }

      // 6. Release native speech engine resources (TTS/STT models)
      const { getSpeechService } = await import('../../speech/speech-service.js');
      try {
        await getSpeechService().shutdown();
      } catch {
        // Speech service may not be initialized
      }

      // 7. Close all database connections
      closeDatabases();

      // 8. Selectively delete data directory contents, preserving
      //    secrets (server identity), models, voices, and saves
      const PRESERVE = new Set(['.secrets', 'models', 'voices', 'saves']);

      try {
        const entries = fs.readdirSync(DATA_DIR, { withFileTypes: true });
        for (const entry of entries) {
          if (PRESERVE.has(entry.name)) continue;
          const fullPath = path.join(DATA_DIR, entry.name);
          fs.rmSync(fullPath, { recursive: true, force: true });
        }
        log.info('Data directory wiped (preserved: .secrets, models, voices, saves)');
      } catch (err) {
        log.error('Failed to wipe data directory:', err);
      }

      // 9. Re-initialize fresh databases (creates empty DBs, runs migrations)
      const { initializeDatabases } = await import('../../db/index.js');
      await initializeDatabases();

      log.info('Factory reset complete — server reinitialized with fresh databases');
    } finally {
      setMaintenanceMode(false, '');
    }

    return { success: true };
  }),
});
