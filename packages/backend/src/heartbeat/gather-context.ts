/**
 * Gather Context — Stage 1 of the heartbeat pipeline
 *
 * Assembles all inputs for the mind query: trigger context, emotional state,
 * recent thoughts/experiences/messages, memory, goals, energy, plugins, etc.
 *
 * Extracted from heartbeat/index.ts — pure structural refactor, no behavior changes.
 *
 * See docs/architecture/heartbeat.md — "Stage 1: GATHER CONTEXT"
 */

import { getHeartbeatDb, getSystemDb, getMessagesDb, getMemoryDb } from '../db/index.js';
import * as heartbeatStore from '../db/stores/heartbeat-store.js';
import * as systemStore from '../db/stores/system-store.js';
import * as messageStore from '../db/stores/message-store.js';
import * as memoryDbStore from '../db/stores/memory-store.js';
import { DecayEngine } from '@animus-labs/shared';
import type {
  HeartbeatState,
  Contact,
  EmotionState,
  EnergyBand,
  Task,
  ContactChannel,
  ChannelType,
  ToolApprovalRequest,
} from '@animus-labs/shared';

import { MemoryManager, buildMemoryContext } from '../memory/index.js';
import type { MemoryContext } from '../memory/index.js';
import { loadStreamContext, type StreamContext } from '../memory/observational-memory/index.js';
import { OBSERVATIONAL_MEMORY_CONFIG } from '../config/observational-memory.config.js';
import { SeedManager, GoalManager, buildGoalContext } from '../goals/index.js';
import type { GoalContext } from '../goals/index.js';
import { getDeferredQueue } from '../tasks/index.js';

import { getChannelManager } from '../channels/channel-manager.js';
import type { TriggerContext } from './context-builder.js';
import { applyDecay } from './emotion-engine.js';
import { AgentOrchestrator } from './agent-orchestrator.js';
import {
  getEnergyBand,
  computeCircadianBaseline,
  applyEnergyDecay,
  isInSleepHours,
  SLEEP_EMOTION_DECAY_MULTIPLIER,
  type WakeUpContext,
} from './energy-engine.js';
import type { TickQueue } from './tick-queue.js';
import { getPluginManager } from '../services/plugin-manager.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('GatherContext', 'heartbeat');

// ============================================================================
// Types
// ============================================================================

export interface GatherResult {
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
  contacts: Array<{ contact: Contact; channels: ContactChannel[] }>;
  energyLevel: number | null;
  energyBand: EnergyBand | null;
  circadianBaseline: number | null;
  wakeUpContext: WakeUpContext | null;
  energySystemEnabled: boolean;
  pluginDecisionDescriptions: string;
  pluginContextSources: string;
  credentialManifest: string;
  /** Deferred tasks for idle ticks (surfaced for the mind to pick up) */
  deferredTasks: Task[];
  /** Observational memory stream contexts (observation + raw items per stream) */
  thoughtContext: StreamContext;
  experienceContext: StreamContext;
  messageContext: StreamContext | null;
  /** Pending tool approval requests for the current contact */
  pendingApprovals: ToolApprovalRequest[];
  /** Trust ramp context for tools with repeated approvals (interval ticks only) */
  trustRampContext: string | null;
  /** External conversation history from channel adapters (e.g., Slack, Discord) */
  externalHistory: Map<string, Array<{
    author: { identifier: string; displayName: string; isBot: boolean };
    content: string;
    timestamp: string;
  }>> | null;
}

export interface GatherDeps {
  tickQueue: TickQueue;
  memoryManager: MemoryManager | null;
  seedManager: SeedManager | null;
  goalManager: GoalManager | null;
  agentOrchestrator: AgentOrchestrator | null;
  sessionInvalidated: boolean;
  /** Callback to clear the invalidation flag after reading it */
  clearSessionInvalidation: () => void;
}

// ============================================================================
// Session State Determination
// ============================================================================

