# App Shell & Navigation

The structural container for the entire Animus application. This spec covers the spatial model (four spaces), the navigation pill, the command palette, connection status, the "clicking deeper" transition pattern, responsive behavior, and route structure. Every other frontend spec sits inside this shell.

## Design Philosophy

The app shell should be invisible when things are working well. It exists to orient the user within the spatial model, provide fast access to any part of the application, and communicate system health. It should never compete with the content of the active space for attention. Think of it as the frame of a window -- you notice what is beyond it, not the frame itself.

**Guiding Principles:**
- **Ambient, not structural** -- The shell elements hover over content, not beside it. No sidebar. No top bar. No visual chrome that carves the page into regions.
- **Present but unobtrusive** -- Navigation and status are always accessible, never demanding.
- **Spatial, not hierarchical** -- The four spaces are peers, not parent-child. Moving between them is lateral, not vertical.

---

## The Four Spaces

Animus is organized into four peer-level spaces. Each represents a fundamentally different mode of engagement with the being.

| Space | Purpose | Feeling |
|-------|---------|---------|
| **Presence** | Being with the entity -- conversation, emotional atmosphere, ambient awareness | Warm, alive, immediate |
| **Mind** | Observing the entity's inner life in detail -- emotions, thoughts, memories, goals, agents | Contemplative, transparent, rich |
| **People** | The entity's social world -- contacts, conversations, relationships | Relational, organized, clear |
| **Settings** | Configuring the entity and the system -- persona, heartbeat, channels, providers | Practical, clean, trustworthy |

Presence is the default space. It is where the user lands after onboarding and after every login. The other three spaces are accessible via the navigation pill.

---

## The Navigation Pill

### Concept

A floating, translucent pill anchored to the top-center of the viewport. It contains the four space labels and floats above all content via a high z-index. It is always visible, always accessible, and never pushes content down.

### Visual Treatment

