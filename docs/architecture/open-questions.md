# Animus: Open Questions

> Questions and concerns that need resolution before or during implementation. Each entry includes context on why it matters and any preliminary thinking.

## 1. Concurrent Tick Handling & Race Conditions

**Context:** Multiple tick triggers can fire simultaneously or in rapid succession — a message arrives while an interval tick is processing, a sub-agent completes during a message-triggered tick, etc.

**The Problem:**
- If two ticks run concurrently against the same mind session, they could produce conflicting state updates (emotion deltas that double-count, duplicate thoughts, conflicting decisions)
- If ticks are strictly serialized, message response latency suffers — user sends a message but has to wait for the current interval tick to finish
- Database writes from the EXECUTE stage could conflict if two ticks try to write simultaneously

**Preliminary Thinking:**
- Sequential processing with a FIFO queue is the simplest safe approach (see heartbeat.md, Mind Session Lifecycle)
- Message-triggered ticks could potentially preempt interval ticks (interrupt and requeue)
- The warm session model helps — rapid messages hit the same session rather than spawning separate ticks
- SQLite's WAL mode handles concurrent reads but writes are serialized, so DB-level conflicts are unlikely if ticks are queued

**Needs Resolution:**
- Should interval ticks be cancellable/preemptable by higher-priority triggers?
- What happens to queued ticks if the queue grows too large?
- Is there a maximum queue depth, and what happens when it's exceeded?

---

## 2. Crash Recovery Robustness

**Context:** The heartbeat pipeline persists state to SQLite for crash recovery, but the recovery mechanism has fragile points.

**The Problem:**
- If a crash occurs mid-EXECUTE (after some writes but before others), the system could be left in an inconsistent state
- Agent sessions (SDK-level) are lost on crash — the warm session is gone, requiring a cold start
- Sub-agents that were running at crash time need to be detected and handled on restart
- Emotion state could be inconsistent if a crash happens between writing emotion deltas and updating emotion_state

**Preliminary Thinking:**
- SQLite transactions should wrap the entire EXECUTE stage's database writes
- On startup, check for incomplete ticks (status = 'active') and either replay or discard them
- Sub-agent sessions stored in SQLite can be checked against the SDK on restart
- A "last known good state" checkpoint could help, but adds complexity

**Needs Resolution:**
- How granular should EXECUTE-stage transactions be?
- Should we attempt to resume incomplete ticks or always discard them?
- How do we handle sub-agents that completed during downtime (their results may be lost)?

---

## 3. MCP Tool Design for Sub-Agents

**Context:** Sub-agents use MCP tools to interact with the Animus system (sending messages to users, reading memories, updating progress). The tool interface needs to be defined.

**The Problem:**
- `send_message` tool — How does the sub-agent specify which contact/channel to message? It needs the originating channel context.
- `update_progress` tool — What schema does progress reporting follow? How does the mind consume this?
- `read_memory` tool — Does this go through the same memory retrieval system as the mind's GATHER CONTEXT, or is it a separate query interface?
- Tool permissions — How are tools filtered by contact permission tier at the MCP level?

**Preliminary Thinking:**
- Sub-agents receive channel context in their prompt template, so `send_message` can default to the originating channel
- The backend (not the agents package) implements MCP tool handlers — the agents package just provides tool definitions
- Tool list is filtered before session creation based on the triggering contact's permission tier
- `send_message` should write to `messages.db` and emit a real-time event (tRPC subscription) for the frontend

