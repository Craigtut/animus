/**
 * Agent Orchestrator
 *
 * Manages sub-agent lifecycle: spawning, updating, cancelling, and
 * processing completion results. Handles MindOutput decisions related
 * to sub-agents (spawn_agent, update_agent, cancel_agent).
 *
 * See docs/architecture/agent-orchestration.md for the full design.
 */

import { generateUUID, now } from '@animus-labs/shared';
import type { IEventBus } from '@animus-labs/shared';
import type { CortexAgent } from '@animus-labs/cortex';
import { createLogger } from '../lib/logger.js';
import { getAgentLogsDb } from '../db/index.js';
import * as agentLogStore from '../db/stores/agent-log-store.js';

const log = createLogger('AgentOrchestrator', 'agents');

// ============================================================================
// Types
// ============================================================================

export interface SpawnAgentParams {
  taskType: string;
  description: string;
  instructions: string;
  contactId: string;
  channel: string;
  tickNumber: number;
  systemPrompt: string;
  parentTaskId?: string | null;
}

export interface UpdateAgentParams {
  agentId: string;
  context: string;
}

export interface CancelAgentParams {
  agentId: string;
  reason: string;
}

export interface AgentTaskRecord {
  id: string;
  tickNumber: number;
  sessionId: string | null;
  provider: string;
  status: 'spawning' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timed_out';
  taskType: string;
  taskDescription: string;
  parentTaskId: string | null;
  contactId: string | null;
  sourceChannel: string | null;
  currentActivity: string | null;
  result: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

/** Per-task-type timeout defaults (ms) */
const TASK_TIMEOUTS: Record<string, number> = {
  research: 5 * 60 * 1000,
  code_generation: 10 * 60 * 1000,
  analysis: 5 * 60 * 1000,
  review: 3 * 60 * 1000,
  planning: 5 * 60 * 1000,
  execution: 10 * 60 * 1000,
};

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

// ============================================================================
// Agent Task Store Interface
// ============================================================================

/**
 * Interface for the heartbeat store functions the orchestrator needs.
 * This decouples the orchestrator from direct DB access.
 */
export interface AgentTaskStore {
  insertAgentTask(data: {
    id: string;
    tickNumber: number;
    sessionId: string | null;
    provider: string;
    status: string;
    taskType: string;
    taskDescription: string;
    parentTaskId?: string | null;
    contactId: string | null;
    sourceChannel: string | null;
    createdAt: string;
  }): void;

  updateAgentTask(id: string, data: Partial<{
    sessionId: string | null;
    status: string;
    currentActivity: string | null;
    result: string | null;
    error: string | null;
    startedAt: string | null;
    completedAt: string | null;
  }>): void;

  getAgentTask(id: string): AgentTaskRecord | null;
  getRunningAgentTasks(): AgentTaskRecord[];
}

// ============================================================================
// Agent Orchestrator
// ============================================================================

export class AgentOrchestrator {
  private taskStore: AgentTaskStore;
  private eventBus: IEventBus;
  private timeoutTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private spawnTimestamps: number[] = [];
  private spawnBudgetPerHour: number;
  private onAgentComplete: (params: {
    agentId: string;
    taskDescription: string;
    outcome: string;
    resultContent?: string;
  }) => void;
  /** CortexAgent for sub-agent spawning (required) */
  private cortexAgent: CortexAgent | null = null;

  constructor(params: {
    taskStore: AgentTaskStore;
    eventBus: IEventBus;
    spawnBudgetPerHour?: number;
    onAgentComplete: (params: {
      agentId: string;
      taskDescription: string;
      outcome: string;
      resultContent?: string;
    }) => void;
  }) {
    this.taskStore = params.taskStore;
    this.eventBus = params.eventBus;
    this.spawnBudgetPerHour = params.spawnBudgetPerHour ?? 20;
    this.onAgentComplete = params.onAgentComplete;
  }

  // --------------------------------------------------------------------------
  // Cortex Integration
  // --------------------------------------------------------------------------

