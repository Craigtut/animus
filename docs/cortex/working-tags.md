# Working Tags

> **STATUS: RESEARCH** - Not yet implemented.

Working tags are an optional Cortex feature that separates an agent's internal reasoning from user-facing communication during agentic loops. When enabled, the agent wraps internal working content in `<working>` XML tags. Text outside these tags is direct communication intended for the user.

## Problem

When an agent handles multi-step tasks, it generates text between tool calls that narrates its internal process: reasoning about results, planning next steps, synthesizing findings. In the current model, all text generated during the agentic loop is treated as user-facing reply. On channels like SMS or Discord, this means users receive a stream of internal monologue they did not ask for.

Simply suppressing all intermediate text is not the answer:

1. **Progress updates are good UX.** A brief "Found some promising platforms, digging into details now" keeps the user informed and confident.
2. **Analysis should stay in conversation history.** The agent's synthesis of tool results is valuable context for subsequent reasoning. Moving it to external files removes it from the agent's working memory.

The solution must let the agent communicate intentionally with the user while keeping its analytical work in-context for its own reference.

## How It Works

The agent uses `<working>` XML tags to wrap content that is part of its internal process. Text outside these tags is direct communication with the user. Both types of content remain in conversation history; the difference is only in delivery.

### What Goes in Working Tags

- Analysis of tool call results
- Reasoning about what to do next
- Synthesis of findings that informs later steps
- Planning and strategy formulation
- Any text that serves the agent's process rather than the user

### What Stays Outside Working Tags

- Acknowledgments ("Sure, let me look into that")
- Progress updates at meaningful milestones
- Final answers, recommendations, deliverables
- Questions directed at the user
- Any text the user should see

### Example

Turn 1 (user asks "research good platforms for posting about Animus"):
```
Sure, let me look into that for you! <working>I should search for developer
community platforms, content aggregators, and social channels that work well
for open-source developer tools. Key factors: audience alignment with
self-hosted/AI enthusiasts, content format support, engagement patterns.</working>
```

Turn 2 (after web search results return):
```
<working>Search results show several strong options: dev.to has 1M+ monthly
active developers and supports long-form markdown. Reddit r/selfhosted
(400K subscribers) is directly aligned with self-hosted positioning.
HackerNews drives significant traffic for dev tool launches but is
volatile. Let me investigate posting guidelines for the top three.</working>
Found some promising platforms. Digging into their posting requirements now.
```

Turn 3 (after more research tool calls):
```
<working>Based on posting guidelines research: dev.to has no self-promotion
restrictions if content is genuinely technical. Reddit r/selfhosted requires
10:1 participation ratio. HackerNews Show HN requires the project to be
something users can try.</working>

Here's what I'd recommend:
1. **dev.to** - Best for technical deep-dives about the architecture
2. **Reddit r/selfhosted** - Your core audience, but participate first
3. **HackerNews Show HN** - Save for a polished launch moment

Want me to put together a detailed posting strategy with content templates?
```

In this interaction:
- The user sees three messages: an acknowledgment, a progress update, and the recommendations.
- The agent's conversation history retains all the analysis for follow-up reasoning.
- If the user asks "tell me more about the Reddit approach," the agent has its full analysis in context.

## Configuration

Working tags are enabled by default and can be disabled by the consumer.

```typescript
interface CortexAgentConfig {
  // ... other config
  workingTags?: {
    enabled?: boolean;  // default: true
  };
}
```

When enabled, Cortex appends working tag guidance to its operational rules section of the system prompt (see System Prompt Guidance below). When disabled, the guidance is omitted and all agent text is treated as user-facing (current behavior).

The consumer decides when to enable or disable. A common pattern: enable for text-based channels, disable for voice channels where the interaction is conversational and low-latency streaming matters more than internal/external separation.

## System Prompt Guidance

When `workingTags.enabled` is true, Cortex appends a "Response Delivery" section to its operational rules. This section is placed after "System Rules" and before "Taking Action" so the agent internalizes it as a core operating principle.

```
# Response Delivery

When working through multi-step tasks, distinguish between internal
working content and direct communication using <working> tags.

**Wrap in <working> tags:**
- Your analysis of tool call results
- Reasoning about what to do next
- Synthesis of findings you will reference in later steps
- Planning and strategy

**Keep outside <working> tags (delivered to user):**
- Acknowledgments when starting work
- Progress updates at meaningful milestones
- Final answers, recommendations, and deliverables
- Questions directed at the user

Text outside <working> tags is what the user sees. Text inside <working>
tags stays in your conversation for your own reference but may not be
displayed to the user depending on their interface.

Good progress updates are concise and informative: "Found 5 strong
candidates, analyzing their requirements now." Do not narrate every
step, but do keep the user informed at natural milestones.

For complex tasks requiring extensive research or multiple phases of
work, consider delegating to a sub-agent so you remain responsive
for other interactions.
```

