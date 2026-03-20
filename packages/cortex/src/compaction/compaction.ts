/**
 * Layer 2: Conversation Summarization.
 *
 * Replaces older conversation history with an LLM-generated summary
 * while preserving a tail of recent turns. Uses the primary model
 * for summarization quality (the conversation history is structurally
 * complex with interleaved tool calls and multi-turn reasoning).
 *
 * Fires at 70% of context window (configurable). Emits lifecycle
 * events (onBeforeCompaction, onPostCompaction) for consumer
 * coordination (e.g., observational memory flush).
 *
 * References:
 *   - compaction-strategy.md (Layer 2: Conversation Summarization)
 *   - phase-5-compaction.md (5.3)
 */

import type { AgentMessage } from '../context-manager.js';
import type { CompactionConfig, CompactionResult, CompactionTarget } from '../types.js';
import { estimateTokens } from '../token-estimator.js';
import { extractTextContent } from './microcompaction.js';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const COMPACTION_DEFAULTS: CompactionConfig = {
  threshold: 0.70,
  preserveRecentTurns: 6,
};

// ---------------------------------------------------------------------------
// Summarization prompt
// ---------------------------------------------------------------------------

const DEFAULT_SUMMARIZATION_PROMPT = `You are performing a context compaction for a long-running agent session.
The conversation history will be replaced with your summary. A small tail
of recent turns is preserved separately and does not need to be repeated.

Create a structured summary covering:

## Conversation Context
Key topics discussed, user requests, and important statements.
Preserve the user's exact words for directives, preferences, and
constraints.

## Tool Call History
What tools were called, what they found, and what failed. Include
specific file paths, function names, URLs, error messages, and outcomes.

## In-Progress Work
Any multi-step task or investigation that was underway. What has been
completed, what remains.

## Reasoning and Rationale
Why specific approaches were chosen over alternatives. Key analysis
that informed decisions during this session.

## Key Decisions (Cumulative)
If a previous compaction summary exists, carry forward its Key Decisions
section and append any new decisions from this cycle. This section grows
across compactions to prevent progressive loss of important decisions.

Be thorough but concise. When preserving details, extract and retain
exact values rather than paraphrasing:
- File paths, directory names, and line numbers
- URLs, API endpoints, and query parameters
- Function names, class names, variable names
- IDs, hashes, version numbers, and configuration values
- Error messages and status codes
- Specific quantities, dates, and thresholds

These exact details are what the agent needs to continue working
without re-discovering them via tool calls.`;

// ---------------------------------------------------------------------------
// Summarization
// ---------------------------------------------------------------------------

/**
 * Partition conversation history into compaction target and preserved tail.
 *
 * @param history - The full conversation history (post-slot region)
 * @param preserveRecentTurns - Number of recent turns to preserve
 * @returns [target, preserved] where target is summarized and preserved is kept verbatim
 */
export function partitionHistory(
  history: AgentMessage[],
  preserveRecentTurns: number,
): [AgentMessage[], AgentMessage[]] {
  if (history.length <= preserveRecentTurns) {
    return [[], history];
  }

  const splitPoint = history.length - preserveRecentTurns;
  return [history.slice(0, splitPoint), history.slice(splitPoint)];
}

/**
 * Build the compaction summary message wrapping it in XML tags.
 *
 * @param summary - The LLM-generated summary text
 * @param turnsCompacted - Number of turns that were summarized
 * @returns A user-role message containing the tagged summary
 */
export function buildSummaryMessage(
  summary: string,
  turnsCompacted: number,
): AgentMessage {
  const timestamp = new Date().toISOString();
  const content = `<compaction-summary generated="${timestamp}" turns-summarized="${turnsCompacted}">\n${summary}\n</compaction-summary>`;
  return { role: 'user', content };
}

/**
 * Format conversation turns for the summarization prompt.
 * Extracts text content and labels each turn with role.
 */
export function formatTurnsForSummarization(turns: AgentMessage[]): string {
  // No per-turn truncation. The compaction target is already bounded by
  // partitionHistory (everything minus the preserved tail), and the
  // summarizer needs access to full turn content for high-quality
  // compression. See compaction-strategy.md Layer 2.
  return turns
    .map((msg, i) => {
      const text = extractTextContent(msg);
      return `[Turn ${i + 1}] ${msg.role}:\n${text}`;
    })
    .join('\n\n---\n\n');
}

/**
 * Type for the LLM completion function.
 * Matches the signature of CortexAgent.directComplete().
 */
export type CompleteFn = (context: {
  systemPrompt: string;
  messages: unknown[];
}) => Promise<string>;

/**
 * Type for the consumer's onBeforeCompaction handler.
 */
export type BeforeCompactionHandler = (target: CompactionTarget) => Promise<void>;

/**
 * Type for the consumer's onPostCompaction handler.
 */
