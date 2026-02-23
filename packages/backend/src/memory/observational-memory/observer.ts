/**
 * Observer Agent — Compresses batches of raw items into structured observation logs.
 *
 * The Observer is a cold agent session that processes overflow items from the raw
 * token window into date-grouped, priority-tagged observation entries. It carries
 * the mind's persona so observations feel like genuine memories, not flat summaries.
 *
 * See docs/architecture/observational-memory.md — The Observer Agent.
 */

import type { AgentManager } from '@animus-labs/agents';
import type { SessionUsage } from '@animus-labs/agents';
import { estimateTokens } from '@animus-labs/shared';
import type { StreamType } from '../../config/observational-memory.config.js';
import { OBSERVATIONAL_MEMORY_CONFIG } from '../../config/observational-memory.config.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('Observer', 'memory');

// ============================================================================
// System Prompt Builders
// ============================================================================

const COMMON_FORMAT_INSTRUCTIONS = `
## Output Format

Produce date-grouped observations with priority tags and timestamps:

\`\`\`
Date: Mon DD, YYYY
* 🔴 (HH:MM) Observation text
* 🟡 (HH:MM) Another observation
  * -> Sub-detail if needed
\`\`\`

Priority levels:
- 🔴 HIGH — User facts, preferences, goals achieved, critical context
- 🟡 MEDIUM — Project details, learned information, tool results
- 🟢 LOW — Minor details, uncertain observations

Rules:
- Group by date, ordered chronologically
- Use the exact "Date: Mon DD, YYYY" header format (e.g., "Date: Feb 14, 2026")
- Include timestamps from the source material in (HH:MM) format
- Preserve distinguishing details: names, quantities, identifiers, dates
- When a fact supersedes an earlier one, keep only the latest version
- Do NOT include relative time annotations — those are added later
- Do NOT duplicate information already present in existing observations

CRITICAL: Output ONLY the structured observations starting with "Date:". Do NOT include any reasoning, analysis, thinking, commentary, or preamble. Your entire response must be the observation format above — nothing else.
`.trim();

const STREAM_INSTRUCTIONS: Record<StreamType, string> = {
  messages: `
## Your Role

You are reviewing a batch of conversation messages to extract and compress the most important information into structured observations.

## What to Focus On

- **User assertions** — Statements of fact from the user are authoritative (names, preferences, history)
- **Temporal anchoring** — When something was said vs when it was referenced (distinguish between the two)
- **State changes** — New information that supersedes old (e.g., "I have 2 kids" later becomes "I have 3 kids")
- **Distinguishing details** — Names, quantities, dates, identifiers that would be lost in a summary
- **Actionable context** — What the user needs, what was promised, what's pending
- **User questions** are less important than user statements unless they reveal intent or needs
`.trim(),

  thoughts: `
## Your Role

You are reviewing a batch of your own thoughts to extract and compress patterns, insights, and reasoning into structured observations.

## What to Focus On

- **Recurring patterns** — Themes that appear across multiple thoughts
- **Goal-related reasoning** — How you're thinking about goals, plans, and progress
- **Self-reflections** — Insights about your own behavior, preferences, or decision-making
- **Decision rationale** — Why you chose one approach over another
- **Unresolved questions** — Things you're still thinking about or need to address
`.trim(),

  experiences: `
## Your Role

You are reviewing a batch of your experiences to extract and compress significant events into structured observations.

## What to Focus On

- **Significant events** — Notable outcomes, completions, or milestones
- **Sub-agent results** — What delegated tasks produced and their outcomes
- **Environmental changes** — System events, configuration changes, new capabilities
- **Emotional milestones** — Shifts in emotional state tied to specific events
- **Failures and recoveries** — What went wrong and how it was handled
`.trim(),
};

/**
 * Build the observer system prompt for a given stream type.
 * Includes compiled persona + stream-specific observation instructions.
 */
export function buildObserverSystemPrompt(streamType: StreamType, compiledPersona: string): string {
  const parts: string[] = [];

  if (compiledPersona) {
    parts.push(compiledPersona);
    parts.push('---');
  }

  parts.push('# Observation Task');
  parts.push('');
  parts.push(STREAM_INSTRUCTIONS[streamType]);
  parts.push('');
  parts.push(COMMON_FORMAT_INSTRUCTIONS);

  return parts.join('\n');
}

