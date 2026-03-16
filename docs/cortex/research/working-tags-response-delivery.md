# Working Tags: Response Delivery Architecture

> **STATUS: PROPOSAL**
> **Date**: 2026-03-15
> **Related docs**: [system-prompt.md](../system-prompt.md), [cortex-architecture.md](../cortex-architecture.md), [mind-migration.md](../mind-migration.md), [compaction-strategy.md](../compaction-strategy.md), [agent-orchestration](../../architecture/agent-orchestration.md), [channel-packages](../../architecture/channel-packages.md)

---

## Problem Statement

When an agent handles a multi-step task during its agentic loop, it generates text between tool calls that narrates its internal process. Currently, ALL text generated during the agentic loop is treated as user-facing reply. On channels like SMS or Discord, this means the user receives a stream of internal reasoning:

- "Let me search for platforms..."
- "I found three options, let me dig deeper..."
- "Analyzing posting formats for dev.to..."
- "Here are my recommendations: ..."

The user only wanted the last message. The intermediate text is useful to the agent (it documents its thinking, informs subsequent tool calls, and stays in conversation history for context), but it is not useful to a user reading messages on a simple channel.

At the same time, we cannot simply suppress all intermediate text. Two important concerns prevent that:

1. **Progress updates are good UX.** When a user asks for something that takes multiple tool calls, silence is worse than a brief "Found some promising options, digging into details now." The user should know work is happening.
2. **Analysis of tool results is valuable context.** The agent's reasoning about what it found informs its subsequent tool calls and should stay in conversation history for future reference. Suppressing it entirely would degrade the agent's reasoning quality.

The challenge is separating internal reasoning (valuable for the agent but not for the user) from direct communication (valuable for both).

---

## Solution: Working Tags

The agent uses `<working>` XML tags to wrap internal reasoning, analysis, and synthesis. Text OUTSIDE these tags is direct communication intended for the user. Text INSIDE these tags stays in conversation history for the agent's reference but may be stripped before delivery depending on the user's channel.

This is a lightweight, prompt-driven convention that requires no structural changes to the agentic loop. The agent simply marks which parts of its output are internal work and which parts are user-facing communication.

### Example Interaction

Consider a user asking "research good platforms for posting about Animus."

**Turn 1** (agent receives request):
```
Sure, let me look into that for you! <working>I should search for developer
community platforms, content aggregators, and social channels that work well
for open-source developer tools. Key factors: audience alignment with
self-hosted/AI enthusiasts, content format support, engagement patterns.</working>
```

- User sees: "Sure, let me look into that for you!"
- Agent keeps: full reasoning in conversation history

**Turn 2** (after web search results):
```
<working>Search results show several strong options: dev.to has 1M+ monthly
active developers and supports long-form markdown. Reddit r/selfhosted
(400K subscribers) is directly aligned with Animus's self-hosted positioning.
HackerNews drives significant traffic for dev tool launches but is volatile.
Let me investigate posting guidelines for the top three.</working> Found some
promising platforms. Digging into their posting requirements now.
```

- User sees: "Found some promising platforms. Digging into their posting requirements now."
- Agent keeps: full comparative analysis for subsequent reasoning

**Turn 3** (after more research):
```
<working>Based on posting guidelines research: dev.to has no self-promotion
restrictions if content is genuinely technical. Reddit r/selfhosted requires
10:1 participation ratio. HackerNews Show HN requires the project to be
something users can try.</working>

Here's what I'd recommend for Animus:
1. **dev.to** - Best for technical deep-dives about the architecture
2. **Reddit r/selfhosted** - Your core audience, but participate first
3. **HackerNews Show HN** - Save for a polished launch moment

Want me to put together a detailed posting strategy with content templates?
```

- User sees: recommendations and the follow-up offer
- Agent keeps: all analysis that led to those recommendations

### What Goes in Working Tags

- Analysis of tool call results
- Reasoning about what to do next
- Synthesis of findings that informs the agent's next step
- Planning and strategy formulation
- Any text that is part of the agent's internal process rather than direct communication

### What Stays Outside Working Tags

- Acknowledgments ("Sure, let me look into that")
- Progress updates ("Found some promising options, digging deeper")
- Final answers, recommendations, deliverables
- Questions directed at the user
- Any text the user should see