export type PostCompactionHandler = (result: CompactionResult) => void;

/**
 * Type for the consumer's onCompactionError handler.
 */
export type CompactionErrorHandler = (error: Error) => void;

/**
 * Run Layer 2 conversation summarization.
 *
 * Steps:
 * 1. Partition history into target and preserved tail
 * 2. Emit onBeforeCompaction (awaited)
 * 3. Generate summary via LLM
 * 4. Build new history: [summary message] + [preserved tail]
 * 5. Emit onPostCompaction
 *
 * @param history - Current conversation history (post-slot region)
 * @param config - Compaction configuration
 * @param complete - LLM completion function
 * @param handlers - Consumer lifecycle handlers
 * @returns The new conversation history and compaction result
 */
export async function runCompaction(
  history: AgentMessage[],
  config: CompactionConfig,
  complete: CompleteFn,
  handlers: {
    onBeforeCompaction?: BeforeCompactionHandler[];
    onPostCompaction?: PostCompactionHandler[];
    onCompactionError?: CompactionErrorHandler[];
  } = {},
): Promise<{ newHistory: AgentMessage[]; result: CompactionResult }> {
  const [target, preserved] = partitionHistory(history, config.preserveRecentTurns);

  if (target.length === 0) {
    // Nothing to compact; not enough history
    throw new Error('Not enough conversation history to compact');
  }

  // Estimate tokens before compaction
  const tokensBefore = estimateTokens(
    history.map(m => extractTextContent(m)).join('\n'),
  );

  // Build compaction target info for the event
  const targetInfo: CompactionTarget = {
    turnsToCompact: target.length,
    estimatedTokens: estimateTokens(
      target.map(m => extractTextContent(m)).join('\n'),
    ),
  };

  // Emit onBeforeCompaction (awaited)
  if (handlers.onBeforeCompaction) {
    for (const handler of handlers.onBeforeCompaction) {
      await handler(targetInfo);
    }
  }

  // Generate summary via LLM
  const prompt = config.customPrompt ?? DEFAULT_SUMMARIZATION_PROMPT;
  const turnsText = formatTurnsForSummarization(target);

  let summary: string;
  try {
    summary = await complete({
      systemPrompt: prompt,
      messages: [
        {
          role: 'user',
          content: `Here are the conversation turns to summarize:\n\n${turnsText}`,
        },
      ],
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    // Emit compaction error
    if (handlers.onCompactionError) {
      for (const handler of handlers.onCompactionError) {
        try {
          handler(error);
        } catch {
          // Swallow handler errors
        }
      }
    }
    throw error;
  }

  // Build new history
  const summaryMessage = buildSummaryMessage(summary, target.length);
  const newHistory = [summaryMessage, ...preserved];

  // Calculate result metrics
  const tokensAfter = estimateTokens(
    newHistory.map(m => extractTextContent(m)).join('\n'),
  );
  const summaryTokens = estimateTokens(summary);

  // The oldest preserved turn's index in the original history.
  // target.length is the split point: all turns before it were compacted.
  const oldestPreservedIndex = target.length;

  // Attempt to find a timestamp in the preserved messages; null if not found.
  const oldestPreservedTimestamp = findOldestTimestamp(preserved);

  const result: CompactionResult = {
    tokensBefore,
    tokensAfter,
    turnsCompacted: target.length,
    turnsPreserved: preserved.length,
    summaryTokens,
    oldestPreservedTimestamp,
    oldestPreservedIndex,
    summary,
  };

  // Emit onPostCompaction
  if (handlers.onPostCompaction) {
    for (const handler of handlers.onPostCompaction) {
      try {
        handler(result);
      } catch {
        // Swallow handler errors
      }
    }
  }

  return { newHistory, result };
}

/**
 * Attempt to find the oldest timestamp in a set of messages.
 *
 * Scans message content for ISO date patterns. Returns the first match
 * or null if none found. This is a best-effort heuristic; the consumer
 * should prefer `oldestPreservedIndex` from CompactionResult for
 * reliable timestamp resolution via their own database.
 */
function findOldestTimestamp(messages: AgentMessage[]): string | null {
  const isoPattern = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

  for (const msg of messages) {
    const text = extractTextContent(msg);
    const match = isoPattern.exec(text);
    if (match) {
      return match[0];
    }
  }

  // No ISO timestamp found in preserved messages. Return null rather
  // than Date.now() so the consumer knows no timestamp was found and
  // can fall back to oldestPreservedIndex for database-level resolution.
  return null;
}

/**
 * Check if compaction should trigger based on token count and threshold.
 */
export function shouldCompact(
  currentTokens: number,
  contextWindow: number,
  threshold: number,
): boolean {
  if (contextWindow <= 0) return false;
  return (currentTokens / contextWindow) >= threshold;
}
