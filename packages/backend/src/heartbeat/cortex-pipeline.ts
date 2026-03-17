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

import type { CortexAgent, AgentTextOutput, CortexEvent } from '@animus-labs/cortex';
import { zodToTypebox } from '@animus-labs/cortex';
import type { MindOutput } from '@animus-labs/shared';
import { recordThoughtSchema, recordCognitiveStateSchema } from './cognitive-tools.js';

import { createLogger } from '../lib/logger.js';
import { getEventBus } from '../lib/event-bus.js';
import { getAgentLogsDb } from '../db/index.js';
import * as agentLogStore from '../db/stores/agent-log-store.js';

import type { GatherResult } from './gather-context.js';
import type { CompiledPersona } from './persona-compiler.js';
import { isNonResponse, type CognitiveSnapshot, createEmptySnapshot, snapshotToMindOutput, safeMindOutput } from './cognitive-tools.js';
import {
  buildTriggerSection,
  getReplyGuidance,
  buildChannelCapabilities,
  buildContactPresence,
  buildExternalHistorySection,
  buildDeliveryFailuresSection,
  buildEnergyMagnitudeCalibration,
  buildFirstTickKickstart,
  PREAMBLE,
  EMOTION_GUIDANCE,
  buildEnergyGuidance,
  buildDecisionRef,
  MEMORY_INSTRUCTIONS,
  GOAL_GUIDANCE,
} from './context-builder.js';

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

    // THOUGHT uses the primary model (same as agentic loop), not the utility model.
    // Uses tool-call-as-structured-output: define a tool matching the desired schema,
    // the model "calls" it, and we extract the arguments as structured data.
    const thoughtSchema = await zodToTypebox(recordThoughtSchema);
    const result = await cortexAgent.structuredComplete(
      {
        systemPrompt: thoughtSystemPrompt,
        messages: [{ role: 'user', content: thoughtPrompt }],
      },
      thoughtSchema,
      'record_thought',
      'Record your inner thought for this moment.',
    );

    let thought: ThoughtResult;
    if (result) {
      thought = {
        content: typeof result['content'] === 'string' ? result['content'] : 'A quiet moment passes.',
        importance: typeof result['importance'] === 'number' ? Math.max(0, Math.min(1, result['importance'])) : 0.3,
      };
    } else {
      // Model didn't call the tool — fall back to directComplete text
      log.warn('THOUGHT: model did not produce structured output, using fallback');
      const textResponse = await cortexAgent.directComplete({
        systemPrompt: thoughtSystemPrompt,
        messages: [{ role: 'user', content: thoughtPrompt }],
      });
      thought = { content: textResponse.trim() || 'A quiet moment passes.', importance: 0.2 };
    }

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

/**
 * Generate a context-aware placeholder thought from gathered state.
 * This replaces the static hardcoded string and produces varied output
 * based on the trigger type and available context until utilityComplete()
 * is available.
 */
