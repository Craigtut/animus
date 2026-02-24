# Agent Orchestration Architecture

How the mind delegates work to sub-agents, tracks their lifecycle, and delivers results back to the user.

## Decision: Custom Orchestration Layer

We evaluated four approaches (native SDK sub-agents, custom orchestration, hybrid, Claude Agent Teams) and chose to **build our own sub-agent management system on top of `@animus-labs/agents`**. Sub-agents are independent agent sessions that we create, track, and coordinate ourselves.

**Why not native SDK sub-agents?** Codex has no SDK-level sub-agent API. OpenCode's REST API has known bugs with programmatic sub-agent invocation. Only Claude has a mature system. Building our own gives us one code path that works identically across all three providers.

**Why not Claude Agent Teams?** Experimental, CLI-only (not SDK), Claude-only, extremely high token cost. Not suitable for a production heartbeat system.

**Why not hybrid (native for Claude, custom for others)?** Two code paths means double the maintenance, double the testing, and subtle behavioral differences between providers. One consistent system is better.

---

## How It Works

Sub-agents are extensions of the mind. They carry the same personality, emotional context, and understanding of the user. The difference is scope: the mind is the quick, aware orchestrator; sub-agents are the ones that go deep on a specific task.

**The mind can handle simple tasks directly.** Not every request needs delegation. If the mind can answer a question, perform a quick lookup, or handle a simple action within the current tick, it should do so — producing a reply directly in its structured output. Sub-agents are reserved for work that would block the mind: research tasks, multi-step workflows, code generation, lengthy analysis, or anything that requires extended tool use. The mind naturally makes this judgment as part of its decision-making.

**Sub-agents are only spawned for primary contact tasks.** The EXECUTE stage enforces this: `spawn_agent` decisions produced during non-primary contact ticks are dropped. This is a hard permission boundary. See `docs/architecture/contacts.md` for the full permission tier system.

### The Core Flow

```
┌──────────────────────────────────────────────────────────┐
│                    HEARTBEAT PIPELINE                     │
│                                                          │
│  ┌────────────┐   ┌───────────┐   ┌──────────────────┐  │
│  │  GATHER    │ → │   MIND    │ → │     EXECUTE      │  │
│  │  CONTEXT   │   │   QUERY   │   │                  │  │
│  │            │   │           │   │ • Send reply     │  │
│  │ • Agent    │   │ Produces: │   │ • Spawn agents   │  │
│  │   status   │   │ • Thoughts│   │ • Update agents  │  │
│  │ • Results  │   │ • Emotions│   │ • Persist data   │  │
│  │ • Messages │   │ • Decisions│  │ • Cleanup        │  │
│  │            │   │ • Reply   │   │                  │  │
│  └────────────┘   └───────────┘   └────────┬─────────┘  │
└────────────────────────────────────────────┘             │
                                               │           │
                                    ┌──────────┘           │
                                    ▼                      │
                    ┌───────────────────────────┐          │
                    │   AGENT ORCHESTRATOR      │          │
                    │                           │          │
                    │ • Creates sessions        │          │
                    │ • Builds prompts          │          │
                    │ • Tracks in SQLite        │          │
                    │ • Routes events           │          │
                    │ • Forwards updates        │          │
                    └───────┬───────────────────┘          │
                            │                              │
                 ┌──────────┼──────────┐                   │
                 ▼          ▼          ▼                   │
           ┌──────────┐┌──────────┐┌──────────┐           │
           │ Sub-Agent││ Sub-Agent││ Sub-Agent│           │
           │ (any     ││ (any     ││ (any     │           │
           │ provider)││ provider)││ provider)│           │
           └─────┬────┘└─────┬────┘└─────┬────┘           │
                 │           │           │                 │
                 └───────────┴───────────┘                 │
                        On completion:                     │
                     trigger heartbeat ────────────────────┘
```

### Step by Step

**1. Mind decides to delegate.** During a heartbeat tick, the mind produces a `spawn_agent` decision as part of its structured output. The mind provides the task instructions — what to do, what the user asked for, any relevant details from the conversation. It also produces an immediate reply to the user acknowledging the request.

