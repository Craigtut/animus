/**
 * Heartbeat System
 *
 * The heartbeat is the core tick system that drives Animus's inner life.
 * Architecture: 3-stage pipeline (Gather -> Mind -> Execute)
 *
 * This file is the orchestration spine. Pipeline stages are implemented in:
 *   - gather-context.ts    (Stage 1: GATHER)
 *   - mind-session.ts      (Session lifecycle)
 *   - cognitive-tools.ts   (Cognitive MCP tools + snapshot-to-MindOutput)
 *   - decision-executor.ts (Decision execution)
 *   - execute-output.ts    (Stage 3: EXECUTE)
 *
 * See docs/architecture/heartbeat.md for the full design.
 */

import { getHeartbeatDb, getSystemDb, getPersonaDb, getAgentLogsDb, getMemoryDb } from '../db/index.js';
import * as heartbeatStore from '../db/stores/heartbeat-store.js';
import * as agentLogStore from '../db/stores/agent-log-store.js';
import * as systemStore from '../db/stores/system-store.js';
import * as personaStore from '../db/stores/persona-store.js';
import { getEventBus } from '../lib/event-bus.js';
import { createLogger } from '../lib/logger.js';
import { env, LANCEDB_PATH } from '../utils/env.js';
import { now } from '@animus-labs/shared';
import type { HeartbeatState, MindOutput } from '@animus-labs/shared';

import { MemoryManager, LocalEmbeddingProvider, VectorStore } from '../memory/index.js';
import { SeedManager, GoalManager } from '../goals/index.js';
import { getTaskScheduler } from '../tasks/index.js';

import {
  createAgentManager,
  type AgentManager,
  type AgentLogStore,
} from '@animus-labs/agents';

import { TickQueue, type QueuedTick } from './tick-queue.js';
import { type TriggerContext, type CompiledContext, buildMindContext, buildSystemPrompt } from './context-builder.js';
import { computeBaselines, type PersonaDimensions } from './emotion-engine.js';
import { compilePersona, type PersonaConfig, type CompiledPersona } from './persona-compiler.js';
import { createAgentLogStoreAdapter } from './agent-log-adapter.js';
import { AgentOrchestrator, type AgentTaskStore, type AgentTaskRecord } from './agent-orchestrator.js';

// Extracted modules
import { gatherContext, type GatherResult } from './gather-context.js';
import {
  createMindSessionState,
  getOrCreateMindSession,
  buildMindToolContext,
  resetMindSession,
  type MindSessionState,
} from './mind-session.js';
import { safeMindOutput, snapshotToMindOutput, isNonResponse } from './cognitive-tools.js';
import { executeOutput } from './execute-output.js';

const log = createLogger('Heartbeat', 'heartbeat');

// ============================================================================
// HeartbeatContext — encapsulates all module-level state
// ============================================================================

class HeartbeatContext {
  agentManager: AgentManager | null = null;
  agentLogStoreAdapter: AgentLogStore | null = null;
  agentOrchestrator: AgentOrchestrator | null = null;
  compiledPersona: CompiledPersona | null = null;
  memoryManager: MemoryManager | null = null;
  vectorStore: VectorStore | null = null;
  seedManager: SeedManager | null = null;
  goalManager: GoalManager | null = null;
  embeddingProvider: LocalEmbeddingProvider | null = null;
  mindSession: MindSessionState;

  constructor() {
    this.mindSession = createMindSessionState();
  }
}

const ctx = new HeartbeatContext();
const tickQueue = new TickQueue();

// ============================================================================
// Persona Helpers
// ============================================================================

/**
 * Convert the full Persona from the DB into a PersonaConfig for the compiler.
 */
function buildPersonaConfig(
  persona: import('@animus-labs/shared').Persona
): PersonaConfig {
  return {
    name: persona.name || 'Animus',
    ...(persona.gender != null && { gender: persona.gender }),
    ...(persona.age != null && { age: persona.age }),
    ...(persona.physicalDescription != null && { physicalDescription: persona.physicalDescription }),
    existenceParadigm: persona.existenceParadigm || 'digital_consciousness',
    ...(persona.location != null && { location: persona.location }),
    ...(persona.worldDescription != null && { worldDescription: persona.worldDescription }),
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
    ...(persona.background != null && { background: persona.background }),
    ...((persona.personalityNotes ?? persona.communicationStyle) != null && { personalityNotes: (persona.personalityNotes ?? persona.communicationStyle)! }),
  };
}