**Needs Resolution:**
- Full MCP tool schema definitions (input/output for each tool)
- Whether sub-agents can call tools that trigger side effects beyond messaging (e.g., file operations, web requests)
- How tool call results flow back to the sub-agent session
- Whether custom user-defined tools are supported (and how they'd be registered)

---

## 4. Structured Output Across SDK Adapters

**Context:** The mind needs to produce structured JSON output (thoughts, experiences, emotion deltas, decisions) on every tick. Each SDK handles structured output differently.

**The Problem:**
- **Claude SDK**: Supports `outputFormat: { type: 'json_schema', schema }` for structured output enforcement
- **Codex SDK**: Supports `outputSchema` parameter on thread creation
- **OpenCode SDK**: No native structured output — would need to inject schema in prompt and parse JSON from response

**Preliminary Thinking:**
- The `@animus/agents` abstraction layer should expose a unified `outputSchema` option in `PromptOptions`
- Each adapter maps this to its SDK's native mechanism (or prompt injection for OpenCode)
- Zod schemas define the output format, compiled to JSON Schema for SDK consumption
- The MindOutput schema is defined in the heartbeat system and passed through the agents layer

**Needs Resolution:**
- How reliable is prompt-injected schema enforcement for OpenCode? Do we need validation + retry?
- Should the abstraction layer handle output validation, or leave it to the caller?
- How do streaming events interact with structured output (partial JSON in chunks)?

---

## 5. Claude OAuth Token Restrictions for Agent SDK

**Context:** Claude's Agent SDK supports authentication via long-lived OAuth access tokens (generated by `claude setup-token`, format `sk-ant-oat01-...`, valid ~1 year). These tokens are an alternative to standard API keys and are passed via the `CLAUDE_CODE_OAUTH_TOKEN` environment variable.

**The Problem:**
- Anthropic's OAuth system distinguishes between first-party use (Anthropic's own apps like Claude Code) and third-party use. Third-party OAuth tokens carry restrictions — limited to specific model tiers and potentially subject to rate limits or revocation.
- Animus is a third-party application using Anthropic's Agent SDK. It's unclear whether OAuth tokens generated via `claude setup-token` would be treated as first-party (since they go through the Agent SDK, which is Anthropic's product) or third-party (since Animus is not an Anthropic application).
- If treated as third-party, the tokens may not have access to the same models or capabilities as API key authentication, making them a worse option for users.

**Preliminary Thinking:**
- For v1, support both API key and OAuth token as authentication options, clearly documented
- API key is the safe default — no ambiguity about access level
- OAuth token is a convenience option for users who already have Claude Code configured
- We should test whether Agent SDK sessions created with OAuth tokens face any restrictions vs. API key sessions

**Needs Resolution:**
- Do OAuth tokens created via `claude setup-token` face third-party restrictions when used through the Agent SDK?
- Should we warn users about potential limitations, or test and document the actual behavior?
- If restrictions exist, should we still offer OAuth token auth or remove it to avoid confusion?

---

## 6. Codex ChatGPT OAuth Implementation

**Context:** The Codex SDK supports authentication via ChatGPT OAuth (the `codex login` flow), which would let users authenticate with their ChatGPT account instead of providing an API key. This is noted in the onboarding design but not implemented for v1.

**The Problem:**
- The `codex login` flow is a device code OAuth flow designed for CLI use — it opens a browser on the machine running the command
- In a self-hosted web application, the server needs to run this flow, but the browser opens on the server machine, not the user's machine
- The device code flow displays a URL + code for the user to visit, which could theoretically be proxied through the web UI, but this requires implementing a device code polling flow in the frontend

**Preliminary Thinking:**
- For v1, Codex auth is API key only. The ChatGPT OAuth option is deferred.
- A future implementation could: (1) initiate the device code flow on the backend, (2) return the verification URL and user code to the frontend, (3) display these to the user with instructions, (4) poll for completion
- This is a nice-to-have — API keys work fine for users who want to use Codex

**Needs Resolution:**
- Is the device code flow worth implementing, or is API key sufficient for Codex users?
- If implemented, what's the UX for presenting the verification URL and code in the web UI?
- How do we handle the polling timeout and error states?

---

## 7. Contact "Notes About You" Storage & Surfacing

**Context:** During onboarding (Step 3: Your Identity), the user provides personal context about themselves — the kind of information that helps their AI know them better. This is a free text field labeled *"Anything your Animus should know about you?"*

**The Problem:**
- This information doesn't map neatly to any existing data structure. It's not a contact field (contacts are messaging identities), not a persona field (persona is the AI's personality), and not a system setting.
- The data needs to be stored somewhere persistent and surfaced in the mind's context during ticks so the AI actually uses it.
- It's conceptually "knowledge about the primary contact" but the contact system is designed for identity resolution and permissions, not rich personal profiles.

**Preliminary Thinking:**
- Could be stored as a field on the primary contact record in `system.db` (simplest, but overloads the contact model)
- Could be a dedicated `user_profile` table in `system.db` (cleaner, but adds a table for potentially one field)
- Could be stored as a "pinned memory" in the memory/knowledge system (when it exists)
- The mind's GATHER CONTEXT stage needs to include this information — it should be part of the base context on every tick, not something retrieved via search

**Needs Resolution:**
- Where does this data live? Contact record, dedicated table, or memory system?
- Should it be editable from settings after onboarding? (Probably yes)
- How does it get into the mind's context — hardcoded in the system prompt, or part of the gathered context?

---

## Related Documents

- `docs/architecture/heartbeat.md` — Tick pipeline, session lifecycle, crash recovery
- `docs/architecture/agent-orchestration.md` — Sub-agent lifecycle, MCP tools
- `docs/architecture/contacts.md` — Permission tiers affecting tool access
- `docs/frontend/onboarding.md` — Onboarding flow, agent provider auth, persona creation UX
