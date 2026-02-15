# Agent Timeline — Design Spec

## Purpose

The Agent Timeline replaces the current TickDetail view in the Mind > Heartbeats section. Where the old view showed only the results of a tick (thought, experience, emotion deltas, decisions), the Agent Timeline reveals the full chronological story of what happened during a tick — every agent session event, from session creation through thinking, tool use, and response, culminating in the tick's cognitive output.

This view serves the user who wants to understand not just what Animus thought, but how it got there. It is a transparency tool — the inner workings made visible — and it should feel like watching a mind at work, not reading a server log.

**User need:** "What happened during this tick? Why did it take so long? What tools did it use? What was it thinking about?"

---

## User Flow

```
Heartbeats List (tick rows)
    |
    | click a tick row
    v
Agent Timeline (this spec)
    |
    | click "Back to ticks"
    v
Heartbeats List
```

**Entry points:**
1. Click a tick row in the Heartbeats list view (existing TickList component)
2. Direct link via future command palette or deep link (`/mind/heartbeats/:tickNumber`)

**Exit points:**
1. Back button returns to Heartbeats list
2. Sub-agent link navigates to `/mind/agents/:agentId` (the existing Agent Detail route)
3. Navigation pill to switch spaces

---

## Data Requirements

### New API Endpoint

A new tRPC procedure is required to return the full event timeline for a tick.

```typescript
// heartbeat.getTickTimeline
getTickTimeline: protectedProcedure
  .input(z.object({ tickNumber: z.number().int().positive() }))
  .query(({ input }) => {
    // Returns:
    // 1. All agent_events for the session associated with this tick,
    //    ordered chronologically
    // 2. Tick metadata (trigger type, session state, etc.)
    // 3. Tick results from heartbeat.db (thoughts, experiences,
    //    emotion history, decisions)
    // 4. Token usage from agent_usage
  })
```

**Response shape:**

```typescript
interface TickTimeline {
  // Tick metadata
  tickNumber: number;
  triggerType: 'interval' | 'message' | 'scheduled_task' | 'agent_complete';
  sessionState: 'cold' | 'warm';
  createdAt: string;           // ISO timestamp

  // The chronological event list
  events: TimelineEvent[];

  // Tick results (from heartbeat.db, attached to the tick_output event)
  results: {
    thoughts: Array<{ content: string; importance: number }>;
    experiences: Array<{ content: string; importance: number }>;
    reply: { content: string; channel: string; contactId?: string } | null;
    emotionDeltas: Array<{
      emotion: string;
      delta: number;
      reasoning: string;
      intensityBefore: number;
      intensityAfter: number;
    }>;
    decisions: Array<{
      type: string;
      description: string;
      parameters: Record<string, unknown>;
      outcome: 'executed' | 'dropped' | 'failed';
      outcomeDetail?: string;
    }>;
  } | null;

  // Token usage summary
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number | null;
  } | null;

  // Total tick duration in ms (from tick_input to tick_output)
  durationMs: number | null;
}

interface TimelineEvent {
  id: string;
  eventType: AgentEventType;
  data: Record<string, unknown>;
  createdAt: string;            // ISO timestamp
  relativeMs: number;           // Milliseconds since first event (session_start or tick_input)
}
```

The existing `agentEventTypeSchema` already defines all 14 event types needed. The `response_chunk` events are excluded from persistence per the heartbeat architecture doc, so they will not appear in the timeline.

---

## Component Hierarchy

```
HeartbeatsSection
  |-- TickList (existing, unchanged)
  |-- AgentTimeline (NEW — replaces TickDetail)
        |-- TimelineHeader
        |-- TimelineBody
        |     |-- TimelineLine (the vertical connecting line)
        |     |-- TimelineEventRow (repeated for each event)
        |     |     |-- TimelineDot
        |     |     |-- RelativeTimestamp
        |     |     |-- EventLabel
        |     |     |-- EventPreview
        |     |     |-- DurationBadge (conditional)
        |     |     |-- ExpandIndicator
        |     |     |-- EventDetail (conditional, expanded state)
        |     |
        |     |-- TickCompletionCard (for tick_output — expanded by default)
        |           |-- ThoughtBlock
        |           |-- ExperienceBlock
        |           |-- ReplyBlock (conditional)
        |           |-- EmotionDeltaGrid
        |           |-- DecisionList
        |           |-- TokenUsageSummary
        |
        |-- TimelineFooter (empty state or error)
```

---

## Screen: Agent Timeline

### Layout

The timeline occupies the full content column of the Mind page (max-width 640px, centered). It scrolls vertically as a single page.

