/**
 * Heartbeat System
 *
 * The heartbeat is the core tick system that drives Animus's inner life.
 * Architecture: 3-stage pipeline (Gather -> Mind -> Execute)
 *
 * This file is the orchestration spine. Pipeline stages are implemented in:
 *   - gather-context.ts    (Stage 1: GATHER)
 *   - cortex-mind.ts       (CortexAgent lifecycle, session persistence, tool wiring)
 *   - cortex-pipeline.ts   (5-phase pipeline: THOUGHT, AGENTIC LOOP, REFLECT)
 *   - cognitive-tools.ts   (Zod schemas for THOUGHT/REFLECT structured output)
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
import { getBudgetService } from '../services/budget-service.js';
import { getCortexCredentialService } from '../services/cortex-credential-service.js';
import { now } from '@animus-labs/shared';
import type { HeartbeatState, MindOutput } from '@animus-labs/shared';
import { resolveCacheRetention } from '@animus-labs/cortex';

import type { VectorStore } from '../memory/index.js';
import type { MemorySubsystem } from '../memory/memory-subsystem.js';
import type { GoalSubsystem } from '../goals/goal-subsystem.js';
import type { AgentSubsystem } from './agent-subsystem.js';

import { TickQueue, type QueuedTick } from './tick-queue.js';
import { type TriggerContext, type CompiledContext, buildMindContext, buildSystemPrompt, buildTriggerSection } from './context-builder.js';
import { buildAgenticSnapshot, logPhaseSnapshot } from './context-snapshot.js';
import { computeBaselines, type PersonaDimensions } from './emotion-engine.js';
import { getEnergyBand } from './energy-engine.js';
import { compilePersona, type PersonaConfig, type CompiledPersona } from './persona-compiler.js';
import type { AgentOrchestrator } from './agent-orchestrator.js';

// Extracted modules
import { gatherContext, type GatherResult } from './gather-context.js';
import { safeMindOutput, snapshotToMindOutput, isNonResponse } from './cognitive-tools.js';
import { executeOutput } from './execute-output.js';
import { getPluginManager } from '../plugins/index.js';
import { getChannelManager } from '../channels/channel-manager.js';
import { getDeferredQueue, getTaskScheduler, getTaskRunner } from '../tasks/index.js';
import { interceptApprovalPhrase } from '../tools/approval-interceptor.js';

// Cortex pipeline (Phase 2A)
import { executeCortexPipeline, type PipelinePhase, type EphemeralSection } from './cortex-pipeline.js';
import {
  createCortexMind,
  populateContextSlots,
  loadSessionForTick,
  buildMindToolContext as buildCortexToolContext,
  updatePreprocessorVariables,
  destroyCortexMind,
} from './cortex-mind.js';
import { attachCortexLogging } from './cortex-log-bridge.js';

const log = createLogger('Heartbeat', 'heartbeat');

// ============================================================================
// Budget Gate — checks whether a tick should proceed based on budget limits
// ============================================================================

interface BudgetGateResult {
  allowed: boolean;
  reason?: string;
  /** True when budget is exceeded but we allow one grace reply to a message */
  isGraceMessage?: boolean;
}

/**
 * Check whether the current tick is allowed to proceed given budget constraints.
 *
 *   - If hard stopped and trigger is 'message': allow with grace flag
 *   - If hard stopped and trigger is not 'message': block tick
 *   - Otherwise: allow
 */
function checkBudgetGate(triggerType: string): BudgetGateResult {
  const budgetService = getBudgetService({ getSystemDb, getAgentLogsDb });
  return budgetService.shouldAllowTick(triggerType);
}

function getActiveProviderReadiness() {
  return getCortexCredentialService().getActiveProviderReadiness();
}

function emitProviderRequiredError(message?: string | null): void {
  getEventBus().emit('system:error', {
    category: 'configuration',
    message: message ?? 'No AI provider configured. Go to Settings > AI Provider to connect one.',
    recoverable: true,
    suggestedAction: 'Configure a provider in Settings > AI Provider.',
  });
}

