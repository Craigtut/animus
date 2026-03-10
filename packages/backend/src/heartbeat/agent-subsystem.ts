/**
 * Agent Subsystem
 *
 * Wraps the initialization of agent-related infrastructure (AgentManager,
 * AgentLogStore adapter, AgentOrchestrator) into a SubsystemLifecycle.
 */

import { join } from 'node:path';
import type { SubsystemLifecycle } from '../lib/lifecycle.js';
import { createLogger } from '../lib/logger.js';
import { DATA_DIR } from '../utils/env.js';
import { getHeartbeatDb, getSystemDb, getAgentLogsDb } from '../db/index.js';
import * as heartbeatStore from '../db/stores/heartbeat-store.js';
import * as agentLogStore from '../db/stores/agent-log-store.js';
import * as systemStore from '../db/stores/system-store.js';
import { getEventBus } from '../lib/event-bus.js';
import { createAgentManager, type AgentManager, type AgentLogStore } from '@animus-labs/agents';
import { createAgentLogStoreAdapter } from './agent-log-adapter.js';
import { AgentOrchestrator, type AgentTaskStore, type AgentTaskRecord } from './agent-orchestrator.js';

const log = createLogger('AgentSubsystem', 'heartbeat');

export class AgentSubsystem implements SubsystemLifecycle {
  readonly name = 'agents';
  agentManager: AgentManager | null = null;
  agentLogStoreAdapter: AgentLogStore | null = null;
  agentOrchestrator: AgentOrchestrator | null = null;

  constructor(private onAgentComplete: (params: {
    agentId: string;
    taskDescription: string;
    outcome: string;
    resultContent?: string;
  }) => void) {}

  async start(): Promise<void> {
    const hbDb = getHeartbeatDb();

    // Mark orphaned agent tasks from previous crash
    const orphaned = heartbeatStore.markOrphanedAgentTasks(hbDb);
    if (orphaned > 0) {
      log.info(`Marked ${orphaned} orphaned agent tasks as failed`);
    }

    // Initialize AgentManager (1 mind + 3 sub-agents + 2 observer/reflector + 2 buffer = 8 max)
    this.agentManager = createAgentManager({
      maxConcurrentSessions: 8,
      runtimeSdkPath: join(DATA_DIR, 'sdks', 'claude'),
      dataDir: join(DATA_DIR, 'sdks'),
    });
    const configuredProviders = this.agentManager.getConfiguredProviders();
    if (configuredProviders.length > 0) {
      log.debug(`Agent providers configured: ${configuredProviders.join(', ')}`);
    } else {
      log.warn('No agent providers configured. Mind query will use safe defaults.');
    }

    // Initialize agent log store adapter
    try {
      const agentLogsDb = getAgentLogsDb();
      this.agentLogStoreAdapter = createAgentLogStoreAdapter(agentLogsDb);
      const orphanedSessions = agentLogStore.markOrphanedSessions(agentLogsDb);
      if (orphanedSessions > 0) {
        log.info(`Marked ${orphanedSessions} orphaned agent sessions as error`);
      }
    } catch (err) {
      log.warn('Agent log store not available:', err);
    }

    // Initialize agent orchestrator
    if (this.agentManager && this.agentLogStoreAdapter) {
      const agentTaskStore: AgentTaskStore = {
        insertAgentTask: (data) => heartbeatStore.insertAgentTask(hbDb, data),
        updateAgentTask: (id, data) => heartbeatStore.updateAgentTask(hbDb, id, data),
        getAgentTask: (id) => heartbeatStore.getAgentTask(hbDb, id) as unknown as AgentTaskRecord | null,
        getRunningAgentTasks: () => heartbeatStore.getRunningAgentTasks(hbDb) as unknown as AgentTaskRecord[],
      };
      this.agentOrchestrator = new AgentOrchestrator({
        manager: this.agentManager,
        taskStore: agentTaskStore,
        logStore: this.agentLogStoreAdapter,
        eventBus: getEventBus(),
        getPreferredProvider: () => {
          try {
            const settings = systemStore.getSystemSettings(getSystemDb());
            return settings.defaultAgentProvider ?? null;
          } catch {
            return null;
          }
        },
        getPreferredModel: () => {
          try {
            const settings = systemStore.getSystemSettings(getSystemDb());
            return settings.defaultModel ?? undefined;
          } catch {
            return undefined;
          }
        },
        onAgentComplete: this.onAgentComplete,
      });
    }
  }

  async stop(): Promise<void> {
    if (this.agentOrchestrator) {
      await this.agentOrchestrator.cleanup();
      this.agentOrchestrator = null;
    }
    if (this.agentManager) {
      await this.agentManager.cleanup();
      this.agentManager = null;
    }
    this.agentLogStoreAdapter = null;
  }
}
