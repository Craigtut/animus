# Mind

The deeper observation layer. Where Presence gives you the feeling of the being's state, Mind gives you the detail. This is where you see the full emotional breakdown, read the complete thought history, browse accumulated memories, inspect goal strategies, and observe sub-agent activity. Mind is contemplative and transparent -- a window into the inner workings of a living system.

## Design Philosophy

Mind is what you arrive at when you lean in from Presence. You clicked the emotional field because you wanted to know what the being is actually feeling. You clicked a goal because you wanted to see the plan. Mind rewards that curiosity with depth and clarity.

**Guiding Principles:**
- **Depth, not breadth** -- Each section goes deep into one concern. No overview dashboards.
- **Labels and numbers are welcome here** -- Unlike Presence (which communicates through color and motion), Mind is where text, charts, and explicit data appear. The user came here for specifics.
- **Still warm, still alive** -- Mind is not a developer console. It uses the same warm palette, rim-lit cards, and organic animation. But the information density is higher and the layout is more structured.
- **Always navigable** -- The user can always get back to Presence, and can always move between Mind sections.

---

## Structure: Sectioned Space with Sub-Navigation

Mind is organized into five sections. Each section is a distinct view with its own content and layout. The user navigates between them via a minimal sub-navigation element at the top of the Mind space, below the main navigation pill.

### Sub-Navigation

**Visual treatment:** A horizontal row of text labels, left-aligned within the content column. No background, no container -- just text. This is not a tab bar; it is a set of section links.

**Labels:** Emotions, Thoughts, Memories, Goals, Agents

**Active section:** Semibold weight, primary text color, with a subtle underline (2px, warm accent, offset 4px below the text). The underline animates horizontally when switching sections (250ms ease-in-out).

**Inactive sections:** Regular weight, secondary text color (0.55 opacity). On hover: 0.75 opacity (100ms ease-out).

**Layout:** Horizontal, left-aligned, with 24px between labels. On mobile, the labels scroll horizontally if they exceed the viewport width.

**Content column:** Max-width 840px (slightly wider than Presence to accommodate data-rich content). Centered with generous margins.

### Direct Landing

When the user clicks deeper from Presence, they land directly on the relevant section. Clicking the emotional field lands on Emotions. Clicking a thought lands on Thoughts with that thought highlighted. Clicking a goal lands on Goals with that goal expanded. The sub-navigation reflects the active section.

When the user navigates to `/mind` directly (via the navigation pill), they land on the Emotions section by default.

---

## Section: Emotions

**Route:** `/mind/emotions`

### Purpose

The full breakdown of the being's emotional state. Where Presence communicates emotion through color and motion, this section names every emotion, shows its intensity, traces its history, and explains what is driving it.

### Layout

**The emotional field persists at the top** but at a reduced height (15vh, minimum 120px). It serves as a visual header that connects this detailed view to what the user saw in Presence. It is annotated here -- see below.

**Below the field:** A two-column grid of emotion cards (on desktop; stacks to one column on mobile). Each card represents one of the 12 emotions.

### Annotated Emotional Field

In this view, subtle text labels appear within the emotional field, positioned near their corresponding color regions. Each label shows the emotion name in small text (11px, Semibold, slightly more opaque than the surrounding field). The labels fade in and out as the orbs drift, maintaining association with their colors without being pinned to exact positions. This is the only place where the emotional field is labeled.

### Emotion Cards

Each card is a rim-lit container (consistent with the design system) displaying:

**Header row:**
- Emotion name (16px Semibold, primary text color)
- Category badge ("Positive" / "Negative" / "Drive") in small text (11px, 0.45 opacity)
- Current intensity as a horizontal bar: a thin warm-toned bar (4px height, rounded) showing intensity as a filled percentage. The fill color matches the emotion's color from the Presence palette. Below the bar, the numeric value is shown in small text (12px, 0.45 opacity): "0.42"

**Baseline indicator:** A small tick mark on the intensity bar showing the personality-derived baseline. If the current intensity is above baseline, the bar fill extends past the tick. If below, the tick mark sits ahead of the fill.

**Sparkline:** A small inline chart (120px wide, 40px tall) showing the emotion's intensity over the last 24 hours. The line uses the emotion's color. The chart has no axis labels -- just the shape of the trajectory. The current value is the rightmost point. Significant events (large deltas) can be shown as small dots on the line.

**Last delta:** The most recent change, shown as a brief text: "+0.05 -- 'The user shared good news about their project'" (12px, secondary text color). This is the `reasoning` field from the most recent `EmotionDelta` for this emotion.