function forceHeartbeatPaused(reason: string): void {
  const hbDb = getHeartbeatDb();
  tickQueue.stopInterval();
  tickQueue.clear();
  heartbeatStore.updateHeartbeatState(hbDb, {
    currentStage: 'idle',
    triggerType: null,
    triggerContext: null,
    isRunning: false,
  });
  getEventBus().emit('heartbeat:state_change', heartbeatStore.getHeartbeatState(hbDb));
  log.info(`Heartbeat paused: ${reason}`);
}

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

  // Cortex rate-limit backoff state
  consecutiveRateLimits: number = 0;
  rateLimitBackoffMs: number = 0;

  // Cortex pipeline phase tracking (for mid-tick injection routing)
  currentPhase: { value: PipelinePhase } = { value: 'gather' };

  constructor() {}
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
    ...(persona.personalityNotes != null && { personalityNotes: persona.personalityNotes }),
  };
}

// ============================================================================
// Tick Input Logging Helper
// ============================================================================

function logTickInput(params: {
  logSessionId: string;
  tickNumber: number;
  triggerType: string;
  triggerContext: unknown;
  compiledContext: CompiledContext;
}): void {
  const agentLogsDb = getAgentLogsDb();
  const event = agentLogStore.insertEvent(agentLogsDb, {
    sessionId: params.logSessionId,
    eventType: 'tick_input',
    data: {
      tickNumber: params.tickNumber,
      triggerType: params.triggerType,
      triggerContext: params.triggerContext,
      systemPrompt: params.compiledContext.systemPrompt,
      userMessage: params.compiledContext.userMessage,
      systemPromptManifest: params.compiledContext.systemPromptManifest,
      userMessageManifest: params.compiledContext.userMessageManifest,
      tokenBreakdown: params.compiledContext.tokenBreakdown,
    },
  });
  const eventBus = getEventBus();
  eventBus.emit('agent:event:logged', {
    id: event.id,
    sessionId: event.sessionId,
    eventType: event.eventType,
    data: event.data,
    createdAt: event.createdAt,
  });
  eventBus.emit('tick:input_stored', {
    tickNumber: params.tickNumber,
    triggerType: params.triggerType,
  });
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
  /** Per-tick agent log session ID for observability events. */
  logSessionId: string | null;
}

/**
 * Execute the cortex 5-phase pipeline (the only mind query path).
 *
 * Returns a MindQueryResult so executeTick can process the output uniformly.
 */
