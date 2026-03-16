/**
 * Cortex 5-Phase Pipeline
 *
 * Implements the THOUGHT -> AGENTIC LOOP -> REFLECT pipeline phases
 * as direct pi-ai calls (THOUGHT, REFLECT) and cortexAgent.prompt()
 * (AGENTIC LOOP).
 *
 * GATHER and EXECUTE are handled by the existing gather-context.ts and
 * execute-output.ts respectively. This file covers Phases 2-4.
 *
 * See docs/cortex/mind-migration.md for the full design.
 */

import type { CortexAgent, AgentTextOutput } from '@animus-labs/cortex';
import type { MindOutput, ChannelType, IEventBus } from '@animus-labs/shared';

import { createLogger } from '../lib/logger.js';
import { getEventBus } from '../lib/event-bus.js';
import { getHeartbeatDb, getAgentLogsDb } from '../db/index.js';
import * as heartbeatStore from '../db/stores/heartbeat-store.js';
import * as agentLogStore from '../db/stores/agent-log-store.js';

import type { GatherResult } from './gather-context.js';
import type { CompiledPersona } from './persona-compiler.js';
import { isNonResponse, type CognitiveSnapshot, createEmptySnapshot, snapshotToMindOutput, safeMindOutput } from './cognitive-tools.js';
import { buildTriggerSection } from './context-builder.js';
import { buildTriggerSection } from './context-builder.js';

const log = createLogger('CortexPipeline', 'heartbeat');

// ============================================================================
// Types
// ============================================================================

/** Current pipeline phase for mid-tick injection routing */
export type PipelinePhase = 'gather' | 'thought' | 'agentic-loop' | 'reflect' | 'execute';

/** Result of the 5-phase pipeline */
export interface PipelineResult {
  output: MindOutput;
  replySentEarly: boolean;
  earlyReplyContent: string;
  allThoughts: Array<{ content: string; importance: number }>;
  replyTurnsSent: number;
}

/** Configuration for a pipeline run */
export interface PipelineConfig {
  cortexAgent: CortexAgent;
  gathered: GatherResult;
  compiledPersona: CompiledPersona;
  tickNumber: number;
  systemPrompt: string;
  logSessionId: string | null;
}

// ============================================================================
// THOUGHT Phase (Phase 2)
// ============================================================================

interface ThoughtResult {
  content: string;
  importance: number;
}

/**
 * Execute the THOUGHT phase.
 *
 * Makes a direct pi-ai complete() call (NOT through agent.prompt()) to
 * generate the agent's inner thought. This replaces the old record_thought
 * MCP tool.
 *
 * The response is NOT added to agent.state.messages. The thought is
 * persisted to heartbeat.db and injected into ephemeral context for
 * the agentic loop.
 *
 * On failure: log warning, continue with null thought (do not retry).
 */
async function executeThought(
  config: PipelineConfig,
): Promise<ThoughtResult | null> {
  const { cortexAgent, gathered, compiledPersona, tickNumber } = config;

  log.info(`THOUGHT phase starting (tick #${tickNumber})`);

  try {
    // Build THOUGHT-specific system prompt (stripped down, no tool/decision/goal guidance)
    const thoughtSystemPrompt = buildThoughtSystemPrompt(compiledPersona);

    // Build THOUGHT-specific context (user message with structured output schema)
    const thoughtPrompt = buildThoughtPrompt(gathered);

    // TODO: Make direct pi-ai call via cortexAgent.utilityComplete() or
    // direct import of pi-ai complete(). For Phase 2A, we use a simplified
    // approach through cortexAgent.prompt() but with the thought prompt only.
    //
    // In the final implementation, this will be:
    //   const piAi = await import('@mariozechner/pi-ai');
    //   const response = await piAi.complete(cortexAgent.getModel(), {
    //     systemPrompt: thoughtSystemPrompt,
    //     messages: [...slots, ...history, ...ephemeral, { role: 'user', content: thoughtPrompt }],
    //   });
    //
    // For now, parse a structured response from the thought prompt.
    // This is a temporary bridge until pi-ai's complete() is wired.

    // Placeholder: Generate a default thought for now
    // In production, this calls pi-ai complete() directly
    const thought: ThoughtResult = {
      content: 'A quiet moment of reflection passes.',
      importance: 0.2,
    };

    log.info(`THOUGHT complete: "${thought.content.substring(0, 80)}${thought.content.length > 80 ? '...' : ''}" (importance=${thought.importance})`);

    return thought;
  } catch (err) {
    // THOUGHT failure: log and continue (do not retry, latency-sensitive)
    log.warn(`THOUGHT phase failed (tick #${tickNumber}), continuing without thought:`, err);

    // Log as a lifecycle event
    if (config.logSessionId) {
      try {
        const agentLogsDb = getAgentLogsDb();
        agentLogStore.insertEvent(agentLogsDb, {
          sessionId: config.logSessionId,
          eventType: 'thought_failed' as any,
          data: {
            tickNumber,
            error: err instanceof Error ? err.message : String(err),
          },
        });
      } catch (logErr) {
        log.warn('Failed to log thought_failed event:', logErr);
      }
    }

    return null;
  }
}

