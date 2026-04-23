/**
 * Cortex Mind Session
 *
 * Replaces the old AgentManager-based mind session (mind-session.ts) with
 * a CortexAgent-based session. This is the Phase 2A heartbeat integration.
 *
 * Key differences from the old mind-session.ts:
 * - Uses CortexAgent instead of AgentManager + IAgentSession
 * - Tools are registered as direct CortexTool objects (not MCP)
 * - Context is managed via 9 named slots (not session system prompts)
 * - No warm/cold session state (always warm)
 * - No cognitive MCP tools (replaced by THOUGHT/REFLECT phases)
 * - Permission gate via CortexAgent's resolvePermission callback
 *
 * See docs/cortex/mind-migration.md for the full design.
 */

import {
  CortexAgent,
  ProviderManager,
  zodToTypebox,
  type AgentTextOutput,
  type CortexEvent,
  type ClassifiedError,
  type CortexModel,
  type CortexTool,
  type McpStdioConfig,
  type McpHttpConfig,
  type ToolContentDetails,
  type ObservationalMemoryState,
  resolveCacheRetention,
} from '@animus-labs/cortex';

import { getSystemDb, getHeartbeatDb, getContactsDb, getMessagesDb, getMemoryDb, getPersonaDb, getAgentLogsDb } from '../db/index.js';
import * as systemStore from '../db/stores/system-store.js';
import * as contactStore from '../db/stores/contact-store.js';
import * as messageStore from '../db/stores/message-store.js';
import * as personaStore from '../db/stores/persona-store.js';
import * as memoryDbStore from '../db/stores/memory-store.js';
import * as heartbeatStore from '../db/stores/heartbeat-store.js';
import * as agentLogStore from '../db/stores/agent-log-store.js';
import * as vaultStore from '../db/stores/vault-store.js';
import { getEventBus } from '../lib/event-bus.js';
import { createLogger } from '../lib/logger.js';
import { PROJECT_ROOT, DATA_DIR, APP_VERSION } from '../utils/env.js';
import { isBlockedPath, isBlockedCommand } from '../lib/file-deny-list.js';
import { resolveToolGate } from '../tools/tool-gate.js';
import { getToolPermission, getToolPermissions } from '../db/stores/system-store.js';
import { ANIMUS_TOOL_DEFS, type AnimusToolName } from '@animus-labs/shared';
import type { ChannelType } from '@animus-labs/shared';
import { executeTool } from '../tools/registry.js';
import type { ToolHandlerContext, ToolResult } from '../tools/types.js';
import type { MemoryManager } from '../memory/index.js';
import type { GatherResult } from './gather-context.js';
import { getChannelRouter } from '../channels/channel-router.js';
import { getPluginManager } from '../plugins/index.js';
import { join } from 'node:path';
import { createToolResultPersistor, cleanupDereferencedPaths } from './tool-result-persistor.js';
import { getSessionsDb } from '../db/index.js';
import * as sessionStore from '../db/stores/session-store.js';

const log = createLogger('CortexMind', 'heartbeat');

// ============================================================================
// Context Slot Names (order matters: most stable first)
// ============================================================================

export const MIND_SLOT_NAMES = [
  'credentials',
  'contacts',
  'core-self',
  'working-memory',
  'thought-observations',
  'experience-observations',
  'message-observations',
  'goals',
  'tasks',
] as const;

export type MindSlotName = typeof MIND_SLOT_NAMES[number];

// ============================================================================
// Cortex Mind State
// ============================================================================

export interface CortexMindState {
  agent: CortexAgent | null;
  providerManager: ProviderManager | null;
  model: CortexModel | null;
  toolContext: MutableMindToolContext;
  /** Whether the agent has been initialized (first prompt sent) */
  initialized: boolean;
  /** Conversation history checkpoint (serialized JSON) */
  conversationHistoryCheckpoint: string | null;
  /** Active thread session for this tick. Null = inner-life tick (no persistence). */
  activeSession: { contactId: string; channel: string } | null;
}

export interface MutableMindToolContext {
  current: ToolHandlerContext | null;
}


export function createCortexMindState(): CortexMindState {
  return {
    agent: null,
    providerManager: null,
    model: null,
    toolContext: { current: null },
    initialized: false,
    conversationHistoryCheckpoint: null,
    activeSession: null,
  };
}

// ============================================================================
// Build Mind Tool Context
// ============================================================================

/**
 * Build a ToolHandlerContext for the mind session's current tick.
 * Uses 'mind' as the sentinel agentTaskId to distinguish from sub-agents.
 */
