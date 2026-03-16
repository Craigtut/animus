/**
 * Cortex Mind Session
 *
 * Replaces the old AgentManager-based mind session (mind-session.ts) with
 * a CortexAgent-based session. This is the Phase 2A heartbeat integration.
 *
 * Key differences from the old mind-session.ts:
 * - Uses CortexAgent instead of AgentManager + IAgentSession
 * - Tools are registered as direct AgentTool objects (not MCP)
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
  unwrapModel,
  type AgentTextOutput,
  type ClassifiedError,
  type CortexModel,
  type McpStdioConfig,
  type McpHttpConfig,
} from '@animus-labs/cortex';

import { getSystemDb, getHeartbeatDb, getContactsDb, getMessagesDb, getMemoryDb } from '../db/index.js';
import * as systemStore from '../db/stores/system-store.js';
import * as contactStore from '../db/stores/contact-store.js';
import * as messageStore from '../db/stores/message-store.js';
import * as memoryDbStore from '../db/stores/memory-store.js';
import * as heartbeatStore from '../db/stores/heartbeat-store.js';
import * as vaultStore from '../db/stores/vault-store.js';
import { getEventBus } from '../lib/event-bus.js';
import { createLogger } from '../lib/logger.js';
import { PROJECT_ROOT, DATA_DIR } from '../utils/env.js';
import { isBlockedPath, isBlockedCommand } from '../lib/file-deny-list.js';
import { resolveToolGate } from '../tools/tool-gate.js';
import { getToolPermission, getToolPermissions } from '../db/stores/system-store.js';
import { ANIMUS_TOOL_DEFS, type AnimusToolName } from '@animus-labs/shared';
import { executeTool } from '../tools/registry.js';
import type { ToolHandlerContext, ToolResult } from '../tools/types.js';
import type { MemoryManager } from '../memory/index.js';
import type { GatherResult } from './gather-context.js';
import { getChannelRouter } from '../channels/channel-router.js';
import { getPluginManager } from '../plugins/index.js';
import { join } from 'node:path';

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
    const conv = messageStore.getConversationByContactAndChannel(
      msgDb, gathered.contact.id, channel
    );
    if (conv) conversationId = conv.id;
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
// Build Animus Tools as AgentTool Objects
// ============================================================================

/**
 * AgentTool interface from pi-agent-core (minimal contract).
 * Defined inline to avoid hard dependency on pi-agent-core types.
 */
interface AgentTool {
  name: string;
  description: string;
  parameters: unknown; // TypeBox TSchema
  execute: (args: unknown) => Promise<unknown>;
}

/**
 * Convert Animus tool definitions + handlers into AgentTool objects
 * for registration with CortexAgent.
 *
 * Each tool wraps the existing handler from tools/handlers/ and converts
 * Zod schemas to TypeBox via zodToTypebox().
 */