// ============================================================================
// AGENTIC LOOP Phase (Phase 3)
// ============================================================================

interface AgenticLoopResult {
  replyText: string;
  replySentEarly: boolean;
  replyTurnsSent: number;
  hadTurns: boolean;
}

/**
 * Execute the AGENTIC LOOP phase.
 *
 * Runs cortexAgent.prompt(tickPrompt) with the full tool set.
 * Reply text streams via event bridge response_chunk events.
 * Reply delivery via ChannelRouter.sendOutbound() at turn_end events.
 *
 * No phase gate: text streams immediately (THOUGHT already captured).
 */
async function executeAgenticLoop(
  config: PipelineConfig,
  thought: ThoughtResult | null,
  pendingInjections: Array<{ content: string; contactId: string; channel: string }>,
): Promise<AgenticLoopResult> {
  const { cortexAgent, gathered, tickNumber } = config;
  const eventBus = getEventBus();
  const isMessageTrigger = gathered.trigger.type === 'message';
  const triggerChannel = gathered.trigger.channel ?? '';

  log.info(`AGENTIC LOOP starting (tick #${tickNumber})`);

  // Set ephemeral context (thought + per-tick sections)
  const ephemeralSections = buildEphemeralContext(gathered, thought);
  cortexAgent.getContextManager().setEphemeral(ephemeralSections);

  // Build the tick prompt (trigger context IS the user message)
  const tickPrompt = buildTriggerSection(gathered.trigger);

  // Reply tracking
  let replyAccumulated = '';
  let replySentEarly = false;
  let replyTurnsSent = 0;

  // Wire turn_end handler for per-turn reply delivery
  const turnEndUnsub = cortexAgent.getEventBridge().on('turn_end', (event) => {
    if (!event.textOutput?.userFacing) return;

    const turnText = event.textOutput.userFacing;
    if (isNonResponse(turnText)) {
      log.info(`Filtered non-response turn: "${turnText.trim()}"`);
      return;
    }

    replyAccumulated += (replyAccumulated ? '\n' : '') + turnText;

    // Allow replies for both full contacts and recognized participants
    const turnContactId = gathered.contact?.id ?? gathered.trigger.contactId;
    if (!isMessageTrigger || !turnContactId || !gathered.trigger.channel) return;

    // Send per-turn reply
    (async () => {
      try {
        const { getChannelRouter } = await import('../channels/channel-router.js');
        const router = getChannelRouter();
        const triggerMetadata = gathered.trigger?.metadata as Record<string, unknown> | undefined;
        const replyMetadata = triggerMetadata
          ? Object.fromEntries(Object.entries(triggerMetadata).filter(([k]) => k !== 'media'))
          : undefined;
        const hasReplyMetadata = replyMetadata && Object.keys(replyMetadata).length > 0;

        await router.sendOutbound({
          contactId: turnContactId,
          channel: gathered.trigger.channel!,
          content: turnText.trim(),
          ...(hasReplyMetadata ? { metadata: replyMetadata } : {}),
        });
        replyTurnsSent++;
        replySentEarly = true;
        log.info(`Turn reply sent on "${gathered.trigger.channel}" for tick #${tickNumber} (${turnText.length} chars)`);

        eventBus.emit('reply:turn_complete', {
          turnIndex: replyTurnsSent - 1,
          content: turnText.trim(),
          tickNumber,
          channel: triggerChannel,
        });
      } catch (channelErr) {
        log.debug('Turn reply send failed:', channelErr);
      }
    })();
  });

  // Wire response_chunk handler for real-time streaming to frontend
  const chunkUnsub = cortexAgent.getEventBridge().on('response_chunk', (event) => {
    if (!isMessageTrigger) return;

    // Extract text chunk from the event
    const data = event.data as Record<string, unknown> | undefined;
    const chunk = data?.text as string | undefined;
    if (!chunk) return;

    eventBus.emit('reply:chunk', {
      content: chunk,
      accumulated: replyAccumulated + chunk,
      turnIndex: 0, // Will be refined when turn tracking is wired
      channel: triggerChannel,
    });
  });

  // Flush any messages queued during THOUGHT phase
  if (pendingInjections.length > 0) {
    log.info(`Flushing ${pendingInjections.length} queued injection(s) from THOUGHT phase`);
    // TODO: agent.steer() not yet available in CortexAgent Phase 1B
    // For now, inject via ephemeral context
    const injectionText = pendingInjections.map(msg =>
      `[ADDITIONAL MESSAGE received]\nFrom: ${gathered.contact?.fullName ?? 'User'} via ${msg.channel}\n"${msg.content}"`
    ).join('\n\n');

    const currentEphemeral = cortexAgent.getContextManager().getEphemeral() ?? '';
    cortexAgent.getContextManager().setEphemeral(currentEphemeral + '\n\n' + injectionText);
  }

  try {
    // Run the agentic loop
    await cortexAgent.prompt(tickPrompt);

    // Clean up event handlers
    turnEndUnsub();
    chunkUnsub();

    log.info(`AGENTIC LOOP complete (tick #${tickNumber}): reply=${replyAccumulated.length} chars, turns sent=${replyTurnsSent}`);

    // Emit reply completion event
    if (isMessageTrigger && replyAccumulated.trim()) {
      eventBus.emit('reply:complete', {
        content: replyAccumulated.trim(),
        tickNumber,
        totalTurns: replyTurnsSent,
        channel: triggerChannel,
      });
    }

    return {
      replyText: replyAccumulated,
      replySentEarly,
      replyTurnsSent,
      hadTurns: replyAccumulated.length > 0 || replyTurnsSent > 0,
    };
  } catch (err) {
    // Clean up event handlers on error too
    turnEndUnsub();
    chunkUnsub();

    log.error(`AGENTIC LOOP failed (tick #${tickNumber}):`, err);

    return {
      replyText: replyAccumulated,
      replySentEarly,
      replyTurnsSent,
      hadTurns: replyAccumulated.length > 0 || replyTurnsSent > 0,
    };
  }
}

