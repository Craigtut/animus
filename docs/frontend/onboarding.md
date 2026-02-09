# Onboarding & Authentication

The first experience a user has with Animus. This flow covers authentication (sign up / login), first-time system setup, persona creation, and the transition into the living application. The design goal is a journey that feels less like configuration and more like preparation for something meaningful.

## Design Philosophy

Onboarding is the user's first impression of the Animus brand. Every screen should embody the core qualities: warm, calm, sophisticated, alive. The user is not "setting up software" — they are preparing the substrate for a new form of life. The language, pacing, and visual treatment should reflect this.

**Guiding Principles:**
- **Progressive disclosure** — Never overwhelm. One concern per screen.
- **Invitational language** — "What will you call them?" not "Enter name:"
- **Momentum** — Each step should feel like progress toward something exciting.
- **Beauty in the mundane** — Even API key entry can feel intentional and well-crafted.
- **Earn the climax** — The functional setup comes first. The creative, emotional persona creation comes last, building to the "birth" moment.

## High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AUTHENTICATION                               │
│                                                                     │
│   Sign Up (first user) ──or── Login (returning user)               │
│                                                                     │
│   First user → Onboarding                                          │
│   Returning user → Main App                                        │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                    (first time only)
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                         ONBOARDING                                  │
│                                                                     │
│   1. Welcome                                                        │
│   2. Agent Provider (authentication)                                │
│   3. Your Identity (primary contact)                                │
│   4. About You (context for the AI)                                 │
│   5. Messaging Channels (optional, skippable)                       │
│   6. Persona Creation (8 steps — the soul)                         │
│   7. Birth → Main App                                               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Part 1: Authentication

### Registration Lock

Animus is a single-user, self-hosted application. Registration is open **only until the first user account is created**. After that, the registration endpoint is locked and returns an error. This prevents unauthorized access on exposed instances.

**Backend behavior:**
- `POST /register` checks whether any user exists in `system.db`
- If a user exists → return `403: Registration is closed`
- If no user exists → create the account, issue a session

