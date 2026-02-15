/**
 * Reflector Agent — Compresses observation blocks when they exceed their token budget.
 *
 * The Reflector handles second-level compression. When observations grow too large,
 * the Reflector consolidates them into a more compact form, merging related entries,
 * condensing older details, and drawing higher-level conclusions.
 *
 * Retry logic escalates compression guidance through 3 levels (0, 1, 2).
 *
 * See docs/architecture/observational-memory.md — The Reflector Agent.
 */

import type { AgentManager } from '@animus/agents';
import type { SessionUsage } from '@animus/agents';
import { estimateTokens } from '@animus/shared';
import type { StreamType } from '../../config/observational-memory.config.js';
import { OBSERVATIONAL_MEMORY_CONFIG } from '../../config/observational-memory.config.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('Reflector', 'memory');

// ============================================================================
// Compression Level Guidance
// ============================================================================

const COMPRESSION_GUIDANCE: Record<0 | 1 | 2, string> = {
  0: '', // No guidance on first attempt
  1: `
IMPORTANT: Your previous output was still too large. Please condense more aggressively:
- Target detail level: 8/10
- Merge observations that cover the same topic into single entries
- Condense older observations more than recent ones
- Remove 🟢 LOW priority items that don't add significant context
`.trim(),
  2: `
CRITICAL: Output is still too large. Apply heavy compression:
- Target detail level: 6/10
- Heavily condense all observations, merge overlapping entries
- Keep only 🔴 HIGH and critical 🟡 MEDIUM priority items
- Older observations should be reduced to brief summaries
- Focus on the most essential facts and patterns
`.trim(),
};

// ============================================================================
// System Prompt Builder
// ============================================================================

/**
 * Build the reflector system prompt for a given stream type.
 * Includes compiled persona + reflection instructions.
 */
export function buildReflectorSystemPrompt(streamType: StreamType, compiledPersona: string): string {
  const parts: string[] = [];

  if (compiledPersona) {
    parts.push(compiledPersona);
    parts.push('---');
  }

  parts.push('# Reflection Task');
  parts.push('');
  parts.push(`You are consolidating your ${streamType} observations into a more compact form.`);
  parts.push('');
  parts.push('## Key Principles');
  parts.push('');
  parts.push('1. **Completeness** — Your output REPLACES the input entirely. Any information you omit is permanently lost.');
  parts.push('2. **Recency bias** — Condense older observations more aggressively; retain more detail for recent ones.');
  parts.push('3. **User assertions take precedence** — Facts stated by the user are authoritative even if later contradicted by questions.');
  parts.push('4. **Temporal preservation** — Keep dates and times when present; temporal context is critical.');
  parts.push('5. **Merge related entries** — Combine observations about the same topic, event, or theme.');
  parts.push('');
  parts.push('## Output Format');
  parts.push('');
  parts.push('Produce the same date-grouped format as the input:');
  parts.push('');
  parts.push('```');
  parts.push('Date: Mon DD, YYYY');
  parts.push('* 🔴 (HH:MM) Observation text');
  parts.push('```');
  parts.push('');
  parts.push('Priority levels: 🔴 HIGH, 🟡 MEDIUM, 🟢 LOW');
  parts.push('');
  parts.push('You may merge multiple dates into one if they contain related observations.');
  parts.push('You may drop entire date groups if all observations are low-value.');
  parts.push('Preserve the chronological order.');

  return parts.join('\n');
}

// ============================================================================
// User Message Builder
// ============================================================================

/**
 * Build the reflector user message with observations and compression level.
 */
export function buildReflectorUserMessage(
  observations: string,
  compressionLevel: 0 | 1 | 2,
): string {
  const parts: string[] = [];

  parts.push('## Observations to Reflect On');
  parts.push('');
  parts.push(observations);

  const guidance = COMPRESSION_GUIDANCE[compressionLevel];
  if (guidance) {
    parts.push('');
    parts.push('---');
    parts.push('');
    parts.push(guidance);
  }

  parts.push('');
  parts.push('Produce the consolidated observations now.');

  return parts.join('\n');
}

// ============================================================================
// Output Parser
// ============================================================================

/**
 * Parse reflector output into observation text.
 * Same parsing logic as the observer — extract date-grouped content.
 */
