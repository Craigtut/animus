/**
 * Cognitive MCP Tools — experimental mind tools for natural language turns.
 *
 * Instead of forcing the entire mind output into a single JSON blob,
 * these tools let the agent think and speak naturally while capturing
 * structured cognitive state via MCP tool calls:
 *
 *   1. record_thought  — called FIRST, before any reply (thought steers response)
 *   2. (natural language reply streams between tool calls)
 *   3. record_cognitive_state — called LAST, captures experience, emotions, etc.
 *
 * This is a sandbox-only experiment. If it works well, these tools will
 * replace OUTPUT_SCHEMA_REF in the production mind pipeline.
 */

import { z } from 'zod/v3';
import { createLogger } from '../lib/logger.js';

const log = createLogger('CognitiveTools', 'agents');

// ============================================================================
// Collected state — accumulates across tool calls within a single prompt
// ============================================================================

export interface CognitiveSnapshot {
  thought: { content: string; importance: number } | null;
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
  }>;
}

export function createEmptySnapshot(): CognitiveSnapshot {
  return {
    thought: null,
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

const recordThoughtSchema = z.object({
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

const recordCognitiveStateSchema = z.object({
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

  emotionDeltas: z
    .array(
      z.object({
        emotion: z
          .enum([
            'joy', 'contentment', 'excitement', 'gratitude', 'confidence',
            'stress', 'anxiety', 'frustration', 'sadness', 'boredom',
            'curiosity', 'loneliness',
          ])
          .describe('One of your 12 emotions'),
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

  decisions: z
    .array(
      z.object({
        type: z
          .enum([
            'spawn_agent', 'cancel_agent', 'update_agent',
            'create_goal', 'update_goal', 'create_seed',
            'create_task', 'update_task',
            'adjust_heartbeat_interval',
          ])
          .describe('The type of decision/action to take'),
        description: z.string().describe('What this decision accomplishes'),
        parameters: z.record(z.unknown()).describe('Decision-specific parameters'),
      }),
    )
    .describe(
      'Actions you choose to take. Can be empty — not every moment calls for action. ' +
      'Every decision should be purposeful.',
    ),

  workingMemoryUpdate: z
    .string()
    .nullable()
    .describe(
      'If you learned something new about the contact you\'re interacting with, ' +
      'provide the complete updated notepad here. This REPLACES the entire previous content. ' +
      'null if no update needed.',
    ),

  coreSelfUpdate: z
    .string()
    .nullable()
    .describe(
      'If you gained genuine new self-knowledge, provide the complete updated self-description. ' +
      'This REPLACES entirely. null if no update needed.',
    ),

  memoryCandidate: z
    .array(
      z.object({
        content: z.string().describe('The knowledge to preserve'),
        memoryType: z.enum(['fact', 'experience', 'procedure', 'outcome']).describe('Category of memory'),
        importance: z.number().min(0).max(1).describe('0.0 = trivial, 1.0 = critical'),
      }),
    )
    .describe('Knowledge worth preserving in long-term memory. Be selective — not everything needs saving.'),
});

// ============================================================================
// Build the cognitive MCP server (Claude SDK in-process pattern)
// ============================================================================

/** Mutable box so tool closures and getSnapshot always share the same reference. */
const snapshotBox: { current: CognitiveSnapshot } = { current: createEmptySnapshot() };

let cached: {
  serverConfig: Record<string, unknown>;
  allowedTools: string[];
} | null = null;

/**
 * Build an in-process MCP server exposing cognitive tools.
 *
 * Returns the server config, allowed tool names, and a mutable snapshot
 * reference that accumulates state as the agent calls tools.
 *
 * Call `resetSnapshot()` on the returned object before each new prompt
 * to clear accumulated state.
 */
export async function buildCognitiveMcpServer(): Promise<{
  serverConfig: Record<string, unknown>;
  allowedTools: string[];
  getSnapshot: () => CognitiveSnapshot;
  resetSnapshot: () => void;
}> {
  const result = {
    getSnapshot: () => snapshotBox.current,
    resetSnapshot: () => { snapshotBox.current = createEmptySnapshot(); },
  };

  if (cached) {
    return { ...cached, ...result };
  }

  const sdk = await import('@anthropic-ai/claude-agent-sdk');

  // --- record_thought ---
  const thoughtTool = sdk.tool(
    'record_thought',
    'Your first action every time you respond. Call this once before writing any reply ' +
    'or calling any other tool. It is critical that this is the very first thing you do.',
    recordThoughtSchema.shape as any, // eslint-disable-line @typescript-eslint/no-explicit-any -- Zod v3 compat shim; SDK expects v4 schema shapes
    async (args: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (snapshotBox.current.thought) {
        log.warn('record_thought called again — already recorded, ignoring duplicate');
        return { content: [{ type: 'text' as const, text: 'Already recorded.' }] };
      }
      log.info('record_thought called', { importance: args.importance });
      snapshotBox.current.thought = { content: args.content, importance: args.importance };
      return { content: [{ type: 'text' as const, text: 'Thought recorded.' }] };
    },
  );

  // --- record_cognitive_state ---
  const stateTool = sdk.tool(
    'record_cognitive_state',
    'Your last action every time you respond. Call this once after you have delivered your ' +
    'final reply and completed all other work. It is critical that this is always called ' +
    'and that it is the very last thing you do.',
    recordCognitiveStateSchema.shape as any, // eslint-disable-line @typescript-eslint/no-explicit-any -- Zod v3 compat shim; SDK expects v4 schema shapes
    async (args: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      log.info('record_cognitive_state called', {
        emotionCount: args.emotionDeltas.length,
        decisionCount: args.decisions.length,
        memoryCount: args.memoryCandidate.length,
      });

      // Experience always takes the latest (it's a narrative that progresses)
      snapshotBox.current.experience = args.experience;

      // Emotion deltas accumulate across cycles within the same prompt
      snapshotBox.current.emotionDeltas.push(...args.emotionDeltas);

      // Energy deltas accumulate
      if (args.energyDelta) {
        if (snapshotBox.current.energyDelta) {
          snapshotBox.current.energyDelta.delta += args.energyDelta.delta;
          snapshotBox.current.energyDelta.reasoning = args.energyDelta.reasoning;
        } else {
          snapshotBox.current.energyDelta = args.energyDelta;
        }
      }

      // Decisions and memories accumulate
      snapshotBox.current.decisions.push(...args.decisions);
      snapshotBox.current.memoryCandidate.push(...args.memoryCandidate);

      // These take the latest value
      snapshotBox.current.workingMemoryUpdate = args.workingMemoryUpdate ?? snapshotBox.current.workingMemoryUpdate;
      snapshotBox.current.coreSelfUpdate = args.coreSelfUpdate ?? snapshotBox.current.coreSelfUpdate;

      return { content: [{ type: 'text' as const, text: 'Cognitive state recorded.' }] };
    },
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