The distinction follows a simple principle: if the agent is talking TO the user, it stays outside. If the agent is talking TO ITSELF (reasoning, analyzing, planning), it goes inside.

---

## Architecture

### Ownership Boundary

Cortex is a general-purpose agent package. It provides the working tag mechanism as an optional capability. The consumer (e.g., the Animus backend) decides how to use it in the context of its delivery pipeline.

**Cortex owns:**
- The working tag system prompt guidance (when to use tags, what goes inside vs. outside)
- Configuration toggle (enabled by default, consumer can disable)
- A utility module for parsing, stripping, and extracting working tag content (keeps tag format centralized)
- Layer 2 guidance: general-purpose advice about delegating complex multi-step tasks to sub-agents rather than handling them directly in the main agent loop

**The consumer (Animus backend) owns:**
- Channel-aware delivery decisions (which channels strip tags, which show full content)
- Actual tag stripping at the delivery point using Cortex's utility
- Frontend rendering of working content (inline dimmed, collapsed, hidden, etc.)
- Channel-aware system prompt guidance ("You are communicating via SMS, be concise")

This split follows the same pattern used throughout the Cortex design: Cortex provides general-purpose capabilities and the consumer provides domain-specific integration.

### Configuration

Working tags are configured via the `CortexAgent` constructor:

```typescript
interface CortexAgentConfig {
  // ... other config
  workingTags?: {
    enabled?: boolean;  // default: true
  };
}
```

When enabled, Cortex appends working tag guidance to its operational rules section of the system prompt. When disabled, no guidance is added and the agent behaves as it does today (all text treated as user-facing).

---

## System Prompt Guidance

Working tag guidance belongs in Cortex's operational rules section of the system prompt (see [system-prompt.md](../system-prompt.md)). It is appended after the consumer's content, alongside the other operational sections (System Rules, Taking Action, Tool Usage, Executing with Care, Environment).

Position it early in the operational rules, before Tool Usage guidance, since it affects all output the agent produces. This placement ensures the agent considers working tags before it begins any tool-calling sequence.

### Prompt Content

The guidance should cover five things:

1. The `<working>` tag syntax and purpose
2. When to use working tags: internal reasoning, analysis of tool results, planning next steps, synthesis that informs subsequent work
3. When NOT to use working tags: direct communication with the user, progress updates, final answers, questions for the user
4. The framing principle: "Text outside working tags is delivered to the user. Text inside working tags stays in your conversation history for your reference but may not be shown to the user depending on their interface."
5. Emphasis that progress updates and acknowledgments are good UX and should NOT be wrapped in working tags

Example system prompt section:

```
# Response Delivery

When working through multi-step tasks, distinguish between internal working
content and user-facing communication using <working> tags.

**Wrap in <working> tags:**
- Your analysis of tool call results
- Reasoning about what to do next
- Synthesis of findings you'll reference in later steps
- Planning and strategy

**Keep outside <working> tags (delivered to user):**
- Acknowledgments when starting work
- Progress updates at meaningful milestones
- Final answers, recommendations, and deliverables
- Questions directed at the user

Text outside <working> tags is what the user sees. Text inside <working> tags
stays in your conversation for context but may not be displayed depending on
the user's interface.

Good progress updates are concise and informative: "Found 5 strong candidates,
analyzing their requirements now." Do not narrate every step, but do keep the
user informed at natural milestones.

For complex tasks requiring extensive research or multiple phases of work,
consider delegating to a sub-agent so you remain responsive for other
interactions.
```

The final paragraph is Layer 2 guidance: a nudge toward sub-agent delegation for complex work. This is general-purpose advice that applies to any consumer with sub-agent support. The specific orchestration mechanics (spawn_agent decisions, AgentOrchestrator) are consumer concerns described in the Animus backend's agent orchestration architecture.

---

## Tag Stripping Utility

Cortex exports a utility module for working with `<working>` tags. Centralizing the tag format in Cortex means consumers do not need to know or maintain the regex patterns. If the tag name or format ever changes, consumers update their Cortex dependency and everything continues to work.

