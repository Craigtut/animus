/**
 * LLM-as-Judge helper for evaluating non-deterministic output.
 *
 * Uses the same eval model (Haiku) to score outputs against criteria.
 * Returns structured scores (0.0-1.0) per criterion with reasoning.
 */

import { evalComplete } from './provider.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JudgeCriterion {
  /** Short name for this criterion (used as key in results). */
  name: string;
  /** What to evaluate. Be specific. */
  description: string;
}

export interface JudgeResult {
  /** Score per criterion (0.0 = completely fails, 1.0 = perfectly meets). */
  scores: Record<string, number>;
  /** Average score across all criteria. */
  averageScore: number;
  /** Full reasoning from the judge. */
  reasoning: string;
  /** Raw judge response text. */
  raw: string;
}

// ---------------------------------------------------------------------------
// Fact-checking judge
// ---------------------------------------------------------------------------

/**
 * Judge whether a text preserves specific facts.
 *
 * Designed for compaction quality testing: given the original conversation
 * and the compacted summary, check whether critical facts survived.
 *
 * @param summary - The text to evaluate (e.g., compaction summary)
 * @param facts - List of facts that should be present
 * @param context - Optional original text for reference
 * @returns Scores per fact (0 = missing, 0.5 = partially present, 1 = clearly present)
 */
export async function judgeFacts(
  summary: string,
  facts: string[],
  context?: string,
): Promise<JudgeResult> {
  const factsBlock = facts.map((f, i) => `${i + 1}. ${f}`).join('\n');
  const contextBlock = context
    ? `\n\nHere is the original conversation for reference:\n<original>\n${context.slice(0, 8000)}\n</original>`
    : '';

  const systemPrompt = `You are a precise evaluator. Your task is to check whether a summary preserves specific facts from a conversation.

For each fact listed, score it:
- 1.0 = The fact is clearly and accurately present in the summary
- 0.5 = The fact is partially present or vaguely referenced
- 0.0 = The fact is missing or incorrect

You MUST respond with valid JSON only. No other text. Use this exact format:
{
  "scores": [<score for fact 1>, <score for fact 2>, ...],
  "reasoning": "<brief explanation of your scoring decisions>"
}`;

  const userMessage = `Here is the summary to evaluate:
<summary>
${summary}
</summary>

Check whether these facts are preserved in the summary:
${factsBlock}${contextBlock}

Respond with JSON only.`;

  const { text } = await evalComplete({
    systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  return parseScoredResponse(text, facts);
}

/**
 * Judge the quality of a text against custom criteria.
 *
 * More flexible than judgeFacts: each criterion can be any quality dimension
 * (completeness, accuracy, structure, tone, etc.).
 *
 * @param text - The text to evaluate
 * @param criteria - List of criteria to evaluate against
 * @returns Scores per criterion (0.0-1.0)
 */
export async function judgeQuality(
  text: string,
  criteria: JudgeCriterion[],
): Promise<JudgeResult> {
  const criteriaBlock = criteria
    .map((c, i) => `${i + 1}. "${c.name}": ${c.description}`)
    .join('\n');

  const systemPrompt = `You are a precise evaluator. Score the provided text against each criterion.

For each criterion, score it 0.0 to 1.0:
- 1.0 = Excellent, fully meets the criterion
- 0.5 = Partially meets
- 0.0 = Does not meet at all

You MUST respond with valid JSON only. No other text. Use this exact format:
{
  "scores": [<score for criterion 1>, <score for criterion 2>, ...],
  "reasoning": "<brief explanation>"
}`;

  const userMessage = `Text to evaluate:
<text>
${text}
</text>

Criteria:
${criteriaBlock}

Respond with JSON only.`;

  const { text: responseText } = await evalComplete({
    systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const factNames = criteria.map(c => c.name);
  return parseScoredResponse(responseText, factNames);
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

function parseScoredResponse(raw: string, names: string[]): JudgeResult {
  // Try to parse JSON from the response
  let parsed: { scores: number[]; reasoning: string };
  try {
    // Handle markdown code blocks
    const jsonStr = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    parsed = JSON.parse(jsonStr);
  } catch {
    // If JSON parsing fails, return zeros with the raw response as reasoning
    const scores: Record<string, number> = {};
    for (const name of names) {
      scores[name] = 0;
    }
    return {
      scores,
      averageScore: 0,
      reasoning: `Failed to parse judge response: ${raw.slice(0, 500)}`,
      raw,
    };
  }

  // Map array scores to named scores
  const scores: Record<string, number> = {};
  const rawScores = Array.isArray(parsed.scores) ? parsed.scores : [];

  for (let i = 0; i < names.length; i++) {
    const score = rawScores[i];
    scores[names[i]!] = typeof score === 'number' ? Math.max(0, Math.min(1, score)) : 0;
  }

  const values = Object.values(scores);
  const averageScore = values.length > 0
    ? values.reduce((a, b) => a + b, 0) / values.length
    : 0;

  return {
    scores,
    averageScore,
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
    raw,
  };
}
