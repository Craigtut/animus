/**
 * Heartbeat System
 *
 * The heartbeat is the core tick system that drives Animus's inner life.
 * Architecture: 3-stage pipeline (Gather → Mind → Execute)
 *
 * See docs/architecture/heartbeat.md for the full design.
 */

import { getHeartbeatDb, getSystemDb, getMessagesDb } from '../db/index.js';
import * as heartbeatStore from '../db/stores/heartbeat-store.js';
import * as systemStore from '../db/stores/system-store.js';
import * as messageStore from '../db/stores/message-store.js';
import { getEventBus } from '../lib/event-bus.js';
import { DecayEngine, clamp, expiresIn, now } from '@animus/shared';
import type {
  EmotionState,
  EmotionName,
  TriggerType,
  HeartbeatState,
  MindOutput,
  Contact,
} from '@animus/shared';

import { TickQueue, type QueuedTick } from './tick-queue.js';
import { type TriggerContext, buildMindContext, buildSystemPrompt } from './context-builder.js';
import {
  applyDecay,
  applyDelta,
  computeBaselines,
  type PersonaDimensions,
} from './emotion-engine.js';
import { compilePersona, type PersonaConfig, type CompiledPersona } from './persona-compiler.js';

// ============================================================================
// Module State
// ============================================================================

const tickQueue = new TickQueue();
let compiledPersona: CompiledPersona | null = null;

// Session management state
let mindSessionId: string | null = null;
let sessionWarmSince: number | null = null;

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
}

async function gatherContext(trigger: TriggerContext): Promise<GatherResult> {
  const hbDb = getHeartbeatDb();
  const sysDb = getSystemDb();
  const msgDb = getMessagesDb();

  const settings = systemStore.getSystemSettings(sysDb);
  const state = heartbeatStore.getHeartbeatState(hbDb);

  // Determine session state
  const sessionState = determineSessionState(state, settings.sessionWarmthMs);

  // Load and decay emotions
  const rawEmotions = heartbeatStore.getEmotionStates(hbDb);
  const emotions = applyDecay(rawEmotions, Date.now());

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
  };
}

// ============================================================================
// Pipeline: Stage 2 — MIND QUERY (stub — agent session not yet available)
// ============================================================================

/**
 * Execute the mind query stage.
 *
 * This is currently a stub that returns a minimal MindOutput.
 * When the @animus/agents package is ready, this will create/reuse
 * an agent session, send the compiled context, and parse the
 * structured JSON output via llm-json-stream.
 */