This guidance is Cortex-owned and always present when working tags are enabled. The consumer does not need to add their own working tag instructions. Channel-specific communication style guidance (e.g., "You are communicating via SMS, be concise") is the consumer's responsibility and goes in the consumer's system prompt content.

## Event Model

Working tags affect the event model at two levels: raw streaming and structured turn completion.

### Raw Streaming (Zero Latency)

During the agentic loop, Cortex streams raw text chunks to the consumer with zero buffering and zero latency impact. Working tags appear in the raw stream as literal text.

```typescript
// Raw text chunks, unprocessed, zero latency
cortex.on('response_chunk', (chunk: string) => {
  // chunk may contain <working> tags, partial tags, or plain text
  // Consumer handles rendering/stripping as needed
});
```

Cortex does NOT attempt to parse or buffer tags during streaming. This preserves latency characteristics for all consumers, including voice channels where even small buffers create audible gaps.

### Structured Turn Completion

At the end of each turn, Cortex parses the complete turn text and emits a structured `AgentTextOutput` object. This is where Cortex owns the tag parsing.

```typescript
interface AgentTextOutput {
  /** Text intended for the user (working tag content stripped, whitespace normalized) */
  userFacing: string;
  /** Content from inside <working> tags, concatenated. Null if no working tags present. */
  working: string | null;
  /** The original unparsed text exactly as the agent produced it */
  raw: string;
}
```

```typescript
// Structured output at turn boundary
cortex.on('turn_complete', (output: AgentTextOutput) => {
  // output.userFacing  - clean text for delivery
  // output.working     - internal content for logging/display
  // output.raw         - original text for conversation history
});
```

The consumer uses whichever property fits their channel:
- SMS/Discord: deliver `output.userFacing`
- Frontend: use `output.raw` for streaming display with visual differentiation of tags, or use the structured properties for rendering
- Agent logs: store `output.raw` for full observability

### Why Two Levels

Streaming and delivery are different concerns:
- **Streaming** is about real-time display. Latency matters. The consumer needs raw text immediately.
- **Delivery** is about what message the user receives. Correctness matters. The consumer needs parsed, structured data.

These do not conflict. Stream raw for speed, parse at turn boundary for structure. Cortex avoids complex mid-stream buffering entirely.

## Parsing Utility

Cortex exports utility functions for consumers that need to do their own tag processing (e.g., frontend rendering from raw stream data).

```typescript
/**
 * Strips <working> tag content from text.
 * Returns only user-facing content with normalized whitespace.
 */
export function stripWorkingTags(text: string): string;

/**
 * Extracts content from inside <working> tags.
 * Returns concatenated working content, or null if none found.
 */
export function extractWorkingContent(text: string): string | null;

/**
 * Parses text into user-facing and working segments.
 */
export function parseWorkingTags(text: string): {
  userFacing: string;
  working: string | null;
  raw: string;
};
```

These are the same functions Cortex uses internally for `AgentTextOutput` construction. Exporting them keeps the tag format centralized: if the tag name or parsing logic ever changes, consumers using the utility stay correct.

### Parsing Rules

- Tags are flat delimiters: `<working>` opens, `</working>` closes. Nesting is not supported.
- Multiple `<working>` blocks in a single turn are concatenated (separated by newlines) in the `working` property.
- Whitespace between a closing `</working>` tag and subsequent user-facing text is normalized (collapsed to a single space or newline as appropriate).
- Unclosed `<working>` tags at the end of text: all content after the opening tag is treated as working content. This handles streaming edge cases where a turn is interrupted.
- The regex is simple and handles the common case. It is not a full XML parser.

## Consumer Integration

Cortex provides the tag system (prompting, parsing, utilities). The consumer decides what to do with the structured output per channel.

### Delivery Decisions (Consumer-Owned)

| Channel Type | Recommended Handling |
|---|---|
| Frontend web UI | Render full text with working content visually dimmed (inline, lower opacity or different background) |
| SMS | Deliver `userFacing` only. Strip working content entirely. |
| Discord | Deliver `userFacing` only. Configurable per channel instance. |
| Voice | Disable working tags entirely (`workingTags.enabled: false`). Voice interactions are conversational with short turns; sub-agent delegation handles complex tasks. |
| API | Configurable. Provide both `userFacing` and `working` in the response payload. |

### Frontend Rendering

For the web frontend, working content is rendered **inline but dimmed**: same position in the text flow, but visually differentiated (lower opacity, subtle background tint, or muted text color). The user can see the agent's reasoning if they look for it, but the direct communication stands out.

This preserves the "inner life" experience on the web UI while keeping the interface clean.

