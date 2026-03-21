/**
 * Agent Subsystem
 *
 * Wraps the initialization of agent-related infrastructure into a
 * SubsystemLifecycle. Manages:
 *
 * - CortexMindState: The cortex-based mind session
 * - AgentOrchestrator: Sub-agent lifecycle management (cortex sub-agents)
 */

import type { SubsystemLifecycle } from '../lib/lifecycle.js';
import { createLogger } from '../lib/logger.js';
import { getHeartbeatDb, getAgentLogsDb } from '../db/index.js';
import * as heartbeatStore from '../db/stores/heartbeat-store.js';
import * as agentLogStore from '../db/stores/agent-log-store.js';
import { getEventBus } from '../lib/event-bus.js';
import { AgentOrchestrator, type AgentTaskStore, type AgentTaskRecord } from './agent-orchestrator.js';
import {
  createCortexMindState,
  destroyCortexMind,
  type CortexMindState,
} from './cortex-mind.js';

const log = createLogger('AgentSubsystem', 'heartbeat');

export class AgentSubsystem implements SubsystemLifecycle {
  readonly name = 'agents';
  agentOrchestrator: AgentOrchestrator | null = null;
  /** CortexAgent state for the mind session */
  cortexMind: CortexMindState = createCortexMindState();

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

    // Mark orphaned agent log sessions
    try {
      const agentLogsDb = getAgentLogsDb();
      const orphanedSessions = agentLogStore.markOrphanedSessions(agentLogsDb);
      if (orphanedSessions > 0) {
        log.info(`Marked ${orphanedSessions} orphaned agent sessions as error`);
      }
    } catch (err) {
      log.warn('Agent log store not available:', err);
    }

    // Initialize agent orchestrator (cortex sub-agents only)
    const agentTaskStore: AgentTaskStore = {
      insertAgentTask: (data) => heartbeatStore.insertAgentTask(hbDb, data),
      updateAgentTask: (id, data) => heartbeatStore.updateAgentTask(hbDb, id, data),
      getAgentTask: (id) => heartbeatStore.getAgentTask(hbDb, id) as unknown as AgentTaskRecord | null,
      getRunningAgentTasks: () => heartbeatStore.getRunningAgentTasks(hbDb) as unknown as AgentTaskRecord[],
    };
    this.agentOrchestrator = new AgentOrchestrator({
      taskStore: agentTaskStore,
      eventBus: getEventBus(),
      onAgentComplete: this.onAgentComplete,
    });
  }

  async stop(): Promise<void> {
    // Destroy the cortex mind session
    await destroyCortexMind(this.cortexMind);
    this.cortexMind = createCortexMindState();

    if (this.agentOrchestrator) {
      await this.agentOrchestrator.cleanup();
      this.agentOrchestrator = null;
    }
  }
}
