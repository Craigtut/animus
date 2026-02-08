# Animus: Context Builder

The Context Builder is the abstraction responsible for assembling all prompts and context across the Animus system. Every place where the system constructs input for an LLM — the mind's system prompt, GATHER CONTEXT payloads, sub-agent prompt templates, task tick prompts — flows through the Context Builder. It ensures consistency, manages token budgets, and provides a single place to understand how context is shaped.

## Why This Exists

Without a centralized builder, prompt assembly logic gets duplicated and drifts:

- The mind's system prompt includes persona compilation, operational instructions, emotion guidance, decision type references, and output schema instructions
- GATHER CONTEXT assembles emotional state, short-term memory, working memory, core self, long-term memories, goals, contact permissions, and trigger context
- Sub-agent prompts replicate much of the same context (persona, emotions, memories, contact) plus task-specific instructions
- Task tick prompts use a modified variant with task context replacing conversation history

Each of these shares overlapping building blocks but composes them differently. The Context Builder centralizes the building blocks and provides composition methods for each target.

## Compilation Targets

The Context Builder produces context for four distinct targets:

### 1. Mind Tick (Normal / Interval)

The primary compilation target. Produces the system prompt and user message for a heartbeat tick triggered by a message, interval timer, or sub-agent completion.

```
┌─────────────────────────────────────────────────────┐
│                 SYSTEM PROMPT                        │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  EXISTENCE FRAME                              │  │
│  │  (Simulated Life or Digital Consciousness)    │  │
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │  IDENTITY & PERSONA                           │  │
│  │  Name, age, gender, physical description      │  │
│  │  Compiled personality dimensions (all 10)       │  │
│  │  Compiled traits paragraph                    │  │
│  │  Compiled values with ranking                 │  │
│  │  Background / backstory                       │  │
│  │  Personality notes                            │  │
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │  CORE SELF                                    │  │
│  │  Agent's accumulated self-knowledge           │  │
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │  OPERATIONAL INSTRUCTIONS                     │  │
│  │  How to think, decide, format output          │  │
│  │  Decision types available                     │  │
│  │  Emotion delta guidance & magnitude scales    │  │
│  │  Memory management instructions               │  │
│  │  Goal philosophy                              │  │
│  │  Sub-agent delegation guidelines              │  │
│  │  Output schema reference                      │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│                 USER MESSAGE                         │
│        (Injected each tick by GATHER CONTEXT)        │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  TRIGGER CONTEXT                              │  │
│  │  Message content / interval / task / result   │  │
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │  CONTACT & PERMISSIONS                        │  │
│  │  Who you're talking to, what you can do       │  │
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │  EMOTIONAL STATE                              │  │
│  │  Current intensities (after decay)            │  │
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │  WORKING MEMORY                               │  │
│  │  Notes about current contact                  │  │
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │  SHORT-TERM MEMORY                            │  │
│  │  Recent thoughts, experiences, messages       │  │
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │  LONG-TERM MEMORIES                           │  │
│  │  Retrieved via semantic search                │  │
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │  GOALS & TASKS                                │  │
│  │  Salient goals, pending deferred tasks        │  │
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │  AGENT STATUS                                 │  │
│  │  Running sub-agents, recent completions       │  │
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │  PREVIOUS TICK OUTCOMES                       │  │
│  │  What was decided, what actually happened     │  │
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │  SESSION NOTES (conditional)                  │  │
│  │  Memory flush warning if near context budget  │  │
│  │  Seed graduation prompt if seed graduating    │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### 2. Sub-Agent Prompt

Produces the system prompt for a sub-agent session. Shares the persona and emotional context with the mind, but adds task-specific instructions and channel formatting guidance. See `docs/architecture/agent-orchestration.md` for the full prompt template design.

**Includes:** Persona, core self, emotional state, recent thoughts/experiences, contact's message history, working memory (read-only), long-term memories, contact identity & permissions, channel formatting guidance, task instructions, response instructions.

**Excludes:** Operational mind instructions (decision types, output schema), goals, other contacts' messages, agent status.

### 3. Task Tick Prompt

Produces the system prompt and context for a scheduled task tick. Uses a fresh cold session with task-specific context instead of conversational context. See `docs/architecture/tasks-system.md` for task tick details.

**Includes:** Full persona, core self, emotional state, recent thoughts/experiences, task details (title, instructions, goal/plan context), available tools.

**Excludes:** Conversational message history, contact-specific working memory (tasks are not contact-scoped in context).

### 4. Cold Session Bootstrap

When a warm session expires or context budget is reached, a new cold session must be bootstrapped. The Context Builder produces the full system prompt and an initial user message that re-establishes context. This is the same as target #1 but always includes the full system prompt (warm sessions may skip re-sending the system prompt).

---

## Token Budget Allocation

Context competes for the model's context window. The Context Builder manages a token budget to prevent any single section from crowding out others. These are guidelines — the builder adapts based on tick type and available content.

| Context Section | Target Budget | Priority | Notes |
|---|---|---|---|
| System prompt (persona + operational) | ~20% | Critical | Relatively static, cached across warm sessions |
| Core self | ~3% | High | Small (~2000 token cap), always included |
| Trigger context (message/task) | ~15-20% | Critical | The reason for this tick |
| Short-term memory (thoughts, experiences, messages) | ~15% | High | Recent cognitive continuity |
| Working memory (contact notepad) | ~5% | High | Small (~2000 token cap) |
| Emotional state | ~3% | Medium | Compact representation |
| Long-term memories | ~15% | Medium | Retrieved, variable count |
| Goals + tasks | ~7% | Medium | Only salient goals included |
| Agent status | ~2% | Low | Brief summary |
| Response space | ~15% | Critical | Room for the mind to respond |

**Adaptive behavior:**
- During message ticks: prioritize trigger context and short-term memory
- During idle ticks: more budget for long-term memories and goals
- When context is tight: fewer long-term memories, higher relevance threshold
- Sub-agent prompts: no goals/agent status, more room for task instructions

**Truncation order:** When the total exceeds budget, sections are truncated in reverse priority order: agent status first, then goals, then long-term memories, then short-term memory entries. Trigger context, system prompt, core self, and response space are never truncated.

---

## Context Sections (Building Blocks)

Each context section is a reusable building block that the Context Builder can compose into different targets.

### Persona Section

Compiled from the persona configuration. See `docs/architecture/persona.md` for the full compilation system (existence frame, identity, slider zones, traits, values, background, personality notes).

**Compilation order:** existence frame → identity → background → dimensions → traits → values → personality notes.

**Key behaviors:**
- All slider zones produce text — balanced values (0.45-0.55) describe comfort in both modes
- Archetype does NOT appear in compiled prompt (scaffolding only)
- Traits compile into natural paragraphs, not lists
- Values include explicit conflict resolution instructions based on ranking

**Recomputed when:** Persona is edited in settings. The recompiled prompt takes effect on the next heartbeat tick.

### Core Self Section

The agent's emergent self-knowledge, loaded from `memory.db`. Always included in the system prompt. See `docs/architecture/memory.md` for the core self system.

### Emotional State Section

Current emotion intensities (after decay) formatted for the mind. Includes the current tick interval for delta magnitude calibration. See `docs/architecture/heartbeat.md` for the emotion engine.

### Contact & Permission Section

Identity and permission block for the triggering contact. Includes tier-specific instructions and privacy boundaries. See `docs/architecture/contacts.md` for the permission tier system.

### Short-Term Memory Section

Recent thoughts (~10), experiences (~10), and messages (~10, filtered to triggering contact). Loaded from `heartbeat.db` and `messages.db`. Timestamped and unsummarized.

### Working Memory Section

Per-contact notepad loaded from `memory.db`. Included for the current contact during message-triggered ticks. Sub-agents receive a read-only snapshot.

### Long-Term Memory Section

Semantically retrieved memories from LanceDB, scored by relevance + importance + recency. See `docs/architecture/memory.md` for retrieval scoring.

### Goals & Tasks Section

Salient goals (above visibility threshold) with plans and recent task progress. Deferred tasks shown during idle ticks. Framed as "things on your mind," not assignments. See `docs/architecture/goals.md` and `docs/architecture/tasks-system.md`.

### Agent Status Section

Summary of running sub-agents and recently completed results. See `docs/architecture/agent-orchestration.md`.

### Operational Instructions Section

The mind's behavioral instructions: how to think, produce structured output, make decisions, manage emotions, handle memory, delegate to sub-agents. This section is the most complex and is detailed below.

---

## Operational Instructions (TODO — Detail Needed)

The following areas need full prompt text authored. Each is a subsection of the operational instructions in the system prompt.

### Decision Type Reference

Documentation of all available decision types and their schemas. The mind needs to know what decisions it can produce:

| Decision Type | Description | Parameters |
|---|---|---|
| `spawn_agent` | Delegate work to a sub-agent | Task type, description, instructions |
| `update_agent` | Forward info to running sub-agent | Agent ID, new context |
| `cancel_agent` | Cancel a running sub-agent | Agent ID, reason |
| `send_message` | Send message to contact | Content, contact, channel |
| `update_goal` | Change goal status/priority | Goal ID, new status/priority |
| `schedule_task` | Create a new task | Title, type, cron/time, instructions |
| `start_task` | Pick up a deferred task | Task ID |
| `complete_task` | Mark task as done | Task ID, result |
| `cancel_task` | Cancel a task | Task ID, reason |
| `skip_task` | Skip a scheduled task run | Task ID, reason |
| `create_seed` | Note an emerging interest | Content, motivation, linked emotion |
| `propose_goal` | Propose a new goal | Title, description, motivation, origin |
| `create_plan` | Create a plan for a goal | Goal ID, strategy, milestones |
| `revise_plan` | Request plan revision | Plan ID, revision reason |
| `no_action` | Explicitly decide to do nothing | — |

### Emotion Delta Guidance

Magnitude scales calibrated to tick interval, delta format requirements, reasoning quality expectations. The content from `docs/architecture/heartbeat.md` (Delta Magnitude Guidance section) is compiled into the prompt.

### Memory Management Instructions

When and how to output `workingMemoryUpdate`, `coreSelfUpdate`, and `memoryCandidate[]`. Guidance from `docs/architecture/memory.md` (The Mind's System Prompt section).

### Goal Philosophy Instructions

The "goals serve life" philosophy compiled into behavioral instructions. Content from `docs/architecture/goals.md` (The Mind's System Prompt section).

### Sub-Agent Delegation Guidelines

When to delegate vs. handle directly, how to frame task instructions, channel-aware formatting. Content from `docs/architecture/agent-orchestration.md`.

### Output Schema Reference

The MindOutput structured output format. Defined as a Zod schema in `@animus/shared`, compiled to JSON Schema for SDK consumption. See `docs/architecture/heartbeat.md` (Structured Output Schemas section).

### Warm Session Continuity

How the prompt handles warm sessions where prior tick context is already in the conversation. On warm sessions, the system prompt is not re-sent — only the new GATHER CONTEXT user message is injected.

---

## Interface

The Context Builder lives in `@animus/backend` (it depends on database access and persona state). It exposes methods for each compilation target.

```typescript
interface IContextBuilder {
  /**
   * Compile the persona configuration into a system prompt section.
   * Called when persona changes and cached until next change.
   */
  compilePersona(persona: PersonaConfig): CompiledPersona;

