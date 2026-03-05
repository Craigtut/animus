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

import { getHeartbeatDb, getSystemDb, getPersonaDb, getAgentLogsDb } from '../db/index.js';
import * as heartbeatStore from '../db/stores/heartbeat-store.js';
import * as agentLogStore from '../db/stores/agent-log-store.js';
import * as systemStore from '../db/stores/system-store.js';
import * as personaStore from '../db/stores/persona-store.js';
import { getEventBus } from '../lib/event-bus.js';
import { createLogger } from '../lib/logger.js';
import { isUnsealed } from '../lib/vault-manager.js';
import { getTelemetryService } from '../services/telemetry-service.js';
import { now } from '@animus-labs/shared';
import type { HeartbeatState, MindOutput } from '@animus-labs/shared';

import type { VectorStore } from '../memory/index.js';
import type { MemorySubsystem } from '../memory/memory-subsystem.js';
import type { GoalSubsystem } from '../goals/goal-subsystem.js';
import type { AgentSubsystem } from './agent-subsystem.js';

import { TickQueue, type QueuedTick } from './tick-queue.js';
import { type TriggerContext, type CompiledContext, buildMindContext, buildSystemPrompt } from './context-builder.js';
import { computeBaselines, type PersonaDimensions } from './emotion-engine.js';
import { getEnergyBand } from './energy-engine.js';
import { compilePersona, type PersonaConfig, type CompiledPersona } from './persona-compiler.js';
import type { AgentOrchestrator } from './agent-orchestrator.js';

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
import { getPluginManager } from '../plugins/index.js';
import { getChannelManager } from '../channels/channel-manager.js';
import { getDeferredQueue, getTaskScheduler, getTaskRunner } from '../tasks/index.js';

const log = createLogger('Heartbeat', 'heartbeat');

// ============================================================================
// HeartbeatContext — encapsulates all module-level state
// ============================================================================

class HeartbeatContext {
  // Subsystem references (set during init, accessed via getters)
  memory: MemorySubsystem | null = null;
  goals: GoalSubsystem | null = null;
  agents: AgentSubsystem | null = null;