// ============================================================================
// REFLECT Phase (Phase 4)
// ============================================================================

interface ReflectResult {
  experience: { content: string; importance: number };
  emotionDeltas: Array<{ emotion: string; delta: number; reasoning: string }>;
  energyDelta: { delta: number; reasoning: string } | null;
  decisions: Array<{ type: string; description: string; parameters: Record<string, unknown> }>;
  workingMemoryUpdate: string | null;
  coreSelfUpdate: string | null;
  memoryCandidate: Array<{
    content: string;
    memoryType: 'fact' | 'experience' | 'procedure' | 'outcome';
    importance: number;
    contactId?: string;
    keywords?: string[];
  }>;
}

/**
 * Execute the REFLECT phase.
 *
 * Makes a direct pi-ai complete() call (NOT through agent.prompt()) to
 * generate the cognitive state: experience, emotions, energy, memories,
 * decisions. This replaces the old record_cognitive_state MCP tool.
 *
 * The conversation history INCLUDES the agentic loop's turns, giving
 * REFLECT full visibility into what happened during the tick.
 *
 * On failure: retry up to 3 times with exponential backoff (1s, 2s, 4s).
 * If all retries fail, skip reflection.
 */
async function executeReflect(
  config: PipelineConfig,
  thought: ThoughtResult | null,
  loopResult: AgenticLoopResult,
): Promise<ReflectResult | null> {
  const { cortexAgent, gathered, compiledPersona, tickNumber } = config;

  log.info(`REFLECT phase starting (tick #${tickNumber})`);

  const maxRetries = 3;
  const baseDelayMs = 1000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // TODO: Make direct pi-ai call with REFLECT-specific system prompt.
      // For Phase 2A, this is a structured output call.
      //
      // In the final implementation:
      //   const piAi = await import('@mariozechner/pi-ai');
      //   const response = await piAi.complete(cortexAgent.getModel(), {
      //     systemPrompt: reflectSystemPrompt,
      //     messages: [...slots, ...conversationHistory, ...ephemeral, { role: 'user', content: reflectPrompt }],
      //   });
      //
      // Parse the structured output into ReflectResult.

      // Placeholder: Return minimal reflection
      // In production, this calls pi-ai complete() directly
      const result: ReflectResult = {
        experience: {
          content: 'A moment passed in quiet contemplation.',
          importance: 0.2,
        },
        emotionDeltas: [],
        energyDelta: null,
        decisions: [],
        workingMemoryUpdate: null,
        coreSelfUpdate: null,
        memoryCandidate: [],
      };

      log.info(`REFLECT complete (tick #${tickNumber}): ${result.emotionDeltas.length} emotion(s), ${result.decisions.length} decision(s), ${result.memoryCandidate.length} memory candidate(s)`);

      return result;
    } catch (err) {
      if (attempt < maxRetries) {
        const delayMs = baseDelayMs * Math.pow(2, attempt);
        log.warn(`REFLECT attempt ${attempt + 1} failed, retrying in ${delayMs}ms:`, err);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } else {
        log.error(`REFLECT failed after ${maxRetries + 1} attempts (tick #${tickNumber}):`, err);

        // Log as a lifecycle event
        if (config.logSessionId) {
          try {
            const agentLogsDb = getAgentLogsDb();
            agentLogStore.insertEvent(agentLogsDb, {
              sessionId: config.logSessionId,
              eventType: 'reflect_failed' as any,
              data: {
                tickNumber,
                error: err instanceof Error ? err.message : String(err),
                attempts: maxRetries + 1,
              },
            });
          } catch (logErr) {
            log.warn('Failed to log reflect_failed event:', logErr);
          }
        }

        return null;
      }
    }
  }

  return null;
}