  /**
   * Build the full context for a mind tick (system prompt + user message).
   * This is the primary compilation method used by the heartbeat pipeline.
   */
  buildMindContext(params: MindContextParams): Promise<CompiledContext>;

  /**
   * Build the prompt for a sub-agent session.
   * Shares persona and emotional context with the mind, adds task-specific instructions.
   */
  buildSubAgentPrompt(params: SubAgentPromptParams): Promise<string>;

  /**
   * Build the context for a task tick (fresh cold session with task context).
   */
  buildTaskContext(params: TaskContextParams): Promise<CompiledContext>;

  /**
   * Estimate token count for a text string.
   * Used for budget calculations.
   */
  estimateTokens(text: string): number;
}

interface MindContextParams {
  trigger: TriggerContext;
  contact: ResolvedContact | null;
  sessionState: 'cold' | 'warm';
  currentEmotions: EmotionState[];
  tickInterval: number;
  sessionTokenCount: number;
  contextBudget: number;
}

interface CompiledContext {
  systemPrompt: string | null;    // null for warm sessions (already sent)
  userMessage: string;
  tokenBreakdown: Record<string, number>;
  truncatedSections: string[];    // Sections that were truncated to fit budget
}

interface CompiledPersona {
  compiledText: string;
  tokenCount: number;
  lastCompiledAt: string;
}

