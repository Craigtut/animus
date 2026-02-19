# Animus: Open Questions

> Questions and concerns that need resolution before or during implementation. Each entry includes context on why it matters, the resolution, and links to updated documentation.

## 1. Concurrent Tick Handling & Race Conditions ✅ RESOLVED

**Context:** Multiple tick triggers can fire simultaneously or in rapid succession — a message arrives while an interval tick is processing, a sub-agent completes during a message-triggered tick, etc.

**Resolution:** FIFO priority queue with message coalescing via per-contact debounce.

- **Priority ordering**: `message` > `agent_complete` > `scheduled_task` > `interval`
- **Same-contact rapid messages**: Coalesced via ~1.5s debounce — rapid messages from the same contact hit the same warm session, not queued as separate ticks
- **Cross-contact messages**: Queued normally — different contacts queue separate ticks
- **Interval tick coalescing**: Only one interval tick can be queued at a time. If one is already queued when another would fire, the new one is dropped
- **No preemption**: Running ticks are never interrupted. Queue processes strictly FIFO after priority sort
- **Queue depth cap**: Maximum 10 queued ticks. Beyond that, interval ticks are dropped first, then oldest non-message ticks
- **Warm session model**: The key insight — rapid messages from the same contact don't need separate ticks because they hit the warm session window

**Updated in:** `docs/architecture/heartbeat.md` (Tick Queuing & Concurrency section)

---

## 2. Crash Recovery Robustness ✅ RESOLVED

**Context:** The heartbeat pipeline persists state to SQLite for crash recovery, but the recovery mechanism has fragile points.

**Resolution:** Single transaction for EXECUTE, discard incomplete ticks, sub-agent re-check.

- **EXECUTE stage**: Wrapped in a single SQLite transaction. All writes (thoughts, experiences, emotion updates, decisions) are committed atomically. If the process dies mid-EXECUTE, the transaction rolls back
- **Incomplete ticks on startup**: Mark as `failed` and move on. The next tick naturally observes current state and re-thinks. No replay of incomplete ticks
- **Messages are safe**: Inbound messages are written to `messages.db` at ingestion time (before tick processing), not during EXECUTE. A crash never loses messages
- **Sub-agent re-check**: On startup, query SQLite for `status = 'running'` tasks and check each against the agent SDK — completed sessions store results and trigger `agent_complete`, dead sessions are marked `failed`, running sessions re-attach event handlers

**Updated in:** `docs/architecture/heartbeat.md` (Crash Recovery section)

---

## 3. MCP Tool Design for Sub-Agents ✅ RESOLVED (design approach decided, full spec pending)

**Context:** Sub-agents use MCP tools to interact with the Animus system (sending messages to users, reading memories, updating progress). The tool interface needs to be designed to work across all three agent SDK providers.

**Resolution:** MCP protocol is the cross-provider standard — all three SDKs support it.

- **MCP is the common ground**: Claude (native in-process + stdio), Codex (stdio), and OpenCode (via config) all support MCP servers
- **Tool definitions in `@animus/shared`**: Provider-agnostic tool schemas (name, description, input/output Zod schemas)
- **Tool handlers in `@animus/backend`**: Where DB access lives — the backend IS the host process for all SDK subprocesses/servers
- **MCP server in `@animus/backend`**: Wraps tool handlers as MCP tools. Runs as stdio server that all SDK adapters can connect to
- **Claude optimization**: Can use `createSdkMcpServer()` for efficient in-process tools (no subprocess overhead)
- **Permission filtering**: `allowedTools` list filtered by contact permission tier before session creation
- **Extensible**: Users can add custom MCP servers in the future via configuration
- **v1 tool set**: Start minimal — `send_message`, `read_memory`, `update_progress`. Expand heavily post-v1

**Further research documented in:** Cross-provider MCP tool abstraction doc (pending)

---

## 4. Structured Output Across SDK Adapters ✅ RESOLVED

**Context:** The mind needs to produce structured cognitive state on every tick while streaming replies naturally.

**Resolution:** Cognitive MCP tools — two in-process tools bracket every response.