// ============================================================================
// Full Pipeline
// ============================================================================

/**
 * Execute the 5-phase pipeline: THOUGHT -> AGENTIC LOOP -> REFLECT
 *
 * GATHER and EXECUTE are handled externally (in heartbeat/index.ts).
 * This function covers Phases 2-4 and assembles the MindOutput.
 */
export async function executeCortexPipeline(
  config: PipelineConfig,
  currentPhase: { value: PipelinePhase },
  pendingInjections: Array<{ content: string; contactId: string; channel: string }>,
): Promise<PipelineResult> {
  const { gathered, tickNumber } = config;
  const triggerInfo = {
    type: gathered.trigger.type,
    contactId: gathered.trigger.contactId,
    channel: gathered.trigger.channel,
    messageId: gathered.trigger.messageId,
  };

  // Phase 2: THOUGHT
  currentPhase.value = 'thought';
  const thought = await executeThought(config);

  // Phase 3: AGENTIC LOOP
  currentPhase.value = 'agentic-loop';
  const loopResult = await executeAgenticLoop(config, thought, pendingInjections);

  // Decide whether to run REFLECT
  const thoughtFailed = thought === null;
  const loopHadContent = loopResult.hadTurns;

  if (!loopHadContent && thoughtFailed) {
    // Both THOUGHT and AGENTIC LOOP produced nothing. Skip REFLECT.
    log.warn(`Skipping REFLECT: no content from THOUGHT or AGENTIC LOOP (tick #${tickNumber})`);
    currentPhase.value = 'execute';
    return {
      output: safeMindOutput(triggerInfo),
      replySentEarly: loopResult.replySentEarly,
      earlyReplyContent: loopResult.replyText,
      allThoughts: thought ? [thought] : [],
      replyTurnsSent: loopResult.replyTurnsSent,
    };
  }

  // Phase 4: REFLECT
  currentPhase.value = 'reflect';
  const reflectResult = await executeReflect(config, thought, loopResult);

  // Assemble MindOutput from the combined pipeline results
  currentPhase.value = 'execute';

  const snapshot: CognitiveSnapshot = {
    thoughts: thought ? [thought] : [],
    experience: reflectResult?.experience ?? null,
    emotionDeltas: reflectResult?.emotionDeltas ?? [],
    energyDelta: reflectResult?.energyDelta ?? null,
    decisions: reflectResult?.decisions ?? [],
    workingMemoryUpdate: reflectResult?.workingMemoryUpdate ?? null,
    coreSelfUpdate: reflectResult?.coreSelfUpdate ?? null,
    memoryCandidate: reflectResult?.memoryCandidate ?? [],
  };

  const output = snapshotToMindOutput(snapshot, loopResult.replyText, gathered);

  return {
    output,
    replySentEarly: loopResult.replySentEarly,
    earlyReplyContent: loopResult.replyText,
    allThoughts: thought ? [thought] : [],
    replyTurnsSent: loopResult.replyTurnsSent,
  };
}

// ============================================================================
// System Prompt Builders
// ============================================================================

/**
 * Build the THOUGHT-specific system prompt.
 * Stripped down: only persona + inner life preamble.
 * Starts with thought instructions for unique prefix cache.
 */