  /**
   * Set the CortexAgent for sub-agent spawning.
   * Must be set before calling spawnAgent/updateAgent/cancelAgent.
   */
  setCortexAgent(cortexAgent: CortexAgent | null): void {
    this.cortexAgent = cortexAgent;

    if (cortexAgent) {
      this.wireCortexLifecycleHooks(cortexAgent);
      log.info('AgentOrchestrator wired to CortexAgent for sub-agent spawning');
    }
  }

  /**
   * Wire the SubAgentManager's lifecycle hooks to the orchestrator's
   * database tracking (agent_tasks table) and event bus.
   */
  private wireCortexLifecycleHooks(cortexAgent: CortexAgent): void {
    cortexAgent.onSubAgentSpawned((taskId: string, instructions: string) => {
      log.info(`Cortex sub-agent spawned: ${taskId} ("${instructions.substring(0, 60)}...")`);
      this.eventBus.emit('agent:spawned', { taskId, provider: 'cortex' });
    });

    cortexAgent.onSubAgentCompleted((taskId: string, result: string, status: string, usage: unknown) => {
      const task = this.taskStore.getAgentTask(taskId);

      this.taskStore.updateAgentTask(taskId, {
        status: status === 'completed' ? 'completed' : 'failed',
        result: result || null,
        completedAt: now(),
      });

      // Persist sub-agent usage to agent_logs.db
      const usageData = usage as { turns?: number; cost?: number; durationMs?: number } | null;
      if (usageData?.cost != null && usageData.cost > 0) {
        try {
          agentLogStore.insertUsage(getAgentLogsDb(), {
            sessionId: taskId,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            costUsd: usageData.cost,
            model: 'cortex-sub-agent',
            tickType: 'agent_complete',
            pipelinePhase: 'agentic_loop',
            contactId: null,
          });
        } catch (err) {
          log.warn('Failed to log sub-agent usage:', err);
        }
      }

      this.eventBus.emit('agent:completed', { taskId, result });

      this.onAgentComplete({
        agentId: taskId,
        taskDescription: task?.taskDescription ?? '',
        outcome: status,
        resultContent: result,
      });

      log.info(`Cortex sub-agent completed: ${taskId} (${status})`);
    });

    cortexAgent.onSubAgentFailed((taskId: string, error: string) => {
      const task = this.taskStore.getAgentTask(taskId);

      this.taskStore.updateAgentTask(taskId, {
        status: 'failed',
        error,
        completedAt: now(),
      });

      this.eventBus.emit('agent:failed', { taskId, error });

      this.onAgentComplete({
        agentId: taskId,
        taskDescription: task?.taskDescription ?? '',
        outcome: 'failed',
        resultContent: `Sub-agent failed: ${error}`,
      });

      log.warn(`Cortex sub-agent failed: ${taskId}: ${error}`);
    });
  }

  /**
   * Check the rolling-window spawn budget.
   * Returns whether spawning is allowed and current usage stats.
   */
  checkSpawnBudget(): { allowed: boolean; count: number; limit: number; warning: boolean } {
    const oneHourAgo = Date.now() - 3_600_000;
    this.spawnTimestamps = this.spawnTimestamps.filter((t) => t > oneHourAgo);
    const count = this.spawnTimestamps.length;
    return {
      allowed: count < this.spawnBudgetPerHour,
      count,
      limit: this.spawnBudgetPerHour,
      warning: count >= this.spawnBudgetPerHour * 0.8,
    };
  }

  /**
   * Get spawn budget status for context builder injection.
   */
  getSpawnBudgetStatus(): { allowed: boolean; count: number; limit: number; warning: boolean } {
    return this.checkSpawnBudget();
  }

  /**
   * Spawn a new sub-agent for a task.
   *
   * Delegates to the cortex SubAgentManager infrastructure.
   * Requires a CortexAgent to be set via setCortexAgent().
   */
  async spawnAgent(params: SpawnAgentParams): Promise<string> {
    if (!this.cortexAgent) {
      throw new Error('Cannot spawn sub-agent: no CortexAgent configured. Call setCortexAgent() first.');
    }

    return this.spawnCortexSubAgent(params);
  }

