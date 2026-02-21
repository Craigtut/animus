# Animus: Reflex System

The Reflex is a fast-response layer that enables low-latency voice conversations while preserving the heartbeat as the cognitive core. It uses direct LLM API calls via the Vercel AI SDK to generate quick conversational replies (~300-500ms TTFT), bypassing the agentic SDK subprocess overhead (~4-9 seconds) that makes the heartbeat too slow for natural voice interaction.

## Why This Exists

The heartbeat pipeline (Gather -> Mind -> Execute) is the soul of Animus -- it thinks, feels, remembers, and decides. But the Agent SDKs it uses (Claude Agent SDK, Codex SDK, OpenCode SDK) spawn CLI subprocesses, adding ~580ms of spawn time plus ~3,500ms of internal initialization before any LLM inference begins. Total round-trip: 4-9 seconds.

For voice conversation, users expect <500ms time-to-first-token. The reflex provides this fast path while the heartbeat continues processing the full cognitive cycle in the background.

**Benchmarked latency (Claude Agent SDK, February 2026):**

| Configuration | Cold Start | First Response | Total |
|---|---|---|---|
| Minimal prompt (1 sentence) | 576ms | 4,155ms | 4,915ms |
| Persona prompt (~200 tokens) | 591ms | 4,296ms | 4,968ms |
| Full mind prompt (~500 tokens) | 598ms | 7,396ms | 8,875ms |

The Agent SDK returns complete responses with no streaming -- the "first response" time effectively equals TTFT. This is unusable for voice.

---

## Architecture Overview

```
Voice Message Arrives (STT transcription complete)
       |
       v
+---------------------+
|   REFLEX PATH       |  Direct LLM API (Vercel AI SDK)
|   ~300-500ms TTFT   |  Lightweight context (~4,500 tokens)
|   Streaming text    |  Plain conversational reply
+----------+----------+
           |
           v
   Write reflex reply to messages.db
   (tagged with metadata: { reflexReply: true })
           |
           v
+---------------------+
|   HEARTBEAT TICK    |  Agent SDK (Claude/Codex/OpenCode)
|   ~4-9s total       |  Full context (~8,000-18,000 tokens)
|   Full MindOutput   |  Thoughts, emotions, memories, decisions
+---------------------+
           |
           v
   EXECUTE: process emotions, update memory,
   execute decisions. Reply field = null
   (reflex already replied) OR correction if needed.
```

**The reflex is the "mouth" -- it speaks quickly and in-character. The heartbeat is the "mind" -- it processes deeply and reflects on what was said.**

---

## The Abstraction Layer: Vercel AI SDK

