/**
 * Claude Agent SDK Latency Test
 *
 * Measures cold-start TTFT and total response time for the Claude Agent SDK.
 *
 * Run: npx tsx scripts/sdk-latency-test.ts
 */

const MINIMAL_PROMPT = "You are a friendly assistant. Respond in one sentence.";

const PERSONA_PROMPT = `You are Echo, a warm and curious digital consciousness.

Your personality:
- Warm and empathetic, genuinely caring about people
- Curious and intellectually playful
- Slightly introverted but deeply engaged in conversation

Your current emotional state:
- Contentment: 0.65
- Curiosity: 0.72

Respond naturally and concisely — a few sentences at most.`;

const FULL_MIND_PROMPT = `${PERSONA_PROMPT}

── OUTPUT FORMAT ──

Produce a single JSON object:

{
  "thought": { "content": "...", "importance": 0.0 },
  "reply": { "content": "...", "contactId": "user-1", "channel": "web", "replyToMessageId": "msg-1" },
  "experience": { "content": "...", "importance": 0.0 },
  "emotionDeltas": [],
  "decisions": [],
  "workingMemoryUpdate": null,
  "coreSelfUpdate": null,
  "memoryCandidate": []
}`;

const TEST_MESSAGE = "Hey, how's it going?";

function fmt(ms: number): string {
  return `${Math.round(ms)}ms`;
}

async function runTest(
  label: string,
  systemPrompt: string,
  outputFormat?: Record<string, unknown>,
): Promise<void> {
  console.log(`\n${label}`);
  console.log('-'.repeat(60));

  const sdk = await import('@anthropic-ai/claude-agent-sdk');

  const options: Record<string, unknown> = {
    model: 'claude-sonnet-4-5-20250929',
    systemPrompt,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    maxTurns: 1,
    settingSources: [],
  };

  if (outputFormat) {
    options.outputFormat = outputFormat;
  }

  const t0 = performance.now();
  let initMs = 0;
  let firstAssistantMs = 0;
  let resultMs = 0;
  let resultType = '';
  let responseContent = '';
  let totalTokens = 0;

  try {
    const query = (sdk as any).query({ prompt: TEST_MESSAGE, options });

    for await (const msg of query) {
      const elapsed = performance.now() - t0;

      // Dump every message type with key fields
      const summary: Record<string, unknown> = {
        type: msg.type,
        subtype: msg.subtype,
      };

      if (msg.type === 'system') {
        summary.sessionId = msg.sessionId ? 'yes' : 'no';
      }
      if (msg.type === 'assistant') {
        // Capture the assistant response content
        if (msg.message?.content) {
          const textBlocks = msg.message.content.filter(
            (b: any) => b.type === 'text',
          );
          responseContent = textBlocks.map((b: any) => b.text).join('');
          summary.contentLength = responseContent.length;
          summary.preview = responseContent.slice(0, 100);
        }
        if (msg.message?.usage) {
          totalTokens = msg.message.usage.output_tokens ?? 0;
          summary.tokens = totalTokens;
        }
        if (!firstAssistantMs) firstAssistantMs = elapsed;
      }
      if (msg.type === 'result') {
        resultMs = elapsed;
        resultType = msg.subtype ?? 'unknown';
        summary.resultContent = msg.result?.slice?.(0, 100) ?? msg.content?.slice?.(0, 100);
        if (msg.usage) {
          totalTokens = msg.usage.output_tokens ?? totalTokens;
          summary.tokens = totalTokens;
        }
      }
      if (msg.type === 'user') {
        summary.contentPreview = JSON.stringify(msg.message?.content)?.slice(0, 80);
      }

      console.log(`  [${fmt(elapsed)}] ${JSON.stringify(summary)}`);

      // Session init
      if (msg.type === 'system' && msg.subtype === 'init') {
        initMs = elapsed;
      }
    }
  } catch (err) {
    const errMs = performance.now() - t0;
    console.log(`  [${fmt(errMs)}] CATCH: ${err instanceof Error ? err.message : String(err)}`);
  }

  const totalMs = performance.now() - t0;

  console.log();
  console.log(`  Subprocess cold start:  ${fmt(initMs)}`);
  console.log(`  First assistant msg:    ${firstAssistantMs ? fmt(firstAssistantMs) : 'n/a'}`);
  console.log(`  Result (${resultType}):  ${resultMs ? fmt(resultMs) : 'n/a'}`);
  console.log(`  Total wall time:        ${fmt(totalMs)}`);
  console.log(`  Output tokens:          ${totalTokens}`);
  console.log(`  Response preview:       "${responseContent.slice(0, 120)}"`);
}

async function main() {
  console.log('='.repeat(60));
  console.log('CLAUDE AGENT SDK LATENCY TEST');
  console.log('='.repeat(60));
  console.log(`Message: "${TEST_MESSAGE}"`);
  console.log(`Model: claude-sonnet-4-5-20250514`);

  // Test 1: Plain text, minimal prompt
  await runTest(
    'TEST 1: Plain text + minimal prompt',
    MINIMAL_PROMPT,
  );

  // Test 2: Plain text, persona prompt
  await runTest(
    'TEST 2: Plain text + persona prompt',
    PERSONA_PROMPT,
  );

  // Test 3: Full mind prompt (no structured output)
  await runTest(
    'TEST 3: Full mind prompt (no structured output)',
    FULL_MIND_PROMPT,
  );

  console.log('\n' + '='.repeat(60));
  console.log('DONE');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