### Card Interaction

Clicking an emotion card expands it to show a detailed history:

**Expanded view (inline, not a new route):**
- A larger chart showing 7-day intensity history with labeled axes
- A list of the last ~10 deltas for this emotion, each with: tick number, delta value, reasoning, timestamp
- The personality baseline value and which dimensions contribute to it

The expansion is animated: the card grows vertically, pushing cards below it down. Duration: 250ms ease-out. Clicking again or clicking another card collapses it.

### Data Sources

- `onEmotionState` subscription for live intensity updates
- `emotion_history` table via tRPC query for sparklines and history
- `emotion_state` table for baselines
- Persona dimensions (from `system.db`) for baseline explanation

---

## Section: Thoughts

**Route:** `/mind/thoughts`

### Purpose

The complete inner monologue. A chronological log of every thought and experience the being has produced, with full timestamps, importance indicators, and the ability to see which tick produced what.

### Layout

A reverse-chronological list (newest first) of thought and experience entries. Each entry is a single card or row.

### Entry Design

Each entry shows:

**Left column (narrow, 48px):**
- A vertical tick indicator: a small dot and a thin vertical line connecting entries from the same tick. Dots are colored by tick trigger type:
  - Interval tick: warm gray
  - Message tick: warm accent
  - Agent complete: warm teal
  - Task tick: warm amber

**Right column (main content):**
- **Content:** The thought or experience text. 15px Regular, primary text color.
- **Type badge:** "Thought" or "Experience" -- a small label (11px, 0.45 opacity) distinguishing the two. Experiences get a slightly different visual treatment: an italic style or a subtle left border (2px, warm accent at 0.2 opacity).
- **Importance:** Shown as a subtle visual indicator -- thoughts with importance > 0.7 have a small Phosphor `Star` icon (12px, warm accent) next to the type badge. Lower importance thoughts have no indicator.
- **Timestamp:** Relative time ("3 min ago", "2 hours ago") in small text (12px, 0.40 opacity), right-aligned.
- **Tick number:** Shown on hover as a tooltip: "Tick #47"

### Filtering

A minimal filter row at the top of the list:

- **Type filter:** "All" | "Thoughts" | "Experiences" -- toggle buttons (small, text-based, no heavy styling)
- **Importance filter:** "All" | "Important only" (importance > 0.7)

Filters apply instantly with a brief fade transition (150ms) on the list.

### Pagination

Entries load in batches of 50, with infinite scroll. A subtle loading indicator (the breathing opacity treatment) appears at the bottom while loading.

### Empty State

If no thoughts or experiences exist (pre-first-tick or after a reset): "No thoughts yet. The mind hasn't started thinking." in centered secondary text.

### Data Sources

- `thoughts` and `experiences` tables via tRPC queries with pagination
- `onThoughts` subscription for real-time new entries (prepended to the list with the same fade-in animation as in Presence)

---

## Section: Memories

**Route:** `/mind/memories`

### Purpose

Browse and search the being's accumulated knowledge -- working memory per contact, core self-knowledge, and long-term memories. This is the library of everything the being has learned.

### Layout

Three sub-sections, presented as expandable regions within a single scrollable view.

### Sub-Section: Core Self

**Header:** "Self-Knowledge" with a Phosphor `UserCircle` icon (20px)

**Content:** The full core self text block, rendered in a warm-toned card with generous padding. The text is displayed in 15px Regular, primary text color. A small label below the text: "Last updated [relative time]" in 12px secondary text.

**If empty:** "The mind hasn't reflected on itself yet. Self-knowledge builds over time." in secondary text.

This sub-section is always expanded by default.

### Sub-Section: Working Memory

**Header:** "Contact Notes" with a Phosphor `Notebook` icon (20px)

**Content:** A list of contacts, each showing their working memory content. Each contact entry is a card:

- Contact name (16px Semibold)
- Tier badge ("Primary" / "Standard") in small text
- The working memory text, truncated to 3 lines with a "Show more" link
- Last updated timestamp

Contacts with empty working memory are listed but show: "No notes yet" in secondary text.

### Sub-Section: Long-Term Memories

**Header:** "Long-Term Memory" with a Phosphor `Database` icon (20px)

**Content:** A searchable list of long-term memory entries.

**Search:** A text input at the top of this sub-section. Placeholder: "Search memories..." Searching performs a semantic search via the backend (embedding the query and searching LanceDB). Results are ranked by the same scoring formula used in GATHER CONTEXT: `0.4 * relevance + 0.3 * importance + 0.3 * recency`.

