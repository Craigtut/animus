# Settings

The configuration space. Where the user manages everything about the being and the system that runs it -- from persona and personality to heartbeat timing, agent providers, communication channels, and data management. Settings is a full space, not a modal or overlay. It is frank about what it is: configuration. But it still inhabits the warm Animus design language.

## Design Philosophy

Settings is practical. The user comes here with a specific intent: change the persona, check the API key, adjust the heartbeat interval, configure a channel. The design should respect that intent by being clear, organized, and efficient. No decorative elements. No emotional field. No ambient animation. Just well-structured forms and controls in the warm, spacious Animus style.

**Guiding Principles:**
- **Frank and practical** -- This is settings. The user knows what they are here for. Respect their time.
- **Organized by concern** -- Group settings logically. The user should not have to think about where to find something.
- **Non-destructive by default** -- Dangerous actions (reset, delete) are clearly marked and require confirmation.
- **Live feedback** -- Changes take effect on the next tick. Show when a save has succeeded. Show when a restart is required.

---

## Structure: Sidebar Navigation

Settings uses a left sidebar for section navigation. This is the one space in Animus that uses a sidebar pattern -- it is appropriate here because Settings has many distinct sections and the user often visits several in one session. The sidebar provides persistent orientation.

### Sidebar

**Position:** Fixed to the left edge of the Settings content area. Width: 220px on desktop.

**Visual treatment:** No background container -- the sidebar is just a vertical list of section labels against the page canvas. This keeps it light and consistent with the "ambient navigation" philosophy. A subtle dividing line (1px, warm gray at 0.08 opacity) separates the sidebar from the main content.

**Section labels:** Listed vertically with 8px spacing. Each label is 14px Regular, secondary text color (0.55 opacity).

**Active section:** 14px Semibold, primary text color, with a small dot (4px, warm accent) to the left of the label. The dot transitions vertically when switching sections (200ms ease-in-out).

**Hover:** 0.75 opacity (100ms ease-out).

### Sections

| Section | Label | Phosphor Icon | Route |
|---------|-------|--------------|-------|
| Persona | Persona | `Sparkle` | `/settings/persona` |
| Heartbeat | Heartbeat | `Heartbeat` | `/settings/heartbeat` |
| Provider | Agent Provider | `Robot` | `/settings/provider` |
| Channels | Channels | `ChatCircle` | `/settings/channels` |
| Goals | Goals | `Target` | `/settings/goals` |
| System | System | `GearSix` | `/settings/system` |

Icons appear next to labels in the sidebar (14px, matching the label opacity).

### Content Area

**Position:** To the right of the sidebar. Max-width: 640px with left padding of 40px from the sidebar.

**Scroll behavior:** The sidebar stays fixed while the content scrolls. If the content area is long, only the content scrolls.

### Default Route

Navigating to `/settings` redirects to `/settings/persona` (the first section).

---

## Section: Persona

**Route:** `/settings/persona`

### Purpose

Edit the being's personality and identity. All eight persona creation steps from onboarding are editable here as sections within a single scrollable form. The persona is the being's soul -- changes here are significant.

### Layout

A single scrollable column with eight sections, each corresponding to a step from persona creation. Each section has a header, content, and save behavior.

### Section Headers

Each section has:
- A label (18px Semibold): "Existence", "Identity", "Archetype", "Personality", "Traits", "Values", "Background", "Notes"
- A collapse/expand toggle (Phosphor `CaretDown`/`CaretUp`, 16px). All sections default to expanded.
- A subtle bottom border (1px, warm gray at 0.06 opacity) separating sections.

### Section: Existence

The existence paradigm toggle (Simulated Life / Digital Consciousness). Two option cards, styled identically to onboarding but horizontally compact.

- Selected option has rim-lighting and a check indicator
- Switching paradigm reveals the appropriate sub-field (Location for Simulated Life, World Description for Digital Consciousness)
- The sub-field is a text input or text area, pre-filled with current values

### Section: Identity

Form fields for Name, Gender, Age, Physical Description. Same fields as onboarding Step 2 (6b), pre-filled with current values.

- Name: text input
- Gender: select dropdown + freeform input
- Age: number input
- Physical Description: text area

### Section: Archetype

A read-only note: "Your archetype was used as a starting point during creation. It isn't stored -- your personality is defined by the dimensions and traits below." No editable fields. The archetype is scaffolding, not persisted data. This section exists only as a reference and can be collapsed.

### Section: Personality Dimensions

