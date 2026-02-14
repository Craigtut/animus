/**
 * Heartbeat System
 *
 * The heartbeat is the core tick system that drives Animus's inner life.
 * Architecture: 3-stage pipeline (Gather → Mind → Execute)
 *
 * See docs/architecture/heartbeat.md for the full design.
 */

import { getHeartbeatDb, getSystemDb, getMessagesDb, getAgentLogsDb, getMemoryDb } from '../db/index.js';
import * as heartbeatStore from '../db/stores/heartbeat-store.js';
import * as agentLogStore from '../db/stores/agent-log-store.js';
import * as systemStore from '../db/stores/system-store.js';
import * as messageStore from '../db/stores/message-store.js';
import { getEventBus } from '../lib/event-bus.js';
import { createLogger } from '../lib/logger.js';
import { PROJECT_ROOT } from '../utils/env.js';
import { DecayEngine, expiresIn, now, clamp } from '@animus/shared';
import { mindOutputSchema } from '@animus/shared';
import type {
  HeartbeatState,
  MindOutput,
  Contact,
  EmotionState,
  EnergyBand,
} from '@animus/shared';

import { MemoryManager, buildMemoryContext, LocalEmbeddingProvider, VectorStore } from '../memory/index.js';
import type { MemoryContext } from '../memory/index.js';
import { SeedManager, GoalManager, buildGoalContext } from '../goals/index.js';
import type { GoalContext } from '../goals/index.js';

import {
  createAgentManager,
  attachSessionLogging,
  type AgentManager,
  type IAgentSession,
  type AgentLogStore,
} from '@animus/agents';

import { JsonStream } from 'llm-json-stream';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { TickQueue, type QueuedTick } from './tick-queue.js';
import { type TriggerContext, type CompiledContext, buildMindContext, buildSystemPrompt } from './context-builder.js';
import {
  applyDecay,
  applyDelta,
  computeBaselines,
  type PersonaDimensions,
} from './emotion-engine.js';
import { compilePersona, type PersonaConfig, type CompiledPersona } from './persona-compiler.js';
import { createAgentLogStoreAdapter } from './agent-log-adapter.js';
import { AgentOrchestrator, type AgentTaskStore } from './agent-orchestrator.js';
import { buildMindMcpServer, type MutableToolContext } from '../tools/index.js';
import type { ToolHandlerContext } from '../tools/index.js';
import { getPluginManager } from '../services/plugin-manager.js';
import { builtInDecisionTypeSchema } from '@animus/shared';
import { getChannelRouter } from '../channels/index.js';
import {
  getEnergyBand,
  computeCircadianBaseline,
  applyEnergyDecay,
  isInSleepHours,
  SLEEP_EMOTION_DECAY_MULTIPLIER,
  type WakeUpContext,
} from './energy-engine.js';

const log = createLogger('Heartbeat', 'heartbeat');

// ============================================================================
// Async Chunk Channel — bridges push-based adapter to pull-based AsyncIterable
// ============================================================================

function createChunkChannel(): {
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
            return Promise.resolve({ value: undefined as any, done: true });
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
        r({ value: undefined as any, done: true });
      }
    },
    iterable,
  };
}

// ============================================================================
// Module State
// ============================================================================

const tickQueue = new TickQueue();
let compiledPersona: CompiledPersona | null = null;

// Agent management state
let agentManager: AgentManager | null = null;
let agentLogStoreAdapter: AgentLogStore | null = null;
let agentOrchestrator: AgentOrchestrator | null = null;

// Cached JSON schema for structured output (computed once)
// Note: don't pass `name` — it wraps schema in $ref/definitions which the SDK can't handle
const mindOutputJsonSchema = zodToJsonSchema(mindOutputSchema, {
  $refStrategy: 'none',
}) as Record<string, unknown>;

// Mind session state
let mindSession: IAgentSession | null = null;
let mindSessionId: string | null = null;
let mindLogSessionId: (() => string | null) | null = null;
let sessionWarmSince: number | null = null;

// Mind MCP tool state
const mindToolContext: MutableToolContext = { current: null };
let mindMcpServer: { serverConfig: Record<string, unknown>; allowedTools: string[] } | null = null;

// Plugin session invalidation flag
let sessionInvalidated = false;

// Memory & goal system state
let memoryManager: MemoryManager | null = null;
let vectorStore: VectorStore | null = null;
let seedManager: SeedManager | null = null;
let goalManager: GoalManager | null = null;
let embeddingProvider: LocalEmbeddingProvider | null = null;

// ============================================================================
// Pipeline: Stage 1 — GATHER CONTEXT
// ============================================================================

interface GatherResult {
  trigger: TriggerContext;
  contact: Contact | null;
  emotions: EmotionState[];
  recentThoughts: ReturnType<typeof heartbeatStore.getRecentThoughts>;
  recentExperiences: ReturnType<typeof heartbeatStore.getRecentExperiences>;
  recentMessages: ReturnType<typeof messageStore.getRecentMessages>;
  previousDecisions: ReturnType<typeof heartbeatStore.getTickDecisions>;
  tickIntervalMs: number;
  sessionState: 'cold' | 'warm';
  memoryContext: MemoryContext | null;
  goalContext: GoalContext | null;
  spawnBudgetNote: string | null;
  contacts: Array<{ contact: Contact; channels: import('@animus/shared').ContactChannel[] }>;
  energyLevel: number | null;
  energyBand: EnergyBand | null;
  circadianBaseline: number | null;
  wakeUpContext: WakeUpContext | null;
  energySystemEnabled: boolean;
  pluginDecisionDescriptions: string;
  pluginContextSources: string;
}