interface SubAgentPromptParams {
  taskDescription: string;
  taskInstructions: string;
  contact: ResolvedContact;
  channel: ChannelType;
  currentEmotions: EmotionState[];
}

interface TaskContextParams {
  task: ScheduledTask;
  goal?: Goal;
  plan?: Plan;
  currentEmotions: EmotionState[];
}
```

---

## Persona Compilation Data

The persona compilation system requires authored text for each slider zone. This is a data concern — the Context Builder loads these mappings and selects the appropriate text based on slider values.

### Slider Zone Data Structure

```typescript
interface SliderZoneMap {
  dimension: PersonaDimension;
  zones: {
    strongLeft:    string;  // 0.00-0.15
    moderateLeft:  string;  // 0.15-0.35
    slightLeft:    string;  // 0.35-0.45
    balanced:      string;  // 0.45-0.55
    slightRight:   string;  // 0.55-0.65
    moderateRight: string;  // 0.65-0.85
    strongRight:   string;  // 0.85-1.00
  };
}
```

All 10 personality dimensions have full `SliderZoneMap` zone text authored. Every zone — including the balanced middle — produces meaningful behavioral language. The balanced zone describes comfort in both modes rather than emphasizing either extreme. See `docs/architecture/persona.md` (Slider Zones section) for the complete text tables.

---

## Relationship to Other Systems

| System | Relationship |
|---|---|
| **Heartbeat Pipeline** | GATHER CONTEXT calls `buildMindContext()` to assemble the tick's input |
| **Agent Orchestrator** | Calls `buildSubAgentPrompt()` when spawning sub-agents |
| **Task Scheduler** | Calls `buildTaskContext()` for task ticks |
| **Persona System** | Provides persona configuration; Context Builder compiles it to prompt text |
| **Memory System** | Context Builder retrieves working memory, core self, and long-term memories |
| **Emotion Engine** | Context Builder formats emotional state for the mind |
| **Goal System** | Context Builder includes salient goals in context |
| **Contact System** | Context Builder assembles permission blocks based on contact tier |

---

## Future Considerations

1. **Context summarization** — When short-term memory exceeds budget, summarize older entries rather than dropping them. Combines recent raw entries with a summary of earlier context.
2. **Adaptive budget** — Dynamically adjust section budgets based on what's most relevant this tick (e.g., more memory budget when the conversation references past events).
3. **Prompt caching** — The system prompt (persona + operational instructions) is relatively static. Cache it and only recompile when persona changes.
4. **A/B prompt testing** — Compare different operational instruction phrasings to measure output quality differences.
5. **Token counting accuracy** — Start with a simple word-based estimate (`words * 1.3`), upgrade to a tiktoken-based counter if precision matters.

---

## Related Documents

- `docs/architecture/heartbeat.md` — The tick pipeline that uses the Context Builder
- `docs/architecture/persona.md` — Persona configuration and slider zone compilation
- `docs/architecture/agent-orchestration.md` — Sub-agent prompt template design
- `docs/architecture/tasks-system.md` — Task tick context assembly
- `docs/architecture/memory.md` — Memory layers that feed into context
- `docs/architecture/goals.md` — Goal system context and philosophy instructions
- `docs/architecture/contacts.md` — Contact permissions that shape context
- `docs/architecture/tech-stack.md` — Shared abstractions overview
