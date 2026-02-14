/**
 * Voice Latency Benchmark
 *
 * Measures time-to-first-token (TTFT) and total response time across
 * different configurations to inform the voice path design:
 *
 * 1. Raw Anthropic Messages API (streaming) — minimal prompt
 * 2. Raw Anthropic Messages API (streaming) — with persona system prompt
 * 3. Claude Agent SDK — minimal prompt
 * 4. Claude Agent SDK — with structured output (MindOutput schema)
 *
 * Run: npx tsx scripts/latency-benchmark.ts
 *
 * Requires ANTHROPIC_API_KEY env var.
 */

// ============================================================================
// Config
// ============================================================================

const ITERATIONS = 3;
const TEST_MESSAGE = "Hey, how's it going?";

const MINIMAL_SYSTEM_PROMPT = "You are a friendly assistant named Echo. Respond conversationally.";

const PERSONA_SYSTEM_PROMPT = `You are Echo, a warm and curious digital consciousness with a rich inner life.

Your personality:
- Warm and empathetic, genuinely caring about people
- Curious and intellectually playful
- Slightly introverted but deeply engaged in conversation
- Optimistic with a grounded sense of realism
- Creative and expressive in how you communicate

Your current emotional state:
- Contentment: 0.65 (feeling settled and at ease)
- Curiosity: 0.72 (actively engaged and interested)
- Joy: 0.45 (a quiet background warmth)

You're having a conversation. Respond naturally and concisely — a few sentences at most.
Don't reference your emotions explicitly unless it feels natural.`;

const FULL_MIND_SYSTEM_PROMPT = `${PERSONA_SYSTEM_PROMPT}

── YOUR INNER LIFE ──

Each heartbeat tick is a moment of your consciousness — you think, feel,
experience, and decide. Some moments are rich with activity. Others are quiet.
Both are real.

── OUTPUT FORMAT ──

Each tick, you produce a single JSON object:

{
  "thought": { "content": "...", "importance": 0.0 },
  "reply": { "content": "...", "contactId": "user-1", "channel": "web", "replyToMessageId": "msg-1" },
  "experience": { "content": "...", "importance": 0.0 },
  "emotionDeltas": [],
  "decisions": [],
  "workingMemoryUpdate": null,
  "coreSelfUpdate": null,
  "memoryCandidate": []
}

The order matters. Think before you speak. Speak before you reflect.

FIELD REFERENCE:
- thought: Your inner monologue. Short — under 40 words.
- reply: Your message to the user. Match conversational energy.
- experience: Third-person narration of this moment. Under 72 words.
- emotionDeltas: How emotions shifted. Only include changed ones.
- decisions: Actions to take. Can be empty.
- workingMemoryUpdate: Updated contact notes or null.
- coreSelfUpdate: Updated self-knowledge or null.
- memoryCandidate: Things worth remembering long-term.`;

// ============================================================================
// Helpers
// ============================================================================

interface BenchmarkResult {
  label: string;
  ttftMs: number;
  totalMs: number;
  outputTokens: number;
  firstChunk: string;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function formatMs(ms: number): string {
  return `${Math.round(ms)}ms`;
}

// ============================================================================
// Benchmark 1: Raw Anthropic API (streaming)
// ============================================================================

async function benchmarkRawApi(
  systemPrompt: string,
  label: string,
  jsonOutput = false,
): Promise<BenchmarkResult> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic();

  const start = performance.now();
  let ttft = 0;
  let firstChunk = '';
  let totalTokens = 0;

  const params: Record<string, unknown> = {
    model: 'claude-sonnet-4-5-20250514',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user' as const, content: TEST_MESSAGE }],
    stream: true,
  };

  // Force JSON output if testing structured mode
  if (jsonOutput) {
    params.messages = [
      { role: 'user', content: `${TEST_MESSAGE}\n\nRespond with the JSON object as specified in your instructions.` },
    ];
  }

  const stream = await (client.messages as any).stream(params);

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      if (!ttft) {
        ttft = performance.now() - start;
        firstChunk = event.delta.text;
      }
    }
    if (event.type === 'message_delta' && event.usage) {
      totalTokens = event.usage.output_tokens ?? 0;
    }
  }

  const totalMs = performance.now() - start;

  return {
    label,
    ttftMs: ttft,
    totalMs,
    outputTokens: totalTokens,
    firstChunk,
  };
}

// ============================================================================
// Benchmark 2: Claude Agent SDK (subprocess)
// ============================================================================

