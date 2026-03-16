/**
 * Agent Orchestrator
 *
 * Manages sub-agent lifecycle: spawning, updating, cancelling, and
 * processing completion results. Handles MindOutput decisions related
 * to sub-agents (spawn_agent, update_agent, cancel_agent).
 *
 * See docs/architecture/agent-orchestration.md for the full design.
 */

import type { AgentProvider, PermissionTier } from '@animus-labs/shared';
import { generateUUID, now } from '@animus-labs/shared';
import type {
  AgentManager,
  IAgentSession,
  AgentResponse,
} from '@animus-labs/agents';
import { attachSessionLogging, type AgentLogStore } from '@animus-labs/agents';
import type { IEventBus } from '@animus-labs/shared';
import type { CortexAgent, SubAgentManager } from '@animus-labs/cortex';
import { CodexAuthProvider } from '@animus-labs/agents';
import { createCredentialStore } from '../services/credential-store-adapter.js';
import { getSystemDb, getContactsDb } from '../db/index.js';
import * as systemStore from '../db/stores/system-store.js';
import * as contactStore from '../db/stores/contact-store.js';
import * as messageStore from '../db/stores/message-store.js';
import { getMessagesDb, getMemoryDb } from '../db/index.js';
import { createLogger } from '../lib/logger.js';
import { logProcessSpawn } from '../lib/process-diagnostics.js';
import { env, PROJECT_ROOT } from '../utils/env.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  startBridge,
  registerContext,
  unregisterContext,
  updatePermissions,
  updateSubagentTier,
  buildMcpServerConfig,
  type MutableToolContext,
  type ToolPermissionLookup,
} from '../tools/servers/mcp-bridge.js';
import type { ToolHandlerContext } from '../tools/types.js';
import { getToolPermissions } from '../db/stores/system-store.js';
import { getPluginManager } from '../plugins/index.js';
import { getAllowedTools, ANIMUS_TOOL_DEFS } from '@animus-labs/shared';

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
  /** Per-task mutable tool contexts for sub-agent MCP handlers */
  private subAgentToolContexts = new Map<string, MutableToolContext>();
  private onAgentComplete: (params: {
    agentId: string;
    taskDescription: string;
    outcome: string;
    resultContent?: string;
  }) => void;
  private buildToolContextFactory: ((taskId: string, params: SpawnAgentParams) => ToolHandlerContext) | null;
  /** Optional CortexAgent for cortex-based sub-agent spawning */
  private cortexAgent: CortexAgent | null = null;

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

  // --------------------------------------------------------------------------
  // Cortex Integration
  // --------------------------------------------------------------------------

  /**
   * Set the CortexAgent for cortex-based sub-agent spawning.
   * When set, spawnAgent/updateAgent/cancelAgent route through cortex.
   * When null, the legacy @animus-labs/agents path is used.
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
   * When a CortexAgent is configured, delegates to the cortex SubAgent
   * infrastructure. Otherwise, falls back to the legacy @animus-labs/agents
   * path using Claude/Codex SDK sessions.
   */
  async spawnAgent(params: SpawnAgentParams): Promise<string> {
    // Route through cortex when available
    if (this.cortexAgent) {
      return this.spawnCortexSubAgent(params);
    }

    return this.spawnLegacyAgent(params);
  }

  /**
   * Spawn a sub-agent via cortex SubAgentManager.
   *
   * The cortex SubAgent tool creates an independent CortexAgent instance.
   * The orchestrator tracks it in the agent_tasks table and monitors
   * completion via lifecycle hooks wired in wireCortexLifecycleHooks().
   */
  private async spawnCortexSubAgent(params: SpawnAgentParams): Promise<string> {
    const taskId = generateUUID();
    const timestamp = now();

    // Check spawn budget
    const budget = this.checkSpawnBudget();
    if (!budget.allowed) {
      this.taskStore.insertAgentTask({
        id: taskId,
        tickNumber: params.tickNumber,
        sessionId: null,
        provider: 'cortex' as AgentProvider,
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

    // Insert task record in the database before spawning
    this.taskStore.insertAgentTask({
      id: taskId,
      tickNumber: params.tickNumber,
      sessionId: null,
      provider: 'cortex' as AgentProvider,
      status: 'spawning',
      taskType: params.taskType,
      taskDescription: params.description,
      contactId: params.contactId,
      sourceChannel: params.channel,
      createdAt: timestamp,
    });

    try {
      const subAgentManager = this.cortexAgent!.getSubAgentManager();

      // Check concurrency limit
      if (!subAgentManager.canSpawn()) {
        this.taskStore.updateAgentTask(taskId, {
          status: 'failed',
          error: `Cortex sub-agent concurrency limit reached (${subAgentManager.activeCount}/${subAgentManager.limit})`,
          completedAt: now(),
        });
        throw new Error(`Cortex sub-agent concurrency limit reached (${subAgentManager.activeCount}/${subAgentManager.limit})`);
      }

      // Update to running
      this.taskStore.updateAgentTask(taskId, {
        status: 'running',
        startedAt: now(),
      });

      // Set timeout
      const timeoutMs = TASK_TIMEOUTS[params.taskType] ?? DEFAULT_TIMEOUT_MS;
      const timer = setTimeout(() => {
        this.handleCortexTimeout(taskId);
      }, timeoutMs);
      this.timeoutTimers.set(taskId, timer);

      // Use the cortex agent's prompt() in the background. The SubAgentManager
      // lifecycle hooks handle completion/failure tracking. For background
      // sub-agents, we use cortex's SubAgent tool which creates an independent
      // CortexAgent. For now, we delegate via the parent cortex agent's prompt
      // by injecting a steering message that triggers the SubAgent tool. However,
      // the more direct approach is to have the mind decide to use the SubAgent
      // tool itself. Since the decision executor calls spawnAgent(), we spawn
      // asynchronously and track via the task record.
      // The SubAgent tool is invoked by the LLM, not by us directly. So here we
      // just record the intent and let the cortex lifecycle hooks track it.
      // The taskId we created is the orchestrator's tracking ID.
      log.info(`Cortex sub-agent spawn requested: ${taskId} (${params.taskType}: ${params.description.substring(0, 80)})`);

      return taskId;
    } catch (err) {
      if (this.taskStore.getAgentTask(taskId)?.status === 'spawning') {
        this.taskStore.updateAgentTask(taskId, {
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
          completedAt: now(),
        });
      }
      throw err;
    }
  }

  /**
   * Legacy sub-agent spawning via @animus-labs/agents SDK sessions.
   * Used when no CortexAgent is configured.
   */
  private async spawnLegacyAgent(params: SpawnAgentParams): Promise<string> {
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
      // Prepare Codex session auth if needed
      let sessionEnv: Record<string, string> | undefined;
      if (provider === 'codex' && (process.env['CODEX_OAUTH_CONFIGURED'] || process.env['CODEX_CLI_CONFIGURED'])) {
        try {
          codexTempDir = await mkdtemp(join(tmpdir(), 'animus-codex-'));
          const codexAuth = new CodexAuthProvider();
          const store = createCredentialStore(getSystemDb());
          sessionEnv = await codexAuth.prepareSessionEnv(store, codexTempDir);
        } catch (err) {
          log.warn('Codex session auth prep failed, falling back:', err);
          if (codexTempDir) {
            rm(codexTempDir, { recursive: true, force: true }).catch(() => {});
            codexTempDir = null;
          }
        }
      }

      // Build sub-agent MCP server via stdio bridge (works for ALL providers)
      const contactTier = this.resolveContactTier(params.contactId);
      const subAgentContext: MutableToolContext = { current: null };
      this.subAgentToolContexts.set(taskId, subAgentContext);

      let subAgentMcpConfig: { serverConfig: Record<string, unknown>; allowedTools: string[] } | null = null;
      try {
        const permissions = this.buildToolPermissionLookup();
        updatePermissions(permissions);
        updateSubagentTier(contactTier);
        const bridgePort = await startBridge();
        registerContext(taskId, subAgentContext);
        const serverConfig = buildMcpServerConfig(bridgePort, 'subagent', taskId);
        // Build allowed tools list from the sub-agent tool set
        const subAgentToolNames = getAllowedTools(contactTier);
        const allowedTools: string[] = [];
        for (const toolName of subAgentToolNames) {
          const mode = permissions.get(toolName);
          if (mode === 'off' || mode === 'ask') continue;
          allowedTools.push(`mcp__animus__${toolName}`);
        }
        subAgentMcpConfig = { serverConfig: serverConfig as unknown as Record<string, unknown>, allowedTools };
        log.info(`Sub-agent MCP server built (stdio bridge) with tools: ${allowedTools.join(', ')}`);
      } catch (err) {
        log.warn('Failed to build sub-agent MCP server:', err);
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
        ...(subAgentMcpConfig ? { animus: subAgentMcpConfig.serverConfig } : {}),
        ...filteredPluginServers,
      };
      const mergedAllowedTools: string[] = [
        ...(subAgentMcpConfig ? subAgentMcpConfig.allowedTools : []),
        ...filteredPluginTools,
      ];

      // Provider-specific skill discovery wiring:
      // - Claude: expose Animus plugin skills via the local bridge plugin.
      // - Codex: inject generated runtime config via CODEX_HOME.
      let sdkPlugins: Array<{ type: 'local'; path: string }> | undefined;
      if (provider === 'codex') {
        sessionEnv = await getPluginManager().buildCodexRuntimeEnv(sessionEnv);
      }
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

      logProcessSpawn(
        `sub-agent:${taskId}`,
        `sdk:${provider}`,
        [params.taskType, params.description.substring(0, 60)],
        sessionEnv,
      );

      // When using Claude Code, use the claude_code preset so sub-agents get
      // the full Claude Code system prompt (tool instructions, coding guidelines).
      // Other providers (Codex, OpenCode) get the plain system prompt string.
      const systemPromptConfig = provider === 'claude'
        ? { type: 'preset' as const, preset: 'claude_code' as const, append: params.systemPrompt }
        : params.systemPrompt;

      const session = await this.manager.createSession({
        provider,
        ...(model != null ? { model } : {}),
        cwd: PROJECT_ROOT,
        systemPrompt: systemPromptConfig,
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
        // Claude SDK plugins for skill discovery (bridge to runtime claude/skills/)
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
   *
   * When cortex is available, uses agent.steer() to inject context into
   * the running agentic loop. Otherwise, uses the legacy session.prompt().
   */
  async updateAgent(params: UpdateAgentParams): Promise<void> {
    // Cortex path: steer the sub-agent via SubAgentManager
    if (this.cortexAgent) {
      const subAgentManager = this.cortexAgent.getSubAgentManager();
      const tracked = subAgentManager.get(params.agentId);
      if (!tracked) {
        log.warn(`Cannot steer cortex sub-agent ${params.agentId}: not tracked`);
        return;
      }

      try {
        const subAgent = tracked.agent as CortexAgent;
        subAgent.steer(params.context);
        this.taskStore.updateAgentTask(params.agentId, {
          currentActivity: 'Processing update (steered)',
        });
        log.info(`Steered cortex sub-agent ${params.agentId}`);
      } catch (err) {
        log.error(`Failed to steer cortex sub-agent ${params.agentId}:`, err);
      }
      return;
    }

    // Legacy path
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
   *
   * When cortex is available, calls abort() on the cortex sub-agent.
   * Otherwise, cancels the legacy SDK session.
   */
  async cancelAgent(params: CancelAgentParams): Promise<void> {
    // Clear timeout (applies to both paths)
    const timer = this.timeoutTimers.get(params.agentId);
    if (timer) {
      clearTimeout(timer);
      this.timeoutTimers.delete(params.agentId);
    }

    // Cortex path: abort the sub-agent via SubAgentManager
    if (this.cortexAgent) {
      const subAgentManager = this.cortexAgent.getSubAgentManager();
      const tracked = subAgentManager.get(params.agentId);
      if (tracked) {
        try {
          const subAgent = tracked.agent as CortexAgent;
          await subAgent.abort();
          log.info(`Aborted cortex sub-agent ${params.agentId}`);
        } catch (err) {
          log.warn(`Failed to abort cortex sub-agent ${params.agentId}:`, err);
        }

        // Remove from tracking with a cancelled result
        subAgentManager.fail(params.agentId, params.reason);
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
      return;
    }

    // Legacy path
    const session = this.activeSessions.get(params.agentId);
    if (session) {
      try {
        await session.cancel();
        await session.end();
      } catch (err) {
        log.warn(`Failed to cancel session for ${params.agentId}:`, err);
      }
      this.activeSessions.delete(params.agentId);
    }
    this.subAgentToolContexts.delete(params.agentId);
    unregisterContext(params.agentId);

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
    if (this.activeSessions.has(agentId)) return true;

    // Also check cortex sub-agents
    if (this.cortexAgent) {
      const subAgentManager = this.cortexAgent.getSubAgentManager();
      return subAgentManager.get(agentId) !== undefined;
    }

    return false;
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

    // End all active legacy sessions
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

    // Clear cortex reference (cortex agent lifecycle managed separately)
    this.cortexAgent = null;
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
      const cDb = getContactsDb();
      const contact = contactStore.getContact(cDb, contactId);
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

      // Log usage with tick metadata for the usage & budget system.
      // The logUsage signature already accepts a TickContext parameter.
      const taskRecord = this.taskStore.getAgentTask(taskId);
      logging.logUsage(response.usage, response.cost ?? null, response.model, {
        tickNumber: taskRecord?.tickNumber ?? null,
        tickType: 'agent_complete',
        contactId: taskRecord?.contactId ?? null,
      });

      // Clear timeout
      const timer = this.timeoutTimers.get(taskId);
      if (timer) {
        clearTimeout(timer);
        this.timeoutTimers.delete(taskId);
      }

      // Clean up session, tool context, and bridge registration
      this.activeSessions.delete(taskId);
      this.subAgentToolContexts.delete(taskId);
      unregisterContext(taskId);
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
      unregisterContext(taskId);

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
   * Handle cortex sub-agent timeout.
   * Aborts the sub-agent and marks it as timed out in the task store.
   */
  private async handleCortexTimeout(taskId: string): Promise<void> {
    this.timeoutTimers.delete(taskId);

    if (!this.cortexAgent) return;

    const subAgentManager = this.cortexAgent.getSubAgentManager();
    const tracked = subAgentManager.get(taskId);
    if (tracked) {
      try {
        const subAgent = tracked.agent as CortexAgent;
        await subAgent.abort();
      } catch (err) {
        log.warn(`Failed to abort timed out cortex sub-agent ${taskId}:`, err);
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

  /**
   * Handle legacy agent timeout.
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
    unregisterContext(taskId);

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
