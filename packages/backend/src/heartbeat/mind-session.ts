/**
 * Mind Session Management
 *
 * Encapsulates the mind agent session lifecycle: creation, reuse,
 * cleanup, and the MCP tool context for each tick.
 *
 * Extracted from heartbeat/index.ts — pure structural refactor.
 */

import { getSystemDb, getContactsDb, getMessagesDb, getMemoryDb } from '../db/index.js';
import * as systemStore from '../db/stores/system-store.js';
import * as contactStore from '../db/stores/contact-store.js';
import * as messageStore from '../db/stores/message-store.js';
import { getEventBus } from '../lib/event-bus.js';
import { createLogger } from '../lib/logger.js';
import path from 'path';
import { env, PROJECT_ROOT } from '../utils/env.js';
import { isBlockedPath, isBlockedCommand } from '../lib/file-deny-list.js';

import {
  attachSessionLogging,
  type AgentManager,
  type AgentEvent,
  type IAgentSession,
  type AgentLogStore,
  type HookResult,
  type PreToolUseEvent,
} from '@animus-labs/agents';

import {
  startBridge,
  registerContext,
  updatePermissions,
  buildMcpServerConfig,
  type MutableToolContext,
  type ToolPermissionLookup,
} from '../tools/index.js';
import type { ToolHandlerContext } from '../tools/index.js';
import { getToolPermissions, getToolPermission } from '../db/stores/system-store.js';
import {
  getActiveApproval,
  getPendingApprovals,
  createApprovalRequest,
  consumeApproval,
  getHeartbeatState,
} from '../db/stores/heartbeat-store.js';
import { getHeartbeatDb } from '../db/index.js';
import { getPluginManager } from '../plugins/index.js';
import { prepareCodexSessionAuth, copyCodexCliAuth } from '../services/codex-oauth.js';
import { getChannelRouter } from '../channels/index.js';
import type { MemoryManager } from '../memory/index.js';

import type { GatherResult } from './gather-context.js';
import {
  getSnapshot as getCognitiveSnapshot,
  resetSnapshot as resetCognitiveSnapshot,
  getPhase as getCognitivePhase,
  type CognitiveSnapshot,
  type CognitivePhase,
} from './cognitive-tools.js';

const log = createLogger('MindSession', 'heartbeat');

// ============================================================================
// Mind Session State
// ============================================================================

export interface MindSessionState {
  session: IAgentSession | null;
  sessionId: string | null;
  logSessionId: (() => string | null) | null;
  warmSince: number | null;
  /** Stdio MCP config for Animus built-in tools */
  mcpServer: { serverConfig: Record<string, unknown>; allowedTools: string[] } | null;
  /** Cognitive tools: snapshot accessors (in-process) + stdio MCP config */
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
  let reasoningEffort: 'low' | 'medium' | 'high' | 'max' | undefined;
  try {
    const settings = systemStore.getSystemSettings(getSystemDb());
    const preferred = settings.defaultAgentProvider;
    if (preferred && agentManager.isConfigured(preferred)) {
      provider = preferred;
    }
    model = settings.defaultModel ?? undefined;
    reasoningEffort = settings.reasoningEffort ?? undefined;
  } catch {
    // Settings table may not exist yet on fresh install
  }

  // Build MCP servers on first cold session (lazy, once per process lifetime)
  // Uses the stdio bridge pattern so tools work with ALL providers (Claude, Codex, OpenCode)
  if (!state.mcpServer) {
    try {
      const permissions = buildToolPermissionLookup();
      updatePermissions(permissions);
      const bridgePort = await startBridge();
      registerContext('mind', state.toolContext);
      const serverConfig = buildMcpServerConfig(bridgePort, 'mind', 'mind');
      // Build the allowedTools list using the same logic as before
      const { getMindTools } = await import('@animus-labs/shared');
      const mindTools = getMindTools();
      const allowedTools: string[] = [];
      for (const def of mindTools) {
        const mode = permissions.get(def.name);
        if (mode === 'off') continue;
        allowedTools.push(`mcp__animus__${def.name}`);
      }
      state.mcpServer = { serverConfig: serverConfig as unknown as Record<string, unknown>, allowedTools };
      log.info(`Mind MCP server built (stdio bridge) with tools: ${allowedTools.join(', ')}`);
    } catch (err) {
      log.warn('Failed to build mind MCP server, proceeding without tools:', err);
    }
  }