**Vertical structure:**
1. **Header** — Fixed metadata bar at the top (not position:fixed; it scrolls with content)
2. **Timeline body** — The event list with connecting line
3. **Completion card** — The tick_output section, visually distinct and expanded

The left edge of the timeline body is inset 72px from the content edge to create room for the timestamp column and dot. The timeline line runs vertically at the 72px mark.

### Information Hierarchy

1. **Primary:** The chronological event flow — what happened, in what order
2. **Secondary:** The tick_output completion card — the cognitive results
3. **Tertiary:** Event detail payloads (hidden behind expand), token usage, system prompt

---

## Component: TimelineHeader

### Layout

A horizontal row with wrapped elements, sitting above the timeline body. Separated from the timeline by 24px of space.

**Elements (left to right, wrapping):**
- Back button: Phosphor `ArrowLeft` (14px) + "Back to ticks" text
- Tick number: `#123` in mono font
- Trigger badge: color-coded pill
- Session state badge: "cold" or "warm" pill
- Duration: total tick duration in mono font (e.g., `4.2s`)
- Timestamp: absolute date/time, right-aligned or wrapping to next line

### Content

**Back button:**
- Text: "Back to ticks"
- Font: Outfit, 14px, Regular
- Color: `text.secondary`, hover: `text.primary`
- Icon: Phosphor `ArrowLeft`, 14px
- Transition: color 150ms ease-out
- Click: returns to TickList view
- Margin-bottom: 16px (separated from the metadata row)

**Tick number:**
- Font: JetBrains Mono, 18px, Semibold
- Color: `text.primary`

**Trigger badge:**
- Font: Outfit, 12px, Medium
- Border-radius: 6px
- Padding: 2px 8px
- Colors per trigger type (border at 20% opacity, background at 7% opacity):
  - `message`: accent color (`#1A1816` light / `#FAF9F4` dark)
  - `interval`: `text.hint`
  - `scheduled_task`: `warning.main`
  - `agent_complete`: `success.main`

**Session state badge:**
- Same dimensions as trigger badge
- Colors:
  - `cold`: `#5B8DEF` (cool blue — fresh session)
  - `warm`: `#E8A838` (warm amber — reused session)

**Duration:**
- Font: JetBrains Mono, 14px, Regular
- Color: `text.secondary`
- Only shown if `durationMs` is non-null

**Timestamp:**
- Font: Outfit, 13px, Regular
- Color: `text.disabled`
- Format: locale date/time string (e.g., "Feb 14, 2026, 3:42:17 PM")

### Spacing

- Back button row: margin-bottom 16px
- Metadata row: gap 8px between elements, flex-wrap enabled
- Below header: margin-bottom 24px before the timeline body

---

## Component: TimelineBody

### The Timeline Line

A thin vertical line running down the left side of the event list. It connects the dots of each event row.

- Position: absolute, left 72px from the content edge
- Width: 1px
- Color: `border.default` (10% opacity neutral)
- Extends from the center of the first event dot to the center of the last event dot (before the completion card)
- The line does NOT extend through the completion card — it terminates before it, signaling that the tick_output is the culmination

### Event Category Color Palette

Each event type belongs to a category with a specific color. These colors are used for the timeline dot, the event type icon, and subtle accents in the expanded detail.

| Category | Events | Light Mode | Dark Mode |
|----------|--------|------------|-----------|
| **Session** | `session_start`, `session_end` | `rgba(26, 24, 22, 0.40)` | `rgba(250, 249, 244, 0.40)` |
| **Input** | `input_received`, `tick_input` | accent color | accent color |
| **Thinking** | `thinking_start`, `thinking_end` | `#8B7EC8` | `#A194D9` |
| **Tool** | `tool_call_start`, `tool_call_end`, `tool_error` | `#C4943A` | `#D4A94E` |
| **Response** | `response_start`, `response_end` | `#4A9B6E` | `#5DB87E` |
| **Error** | `error` | `#C75050` | `#D96060` |
| **Complete** | `tick_output` | accent color | accent color |

These are intentionally muted and warm. Not saturated primaries. They harmonize with the warm neutral palette and never feel like traffic lights.

---

## Component: TimelineEventRow

Each event in the timeline is a single row. The row has a collapsed state (default, showing a 1-line preview) and an expanded state (showing the full event payload).

### Layout (Collapsed)

```
| Relative    |  .  | Icon  EventLabel              Preview...          Duration |  v  |
| Timestamp   |     |                                                            |     |
|  (right-    | dot |       (category-colored)        (truncated 1-line)  (badge) |caret|
|   aligned)  |     |                                                            |     |
```