**Default view (no search):** The most recent 20 memories, sorted by `last_accessed_at` (most recently relevant first).

**Memory entry design:**
- Content text (15px Regular)
- Type badge: "Fact" | "Experience" | "Procedure" | "Outcome" (11px, colored by type: facts in warm gray, experiences in warm teal, procedures in warm amber, outcomes in warm green)
- Importance indicator: a small bar (same treatment as emotion intensity bars) showing the 0-1 importance value
- Strength indicator: a number showing how many times this memory has been accessed (e.g., "Accessed 7 times")
- Contact association: if contact-specific, shows the contact's name
- Timestamps: Created date and last accessed date in 12px secondary text

**Pagination:** Load 20 at a time, infinite scroll.

### Data Sources

- `core_self` table via tRPC query
- `working_memory` table via tRPC query (for all contacts)
- `long_term_memories` table via tRPC query (paginated, searchable)
- LanceDB search via tRPC query (for semantic search)

---

## Section: Goals

**Route:** `/mind/goals`

### Purpose

The full view of the being's goal system. Active goals with their plans, milestones, and tasks. Proposed goals awaiting approval. Seeds that are forming. Historical goals that were completed or abandoned. This is where the user sees and manages the being's agency.

### Layout

A vertical list of goal cards, organized by status. Each status group has a minimal section header.

### Goal Status Groups

**Active Goals** (shown first, always expanded):
- Sorted by salience (highest first)
- Each goal as a full goal card (see below)

**Proposed Goals** (shown if any exist):
- Section header: "Awaiting your input"
- Each goal shows the proposal message and action buttons: "Approve" (primary button) and "Decline" (secondary text link)

**Seeds** (shown if any exist, collapsed by default):
- Section header: "Emerging interests"
- Each seed shows: content, strength (as a progress bar toward the graduation threshold of 0.7), linked emotion, reinforcement count, last reinforced time
- Seeds are not interactive -- they are observational

**Completed / Abandoned** (collapsed by default):
- Section header: "History"
- Compact entries showing title, outcome, and date

### Goal Card (Active Goals)

A rim-lit card showing comprehensive goal information:

**Header:**
- Goal title (18px Semibold)
- Origin badge: "User-directed" | "AI-internal" | "Collaborative" (11px, 0.45 opacity)
- Status badge with semantic color: Active (green), Paused (orange)

**Salience section:**
- Current salience as a horizontal bar (same treatment as emotion bars)
- A sparkline showing salience over the last 7 days
- Linked emotion (if any): name and current intensity

**Plan section:**
- Current plan strategy text (truncated, expandable)
- Milestones as a vertical list:
  - Each milestone shows: title, status (pending / in progress / completed / skipped)
  - Completed milestones have a green check. In-progress milestones pulse gently.
  - Plan version number in small text: "Plan v2"

**Tasks section:**
- Active tasks for this goal, each showing: title, type (scheduled/recurring/deferred), status, next run time (for scheduled)
- Recently completed tasks (last 3)

**Sub-agent activity (if any):**
- Running sub-agents for this goal with: task description, running time, current activity

### Goal Detail Route

**Route:** `/mind/goals/:goalId`

When a user clicks deeper on a specific goal (from Presence or from the goal list), this route shows a single goal card expanded to fill the content area, with additional detail:

- Full salience history chart (30 days) with component breakdown (base priority, emotional resonance, user engagement, progress momentum, urgency, staleness, novelty)
- Complete task history (all tasks ever created for this goal)
- Plan revision history (all plan versions with revision reasons)
- Decision log: all `tick_decisions` entries related to this goal

### Data Sources

- `goals` table via tRPC query
- `goal_seeds` table via tRPC query
- `plans` table via tRPC query
- `tasks` table via tRPC query (filtered by goal)
- `goal_salience_log` table via tRPC query (for sparklines and history)
- `tick_decisions` table via tRPC query (for decision log)
- `onGoals` subscription for live salience updates

---

## Section: Agents

**Route:** `/mind/agents`

### Purpose

Observe what the being is doing right now and what it has done recently. Running sub-agents, completed results, and the decision log that shows every action the mind has taken.

### Layout

Two sub-sections within a single scrollable view.

### Sub-Section: Active Agents

**Header:** "Currently running" with a Phosphor `Lightning` icon (20px)