  // Build cognitive MCP server config (record_thought + record_cognitive_state)
  // Cognitive state is accumulated in-process via module-level singleton;
  // the stdio subprocess proxies tool calls back to the bridge.
  if (!state.cognitiveServer) {
    try {
      const bridgePort = await startBridge();
      const serverConfig = buildMcpServerConfig(bridgePort, 'cognitive', 'mind');
      state.cognitiveServer = {
        serverConfig: serverConfig as unknown as Record<string, unknown>,
        allowedTools: [
          'mcp__cognitive__record_thought',
          'mcp__cognitive__record_cognitive_state',
        ],
        getSnapshot: getCognitiveSnapshot,
        resetSnapshot: resetCognitiveSnapshot,
        getPhase: getCognitivePhase,
      };
      log.info(`Cognitive MCP server built (stdio bridge) with tools: ${state.cognitiveServer.allowedTools.join(', ')}`);
    } catch (err) {
      log.warn('Failed to build cognitive MCP server, proceeding without:', err);
    }
  }

  // Merge built-in MCP tools + cognitive tools + plugin MCP servers
  const pluginMgr = getPluginManager();
  const pluginMcp = pluginMgr.getPluginMcpServersForSdk();

  // Filter plugin MCP servers by permission mode — exclude disabled ('off') servers
  const filteredPluginMcpServers: Record<string, Record<string, unknown>> = {};
  const filteredPluginAllowedTools: string[] = [];
  const sysDbForPerms = getSystemDb();
  for (const [key, config] of Object.entries(pluginMcp.mcpServers)) {
    const permKey = `mcp__${key}`;
    const perm = getToolPermission(sysDbForPerms, permKey);
    if (perm && perm.mode === 'off') {
      log.info(`Excluding disabled plugin MCP server from session: ${key}`);
      continue;
    }
    filteredPluginMcpServers[key] = config;
    filteredPluginAllowedTools.push(`mcp__${key}__*`);
  }

  const mergedMcpServers: Record<string, Record<string, unknown>> = {
    ...(state.mcpServer ? { animus: state.mcpServer.serverConfig } : {}),
    ...(state.cognitiveServer ? { cognitive: state.cognitiveServer.serverConfig } : {}),
    ...filteredPluginMcpServers,
  };
  const mergedAllowedTools: string[] = [
    ...(state.mcpServer ? state.mcpServer.allowedTools : []),
    ...(state.cognitiveServer ? state.cognitiveServer.allowedTools : []),
    ...filteredPluginAllowedTools,
  ];

  // Build the session env. The Claude SDK replaces process.env entirely when
  // options.env is provided, so we MUST start from a full copy of process.env
  // and then override specific keys. Without this, child processes would get
  // a sparse env missing HOME, USER, SHELL, etc.
  const baseSessionEnv: Record<string, string> = {};
  let needsEnvOverride = false;

  // Ensure the running node binary's directory is on PATH for all providers.
  // In the bundled Tauri app, the Rust launcher sets PATH before spawning the
  // sidecar, but child processes spawned by the SDK need it too.
  const nodeDir = path.dirname(process.execPath);
  const currentPath = process.env['PATH'] || '';
  if (!currentPath.split(path.delimiter).includes(nodeDir)) {
    baseSessionEnv['PATH'] = `${nodeDir}${path.delimiter}${currentPath}`;
    needsEnvOverride = true;
    log.debug(`Prepended node directory to session PATH: ${nodeDir}`);
  }

  // macOS dock icon suppression for child processes. The Rust launcher sets
  // ANIMUS_DOCK_SUPPRESS_ADDON to the path of a native addon that calls
  // NSApp.setActivationPolicy(.accessory). We translate this to
  // DYLD_INSERT_LIBRARIES for child processes so macOS injects the addon
  // at process load time. We don't set DYLD on the sidecar itself because
  // it can interfere with native addons (onnxruntime, etc.).
  const dockAddonPath = process.env['ANIMUS_DOCK_SUPPRESS_ADDON'];
  if (dockAddonPath) {
    baseSessionEnv['DYLD_INSERT_LIBRARIES'] = dockAddonPath;
    needsEnvOverride = true;
    log.info(`Dock suppression: DYLD_INSERT_LIBRARIES=${dockAddonPath}`);
  }