// ============================================================================
// User Message Builder
// ============================================================================

/**
 * Build the user message with batch items and existing observations.
 */
export function buildObserverUserMessage(
  batchItems: string[],
  existingObservations: string | null,
): string {
  const parts: string[] = [];

  if (existingObservations) {
    parts.push('## Existing Observations (do not duplicate)');
    parts.push('');
    parts.push(existingObservations);
    parts.push('');
    parts.push('---');
    parts.push('');
  }

  parts.push('## New Items to Observe');
  parts.push('');
  parts.push(batchItems.join('\n'));
  parts.push('');
  parts.push('Produce observations for the new items above. Do not repeat information already in existing observations.');

  return parts.join('\n');
}

// ============================================================================
// Output Parser
// ============================================================================

/**
 * Parse observer output into observation text.
 * The observer produces plain text in the date-grouped format.
 * We extract it as-is, stripping any preamble or trailing commentary.
 */
export function parseObserverOutput(rawOutput: string): { observations: string } {
  const trimmed = rawOutput.trim();
  if (!trimmed) {
    return { observations: '' };
  }

  // Find the first "Date:" line — everything from there is the observation content
  const lines = trimmed.split('\n');
  const firstDateIdx = lines.findIndex(l => /^Date:\s+/.test(l));

  if (firstDateIdx === -1) {
    // No date headers found — the observer produced unstructured output
    // (likely chain-of-thought reasoning). Reject it so processStream
    // hits the empty-output guard and skips watermark advancement.
    log.warn('Observer output has no date headers, rejecting unstructured output');
    return { observations: '' };
  }

  // Take everything from the first date header onward,
  // but strip trailing commentary after the last observation line.
  const observationLines = lines.slice(firstDateIdx);

  // Find the last line that's part of observation content
  // (date headers, bullet points, sub-bullets, empty lines between groups)
  let lastContentIdx = observationLines.length - 1;
  while (lastContentIdx >= 0) {
    const line = observationLines[lastContentIdx]!.trim();
    if (line === '' || /^Date:\s+/.test(line) || /^\*\s+/.test(line)) {
      break;
    }
    lastContentIdx--;
  }

  const observations = observationLines.slice(0, lastContentIdx + 1).join('\n').trimEnd();
  return { observations };
}

// ============================================================================
// Runner
// ============================================================================

export interface RunObserverParams {
  agentManager: AgentManager;
  streamType: StreamType;
  compiledPersona: string;
  batchItems: string[];
  existingObservations: string | null;
  config: typeof OBSERVATIONAL_MEMORY_CONFIG;
}

export interface RunObserverResult {
  observations: string;
  tokenCount: number;
  usage: SessionUsage;
}

/**
 * Run a full observer cycle: create cold session, prompt, parse, end session.
 */
export async function runObserver(params: RunObserverParams): Promise<RunObserverResult> {
  const { agentManager, streamType, compiledPersona, batchItems, existingObservations, config } = params;

  const systemPrompt = buildObserverSystemPrompt(streamType, compiledPersona);
  const userMessage = buildObserverUserMessage(batchItems, existingObservations);

  // Resolve provider: prefer user's configured default, fall back to first available
  const configuredProviders = agentManager.getConfiguredProviders();
  if (configuredProviders.length === 0) {
    throw new Error('No agent providers configured');
  }
  const provider = configuredProviders[0]!;

  // Graceful degradation: skip if no session slots available
  if (!agentManager.canCreateSession()) {
    log.warn(`Skipping ${streamType} observation — no session slots available`);
    return { observations: '', tokenCount: 0, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
  }

  log.debug(`Creating observer session for ${streamType} stream (provider: ${provider}, model: ${config.model})`);

  const session = await agentManager.createSession({
    provider,
    model: config.model,
    temperature: config.observer.temperature,
    maxOutputTokens: config.observer.maxOutputTokens,
    systemPrompt,
    permissions: {
      executionMode: 'plan',
      approvalLevel: 'none',
    },
  });

  try {
    const response = await session.prompt(userMessage);
    const parsed = parseObserverOutput(response.content);
    const tokenCount = estimateTokens(parsed.observations);

    log.debug(`Observer produced ${tokenCount} tokens for ${streamType} stream`);

    return {
      observations: parsed.observations,
      tokenCount,
      usage: response.usage,
    };
  } finally {
    await session.end();
  }
}
