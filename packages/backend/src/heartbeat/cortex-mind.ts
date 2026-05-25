/**
 * Cortex Mind Session
 *
 * CortexAgent lifecycle, context slot management, session persistence,
 * tool/plugin wiring, and permission resolution for the heartbeat mind.
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
  type AgentMessage,
  resolveCacheRetention,
  type ThinkingLevel,
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
import { getChannelManager } from '../channels/channel-manager.js';
import { getPluginManager } from '../plugins/index.js';
import { getEnvironmentService } from '../services/environment-service.js';
import {
  SETUP_ENVIRONMENT_SKILL_NAME,
  SETUP_ENVIRONMENT_SKILL_MD,
} from './builtin-skills/setup-environment-skill.js';
import { z } from 'zod/v3';
import { join } from 'node:path';
import { createToolResultPersistor, cleanupDereferencedPaths } from './tool-result-persistor.js';
import { buildTaskContextSection, formatTimestamp } from './context-builder.js';
import { buildCortexEnvOverrides } from './cortex-env.js';
import { getSessionsDb } from '../db/index.js';
import * as sessionStore from '../db/stores/session-store.js';

const log = createLogger('CortexMind', 'heartbeat');
const cortexLog = createLogger('Cortex', 'heartbeat');

function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function extractMessageContent(message: AgentMessage): string {
  if (typeof message.content === 'string') return message.content;
  return JSON.stringify(message.content);
}

function estimateMessageTokens(messages: AgentMessage[]): number {
  return estimateTextTokens(messages.map(extractMessageContent).join('\n'));
}

function emptyObservationalMemoryState(): ObservationalMemoryState {
  return {
    observations: '',
    continuationHint: null,
    observationTokenCount: 0,
    generationCount: 0,
    bufferedChunks: [],
  };
}

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
  'recent-messages',
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
 * Map a runtime MCP tool name back to its server-level permission key.
 *
 * Cortex names plugin MCP tools `<namespacedKey>__<mcpToolName>`, where
 * `namespacedKey` is `<plugin>__<server>` (see mcp-client.ts `wrapMcpTool`).
 * The permission seeder, however, creates one row per MCP *server*, keyed
 * `mcp__<namespacedKey>` (see index.ts `collectPluginTools`). Without this
 * bridge the exact-name lookup always misses for MCP tools, so "ask"/"off"
 * modes are never enforced for plugin tools.
 *
 * Given a runtime tool name and the list of connected MCP server keys,
 * returns the seeded permKey (`mcp__<namespacedKey>`) for the longest
 * matching server, or null if the tool is not an MCP tool from a known
 * server. Longest-match handles servers whose keys share a prefix.
 */