  // Provider-specific configuration: skill bridge plugins, runtime env, auth.
  // Also add 'Skill' to allowedTools so Claude SDK enables its built-in Skill tool.
  let sdkPlugins: Array<{ type: 'local'; path: string }> | undefined;
  let sessionEnv: Record<string, string> | undefined;
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
  } else if (provider === 'codex') {
    sessionEnv = await pluginMgr.buildCodexRuntimeEnv();
    if (process.env['CODEX_OAUTH_CONFIGURED']) {
      try {
        sessionEnv = await prepareCodexSessionAuth(getSystemDb(), sessionEnv['CODEX_HOME']!);
      } catch (err) {
        log.warn('Codex OAuth session prep failed, continuing without refresh:', err);
      }
    } else if (process.env['CODEX_CLI_CONFIGURED']) {
      // CLI auth: credentials live at ~/.codex/auth.json (or system keyring).
      // Since CODEX_HOME is overridden for plugin config, copy the auth file
      // so the binary finds it at $CODEX_HOME/auth.json as a file fallback.
      await copyCodexCliAuth(sessionEnv['CODEX_HOME']!);
    }
    sessionEnv = await pluginMgr.buildCodexRuntimeEnv(sessionEnv);
    log.info('Codex runtime config prepared for session', {
      codexHome: sessionEnv['CODEX_HOME'],
    });
  }

  // Merge envs. When the SDK receives options.env, it uses it as the COMPLETE
  // env for the spawned CLI process (no automatic inheritance from process.env).
  // We must start from a full copy of process.env, then layer overrides on top.
  // Provider-specific keys win over base overrides, which win over process.env.
  if (needsEnvOverride || sessionEnv) {
    const fullEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) fullEnv[k] = v;
    }
    sessionEnv = { ...fullEnv, ...baseSessionEnv, ...sessionEnv };
    log.info('Session env verification', {
      hasDYLD: !!sessionEnv['DYLD_INSERT_LIBRARIES'],
      dyldPath: sessionEnv['DYLD_INSERT_LIBRARIES']?.substring(0, 50),
      hasNodeOptions: !!sessionEnv['NODE_OPTIONS'],
      pathStartsWith: sessionEnv['PATH']?.substring(0, 80),
      totalVars: Object.keys(sessionEnv).length,
    });
  }

  // Enable verbose agent logging when LOG_LEVEL is debug or trace
  const verboseAgent = env.LOG_LEVEL === 'debug' || env.LOG_LEVEL === 'trace';

  // Build disallowed list for SDK built-in tools that are disabled (mode='off').
  const disabledSdkTools = getDisabledSdkTools('off');

  // Add only 'always_allow' SDK tools to allowedTools (auto-approved by SDK).
  // 'ask' mode SDK tools are intentionally LEFT OUT so the SDK routes them
  // through canUseTool, which only fires for model-initiated calls — NOT for
  // SDK internal operations (e.g., git status via Bash during init).
  const autoApprovedSdkTools = getAutoApprovedSdkTools();
  if (autoApprovedSdkTools.length > 0) {
    mergedAllowedTools.push(...autoApprovedSdkTools);
    log.info('Added always_allow SDK tools to allowedTools:', autoApprovedSdkTools);
  }

  // Build the canUseTool callback — PRIMARY gate for 'ask'-mode SDK built-in tools.
  // SDK routes model-initiated calls for tools NOT in allowedTools through this.
  // Crucially, canUseTool does NOT fire for SDK internal operations (git status, etc.),
  // so it correctly avoids false positives on SDK startup Bash calls.
  const canUseToolCallback = buildCanUseToolCallback(state.toolContext);

  // Build the PreToolUse hook — SECONDARY gate for plugin MCP tools in 'ask' mode.
  // Plugin MCP tools use wildcard patterns in allowedTools (mcp__plugin__*), so the
  // SDK auto-approves them. The hook catches these and enforces approval.
  // For SDK built-in tools: this hook still fires but canUseTool handles them first.
  const preToolUseHook = buildPreToolUseHook(state.toolContext);

  const session = await agentManager.createSession({
    provider,
    ...(model != null ? { model } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
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
      approvalLevel: 'normal',
    },
    ...(sessionEnv ? { env: sessionEnv } : {}),
    canUseTool: canUseToolCallback,
    hooks: {
      onPreToolUse: preToolUseHook,
    },
    // Structured output captured via cognitive MCP tools (record_thought + record_cognitive_state)
    // Natural language between tool calls becomes the reply
    // Attach MCP servers: built-in Animus tools + plugin MCP servers
    ...(Object.keys(mergedMcpServers).length > 0 ? {
      mcpServers: mergedMcpServers,
    } : {}),
    // allowedTools: ALL non-off tools (SDK + MCP patterns + 'Skill')
    // The SDK auto-approves everything in this list; 'ask' enforcement is via hook.
    ...(mergedAllowedTools.length > 0 ? { allowedTools: mergedAllowedTools } : {}),
    // Disable SDK built-in tools that have mode='off' in tool_permissions
    ...(disabledSdkTools.length > 0 ? { disallowedTools: disabledSdkTools } : {}),
    // Claude SDK plugins for skill discovery (bridge to runtime claude/skills/)
    ...(sdkPlugins ? { plugins: sdkPlugins } : {}),
    verbose: verboseAgent,
  });

  // Attach logging — eagerly init so logSessionId is available before promptStreaming()
  if (agentLogStoreAdapter) {
    const logging = attachSessionLogging(session, {
      store: agentLogStoreAdapter,
      eagerInit: { provider, model: model ?? 'unknown' },
    });
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
// Tool Permission Lookup Helpers
// ============================================================================

/**
 * Build a ToolPermissionLookup from the tool_permissions table.
 * Returns a Map<toolName, mode> for quick lookups in MCP server builders.
 */
export function buildToolPermissionLookup(): ToolPermissionLookup {
  const sysDb = getSystemDb();
  const perms = getToolPermissions(sysDb);
  const lookup: ToolPermissionLookup = new Map();
  for (const p of perms) {
    lookup.set(p.toolName, p.mode);
  }
  return lookup;
}

/**
 * Get SDK built-in tools that should be disallowed based on permission mode.
 *
 * @param blockModes  Which modes to treat as blocked. For the mind session,
 *                    pass 'off' only (ask tools are kept). For sub-agents,
 *                    pass both 'off' and 'ask'.
 */
function getDisabledSdkTools(...blockModes: Array<'off' | 'ask'>): string[] {
  const sysDb = getSystemDb();
  const perms = getToolPermissions(sysDb);
  const modes = new Set<string>(blockModes);
  return perms
    .filter((p) => p.toolSource.startsWith('sdk:') && modes.has(p.mode))
    .map((p) => p.toolName);
}

/**
 * Get SDK built-in tools that should be added to allowedTools.
 *
 * Returns only 'always_allow' SDK tools. Why not 'ask' tools?
 * - Tools in allowedTools are auto-approved by the SDK, bypassing canUseTool
 * - The SDK also uses some tools internally (e.g., Bash for git status during init)
 * - Internal SDK tool calls do NOT route through canUseTool or PreToolUse hooks
 *   when the tool is in allowedTools — they just execute silently
 * - But when a tool is NOT in allowedTools, the SDK routes model-initiated calls
 *   through canUseTool, which correctly skips internal calls
 *
 * So: 'always_allow' → allowedTools (auto-approved), 'ask' → canUseTool gate
 */
function getAutoApprovedSdkTools(): string[] {
  const sysDb = getSystemDb();
  const perms = getToolPermissions(sysDb);
  return perms
    .filter((p) => p.toolSource.startsWith('sdk:') && p.mode === 'always_allow')
    .map((p) => p.toolName);
}

/**
 * Extract the server-level permission key from a plugin MCP tool name.
 *
 * Tool name format: mcp__<pluginName>__<serverName>__<toolFunction>
 * Permission key:   mcp__<pluginName>__<serverName>
 *
 * Returns null if the format doesn't match (fewer than 4 segments).
 */
function getPluginMcpPermissionKey(toolName: string): string | null {
  const parts = toolName.split('__');
  // parts[0]='mcp', parts[1]=pluginName, parts[2]=serverName, parts[3+]=toolFunc
  if (parts.length < 4) return null;
  return `${parts[0]}__${parts[1]}__${parts[2]}`;
}

/**
 * Resolve permission key and record for a given tool name.
 *
 * Different tool types use different key formats:
 * - SDK built-in tools: exact name (e.g., "bash", "write")
 * - Animus core MCP tools: exact name (e.g., "send_message")
 * - Plugin MCP tools: server-level key (e.g., "mcp__home-assistant__main")
 */
function resolveToolPermission(toolName: string): {
  permKey: string;
  permission: import('@animus-labs/shared').ToolPermission | null;
} | null {
  const sysDb = getSystemDb();

  // Plugin MCP tools: use server-level key
  if (toolName.startsWith('mcp__')) {
    // Core Animus MCP tools have their own in-process gate in registry.ts
    // Mind session and sub-agents register under key 'animus' (mcp__animus__*)
    if (toolName.startsWith('mcp__animus__')) return null;
    // Cognitive tools are internal, always allowed
    if (toolName.startsWith('mcp__cognitive__')) return null;

    const permKey = getPluginMcpPermissionKey(toolName);
    if (!permKey) return null;
    return { permKey, permission: getToolPermission(sysDb, permKey) };
  }

  // SDK built-in tools and others: exact name lookup
  return { permKey: toolName, permission: getToolPermission(sysDb, toolName) };
}

/**
 * Build the canUseTool callback for the mind session.
 *
 * Primary gate for 'ask'-mode SDK built-in tools (Bash, Write, Edit, etc.).
 * The SDK only routes tool calls through canUseTool when the tool is NOT in
 * allowedTools. Since we only add 'always_allow' tools to allowedTools,
 * 'ask'-mode SDK tools flow through here.
 *
 * Key advantage: canUseTool only fires for MODEL-initiated tool calls, not
 * SDK internal operations (e.g., git status via Bash during CLI startup).
 * This prevents false approval prompts on normal conversations.
 *
 * Also handles plugin MCP tools as a fallback (primary gate is PreToolUse hook).
 * Animus core MCP tools are skipped (they have their own in-process gate).
 */
function buildCanUseToolCallback(
  toolContextRef: MutableToolContext,
): (
  toolName: string,
  input: Record<string, unknown>,
) => Promise<
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; message?: string }
> {
  return async (toolName: string, input: Record<string, unknown>) => {
    log.info(`canUseTool callback invoked for: "${toolName}"`);

    // Security: file deny list -- block access to vault, .env, encryption source files
    if (['Read', 'Write', 'Edit'].includes(toolName)) {
      const filePath = input['file_path'] as string | undefined;
      if (filePath && isBlockedPath(filePath)) {
        log.warn(`Blocked agent access to restricted file: ${filePath}`);
        return { behavior: 'deny', message: 'Access to this file is restricted for security.' };
      }
    }
    if (toolName === 'Bash') {
      const command = input['command'] as string | undefined;
      if (command && isBlockedCommand(command)) {
        log.warn(`Blocked agent execution of restricted command: ${command.substring(0, 100)}`);
        return { behavior: 'deny', message: 'This command is restricted for security.' };
      }
    }

    const resolved = resolveToolPermission(toolName);

    // No resolved info means tool is exempt (core MCP, cognitive, unknown)
    if (!resolved) {
      log.info(`canUseTool: "${toolName}" → exempt (no permission record), allowing`);
      return { behavior: 'allow' };
    }

    const { permKey, permission } = resolved;

    // No permission record — allow (seeder will catch up)
    if (!permission) {
      return { behavior: 'allow' };
    }

    // Off = disabled entirely
    if (permission.mode === 'off') {
      return { behavior: 'deny', message: `Tool "${permission.displayName}" is disabled.` };
    }

    // Always allow = no gate
    if (permission.mode === 'always_allow') {
      return { behavior: 'allow' };
    }

    // Mode is 'ask' — check for active approval
    const heartbeatDb = getHeartbeatDb();
    const ctx = toolContextRef.current;
    const contactId = ctx?.contactId ?? '';

    const activeApproval = getActiveApproval(heartbeatDb, permKey, contactId);
    if (activeApproval) {
      consumeApproval(heartbeatDb, activeApproval.id);
      log.info(`Consumed approval ${activeApproval.id} for tool "${toolName}"`);
      return { behavior: 'allow' };
    }

    // Check for existing pending request to avoid duplicates
    const pendingRequests = getPendingApprovals(heartbeatDb, contactId);
    const existingPending = pendingRequests.find((r) => r.toolName === permKey);
    if (!existingPending) {
      const heartbeatState = getHeartbeatState(heartbeatDb);
      const approvalRequest = createApprovalRequest(heartbeatDb, {
        toolName: permKey,
        toolSource: permission.toolSource,
        contactId,
        channel: ctx?.sourceChannel ?? 'web',
        tickNumber: heartbeatState.tickNumber,
        agentContext: {
          taskDescription: `Tool "${toolName}" invoked during tick ${heartbeatState.tickNumber}`,
          conversationSummary: `Conversation ${ctx?.conversationId ?? 'unknown'}`,
          pendingAction: `Execute tool "${toolName}"`,
        },
        toolInput: input,
        triggerSummary: `Agent wants to use "${permission.displayName}"`,
        conversationId: ctx?.conversationId ?? '',
        originatingAgent: 'mind',
      });

      ctx?.eventBus.emit('tool:approval_requested', approvalRequest);
      log.info(`Created approval request ${approvalRequest.id} for tool "${toolName}"`);
    }

    return {
      behavior: 'deny',
      message: `Tool "${permission.displayName}" requires user approval before it can run. ` +
        'Please explain to the user what you want to do with this tool and why. ' +
        'The system will present them with an approval request. ' +
        'Do NOT attempt to call this tool again until the user has responded.',
    };
  };
}