**Relative Timestamp Column (left, 60px width):**
- Position: to the left of the timeline line
- Alignment: right-aligned, so values sit close to the line
- Font: JetBrains Mono, 11px, Regular
- Color: `text.hint`
- Format: `+0.0s`, `+1.2s`, `+12.4s` — relative to the first event in the timeline
- For events at `+0.0s`, display just `0s`

**Timeline Dot:**
- Position: centered on the timeline line (left 72px)
- Size: 8px diameter circle
- Fill: category color (see palette above)
- Border: none
- For error events: the dot is 10px and uses a filled circle with a slightly brighter hue

**Event Content Area (right of dot, flex: 1):**
- Starts 12px to the right of the dot (left margin: 84px from content edge)
- Contains: icon, label, preview, duration badge, expand caret
- Single line, overflow hidden with text-overflow ellipsis

**Icon:**
- Phosphor icon, 14px, Regular weight
- Color: category color
- Icons per event type:
  - `session_start`: `Play`
  - `session_end`: `Stop`
  - `input_received`: `ArrowFatLineDown`
  - `tick_input`: `ArrowFatLineDown`
  - `thinking_start`: `Brain`
  - `thinking_end`: `Brain`
  - `tool_call_start`: `Wrench`
  - `tool_call_end`: `Wrench`
  - `tool_error`: `WarningCircle`
  - `response_start`: `ChatText`
  - `response_end`: `ChatText`
  - `error`: `XCircle`
  - `tick_output`: `CheckCircle`

**Event Label:**
- Font: Outfit, 13px, Medium
- Color: `text.primary`
- Text: human-readable label derived from event type:
  - `session_start` -> "Session Started"
  - `session_end` -> "Session Ended"
  - `input_received` -> "Input Received"
  - `tick_input` -> "Tick Input"
  - `thinking_start` -> "Thinking..."
  - `thinking_end` -> "Thinking Complete"
  - `tool_call_start` -> "Tool Call"
  - `tool_call_end` -> "Tool Complete"
  - `tool_error` -> "Tool Error"
  - `response_start` -> "Response Started"
  - `response_end` -> "Response Complete"
  - `error` -> "Error"
  - `tick_output` -> "Tick Complete"
- Spacing: 6px gap after icon