// ============================================================================
// Pipeline: Stage 2 -- MIND QUERY
// ============================================================================

interface MindQueryResult {
  output: MindOutput;
  compiledContext: CompiledContext;
  replySentEarly: boolean;
  /** The content that was sent optimistically via streaming (if any). */
  earlyReplyContent: string;
  tickInputLogged: boolean;
  /** All thoughts from this tick (may be > 1 if mid-tick injection caused re-entry). */
  allThoughts: Array<{ content: string; importance: number }>;
  /** How many reply turns were already sent via sendOutbound during streaming. */
  replyTurnsSent: number;
}

/**
 * Execute the mind query stage.
 *
 * Creates/reuses an agent session, sends compiled context,
 * captures structured state via cognitive MCP tools (record_thought +
 * record_cognitive_state), and streams reply text via phase tracking.
 */
async function mindQuery(
  gathered: GatherResult,
  tickNumber: number
): Promise<MindQueryResult> {
  // Ensure persona is compiled and load full persona for existence info
  const sysDb = getSystemDb();
  const fullPersona = personaStore.getPersona(getPersonaDb());
  if (!ctx.compiledPersona) {
    ctx.compiledPersona = compilePersona(buildPersonaConfig(fullPersona));
  }

  // Load timezone for timestamp formatting
  const settings = systemStore.getSystemSettings(sysDb);

  // Determine if session is approaching context limit (~85% of token budget)
  const SESSION_TOKEN_BUDGET = 100_000; // approx budget for a mind session
  const state = heartbeatStore.getHeartbeatState(getHeartbeatDb());
  const memoryFlushPending = state.sessionTokenCount > 0 &&
    state.sessionTokenCount >= SESSION_TOKEN_BUDGET * 0.85;

  // Build the context -- wire all gathered data through
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
    compiledPersona: ctx.compiledPersona,
    workingMemory: gathered.memoryContext?.workingMemorySection ?? null,
    coreSelf: gathered.memoryContext?.coreSelfSection ?? null,
    longTermMemories: gathered.memoryContext?.longTermMemorySection ?? null,
    goalContext: gathered.goalContext?.goalSection ?? null,
    graduatingSeedsContext: gathered.goalContext?.graduatingSeedsSection ?? null,
    proposedGoalsContext: gathered.goalContext?.proposedGoalsSection ?? null,
    planningPromptsContext: gathered.goalContext?.planningPromptsSection ?? null,
    memoryFlushPending,
    spawnBudgetNote: gathered.spawnBudgetNote,
    contacts: gathered.contacts,
    tickNumber,
    existenceParadigm: fullPersona.existenceParadigm ?? 'digital_consciousness',
    existenceLocation: fullPersona.existenceParadigm === 'simulated_life'
      ? fullPersona.location
      : fullPersona.worldDescription,
    ...(settings.timezone ? { timezone: settings.timezone } : {}),
    energyLevel: gathered.energyLevel,
    energyBand: gathered.energyBand,
    circadianBaseline: gathered.circadianBaseline,
    wakeUpContext: gathered.wakeUpContext,
    energySystemEnabled: gathered.energySystemEnabled,
    mindToolsEnabled: !!ctx.mindSession.mcpServer,
    ...(gathered.pluginDecisionDescriptions ? { pluginDecisionDescriptions: gathered.pluginDecisionDescriptions } : {}),
    ...(gathered.pluginContextSources ? { pluginContextSources: gathered.pluginContextSources } : {}),
    ...(gathered.credentialManifest ? { credentialManifest: gathered.credentialManifest } : {}),
    deferredTasks: gathered.deferredTasks,
    thoughtContext: gathered.thoughtContext,
    experienceContext: gathered.experienceContext,
    ...(gathered.messageContext ? { messageContext: gathered.messageContext } : {}),
    ...(gathered.pendingApprovals.length > 0 ? { pendingApprovals: gathered.pendingApprovals } : {}),
    ...(gathered.trustRampContext ? { trustRampContext: gathered.trustRampContext } : {}),
    ...(gathered.externalHistory ? { externalHistory: gathered.externalHistory } : {}),
  });

  const triggerInfo = {
    type: gathered.trigger.type,
    contactId: gathered.trigger.contactId,
    channel: gathered.trigger.channel,
    messageId: gathered.trigger.messageId,
  };

  // If no agent manager configured, fall back to safe output
  if (!ctx.agentManager || ctx.agentManager.getConfiguredProviders().length === 0) {
    log.warn('No agent provider configured, using safe output');
    return { output: safeMindOutput(triggerInfo), compiledContext: context, replySentEarly: false, earlyReplyContent: '', tickInputLogged: false, allThoughts: [], replyTurnsSent: 0 };
  }

  try {
    // If session state is "warm" but no active session exists, we need to rebuild
    // the system prompt that was skipped during context building
    let effectiveSystemPrompt = context.systemPrompt;
    if (!effectiveSystemPrompt && (!ctx.mindSession.session || !ctx.mindSession.session.isActive)) {
      log.info('Rebuilding system prompt for dead warm session');
      effectiveSystemPrompt = buildSystemPrompt(ctx.compiledPersona!, {
        energySystemEnabled: gathered.energySystemEnabled ?? false,
        tickIntervalMs: gathered.tickIntervalMs,
        mindToolsEnabled: !!ctx.mindSession.mcpServer,
        ...(gathered.pluginDecisionDescriptions ? { pluginDecisionDescriptions: gathered.pluginDecisionDescriptions } : {}),
      });
    }

    // Get or create the mind session
    const mindStart = Date.now();
    log.info(`Mind query: session=${gathered.sessionState}, provider=${ctx.agentManager.getConfiguredProviders()[0] ?? 'none'}`);

    const session = await getOrCreateMindSession(
      ctx.mindSession,
      gathered.sessionState,
      effectiveSystemPrompt,
      ctx.agentManager,
      ctx.agentLogStoreAdapter,
    );

    log.info(`Mind session ready: id=${session.id}, hasTools=${!!ctx.mindSession.mcpServer}, hasCognitive=${!!ctx.mindSession.cognitiveServer}`);

    // Update the mutable tool context for this tick so tool handlers
    // can access the current contact/channel/conversation
    ctx.mindSession.toolContext.current = buildMindToolContext(gathered, ctx.memoryManager);

    const eventBus = getEventBus();

    // Log tick_input BEFORE prompting so the DB entry exists while LLM processes.
    // This enables getTickTimeline to work for in-progress ticks.
    let tickInputLogged = false;
    const logSessionId = ctx.mindSession.logSessionId?.() ?? null;
    if (logSessionId) {
      try {
        const agentLogsDb = getAgentLogsDb();
        const tickInputEvent = agentLogStore.insertEvent(agentLogsDb, {
          sessionId: logSessionId,
          eventType: 'tick_input',
          data: {
            tickNumber,
            triggerType: gathered.trigger.type,
            triggerContext: gathered.trigger,
            sessionState: gathered.sessionState,
            systemPrompt: context.systemPrompt,
            userMessage: context.userMessage,
            tokenBreakdown: context.tokenBreakdown,
          },
        });
        eventBus.emit('agent:event:logged', {
          id: tickInputEvent.id,
          sessionId: tickInputEvent.sessionId,
          eventType: tickInputEvent.eventType,
          data: tickInputEvent.data,
          createdAt: tickInputEvent.createdAt,
        });
        eventBus.emit('tick:input_stored', {
          tickNumber,
          triggerType: gathered.trigger.type,
          sessionState: gathered.sessionState,
        });
        tickInputLogged = true;
        log.info(`tick_input logged early for tick #${tickNumber}`);
      } catch (err) {
        log.warn('Failed to log early tick_input event:', err);
      }
    }

    // Reset cognitive snapshot before prompting
    const cogServer = ctx.mindSession.cognitiveServer;
    if (cogServer) {
      cogServer.resetSnapshot();
    }

    const estTokens = Object.values(context.tokenBreakdown).reduce((a, b) => a + b, 0);
    log.info(`Prompting mind (${context.userMessage.length} chars, ~${estTokens} est. tokens)`);

    // Phase-based reply streaming:
    // Only stream text during the 'replying' phase (after record_thought, before record_cognitive_state)
    // Only emit reply:chunk events for message-triggered ticks — other tick types
    // (interval, scheduled_task, agent_complete) treat the text as internal processing.
    // The mind uses send_proactive_message to reach users on non-message ticks.
    let replyAccumulated = '';
    let replySentEarly = false;
    let replyTurnsSent = 0;
    const isMessageTrigger = gathered.trigger.type === 'message';
    const triggerChannel = gathered.trigger.channel ?? '';

    // Per-turn accumulated text tracking for turn-based reply segments
    const turnTextMap = new Map<number, string>();

    // --- Mid-tick message injection ---
    // While the mind is running, listen for new inbound messages from the
    // same contact and inject them into the active agent session via the
    // AsyncIterable prompt pattern. This lets the agent see and respond
    // to follow-up messages without waiting for a new tick.
    const injectedMessageIds = new Set<string>();
    const injectFn = session.injectMessage?.bind(session);
    const messageInjectionHandler = (msg: { id: string; contactId: string; direction: string; content: string; channel: string }) => {
      if (
        injectFn &&
        msg.direction === 'inbound' &&
        msg.contactId === gathered.contact?.id
      ) {
        injectedMessageIds.add(msg.id);
        const injectionContent = [
          `[ADDITIONAL MESSAGE received while you were composing your response]`,
          `From: ${gathered.contact.fullName ?? 'User'} via ${msg.channel}`,
          `"${msg.content}"`,
          ``,
          `Incorporate this into your response. You may address all messages in a single reply.`,
        ].join('\n');

        injectFn(injectionContent);
        log.info(`Injected mid-tick message into mind session: "${msg.content.substring(0, 60)}..."`);

        // Log as a lifecycle event so it appears in the AgentTimeline
        const sessionId = ctx.mindSession.logSessionId?.() ?? null;
        if (sessionId) {
          try {
            const agentLogsDb = getAgentLogsDb();
            const injectedEvent = agentLogStore.insertEvent(agentLogsDb, {
              sessionId,
              eventType: 'message_injected',
              data: {
                tickNumber,
                messageId: msg.id,
                contactId: msg.contactId,
                channel: msg.channel,
                content: msg.content,
                contactName: gathered.contact?.fullName ?? 'Unknown',
              },
            });
            eventBus.emit('agent:event:logged', {
              id: injectedEvent.id,
              sessionId: injectedEvent.sessionId,
              eventType: injectedEvent.eventType,
              data: injectedEvent.data,
              createdAt: injectedEvent.createdAt,
            });
          } catch (err) {
            log.warn('Failed to log message_injected event:', err);
          }
        }
      }
    };
    eventBus.on('message:received', messageInjectionHandler);

    // Turn-end handler: persist each turn's reply text as a separate message
    const turnEndHandler = async (event: import('@animus-labs/agents').AgentEvent) => {
      if (event.type !== 'turn_end') return;
      const turnData = event.data as import('@animus-labs/agents').TurnEndData;
      const turnText = turnTextMap.get(turnData.turnIndex);
      if (!turnText?.trim()) return;
      if (isNonResponse(turnText)) {
        log.info(`Filtered non-response turn ${turnData.turnIndex}: "${turnText.trim()}"`);
        return;
      }
      // Allow replies for both full contacts and recognized participants (synthetic contactId)
      const turnContactId = gathered.contact?.id ?? gathered.trigger.contactId;
      if (!isMessageTrigger || !turnContactId || !gathered.trigger.channel) return;

      try {
        // Strip 'media' from trigger metadata — incoming attachments shouldn't be re-sent.
        // Keep other metadata like channelId for Discord reply routing.
        const triggerMetadata = gathered.trigger?.metadata as Record<string, unknown> | undefined;
        const replyMetadata = triggerMetadata
          ? Object.fromEntries(Object.entries(triggerMetadata).filter(([k]) => k !== 'media'))
          : undefined;
        const hasReplyMetadata = replyMetadata && Object.keys(replyMetadata).length > 0;
        const { getChannelRouter } = await import('../channels/channel-router.js');
        const router = getChannelRouter();
        await router.sendOutbound({
          contactId: turnContactId,
          channel: gathered.trigger.channel,
          content: turnText.trim(),
          ...(hasReplyMetadata ? { metadata: replyMetadata } : {}),
        });
        replyTurnsSent++;
        replySentEarly = true;
        log.info(`Turn ${turnData.turnIndex} reply sent on "${gathered.trigger.channel}" for tick #${tickNumber} (${turnText.length} chars)`);

        // Emit turn_complete for the frontend
        eventBus.emit('reply:turn_complete', {
          turnIndex: turnData.turnIndex,
          content: turnText.trim(),
          tickNumber,
          channel: triggerChannel,
        });
      } catch (channelErr) {
        log.debug(`Turn ${turnData.turnIndex} reply send failed:`, channelErr);
      }
    };
    session.onEvent(turnEndHandler);

    // Stream: feed chunks from the agent adapter, only emit reply chunks during 'replying' phase.
    // For non-message ticks, still accumulate text (for logging/snapshot) but don't stream to frontend.
    await session.promptStreaming(
      context.userMessage,
      (chunk: string, meta: import('@animus-labs/agents').StreamChunkMeta) => {
        if (cogServer && cogServer.getPhase() === 'replying') {
          replyAccumulated += chunk;

          // Track per-turn accumulated text
          const prev = turnTextMap.get(meta.turnIndex) ?? '';
          turnTextMap.set(meta.turnIndex, prev + chunk);

          if (isMessageTrigger) {
            const turnAccumulated = turnTextMap.get(meta.turnIndex)!;
            eventBus.emit('reply:chunk', {
              content: chunk,
              accumulated: turnAccumulated,
              turnIndex: meta.turnIndex,
              channel: triggerChannel,
            });
          }
        }
      },
    );

    // Remove turn-end handler and stop listening for message injection
    session.offEvent(turnEndHandler);
    eventBus.off('message:received', messageInjectionHandler);
    if (injectedMessageIds.size > 0) {
      log.info(`Mid-tick injection summary: ${injectedMessageIds.size} message(s) injected during mind query`);
    }

    // Read cognitive snapshot and convert to MindOutput
    const snapshot = cogServer ? cogServer.getSnapshot() : null;
    const allThoughts = snapshot?.thoughts ?? [];

    const output = snapshot
      ? snapshotToMindOutput(snapshot, replyAccumulated, gathered)
      : safeMindOutput(triggerInfo);

    const mindMs = Date.now() - mindStart;
    const totalTurns = turnTextMap.size;
    if (snapshot) {
      log.info(`Mind query complete (${(mindMs / 1000).toFixed(1)}s): ${allThoughts.length} thought(s), ${snapshot.emotionDeltas.length} emotion delta(s), ${snapshot.decisions.length} decision(s), reply=${replyAccumulated.length} chars, turns=${totalTurns} (${replyTurnsSent} sent early)`);
    } else {
      log.warn('No cognitive server available — using safe fallback');
    }

    // If no turns were sent during streaming (single-turn or turn_end handler didn't fire),
    // send the full accumulated reply as one message (fallback to monolithic behavior).
    // Allow replies for both full contacts and recognized participants (synthetic contactId)
    const fallbackContactId = gathered.contact?.id ?? gathered.trigger.contactId;
    if (!replySentEarly && isMessageTrigger && replyAccumulated.trim() && !isNonResponse(replyAccumulated) && fallbackContactId && gathered.trigger.channel) {
      try {
        // Strip 'media' from trigger metadata — incoming attachments shouldn't be re-sent.
        // Keep other metadata like channelId for Discord reply routing.
        const triggerMetadata = gathered.trigger?.metadata as Record<string, unknown> | undefined;
        const fallbackMetadata = triggerMetadata
          ? Object.fromEntries(Object.entries(triggerMetadata).filter(([k]) => k !== 'media'))
          : undefined;
        const hasFallbackMetadata = fallbackMetadata && Object.keys(fallbackMetadata).length > 0;
        const { getChannelRouter } = await import('../channels/channel-router.js');
        const router = getChannelRouter();
        await router.sendOutbound({
          contactId: fallbackContactId,
          channel: gathered.trigger.channel,
          content: replyAccumulated.trim(),
          ...(hasFallbackMetadata ? { metadata: fallbackMetadata } : {}),
        });
        replySentEarly = true;
        replyTurnsSent = 1;
        log.info(`Fallback: full reply sent on "${gathered.trigger.channel}" for tick #${tickNumber}`);
      } catch (channelErr) {
        log.debug('Fallback reply send skipped:', channelErr);
      }
    }

    // Emit reply completion event (only for message-triggered ticks)
    if (isMessageTrigger && output.reply?.content) {
      eventBus.emit('reply:complete', {
        content: output.reply.content,
        tickNumber,
        totalTurns,
        channel: triggerChannel,
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
      const cost = session.getCost();
      log.info(`Token usage: ${usage.totalTokens.toLocaleString()} total (session cumulative)${cost ? `, $${cost.totalCostUsd.toFixed(4)}` : ''}`);
    }

    return { output, compiledContext: context, replySentEarly, earlyReplyContent: replyAccumulated, tickInputLogged, allThoughts, replyTurnsSent };
  } catch (err) {
    log.error('Mind query failed:', err);
    ctx.mindSession.toolContext.current = null;

    // Surface authentication errors to the UI via system:error event
    const { AgentError } = await import('@animus-labs/agents');
    if (err instanceof AgentError && err.category === 'authentication') {
      const eventBus = getEventBus();
      eventBus.emit('system:error', {
        category: 'authentication',
        message: err.message,
        provider: err.provider,
        recoverable: false,
        suggestedAction: (err.details?.suggestedAction as string) ??
          'Check your API key or re-authenticate in Settings.',
      });
    }

    // End the leaked session before nulling references
    await resetMindSession(ctx.mindSession, ctx.agentManager);

    return { output: safeMindOutput(triggerInfo), compiledContext: context, replySentEarly: false, earlyReplyContent: '', tickInputLogged: false, allThoughts: [], replyTurnsSent: 0 };
  }
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

  let typingTimer: ReturnType<typeof setInterval> | null = null;
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
    eventBus.emit('heartbeat:state_change', heartbeatStore.getHeartbeatState(hbDb));

    // Stage 1: GATHER CONTEXT
    const gathered = await gatherContext(queuedTick.trigger, {
      tickQueue,
      memoryManager: ctx.memoryManager,
      seedManager: ctx.seedManager,
      goalManager: ctx.goalManager,
      agentOrchestrator: ctx.agentOrchestrator,
      sessionInvalidated: ctx.mindSession.invalidated,
      clearSessionInvalidation: () => { ctx.mindSession.invalidated = false; },
    });
    const tickStart = Date.now();

    // Start typing indicator for message-triggered ticks
    if (queuedTick.trigger.type === 'message' && queuedTick.trigger.channel) {
      const triggerChannel = queuedTick.trigger.channel;
      const triggerMetadata = queuedTick.trigger.metadata as Record<string, unknown> | undefined;
      const channelId = triggerMetadata?.['channelId'] as string | undefined;

      const { getChannelManager } = await import('../channels/channel-manager.js');
      const cm = getChannelManager();
      const manifest = cm.getChannelManifest(triggerChannel);

      if (manifest?.capabilities.includes('typing-indicator') && channelId) {
        const fireTyping = () => {
          cm.performAction(triggerChannel, { type: 'typing_indicator', channelId }).catch(() => {});
        };
        fireTyping();
        typingTimer = setInterval(fireTyping, 8_000);
      }
    }

    // Update state: entering mind stage
    heartbeatStore.updateHeartbeatState(hbDb, { currentStage: 'mind' });
    eventBus.emit('heartbeat:stage_change', { stage: 'mind' });
    eventBus.emit('heartbeat:state_change', heartbeatStore.getHeartbeatState(hbDb));

    // Stage 2: MIND QUERY
    const { output, compiledContext, replySentEarly, earlyReplyContent, tickInputLogged, allThoughts, replyTurnsSent } = await mindQuery(gathered, tickNumber);

    // Clear typing indicator now that mind query is done
    if (typingTimer) { clearInterval(typingTimer); typingTimer = null; }

    // Log tick input to agent_logs.db (only if mindQuery didn't already log it)
    const logSessionId = ctx.mindSession.logSessionId?.() ?? null;
    if (logSessionId && !tickInputLogged) {
      try {
        const agentLogsDb = getAgentLogsDb();
        const tickInputEvent = agentLogStore.insertEvent(agentLogsDb, {
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
        eventBus.emit('agent:event:logged', {
          id: tickInputEvent.id,
          sessionId: tickInputEvent.sessionId,
          eventType: tickInputEvent.eventType,
          data: tickInputEvent.data,
          createdAt: tickInputEvent.createdAt,
        });
        eventBus.emit('tick:input_stored', {
          tickNumber,
          triggerType: queuedTick.trigger.type,
          sessionState: gathered.sessionState,
        });
      } catch (err) {
        log.warn('Failed to log tick_input event:', err);
      }
    }

    // Update state: entering execute stage
    heartbeatStore.updateHeartbeatState(hbDb, { currentStage: 'execute' });
    eventBus.emit('heartbeat:stage_change', { stage: 'execute' });
    eventBus.emit('heartbeat:state_change', heartbeatStore.getHeartbeatState(hbDb));

    // Stage 3: EXECUTE
    await executeOutput(output, tickNumber, gathered, {
      decisionDeps: {
        agentOrchestrator: ctx.agentOrchestrator,
        compiledPersona: ctx.compiledPersona,
        seedManager: ctx.seedManager,
        goalManager: ctx.goalManager,
        buildSystemPrompt: (persona: CompiledPersona) => buildSystemPrompt(persona),
      },
      memoryManager: ctx.memoryManager,
      seedManager: ctx.seedManager,
      agentManager: ctx.agentManager,
      compiledPersona: ctx.compiledPersona,
      tickQueue,
    }, eventBus, {
      replySentEarly,
      earlyReplyContent,
      logSessionId,
      allThoughts,
      replyTurnsSent,
    });

    // Log tick output to agent_logs.db
    const durationMs = Date.now() - tickStart;
    if (logSessionId) {
      try {
        const agentLogsDb = getAgentLogsDb();
        const tickOutputEvent = agentLogStore.insertEvent(agentLogsDb, {
          sessionId: logSessionId,
          eventType: 'tick_output',
          data: {
            tickNumber,
            rawOutput: output,
            durationMs,
          },
        });
        eventBus.emit('agent:event:logged', {
          id: tickOutputEvent.id,
          sessionId: tickOutputEvent.sessionId,
          eventType: tickOutputEvent.eventType,
          data: tickOutputEvent.data,
          createdAt: tickOutputEvent.createdAt,
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
      ctx.mindSession.warmSince = Date.now();
    }

    log.info(`Completed tick #${tickNumber}`);
  } catch (err) {
    // Clear typing indicator on error
    if (typingTimer) { clearInterval(typingTimer); typingTimer = null; }

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
// Public API
// ============================================================================

/**
 * Initialize the heartbeat system.
 * Creates the AgentManager, recovers from crashes, and sets up the tick queue.
 */
export async function initializeHeartbeat(): Promise<{ resumedAfterRestart: boolean; nextTickInMs: number | null }> {
  const hbDb = getHeartbeatDb();
  const state = heartbeatStore.getHeartbeatState(hbDb);
  let resumedAfterRestart = false;
  let nextTickInMs: number | null = null;

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

  // Initialize the AgentManager (1 mind + 3 sub-agents + 2 observer/reflector + 2 buffer = 8 max)
  ctx.agentManager = createAgentManager({ maxConcurrentSessions: 8 });
  const configuredProviders = ctx.agentManager.getConfiguredProviders();
  if (configuredProviders.length > 0) {
    log.debug(`Agent providers configured: ${configuredProviders.join(', ')}`);
  } else {
    log.warn('No agent providers configured. Mind query will use safe defaults.');
  }

  // Initialize the agent log store adapter
  try {
    const agentLogsDb = getAgentLogsDb();
    ctx.agentLogStoreAdapter = createAgentLogStoreAdapter(agentLogsDb);

    // Mark orphaned agent sessions from previous crash
    const orphanedSessions = agentLogStore.markOrphanedSessions(agentLogsDb);
    if (orphanedSessions > 0) {
      log.info(`Marked ${orphanedSessions} orphaned agent sessions as error`);
    }
  } catch (err) {
    log.warn('Agent log store not available:', err);
  }

  // Initialize memory system
  try {
    const memDb = getMemoryDb();
    ctx.embeddingProvider = new LocalEmbeddingProvider();
    ctx.vectorStore = new VectorStore(LANCEDB_PATH, ctx.embeddingProvider.dimensions);
    await ctx.vectorStore.initialize();
    ctx.memoryManager = new MemoryManager(memDb, ctx.vectorStore, ctx.embeddingProvider);
    log.debug('Memory system initialized');
  } catch (err) {
    log.warn('Memory system not available:', err);
  }

  // Initialize goal system
  try {
    ctx.goalManager = new GoalManager(hbDb);
    if (ctx.embeddingProvider) {
      ctx.seedManager = new SeedManager(hbDb, ctx.embeddingProvider);
    }
    log.debug('Goal system initialized');
  } catch (err) {
    log.warn('Goal system not available:', err);
  }

  // Initialize the agent orchestrator with DB-backed task store
  if (ctx.agentManager && ctx.agentLogStoreAdapter) {
    const agentTaskStore: AgentTaskStore = {
      insertAgentTask: (data) => heartbeatStore.insertAgentTask(hbDb, data),
      updateAgentTask: (id, data) => heartbeatStore.updateAgentTask(hbDb, id, data),
      getAgentTask: (id) => heartbeatStore.getAgentTask(hbDb, id) as unknown as AgentTaskRecord | null,
      getRunningAgentTasks: () => heartbeatStore.getRunningAgentTasks(hbDb) as unknown as AgentTaskRecord[],
    };
    ctx.agentOrchestrator = new AgentOrchestrator({
      manager: ctx.agentManager,
      taskStore: agentTaskStore,
      logStore: ctx.agentLogStoreAdapter,
      eventBus: getEventBus(),
      getPreferredProvider: () => {
        try {
          const settings = systemStore.getSystemSettings(getSystemDb());
          return settings.defaultAgentProvider ?? null;
        } catch {
          return null;
        }
      },
      getPreferredModel: () => {
        try {
          const settings = systemStore.getSystemSettings(getSystemDb());
          return settings.defaultModel ?? undefined;
        } catch {
          return undefined;
        }
      },
      onAgentComplete: handleAgentComplete,
    });
  }

  // Initialize task scheduler
  try {
    const taskScheduler = getTaskScheduler();
    taskScheduler.setTaskDueHandler((task) => {
      // Look up goal/plan context so the mind sees full task details
      const hbDb = getHeartbeatDb();
      const goal = task.goalId ? heartbeatStore.getGoal(hbDb, task.goalId) : null;
      const plan = task.planId ? heartbeatStore.getPlan(hbDb, task.planId) : null;
      const milestone = plan && task.milestoneIndex != null
        ? (plan.milestones as Array<{ title: string }>)?.[task.milestoneIndex]?.title
        : undefined;

      handleScheduledTask({
        taskId: task.id,
        taskTitle: task.title,
        taskType: task.scheduleType,
        taskInstructions: task.instructions || '',
        ...(goal ? { goalTitle: goal.title } : {}),
        ...(plan ? { planTitle: plan.strategy } : {}),
        ...(milestone ? { currentMilestone: milestone } : {}),
      });
    });
    taskScheduler.start();
    log.debug('Task scheduler started');
  } catch (err) {
    log.warn('Task scheduler not available:', err);
  }

  // Listen for plugin changes to invalidate the session
  getEventBus().on('plugin:changed', () => {
    ctx.mindSession.invalidated = true;
    log.info('Plugin changed -- next tick will force cold session');
  });

  // Listen for tool permission changes to invalidate the session.
  // This ensures permission updates (e.g. off → always_allow) take effect
  // on the next tick by forcing a cold session rebuild with updated tool lists.
  getEventBus().on('tool:permission_changed', () => {
    ctx.mindSession.invalidated = true;
    log.info('Tool permission changed -- next tick will force cold session');
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
    resumedAfterRestart = true;
    nextTickInMs = settings.heartbeatIntervalMs;
  }

  return { resumedAfterRestart, nextTickInMs };
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
  await resetMindSession(ctx.mindSession, ctx.agentManager);

  // Stop task scheduler
  try {
    getTaskScheduler().stop();
  } catch (err) {
    log.warn('Failed to stop task scheduler:', err);
  }

  // Clean up orchestrator
  if (ctx.agentOrchestrator) {
    await ctx.agentOrchestrator.cleanup();
  }

  // Clean up agent manager
  if (ctx.agentManager) {
    await ctx.agentManager.cleanup();
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
 * Get the AgentOrchestrator instance (if initialized).
 * Used by heartbeat router for sub-agent management.
 */
export function getAgentOrchestrator(): AgentOrchestrator | null {
  return ctx.agentOrchestrator ?? null;
}

/**
 * Get the VectorStore instance (if initialized).
 * Used by data router for full reset cleanup.
 */
export function getVectorStore(): VectorStore | null {
  return ctx.vectorStore;
}

/**
 * Get the MemoryManager instance (if initialized).
 * Used by memory router for semantic search.
 */
export function getMemoryManager(): MemoryManager | null {
  return ctx.memoryManager;
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
  const persona = personaStore.getPersona(getPersonaDb());
  ctx.compiledPersona = compilePersona(buildPersonaConfig(persona));
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