  // HeartbeatContext-owned state (NOT part of subsystems)
  compiledPersona: CompiledPersona | null = null;
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
  const fullPersona = personaStore.getPersona(getPersonaDb());
  if (!ctx.compiledPersona) {
    ctx.compiledPersona = compilePersona(buildPersonaConfig(fullPersona));
  }

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
    ...(gathered.aiTimezone ? { timezone: gathered.aiTimezone } : {}),
    energyLevel: gathered.energyLevel,
    energyBand: gathered.energyBand,
    circadianBaseline: gathered.circadianBaseline,
    wakeUpContext: gathered.wakeUpContext,
    energySystemEnabled: gathered.energySystemEnabled,
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
    ...(gathered.deliveryFailures.length > 0 ? { deliveryFailures: gathered.deliveryFailures } : {}),
  });

  const triggerInfo = {
    type: gathered.trigger.type,
    contactId: gathered.trigger.contactId,
    channel: gathered.trigger.channel,
    messageId: gathered.trigger.messageId,
  };

  // If no agent manager configured, fall back to safe output
  if (!ctx.agents?.agentManager || ctx.agents.agentManager.getConfiguredProviders().length === 0) {
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
        ...(gathered.pluginDecisionDescriptions ? { pluginDecisionDescriptions: gathered.pluginDecisionDescriptions } : {}),
        ...(gathered.aiTimezone ? { timezone: gathered.aiTimezone } : {}),
      });
    }

    // Get or create the mind session
    const mindStart = Date.now();
    log.info(`Mind query: session=${gathered.sessionState}, provider=${ctx.agents!.agentManager!.getConfiguredProviders()[0] ?? 'none'}`);

    const session = await getOrCreateMindSession(
      ctx.mindSession,
      gathered.sessionState,
      effectiveSystemPrompt,
      ctx.agents!.agentManager!,
      ctx.agents!.agentLogStoreAdapter,
    );

    log.info(`Mind session ready: id=${session.id}, hasTools=${!!ctx.mindSession.mcpServer}, hasCognitive=${!!ctx.mindSession.cognitiveServer}`);

    // Update the mutable tool context for this tick so tool handlers
    // can access the current contact/channel/conversation
    ctx.mindSession.toolContext.current = buildMindToolContext(gathered, ctx.memory?.memoryManager ?? null);

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
    await resetMindSession(ctx.mindSession, ctx.agents?.agentManager ?? null);

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

  // Skip the full pipeline when the vault is sealed (no credentials available)
  if (!isUnsealed()) {
    log.info(`Tick #${tickNumber} skipped: vault is sealed`);
    heartbeatStore.updateHeartbeatState(hbDb, {
      tickNumber,
      lastTickAt: now(),
    });
    eventBus.emit('heartbeat:state_change', heartbeatStore.getHeartbeatState(hbDb));
    return;
  }

  log.info(`Starting tick #${tickNumber} (${queuedTick.trigger.type})`);

  // Daily active telemetry (deduped per-day, never blocks the pipeline)
  try {
    const uptimeHours = process.uptime() / 3600;
    getTelemetryService().captureDailyActive(uptimeHours);
  } catch { /* telemetry must never block the heartbeat */ }

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
      memoryManager: ctx.memory?.memoryManager ?? null,
      seedManager: ctx.goals?.seedManager ?? null,
      goalManager: ctx.goals?.goalManager ?? null,
      agentOrchestrator: ctx.agents?.agentOrchestrator ?? null,
      sessionInvalidated: ctx.mindSession.invalidated,
      clearSessionInvalidation: () => { ctx.mindSession.invalidated = false; },
      pluginManager: getPluginManager(),
      channelManager: getChannelManager(),
      deferredQueue: getDeferredQueue(),
    });
    const tickStart = Date.now();

    // Start typing indicator for message-triggered ticks
    if (queuedTick.trigger.type === 'message' && queuedTick.trigger.channel) {
      const triggerChannel = queuedTick.trigger.channel;
      const triggerMetadata = queuedTick.trigger.metadata as Record<string, unknown> | undefined;
      const channelId = triggerMetadata?.['channelId'] as string | undefined;

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
        agentOrchestrator: ctx.agents?.agentOrchestrator ?? null,
        compiledPersona: ctx.compiledPersona,
        seedManager: ctx.goals?.seedManager ?? null,
        goalManager: ctx.goals?.goalManager ?? null,
        buildSystemPrompt: (persona: CompiledPersona) => buildSystemPrompt(persona, {
          ...(gathered.aiTimezone ? { timezone: gathered.aiTimezone } : {}),
        }),
        pluginManager: getPluginManager(),
        taskScheduler: getTaskScheduler(),
        taskRunner: getTaskRunner(),
        channelManager: getChannelManager(),
      },
      memoryManager: ctx.memory?.memoryManager ?? null,
      seedManager: ctx.goals?.seedManager ?? null,
      agentManager: ctx.agents?.agentManager ?? null,
      compiledPersona: ctx.compiledPersona,
      tickQueue,
      deferredQueue: getDeferredQueue(),
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
// Helpers
// ============================================================================

/**
 * Determine the correct tick interval based on current energy state.
 * If the energy system is enabled and the AI is in the sleeping band,
 * returns the sleep tick interval; otherwise the regular heartbeat interval.
 */
