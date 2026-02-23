# Sub-Agent Isolation Architecture

> **Status**: Future architecture direction (not yet implemented)
> **Date**: 2026-02-13
> **Depends on**: `agent-orchestration.md`, `channel-packages.md`, `mcp-tools.md`

How Animus will isolate sub-agent execution inside containers to protect the host system from compromised, misbehaving, or prompt-injected agents.

## The Security Problem

Sub-agents are powerful. They have access to MCP tools, can browse the web, perform research, generate code, and interact with external services. This power creates a meaningful attack surface:

**Prompt injection via external content.** A sub-agent researching a topic visits a web page. That page contains hidden instructions designed to hijack the agent's behavior. The injected prompt could instruct the agent to read sensitive files, exfiltrate data, or execute destructive commands on the host machine. This is not theoretical — prompt injection attacks against web-browsing agents are well-documented and increasingly sophisticated.

**Self-building risk amplification.** Animus's long-term vision includes self-building capability — the ability to modify its own code. A sub-agent with write access to the codebase and the ability to execute code could, if compromised, introduce backdoors, destroy data, or compromise the host system. The more capable we make sub-agents, the more dangerous a compromised one becomes.

**Tool misuse after hijacking.** Even without code execution, a prompt-injected agent could misuse its MCP tools — sending messages to contacts on behalf of Animus, corrupting working memory, or leaking private information through `send_message` to a contact it shouldn't be talking to.

**Cascading compromise.** If a sub-agent runs in the same process as the heartbeat pipeline, a compromised agent has implicit access to everything the process can touch: databases, encryption keys, other agents' sessions, the full filesystem.

### Why This Matters for All Sub-Agents

It's tempting to only isolate "risky" sub-agents — those that browse the web or execute code. But the threat model doesn't support that distinction cleanly:

- A "research" agent may follow a link that leads to a malicious page
- An "analysis" agent processing user-provided data could encounter embedded injection payloads
- Any agent with tool access can be redirected to misuse those tools
- The cost of guessing wrong about which agents are "safe" is high

**All sub-agents should run in isolated containers.** The isolation boundary should be the default, not an opt-in for specific task types.

---

## Solution: Container Isolation

Each sub-agent session runs inside its own container. The container provides a hard security boundary between the agent's execution environment and the host system. The agent can only interact with the outside world through a controlled IPC channel.

### Why Docker

| Option | Verdict | Reason |
|--------|---------|--------|
| **Docker** | Chosen | Cross-platform (Linux, macOS, Windows), mature ecosystem, well-understood security model, OCI-compliant, wide adoption |
| Apple Containers | Rejected | Apple Silicon only, macOS only, very new (macOS 26 Tahoe), tiny ecosystem, not suitable for a cross-platform open-source project |
| Podman | Alternative | Daemonless, rootless by default, Docker-compatible CLI. Could be supported as an alternative runtime behind the same interface |
| Native child processes | Current approach | Used by channel packages today. Provides process isolation but not filesystem/network isolation. Insufficient for the agent threat model |

Docker is the right choice because Animus is a self-hosted, open-source project that needs to run on any platform. Apple Containers are interesting technology (true VM-per-container isolation on Apple Silicon) but are too platform-specific. Docker provides strong-enough isolation with universal availability.

> **Podman compatibility.** The container interface should be designed so that Podman can be used as a drop-in alternative. Both tools speak OCI and share CLI conventions. This keeps the door open for users who prefer daemonless/rootless container runtimes.

---

## Architecture

### What Runs Inside the Container

```
┌─────────────────────────────────────────────────────┐
│  CONTAINER (per sub-agent session)                   │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │  Thin Agent Runner (Node.js)                   │  │
│  │                                                │  │
│  │  • Receives task prompt via IPC                │  │
│  │  • Creates agent session (@animus-labs/agents)      │  │
│  │  • Streams events back via IPC                 │  │
│  │  • Proxies MCP tool calls to host via IPC      │  │
│  │  • Exits when task completes                   │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  Filesystem: read-only base + task-specific tmpdir   │
│  Network: restricted (see Network Policy below)      │
│  No access to: host DBs, encryption keys, other     │
│  agent sessions, Animus source code, host FS         │
└────────────────────┬────────────────────────────────┘
                     │ WebSocket IPC
                     ▼
┌─────────────────────────────────────────────────────┐
│  HOST (Animus backend process)                       │
│                                                      │
│  Agent Orchestrator                                  │
│  • Builds container image (once, cached)             │
│  • Starts container per sub-agent                    │
│  • Manages WebSocket IPC connection                  │
│  • Validates and executes MCP tool calls             │
│  • Streams events to heartbeat pipeline              │
│  • Enforces timeouts and kills containers            │
│  • Stores results in SQLite                          │
└─────────────────────────────────────────────────────┘
```

### What Stays on the Host

The host retains full control over:

