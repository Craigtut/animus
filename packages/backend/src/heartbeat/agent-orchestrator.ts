/**
 * Agent Orchestrator
 *
 * Manages sub-agent lifecycle: spawning, updating, cancelling, and
 * processing completion results. Handles MindOutput decisions related
 * to sub-agents (spawn_agent, update_agent, cancel_agent).
 *
 * See docs/architecture/agent-orchestration.md for the full design.
 */

import type { AgentProvider, PermissionTier } from '@animus/shared';
import { generateUUID, now } from '@animus/shared';
import type {
  AgentManager,
  IAgentSession,
  AgentResponse,
} from '@animus/agents';
import { attachSessionLogging, type AgentLogStore } from '@animus/agents';
import type { IEventBus } from '@animus/shared';
import { prepareCodexSessionAuth } from '../services/codex-oauth.js';
import { getSystemDb } from '../db/index.js';
import * as systemStore from '../db/stores/system-store.js';
import * as messageStore from '../db/stores/message-store.js';
import { getMessagesDb, getMemoryDb } from '../db/index.js';
import { createLogger } from '../lib/logger.js';
import { env, PROJECT_ROOT } from '../utils/env.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSubAgentMcpServer, type MutableToolContext, type ToolPermissionLookup } from '../tools/servers/claude-mcp.js';
import type { ToolHandlerContext } from '../tools/types.js';
import { getToolPermissions } from '../db/stores/system-store.js';
import { getPluginManager } from '../services/plugin-manager.js';

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
  private getPreferredProvider: (() => AgentProvider | null) | null;
  private getPreferredModel: (() => string | undefined) | null;
  /** Cached sub-agent MCP server (built lazily, once per process) */
  private subAgentMcpServer: { serverConfig: Record<string, unknown>; allowedTools: string[] } | null = null;
  /** Per-task mutable tool contexts for sub-agent MCP handlers */
  private subAgentToolContexts = new Map<string, MutableToolContext>();
  private onAgentComplete: (params: {
    agentId: string;
    taskDescription: string;
    outcome: string;
    resultContent?: string;
  }) => void;
  private buildToolContextFactory: ((taskId: string, params: SpawnAgentParams) => ToolHandlerContext) | null;

  constructor(params: {
    manager: AgentManager;
    taskStore: AgentTaskStore;
    logStore: AgentLogStore;
    eventBus: IEventBus;
    spawnBudgetPerHour?: number;
    getPreferredProvider?: () => AgentProvider | null;
    getPreferredModel?: () => string | undefined;
    buildToolContext?: (taskId: string, params: SpawnAgentParams) => ToolHandlerContext;
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
    this.getPreferredProvider = params.getPreferredProvider ?? null;
    this.getPreferredModel = params.getPreferredModel ?? null;
    this.buildToolContextFactory = params.buildToolContext ?? null;
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
    // Determine provider: prefer user's setting, fall back to first configured
    const preferred = this.getPreferredProvider?.();
    const provider = (preferred && this.manager.isConfigured(preferred))
      ? preferred
      : (this.manager.getConfiguredProviders()[0] ?? 'claude');

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

    let codexTempDir: string | null = null;

    try {
      // Prepare Codex OAuth session auth if needed
      let sessionEnv: Record<string, string> | undefined;
      if (provider === 'codex' && process.env['CODEX_OAUTH_CONFIGURED']) {
        try {
          codexTempDir = await mkdtemp(join(tmpdir(), 'animus-codex-'));
          sessionEnv = await prepareCodexSessionAuth(getSystemDb(), codexTempDir);
        } catch (err) {
          log.warn('Codex OAuth session prep failed, falling back:', err);
          if (codexTempDir) {
            rm(codexTempDir, { recursive: true, force: true }).catch(() => {});
            codexTempDir = null;
          }
        }
      }

      // Build sub-agent MCP server lazily (once per process, Claude only)
      // Determine contact tier for tool filtering
      const contactTier = this.resolveContactTier(params.contactId);
      const subAgentContext: MutableToolContext = { current: null };
      this.subAgentToolContexts.set(taskId, subAgentContext);

      if (!this.subAgentMcpServer && provider === 'claude') {
        try {
          const permissions = this.buildToolPermissionLookup();
          this.subAgentMcpServer = await buildSubAgentMcpServer(contactTier, subAgentContext, permissions);
          log.info(`Sub-agent MCP server built with tools: ${this.subAgentMcpServer.allowedTools.join(', ')}`);
        } catch (err) {
          log.warn('Failed to build sub-agent MCP server:', err);
        }
      }

      // Merge built-in sub-agent MCP tools with plugin MCP servers.
      // Sub-agents can't interact with users for approval, so exclude
      // plugin MCP servers with 'off' or 'ask' mode (only 'always_allow' passes).
      const pluginMcp = getPluginManager().getPluginMcpServersForSdk();
      const filteredPluginServers: Record<string, Record<string, unknown>> = {};
      const filteredPluginTools: string[] = [];
      try {
        const sysDb = getSystemDb();
        for (const [key, config] of Object.entries(pluginMcp.mcpServers)) {
          const permKey = `mcp__${key}`;
          const perm = systemStore.getToolPermission(sysDb, permKey);
          if (perm && (perm.mode === 'off' || perm.mode === 'ask')) {
            continue; // Sub-agents skip disabled and gated tools
          }
          filteredPluginServers[key] = config;
          filteredPluginTools.push(`mcp__${key}__*`);
        }
      } catch {
        // DB not available — include all plugin servers as fallback
        Object.assign(filteredPluginServers, pluginMcp.mcpServers);
        filteredPluginTools.push(...pluginMcp.allowedTools);
      }
      const mergedMcpServers: Record<string, Record<string, unknown>> = {
        ...(this.subAgentMcpServer ? { animus: this.subAgentMcpServer.serverConfig } : {}),
        ...filteredPluginServers,
      };
      const mergedAllowedTools: string[] = [
        ...(this.subAgentMcpServer ? this.subAgentMcpServer.allowedTools : []),
        ...filteredPluginTools,
      ];

      // For Claude provider: expose Animus plugin skills via the skill bridge plugin
      let sdkPlugins: Array<{ type: 'local'; path: string }> | undefined;
      if (provider === 'claude') {
        const bridgePath = getPluginManager().getSkillBridgePath();
        sdkPlugins = [{ type: 'local' as const, path: bridgePath }];
        if (!mergedAllowedTools.includes('Skill')) {
          mergedAllowedTools.push('Skill');
        }
      }

      // Create the agent session
      const verboseAgent = env.LOG_LEVEL === 'debug' || env.LOG_LEVEL === 'trace';
      const model = this.getPreferredModel?.();

      // Sub-agents cannot interact with the user for approval, so both
      // 'off' and 'ask' SDK built-in tools are disallowed.
      const disabledSdkTools = this.getDisabledSdkTools('off', 'ask');

      const session = await this.manager.createSession({
        provider,
        model,
        cwd: PROJECT_ROOT,
        systemPrompt: params.systemPrompt,
        permissions: {
          executionMode: 'build',
          approvalLevel: 'none',
        },
        ...(sessionEnv ? { env: sessionEnv } : {}),
        ...(Object.keys(mergedMcpServers).length > 0 ? {
          mcpServers: mergedMcpServers,
        } : {}),
        // allowedTools: MCP tool patterns + 'Skill' for SDK skill discovery
        ...(mergedAllowedTools.length > 0 ? { allowedTools: mergedAllowedTools } : {}),
        // Disable SDK built-in tools with mode='off' or 'ask' (sub-agents can't do approvals)
        ...(disabledSdkTools.length > 0 ? { disallowedTools: disabledSdkTools } : {}),
        // Claude SDK plugins for skill discovery (bridge to .claude/skills/)
        ...(sdkPlugins ? { plugins: sdkPlugins } : {}),
        verbose: verboseAgent,
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

      // Set the sub-agent tool context for this task
      subAgentContext.current = this.buildToolContextFactory
        ? this.buildToolContextFactory(taskId, params)
        : this.buildSubAgentToolContext(taskId, params);

      // Run asynchronously (non-blocking)
      this.runAgent(taskId, session, params.instructions, logging)
        .catch((err) => {
          log.error(`Agent ${taskId} run error:`, err);
        })
        .finally(() => {
          // Clean up Codex OAuth temp directory
          if (codexTempDir) {
            rm(codexTempDir, { recursive: true, force: true }).catch(() => {});
          }
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

      // Clean up Codex temp dir on session creation failure
      if (codexTempDir) {
        rm(codexTempDir, { recursive: true, force: true }).catch(() => {});
      }

      throw err;
    }
  }

  /**
   * Forward new information to a running sub-agent.
   */
  async updateAgent(params: UpdateAgentParams): Promise<void> {
    const session = this.activeSessions.get(params.agentId);
    if (!session) {
      log.warn(`Cannot update agent ${params.agentId}: no active session`);
      return;
    }

    try {
      await session.prompt(params.context);
      this.taskStore.updateAgentTask(params.agentId, {
        currentActivity: 'Processing update',
      });
    } catch (err) {
      log.error(`Failed to update agent ${params.agentId}:`, err);
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
        log.warn(`Failed to cancel session for ${params.agentId}:`, err);
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
          log.warn(`Failed to end session for ${taskId}:`, err);
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
   * Build a ToolPermissionLookup from the tool_permissions table.
   */
  private buildToolPermissionLookup(): ToolPermissionLookup {
    try {
      const sysDb = getSystemDb();
      const perms = getToolPermissions(sysDb);
      const lookup: ToolPermissionLookup = new Map();
      for (const p of perms) {
        lookup.set(p.toolName, p.mode);
      }
      return lookup;
    } catch {
      return new Map();
    }
  }

  /**
   * Get SDK built-in tools that should be disallowed based on permission mode.
   */
  private getDisabledSdkTools(...blockModes: Array<'off' | 'ask'>): string[] {
    try {
      const sysDb = getSystemDb();
      const perms = getToolPermissions(sysDb);
      const modes = new Set<string>(blockModes);
      return perms
        .filter((p) => p.toolSource.startsWith('sdk:') && modes.has(p.mode))
        .map((p) => p.toolName);
    } catch {
      return [];
    }
  }

  /**
   * Resolve the contact permission tier, defaulting to 'primary'.
   */
  private resolveContactTier(contactId: string): PermissionTier {
    if (!contactId) return 'primary';
    try {
      const sysDb = getSystemDb();
      const contact = systemStore.getContact(sysDb, contactId);
      return (contact?.permissionTier ?? 'primary') as PermissionTier;
    } catch {
      return 'primary';
    }
  }

  /**
   * Build a ToolHandlerContext for a sub-agent task.
   */
  private buildSubAgentToolContext(
    taskId: string,
    params: SpawnAgentParams,
  ): ToolHandlerContext {
    const msgDb = getMessagesDb();
    const memDb = getMemoryDb();

    // Resolve conversation for the contact + channel
    let conversationId = '';
    if (params.contactId && params.channel) {
      try {
        const conv = messageStore.getConversationByContactAndChannel(
          msgDb, params.contactId, params.channel as any,
        );
        if (conv) conversationId = conv.id;
      } catch {
        // No conversation yet — fine
      }
    }

    return {
      agentTaskId: taskId,
      contactId: params.contactId,
      sourceChannel: params.channel,
      conversationId,
      stores: {
        messages: {
          createMessage: (data) => messageStore.createMessage(msgDb, data),
        },
        heartbeat: {
          updateAgentTaskProgress: (agentTaskId, activity, percentComplete) => {
            this.taskStore.updateAgentTask(agentTaskId, {
              currentActivity: activity + (percentComplete != null ? ` (${percentComplete}%)` : ''),
            });
          },
        },
        memory: {
          retrieveRelevant: async () => [],
        },
      },
      eventBus: this.eventBus,
    };
  }

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

      // Clean up session and tool context
      this.activeSessions.delete(taskId);
      this.subAgentToolContexts.delete(taskId);
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
      this.subAgentToolContexts.delete(taskId);

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
        log.warn(`Failed to cancel timed out session ${taskId}:`, err);
      }
      this.activeSessions.delete(taskId);
    }
    this.subAgentToolContexts.delete(taskId);

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