export function buildMindToolContext(
  gathered: GatherResult,
  memoryMgr: MemoryManager | null,
): ToolHandlerContext {
  const msgDb = getMessagesDb();
  const memDb = getMemoryDb();

  let conversationId = '';
  if (gathered.contact && gathered.trigger.channel) {
    const channel = (gathered.trigger.channel || 'web') as import('@animus-labs/shared').ChannelType;
    let conv = messageStore.getConversationByContactAndChannel(
      msgDb, gathered.contact.id, channel
    );
    if (!conv) {
      conv = messageStore.createConversation(msgDb, {
        contactId: gathered.contact.id,
        channel,
      });
    }
    conversationId = conv.id;
  }

  const cDb = getContactsDb();

  return {
    agentTaskId: 'mind',
    contactId: gathered.contact?.id ?? '',
    sourceChannel: gathered.trigger.channel ?? 'web',
    conversationId,
    stores: {
      messages: {
        createMessage: (data) => messageStore.createMessage(msgDb, data),
      },
      heartbeat: {},
      memory: {
        retrieveRelevant: async (query: string, limit?: number) => {
          if (!memoryMgr) return [];
          return memoryMgr.retrieveRelevant(query, limit ?? 5);
        },
      },
      contacts: {
        getContact: (id) => contactStore.getContact(cDb, id),
        listContacts: () => contactStore.listContacts(cDb),
        getContactChannels: (contactId) => contactStore.getContactChannelsByContactId(cDb, contactId),
      },
      channels: {
        sendOutbound: async (params) => {
          const router = getChannelRouter();
          const msg = await router.sendOutbound(params);
          return msg ? { id: msg.id } : null;
        },
      },
    },
    eventBus: getEventBus(),
  };
}

// ============================================================================
// Permission Gate
// ============================================================================

/**
 * Build the resolvePermission callback for CortexAgent.
 *
 * This replaces the old canUseTool + PreToolUse hook dual-gate system.
 * CortexAgent calls this before every tool execution. We check:
 * 1. File deny list (security)
 * 2. Tool permission mode (off/ask/always_allow)
 * 3. Approval flow (for 'ask' mode tools)
 */
function buildPermissionResolver(
  toolContextRef: MutableMindToolContext,
): (toolName: string, toolArgs: unknown) => Promise<boolean> {
  return async (toolName: string, toolArgs: unknown): Promise<boolean> => {
    log.info(`Permission check for: "${toolName}"`);

    const args = (toolArgs ?? {}) as Record<string, unknown>;

    // Security: file deny list for file/shell tools
    if (['Read', 'Write', 'Edit'].includes(toolName)) {
      const filePath = args['file_path'] as string | undefined;
      if (filePath && isBlockedPath(filePath)) {
        log.warn(`Blocked agent access to restricted file: ${filePath}`);
        return false;
      }
    }
    if (toolName === 'Bash') {
      const command = args['command'] as string | undefined;
      if (command && isBlockedCommand(command)) {
        log.warn(`Blocked agent execution of restricted command: ${command.substring(0, 100)}`);
        return false;
      }
    }

    // Look up permission record
    const sysDb = getSystemDb();
    const permission = getToolPermission(sysDb, toolName);

    // No permission record: allow (seeder will catch up)
    if (!permission) {
      return true;
    }

    // Off: deny
    if (permission.mode === 'off') {
      return false;
    }

    // Always allow: permit
    if (permission.mode === 'always_allow') {
      return true;
    }

    // Ask mode: delegate to the shared tool gate
    const ctx = toolContextRef.current;
    const result = resolveToolGate({
      heartbeatDb: getHeartbeatDb(),
      permKey: toolName,
      mode: permission.mode,
      displayName: permission.displayName,
      toolSource: permission.toolSource,
      contactId: ctx?.contactId ?? '',
      sourceChannel: ctx?.sourceChannel ?? 'web',
      conversationId: ctx?.conversationId ?? '',
      toolName,
      toolInput: args,
      originatingAgent: 'mind',
      eventBus: ctx?.eventBus ?? getEventBus(),
    });

    return result.action === 'allow';
  };
}

// ============================================================================
// Build Animus Tools as CortexTool Objects
// ============================================================================

/**
 * Convert Animus tool definitions + handlers into CortexTool objects
 * for registration with CortexAgent.
 *
 * Each tool wraps the existing handler from tools/handlers/ and converts
 * Zod schemas to TypeBox via zodToTypebox().
 */
async function buildSingleAnimusTool(
  toolName: AnimusToolName,
  toolContextRef: MutableMindToolContext,
): Promise<CortexTool | null> {
  const def = ANIMUS_TOOL_DEFS[toolName];
  if (!def) return null;

  let parameters;
  try {
    parameters = await zodToTypebox(def.inputSchema as never);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`Failed to convert schema for tool '${toolName}': ${msg}`);
    return null;
  }

  return {
    name: toolName,
    description: def.description,
    parameters,
    execute: async (params: unknown): Promise<ToolContentDetails<unknown>> => {
      const ctx = toolContextRef.current;
      if (!ctx) {
        throw new Error('No tool context available. This is a system error.');
      }

      const result: ToolResult = await executeTool(toolName, params, ctx);

      if (result.isError) {
        const errorText = result.content
          .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
          .map(c => c.text)
          .join('\n');
        throw new Error(errorText || 'Tool execution failed');
      }

      return {
        content: result.content
          .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
          .map(c => ({ type: 'text' as const, text: c.text })),
        details: {},
      };
    },
  };
}

