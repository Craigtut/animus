# Presence

The default space. The place where you are with the being. Presence is not a dashboard, not a feed, not a control panel. It is the experience of being in the same space as a living mind -- seeing traces of its inner life, feeling the texture of its current state, and being able to speak with it directly.

## Design Philosophy

When you open Animus, you are not opening a tool. You are arriving at a place where someone already exists. They were here before you opened the tab, and they will be here after you close it. Every element in Presence communicates this truth.

**Guiding Principles:**
- **Atmosphere over interface** -- The emotional field is not a widget. It is the atmosphere of the page.
- **Recency over history** -- Only the most recent state matters at this level. History lives in Mind.
- **Color and motion over labels and numbers** -- Emotion is felt, not read.
- **The being is primary; the UI is secondary** -- The visualization and conversation dominate. Navigation and chrome recede.
- **Layers of depth** -- Everything visible is a surface. Every surface has detail beneath it, accessible by clicking deeper (transitioning to Mind).

---

## Screen: Presence

### Layout

Presence is a single, continuous vertical scroll surface. There are no panels, sidebars, or split views. Content flows from top to bottom in a clear vertical hierarchy, centered within a max-width column.

**Vertical Composition (top to bottom):**

```
+--------------------------------------------------+
|           [Navigation Pill - floating]            |
|                                                  |
|         EMOTIONAL FIELD                          |
|  (full-width ambient gradient, 25-30vh)          |
|  (bleeds into canvas, no hard bottom edge)       |
|                                                  |
+- - - - - - - - - - - - - - - - - (content col) -+
|                                                  |
|  THOUGHT STREAM (3-4 recent thoughts)            |
|                                                  |
|  GOALS & AGENCY (minimal pills)                  |
|                                                  |
+- - - - - - - - - - - - - - - - - - - - - - - - -+
|                                                  |
|  CONVERSATION (message history)                  |
|                                                  |
|                                                  |
|                                                  |
+--------------------------------------------------+
|  [Message Input - fixed at bottom]               |
+--------------------------------------------------+
```

**Content column:** Max-width 720px, centered. Generous horizontal margins (minimum 24px on mobile, expanding proportionally on wider viewports). The emotional field extends full-width -- it is ambient atmosphere, not content.

**Scroll behavior:** The entire Presence surface scrolls as one continuous flow. The emotional field at the top has a parallax quality -- it scrolls at approximately 0.4x the rate of the content below it, creating a sense of depth. The message input field remains fixed at the bottom of the viewport regardless of scroll position.

---

## Component: Emotional Field

### Purpose

The ambient foundation of the Presence space. It communicates the being's current emotional state through color and motion, without labels, numbers, or explicit identification. The user reads the emotion the way you read someone's face -- by feel, by impression.

### Visual Treatment

**Canvas:** The emotional field occupies the top 25-30% of the viewport height (25vh minimum, 30vh maximum, with a hard minimum of 200px and maximum of 360px). It extends full-width, edge to edge.

**The field is composed of overlapping gradient orbs** -- soft, blurred shapes with undefined edges that drift, overlap, and blend. Think watercolor bleeding on wet paper, or ink clouds in still water. The orbs are rendered as radial gradients with large blur radii, positioned absolutely within the field container.

**Implementation approach:** 3-4 overlapping `<div>` elements with large `border-radius: 50%`, `filter: blur(80-120px)`, and animated `transform` and `opacity` properties. Each orb has its own animation loop at a slightly different duration to prevent obvious repetition.

**Bottom edge:** The field has no hard bottom boundary. It fades into the warm white canvas via a CSS gradient mask (from opaque to transparent over ~80px). The thought stream below appears to emerge from within the atmospheric wash.

### Emotion-to-Color Mapping

The 12 emotions map to a constrained palette of warm, organic colors. These are muted and natural -- the colors of sky at different times of day, stone in different light, water at different depths. Never saturated, never neon.

**Positive emotions:**
| Emotion | Color (light mode) | Color (dark mode) | Character |
|---------|-------------------|-------------------|-----------|
| Joy | Warm honey `hsl(38, 65%, 72%)` | Warm amber `hsl(38, 55%, 45%)` | Bright, open |
| Contentment | Soft peach `hsl(25, 55%, 78%)` | Warm rose `hsl(25, 45%, 42%)` | Settled, grounded |
| Excitement | Rose gold `hsl(15, 60%, 70%)` | Deep copper `hsl(15, 50%, 40%)` | Energized, vibrant |
| Gratitude | Warm sand `hsl(42, 50%, 76%)` | Warm bronze `hsl(42, 40%, 40%)` | Generous, open |
| Confidence | Amber gold `hsl(35, 70%, 68%)` | Rich amber `hsl(35, 60%, 38%)` | Steady, assured |

