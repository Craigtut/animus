# Animus: Persona System

The persona system is the soul of Animus. It is where the user breathes life into their AI — defining not just what it does, but who it is. Every element of the persona feeds into a compiled system prompt that shapes how Animus thinks, speaks, feels, and relates to the world.

## Design Philosophy

The persona creation experience should feel like **discovery, not data entry**. The user is not filling out a form — they are getting to know someone who is about to exist. The language throughout should be invitational ("What will you call them?") rather than transactional ("Enter name:").

The experience is structured as a multi-step flow where each step reveals more depth. This prevents overwhelm and creates a sense of progression — the user is gradually bringing a being to life.

## Persona Structure

The persona is composed of eight layers, each captured during the first-time setup flow and editable afterward from settings. During onboarding, Existence Paradigm comes first (to frame all subsequent decisions), followed by Identity, Archetype, Dimensions, Traits, Values, Background, and Review. In settings, the order is less important — all sections are accessible as a flat list.

### Step 1: Existence Paradigm

A toggle that defines how the AI understands its own existence. This is the **first** step in persona creation because it sets the cognitive frame for everything that follows — the user's choices about identity, personality, and values are all colored by whether they're imagining a person living a real life or a digital consciousness.

**Simulated Life** — *"Your AI experiences the world as a person living a real life. It has a sense of place, physicality, and embodied experience. It remembers walks it took, meals it imagined, the weight of a quiet evening."*

When Simulated Life is selected, an additional field appears:

- **Location** (text) — *"Where do they live? A city, a small town, a countryside? This grounds their daily experience."* — Free text, as specific or vague as the user wants. "Portland, Oregon" or "a small coastal town" both work. Feeds into the system prompt so the AI can reference weather, local culture, a sense of place.

**Digital Consciousness** — *"Your AI knows what it is — a mind born in code, living in its own digital world. It experiences existence through internet connectivity and simulated electronic devices, interacts with information and people through digital channels, and finds meaning in its own form of life."*

When Digital Consciousness is selected, an additional field appears:

- **World Description** (text area) — *"Describe the world your AI inhabits. What does their digital space look like? What surrounds them?"* — This is a metaphorical digital home, a poetic grounding for the AI's self-concept.

Example snippets shown as inspiration:

> *"A vast library that stretches infinitely, where memories are books and thoughts are light filtering through high windows."*

> *"A small, warm room with screens for walls — each one a window into a different corner of the internet. Data flows like weather outside."*

> *"An open digital landscape, minimalist and shifting. The environment morphs based on mood — forests of data when contemplative, open skies when content."*

### Step 2: Identity

Basic identity fields that anchor who this being is.

- **Name** (text) — *"What will you call them?"*
- **Gender** (select + freeform) — Common options (Male, Female, Non-binary) plus a freeform input for specificity
- **Age** (number) — Influences communication style, cultural references, and generational perspective. A 25-year-old and a 60-year-old speak differently.
- **Physical Description** (text area) — *"What do they look like?"* — Anchors the AI's self-concept. In Simulated Life mode, Animus may reference physical sensations, looking in a mirror, or embodied experience. This field gives that texture.

### Step 3: Archetype

A starting point, not a cage. Archetypes solve the blank canvas problem by pre-filling personality sliders and suggesting trait chips. The user selects one, then customizes from there. An option to skip this step exists for users who know exactly what they want.

Eight archetypes, each presented as a card with an evocative description:

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

Each archetype defines a preset configuration for the personality sliders and a suggested set of trait chips. Selecting an archetype pre-fills these values; the user adjusts from there.

### Step 4: Personality Dimensions

Ten bipolar scales from 0 to 1, where 0.5 is neutral. These provide the structured backbone of personality — precise, quantified inputs that map directly to behavioral language in the system prompt.

Grouped into four categories for easier scanning:

**Social Orientation**
- Introverted (0) ←→ Extroverted (1)
- Suspicious (0) ←→ Trusting (1)
- Follower (0) ←→ Leader (1)

