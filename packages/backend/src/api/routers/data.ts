/**
 * Data Management Router — tRPC procedures for data reset and export.
 *
 * Provides soft reset, full reset, conversation clear, and data export.
 */

import { router, protectedProcedure } from '../trpc.js';
import {
  getHeartbeatDb,
  getMemoryDb,
  getMessagesDb,
  getSystemDb,
  getAgentLogsDb,
} from '../../db/index.js';
import { stopHeartbeat, getVectorStore } from '../../heartbeat/index.js';
import * as systemStore from '../../db/stores/system-store.js';
import * as heartbeatStore from '../../db/stores/heartbeat-store.js';

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

    // Clear messages and conversations
    msgDb.transaction(() => {
      msgDb.exec('DELETE FROM media_attachments');
      msgDb.exec('DELETE FROM messages');
      msgDb.exec('DELETE FROM conversations');
    })();

    return { success: true, cleared: 'heartbeat+memory+messages' };
  }),

  /**
   * Clear all conversations, messages, and media attachments.
   */
  clearConversations: protectedProcedure.mutation(() => {
    const msgDb = getMessagesDb();
    msgDb.transaction(() => {
      msgDb.exec('DELETE FROM media_attachments');
      msgDb.exec('DELETE FROM messages');
      msgDb.exec('DELETE FROM conversations');
    })();
    return { success: true, cleared: 'messages' };
  }),

  /**
   * Export all database data as JSON.
   */
  export: protectedProcedure.query(() => {
    const sysDb = getSystemDb();
    const hbDb = getHeartbeatDb();
    const memDb = getMemoryDb();
    const msgDb = getMessagesDb();

    return {
      exportedAt: new Date().toISOString(),
      system: {
        contacts: systemStore.listContacts(sysDb),
        settings: systemStore.getSystemSettings(sysDb),
        persona: systemStore.getPersona(sysDb),
        channelPackages: systemStore.getChannelPackages(sysDb),
      },
      heartbeat: {
        state: heartbeatStore.getHeartbeatState(hbDb),
        emotions: heartbeatStore.getEmotionStates(hbDb),
        thoughts: heartbeatStore.getRecentThoughts(hbDb, 1000),
        experiences: heartbeatStore.getRecentExperiences(hbDb, 1000),
      },
      memory: {
        workingMemories: memDb.prepare('SELECT * FROM working_memory').all(),
        coreSelf: memDb.prepare('SELECT * FROM core_self WHERE id = 1').get(),
        longTermMemories: memDb.prepare('SELECT * FROM long_term_memories LIMIT 1000').all(),
      },
      messages: {
        conversations: msgDb.prepare('SELECT * FROM conversations').all(),
        messageCount: (
          msgDb.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number }
        ).count,
      },
    };
  }),
});