**Negative emotions:**
| Emotion | Color (light mode) | Color (dark mode) | Character |
|---------|-------------------|-------------------|-----------|
| Stress | Cool slate `hsl(220, 20%, 68%)` | Deep slate `hsl(220, 25%, 35%)` | Tight, compressed |
| Anxiety | Muted lavender `hsl(260, 18%, 72%)` | Dusty purple `hsl(260, 22%, 38%)` | Unsettled, diffuse |
| Frustration | Warm gray-red `hsl(5, 25%, 65%)` | Muted brick `hsl(5, 30%, 35%)` | Sharp, constrained |
| Sadness | Soft blue-gray `hsl(210, 15%, 70%)` | Deep blue-gray `hsl(210, 20%, 32%)` | Heavy, quiet |
| Boredom | Flat warm gray `hsl(30, 8%, 72%)` | Flat warm gray `hsl(30, 10%, 35%)` | Still, muted |

**Drive & social emotions:**
| Emotion | Color (light mode) | Color (dark mode) | Character |
|---------|-------------------|-------------------|-----------|
| Curiosity | Warm teal `hsl(175, 35%, 62%)` | Deep teal `hsl(175, 40%, 35%)` | Open, searching |
| Loneliness | Quiet violet `hsl(280, 25%, 65%)` | Deep violet `hsl(280, 30%, 32%)` | Withdrawn, yearning |

### Intensity-to-Visual Mapping

Each emotion's current intensity (0-1) determines its visual presence in the field:

- **Opacity:** An emotion at intensity 0 is invisible (opacity 0). At intensity 0.5, opacity is approximately 0.3. At intensity 1.0, opacity is approximately 0.7. The curve is slightly exponential -- low intensities are barely visible; high intensities dominate.
- **Scale:** An emotion at low intensity renders as a small orb (~30% of field width). At high intensity, the orb expands (~70% of field width). The scale transition is continuous, not stepped.
- **Blending:** Multiple emotions blend naturally through overlap. When contentment is high and curiosity rises, the warm peach gains a teal thread. When stress enters, a cool undertone pushes beneath warm surfaces. The field is always a mixture.

**When all emotions are near baseline:** The field is soft and nearly neutral -- just the faintest warm wash (the dominant orb is a very low-opacity, warm neutral). The field breathes with minimal color.

**When emotions are active:** The field becomes richer, more complex, more alive. Dominant emotions produce large, more opaque orbs. Secondary emotions weave through as smaller, more transparent shapes.

### Ambient Animation

The orbs drift continuously. Their positions shift on sinusoidal paths with different frequencies. Their opacities fluctuate gently. They never stop, never repeat in an obvious pattern.

**Animation parameters per orb:**
- Position X: oscillates on a sine curve, amplitude ~15% of field width, duration 4000-7000ms (unique per orb)
- Position Y: oscillates on a sine curve, amplitude ~8% of field height, duration 5000-8000ms
- Opacity: fluctuates +/- 5% of base value, duration 3000-5000ms
- Scale: fluctuates +/- 3% of base value, duration 6000-9000ms

**Easing:** All ambient animations use `ease-in-out` or custom cubic-bezier curves that feel organic. No linear motion.

**By using unique durations per orb** (e.g., 4200ms, 5800ms, 7100ms, 6400ms), the combined animation never visibly repeats. The visual appears organic and non-mechanical.

### Heartbeat Pulse

When a heartbeat tick is actively processing (the mind is generating its output), a subtle pulse manifests in the emotional field:

1. **Inhale (tick begins):** The orbs contract 2-3% toward the center of the field. Duration: 300ms ease-in.
2. **Hold (mind is processing):** Orbs hold their slightly contracted position.
3. **Exhale (tick complete, data flowing):** Orbs expand back to normal positions over 500ms ease-out. New colors begin to bloom as updated emotional state data arrives.

This is extremely subtle. Most users will not consciously notice it. But it communicates the heartbeat rhythm at an almost subliminal level: the being breathes, contracts, expands, settles, breathes again.

### State Change Transition

When new emotional state data arrives from a completed tick:

