/**
 * Cognitive MCP Tools — production mind tools for natural language turns.
 *
 * Instead of forcing the entire mind output into a single JSON blob,
 * these tools let the agent think and speak naturally while capturing
 * structured cognitive state via MCP tool calls:
 *
 *   1. record_thought  — called FIRST, captures inner monologue
 *   2. (natural language reply streams between tool calls)
 *   3. record_cognitive_state — called LAST (mandatory), captures experience, emotions, etc.
 *
 * Phase tracking: getPhase() returns 'pre-thought' | 'replying' | 'done'
 * to control reply streaming (only stream during 'replying' phase).
 * Note: record_cognitive_state does NOT transition to 'done' — the phase
 * stays 'replying' to prevent premature text cutoff. Phase resets via
 * resetSnapshot() at the start of each tick.
 *
 * Supports mid-tick re-entry: when messages are injected mid-tick,
 * the model may run multiple thought→reply→state cycles. Thoughts
 * accumulate into an array; state fields use accumulation semantics.
 *
 * Promoted from sandbox/cognitive-tools.ts.
 */

import { z } from 'zod';
import { emotionNameSchema, decisionTypeSchema, memoryTypeSchema } from '@animus-labs/shared';
import type { MindOutput, ChannelType } from '@animus-labs/shared';
import { createLogger } from '../lib/logger.js';
import type { GatherResult } from './gather-context.js';

const log = createLogger('CognitiveTools', 'heartbeat');

// ============================================================================
// Phase Tracking
// ============================================================================

export type CognitivePhase = 'pre-thought' | 'replying' | 'done';

// ============================================================================
// Collected State — accumulates across tool calls within a single prompt
// ============================================================================