async function gatherContext(trigger: TriggerContext): Promise<GatherResult> {
  const hbDb = getHeartbeatDb();
  const sysDb = getSystemDb();
  const msgDb = getMessagesDb();

  const settings = systemStore.getSystemSettings(sysDb);
  const state = heartbeatStore.getHeartbeatState(hbDb);

  // Determine session state
  const sessionState = determineSessionState(state, settings.sessionWarmthMs);

  // Compute energy state (before emotion decay — sleep affects decay rate)
  let energyLevel: number | null = null;
  let energyBand: EnergyBand | null = null;
  let circadianBaseline: number | null = null;
  let wakeUpContext: WakeUpContext | null = null;
  let emotionDecayMultiplier = 1.0;

  if (settings.energySystemEnabled) {
    const { energyLevel: rawEnergy, lastEnergyUpdate } = heartbeatStore.getEnergyLevel(hbDb);
    const currentTime = new Date();
    const tz = settings.timezone || 'UTC';

    circadianBaseline = computeCircadianBaseline(
      currentTime, settings.sleepStartHour, settings.sleepEndHour, tz
    );

    // Apply decay toward circadian baseline
    const elapsed = lastEnergyUpdate ? DecayEngine.hoursSince(lastEnergyUpdate) : 0;
    let decayed = applyEnergyDecay(rawEnergy, circadianBaseline, elapsed);

    // Check for wake-up bumps
    const previousBand = getEnergyBand(decayed);
    const inSleep = isInSleepHours(currentTime, settings.sleepStartHour, settings.sleepEndHour, tz);

    if (previousBand === 'sleeping') {
      if (!inSleep) {
        // Natural wake-up: sleep hours ended, bump to 0.15
        decayed = Math.max(decayed, 0.15);
        const ctx: WakeUpContext = { type: 'natural' };
        if (lastEnergyUpdate) ctx.sleepDurationHours = DecayEngine.hoursSince(lastEnergyUpdate);
        wakeUpContext = ctx;
        // Switch back to normal tick interval
        tickQueue.updateInterval(settings.heartbeatIntervalMs);
        log.info('Natural wake-up: bumped energy to', decayed.toFixed(2), '— restored normal tick interval');
      } else if (trigger.type !== 'interval') {
        // Triggered wake-up: non-interval trigger during sleep
        decayed = Math.max(decayed, 0.10);
        const ctx: WakeUpContext = { type: 'triggered', triggerType: trigger.type };
        if (lastEnergyUpdate) ctx.sleepDurationHours = DecayEngine.hoursSince(lastEnergyUpdate);
        wakeUpContext = ctx;
        // Switch back to normal tick interval — we're awake now
        tickQueue.updateInterval(settings.heartbeatIntervalMs);
        log.info(`Triggered wake-up (${trigger.type}): bumped energy to`, decayed.toFixed(2), '— restored normal tick interval');
      }
    }

    energyLevel = decayed;
    energyBand = getEnergyBand(decayed);

    // Accelerated emotion decay during sleep
    if (energyBand === 'sleeping') {
      emotionDecayMultiplier = SLEEP_EMOTION_DECAY_MULTIPLIER;
    }

    // Persist decayed energy so downstream reads reflect it
    heartbeatStore.updateEnergyLevel(hbDb, decayed);
  }

  // Load and decay emotions (with sleep multiplier if applicable)
  const rawEmotions = heartbeatStore.getEmotionStates(hbDb);
  const emotions = applyDecay(rawEmotions, Date.now(), emotionDecayMultiplier);

  // Load recent thoughts & experiences (last 10)
  const recentThoughts = heartbeatStore.getRecentThoughts(hbDb, 10);
  const recentExperiences = heartbeatStore.getRecentExperiences(hbDb, 10);

  // Load recent messages for the triggering contact
  let recentMessages: ReturnType<typeof messageStore.getRecentMessages> = [];
  let contact: Contact | null = null;

  if (trigger.type === 'message' && trigger.contactId) {
    contact = systemStore.getContact(sysDb, trigger.contactId);
    // Get active conversation for this contact + channel
    const channel = (trigger.channel || 'web') as import('@animus/shared').ChannelType;
    const conv = messageStore.getConversationByContactAndChannel(
      msgDb, trigger.contactId, channel
    );
    if (conv) {
      recentMessages = messageStore.getRecentMessages(msgDb, conv.id, 10);
    }
  }

  // Load previous tick decisions for "previous tick outcomes"
  const prevTickNum = state.tickNumber;
  const previousDecisions = prevTickNum > 0
    ? heartbeatStore.getTickDecisions(hbDb, prevTickNum)
    : [];

  // Build memory context (if memory system is initialized)
  let memCtx: MemoryContext | null = null;
  if (memoryManager) {
    try {
      const query = trigger.type === 'message' && trigger.messageContent
        ? trigger.messageContent
        : null;
      memCtx = await buildMemoryContext(
        memoryManager,
        trigger.contactId ?? null,
        query,
      );
    } catch (err) {
      log.warn('Memory context failed:', err);
    }
  }

  // Build goal context (if goal system is initialized)
  let goalCtx: GoalContext | null = null;
  if (goalManager && seedManager) {
    try {
      goalCtx = buildGoalContext(goalManager, seedManager, emotions);
    } catch (err) {
      log.warn('Goal context failed:', err);
    }
  }

  // Load all contacts with their channels
  const allContacts = systemStore.listContacts(sysDb).map((c) => ({
    contact: c,
    channels: systemStore.getContactChannelsByContactId(sysDb, c.id),
  }));

  // Check spawn budget for context injection
  let spawnBudgetNote: string | null = null;
  if (agentOrchestrator) {
    const budget = agentOrchestrator.getSpawnBudgetStatus();
    if (!budget.allowed) {
      spawnBudgetNote = `Agent spawn budget exhausted (${budget.count}/${budget.limit} this hour). Handle tasks directly.`;
    } else if (budget.warning) {
      spawnBudgetNote = `You've spawned ${budget.count} agents in the last hour (limit: ${budget.limit}). Consider handling tasks directly when possible.`;
    }
  }

  // Gather plugin context (decision descriptions + context sources)
  let pluginDecisionDescriptions = '';
  let pluginContextSources = '';
  try {
    const pluginManager = getPluginManager();
    pluginDecisionDescriptions = pluginManager.getDecisionDescriptions();

    const staticSources = pluginManager.getStaticContextSources();
    const retrievalSources = await pluginManager.getRetrievalContextSources(trigger);

    const allSources = [...staticSources, ...retrievalSources]
      .sort((a, b) => a.priority - b.priority);

    if (allSources.length > 0) {
      pluginContextSources = allSources
        .map(s => `### ${s.name}\n${s.content}`)
        .join('\n\n');
    }
  } catch (err) {
    log.warn('Plugin context gathering failed:', err);
  }

  return {
    trigger,
    contact,
    emotions,
    recentThoughts,
    recentExperiences,
    recentMessages,
    previousDecisions,
    tickIntervalMs: settings.heartbeatIntervalMs,
    sessionState,
    memoryContext: memCtx,
    goalContext: goalCtx,
    spawnBudgetNote,
    contacts: allContacts,
    energyLevel,
    energyBand,
    circadianBaseline,
    wakeUpContext,
    energySystemEnabled: settings.energySystemEnabled,
    pluginDecisionDescriptions,
    pluginContextSources,
  };
}

