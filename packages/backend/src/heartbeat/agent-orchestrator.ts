/**
 * Agent Orchestrator
 *
 * Manages sub-agent lifecycle: spawning, updating, cancelling, and
 * processing completion results. Handles MindOutput decisions related
 * to sub-agents (spawn_agent, update_agent, cancel_agent).
 *
 * See docs/architecture/agent-orchestration.md for the full design.
 */

import type { AgentProvider } from '@animus/shared';
import { generateUUID, now } from '@animus/shared';
import type {
  AgentManager,
  IAgentSession,
  AgentResponse,
} from '@animus/agents';
import { attachSessionLogging, type AgentLogStore } from '@animus/agents';
import type { IEventBus } from '@animus/shared';

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
  provider: AgentProvider;
  status: 'spawning' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timed_out';
  taskType: string;
  taskDescription: string;
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
    provider: AgentProvider;
    status: string;
    taskType: string;
    taskDescription: string;
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
  private manager: AgentManager;
  private taskStore: AgentTaskStore;
  private logStore: AgentLogStore;
  private eventBus: IEventBus;
  private activeSessions = new Map<string, IAgentSession>();
  private timeoutTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private settledTasks = new Set<string>();
  private spawnTimestamps: number[] = [];
  private spawnBudgetPerHour: number;
  private onAgentComplete: (params: {
    agentId: string;
    taskDescription: string;
    outcome: string;
    resultContent?: string;
  }) => void;

  constructor(params: {
    manager: AgentManager;
    taskStore: AgentTaskStore;
    logStore: AgentLogStore;
    eventBus: IEventBus;
    spawnBudgetPerHour?: number;
    onAgentComplete: (params: {
      agentId: string;
      taskDescription: string;
      outcome: string;
      resultContent?: string;
    }) => void;
  }) {
    this.manager = params.manager;
    this.taskStore = params.taskStore;
    this.logStore = params.logStore;
    this.eventBus = params.eventBus;
    this.spawnBudgetPerHour = params.spawnBudgetPerHour ?? 20;
    this.onAgentComplete = params.onAgentComplete;
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
   * Creates an agent session, tracks it in the task store,
   * and runs it asynchronously (non-blocking).
   */
  async spawnAgent(params: SpawnAgentParams): Promise<string> {
    const taskId = generateUUID();
    const timestamp = now();
    const provider = this.manager.getConfiguredProviders()[0] ?? 'claude';

    // Check spawn budget before proceeding
    const budget = this.checkSpawnBudget();
    if (!budget.allowed) {
      this.taskStore.insertAgentTask({
        id: taskId,
        tickNumber: params.tickNumber,
        sessionId: null,
        provider,
        status: 'failed',
        taskType: params.taskType,
        taskDescription: params.description,
        contactId: params.contactId,
        sourceChannel: params.channel,
        createdAt: timestamp,
      });
      this.taskStore.updateAgentTask(taskId, {
        status: 'failed',
        error: 'Spawn budget exhausted',
        completedAt: timestamp,
      });
      this.eventBus.emit('agent:rate_limited', { taskId, count: budget.count, limit: budget.limit });
      throw new Error(`Agent spawn budget exhausted (${budget.count}/${budget.limit} per hour)`);
    }
    this.spawnTimestamps.push(Date.now());

    // Insert task record
    this.taskStore.insertAgentTask({
      id: taskId,
      tickNumber: params.tickNumber,
      sessionId: null,
      provider,
      status: 'spawning',
      taskType: params.taskType,
      taskDescription: params.description,
      contactId: params.contactId,
      sourceChannel: params.channel,
      createdAt: timestamp,
    });

    try {
      // Create the agent session
      const session = await this.manager.createSession({
        provider,
        systemPrompt: params.systemPrompt,
        permissions: {
          executionMode: 'build',
          approvalLevel: 'none',
        },
      });

      // Attach logging
      const logging = attachSessionLogging(session, { store: this.logStore });

      // Update task with session info
      this.taskStore.updateAgentTask(taskId, {
        sessionId: session.id,
        status: 'running',
        startedAt: now(),
      });

      // Track session
      this.activeSessions.set(taskId, session);

      // Emit event
      this.eventBus.emit('agent:spawned', { taskId, provider });

      // Set timeout
      const timeoutMs = TASK_TIMEOUTS[params.taskType] ?? DEFAULT_TIMEOUT_MS;
      const timer = setTimeout(() => {
        this.handleTimeout(taskId);
      }, timeoutMs);
      this.timeoutTimers.set(taskId, timer);

      // Run asynchronously (non-blocking)
      this.runAgent(taskId, session, params.instructions, logging).catch((err) => {
        console.error(`[AgentOrchestrator] Agent ${taskId} run error:`, err);
      });

      return taskId;
    } catch (err) {
      // Failed to create session
      this.taskStore.updateAgentTask(taskId, {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        completedAt: now(),
      });

      this.eventBus.emit('agent:failed', {
        taskId,
        error: err instanceof Error ? err.message : String(err),
      });

      throw err;
    }
  }

  /**
   * Forward new information to a running sub-agent.
   */
  async updateAgent(params: UpdateAgentParams): Promise<void> {
    const session = this.activeSessions.get(params.agentId);
    if (!session) {
      console.warn(
        `[AgentOrchestrator] Cannot update agent ${params.agentId}: no active session`
      );
      return;
    }

    try {
      await session.prompt(params.context);
      this.taskStore.updateAgentTask(params.agentId, {
        currentActivity: 'Processing update',
      });
    } catch (err) {
      console.error(
        `[AgentOrchestrator] Failed to update agent ${params.agentId}:`,
        err
      );
    }
  }

  /**
   * Cancel a running sub-agent.
   */
  async cancelAgent(params: CancelAgentParams): Promise<void> {
    const session = this.activeSessions.get(params.agentId);

    // Clear timeout
    const timer = this.timeoutTimers.get(params.agentId);
    if (timer) {
      clearTimeout(timer);
      this.timeoutTimers.delete(params.agentId);
    }

    if (session) {
      try {
        await session.cancel();
        await session.end();
      } catch (err) {
        console.warn(
          `[AgentOrchestrator] Failed to cancel session for ${params.agentId}:`,
          err
        );
      }
      this.activeSessions.delete(params.agentId);
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
    return this.activeSessions.has(agentId);
  }

  /**
   * Clean up all active sessions and timers.
   */
  async cleanup(): Promise<void> {
    // Clear all timeouts
    for (const timer of this.timeoutTimers.values()) {
      clearTimeout(timer);
    }
    this.timeoutTimers.clear();

    // End all active sessions
    const endPromises = Array.from(this.activeSessions.entries()).map(
      async ([taskId, session]) => {
        try {
          await session.end();
        } catch (err) {
          console.warn(
            `[AgentOrchestrator] Failed to end session for ${taskId}:`,
            err
          );
        }
      }
    );
    await Promise.allSettled(endPromises);
    this.activeSessions.clear();
    this.settledTasks.clear();
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  /**
   * Run an agent session asynchronously.
   * This is fire-and-forget from the caller's perspective.
   */
  private async runAgent(
    taskId: string,
    session: IAgentSession,
    instructions: string,
    logging: { logUsage: (usage: any, cost: any, model: string) => void },
  ): Promise<void> {
    try {
      const response: AgentResponse = await session.prompt(instructions);

      // Guard: if already settled by timeout, bail out
      if (this.settledTasks.has(taskId)) return;
      this.settledTasks.add(taskId);

      // Log usage
      logging.logUsage(response.usage, response.cost ?? null, response.model);

      // Clear timeout
      const timer = this.timeoutTimers.get(taskId);
      if (timer) {
        clearTimeout(timer);
        this.timeoutTimers.delete(taskId);
      }

      // Clean up session
      this.activeSessions.delete(taskId);
      await session.end();

      // Check for empty result
      const result = response.content?.trim();
      if (!result) {
        this.taskStore.updateAgentTask(taskId, {
          status: 'failed',
          error: 'Empty result',
          completedAt: now(),
        });

        this.eventBus.emit('agent:failed', { taskId, error: 'Empty result' });

        this.onAgentComplete({
          agentId: taskId,
          taskDescription: this.taskStore.getAgentTask(taskId)?.taskDescription ?? '',
          outcome: 'failed',
          resultContent: 'The sub-agent returned an empty result.',
        });
        return;
      }

      // Store result
      const task = this.taskStore.getAgentTask(taskId);
      this.taskStore.updateAgentTask(taskId, {
        status: 'completed',
        result,
        completedAt: now(),
      });

      this.eventBus.emit('agent:completed', { taskId, result });

      // Trigger agent_complete tick
      this.onAgentComplete({
        agentId: taskId,
        taskDescription: task?.taskDescription ?? '',
        outcome: 'completed',
        resultContent: result,
      });
    } catch (err) {
      // Guard: if already settled by timeout, bail out
      if (this.settledTasks.has(taskId)) return;
      this.settledTasks.add(taskId);

      // Clear timeout
      const timer = this.timeoutTimers.get(taskId);
      if (timer) {
        clearTimeout(timer);
        this.timeoutTimers.delete(taskId);
      }

      this.activeSessions.delete(taskId);

      const errorMsg = err instanceof Error ? err.message : String(err);
      const task = this.taskStore.getAgentTask(taskId);

      this.taskStore.updateAgentTask(taskId, {
        status: 'failed',
        error: errorMsg,
        completedAt: now(),
      });

      this.eventBus.emit('agent:failed', { taskId, error: errorMsg });

      // Trigger agent_complete tick with failure
      this.onAgentComplete({
        agentId: taskId,
        taskDescription: task?.taskDescription ?? '',
        outcome: 'failed',
        resultContent: `Sub-agent failed: ${errorMsg}`,
      });
    }
  }

  /**
   * Handle agent timeout.
   */
  private async handleTimeout(taskId: string): Promise<void> {
    this.timeoutTimers.delete(taskId);

    // Guard: if already settled by runAgent completion/error, bail out
    if (this.settledTasks.has(taskId)) return;
    this.settledTasks.add(taskId);

    const session = this.activeSessions.get(taskId);
    if (session) {
      try {
        await session.cancel();
        await session.end();
      } catch (err) {
        console.warn(
          `[AgentOrchestrator] Failed to cancel timed out session ${taskId}:`,
          err
        );
      }
      this.activeSessions.delete(taskId);
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
