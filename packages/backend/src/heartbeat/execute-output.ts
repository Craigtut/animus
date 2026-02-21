/**
 * Execute Output — Stage 3 of the heartbeat pipeline
 *
 * Coordinates all side effects after the mind query completes:
 * reply sending, DB transaction (thought/experience/emotion/energy/decisions),
 * decision execution, memory processing, observational memory, and cleanup.
 *
 * Extracted from heartbeat/index.ts — pure structural refactor, no behavior changes.
 *
 * See docs/architecture/heartbeat.md — "Stage 3: EXECUTE"
 */

import { getHeartbeatDb, getSystemDb, getMessagesDb, getAgentLogsDb, getMemoryDb } from '../db/index.js';
import * as heartbeatStore from '../db/stores/heartbeat-store.js';
import * as agentLogStore from '../db/stores/agent-log-store.js';
import * as systemStore from '../db/stores/system-store.js';
import * as taskStore from '../db/stores/task-store.js';
import { expiresIn, now, clamp, builtInDecisionTypeSchema } from '@animus/shared';
import type { MindOutput, IEventBus, AgentEventType } from '@animus/shared';

import type { AgentManager } from '@animus/agents';
import type { MemoryManager } from '../memory/index.js';
import { processAllStreams } from '../memory/observational-memory/index.js';
import { OBSERVATIONAL_MEMORY_CONFIG } from '../config/observational-memory.config.js';
import type { SeedManager } from '../goals/index.js';
import { getDeferredQueue } from '../tasks/index.js';

import type { GatherResult } from './gather-context.js';
import { applyDelta } from './emotion-engine.js';
import { getEnergyBand, isInSleepHours } from './energy-engine.js';
import { logDecisionsInTransaction, executeDecisions, type DecisionExecutorDeps } from './decision-executor.js';
import type { CompiledPersona } from './persona-compiler.js';
import type { TickQueue } from './tick-queue.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('ExecuteOutput', 'heartbeat');

// ============================================================================
// Types
// ============================================================================

export interface ExecuteOutputDeps {
  decisionDeps: DecisionExecutorDeps;
  memoryManager: MemoryManager | null;
  seedManager: SeedManager | null;
  agentManager: AgentManager | null;
  compiledPersona: CompiledPersona | null;
  tickQueue: TickQueue;
}

// ============================================================================
// Execute Output
// ============================================================================

/**
 * Execute the output of a mind query — the EXECUTE stage of the pipeline.
 *
 * Steps:
 * 1. Send reply through channel router
 * 2. DB transaction: persist thought, experience, emotion deltas, energy delta, decision logs
 * 3. Execute decisions (agent, plugin, goal/task) via decision-executor
 * 4. Memory processing (working memory, core self, memory candidates) + seed processing
 * 5. Observational memory (fire-and-forget)
 * 6. Cleanup expired entries
 */