async function cortexMindQuery(
  gathered: GatherResult,
  tickNumber: number,
  gatherDurationMs: number,
): Promise<MindQueryResult> {
  const fullPersona = personaStore.getPersona(getPersonaDb());
  if (!ctx.compiledPersona) {
    ctx.compiledPersona = compilePersona(buildPersonaConfig(fullPersona));
  }

  const cortexMind = ctx.agents!.cortexMind;
  const cortexAgent = cortexMind.agent!;

  // Load the conversation thread for this tick's (contact, channel) pair.
  // Inner-life ticks (no contact) start with empty history and don't persist.
  loadSessionForTick(
    cortexAgent,
    cortexMind,
    gathered.trigger.contactId,
    gathered.trigger.channel,
  );

  // Create a per-tick log session for agent_logs.db observability.
  // Each tick gets its own session so cleanup never deletes an in-use session.
  let logSessionId: string | null = null;
  try {
    const agentLogsDb = getAgentLogsDb();
    const session = agentLogStore.createSession(agentLogsDb, {
      provider: 'cortex',
      model: cortexMind.model?.modelId ?? 'cortex',
    });
    logSessionId = session.id;
  } catch (err) {
    log.warn('Failed to create log session for tick:', err);
  }
  let cortexLogBridge: { detach: () => void } | null = null;
  if (logSessionId) {
    const eventBus = getEventBus();
    cortexLogBridge = attachCortexLogging(cortexAgent, {
      sessionId: logSessionId,
      eventBus,
      provider: cortexMind.model?.provider ?? 'cortex',
      model: cortexMind.model?.modelId ?? 'cortex',
    });

    // Log gather phase events retroactively (session didn't exist during gather)
    try {
      const agentLogsDb = getAgentLogsDb();
      const startEvent = agentLogStore.insertEvent(agentLogsDb, {
        sessionId: logSessionId,
        eventType: 'gather_start',
        data: { tickNumber },
      });
      eventBus.emit('agent:event:logged', {
        id: startEvent.id,
        sessionId: startEvent.sessionId,
        eventType: startEvent.eventType,
        data: startEvent.data,
        createdAt: startEvent.createdAt,
      });
      const endEvent = agentLogStore.insertEvent(agentLogsDb, {
        sessionId: logSessionId,
        eventType: 'gather_end',
        data: { tickNumber, durationMs: gatherDurationMs },
      });
      eventBus.emit('agent:event:logged', {
        id: endEvent.id,
        sessionId: endEvent.sessionId,
        eventType: endEvent.eventType,
        data: endEvent.data,
        createdAt: endEvent.createdAt,
      });
    } catch (err) {
      log.debug('Failed to log gather phase events:', err);
    }
  }

  // Signal interaction recency for adaptive compaction thresholds.
  // Message-triggered ticks set the timestamp to now; interval/scheduled/agent_complete
  // ticks do not call this, so the timestamp ages naturally, causing the
  // compaction system to lower its threshold for idle sessions.
  if (gathered.trigger.type === 'message') {
    cortexAgent.setLastInteractionTime(Date.now());
  }

  // Update the mutable tool context for this tick
  cortexMind.toolContext.current = buildCortexToolContext(gathered, ctx.memory?.memoryManager ?? null);

  // Populate context slots with gathered data
  populateContextSlots(cortexAgent, gathered);

  // Update preprocessor variables for ${VAR} substitution in SKILL.md files
  updatePreprocessorVariables(cortexAgent, gathered);

  // Build and set the system prompt (persona + cortex operational sections)
  const consumerPrompt = buildSystemPrompt(ctx.compiledPersona, {
    ...(gathered.aiTimezone ? { timezone: gathered.aiTimezone } : {}),
    energySystemEnabled: gathered.energySystemEnabled,
    ...(gathered.pluginDecisionDescriptions ? { pluginDecisionDescriptions: gathered.pluginDecisionDescriptions } : {}),
  });
  const systemPrompt = cortexAgent.setBasePrompt(consumerPrompt);

  // Build the compiled context for logging (reuse the legacy builder for now)
  const context = buildMindContext({
    trigger: gathered.trigger,
    contact: gathered.contact,
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
    goalIndexContext: gathered.goalContext?.goalIndexSection ?? null,
    goalContext: gathered.goalContext?.goalSection ?? null,
    graduatingSeedsContext: gathered.goalContext?.graduatingSeedsSection ?? null,
    proposedGoalsContext: gathered.goalContext?.proposedGoalsSection ?? null,
    planningPromptsContext: gathered.goalContext?.planningPromptsSection ?? null,
    memoryFlushPending: false,
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
    taskJournals: gathered.taskJournals,
    thoughtContext: gathered.thoughtContext,
    experienceContext: gathered.experienceContext,
    ...(gathered.messageContext ? { messageContext: gathered.messageContext } : {}),
    ...(gathered.trustRampContext ? { trustRampContext: gathered.trustRampContext } : {}),
    ...(gathered.environmentContext ? { environmentContext: gathered.environmentContext } : {}),
    ...(gathered.externalHistory ? { externalHistory: gathered.externalHistory } : {}),
    ...(gathered.deliveryFailures.length > 0 ? { deliveryFailures: gathered.deliveryFailures } : {}),
    ...(gathered.budgetStatus ? { budgetStatus: gathered.budgetStatus } : {}),
    ...(gathered.budgetAlert ? { budgetAlert: gathered.budgetAlert } : {}),
  });

  const triggerInfo = {
    type: gathered.trigger.type,
    contactId: gathered.trigger.contactId,
    channel: gathered.trigger.channel,
    messageId: gathered.trigger.messageId,
  };

  // Log tick input (reuses logSessionId from the log bridge setup above)
  let tickInputLogged = false;
  if (logSessionId) {
    try {
      logTickInput({
        logSessionId,
        tickNumber,
        triggerType: gathered.trigger.type,
        triggerContext: gathered.trigger,
        compiledContext: context,
      });
      tickInputLogged = true;
    } catch (err) {
      log.warn('Failed to log early tick_input event:', err);
    }
  }

  // Prepare mid-tick injection queue
  const pendingInjections: Array<{ content: string; contactId: string; channel: string }> = [];
  const eventBus = getEventBus();

  // Listen for mid-tick messages and route based on pipeline phase
  const messageInjectionHandler = (msg: { id: string; contactId: string; direction: string; content: string; channel: string }) => {
    if (msg.direction !== 'inbound' || msg.contactId !== gathered.contact?.id) return;

    const phase = ctx.currentPhase.value;
    if (phase === 'thought') {
      // Queue for injection at the start of the agentic loop
      pendingInjections.push({ content: msg.content, contactId: msg.contactId, channel: msg.channel });
      log.info(`Queued mid-tick message during THOUGHT phase: "${msg.content.substring(0, 60)}..."`);
    } else if (phase === 'agentic-loop') {
      // Inject directly into the running agentic loop via steer()
      const messageContent = `[ADDITIONAL MESSAGE received]\nFrom: ${gathered.contact?.fullName ?? 'User'} via ${msg.channel}\n"${msg.content}"`;
      cortexAgent.steer(messageContent);
      log.info(`Steered mid-tick message into agentic loop: "${msg.content.substring(0, 60)}..."`);
    }
    // During reflect/execute, let TickQueue handle it as a new tick
  };
  eventBus.on('message:received', messageInjectionHandler);

  try {
    // Run the 5-phase cortex pipeline (THOUGHT, AGENTIC LOOP, REFLECT)
    ctx.currentPhase.value = 'gather';
    // Read debug mode setting for context snapshot capture
    const currentSettings = systemStore.getSystemSettings(getSystemDb());
    const contextDebugMode = currentSettings.contextDebugMode;

    const triggerMeta = gathered.trigger.metadata as Record<string, unknown> | undefined;
    const lowLatency = triggerMeta?.['lowLatency'] === true;

    const pipelineResult = await executeCortexPipeline(
      {
        cortexAgent,
        gathered,
        compiledPersona: ctx.compiledPersona,
        tickNumber,
        systemPrompt,
        logSessionId,
        tickType: gathered.trigger.type ?? null,
        contactId: gathered.trigger.contactId ?? null,
        model: cortexMind.model?.modelId ?? 'cortex',
        contextDebugMode,
        lowLatency,
        existenceParadigm: fullPersona.existenceParadigm ?? 'digital_consciousness',
        existenceLocation: fullPersona.existenceParadigm === 'simulated_life'
          ? fullPersona.location
          : fullPersona.worldDescription,
      },
      ctx.currentPhase,
      pendingInjections,
    );

    // Clean up mid-tick injection listener and log bridge
    eventBus.off('message:received', messageInjectionHandler);
    cortexLogBridge?.detach();

    // Reset rate-limit backoff on success
    ctx.consecutiveRateLimits = 0;
    ctx.rateLimitBackoffMs = 0;

    // Clear tool and compaction context after successful pipeline run
    cortexMind.toolContext.current = null;

    // Log agentic loop context snapshot (replaces the old single-snapshot approach)
    if (logSessionId) {
      try {
        const triggerPrompt = buildTriggerSection(gathered.trigger);
        const agenticSnap = buildAgenticSnapshot({
          cortexAgent,
          compiledPersona: ctx.compiledPersona,
          gathered,
          ephemeralSections: pipelineResult.ephemeralSections,
          triggerPrompt,
          tickNumber,
          debugMode: contextDebugMode,
          timezone: gathered.aiTimezone ?? undefined,
          firstTurnInputTokens: pipelineResult.firstTurnInputTokens,
        });
        if (agenticSnap) {
          logPhaseSnapshot(logSessionId, tickNumber, agenticSnap);
        }
      } catch (err) {
        log.warn('Failed to log context snapshot:', err);
      }
    }

    return {
      output: pipelineResult.output,
      compiledContext: context,
      replySentEarly: pipelineResult.replySentEarly,
      earlyReplyContent: pipelineResult.earlyReplyContent,
      tickInputLogged,
      allThoughts: pipelineResult.allThoughts,
      replyTurnsSent: pipelineResult.replyTurnsSent,
      logSessionId,
    };
  } catch (err) {
    eventBus.off('message:received', messageInjectionHandler);
    cortexLogBridge?.detach();

    log.error('Cortex pipeline failed:', err);
    cortexMind.toolContext.current = null;

    return {
      output: safeMindOutput(triggerInfo),
      compiledContext: context,
      replySentEarly: false,
      earlyReplyContent: '',
      tickInputLogged,
      allThoughts: [],
      replyTurnsSent: 0,
      logSessionId,
    };
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

  const providerReadiness = getActiveProviderReadiness();
  if (!providerReadiness.ready) {
    log.warn(`Tick skipped: ${providerReadiness.message}`);
    forceHeartbeatPaused(providerReadiness.message ?? 'AI provider is not configured');
    emitProviderRequiredError(providerReadiness.message);
    return;
  }

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

  // Budget gate: check if the tick is allowed to proceed
  const budgetGate = checkBudgetGate(queuedTick.trigger.type);
  if (!budgetGate.allowed) {
    log.warn(`Tick #${tickNumber} blocked by budget: ${budgetGate.reason}`);
    heartbeatStore.updateHeartbeatState(hbDb, {
      tickNumber,
      lastTickAt: now(),
    });
    eventBus.emit('budget:tick_blocked', {
      reason: budgetGate.reason ?? 'budget exceeded',
      triggerType: queuedTick.trigger.type,
    });
    eventBus.emit('heartbeat:state_change', heartbeatStore.getHeartbeatState(hbDb));
    return;
  }

  log.info(`Starting tick #${tickNumber} (${queuedTick.trigger.type})${budgetGate.isGraceMessage ? ' [budget grace message]' : ''}`);

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
      triggerType: queuedTick.trigger.type,
      triggerContext: JSON.stringify(queuedTick.trigger),
      lastTickAt: now(),
    });
    eventBus.emit('heartbeat:stage_change', { stage: 'gather' });
    eventBus.emit('heartbeat:state_change', heartbeatStore.getHeartbeatState(hbDb));

    // Pre-processing: intercept approval/denial phrases before gather.
    // If the user's message matches a recognized phrase and there's a pending
    // approval, resolve it deterministically and transform the trigger.
    const effectiveTrigger = interceptApprovalPhrase(queuedTick.trigger, {
      heartbeatDb: hbDb,
      eventBus,
    });

    // Annotate trigger with budget grace flag if applicable
    if (budgetGate.isGraceMessage) {
      effectiveTrigger.isBudgetGraceMessage = true;
    }

    // Stage 1: GATHER CONTEXT
    const gatherStartTime = Date.now();
    const gathered = await gatherContext(effectiveTrigger, {
      tickQueue,
      memoryManager: ctx.memory?.memoryManager ?? null,
      seedManager: ctx.goals?.seedManager ?? null,
      goalManager: ctx.goals?.goalManager ?? null,
      agentOrchestrator: ctx.agents?.agentOrchestrator ?? null,
      pluginManager: getPluginManager(),
      channelManager: getChannelManager(),
      deferredQueue: getDeferredQueue(),
    });
    const gatherDurationMs = Date.now() - gatherStartTime;
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

    // Stage 2: MIND QUERY (cortex pipeline)
    if (!ctx.agents?.cortexMind?.agent) {
      log.warn('No AI provider configured — skipping mind query');
      eventBus.emit('system:error', {
        category: 'configuration',
        message: 'No AI provider configured. Go to Settings > AI Provider to connect one.',
        recoverable: true,
        suggestedAction: 'Configure a provider in Settings > AI Provider.',
      });
      heartbeatStore.updateHeartbeatState(hbDb, {
        tickNumber,
        lastTickAt: now(),
        currentStage: 'idle',
      });
      eventBus.emit('heartbeat:state_change', heartbeatStore.getHeartbeatState(hbDb));
      if (typingTimer) { clearInterval(typingTimer); typingTimer = null; }
      return;
    }
    const { output, compiledContext, replySentEarly, earlyReplyContent, tickInputLogged, allThoughts, replyTurnsSent, logSessionId } = await cortexMindQuery(gathered, tickNumber, gatherDurationMs);

    // Clear typing indicator now that mind query is done
    if (typingTimer) { clearInterval(typingTimer); typingTimer = null; }
    if (logSessionId && !tickInputLogged) {
      try {
        logTickInput({
          logSessionId,
          tickNumber,
          triggerType: queuedTick.trigger.type,
          triggerContext: queuedTick.trigger,
          compiledContext,
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
          energySystemEnabled: gathered.energySystemEnabled,
          ...(gathered.pluginDecisionDescriptions ? { pluginDecisionDescriptions: gathered.pluginDecisionDescriptions } : {}),
        }),
        pluginManager: getPluginManager(),
        taskScheduler: getTaskScheduler(),
        taskRunner: getTaskRunner(),
        channelManager: getChannelManager(),
      },
      memoryManager: ctx.memory?.memoryManager ?? null,
      seedManager: ctx.goals?.seedManager ?? null,
      completeFn: ctx.agents?.cortexMind?.agent ? ctx.agents.cortexMind.agent.utilityComplete.bind(ctx.agents.cortexMind.agent) : null,
      compiledPersona: ctx.compiledPersona,
      tickQueue,
      deferredQueue: getDeferredQueue(),
      onIntervalChanged: (newIntervalMs: number) => {
        updateCortexCacheRetention(newIntervalMs);
      },
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

    // Close the per-tick log session
    if (logSessionId) {
      try {
        agentLogStore.endSession(getAgentLogsDb(), logSessionId, 'completed');
      } catch (err) {
        log.warn('Failed to close log session:', err);
      }
    }

    // Emit for real-time subscription
    eventBus.emit('tick:context_stored', {
      tickNumber,
      triggerType: queuedTick.trigger.type,
      durationMs,
      createdAt: now(),
    });

    // Return to idle
    heartbeatStore.updateHeartbeatState(hbDb, {
      currentStage: 'idle',
      triggerType: null,
      triggerContext: null,
    });

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
 * Determine the correct tick interval based on current energy state and budget.
 *
 * Layers:
 *   1. Energy system: sleeping band uses sleepTickIntervalMs
 *   2. Budget throttle: scales interval by (1 + throttleFactor * 5)
 *
 * The budget throttle is layered on top of the energy-based interval,
 * so a sleeping AI with budget pressure gets an even longer interval.
 */
function resolveTickInterval(settings: import('@animus-labs/shared').SystemSettings): number {
  let interval = settings.heartbeatIntervalMs;

  // Layer 1: Energy system
  if (settings.energySystemEnabled) {
    const hbDb = getHeartbeatDb();
    const { energyLevel } = heartbeatStore.getEnergyLevel(hbDb);
    const band = getEnergyBand(energyLevel);
    if (band === 'sleeping') {
      log.info(`Energy band is sleeping (${energyLevel.toFixed(4)}), using sleep interval ${settings.sleepTickIntervalMs}ms`);
      interval = settings.sleepTickIntervalMs;
    }
  }

  // Layer 2: Budget throttle (layered on top of energy interval)
  // Formula: interval * (1 + throttleFactor * 5)
  // throttleFactor: 0 at <80% budget, linear 0-1 from 80-95%, 1 at >95%
  const budgetService = getBudgetService({ getSystemDb, getAgentLogsDb });
  interval = budgetService.getEffectiveInterval(interval);

  return interval;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Wire rate-limit backoff handler on a CortexAgent.
 * Extracted so it can be called both at startup and on late initialization
 * (when the user configures a provider after onboarding).
 */
function wireCortexRateLimitHandler(cortexAgent: import('@animus-labs/cortex').CortexAgent): void {
  cortexAgent.onError((classified: { category: string; severity: string; originalMessage: string }) => {
    if (classified.category === 'rate_limit') {
      ctx.consecutiveRateLimits++;
      ctx.rateLimitBackoffMs = Math.min(
        30_000 * Math.pow(2, ctx.consecutiveRateLimits - 1),
        300_000,
      );
      log.warn(`Rate limit #${ctx.consecutiveRateLimits}: delaying next tick by ${ctx.rateLimitBackoffMs}ms`);
      tickQueue.delayNext(ctx.rateLimitBackoffMs);
    }
  });
}

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

  // Embed messages asynchronously on intake for recall search
  if (subsystems.memory.messageEmbedder) {
    const embedder = subsystems.memory.messageEmbedder;
    const handleEmbed = (msg: { id: string; content: string; createdAt: string }) => {
      void embedder.embedMessage(msg);
    };
    getEventBus().on('message:received', handleEmbed);
    getEventBus().on('message:sent', handleEmbed);
  }

  // Recover from interrupted tick
  if (state.currentStage !== 'idle') {
    heartbeatStore.updateHeartbeatState(hbDb, {
      currentStage: 'idle',
      triggerType: null,
      triggerContext: null,
    });
    log.info('Recovered from interrupted tick');
  }

  // Cortex startup: attempt to initialize the CortexAgent.
  // Returns null if no provider is configured yet (fresh install, pre-onboarding).
  // The agent will be created later via the cortex:provider-changed event
  // when the user configures a provider through onboarding or settings.
  if (subsystems.agents.cortexMind.agent == null) {
    try {
      const cortexAgent = await createCortexMind(
        subsystems.agents.cortexMind,
        { messageEmbedder: subsystems.memory.messageEmbedder },
      );

      if (cortexAgent) {
        log.info('CortexAgent initialized at startup');

        if (subsystems.agents.agentOrchestrator) {
          subsystems.agents.agentOrchestrator.setCortexAgent(cortexAgent);
        }

        wireCortexRateLimitHandler(cortexAgent);
      } else {
        log.info('No CortexAgent at startup (no provider configured). Waiting for provider setup.');
      }
    } catch (err) {
      log.warn('CortexAgent initialization failed:', err);
    }
  }

  // Late initialization: when the user configures a cortex provider for the
  // first time (during onboarding or in settings), create the CortexAgent now.
  // This covers the fresh-install flow where no provider exists at startup.
  getEventBus().on('cortex:provider-changed', async () => {
    if (subsystems.agents.cortexMind.agent) return; // Already initialized, model-switch handled by cortex-mind.ts
    try {
      const cortexAgent = await createCortexMind(
        subsystems.agents.cortexMind,
        { messageEmbedder: subsystems.memory.messageEmbedder },
      );
      if (cortexAgent) {
        if (subsystems.agents.agentOrchestrator) {
          subsystems.agents.agentOrchestrator.setCortexAgent(cortexAgent);
        }
        wireCortexRateLimitHandler(cortexAgent);
        log.info('CortexAgent initialized after provider setup (late init)');
      }
    } catch (err) {
      log.warn('Late CortexAgent initialization failed:', err);
    }
  });

  // When the cortex provider is removed, disconnect the orchestrator.
  getEventBus().on('cortex:provider-removed', () => {
    if (subsystems.agents.agentOrchestrator) {
      subsystems.agents.agentOrchestrator.setCortexAgent(null);
      log.info('AgentOrchestrator disconnected from cortex (provider removed)');
    }
    forceHeartbeatPaused('AI provider was removed');
  });

  // Plugin changes, tool permission changes, and provider/model settings
  // are handled by cortex-mind.ts (skill registry, tool refresh, model hot-swap).

  // Set up the tick queue processor
  tickQueue.setProcessor(executeTick);

  // Resume heartbeat if the user had it enabled before the server stopped.
  // Graceful shutdown preserves the isRunning flag so the user's toggle
  // is respected across restarts. Only an explicit user stop clears it.
  if (state.isRunning) {
    const sysDb = getSystemDb();
    const settings = systemStore.getSystemSettings(sysDb);
    const providerReadiness = getActiveProviderReadiness();

    if (!providerReadiness.ready) {
      forceHeartbeatPaused(providerReadiness.message ?? 'AI provider is not configured');
      log.info('Heartbeat will not resume until an AI provider is configured.');
      return { resumedAfterRestart, nextTickInMs };
    }

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
export function startHeartbeat(): boolean {
  const hbDb = getHeartbeatDb();
  const state = heartbeatStore.getHeartbeatState(hbDb);
  const providerReadiness = getActiveProviderReadiness();

  if (!providerReadiness.ready) {
    forceHeartbeatPaused(providerReadiness.message ?? 'AI provider is not configured');
    emitProviderRequiredError(providerReadiness.message);
    log.warn(`Cannot start heartbeat: ${providerReadiness.message}`);
    return false;
  }

  if (state.isRunning) {
    log.info('Already running');
    return true;
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
  return true;
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

  // Note: we do NOT destroy the CortexAgent here. Pausing the heartbeat
  // only stops interval ticks. Message-triggered, scheduled-task, and
  // agent-complete ticks can still fire and need a live agent. The agent
  // is only destroyed during full server shutdown (via the lifecycle manager).

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

export function getMessageEmbedder(): import('../memory/message-embedder.js').MessageEmbedder | null {
  return ctx.memory?.messageEmbedder ?? null;
}

/**
 * Update heartbeat interval (from settings change).
 */
export function updateHeartbeatInterval(intervalMs: number): void {
  tickQueue.updateInterval(intervalMs);
  updateCortexCacheRetention(intervalMs);
}

function updateCortexCacheRetention(intervalMs: number): void {
  const cortexAgent = ctx.agents?.cortexMind?.agent;
  if (!cortexAgent) return;

  const providerName = (systemStore.getSystemSettings(getSystemDb()) as Record<string, unknown>)['cortexProvider'] as string | undefined;
  if (!providerName) return;

  const newRetention = resolveCacheRetention(providerName, intervalMs);
  const previousRetention = cortexAgent.getCacheRetention();
  cortexAgent.setCacheRetention(newRetention);
  if (previousRetention !== newRetention) {
    log.info(`Cache retention updated: ${previousRetention ?? 'unset'} -> ${newRetention} (provider=${providerName}, interval=${intervalMs}ms)`);
  } else {
    log.debug(`Cache retention unchanged: ${newRetention} (provider=${providerName}, interval=${intervalMs}ms)`);
  }
}

/**
 * Destroy and recreate the CortexAgent with a clean state.
 *
 * Called by soft/full reset to ensure the in-memory agent doesn't carry
 * stale conversation history or context from the previous session.
 * The agent is destroyed, then reinitialized from the (now-cleared) DB.
 */
export async function resetCortexAgent(): Promise<void> {
  const cortexMind = ctx.agents?.cortexMind;
  if (!cortexMind) return;

  // Disconnect orchestrator from the old agent
  if (ctx.agents?.agentOrchestrator) {
    ctx.agents.agentOrchestrator.setCortexAgent(null);
  }

  // Destroy the old agent (releases pi-agent-core resources, MCP connections)
  await destroyCortexMind(cortexMind);

  // Recreate from scratch (reads provider/model from DB, starts fresh)
  try {
    const cortexAgent = await createCortexMind(
      cortexMind,
      { messageEmbedder: ctx.memory?.messageEmbedder ?? null },
    );
    if (cortexAgent) {
      // Do NOT restore conversation history; the DB was just cleared
      if (ctx.agents?.agentOrchestrator) {
        ctx.agents.agentOrchestrator.setCortexAgent(cortexAgent);
      }
      wireCortexRateLimitHandler(cortexAgent);
      log.info('CortexAgent recreated with clean state after reset');
    }
  } catch (err) {
    log.warn('Failed to recreate CortexAgent after reset:', err);
  }
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