function determineSessionState(
  state: HeartbeatState,
  warmthMs: number,
  deps: GatherDeps,
): 'cold' | 'warm' {
  // Plugin change forces cold session on next tick
  if (deps.sessionInvalidated) {
    deps.clearSessionInvalidation();
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
// Gather Context
// ============================================================================

export async function gatherContext(
  trigger: TriggerContext,
  deps: GatherDeps,
): Promise<GatherResult> {
  const hbDb = getHeartbeatDb();
  const sysDb = getSystemDb();
  const msgDb = getMessagesDb();

  const settings = systemStore.getSystemSettings(sysDb);
  const state = heartbeatStore.getHeartbeatState(hbDb);

  // Determine session state
  const gatherStart = Date.now();
  const sessionState = determineSessionState(state, settings.sessionWarmthMs, deps);
  log.info(`Gather: session=${sessionState}, trigger=${trigger.type}${trigger.contactName ? `, contact=${trigger.contactName}` : ''}`);

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

    // Check for wake-up bumps.
    // We check BOTH the raw (pre-decay) energy and the decayed energy.
    // During the long sleep interval (e.g. 30 min), the circadian baseline
    // can shift upward when sleep hours end, and applyEnergyDecay pulls
    // energy above 0.05 BEFORE we get here. Without checking rawBand,
    // wake-up detection is silently skipped.
    const rawBand = getEnergyBand(rawEnergy);
    const previousBand = getEnergyBand(decayed);
    const inSleep = isInSleepHours(currentTime, settings.sleepStartHour, settings.sleepEndHour, tz);

    if (previousBand === 'sleeping' || rawBand === 'sleeping') {
      if (!inSleep) {
        // Natural wake-up: sleep hours ended, bump to 0.15
        decayed = Math.max(decayed, 0.15);
        const ctx: WakeUpContext = { type: 'natural' };
        if (lastEnergyUpdate) ctx.sleepDurationHours = DecayEngine.hoursSince(lastEnergyUpdate);
        wakeUpContext = ctx;
        log.info('Natural wake-up: bumped energy to', decayed.toFixed(2));
      } else if (trigger.type !== 'interval') {
        // Triggered wake-up: non-interval trigger during sleep
        decayed = Math.max(decayed, 0.10);
        const ctx: WakeUpContext = { type: 'triggered', triggerType: trigger.type };
        if (lastEnergyUpdate) ctx.sleepDurationHours = DecayEngine.hoursSince(lastEnergyUpdate);
        wakeUpContext = ctx;
        log.info(`Triggered wake-up (${trigger.type}): bumped energy to`, decayed.toFixed(2));
      }
    }

    energyLevel = decayed;
    energyBand = getEnergyBand(decayed);

    // Reconcile tick interval with current energy state.
    // This is the single source of truth for interval switching. It catches
    // all edge cases: wake-up bumps above, energy decaying across the sleeping
    // boundary between ticks, and any other state mismatch.
    const targetInterval = energyBand === 'sleeping'
      ? settings.sleepTickIntervalMs
      : settings.heartbeatIntervalMs;
    deps.tickQueue.updateInterval(targetInterval);

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

  // Load recent thoughts & experiences with observation context.
  // We load items since the observation watermark so the observation pipeline
  // sees ALL unsummarized items (not just the most recent 50). Without this,
  // items from previous days would never be observed and compressed.
  const memDb = getMemoryDb();

  const thoughtWatermark = memoryDbStore.getObservation(memDb, 'thoughts', null)?.lastRawTimestamp;
  const experienceWatermark = memoryDbStore.getObservation(memDb, 'experiences', null)?.lastRawTimestamp;

  const allRecentThoughts = thoughtWatermark
    ? heartbeatStore.getThoughtsSince(hbDb, thoughtWatermark)
    : heartbeatStore.getRecentThoughts(hbDb, 500);
  const allRecentExperiences = experienceWatermark
    ? heartbeatStore.getExperiencesSince(hbDb, experienceWatermark)
    : heartbeatStore.getRecentExperiences(hbDb, 500);

  const thoughtContext = loadStreamContext({
    stream: 'thoughts',
    contactId: null,
    memoryDb: memDb,
    rawItems: allRecentThoughts.map(t => ({ id: t.id, content: t.content, createdAt: t.createdAt })),
    rawTokenBudget: OBSERVATIONAL_MEMORY_CONFIG.streams.thoughts.rawTokens,
  });

  const experienceContext = loadStreamContext({
    stream: 'experiences',
    contactId: null,
    memoryDb: memDb,
    rawItems: allRecentExperiences.map(e => ({ id: e.id, content: e.content, createdAt: e.createdAt })),
    rawTokenBudget: OBSERVATIONAL_MEMORY_CONFIG.streams.experiences.rawTokens,
  });

  // Map back to full typed arrays for downstream compatibility
  const thoughtIds = new Set(thoughtContext.rawItems.map(r => r.id));
  const recentThoughts = allRecentThoughts.filter(t => thoughtIds.has(t.id));
  const experienceIds = new Set(experienceContext.rawItems.map(r => r.id));
  const recentExperiences = allRecentExperiences.filter(e => experienceIds.has(e.id));

  // Load recent messages for the triggering contact
  let recentMessages: ReturnType<typeof messageStore.getRecentMessages> = [];
  let contact: Contact | null = null;
  let messageContext: StreamContext | null = null;

  // Resolve contactId and channel from trigger (or from agent task record for agent_complete)
  let resolvedContactId: string | undefined = trigger.contactId;
  let resolvedChannel: string | undefined = trigger.channel;

  if (trigger.type === 'agent_complete' && trigger.agentId && !resolvedContactId) {
    const agentTask = heartbeatStore.getAgentTask(hbDb, trigger.agentId);
    if (agentTask) {
      const taskContactId = agentTask['contactId'];
      const taskSourceChannel = agentTask['sourceChannel'];
      resolvedContactId = (typeof taskContactId === 'string' ? taskContactId : undefined) || undefined;
      resolvedChannel = (typeof taskSourceChannel === 'string' ? taskSourceChannel : undefined) || undefined;
    }
  }

  if (resolvedContactId) {
    contact = systemStore.getContact(sysDb, resolvedContactId);
    // Get active conversation for this contact + channel
    const channel = (resolvedChannel || 'web') as ChannelType;
    const conv = messageStore.getConversationByContactAndChannel(
      msgDb, resolvedContactId, channel
    );
    if (conv) {
      const messageWatermark = memoryDbStore.getObservation(memDb, 'messages', resolvedContactId)?.lastRawTimestamp;
      const allRecentMessages = messageWatermark
        ? messageStore.getMessagesSince(msgDb, conv.id, messageWatermark)
        : messageStore.getRecentMessages(msgDb, conv.id, 500);
      messageContext = loadStreamContext({
        stream: 'messages',
        contactId: resolvedContactId,
        memoryDb: memDb,
        rawItems: allRecentMessages.map(m => ({ id: m.id, content: m.content, createdAt: m.createdAt })),
        rawTokenBudget: OBSERVATIONAL_MEMORY_CONFIG.streams.messages.rawTokens,
      });
      const messageIds = new Set(messageContext.rawItems.map(r => r.id));
      recentMessages = allRecentMessages.filter(m => messageIds.has(m.id));
    }
  }

  // Load external conversation history from channel adapters
  let externalHistory: GatherResult['externalHistory'] = null;
  if (recentMessages.length > 0) {
    try {
      const channelManager = getChannelManager();
      // Collect unique external conversation IDs with their channel types
      const externalConvos = new Map<string, string>(); // conversationId -> channelType
      for (const msg of recentMessages) {
        const meta = msg.metadata as Record<string, unknown> | null;
        const extConvId = meta?.['externalConversationId'] as string | undefined;
        // Only fetch external history for participated conversations (channels, threads, mpims).
        // Owned conversations (DMs, SMS) have complete history in messages.db.
        // The adapter declares this via conversationType in reportIncoming.
        if (extConvId && msg.channel !== 'web' && meta?.['conversationType'] === 'participated') {
          externalConvos.set(extConvId, msg.channel);
        }
      }

      if (externalConvos.size > 0) {
        externalHistory = new Map();
        const historyPromises = [...externalConvos.entries()].map(async ([convId, channelType]) => {
          const history = await channelManager.getHistory(channelType, convId, 25);
          if (history && history.length > 0) {
            externalHistory!.set(`${channelType}:${convId}`, history);
          }
        });
        await Promise.all(historyPromises);
        if (externalHistory.size === 0) externalHistory = null;
      }
    } catch (err) {
      log.warn('External history fetching failed:', err);
    }
  }

  // Load previous tick decisions for "previous tick outcomes"
  const prevTickNum = state.tickNumber;
  const previousDecisions = prevTickNum > 0
    ? heartbeatStore.getTickDecisions(hbDb, prevTickNum)
    : [];

  // Build memory context (if memory system is initialized)
  let memCtx: MemoryContext | null = null;
  if (deps.memoryManager) {
    try {
      const query = trigger.type === 'message' && trigger.messageContent
        ? trigger.messageContent
        : null;
      memCtx = await buildMemoryContext(
        deps.memoryManager,
        trigger.contactId ?? null,
        query,
      );
    } catch (err) {
      log.warn('Memory context failed:', err);
    }
  }

  // Build goal context (if goal system is initialized)
  let goalCtx: GoalContext | null = null;
  if (deps.goalManager && deps.seedManager) {
    try {
      goalCtx = buildGoalContext(deps.goalManager, deps.seedManager, emotions, state.tickNumber);
    } catch (err) {
      log.warn('Goal context failed:', err);
    }
  }

  // Build deferred task context (for interval ticks)
  let deferredTasks: Task[] = [];
  if (trigger.type === 'interval') {
    try {
      deferredTasks = getDeferredQueue().getTopTasks(5);
    } catch (err) {
      log.warn('Deferred task context failed:', err);
    }
  }

  // Load all contacts with their channels
  const allContacts = systemStore.listContacts(sysDb).map((c) => ({
    contact: c,
    channels: systemStore.getContactChannelsByContactId(sysDb, c.id),
  }));

  // Check spawn budget for context injection
  let spawnBudgetNote: string | null = null;
  if (deps.agentOrchestrator) {
    const budget = deps.agentOrchestrator.getSpawnBudgetStatus();
    if (!budget.allowed) {
      spawnBudgetNote = `Agent spawn budget exhausted (${budget.count}/${budget.limit} this hour). Handle tasks directly.`;
    } else if (budget.warning) {
      spawnBudgetNote = `You've spawned ${budget.count} agents in the last hour (limit: ${budget.limit}). Consider handling tasks directly when possible.`;
    }
  }

  // Gather plugin context (decision descriptions + context sources + credentials)
  let pluginDecisionDescriptions = '';
  let pluginContextSources = '';
  let credentialManifest = '';
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

    // Build credential manifest for run_with_credentials tool
    const manifest = pluginManager.getCredentialManifest();
    if (manifest.length > 0) {
      credentialManifest = manifest
        .map(m => `  ${m.ref} → ${m.envVar} (${m.label}, hint: ${m.hint})`)
        .join('\n');
    }
  } catch (err) {
    log.warn('Plugin context gathering failed:', err);
  }

  // Load pending tool approvals for the current contact
  const pendingApprovals = heartbeatStore.getPendingApprovals(hbDb, contact?.id ?? undefined);

  // Build trust ramp context (interval ticks only — non-intrusive)
  let trustRampContext: string | null = null;
  if (trigger.type === 'interval') {
    try {
      const eligible = systemStore.getToolsEligibleForTrustRamp(sysDb);
      if (eligible.length > 0) {
        const suggestions: string[] = [];
        for (const tool of eligible) {
          const stats = heartbeatStore.getApprovalStats(hbDb, tool.toolName, 7);
          if (stats.approved >= 5 && stats.denied === 0) {
            suggestions.push(
              `You've noticed that the user has approved "${tool.displayName}" ${stats.approved} times ` +
              `in the past week without ever denying it. If it feels natural in ` +
              `conversation, you might casually suggest they set it to "Always Allow" ` +
              `in Settings > Tools to save time. This is not urgent.`
            );
          }
        }
        if (suggestions.length > 0) {
          trustRampContext = '── TRUST OBSERVATION ──\n' + suggestions.join('\n\n');
        }
      }
    } catch (err) {
      log.warn('Trust ramp context failed:', err);
    }
  }

  const gatherMs = Date.now() - gatherStart;
  log.info(`Gather complete (${gatherMs}ms): ${recentMessages.length} messages, ${recentThoughts.length} recent thoughts, ${emotions.filter(e => e.intensity > 0.1).length} active emotions${energyBand ? `, energy=${energyBand}` : ''}${memCtx ? ', memory=yes' : ''}${goalCtx ? ', goals=yes' : ''}${pendingApprovals.length > 0 ? `, approvals=${pendingApprovals.length}` : ''}`);

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
    deferredTasks,
    pluginDecisionDescriptions,
    pluginContextSources,
    credentialManifest,
    thoughtContext,
    experienceContext,
    messageContext,
    pendingApprovals,
    trustRampContext,
    externalHistory,
  };
}
