/**
 * Mind Session Management
 *
 * Encapsulates the mind agent session lifecycle: creation, reuse,
 * cleanup, and the MCP tool context for each tick.
 *
 * Extracted from heartbeat/index.ts — pure structural refactor.
 */

import { getSystemDb, getMessagesDb, getMemoryDb } from '../db/index.js';
import * as systemStore from '../db/stores/system-store.js';
import * as messageStore from '../db/stores/message-store.js';
import { getEventBus } from '../lib/event-bus.js';
import { createLogger } from '../lib/logger.js';
import { env, PROJECT_ROOT } from '../utils/env.js';

import {
  attachSessionLogging,
  type AgentManager,
  type AgentEvent,
  type IAgentSession,
  type AgentLogStore,
} from '@animus/agents';

import { buildMindMcpServer, type MutableToolContext } from '../tools/index.js';
import type { ToolHandlerContext } from '../tools/index.js';
import { getPluginManager } from '../services/plugin-manager.js';
import { getChannelRouter } from '../channels/index.js';
import type { MemoryManager } from '../memory/index.js';

import type { GatherResult } from './gather-context.js';
import { buildCognitiveMcpServer, type CognitiveSnapshot, type CognitivePhase } from './cognitive-tools.js';

const log = createLogger('MindSession', 'heartbeat');

// ============================================================================
// Mind Session State
// ============================================================================

export interface MindSessionState {
  session: IAgentSession | null;
  sessionId: string | null;
  logSessionId: (() => string | null) | null;
  warmSince: number | null;
  mcpServer: { serverConfig: Record<string, unknown>; allowedTools: string[] } | null;
  cognitiveServer: {
    serverConfig: Record<string, unknown>;
    allowedTools: string[];
    getSnapshot: () => CognitiveSnapshot;
    resetSnapshot: () => void;
    getPhase: () => CognitivePhase;
  } | null;
  toolContext: MutableToolContext;
  invalidated: boolean;
}