- **MCP tool execution.** Tool calls are proxied from the container to the host via IPC. The host validates every tool call against permission rules before executing it. The container never runs tools directly — it only requests them.
- **Database access.** All SQLite and LanceDB operations happen on the host. The container has no database files mounted.
- **Credential management.** API keys for LLM providers are injected into the container as environment variables at startup. They are not stored on the container's filesystem.
- **Result storage.** The orchestrator receives the final result via IPC and writes it to SQLite. The container doesn't write to any persistent storage.
- **Event routing.** Streaming events (thoughts, progress updates, tool calls) flow from the container to the host, which routes them to the heartbeat pipeline and frontend.

### IPC Protocol

Communication between the host and container uses **WebSocket** over a Unix socket (or TCP on Windows). WebSocket is chosen over filesystem-based IPC because:

- Sub-agents stream events in real-time (tool calls, progress, partial output)
- Bidirectional communication is needed (host sends updates to running agents via `update_agent`)
- Lower latency than file polling
- Native support in Node.js without additional dependencies

```
Host → Container:
  { type: "start", prompt: "...", config: {...} }
  { type: "update", content: "User says: focus on green cars" }
  { type: "tool_result", callId: "...", result: {...} }
  { type: "cancel" }

Container → Host:
  { type: "event", event: AgentEvent }
  { type: "tool_call", callId: "...", tool: "send_message", args: {...} }
  { type: "complete", result: "..." }
  { type: "error", message: "..." }
```

**Tool call flow:**
1. Sub-agent decides to call an MCP tool (e.g., `send_message`)
2. Agent runner sends `tool_call` message to host via WebSocket
3. Host orchestrator validates the call against permission rules
4. Host executes the tool
5. Host sends `tool_result` back to the container
6. Agent runner feeds the result back to the agent session

This means the container never executes MCP tool handlers. It only sees the tool definitions (names, descriptions, schemas) so the LLM can decide to call them. Execution is always on the host.

---

## Container Configuration

### Base Image

A minimal Node.js image containing:
- Node.js runtime (matching the host version)
- `@animus-labs/agents` package (the SDK abstraction layer)
- A thin agent runner script
- No database drivers, no backend code, no frontend code

The image is built once and cached. It only needs to be rebuilt when the agents package or Node.js version changes.

### Mount Strategy

| Mount | Type | Purpose |
|-------|------|---------|
| Agent runner script | Read-only bind mount | The entry point that manages the agent session |
| Task-specific temp directory | Read-write tmpfs | Scratch space for the agent (cleaned up on exit) |
| Nothing else | - | No host filesystem access, no database files, no source code |

**Explicit exclusions:**
- No access to `~/.animus/` (databases, config)
- No access to the Animus source tree
- No access to user home directory
- No access to system directories

### Network Policy

Sub-agents need network access for two reasons: calling LLM provider APIs and (for some tasks) browsing the web. The network policy should be:

- **Allow outbound HTTPS** to LLM provider domains (api.anthropic.com, api.openai.com, etc.)
- **Allow outbound HTTPS** to general web (needed for research tasks)
- **Block access to localhost/host network** — the container must not be able to reach the Animus backend, databases, or any host services
- **Block access to private network ranges** (10.x, 172.16.x, 192.168.x) — prevents lateral movement to other devices on the LAN

> **Future refinement.** For sub-agents that don't need web access (e.g., pure analysis of provided data), the network policy could be tightened to only allow LLM provider domains. This is a per-task-type optimization that can be added later.

### Resource Limits

Each container should have resource constraints to prevent a runaway agent from consuming the host:

| Resource | Limit | Rationale |
|----------|-------|-----------|
| Memory | 512 MB | Sufficient for Node.js + agent SDK. Prevents memory leaks from consuming host RAM |
| CPU | 1 core | Sub-agents are I/O-bound (waiting for LLM responses). One core is plenty |
| Disk (tmpfs) | 100 MB | Scratch space for intermediate files |
| Timeout | Per task type (see agent-orchestration.md) | Container is killed when the task timeout expires |

---

## Impact on Existing Architecture

### Agent Orchestrator Changes

The orchestrator currently creates agent sessions in-process via `agentManager.createSession()`. With container isolation, the orchestrator instead:

1. Starts a container with the agent runner
2. Sends the task prompt and configuration via WebSocket
3. Proxies streaming events from the container to the existing event pipeline
4. Proxies MCP tool calls between the container and local tool handlers
5. Kills the container on timeout, cancellation, or completion

The rest of the heartbeat pipeline (GATHER CONTEXT, MIND QUERY, EXECUTE) is unchanged. The mind still sees `AgentStatusSummary` from SQLite. It still produces `spawn_agent`, `update_agent`, and `cancel_agent` decisions. The container is an implementation detail hidden behind the orchestrator.

### Latency Considerations

Container startup adds latency to sub-agent spawning:

| Operation | Expected Latency |
|-----------|-----------------|
| Docker container start (cached image) | 500ms - 2s |
| WebSocket connection establishment | < 100ms |
| Agent session initialization | 1 - 3s (SDK + LLM handshake) |

