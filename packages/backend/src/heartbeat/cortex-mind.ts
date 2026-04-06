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
  type AgentTextOutput,
  type CortexEvent,
  type ClassifiedError,
  type CompactionTarget,
  type CompactionResult,
  type CortexModel,
  type McpStdioConfig,
  type McpHttpConfig,
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
import { processAllStreams } from '../memory/observational-memory/index.js';
import { OBSERVATIONAL_MEMORY_CONFIG } from '../config/observational-memory.config.js';
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
  /** Mutable reference to the current tick's gathered context (for compaction handlers) */
  compactionContext: MutableCompactionContext;
}

export interface MutableMindToolContext {
  current: ToolHandlerContext | null;
}

/**
 * Mutable reference to per-tick data needed by compaction handlers.
 * Updated at the start of each cortexMindQuery; cleared after.
 * The onBeforeCompaction / onPostCompaction callbacks are registered once
 * at agent creation but need access to the current tick's data.
 */
export interface MutableCompactionContext {
  gathered: GatherResult | null;
  completeFn: ((context: { systemPrompt: string; messages: Array<{ role: string; content: string }> }) => Promise<string>) | null;
  compiledPersona: string | null;
}

export function createCortexMindState(): CortexMindState {
  return {
    agent: null,
    providerManager: null,
    model: null,
    toolContext: { current: null },
    initialized: false,
    conversationHistoryCheckpoint: null,
    compactionContext: { gathered: null, completeFn: null, compiledPersona: null },
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
// Build Animus Tools as AgentTool Objects
// ============================================================================

/**
 * AgentTool interface from pi-agent-core (minimal contract).
 * Defined inline to avoid hard dependency on pi-agent-core types.
 *
 * IMPORTANT: pi-agent-core calls execute(toolCallId, params, signal?, onUpdate?)
 * where params is the validated arguments object, NOT the first parameter.
 */
interface AgentToolResult {
  content: Array<{ type: string; text: string }>;
  details?: unknown;
}

interface AgentTool {
  name: string;
  label?: string;
  description: string;
  parameters: unknown; // TypeBox TSchema
  execute: (toolCallId: string, params: unknown, signal?: AbortSignal) => Promise<AgentToolResult>;
}

/**
 * Convert Animus tool definitions + handlers into AgentTool objects
 * for registration with CortexAgent.
 *
 * Each tool wraps the existing handler from tools/handlers/ and converts
 * Zod schemas to TypeBox via zodToTypebox().
 */
async function buildAnimusTools(
  toolContextRef: MutableMindToolContext,
): Promise<AgentTool[]> {
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

    let parameters;
    try {
      parameters = await zodToTypebox(def.inputSchema as never);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to convert schema for tool '${toolName}': ${msg}`);
    }

    const tool: AgentTool = {
      name: toolName,
      label: toolName,
      description: def.description,
      parameters,
      // pi-agent-core calls: execute(toolCallId, params, signal?, onUpdate?)
      // params is the validated arguments object (2nd parameter)
      execute: async (_toolCallId: string, params: unknown): Promise<AgentToolResult> => {
        const ctx = toolContextRef.current;
        if (!ctx) {
          throw new Error('No tool context available. This is a system error.');
        }

        const result: ToolResult = await executeTool(toolName, params, ctx);

        // Convert ToolResult to the format pi-agent-core expects
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

  // Use CortexAgent.create() factory to construct the pi-agent-core Agent
  // internally, eliminating the need to import pi-agent-core in the backend.
  // Built-in tools (Read, Write, Edit, Glob, Grep, Bash, WebFetch, TaskOutput)
  // are auto-registered by Cortex using workingDirectory.
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

  // Wire compaction lifecycle handlers (Items 2, 3, 4 from integration audit)
  wireCompactionHandlers(cortexAgent, state);
}

// ============================================================================
// Compaction Lifecycle Handlers
// ============================================================================

/**
 * Wire onBeforeCompaction, onPostCompaction, and onCompactionError handlers.
 *
 * These handlers use mutable references from state.compactionContext, which
 * is updated at the start of each cortexMindQuery in index.ts.
 *
 * See docs/cortex/compaction-strategy.md and docs/cortex/mind-migration.md
 * for the full design.
 */
function wireCompactionHandlers(
  cortexAgent: CortexAgent,
  state: CortexMindState,
): void {
  // -----------------------------------------------------------------------
  // Item 2: onBeforeCompaction -> processAllStreams
  //
  // Synchronously run observational memory processing before conversation
  // history is compacted. This ensures watermarks advance before re-seeding.
  // -----------------------------------------------------------------------
  cortexAgent.onBeforeCompaction(async (_target: CompactionTarget) => {
    const { gathered, completeFn, compiledPersona } = state.compactionContext;

    if (!gathered || !completeFn || !compiledPersona) {
      log.warn('onBeforeCompaction: no compaction context available, skipping observational memory flush');
      return;
    }

    log.info(`onBeforeCompaction: flushing observational memory (${_target.turnsToCompact} turns, ~${_target.estimatedTokens} tokens)`);

    try {
      const eventBus = getEventBus();
      await processAllStreams({
        deps: {
          completeFn,
          memoryDb: getMemoryDb(),
          compiledPersona,
          eventBus,
        },
        thoughts: gathered.thoughtContext.allFilteredItems,
        experiences: gathered.experienceContext.allFilteredItems,
        messages: gathered.messageContext?.allFilteredItems ?? [],
        contactId: gathered.contact?.id ?? null,
        config: OBSERVATIONAL_MEMORY_CONFIG,
        ...(gathered.aiTimezone ? { timezone: gathered.aiTimezone } : {}),
      });
      log.info('onBeforeCompaction: observational memory flush complete');
    } catch (err) {
      log.warn('onBeforeCompaction: observational memory flush failed (continuing with compaction):', err);
    }
  });

  // -----------------------------------------------------------------------
  // Item 3: onPostCompaction -> re-seed from messages.db
  //
  // After compaction clears old conversation turns, re-seed the gap between
  // the observation watermark and the preserved tail from messages.db.
  // -----------------------------------------------------------------------
  cortexAgent.onPostCompaction((result: CompactionResult) => {
    const { gathered } = state.compactionContext;

    log.info(
      `onPostCompaction: ${result.turnsCompacted} turns compacted, ` +
      `${result.tokensBefore} -> ${result.tokensAfter} tokens, ` +
      `${result.turnsPreserved} turns preserved`
    );

    // Log compaction event to agent_logs.db (Item 4)
    logCompactionEvent(result);

    // Re-seed conversation history from messages.db
    if (!gathered) {
      log.warn('onPostCompaction: no gathered context, skipping message re-seeding');
      return;
    }

    try {
      reseedMessagesAfterCompaction(cortexAgent, gathered, result);
    } catch (err) {
      log.warn('onPostCompaction: message re-seeding failed:', err);
    }
  });

  // -----------------------------------------------------------------------
  // Compaction error handler
  // -----------------------------------------------------------------------
  // Wire debug logging for compaction diagnostics
  cortexAgent.getCompactionManager().setDebugLog((msg: string) => {
    log.debug(`[Compaction] ${msg}`);
  });

  cortexAgent.onCompactionError((error: Error) => {
    log.error('Compaction failed:', error);

    // Log the failure to agent_logs.db
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

/**
 * Log a compaction event to agent_logs.db with before/after metrics.
 * Surfaces in the tick timeline and allows debugging of context management.
 */
function logCompactionEvent(result: CompactionResult): void {
  try {
    const agentLogsDb = getAgentLogsDb();

    // Find the most recent session to attach the event to
    const session = agentLogsDb
      .prepare('SELECT id FROM agent_sessions ORDER BY started_at DESC LIMIT 1')
      .get() as { id: string } | undefined;

    if (!session) {
      log.debug('No agent session found for compaction log entry');
      return;
    }

    const summaryPreview = result.summary
      ? result.summary.substring(0, 300) + (result.summary.length > 300 ? '...' : '')
      : null;

    const event = agentLogStore.insertEvent(agentLogsDb, {
      sessionId: session.id,
      eventType: 'compaction',
      data: {
        tokensBefore: result.tokensBefore,
        tokensAfter: result.tokensAfter,
        turnsCompacted: result.turnsCompacted,
        turnsPreserved: result.turnsPreserved,
        summaryTokens: result.summaryTokens,
        summaryPreview,
        oldestPreservedTimestamp: result.oldestPreservedTimestamp,
      },
    });

    // Emit to frontend for real-time timeline updates
    const eventBus = getEventBus();
    eventBus.emit('agent:event:logged', {
      id: event.id,
      sessionId: event.sessionId,
      eventType: event.eventType,
      data: event.data,
      createdAt: event.createdAt,
    });

    log.info(
      `Compaction logged: ${result.tokensBefore} -> ${result.tokensAfter} tokens ` +
      `(${result.turnsCompacted} turns compacted, ${result.summaryTokens} summary tokens)`
    );
  } catch (err) {
    log.warn('Failed to log compaction event:', err);
  }
}

/**
 * Re-seed conversation history from messages.db after compaction.
 *
 * Fills the gap between the observation watermark and the preserved tail.
 * The observation watermark is the newest message already compressed into
 * an observation summary (in slots). Messages newer than this watermark
 * need full representation in conversation history.
 *
 * See docs/cortex/mind-migration.md "Compaction Re-Seeding" for the full design.
 */
function reseedMessagesAfterCompaction(
  cortexAgent: CortexAgent,
  gathered: GatherResult,
  result: CompactionResult,
): void {
  const contactId = gathered.contact?.id;
  if (!contactId) {
    log.debug('No contact for re-seeding (non-message tick), skipping');
    return;
  }

  const channel = gathered.trigger.channel;
  if (!channel) {
    log.debug('No channel for re-seeding, skipping');
    return;
  }

  // Find the conversation for this contact + channel
  const msgDb = getMessagesDb();
  const conv = messageStore.getConversationByContactAndChannel(
    msgDb, contactId, channel as ChannelType
  );
  if (!conv) {
    log.debug('No conversation found for re-seeding');
    return;
  }

  // Get the observation watermark for the message stream
  const memDb = getMemoryDb();
  const observation = memoryDbStore.getObservation(memDb, 'messages', contactId);
  const watermark = observation?.lastRawTimestamp ?? null;

  if (!watermark) {
    // No observation watermark means no messages have been compressed yet.
    // Re-seed all recent messages (up to budget).
    log.debug('No observation watermark, re-seeding recent messages');
    const recentMessages = messageStore.getRecentMessages(msgDb, conv.id, 50);
    if (recentMessages.length > 0) {
      injectMessagesIntoHistory(cortexAgent, recentMessages.reverse());
    }
    return;
  }

  const oldestPreserved = result.oldestPreservedTimestamp;
  if (!oldestPreserved) {
    // No preserved tail timestamp; re-seed everything after the watermark
    const postWatermark = messageStore.getMessagesSince(msgDb, conv.id, watermark, 200);
    if (postWatermark.length > 0) {
      injectMessagesIntoHistory(cortexAgent, postWatermark.reverse());
    }
    return;
  }

  // Query the gap: messages after watermark but before the preserved tail
  const gapMessages = messageStore.getMessagesInRange(
    msgDb, conv.id, watermark, oldestPreserved, 200
  );

  if (gapMessages.length === 0) {
    log.debug('No gap messages to re-seed');
    return;
  }

  // Cap re-seeded messages by a rough token budget (4K tokens, ~3 chars per token)
  const TOKEN_BUDGET = 4000;
  const CHARS_PER_TOKEN = 3;
  let charBudget = TOKEN_BUDGET * CHARS_PER_TOKEN;
  const budgetedMessages = [];

  for (const msg of gapMessages) {
    const msgChars = (msg.content ?? '').length + 50; // 50 chars overhead for role/metadata
    if (charBudget - msgChars < 0 && budgetedMessages.length > 0) break;
    budgetedMessages.push(msg);
    charBudget -= msgChars;
  }

  injectMessagesIntoHistory(cortexAgent, budgetedMessages);
  log.info(`Re-seeded ${budgetedMessages.length} gap messages after compaction`);
}

/**
 * Format messages from messages.db as agent conversation turns and inject
 * them into the cortex agent's conversation history after the compaction
 * summary.
 */
function injectMessagesIntoHistory(
  cortexAgent: CortexAgent,
  messages: import('@animus-labs/shared').Message[],
): void {
  if (messages.length === 0) return;

  // Format as conversation turns for the agent
  const turns: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    const role = msg.direction === 'inbound' ? 'user' : 'assistant';
    const content = msg.content ?? '';
    if (!content.trim()) continue;
    turns.push({ role, content });
  }

  if (turns.length === 0) return;

  // The cortex agent provides restoreConversationHistory which replaces
  // the entire history. We need to INSERT after the compaction summary.
  // Get current history, find the summary, splice in re-seeded messages.
  const currentHistory = cortexAgent.getConversationHistory();

  // Find insertion point: after the compaction summary (first message),
  // before the preserved tail
  const insertionIndex = Math.min(1, currentHistory.length);

  // Build injection messages in the agent's format
  const injectionMessages = turns.map(t => ({
    role: t.role,
    content: t.content,
  }));

  // Splice into history
  const updatedHistory = [
    ...currentHistory.slice(0, insertionIndex),
    ...injectionMessages,
    ...currentHistory.slice(insertionIndex),
  ];

  cortexAgent.restoreConversationHistory(updatedHistory);
  log.debug(`Injected ${turns.length} re-seeded messages at index ${insertionIndex}`);
}

// ============================================================================
// Compaction Context Management
// ============================================================================

/**
 * Update the mutable compaction context for the current tick.
 * Called at the start of each cortexMindQuery so that the compaction
 * handlers (registered once at agent creation) can access per-tick data.
 */
export function updateCompactionContext(
  state: CortexMindState,
  gathered: GatherResult,
  completeFn: ((context: { systemPrompt: string; messages: Array<{ role: string; content: string }> }) => Promise<string>) | null,
  compiledPersona: string | null,
): void {
  state.compactionContext.gathered = gathered;
  state.compactionContext.completeFn = completeFn;
  state.compactionContext.compiledPersona = compiledPersona;
}

/**
 * Clear the compaction context after the tick completes.
 */
export function clearCompactionContext(state: CortexMindState): void {
  state.compactionContext.gathered = null;
  state.compactionContext.completeFn = null;
  state.compactionContext.compiledPersona = null;
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