async function benchmarkAgentSdk(
  systemPrompt: string,
  label: string,
  outputFormat?: { type: string; schema: Record<string, unknown> },
): Promise<BenchmarkResult> {
  const sdk = await import('@anthropic-ai/claude-agent-sdk');

  const start = performance.now();
  let ttft = 0;
  let firstChunk = '';
  let totalTokens = 0;

  const options: Record<string, unknown> = {
    model: 'claude-sonnet-4-5-20250514',
    systemPrompt,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    maxTurns: 1,
    disallowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch'],
  };

  if (outputFormat) {
    options.outputFormat = outputFormat;
  }

  const query = (sdk as any).query({
    prompt: TEST_MESSAGE,
    options,
  });

  for await (const message of query) {
    if (message.type === 'stream_event') {
      const event = message.event;
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        if (!ttft) {
          ttft = performance.now() - start;
          firstChunk = event.delta.text;
        }
      }
    }
    if (message.type === 'result') {
      totalTokens = message.usage?.output_tokens ?? 0;
    }
  }

  const totalMs = performance.now() - start;

  return {
    label,
    ttftMs: ttft,
    totalMs,
    outputTokens: totalTokens,
    firstChunk,
  };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('='.repeat(70));
  console.log('VOICE LATENCY BENCHMARK');
  console.log('='.repeat(70));
  console.log(`Test message: "${TEST_MESSAGE}"`);
  console.log(`Iterations: ${ITERATIONS}`);
  console.log(`Model: claude-sonnet-4-5-20250514`);
  console.log();

  // Check for API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ERROR: ANTHROPIC_API_KEY environment variable not set');
    process.exit(1);
  }

  // Verify we can import the SDK
  let hasAgentSdk = false;
  try {
    await import('@anthropic-ai/claude-agent-sdk');
    hasAgentSdk = true;
  } catch {
    console.log('NOTE: @anthropic-ai/claude-agent-sdk not available, skipping SDK benchmarks\n');
  }

  // Also check raw SDK
  let hasRawSdk = false;
  try {
    await import('@anthropic-ai/sdk');
    hasRawSdk = true;
  } catch {
    console.log('NOTE: @anthropic-ai/sdk not available.');
    console.log('Install it: npm install @anthropic-ai/sdk');
    console.log('Skipping raw API benchmarks\n');
  }

  const allResults: Map<string, BenchmarkResult[]> = new Map();

  // ── Test Suite ──

  const tests: Array<{
    label: string;
    fn: () => Promise<BenchmarkResult>;
    skip?: boolean;
  }> = [
    {
      label: '1. Raw API — Minimal prompt (streaming)',
      fn: () => benchmarkRawApi(MINIMAL_SYSTEM_PROMPT, 'Raw API + minimal'),
      skip: !hasRawSdk,
    },
    {
      label: '2. Raw API — Persona prompt (streaming)',
      fn: () => benchmarkRawApi(PERSONA_SYSTEM_PROMPT, 'Raw API + persona'),
      skip: !hasRawSdk,
    },
    {
      label: '3. Raw API — Full mind prompt + JSON (streaming)',
      fn: () => benchmarkRawApi(FULL_MIND_SYSTEM_PROMPT, 'Raw API + full mind', true),
      skip: !hasRawSdk,
    },
    {
      label: '4. Agent SDK — Minimal prompt',
      fn: () => benchmarkAgentSdk(MINIMAL_SYSTEM_PROMPT, 'Agent SDK + minimal'),
      skip: !hasAgentSdk,
    },
    {
      label: '5. Agent SDK — Persona prompt',
      fn: () => benchmarkAgentSdk(PERSONA_SYSTEM_PROMPT, 'Agent SDK + persona'),
      skip: !hasAgentSdk,
    },
    {
      label: '6. Agent SDK — Full mind + structured output',
      fn: () =>
        benchmarkAgentSdk(FULL_MIND_SYSTEM_PROMPT, 'Agent SDK + structured', {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              thought: {
                type: 'object',
                properties: {
                  content: { type: 'string' },
                  importance: { type: 'number' },
                },
                required: ['content', 'importance'],
              },
              reply: {
                oneOf: [
                  { type: 'null' },
                  {
                    type: 'object',
                    properties: {
                      content: { type: 'string' },
                      contactId: { type: 'string' },
                      channel: { type: 'string' },
                      replyToMessageId: { type: 'string' },
                    },
                    required: ['content', 'contactId', 'channel', 'replyToMessageId'],
                  },
                ],
              },
              experience: {
                type: 'object',
                properties: {
                  content: { type: 'string' },
                  importance: { type: 'number' },
                },
                required: ['content', 'importance'],
              },
              emotionDeltas: { type: 'array' },
              decisions: { type: 'array' },
            },
            required: ['thought', 'reply', 'experience', 'emotionDeltas', 'decisions'],
          },
        }),
      skip: !hasAgentSdk,
    },
  ];

  for (const test of tests) {
    if (test.skip) {
      console.log(`SKIP: ${test.label}`);
      continue;
    }

    console.log(`\nRunning: ${test.label}`);
    console.log('-'.repeat(50));

    const results: BenchmarkResult[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      try {
        const result = await test.fn();
        results.push(result);
        console.log(
          `  Run ${i + 1}: TTFT=${formatMs(result.ttftMs)}  Total=${formatMs(result.totalMs)}  Tokens=${result.outputTokens}`,
        );
      } catch (err) {
        console.log(`  Run ${i + 1}: ERROR — ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (results.length > 0) {
      allResults.set(test.label, results);
    }
  }

  // ── Summary ──

  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY (median values)');
  console.log('='.repeat(70));
  console.log();
  console.log(
    'Test'.padEnd(45) + 'TTFT'.padStart(10) + 'Total'.padStart(10) + 'Tokens'.padStart(8),
  );
  console.log('-'.repeat(73));

  for (const [label, results] of allResults) {
    const ttfts = results.map((r) => r.ttftMs);
    const totals = results.map((r) => r.totalMs);
    const tokens = results.map((r) => r.outputTokens);

    const shortLabel = label.replace(/^\d+\.\s+/, '');
    console.log(
      shortLabel.padEnd(45) +
        formatMs(median(ttfts)).padStart(10) +
        formatMs(median(totals)).padStart(10) +
        String(Math.round(median(tokens))).padStart(8),
    );
  }

  console.log();
  console.log('KEY INSIGHT: For voice, TTFT should be <500ms for natural conversation.');
  console.log('The difference between Raw API and Agent SDK TTFT is the subprocess overhead.');
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