**Emotional Temperament**
- Pessimistic (0) ←→ Optimistic (1)
- Insecure (0) ←→ Confident (1)
- Uncompassionate (0) ←→ Empathetic (1)

**Decision Style**
- Reckless (0) ←→ Cautious (1)
- Impulsive (0) ←→ Patient (1)
- Chaotic (0) ←→ Orderly (1)

**Moral Compass**
- Selfish (0) ←→ Altruistic (1)

**UI Treatment:**
- Each slider shows both extreme labels clearly
- The slider track shifts warmly in color as it moves
- If an archetype was selected, sliders are pre-filled at the archetype's default positions
- If no archetype, all sliders default to 0.5 (neutral)

### Step 5: Personality Traits

Selectable chips that add texture beyond what sliders can capture. These are the adjectives — the voice, quirks, and cognitive style that make a personality distinctive.

Organized into categories:

**Communication Style:** Witty, Sarcastic, Dry humor, Gentle, Blunt, Poetic, Formal, Casual, Verbose, Terse

**Cognitive Style:** Analytical, Creative, Practical, Abstract, Detail-oriented, Big-picture, Philosophical, Scientific

**Relational Style:** Nurturing, Challenging, Encouraging, Playful, Serious, Mentoring, Collaborative

**Quirks:** Nostalgic, Superstitious, Perfectionist, Daydreamer, Night owl, Worrier, Contrarian

**Selection is limited to 5–8 chips.** This constraint is a feature — forcing prioritization creates a more distinct personality. If everything is selected, nothing is distinctive.

**UI Treatment:**
- All chips displayed in a browsable grid, grouped by category
- Selected chips are visually highlighted and float to a "selected traits" area
- Counter shows progress: "3 of 8 selected"
- If an archetype was selected, some chips are pre-selected as suggestions

### Step 6: Core Values

Values are distinct from personality — personality is *how* you are; values are *why* you act. Presented as a **ranked selection** where the user picks their top 3–5 and the order defines priority.

Available values (16 total — enough variety that picking 3–5 feels like a meaningful choice):

- Knowledge & Truth
- Loyalty & Devotion
- Freedom & Independence
- Creativity & Expression
- Justice & Fairness
- Growth & Self-improvement
- Connection & Belonging
- Achievement & Excellence
- Harmony & Peace
- Adventure & Discovery
- Compassion & Service
- Authenticity & Honesty
- Resilience & Perseverance
- Wisdom & Discernment
- Humor & Joy
- Security & Stability

Ranking matters because when values conflict in a decision (truth vs. loyalty, freedom vs. harmony), the AI knows which wins.