```typescript
/**
 * Strips <working> tag content from agent text.
 * Returns only user-facing content with normalized whitespace.
 */
export function stripWorkingTags(text: string): string;

/**
 * Extracts working content from agent text.
 * Returns only the content inside <working> tags, concatenated.
 * Returns null if no working tags are present.
 */
export function extractWorkingContent(text: string): string | null;

/**
 * Parses agent text into user-facing and working segments.
 * Provides structured access to both parts.
 */
export function parseWorkingTags(text: string): {
  userFacing: string;
  working: string | null;
  hasWorkingContent: boolean;
};
```

### Implementation Notes

- The parser treats `<working>` and `</working>` as flat delimiters. Nested working tags are not supported and should not be instructed by the system prompt.
- `stripWorkingTags()` normalizes whitespace after removal: collapses multiple consecutive newlines to a maximum of two, trims leading/trailing whitespace. This prevents awkward gaps where working content was removed.
- All three functions handle the case where no working tags are present (passthrough for `stripWorkingTags`, null for `extractWorkingContent`, `hasWorkingContent: false` for `parseWorkingTags`).
- The regex pattern is defined once internally and shared across all three functions.

---

## Delivery Flow

The consumer (Animus heartbeat pipeline) handles delivery based on channel type. Working tag processing happens at the delivery boundary, not during the agentic loop itself.

### During the Agentic Loop

The agent generates text normally. Working tags are part of the generated text. No stripping occurs during generation. The full text (tags included) flows through the event bridge, is logged to `agent_logs.db`, and stays in conversation history. This preserves the agent's reasoning chain for subsequent tool calls within the same loop.

### At Delivery Time

When a reply is ready to be delivered to the user:

1. The heartbeat pipeline's EXECUTE phase processes the reply
2. The pipeline checks the target channel's working tag handling mode
3. For channels that strip working content:
   - Use `stripWorkingTags()` to remove `<working>` content
   - If the remaining text is non-empty, deliver it to the user
   - If the remaining text is empty (the entire chunk was working content), skip delivery for that chunk
4. For channels that show everything (e.g., the frontend web UI):
   - Deliver the full text, potentially with visual differentiation for working content
5. The full unstripped text always goes to `agent_logs.db` and stays in conversation history regardless of channel handling

### Channel Configuration (Consumer-Owned)

Each channel type has a preferred working tag handling mode. This configuration lives in the consumer (Animus), not in Cortex.

| Channel | Working Tag Handling | Rationale |
|---------|---------------------|-----------|
| Frontend web UI | Render inline, visually dimmed | Preserves the "inner life" transparency that is core to Animus's product vision |
| SMS / Twilio | Strip entirely | Character limits and user expectations for brevity |
| Discord | Strip by default (configurable per instance) | Most Discord users expect clean messages; power users can enable full display |
| API (OpenAI-compat) | Configurable (default: include) | API consumers can parse tags themselves |
| API (Ollama-compat) | Configurable (default: include) | Same as OpenAI-compat |

Channel configuration could be stored alongside existing channel settings. Each channel instance could expose a `workingTagMode: 'strip' | 'show' | 'dim'` setting, with the default determined by channel type.

---

## Interaction with Streaming

Working tag stripping works with streaming, but the implementation needs to handle partial tags across chunk boundaries.

### Streaming Strategy

The streaming pipeline processes text chunks as they arrive from the agentic loop:

1. **Buffer until a complete tag boundary is found.** If a `<working>` open tag is detected mid-chunk, buffer text until the corresponding `</working>` close tag arrives.
2. **Emit user-facing content immediately.** Text outside working tags streams to the user with minimal latency. Progress updates and acknowledgments arrive as soon as the agent produces them.
3. **Emit or discard working content based on channel config.** For channels that show working content (web UI), emit it as a separate stream segment with metadata indicating it is working content. For channels that strip, discard the buffered working content.

### Latency Impact

In practice, the latency impact is minimal:

- Tag boundaries (`<working>` and `</working>`) are typically emitted within a single streamed chunk or at most across two adjacent chunks. The buffer window is very short.
- User-facing content before the first `<working>` tag streams immediately with zero additional latency.
- User-facing content after a `</working>` close tag streams immediately once the tag boundary is resolved.
- The only scenario with meaningful latency is when the agent produces a very long working block (thousands of tokens of analysis). In this case, the user sees no output until the working block completes and user-facing text resumes. This is acceptable because the alternative (no working tags) would stream the analysis directly to the user, which is worse.