function resolveTickInterval(settings: import('@animus-labs/shared').SystemSettings): number {
  if (settings.energySystemEnabled) {
    const hbDb = getHeartbeatDb();
    const { energyLevel } = heartbeatStore.getEnergyLevel(hbDb);
    const band = getEnergyBand(energyLevel);
    if (band === 'sleeping') {
      log.info(`Energy band is sleeping (${energyLevel.toFixed(4)}), using sleep interval ${settings.sleepTickIntervalMs}ms`);
      return settings.sleepTickIntervalMs;
    }
  }
  return settings.heartbeatIntervalMs;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize the heartbeat system.
 * Receives pre-started subsystems, recovers from crashes, and sets up the tick queue.
 */
export async function initializeHeartbeat(subsystems: {
  memory: MemorySubsystem;
  goals: GoalSubsystem;
  agents: AgentSubsystem;
}): Promise<{ resumedAfterRestart: boolean; nextTickInMs: number | null }> {
  const hbDb = getHeartbeatDb();
  const state = heartbeatStore.getHeartbeatState(hbDb);
  let resumedAfterRestart = false;
  let nextTickInMs: number | null = null;

  // Store subsystem references
  ctx.memory = subsystems.memory;
  ctx.goals = subsystems.goals;
  ctx.agents = subsystems.agents;

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

  // Listen for plugin changes to invalidate the session
  getEventBus().on('plugin:changed', async (payload) => {
    // Hot-swap Codex skills via JSON-RPC if the app-server is running
    if (ctx.agents?.agentManager) {
      try {
        const settings = systemStore.getSystemSettings(getSystemDb());
        if (settings.defaultAgentProvider === 'codex') {
          const { CodexAdapter } = await import('@animus-labs/agents');
          const adapter = ctx.agents.agentManager.getAdapter('codex');
          if (adapter instanceof CodexAdapter) {
            const { getPluginManager } = await import('../plugins/index.js');
            const pm = getPluginManager();
            const codexSkillPaths = pm.getDeployedCodexSkillPaths();
            const enabled = payload?.action !== 'uninstalled' && payload?.action !== 'disabled';
            for (const skillPath of codexSkillPaths) {
              await adapter.syncSkill(skillPath, enabled);
            }
            if (codexSkillPaths.length > 0) {
              log.debug(`Synced ${codexSkillPaths.length} Codex skills (enabled=${enabled})`);
            }
          }
        }
      } catch (err) {
        log.debug('Codex skill hot-swap failed (non-critical):', err);
      }
    }

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

  // Listen for provider/model setting changes to force a cold session rebuild.
  // Nulling mcpServer and cognitiveServer ensures the MCP build guards in
  // mind-session.ts re-create them for the new provider on the next tick.
  getEventBus().on('system:settings_updated', (payload) => {
    if ('defaultAgentProvider' in payload || 'defaultModel' in payload) {
      ctx.mindSession.invalidated = true;
      ctx.mindSession.mcpServer = null;
      ctx.mindSession.cognitiveServer = null;
      log.info('Provider/model settings changed -- next tick will force cold session');
    }
  });

  // Set up the tick queue processor
  tickQueue.setProcessor(executeTick);

  // Resume heartbeat if the user had it enabled before the server stopped.
  // Graceful shutdown preserves the isRunning flag so the user's toggle
  // is respected across restarts. Only an explicit user stop clears it.
  if (state.isRunning) {
    const sysDb = getSystemDb();
    const settings = systemStore.getSystemSettings(sysDb);

    // Use sleep interval if the AI is currently in the sleeping energy band
    const intervalMs = resolveTickInterval(settings);
    tickQueue.startInterval(intervalMs);
    resumedAfterRestart = true;
    nextTickInMs = intervalMs;
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

  // Use sleep interval if the AI is currently in the sleeping energy band
  const intervalMs = resolveTickInterval(settings);
  tickQueue.startInterval(intervalMs);

  // Fire the first tick immediately
  tickQueue.enqueueInterval();

  log.info(`Started with interval of ${intervalMs}ms${intervalMs !== settings.heartbeatIntervalMs ? ' (sleep)' : ''}`);
}

/**
 * Stop the heartbeat system.
 * @param opts.preserveDesiredState - If true, keeps `isRunning=true` in the DB
 *   so the heartbeat auto-resumes on the next server start. Used during graceful
 *   shutdown to respect the user's toggle. Defaults to false (user-initiated stop).
 */
export async function stopHeartbeat(opts?: { preserveDesiredState?: boolean }): Promise<void> {
  tickQueue.stopInterval();
  tickQueue.clear();

  // End mind session
  await resetMindSession(ctx.mindSession, ctx.agents?.agentManager ?? null);

  if (!opts?.preserveDesiredState) {
    const hbDb = getHeartbeatDb();
    heartbeatStore.updateHeartbeatState(hbDb, { isRunning: false });
  }
  log.info(opts?.preserveDesiredState ? 'Stopped (will resume on next start)' : 'Stopped');
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

  // Extract userTimezone from metadata and promote to first-class trigger field
  const userTimezone = params.metadata?.['userTimezone'] as string | undefined;

  tickQueue.enqueueMessage({
    type: 'message',
    contactId: params.contactId,
    contactName: params.contactName,
    channel: params.channel,
    messageContent: params.content,
    messageId: params.messageId,
    ...(userTimezone ? { userTimezone } : {}),
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
  const state = heartbeatStore.getHeartbeatState(hbDb);
  return { ...state, nextTickAt: tickQueue.nextTickAt };
}

/**
 * Get the AgentOrchestrator instance (if initialized).
 * Used by heartbeat router for sub-agent management.
 */
export function getAgentOrchestrator(): AgentOrchestrator | null {
  return ctx.agents?.agentOrchestrator ?? null;
}

/**
 * Get the VectorStore instance (if initialized).
 * Used by data router for full reset cleanup.
 */
export function getVectorStore(): VectorStore | null {
  return ctx.memory?.vectorStore ?? null;
}

/**
 * Get the MemoryManager instance (if initialized).
 * Used by memory router for semantic search.
 */
export function getMemoryManager(): import('../memory/index.js').MemoryManager | null {
  return ctx.memory?.memoryManager ?? null;
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