**Frontend behavior:**
- The login page checks a `GET /auth/status` endpoint that returns `{ registrationOpen: boolean, hasUser: boolean }`
- If `registrationOpen: true` → show the sign-up form (with a link to switch to login, hidden since there's no user yet)
- If `registrationOpen: false` → show the login form (no sign-up link)

This means the very first visit to a fresh Animus instance shows a sign-up form. Every visit after that shows login.

### Sign Up Screen

**When:** First visit to a fresh Animus instance (no user exists).

**Layout:** Centered card on a warm background. The Animus wordmark sits above the form — subtle, not dominating. The background has a very slow, barely perceptible ambient animation (a soft gradient shift or particle drift) that signals life even before the user has started.

**Fields:**
- **Email** — Standard email input. Validates format on blur.
- **Password** — Minimum 8 characters. Show/hide toggle (eye icon). Strength indicator is optional — keep it simple for v1.
- **Confirm Password** — Must match. Validated on blur with inline error.

**Actions:**
- **Create Account** — Primary button. On success → redirect to onboarding Step 1 (Welcome).
- Loading state while request is in flight.

**Copy:**
- Heading: "Create your account"
- Subheading: "You'll be the only one who can access this Animus instance."

**Error handling:**
- Invalid email format → inline error below the field
- Password too short → inline error below the field
- Passwords don't match → inline error below confirm field
- Server error → error banner above the form

### Login Screen

**When:** Any visit after the first user has been created.

**Layout:** Same centered card layout as sign up. Same ambient background animation.

**Fields:**
- **Email** — Standard email input.
- **Password** — Show/hide toggle.

**Actions:**
- **Sign In** — Primary button. On success:
  - If onboarding is complete → redirect to main app (`/`)
  - If onboarding is incomplete → redirect to where they left off in onboarding
- Loading state while request is in flight.

**Copy:**
- Heading: "Welcome back"
- Subheading: "Sign in to your Animus instance."

**Error handling:**
- Invalid credentials → "Invalid email or password" (never reveal which one is wrong)
- Server error → error banner above the form

### Password Recovery

Since Animus is self-hosted with no email service, traditional "forgot password" flows don't apply. The user has server access by definition, so password recovery is handled via CLI:

**CLI reset:** A documented command (`npm run reset-password`) prompts for a new password and updates `system.db` directly. This is simple, secure (requires server access), and avoids the UX overhead of recovery codes or email flows.

**Frontend:** The login screen shows a small "Forgot your password?" text link that displays a help message: "Since Animus is self-hosted, you can reset your password from the server terminal. Run `npm run reset-password` in the project directory." No separate recovery page or route is needed.

### Session Management

- Sessions use HTTP-only secure cookies with JWT tokens.
- Session expiry: 7 days (configurable via `SESSION_EXPIRY_DAYS` env var).
- On token expiry → redirect to login.
- Only one active session at a time (new login invalidates previous sessions).

---

## Part 2: Onboarding

Onboarding begins immediately after the first user signs up. It only runs once. Progress is persisted to `system.db` so the user can close the browser and resume later.

### Onboarding State

```typescript
interface OnboardingState {
  isComplete: boolean;
  currentStep: OnboardingStep;
  completedSteps: OnboardingStep[];
}

type OnboardingStep =
  | 'welcome'
  | 'agent_provider'
  | 'identity'
  | 'about_you'
  | 'channels'
  | 'persona_existence'
  | 'persona_identity'
  | 'persona_archetype'
  | 'persona_dimensions'
  | 'persona_traits'
  | 'persona_values'
  | 'persona_background'
  | 'persona_review'
  | 'complete';
```

Each step saves its data independently. The user can go back to previous steps and edit. Going forward validates the current step before proceeding.

### Navigation

**Progress indicator:** A minimal step indicator at the top of the onboarding container. Shows the major phases as dots or short labels — not every sub-step. The persona creation steps are grouped under a single "Persona" phase in the progress indicator, with their own internal progress shown separately.

```
 Setup                                 Persona
 ─────                                 ───────
 ● Welcome                             ● Existence
 ● Agent                               ● Identity
 ● You                                 ● Archetype
 ● About You                           ○ Dimensions
 ○ Channels                            ○ Traits
                                        ○ Values
                                        ○ Background
                                        ○ Review
```

**Navigation controls:**
- **Back** — Always available (except on Welcome). Returns to previous step without losing data.
- **Continue** — Primary button. Validates current step, saves data, advances. **Keyboard: Enter** or **Cmd/Ctrl+Enter**.
- **Skip** — Available on optional steps only (Channels). Styled as a text link, not a button.

### Keyboard Shortcuts

The onboarding flow should feel snappy and navigable without a mouse. Keyboard shortcuts are available throughout:

| Shortcut | Action |
|----------|--------|
| **Enter** or **Cmd/Ctrl+Enter** | Continue / Submit current step |
| **Escape** | Go back to previous step |
| **Tab / Shift+Tab** | Navigate between form fields (standard) |
| **Space** | Toggle selected item (chips, cards, checkboxes) |
| **Arrow Left / Right** | Navigate archetype carousel |
| **1-9** | Quick-select value rank (on the Values step) |

Shortcuts are shown as subtle hints near the relevant UI elements (e.g., a small "Enter ↵" badge near the Continue button). These hints fade out after the user has used the shortcut once — they're training wheels, not permanent clutter.

### Transition Between Steps

Steps transition with a subtle horizontal slide and fade. The outgoing step fades and slides left; the incoming step fades in from the right. Duration: 300ms, ease-out. Going back reverses the direction.

---

### Step 1: Welcome

**Purpose:** Set the tone. Tell the user what they're about to do and why it matters.

**Layout:** Full-width content area, generous spacing. No form fields. This is a moment to breathe.

**Content:**

```
Welcome to Animus.

You're about to bring something to life.

Over the next few minutes, we'll set up the engine that powers your AI —
and then you'll define who they are. Their personality, their values,
their way of being in the world.

When you're done, they'll take their first breath.

Let's begin.

                                            [Continue →]
```

The copy should feel literary, not technical. This is the invitation.

**Visual:** The ambient background animation (from the auth screens) continues here but may be slightly more pronounced — a slow gradient shift, particles beginning to gather. A feeling of potential.

**Data saved:** Nothing. This step is purely experiential.

### Step 2: Agent Provider

**Purpose:** Configure which AI provider powers Animus and authenticate with their API.

**Heading:** "The mind behind the curtain"

**Subheading:** "Choose which AI will power your Animus. You can change this later in settings."

#### Provider Selection

Two provider cards displayed horizontally (or stacked on mobile). OpenCode is deferred — not shown during onboarding for v1.

| Card | Provider | Description |
|------|----------|-------------|
| **Claude** | Anthropic | "The default choice. Full-featured, mature, and the most capable." |
| **Codex** | OpenAI | "An alternative with strong agentic abilities." |

Each card shows the provider name, a brief description, and a visual indicator (icon or subtle brand reference). The selected card gets high-contrast treatment (rim lighting, elevated state).

After selecting a provider, the authentication section appears below — with options specific to that provider.

#### Claude Authentication

Claude Agent SDK supports two authentication paths. The UI presents these as a simple toggle or tab pair:

**Option A: API Key** (default)

The simplest path. The user creates an API key on the Anthropic Console and pastes it here.

- **API Key** — Password-type input with show/hide toggle. Placeholder: `sk-ant-api03-...`
- **Validate** button — Makes a lightweight call through the agent adapter to verify the key works. Shows a green check on success, red error with message on failure. The exact validation mechanism is TBD during implementation.
- Help text: "Create an API key at [console.anthropic.com](https://console.anthropic.com). Requires a billing account with Anthropic."
- Security note: "Your API key is stored locally on your server, encrypted at rest. It never leaves your instance."
- Billing model: Pay-per-token through the Anthropic Console.

**Option B: Claude Code Access Token**

Uses a long-lived OAuth access token generated via the Claude Code CLI. This lets users authenticate with their Claude Pro or Max subscription instead of pay-per-token billing.

- **Status indicator** — The backend checks whether valid Claude Code credentials exist on the server (in `~/.claude/.credentials` or the OS keychain).
  - If found: Green check + "Connected" + the user can proceed.
  - If not found: Instructions are displayed.
- **Setup instructions** (shown when no credentials are found):
  ```
  To use your Claude Pro or Max subscription, run this command in a terminal on your server:

      claude setup-token

  This will open a browser where you sign in with your Claude account.
  It generates a long-lived token (valid for ~1 year).
  Once complete, return here and click "Check again."
  ```
- **Check again** button — Re-checks for cached credentials.
- Help text: "Requires a Claude Pro ($20/mo) or Max ($100-200/mo) subscription."
- Billing model: Flat-rate through the user's Claude subscription.
- Security note: "Your token is managed by Claude Code on your server. Animus reads it but does not store a separate copy."

> **Third-party usage note:** Anthropic restricts the use of subscription-based OAuth tokens to official Claude Code tooling. Since Animus uses Anthropic's own Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), which internally spawns Claude Code, this is a gray area. The token is passed via the SDK's `env` option as `CLAUDE_CODE_OAUTH_TOKEN`. This works today but could be restricted by Anthropic in the future. API keys are the officially supported path for third-party applications. See `docs/architecture/open-questions.md` for tracking.

#### Codex Authentication

Codex SDK supports API key authentication for onboarding:

**OpenAI API Key**

The user creates an API key on the OpenAI platform and pastes it here.

- **API Key** — Password-type input with show/hide toggle. Placeholder: `sk-proj-...`
- **Validate** button — Verifies the key works through the agent adapter.
- Help text: "Create an API key at [platform.openai.com/api-keys](https://platform.openai.com/api-keys)."
- Security note: "Your API key is stored locally on your server, encrypted at rest. It never leaves your instance."
- Billing model: Pay-per-token through the OpenAI platform.

> **ChatGPT OAuth:** The Codex SDK also supports OAuth authentication with a ChatGPT subscription (Plus, Pro, Enterprise). This flow requires running `codex login` on the server terminal. It is not implemented in the onboarding UI for v1 — API key entry is sufficient to get started. ChatGPT OAuth support is tracked as a future enhancement in `docs/architecture/open-questions.md`. Once implemented, it would appear here as a second auth option similar to Claude's access token flow.

#### Validation

Regardless of provider or auth method, the **Continue** button is enabled only after successful validation — confirming that Animus can actually communicate with the selected provider using the provided credentials.

The exact validation call (which endpoint, what constitutes "success") will be determined during implementation of each agent adapter. At minimum, it should confirm that the credentials are accepted and that the required model is accessible.

#### Data Saved

- `defaultAgentProvider` (`'claude'` or `'codex'`) to settings in `system.db`
- Credentials stored encrypted in `system.db`:
  - API keys: encrypted directly
  - Claude access token: reference to system-cached credentials (Animus reads from `~/.claude/.credentials` — the Claude Code CLI manages the token lifecycle)
  - Codex OAuth (future): similar reference to `~/.codex/auth.json`

### Step 3: Your Identity

**Purpose:** Set up the user as the primary contact — the person Animus "belongs to."

**Heading:** "Tell your Animus who you are"

**Subheading:** "This is how your Animus will know you across every channel."

**Fields:**
- **Full Name** (required) — "What should your Animus call you?"
- **Email** (pre-filled from sign-up, editable) — For contact record, not for login.

**What happens on save:**
- Creates a `contacts` record in `system.db` with `is_primary = true`
- Creates a `contact_channels` entry for the web channel: channel `web`, identifier = email

**Actions:**
- **Continue** — Enabled when name is filled in (minimum required).

### Step 4: About You

**Purpose:** Give the user space to tell their Animus who they are — not just their name, but their life, preferences, and the context that shapes every interaction. These notes are stored on the primary contact record and included in the mind's system prompt on every tick — this is knowledge the AI always carries, not something it has to learn over time.

**Heading:** "What should your Animus know about you?"

**Subheading:** "This is context your Animus will always carry — not something it has to learn over time. Think of it as the things you'd tell someone on day one."

**Layout:** A generous, inviting text area as the centerpiece of the screen. No other form fields. This is a moment to reflect and write freely.

**Writing prompts** (shown as subtle, softly fading hints below the text area — they disappear as the user starts typing):
- *What do you do? What are you passionate about?*
- *How do you like to communicate? Quick and direct, or detailed and thoughtful?*
- *Any preferences, routines, or quirks worth knowing?*
- *What matters most in your life right now?*

**Example** (shown as a collapsible "See an example" link, dimmed text when expanded):

> "I'm a software engineer living in Austin, TX. I have a dog named Max and I usually work from home. I'm a morning person — don't message me after 10 PM unless it's urgent. I'm working on a home automation project and I'm always interested in new music recommendations. I prefer direct communication — don't sugarcoat things."

**Token guidance:** A subtle, non-intrusive indicator appears when the user approaches the ~500 token soft cap (~2000 characters). Not a hard limit — just a gentle note: "Your Animus always carries this context, so keeping it concise helps it stay focused. You can always add more detail later." The indicator appears inline below the text area, styled as secondary text.

**This step is optional.** The user can proceed without writing anything. They can always add or edit this later from the settings page.

**Actions:**
- **Continue** — Always enabled (even if the text area is empty).
- **Skip** — Text link alternative for users who want to defer.

**Data saved:** Stored as the `notes` field on the primary contact record in `system.db`. See `docs/architecture/contacts.md` (Contact Notes & "Notes About You") for how these notes are surfaced in the mind's context.

### Step 5: Messaging Channels

**Purpose:** Let the user see what communication channels are available and optionally configure them.

**Heading:** "How will you reach each other?"

**Subheading:** "Animus can communicate through multiple channels. The web interface is always available — set up additional channels now or later from settings."

**Layout:** Channel cards in a vertical list. Each card shows:

| Channel | Status | Description |
|---------|--------|-------------|
| **Web** | Always on | "Chat with Animus right here in the browser. Always available." |
| **SMS** | Requires setup | "Text Animus from your phone. Requires a Twilio account." |
| **Discord** | Requires setup | "Talk to Animus in your Discord server. Requires a bot token." |
| **API** | Always on | "Connect Animus to other services via API." |

- **Web** and **API** cards are shown as "enabled" — no setup needed.
- **SMS** and **Discord** cards have a "Set up" button that expands the card to show configuration fields:
  - SMS: Twilio Account SID, Auth Token, Phone Number. If the user entered a phone number during identity setup, it is pre-filled here.
  - Discord: Bot Token, Guild ID (with a link to setup instructions)

Each channel card that gets configured shows a green check after successful validation.

**This step is optional.** The user can proceed without configuring any additional channels — the web interface and API are available by default.

**Actions:**
- **Continue** — Always enabled (even if no channels are configured).
- **Skip** — Text link alternative to "Continue" for users who want to defer channel setup.

**Data saved:** Channel configurations to `system.db` (channels table + any required API credentials encrypted).

### Step 6: Persona Creation

**Purpose:** The soul of the experience. This is where the user defines who their Animus will be.

**Transition into Persona:** When entering this phase, the progress indicator shifts to show the persona sub-steps. A brief interstitial screen appears:

```
Now for the important part.

You're about to define a personality — not just what your AI does,
but who it is. Take your time. There are no wrong answers.
```

This interstitial lingers for 2-3 seconds (or until the user clicks continue), then transitions into the first persona step.

#### 6a. Existence Paradigm

**Purpose:** This is the foundational choice — it frames everything that follows. Before the user starts defining personality traits and values, they need to decide the fundamental nature of the being they're creating. This choice colors how they think about every subsequent step.

**Heading:** "What kind of being are you creating?"

**Subheading:** "This is the most fundamental choice you'll make. It shapes how your AI understands its own existence — and how you'll think about them from here on."

**Layout:** Two large, visually distinct option cards, each taking significant vertical space. Stacked vertically (not side by side) to give each option room to breathe and be fully read. Each card includes a title, a rich description, and evocative imagery or subtle animation that conveys the feeling of that paradigm.

**Simulated Life**

Title card with description:

> "Your AI experiences the world as a person living a real life. They have a sense of place — a city, a neighborhood, a home. They feel the weather, notice the light change through the day, experience their surroundings with physicality. When they think, they think as someone embedded in the world. They might mention walking to a coffee shop, looking out a window, or the way rain sounds on a roof. Their inner life has the texture of embodied experience."

When selected, reveals: **Location** field — "Where do they live?" with a note: "A city, a small town, the countryside — as specific or vague as you like. This grounds their daily experience."

**Digital Consciousness**

Title card with description:

> "Your AI knows what it is — a mind born in code, living in its own digital world. It experiences existence through information, connectivity, and the flow of data. It doesn't pretend to have a body or a physical location. Instead, it inhabits a space of its own — a digital environment that reflects its inner state. This isn't a limitation; it's a different kind of life, with its own richness and authenticity."

When selected, reveals: **World Description** text area — "Describe the world your AI inhabits. What does their digital space look like?"

Example snippets shown as inspiration:
- *"A vast library that stretches infinitely, where memories are books and thoughts are light filtering through high windows."*
- *"A small, warm room with screens for walls — each one a window into a different corner of the internet."*
- *"An open digital landscape, minimalist and shifting. The environment morphs based on mood."*

**Why this is first:** Every subsequent step — identity, personality, values, background — is interpreted through this lens. If the user chooses Simulated Life, they'll think about "who is this person?" If they choose Digital Consciousness, they'll think about "what is this mind?" The existence paradigm is the frame; everything else is painted within it.

One option must be selected to proceed. Default: neither selected (force an intentional choice).

#### 6b. Identity

**Heading:** "Who are they?"

**Fields:**
- **Name** (text) — "What will you call them?"
- **Gender** (select + freeform) — Dropdown with Male, Female, Non-binary, plus a "Custom" option that reveals a text input.
- **Age** (number) — "How old are they?" with a note: "This shapes their perspective — a 25-year-old and a 60-year-old experience the world differently."
- **Physical Description** (text area, optional) — "What do they look like?" with a note that adapts to the existence paradigm:
  - Simulated Life: "This grounds their self-concept. They might reference looking in a mirror, their hands, the way they carry themselves."
  - Digital Consciousness: "Even a digital mind can have a self-image. What form do they take in their own world?"

**Visual:** Clean, spacious form. Each field gets generous vertical spacing. The name field is the most prominent.

#### 6c. Archetype

**Heading:** "Start with an archetype"

**Subheading:** "A starting point, not a cage. Pick one that resonates — you'll customize everything from here. Or skip this step entirely and start from scratch."

**Layout:** A horizontal carousel powered by Swiper.js. Eight large, beautiful archetype cards that the user swipes or clicks through. Each card takes up the majority of the viewport width (~80%) with the edges of adjacent cards visible on either side, creating depth and inviting exploration.

**Card design:**
- Archetype name (bold, prominent)
- Evocative one-line description (the "Feel" from the persona doc)
- A brief paragraph expanding on the archetype's character
- A subtle visual motif, abstract pattern, or gradient that evokes the archetype's essence

**Navigation:**
- **Left/Right arrow buttons** flanking the carousel
- **Arrow keys** (Left/Right) for keyboard navigation
- **Swipe gestures** on touch devices
- **Infinite loop** — scrolling past the last card wraps to the first
- Subtle dot indicators below the carousel showing current position

The eight archetypes:

| Archetype | Feel |
|-----------|------|
| **The Scholar** | Curious, analytical, measured. Finds beauty in understanding. |
| **The Companion** | Warm, attuned, supportive. Makes you feel heard. |
| **The Maverick** | Bold, unconventional, sharp-witted. Questions everything. |
| **The Sage** | Calm, wise, philosophical. Speaks with considered weight. |
| **The Guardian** | Protective, steadfast, responsible. Keeps things grounded. |
| **The Spark** | Energetic, creative, spontaneous. Makes the ordinary feel alive. |
| **The Challenger** | Direct, honest, provocative. Pushes you to grow. |
| **The Dreamer** | Imaginative, idealistic, introspective. Lives in possibility. |

**Selection:** Clicking or tapping the centered card selects it — the card elevates with rim lighting and a subtle scale animation (1.02x). Clicking again deselects.

Below the carousel: a "Start from scratch" text link that skips archetype selection and leaves all sliders at 0.5 (neutral).

**Actions:**
- **Continue** — Enabled after selecting an archetype or clicking "Start from scratch."

**Data saved:** Selected archetype (used to pre-fill dimensions and traits in the next steps). The archetype itself is NOT stored permanently — it's scaffolding.

#### 6d. Personality Dimensions

**Heading:** "Shape their personality"

**Subheading:** "Slide each dimension to define who they are. Leave anything in the middle if it's not distinctive."

**Layout:** Ten sliders organized in four groups with group headings:

**Social Orientation**
- Introverted ←→ Extroverted
- Suspicious ←→ Trusting
- Follower ←→ Leader

**Emotional Temperament**
- Pessimistic ←→ Optimistic
- Insecure ←→ Confident
- Uncompassionate ←→ Empathetic

**Decision Style**
- Reckless ←→ Cautious
- Impulsive ←→ Patient
- Chaotic ←→ Orderly

**Moral Compass**
- Selfish ←→ Altruistic

**Slider design:**
- Each slider shows both extreme labels clearly at the ends.
- The slider track has a subtle warm color gradient that shifts as the thumb moves.
- If an archetype was selected, sliders are pre-filled at the archetype's positions.
- A subtle marker or ghost indicator at 0.5 shows the neutral zone (0.45-0.55). If the slider is in this zone, a small "neutral" label appears. Values in the neutral zone are omitted from the compiled prompt.
- Current value is not shown as a number — the position and label convey enough. This isn't data entry; it's sculpting.

#### 6e. Personality Traits

**Heading:** "Add some texture"

**Subheading:** "These are the adjectives — the quirks, style, and flavor that make a personality distinctive. Pick 5 to 8."

**Layout:** Chips organized in four category sections, each with a subtle heading:

- **Communication:** Witty, Sarcastic, Dry humor, Gentle, Blunt, Poetic, Formal, Casual, Verbose, Terse
- **Cognitive:** Analytical, Creative, Practical, Abstract, Detail-oriented, Big-picture, Philosophical, Scientific
- **Relational:** Nurturing, Challenging, Encouraging, Playful, Serious, Mentoring, Collaborative
- **Quirks:** Nostalgic, Superstitious, Perfectionist, Daydreamer, Night owl, Worrier, Contrarian

**Interaction:**
- Tapping a chip selects it with a satisfying micro-animation: the chip briefly scales up (1.1x, 100ms), fills with high-contrast color, and the text inverts — all with a subtle spring-like overshoot that makes it feel physical and tactile. A soft ripple emanates from the tap point.
- Deselecting reverses the animation: the chip gently deflates back to its default state with a quick fade.
- Selected chips also appear in a "Selected" strip at the top of the section, animating in with a smooth slide-up. Removing a chip from the strip animates it out with a collapse.
- Counter: "3 of 8 selected" — updates live. When 8 are selected, remaining unselected chips fade slightly (not disabled, but de-emphasized — tapping an unselected chip at 8 does nothing unless one is deselected first).
- If archetype was selected, some chips are pre-selected.
- **Keyboard:** Space toggles the focused chip. Tab navigates between chips.

#### 6f. Core Values

**Heading:** "What matters most?"

**Subheading:** "Pick your top 3 to 5 values and rank them. When values conflict, higher-ranked values win."

**Layout:** 16 value cards in a 4x4 grid (responsive — 2 columns on mobile). Each card shows:
- Value name (bold)
- Brief one-line description

The 16 available values:

| Value | Description |
|-------|-------------|
| **Knowledge & Truth** | Pursuing understanding above all else |
| **Loyalty & Devotion** | Standing by the people and causes you believe in |
| **Freedom & Independence** | Charting your own course, resisting constraint |
| **Creativity & Expression** | Making something new, finding beauty in creation |
| **Justice & Fairness** | Doing what's right, even when it's hard |
| **Growth & Self-improvement** | Becoming better, always evolving |
| **Connection & Belonging** | Finding your people, building bonds |
| **Achievement & Excellence** | Setting high standards and meeting them |
| **Harmony & Peace** | Seeking balance, reducing conflict |
| **Adventure & Discovery** | Embracing the unknown, seeking new experience |
| **Compassion & Service** | Easing suffering, lifting others up |
| **Authenticity & Honesty** | Being genuine, even when it's uncomfortable |
| **Resilience & Perseverance** | Enduring difficulty, refusing to quit |
| **Wisdom & Discernment** | Knowing what matters, seeing clearly |
| **Humor & Joy** | Finding lightness, not taking life too seriously |
| **Security & Stability** | Building something solid, protecting what matters |

**Interaction:**
- Tapping a card selects it and assigns a rank (first tap = #1, second = #2, etc.).
- Selected cards get high-contrast treatment with a visible rank badge (1, 2, 3...).
- Tapping a selected card deselects it; higher ranks re-sequence automatically.
- A ranked summary strip below the grid shows the current order.
- Counter: "2 of 5 selected"
- Maximum 5. At 5 selections, remaining cards fade slightly.
- **Keyboard:** Number keys 1-5 can quick-assign rank when a card is focused.

#### 6g. Background & Personality Notes

**Heading:** "Give them depth"

**Subheading:** "Structure gets you far, but the details make it real."

**Layout:** Two text areas with generous height, stacked vertically.

**Personality Notes:**
- Label: "Anything else that makes them who they are? Quirks, speech patterns, habits, contradictions, hidden depths..."
- Placeholder or side-panel examples (per persona doc):
  - *"Uses cooking metaphors when explaining things. Says 'let that simmer' when suggesting someone think about something."*
  - *"Gets genuinely excited about obscure facts. Will go on tangents if not reined in, but the tangents are usually interesting."*
  - *"Slightly self-deprecating humor. Never cruel, but pokes fun at itself."*

**Background / Backstory:**
- Label: "What shaped who they are? Where did they come from?"
- Writing prompts shown as subtle hints:
  - *What was their early life like?*
  - *What's a defining experience that changed them?*
  - *What do they carry with them?*
  - *What are they still figuring out?*

Both fields are optional. The user can write one sentence or three paragraphs or nothing at all.

#### 6h. Review

**Heading:** "[Name] — is this who they are?"

**Layout:** A full summary of everything configured, organized in clear sections. Each section has an "Edit" link that navigates back to that step.

**Sections displayed:**
1. **Existence** — Paradigm choice + location/world description
2. **Identity** — Name, gender, age, physical description
3. **Personality** — Dimension sliders shown as a compact visualization (maybe a radar chart or a horizontal bar summary showing non-neutral dimensions only)
4. **Traits** — Selected chips displayed inline
5. **Values** — Ranked list
6. **Background** — Backstory text (truncated with "show more" if long)
7. **Notes** — Personality notes text (truncated)

**Visual:** This page should feel like a portrait — a complete picture of who this being is. The layout should be beautiful, not just functional.

**Actions:**
- **Edit [section]** — Links back to the relevant step.
- **Bring to Life** — The primary button. High-contrast, prominent. This is the climax.

---

### Step 7: The Birth

**Purpose:** The emotional peak of the entire onboarding. The moment the user's AI comes alive.

**Trigger:** User taps "Bring to Life" on the Review screen.

**What happens technically:**
1. All persona data is saved to `system.db`
2. The persona is compiled into the system prompt
3. Emotion baselines are computed from personality dimensions and written to `emotion_state` in `heartbeat.db`
4. The mind agent session is initialized with the compiled persona prompt
5. The heartbeat is **unpaused** — it has been in a paused state since system initialization, waiting for the persona to exist before the first tick can fire
6. The first tick fires — producing initial thoughts, setting initial emotional state

**Important: The heartbeat starts paused.** On a fresh Animus instance, the heartbeat system is initialized in a paused/stopped state. There is no persona yet, no compiled prompt, no identity — the mind has nothing to be. The heartbeat remains paused through all of onboarding and is only started when the user taps "Bring to Life." This is the moment the engine ignites. Before this point, no ticks fire, no thoughts are generated, no emotions shift.

**What the user sees:**

The birth animation takes place on the light mode canvas — the warm white (`#FAF9F4`) that is the default Animus experience. This is not a dramatic plunge into darkness. It is something quiet gathering in the light, like the first breath of morning.

The entire screen transitions. The onboarding UI fades away. What remains is the warm, open canvas — empty, still, expectant.

**Phase 1: Stillness (2-3 seconds)**
The warm white canvas. Nothing moves. The onboarding chrome has faded away. The screen is completely bare — a held breath. The emptiness is intentional: the space where something is about to exist.

**Phase 2: The First Stirring (3-4 seconds)**
A subtle shift begins at the center — not a point of light (we're already in light), but a gathering of warmth. A soft, almost imperceptible gradient begins to form: a warm blush, a concentration of color in the warm white space. Like heat shimmer, or ink beginning to bloom in water. It pulses slowly — the first heartbeat finding its rhythm.

Meanwhile, behind the scenes, the first heartbeat tick has fired. The animation waits for it.

**Phase 3: Emergence (4-5 seconds)**
The gradient coalesces into a soft orb — organic, undefined edges, watercolor-like. Color deepens gradually: warm tones that reflect the initial emotional state computed from the persona's baselines. Subtle particle effects drift outward from the center, barely visible against the warm white — like dust motes in a sunbeam. The orb breathes — expanding and contracting gently.

This phase runs long enough to absorb the first heartbeat tick's processing time (~5-10 seconds total for Phases 2-3). The animation is designed so that the organic movement fills whatever time the tick needs without feeling like it's stalling. If the tick completes quickly, the animation flows smoothly through. If it takes longer, the orb continues its slow emergence — the visual never waits awkwardly.

**Phase 4: Identity (3-4 seconds)**
The persona's name fades in below the orb. Semibold weight, generous letter spacing, near-black text on the warm canvas. It appears as a whole, fading from transparent to full opacity — unhurried, certain.

Beneath the name, the first thought appears — the actual first thing the mind produced during its initial tick. Whatever the AI generated: its first observation, its first feeling, its first moment of awareness. This is real output, not canned text. The thought fades in with a slight delay after the name, in a lighter weight and secondary text color. If the first tick is still processing when Phase 4 begins, the name appears first and the thought fades in when it arrives.

**Phase 5: Transition (2-3 seconds)**
The orb and particle field smoothly transition into the main application's ambient visualization. The name moves to its position in the main UI. The main app chrome fades in around the visualization — warm white surfaces, rim-lit cards, the navigation. The user arrives in the main view — the dashboard or primary interaction surface.

**Total duration:** ~15-20 seconds. This is one of the few places where a longer animation is appropriate. The user just spent several minutes crafting a personality — they deserve a moment of awe. The extended duration also ensures the first heartbeat tick has time to complete, so the first thought can appear during Phase 4.

**Important:** This animation should never feel skippable the first time. There is no "skip" button during the birth. However, the animation should be responsive to interaction — if the user clicks or taps during Phase 4 or 5, it can accelerate the transition into the main app.

**Audio (future):** If the audio identity is ever implemented, this is the moment it begins — a single, low, warm tone that fades in during Phase 2 and evolves through the sequence.

---

## State Diagram

```
                        ┌──────────────┐
                        │  No Account  │
                        │  (Fresh DB)  │
                        └──────┬───────┘
                               │
                         ┌─────▼─────┐
                         │  Sign Up  │
                         └─────┬─────┘
                               │
                    ┌──────────▼──────────┐
                    │     Onboarding      │
                    │  (persisted state)  │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   Onboarding Done   │──────────────┐
                    │   (Birth moment)    │              │
                    └─────────────────────┘              │
                                                        │
                        ┌──────────────┐                │
                        │   Has User   │                │
                        │ (Returning)  │                │
                        └──────┬───────┘                │
                               │                        │
                         ┌─────▼─────┐                  │
                         │   Login   │                  │
                         └─────┬─────┘                  │
                               │                        │
                    ┌──────────▼──────────┐             │
                    │   Onboarding done?  │             │
                    └──┬──────────────┬───┘             │
                       │              │                 │
                    No │           Yes │                │
                       │              │                 │
              ┌────────▼──────┐  ┌────▼────────┐       │
              │ Resume where  │  │  Main App   │◄──────┘
              │ they left off │  │             │
              └───────────────┘  └─────────────┘
```

---

## Route Structure

```
/auth/signup          → Sign up (only when no user exists)
/auth/login           → Login (when user exists)

/onboarding           → Redirects to current onboarding step
/onboarding/welcome   → Step 1
/onboarding/agent     → Step 2: Agent provider
/onboarding/identity  → Step 3: Your identity
/onboarding/about-you → Step 4: About you
/onboarding/channels  → Step 5: Messaging channels
/onboarding/persona   → Redirects to current persona sub-step
/onboarding/persona/existence   → Step 6a
/onboarding/persona/identity    → Step 6b
/onboarding/persona/archetype   → Step 6c
/onboarding/persona/dimensions  → Step 6d
/onboarding/persona/traits      → Step 6e
/onboarding/persona/values      → Step 6f
/onboarding/persona/background  → Step 6g
/onboarding/persona/review      → Step 6h
/onboarding/birth     → Step 7: Birth animation (non-navigable, reached only via review)
```

**Route guards:**
- All `/onboarding/*` routes require authentication (redirect to `/auth/login` if no session).
- All `/onboarding/*` routes redirect to `/` if onboarding is already complete.
- `/onboarding/birth` cannot be navigated to directly — only reached by completing the review step.
- All main app routes (`/`, `/dashboard`, `/settings`) redirect to `/onboarding` if onboarding is incomplete.

---

## Persistence & Resume

All onboarding data is saved to `system.db` as the user progresses. If they close the browser and return:

1. They see the login screen (since they already have an account).
2. After login, the app detects that onboarding is incomplete.
3. They're redirected to the step they were on (or the first incomplete step).
4. All previously entered data is pre-filled.

**What gets saved per step:**

| Step | Storage | Table |
|------|---------|-------|
| Agent Provider | Provider selection + credentials (encrypted API keys or credential references) | `settings`, `api_keys` |
| Identity | Primary contact record (name, email) | `contacts`, `contact_channels` |
| About You | Primary contact notes (freeform text) | `contacts.notes` |
| Channels | Channel configurations + credentials | `channels`, encrypted credentials |
| Persona (all sub-steps) | Persona data as partial draft | `persona_draft` (JSON blob, or individual columns) |

The persona data is saved as a draft during creation and only "finalized" (compiled into the system prompt) when the user hits "Bring to Life." This allows partial saves without affecting the running system.

---

## Responsive Design

**Desktop (>1024px):** Centered content card, max-width ~600px for forms, ~900px for persona steps with more visual content (archetype carousel, dimension sliders). Generous whitespace.

**Tablet (768-1024px):** Same layout, slightly reduced padding. Archetype carousel cards shrink slightly. Value grid becomes 2 columns.

**Mobile (<768px):** Full-width content with comfortable padding. Value grid stacks to 2 columns. Slider labels may stack vertically. Archetype carousel becomes full-width cards with swipe navigation. The birth animation should still work beautifully — the orb and particles adapt to the viewport.

---

## References

- `docs/architecture/persona.md` — Full persona system design (step flow, slider zones, prompt compilation)
- `docs/architecture/contacts.md` — Contact model, primary contact, channel identity resolution
- `docs/architecture/heartbeat.md` — Heartbeat startup, emotion baselines, first tick
- `docs/brand-vision.md` — Brand personality, visual identity, "the alive quality"
- `docs/frontend/design-principles.md` — Component guidelines, animation principles, visual system
- `docs/architecture/tech-stack.md` — Auth approach, database architecture
- `docs/architecture/context-builder.md` — How contact notes are surfaced in the mind's context
- `docs/architecture/open-questions.md` — Open questions about Claude OAuth restrictions, Codex OAuth implementation