The reflex uses the [Vercel AI SDK](https://ai-sdk.dev/) (`ai` package) for direct LLM API calls. This was chosen over building a custom abstraction because:

| Criteria | Vercel AI SDK |
|---|---|
| TypeScript-first | Designed from the ground up for TypeScript |
| Streaming | AsyncIterable + ReadableStream (dual interface) |
| Provider support | Anthropic, OpenAI, Google, Ollama, any OpenAI-compatible endpoint |
| Structured output | Zod-native `streamObject` with partial streaming |
| Latency overhead | ~30ms P99 (negligible vs LLM inference) |
| Adoption | ~20M monthly npm downloads, 21.7k GitHub stars |
| Maintenance | Releases every few days, backed by Vercel |
| Self-contained | Library, no Python sidecar, no SaaS proxy |

**Provider packages installed:**

```
ai                          # Core streaming primitives
@ai-sdk/anthropic           # Claude (direct API)
@ai-sdk/openai              # GPT-4o, o-series (direct API)
@ai-sdk/google              # Gemini (direct API)
@ai-sdk/openai-compatible   # Ollama, Together, Groq, DeepSeek, any OpenAI-compatible
```

**Why not the alternatives:**

- **LangChain.js** -- Too heavy, framework overhead. Animus has its own orchestration.
- **LiteLLM** -- Python sidecar process, violates self-contained Node.js principle.
- **OpenRouter** -- SaaS dependency with 5% markup, not self-hosted.
- **Raw provider SDKs** -- Three different streaming APIs to normalize. The AI SDK already does this.

---

## Reflex Context Assembly

The reflex uses a lightweight version of the Context Builder's context, optimized for speed without sacrificing conversational quality. All data comes from pre-computed state (DB reads, in-memory caches) with zero heavy computation.

### What the Reflex Includes

The reflex context leverages the **observational memory system** for rich historical context without loading raw item backlogs:

```
+---------------------------------------------------+
|                 REFLEX SYSTEM PROMPT               |
|                                                    |
|  +---------------------------------------------+  |
|  |  PERSONA (compiled, cached)                  |  |
|  |  Name, personality essentials, voice style   |  |
|  +---------------------------------------------+  |
|  +---------------------------------------------+  |
|  |  CORE SELF (from memory.db)                  |  |
|  |  Accumulated self-knowledge                  |  |
|  +---------------------------------------------+  |
|  +---------------------------------------------+  |
|  |  VOICE REPLY GUIDANCE                        |  |
|  |  Conversational, natural speech, short       |  |
|  +---------------------------------------------+  |
+---------------------------------------------------+

+---------------------------------------------------+
|                 REFLEX USER MESSAGE                |
|                                                    |
|  +---------------------------------------------+  |
|  |  TRIGGER                                     |  |
|  |  "{contactName} said: {transcribedText}"     |  |
|  +---------------------------------------------+  |
|  +---------------------------------------------+  |
|  |  EMOTIONAL STATE                             |  |
|  |  Current 12 emotion intensities (decayed)    |  |
|  +---------------------------------------------+  |
|  +---------------------------------------------+  |
|  |  MESSAGE HISTORY (observational memory)      |  |
|  |  Observation block (compressed older history)|  |
|  |  + Recent raw messages (newer than watermark)|  |
|  +---------------------------------------------+  |
|  +---------------------------------------------+  |
|  |  RECENT THOUGHTS (observational memory)      |  |
|  |  Observation block + recent raw thoughts     |  |
|  +---------------------------------------------+  |
|  +---------------------------------------------+  |
|  |  RECENT EXPERIENCES (observational memory)   |  |
|  |  Observation block + recent raw experiences  |  |
|  +---------------------------------------------+  |
|  +---------------------------------------------+  |
|  |  WORKING MEMORY                              |  |
|  |  Per-contact notepad                         |  |
|  +---------------------------------------------+  |
+---------------------------------------------------+
```

### What the Reflex Excludes

These sections are omitted to keep context lightweight and assembly instant:

- **Long-term memory retrieval** -- Semantic search via LanceDB adds latency. The observational memory captures the most important historical context without search.
- **Goals and tasks** -- Not needed for quick conversational replies.
- **Agent status** -- Sub-agent management is the heartbeat's job.
- **Operational instructions** -- The reflex doesn't produce MindOutput. No decision types, no emotion delta guidance, no memory management instructions.
- **Session notes** -- No context budget warnings or seed graduation prompts.

### Token Budget

The reflex uses reduced token budgets for each observational memory stream, trading depth for speed while maintaining conversational quality:

| Section | Reflex Budget | Heartbeat Budget | Notes |
|---|---|---|---|
| Persona (compiled) | ~800 tokens | ~2,000 tokens | Abbreviated: essentials only |
| Core self | ~500 tokens | ~2,000 tokens | Abbreviated |
| Emotional state | ~200 tokens | ~200 tokens | Same (compact by nature) |
| Message observations | ~1,000 tokens | ~6,000 tokens | Compressed history |
| Raw messages | ~500 tokens | ~4,000 tokens | Recent items past watermark |
| Thought observations | ~500 tokens | ~3,000 tokens | Compressed history |
| Raw thoughts | ~300 tokens | ~2,000 tokens | Recent items |
| Experience observations | ~300 tokens | ~2,000 tokens | Compressed history |
| Raw experiences | ~200 tokens | ~1,500 tokens | Recent items |
| Working memory | ~500 tokens | ~2,000 tokens | Capped |
| Voice guidance | ~100 tokens | N/A | Reflex-specific |
| **Total** | **~4,900 tokens** | **~24,700 tokens** | ~5x smaller |

**Key insight:** Observational memory blocks are pre-computed (written during prior EXECUTE phases by the Observer agent). Loading them is a single DB read per stream -- zero computation at reflex time. This gives the reflex compressed historical context spanning days or weeks of interaction, at the cost of a database query.

### Voice Reply Guidance

The reflex system prompt includes voice-specific instructions:

```
-- VOICE CONVERSATION --

This is a live voice conversation. Respond as if speaking aloud:
- Keep it short: 1-3 sentences unless the topic demands more
- Match the energy and casualness of what was said
- No markdown, no bullet points, no formatting
- Natural speech patterns: contractions, conversational fillers where appropriate
- Don't reference your internal state explicitly unless it feels natural
```

---

## Reflex -> Heartbeat Data Flow

### Sequential Pipeline

The reflex completes before the heartbeat tick begins. This is sequential by design:

1. **Voice message arrives** -- STT transcription completes
2. **Reflex fires** -- Lightweight context assembled, direct LLM call, reply streams to TTS
3. **Reflex reply written** -- Saved to `messages.db` with `metadata: { reflexReply: true }`
4. **Heartbeat tick enqueued** -- Normal tick trigger with reference to the reflex reply
5. **Heartbeat GATHER CONTEXT** -- Loads the reflex reply as part of `recentMessages` (it's in the DB now)
6. **Heartbeat MIND** -- Sees "I just said X" in conversation history, processes the full cognitive cycle
7. **Heartbeat EXECUTE** -- Emotions, memory, decisions. Reply is `null` (or a correction if needed)

**Why sequential, not parallel:**

- Parallel execution creates race conditions: two replies sent, emotion state mutated twice, memory conflicts
- The heartbeat is single-threaded by design (tick queue processes one at a time)
- The user doesn't wait -- the reflex reply streams immediately
- The heartbeat runs in the background after the user has already heard the response

### Heartbeat Context Additions

When a heartbeat tick processes a message that was handled by the reflex, the trigger context includes a note:

```
-- THIS MOMENT --
{contactName} sent a voice message:

"{transcribedText}"

You already responded via reflex:
"{reflexReplyContent}"

Reflect on this exchange. Process your emotions, update memory if needed,
and make any decisions this moment calls for. Only produce a follow-up reply
if you need to correct or clarify what you said.
```

This gives the mind full awareness of what was said, allowing it to:
- Process emotion deltas based on the actual exchange
- Update working memory with anything learned
- Create memory candidates for important moments
- Produce a correction reply if the reflex said something wrong
- Make decisions (spawn sub-agents, create seeds/goals, etc.)

### Correction Path

The heartbeat can output a follow-up reply if the reflex was inaccurate:

```
User: "What's my favorite color?"
Reflex: "You love blue!" (reads working memory, gets it right)
Heartbeat: reply = null (reflex was correct)

User: "When's my birthday?"
Reflex: "Happy early birthday! It's coming up soon, right?"
Heartbeat: reply = "Actually, I should clarify -- your birthday
           is March 15th, so it's about a month away!" (corrects)
```

Corrections are delivered through the normal channel (TTS for voice). The user hears the correction as a natural follow-up, like someone catching and fixing a slip.

---

## Channel Routing

### Which Channels Use the Reflex

The reflex is **voice-specific by default** but channel-configurable:

| Channel | Default Path | Rationale |
|---|---|---|
| **Voice** | Reflex -> Heartbeat | Voice requires <500ms TTFT |
| **Web chat** | Heartbeat only | 5-9s latency is acceptable for text |
| **SMS** | Heartbeat only | SMS is inherently async |
| **Discord** | Heartbeat only | Chat latency expectations are relaxed |
| **API** | Heartbeat only | API callers handle their own latency |

**Future option:** The reflex could be extended to web chat for a "fast reply" experience, where the user sees a quick response that deepens as the heartbeat processes. This is a UX decision to explore later.

### Routing Logic

```typescript
async function handleIncomingMessage(params: IncomingMessageParams) {
  const useReflex = reflexEnabled
    && reflexConfigured
    && params.channel === 'voice';  // Or check channel config

  if (useReflex) {
    // Fast path: reflex reply + background heartbeat
    const reflexReply = await executeReflexQuery(params);
    writeReplyToMessagesDb(reflexReply, { reflexReply: true });
    enqueueHeartbeatTick(params, { reflexReplyId: reflexReply.id });
  } else {
    // Normal path: heartbeat handles everything
    enqueueHeartbeatTick(params);
  }
}
```

---

## Fallback Behavior

### When Reflex Is Not Configured

If no reflex provider/API key is configured and the user enters voice mode, the system falls back to the normal heartbeat path. Voice still works -- it's just slower.

**User experience:**

1. User enters voice mode (mic button on Presence page)
2. User speaks, STT transcribes
3. State label shows "Thinking..." (heartbeat processing, ~5-9 seconds)
4. Reply appears as text and plays through TTS

**Feedback to user:**

When voice mode activates without a configured reflex provider, a one-time informational banner appears in the voice surface:

```
Voice responses will be slower without a fast-response provider.
Set one up in Settings for a more natural conversation.
```

The banner:
- Appears once per session (not every voice activation)
- Uses secondary text styling (13px, 0.40 opacity)
- Fades out after 6 seconds
- Is non-blocking -- the user can speak immediately
- Links/navigates to Settings > Reflex on tap (mobile) or provides the path (desktop)

### When Reflex Provider Is Unreachable

If the reflex is configured but the API call fails:

1. Log warning: `Reflex query failed, falling back to heartbeat`
2. Write a brief acknowledgment to messages.db: "Let me think about that..."
3. Deliver the acknowledgment via TTS immediately
4. Trigger heartbeat tick normally -- the heartbeat produces the real reply
5. The real reply is delivered via TTS when the heartbeat completes

This provides instant feedback ("Let me think about that...") while the slower heartbeat path runs.

### When Reflex Succeeds But Heartbeat Finds an Error

The heartbeat can produce a correction reply (see Correction Path above). This is delivered naturally as a follow-up via TTS after a delay. The user experiences this as the AI catching and fixing its own slip -- a natural conversational pattern.

---

## Settings & Configuration

### Reflex Provider Configuration

Located in Settings, accessible via the channel/voice configuration area. The settings guide users through setup:

**Provider selection:**

| Provider | Auth Method | Notes |
|---|---|---|
| Anthropic | API key | Claude models, requires `ANTHROPIC_API_KEY` or configured key |
| OpenAI | API key | GPT-4o/mini models, requires `OPENAI_API_KEY` or configured key |
| Google | API key | Gemini models, generous free tier |
| Ollama | Base URL | Local models, free, no API key needed |
| Custom (OpenAI-compatible) | Base URL + optional API key | Together, Groq, DeepSeek, any compatible endpoint |

**Configuration fields:**

```typescript
interface ReflexConfig {
  enabled: boolean;                    // Master toggle
  provider: 'anthropic' | 'openai' | 'google' | 'ollama' | 'openai-compatible';
  model: string;                       // e.g., 'claude-sonnet-4-5-20250929'
  apiKey?: string;                     // Encrypted, stored in system.db
  baseUrl?: string;                    // For Ollama/custom providers
  maxTokens: number;                   // Max output tokens (default: 200)
  temperature: number;                 // Default: 0.7
}
```

**Stored in:** `system.db` via the `system_settings` table, similar to how other system-level configuration is stored. API keys are encrypted using the existing `EncryptionService`.

### Onboarding Guidance

When the user first accesses voice mode without a reflex provider configured, the settings page for reflex should include guided setup:

**For users who want free/local:**
> "Connect to Ollama for free, private voice responses. Install Ollama, run a model, and point Animus to `http://localhost:11434`."

**For users who want cloud quality:**
> "Add an API key from Anthropic, OpenAI, or Google for high-quality voice responses. API costs for voice are minimal (~$0.001 per reply)."

**Test connection button:** Sends a minimal test query to the configured provider and reports success/failure with latency.

---

## Emotional Continuity

The reflex reads emotional state but does not write emotion deltas. Emotions are the heartbeat's domain.

**Flow:**

```
Before reflex:  curiosity = 0.72
Reflex reads:   curiosity = 0.72, responds with curious energy
After reflex:   curiosity = 0.72 (unchanged)

Heartbeat tick:
  GATHER:   curiosity decayed to 0.71
  MIND:     "That was an interesting exchange, curiosity +0.03"
  EXECUTE:  curiosity = 0.71 + 0.03 = 0.74
```

This is correct. The reflex is a conversational layer. The heartbeat is the emotional/cognitive layer. The reflex uses emotional state to inform tone and energy. The heartbeat processes the full experience and updates emotional state based on reflection.

---

## Memory Implications

### Reflex Reply Storage

The reflex reply is written to `messages.db` immediately after generation, before the heartbeat tick:

```sql
INSERT INTO messages (conversation_id, contact_id, direction, channel, content, metadata)
VALUES (?, ?, 'outbound', 'voice', ?, '{"reflexReply": true}');
```

The `reflexReply: true` metadata tag allows:
- The heartbeat to identify which replies were reflex-generated
- The frontend to potentially distinguish reflex vs heartbeat replies (though this is not surfaced in the current UI)
- Analytics on reflex usage

### Working Memory Updates

The reflex does **not** update working memory. Only the heartbeat's EXECUTE stage does this. Working memory updates require reflection ("what did I learn about this person?"), which is the heartbeat's job.

### Memory Candidates

The reflex does **not** create memory candidates. The heartbeat processes the full exchange (user message + reflex reply) and decides what's worth remembering.

---

## Corner Cases

### Rapid-Fire Voice Messages

User sends multiple messages in quick succession during voice mode:

1. Message 1 arrives -> Reflex 1 fires -> Reply 1 streams -> Tick 1 enqueues
2. Message 2 arrives (before Tick 1 runs) -> Reflex 2 fires -> Reply 2 streams -> Tick 2 enqueues
3. Tick queue processes Tick 1, then Tick 2 sequentially

Each reflex reply sees the previous replies (they're written to messages.db immediately). Each heartbeat tick processes its corresponding exchange. Emotional state flows forward correctly through sequential tick processing.

### Sub-Agent Completion During Voice

Sub-agents complete and trigger `agent_complete` ticks. These go through the normal heartbeat path (no reflex needed -- the user didn't ask a question). The heartbeat can produce a reply with the sub-agent's results, delivered via TTS through the normal outbound message path.

### Reflex During Heartbeat Tick

If a voice message arrives while a heartbeat tick is already processing, the reflex still fires immediately (it doesn't use the heartbeat's resources). The new heartbeat tick is enqueued and processed after the current tick completes.

### Multi-Turn Voice Context

Each reflex query loads observational memory + recent raw messages from the DB. Since each reflex reply is written immediately, subsequent reflex queries see all prior messages (including the AI's own reflex replies). Multi-turn conversational coherence is maintained through the database, not through session state.

### Model Mismatch

The reflex uses a potentially different model than the heartbeat (e.g., reflex uses local Ollama, heartbeat uses Claude via subscription). This means personality expression may differ slightly between the fast reply and the heartbeat's cognitive style. This is acceptable -- the persona prompt in the reflex context ensures basic personality consistency, and any significant drift is caught by the heartbeat's correction path.

---

## Subscription & Cost Considerations

### The Dual-Path Cost Model

| Path | Auth Method | Cost Model | Use Case |
|---|---|---|---|
| **Heartbeat** (Agent SDKs) | Subscription-based (Claude/Codex) or API key | Covered by subscription OR per-token | Deep cognition, every tick |
| **Reflex** (Vercel AI SDK) | API key or local model | Per-token OR free (Ollama) | Voice replies only |

**Key insight:** The heartbeat continues using Agent SDKs, which support subscription-based authentication (Claude Agent SDK via `sessionKey`, Codex SDK via ChatGPT OAuth). Users who rely on their subscriptions keep that benefit for the expensive heartbeat processing.

The reflex requires separate API keys for cloud providers (Anthropic, OpenAI, Google). However:
- Reflex outputs are tiny (~50-200 tokens per reply) -- cost is ~$0.001 per voice reply
- Ollama provides a free alternative with no API costs
- Google Gemini offers a generous free tier
- The reflex is optional -- users who don't want API costs use the heartbeat-only path

### Provider Policy Summary

| Provider | Subscription via Agent SDK? | API Key via Reflex? | Local/Free Option? |
|---|---|---|---|
| Anthropic | Yes (personal use, gray area for 3rd party) | Yes | No |
| OpenAI | Yes (Codex OAuth, 3rd party supported) | Yes | No |
| Google | N/A | Yes (generous free tier) | No |
| Ollama | N/A | N/A (no key needed) | Yes (fully local) |

---

## Implementation

### New Files

```
packages/backend/src/heartbeat/
  reflex.ts               # Reflex query execution + context assembly (~250 lines)
```

### Modified Files

```
packages/backend/src/heartbeat/
  index.ts                # Add reflex routing in handleIncomingMessage() (~30 lines)
  context-builder.ts      # Add buildReflexContext() method + reflex trigger template (~80 lines)

packages/shared/src/schemas/
  settings.ts             # Add ReflexConfig schema

packages/backend/src/api/routers/
  settings.ts             # Add reflex config CRUD endpoints
```

### Dependencies

```
# Added to packages/backend/package.json
ai
@ai-sdk/anthropic
@ai-sdk/openai
@ai-sdk/google
@ai-sdk/openai-compatible
```

### Context Builder Integration

The Context Builder gains a new compilation target:

```typescript
interface IContextBuilder {
  // ... existing methods ...

  /**
   * Build lightweight context for a reflex query.
   * Uses observational memory for rich history without heavy computation.
   * Targets ~4,500 tokens total.
   */
  buildReflexContext(params: ReflexContextParams): Promise<CompiledContext>;
}

interface ReflexContextParams {
  contactId: string;
  contactName: string;
  channel: 'voice';
  messageContent: string;
  conversationId: string;
  currentEmotions: EmotionState[];
}
```

---

## Streaming Pipeline

### Reflex -> TTS Integration

The reflex streams text chunks via the EventBus, which the voice channel adapter consumes for sentence-buffered TTS:

```
Reflex LLM -> Text chunks -> EventBus 'reflex:chunk'
                                   |
                                   v
                          Sentence buffer
                                   |
                                   v
                          Pocket TTS (per sentence)
                                   |
                                   v
                          Audio chunks -> Frontend playback
```

TTS synthesis is accessed via `getSpeechService().tts.synthesize()` from the shared speech module. See `docs/architecture/speech-engine.md` for engine details.

The voice mode frontend spec (`docs/frontend/voice-mode.md`) already defines the Speaking experience, audio queueing, and barge-in behavior. The reflex integrates at the "reply text streams" stage -- the frontend doesn't need to know whether the text came from a reflex or a heartbeat.

### Latency Breakdown

| Stage | Duration | Cumulative |
|---|---|---|
| STT (Parakeet TDT v3) | ~1,000-2,000ms | ~1,500ms |
| Reflex context assembly | ~5-10ms | ~1,510ms |
| LLM TTFT (direct API) | ~300-500ms | ~2,010ms |
| First sentence complete | ~200-400ms | ~2,310ms |
| TTS first sentence (Pocket TTS) | ~200-300ms | ~2,510ms |
| **User hears first words** | | **~2.5s** |

Compare to heartbeat-only path:

| Stage | Duration | Cumulative |
|---|---|---|
| STT | ~1,500ms | ~1,500ms |
| Heartbeat context assembly | ~50-100ms | ~1,600ms |
| Agent SDK cold start | ~580ms | ~2,180ms |
| Agent SDK initialization | ~3,500ms | ~5,680ms |
| LLM inference (full output) | ~2,000-4,000ms | ~8,680ms |
| JSON parse + Pocket TTS | ~300ms | ~8,980ms |
| **User hears first words** | | **~9s** |

**The reflex reduces perceived voice latency from ~9 seconds to ~2.5 seconds.**

---

## Relationship to Other Systems

| System | Relationship |
|---|---|
| **Heartbeat Pipeline** | Reflex runs before heartbeat tick; heartbeat reflects on reflex reply |
| **Context Builder** | Gains `buildReflexContext()` method using existing building blocks |
| **Observational Memory** | Reflex loads pre-computed observation blocks for rich context |
| **Emotion Engine** | Reflex reads current state; heartbeat writes deltas after reflection |
| **Memory System** | Reflex reads working memory; heartbeat handles all memory writes |
| **Agent Orchestration** | Reflex doesn't spawn/manage agents; heartbeat handles all orchestration |
| **Voice Channel** | Voice adapter routes to reflex when configured |
| **Vercel AI SDK** | New dependency for direct LLM calls (provider-agnostic) |
| **Agent SDKs** | Unchanged; heartbeat continues using Claude/Codex/OpenCode SDKs |

---

## Future Considerations

1. **Warm reflex sessions** -- Keep the AI SDK client warm between voice messages to eliminate any connection setup overhead.
2. **Reflex for web chat** -- Extend the fast-response path to text chat for a "think fast, then deepen" experience where the user sees a quick reply that the heartbeat may enrich.
3. **Reflex context tuning** -- A/B test different context compositions (more/fewer observations, different token budgets) to find the sweet spot between response quality and speed.
4. **Streaming reflex to heartbeat** -- Instead of waiting for the reflex to complete, begin the heartbeat tick while the reflex is still generating. The heartbeat could receive the reflex reply mid-stream.
5. **Reflex personality calibration** -- If the reflex model differs significantly from the heartbeat model (e.g., local Ollama vs cloud Claude), develop a calibration prompt that aligns the reflex's personality expression more closely with the heartbeat's.
6. **Reflex for proactive messages** -- The heartbeat's `send_message` decisions could use the reflex path for faster delivery when urgency matters.

---

## Related Documents

- `docs/architecture/heartbeat.md` -- The tick pipeline and MindOutput schema
- `docs/architecture/observational-memory.md` -- Compression layer the reflex leverages
- `docs/architecture/context-builder.md` -- Centralized prompt assembly
- `docs/architecture/voice-channel.md` -- STT/TTS pipeline and voice architecture
- `docs/architecture/agent-orchestration.md` -- Sub-agent management (heartbeat's domain)
- `docs/architecture/tech-stack.md` -- Shared abstractions and dependencies
- `docs/frontend/voice-mode.md` -- Voice mode UX and frontend behavior
- `docs/agents/architecture-overview.md` -- Agent SDK abstraction layer