function generatePlaceholderThought(gathered: GatherResult): ThoughtResult {
  const trigger = gathered.trigger;

  if (trigger.type === 'message') {
    const who = trigger.contactName ?? 'someone';
    const preview = trigger.messageContent
      ? trigger.messageContent.substring(0, 60)
      : 'something';
    return {
      content: `${who} reached out. Processing what they said about ${preview}...`,
      importance: 0.4,
    };
  }

  if (trigger.type === 'scheduled_task') {
    return {
      content: `A scheduled task came due: ${trigger.taskTitle ?? 'something pending'}. Time to follow through.`,
      importance: 0.5,
    };
  }

  if (trigger.type === 'agent_complete') {
    return {
      content: `A sub-agent finished its work: ${trigger.taskDescription ?? 'a delegated task'}. Reviewing what came back.`,
      importance: 0.4,
    };
  }

  // interval trigger or unknown
  const activeEmotions = gathered.emotions.filter(e => e.intensity > 0.15);
  if (activeEmotions.length > 0) {
    const top = activeEmotions.sort((a, b) => b.intensity - a.intensity)[0];
    return {
      content: `A quiet interval passes. Feeling a thread of ${top.emotion} (${top.intensity.toFixed(2)}).`,
      importance: 0.2,
    };
  }

  return {
    content: 'A quiet moment between moments. The world turns and I turn with it.',
    importance: 0.1,
  };
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
  const ephemeralSections = buildEphemeralContext(gathered, thought, config);
  cortexAgent.getContextManager().setEphemeral(ephemeralSections);

  // Build the tick prompt (trigger context IS the user message)
  const tickPrompt = buildTriggerSection(gathered.trigger);

  // Reply tracking
  let replyAccumulated = '';
  let replySentEarly = false;
  let replyTurnsSent = 0;

  // Wire turn_end handler for per-turn reply delivery.
  //
  // Channel-aware working tag delivery (see docs/cortex/working-tags.md):
  // - SMS/Discord (external channels): deliver userFacing only (working tags stripped)
  //   via the channelContent parameter on sendOutbound.
  // - Web frontend: DB stores raw text (with working tags) for inline rendering with
  //   visual differentiation. Real-time streaming via reply:chunk events also uses raw.
  // - The web channel's sendToChannel is a no-op; the frontend reads from the DB.
  const turnEndUnsub = cortexAgent.getEventBridge().on('turn_end', (event: CortexEvent) => {
    if (!event.textOutput?.userFacing) return;

    const userFacingText = event.textOutput.userFacing;
    const rawText = event.textOutput.raw;
    if (isNonResponse(userFacingText)) {
      log.info(`Filtered non-response turn: "${userFacingText.trim()}"`);
      return;
    }

    replyAccumulated += (replyAccumulated ? '\n' : '') + userFacingText;

    // Allow replies for both full contacts and recognized participants
    const turnContactId = gathered.contact?.id ?? gathered.trigger.contactId;
    if (!isMessageTrigger || !turnContactId || !gathered.trigger.channel) return;

    // Determine if this is a non-web channel (external delivery target)
    const isWebChannel = gathered.trigger.channel === 'web';

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

        // For the web channel, store raw text (with working tags) in the DB so the
        // frontend can render them with visual differentiation. For external channels
        // (SMS, Discord, API), store raw in the DB for observability but deliver
        // userFacing via channelContent so the adapter sends clean text.
        await router.sendOutbound({
          contactId: turnContactId,
          channel: gathered.trigger.channel!,
          content: isWebChannel ? rawText.trim() : rawText.trim(),
          ...(!isWebChannel ? { channelContent: userFacingText.trim() } : {}),
          ...(hasReplyMetadata ? { metadata: replyMetadata } : {}),
        });
        replyTurnsSent++;
        replySentEarly = true;
        log.info(`Turn reply sent on "${gathered.trigger.channel}" for tick #${tickNumber} (${userFacingText.length} chars)`);

        eventBus.emit('reply:turn_complete', {
          turnIndex: replyTurnsSent - 1,
          content: userFacingText.trim(),
          tickNumber,
          channel: triggerChannel,
        });
      } catch (channelErr) {
        log.debug('Turn reply send failed:', channelErr);
      }
    })();
  });

  // Wire response_chunk handler for real-time streaming to frontend
  const chunkUnsub = cortexAgent.getEventBridge().on('response_chunk', (event: CortexEvent) => {
    if (!isMessageTrigger) return;

    // Extract text chunk from the event
    const data = event.data as Record<string, unknown> | undefined;
    const chunk = data?.['text'] as string | undefined;
    if (!chunk) return;

    eventBus.emit('reply:chunk', {
      content: chunk,
      accumulated: replyAccumulated + chunk,
      turnIndex: 0, // Will be refined when turn tracking is wired
      channel: triggerChannel,
    });
  });

  // Prepend any messages queued during THOUGHT phase to the tick prompt.
  // These arrived before the agentic loop started, so steer() cannot be used
  // (it requires a running loop). Instead, include them in the initial prompt.
  let effectiveTickPrompt = tickPrompt;
  if (pendingInjections.length > 0) {
    log.info(`Prepending ${pendingInjections.length} queued injection(s) from THOUGHT phase to tick prompt`);
    const injectionText = pendingInjections.map(msg =>
      `[Message received during thought phase]\nFrom: ${gathered.contact?.fullName ?? 'User'} via ${msg.channel}\n"${msg.content}"`
    ).join('\n\n');
    effectiveTickPrompt = injectionText + '\n\n' + tickPrompt;
    pendingInjections.length = 0; // clear
  }

  try {
    // Run the agentic loop
    await cortexAgent.prompt(effectiveTickPrompt);

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

  // Build REFLECT-specific system prompt with all 8 documented sections
  const reflectSystemPrompt = buildReflectSystemPrompt(compiledPersona, gathered);

  const maxRetries = 3;
  const baseDelayMs = 1000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // REFLECT uses the primary model (same as agentic loop), not the utility model.
      // Uses tool-call-as-structured-output with the existing recordCognitiveStateSchema.
      const reflectPrompt = buildReflectPrompt(thought, loopResult);
      const reflectSchema = await zodToTypebox(recordCognitiveStateSchema);
      const parsed = await cortexAgent.structuredComplete(
        {
          systemPrompt: reflectSystemPrompt,
          messages: [{ role: 'user', content: reflectPrompt }],
        },
        reflectSchema,
        'record_cognitive_state',
        'Record your cognitive state: experience, emotions, decisions, and memories.',
      );

      let result: ReflectResult;
      if (parsed) {
        const exp = parsed['experience'] as Record<string, unknown> | undefined;
        result = {
          experience: {
            content: typeof exp?.['content'] === 'string' ? exp['content'] : 'A tick passed without notable experience.',
            importance: typeof exp?.['importance'] === 'number'
              ? Math.max(0, Math.min(1, exp['importance']))
              : 0.2,
          },
          emotionDeltas: Array.isArray(parsed['emotionDeltas']) ? parsed['emotionDeltas'] as ReflectResult['emotionDeltas'] : [],
          energyDelta: (parsed['energyDelta'] as ReflectResult['energyDelta']) ?? null,
          decisions: Array.isArray(parsed['decisions']) ? parsed['decisions'] as ReflectResult['decisions'] : [],
          workingMemoryUpdate: (parsed['workingMemoryUpdate'] as string) ?? null,
          coreSelfUpdate: (parsed['coreSelfUpdate'] as string) ?? null,
          memoryCandidate: Array.isArray(parsed['memoryCandidate']) ? parsed['memoryCandidate'] as ReflectResult['memoryCandidate'] : [],
        };
      } else {
        // Model didn't call the tool — produce minimal reflection
        log.warn('REFLECT: model did not produce structured output, using fallback');
        result = generatePlaceholderReflection(gathered, thought, loopResult);
      }

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

/**
 * Generate a context-aware placeholder reflection from gathered state.
 * Produces varied output based on the trigger type and emotional state
 * until utilityComplete() is available.
 */
function generatePlaceholderReflection(
  gathered: GatherResult,
  thought: ThoughtResult | null,
  loopResult: AgenticLoopResult,
): ReflectResult {
  const trigger = gathered.trigger;
  const name = gathered.contact?.fullName ?? 'the world';

  // Build a contextual experience narration
  let experienceContent: string;
  let experienceImportance: number;

  if (trigger.type === 'message' && loopResult.hadTurns) {
    experienceContent = `Engaged in conversation with ${name}. The exchange carried its own weight.`;
    experienceImportance = 0.4;
  } else if (trigger.type === 'scheduled_task') {
    experienceContent = `Attended to a scheduled task: ${trigger.taskTitle ?? 'a pending duty'}. The rhythm of routine continued.`;
    experienceImportance = 0.3;
  } else if (trigger.type === 'agent_complete') {
    experienceContent = `Received results from a delegated task. Reviewed what the sub-agent produced.`;
    experienceImportance = 0.3;
  } else {
    experienceContent = 'A quiet interval passed. The inner world turned at its own pace.';
    experienceImportance = 0.1;
  }

  return {
    experience: {
      content: experienceContent,
      importance: experienceImportance,
    },
    emotionDeltas: [],
    energyDelta: null,
    decisions: [],
    workingMemoryUpdate: null,
    coreSelfUpdate: null,
    memoryCandidate: [],
  };
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

  // If the reply was already sent during the agentic loop (per-turn delivery),
  // clear output.reply so execute doesn't send a duplicate.
  if (loopResult.replySentEarly && output.reply) {
    output.reply = undefined;
  }

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
 * Includes: Thought Instructions, Persona, Inner Life PREAMBLE.
 * Starts with thought instructions for unique prefix cache.
 *
 * Per docs/cortex/mind-migration.md THOUGHT Context table:
 * - Thought Instructions: Yes (first, for cache divergence)
 * - Persona: Yes
 * - Inner Life (PREAMBLE): Yes
 * - Emotion/Energy/Decisions/Memory/Goal Guidance: No
 * - Installed Plugins & Tools: No
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

  // Inner Life PREAMBLE
  sections.push(PREAMBLE);

  return sections.join('\n\n');
}

/**
 * Build the REFLECT-specific system prompt with all 8 documented sections.
 *
 * Per docs/cortex/mind-migration.md REFLECT Context table:
 * 1. Reflect Instructions (first, for cache prefix divergence)
 * 2. Persona
 * 3. Inner Life (PREAMBLE)
 * 4. Emotion Guidance
 * 5. Energy Guidance
 * 6. Decisions Reference
 * 7. Memory Instructions
 * 8. Goal Guidance
 */
function buildReflectSystemPrompt(compiledPersona: CompiledPersona, gathered: GatherResult): string {
  const sections: string[] = [];

  // 1. Reflect Instructions FIRST (for cache prefix divergence)
  sections.push(`# Cognitive Reflection

You are reflecting on what just happened during this tick. You have full
visibility into the conversation history, tool calls, and decisions made.
Your task is to produce a structured cognitive state capturing your inner
experience.

Respond with a JSON object containing:
{
  "experience": {
    "content": "Third-person past tense narration of what happened, under 72 words, using your name.",
    "importance": 0.0-1.0
  },
  "emotionDeltas": [
    { "emotion": "<one of 12 emotions>", "delta": -0.3 to 0.3, "reasoning": "why this shifted" }
  ],
  "energyDelta": { "delta": -0.1 to 0.1, "reasoning": "why energy changed" } | null,
  "decisions": [
    { "type": "<decision_type>", "description": "what and why", "parameters": { ... } }
  ],
  "workingMemoryUpdate": "complete replacement text" | null,
  "coreSelfUpdate": "complete replacement text" | null,
  "memoryCandidate": [
    { "content": "...", "memoryType": "fact|experience|procedure|outcome", "importance": 0.0-1.0, "contactId?": "...", "keywords?": [...] }
  ]
}

Only include emotions that actually shifted. Only include memory candidates
for genuinely noteworthy knowledge. Experience narration should be in third
person, past tense, using your name.`);

  // 2. Persona
  if (compiledPersona.compiledText) {
    sections.push(compiledPersona.compiledText);
  }

  // 3. Inner Life PREAMBLE
  sections.push(PREAMBLE);

  // 4. Emotion Guidance
  sections.push(EMOTION_GUIDANCE);

  // 5. Energy Guidance
  sections.push(buildEnergyGuidance());

  // 6. Decisions Reference
  sections.push(buildDecisionRef(gathered.pluginDecisionDescriptions || undefined));

  // 7. Memory Instructions
  sections.push(MEMORY_INSTRUCTIONS);

  // 8. Goal Guidance
  sections.push(GOAL_GUIDANCE);

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

  lines.push('\nUse the record_thought tool to capture your thought.');

  return lines.join('\n');
}

/**
 * Build the REFLECT prompt (user message summarizing what happened this tick).
 * Provides the thought and agentic loop outcome as context for reflection.
 */
function buildReflectPrompt(
  thought: ThoughtResult | null,
  loopResult: AgenticLoopResult,
): string {
  const lines: string[] = [];

  lines.push('Reflect on what happened during this tick and produce your cognitive state update.');

  if (thought) {
    lines.push(`\nYour thought this tick: "${thought.content}" (importance: ${thought.importance.toFixed(1)})`);
  } else {
    lines.push('\nThought generation was skipped this tick.');
  }

  if (loopResult.hadTurns) {
    lines.push(`\nThe agentic loop produced a response (${loopResult.replyText.length} characters).`);
    if (loopResult.replyTurnsSent > 0) {
      lines.push(`${loopResult.replyTurnsSent} reply turn(s) were sent to the user.`);
    }
  } else {
    lines.push('\nThe agentic loop did not produce any response this tick.');
  }

  lines.push('\nReview the full conversation history above for details of tool calls, reasoning, and interactions.');
  lines.push('\nUse the record_cognitive_state tool to capture your reflection.');

  return lines.join('\n');
}

/**
 * Build ephemeral context for the agentic loop.
 * Injected via transformContext, never stored in messages.
 *
 * Includes all 17 documented ephemeral sections from
 * docs/cortex/mind-migration.md.
 */
function buildEphemeralContext(
  gathered: GatherResult,
  thought: ThoughtResult | null,
  config: PipelineConfig,
): string {
  const sections: string[] = [];

  // 1. Date/time awareness
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

  // 2. Active contact (message triggers only)
  if (gathered.trigger.type === 'message' && gathered.contact) {
    sections.push(`You are talking to: ${gathered.contact.fullName} (${gathered.contact.permissionTier} tier)`);
  }

  // 3. Reply guidance (channel-specific)
  if (gathered.trigger.channel) {
    const replyGuidance = getReplyGuidance(gathered.trigger.channel);
    if (replyGuidance) {
      sections.push(replyGuidance);
    }
  }

  // 4. Channel capabilities (rich features like reactions, voice)
  if (gathered.trigger.channel) {
    const capabilities = buildChannelCapabilities(gathered.trigger.channel);
    if (capabilities) {
      sections.push(capabilities);
    }
  }

  // 5. Contact presence (online/offline/activity)
  if (gathered.contact && gathered.trigger.channel) {
    const presence = buildContactPresence(gathered.contact, gathered.trigger.channel);
    if (presence) {
      sections.push(presence);
    }
  }

  // 6. Thought from Phase 2 (or null note)
  if (thought) {
    sections.push(`Your current thought: "${thought.content}" (importance: ${thought.importance.toFixed(1)})`);
  } else {
    sections.push('Thought generation was skipped this tick.');
  }

  // 7. Emotional state
  const activeEmotions = gathered.emotions.filter(e => e.intensity > 0.1);
  if (activeEmotions.length > 0) {
    const emotionLines = activeEmotions.map(e =>
      `  ${e.emotion}: ${e.intensity.toFixed(2)}`
    );
    sections.push('Current emotional state:\n' + emotionLines.join('\n'));
  }

  // 8. Energy state
  if (gathered.energySystemEnabled && gathered.energyLevel != null) {
    sections.push(`Energy: ${gathered.energyLevel.toFixed(2)} (${gathered.energyBand ?? 'unknown'})`);
  }

  // 9. Recent thoughts (raw, for context)
  if (gathered.recentThoughts.length > 0) {
    const recent = gathered.recentThoughts.slice(-5);
    const lines = recent.map(t => `  - ${t.content}`);
    sections.push('Recent thoughts:\n' + lines.join('\n'));
  }

  // 10. Recent experiences (raw, for context)
  if (gathered.recentExperiences.length > 0) {
    const recent = gathered.recentExperiences.slice(-5);
    const lines = recent.map(e => `  - ${e.content}`);
    sections.push('Recent experiences:\n' + lines.join('\n'));
  }

  // 11. Long-term memories (from semantic search)
  if (gathered.memoryContext?.longTermMemorySection) {
    sections.push(gathered.memoryContext.longTermMemorySection);
  }

  // 12. External history (messages from Discord servers, Slack channels, etc.)
  if (gathered.externalHistory && gathered.externalHistory.size > 0) {
    sections.push(buildExternalHistorySection(gathered.externalHistory));
  }

  // 13. Previous tick outcomes
  if (gathered.previousDecisions.length > 0) {
    const lines = gathered.previousDecisions.map(d => {
      const status = d.outcome === 'executed' ? 'done' : d.outcome;
      return `  - ${d.type}: ${d.description} [${status}]`;
    });
    sections.push('Previous tick outcomes:\n' + lines.join('\n'));
  }

  // 14. Graduating seeds (one-time prompt when a seed graduates to goal proposal)
  if (gathered.goalContext?.graduatingSeedsSection) {
    sections.push('-- EMERGING INTEREST --\n' + gathered.goalContext.graduatingSeedsSection);
  }

  // 15. Delivery failures (outbound messages that failed after retries)
  if (gathered.deliveryFailures.length > 0) {
    sections.push(buildDeliveryFailuresSection(gathered.deliveryFailures));
  }

  // 16. Tick-interval energy magnitude calibration
  if (gathered.energySystemEnabled) {
    sections.push(buildEnergyMagnitudeCalibration(gathered.tickIntervalMs));
  }

  // 17. First tick kickstart (only on tick 1 with no prior experiences)
  if (config.tickNumber === 1 && gathered.recentExperiences.length === 0) {
    sections.push(buildFirstTickKickstart(
      config.compiledPersona,
      // Infer paradigm from persona config or default
      undefined,
      undefined,
    ));
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