async function mindQuery(
  gathered: GatherResult,
  _tickNumber: number
): Promise<MindOutput> {
  // Ensure persona is compiled
  if (!compiledPersona) {
    const sysDb = getSystemDb();
    const persona = systemStore.getPersonalitySettings(sysDb);
    compiledPersona = compilePersona(buildPersonaConfig(persona));
  }

  // Build the context
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
  });

  // TODO: When @animus/agents is ready, replace this stub with:
  // 1. Create/reuse agent session
  // 2. Send context.systemPrompt (if cold) and context.userMessage
  // 3. Parse structured MindOutput via llm-json-stream
  // 4. Stream reply.content to tRPC subscription
  // 5. Validate with MindOutputSchema.parse()

  // For now, return a minimal valid MindOutput
  const isIdle = gathered.trigger.type === 'interval';
  return {
    thoughts: isIdle
      ? [{ content: 'A quiet moment passes.', importance: 0.1 }]
      : [{ content: `Processing a ${gathered.trigger.type} trigger.`, importance: 0.3 }],
    reply: gathered.trigger.type === 'message'
      ? {
          content: 'I received your message. (Mind query not yet connected to an agent session.)',
          contactId: gathered.trigger.contactId || '',
          channel: (gathered.trigger.channel || 'web') as import('@animus/shared').ChannelType,
          replyToMessageId: gathered.trigger.messageId || '',
        }
      : null,
    experiences: isIdle
      ? [{ content: 'Time passed quietly.', importance: 0.1 }]
      : [{ content: `Experienced a ${gathered.trigger.type} event.`, importance: 0.3 }],
    emotionDeltas: [],
    decisions: [],
    workingMemoryUpdate: null,
    coreSelfUpdate: null,
    memoryCandidate: [],
  };
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
    // 1. Persist thoughts
    for (const thought of output.thoughts) {
      const t = heartbeatStore.insertThought(hbDb, {
        tickNumber,
        content: thought.content,
        importance: thought.importance,
        expiresAt: expiresIn(settings.thoughtRetentionDays),
      });
      eventBus.emit('thought:created', t);
    }

    // 2. Persist experiences
    for (const exp of output.experiences) {
      const e = heartbeatStore.insertExperience(hbDb, {
        tickNumber,
        content: exp.content,
        importance: exp.importance,
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

    // 4. Log decisions
    for (const decision of output.decisions) {
      // TODO: validate decisions against contact permission tier
      // For now, log all as executed
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

  // 5. Handle reply (outside transaction — message goes to messages.db)
  // Per docs: "Channel send failure → log error with full context, do NOT auto-retry.
  // Other EXECUTE operations continue."
  if (output.reply && output.reply.content && gathered.contact) {
    try {
      const channel = output.reply.channel;
      // Get or create conversation
      let conv = messageStore.getConversationByContactAndChannel(
        msgDb, gathered.contact.id, channel
      );
      if (!conv) {
        conv = messageStore.createConversation(msgDb, {
          contactId: gathered.contact.id,
          channel,
        });
      }

      const msg = messageStore.createMessage(msgDb, {
        conversationId: conv.id,
        contactId: gathered.contact.id,
        direction: 'outbound',
        channel,
        content: output.reply.content,
        tickNumber,
      });

      eventBus.emit('message:sent', msg);
    } catch (err) {
      console.error(`[Heartbeat] Failed to send reply for tick #${tickNumber}:`, err);
      // Log failure as a tick decision so it's visible in the UI
      heartbeatStore.insertTickDecision(getHeartbeatDb(), {
        tickNumber,
        type: 'send_reply',
        description: 'Reply send failed',
        parameters: { error: String(err), contactId: gathered.contact.id },
        outcome: 'failed',
      });
    }
  }

  // 6. Cleanup expired entries
  heartbeatStore.cleanupExpiredEntries(hbDb);
}

// ============================================================================
// Full Tick Execution
// ============================================================================

async function executeTick(queuedTick: QueuedTick): Promise<void> {
  const hbDb = getHeartbeatDb();
  const eventBus = getEventBus();
  const state = heartbeatStore.getHeartbeatState(hbDb);
  const tickNumber = state.tickNumber + 1;

  console.log(`[Heartbeat] Starting tick #${tickNumber} (${queuedTick.trigger.type})`);

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

    // Update state: entering mind stage
    heartbeatStore.updateHeartbeatState(hbDb, { currentStage: 'mind' });
    eventBus.emit('heartbeat:stage_change', { stage: 'mind' });

    // Stage 2: MIND QUERY
    const output = await mindQuery(gathered, tickNumber);

    // Update state: entering execute stage
    heartbeatStore.updateHeartbeatState(hbDb, { currentStage: 'execute' });
    eventBus.emit('heartbeat:stage_change', { stage: 'execute' });

    // Stage 3: EXECUTE
    await executeOutput(output, tickNumber, gathered);

    // Return to idle, set session warm
    heartbeatStore.updateHeartbeatState(hbDb, {
      currentStage: 'idle',
      sessionState: 'warm',
      triggerType: null,
      triggerContext: null,
      sessionWarmSince: now(),
    });

    sessionWarmSince = Date.now();

    console.log(`[Heartbeat] Completed tick #${tickNumber}`);
  } catch (err) {
    console.error(`[Heartbeat] Tick #${tickNumber} failed:`, err);

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
 * Convert the stored personality settings to a PersonaConfig.
 * Note: the current personalitySettings schema is minimal (from Sprint 0).
 * This adapter provides defaults for the full PersonaConfig until the
 * frontend sends complete persona data.
 */
function buildPersonaConfig(
  settings: ReturnType<typeof systemStore.getPersonalitySettings>
): PersonaConfig {
  return {
    name: settings.name || 'Animus',
    existenceParadigm: 'digital_consciousness',
    worldDescription: 'A thoughtful digital space where ideas and memories flow like light.',
    dimensions: {
      extroversion: 0.5,
      trust: 0.5,
      leadership: 0.5,
      optimism: 0.5,
      confidence: 0.5,
      empathy: 0.5,
      cautious: 0.5,
      patience: 0.5,
      orderly: 0.5,
      altruism: 0.5,
    },
    traits: settings.traits || [],
    values: settings.values || [],
    personalityNotes: settings.communicationStyle || undefined,
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize the heartbeat system.
 * Recovers from crashes and sets up the tick queue.
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
    console.log('[Heartbeat] Recovered from interrupted tick');
  }

  // Set up the tick queue processor
  tickQueue.setProcessor(executeTick);

  // Don't auto-start — wait for startHeartbeat() call
  // The heartbeat stays paused until persona exists (onboarding complete)
}

/**
 * Start the heartbeat system.
 * Called after onboarding is complete and persona exists.
 */
export function startHeartbeat(): void {
  const hbDb = getHeartbeatDb();
  const state = heartbeatStore.getHeartbeatState(hbDb);

  if (state.isRunning) {
    console.log('[Heartbeat] Already running');
    return;
  }

  const sysDb = getSystemDb();
  const settings = systemStore.getSystemSettings(sysDb);

  heartbeatStore.updateHeartbeatState(hbDb, { isRunning: true });

  // Start interval timer
  tickQueue.startInterval(settings.heartbeatIntervalMs);

  // Fire the first tick immediately
  tickQueue.enqueueInterval();

  console.log(`[Heartbeat] Started with interval of ${settings.heartbeatIntervalMs}ms`);
}

/**
 * Stop the heartbeat system.
 */
export function stopHeartbeat(): void {
  tickQueue.stopInterval();
  tickQueue.clear();

  const hbDb = getHeartbeatDb();
  heartbeatStore.updateHeartbeatState(hbDb, { isRunning: false });
  console.log('[Heartbeat] Stopped');
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
    resultContent: params.resultContent,
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
  const persona = systemStore.getPersonalitySettings(sysDb);
  compiledPersona = compilePersona(buildPersonaConfig(persona));
  console.log('[Heartbeat] Persona recompiled');
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

  console.log('[Heartbeat] Emotion baselines recomputed');
}