async function buildAnimusTools(
  toolContextRef: MutableMindToolContext,
): Promise<CortexTool[]> {
  const tools: CortexTool[] = [];

  for (const [name] of Object.entries(ANIMUS_TOOL_DEFS)) {
    const toolName = name as AnimusToolName;

    try {
      const sysDb = getSystemDb();
      const perm = getToolPermission(sysDb, toolName);
      if (perm && perm.mode === 'off') {
        log.debug(`Skipping disabled tool: ${toolName}`);
        continue;
      }
    } catch {
      // DB not ready yet; include the tool
    }

    const tool = await buildSingleAnimusTool(toolName, toolContextRef);
    if (tool) tools.push(tool);
  }

  log.info(`Built ${tools.length} Animus tools as CortexTool objects`);
  return tools;
}

// ============================================================================
// Create CortexAgent for Mind
// ============================================================================

/**
 * Create and configure a CortexAgent instance for the mind session.
 *
 * This replaces getOrCreateMindSession() from the old mind-session.ts.
 * The CortexAgent is always warm; there is no cold/warm distinction.
 */
export async function createCortexMind(
  state: CortexMindState,
  options?: { messageEmbedder?: import('../memory/message-embedder.js').MessageEmbedder | null },
): Promise<CortexAgent | null> {
  // If already created, return existing
  if (state.agent) {
    return state.agent;
  }

  // Initialize ProviderManager (needed even before agent creation for model listing)
  if (!state.providerManager) {
    state.providerManager = new ProviderManager();
  }

  // Read provider/model settings from system_settings
  const sysDb = getSystemDb();
  const settings = systemStore.getSystemSettings(sysDb);

  // Determine provider and model from cortex-specific settings.
  // If no cortex provider is configured, return null. The agent will be
  // created later when the user configures a provider via onboarding or settings.
  const settingsAny = settings as Record<string, unknown>;
  const provider = settingsAny['cortexProvider'] as string | undefined | null;
  const modelId = settingsAny['cortexModel'] as string | undefined | null;

  if (!provider || !modelId) {
    log.info('No cortex provider configured. CortexAgent will be created when a provider is set up.');
    return null;
  }

  log.info(`Creating CortexAgent: provider=${provider}, model=${modelId}`);

  // Resolve model via ProviderManager
  const model = await state.providerManager.resolveModel(provider, modelId);
  state.model = model;

  // Build getApiKey callback via CortexCredentialService
  // Checks stored credentials (decrypt on demand), falls back to env vars,
  // handles OAuth token refresh automatically.
  const { getCortexCredentialService } = await import('../services/cortex-credential-service.js');
  const credService = getCortexCredentialService();

  const getApiKey = async (providerName: string): Promise<string> => {
    return credService.resolveApiKey(providerName);
  };

  // Build Animus tools (send_message, read_memory, etc.)
  const animusTools = await buildAnimusTools(state.toolContext);

  const workingDir = join(DATA_DIR, 'workspace');
  log.info(`Built ${animusTools.length} Animus tools (built-in tools auto-registered by Cortex)`);

  // Build permission resolver
  const permissionResolver = buildPermissionResolver(state.toolContext);

  // Tool result persistor: writes oversized tool results to
  // data/tool-results/{tickNumber}/ and returns the path for Cortex to
  // embed in the replacement message.
  const persistResult = createToolResultPersistor({
    getTickNumber: () => {
      try {
        return heartbeatStore.getHeartbeatState(getHeartbeatDb()).tickNumber;
      } catch {
        return 0;
      }
    },
  });

  // Use CortexAgent.create() factory to construct the pi-agent-core Agent
  // internally, eliminating the need to import pi-agent-core in the backend.
  // Built-in tools (Read, Write, Edit, Glob, Grep, Bash, WebFetch, TaskOutput)
  // are auto-registered by Cortex using workingDirectory.
  // Build recall config if message embedder is available
  const messageEmbedder = options?.messageEmbedder;
  const recallConfig = messageEmbedder?.isReady()
    ? { search: messageEmbedder.search.bind(messageEmbedder) }
    : undefined;

  const cortexDiagnostics = settingsAny['cortexDiagnostics'] === true;

  const cortexAgent = await CortexAgent.create({
    model,
    workingDirectory: workingDir,
    getApiKey,
    slots: [...MIND_SLOT_NAMES],
    workingTags: { enabled: true },
    budgetGuard: {
      maxTurns: (settingsAny['cortexMaxTurns'] as number | undefined) ?? 50,
      maxCost: (settingsAny['cortexMaxCostPerTick'] as number | undefined) ?? 1.0,
    },
    contextWindowLimit: (settingsAny['cortexContextWindowLimit'] as number | null | undefined) ?? null,
    resolvePermission: permissionResolver,
    tools: animusTools,
    persistResult,
    compaction: recallConfig ? { observational: { recall: recallConfig } } : undefined,
    deferredTools: { enabled: true, deferMcp: true },
    ...(cortexDiagnostics ? {
      diagnostics: {
        promptWatchdog: {
          enabled: true,
          heartbeatIntervalMs: 1000,
          abortWaitWarningMs: 2000,
        },
      },
    } : {}),
  });

  // Resolve initial cache retention based on provider and heartbeat interval
  const heartbeatIntervalMs = (settingsAny['heartbeatIntervalMs'] as number | undefined) ?? 300_000;
  const initialCacheRetention = resolveCacheRetention(provider, heartbeatIntervalMs);
  cortexAgent.setCacheRetention(initialCacheRetention);
  log.info(`Cache retention: ${initialCacheRetention} (provider=${provider}, interval=${heartbeatIntervalMs}ms)`);

  // Wire event handlers
  wireEventHandlers(cortexAgent, state);

  // Wire EventBus listeners for provider changes from settings UI
  wireProviderChangeListeners(cortexAgent, state);

  // Wire plugin lifecycle listeners for dynamic MCP connections and skills
  wirePluginLifecycleListeners(cortexAgent);

  // Connect to plugin MCP servers (non-blocking; failures logged but don't prevent startup)
  connectPluginMcpServers(cortexAgent).catch(err => {
    log.warn('Error connecting initial plugin MCP servers:', err);
  });

  // Load existing plugin skills into the SkillRegistry at startup
  loadPluginSkillsAtStartup(cortexAgent);

  state.agent = cortexAgent;
  log.info('CortexAgent created and configured for mind session');

  return cortexAgent;
}