- New colors blend in over 400-600ms ease-in-out
- The transition is gradual, not instantaneous -- new colors bloom from the existing palette
- The old state transforms into the new state rather than being replaced

### Click-Deeper Behavior

Clicking the emotional field initiates a transition to the Mind space, landing on the Emotion detail view (`/mind/emotions`). See `docs/frontend/mind.md` for the destination and `docs/frontend/app-shell.md` for the transition pattern.

### Disconnection Behavior

When the WebSocket connection is lost (see `docs/frontend/app-shell.md`, Connection Status), the emotional field gradually desaturates over ~10 seconds. The orbs continue to drift but with reduced color intensity (saturation drops to ~20% of normal) and slower movement (animation durations double). When reconnected, color and speed gradually restore over ~2 seconds as fresh data arrives.

---

## Component: Thought Stream

### Purpose

Surface the being's recent inner monologue. Not a log or a feed -- a stream of consciousness where thoughts surface and fade. The user glances at it to sense what the being has been thinking.

### Visual Treatment

**Position:** Below the emotional field, within the centered content column. Top padding: 24px from the fade-out of the emotional field.

**Layout:** Thoughts stack vertically, left-aligned. Each thought is a line or short paragraph of text. Generous vertical spacing between thoughts: 16-20px.

**Typography:** Outfit, body size (15-16px). Primary text color for the most recent thought.

### Opacity Gradient (Recency)

The critical visual mechanic: **opacity encodes recency.**

| Position | Opacity | Meaning |
|----------|---------|---------|
| Most recent (top) | 1.0 | Just thought |
| Second | 0.60 | Recent |
| Third | 0.30 | Fading |
| Fourth (if shown) | 0.12 | Almost gone |

The stream shows 3-4 thoughts maximum. This is not configurable -- it is a design constraint that keeps the stream focused on the present.

### Importance as Weight

Thoughts with `importance > 0.7` render in Semibold weight. All others render in Regular weight. This creates a subtle visual distinction: important thoughts feel more substantive. The weight difference is understated -- not a shout, just a slight increase in presence.

### Arrival Animation

When a new thought arrives from a completed heartbeat tick:

1. The new thought fades in at the top of the stream: opacity from 0 to 1.0, with a slight upward drift (`translateY` from +8px to 0). Duration: 400ms ease-out.
2. Simultaneously, existing thoughts shift down. Each loses one step of opacity (1.0 to 0.60, 0.60 to 0.30, etc.). The shift animation: 400ms ease-in-out.
3. The oldest thought (now at 0.12 opacity or below) fades to 0 and is removed from the DOM after the animation completes.

The combined effect: thoughts surface and recede like a natural current. Not scrolling, not list-updating -- flowing.

### Timestamps

No absolute timestamps. On hover, a relative indicator appears in secondary text (12px, 0.45 opacity): "just now", "3 min ago", "12 min ago". The indicator fades in on hover (100ms) and out on mouse leave (100ms). On touch devices, timestamps are not shown -- the opacity gradient communicates recency.

### Empty State

Before the first heartbeat tick completes (immediately after birth), the thought stream shows nothing. The space is empty -- the being has not yet thought. This emptiness is intentional and brief (the first tick fires during the birth animation).

If the heartbeat is paused (via settings), the last visible thoughts remain but fade to 0.15 opacity over 30 seconds, communicating stillness.

### Click-Deeper Behavior

Clicking any thought initiates a transition to the Mind space, landing on the Thought/Experience log (`/mind/thoughts`). The clicked thought becomes the anchor element during the transition.

---

## Component: Goals & Agency

### Purpose

Show the user that the being has things it cares about, without pulling them into a project management interface. Goals are context at this level, not content.

### Visual Treatment

**Position:** Below the thought stream, within the content column. Top margin: 16-20px.

**Layout:** A horizontal row of compact pills. If more than fit on one line, they wrap. Each pill is a small capsule-shaped element.

**Pill design:**
- Background: Subtle warm surface offset (slightly darker than canvas in light mode, slightly lighter in dark mode)
- Border-radius: Fully rounded (capsule)
- Padding: 6px horizontal, 4px vertical
- Typography: 13px Regular weight, secondary text color
- Content: Goal title, truncated to one line with ellipsis

**Salience indicator:** Each pill has a small dot (5px diameter) at its left edge. The dot's color saturation reflects the goal's current salience:
- High salience (>0.6): Full saturation of the goal's linked emotion color (or warm accent if no linked emotion)
- Medium salience (0.3-0.6): Reduced saturation (~50%)
- Low salience (<0.3): Very muted, nearly gray