### Edge Cases in Streaming

- **Chunk splits a tag name**: e.g., `<wor` in one chunk, `king>` in the next. The buffer detects the partial tag and waits for completion.
- **Multiple working blocks in one chunk**: Handled correctly by the parser; each `<working>...</working>` pair is processed independently.
- **Unclosed working tag at end of response**: If the agent's response ends with an unclosed `<working>` tag, treat the entire buffered content as user-facing (fail-open). Log a warning for monitoring.
- **Empty user-facing content between working blocks**: Skip delivery. Do not send empty messages or whitespace-only messages.

---

## Interaction with Compaction

Working tag content stays in conversation history and is subject to normal compaction. No special handling is required.

### Layer 1: Microcompaction

Microcompaction only touches tool results (content blocks with `type: 'tool_result'`), not assistant text. Working tags appear in assistant text blocks. Microcompaction does not affect them at all.

### Layer 2: Conversation Summarization

The summarizer sees full text including working content. This is beneficial: the agent's analysis and reasoning (inside working tags) provides better context for producing structured summaries. The summarizer can distinguish between what the agent communicated to the user and what the agent kept as internal reasoning, producing a more accurate summary.

### Layer 3: Emergency Truncation

Emergency truncation removes whole turns. No special handling is needed for working tags.

### Net Effect

Working tags may actually improve compaction quality. By explicitly marking internal reasoning, the summarizer has a clearer signal about what happened during the agent's work. "The agent analyzed three platforms (analysis in working tags) and recommended dev.to, Reddit, and HackerNews (delivered to user)" is a more useful summary than one that cannot distinguish analysis from communication.

---

## Interaction with Sub-Agent Communication

Sub-agents also use working tags in their own agentic loops. When a sub-agent uses the `send_message` tool to proactively communicate with the user, the message content should already be user-facing (the sub-agent chose to send it intentionally). Working tag stripping still applies as a safety net at the delivery boundary.

The delivery flow for sub-agent messages:

1. Sub-agent calls `send_message` with a message intended for the user
2. The message passes through the normal outbound delivery pipeline
3. Working tag stripping applies based on the target channel's configuration
4. If the sub-agent accidentally included working tags in a `send_message` call, the stripping catches it

This is a defense-in-depth pattern. The system prompt guidance should produce correct behavior (sub-agents should not include working tags in `send_message` content), but the stripping at the delivery boundary provides a safety net.

---

## Frontend Rendering (Consumer-Owned)

For the Animus web frontend, working content should be rendered inline with visual differentiation:

- **Dimmed text**: Working content appears in a lighter, lower-contrast style that is readable but visually recedes. This preserves the "inner life" transparency that is core to Animus's product vision (see [product-vision.md](../../product-vision.md) and [brand-vision.md](../../brand-vision.md)).
- **Different background**: A subtle background tint (warm gray or muted) could distinguish working content from user-facing text.
- **Optional collapse**: Working blocks could be collapsed by default with a "show reasoning" toggle, allowing users who want to see the full process to expand them.

The frontend uses `parseWorkingTags()` from Cortex to segment the text, then applies appropriate styling to each segment. This is purely a rendering concern; the full text is always available in the conversation data.

### Future Evolution

Frontend rendering could evolve in several directions:

- Collapsed sections with expand/collapse for each working block
- A separate "thinking" panel alongside the conversation
- Toggleable visibility (a global setting to show or hide working content)
- Per-conversation or per-message visibility controls

These are UI decisions that can be iterated on independently of the working tag mechanism itself.

---

## Reliability Considerations

### Agent Compliance

The primary risk is the agent not consistently using working tags. This is a prompt-driven convention, and LLMs can be inconsistent with conventions under certain conditions.

**Mitigations:**