export function resolveMcpPermKey(
  toolName: string,
  mcpServerKeys: string[],
): string | null {
  let best: string | null = null;
  for (const namespacedKey of mcpServerKeys) {
    if (toolName === namespacedKey || toolName.startsWith(`${namespacedKey}__`)) {
      if (best === null || namespacedKey.length > best.length) best = namespacedKey;
    }
  }
  return best ? `mcp__${best}` : null;
}

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
    if (['Read', 'Write', 'Edit', 'UndoEdit'].includes(toolName)) {
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

    // Look up permission record. Plugin MCP tools are seeded per-server with
    // an `mcp__<plugin>__<server>` key, but Cortex calls them by their
    // per-tool runtime name (`<plugin>__<server>__<tool>`). When the exact
    // lookup misses, map the runtime name back to its server-level permKey
    // so "ask"/"off" modes are actually enforced for MCP tools.
    const sysDb = getSystemDb();
    let permKey = toolName;
    let permission = getToolPermission(sysDb, permKey);

    if (!permission) {
      let mcpServerKeys: string[] = [];
      try {
        mcpServerKeys = Object.keys(getPluginManager().getMcpConfigs());
      } catch {
        // Plugin manager not ready; fall through to the fail-safe gate.
      }
      const serverPermKey = resolveMcpPermKey(toolName, mcpServerKeys);
      if (serverPermKey) {
        // It is an MCP tool from a connected server. Prefer a per-tool
        // row (`mcp__<plugin>__<server>__<tool>`), then fall back to the
        // server-level row (`mcp__<plugin>__<server>`).
        const perToolKey = `mcp__${toolName}`;
        const perToolPerm = getToolPermission(sysDb, perToolKey);
        if (perToolPerm) {
          permKey = perToolKey;
          permission = perToolPerm;
        } else {
          permKey = serverPermKey;
          permission = getToolPermission(sysDb, permKey);
        }
      }
    }

    const ctx = toolContextRef.current;

    // No permission record even after MCP mapping. Fail safe: route through
    // the approval gate ("ask") rather than silently allowing. The seeder
    // covers core, built-in, and plugin tools, so a genuine miss is rare;
    // treating the unknown as ask surfaces any future key mismatch instead
    // of hiding it (this was the original MCP permission-bypass bug).
    if (!permission) {
      log.warn(`No permission record for "${toolName}" (permKey=${permKey}); defaulting to ask`);
      const fallback = resolveToolGate({
        heartbeatDb: getHeartbeatDb(),
        permKey,
        mode: 'ask',
        displayName: toolName,
        toolSource: 'unknown',
        contactId: ctx?.contactId ?? '',
        sourceChannel: ctx?.sourceChannel ?? 'web',
        conversationId: ctx?.conversationId ?? '',
        toolName,
        toolInput: args,
        originatingAgent: 'mind',
        eventBus: ctx?.eventBus ?? getEventBus(),
      });
      return fallback.action === 'allow';
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
    const result = resolveToolGate({
      heartbeatDb: getHeartbeatDb(),
      permKey,
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
 * Narrow a tool's dynamic `channel` field to an enum of the given channels.
 *
 * The shared tool definitions declare `channel` as a dynamic string because the
 * channel set is not known at authoring time (packages add new types). The
 * backend owns the channel registry, so here we narrow that field to an enum of
 * the channels actually installed on this instance. This is what tells the
 * model which channels are real (e.g. `web`, `slack`) instead of a stale
 * hardcoded list.
 *
 * Pure: callers pass the live channel set (see `getChannelManager().getChannelTypes()`).
 * Generic by design: any tool whose top-level schema has a `channel` field gets
 * the enum, preserving the field's optionality and description. If `channels` is
 * empty (should not happen — `web` is always built in) the schema is returned
 * unchanged so we never produce an invalid empty enum.
 */
export function injectChannelEnum(
  schema: z.ZodTypeAny,
  channels: readonly string[],
): z.ZodTypeAny {
  if (!(schema instanceof z.ZodObject)) return schema;

  const shape = schema.shape as Record<string, z.ZodTypeAny>;
  const field = shape['channel'];
  if (!field) return schema;
  if (channels.length === 0) return schema;

  const description = field.description;
  const isOptional = field.isOptional();

  // Build outermost-last so the description sits on the wrapper, matching how
  // the original definitions were authored (and what zodToTypebox reads).
  let channelField: z.ZodTypeAny = z.enum(channels as [string, ...string[]]);
  if (isOptional) channelField = channelField.optional();
  if (description) channelField = channelField.describe(description);

  return schema.extend({ channel: channelField });
}

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
    const channels = getChannelManager().getChannelTypes();
    parameters = await zodToTypebox(injectChannelEnum(def.inputSchema, channels) as never);
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

/** Whether a tool is turned off via the tool-permission settings. */
function isToolDisabled(toolName: AnimusToolName): boolean {
  try {
    const sysDb = getSystemDb();
    const perm = getToolPermission(sysDb, toolName);
    return perm?.mode === 'off';
  } catch {
    // DB not ready yet; treat as enabled.
    return false;
  }
}

/** Tool names whose schema declares a dynamic `channel` field. */
function channelDependentToolNames(): AnimusToolName[] {
  return (Object.keys(ANIMUS_TOOL_DEFS) as AnimusToolName[]).filter((name) => {
    const schema = ANIMUS_TOOL_DEFS[name].inputSchema;
    return schema instanceof z.ZodObject && 'channel' in schema.shape;
  });
}

async function buildAnimusTools(
  toolContextRef: MutableMindToolContext,
): Promise<CortexTool[]> {
  const tools: CortexTool[] = [];

  for (const [name] of Object.entries(ANIMUS_TOOL_DEFS)) {
    const toolName = name as AnimusToolName;

    if (isToolDisabled(toolName)) {
      log.debug(`Skipping disabled tool: ${toolName}`);
      continue;
    }

    const tool = await buildSingleAnimusTool(toolName, toolContextRef);
    if (tool) tools.push(tool);
  }

  log.info(`Built ${tools.length} Animus tools as CortexTool objects`);
  return tools;
}

/**
 * Hot-swap the channel-dependent tools on a live mind agent so their `channel`
 * enum reflects the currently-installed channels. Channels install/uninstall at
 * runtime (no engine restart), but the agent caches its tool set for its whole
 * lifetime, so without this the model keeps seeing the channel set from when the
 * agent was first built. Wired to `channel:installed` / `channel:uninstalled`
 * in AgentSubsystem.
 *
 * No-op when the agent has not been created yet — the next createCortexMind()
 * build reads the live channel set anyway.
 */
export async function refreshChannelDependentTools(
  state: CortexMindState,
): Promise<void> {
  const agent = state.agent;
  if (!agent) return;

  for (const toolName of channelDependentToolNames()) {
    if (isToolDisabled(toolName)) {
      agent.removeConsumerTool(toolName);
      continue;
    }
    const tool = await buildSingleAnimusTool(toolName, state.toolContext);
    if (tool) agent.addConsumerTool(tool);
  }

  log.info('Refreshed channel-dependent mind tools after channel change');
}

// ============================================================================
// Create CortexAgent for Mind
// ============================================================================

/**
 * Create and configure a CortexAgent instance for the mind session.
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
  const envOverrides = buildCortexEnvOverrides();

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
  // Built-in tools (Read, Write, Edit, UndoEdit, Glob, Grep, Bash, WebFetch, TaskOutput)
  // are auto-registered by Cortex using workingDirectory.
  // Build recall config if message embedder is available
  const messageEmbedder = options?.messageEmbedder;
  const recallConfig = messageEmbedder?.isReady()
    ? {
        search: (
          query: string,
          options?: { timeRange?: { start?: Date; end?: Date } },
        ) => {
          const searchOptions: import('../memory/message-embedder.js').MessageRecallSearchOptions = {};
          const contactId = state.activeSession?.contactId || state.toolContext.current?.contactId || undefined;
          const channel = state.activeSession?.channel || state.toolContext.current?.sourceChannel || undefined;

          if (options?.timeRange) searchOptions.timeRange = options.timeRange;
          if (contactId) searchOptions.contactId = contactId;
          if (channel) searchOptions.channel = channel;

          return messageEmbedder.search(query, searchOptions);
        },
      }
    : undefined;

  const cortexDiagnostics = settingsAny['cortexDiagnostics'] === true;
  const savedThinkingLevel = (settingsAny['cortexThinkingLevel'] as string | undefined) ?? 'high';

  // Resolve the utility model (thought/reflect/WebFetch summarization/safety).
  // 'default' lets Cortex programmatically infer the recommended fast model
  // for this provider (Cortex 0.2.3 inferUtilityModel).
  const utilityModelConfig = await resolveUtilityModelConfig(
    state,
    provider,
    settingsAny['utilityModel'] as string | undefined | null,
  );
  log.info(
    `Utility model: ${utilityModelConfig === 'default' ? 'default (auto-inferred)' : utilityModelConfig.modelId}`,
  );

  const cortexAgent = await CortexAgent.create({
    model,
    utilityModel: utilityModelConfig,
    workingDirectory: workingDir,
    getApiKey,
    slots: [...MIND_SLOT_NAMES],
    thinkingLevel: savedThinkingLevel as ThinkingLevel,
    workingTags: { enabled: true },
    logger: cortexLog,
    contextWindowLimit: (settingsAny['cortexContextWindowLimit'] as number | null | undefined) ?? null,
    resolvePermission: permissionResolver,
    tools: animusTools,
    ...(envOverrides ? { envOverrides } : {}),
    persistResult,
    ...(recallConfig ? { compaction: { observational: { recall: recallConfig } } } : {}),
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

  // Load built-in skills (always available, not tied to any plugin)
  loadBuiltInSkillsAtStartup(cortexAgent);

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
    const message = `CortexAgent error: ${classified.category} (${classified.severity}): ${classified.originalMessage}`;

    if (classified.category === 'cancelled') {
      log.info(`CortexAgent cancelled: ${classified.originalMessage}`);
      return;
    }

    if (classified.severity === 'retry' || classified.severity === 'recoverable') {
      log.warn(message);
    } else {
      log.error(message);
    }

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
    logCortexObservationEvent(cortexAgent, eventBus, event);
    saveActiveSession(cortexAgent, state);

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

  cortexAgent.onReflection((event) => {
    logCortexReflectionEvent(eventBus, event);
    saveActiveSession(cortexAgent, state);
  });

  // Wire compaction error handler and debug logging
  wireCompactionHandlers(cortexAgent);
}

function insertLatestCompactionEvent(
  eventBus: ReturnType<typeof getEventBus>,
  data: Record<string, unknown>,
): void {
  try {
    const agentLogsDb = getAgentLogsDb();
    const { sessions } = agentLogStore.listSessions(agentLogsDb, { limit: 1 });
    const latest = sessions[0];
    if (!latest) return;

    const event = agentLogStore.insertEvent(agentLogsDb, {
      sessionId: latest.id,
      eventType: 'compaction',
      data,
    });

    eventBus.emit('agent:event:logged', {
      id: event.id,
      sessionId: event.sessionId,
      eventType: event.eventType,
      data: event.data,
      createdAt: event.createdAt,
    });
  } catch (err) {
    log.warn('Failed to log Cortex compaction event:', err);
  }
}

function logCortexObservationEvent(
  cortexAgent: CortexAgent,
  eventBus: ReturnType<typeof getEventBus>,
  event: {
    compactedMessages: AgentMessage[];
    observations: string;
    contextUtilization: number;
    sync: boolean;
    timestamp: Date;
  },
): void {
  insertLatestCompactionEvent(eventBus, {
    kind: 'observation',
    strategy: 'observational',
    messagesCompacted: event.compactedMessages.length,
    compactedMessageTokens: estimateMessageTokens(event.compactedMessages),
    observationTokens: estimateTextTokens(event.observations),
    contextUtilization: event.contextUtilization,
    sync: event.sync,
    historyMessagesRemaining: cortexAgent.getConversationHistory().length,
    timestamp: event.timestamp.toISOString(),
  });
}

function logCortexReflectionEvent(
  eventBus: ReturnType<typeof getEventBus>,
  event: {
    previousObservations: string;
    newObservations: string;
    generationCount: number;
    compressionLevel: number;
    timestamp: Date;
  },
): void {
  const tokensBefore = estimateTextTokens(event.previousObservations);
  const tokensAfter = estimateTextTokens(event.newObservations);

  insertLatestCompactionEvent(eventBus, {
    kind: 'reflection',
    strategy: 'observational',
    tokensBefore,
    tokensAfter,
    generationCount: event.generationCount,
    compressionLevel: event.compressionLevel,
    timestamp: event.timestamp.toISOString(),
  });
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
  cortexAgent.onCompactionError((error: Error) => {
    log.error('Compaction failed:', error);

    // Best-effort: log to the most recent per-tick session (compaction runs
    // during the agentic loop, so the current tick's session is the newest).
    try {
      const agentLogsDb = getAgentLogsDb();
      const { sessions } = agentLogStore.listSessions(agentLogsDb, { limit: 1 });
      const latest = sessions[0];
      if (latest) {
        agentLogStore.insertEvent(agentLogsDb, {
          sessionId: latest.id,
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
// Utility Model Resolution
// ============================================================================

/**
 * Resolve the utility model config to pass to / apply on a CortexAgent.
 *
 * - `'default'` (or unset) -> Cortex programmatically infers the recommended
 *   fast model for the provider (Cortex 0.2.3 inferUtilityModel).
 * - An explicit model id -> resolved to a CortexModel for that provider.
 *   The id must belong to `provider`; on any failure we fall back to
 *   `'default'` so a stale/invalid setting never breaks the agent.
 */
async function resolveUtilityModelConfig(
  state: CortexMindState,
  provider: string,
  utilityModelSetting: string | undefined | null,
): Promise<CortexModel | 'default'> {
  const setting = (utilityModelSetting ?? '').trim();
  if (!setting || setting === 'default' || setting === 'recommended') {
    return 'default';
  }
  if (!state.providerManager) return 'default';
  try {
    return await state.providerManager.resolveModel(provider, setting);
  } catch (err) {
    log.warn(
      `Failed to resolve utility model "${setting}" for provider "${provider}"; using recommended:`,
      err,
    );
    return 'default';
  }
}

/**
 * Apply the current utility-model setting to a live CortexAgent.
 * Reads the freshest setting/provider so it is correct even after a
 * provider switch (where a stale explicit id would belong to the old
 * provider and must degrade to the recommended model).
 */
async function applyUtilityModel(
  cortexAgent: CortexAgent,
  state: CortexMindState,
): Promise<void> {
  const sysDb = getSystemDb();
  const settingsAny = systemStore.getSystemSettings(sysDb) as Record<string, unknown>;
  const provider = settingsAny['cortexProvider'] as string | undefined | null;
  if (!provider) return;

  const config = await resolveUtilityModelConfig(
    state,
    provider,
    settingsAny['utilityModel'] as string | undefined | null,
  );

  if (config === 'default') {
    cortexAgent.resetUtilityModel();
    log.info('Utility model: default (auto-inferred)');
  } else {
    cortexAgent.setUtilityModel(config);
    log.info(`Utility model: ${config.modelId}`);
  }
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
      const settings = systemStore.getSystemSettings(getSystemDb());
      const cacheRetention = resolveCacheRetention(provider, settings.heartbeatIntervalMs);
      cortexAgent.setCacheRetention(cacheRetention);
      // The utility model is provider-scoped; re-resolve it for the new
      // provider so an explicit selection from the old provider does not
      // leak across (it degrades to the recommended model).
      await applyUtilityModel(cortexAgent, state);
      log.info(`CortexAgent model updated to ${provider}/${modelId} (cache=${cacheRetention})`);
    } catch (err) {
      log.error('Failed to switch model:', err);
    }
  });

  eventBus.on('cortex:utility-model-changed', async ({ utilityModel }) => {
    try {
      log.info(`Utility model changed to "${utilityModel}", updating CortexAgent`);
      await applyUtilityModel(cortexAgent, state);
    } catch (err) {
      log.error('Failed to switch utility model:', err);
    }
  });

  eventBus.on('cortex:thinking-level-changed', ({ level }) => {
    log.info(`Thinking level changed to "${level}"`);
    cortexAgent.setThinkingLevel(level as ThinkingLevel);
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

    // Null out the agent so the heartbeat skips mind queries
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
  mcpManager.logger = {
    info: (msg: string) => log.info(`[MCP] ${msg}`),
    warn: (msg: string) => log.warn(`[MCP] ${msg}`),
    error: (msg: string) => log.error(`[MCP] ${msg}`),
    debug: (msg: string) => log.debug(`[MCP] ${msg}`),
  };

  const removePluginSkillsFromRegistry = (pluginName: string): void => {
    const source = `plugin:${pluginName}`;
    for (const entry of skillRegistry.getAll()) {
      if (entry.source === source) {
        skillRegistry.removeSkill(entry.name);
        log.info(`Removed plugin skill: ${entry.name} (${source})`);
      }
    }
  };

  eventBus.on('plugin:changed', async ({ pluginName, action }) => {
    const pluginManager = getPluginManager();
    if (!pluginManager) return;

    if (action === 'installed' || action === 'enabled') {
      // Clear any stale skills for this plugin first. This handles upgrades
      // where a plugin renames or removes skills.
      removePluginSkillsFromRegistry(pluginName);

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

      removePluginSkillsFromRegistry(pluginName);
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
/**
 * Materialize and register the built-in skills with the SkillRegistry.
 *
 * Built-in skills ship as backend source strings (no plugin, no DB rows).
 * Their SKILL.md is written into the agent-env skills directory and registered
 * with `${AGENT_ENV}` resolved to the agent-env root, so the entity can act on
 * the install paths the skill references.
 */
function loadBuiltInSkillsAtStartup(cortexAgent: CortexAgent): void {
  try {
    const envService = getEnvironmentService();
    const skillRegistry = cortexAgent.getSkillRegistry();
    const skillPath = envService.materializeSkill(
      SETUP_ENVIRONMENT_SKILL_NAME,
      SETUP_ENVIRONMENT_SKILL_MD,
    );
    skillRegistry.addSkill({
      path: skillPath,
      source: 'builtin',
      variables: { AGENT_ENV: envService.rootDir },
    });
    log.info('Loaded built-in setup-environment skill into SkillRegistry');
  } catch (err) {
    log.warn('Failed to load built-in skills:', err);
  }
}

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
 * Populate all 10 context slots from the gathered context.
 * Called during GATHER phase and on startup.
 */
export function populateContextSlots(
  cortexAgent: CortexAgent,
  gathered: GatherResult,
): void {
  const cm = cortexAgent.getContextManager();

  // Slot 0: credentials
  if (gathered.credentialManifest) {
    cm.setSlot('credentials',
      '── AVAILABLE CREDENTIALS ──\n' +
      'These credentials are stored securely. Use run_with_credentials to\n' +
      'execute commands that need them. Reference by ref name -- you never\n' +
      'see the actual values.\n\n' +
      gathered.credentialManifest +
      '\n\nUsage: run_with_credentials({ command, credentialRef, envVar })',
    );
  } else {
    cm.setSlot('credentials', '(No credentials configured)');
  }

  // Slot 1: contacts
  const contactLines: string[] = ['── YOUR CONTACTS ──'];
  for (const { contact, channels } of gathered.contacts) {
    const channelList = channels.map(ch => ch.channel).join(', ');
    let line = `${contact.fullName} [id: ${contact.id}] - ${contact.permissionTier}`;
    if (channelList) line += ` - reachable via: ${channelList}`;
    if (contact.notes) line += `\n  ${contact.notes}`;
    contactLines.push(line);
  }
  if (gathered.contacts.length > 0) {
    contactLines.push(
      '',
      'These are real people. Do not fabricate actions or dialogue for them',
      'in your experience narrative.',
    );
    cm.setSlot('contacts', contactLines.join('\n'));
  } else {
    cm.setSlot('contacts', '(No contacts yet)');
  }

  // Slot 2: core-self
  const coreSelf = gathered.memoryContext?.coreSelfSection ?? null;
  cm.setSlot('core-self', coreSelf
    ? '── CORE SELF ──\n' + coreSelf
    : '(No self-knowledge accumulated yet)');

  // Slot 3: working-memory
  const workingMemory = gathered.memoryContext?.workingMemorySection ?? null;
  const wmLabel = gathered.contact?.fullName ? ` (${gathered.contact.fullName})` : '';
  cm.setSlot('working-memory', workingMemory
    ? `── WORKING MEMORY${wmLabel} ──\n` + workingMemory
    : '(No working memory for this contact)');

  // Slot 4: thought-observations
  const thoughtObs = gathered.thoughtContext?.observations?.content ?? null;
  cm.setSlot('thought-observations', thoughtObs
    ? '── THOUGHT OBSERVATIONS ──\n' + thoughtObs
    : '');

  // Slot 5: experience-observations
  const experienceObs = gathered.experienceContext?.observations?.content ?? null;
  cm.setSlot('experience-observations', experienceObs
    ? '── EXPERIENCE OBSERVATIONS ──\n' + experienceObs
    : '');

  // Slot 6: recent-messages (interval ticks only; message ticks use ephemeral)
  if (!gathered.contact && gathered.recentMessages.length > 0) {
    const tz = gathered.aiTimezone || 'UTC';
    const contactNameMap = new Map<string, string>();
    for (const { contact } of gathered.contacts) {
      contactNameMap.set(contact.id, contact.fullName);
    }

    const groups = new Map<string, typeof gathered.recentMessages>();
    const chronological = [...gathered.recentMessages].reverse();
    for (const m of chronological) {
      const key = `${m.contactId}:${m.channel}`;
      let group = groups.get(key);
      if (!group) { group = []; groups.set(key, group); }
      group.push(m);
    }

    const parts: string[] = [
      '── RECENT CONVERSATIONS ──',
      'These are recent messages exchanged with your contacts.',
    ];
    for (const [, msgs] of groups) {
      if (msgs.length === 0) continue;
      const first = msgs[0]!;
      const name = contactNameMap.get(first.contactId) || 'Unknown';
      parts.push('');
      parts.push(`With ${name} (via ${first.channel}):`);
      for (const m of msgs) {
        const ts = formatTimestamp(m.createdAt, tz);
        const sender = m.direction === 'inbound' ? name : 'You';
        parts.push(`  [${ts}] ${sender}: "${m.content}"`);
      }
    }
    cm.setSlot('recent-messages', parts.join('\n'));
  } else {
    cm.setSlot('recent-messages', '');
  }

  // Slot 7: message-observations
  const messageObs = gathered.messageContext?.observations?.content ?? null;
  cm.setSlot('message-observations', messageObs
    ? '── MESSAGE OBSERVATIONS ──\n' + messageObs
    : '');

  // Slot 8: goals
  const goalParts: string[] = [];
  if (gathered.goalContext?.goalSection) {
    goalParts.push(
      '── THINGS ON YOUR MIND ──\n' +
      'These are things you care about. They\'re part of who you are,\n' +
      'but they don\'t control you. You may advance them, reflect on\n' +
      'them, or set them aside entirely.\n\n' +
      gathered.goalContext.goalSection,
    );
  }
  if (gathered.goalContext?.proposedGoalsSection) {
    goalParts.push('── PENDING GOALS ──\n' + gathered.goalContext.proposedGoalsSection);
  }
  if (gathered.goalContext?.planningPromptsSection) {
    goalParts.push(gathered.goalContext.planningPromptsSection);
  }
  cm.setSlot('goals', goalParts.length > 0
    ? goalParts.join('\n\n')
    : '(No active goals)');

  // Slot 8: tasks
  cm.setSlot('tasks', gathered.deferredTasks.length > 0
    ? buildTaskContextSection(gathered.deferredTasks, gathered.taskJournals)
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

    // Restore Cortex observational memory state (compaction tracking).
    // If the row has no saved state, explicitly reset it so observations from
    // the previously active thread cannot leak into this one.
    let restoredObservationalState = false;
    if (session?.cortexObservationalState) {
      try {
        const obsState = JSON.parse(session.cortexObservationalState) as ObservationalMemoryState;
        cortexAgent.restoreObservationalMemoryState(obsState);
        restoredObservationalState = true;
        log.debug(`Restored observational state for (${contactId}, ${channel})`);
      } catch (err) {
        log.warn(`Failed to restore observational state for (${contactId}, ${channel}):`, err);
      }
    }

    if (!restoredObservationalState) {
      cortexAgent.restoreObservationalMemoryState(emptyObservationalMemoryState());
      log.debug(`Reset observational state for (${contactId}, ${channel})`);
    }

    state.activeSession = { contactId, channel };
  } else {
    cortexAgent.restoreConversationHistory([]);
    cortexAgent.restoreObservationalMemoryState(emptyObservationalMemoryState());
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
      estimateMessageTokens(history),
    );

    log.info(`Session saved (${contactId}, ${channel}): ${history.length} messages`);
  } catch (err) {
    log.warn('Failed to save session:', err);
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
}