// ============================================================================
// PreToolUse Hook — Primary Permission Enforcement
// ============================================================================

/**
 * Build a PreToolUse hook that enforces 'ask' mode for plugin MCP tools.
 *
 * Plugin MCP tools are registered with wildcard patterns in allowedTools
 * (e.g., mcp__home-assistant__ha__*), so the SDK auto-approves them.
 * This hook catches those calls and enforces the approval gate.
 *
 * For SDK built-in tools: canUseTool is the primary gate (it only fires for
 * model-initiated calls, avoiding false positives on SDK internal operations).
 * This hook may also fire for SDK tools as a secondary check.
 *
 * For 'ask' mode tools:
 *   - No active approval → creates approval request, emits event, blocks tool
 *   - Active approval → consumes it and allows tool
 * For 'always_allow' and unknown tools: allows (no-op)
 * For 'off' tools: handled by disallowedTools (never reaches here)
 *
 * Core Animus MCP tools are skipped (they have their own in-process gate).
 */
function buildPreToolUseHook(
  toolContextRef: MutableToolContext,
): (event: PreToolUseEvent) => Promise<HookResult | void> {
  return async (event: PreToolUseEvent) => {
    const { toolName } = event;

    // SDK built-in tools (Bash, Write, Edit, WebSearch, etc.) are NOT gated here.
    // Hooks fire for ALL tool calls including SDK internal operations (git status,
    // environment checks) that happen during CLI startup. We can't distinguish
    // those from model-initiated calls in this hook.
    // Instead, canUseTool handles SDK built-in tools — it only fires for
    // model-initiated calls, correctly skipping SDK internal operations.
    if (!toolName.startsWith('mcp__')) {
      return; // Not an MCP tool — canUseTool handles SDK tools
    }

    const resolved = resolveToolPermission(toolName);
    if (!resolved) {
      // Exempt tool (core MCP, cognitive, unknown) — allow
      return;
    }

    const { permKey, permission } = resolved;
    if (!permission || permission.mode !== 'ask') {
      // No record or not 'ask' mode — allow
      return;
    }

    // Mode is 'ask' — check for active approval
    const heartbeatDb = getHeartbeatDb();
    const ctx = toolContextRef.current;
    const contactId = ctx?.contactId ?? '';

    const activeApproval = getActiveApproval(heartbeatDb, permKey, contactId);
    if (activeApproval) {
      consumeApproval(heartbeatDb, activeApproval.id);
      log.info(`[PreToolUse] Consumed approval ${activeApproval.id} for "${toolName}"`);
      return; // Allow
    }

    // No approval — create request and block
    const pendingRequests = getPendingApprovals(heartbeatDb, contactId);
    const existingPending = pendingRequests.find((r) => r.toolName === permKey);
    if (!existingPending) {
      const heartbeatState = getHeartbeatState(heartbeatDb);
      const approvalRequest = createApprovalRequest(heartbeatDb, {
        toolName: permKey,
        toolSource: permission.toolSource,
        contactId,
        channel: ctx?.sourceChannel ?? 'web',
        tickNumber: heartbeatState.tickNumber,
        agentContext: {
          taskDescription: `Tool "${toolName}" invoked during tick ${heartbeatState.tickNumber}`,
          conversationSummary: `Conversation ${ctx?.conversationId ?? 'unknown'}`,
          pendingAction: `Execute tool "${toolName}"`,
        },
        toolInput: event.toolInput as Record<string, unknown> | null,
        triggerSummary: `Agent wants to use "${permission.displayName}"`,
        conversationId: ctx?.conversationId ?? '',
        originatingAgent: 'mind',
      });

      ctx?.eventBus.emit('tool:approval_requested', approvalRequest);
      log.info(`[PreToolUse] Created approval request ${approvalRequest.id} for "${toolName}"`);
    } else {
      log.info(`[PreToolUse] Pending approval already exists for "${toolName}", blocking`);
    }

    return { allow: false };
  };
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