1. **Prompt positioning**: Working tag guidance is positioned early in Cortex's operational rules, before tool usage guidance. The agent sees this guidance before it begins any tool-calling sequence.
2. **Simple convention**: One tag (`<working>`), clear rules for what goes inside vs. outside. The simpler the convention, the more reliably the agent follows it.
3. **Safe failure mode**: If the agent forgets to use working tags, all text goes to the user. This is the current behavior (over-communicate) and is better than the alternative (the agent wraps everything in working tags and the user gets nothing).
4. **XML tag strength**: Claude models are particularly good at following XML tag conventions. The `<working>` tag format leverages a well-understood pattern.
5. **Always-present guidance**: Working tag guidance is part of Cortex's operational rules and is always present regardless of persona or consumer content. The consumer cannot accidentally remove it.

### Edge Cases

| Scenario | Behavior | Severity |
|----------|----------|----------|
| Agent wraps everything in working tags | User gets no messages | Unlikely with good prompting; monitor for this pattern |
| Agent never uses working tags | All text goes to user (current behavior) | Not ideal but not broken |
| Mixed tags in one chunk | Parser handles correctly via regex | Non-issue |
| Nested working tags | Not supported; outer pair is treated as the boundary | Non-issue (prompting does not instruct nesting) |
| Tags split across streaming chunks | Streaming implementation buffers across boundaries | Handled by design |
| Malformed tags (e.g., `<working>` without close) | Fail-open: treat as user-facing | Safe default |

### Monitoring

Track working tag usage patterns to ensure the system is working as intended:

- **Tag presence rate**: Percentage of agentic loop turns that include working tags. A rate near zero suggests the agent is not following the guidance; a rate near 100% suggests potential over-tagging.
- **Content ratio**: Ratio of working content tokens to user-facing content tokens. Extreme ratios in either direction warrant investigation.
- **Empty delivery rate**: How often stripping working tags produces empty user-facing content. A high rate suggests the agent is wrapping too much in working tags.

These metrics can be derived from `agent_logs.db` entries without additional infrastructure.

---

## Relationship to Other Response Delivery Layers

Working tags are Layer 1 of a multi-layered response delivery approach. Each layer addresses a different aspect of how the agent's output reaches the user.

### Layer 1: Working Tags (This Document)

Moment-to-moment separation of internal reasoning from user-facing text within any agentic loop turn. Operates at the text level within individual assistant messages.

**Scope**: Single turns within the agentic loop.
**Owner**: Cortex (prompt guidance, utilities); consumer (delivery decisions).

### Layer 2: Sub-Agent Delegation

Complex multi-step tasks are delegated to sub-agents that work independently. The mind stays responsive for other interactions. Sub-agents communicate proactively via `send_message` when they have progress or results to share. See [agent-orchestration.md](../../architecture/agent-orchestration.md).

**Scope**: Entire tasks that would block the mind.
**Owner**: General guidance in Cortex (system prompt nudge); specific orchestration in consumer.

### Layer 3: Channel-Aware Prompting

Channel-specific communication style guidance shapes the agent's overall output. "You are communicating via SMS; be concise" or "You are communicating via the web UI; rich markdown is supported." Animus already has this via `getReplyGuidance()` and `buildChannelCapabilities()` in the context builder.

**Scope**: Overall communication style for the entire interaction.
**Owner**: Consumer (Animus backend context builder).

### Layer 4: Artifact Pattern

For deliverables too large for inline delivery (full reports, strategy documents, code files), the agent writes to files and references them in its reply. This is driven by Layer 3 prompting (channel guidance instructs the agent when to use files vs. inline content).

**Scope**: Large output that exceeds inline delivery constraints.
**Owner**: Driven by Layer 3 prompting and tool availability.

### How the Layers Compose

The layers are complementary, not alternatives. A typical complex interaction might use all four:

1. User asks for a comprehensive analysis
2. **Layer 1**: The mind acknowledges the request (outside working tags), reasons about how to approach it (inside working tags), and decides to delegate
3. **Layer 2**: The mind spawns a research sub-agent
4. **Layer 1**: The sub-agent uses working tags during its own agentic loop, sending progress updates outside tags and keeping analysis inside
5. **Layer 3**: Channel-aware prompting shapes the sub-agent's communication style
6. **Layer 4**: The sub-agent writes a detailed report to a file and sends a summary with a reference to the file

---

## Open Design Questions

### 1. Tag Name Selection