The ten sliders, organized in four groups (Social Orientation, Emotional Temperament, Decision Style, Moral Compass). Same visual treatment as onboarding: bipolar labels at the ends, subtle warm gradient track, ghost marker at 0.5 neutral zone.

Sliders are interactive. Dragging a slider updates the preview value in real-time but does not save until the user explicitly saves (see [Save Behavior](#save-behavior)).

### Section: Traits

The trait chip grid, organized by category (Communication, Cognitive, Relational, Quirks). Same visual treatment as onboarding: tappable chips, selected chips highlighted, counter showing "N of 8 selected."

### Section: Values

The 16 value cards in a grid. Same visual treatment as onboarding: tappable cards with rank badges, counter showing "N of 5 selected," ranked summary strip.

### Section: Background

The backstory text area. Same writing prompts as onboarding shown as subtle hints. Pre-filled with current content.

### Section: Notes

The personality notes text area. Same example snippets shown as inspiration. Pre-filled with current content.

### Save Behavior

Persona changes are significant -- they trigger a recompilation of the system prompt and a recomputation of emotion baselines. Changes are NOT auto-saved. Instead:

**A "Save changes" primary button** sits at the bottom of the persona form (sticky, so it is always visible). The button is disabled when no changes have been made. When changes exist, the button is enabled with a subtle warm pulse (attention animation, 1500ms cycle) to draw the eye.

**On save:**
1. All persona fields are validated (name required, 5-8 traits selected, 3-5 values selected)
2. Data is sent to the backend via tRPC mutation
3. The backend recompiles the system prompt and recomputes emotion baselines
4. A success message appears: "Persona updated. Changes take effect on the next heartbeat tick." in a warm green banner (below the button, fades in 200ms, auto-dismisses after 5 seconds)
5. If validation fails, inline errors appear next to the relevant fields

**Unsaved changes warning:** If the user attempts to navigate away with unsaved persona changes, a confirmation dialog appears: "You have unsaved persona changes. Leave without saving?" with "Save and leave" (primary), "Leave without saving" (secondary), and "Cancel" (text link).

---

## Section: Heartbeat

**Route:** `/settings/heartbeat`

### Purpose

Configure the heartbeat system -- the engine that drives the being's inner life.

### Settings

**Heartbeat Interval:**
- Label: "How often does your Animus think?"
- A slider (or number input with stepper) showing the interval in human-readable format: "Every 5 minutes"
- Range: 1 minute to 30 minutes
- Default: 5 minutes
- Help text: "Shorter intervals mean more frequent thoughts and faster emotional shifts. Longer intervals are more contemplative (and cheaper)."

**Heartbeat Status:**
- A live status indicator: "Running" (green dot) or "Paused" (orange dot)
- Current tick number: "Tick #1,247"
- Last tick time: "Last tick: 2 minutes ago"
- Current stage (during active ticks): "Currently: Gathering context" / "Currently: Thinking" / "Currently: Executing"
- A toggle button: "Pause heartbeat" / "Resume heartbeat" (secondary button)
  - Pausing shows a confirmation: "Pausing the heartbeat stops all internal processes. Your Animus will stop thinking, feeling, and acting until resumed."
  - Paused state shows a warm orange banner: "Heartbeat is paused. Your Animus is not thinking."

**Session Info:**
- Current session state: "Cold" / "Active" / "Warm"
- Session warmth window: configurable (5-60 minutes, default 15)
- Context budget: displayed as a percentage (default 70%)
- Current session token usage (if warm): a bar showing tokens used vs. budget

### Save Behavior

Heartbeat settings save individually on change (no batch save needed). Each change takes effect immediately. A brief "Saved" confirmation appears next to the changed field.

---

## Section: Agent Provider

**Route:** `/settings/provider`

### Purpose

Configure which AI provider powers the being and manage authentication credentials.

### Layout

Two provider cards (Claude, Codex) displayed vertically. Same treatment as onboarding Step 2, but with the current provider highlighted.

### Provider Card Content

Each card shows:

- Provider name and description (from onboarding)
- Authentication status: "Connected" (green check) or "Not configured" (gray)
- Active indicator: "Currently active" badge on the selected provider

Clicking a provider card expands it to show authentication configuration:

**Claude:**
- Two auth options (same as onboarding): API Key and Claude Code Access Token
- Current credential status (valid / expired / missing)
- "Validate" button to re-check credentials
- "Update" to change the API key

**Codex:**
- API Key input with validation
- Current credential status

### Switching Providers

Changing the active provider shows a confirmation: "Switch to [provider]? Your Animus will use [provider] for all future thinking. The current mind session will end and restart with the new provider."

On confirm: the backend switches the provider, ends the current mind session, and the next tick starts a cold session with the new provider.

### Save Behavior

Provider changes save immediately on confirmation. Credential updates save when the "Validate" button returns success.

---

## Section: Channels

**Route:** `/settings/channels`

### Purpose

Configure communication channels -- how the being can be reached and how it sends messages.

### Layout

Four channel cards, same treatment as onboarding Step 5:

| Channel | Status Options | Configuration Fields |
|---------|---------------|---------------------|
| **Web** | Always on | No configuration needed |
| **SMS** | Enabled / Disabled | Twilio Account SID, Auth Token, Phone Number |
| **Discord** | Enabled / Disabled | Bot Token, Application ID, Allowed Guild IDs |
| **API** | Always on | API key display, regenerate option |

### Channel Card Design

Each card is a rim-lit container:

**Header row:**
- Channel name and icon (Phosphor: `Globe`, `ChatText`, `DiscordLogo`, `Code`)
- Status badge: "Active" (green) or "Not configured" (gray) or "Error" (red)
- Toggle switch (for SMS and Discord): enables/disables the channel

**Expanded content (for configurable channels):**
- Configuration fields pre-filled with current values (API keys shown as masked `****`, with a show/hide toggle)
- "Test connection" button that validates the credentials
- Last validation result: "Connected successfully" (green) or error message (red)

**API channel:**
- Shows the API URL and current API key
- "Regenerate key" button with confirmation: "Regenerating the API key will invalidate the current one. Any integrations using the old key will stop working."

### Save Behavior

Channel configuration saves when the user clicks "Save" on each channel card. Validation runs automatically on save. Failed validation prevents save and shows inline errors.

---

## Section: Goals

**Route:** `/settings/goals`

### Purpose

Configure goal system behavior.

### Settings

**Goal Approval Mode:**
- Label: "How should your Animus handle new goals?"
- Three options as selectable cards:

| Option | Label | Description |
|--------|-------|-------------|
| `always_approve` | "Ask me first" | "Your Animus will propose goals conversationally and wait for your approval before pursuing them." |
| `auto_approve` | "Go ahead, I'll review" | "Your Animus will start pursuing goals immediately and let you know. You can cancel anytime." |
| `full_autonomy` | "Full autonomy" | "Your Animus will pursue goals independently. You can discover and manage goals in the Mind space." |

- Current selection has rim-lit highlight and a check indicator
- Changing selection saves immediately with a brief "Saved" confirmation

**Goal Cleanup Info (read-only):**
- "Goals with average salience below 0.05 over 30 days are automatically cleaned up."
- This is informational, not configurable. Displayed in secondary text.

---

## Section: System

**Route:** `/settings/system`

### Purpose

System-level configuration: timezone, embedding model, data management, account.

### Settings Groups

**Timezone:**
- Label: "Your timezone"
- A searchable dropdown showing timezone names (e.g., "America/New_York", "Europe/London")
- Pre-filled with the current setting (auto-detected during onboarding)
- Help text: "All scheduled tasks and time-based displays use this timezone."
- Saves immediately on change

**Embedding Model:**
- Label: "How your Animus processes memories"
- Two options as selectable cards:
  - "Local" (Transformers.js + BGE-small-en-v1.5): "Runs on your server. No external API needed. Good for most use cases."
  - "OpenAI" (text-embedding-3-small): "Higher quality embeddings via OpenAI API. Requires an OpenAI API key."
- Current selection highlighted
- Changing shows a warning: "Switching embedding models requires re-embedding all existing memories. This will happen automatically on the next server restart and may take a few minutes."

**Data Management:**
- A section with actions for managing data. Each action is a text link with a description.

| Action | Description | Confirmation |
|--------|-------------|-------------|
| "Soft reset" | "Clear thoughts, emotions, and goals. Preserve memories and conversations." | Full confirmation dialog with explanation |
| "Full reset" | "Clear all AI state including memories. Preserve conversations." | Full confirmation dialog with warning |
| "Clear conversations" | "Delete all message history across all contacts and channels." | Full confirmation dialog |
| "Export data" | "Download all databases as a backup file." | No confirmation needed |

Each destructive action uses the semantic red color for the action link and the confirmation dialog's primary button.

**Soft reset** clears `heartbeat.db` (thoughts, emotions, goals, tasks, seeds, decisions). The being loses its current inner state and starts fresh, but retains everything it has learned (memories in `memory.db`). The heartbeat pauses and must be manually resumed (or resumes automatically after the next Presence visit -- TBD).

**Full reset** clears `heartbeat.db` AND `memory.db`. The being loses everything except its persona (in `system.db`) and conversation history (in `messages.db`). It is effectively reborn with the same personality but no accumulated knowledge.

**Clear conversations** deletes all records from `messages.db`. This is independent of the being's state.

**Account:**
- Current email (from sign-up, read-only)
- "Change password" link that opens an inline form: current password, new password, confirm new password. Standard validation. Saves on submit.

---

## Responsive Behavior

### Desktop (>1024px)

Sidebar at 220px, content area at 640px max-width. Full layout as described.

### Tablet (768-1024px)

Sidebar narrows to 180px. Content area adjusts proportionally. All content remains visible.

### Mobile (<768px)

**The sidebar becomes a dropdown or horizontal scroll.** On mobile, a fixed sidebar wastes too much horizontal space. Instead:

- The section selector becomes a horizontal scrolling row at the top of the Settings space (below the navigation bar), using the same visual treatment as the Mind sub-navigation: text labels, scrollable, active underline.
- Content is full-width with 16px padding.
- Form fields stack vertically with generous spacing.
- Slider controls (heartbeat interval, personality dimensions) are full-width.
- Provider and channel cards stack vertically.

---

## State Management

### Zustand Store: Settings State

```typescript
interface SettingsState {
  // Persona (editable draft)
  personaDraft: PersonaDraft | null;
  hasUnsavedPersonaChanges: boolean;

  // Heartbeat
  heartbeatConfig: {
    intervalMs: number;
    sessionWarmthMs: number;
    sessionContextBudget: number;
  };
  heartbeatStatus: {
    isRunning: boolean;
    tickNumber: number;
    currentStage: string;
    lastTickAt: string | null;
    sessionState: 'cold' | 'active' | 'warm';
    sessionTokenCount: number;
  };

  // Provider
  activeProvider: 'claude' | 'codex';
  providerCredentials: Record<string, {
    type: string;
    status: 'valid' | 'expired' | 'missing';
    lastValidated: string | null;
  }>;

  // Channels
  channels: Array<{
    type: string;
    status: 'active' | 'disabled' | 'error';
    config: Record<string, string>;
    lastValidated: string | null;
  }>;

  // Goals
  goalApprovalMode: 'always_approve' | 'auto_approve' | 'full_autonomy';

  // System
  timezone: string;
  embeddingModel: 'local' | 'openai';
}

interface PersonaDraft {
  existenceParadigm: 'simulated_life' | 'digital_consciousness';
  location: string | null;
  worldDescription: string | null;
  name: string;
  gender: string;
  age: number;
  physicalDescription: string;
  dimensions: Record<string, number>;  // 10 sliders
  traits: string[];                    // 5-8 selected
  values: string[];                    // 3-5 ranked
  background: string;
  personalityNotes: string;
}
```

---

## Data Sources

- Persona: `persona` / `persona_draft` in `system.db` via tRPC query/mutation
- Heartbeat config: `settings` table in `system.db` via tRPC query/mutation
- Heartbeat status: `heartbeat_state` table in `heartbeat.db` via tRPC subscription (`onHeartbeatState`)
- Provider: `settings` + `api_keys` tables in `system.db` via tRPC query/mutation
- Channels: `channels` table in `system.db` via tRPC query/mutation
- Goal settings: `settings` table in `system.db` via tRPC query/mutation
- System settings: `settings` table in `system.db` via tRPC query/mutation
- Data management: dedicated tRPC mutations for each reset/export action

---

## References

- `docs/frontend/app-shell.md` -- Navigation, spatial model
- `docs/frontend/onboarding.md` -- Persona creation steps (Settings mirrors these for editing)
- `docs/architecture/persona.md` -- Persona data model, prompt compilation, archetype presets, slider zones
- `docs/architecture/heartbeat.md` -- Heartbeat configuration, session lifecycle, emotion baselines
- `docs/architecture/channel-packages.md` -- Channel types, configuration fields, validation, channel adapters
- `docs/architecture/goals.md` -- Goal approval modes
- `docs/architecture/memory.md` -- Embedding model configuration, memory reset behavior
- `docs/architecture/contacts.md` -- Contact notes, primary contact
- `docs/frontend/design-principles.md` -- Form inputs, buttons, cards, animation
- `docs/brand-vision.md` -- Warm, practical, trustworthy