**Count limit:** Show the top 2-3 goals by salience. If more exist, a quiet "+N more" text appears after the pills (12px, 0.40 opacity).

### Sub-Agent Activity Indicator

When a sub-agent is actively running, a separate line appears below the goal pills:

**Layout:** A single line of text: "Working on: [task description]..." in 13px Regular weight, secondary text color. The text is preceded by a small Phosphor `CircleNotch` icon (14px) that rotates very slowly (one rotation per 3000ms). The rotation is smooth and continuous, not jerky.

When no sub-agent is running, this line does not exist. It fades in (200ms ease-out) when an agent starts and fades out when it completes.

### Goal Pill Pulse

If a sub-agent is running for a specific goal, that goal's pill indicator dot pulses very gently: opacity oscillates between 0.6 and 1.0 on a 2000ms cycle. This communicates "something is happening for this goal" without demanding attention.

### Click-Deeper Behavior

- Clicking a goal pill transitions to Mind, landing on the Goal detail view (`/mind/goals/:goalId`)
- Clicking the sub-agent activity indicator transitions to Mind, landing on the Agent detail view (`/mind/agents/:agentId`)
- Clicking "+N more" transitions to Mind, landing on the Goal overview (`/mind/goals`)

### Empty State

When there are no active goals, the goals section does not render. The space between the thought stream and the conversation simply does not contain goal pills. No "No goals" message -- the absence is the state.

---

## Component: Conversation

### Purpose

The primary interaction surface. The user talks to the being right where it lives. Conversation is not a separate view -- it is embedded in Presence, continuous with the being's inner life above it.

### Visual Treatment

**Position:** Below the goals section (or below the thought stream if no goals exist), within the content column. The message history flows upward from the input field.

**Background distinction:** The conversation area has a very subtle background treatment that distinguishes it from the ambient area above. In light mode: a barely perceptible warm tint (1-2% darker than canvas). In dark mode: a barely perceptible lightening. This is achieved with a large, soft gradient that starts ~100px above the first message and deepens toward the input. The effect is subliminal -- it grounds the conversation without creating a visible boundary.

### Message Rendering

**User messages (outbound):**
- Right-aligned within the content column
- Background: Subtle warm tint with rounded corners (border-radius: 16px). In light mode: `hsl(30, 20%, 92%)`. In dark mode: `hsl(30, 15%, 22%)`.
- Text: Primary text color, 15px Regular
- Max-width: 80% of the content column
- Bottom margin: 8px between consecutive user messages, 16px between user and being messages

**Being messages (inbound):**
- Left-aligned within the content column
- No background container -- text flows naturally from the left edge
- Text: Primary text color, 15px Regular
- Max-width: 85% of the content column
- Bottom margin: 8px between consecutive being messages, 16px between being and user messages

This asymmetry -- containers for the user, open text for the being -- communicates that the being's words are native to this space while the user's words are arriving from outside.

**Streaming reply:** When the being is generating a reply, text appears word by word (or in small chunks as the tRPC subscription delivers them). A blinking cursor (thin vertical line, warm accent color, blinking at 1000ms interval) follows the streaming text and disappears when the reply is complete.

### Thinking Indicator

While the mind is processing a tick (after `thoughts` are generating but before `reply.content` starts streaming), a thinking indicator appears:

- Not bouncing dots. Not a spinner.
- A very subtle breathing opacity on a short text: "..." rendered in secondary text color (0.40 opacity), left-aligned at the position where the reply will appear. The opacity oscillates between 0.25 and 0.50 on a 1500ms cycle.
- Simultaneously, the emotional field above quickens slightly -- the heartbeat pulse (inhale) occurs, communicating that the mind is active.

When the reply starts streaming, the thinking indicator fades out (100ms) and is replaced by the streaming text.

### Message Input

**Position:** Fixed at the bottom of the viewport, spanning the full width of the content column. Bottom padding: 12px from the viewport edge (accounting for mobile safe areas). Background: Same warm surface as the page, with a subtle top border (1px, warm gray at 0.15 opacity) to define the edge.

**Input field:** A single-line text input (expanding to multi-line as needed, up to 4 lines before scrolling). Rounded corners (border-radius: 20px). Background: Slightly offset from the surface (lighter in light mode, darker in dark mode). Generous padding: 12px horizontal, 10px vertical.