**Content:** A list of currently running sub-agents. Each agent is a card showing:

- **Task description** (16px Semibold) -- what the agent is working on
- **Status:** "Running" with a green dot pulsing gently (2000ms cycle)
- **Running time:** "Started 12 minutes ago" in secondary text
- **Current activity** (if the agent has reported progress): most recent activity text
- **Associated goal** (if any): goal title as a link (clicking navigates to the goal detail)
- **Provider:** "Claude" / "Codex" / "OpenCode" in small text (11px)

If no agents are running: "Nothing running right now." in centered secondary text.

### Sub-Section: Recent Activity

**Header:** "Recent" with a Phosphor `ClockCounterClockwise` icon (20px)

**Content:** A reverse-chronological list of recently completed agents and significant mind decisions.

**Completed agent entries:**
- Task description
- Outcome: "Completed" (green) / "Failed" (red) / "Cancelled" (orange)
- Duration: "Ran for 8 minutes"
- Result summary: truncated, expandable
- Timestamp

**Decision log entries:**
- Decision type (spawn_agent, update_goal, schedule_task, etc.)
- Description (the mind's reasoning)
- Outcome: "Executed" (green) / "Dropped" (orange, with reason) / "Failed" (red)
- Tick number and timestamp

The two types are interspersed chronologically, distinguished by subtle visual treatment:
- Agent entries have a Phosphor `Robot` icon (14px) prefix
- Decision entries have a Phosphor `TreeStructure` icon (14px) prefix

### Agent Detail Route

**Route:** `/mind/agents/:agentId`

Shows full detail for a single agent:

- Complete task description and instructions
- Full result text (for completed agents)
- Event log: the sequence of agent events from `agent_logs.db` (session start, thinking events, tool calls, responses)
- Token usage and cost (from agent_logs)
- Timeline visualization: a vertical timeline showing key events with timestamps

### Data Sources

- `agent_tasks` table via tRPC query
- `agent_events` table via tRPC query (from `agent_logs.db`)
- `tick_decisions` table via tRPC query
- `onAgentStatus` subscription for live agent updates

---

## Responsive Behavior

### Desktop (>1024px)

Full layout as described. Content column at 840px. Emotion cards in a 2-column grid (6 rows). Thought entries and goal cards at full width.

### Tablet (768-1024px)

Content column at ~680px. Emotion cards stack to a 1-column layout when the viewport is narrow. Sub-navigation labels may use shorter names or scroll horizontally.

### Mobile (<768px)

Content column is full-width with 16px horizontal padding. Emotion cards are always single-column. Sparklines and charts reduce in width proportionally. The sub-navigation scrolls horizontally with the active section's underline remaining visible. Cards reduce their internal padding to 12-16px.

Goal cards and agent cards may collapse non-essential information (sparklines, detailed timestamps) behind a "More" toggle to save vertical space.

---

## State Management

### Zustand Store: Mind State

```typescript
interface MindState {
  // Active section
  activeSection: 'emotions' | 'thoughts' | 'memories' | 'goals' | 'agents';

  // Emotions
  emotionHistory: Record<EmotionName, Array<{
    timestamp: string;
    intensity: number;
    delta: number;
    reasoning: string;
  }>>;

  // Goals (detailed, beyond what Presence needs)
  goals: Goal[];
  seeds: Seed[];
  selectedGoalId: string | null;

  // Agents
  activeAgents: AgentTask[];
  recentDecisions: TickDecision[];

  // Memories
  coreSelf: { content: string; updatedAt: string } | null;
  workingMemories: Array<{ contactId: string; contactName: string; content: string; updatedAt: string }>;
  memorySearchQuery: string;
  memorySearchResults: LongTermMemory[];
}
```

---

## References

- `docs/frontend/app-shell.md` -- Navigation, click-deeper transitions, sub-navigation patterns
- `docs/frontend/presence.md` -- The source view that users click deeper from
- `docs/architecture/heartbeat.md` -- Emotion engine, thoughts, experiences, tick pipeline
- `docs/architecture/goals.md` -- Goals, seeds, plans, salience, cleanup
- `docs/architecture/tasks-system.md` -- Tasks, scheduling, task runs
- `docs/architecture/agent-orchestration.md` -- Sub-agent lifecycle, status, event logging
- `docs/architecture/memory.md` -- Four memory layers, retrieval, consolidation
- `docs/frontend/design-principles.md` -- Cards, rim lighting, animation timing
- `docs/brand-vision.md` -- Warm, sophisticated, never clinical