export async function executeOutput(
  output: MindOutput,
  tickNumber: number,
  gathered: GatherResult,
  deps: ExecuteOutputDeps,
  eventBus: IEventBus,
  options?: {
    replySentEarly?: boolean;
    earlyReplyContent?: string;
    logSessionId?: string | null;
    /** All thoughts from cognitive tools (may be > 1 for mid-tick re-entry). */
    allThoughts?: Array<{ content: string; importance: number }>;
    /** How many reply turns were already sent via sendOutbound during streaming. */
    replyTurnsSent?: number;
  },
): Promise<void> {
  const hbDb = getHeartbeatDb();
  const eventBusRef = eventBus;
  const settings = systemStore.getSystemSettings(getSystemDb());

  const replySentEarly = options?.replySentEarly ?? false;
  const earlyReplyContent = options?.earlyReplyContent ?? '';
  const logSessionId = options?.logSessionId ?? null;
  const replyTurnsSent = options?.replyTurnsSent ?? 0;

  // Execute phase observability
  const executeStartTime = Date.now();
  const logExecuteEvent = (eventType: AgentEventType, data: Record<string, unknown> = {}) => {
    if (!logSessionId) return;
    try {
      const agentLogsDb = getAgentLogsDb();
      const ev = agentLogStore.insertEvent(agentLogsDb, {
        sessionId: logSessionId,
        eventType,
        data: { tickNumber, durationMs: Date.now() - executeStartTime, ...data },
      });
      eventBusRef.emit('agent:event:logged', {
        id: ev.id,
        sessionId: ev.sessionId,
        eventType: ev.eventType,
        data: ev.data,
        createdAt: ev.createdAt,
      });
    } catch (err) {
      log.warn(`Failed to log ${eventType} event:`, err);
    }
  };

  // Step 0: Mark execute start
  log.info(`Execute: ${output.decisions.length} decision(s), ${output.emotionDeltas.length} emotion(s), ${output.memoryCandidate?.length ?? 0} memory candidate(s)${output.reply?.content ? `, reply=${output.reply.content.length} chars` : ''}`);
  logExecuteEvent('execute_start', {
    triggerType: gathered.trigger.type,
    contactId: gathered.contact?.id ?? null,
    contactName: gathered.contact?.fullName ?? null,
    channel: gathered.trigger.channel ?? null,
    hasReply: !!output.reply?.content,
    decisionCount: output.decisions.length,
    memoryCandidateCount: output.memoryCandidate?.length ?? 0,
  });

  // Step 1: Handle reply (outside transaction -- message goes to messages.db)
  // Per docs: "Channel send failure -> log error with full context, do NOT auto-retry.
  // Other EXECUTE operations continue."
  //
  // Auto-reply is only for message-triggered ticks. Non-message ticks (interval,
  // scheduled_task, agent_complete) treat the mind's natural language text as internal
  // processing. The mind uses send_proactive_message tool to reach users on those ticks.
  //
  // When messages were injected mid-tick, the structured output's reply may
  // address the injected messages and differ from the optimistic streamed reply.
  // In that case, send the structured reply as a follow-up message.
  const isMessageTrigger = gathered.trigger.type === 'message';
  const finalReplyContent = output.reply?.content ?? '';
  const finalReplyDiffers = replySentEarly && finalReplyContent && finalReplyContent !== earlyReplyContent;
  // Resolve contact: prefer gathered.contact, fall back to reply's contactId
  const replyContactId = gathered.contact?.id ?? output.reply?.contactId;
  const shouldSendReply = isMessageTrigger && output.reply && finalReplyContent && replyContactId && (!replySentEarly || finalReplyDiffers);

  if (shouldSendReply) {
    // Strip 'media' from trigger metadata — incoming attachments shouldn't be re-sent.
    // Keep other metadata like channelId for Discord reply routing.
    const rawTriggerMetadata = gathered.trigger?.metadata as Record<string, unknown> | undefined;
    const replyMetadata = rawTriggerMetadata
      ? Object.fromEntries(Object.entries(rawTriggerMetadata).filter(([k]) => k !== 'media'))
      : undefined;
    const hasReplyMetadata = replyMetadata && Object.keys(replyMetadata).length > 0;

    try {
      // On proactive ticks (no gathered.contact), validate the contact exists
      if (!gathered.contact) {
        const contact = systemStore.getContact(getSystemDb(), replyContactId);
        if (!contact) {
          log.error(`Reply send failed: non-existent contactId "${replyContactId}" on tick #${tickNumber}`);
          heartbeatStore.insertTickDecision(getHeartbeatDb(), {
            tickNumber,
            type: 'send_message',
            description: 'Reply send failed - invalid contactId',
            parameters: { error: 'Contact not found', contactId: replyContactId },
            outcome: 'failed',
          });
          // Skip reply but continue with other EXECUTE steps
        } else {
          // Valid proactive reply -- send it
          const channel = output.reply!.channel;
          const replyMedia = output.reply!.media;
          const { getChannelRouter } = await import('../channels/channel-router.js');
          const router = getChannelRouter();
          await router.sendOutbound({
            contactId: replyContactId,
            channel,
            content: finalReplyContent,
            ...(hasReplyMetadata ? { metadata: replyMetadata } : {}),
            ...(replyMedia && replyMedia.length > 0 ? {
              media: replyMedia.map(m => {
                const entry: { type: 'image' | 'audio' | 'video' | 'file'; path: string; filename?: string } = {
                  type: m.type,
                  path: m.path,
                };
                if (m.filename) entry.filename = m.filename;
                return entry;
              }),
            } : {}),
          });
          log.info(`Proactive reply sent on "${channel}" to contact ${replyContactId} for tick #${tickNumber}`);
        }
      } else {
        // Normal reply path (message-triggered tick with gathered.contact)
        const channel = output.reply!.channel;
        const replyMedia = output.reply!.media;
        const { getChannelRouter } = await import('../channels/channel-router.js');
        const router = getChannelRouter();
        await router.sendOutbound({
          contactId: replyContactId,
          channel,
          content: finalReplyContent,
          ...(hasReplyMetadata ? { metadata: replyMetadata } : {}),
          ...(replyMedia && replyMedia.length > 0 ? {
            media: replyMedia.map(m => {
              const entry: { type: 'image' | 'audio' | 'video' | 'file'; path: string; filename?: string } = {
                type: m.type,
                path: m.path,
              };
              if (m.filename) entry.filename = m.filename;
              return entry;
            }),
          } : {}),
        });

        if (finalReplyDiffers) {
          log.info(`Sent follow-up reply for tick #${tickNumber} (structured output differed from optimistic reply)`);
        }
      }
    } catch (err) {
      log.error(`Failed to send reply for tick #${tickNumber}:`, err);
      // Log failure as a tick decision so it's visible in the UI
      heartbeatStore.insertTickDecision(getHeartbeatDb(), {
        tickNumber,
        type: 'send_message',
        description: 'Reply send failed',
        parameters: { error: String(err), contactId: replyContactId },
        outcome: 'failed',
      });
    }
  }

  // Step 2: Reply handling complete
  logExecuteEvent('execute_reply_sent', {
    path: replySentEarly ? (finalReplyDiffers ? 'follow-up' : 'early') : (shouldSendReply ? 'fallback' : 'none'),
    proactive: !gathered.contact && !!replyContactId,
    hasReply: !!output.reply?.content,
    channel: output.reply?.channel ?? null,
    contactId: replyContactId ?? null,
    contactName: gathered.contact?.fullName ?? null,
    contentLength: finalReplyContent.length,
    hasMedia: !!(output.reply?.media?.length),
    turnsSent: replyTurnsSent,
  });

  // Wrap all DB writes in a transaction for atomicity
  const runTransaction = hbDb.transaction(() => {
    // 1. Persist thought(s) — when allThoughts is provided (cognitive tools),
    //    persist every thought to capture the full thought progression across
    //    mid-tick injection cycles. Otherwise fall back to output.thought.
    const thoughtsToInsert = options?.allThoughts && options.allThoughts.length > 0
      ? options.allThoughts
      : (output.thought?.content ? [output.thought] : []);
    for (const thought of thoughtsToInsert) {
      if (thought.content) {
        const t = heartbeatStore.insertThought(hbDb, {
          tickNumber,
          content: thought.content,
          importance: thought.importance,
          expiresAt: expiresIn(settings.thoughtRetentionDays),
        });
        eventBusRef.emit('thought:created', t);
      }
    }

    // 2. Persist experience
    if (output.experience?.content) {
      const e = heartbeatStore.insertExperience(hbDb, {
        tickNumber,
        content: output.experience.content,
        importance: output.experience.importance,
        expiresAt: expiresIn(settings.experienceRetentionDays),
      });
      eventBusRef.emit('experience:created', e);
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

      eventBusRef.emit('emotion:updated', {
        ...currentEmotion,
        intensity: after,
        lastUpdatedAt: now(),
      });
    }

    // 3b. Apply energy delta
    if (settings.energySystemEnabled && output.energyDelta) {
      const before = gathered.energyLevel ?? 0.85;

      // During sleep hours, ignore the mind's energy delta entirely.
      // The circadian decay toward 0.0 is the sole force on energy at night —
      // otherwise the mind narrates sleep as "restorative" and produces positive
      // deltas that prevent energy from ever reaching the sleeping band.
      const inSleepHours = isInSleepHours(
        new Date(), settings.sleepStartHour, settings.sleepEndHour,
        settings.timezone || 'UTC'
      );
      const effectiveDelta = inSleepHours ? 0 : output.energyDelta.delta;

      const after = clamp(before + effectiveDelta, 0, 1);
      heartbeatStore.updateEnergyLevel(hbDb, after);
      heartbeatStore.insertEnergyHistory(hbDb, {
        tickNumber,
        energyBefore: before,
        energyAfter: after,
        delta: effectiveDelta,
        reasoning: output.energyDelta.reasoning,
        circadianBaseline: gathered.circadianBaseline ?? 0.85,
        energyBand: getEnergyBand(after),
      });
      eventBusRef.emit('energy:updated', { energyLevel: after, band: getEnergyBand(after) });

      // Interval switching based on energy band transitions
      const prevBand = getEnergyBand(before);
      const newBand = getEnergyBand(after);
      if (newBand === 'sleeping' && prevBand !== 'sleeping') {
        deps.tickQueue.updateInterval(settings.sleepTickIntervalMs);
      } else if (prevBand === 'sleeping' && newBand !== 'sleeping' && !inSleepHours) {
        deps.tickQueue.updateInterval(settings.heartbeatIntervalMs);
      }
    }

    // 4. Log decisions (DB writes only; agent operations happen outside transaction)
    logDecisionsInTransaction(hbDb, output.decisions, tickNumber, gathered.contact, eventBusRef);
  });

  // Execute the transaction
  runTransaction();

  log.info(`DB transaction complete: thought=${!!output.thought?.content}, experience=${!!output.experience?.content}, emotions=${output.emotionDeltas.length}, energy=${!!(settings.energySystemEnabled && output.energyDelta)}`);
  logExecuteEvent('execute_transaction_complete', {
    hadThought: !!output.thought?.content,
    hadExperience: !!output.experience?.content,
    emotionDeltaCount: output.emotionDeltas.length,
    hadEnergyDelta: !!(settings.energySystemEnabled && output.energyDelta),
    decisionCount: output.decisions.length,
  });

  // 4b-4d. Execute decisions (agent, plugin, goal/task, channel) -- outside transaction
  await executeDecisions(
    hbDb,
    output.decisions,
    tickNumber,
    gathered.contact,
    gathered.trigger.channel,
    gathered.trigger.metadata as Record<string, unknown> | undefined,
    deps.decisionDeps,
    eventBusRef,
  );

  if (output.decisions.length > 0) {
    log.info(`Decisions executed: ${output.decisions.map(d => d.type).join(', ')}`);
  }

  // Auto-complete one-shot scheduled tasks after the mind processes them.
  // The scheduler sets status to in_progress when it fires a task. If the mind
  // handled it (sent a reply, took action) but didn't explicitly issue a
  // complete_task decision, the task would stay in_progress forever.
  // For one-shot tasks, firing = execution — auto-complete if still in_progress.
  // Recurring tasks are handled by the scheduler (rescheduled in fireTask).
  if (gathered.trigger.type === 'scheduled_task' && gathered.trigger.taskId) {
    const taskId = gathered.trigger.taskId;
    const mindExplicitlyHandled = output.decisions.some(
      d => ['complete_task', 'cancel_task', 'skip_task'].includes(d.type) &&
           (d.parameters as Record<string, unknown>)?.['taskId'] === taskId
    );
    if (!mindExplicitlyHandled) {
      const task = taskStore.getTask(hbDb, taskId);
      if (task && task.status === 'in_progress' && task.scheduleType === 'one_shot') {
        taskStore.updateTask(hbDb, taskId, {
          status: 'completed',
          completedAt: now(),
          result: 'Auto-completed after scheduled tick execution',
        });
        const updated = taskStore.getTask(hbDb, taskId);
        if (updated) eventBus.emit('task:updated', updated);
        log.info(`Auto-completed one-shot task "${task.title}" (${taskId})`);
      }
    }
  }
  logExecuteEvent('execute_decisions_complete', {
    agentDecisions: output.decisions.filter(d => ['spawn_agent', 'update_agent', 'cancel_agent'].includes(d.type)).length,
    pluginDecisions: output.decisions.filter(d => !builtInDecisionTypeSchema.safeParse(d.type).success).length,
    goalTaskDecisions: output.decisions.filter(d => [
      'create_seed', 'propose_goal', 'update_goal', 'create_plan', 'revise_plan',
      'schedule_task', 'start_task', 'complete_task', 'cancel_task', 'skip_task',
    ].includes(d.type)).length,
    totalDecisions: output.decisions.length,
    decisionTypes: output.decisions.map(d => d.type),
  });

  // 6+7. Memory candidates + seed resonance (parallelized)
  {
    const memoryPromise = (async () => {
      if (!deps.memoryManager) return;
      try {
        // Working memory update
        if (output.workingMemoryUpdate && gathered.contact) {
          deps.memoryManager.updateWorkingMemory(gathered.contact.id, output.workingMemoryUpdate);
        }

        // Core self update
        if (output.coreSelfUpdate) {
          deps.memoryManager.updateCoreSelf(output.coreSelfUpdate);
        }

        // Memory candidates -> long-term memory (parallel)
        if (output.memoryCandidate && output.memoryCandidate.length > 0) {
          await Promise.all(output.memoryCandidate.map(candidate =>
            deps.memoryManager!.storeMemory({
              content: candidate.content,
              memoryType: candidate.type,
              importance: candidate.importance,
              ...(candidate.contactId !== undefined && { contactId: candidate.contactId }),
              ...(candidate.keywords !== undefined && { keywords: candidate.keywords }),
            })
          ));
        }
      } catch (err) {
        log.error(`Memory processing failed for tick #${tickNumber}:`, err);
      }
    })();

    const seedPromise = (async () => {
      if (!deps.seedManager) return;

      // Seed resonance check — use all thoughts when available (mid-tick re-entry)
      const resonanceThoughts = (options?.allThoughts && options.allThoughts.length > 0
        ? options.allThoughts
        : (output.thought?.content ? [output.thought] : [])
      ).filter(t => t.content && t.importance >= 0.3);
      if (resonanceThoughts.length > 0) {
        try {
          await deps.seedManager.checkSeedResonance(resonanceThoughts);
        } catch (err) {
          log.warn('Seed resonance check failed:', err);
        }
      }

      // Apply time-based decay to all active seeds
      try {
        deps.seedManager.applyDecay();
      } catch (err) {
        log.warn('Seed decay failed:', err);
      }

      // Check for graduation
      try {
        deps.seedManager.checkGraduation();
      } catch (err) {
        log.warn('Seed graduation check failed:', err);
      }
    })();

    await Promise.all([memoryPromise, seedPromise]);
  }

  logExecuteEvent('execute_memory_complete', {
    candidateCount: output.memoryCandidate?.length ?? 0,
    candidateTypes: output.memoryCandidate?.map(c => c.type) ?? [],
    hadWorkingMemoryUpdate: !!output.workingMemoryUpdate,
    workingMemoryContactId: output.workingMemoryUpdate && gathered.contact ? gathered.contact.id : null,
    hadCoreSelfUpdate: !!output.coreSelfUpdate,
    hadSeedResonance: !!(deps.seedManager && output.thought?.content && output.thought.importance >= 0.3),
  });

  // 8. Observational memory processing (async, non-blocking)
  // Requires both agentManager and compiledPersona -- persona may be null on first boot
  if (deps.agentManager && deps.compiledPersona) {
    try {
      // Fire-and-forget -- don't await, don't block next tick
      processAllStreams({
        deps: {
          agentManager: deps.agentManager,
          memoryDb: getMemoryDb(),
          compiledPersona: deps.compiledPersona.compiledText,
          eventBus: eventBusRef,
        },
        thoughts: gathered.thoughtContext.allFilteredItems,
        experiences: gathered.experienceContext.allFilteredItems,
        messages: gathered.messageContext?.allFilteredItems ?? [],
        contactId: gathered.contact?.id ?? null,
        config: OBSERVATIONAL_MEMORY_CONFIG,
        ...(settings.timezone ? { timezone: settings.timezone } : {}),
      }).catch(err => {
        log.warn('Observation processing failed (non-fatal):', err);
      });
    } catch (err) {
      log.warn('Observation processing setup failed (non-fatal):', err);
    }
  }

  // 9. Cleanup expired entries
  heartbeatStore.cleanupExpiredEntries(hbDb);
  heartbeatStore.cleanupEnergyHistory(hbDb, settings.emotionHistoryRetentionDays);
  heartbeatStore.cleanupOldEmotionHistory(hbDb, settings.emotionHistoryRetentionDays);
  agentLogStore.cleanupOldSessions(getAgentLogsDb(), settings.agentLogRetentionDays);
  taskStore.cleanupOldTaskRuns(hbDb, settings.taskRunRetentionDays);
  heartbeatStore.expirePendingApprovals(hbDb);
  heartbeatStore.cleanupOldApprovals(hbDb, 7);

  // 9b. Periodic deferred task staleness processing (~every 50 ticks)
  if (tickNumber % 50 === 0) {
    try {
      const { boosted, cancelled } = getDeferredQueue().processStaleness();
      if (boosted > 0 || cancelled > 0) {
        log.info(`Deferred task staleness: boosted=${boosted}, cancelled=${cancelled}`);
      }
    } catch (err) {
      log.warn('Deferred task staleness processing failed:', err);
    }
  }

  const executeMs = Date.now() - executeStartTime;
  log.info(`Execute complete (${executeMs}ms)`);
  logExecuteEvent('execute_complete', { totalDurationMs: executeMs });
}
