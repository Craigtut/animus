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
  type IAgentSession,
  type AgentLogStore,
} from '@animus/agents';

import { buildMindMcpServer, type MutableToolContext } from '../tools/index.js';
import type { ToolHandlerContext } from '../tools/index.js';
import { getPluginManager } from '../services/plugin-manager.js';
import { getChannelRouter } from '../channels/index.js';
import type { MemoryManager } from '../memory/index.js';

import type { GatherResult } from './gather-context.js';

const log = createLogger('MindSession', 'heartbeat');

// ============================================================================
// Async Chunk Channel — bridges push-based adapter to pull-based AsyncIterable
// ============================================================================

export function createChunkChannel(): {
  push: (chunk: string) => void;
  end: () => void;
  iterable: AsyncIterable<string>;
} {
  let resolve: ((value: IteratorResult<string>) => void) | null = null;
  const buffer: string[] = [];
  let done = false;

  const iterable: AsyncIterable<string> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<string>> {
          if (buffer.length > 0) {
            return Promise.resolve({ value: buffer.shift()!, done: false });
          }
          if (done) {
            return Promise.resolve({ value: undefined, done: true } as IteratorResult<string>);
          }
          return new Promise((r) => { resolve = r; });
        },
      };
    },
  };

  return {
    push(chunk: string) {
      if (resolve) {
        const r = resolve;
        resolve = null;
        r({ value: chunk, done: false });
      } else {
        buffer.push(chunk);
      }
    },
    end() {
      done = true;
      if (resolve) {
        const r = resolve;
        resolve = null;
        r({ value: undefined, done: true } as IteratorResult<string>);
      }
    },
    iterable,
  };
}

// ============================================================================
// Mind Session State
// ============================================================================

export interface MindSessionState {
  session: IAgentSession | null;
  sessionId: string | null;
  logSessionId: (() => string | null) | null;
  warmSince: number | null;
  mcpServer: { serverConfig: Record<string, unknown>; allowedTools: string[] } | null;
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
  try {
    const settings = systemStore.getSystemSettings(getSystemDb());
    const preferred = settings.defaultAgentProvider;
    if (preferred && agentManager.isConfigured(preferred)) {
      provider = preferred;
    }
  } catch {
    // Settings table may not exist yet on fresh install
  }

  // Build MCP server on first cold session (lazy, once per process lifetime)
  if (!state.mcpServer && provider === 'claude') {
    try {
      state.mcpServer = await buildMindMcpServer(state.toolContext);
      log.info(`Mind MCP server built with tools: ${state.mcpServer.allowedTools.join(', ')}`);
    } catch (err) {
      log.warn('Failed to build mind MCP server, proceeding without tools:', err);
    }
  }

  // Merge built-in MCP tools with plugin MCP servers
  const pluginMgr = getPluginManager();
  const pluginMcp = pluginMgr.getPluginMcpServersForSdk();
  const mergedMcpServers: Record<string, Record<string, unknown>> = {
    ...(state.mcpServer ? { tools: state.mcpServer.serverConfig } : {}),
    ...pluginMcp.mcpServers,
  };
  const mergedAllowedTools: string[] = [
    ...(state.mcpServer ? state.mcpServer.allowedTools : []),
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
    // Structured output enforced via system prompt instructions + llm-json-stream parsing
    // (no SDK outputFormat — its StructuredOutput tool approach is unreliable with complex schemas)
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

  state.session = session;
  state.sessionId = session.id;

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