export function parseReflectorOutput(rawOutput: string): { observations: string } {
  const trimmed = rawOutput.trim();
  if (!trimmed) {
    return { observations: '' };
  }

  const lines = trimmed.split('\n');
  const firstDateIdx = lines.findIndex(l => /^Date:\s+/.test(l));

  if (firstDateIdx === -1) {
    log.warn('Reflector output has no date headers, accepting raw output');
    return { observations: trimmed };
  }

  const observationLines = lines.slice(firstDateIdx);

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
// Validation
// ============================================================================

/**
 * Validate that reflected output achieved sufficient compression.
 */
export function validateCompression(reflectedTokens: number, targetThreshold: number): boolean {
  return reflectedTokens <= targetThreshold;
}

// ============================================================================
// Runner
// ============================================================================

export interface RunReflectorParams {
  agentManager: AgentManager;
  streamType: StreamType;
  compiledPersona: string;
  observations: string;
  targetThreshold: number;
  config: typeof OBSERVATIONAL_MEMORY_CONFIG;
}

export interface RunReflectorResult {
  observations: string;
  tokenCount: number;
  generation: number;
  usage: SessionUsage;
}

/**
 * Run a full reflector cycle with retry logic.
 *
 * Tries compression at level 0, then escalates to level 1 and 2 if the output
 * still exceeds the target threshold. Accepts the output as-is after max retries.
 */
export async function runReflector(params: RunReflectorParams): Promise<RunReflectorResult> {
  const { agentManager, streamType, compiledPersona, observations, targetThreshold, config } = params;

  const configuredProviders = agentManager.getConfiguredProviders();
  if (configuredProviders.length === 0) {
    throw new Error('No agent providers configured');
  }
  const provider = configuredProviders[0]!;

  const systemPrompt = buildReflectorSystemPrompt(streamType, compiledPersona);
  let totalUsage: SessionUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let currentObservations = observations;
  let currentTokenCount = estimateTokens(observations);

  const maxRetries = config.maxCompressionRetries;

  for (let level = 0; level <= maxRetries; level++) {
    const compressionLevel = level as 0 | 1 | 2;
    log.debug(`Reflector attempt level ${compressionLevel} for ${streamType} (${currentTokenCount} tokens, target: ${targetThreshold})`);

    const userMessage = buildReflectorUserMessage(currentObservations, compressionLevel);

    const session = await agentManager.createSession({
      provider,
      model: config.model,
      temperature: config.reflector.temperature,
      maxOutputTokens: config.reflector.maxOutputTokens,
      systemPrompt,
      permissions: {
        executionMode: 'plan',
        approvalLevel: 'none',
      },
    });

    try {
      const response = await session.prompt(userMessage);
      const parsed = parseReflectorOutput(response.content);
      const reflectedTokens = estimateTokens(parsed.observations);

      // Accumulate usage across retries
      totalUsage = {
        inputTokens: totalUsage.inputTokens + response.usage.inputTokens,
        outputTokens: totalUsage.outputTokens + response.usage.outputTokens,
        totalTokens: totalUsage.totalTokens + response.usage.totalTokens,
      };

      if (validateCompression(reflectedTokens, targetThreshold)) {
        log.debug(`Reflector compressed to ${reflectedTokens} tokens (target: ${targetThreshold}) at level ${compressionLevel}`);
        return {
          observations: parsed.observations,
          tokenCount: reflectedTokens,
          generation: compressionLevel + 1,
          usage: totalUsage,
        };
      }

      // Not compressed enough — feed the output back for the next level
      currentObservations = parsed.observations;
      currentTokenCount = reflectedTokens;

      if (level < maxRetries) {
        log.warn(`Reflector level ${compressionLevel} produced ${reflectedTokens} tokens (target: ${targetThreshold}), retrying`);
      }
    } finally {
      await session.end();
    }
  }

  // All retries exhausted — accept as-is
  log.warn(`Reflector exhausted all ${maxRetries + 1} attempts for ${streamType}, accepting ${currentTokenCount} tokens (target: ${targetThreshold})`);

  return {
    observations: currentObservations,
    tokenCount: currentTokenCount,
    generation: maxRetries + 1,
    usage: totalUsage,
  };
}