  /**
   * Spawn a sub-agent via cortex SubAgentManager.
   *
   * The cortex SubAgent tool creates an independent CortexAgent instance.
   * The orchestrator tracks it in the agent_tasks table and monitors
   * completion via lifecycle hooks wired in wireCortexLifecycleHooks().
   */
  private async spawnCortexSubAgent(params: SpawnAgentParams): Promise<string> {
    const timestamp = now();

    // Check spawn budget
    const budget = this.checkSpawnBudget();
    if (!budget.allowed) {
      const failedTaskId = generateUUID();
      this.taskStore.insertAgentTask({
        id: failedTaskId,
        tickNumber: params.tickNumber,
        sessionId: null,
        provider: 'cortex',
        status: 'failed',
        taskType: params.taskType,
        taskDescription: params.description,
        parentTaskId: params.parentTaskId ?? null,
        contactId: params.contactId,
        sourceChannel: params.channel,
        createdAt: timestamp,
      });
      this.taskStore.updateAgentTask(failedTaskId, {
        status: 'failed',
        error: 'Spawn budget exhausted',
        completedAt: timestamp,
      });
      this.eventBus.emit('agent:rate_limited', { taskId: failedTaskId, count: budget.count, limit: budget.limit });
      throw new Error(`Agent spawn budget exhausted (${budget.count}/${budget.limit} per hour)`);
    }
    this.spawnTimestamps.push(Date.now());

    try {
      const subAgentManager = this.cortexAgent!.getSubAgentManager();

      // Check concurrency limit
      if (!subAgentManager.canSpawn()) {
        throw new Error(`Cortex sub-agent concurrency limit reached (${subAgentManager.activeCount}/${subAgentManager.limit})`);
      }

      const { taskId } = await this.cortexAgent!.spawnBackgroundSubAgent({
        instructions: params.instructions,
        systemPrompt: params.systemPrompt,
      });

      this.taskStore.insertAgentTask({
        id: taskId,
        tickNumber: params.tickNumber,
        sessionId: null,
        provider: 'cortex',
        status: 'running',
        taskType: params.taskType,
        taskDescription: params.description,
        parentTaskId: params.parentTaskId ?? null,
        contactId: params.contactId,
        sourceChannel: params.channel,
        createdAt: timestamp,
      });

      this.taskStore.updateAgentTask(taskId, {
        startedAt: now(),
      });

      // Set timeout
      const timeoutMs = TASK_TIMEOUTS[params.taskType] ?? DEFAULT_TIMEOUT_MS;
      const timer = setTimeout(() => {
        this.handleTimeout(taskId);
      }, timeoutMs);
      this.timeoutTimers.set(taskId, timer);

      log.info(`Cortex sub-agent spawn requested: ${taskId} (${params.taskType}: ${params.description.substring(0, 80)})`);

      return taskId;
    } catch (err) {
      const failedTaskId = generateUUID();
      this.taskStore.insertAgentTask({
        id: failedTaskId,
        tickNumber: params.tickNumber,
        sessionId: null,
        provider: 'cortex',
        status: 'failed',
        taskType: params.taskType,
        taskDescription: params.description,
        parentTaskId: params.parentTaskId ?? null,
        contactId: params.contactId,
        sourceChannel: params.channel,
        createdAt: timestamp,
      });
      this.taskStore.updateAgentTask(failedTaskId, {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        completedAt: now(),
      });
      throw err;
    }
  }