**Inline Preview:**
- Font: Outfit, 13px, Regular
- Color: `text.secondary`
- Truncated with ellipsis, single line
- Spacing: 8px gap after event label
- Flex: 1 (takes remaining space)
- Content varies by event type (see [Preview Content](#preview-content) section)

**Duration Badge (conditional):**
- Shown only on `_end` events that have a paired `_start` (thinking_end, tool_call_end, session_end) and tick_output
- Font: JetBrains Mono, 11px, Regular
- Padding: 1px 6px
- Border-radius: 6px
- Background and text color based on duration:
  - < 200ms: `success.main` at 12% opacity background, `success.main` text
  - 200ms - 1000ms: `warning.main` at 12% opacity background, `warning.main` text
  - > 1000ms: `error.main` at 12% opacity background, `error.main` text
- Content: formatted duration (e.g., `142ms`, `1.2s`, `4.8s`)
- Hover: tooltip showing exact millisecond value (e.g., "1,247ms")

**Expand Caret:**
- Phosphor `CaretDown` (12px) when collapsed, `CaretUp` when expanded
- Color: `text.hint`
- Transition: 150ms ease-out rotation (rotates 180deg on expand)
- Only shown when the event has expandable detail data

### Layout (Expanded)

When the user clicks an event row, the detail panel expands below the preview line.

**Expand animation:**
- The row grows vertically, pushing subsequent rows down
- Duration: 200ms, ease-out
- The detail content fades in with a slight vertical translate (from +8px to 0, 200ms ease-out, 50ms delay after height animation begins)

**Detail panel:**
- Background: `background.paper` (translucent card surface)
- Border-radius: 8px
- Padding: 12px 16px
- Margin: 8px 0 8px 84px (aligned with the event content area, not the timestamp)
- Border: 1px solid `border.light`

**Detail content varies by event type** (see [Expanded Detail Content](#expanded-detail-content) section). All detail content uses:
- Labels: Outfit, 11px, Medium, `text.hint`, uppercase, letter-spacing 0.04em
- Values: Outfit, 13px, Regular, `text.primary`
- Code/data values: JetBrains Mono, 12px, Regular
- JSON payloads: JetBrains Mono, 12px, wrapped in a scrollable pre block (max-height 300px, subtle border, `background.elevated`)

### Row Interaction

- **Hover:** Entire row gets a subtle background shift — `background.elevated` at 50% opacity. Transition: 100ms ease-out.
- **Click:** Toggles expanded/collapsed state. Only the row area is clickable, not the detail panel itself.
- **Keyboard:** Tab to focus rows, Enter/Space to expand/collapse. Escape collapses the currently expanded row.
- **Only one row expanded at a time** (optional — could also allow multiple). Recommendation: allow multiple, since the user may want to compare events. Expanding a new row does NOT collapse others.

### Row Spacing

- Gap between rows: 4px (tight, to keep the timeline feeling connected)
- The row itself has: padding 8px vertical, making the total visual gap ~12px between content lines

---

## Preview Content

What appears as the truncated 1-line preview for each event type.

| Event Type | Preview Content | Example |
|------------|----------------|---------|
| `session_start` | Provider + model name from `data.provider` and `data.model` | "claude / claude-sonnet-4-20250514" |
| `session_end` | Reason from `data.reason` + total duration | "completed - 4.2s total" |
| `input_received` | First 80 chars of `data.content` or `data.text` | "What's the weather like today in..." |
| `tick_input` | Trigger type + session state from `data.triggerType` and `data.sessionState` | "message trigger - warm session" |
| `thinking_start` | (no preview — just the label) | |
| `thinking_end` | First 80 chars of thinking content from `data.content` | "The user is asking about weather, I should..." |
| `tool_call_start` | Tool name + first argument key from `data.toolName` and `data.input` | "read_memory - query: 'user preferences'" |
| `tool_call_end` | Tool name + status from `data.toolName` | "read_memory - success" |
| `tool_error` | Tool name + error message preview from `data.toolName` and `data.error` | "send_message - Connection refused" |
| `response_start` | (no preview — just the label) | |
| `response_end` | First 80 chars of response + finish reason from `data.content` and `data.finishReason` | "I'd be happy to help with that! Let me..." |
| `error` | Error code + message from `data.code` and `data.message` | "VALIDATION_ERROR - MindOutput schema..." |
| `tick_output` | Duration of the full tick | "completed in 4.2s" |

---

## Expanded Detail Content

What appears in the detail panel when an event row is expanded.

### session_start

| Field | Label | Value |
|-------|-------|-------|
| Provider | PROVIDER | `data.provider` |
| Model | MODEL | `data.model` |
| Session ID | SESSION | `data.sessionId` (mono font, truncated with copy button) |

### session_end

| Field | Label | Value |
|-------|-------|-------|
| Reason | REASON | `data.reason` |
| Duration | DURATION | Formatted from `data.durationMs` |
| Final Status | STATUS | `data.status` with semantic color |

### input_received

Full input text displayed in a scrollable pre block.

### tick_input

| Field | Label | Value |
|-------|-------|-------|
| Tick Number | TICK | `data.tickNumber` (mono) |
| Trigger Type | TRIGGER | `data.triggerType` with trigger badge |
| Session State | SESSION | `data.sessionState` with session badge |
| Token Breakdown | TOKENS | Formatted table of `data.tokenBreakdown` entries |

**Collapsible sub-sections:**
- "System Prompt" — the full system prompt text in a scrollable pre block (collapsed by default)
- "User Message" — the full user message/context in a scrollable pre block (collapsed by default)

### thinking_start

No additional detail beyond the label.

### thinking_end

| Field | Label | Value |
|-------|-------|-------|
| Duration | DURATION | Duration badge |
| Content | CONTENT | Full thinking text in serif font (Crimson Pro), since this is inner-life content |

### tool_call_start

| Field | Label | Value |
|-------|-------|-------|
| Tool Name | TOOL | `data.toolName` (semibold) |
| Input | INPUT | JSON payload in scrollable mono pre block |

### tool_call_end

| Field | Label | Value |
|-------|-------|-------|
| Tool Name | TOOL | `data.toolName` (semibold) |
| Duration | DURATION | Duration badge |
| Output | OUTPUT | JSON payload or text in scrollable mono pre block (max-height 200px) |

### tool_error

| Field | Label | Value |
|-------|-------|-------|
| Tool Name | TOOL | `data.toolName` (semibold) |
| Error | ERROR | Error message in `error.main` color |
| Stack | STACK | If available, in collapsible mono pre block |

### response_start

No additional detail beyond the label.

### response_end

| Field | Label | Value |
|-------|-------|-------|
| Finish Reason | REASON | `data.finishReason` |
| Content | RESPONSE | Full response text (could be long — scrollable container, max-height 400px) |

### error

| Field | Label | Value |
|-------|-------|-------|
| Code | CODE | `data.code` in mono font |
| Message | MESSAGE | `data.message` in `error.main` color |
| Details | DETAILS | If available, JSON in collapsible pre block |

### tick_output

This event type does NOT use the standard detail panel. Instead, it uses the TickCompletionCard (see below).

---

## Component: TickCompletionCard

The `tick_output` event is the culmination of the tick. It is displayed as a distinct, expanded card below the timeline — visually separated from the regular event rows. It is always expanded by default and cannot be collapsed.

### Visual Treatment

- **Background:** `background.paper` with rim-lighting gradient border (consistent with the design system card treatment)
- **Border-radius:** 12px
- **Padding:** 20px 24px
- **Margin-top:** 24px from the last timeline event row
- **Margin-left:** 0 (full width of the content column — unlike event detail panels, this card spans the full width because it is the main destination, not a subordinate detail)

A subtle label appears above the card:
- Text: "Tick Output"
- Font: Outfit, 11px, Medium, `text.hint`, uppercase, letter-spacing 0.05em
- Margin-bottom: 8px

### Sections Within the Card

Each section within the card is separated by 20px vertical spacing.

#### Thought Section

- **Label:** "THOUGHT" — 11px, Medium, `text.hint`, uppercase, letter-spacing 0.04em
- **Content:** Each thought rendered as:
  - Text: Crimson Pro (serif), 15px, Regular, `text.primary`
  - Importance: shown as a small inline badge after the text if importance > 0.7 — Phosphor `Star` icon (12px) + the value in mono 11px `text.hint`
  - If importance <= 0.7: just show the value in mono 11px `text.hint` without the star
- Multiple thoughts separated by 12px

#### Experience Section

- **Label:** "EXPERIENCE" — same treatment as Thought label
- **Content:** Each experience rendered as:
  - Text: Crimson Pro (serif), 15px, Regular italic, `text.primary`
  - Subtle left border: 2px, accent color at 20% opacity, padding-left 12px
  - Importance: same treatment as thoughts
- Multiple experiences separated by 12px

#### Reply Section (conditional — only if a reply was produced)

- **Label:** "REPLY" — same treatment
- **Content:**
  - Reply text: Outfit, 14px, Regular, `text.primary`
  - Below the text, a row of metadata:
    - Channel badge (same style as trigger badge, using `text.hint` color)
    - Contact ID in mono 11px `text.hint` (if present)
- **Left border:** 2px solid accent color at 30% opacity (stronger than experience, signaling this is outward-facing)

#### Emotion Deltas Section

- **Label:** "EMOTIONS" — same treatment
- **Layout:** A compact grid, 2 columns on desktop, 1 column on mobile
- **Each delta entry:**
  - Emotion name: Outfit, 13px, Medium, `text.primary`
  - Delta value: JetBrains Mono, 13px, Regular
    - Positive: `success.main` color, prefixed with `+`
    - Negative: `error.main` color (already has `-`)
    - Zero: `text.hint` color
  - Arrow indicator between before/after values: `intensityBefore` -> `intensityAfter` in mono 11px `text.hint`
  - Reasoning: Outfit, 12px, Regular, `text.secondary`, on a new line below the delta, truncated to 1 line with "..." (expandable on click to show full text)
- Grid gap: 12px vertical, 24px horizontal

#### Decisions Section

- **Label:** "DECISIONS" — same treatment
- **Each decision:**
  - Type badge: same badge component used throughout (color based on outcome: executed = `success.main`, dropped = `warning.main`, failed = `error.main`)
  - Description: Outfit, 13px, Regular, `text.primary`
  - Outcome badge: small text label `[executed]` / `[dropped]` / `[failed]` in the semantic color, mono 11px
  - If outcome is "dropped" or "failed": `outcomeDetail` text shown on next line in 12px `text.secondary`
  - If decision type is `spawn_agent`: the description becomes a link styled in accent color, navigating to `/mind/agents/:agentId` (extracted from `parameters.taskId` or similar). Phosphor `ArrowSquareOut` icon (12px) appended.
- Decisions separated by 12px

#### Token Usage Section

- **Label:** "TOKENS" — same treatment
- **Layout:** Horizontal row of stat pairs, wrapping on mobile
- **Stat pairs:**
  - "Input" — value in mono (e.g., `12,483`)
  - "Output" — value in mono (e.g., `1,247`)
  - "Total" — value in mono, slightly bolder (e.g., `13,730`)
  - "Cost" — value in mono (e.g., `$0.0412`) — only shown if costUsd is non-null
- Font: Labels in 11px `text.hint` uppercase; values in JetBrains Mono 13px `text.primary`
- Gap: 24px between stat pairs

---

## States

### Loading State

When the timeline data is being fetched:

- The header area shows a skeleton shimmer for the tick number and badges (3 rectangles, 16px height, rounded, staggered widths)
- The timeline body shows 6 skeleton rows:
  - Each row: a small circle (8px) on the left, a rectangle bar (60% width, 14px height) to the right
  - Rows are spaced identically to real event rows
  - Skeleton uses a subtle shimmer animation: a horizontal gradient sweep moving left to right, 1.5s duration, infinite, ease-in-out
  - Shimmer color: in light mode, the bar shifts between `rgba(0,0,0,0.04)` and `rgba(0,0,0,0.08)`. In dark mode, `rgba(255,255,255,0.03)` and `rgba(255,255,255,0.07)`.

This shimmer is a "breathing" treatment rather than a harsh loading spinner — consistent with the brand's "breathing over blinking" principle.

### Empty State

If the tick number is not found (getTickTimeline returns null):

- Back button remains visible
- Centered content:
  - Text: "Tick #[number] not found"
  - Font: Crimson Pro, 16px, Regular italic, `text.hint`
  - Below: "This tick may have been cleaned up, or it hasn't completed yet."
  - Font: Outfit, 14px, Regular, `text.secondary`

### Error State

If the API call fails:

- Back button remains visible
- Centered content:
  - Phosphor `WarningCircle` icon, 32px, `text.hint`
  - Text: "Something went wrong loading this tick."
  - Font: Outfit, 14px, Regular, `text.secondary`
  - Retry button: Secondary button style (text + subtle border), "Try again"
  - Click: re-fetches the timeline data

### Partial State / Live Tick (no tick_output yet)

If the tick is still in progress (tick_input exists but tick_output does not), the timeline operates in **live streaming mode**:

- The timeline shows whatever events have been logged so far (loaded via initial query)
- A tRPC subscription (`heartbeat.onAgentEvent`) streams new events in real-time
- Each new event animates in at the bottom of the timeline individually (not stagger — see [Live Event Animation](#live-event-animation))
- The timeline line extends downward as new events arrive
- Instead of the TickCompletionCard, a gentle breathing indicator appears at the bottom:
  - A small dot pulsing in accent color (opacity oscillating 0.3 to 0.8, 2000ms cycle)
  - Text: "Tick in progress..." in 13px, Crimson Pro italic, `text.hint`
  - This indicates that more events may arrive
- When a `tick_output` event arrives via the subscription:
  - The breathing indicator fades out (150ms)
  - The TickCompletionCard animates in (same settling animation as initial load: translateY +16px to 0, opacity 0 to 1, 300ms ease-out)
  - The timeline transitions from "live" to "complete" — subscription can be cleaned up

**Auto-scroll behavior:**
- When in live mode and the user has NOT scrolled up manually, the view auto-scrolls to keep the latest event visible
- If the user scrolls up to inspect earlier events, auto-scroll pauses
- A small "Jump to latest" pill appears at the bottom-right when auto-scroll is paused (Outfit 12px, accent background, click to resume auto-scroll)

---

## Responsive Behavior

### Desktop (> 1024px)

Full layout as described. Content column at 640px max-width (matching existing MindPage constraint). Timestamp column at 60px. Timeline dot at 72px. Event content starts at 84px.

The emotion delta grid shows 2 columns. Token usage stats display horizontally in a single row.

### Tablet (768-1024px)

Same layout, slightly tighter. The content column may shrink toward 560px. No structural changes.

### Mobile (< 768px)

**Structural changes:**
- Timestamp column narrows to 44px. Timestamps abbreviate further (e.g., `+1s` instead of `+1.2s`)
- Timeline dot position shifts to 52px
- Event content starts at 64px
- Preview text gets more truncation (max 60 chars instead of 80)
- Duration badge still shown but may wrap below the preview text

**TickCompletionCard:**
- Padding reduces to 16px
- Emotion delta grid becomes 1 column
- Token usage stats stack vertically (2 per row)
- Decision entries may wrap more aggressively

**Event detail panels:**
- Margin-left reduces to 64px (aligned with mobile event content)
- Padding reduces to 10px 12px
- Scrollable pre blocks get max-height 200px instead of 300px

**General:**
- The back button and header stack vertically rather than wrapping in a single row

---

## Animations and Transitions

### Page Enter

When transitioning from TickList to AgentTimeline:
- Existing TickList fades out and slides left (matching the current `motion.div` exit animation in HeartbeatsSection)
- AgentTimeline fades in with a slight rightward slide (from x: 12 to x: 0, opacity 0 to 1, 150ms ease-out)

### Event Row Hover

- Background color shift to `background.elevated` at 50% opacity
- Duration: 100ms ease-out
- No scale change (keep the timeline feeling stable)

### Event Row Expand

- Row height expands to accommodate the detail panel
- Duration: 200ms ease-out for height change
- Detail content: fade in from opacity 0 to 1 with translateY from +8px to 0
- Duration: 200ms ease-out, 50ms delay
- The expand caret rotates 180 degrees (150ms ease-out)

### Event Row Collapse

- Detail content fades out (100ms ease-in)
- Row height shrinks (200ms ease-out, 50ms delay after content fade begins)
- Caret rotates back (150ms ease-out)

### Timeline Dots

On page load, the timeline dots appear sequentially with a brief stagger:
- Each dot scales from 0 to 1 (with a slight overshoot — `scale(0) -> scale(1.2) -> scale(1)`)
- Duration: 200ms per dot, with 30ms stagger between consecutive dots
- This creates a subtle "filling in" effect down the timeline, like events appearing one by one
- The effect only plays on initial load, not on re-renders

### Duration Badge

On hover, if a tooltip is shown:
- Tooltip fades in from opacity 0 to 1 with a slight vertical shift (translateY from -4px to 0)
- Duration: 150ms ease-out
- Tooltip position: centered above the badge, with a 4px gap

### TickCompletionCard

On page load (after the stagger animation for dots completes):
- The card fades in with a slight upward drift (translateY from +16px to 0, opacity 0 to 1)
- Duration: 300ms ease-out
- This is the slowest animation on the page — it should feel like something settling into place, the culmination arriving

### Live Event Animation

When events arrive via real-time subscription (tick in progress):
- Each new event slides in from the bottom (translateY from +12px to 0, opacity 0 to 1)
- Duration: 200ms ease-out
- The timeline dot appears with the same scale overshoot as initial load (scale 0 → 1.2 → 1), but individually, not staggered
- The timeline line extends smoothly to connect to the new dot (height transition, 200ms ease-out)
- If multiple events arrive in quick succession (< 100ms apart), they animate in with a natural 50ms stagger between them to avoid visual overload

---

## Typography Summary

| Element | Font | Size | Weight | Color |
|---------|------|------|--------|-------|
| Tick number (header) | JetBrains Mono | 18px | Semibold | `text.primary` |
| Trigger/session badge | Outfit | 12px | Medium | (per badge color) |
| Duration (header) | JetBrains Mono | 14px | Regular | `text.secondary` |
| Timestamp (header) | Outfit | 13px | Regular | `text.disabled` |
| Relative timestamp | JetBrains Mono | 11px | Regular | `text.hint` |
| Event label | Outfit | 13px | Medium | `text.primary` |
| Event preview | Outfit | 13px | Regular | `text.secondary` |
| Duration badge | JetBrains Mono | 11px | Regular | (per duration color) |
| Detail field labels | Outfit | 11px | Medium | `text.hint` |
| Detail field values | Outfit | 13px | Regular | `text.primary` |
| Code/JSON values | JetBrains Mono | 12px | Regular | `text.primary` |
| Thought text | Crimson Pro | 15px | Regular | `text.primary` |
| Experience text | Crimson Pro | 15px | Regular italic | `text.primary` |
| Reply text | Outfit | 14px | Regular | `text.primary` |
| Section labels (card) | Outfit | 11px | Medium | `text.hint` |
| Emotion name | Outfit | 13px | Medium | `text.primary` |
| Emotion delta value | JetBrains Mono | 13px | Regular | (per delta sign) |
| Emotion reasoning | Outfit | 12px | Regular | `text.secondary` |
| Decision description | Outfit | 13px | Regular | `text.primary` |
| Token values | JetBrains Mono | 13px | Regular | `text.primary` |
| Token labels | Outfit | 11px | Medium | `text.hint` |
| Back button text | Outfit | 14px | Regular | `text.secondary` |

---

## Color Reference (Complete)

### Event Category Dot & Icon Colors

| Category | Light Mode | Dark Mode |
|----------|-----------|-----------|
| Session | `rgba(26, 24, 22, 0.40)` | `rgba(250, 249, 244, 0.40)` |
| Input | `#1A1816` | `#FAF9F4` |
| Thinking | `#8B7EC8` | `#A194D9` |
| Tool | `#C4943A` | `#D4A94E` |
| Response | `#4A9B6E` | `#5DB87E` |
| Error | `#C75050` | `#D96060` |
| Complete | `#1A1816` | `#FAF9F4` |

### Duration Badge Colors

| Range | Background | Text |
|-------|-----------|------|
| < 200ms | `success.main` at 12% opacity | `success.main` |
| 200ms - 1000ms | `warning.main` at 12% opacity | `warning.main` |
| > 1000ms | `error.main` at 12% opacity | `error.main` |

### Trigger Badge Colors

Inherited from existing HeartbeatsSection implementation:

| Trigger | Color |
|---------|-------|
| message | accent |
| interval | `text.hint` |
| scheduled_task | `warning.main` |
| agent_complete | `success.main` |

### Session State Badge Colors

| State | Color |
|-------|-------|
| cold | `#5B8DEF` |
| warm | `#E8A838` |

---

## Keyboard Navigation

| Key | Action | Scope |
|-----|--------|-------|
| `Escape` | Return to tick list (equivalent to back button) | Timeline view |
| `Tab` | Move focus between event rows | Timeline body |
| `Enter` / `Space` | Expand/collapse focused event row | Focused event row |
| `Escape` (when row expanded) | Collapse the focused expanded row | Expanded event row |

---

## Implementation Notes

### Existing Code to Replace

The `TickDetail` component inside `/packages/frontend/src/components/mind/HeartbeatsSection.tsx` (lines 296-528) is replaced entirely by the new `AgentTimeline` component. The `HeartbeatsSection` wrapper, `TickList`, `BackButton`, `Badge`, and helper functions (`formatRelativeTime`, `formatDuration`) can be reused.

### New Files

- `packages/frontend/src/components/mind/AgentTimeline.tsx` — The main timeline component and all sub-components
- No new Zustand store needed — timeline data is fetched per-view via tRPC query + local subscription state

### Backend Changes

#### 1. EventBus — New Event Type

Add `agent:event:logged` to `AnimusEventMap` in `packages/shared/src/event-bus.ts`:

```typescript
'agent:event:logged': {
  id: string;
  sessionId: string;
  eventType: AgentEventType;
  data: Record<string, unknown>;
  createdAt: string;
}
```

#### 2. Agent Log Adapter — Emit on Insert

Modify `createAgentLogStoreAdapter` in `packages/backend/src/heartbeat/agent-log-adapter.ts` to emit `agent:event:logged` on the EventBus after every `insertEvent()` call. This bridges the agents package (DB-agnostic) to the real-time system.

#### 3. tRPC — New Query + Subscription

- **Query**: `heartbeat.getTickTimeline({ tickNumber })` — Returns all existing events for a tick's session, plus tick results (thoughts, experiences, emotions, decisions, usage)
- **Subscription**: `heartbeat.onAgentEvent` — Streams all `agent:event:logged` events in real-time. Frontend filters by session ID locally.

#### 4. Agent Log Store — New Function

`getTimelineForTick(db, tickNumber)` — Finds the tick_input event, gets its session_id, returns all events for that session (excluding response_chunk), with `relativeMs` computed from the first event's timestamp.

### Data Flow

**Initial load (completed ticks):**
```
User clicks tick row in TickList
  → HeartbeatsSection switches to AgentTimeline view
  → AgentTimeline calls trpc.heartbeat.getTickTimeline({ tickNumber })
    → Backend queries:
         1. agent_events WHERE session_id = (session from tick_input for this tick)
            AND event_type != 'response_chunk'
            ORDER BY created_at
         2. heartbeat.db: thoughts, experiences, emotion_history, tick_decisions
            WHERE tick_number = ?
         3. agent_usage WHERE session_id = ?
    → Computes relativeMs for each event (relative to first event timestamp)
    → Returns TickTimeline response
  → AgentTimeline renders the timeline with stagger animation
```

**Real-time streaming (in-progress ticks):**
```
AgentTimeline mounts with a tick that has no tick_output
  → Initial query loads existing events
  → Component subscribes to trpc.heartbeat.onAgentEvent
  → Backend: agent-log-adapter.insertEvent() fires
    → Writes to agent_logs.db
    → Emits eventBus.emit('agent:event:logged', event)
  → tRPC subscription pushes event to frontend
  → AgentTimeline filters: does event.sessionId match this tick's session?
    → Yes: append to local events array, animate in
    → No: ignore
  → When tick_output event arrives:
    → Breathing indicator → TickCompletionCard transition
    → Subscription can be cleaned up (tick is complete)
```

---

## References

- `docs/frontend/design-principles.md` — Cards, rim lighting, animation timing, typography
- `docs/frontend/mind.md` — Mind space structure, sub-navigation, data sources
- `docs/frontend/app-shell.md` — Click-deeper pattern, back navigation
- `docs/architecture/heartbeat.md` — Tick pipeline, MindOutput schema, event logging
- `docs/architecture/agent-orchestration.md` — Sub-agent lifecycle, result delivery
- `docs/brand-vision.md` — Warmth, alive quality, breathing over blinking
- `packages/shared/src/schemas/agent-logs.ts` — AgentEventType enum (14 event types)
- `packages/backend/src/db/stores/agent-log-store.ts` — Existing data access layer
- `packages/frontend/src/components/mind/HeartbeatsSection.tsx` — Current implementation to replace