**Shape:** A horizontal rounded capsule (border-radius equal to half the pill's height, creating a fully rounded form). Width is content-driven -- wide enough for the four labels with generous internal padding.

**Background:** Semi-transparent warm surface with backdrop-blur. In light mode: `rgba(250, 249, 244, 0.85)` with `backdrop-filter: blur(16px)`. In dark mode: `rgba(28, 26, 24, 0.85)` with the same blur. The emotional field and page content are visible through the pill, but softened.

**Border:** Subtle rim lighting consistent with the design system. A gradient border that implies light from above -- slightly more visible than on standard cards, since the pill floats above everything.

**Position:** Fixed to the top of the viewport, horizontally centered. Approximately 12-16px from the top edge. On desktop, the pill sits above the emotional field, which is visible beneath it.

**Elevation:** Highest z-index in the application. Nothing overlaps the navigation pill except the command palette overlay.

### Space Labels

The four space names are rendered as text labels inside the pill: **Presence**, **Mind**, **People**, **Settings**. Each uses Outfit at Regular weight, small body size (13-14px).

**Active state:** The currently active space label is rendered in Semibold weight with full opacity (1.0). A small dot (4px diameter, high-contrast accent color) sits below the active label, centered.

**Inactive state:** Inactive labels are rendered in Regular weight at reduced opacity (0.55). No dot.

**Hover state:** On hover, an inactive label transitions to 0.8 opacity (120ms ease-out). No other visual change -- the interaction is subtle and confident.

**Click behavior:** Clicking an inactive label triggers a space transition (see [Space Transitions](#space-transitions) below). The active dot animates horizontally to the new label's position (250ms ease-in-out).

### Iconography

Each space label can optionally be preceded by a small Phosphor Icon (16px, line weight) for additional visual anchoring:

| Space | Icon | Phosphor Name |
|-------|------|---------------|
| Presence | A subtle pulse/wave | `Pulse` or `WaveSine` |
| Mind | A simplified brain or thought bubble | `Brain` |
| People | A person silhouette | `User` |
| Settings | A gear | `GearSix` |

Icons match the label opacity and weight behavior. On mobile, icons may replace text labels entirely (see [Responsive Behavior](#responsive-behavior)).

### Back Indicator

When the user has navigated deeper within a space (e.g., clicked a goal in Presence to see its detail in Mind), a back arrow appears at the left edge of the pill. This is a Phosphor `ArrowLeft` icon (16px) that, when clicked, returns the user to their previous position.

The back indicator fades in (150ms ease-out) when a deeper navigation occurs and fades out when the user returns to the top level of a space.

**Keyboard:** The `Escape` key triggers the back action when a deeper view is active. Browser back button / swipe-back gesture also work via the router history stack.

### Scroll Behavior

On Presence, when the user scrolls down into the conversation area (past the emotional field and thought stream), the pill can optionally condense. The text labels fade out, leaving only the icons and the active dot. This reduces the pill's footprint and keeps focus on the conversation. Scrolling back up restores the full labels.

The condensation transition: 200ms ease-in-out. Labels fade to 0, pill width shrinks to fit icons only.

This behavior is specific to Presence. In Mind, People, and Settings, the pill remains in its full form regardless of scroll position.

---

## Space Transitions

### Between Spaces (Lateral)

Moving between spaces feels like shifting your attention laterally -- like turning your head to look in a different direction. The transition is clean and smooth, never jarring.

**Outgoing space:** Fades out and slides slightly in the direction of the incoming space (e.g., moving from Presence to Mind, Presence slides left). Duration: 200ms, ease-in. Opacity goes from 1.0 to 0.

**Incoming space:** Fades in from the opposite direction (Mind slides in from the right). Duration: 250ms, ease-out. Opacity goes from 0 to 1.0. There is a 50ms overlap where both spaces are partially visible, creating a brief cross-fade.

**Total perceived transition time:** ~300ms. Fast enough to feel responsive, slow enough to feel intentional.

**The navigation pill does not transition.** It remains fixed. Only the active dot animates to the new label.

### Within a Space (Clicking Deeper)

This is the primary navigation pattern for exploring detail. Everything in the top-level views is a surface. Clicking any surface reveals depth beneath it.

**The transition has three phases:**

**Phase 1: Anchor (0-100ms)**
The clicked element becomes visually anchored -- it stays in place (or moves to a prominent position, typically top-center) while everything else in the current view fades out. The fade is quick: 150ms ease-in to opacity 0. The anchor element may gain a subtle scale increase (1.02x) to communicate that it is "opening."

**Phase 2: Expand (100-300ms)**
The detailed content of the clicked element expands into the vacated space. It fades in from opacity 0 with a slight upward drift (translateY from +12px to 0). The expansion feels like the surface is blooming -- content reveals itself beneath the anchor point.

**Phase 3: Settle (300-400ms)**
The navigation pill updates to reflect the new location (active dot may shift if the deeper view is in a different space, or a back indicator appears). All elements reach their final positions and opacities.

**Total transition time:** 350-400ms.

**Returning (un-zooming):**
The reverse transition is slightly faster (300ms total). The detail content fades and collapses back toward its origin point. The surrounding top-level elements fade back in. The back indicator in the pill fades out. The experience feels like relaxing your focus -- zooming back out to the broader view.

### Transition Choreography Rules

1. **Content fades before content appears.** Old content exits before new content enters. This prevents visual clutter during transitions.
2. **The navigation pill never participates in the fade.** It is a fixed reference point.
3. **The emotional field (in Presence) has its own transition behavior.** It does not fade out during lateral transitions. Instead, it cross-fades smoothly between states, maintaining the ambient atmosphere.
4. **Scroll position is preserved per space.** When switching from Presence to Mind and back, the user returns to where they were in Presence.

---

## Command Palette

### Concept

A keyboard-driven, search-based interface for fast access to any part of the application. Invoked by `Cmd+K` (macOS) or `Ctrl+K` (other platforms). Inspired by Spotlight/Raycast but styled to match the Animus design language.

### Visual Treatment

**Overlay:** A dimmed backdrop (warm black at 0.4 opacity) covers the entire viewport. The command palette itself is a centered, floating input card.

**Card:** Max-width ~560px, generous internal padding, prominent rim lighting (highest elevation). Background is the card surface color (warm white in light mode, warm dark in dark mode). Rounded corners (large radius). The card appears with a fade + slight scale animation (from 0.97 to 1.0, 150ms ease-out).

**Input:** A single text input fills the width of the card. Large, generous padding. Placeholder text: "Go to..." in secondary text color. A Phosphor `MagnifyingGlass` icon sits at the left edge of the input.

**Results:** Below the input, a results list appears as the user types. Each result is a single row showing:
- An icon (Phosphor, matching the destination type)
- The result label (e.g., "Presence", "Mom", "Heartbeat Settings", "Goal: Build Twitter presence")
- A secondary label showing the space it belongs to (e.g., "People", "Settings", "Mind")

Results are keyboard-navigable with arrow keys. The active result has a subtle background highlight (warm surface shift). Enter selects. Escape dismisses.

### Searchable Items

| Category | Examples | Icon |
|----------|----------|------|
| Spaces | Presence, Mind, People, Settings | Space-specific icons |
| Contacts | Any contact by name | `User` |
| Goals | Any active goal by title | `Target` |
| Settings Sections | Persona, Heartbeat, Channels, etc. | `GearSix` |
| Actions | Pause heartbeat, New contact | `Lightning` |

### Behavior

- Results filter in real-time as the user types, with fuzzy matching
- Empty input shows a short list of recent/suggested destinations
- Selecting a result triggers the appropriate space transition (lateral or click-deeper)
- The palette dismisses after selection, with a quick fade-out (100ms)
- Clicking outside the palette or pressing Escape also dismisses it

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+K` | Open command palette |
| `Escape` | Close command palette / navigate back |
| `Arrow Up/Down` | Navigate results |
| `Enter` | Select active result |

---

## Connection Status Indicator

### Concept

The user needs to know when the frontend cannot communicate with the backend or when the WebSocket connection (tRPC subscription) is unhealthy. This indicator must fit naturally into the ambient design language -- visible when needed, invisible when not.

### Placement

The connection status indicator lives inside the navigation pill, at the far-right edge. It is a small visual element that does not displace the space labels.

### States

**Connected (default):** Invisible. No indicator is shown. Absence of the indicator IS the positive state. When everything is working, the user should not see or think about connection status.

**Reconnecting (transient):** A small dot (6px diameter) appears at the right edge of the pill, pulsing slowly between warm orange at 0.5 opacity and warm orange at 0.2 opacity (2000ms cycle). No text. The pulsing communicates "something is in progress" without alarm. This state activates after 3 seconds of disconnection -- brief network blips (under 3 seconds) do not trigger any visual change.

**Disconnected (persistent):** After 15 seconds of failed reconnection attempts, the dot expands to include a short text label: "Offline" in small secondary text (12px, Regular weight). The dot stops pulsing and holds at warm orange, 0.8 opacity. The text and dot fade in together (200ms ease-out).

If the user hovers over the disconnected indicator, a tooltip appears below the pill with more context: "Unable to reach the Animus server. Reconnecting..." styled as a small warm-toned card with rim lighting.

**Reconnected:** When the connection is restored, the indicator transitions: the text fades out first (150ms), the dot turns green briefly (300ms), then the dot fades out (200ms). Total: ~650ms. The brief green flash provides positive confirmation without lingering.

### Emotional Field Behavior During Disconnection

When the connection is lost, the emotional field (in Presence) cannot receive real-time updates. Rather than freezing in its last state (which would look alive but be lying), the emotional field should gradually desaturate and slow its animation over ~10 seconds, communicating that the live connection to the being has been interrupted. The orbs should still drift (the page should not look broken) but with reduced color intensity and slower movement -- like looking at something through frosted glass.

When the connection restores, the emotional field gradually re-saturates and resumes normal animation speed as fresh data arrives (~2 seconds).

---

## Route Structure

```
/                           --> Presence (default)
/presence                   --> Presence (alias)
/mind                       --> Mind (top level)
/mind/emotions              --> Emotion detail view
/mind/thoughts              --> Thought/experience log
/mind/memories              --> Memory browser
/mind/goals                 --> Goal overview
/mind/goals/:goalId         --> Goal detail
/mind/agents                --> Agent orchestration view
/mind/agents/:agentId       --> Agent detail
/people                     --> People (contact list)
/people/:contactId          --> Contact detail
/settings                   --> Settings (top level)
/settings/persona           --> Persona editing
/settings/heartbeat         --> Heartbeat configuration
/settings/provider          --> Agent provider & credentials
/settings/channels          --> Channel configuration
/settings/goals             --> Goal settings (approval mode)
/settings/system            --> System settings (timezone, embedding, data)
```

**Route guards:**
- All routes require authentication (redirect to `/auth/login` if no session)
- All routes redirect to `/onboarding` if onboarding is incomplete
- `/` redirects to `/presence` internally but the URL shows `/`

**Route-to-space mapping:**
- `/` and `/presence` --> Presence space
- `/mind` and `/mind/*` --> Mind space
- `/people` and `/people/*` --> People space
- `/settings` and `/settings/*` --> Settings space

The navigation pill reads the current route to determine which space label is active. Nested routes within a space (e.g., `/mind/goals/abc123`) keep the parent space active in the pill and show the back indicator.

---

## Global Keyboard Shortcuts

| Shortcut | Action | Scope |
|----------|--------|-------|
| `Cmd/Ctrl+K` | Open command palette | Global |
| `Escape` | Close palette / navigate back / dismiss modal | Global |
| `Cmd/Ctrl+1` | Go to Presence | Global |
| `Cmd/Ctrl+2` | Go to Mind | Global |
| `Cmd/Ctrl+3` | Go to People | Global |
| `Cmd/Ctrl+4` | Go to Settings | Global |
| `/` | Focus message input (in Presence) | Presence only |
| `Cmd/Ctrl+Enter` | Send message | Message input focused |

Shortcuts are not shown in the UI by default. They are discoverable via the command palette (which can show a "Keyboard shortcuts" result).

---

## Responsive Behavior

### Desktop (>1024px)

The full experience as described. Navigation pill shows icons + text labels. Command palette is centered at ~560px width. Generous margins around content.

### Tablet (768-1024px)

Navigation pill condenses to icons + text (slightly tighter spacing). Command palette is full-width with comfortable padding. Content areas reduce their max-width proportionally.

### Mobile (<768px)

**Navigation pill becomes a bottom navigation bar.** On mobile, floating the pill at the top would compete with the system status bar and be difficult to reach with a thumb. Instead, the four space icons (no text labels) sit in a fixed bottom bar with the same translucent treatment as the desktop pill. The active space is indicated by the dot below the icon.

The bottom bar: height ~56px, full width, same backdrop-blur treatment. Icons are 24px with comfortable tap targets (44px minimum).

**Command palette:** Full-screen overlay on mobile. The input sits at the top of the screen with results below. Dismiss by swiping down or tapping the X.

**Space transitions:** The lateral slide distance is reduced on mobile for a snappier feel. The "clicking deeper" pattern works identically -- the transition is zoom-like regardless of viewport size.

**Back navigation:** On mobile, the browser's swipe-back gesture and the back indicator in the (now bottom) bar both work for returning from deeper views.

---

## State Management

### Zustand Store: Shell State

```typescript
interface ShellState {
  // Navigation
  activeSpace: 'presence' | 'mind' | 'people' | 'settings';
  navigationHistory: string[];  // Route stack for back navigation

  // Connection
  connectionStatus: 'connected' | 'reconnecting' | 'disconnected';
  lastConnectedAt: number | null;

  // Command palette
  isCommandPaletteOpen: boolean;

  // Scroll positions (preserved per space)
  scrollPositions: Record<string, number>;
}
```

### tRPC Subscription Health

The WebSocket connection health is monitored by the tRPC client. The shell listens for connection state changes and updates `connectionStatus` accordingly:

- `onOpen` --> `connected`
- `onClose` --> start 3-second timer, then `reconnecting`
- After 15 seconds of `reconnecting` --> `disconnected`
- `onOpen` after `reconnecting`/`disconnected` --> `connected` (with brief green flash)

The tRPC client handles automatic reconnection with exponential backoff. The shell does not manage reconnection logic -- it only reflects the state.

---

## Error Handling

### Route Not Found

A minimal 404 page styled consistently with the warm design language. Centered content:
- Heading: "Nothing here"
- Subheading: "This page doesn't exist."
- A single button: "Go home" (navigates to Presence)

No clever 404 illustrations or humor. Clean and direct.

### React Error Boundary

A global error boundary wraps the entire app shell. On unhandled errors:
- The app shell remains visible (navigation pill, connection status)
- The content area shows a centered error message: "Something went wrong"
- A "Reload" button refreshes the page
- The error is logged to the browser console with full stack trace

---

## References

- `docs/brand-vision.md` -- Visual identity, monochromatic restraint, warmth, the alive quality
- `docs/frontend/design-principles.md` -- Animation timing, rim lighting, typography, spacing
- `docs/frontend/onboarding.md` -- The standard for spec detail level
- `docs/frontend/presence.md` -- The Presence space spec
- `docs/frontend/mind.md` -- The Mind space spec
- `docs/frontend/people.md` -- The People space spec
- `docs/frontend/settings.md` -- The Settings space spec