  /**
   * Forward new information to a running sub-agent.
   *
   * Uses agent.steer() to inject context into the running agentic loop.
   */
  async updateAgent(params: UpdateAgentParams): Promise<void> {
    if (!this.cortexAgent) {
      log.warn(`Cannot update agent ${params.agentId}: no CortexAgent configured`);
      return;
    }

    const subAgentManager = this.cortexAgent.getSubAgentManager();
    const tracked = subAgentManager.get(params.agentId);
    if (!tracked) {
      log.warn(`Cannot steer sub-agent ${params.agentId}: not tracked`);
      return;
    }

    try {
      const subAgent = tracked.agent as CortexAgent;
      subAgent.steer(params.context);
      this.taskStore.updateAgentTask(params.agentId, {
        currentActivity: 'Processing update (steered)',
      });
      log.info(`Steered sub-agent ${params.agentId}`);
    } catch (err) {
      log.error(`Failed to steer sub-agent ${params.agentId}:`, err);
    }
  }

  /**
   * Cancel a running sub-agent.
   *
   * Calls abort() on the cortex sub-agent and marks it as cancelled.
   */
  async cancelAgent(params: CancelAgentParams): Promise<void> {
    // Clear timeout
    const timer = this.timeoutTimers.get(params.agentId);
    if (timer) {
      clearTimeout(timer);
      this.timeoutTimers.delete(params.agentId);
    }

    if (this.cortexAgent) {
      const subAgentManager = this.cortexAgent.getSubAgentManager();
      const tracked = subAgentManager.get(params.agentId);
      if (tracked) {
        try {
          const subAgent = tracked.agent as CortexAgent;
          await subAgent.abort();
          log.info(`Aborted sub-agent ${params.agentId}`);
        } catch (err) {
          log.warn(`Failed to abort sub-agent ${params.agentId}:`, err);
        }

        // Remove from tracking with a cancelled result
        subAgentManager.fail(params.agentId, params.reason);
      }
    }

    this.taskStore.updateAgentTask(params.agentId, {
      status: 'cancelled',
      error: params.reason,
      completedAt: now(),
    });

    this.eventBus.emit('agent:cancelled', {
      taskId: params.agentId,
      reason: params.reason,
    });
  }

  /**
   * Get all currently running agent tasks.
   */
  getRunningTasks(): AgentTaskRecord[] {
    return this.taskStore.getRunningAgentTasks();
  }

  /**
   * Check if a specific agent is still running.
   */
  isAgentRunning(agentId: string): boolean {
    if (this.cortexAgent) {
      const subAgentManager = this.cortexAgent.getSubAgentManager();
      return subAgentManager.get(agentId) !== undefined;
    }

    return false;
  }

  /**
   * Clean up all active timers and references.
   */
  async cleanup(): Promise<void> {
    // Clear all timeouts
    for (const timer of this.timeoutTimers.values()) {
      clearTimeout(timer);
    }
    this.timeoutTimers.clear();

    // Clear cortex reference (cortex agent lifecycle managed separately)
    this.cortexAgent = null;
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  /**
   * Handle sub-agent timeout.
   * Aborts the sub-agent and marks it as timed out in the task store.
   */
  private async handleTimeout(taskId: string): Promise<void> {
    this.timeoutTimers.delete(taskId);

    if (!this.cortexAgent) return;

    const subAgentManager = this.cortexAgent.getSubAgentManager();
    const tracked = subAgentManager.get(taskId);
    if (tracked) {
      try {
        const subAgent = tracked.agent as CortexAgent;
        await subAgent.abort();
      } catch (err) {
        log.warn(`Failed to abort timed out sub-agent ${taskId}:`, err);
      }
      subAgentManager.fail(taskId, 'Agent exceeded timeout');
    }

    const task = this.taskStore.getAgentTask(taskId);

    this.taskStore.updateAgentTask(taskId, {
      status: 'timed_out',
      error: 'Agent exceeded timeout',
      completedAt: now(),
    });

    this.eventBus.emit('agent:failed', { taskId, error: 'Agent timed out' });

    this.onAgentComplete({
      agentId: taskId,
      taskDescription: task?.taskDescription ?? '',
      outcome: 'timed_out',
      resultContent: 'The sub-agent timed out before completing its task.',
    });
  }
}