### Voice Channels

Voice channels should disable working tags. The interaction pattern is fundamentally different:
- Voice is conversational with short, natural turns
- Low-latency streaming is critical (any buffering creates dead air)
- Complex multi-step tasks should be delegated to sub-agents ("I'll look into that and get back to you")
- The agent communicates naturally without needing to distinguish internal/external

The consumer disables working tags for voice by passing `workingTags: { enabled: false }` when configuring the agent for voice channel ticks.

## Interaction with Other Cortex Systems

### Compaction

Working tag content stays in conversation history and is subject to normal compaction:

- **Microcompaction (Layer 1)**: Only touches tool results, never agent text. Working tags unaffected.
- **Conversation Summarization (Layer 2)**: The summarizer sees full text including working content. This is beneficial: the analysis within working tags provides better context for producing structured summaries.
- **Emergency Truncation (Layer 3)**: Removes whole turns. No special handling needed.

Working tags may help the summarizer distinguish analytical work from user-facing communication, potentially improving summary quality.

### Sub-Agent Communication

Sub-agents also use working tags when the feature is enabled. When a sub-agent uses the `send_message` tool to proactively communicate with the user, the message content should already be user-facing (the sub-agent chose to send it intentionally). The consumer can apply working tag stripping to `send_message` content as defense-in-depth.

### Skills

Loaded skill content lives in ephemeral context and does not interact with working tags. The agent may use working tags in its reasoning about how to apply a loaded skill, which is normal and expected.

## Multi-Layer Response Delivery

Working tags are Layer 1 of a complementary four-layer approach to response delivery. Each layer addresses a different aspect of the problem:

| Layer | Mechanism | Owned By | Purpose |
|---|---|---|---|
| 1. Working Tags | `<working>` XML tags in agent text | Cortex | Moment-to-moment separation of internal reasoning from user-facing communication within any agentic loop |
| 2. Sub-Agent Delegation | Mind delegates complex tasks to sub-agents | Cortex (guidance) + Consumer (orchestration) | Isolates long-running work from the main mind session. Sub-agents work silently; mind delivers synthesized results. |
| 3. Channel-Aware Prompting | System prompt guidance per channel type | Consumer | Shapes overall communication style ("Be concise for SMS", "You can be detailed for web") |
| 4. Artifact Pattern | Agent writes deliverables to files and references them | Consumer (prompting) | Handles outputs too large for inline delivery (full reports, strategy docs, code) |

The layers compose naturally: working tags handle the common case (inline tool use), delegation handles complex cases (extended research), channel prompting shapes tone, and artifacts handle large outputs. No single layer needs to solve everything.

## Reliability

### Agent Compliance

The main risk is the agent not consistently using working tags. Mitigations:

- **Prompt positioning**: The guidance is placed early in Cortex's operational rules, before tool usage guidance, establishing it as a core operating principle.
- **Simple behavior**: One tag, clear rules for what goes inside vs. outside. No complex classification.
- **Safe failure mode**: If the agent forgets tags, all text goes to the user. Over-communicating is better than under-communicating.
- **Always present**: Cortex controls this section of the system prompt. It is present regardless of persona, consumer content, or plugin configuration.
- **XML tag strength**: LLMs (Claude in particular) are reliable at following XML tag conventions when clearly instructed.

### Edge Cases

| Scenario | Behavior |
|---|---|
| Agent wraps everything in working tags | User receives no messages. Unlikely with good prompting. Monitor via agent logs. |
| Agent never uses working tags | All text goes to user (current behavior). Not ideal but not broken. |
| Multiple working blocks in one turn | Concatenated in `working` property, stripped from `userFacing`. |
| Working tags split across streaming chunks | Raw stream passes through as-is. Parsing happens at turn completion on complete text. |
| Nested `<working>` tags | Not supported. Treated as flat delimiters (first open, first close). |
| Unclosed `<working>` tag | All content after the opening tag treated as working content. |
| `<working>` in tool results | Only agent-generated text is parsed. Tool result content is not affected. |

## Package Structure

Working tags add the following to the Cortex package:

```
packages/cortex/
  src/
    working-tags.ts             # parseWorkingTags(), stripWorkingTags(), extractWorkingContent()
    ...existing files
```

The parsing utilities are pure functions with no dependencies. The system prompt section is generated conditionally in the system prompt assembly based on `config.workingTags.enabled`.

## References

- [System Prompt](./system-prompt.md): Where the Response Delivery section is placed in the operational rules
- [Mind Migration](./mind-migration.md): How working tags integrate with the 5-phase pipeline
- [Compaction Strategy](./compaction-strategy.md): How working tag content is handled during compaction
- [Research: Working Tags Response Delivery](./research/working-tags-response-delivery.md): Original exploration and problem analysis