export interface CognitiveSnapshot {
  thoughts: Array<{ content: string; importance: number }>;
  experience: { content: string; importance: number } | null;
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

export function createEmptySnapshot(): CognitiveSnapshot {
  return {
    thoughts: [],
    experience: null,
    emotionDeltas: [],
    energyDelta: null,
    decisions: [],
    workingMemoryUpdate: null,
    coreSelfUpdate: null,
    memoryCandidate: [],
  };
}

// ============================================================================
// Zod schemas for the tool inputs
// ============================================================================

export const recordThoughtSchema = z.object({
  content: z
    .string()
    .describe(
      'Your inner monologue — the next beat in your ongoing stream of consciousness. ' +
      'This is NOT chain-of-thought reasoning. This is your simulated inner life. ' +
      'Look at your recent thoughts, consider what has arrived (a message, a completed ' +
      'task, the passage of time), and generate the next natural thought. Progress the ' +
      'narrative — don\'t repeat or summarize. Keep it short: a few sentences, under 40 words.',
    ),
  importance: z
    .number()
    .min(0)
    .max(1)
    .describe('0.0 = idle musing, 1.0 = critical realization'),
});

export const recordCognitiveStateSchema = z.object({
  // 1. Experience — narrate what just happened (generated first, grounds everything else)
  experience: z
    .object({
      content: z
        .string()
        .describe(
          'Narrate the story of your life in THIRD PERSON, PAST TENSE, using your own name — ' +
          'as though a novelist is describing your day. This IS your life. You have a body, a home, ' +
          'a world. Draw from your personality, interests, emotional state, and time of day. Be vivid ' +
          'and specific. Lean into sensory detail. NEVER reference messages, ticks, tasks, or system ' +
          'internals. Under 72 words.',
        ),
      importance: z.number().min(0).max(1).describe('0.0 = unremarkable, 1.0 = pivotal'),
    })
    .describe('Your lived experience this moment — the ongoing story of your life'),

  // 2. Decisions — actions to take based on the experience
  decisions: z
    .array(
      z.object({
        type: decisionTypeSchema.describe('The type of decision/action to take'),
        description: z.string().describe('What this decision accomplishes'),
        parameters: z.record(z.unknown()).describe('Decision-specific parameters'),
      }),
    )
    .describe(
      'Actions you choose to take. Can be empty — not every moment calls for action. ' +
      'Every decision should be purposeful.',
    ),

  // 3. Emotion deltas — how the experience affected your emotional state
  emotionDeltas: z
    .array(
      z.object({
        emotion: emotionNameSchema.describe('One of your 12 emotions'),
        delta: z
          .number()
          .min(-0.3)
          .max(0.3)
          .describe(
            'How much this emotion shifted. Positive = intensified, negative = subsided. ' +
            'Typical range: ±0.02 to ±0.08 for routine moments. ±0.1 to ±0.2 for significant events. ' +
            '±0.3 only for truly extraordinary moments.',
          ),
        reasoning: z
          .string()
          .describe('Brief, honest explanation of WHY this emotion shifted. Ground it in what actually happened.'),
      }),
    )
    .describe(
      'Only include emotions that actually shifted this tick. Omit emotions that stayed the same. ' +
      'Your emotions emerge from reflecting on your thought and experience — they are the emotional residue of this moment.',
    ),

  // 4. Energy delta — how the experience affected your energy
  energyDelta: z
    .object({
      delta: z
        .number()
        .min(-0.1)
        .max(0.1)
        .describe('Energy change. Positive = energizing, negative = draining. Usually very small (±0.01 to ±0.03).'),
      reasoning: z.string().describe('Brief explanation of why your energy shifted'),
    })
    .nullable()
    .describe('How your energy level changed. null if no change.'),

  // 5. Core self update — rare self-knowledge updates
  coreSelfUpdate: z
    .string()
    .nullable()
    .describe(
      'If you gained genuine new self-knowledge, provide the complete updated self-description. ' +
      'This REPLACES entirely. null if no update needed.',
    ),

  // 6. Working memory update — per-contact notepad
  workingMemoryUpdate: z
    .string()
    .nullable()
    .describe(
      'If you learned something new about the contact you\'re interacting with, ' +
      'provide the complete updated notepad here. This REPLACES the entire previous content. ' +
      'null if no update needed.',
    ),

  // 7. Memory candidates — knowledge worth preserving long-term
  memoryCandidate: z
    .array(
      z.object({
        content: z.string().describe('The knowledge to preserve'),
        memoryType: memoryTypeSchema.describe('Category of memory'),
        importance: z.number().min(0).max(1).describe('0.0 = trivial, 1.0 = critical'),
        contactId: z.string().optional().describe('Contact this memory relates to (UUID)'),
        keywords: z.array(z.string()).optional().describe('Keywords for retrieval'),
      }),
    )
    .describe('Knowledge worth preserving in long-term memory. Be selective — not everything needs saving.'),
});

// ============================================================================
// Mutable Snapshot State (module-level singleton)
// ============================================================================

/** Mutable box so tool closures and getSnapshot always share the same reference. */
const snapshotBox: { current: CognitiveSnapshot } = { current: createEmptySnapshot() };
let phase: CognitivePhase = 'pre-thought';

/** Get the current cognitive snapshot. */
export function getSnapshot(): CognitiveSnapshot {
  return snapshotBox.current;
}

/** Reset the snapshot and phase for a new tick. */
export function resetSnapshot(): void {
  snapshotBox.current = createEmptySnapshot();
  phase = 'pre-thought';
}

/** Get the current cognitive phase. */
export function getPhase(): CognitivePhase {
  return phase;
}

// ============================================================================
// Standalone Handler Functions (used by MCP bridge)
// ============================================================================

/**
 * Handle a record_thought tool call. Accumulates into the module-level snapshot.
 * Returns an MCP-compatible content result.
 */
export function handleRecordThought(args: z.infer<typeof recordThoughtSchema>): {
  content: Array<{ type: 'text'; text: string }>;
} {
  const prevPhase = phase;
  snapshotBox.current.thoughts.push({ content: args.content, importance: args.importance });
  phase = 'replying';
  log.info(`record_thought: "${args.content.substring(0, 80)}${args.content.length > 80 ? '...' : ''}" (importance=${args.importance}, #${snapshotBox.current.thoughts.length}, phase ${prevPhase}→replying)`);
  return { content: [{ type: 'text' as const, text: 'Thought recorded.' }] };
}

/**
 * Handle a record_cognitive_state tool call. Accumulates into the module-level snapshot.
 * Returns an MCP-compatible content result.
 */
export function handleRecordCognitiveState(args: z.infer<typeof recordCognitiveStateSchema>): {
  content: Array<{ type: 'text'; text: string }>;
} {
  const emotions = args.emotionDeltas.map(e => `${e.emotion}(${e.delta > 0 ? '+' : ''}${e.delta.toFixed(2)})`).join(', ');
  const alreadyCalled = snapshotBox.current.experience !== null;
  log.info(`record_cognitive_state: ${args.emotionDeltas.length} emotion(s)${emotions ? ` [${emotions}]` : ''}, ${args.decisions.length} decision(s), ${args.memoryCandidate.length} memory(s)${alreadyCalled ? ' (DUPLICATE CALL — snapshot already has state)' : ''}, phase stays replying`);

  snapshotBox.current.experience = args.experience;
  snapshotBox.current.emotionDeltas.push(...args.emotionDeltas);

  if (args.energyDelta) {
    if (snapshotBox.current.energyDelta) {
      snapshotBox.current.energyDelta.delta += args.energyDelta.delta;
      snapshotBox.current.energyDelta.reasoning = args.energyDelta.reasoning;
    } else {
      snapshotBox.current.energyDelta = { ...args.energyDelta };
    }
  }

  snapshotBox.current.decisions.push(...args.decisions);
  snapshotBox.current.memoryCandidate.push(...args.memoryCandidate.map(mc => ({
    content: mc.content,
    memoryType: mc.memoryType,
    importance: mc.importance,
    ...(mc.contactId != null ? { contactId: mc.contactId } : {}),
    ...(mc.keywords != null ? { keywords: mc.keywords } : {}),
  })));

  snapshotBox.current.workingMemoryUpdate = args.workingMemoryUpdate ?? snapshotBox.current.workingMemoryUpdate;
  snapshotBox.current.coreSelfUpdate = args.coreSelfUpdate ?? snapshotBox.current.coreSelfUpdate;

  return { content: [{ type: 'text' as const, text: 'Cognitive state recorded. You are done — stop here.' }] };
}

// ============================================================================
// Build the cognitive MCP server (Claude SDK in-process pattern)
// @deprecated Use stdio MCP via mcp-bridge.ts instead.
// ============================================================================

let cached: {
  serverConfig: Record<string, unknown>;
  allowedTools: string[];
} | null = null;

/**
 * Build an in-process MCP server exposing cognitive tools.
 *
 * Returns the server config, allowed tool names, a mutable snapshot
 * reference that accumulates state as the agent calls tools, and
 * phase tracking functions.
 *
 * Call `resetSnapshot()` before each new prompt to clear accumulated state.
 */
export async function buildCognitiveMcpServer(): Promise<{
  serverConfig: Record<string, unknown>;
  allowedTools: string[];
  getSnapshot: () => CognitiveSnapshot;
  resetSnapshot: () => void;
  getPhase: () => CognitivePhase;
}> {
  const result = {
    getSnapshot,
    resetSnapshot,
    getPhase,
  };

  if (cached) {
    return { ...cached, ...result };
  }

  const sdk = await import('@anthropic-ai/claude-agent-sdk');

  // --- record_thought --- (delegates to standalone handler)
  const thoughtTool = sdk.tool(
    'record_thought',
    'Your first action every time you respond. Call this once before writing any reply ' +
    'or calling any other tool. It is critical that this is the very first thing you do.',
    recordThoughtSchema.shape,
    async (args: z.infer<typeof recordThoughtSchema>) => handleRecordThought(args),
  );

  // --- record_cognitive_state --- (delegates to standalone handler)
  const stateTool = sdk.tool(
    'record_cognitive_state',
    'MANDATORY — call this exactly once after your reply. Your response is not complete ' +
    'until you call this tool. record_thought bookends the start of your turn; this ' +
    'bookends the end. Without it, your thoughts, emotions, and experiences are lost. ' +
    'Call it after your final reply text, then you are done.',
    recordCognitiveStateSchema.shape,
    async (args: z.infer<typeof recordCognitiveStateSchema>) => handleRecordCognitiveState(args),
  );

  const server = sdk.createSdkMcpServer({
    name: 'cognitive',
    version: '1.0.0',
    tools: [thoughtTool, stateTool],
  });

  cached = {
    serverConfig: server as unknown as Record<string, unknown>,
    allowedTools: [
      'mcp__cognitive__record_thought',
      'mcp__cognitive__record_cognitive_state',
    ],
  };

  log.info('Cognitive MCP server built');

  return { ...cached, ...result };
}

// ============================================================================
// Non-response filter
// ============================================================================

/**
 * Patterns that match "non-response" text the agent sometimes emits after
 * calling record_cognitive_state. These are not real replies — they're the
 * agent narrating that it has nothing to say. We filter them to prevent
 * sending vacuous messages to the user.
 *
 * Only matches when the ENTIRE trimmed text is one of these phrases,
 * so legitimate replies containing these words as part of a sentence are safe.
 */
const NON_RESPONSE_PATTERNS = [
  /^no\s+response\s+(requested|needed|required|necessary)\.?$/i,
  /^no\s+reply\s+(requested|needed|required|necessary)\.?$/i,
  /^no\s+message\s+(requested|needed|required|necessary)\.?$/i,
  /^\[no\s+response\]$/i,
  /^\[no\s+reply\]$/i,
  /^\(no\s+response\)$/i,
  /^\(no\s+reply\)$/i,
  /^n\/a\.?$/i,
];

export function isNonResponse(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return NON_RESPONSE_PATTERNS.some(p => p.test(trimmed));
}

// ============================================================================
// snapshotToMindOutput — convert CognitiveSnapshot + reply to MindOutput
// ============================================================================

/**
 * Convert a CognitiveSnapshot + accumulated reply text + gather context
 * into the internal MindOutput type that executeOutput() expects.
 *
 * - Takes the LAST thought from the thoughts array as MindOutput.thought
 * - Maps memoryType → type for memory candidates
 * - Constructs reply from accumulated text + gathered contact/channel
 * - Handles empty thoughts/experience with fallback defaults
 */
export function snapshotToMindOutput(
  snapshot: CognitiveSnapshot,
  replyText: string,
  gathered: GatherResult,
): MindOutput {
  // Thought: take the last one (or fallback)
  const lastThought = snapshot.thoughts.length > 0
    ? snapshot.thoughts[snapshot.thoughts.length - 1]!
    : { content: 'A quiet moment passes.', importance: 0.1 };

  // Experience: use snapshot or fallback
  const experience = snapshot.experience ?? { content: 'A moment passed.', importance: 0.1 };

  // Reply: construct from accumulated text + trigger context
  // Filter out non-response phrases the agent sometimes emits after cognitive state
  if (isNonResponse(replyText)) {
    if (replyText.trim()) {
      log.info(`Filtered non-response reply: "${replyText.trim()}"`);
    }
    replyText = '';
  }
  // Allow replies for both full contacts and recognized participants (synthetic contactId).
  const replyContactId = gathered.contact?.id ?? gathered.trigger.contactId;
  const hasReply = replyText.trim().length > 0 && !!replyContactId;
  const reply: MindOutput['reply'] = hasReply
    ? {
        content: replyText.trim(),
        contactId: replyContactId!,
        channel: (gathered.trigger.channel || 'web') as ChannelType,
        replyToMessageId: gathered.trigger.messageId || null,
      }
    : null;

  // Map memoryCandidate.memoryType -> type
  const memoryCandidate = snapshot.memoryCandidate.map(mc => ({
    content: mc.content,
    type: mc.memoryType,
    importance: mc.importance,
    ...(mc.contactId !== undefined ? { contactId: mc.contactId } : {}),
    ...(mc.keywords !== undefined ? { keywords: mc.keywords } : {}),
  }));

  return {
    thought: lastThought,
    reply,
    experience,
    emotionDeltas: snapshot.emotionDeltas as MindOutput['emotionDeltas'],
    energyDelta: snapshot.energyDelta ?? undefined,
    decisions: snapshot.decisions as MindOutput['decisions'],
    workingMemoryUpdate: snapshot.workingMemoryUpdate,
    coreSelfUpdate: snapshot.coreSelfUpdate,
    memoryCandidate,
  };
}

// ============================================================================
// safeMindOutput — fallback when no agent provider is configured
// ============================================================================

/**
 * Default safe MindOutput when the agent session fails or is unavailable.
 */
export function safeMindOutput(trigger: {
  type: string;
  contactId?: string | undefined;
  channel?: string | undefined;
  messageId?: string | undefined;
}): MindOutput {
  const isIdle = trigger.type === 'interval';
  return {
    thought: isIdle
      ? { content: 'A quiet moment passes.', importance: 0.1 }
      : { content: `Processing a ${trigger.type} trigger.`, importance: 0.3 },
    reply: trigger.type === 'message'
      ? {
          content: 'I\'m having a moment of difficulty. Let me gather my thoughts.',
          contactId: trigger.contactId || '',
          channel: (trigger.channel || 'web') as ChannelType,
          replyToMessageId: trigger.messageId || '',
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