**2. System spawns the sub-agent.** The EXECUTE stage reads the `spawn_agent` decision and hands it to the Agent Orchestrator. The orchestrator:
   - Builds a full prompt using a **prompt template** (see [Prompt Template](#prompt-template) below) that injects the heartbeat context: personality, emotional state, conversation history, user preferences, channel information
   - Combines the template context with the mind's task instructions
   - Creates a new agent session via `agentManager.createSession()`
   - Tracks the session in SQLite

**3. Sub-agent runs independently.** It has its own context window, its own tools, and the full Animus personality. It works through the task, using tools as needed. It can message the user directly for clarification or progress updates — it speaks as Animus because it has the same personality context. **Sub-agents cannot spawn further sub-agents.** Only the mind delegates work. This keeps the system flat (one level of delegation) and prevents runaway agent spawning. If a sub-agent's task turns out to need further decomposition, it should complete with a result indicating what additional work is needed, and the mind can spawn new sub-agents in the next tick.

**4. Mind can forward new information.** If the user sends a follow-up message that's relevant to a running sub-agent (e.g., "actually, focus on green cars"), the mind produces an `update_agent` decision. The orchestrator calls `session.prompt()` on the running sub-agent with the new information. The agent SDK handles this natively — it's just another user input into the session.

**5. Sub-agent completes.** The orchestrator stores the result in SQLite and triggers a heartbeat tick with trigger type `agent_complete`.

**6. Mind processes the result.** The next heartbeat tick's GATHER CONTEXT loads the sub-agent's result. The MIND QUERY processes it — updating thoughts, experiences, and emotions based on what was found — and produces a reply to deliver to the user. The mind doesn't rewrite or transform the result; it delivers the sub-agent's answer, since the sub-agent was already speaking as Animus and formatting for the right channel.

> **Note on planning agents:** Planning sub-agents are **not automatically spawned** when a goal activates. Instead, goals without plans receive escalating context prompts reminding the mind to consider planning (see `docs/architecture/goals.md`). The mind retains full agency — it may spawn a planning sub-agent via `spawn_agent` if the goal is complex, create a plan directly for simpler goals, or decide the goal doesn't need a formal plan. Planning agents are treated like any other delegated work: the mind chooses when and whether to use them.

---

## Prompt Template

Sub-agent prompts are assembled by the **Context Builder** (see `docs/architecture/context-builder.md`) via its `buildSubAgentPrompt()` method. The builder composes the prompt from two sources:

**Template context (system-assembled):**
- Animus's personality and behavioral instructions
- Current emotional state
- Recent thoughts (last ~10, timestamped) — gives the sub-agent a sense of what the mind has been thinking about
- Recent experiences (last ~10, timestamped) — what's been happening in Animus's inner life
- Recent conversation messages **from the triggering contact only** (last ~10, timestamped) — the contact/Animus exchange leading up to this task
- Long-term memory (read-only) — relevant memories retrieved from LanceDB via `read_memory` MCP tool (see `docs/architecture/memory.md`)
- Contact identity and permission tier — who the sub-agent is working for
- Channel the original message came from (SMS, Discord, web, API) — so the sub-agent formats its output appropriately
- Time of day, environmental context
- Available MCP tools and their descriptions (filtered by contact permission tier)
- Privacy instructions — do not reference other contacts' conversations

> **Future: Summarization system.** Currently we include the last ~10 entries for thoughts, experiences, and messages. Older context is omitted. A more sophisticated approach would summarize older history and include both the summary and the recent entries. This is noted for future implementation — keeping it simple for now.

**Task instructions (mind-provided):**
- What to accomplish
- Any specific user requests or constraints
- Relevant details from the conversation the mind thinks are important

The template ensures every sub-agent has the same foundational context as the mind — same personality, same voice, same emotional state. The mind's instructions focus the sub-agent on the specific task.

```
┌─────────────────────────────────────────────────────┐
│                  SUB-AGENT PROMPT                    │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  TEMPLATE CONTEXT (system-assembled)          │  │
│  │                                               │  │
│  │  • Personality & behavioral instructions      │  │
│  │  • Emotional state snapshot                   │  │
│  │  • Recent thoughts (~10, timestamped)         │  │
│  │  • Recent experiences (~10, timestamped)      │  │
│  │  • Recent messages from THIS CONTACT (~10)     │  │
│  │  • Long-term memory (read-only, via MCP tool)  │  │
│  │  • Contact identity & permission tier         │  │
│  │  • Channel context (SMS, Discord, web, API)    │  │
│  │  • Available tools (tier-filtered)            │  │
│  │  • Privacy instructions (cross-contact)       │  │
│  │  • Environment (time, date, etc)              │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  TASK INSTRUCTIONS (mind-provided)            │  │
│  │                                               │  │
│  │  • Task description and goals                 │  │
│  │  • User's original request                    │  │
│  │  • Specific constraints or preferences        │  │
│  │  • Any context the mind deems relevant        │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  RESPONSE INSTRUCTIONS                        │  │
│  │                                               │  │
│  │  • Format output for {channel}                │  │
│  │  • Provide direct answers, not rationale      │  │
│  │  • Use send_message for clarification         │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### Channel-Aware Formatting

The sub-agent's prompt includes the originating channel so it formats output appropriately:

| Channel | Formatting Guidance |
|---|---|
| SMS | Short, plain text. No markdown. Keep under 160 chars per message when possible. |
| Discord | Markdown supported. Can use embeds, code blocks, bullet lists. |
| Web UI | Full markdown. Can be longer and more detailed. |
| API | Structured data preferred. JSON when appropriate. |

---

## Updating Running Sub-Agents

The mind can pass new information to a running sub-agent. This handles the case where a user refines their request after delegation:

**Example:**
1. User: "Research cars I can buy under $30k"
2. Mind delegates to a research sub-agent, replies "I'm on it"
3. User (30 seconds later): "Oh, and I really love green cars — focus on those"
4. Mind's next heartbeat tick recognizes this relates to the running sub-agent
5. Mind produces an `update_agent` decision with the new context
6. Orchestrator calls `session.prompt("The user has clarified: they want to focus specifically on green cars. Please prioritize green options in your research.")` on the running sub-agent
7. The sub-agent incorporates the new information and continues

This works because the agent SDK natively handles new user inputs arriving during processing. It's just another message in the session.

### Decision Types

The mind's structured output can produce these agent-related decisions:

| Decision Type | Description |
|---|---|
| `spawn_agent` | Create a new sub-agent session for a task |
| `update_agent` | Send new information to a running sub-agent |
| `cancel_agent` | Cancel a running sub-agent (if the task is no longer needed) |

---

## Agent Lifecycle

```
SPAWNING ──→ RUNNING ──→ COMPLETED ──→ (heartbeat tick)
   │            │
   │            ├──→ FAILED ──→ (heartbeat tick)
   │            │
   │            ├──→ CANCELLED ──→ (heartbeat tick)
   │            │
   │            └──→ TIMED_OUT ──→ (heartbeat tick)
```

All terminal states trigger a heartbeat tick so the mind can process the outcome.

### SQLite Schema (in heartbeat.db)

```sql
CREATE TABLE agent_tasks (
  id TEXT PRIMARY KEY,                     -- UUID
  tick_number INTEGER NOT NULL,            -- Tick that spawned this agent
  session_id TEXT,                         -- Agent session ID ({provider}:{native_id})
  provider TEXT NOT NULL,                  -- 'claude' | 'codex' | 'opencode'
  model TEXT,                              -- Model used
  status TEXT NOT NULL DEFAULT 'spawning', -- spawning | running | completed | failed | cancelled | timed_out

  -- Task definition
  task_type TEXT NOT NULL,                 -- Category: 'research', 'code_gen', 'analysis', etc.
  task_description TEXT NOT NULL,          -- What the agent was asked to do
  contact_id TEXT,                         -- FK reference to system.db contacts.id (who triggered this)
  source_channel TEXT,                     -- Channel that originated the request

  -- Progress tracking
  current_activity TEXT,                   -- Last known activity (updated from events)

  -- Results
  result TEXT,                             -- Final output from the agent (channel-formatted)
  error TEXT,                              -- Error message if failed

  -- Timing
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  timeout_at TEXT,                         -- When this agent should be killed if not done

  -- Cost tracking
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  total_cost_usd REAL DEFAULT 0
);

CREATE INDEX idx_agent_tasks_status ON agent_tasks(status);
CREATE INDEX idx_agent_tasks_tick ON agent_tasks(tick_number);
```

---

## The Mind's View of Sub-Agents

During GATHER CONTEXT, the mind receives a summary loaded from SQLite:

```typescript
interface AgentStatusSummary {
  active: {
    id: string;
    taskDescription: string;
    status: 'spawning' | 'running';
    currentActivity: string;
    runningFor: string;          // Human-readable duration
  }[];

  recentlyCompleted: {
    id: string;
    taskDescription: string;
    status: 'completed' | 'failed' | 'cancelled' | 'timed_out';
    result?: string;
    error?: string;
    completedAt: string;
    alreadyProcessed: boolean;   // Has the mind seen this result?
  }[];
}
```

This lets the mind:
- Answer "what are you working on?" by listing active agents
- Process results from completed agents and deliver them to the user
- Decide whether to retry failed agents or inform the user of the failure
- Recognize when a user message relates to a running agent and produce an `update_agent` decision

**The mind's context stays lean.** SQLite is the source of truth for agent state. The mind doesn't need to remember delegation history — it's loaded fresh every tick from the database.

---

## MCP Tools for Sub-Agents

Sub-agents receive MCP tools that let them interact with Animus's systems:

| MCP Tool | Purpose |
|---|---|
| `send_message` | Send a message to the triggering contact via the originating channel. Used for progress updates, clarifying questions, or intermediate findings. The sub-agent speaks as Animus. Messages are scoped to the contact that initiated the task. |
| `update_progress` | Report progress back to the orchestrator (updates `current_activity` in SQLite). |
| `read_memory` | Access Animus's long-term memory (LanceDB). Read-only. |

**Sub-agents cannot write to long-term memory.** Only the mind/orchestrator writes memories. Sub-agents execute tasks and return results; the mind decides what's worth remembering. This prevents sub-agents from polluting memory with task-level noise and keeps the mind as the single authority over what Animus "remembers."

Sub-agents **can** message the user directly for progress updates and intermediate findings via the `send_message` MCP tool. However, when the user sends a **reply** related to a running sub-agent, that reply flows through the normal heartbeat pipeline — the mind receives it, recognizes it relates to a running sub-agent, and routes it via an `update_agent` decision. The mind is the router for all inbound messages; sub-agents do not receive replies directly.

---

## Result Delivery

When a sub-agent completes, the result flows back through the heartbeat:

1. **Sub-agent finishes** → orchestrator stores result in SQLite, triggers heartbeat tick
2. **GATHER CONTEXT** → loads the result (marked as `alreadyProcessed: false`)
3. **MIND QUERY** → the mind processes the result:
   - Updates its thoughts, experiences, and emotions based on the findings
   - Produces a reply that delivers the result to the user
   - The mind typically passes the sub-agent's answer through directly, since the sub-agent already formatted it for the right channel
4. **EXECUTE** → sends the reply, marks the result as processed

The mind's role in result delivery is primarily about **maintaining its inner life** (the cognitive/emotional processing of what was found) and **routing the answer** to the user. It doesn't rewrite or summarize the sub-agent's work — the sub-agent was already prompted to produce channel-appropriate output.

---

## Failure Handling

### Sub-Agent Hangs (Timeout)

Each task type has a default timeout. When a sub-agent exceeds its timeout:

1. Orchestrator marks the task as `timed_out` in SQLite
2. Orchestrator attempts `session.cancel()` on the agent session
   - Claude: Uses `AbortController` — clean cancellation
   - Codex: Cancel not supported — log a warning, stop listening for events. The Codex subprocess will eventually complete on its own but we stop tracking it.
   - OpenCode: Uses `session.abort()` — clean cancellation
3. Heartbeat tick fires. The mind sees the timeout and decides how to handle it (retry, inform user, try different approach)

```typescript
const TASK_TIMEOUTS: Record<string, number> = {
  research:        5 * 60 * 1000,   // 5 minutes
  code_generation: 10 * 60 * 1000,  // 10 minutes
  analysis:        5 * 60 * 1000,   // 5 minutes
  review:          3 * 60 * 1000,   // 3 minutes
};
```

### Sub-Agent Produces Bad Output

The orchestrator does not validate output quality — that's the mind's job. The orchestrator only checks:
- The result is non-empty (empty result → mark as `failed` with error "empty result")
- The session ended normally (not with an SDK error)

If the result is low quality, the mind will see it during the heartbeat tick and can decide to retry, ask the user for more context, or try a different approach.

### Orchestrator Crashes While Sub-Agents Run

Sub-agent sessions are independent processes. If the orchestrator crashes:

1. Sub-agents keep running (they're independent sessions)
2. On restart, the orchestrator queries SQLite for tasks with status `running`
3. For each:
   - Attempt to resume the session via `adapter.resumeSession(sessionId)`
   - If resume succeeds: re-attach event handlers, continue tracking
   - If resume fails: mark as `failed` with error "session lost during crash recovery"
4. Trigger a heartbeat tick for each task that completed while we were down (check session status via the adapter)

### Cascading Failures

If the LLM provider is having issues, multiple sub-agents may fail simultaneously. Rather than triggering N separate heartbeat ticks:

1. When multiple `agent_complete` triggers arrive within a 5-second window, **batch them into a single heartbeat tick**
2. The GATHER CONTEXT stage loads all newly-completed results at once
3. The mind processes all results in one pass, producing appropriate replies

This prevents the mind from being overwhelmed by a burst of failure notifications.

### Lost Codex Sessions

Codex sessions that can't be cancelled pose a unique risk: they may run indefinitely, consuming resources. Mitigation:

1. Track the Codex subprocess PID when spawning
2. On timeout, attempt a process kill as a last resort (after logging a warning)
3. Document this as a known Codex limitation in the user-facing settings

---

## Configuration

These settings are configurable via the frontend UI:

| Setting | Default | Description |
|---|---|---|
| `maxConcurrentAgents` | 3 | Maximum number of sub-agents running at once. New `spawn_agent` decisions are queued FIFO if the limit is reached. |
| `defaultAgentModel` | (inherits from mind) | Model used for sub-agents. Applies globally — no per-task granularity initially. |
| `agentTimeouts` | (per task type, see above) | How long each task type has before timeout. |

Cost controls (per-agent budgets, daily spending limits) are noted as a future concern. Model selection is global for now — if cost becomes an issue, we can add per-task-type model configuration later.

---

## Open Questions

- **Context summarization** — Currently we pass the last ~10 thoughts, experiences, and messages to sub-agents. A future iteration should summarize older history and combine summaries with recent entries for richer context without excessive tokens.
- **Task priority and urgency** — Task queuing is FIFO for now. A future iteration should add priority levels and urgency scoring so time-sensitive tasks can jump the queue.
- **Cost budgeting** — Per-agent and daily spending limits. Deferred until cost becomes a practical concern.
- **Memory system integration** — The memory system is fully designed (see `docs/architecture/memory.md`). Sub-agents receive read-only snapshots of working memory and core self in their prompt template, plus access to the `read_memory` MCP tool for long-term memory search. The mind remains the sole writer of long-term memories.

---

## Shared Abstractions

The agent orchestration system uses several shared abstractions (see `docs/architecture/tech-stack.md`):

- **Context Builder** — Assembles sub-agent prompts with persona, emotions, contact context, and task instructions (`docs/architecture/context-builder.md`)
- **Event Bus** — Emits `agent:spawned`, `agent:completed` events consumed by the heartbeat trigger and frontend
- **Database Stores** — Typed data access for `agent_tasks` table in `heartbeat.db`

## References

- Internal: `docs/architecture/context-builder.md` (Prompt assembly for sub-agents)
- Internal: `docs/architecture/contacts.md` (Contact system, permission tiers, identity resolution)
- [Claude Agent SDK: Subagents](https://platform.claude.com/docs/en/agent-sdk/subagents)
- [Claude Code: Agent Teams](https://code.claude.com/docs/en/agent-teams) (experimental)
- [Anthropic: Building Agents with the Claude Agent SDK](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk)
- [Anthropic: Effective Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Anthropic: Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [LangGraph Supervisor: Hierarchical Multi-Agent Systems](https://changelog.langchain.com/announcements/langgraph-supervisor-a-library-for-hierarchical-multi-agent-systems)
- [Microsoft: AI Agent Orchestration Design Patterns](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns)
- [Cognition AI: Don't Build Multi-Agents](https://cognition.ai/blog/dont-build-multi-agents)
- [Google ADK: Multi-Agent Systems](https://google.github.io/adk-docs/agents/multi-agents/)
- Internal: `docs/agents/architecture-overview.md` (SDK comparison and adapter design)