export function createMindSessionState(): MindSessionState {
  return {
    session: null,
    sessionId: null,
    logSessionId: null,
    warmSince: null,
    mcpServer: null,
    cognitiveServer: null,
    toolContext: { current: null },
    invalidated: false,
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

  // Resolve conversation for the triggering contact
  let conversationId = '';
  if (gathered.contact && gathered.trigger.channel) {
    const channel = (gathered.trigger.channel || 'web') as import('@animus/shared').ChannelType;
    const conv = messageStore.getConversationByContactAndChannel(
      msgDb, gathered.contact.id, channel
    );
    if (conv) conversationId = conv.id;
  }

  const sysDb = getSystemDb();

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
        getContact: (id) => systemStore.getContact(sysDb, id),
        listContacts: () => systemStore.listContacts(sysDb),
        getContactChannels: (contactId) => systemStore.getContactChannelsByContactId(sysDb, contactId),
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
// Get or Create Mind Session
// ============================================================================

/**
 * Create or reuse the mind agent session based on warmth state.
 *
 * MUTATES `state` — sets session, sessionId, logSessionId, mcpServer.
 * This is intentional; the caller owns the state object.
 */
export async function getOrCreateMindSession(
  state: MindSessionState,
  sessionState: 'cold' | 'warm',
  systemPrompt: string | null,
  agentManager: AgentManager,
  agentLogStoreAdapter: AgentLogStore | null,
): Promise<IAgentSession> {
  // Warm session: reuse existing (only if the session is actually alive)
  if (sessionState === 'warm' && state.session && state.session.isActive) {
    log.info(`Reusing warm session: ${state.session.id}`);
    return state.session;
  }

  // If we expected warm but session is dead, log warning — system prompt may be null
  if (sessionState === 'warm' && (!state.session || !state.session.isActive)) {
    log.warn('Session state is "warm" but mind session is dead/missing — forcing cold session with system prompt rebuild');
  }

  // Cold session: end old session and create new one
  if (state.session && state.session.isActive) {
    try {
      await state.session.end();
    } catch (err) {
      log.warn('Failed to end previous mind session:', err);
    }
  }

  // Determine provider: respect user's defaultAgentProvider setting
  const configuredProviders = agentManager.getConfiguredProviders();
  if (configuredProviders.length === 0) {
    throw new Error('No agent providers configured. Set ANTHROPIC_API_KEY or other credentials.');
  }

  let provider = configuredProviders[0]!;
  let model: string | undefined;
  try {
    const settings = systemStore.getSystemSettings(getSystemDb());
    const preferred = settings.defaultAgentProvider;
    if (preferred && agentManager.isConfigured(preferred)) {
      provider = preferred;
    }
    model = settings.defaultModel ?? undefined;
  } catch {
    // Settings table may not exist yet on fresh install
  }

  // Build MCP servers on first cold session (lazy, once per process lifetime)
  if (!state.mcpServer && provider === 'claude') {
    try {
      state.mcpServer = await buildMindMcpServer(state.toolContext);
      log.info(`Mind MCP server built with tools: ${state.mcpServer.allowedTools.join(', ')}`);
    } catch (err) {
      log.warn('Failed to build mind MCP server, proceeding without tools:', err);
    }
  }

  // Build cognitive MCP server (record_thought + record_cognitive_state)
  if (!state.cognitiveServer && provider === 'claude') {
    try {
      state.cognitiveServer = await buildCognitiveMcpServer();
      log.info(`Cognitive MCP server built with tools: ${state.cognitiveServer.allowedTools.join(', ')}`);
    } catch (err) {
      log.warn('Failed to build cognitive MCP server, proceeding without:', err);
    }
  }

  // Merge built-in MCP tools + cognitive tools + plugin MCP servers
  const pluginMgr = getPluginManager();
  const pluginMcp = pluginMgr.getPluginMcpServersForSdk();
  const mergedMcpServers: Record<string, Record<string, unknown>> = {
    ...(state.mcpServer ? { tools: state.mcpServer.serverConfig } : {}),
    ...(state.cognitiveServer ? { cognitive: state.cognitiveServer.serverConfig } : {}),
    ...pluginMcp.mcpServers,
  };
  const mergedAllowedTools: string[] = [
    ...(state.mcpServer ? state.mcpServer.allowedTools : []),
    ...(state.cognitiveServer ? state.cognitiveServer.allowedTools : []),
    ...pluginMcp.allowedTools,
  ];

  // For Claude provider: use the skill bridge plugin to expose Animus plugin skills
  // without needing settingSources: ['project'] (which would also load CLAUDE.md).
  // The bridge is a minimal pseudo-plugin whose skills/ symlinks to .claude/skills/.
  // Also add 'Skill' to allowedTools so the SDK enables its built-in Skill tool.
  let sdkPlugins: Array<{ type: 'local'; path: string }> | undefined;
  if (provider === 'claude') {
    const bridgePath = pluginMgr.getSkillBridgePath();
    sdkPlugins = [{ type: 'local' as const, path: bridgePath }];
    if (!mergedAllowedTools.includes('Skill')) {
      mergedAllowedTools.push('Skill');
    }
    log.info('Claude SDK skill bridge plugin configured', {
      bridgePath,
      allowedTools: mergedAllowedTools,
    });
  }

  // Enable verbose agent logging when LOG_LEVEL is debug or trace
  const verboseAgent = env.LOG_LEVEL === 'debug' || env.LOG_LEVEL === 'trace';

  const session = await agentManager.createSession({
    provider,
    model,
    cwd: PROJECT_ROOT,
    ...(systemPrompt != null ? {
      systemPrompt: {
        type: 'preset' as const,
        preset: 'claude_code' as const,
        append: systemPrompt,
      },
    } : {}),
    permissions: {
      executionMode: 'build',
      approvalLevel: 'none',
    },
    // Structured output captured via cognitive MCP tools (record_thought + record_cognitive_state)
    // Natural language between tool calls becomes the reply
    // Attach MCP servers: built-in Animus tools + plugin MCP servers
    ...(Object.keys(mergedMcpServers).length > 0 ? {
      mcpServers: mergedMcpServers,
    } : {}),
    // allowedTools: MCP tool patterns + 'Skill' for SDK skill discovery
    ...(mergedAllowedTools.length > 0 ? { allowedTools: mergedAllowedTools } : {}),
    // Claude SDK plugins for skill discovery (bridge to .claude/skills/)
    ...(sdkPlugins ? { plugins: sdkPlugins } : {}),
    verbose: verboseAgent,
  });

  // Attach logging
  if (agentLogStoreAdapter) {
    const logging = attachSessionLogging(session, { store: agentLogStoreAdapter });
    state.logSessionId = logging.getLogSessionId;
  }

  // Attach lifecycle event handler for heartbeat-level logging.
  // This runs once per cold session creation, so it doesn't stack on warm reuse.
  session.onEvent((event: AgentEvent) => {
    switch (event.type) {
      case 'tool_call_start': {
        const d = event.data as { toolName: string };
        // Cognitive tools log their own detail in cognitive-tools.ts; skip duplicates
        if (d.toolName.startsWith('mcp__cognitive__')) break;
        log.info(`Tool call: ${d.toolName}`);
        break;
      }
      case 'turn_end': {
        const d = event.data as { turnIndex: number; text: string; hasToolCalls: boolean; toolNames: string[] };
        if (d.text.length > 0) {
          const preview = d.text.length > 120 ? d.text.substring(0, 120) + '...' : d.text;
          log.info(`Turn ${d.turnIndex}: "${preview}"${d.hasToolCalls ? ` + tools: ${d.toolNames.join(', ')}` : ''}`);
        } else if (d.hasToolCalls) {
          log.info(`Turn ${d.turnIndex}: tool-only [${d.toolNames.join(', ')}]`);
        }
        break;
      }
      case 'tool_error': {
        const d = event.data as { toolName: string; error: string };
        log.warn(`Tool error: ${d.toolName} — ${d.error}`);
        break;
      }
    }
  });

  state.session = session;
  state.sessionId = session.id;

  log.info(`Cold session created: ${session.id}, provider=${provider}, mcpServers=${Object.keys(mergedMcpServers).join(',') || 'none'}, tools=${mergedAllowedTools.length}`);

  return session;
}

// ============================================================================
// Reset Mind Session
// ============================================================================

/**
 * Clean up the mind session on stop or error.
 */
export async function resetMindSession(
  state: MindSessionState,
  agentManager?: AgentManager | null,
): Promise<void> {
  if (state.session && state.session.isActive) {
    const sessionId = state.session.id;
    try {
      await state.session.end();
    } catch (err) {
      log.warn('Failed to end mind session during reset, force-removing from tracking:', err);
      agentManager?.removeTrackedSession(sessionId);
    }
  }

  state.session = null;
  state.sessionId = null;
  state.logSessionId = null;
}