`<working>` is the current proposal. Alternatives considered:

| Tag Name | Pros | Cons |
|----------|------|------|
| `<working>` | Intuitive, clearly implies in-progress internal work | None significant |
| `<thinking>` | Familiar from extended thinking features | Conflicts with Anthropic's extended thinking `<thinking>` tags; could confuse the model |
| `<internal>` | Unambiguous about audience | Generic; does not convey the "in-progress work" aspect |
| `<process>` | Suggests process/procedure | Less intuitive; could be confused with system processes |
| `<reasoning>` | Descriptive | Too narrow; working content includes planning and synthesis, not just reasoning |

**Recommendation**: Stick with `<working>`. It avoids conflicts with existing model features, is intuitive, and clearly communicates the purpose.

### 2. Streaming Chunk Buffering Strategy

The streaming implementation needs to decide how much to buffer when waiting for tag boundaries vs. delivering immediately. Two approaches:

- **Minimal buffering**: Buffer only when a partial `<working>` tag is detected (6 characters max for the opening tag). Emit everything else immediately. Risk: very slightly higher implementation complexity for tag detection across chunk boundaries.
- **Line-level buffering**: Buffer entire lines and check for tags at the line level. Simpler implementation but adds latency equal to one line of output.

This needs an implementation spike to determine the best approach for the specific streaming infrastructure in use.

### 3. Observability and Metrics

Should working tag usage patterns (ratio of working to user-facing content, frequency of tag usage, empty delivery rate) be tracked as formal metrics? Options:

- **Agent logs only**: Derive metrics from `agent_logs.db` on demand. No additional infrastructure.
- **Telemetry events**: Emit PostHog events for working tag usage. Provides aggregate data across instances. Adds implementation cost.
- **Frontend dashboard**: Show working tag stats in the frontend observability UI. Most useful for individual instance monitoring.

**Recommendation**: Start with agent logs only. Add telemetry or frontend metrics if monitoring reveals compliance concerns.

### 4. Evolution Path

Could working tags evolve to support more structured metadata in the future? For example:

```xml
<working type="analysis">...</working>
<working type="planning">...</working>
<working priority="low">...</working>
```

Typed working content could enable more granular frontend rendering (show analysis but hide planning, or collapse low-priority working blocks by default).

**Recommendation**: Start simple with plain `<working>` tags. Extend with attributes only if a concrete use case emerges that cannot be solved with the basic mechanism.

---

## Implementation Sequence

Working tags can be implemented incrementally:

1. **Cortex utility module**: Implement `stripWorkingTags()`, `extractWorkingContent()`, and `parseWorkingTags()` with unit tests. Pure string operations, no dependencies.

2. **System prompt integration**: Add the Response Delivery section to Cortex's operational rules (see [system-prompt.md](../system-prompt.md)). Gate on the `workingTags.enabled` config flag.

3. **Backend delivery integration**: Add working tag stripping to the heartbeat pipeline's reply delivery path. Use the channel's configured handling mode to decide whether to strip.

4. **Streaming support**: Implement chunk-level buffering for working tag boundaries in the streaming pipeline.

5. **Frontend rendering**: Add visual differentiation for working content in the web UI conversation view.

6. **Monitoring**: Add agent log queries or dashboard metrics for working tag usage patterns.

Steps 1 and 2 are Cortex-side work. Steps 3 through 6 are consumer-side (Animus backend and frontend). Steps 1 and 2 can land with the Cortex package regardless of whether the consumer has integrated them yet.

---

## References

- [Cortex System Prompt](../system-prompt.md) (where working tag guidance is appended)
- [Cortex Architecture](../cortex-architecture.md) (general Cortex design)
- [Mind Migration](../mind-migration.md) (5-phase pipeline, streaming, event bridge)
- [Compaction Strategy](../compaction-strategy.md) (how working tags interact with compaction layers)
- [Agent Orchestration](../../architecture/agent-orchestration.md) (sub-agent delegation, Layer 2)
- [Channel Packages](../../architecture/channel-packages.md) (channel types and delivery infrastructure)
- [Product Vision](../../product-vision.md) (inner life transparency)
- [Brand Vision](../../brand-vision.md) (visual identity for frontend rendering)