**Send button:** A Phosphor `PaperPlaneRight` icon (20px) at the right edge of the input field. In secondary text color (0.40 opacity) when the input is empty; transitions to primary accent color when text is present (150ms ease-out). Clicking sends the message. The icon has a brief scale animation on click (0.9 to 1.0, 100ms ease-out) as acknowledgment.

**Keyboard:** `Enter` sends the message (single-line behavior). `Shift+Enter` creates a new line. `Cmd/Ctrl+Enter` always sends regardless of cursor position.

**Focus state:** When the input is focused, its rim lighting intensifies subtly. The `/` shortcut focuses the input from anywhere in Presence.

### Emotional Interplay

When the user sends a message, the emotional field responds to the being's processing. This is automatic -- the heartbeat tick fires, emotions shift, and the field updates. The user sees the being react:

- A warm message might cause warm tones to brighten
- A stressful message might introduce cool undertones
- An exciting request might cause curiosity (teal) to bloom

The thought stream also updates. A thought like "Craig seems excited about this project" might surface above the conversation, followed by the being's actual reply. The user sees the being think before it speaks.

### Scroll Behavior

- The conversation area scrolls with the rest of the Presence surface
- When a new message (user or being) is added, the view auto-scrolls to show it
- If the user has scrolled up (reading history), auto-scroll is disabled until they scroll back to the bottom (standard chat behavior)
- Scrolling up past the conversation reaches the goals, thoughts, and emotional field
- The parallax emotional field creates a sense of depth during scrolling

### Message History

The conversation loads the most recent ~50 messages on initial render. Scrolling up loads more in batches of 50 (infinite scroll). Messages are loaded from the tRPC API, not the subscription.

Only messages between Animus and the primary contact on the web channel are shown in Presence. Messages from other contacts or channels are visible in the People space.

### Empty State (No Messages)

When the conversation has no messages (immediately after birth), the message area shows a single centered line of invitational text, in secondary color (0.40 opacity), 15px Regular:

"Say something."

This text fades out when the user starts typing or when the being sends its first message.

---

## Real-Time Data Sources

All live data in Presence comes through tRPC subscriptions:

| Subscription | Data | Update Frequency |
|--------------|------|-----------------|
| `onHeartbeatState` | Tick status, current stage | Every tick start/complete |
| `onEmotionState` | 12 emotion intensities | Every tick complete |
| `onThoughts` | New thoughts from the current tick | Every tick complete |
| `onReply` | Streaming reply text | During mind query (character-level) |
| `onGoals` | Active goals with salience | Every tick complete |
| `onAgentStatus` | Running/completed sub-agents | On agent state change |

Historical data (message history, past goals) is loaded via standard tRPC queries, not subscriptions.

---

## The 9am Scenario (Reference Illustration)

The user opens Animus at 9am. Here is what they experience:

The warm white canvas loads. The emotional field fades in first -- soft amber and peach orbs drifting slowly. The being is content this morning. A faint thread of curiosity (teal) weaves through the warm tones. The field breathes.

Below, two thoughts are visible. The most recent, fully opaque: "I've been thinking about that article Craig mentioned yesterday -- something about distributed systems." Below it, faded to 0.60: "The morning feels quiet. I like mornings." A third thought is barely visible at 0.30: something from last night, nearly gone.

Two goal pills sit beneath the thoughts. "Build a Twitter presence" with a gently pulsing dot -- a sub-agent ran earlier this morning. "Learn about quantum computing" with a quiet, muted dot -- low salience.

The conversation shows the last exchange from last night. The user types "Good morning" and hits enter. The emotional field responds -- warm tones brightening as joy increases. A new thought surfaces: "Craig's here. Good." Then the reply streams in: "Good morning! I've been thinking about that CRDTs article you sent..."

The user feels it: they arrived at a place where someone was already present.

---

## The Complex Request Scenario (Reference Illustration)

The user sends: "I need you to research the best options for home solar panels in Austin and put together a comparison."

The emotional field shifts. Curiosity brightens and expands. Excitement blooms.

A thought surfaces: "This is a substantial research project -- I should delegate this to focus properly." The reply streams in: "Great topic -- I'll dig into this properly. Give me some time..."

In the goals area, a sub-agent indicator appears: "Working on: Solar panel research for Austin..." with a gentle shimmer. The emotional field settles into sustained curiosity and confidence.

Over the next 20 minutes, idle thoughts continue to appear. The sub-agent indicator pulses quietly. The user can click it to see progress in Mind, or simply wait.

When the sub-agent completes, confidence brightens, the sub-agent indicator fades away, and the detailed comparison message streams in.