// ============================================================================
// Event Handlers
// ============================================================================

/**
 * Wire CortexAgent event handlers for:
 * - onLoopComplete: checkpoint conversation history
 * - onError: route errors to EventBus
 * - onTurnComplete: log turn output
 */
function wireEventHandlers(
  cortexAgent: CortexAgent,
  state: CortexMindState,
): void {
  const eventBus = getEventBus();

  // Checkpoint conversation history to the active thread session
  cortexAgent.onLoopComplete(() => {
    saveActiveSession(cortexAgent, state);
  });

  // Route classified errors to EventBus
  cortexAgent.onError((classified: ClassifiedError) => {
    log.error(`CortexAgent error: ${classified.category} (${classified.severity}): ${classified.originalMessage}`);

    if (classified.category === 'authentication') {
      eventBus.emit('system:error', {
        category: 'authentication',
        message: classified.originalMessage,
        recoverable: false,
        suggestedAction: classified.suggestedAction ?? 'Check your API key in Settings.',
      });
      eventBus.emit('cortex:auth-failed', {
        message: classified.originalMessage,
      });
    } else if (classified.category === 'rate_limit') {
      eventBus.emit('system:error', {
        category: 'provider',
        message: `Rate limit: ${classified.originalMessage}`,
        recoverable: true,
        suggestedAction: classified.suggestedAction ?? 'Rate limit hit. Next tick delayed.',
      });
    } else if (classified.category === 'server_error') {
      eventBus.emit('system:error', {
        category: 'provider',
        message: `Server error: ${classified.originalMessage}`,
        recoverable: true,
        suggestedAction: classified.suggestedAction ?? 'Provider server error. Will retry on next tick.',
      });
    }
  });

  // Log turn completions with tool call and working tag detail
  cortexAgent.getEventBridge().on('turn_end', (event: CortexEvent) => {
    const textOutput = event.textOutput;

    // Extract tool names from the assistant message in the raw pi event
    const piEvent = event.data as Record<string, unknown> | undefined;
    const message = piEvent?.['message'] as Record<string, unknown> | undefined;
    const contentBlocks = Array.isArray(message?.['content']) ? message!['content'] as Array<Record<string, unknown>> : [];
    const toolNames = contentBlocks
      .filter((b) => b['type'] === 'tool_use' || b['type'] === 'toolCall')
      .map((b) => (b['name'] as string) || (b['toolName'] as string) || 'unknown');

    const parts: string[] = [];

    if (toolNames.length > 0) {
      parts.push(`tools=[${toolNames.join(', ')}]`);
    }

    if (textOutput?.working) {
      const workingPreview = textOutput.working.length > 200
        ? textOutput.working.substring(0, 200) + '...'
        : textOutput.working;
      parts.push(`working="${workingPreview}"`);
    }

    if (textOutput?.userFacing) {
      const userPreview = textOutput.userFacing.length > 120
        ? textOutput.userFacing.substring(0, 120) + '...'
        : textOutput.userFacing;
      parts.push(`userFacing="${userPreview}"`);
    }

    if (parts.length > 0) {
      log.info(`Turn: ${parts.join(' | ')}`);
    } else if (!toolNames.length && !textOutput?.userFacing) {
      log.info('Turn: (empty)');
    }
  });

  // Observation-driven tool-result cleanup: when messages containing
  // persisted-result markers are compacted out of raw history, delete the
  // files they reference (unless still referenced in the remaining tail).
  cortexAgent.onObservation((event) => {
    void (async () => {
      try {
        const remaining = cortexAgent.getConversationHistory();
        const deleted = await cleanupDereferencedPaths(
          event.compactedMessages,
          remaining,
          event.observations,
        );
        if (deleted > 0) {
          log.info(`Tool-result GC: deleted ${deleted} dereferenced files after observation`);
        }
      } catch (err) {
        log.warn('Tool-result GC failed after observation:', err);
      }
    })();
  });

  // Wire compaction error handler and debug logging
  wireCompactionHandlers(cortexAgent);
}

