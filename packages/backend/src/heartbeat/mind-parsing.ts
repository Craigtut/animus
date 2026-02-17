/**
 * Mind Output Parsing & Validation
 *
 * Extracted from heartbeat/index.ts — handles JSON extraction,
 * Zod validation, retry logic, and lenient fallback parsing
 * for the mind's structured output.
 */

import { mindOutputSchema } from '@animus/shared';
import type { MindOutput, ChannelType } from '@animus/shared';
import type { IAgentSession } from '@animus/agents';
import { createLogger } from '../lib/logger.js';

const log = createLogger('MindParsing', 'heartbeat');

// ============================================================================
// Types
// ============================================================================

export interface ParseResult {
  output: MindOutput;
  /** Whether a retry prompt was needed */
  retried: boolean;
  /** Whether lenient parsing was used */
  lenient: boolean;
  /** Whether all parsing attempts failed and safeMindOutput was returned */
  failed: boolean;
}

// ============================================================================
// extractJson
// ============================================================================

/**
 * Extract JSON from model output that may contain markdown fences or surrounding prose.
 * Tries to find a top-level JSON object in the text.
 */
export function extractJson(raw: string): string {
  const trimmed = raw.trim();

  // Already looks like JSON
  if (trimmed.startsWith('{')) return trimmed;

  // Try to extract from markdown code fences: ```json ... ``` or ``` ... ```
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch?.[1]?.trim().startsWith('{')) {
    return fenceMatch[1].trim();
  }

  // Try to find the first { ... } block (greedy, outermost braces)
  const braceStart = trimmed.indexOf('{');
  const braceEnd = trimmed.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    return trimmed.slice(braceStart, braceEnd + 1);
  }

  // Give up — return as-is and let JSON.parse throw
  return trimmed;
}

// ============================================================================
// safeMindOutput
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

// ============================================================================
// parseMindOutput
// ============================================================================

/**
 * Parse, validate, and recover structured MindOutput from raw agent JSON.
 *
 * Strategy:
 *   1. Try JSON.parse(extractJson(raw))
 *   2. On parse failure, send a retry prompt via session.prompt() with the exact schema
 *   3. Validate with mindOutputSchema.safeParse()
 *   4. On validation failure, attempt lenient parsing (legacy fields, defaults)
 *   5. If all else fails, return safeMindOutput()
 */
export async function parseMindOutput(
  rawJson: string,
  session: IAgentSession,
  triggerInfo: { type: string; contactId?: string | undefined; channel?: string | undefined; messageId?: string | undefined },
): Promise<ParseResult> {
  let parsed: unknown;
  let retried = false;

  // Try to extract JSON if the model wrapped it in markdown code fences or added prose
  const jsonContent = extractJson(rawJson);

  try {
    parsed = JSON.parse(jsonContent);
  } catch (parseErr) {
    log.warn('First JSON parse failed, attempting retry prompt...', parseErr);
    log.warn('Raw output (first 500 chars):', rawJson.slice(0, 500));

    // Retry: send a follow-up message with the exact schema so the model knows the structure
    try {
      const retryResponse = await session.prompt(
        `Your previous response was not valid JSON. Please respond with ONLY a JSON object in this exact format — no text before or after, just the JSON starting with { and ending with }:

{
  "thought": { "content": "your inner thought", "importance": 0.5 },
  "reply": { "content": "your message", "contactId": "id", "channel": "web", "replyToMessageId": null } or null,
  "experience": { "content": "third-person narration", "importance": 0.5 },
  "emotionDeltas": [{ "emotion": "joy", "delta": 0.01, "reasoning": "why" }],
  "energyDelta": { "delta": 0.0, "reasoning": "steady" },
  "decisions": [],
  "workingMemoryUpdate": null,
  "coreSelfUpdate": null,
  "memoryCandidate": []
}`,
      );
      const retryJson = extractJson(retryResponse.content || '');
      parsed = JSON.parse(retryJson);
      retried = true;
      log.info('Retry prompt produced valid JSON');
    } catch (retryErr) {
      log.error('Retry also failed to produce valid JSON:', retryErr);
      return { output: safeMindOutput(triggerInfo), retried: true, lenient: false, failed: true };
    }
  }

  // Validate with Zod schema
  const result = mindOutputSchema.safeParse(parsed);
  if (!result.success) {
    log.error('MindOutput validation failed:', result.error.issues);
    // Try to extract what we can from partial output
    try {
      // Lenient parse: accept partial data with defaults
      // Also handle legacy array field names (thoughts/experiences -> thought/experience)
      const p = parsed as Record<string, unknown>;
      const thoughts = p['thoughts'];
      const legacyThought = Array.isArray(thoughts) && thoughts.length > 0
        ? thoughts[0]
        : undefined;
      const experiences = p['experiences'];
      const legacyExperience = Array.isArray(experiences) && experiences.length > 0
        ? experiences[0]
        : undefined;
      const lenient = {
        thought: (p['thought'] ?? legacyThought ?? { content: '', importance: 0 }) as MindOutput['thought'],
        reply: (p['reply'] ?? null) as MindOutput['reply'],
        experience: (p['experience'] ?? legacyExperience ?? { content: '', importance: 0 }) as MindOutput['experience'],
        emotionDeltas: Array.isArray(p['emotionDeltas']) ? p['emotionDeltas'] as MindOutput['emotionDeltas'] : [],
        decisions: Array.isArray(p['decisions']) ? p['decisions'] as MindOutput['decisions'] : [],
        workingMemoryUpdate: (p['workingMemoryUpdate'] ?? null) as MindOutput['workingMemoryUpdate'],
        coreSelfUpdate: (p['coreSelfUpdate'] ?? null) as MindOutput['coreSelfUpdate'],
        memoryCandidate: Array.isArray(p['memoryCandidate'])
          ? (p['memoryCandidate'] as Array<Record<string, unknown>>).filter((c) => c['content'] && c['type']) as MindOutput['memoryCandidate']
          : [],
      };
      return { output: lenient as MindOutput, retried, lenient: true, failed: false };
    } catch {
      return { output: safeMindOutput(triggerInfo), retried, lenient: false, failed: true };
    }
  }

  return { output: result.data, retried, lenient: false, failed: false };
}