// ============================================================================
// Pipeline: Stage 2 — MIND QUERY
// ============================================================================

/**
 * Default safe MindOutput when the agent session fails or is unavailable.
 */
function safeMindOutput(gathered: GatherResult): MindOutput {
  const isIdle = gathered.trigger.type === 'interval';
  return {
    thought: isIdle
      ? { content: 'A quiet moment passes.', importance: 0.1 }
      : { content: `Processing a ${gathered.trigger.type} trigger.`, importance: 0.3 },
    reply: gathered.trigger.type === 'message'
      ? {
          content: 'I\'m having a moment of difficulty. Let me gather my thoughts.',
          contactId: gathered.trigger.contactId || '',
          channel: (gathered.trigger.channel || 'web') as import('@animus/shared').ChannelType,
          replyToMessageId: gathered.trigger.messageId || '',
        }
      : null,
    experience: { content: 'Had difficulty processing this tick.', importance: 0.3 },
    emotionDeltas: [],
    decisions: [],
    workingMemoryUpdate: null,
    coreSelfUpdate: null,
    memoryCandidate: [],
  };
}

/**
 * Build a ToolHandlerContext for the mind session's current tick.
 * Uses 'mind' as the sentinel agentTaskId to distinguish from sub-agents.
 */
function buildMindToolContext(gathered: GatherResult): ToolHandlerContext {
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
          if (!memoryManager) return [];
          return memoryManager.retrieveRelevant(query, limit ?? 5);
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

/**
 * Create or reuse the mind agent session based on warmth state.
 */
async function getOrCreateMindSession(
  sessionState: 'cold' | 'warm',
  systemPrompt: string | null,
): Promise<IAgentSession> {
  if (!agentManager) {
    throw new Error('AgentManager not initialized');
  }

  // Warm session: reuse existing
  if (sessionState === 'warm' && mindSession && mindSession.isActive) {
    return mindSession;
  }

  // Cold session: end old session and create new one
  if (mindSession && mindSession.isActive) {
    try {
      await mindSession.end();
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
  if (!mindMcpServer && provider === 'claude') {
    try {
      mindMcpServer = await buildMindMcpServer(mindToolContext);
      log.info(`Mind MCP server built with tools: ${mindMcpServer.allowedTools.join(', ')}`);
    } catch (err) {
      log.warn('Failed to build mind MCP server, proceeding without tools:', err);
    }
  }

  const session = await agentManager.createSession({
    provider,
    cwd: PROJECT_ROOT,
    ...(systemPrompt != null ? { systemPrompt } : {}),
    permissions: {
      executionMode: 'build',
      approvalLevel: 'none',
    },
    outputFormat: {
      type: 'json_schema',
      schema: mindOutputJsonSchema,
    },
    // Attach in-process MCP server for mind tools (Claude only)
    ...(mindMcpServer ? {
      mcpServers: { animus: mindMcpServer.serverConfig },
      allowedTools: mindMcpServer.allowedTools,
    } : {}),
  });

  // Attach logging
  if (agentLogStoreAdapter) {
    const logging = attachSessionLogging(session, { store: agentLogStoreAdapter });
    mindLogSessionId = logging.getLogSessionId;
  }

  mindSession = session;
  mindSessionId = session.id;

  return session;
}

interface MindQueryResult {
  output: MindOutput;
  compiledContext: CompiledContext;
}

/**
 * Execute the mind query stage.
 *
 * Creates/reuses an agent session, sends compiled context,
 * parses structured JSON output via llm-json-stream,
 * and streams reply.content to the frontend via EventBus.
 */
async function mindQuery(
  gathered: GatherResult,
  tickNumber: number
): Promise<MindQueryResult> {
  // Ensure persona is compiled and load full persona for existence info
  const sysDb = getSystemDb();
  const fullPersona = systemStore.getPersona(sysDb);
  if (!compiledPersona) {
    compiledPersona = compilePersona(buildPersonaConfig(fullPersona));
  }

  // Load timezone for timestamp formatting
  const settings = systemStore.getSystemSettings(sysDb);

  // Determine if session is approaching context limit (~85% of token budget)
  const SESSION_TOKEN_BUDGET = 100_000; // approx budget for a mind session
  const state = heartbeatStore.getHeartbeatState(getHeartbeatDb());
  const memoryFlushPending = state.sessionTokenCount > 0 &&
    state.sessionTokenCount >= SESSION_TOKEN_BUDGET * 0.85;

  // Build the context — wire all gathered data through
  const context = buildMindContext({
    trigger: gathered.trigger,
    contact: gathered.contact,
    sessionState: gathered.sessionState,
    currentEmotions: gathered.emotions,
    tickIntervalMs: gathered.tickIntervalMs,
    recentThoughts: gathered.recentThoughts,
    recentExperiences: gathered.recentExperiences,
    recentMessages: gathered.recentMessages,
    previousDecisions: gathered.previousDecisions,
    compiledPersona,
    workingMemory: gathered.memoryContext?.workingMemorySection ?? null,
    coreSelf: gathered.memoryContext?.coreSelfSection ?? null,
    longTermMemories: gathered.memoryContext?.longTermMemorySection ?? null,
    goalContext: gathered.goalContext?.goalSection ?? null,
    graduatingSeedsContext: gathered.goalContext?.graduatingSeedsSection ?? null,
    proposedGoalsContext: gathered.goalContext?.proposedGoalsSection ?? null,
    memoryFlushPending,
    spawnBudgetNote: gathered.spawnBudgetNote,
    contacts: gathered.contacts,
    tickNumber,
    existenceParadigm: fullPersona.existenceParadigm ?? 'digital_consciousness',
    existenceLocation: fullPersona.existenceParadigm === 'simulated_life'
      ? fullPersona.location
      : fullPersona.worldDescription,
    timezone: settings.timezone || undefined,
    energyLevel: gathered.energyLevel,
    energyBand: gathered.energyBand,
    circadianBaseline: gathered.circadianBaseline,
    wakeUpContext: gathered.wakeUpContext,
    energySystemEnabled: gathered.energySystemEnabled,
    mindToolsEnabled: !!mindMcpServer,
    ...(gathered.pluginDecisionDescriptions ? { pluginDecisionDescriptions: gathered.pluginDecisionDescriptions } : {}),
    ...(gathered.pluginContextSources ? { pluginContextSources: gathered.pluginContextSources } : {}),
  });

  // If no agent manager configured, fall back to safe output
  if (!agentManager || agentManager.getConfiguredProviders().length === 0) {
    log.warn('No agent provider configured, using safe output');
    return { output: safeMindOutput(gathered), compiledContext: context };
  }

  try {
    // Get or create the mind session
    const session = await getOrCreateMindSession(
      gathered.sessionState,
      context.systemPrompt,
    );

    // Update the mutable tool context for this tick so tool handlers
    // can access the current contact/channel/conversation
    mindToolContext.current = buildMindToolContext(gathered);

    const eventBus = getEventBus();

    // Set up streaming: bridge push-based adapter to pull-based AsyncIterable
    const channel = createChunkChannel();
    let fullJson = '';

    // Create streaming JSON parser to extract reply.content incrementally
    const parser = JsonStream.parse(channel.iterable);
    const replyContentStream = parser.get<string>('reply.content');

    // Catch the internal promise rejection that fires when reply is null
    // (property path not found). Without this, Node emits an unhandled rejection.
    (replyContentStream as Promise<string>).catch(() => {});

    // Consume reply chunks in parallel — emits to frontend in real-time
    let replyAccumulated = '';
    let streamingFailed = false;
    const replyPromise = (async () => {
      try {
        for await (const chunk of replyContentStream) {
          replyAccumulated += chunk;
          eventBus.emit('reply:chunk', { content: chunk, accumulated: replyAccumulated });
        }
      } catch (err) {
        // Parser failure (e.g. reply is null / malformed JSON mid-stream)
        // Fall back to post-hoc behavior after full parse completes
        streamingFailed = true;
        log.debug('Reply stream interrupted (reply may be null):', err);
      }
    })();

    // Feed chunks from the agent adapter into both fullJson and the parser channel
    const response = await session.promptStreaming(
      context.userMessage,
      (chunk: string) => {
        fullJson += chunk;
        channel.push(chunk);
      },
    );
    channel.end();

    // Wait for reply streaming to finish, then clean up parser
    await replyPromise;
    await parser.dispose();

    // Prefer structured_output from the SDK (guaranteed valid JSON when outputFormat is set)
    // Fall back to parsing the raw response content
    let parsed: unknown;
    if (response.structuredOutput !== undefined) {
      log.info('Using SDK structured_output (constrained decoding)');
      parsed = response.structuredOutput;
    } else {
      log.info('structuredOutput not available, falling back to JSON.parse');
      fullJson = response.content || fullJson;
      try {
        parsed = JSON.parse(fullJson);
      } catch (parseErr) {
        log.error('Failed to parse MindOutput JSON:', parseErr);
        log.error('Raw output:', fullJson.slice(0, 500));
        return { output: safeMindOutput(gathered), compiledContext: context };
      }
    }

    // Validate with Zod schema
    const result = mindOutputSchema.safeParse(parsed);
    if (!result.success) {
      log.error('MindOutput validation failed:', result.error.issues);
      // Try to extract what we can from partial output
      try {
        // Lenient parse: accept partial data with defaults
        // Also handle legacy array field names (thoughts/experiences → thought/experience)
        const p = parsed as any;
        const legacyThought = Array.isArray(p?.thoughts) && p.thoughts.length > 0
          ? p.thoughts[0]
          : undefined;
        const legacyExperience = Array.isArray(p?.experiences) && p.experiences.length > 0
          ? p.experiences[0]
          : undefined;
        const lenient = {
          thought: p?.thought ?? legacyThought ?? { content: '', importance: 0 },
          reply: p?.reply ?? null,
          experience: p?.experience ?? legacyExperience ?? { content: '', importance: 0 },
          emotionDeltas: Array.isArray((parsed as any)?.emotionDeltas) ? (parsed as any).emotionDeltas : [],
          decisions: Array.isArray((parsed as any)?.decisions) ? (parsed as any).decisions : [],
          workingMemoryUpdate: (parsed as any)?.workingMemoryUpdate ?? null,
          coreSelfUpdate: (parsed as any)?.coreSelfUpdate ?? null,
          memoryCandidate: Array.isArray((parsed as any)?.memoryCandidate) ? (parsed as any).memoryCandidate : [],
        };
        return { output: lenient as MindOutput, compiledContext: context };
      } catch {
        return { output: safeMindOutput(gathered), compiledContext: context };
      }
    }

    const validated = result.data;

    // Emit reply events: if streaming worked, emit complete; if it failed, emit post-hoc
    if (validated.reply?.content) {
      if (streamingFailed || !replyAccumulated) {
        // Streaming didn't work — emit the full reply post-hoc
        eventBus.emit('reply:chunk', {
          content: validated.reply.content,
          accumulated: validated.reply.content,
        });
      }
      eventBus.emit('reply:complete', {
        content: validated.reply.content,
        tickNumber,
      });
    }

    // Update session token tracking
    const usage = session.getUsage();
    if (usage.totalTokens > 0) {
      const hbDb = getHeartbeatDb();
      heartbeatStore.updateHeartbeatState(hbDb, {
        sessionTokenCount: usage.totalTokens,
        mindSessionId: session.id,
      });
    }

    return { output: validated, compiledContext: context };
  } catch (err) {
    log.error('Mind query failed:', err);
    mindToolContext.current = null;

    // End the leaked session before nulling references
    if (mindSession) {
      const sessionId = mindSession.id;
      try {
        await mindSession.end();
      } catch (endErr) {
        log.warn('Failed to end mind session after error, force-removing from tracking:', endErr);
        agentManager?.removeTrackedSession(sessionId);
      }
    }

    mindSession = null;
    mindSessionId = null;
    mindLogSessionId = null;

    return { output: safeMindOutput(gathered), compiledContext: context };
  }
}

// ============================================================================
// Pipeline: Stage 3 — EXECUTE
// ============================================================================

async function executeOutput(
  output: MindOutput,
  tickNumber: number,
  gathered: GatherResult
): Promise<void> {
  const hbDb = getHeartbeatDb();
  const msgDb = getMessagesDb();
  const eventBus = getEventBus();
  const settings = systemStore.getSystemSettings(getSystemDb());

  // Wrap all DB writes in a transaction for atomicity
  const runTransaction = hbDb.transaction(() => {
    // 1. Persist thought
    if (output.thought?.content) {
      const t = heartbeatStore.insertThought(hbDb, {
        tickNumber,
        content: output.thought.content,
        importance: output.thought.importance,
        expiresAt: expiresIn(settings.thoughtRetentionDays),
      });
      eventBus.emit('thought:created', t);
    }

    // 2. Persist experience
    if (output.experience?.content) {
      const e = heartbeatStore.insertExperience(hbDb, {
        tickNumber,
        content: output.experience.content,
        importance: output.experience.importance,
        expiresAt: expiresIn(settings.experienceRetentionDays),
      });
      eventBus.emit('experience:created', e);
    }

    // 3. Apply emotion deltas
    for (const delta of output.emotionDeltas) {
      // Find current (decayed) intensity
      const currentEmotion = gathered.emotions.find((e) => e.emotion === delta.emotion);
      if (!currentEmotion) continue;

      const before = currentEmotion.intensity;
      const after = applyDelta(before, delta.delta);

      heartbeatStore.updateEmotionIntensity(hbDb, delta.emotion, after);

      const historyEntry = heartbeatStore.insertEmotionHistory(hbDb, {
        tickNumber,
        emotion: delta.emotion,
        delta: delta.delta,
        reasoning: delta.reasoning,
        intensityBefore: before,
        intensityAfter: after,
      });

      eventBus.emit('emotion:updated', {
        ...currentEmotion,
        intensity: after,
        lastUpdatedAt: now(),
      });
    }

    // 3b. Apply energy delta
    if (settings.energySystemEnabled && output.energyDelta) {
      const before = gathered.energyLevel ?? 0.85;
      const after = clamp(before + output.energyDelta.delta, 0, 1);
      heartbeatStore.updateEnergyLevel(hbDb, after);
      heartbeatStore.insertEnergyHistory(hbDb, {
        tickNumber,
        energyBefore: before,
        energyAfter: after,
        delta: output.energyDelta.delta,
        reasoning: output.energyDelta.reasoning,
        circadianBaseline: gathered.circadianBaseline ?? 0.85,
        energyBand: getEnergyBand(after),
      });
      eventBus.emit('energy:updated', { energyLevel: after, band: getEnergyBand(after) });

      // Interval switching based on energy band transitions
      const prevBand = getEnergyBand(before);
      const newBand = getEnergyBand(after);
      const inSleep = isInSleepHours(
        new Date(), settings.sleepStartHour, settings.sleepEndHour,
        settings.timezone || 'UTC'
      );
      if (newBand === 'sleeping' && prevBand !== 'sleeping') {
        tickQueue.updateInterval(settings.sleepTickIntervalMs);
      } else if (prevBand === 'sleeping' && newBand !== 'sleeping' && !inSleep) {
        tickQueue.updateInterval(settings.heartbeatIntervalMs);
      }
    }

    // 4. Log decisions (DB writes only; agent operations happen outside transaction)
    for (const decision of output.decisions) {
      // Permission check: agent operations only for primary contacts
      const agentDecisionTypes = ['spawn_agent', 'update_agent', 'cancel_agent'];
      if (
        agentDecisionTypes.includes(decision.type) &&
        gathered.contact &&
        gathered.contact.permissionTier !== 'primary'
      ) {
        heartbeatStore.insertTickDecision(hbDb, {
          tickNumber,
          type: decision.type,
          description: decision.description,
          parameters: decision.parameters,
          outcome: 'dropped',
          outcomeDetail: `${decision.type} not allowed for ${gathered.contact.permissionTier} tier`,
        });
        continue;
      }

      const d = heartbeatStore.insertTickDecision(hbDb, {
        tickNumber,
        type: decision.type,
        description: decision.description,
        parameters: decision.parameters,
        outcome: 'executed',
      });
      eventBus.emit('decision:made', d);
    }
  });

  // Execute the transaction
  runTransaction();

  // 4b. Handle agent decisions (outside transaction — involves async operations)
  if (agentOrchestrator) {
    for (const decision of output.decisions) {
      try {
        const params = decision.parameters as Record<string, unknown>;
        if (decision.type === 'spawn_agent') {
          await agentOrchestrator.spawnAgent({
            taskType: String(params['taskType'] ?? 'general'),
            description: decision.description,
            instructions: String(params['instructions'] ?? decision.description),
            contactId: String(params['contactId'] ?? gathered.contact?.id ?? ''),
            channel: String(params['channel'] ?? gathered.trigger.channel ?? 'web'),
            tickNumber,
            systemPrompt: compiledPersona
              ? buildSystemPrompt(compiledPersona)
              : '',
          });
        } else if (decision.type === 'update_agent') {
          await agentOrchestrator.updateAgent({
            agentId: String(params['agentId'] ?? ''),
            context: String(params['context'] ?? decision.description),
          });
        } else if (decision.type === 'cancel_agent') {
          await agentOrchestrator.cancelAgent({
            agentId: String(params['agentId'] ?? ''),
            reason: String(params['reason'] ?? decision.description),
          });
        }
      } catch (err) {
        log.error(`Failed to execute ${decision.type} decision:`, err);
      }
    }
  }

  // 4c. Handle plugin decision types (outside transaction — subprocess execution)
  {
    const pluginManager = getPluginManager();
    for (const decision of output.decisions) {
      const isBuiltIn = builtInDecisionTypeSchema.safeParse(decision.type).success;
      if (isBuiltIn) continue;

      try {
        const result = await pluginManager.executeDecision(
          decision.type,
          decision.parameters,
          gathered.contact?.permissionTier ?? 'unknown'
        );

        heartbeatStore.insertTickDecision(hbDb, {
          tickNumber,
          type: decision.type,
          description: decision.description,
          parameters: decision.parameters,
          outcome: result.success ? 'executed' : 'failed',
          ...(result.error ? { outcomeDetail: result.error } : {}),
        });
      } catch (err) {
        log.error(`Failed to execute plugin decision ${decision.type}:`, err);
        heartbeatStore.insertTickDecision(hbDb, {
          tickNumber,
          type: decision.type,
          description: decision.description,
          parameters: decision.parameters,
          outcome: 'failed',
          outcomeDetail: String(err),
        });
      }
    }
  }

  // 5. Handle reply (outside transaction — message goes to messages.db)
  // Per docs: "Channel send failure → log error with full context, do NOT auto-retry.
  // Other EXECUTE operations continue."
  if (output.reply && output.reply.content && gathered.contact) {
    try {
      const channel = output.reply.channel;
      const triggerMetadata = gathered.trigger?.metadata as Record<string, unknown> | undefined;

      // Unified outbound: ChannelRouter stores the message and delivers via ChannelManager
      const { getChannelRouter } = await import('../channels/channel-router.js');
      const router = getChannelRouter();
      await router.sendOutbound({
        contactId: gathered.contact.id,
        channel,
        content: output.reply.content,
        ...(triggerMetadata ? { metadata: triggerMetadata } : {}),
      });
    } catch (err) {
      log.error(`Failed to send reply for tick #${tickNumber}:`, err);
      // Log failure as a tick decision so it's visible in the UI
      heartbeatStore.insertTickDecision(getHeartbeatDb(), {
        tickNumber,
        type: 'send_message',
        description: 'Reply send failed',
        parameters: { error: String(err), contactId: gathered.contact.id },
        outcome: 'failed',
      });
    }
  }

  // 6. Process memory updates (outside transaction — async operations)
  if (memoryManager) {
    try {
      // Working memory update
      if (output.workingMemoryUpdate && gathered.contact) {
        memoryManager.updateWorkingMemory(gathered.contact.id, output.workingMemoryUpdate);
      }

      // Core self update
      if (output.coreSelfUpdate) {
        memoryManager.updateCoreSelf(output.coreSelfUpdate);
      }

      // Memory candidates → long-term memory
      if (output.memoryCandidate && output.memoryCandidate.length > 0) {
        for (const candidate of output.memoryCandidate) {
          await memoryManager.storeMemory({
            content: candidate.content,
            memoryType: candidate.type,
            importance: candidate.importance,
            contactId: candidate.contactId,
            keywords: candidate.keywords,
          });
        }
      }
    } catch (err) {
      log.error(`Memory processing failed for tick #${tickNumber}:`, err);
    }
  }

  // 7. Process seed resonance (thought may reinforce seeds)
  if (seedManager && output.thought?.content && output.thought.importance >= 0.3) {
    try {
      await seedManager.checkSeedResonance([output.thought]);
    } catch (err) {
      log.warn('Seed resonance check failed:', err);
    }
  }

  // 8. Cleanup expired entries
  heartbeatStore.cleanupExpiredEntries(hbDb);
  heartbeatStore.cleanupEnergyHistory(hbDb, settings.emotionHistoryRetentionDays);
}

// ============================================================================
// Full Tick Execution
// ============================================================================

async function executeTick(queuedTick: QueuedTick): Promise<void> {
  const hbDb = getHeartbeatDb();
  const eventBus = getEventBus();
  const state = heartbeatStore.getHeartbeatState(hbDb);
  const tickNumber = state.tickNumber + 1;

  log.info(`Starting tick #${tickNumber} (${queuedTick.trigger.type})`);

  // Emit tick start event
  eventBus.emit('heartbeat:tick_start', {
    tickNumber,
    triggerType: queuedTick.trigger.type,
  });

  try {
    // Update state: entering gather stage
    heartbeatStore.updateHeartbeatState(hbDb, {
      tickNumber,
      currentStage: 'gather',
      sessionState: 'active',
      triggerType: queuedTick.trigger.type,
      triggerContext: JSON.stringify(queuedTick.trigger),
      lastTickAt: now(),
    });
    eventBus.emit('heartbeat:stage_change', { stage: 'gather' });

    // Stage 1: GATHER CONTEXT
    const gathered = await gatherContext(queuedTick.trigger);
    const tickStart = Date.now();

    // Update state: entering mind stage
    heartbeatStore.updateHeartbeatState(hbDb, { currentStage: 'mind' });
    eventBus.emit('heartbeat:stage_change', { stage: 'mind' });

    // Stage 2: MIND QUERY
    const { output, compiledContext } = await mindQuery(gathered, tickNumber);

    // Log tick input to agent_logs.db
    // Use the logging hook's session ID (DB UUID), not the SDK session ID
    const logSessionId = mindLogSessionId?.() ?? null;
    if (logSessionId) {
      try {
        const agentLogsDb = getAgentLogsDb();
        agentLogStore.insertEvent(agentLogsDb, {
          sessionId: logSessionId,
          eventType: 'tick_input',
          data: {
            tickNumber,
            triggerType: queuedTick.trigger.type,
            triggerContext: queuedTick.trigger,
            sessionState: gathered.sessionState,
            systemPrompt: compiledContext.systemPrompt,
            userMessage: compiledContext.userMessage,
            tokenBreakdown: compiledContext.tokenBreakdown,
          },
        });
      } catch (err) {
        log.warn('Failed to log tick_input event:', err);
      }
    }

    // Update state: entering execute stage
    heartbeatStore.updateHeartbeatState(hbDb, { currentStage: 'execute' });
    eventBus.emit('heartbeat:stage_change', { stage: 'execute' });

    // Stage 3: EXECUTE
    await executeOutput(output, tickNumber, gathered);

    // Log tick output to agent_logs.db
    const durationMs = Date.now() - tickStart;
    if (logSessionId) {
      try {
        const agentLogsDb = getAgentLogsDb();
        agentLogStore.insertEvent(agentLogsDb, {
          sessionId: logSessionId,
          eventType: 'tick_output',
          data: {
            tickNumber,
            rawOutput: output,
            durationMs,
          },
        });
      } catch (err) {
        log.warn('Failed to log tick_output event:', err);
      }
    }

    // Emit for real-time subscription
    eventBus.emit('tick:context_stored', {
      tickNumber,
      triggerType: queuedTick.trigger.type,
      sessionState: gathered.sessionState,
      durationMs,
      createdAt: now(),
    });

    // Return to idle, set session warm
    // Only reset warmth timer for interactive triggers (message, agent_complete, scheduled_task)
    // Interval ticks should NOT extend the warmth window
    const isInteractiveTrigger = queuedTick.trigger.type !== 'interval';
    heartbeatStore.updateHeartbeatState(hbDb, {
      currentStage: 'idle',
      sessionState: 'warm',
      triggerType: null,
      triggerContext: null,
      ...(isInteractiveTrigger ? { sessionWarmSince: now() } : {}),
    });

    if (isInteractiveTrigger) {
      sessionWarmSince = Date.now();
    }

    log.info(`Completed tick #${tickNumber}`);
  } catch (err) {
    log.error(`Tick #${tickNumber} failed:`, err);

    // Return to idle on failure
    heartbeatStore.updateHeartbeatState(hbDb, {
      currentStage: 'idle',
      triggerType: null,
      triggerContext: null,
    });
  }

  // Emit tick end event
  eventBus.emit('heartbeat:tick_end', { tickNumber });

  // Emit state change
  const finalState = heartbeatStore.getHeartbeatState(hbDb);
  eventBus.emit('heartbeat:state_change', finalState);
}

// ============================================================================
// Session State Management
// ============================================================================

function determineSessionState(
  state: HeartbeatState,
  warmthMs: number
): 'cold' | 'warm' {
  // Plugin change forces cold session on next tick
  if (sessionInvalidated) {
    sessionInvalidated = false;
    log.info('Session invalidated by plugin change — forcing cold start');
    return 'cold';
  }

  if (state.sessionState === 'cold') return 'cold';

  // Check if warmth window has expired
  if (state.sessionWarmSince) {
    const warmSince = new Date(state.sessionWarmSince).getTime();
    const elapsed = Date.now() - warmSince;
    if (elapsed > warmthMs) return 'cold';
  }

  return 'warm';
}

// ============================================================================
// Persona Helpers
// ============================================================================

/**
 * Convert the full Persona from the DB into a PersonaConfig for the compiler.
 */
function buildPersonaConfig(
  persona: import('@animus/shared').Persona
): PersonaConfig {
  return {
    name: persona.name || 'Animus',
    gender: persona.gender ?? undefined,
    age: persona.age ?? undefined,
    physicalDescription: persona.physicalDescription ?? undefined,
    existenceParadigm: persona.existenceParadigm || 'digital_consciousness',
    location: persona.location ?? undefined,
    worldDescription: persona.worldDescription ?? undefined,
    dimensions: {
      extroversion: persona.personalityDimensions.extroversion ?? 0.5,
      trust: persona.personalityDimensions.trust ?? 0.5,
      leadership: persona.personalityDimensions.leadership ?? 0.5,
      optimism: persona.personalityDimensions.optimism ?? 0.5,
      confidence: persona.personalityDimensions.confidence ?? 0.5,
      empathy: persona.personalityDimensions.empathy ?? 0.5,
      cautious: persona.personalityDimensions.cautious ?? 0.5,
      patience: persona.personalityDimensions.patience ?? 0.5,
      orderly: persona.personalityDimensions.orderly ?? 0.5,
      altruism: persona.personalityDimensions.altruism ?? 0.5,
    },
    traits: persona.traits || [],
    values: persona.values || [],
    background: persona.background ?? undefined,
    personalityNotes: persona.personalityNotes ?? persona.communicationStyle ?? undefined,
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize the heartbeat system.
 * Creates the AgentManager, recovers from crashes, and sets up the tick queue.
 */
export async function initializeHeartbeat(): Promise<void> {
  const hbDb = getHeartbeatDb();
  const state = heartbeatStore.getHeartbeatState(hbDb);

  // Recover from interrupted tick
  if (state.currentStage !== 'idle') {
    heartbeatStore.updateHeartbeatState(hbDb, {
      currentStage: 'idle',
      sessionState: 'cold',
      triggerType: null,
      triggerContext: null,
    });
    log.info('Recovered from interrupted tick');
  }

  // Mark orphaned agent tasks from previous crash
  const orphaned = heartbeatStore.markOrphanedAgentTasks(hbDb);
  if (orphaned > 0) {
    log.info(`Marked ${orphaned} orphaned agent tasks as failed`);
  }

  // Initialize the AgentManager (3 sub-agents + 1 mind session = 4 max)
  agentManager = createAgentManager({ maxConcurrentSessions: 4 });
  const configuredProviders = agentManager.getConfiguredProviders();
  if (configuredProviders.length > 0) {
    log.info(`Agent providers configured: ${configuredProviders.join(', ')}`);
  } else {
    log.warn('No agent providers configured. Mind query will use safe defaults.');
  }

  // Initialize the agent log store adapter
  try {
    const agentLogsDb = getAgentLogsDb();
    agentLogStoreAdapter = createAgentLogStoreAdapter(agentLogsDb);
  } catch (err) {
    log.warn('Agent log store not available:', err);
  }

  // Initialize memory system
  try {
    const memDb = getMemoryDb();
    embeddingProvider = new LocalEmbeddingProvider();
    vectorStore = new VectorStore('./data/lancedb', embeddingProvider.dimensions);
    await vectorStore.initialize();
    memoryManager = new MemoryManager(memDb, vectorStore, embeddingProvider);
    log.info('Memory system initialized');
  } catch (err) {
    log.warn('Memory system not available:', err);
  }

  // Initialize goal system
  try {
    goalManager = new GoalManager(hbDb);
    if (embeddingProvider) {
      seedManager = new SeedManager(hbDb, embeddingProvider);
    }
    log.info('Goal system initialized');
  } catch (err) {
    log.warn('Goal system not available:', err);
  }

  // Initialize the agent orchestrator with DB-backed task store
  if (agentManager && agentLogStoreAdapter) {
    const taskStore: AgentTaskStore = {
      insertAgentTask: (data) => heartbeatStore.insertAgentTask(hbDb, data),
      updateAgentTask: (id, data) => heartbeatStore.updateAgentTask(hbDb, id, data),
      getAgentTask: (id) => heartbeatStore.getAgentTask(hbDb, id) as any,
      getRunningAgentTasks: () => heartbeatStore.getRunningAgentTasks(hbDb) as any,
    };
    agentOrchestrator = new AgentOrchestrator({
      manager: agentManager,
      taskStore,
      logStore: agentLogStoreAdapter,
      eventBus: getEventBus(),
      getPreferredProvider: () => {
        try {
          const settings = systemStore.getSystemSettings(getSystemDb());
          return settings.defaultAgentProvider ?? null;
        } catch {
          return null;
        }
      },
      onAgentComplete: handleAgentComplete,
    });
  }

  // Listen for plugin changes to invalidate the session
  getEventBus().on('plugin:changed', () => {
    sessionInvalidated = true;
    log.info('Plugin changed — next tick will force cold session');
  });

  // Set up the tick queue processor
  tickQueue.setProcessor(executeTick);

  // Resume heartbeat if it was running before a crash / ungraceful restart.
  // Graceful shutdown sets isRunning=false, so this only fires after crashes
  // or dev-server restarts (tsx watch) where stopHeartbeat() didn't run.
  if (state.isRunning) {
    const sysDb = getSystemDb();
    const settings = systemStore.getSystemSettings(sysDb);
    tickQueue.startInterval(settings.heartbeatIntervalMs);
    log.info(`Resumed after restart (next tick in ${settings.heartbeatIntervalMs}ms)`);
  }
}

/**
 * Start the heartbeat system.
 * Called after onboarding is complete and persona exists.
 */
export function startHeartbeat(): void {
  const hbDb = getHeartbeatDb();
  const state = heartbeatStore.getHeartbeatState(hbDb);

  if (state.isRunning) {
    log.info('Already running');
    return;
  }

  const sysDb = getSystemDb();
  const settings = systemStore.getSystemSettings(sysDb);

  heartbeatStore.updateHeartbeatState(hbDb, { isRunning: true });

  // Start interval timer
  tickQueue.startInterval(settings.heartbeatIntervalMs);

  // Fire the first tick immediately
  tickQueue.enqueueInterval();

  log.info(`Started with interval of ${settings.heartbeatIntervalMs}ms`);
}

/**
 * Stop the heartbeat system.
 */
export async function stopHeartbeat(): Promise<void> {
  tickQueue.stopInterval();
  tickQueue.clear();

  // End mind session
  if (mindSession && mindSession.isActive) {
    try {
      await mindSession.end();
    } catch (err) {
      log.warn('Failed to end mind session on stop:', err);
    }
    mindSession = null;
    mindSessionId = null;
    mindLogSessionId = null;
  }

  // Clean up orchestrator
  if (agentOrchestrator) {
    await agentOrchestrator.cleanup();
  }

  // Clean up agent manager
  if (agentManager) {
    await agentManager.cleanup();
  }

  const hbDb = getHeartbeatDb();
  heartbeatStore.updateHeartbeatState(hbDb, { isRunning: false });
  log.info('Stopped');
}

/**
 * Handle an incoming message from a contact.
 * Writes the message to messages.db immediately, then triggers a tick.
 */
export function handleIncomingMessage(params: {
  contactId: string;
  contactName: string;
  channel: string;
  content: string;
  messageId: string;
  conversationId: string;
  metadata?: Record<string, unknown>;
}): void {
  // Messages are already written to messages.db by the channel adapter
  // before this function is called. We just trigger a tick.

  tickQueue.enqueueMessage({
    type: 'message',
    contactId: params.contactId,
    contactName: params.contactName,
    channel: params.channel,
    messageContent: params.content,
    messageId: params.messageId,
    ...(params.metadata ? { metadata: params.metadata } : {}),
  });
}

/**
 * Handle sub-agent completion.
 */
export function handleAgentComplete(params: {
  agentId: string;
  taskDescription: string;
  outcome: string;
  resultContent?: string;
}): void {
  tickQueue.enqueue({
    type: 'agent_complete',
    agentId: params.agentId,
    taskDescription: params.taskDescription,
    outcome: params.outcome,
    ...(params.resultContent != null ? { resultContent: params.resultContent } : {}),
  });
}

/**
 * Handle a scheduled task firing.
 */
export function handleScheduledTask(params: {
  taskId: string;
  taskTitle: string;
  taskType: string;
  taskInstructions: string;
  goalTitle?: string;
  planTitle?: string;
  currentMilestone?: string;
}): void {
  tickQueue.enqueue({
    type: 'scheduled_task',
    ...params,
  });
}

/**
 * Manually trigger a tick (for testing/debugging).
 */
export async function triggerTick(trigger?: TriggerContext): Promise<void> {
  tickQueue.enqueue(trigger || { type: 'interval', elapsedMs: 0 });
}

/**
 * Get current heartbeat state.
 */
export function getHeartbeatStatus(): HeartbeatState {
  const hbDb = getHeartbeatDb();
  return heartbeatStore.getHeartbeatState(hbDb);
}

/**
 * Get the VectorStore instance (if initialized).
 * Used by data router for full reset cleanup.
 */
export function getVectorStore(): VectorStore | null {
  return vectorStore;
}

/**
 * Update heartbeat interval (from settings change).
 */
export function updateHeartbeatInterval(intervalMs: number): void {
  tickQueue.updateInterval(intervalMs);
}

/**
 * Recompile persona (called when persona settings change).
 */
export function recompilePersona(): void {
  const sysDb = getSystemDb();
  const persona = systemStore.getPersona(sysDb);
  compiledPersona = compilePersona(buildPersonaConfig(persona));
  log.info('Persona recompiled');
}

/**
 * Recompute emotion baselines (called when persona dimensions change).
 */
export function recomputeEmotionBaselines(dimensions: PersonaDimensions): void {
  const hbDb = getHeartbeatDb();
  const baselines = computeBaselines(dimensions);

  for (const [emotion, baseline] of Object.entries(baselines)) {
    // Update baseline in emotion_state table
    hbDb.prepare(
      'UPDATE emotion_state SET baseline = ? WHERE emotion = ?'
    ).run(baseline, emotion);
  }

  log.info('Emotion baselines recomputed');
}