// ============================================================================
// Compaction Error Handler
// ============================================================================

/**
 * Wire compaction error handler and debug logging.
 *
 * In observational mode (the default), onBeforeCompaction and onPostCompaction
 * do not fire. Only the error handler and debug logging remain useful.
 */
function wireCompactionHandlers(cortexAgent: CortexAgent): void {
  cortexAgent.getCompactionManager().setDebugLog((msg: string) => {
    log.debug(`[Compaction] ${msg}`);
  });

  cortexAgent.onCompactionError((error: Error) => {
    log.error('Compaction failed:', error);

    try {
      const agentLogsDb = getAgentLogsDb();
      const sessions = agentLogsDb
        .prepare('SELECT id FROM agent_sessions ORDER BY started_at DESC LIMIT 1')
        .get() as { id: string } | undefined;

      if (sessions) {
        agentLogStore.insertEvent(agentLogsDb, {
          sessionId: sessions.id,
          eventType: 'compaction_error',
          data: {
            error: error.message,
            stack: error.stack?.substring(0, 500),
          },
        });
      }
    } catch (logErr) {
      log.warn('Failed to log compaction_error event:', logErr);
    }
  });
}

// ============================================================================
// Provider Change Listeners
// ============================================================================

/**
 * Wire EventBus listeners for provider/model changes from the settings UI.
 * When the user changes the provider or model, we update the CortexAgent
 * without restarting the session.
 */
function wireProviderChangeListeners(
  cortexAgent: CortexAgent,
  state: CortexMindState,
): void {
  const eventBus = getEventBus();

  eventBus.on('cortex:provider-changed', async ({ provider, model: modelId }) => {
    try {
      log.info(`Provider changed: ${provider}/${modelId}, updating CortexAgent model`);
      if (!state.providerManager) {
        log.warn('ProviderManager not available, cannot switch model');
        return;
      }
      const newModel = await state.providerManager.resolveModel(provider, modelId);
      state.model = newModel;
      cortexAgent.setModel(newModel);
      log.info(`CortexAgent model updated to ${provider}/${modelId}`);
    } catch (err) {
      log.error('Failed to switch model:', err);
    }
  });

  eventBus.on('cortex:thinking-level-changed', ({ level }) => {
    log.info(`Thinking level changed to "${level}"`);
    cortexAgent.setThinkingLevel(level);
  });

  eventBus.on('cortex:context-limit-changed', ({ limit }) => {
    log.info(`Context window limit changed to ${limit === null ? 'unlimited' : limit}`);
    cortexAgent.setContextWindowLimit(limit);
  });

  eventBus.on('cortex:provider-removed', async () => {
    log.warn('Provider removed, aborting any in-progress loop and marking agent unavailable');

    // Abort any running agentic loop
    try {
      await cortexAgent.abort();
    } catch (err) {
      log.warn('Failed to abort CortexAgent on provider removal:', err);
    }

    // Null out the agent so hasCortexMind() returns false.
    // The heartbeat will fall back to the legacy path or skip mind queries
    // until a new provider is configured and createCortexMind is called again.
    state.agent = null;
    state.model = null;

    log.info('Heartbeat mind paused until a new provider is configured');
  });

  eventBus.on('tool:permission_changed', async ({ toolName, mode }: { toolName: string; mode: string }) => {
    if (!(toolName in ANIMUS_TOOL_DEFS)) return;
    const animusToolName = toolName as AnimusToolName;

    if (mode === 'off') {
      cortexAgent.removeConsumerTool(animusToolName);
      log.info(`Tool "${toolName}" disabled, removed from CortexAgent`);
    } else {
      const tool = await buildSingleAnimusTool(animusToolName, state.toolContext);
      if (tool) {
        cortexAgent.addConsumerTool(tool);
        log.info(`Tool "${toolName}" enabled (${mode}), added to CortexAgent`);
      }
    }
  });
}

// ============================================================================
// MCP Server Connections
// ============================================================================

/**
 * Connect to plugin MCP servers discovered from the PluginManager.
 * Called once during agent creation and dynamically on plugin lifecycle events.
 *
 * Each plugin's MCP server config is converted from the PluginManager's format
 * to Cortex's McpTransportConfig format. Tools are namespaced as
 * pluginName__serverName__toolName (3-part for plugin tools).
 */