function buildAnimusTools(
  toolContextRef: MutableMindToolContext,
): AgentTool[] {
  const tools: AgentTool[] = [];

  for (const [name, def] of Object.entries(ANIMUS_TOOL_DEFS)) {
    const toolName = name as AnimusToolName;

    // Check if tool is enabled (not 'off')
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

    const tool: AgentTool = {
      name: toolName,
      description: def.description,
      parameters: zodToTypebox(def.inputSchema as never),
      execute: async (args: unknown): Promise<unknown> => {
        const ctx = toolContextRef.current;
        if (!ctx) {
          return { content: [{ type: 'text', text: 'No tool context available. This is a system error.' }], isError: true };
        }

        const result: ToolResult = await executeTool(toolName, args, ctx);

        // Convert ToolResult to the format pi-agent-core expects
        if (result.isError) {
          const errorText = result.content
            .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
            .map(c => c.text)
            .join('\n');
          throw new Error(errorText || 'Tool execution failed');
        }

        return result.content
          .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
          .map(c => c.text)
          .join('\n');
      },
    };

    tools.push(tool);
  }

  log.info(`Built ${tools.length} Animus tools as AgentTool objects`);
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
): Promise<CortexAgent> {
  // If already created, return existing
  if (state.agent) {
    return state.agent;
  }

  // Initialize ProviderManager
  state.providerManager = new ProviderManager();

  // Read provider/model settings from system_settings
  const sysDb = getSystemDb();
  const settings = systemStore.getSystemSettings(sysDb);

  // Determine provider and model
  // Use cortex-specific settings if available, fall back to legacy settings.
  // The cortex fields will be added to SystemSettings in a future migration.
  const settingsAny = settings as Record<string, unknown>;
  const provider = (settingsAny['cortexProvider'] as string | undefined) ?? settings.defaultAgentProvider ?? 'anthropic';
  const modelId = (settingsAny['cortexModel'] as string | undefined) ?? settings.defaultModel ?? 'claude-sonnet-4-20250514';

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

  // Build tools
  const animusTools = buildAnimusTools(state.toolContext);

  // Build permission resolver
  const permissionResolver = buildPermissionResolver(state.toolContext);

  // Use CortexAgent.create() factory to construct the pi-agent-core Agent
  // internally, eliminating the need to import pi-agent-core in the backend.
  const piModel = unwrapModel(model);

  const cortexAgent = await CortexAgent.create({
    model: piModel,
    workingDirectory: join(DATA_DIR, 'workspace'),
    getApiKey,
    slots: [...MIND_SLOT_NAMES],
    workingTags: { enabled: true },
    budgetGuard: {
      maxTurns: (settingsAny['cortexMaxTurns'] as number | undefined) ?? 50,
      maxCost: (settingsAny['cortexMaxCostPerTick'] as number | undefined) ?? 1.0,
    },
    resolvePermission: permissionResolver,
    tools: animusTools,
    systemPrompt: '', // Set later via buildSystemPrompt
  });

  // Wire event handlers
  wireEventHandlers(cortexAgent, state);

  // Wire EventBus listeners for provider changes from settings UI
  wireProviderChangeListeners(cortexAgent, state);

  // Wire plugin lifecycle listeners for dynamic MCP connections
  wirePluginLifecycleListeners(cortexAgent);

  // Connect to plugin MCP servers (non-blocking; failures logged but don't prevent startup)
  connectPluginMcpServers(cortexAgent).catch(err => {
    log.warn('Error connecting initial plugin MCP servers:', err);
  });

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

  // Checkpoint conversation history after each agentic loop
  cortexAgent.onLoopComplete(() => {
    try {
      const history = cortexAgent.getConversationHistory();
      const serialized = JSON.stringify(history);
      const hbDb = getHeartbeatDb();
      heartbeatStore.updateConversationHistory(hbDb, serialized);
      state.conversationHistoryCheckpoint = serialized;
      log.info(`Conversation history checkpointed (${history.length} messages)`);
    } catch (err) {
      log.warn('Failed to checkpoint conversation history:', err);
    }
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

  // Log turn completions
  cortexAgent.onTurnComplete((output: AgentTextOutput) => {
    if (output.userFacing) {
      const preview = output.userFacing.length > 120
        ? output.userFacing.substring(0, 120) + '...'
        : output.userFacing;
      log.info(`Turn complete: "${preview}"`);
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
      const piModel = unwrapModel(newModel);
      cortexAgent.setModel(piModel);
      log.info(`CortexAgent model updated to ${provider}/${modelId}`);
    } catch (err) {
      log.error('Failed to switch model:', err);
    }
  });

  eventBus.on('cortex:thinking-level-changed', ({ level }) => {
    log.info(`Thinking level changed to "${level}"`);
    cortexAgent.setThinkingLevel(level);
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
        await mcpManager.connect(namespacedKey, transportConfig);
      }
    } catch (err) {
      log.warn(`Failed to connect plugin MCP server "${namespacedKey}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Merge MCP-discovered tools with built-in tools on the agent
  cortexAgent.refreshTools();
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
 * Dynamically connects/disconnects MCP servers as plugins are installed/removed.
 */
function wirePluginLifecycleListeners(cortexAgent: CortexAgent): void {
  const eventBus = getEventBus();
  const mcpManager = cortexAgent.getMcpClientManager();

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
            await mcpManager.connect(namespacedKey, transportConfig);
          }
        } catch (err) {
          log.warn(`Failed to connect plugin MCP server "${namespacedKey}" on ${action}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } else if (action === 'uninstalled' || action === 'disabled') {
      // Disconnect all MCP servers belonging to this plugin
      const states = mcpManager.getConnectionStates();
      for (const connState of states) {
        if (connState.serverName.startsWith(`${pluginName}__`)) {
          try {
            log.info(`Disconnecting plugin MCP server: ${connState.serverName}`);
            await mcpManager.disconnect(connState.serverName);
          } catch (err) {
            log.warn(`Failed to disconnect plugin MCP server "${connState.serverName}" on ${action}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    }

    // Re-merge tools after MCP connections changed
    cortexAgent.refreshTools();

    // Rebuild system prompt so the LLM sees updated tool/plugin context
    rebuildSystemPromptForPluginChange(cortexAgent);
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
          await mcpManager.disconnect(state.serverName);
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
          await mcpManager.connect(namespacedKey, transportConfig);
        }
      } catch (err) {
        log.warn(`Failed to reconnect plugin MCP server "${namespacedKey}" after config update: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Re-merge tools after MCP reconnection
    cortexAgent.refreshTools();

    // Rebuild system prompt so the LLM sees updated tool/plugin context
    rebuildSystemPromptForPluginChange(cortexAgent);
  });
}

/**
 * Rebuild the system prompt after plugin changes.
 *
 * Plugin install/uninstall/config changes may affect the tool list
 * visible to the LLM. The system prompt includes tool descriptions,
 * so it must be rebuilt when the available tools change.
 *
 * Uses the current system prompt's consumer content (everything before
 * the Cortex operational sections) to rebuild without losing persona
 * or domain context.
 */
function rebuildSystemPromptForPluginChange(cortexAgent: CortexAgent): void {
  try {
    // The current system prompt starts with consumer content followed by
    // Cortex operational sections. rebuildSystemPrompt extracts the consumer
    // portion. Since we don't have direct access to the original consumer
    // prompt, we trigger a rebuild with the existing content. The consumer
    // (pipeline) sets the system prompt during GATHER; between ticks, we
    // re-trigger buildSystemPrompt with the last known consumer prompt.
    // For now, we use the fact that rebuildSystemPrompt will re-append the
    // operational sections (which include tool listings).
    const currentPrompt = cortexAgent.getCurrentSystemPrompt();
    if (currentPrompt) {
      // Find the first Cortex operational section marker
      const sectionMarker = '# Response Delivery';
      const systemRulesMarker = '# System Rules';
      let splitIdx = currentPrompt.indexOf(sectionMarker);
      if (splitIdx < 0) {
        splitIdx = currentPrompt.indexOf(systemRulesMarker);
      }
      if (splitIdx > 0) {
        // Extract consumer content (everything before the first Cortex section)
        const consumerPrompt = currentPrompt.substring(0, splitIdx).trimEnd();
        cortexAgent.rebuildSystemPrompt(consumerPrompt);
        log.debug('System prompt rebuilt after plugin change');
      }
    }
  } catch (err) {
    log.warn('Failed to rebuild system prompt after plugin change:', err);
  }
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
// Session Persistence
// ============================================================================

/**
 * Restore conversation history from the last checkpoint.
 * Called on startup/restart.
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
      log.info(`Restored conversation history from checkpoint (${messages.length} messages)`);
      return true;
    }

    log.info('No conversation history checkpoint found; starting fresh');
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