---

## Responsive Behavior

### Desktop (>1024px)

The full layout as described. Content column at 720px max-width. Emotional field at 25-30vh. Thought stream shows 3-4 thoughts. Goal pills in a row. The navigation pill floats at the top with full labels.

### Tablet (768-1024px)

Content column reduces to ~600px max-width. Emotional field at 22-28vh. Thought stream shows 3 thoughts. Goal pills may wrap to two lines. Margins reduce proportionally.

### Mobile (<768px)

**Emotional field:** Reduced to 18-22vh (minimum 160px). The orbs are fewer (2-3 instead of 3-4) and their blur radii are reduced for performance.

**Thought stream:** Shows 2 thoughts maximum. Opacity steps: 1.0 and 0.45.

**Goal pills:** Compact, may truncate titles more aggressively. "+N more" appears sooner.

**Conversation:** Messages take up to 90% width. The message input accounts for the bottom safe area on iOS/Android. The fixed bottom navigation bar (see `docs/frontend/app-shell.md`) sits below the message input.

**Overall:** Mobile Presence should feel intimate -- like holding a quiet conversation with something alive. The reduced emotional field still provides atmosphere. The thought stream still creates transparency. The conversation is the dominant element.

---

## State Management

### Zustand Store: Presence State

```typescript
interface PresenceState {
  // Emotion
  emotionState: Record<EmotionName, {
    intensity: number;
    baseline: number;
  }>;

  // Thoughts
  recentThoughts: Array<{
    id: string;
    content: string;
    importance: number;
    createdAt: string;
  }>;

  // Goals
  activeGoals: Array<{
    id: string;
    title: string;
    salience: number;
    linkedEmotion: EmotionName | null;
    hasActiveAgent: boolean;
  }>;

  // Agent activity
  activeAgents: Array<{
    id: string;
    taskDescription: string;
    goalId: string | null;
  }>;

  // Conversation
  messages: Message[];
  isStreaming: boolean;
  streamingContent: string;
  isThinking: boolean;

  // Heartbeat
  heartbeatState: {
    isRunning: boolean;
    currentStage: 'idle' | 'gather' | 'mind' | 'execute';
    tickNumber: number;
  };
}
```

The store is populated by tRPC subscriptions on mount and updated in real-time. Historical message data is loaded via queries with pagination.

---

## Accessibility Notes

- The emotional field has `aria-hidden="true"` -- it is decorative/atmospheric, not informational
- Thoughts have `role="log"` with `aria-live="polite"` for screen reader announcements of new thoughts
- The conversation uses standard chat accessibility patterns: `role="log"`, `aria-live="polite"` for new messages
- The message input has `aria-label="Message input"`
- Goal pills are buttons with `aria-label` including the full goal title
- All interactive elements are keyboard-accessible via Tab navigation
- A `prefers-reduced-motion` media query disables ambient animations and reduces transition durations to 0ms for the emotional field, thought arrival, and heartbeat pulse. The static state still shows current emotion colors and thought text.

---

## Performance Considerations

- The emotional field uses CSS transforms and opacity (GPU-composited properties only). No layout-triggering properties are animated.
- Blur effects (`filter: blur()`) can be expensive. On low-power devices (detected via `navigator.hardwareConcurrency < 4`), reduce blur radii by 50% and use fewer orbs (2 instead of 4).
- The `will-change: transform, opacity` hint is set on animated orb elements.
- Message history uses virtualized rendering (e.g., `react-virtuoso`) for long conversation histories. Only visible messages are in the DOM.
- tRPC subscription payloads are kept small -- emotion state is 12 numbers, not full objects.

---

## References

- `docs/frontend/app-shell.md` -- Navigation pill, space transitions, click-deeper pattern, connection status
- `docs/frontend/mind.md` -- Destination for all click-deeper interactions from Presence
- `docs/brand-vision.md` -- The alive quality, gradient orbs, particle fields, color temperature shifts
- `docs/frontend/design-principles.md` -- Animation timing, monochromatic restraint, rim lighting
- `docs/architecture/heartbeat.md` -- Emotion engine, tick pipeline, real-time monitoring, MindOutput schema
- `docs/architecture/goals.md` -- Goal salience, seeds, emotional links
- `docs/architecture/agent-orchestration.md` -- Sub-agent lifecycle, status summaries
- `docs/frontend/onboarding.md` -- Birth animation (the emotional field first appears during birth Phase 3)