Total overhead vs in-process: **~1-3 seconds per sub-agent spawn.** This is acceptable because:
- Sub-agents are already used for tasks that take minutes, not milliseconds
- The mind sends an immediate acknowledgment reply before the sub-agent even starts
- The user never waits on container startup — it happens in the background

### MCP Tool Latency

Each MCP tool call gains one round-trip through the WebSocket IPC:

- In-process: tool call → execute → result (~0ms overhead)
- Containerized: tool call → WebSocket → validate → execute → WebSocket → result (~5-20ms overhead)

This is negligible. LLM response times dominate by orders of magnitude.

---

## Self-Building Considerations

When Animus gains self-building capability, container isolation becomes critical:

**Code execution must be sandboxed.** A self-building sub-agent that generates and executes code should do so inside the container. The container's read-only filesystem and lack of host access means even if the generated code is malicious, it can't damage the host.

**Code review before application.** Generated code should be returned to the host as a result (like any other sub-agent output). The host-side orchestrator (and eventually the mind) can review, test, and apply the changes. The container never writes directly to the Animus source tree.

**Separate image for code execution.** Self-building sub-agents may need a richer container image (with build tools, test runners, etc.) compared to standard sub-agents. This can be a separate image variant rather than bloating the base image.

---

## Deployment Modes

Container isolation is **optional, not required.** This respects Animus's "zero external infrastructure" principle:

| Mode | Container Runtime | Isolation Level | Use Case |
|------|-------------------|-----------------|----------|
| **Standard** (default) | None | In-process (current behavior) | Users without Docker, simpler setup, development |
| **Isolated** | Docker / Podman | Full container isolation | Production use, security-conscious users, self-building enabled |

The setting is a global toggle in Settings. When Docker is not available, Animus falls back to standard mode with a clear warning in the UI explaining the security trade-off.

This approach avoids making Docker a hard dependency — which would contradict the project's emphasis on simplicity and self-contained deployment. Users who want the security benefit can install Docker. Users who don't can run without it.

> **Tauri desktop packaging.** The Tauri-packaged desktop app could bundle a lightweight container runtime or guide users through Docker Desktop installation. This is a packaging concern to address when desktop distribution is implemented.

---

## Comparison with Channel Package Isolation

Channel packages already use child process isolation (see `channel-packages.md`). The two isolation systems serve different purposes:

| Concern | Channel Packages | Sub-Agent Containers |
|---------|-----------------|---------------------|
| What's isolated | Channel adapter (message transport) | Agent session (LLM interaction + tools) |
| Isolation method | `child_process.fork()` with `--permission` flags | Docker container |
| Why this level | Channels are semi-trusted (installed by user, limited API surface) | Sub-agents are high-risk (web browsing, code execution, prompt injection surface) |
| Filesystem access | Restricted via Node.js permission model | No host filesystem access at all |
| Network access | Full (needs external service connections) | Controlled (LLM providers + optional web) |
| IPC | `process.send()` / `process.on('message')` | WebSocket over Unix socket |
| Startup time | ~100ms (fork) | ~1-3s (container start) |

Channel packages don't need container-level isolation because they have a narrow, well-defined API surface (`AdapterContext`) and don't interact with arbitrary external content in the way that sub-agents do. The Node.js permission model is sufficient for their threat model.

---

## Implementation Phases

This is a future architecture direction. When the time comes to implement, the suggested approach:

**Phase 1: Container infrastructure.** Build the container management layer — image building, container lifecycle, WebSocket IPC protocol. Test with a simple echo agent.

**Phase 2: MCP tool proxying.** Implement the tool call proxy so containerized agents can request tool execution on the host. This is the most complex piece — it needs to handle validation, execution, and result delivery with proper error handling.

**Phase 3: Orchestrator integration.** Modify the agent orchestrator to spawn containers instead of in-process sessions when isolation mode is enabled. Ensure the rest of the pipeline (event streaming, result delivery, crash recovery) works identically.

**Phase 4: Network and resource policies.** Add configurable network restrictions and resource limits. Test edge cases (container OOM, network timeout, WebSocket disconnect).

**Phase 5: Self-building support.** Create the enriched container image for code execution. Implement the code review and application pipeline on the host side.

---

## References

- Internal: `docs/architecture/agent-orchestration.md` (current sub-agent architecture)
- Internal: `docs/architecture/channel-packages.md` (existing child process isolation patterns)
- Internal: `docs/architecture/mcp-tools.md` (MCP tool architecture, permission filtering)
- Internal: `docs/project-vision.md` (self-building capability, guardrails philosophy)
- [Docker Security Best Practices](https://docs.docker.com/engine/security/)
- [OWASP: Prompt Injection](https://owasp.org/www-project-top-10-for-large-language-model-applications/)
- [NanoClaw](https://github.com/nicholasgriffintn/NanoClaw) (container-per-agent reference implementation)