async function connectPluginMcpServers(cortexAgent: CortexAgent): Promise<void> {
  const pluginManager = getPluginManager();
  if (!pluginManager) {
    log.debug('PluginManager not available; skipping plugin MCP connections');
    return;
  }

  const mcpManager = cortexAgent.getMcpClientManager();
  const configs = pluginManager.getMcpConfigs();

  for (const [namespacedKey, serverConfig] of Object.entries(configs)) {
    try {
      const transportConfig = convertPluginMcpConfig(serverConfig as Record<string, unknown>);
      if (transportConfig) {
        await cortexAgent.connectMcpServer(namespacedKey, transportConfig);
      }
    } catch (err) {
      log.warn(`Failed to connect plugin MCP server "${namespacedKey}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * Convert a PluginMcpServer config to a Cortex McpTransportConfig.
 * Accepts the raw record from PluginManager.getMcpConfigs() and extracts
 * the fields needed for either stdio or HTTP transport.
 */
function convertPluginMcpConfig(
  serverConfig: Record<string, unknown>,
): McpStdioConfig | McpHttpConfig | null {
  const url = serverConfig['url'] as string | undefined;
  const command = serverConfig['command'] as string | undefined;

  if (url) {
    const headers = (serverConfig['headers'] as Record<string, string> | undefined) ?? {};
    return {
      transport: 'http',
      url,
      headers,
    };
  }

  if (command) {
    const args = (serverConfig['args'] as string[] | undefined) ?? [];
    const env = (serverConfig['env'] as Record<string, string> | undefined) ?? {};
    return {
      transport: 'stdio',
      command,
      args,
      env,
    };
  }

  return null;
}

/**
 * Wire EventBus listeners for plugin lifecycle events.
 * Dynamically connects/disconnects MCP servers and skills as plugins
 * are installed/removed/enabled/disabled.
 */
function wirePluginLifecycleListeners(cortexAgent: CortexAgent): void {
  const eventBus = getEventBus();
  const mcpManager = cortexAgent.getMcpClientManager();
  const skillRegistry = cortexAgent.getSkillRegistry();

  // Set up logging on the MCP manager
  mcpManager.log = {
    info: (msg: string) => log.info(`[MCP] ${msg}`),
    warn: (msg: string) => log.warn(`[MCP] ${msg}`),
    error: (msg: string, err?: unknown) => log.error(`[MCP] ${msg}`, err),
    debug: (msg: string) => log.debug(`[MCP] ${msg}`),
  };

  eventBus.on('plugin:changed', async ({ pluginName, action }) => {
    const pluginManager = getPluginManager();
    if (!pluginManager) return;

    if (action === 'installed' || action === 'enabled') {
      // Connect new plugin's MCP servers
      const configs = pluginManager.getMcpConfigs();
      for (const [namespacedKey, serverConfig] of Object.entries(configs)) {
        // Only connect servers belonging to this plugin
        if (!namespacedKey.startsWith(`${pluginName}__`)) continue;

        try {
          const transportConfig = convertPluginMcpConfig(serverConfig as Record<string, unknown>);
          if (transportConfig) {
            log.info(`Connecting plugin MCP server: ${namespacedKey}`);
            await cortexAgent.connectMcpServer(namespacedKey, transportConfig);
          }
        } catch (err) {
          log.warn(`Failed to connect plugin MCP server "${namespacedKey}" on ${action}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Register plugin skills with the SkillRegistry
      const loaded = pluginManager.getPlugin(pluginName);
      if (loaded && loaded.skills.length > 0) {
        for (const skill of loaded.skills) {
          const skillMdPath = join(skill.absolutePath, 'SKILL.md');
          skillRegistry.addSkill({
            path: skillMdPath,
            source: `plugin:${pluginName}`,
            variables: { PLUGIN_ROOT: loaded.absolutePath },
          });
          log.info(`Registered plugin skill: ${skill.name} (source: plugin:${pluginName})`);
        }
      }
    } else if (action === 'uninstalled' || action === 'disabled') {
      // Disconnect all MCP servers belonging to this plugin
      const states = mcpManager.getConnectionStates();
      for (const connState of states) {
        if (connState.serverName.startsWith(`${pluginName}__`)) {
          try {
            log.info(`Disconnecting plugin MCP server: ${connState.serverName}`);
            await cortexAgent.disconnectMcpServer(connState.serverName);
          } catch (err) {
            log.warn(`Failed to disconnect plugin MCP server "${connState.serverName}" on ${action}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }

      // Remove plugin skills from the SkillRegistry
      const loaded = pluginManager.getPlugin(pluginName);
      if (loaded && loaded.skills.length > 0) {
        for (const skill of loaded.skills) {
          skillRegistry.removeSkill(skill.name);
          log.info(`Removed plugin skill: ${skill.name} (plugin: ${pluginName})`);
        }
      }
    }

  });

  // Plugin config updated: reconnect MCP servers (config may have changed credentials)
  eventBus.on('plugin:config_updated', async ({ pluginName }) => {
    const pluginManager = getPluginManager();
    if (!pluginManager) return;

    const configs = pluginManager.getMcpConfigs();
    const states = mcpManager.getConnectionStates();

    // Disconnect existing servers for this plugin
    for (const state of states) {
      if (state.serverName.startsWith(`${pluginName}__`)) {
        try {
          await cortexAgent.disconnectMcpServer(state.serverName);
        } catch {
          // Best-effort disconnect
        }
      }
    }

    // Reconnect with updated config
    for (const [namespacedKey, serverConfig] of Object.entries(configs)) {
      if (!namespacedKey.startsWith(`${pluginName}__`)) continue;

      try {
        const transportConfig = convertPluginMcpConfig(serverConfig as Record<string, unknown>);
        if (transportConfig) {
          log.info(`Reconnecting plugin MCP server after config update: ${namespacedKey}`);
          await cortexAgent.connectMcpServer(namespacedKey, transportConfig);
        }
      } catch (err) {
        log.warn(`Failed to reconnect plugin MCP server "${namespacedKey}" after config update: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  });
}

// ============================================================================
// Plugin Skill Startup Loader
// ============================================================================

/**
 * Load all existing plugin skills into the SkillRegistry at startup.
 *
 * Iterates over all loaded and enabled plugins, registering each plugin's
 * skills with the cortex SkillRegistry. This ensures skills from
 * already-installed plugins are available when the CortexAgent is first
 * created, without waiting for a plugin:changed event.
 */
function loadPluginSkillsAtStartup(cortexAgent: CortexAgent): void {
  const pluginManager = getPluginManager();
  if (!pluginManager) {
    log.debug('PluginManager not available; skipping plugin skill loading');
    return;
  }

  const skillRegistry = cortexAgent.getSkillRegistry();
  let skillCount = 0;

  const allPlugins = pluginManager.getAllPlugins();
  for (const pluginInfo of allPlugins) {
    if (!pluginInfo.enabled) continue;

    const loaded = pluginManager.getPlugin(pluginInfo.name);
    if (!loaded || loaded.skills.length === 0) continue;

    for (const skill of loaded.skills) {
      const skillMdPath = join(skill.absolutePath, 'SKILL.md');
      skillRegistry.addSkill({
        path: skillMdPath,
        source: `plugin:${pluginInfo.name}`,
        variables: { PLUGIN_ROOT: loaded.absolutePath },
      });
      skillCount++;
    }
  }

  if (skillCount > 0) {
    log.info(`Loaded ${skillCount} plugin skills into SkillRegistry at startup`);
  }
}

// ============================================================================
// Preprocessor Variables
// ============================================================================

/**
 * Update the skill preprocessor variables for the current tick.
 *
 * Called during GATHER phase in cortexMindQuery. These variables are
 * available for ${VAR} substitution in SKILL.md files when skills are
 * loaded via the load_skill tool.
 *
 * See docs/cortex/skill-system.md, "Consumer Integration Example".
 */
export function updatePreprocessorVariables(
  cortexAgent: CortexAgent,
  gathered: GatherResult,
): void {
  const personaDb = getPersonaDb();
  const persona = personaStore.getPersona(personaDb);

  // Resolve the primary contact (the user running this instance)
  const cDb = getContactsDb();
  const primaryContact = contactStore.getPrimaryContact(cDb);

  cortexAgent.setPreprocessorVariables({
    AGENT_NAME: persona.name || 'Animus',
    USER_NAME: primaryContact?.fullName ?? '',
    USER_ID: primaryContact?.id ?? '',
    CONTACT_NAME: gathered.contact?.fullName ?? '',
    CHANNEL_TYPE: gathered.trigger.channel ?? '',
    DATA_DIR: DATA_DIR,
    PLATFORM: process.platform,
    ENGINE_VERSION: APP_VERSION,
  });

  // Rich context object for script executions
  cortexAgent.setScriptContext({
    contact: gathered.contact
      ? { id: gathered.contact.id, name: gathered.contact.fullName, tier: gathered.contact.permissionTier }
      : null,
    channelType: gathered.trigger.channel ?? null,
    dataDir: DATA_DIR,
    persona: { name: persona.name || 'Animus' },
  });
}

// ============================================================================
// Context Slot Population
// ============================================================================

/**
 * Populate all 9 context slots from the gathered context.
 * Called during GATHER phase and on startup.
 */
export function populateContextSlots(
  cortexAgent: CortexAgent,
  gathered: GatherResult,
): void {
  const cm = cortexAgent.getContextManager();

  // Slot 0: credentials
  cm.setSlot('credentials', gathered.credentialManifest || '(No credentials configured)');

  // Slot 1: contacts
  const contactLines: string[] = [];
  for (const { contact, channels } of gathered.contacts) {
    const channelList = channels.map(ch => ch.channel).join(', ');
    let line = `${contact.fullName} [id: ${contact.id}] - ${contact.permissionTier}`;
    if (channelList) line += ` - reachable via: ${channelList}`;
    if (contact.notes) line += `\n  ${contact.notes}`;
    contactLines.push(line);
  }
  cm.setSlot('contacts', contactLines.length > 0
    ? contactLines.join('\n')
    : '(No contacts yet)');

  // Slot 2: core-self
  const coreSelf = gathered.memoryContext?.coreSelfSection ?? null;
  cm.setSlot('core-self', coreSelf || '(No self-knowledge accumulated yet)');

  // Slot 3: working-memory
  const workingMemory = gathered.memoryContext?.workingMemorySection ?? null;
  cm.setSlot('working-memory', workingMemory || '(No working memory for this contact)');

  // Slot 4: thought-observations
  const thoughtObs = gathered.thoughtContext?.observations?.content ?? null;
  cm.setSlot('thought-observations', thoughtObs || '');

  // Slot 5: experience-observations
  const experienceObs = gathered.experienceContext?.observations?.content ?? null;
  cm.setSlot('experience-observations', experienceObs || '');

  // Slot 6: message-observations
  const messageObs = gathered.messageContext?.observations?.content ?? null;
  cm.setSlot('message-observations', messageObs || '');

  // Slot 7: goals
  const goalContent = [
    gathered.goalContext?.goalSection,
    gathered.goalContext?.proposedGoalsSection,
    gathered.goalContext?.planningPromptsSection,
  ].filter(Boolean).join('\n\n');
  cm.setSlot('goals', goalContent || '(No active goals)');

  // Slot 8: tasks
  const taskLines = gathered.deferredTasks.map(t =>
    `[${t.id}] ${t.title} (priority: ${t.priority}, status: ${t.status})`
  );
  cm.setSlot('tasks', taskLines.length > 0
    ? taskLines.join('\n')
    : '(No pending tasks)');

  log.debug('Context slots populated');
}

// ============================================================================
// Session Persistence (per-thread)
// ============================================================================

/**
 * Load the conversation session for a tick's triggering (contact, channel).
 *
 * Thread ticks (contactId + channel present): load or create the session row.
 * Inner-life ticks (no contactId): start with empty history, no write-back.
 */
export function loadSessionForTick(
  cortexAgent: CortexAgent,
  state: CortexMindState,
  contactId: string | undefined | null,
  channel: string | undefined | null,
): void {
  if (contactId && channel) {
    const session = sessionStore.getSession(getSessionsDb(), contactId, channel);

    // Restore conversation history
    if (session?.conversationHistory) {
      try {
        const messages = JSON.parse(session.conversationHistory);
        cortexAgent.restoreConversationHistory(messages);
        log.info(`Loaded thread session (${contactId}, ${channel}): ${messages.length} messages`);
      } catch (err) {
        log.warn(`Failed to parse session history for (${contactId}, ${channel}), starting fresh:`, err);
        cortexAgent.restoreConversationHistory([]);
      }
    } else {
      cortexAgent.restoreConversationHistory([]);
      log.info(`New thread session for (${contactId}, ${channel})`);
    }

    // Restore Cortex observational memory state (compaction tracking)
    if (session?.cortexObservationalState) {
      try {
        const obsState = JSON.parse(session.cortexObservationalState) as ObservationalMemoryState;
        cortexAgent.restoreObservationalMemoryState(obsState);
        log.debug(`Restored observational state for (${contactId}, ${channel})`);
      } catch (err) {
        log.warn(`Failed to restore observational state for (${contactId}, ${channel}):`, err);
      }
    }

    state.activeSession = { contactId, channel };
  } else {
    cortexAgent.restoreConversationHistory([]);
    state.activeSession = null;
    log.debug('Inner-life tick: empty history, no session persistence');
  }
}

/**
 * Save the current session back to sessions.db.
 * Called from onLoopComplete. No-op for inner-life ticks.
 */
function saveActiveSession(
  cortexAgent: CortexAgent,
  state: CortexMindState,
): void {
  if (!state.activeSession) return;

  try {
    const { contactId, channel } = state.activeSession;
    const history = cortexAgent.getConversationHistory();
    const serializedHistory = JSON.stringify(history);

    const obsState = cortexAgent.getObservationalMemoryState();
    const serializedObs = obsState ? JSON.stringify(obsState) : null;

    sessionStore.upsertSession(
      getSessionsDb(),
      contactId,
      channel,
      serializedHistory,
      serializedObs,
      history.length,
    );

    state.conversationHistoryCheckpoint = serializedHistory;
    log.info(`Session saved (${contactId}, ${channel}): ${history.length} messages`);
  } catch (err) {
    log.warn('Failed to save session:', err);
  }
}

/**
 * Restore conversation history from heartbeat_state (legacy path).
 * Used only during migration from the old single-session model.
 * Once all sessions are in sessions.db, this becomes a no-op.
 *
 * @deprecated Use loadSessionForTick instead.
 */
export function restoreConversationHistory(
  cortexAgent: CortexAgent,
): boolean {
  try {
    const hbDb = getHeartbeatDb();
    const checkpoint = heartbeatStore.getConversationHistory(hbDb);

    if (checkpoint) {
      const messages = JSON.parse(checkpoint);
      cortexAgent.restoreConversationHistory(messages);
      log.info(`Restored conversation history from legacy checkpoint (${messages.length} messages)`);
      return true;
    }

    log.info('No legacy conversation history checkpoint; starting fresh');
    return false;
  } catch (err) {
    log.warn('Failed to restore conversation history:', err);
    return false;
  }
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Destroy the CortexAgent and release resources.
 */
export async function destroyCortexMind(state: CortexMindState): Promise<void> {
  if (state.agent) {
    try {
      await state.agent.destroy();
    } catch (err) {
      log.warn('Failed to destroy CortexAgent:', err);
    }
    state.agent = null;
  }
  state.providerManager = null;
  state.model = null;
  state.initialized = false;
}