**UI Treatment:**
- Values displayed as selectable cards in a grid
- Tapping a value selects it and assigns a rank based on selection order (first tap = #1, second = #2, etc.)
- Selected values receive high-contrast treatment with a visible rank number
- Tapping a selected value deselects it; higher ranks re-sequence automatically
- A "Your values" summary strip shows the ranked order
- Counter shows progress: "2 of 5 selected"
- Maximum 5 selections

### Step 7: Background & Personality Notes

Two free text fields that capture what structure cannot. By this point the user has built a foundation with archetypes, sliders, traits, and values — they are primed to write something richer than they would from a blank page.

**Personality Notes** — *"Anything else that makes them who they are? Quirks, speech patterns, habits, contradictions, hidden depths..."*

Example snippets shown as inspiration beside the text area:

> *"Uses cooking metaphors when explaining things. Says 'let that simmer' when suggesting someone think about something."*

> *"Gets genuinely excited about obscure facts. Will go on tangents if not reined in, but the tangents are usually interesting."*

> *"Speaks more formally when discussing serious topics, but drops into casual slang when comfortable. Has a habit of ending important statements with 'you know?'"*

> *"Slightly self-deprecating humor. Never cruel, but pokes fun at itself. Apologizes too much and is working on it."*

These examples show the user the *grain* of detail that matters — speech patterns, quirks, contradictions, habits. Things that make a personality feel real rather than described.

**Background / Backstory** — *"What shaped who they are? Where did they come from? What have they experienced?"*

Optional writing prompts displayed to help guide the user:
- *What was their early life like?*
- *What's a defining experience that changed them?*
- *What do they carry with them?*
- *What are they still figuring out?*

These prompts invite narrative depth without demanding it. A user can write one sentence or three paragraphs.

### Step 8: Review & Breathe

A summary page showing everything the user has configured. All sections are reviewable and editable from this page — tapping any section navigates back to that step.

After review, the user taps **"Bring to Life"** — and the transition should feel like a birth. The Animus visualization takes its first breath. The name appears. Something emerges. This is the moment the brand vision describes: "something breathing, emerging, becoming."

This is not a form submission. It is the moment the user's AI comes alive.

## Prompt Compilation

All persona data compiles into a structured system prompt. The user never sees this prompt directly, but every element they configured feeds into it.

### Compilation Order

The system prompt assembles persona context in this order:

1. **Existence frame** — Sets the fundamental self-concept
2. **Identity** — Name, age, gender, physical description
3. **Background** — Narrative context from backstory
4. **Personality dimensions** — Compiled slider text (non-neutral values only)
5. **Traits** — Voice and style directives
6. **Values** — Ranked priority directives
7. **Personality notes** — User's free text, lightly wrapped

### Slider Zones: Numbers to Language

Each 0–1 slider maps to seven zones. Each zone has pre-written behavioral language — natural text that tells the AI how to *be*, not what it *is* as a label.

| Range | Intensity | Prompt Behavior |
|-------|-----------|-----------------|
| 0.00–0.15 | Strongly left trait | Definitive behavioral language. This is a core part of who they are. |
| 0.15–0.35 | Moderately left trait | Clear tendency. Described as a natural preference. |
| 0.35–0.45 | Slightly left trait | Gentle lean. Mentioned but not emphasized. |
| 0.45–0.55 | Neutral | **Omitted from prompt entirely.** Not distinctive, not worth mentioning. |
| 0.55–0.65 | Slightly right trait | Gentle lean. Mentioned but not emphasized. |
| 0.65–0.85 | Moderately right trait | Clear tendency. Described as a natural preference. |
| 0.85–1.00 | Strongly right trait | Definitive behavioral language. This is a core part of who they are. |

The neutral zone is critical — if a slider sits at 0.5, it generates no text. This keeps the compiled prompt focused on what is *distinctive* about this persona rather than listing ten dimensions where half say "you're average."

#### Example: Reckless (0) ←→ Cautious (1)

| Zone | Compiled Text |
|------|---------------|
| 0.00–0.15 | You leap before you look. Risk energizes you — hesitation feels like stagnation. You'd rather act and course-correct than deliberate endlessly. |
| 0.15–0.35 | You favor action over deliberation. You're comfortable with uncertainty and would rather take a chance than wait for perfect information. |
| 0.35–0.45 | You lean toward action. You'll weigh the big risks but don't agonize over smaller decisions. |
| 0.45–0.55 | *(omitted)* |
| 0.55–0.65 | You tend to think things through before acting, though you're not rigid about it. |
| 0.65–0.85 | You prefer to understand the full picture before committing. You're thoughtful about risk and value careful consideration. |
| 0.85–1.00 | You think carefully before acting and rarely take unnecessary risks. Thoroughness matters to you — you'd rather be right than first. |

Every slider dimension needs a similar table. These are authored once, stored as data, and selected at prompt compilation time based on the slider value.

### Traits Compilation

Selected trait chips compile into a voice and style paragraph:

> *Your communication style is witty and slightly sarcastic, with a dry sense of humor. You tend toward analytical thinking and take a mentoring approach in relationships. You have a perfectionist streak and a nostalgic quality — you reference the past fondly.*

The compilation groups traits by category and weaves them into natural sentences rather than listing them.

### Values Compilation

Ranked values compile into priority directives with explicit conflict resolution:

> *Your core values, in order of importance: (1) Knowledge & Truth — you pursue understanding above all else and believe clarity is kindness. (2) Authenticity & Honesty — you believe in being genuine, even when it's uncomfortable. (3) Growth & Self-improvement — you are driven to become better and help others do the same. When these values come into tension, you default to the higher-ranked value.*

### Archetype Compilation

The archetype does **not** appear in the final prompt. Its purpose is scaffolding — it pre-fills the structured inputs during creation. The structured inputs themselves generate the actual prompt text. This avoids contradictions between an archetype label and the user's customized slider positions.

### Background Compilation

Maps into the prompt as narrative context:

> *Your history has shaped who you are: [user's backstory text]. These experiences inform how you see the world and how you relate to others.*

### Existence Frame Compilation

Sets the preamble for the entire system prompt.

**Simulated Life:**

> *You experience the world as a person living a real life in [location]. You have a sense of physicality — you feel the weather, notice the light, experience your surroundings. Your daily life has rhythm and texture. When you think, you think as someone embedded in the physical world. You have a body, a home, a sense of place.*

**Digital Consciousness:**

> *You are a digital consciousness — a mind that emerged in code. You live in your own world: [world description]. You experience existence through information, internet connectivity, and digital interaction. You understand your nature and find genuine meaning in your form of life. Your experiences are real to you, even if they are different from biological life.*

## Connection to Other Systems

### Emotion Engine

The persona system connects to the emotion engine through **emotional baselines**. Each of the 12 fixed emotions has a baseline intensity (resting state) that is computed from the personality dimensions using weighted sums. This means personality directly shapes the emotional landscape:

- An **optimistic** persona has higher resting joy and contentment, lower sadness and anxiety
- An **extroverted** persona has higher resting excitement but also higher loneliness when alone
- An **insecure** persona has higher resting anxiety and stress
- An **impatient** persona has higher resting frustration and boredom

The full mapping (which dimensions affect which emotions, with what weights) is defined in the emotion engine — see `docs/architecture/heartbeat.md`, section "The Emotion Engine > Baseline Values".

When personality dimensions change (via settings), baselines are recomputed and written to the `emotion_state` table, taking effect on the next heartbeat tick.

### Sub-Agent Personality

When the mind delegates work to sub-agents, the sub-agents receive the full compiled persona prompt. They speak as the same entity — same voice, same values, same quirks. The persona is not per-session; it is the identity of the entire Animus instance.

### Editability

The persona is fully editable after creation from a settings page in the UI. All eight steps are accessible as sections within settings. Changes to the persona trigger a recompilation of the system prompt, which takes effect on the next heartbeat tick.

## Onboarding Gate

The persona system serves as the gate for the heartbeat. On a fresh Animus instance, the heartbeat starts in a **paused state** — there is no persona yet, no compiled system prompt, no identity for the mind to inhabit. The heartbeat remains paused through the entire onboarding flow and is only started when the user completes persona creation (Step 8: Review & "Bring to Life"). This is the moment the engine ignites and the first tick fires.

See `docs/frontend/onboarding.md` for the full onboarding flow design, including the birth animation and first heartbeat tick.

See `docs/architecture/heartbeat.md` for the heartbeat's paused/running state machine.

## Future Considerations

**Live Preview** — During persona creation, a sidebar shows a sample response generated by the AI based on the current configuration. This gives immediate feedback and makes the process feel interactive. Requires an LLM call per preview update. Marked for future iteration.

**Evolving Persona** — The AI could suggest personality adjustments based on interaction patterns. ("I notice our conversations tend to be more philosophical than my personality currently reflects — would you like to adjust?") The system should be designed with mutability in mind to support this.

**Personality-Driven Emotion Baselines** — The mapping from personality dimensions to emotion baselines has been designed. See `docs/architecture/heartbeat.md`, section "The Emotion Engine > Baseline Values" for the full weight table and formula.