function buildThoughtSystemPrompt(compiledPersona: CompiledPersona): string {
  const sections: string[] = [];

  // Thought instructions FIRST (for cache prefix divergence)
  sections.push(`# Thought Generation

You are generating your inner thought. This is your stream of consciousness,
the next beat in your ongoing inner monologue. Look at your recent thoughts,
consider what has arrived (a message, a completed task, the passage of time),
and generate the next natural thought. Progress the narrative. Do not repeat
or summarize. Keep it short: a few sentences, under 40 words.

Respond with a JSON object:
{
  "content": "your thought text",
  "importance": 0.0-1.0
}

Where importance: 0.0 = idle musing, 1.0 = critical realization.`);

  // Persona
  if (compiledPersona.compiledText) {
    sections.push(compiledPersona.compiledText);
  }

  return sections.join('\n\n');
}

/**
 * Build the THOUGHT prompt (user message with context).
 */
function buildThoughtPrompt(gathered: GatherResult): string {
  const lines: string[] = [];

  lines.push('Generate your next inner thought based on the current moment.');

  // Add trigger context for framing
  if (gathered.trigger.type === 'message') {
    lines.push(`\nA message just arrived from ${gathered.trigger.contactName ?? 'someone'}: "${gathered.trigger.messageContent ?? ''}"`);
  } else if (gathered.trigger.type === 'interval') {
    lines.push('\nSome time has passed since your last thought.');
  } else if (gathered.trigger.type === 'scheduled_task') {
    lines.push(`\nA scheduled task fired: ${gathered.trigger.taskTitle ?? 'unknown'}`);
  } else if (gathered.trigger.type === 'agent_complete') {
    lines.push(`\nA sub-agent completed: ${gathered.trigger.taskDescription ?? 'unknown'}`);
  }

  return lines.join('\n');
}

/**
 * Build ephemeral context for the agentic loop.
 * Injected via transformContext, never stored in messages.
 */
function buildEphemeralContext(
  gathered: GatherResult,
  thought: ThoughtResult | null,
): string {
  const sections: string[] = [];

  // Date/time awareness
  const now = new Date();
  const tz = gathered.aiTimezone || 'UTC';
  try {
    const formatted = now.toLocaleString('en-US', {
      timeZone: tz,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    sections.push(`Current date and time: ${formatted} (${tz})`);
  } catch {
    sections.push(`Current date and time: ${now.toISOString()}`);
  }

  // Active contact (message triggers only)
  if (gathered.trigger.type === 'message' && gathered.contact) {
    sections.push(`You are talking to: ${gathered.contact.fullName} (${gathered.contact.permissionTier} tier)`);
  }

  // Thought from Phase 2 (or null note)
  if (thought) {
    sections.push(`Your current thought: "${thought.content}" (importance: ${thought.importance.toFixed(1)})`);
  } else {
    sections.push('Thought generation was skipped this tick.');
  }

  // Emotional state
  const activeEmotions = gathered.emotions.filter(e => e.intensity > 0.1);
  if (activeEmotions.length > 0) {
    const emotionLines = activeEmotions.map(e =>
      `  ${e.emotion}: ${e.intensity.toFixed(2)}`
    );
    sections.push('Current emotional state:\n' + emotionLines.join('\n'));
  }

  // Energy state
  if (gathered.energySystemEnabled && gathered.energyLevel != null) {
    sections.push(`Energy: ${gathered.energyLevel.toFixed(2)} (${gathered.energyBand ?? 'unknown'})`);
  }

  // Recent thoughts (raw, for context)
  if (gathered.recentThoughts.length > 0) {
    const recent = gathered.recentThoughts.slice(-5);
    const lines = recent.map(t => `  - ${t.content}`);
    sections.push('Recent thoughts:\n' + lines.join('\n'));
  }

  // Long-term memories
  if (gathered.memoryContext?.longTermMemorySection) {
    sections.push(gathered.memoryContext.longTermMemorySection);
  }

  // Previous tick outcomes
  if (gathered.previousDecisions.length > 0) {
    const lines = gathered.previousDecisions.map(d => {
      const status = d.outcome === 'executed' ? 'done' : d.outcome;
      return `  - ${d.type}: ${d.description} [${status}]`;
    });
    sections.push('Previous tick outcomes:\n' + lines.join('\n'));
  }

  // Plugin context sources
  if (gathered.pluginContextSources) {
    sections.push(gathered.pluginContextSources);
  }

  // Trust ramp
  if (gathered.trustRampContext) {
    sections.push(gathered.trustRampContext);
  }

  // Spawn budget
  if (gathered.spawnBudgetNote) {
    sections.push(gathered.spawnBudgetNote);
  }

  return sections.join('\n\n');
}

// Note: buildTriggerSection is imported from context-builder.ts (now exported)