- **Approach**: Instead of forcing output into a JSON blob, the model calls `record_thought` first (inner monologue), speaks naturally (reply streams to user), then calls `record_cognitive_state` last (experience, emotions, decisions, memory)
- **Validation**: Zod schemas on MCP tool inputs — validated at tool call time, not post-hoc JSON parsing
- **Streaming**: Phase-based — natural language between `record_thought` and `record_cognitive_state` streams to the frontend via `reply:chunk` events. No JSON path subscriptions needed.
- **Internal type**: Tool outputs accumulate into a `CognitiveSnapshot`, converted to `MindOutput` via `snapshotToMindOutput()` for the EXECUTE stage
- **Tool location**: In-process MCP server in `@animus/backend` (`heartbeat/cognitive-tools.ts`), built via Claude SDK's `createSdkMcpServer()`. Agents package remains a stateless SDK abstraction.
- **Cross-provider**: Claude and Pi support in-process MCP tools natively. Codex/OpenCode fall back to `safeMindOutput()`.
- **Mid-tick re-entry**: Tools support multiple cycles (thought→reply→state→thought→reply→state) with accumulation semantics for mid-tick message injection

**Updated in:** `docs/architecture/heartbeat.md` (Combined MindOutput Schema + Cognitive MCP Tools sections)

---

## 5. Claude OAuth Token Restrictions for Agent SDK ✅ RESOLVED

**Context:** Claude's Agent SDK supports authentication via long-lived OAuth access tokens. Unclear whether third-party restrictions apply.

**Resolution:** Leave ambiguous, support both options, document clearly.

- **Support both**: API key and OAuth token (long-lived, via `claude setup-token`) as authentication options
- **API key is the safe default**: No ambiguity about access level
- **OAuth token as convenience**: For users who already have Claude Code configured (likely Pro/Max subscribers)
- **No special testing needed**: If restrictions exist, users will encounter them naturally and can switch to API key
- **Long-lived tokens**: Valid ~1 year, stored at `~/.claude/.credentials`
- **Environment variable**: `CLAUDE_CODE_OAUTH_TOKEN` for programmatic use

**No doc update needed** — already covered in `docs/agents/claude/sdk-research.md`

---

## 6. Codex ChatGPT OAuth Implementation ✅ RESOLVED (must build, not deferred)

**Context:** The Codex SDK supports authentication via ChatGPT OAuth. Most Codex users authenticate via their ChatGPT account, not API keys — this is a must-build feature.

**Resolution:** Build a device code OAuth proxy through the Animus web UI.

- **Must build**: Unlike the original "defer" recommendation, this is essential — most Codex users authenticate via ChatGPT, not API keys
- **Device code proxy flow**:
  1. Backend initiates OpenAI's device code flow
  2. Returns verification URL + user code to frontend
  3. Frontend displays instructions ("Visit this URL and enter this code")
  4. Backend polls for completion
  5. On success, store tokens encrypted in DB
- **OpenAI's flow is non-standard**: Differs significantly from RFC 8628 — two-step process with server-generated PKCE pair
- **Token storage**: Encrypted in DB (using `IEncryptionService`), cached at runtime
- **tRPC procedures**: `codexAuth.initiate`, `codexAuth.poll`, `codexAuth.status`

**Documented in:** `docs/agents/codex/oauth.md`

---

## 7. Contact "Notes About You" Storage & Surfacing ✅ RESOLVED

**Context:** During onboarding, the user provides personal context about themselves. This needs to be stored and surfaced in the mind's context.

**Resolution:** Store as `notes` field on contacts table (already exists in schema).

- **Storage**: `notes` text field on the contacts table in `system.db` — already exists in the Contact interface and SQL schema
- **Primary contact notes**: Contain the onboarding "Notes About You" free text
- **Context surfacing**: Included in the base system prompt every tick via the Context Builder (not retrieved via search)
- **Editable from settings**: Yes, available in contact settings after onboarding
- **Soft cap**: ~500 tokens (UI guidance, not hard enforcement)
- **Not memory system**: This is static user-provided context, not emergent AI knowledge. Memory system is for what the AI learns

**Updated in:** `docs/architecture/contacts.md` (Contact Notes & "Notes About You" section)

---

## Related Documents

- `docs/architecture/heartbeat.md` — Tick pipeline, session lifecycle, crash recovery, streaming output
- `docs/architecture/agent-orchestration.md` — Sub-agent lifecycle, MCP tools
- `docs/architecture/contacts.md` — Permission tiers, contact notes
- `docs/architecture/context-builder.md` — Context assembly, prompt compilation
- `docs/agents/README.md` — Agent SDK documentation index
- `docs/agents/codex/oauth.md` — Codex OAuth device code proxy design
- `docs/frontend/onboarding.md` — Onboarding flow, agent provider auth, persona creation UX
