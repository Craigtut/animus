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
import * as systemStore from '../db/stores/system-store.js';
import * as messageStore from '../db/stores/message-store.js';
import { getEventBus } from '../lib/event-bus.js';
import { expiresIn, now } from '@animus/shared';
import { mindOutputSchema } from '@animus/shared';
import type {
  HeartbeatState,
  MindOutput,
  Contact,
  EmotionState,
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

import { TickQueue, type QueuedTick } from './tick-queue.js';
import { type TriggerContext, buildMindContext, buildSystemPrompt } from './context-builder.js';
import {
  applyDecay,
  applyDelta,
  computeBaselines,
  type PersonaDimensions,
} from './emotion-engine.js';
import { compilePersona, type PersonaConfig, type CompiledPersona } from './persona-compiler.js';
import { createAgentLogStoreAdapter } from './agent-log-adapter.js';
import { AgentOrchestrator, type AgentTaskStore } from './agent-orchestrator.js';

// ============================================================================
// Module State
// ============================================================================

const tickQueue = new TickQueue();
let compiledPersona: CompiledPersona | null = null;

// Agent management state
let agentManager: AgentManager | null = null;
let agentLogStoreAdapter: AgentLogStore | null = null;
let agentOrchestrator: AgentOrchestrator | null = null;

// Mind session state
let mindSession: IAgentSession | null = null;
let mindSessionId: string | null = null;
let sessionWarmSince: number | null = null;

// Memory & goal system state
let memoryManager: MemoryManager | null = null;
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
      console.warn('[Heartbeat] Memory context failed:', err);
    }
  }

  // Build goal context (if goal system is initialized)
  let goalCtx: GoalContext | null = null;
  if (goalManager && seedManager) {
    try {
      goalCtx = buildGoalContext(goalManager, seedManager, emotions);
    } catch (err) {
      console.warn('[Heartbeat] Goal context failed:', err);
    }
  }

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
    thoughts: isIdle
      ? [{ content: 'A quiet moment passes.', importance: 0.1 }]
      : [{ content: `Processing a ${gathered.trigger.type} trigger.`, importance: 0.3 }],
    reply: gathered.trigger.type === 'message'
      ? {
          content: 'I\'m having a moment of difficulty. Let me gather my thoughts.',
          contactId: gathered.trigger.contactId || '',
          channel: (gathered.trigger.channel || 'web') as import('@animus/shared').ChannelType,
          replyToMessageId: gathered.trigger.messageId || '',
        }
      : null,
    experiences: [{ content: 'Had difficulty processing this tick.', importance: 0.3 }],
    emotionDeltas: [],
    decisions: [],
    workingMemoryUpdate: null,
    coreSelfUpdate: null,
    memoryCandidate: [],
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
      console.warn('[Heartbeat] Failed to end previous mind session:', err);
    }
  }

  // Check if the provider is configured
  const configuredProviders = agentManager.getConfiguredProviders();
  if (configuredProviders.length === 0) {
    throw new Error('No agent providers configured. Set ANTHROPIC_API_KEY or other credentials.');
  }

  const provider = configuredProviders[0]!;

  const session = await agentManager.createSession({
    provider,
    ...(systemPrompt != null ? { systemPrompt } : {}),
    permissions: {
      executionMode: 'plan',
      approvalLevel: 'none',
    },
  });

  // Attach logging
  if (agentLogStoreAdapter) {
    attachSessionLogging(session, { store: agentLogStoreAdapter });
  }

  mindSession = session;
  mindSessionId = session.id;

  return session;
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
): Promise<MindOutput> {
  // Ensure persona is compiled
  if (!compiledPersona) {
    const sysDb = getSystemDb();
    const persona = systemStore.getPersonalitySettings(sysDb);
    compiledPersona = compilePersona(buildPersonaConfig(persona));
  }

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
  });

  // If no agent manager configured, fall back to safe output
  if (!agentManager || agentManager.getConfiguredProviders().length === 0) {
    console.warn('[Heartbeat] No agent provider configured, using safe output');
    return safeMindOutput(gathered);
  }

  try {
    // Get or create the mind session
    const session = await getOrCreateMindSession(
      gathered.sessionState,
      context.systemPrompt,
    );

    const eventBus = getEventBus();

    // Use promptStreaming to get real-time chunks for reply streaming
    let fullJson = '';

    const response = await session.promptStreaming(
      context.userMessage,
      (chunk: string) => {
        fullJson += chunk;
      },
    );

    // The full response content is the complete JSON
    fullJson = response.content || fullJson;

    // Parse and validate the structured output
    let parsed: unknown;
    try {
      parsed = JSON.parse(fullJson);
    } catch (parseErr) {
      console.error('[Heartbeat] Failed to parse MindOutput JSON:', parseErr);
      console.error('[Heartbeat] Raw output:', fullJson.slice(0, 500));
      return safeMindOutput(gathered);
    }

    // Validate with Zod schema
    const result = mindOutputSchema.safeParse(parsed);
    if (!result.success) {
      console.error('[Heartbeat] MindOutput validation failed:', result.error.issues);
      // Try to extract what we can from partial output
      try {
        // Lenient parse: accept partial data with defaults
        const lenient = {
          thoughts: Array.isArray((parsed as any)?.thoughts) ? (parsed as any).thoughts : [],
          reply: (parsed as any)?.reply ?? null,
          experiences: Array.isArray((parsed as any)?.experiences) ? (parsed as any).experiences : [],
          emotionDeltas: Array.isArray((parsed as any)?.emotionDeltas) ? (parsed as any).emotionDeltas : [],
          decisions: Array.isArray((parsed as any)?.decisions) ? (parsed as any).decisions : [],
          workingMemoryUpdate: (parsed as any)?.workingMemoryUpdate ?? null,
          coreSelfUpdate: (parsed as any)?.coreSelfUpdate ?? null,
          memoryCandidate: Array.isArray((parsed as any)?.memoryCandidate) ? (parsed as any).memoryCandidate : [],
        };
        return lenient as MindOutput;
      } catch {
        return safeMindOutput(gathered);
      }
    }

    const validated = result.data;

    // Emit reply streaming events (post-hoc since we got the full reply)
    if (validated.reply?.content) {
      eventBus.emit('reply:chunk', {
        content: validated.reply.content,
        accumulated: validated.reply.content,
      });
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

    return validated;
  } catch (err) {
    console.error('[Heartbeat] Mind query failed:', err);

    // On critical failure, transition session to cold
    mindSession = null;
    mindSessionId = null;

    return safeMindOutput(gathered);
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
        console.error(`[Heartbeat] Failed to execute ${decision.type} decision:`, err);
      }
    }
  }

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
      console.error(`[Heartbeat] Memory processing failed for tick #${tickNumber}:`, err);
    }
  }

  // 7. Process seed resonance (thoughts may reinforce seeds)
  if (seedManager && output.thoughts.length > 0) {
    try {
      const significantThoughts = output.thoughts.filter((t) => t.importance >= 0.3);
      if (significantThoughts.length > 0) {
        await seedManager.checkSeedResonance(significantThoughts);
      }
    } catch (err) {
      console.warn('[Heartbeat] Seed resonance check failed:', err);
    }
  }

  // 8. Cleanup expired entries
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
    ...(settings.communicationStyle ? { personalityNotes: settings.communicationStyle } : {}),
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
    console.log('[Heartbeat] Recovered from interrupted tick');
  }

  // Mark orphaned agent tasks from previous crash
  const orphaned = heartbeatStore.markOrphanedAgentTasks(hbDb);
  if (orphaned > 0) {
    console.log(`[Heartbeat] Marked ${orphaned} orphaned agent tasks as failed`);
  }

  // Initialize the AgentManager (3 sub-agents + 1 mind session = 4 max)
  agentManager = createAgentManager({ maxConcurrentSessions: 4 });
  const configuredProviders = agentManager.getConfiguredProviders();
  if (configuredProviders.length > 0) {
    console.log(`[Heartbeat] Agent providers configured: ${configuredProviders.join(', ')}`);
  } else {
    console.warn('[Heartbeat] No agent providers configured. Mind query will use safe defaults.');
  }

  // Initialize the agent log store adapter
  try {
    const agentLogsDb = getAgentLogsDb();
    agentLogStoreAdapter = createAgentLogStoreAdapter(agentLogsDb);
  } catch (err) {
    console.warn('[Heartbeat] Agent log store not available:', err);
  }

  // Initialize memory system
  try {
    const memDb = getMemoryDb();
    embeddingProvider = new LocalEmbeddingProvider();
    const vectorStore = new VectorStore('./data/lancedb', embeddingProvider.dimensions);
    await vectorStore.initialize();
    memoryManager = new MemoryManager(memDb, vectorStore, embeddingProvider);
    console.log('[Heartbeat] Memory system initialized');
  } catch (err) {
    console.warn('[Heartbeat] Memory system not available:', err);
  }

  // Initialize goal system
  try {
    goalManager = new GoalManager(hbDb);
    if (embeddingProvider) {
      seedManager = new SeedManager(hbDb, embeddingProvider);
    }
    console.log('[Heartbeat] Goal system initialized');
  } catch (err) {
    console.warn('[Heartbeat] Goal system not available:', err);
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
      onAgentComplete: handleAgentComplete,
    });
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
export async function stopHeartbeat(): Promise<void> {
  tickQueue.stopInterval();
  tickQueue.clear();

  // End mind session
  if (mindSession && mindSession.isActive) {
    try {
      await mindSession.end();
    } catch (err) {
      console.warn('[Heartbeat] Failed to end mind session on stop:', err);
    }
    mindSession = null;
    mindSessionId = null;
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
