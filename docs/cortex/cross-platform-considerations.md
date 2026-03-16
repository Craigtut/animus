# Cross-Platform Considerations

> **STATUS: RESEARCH** - Implementation guidance for platform-specific behaviors.

Cortex runs on macOS (ARM + Intel), Linux (ARM + x86_64), and Windows (x64). This document covers platform-specific gaps and their solutions.

## Windows Tauri Graceful Shutdown (CRITICAL)

### Problem

On Windows, Tauri terminates the Node sidecar with `child.kill()`, which calls `TerminateProcess` (equivalent to SIGKILL). The process dies instantly. `CortexAgent.destroy()` never runs.

On macOS/Linux, Tauri sends SIGTERM with a 5-second grace period before SIGKILL. The sidecar receives the signal, calls `stopHeartbeat()` -> `destroy()`, and shuts down cleanly.

On Windows, every app close leaks:
- MCP stdio subprocesses
- Bash tool child processes
- Background sub-agents
- The conversation history checkpoint from the current tick

The `process.on('exit')` safety net in cortex is synchronous. It cannot `await waitForIdle()` or spawn `taskkill /F /T` (which is itself a subprocess).

### Solution

**Level 1: Tauri Windows shutdown fix**

Modify `packages/tauri/src/main.rs` to send an IPC shutdown message to the sidecar before killing it on Windows:

1. Send a shutdown IPC message to the sidecar via the existing IPC channel
2. Wait up to 5 seconds for the sidecar to acknowledge (or the process to exit)
3. If the sidecar hasn't exited after 5 seconds, call `child.kill()` as a fallback

The sidecar's IPC handler calls `stopHeartbeat()` -> `destroy()` upon receiving the shutdown message. This mirrors the Unix SIGTERM pattern.

**Level 2: Windows Job Objects**

Assign all child processes spawned by cortex to a Windows Job Object configured with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. When the parent process exits (even via TerminateProcess), all children in the job are automatically terminated by the OS.

Node.js doesn't expose Job Objects natively. Options:
- A small native addon (~50 lines of C++) that creates a Job Object and assigns child PIDs
- The `windows-job-object` npm package (if suitable)
- Use `child_process.spawn` with `{ windowsHide: true }` and maintain a PID set for manual cleanup

**Level 3: Synchronous exit handler fallback**

`process.on('exit')` can call `process.kill(pid)` synchronously for each tracked PID. This only kills direct children (not grandchildren), but it's the last line of defense. Maintain a `Set<number>` of all spawned subprocess PIDs in the CortexAgent.

### Implementation Phase

- Level 1 (Tauri IPC): Add to Phase 2A as a new task (touches `packages/tauri/src/main.rs`)
- Level 2 (Job Objects): Investigate in Phase 1C when Bash tool process spawning is implemented. If a suitable npm package exists, integrate it. Otherwise, defer to post-launch.
- Level 3 (PID tracking): Already described in `cortex-architecture.md` Lifecycle section. Implement in Phase 1B.

## OAuth in Docker (CRITICAL)

### Problem

OAuth authorization code flows spin up a local HTTP server on `localhost:PORT` to receive the callback. Inside Docker, `localhost` is the container's network, not reachable from the host's browser.

The `backend-auth-integration.md` has `isHeadless()` detection and device-code-style UI. But whether this works depends on pi-ai's OAuth login functions supporting device code flow (stateless, no callback server) vs. authorization code flow (needs localhost callback).

### Solution

**Verify each provider's OAuth flow type.** Document which work in Docker:

| Provider | OAuth Function | Flow Type | Docker Support |
|----------|---------------|-----------|:-:|
| Anthropic | `loginAnthropic` | TBD — verify | TBD |
| OpenAI Codex | `loginOpenAICodex` | Device code (likely) | Likely yes |
| GitHub Copilot | `loginGitHubCopilot` | Device code | Yes |
| Google Gemini CLI | `loginGeminiCli` | TBD — verify | TBD |
| Google Antigravity | `loginAntigravity` | TBD — verify | TBD |

**Action items:**
1. Read pi-ai's OAuth login function source code to determine each flow type
2. For providers using authorization code flow: document that Docker users must use API key auth (Layer 2 in the progressive disclosure)
3. Add a "Docker OAuth Compatibility" section to `backend-auth-integration.md`

### Implementation Phase

Add to Phase 2B (auth integration). The verification step should happen early in 2B before building the OAuth UI.

## Docker Build Pipeline (HIGH)

### Problem

The current Dockerfile builds workspace packages in dependency order. Adding `@animus-labs/cortex` requires Dockerfile updates.

### Changes Needed

1. Package file copy: `COPY packages/cortex/package.json packages/cortex/`
2. Source copy: `COPY packages/cortex/ packages/cortex/`
3. Build step: `cd ../cortex && rm -rf dist && npx tsc` (between shared and backend builds)
4. Runtime copy: `COPY --from=builder /app/packages/cortex/dist packages/cortex/dist`
5. Ripgrep binaries: If bundled as optional deps, they need to survive `npm prune --omit=dev` or be installed via `apt` in the runtime stage (`apt-get install -y ripgrep`)

### Implementation Phase

Add to Phase 1A (package scaffolding) as a task: update the Dockerfile to include the cortex package in the build pipeline. The ripgrep binary concern is addressed in Phase 1C (Grep tool).

## Skill Preprocessor Shell Commands on Windows (HIGH)

### Problem

The skill preprocessor's shell command syntax (`` !`command` ``) executes commands via the system shell. On Windows, this means PowerShell. Skills written with bash syntax (`` !`cat config.json | grep "key"` ``) fail on Windows because PowerShell has different command syntax.

Skills are supposed to be cross-platform since plugins install at runtime on any platform.

### Solution

1. The preprocessor uses the same shell selection logic as the Bash tool (PowerShell on Windows, bash/zsh on Unix).
2. Document cross-platform considerations for skill authors in `skill-system.md`:
   - For anything beyond trivial commands, use `` !{script: path.js} `` (JavaScript is cross-platform)
   - Simple commands like `git log --oneline -5` work everywhere
   - Pipe chains and Unix-specific commands (`cat`, `grep`, `awk`) should use the script approach
3. Add an optional `shell` field to the command syntax: `` !`bash: command` `` or `` !`powershell: command` `` for platform-specific commands. Default: auto-detect.

### Implementation Phase

Add to Phase 4 (skill system) as a documentation task in `skill-system.md` and an implementation consideration in the preprocessor.

## macOS Dock Icon Suppression (MEDIUM)

### Problem

The existing codebase has elaborate dock icon suppression for macOS Tauri. Cortex spawns its own subprocesses (MCP servers, Bash children, sub-agents) that could flash dock icons if they don't inherit the suppression environment variables (`DYLD_INSERT_LIBRARIES`, `ANIMUS_DOCK_SUPPRESS_ADDON`).

### Solution

Cortex already inherits `process.env` for child processes (Layer 1 of Bash safety strips dangerous vars but preserves everything else). MCP client subprocess spawning should do the same: inherit `process.env` with dangerous vars stripped.

The key is that cortex doesn't need explicit dock icon awareness. As long as it passes through the parent's environment (minus the blocked security vars), the Tauri-set dock suppression vars propagate automatically.

**Verify:** Ensure `DYLD_INSERT_LIBRARIES` is NOT in the Bash tool's env var blocklist (it shouldn't be; it IS in the list as a security-blocked var). This creates a conflict: dock suppression on macOS uses `DYLD_INSERT_LIBRARIES`, but the Bash safety layer strips it for library injection prevention.

**Resolution:** The consumer (Animus backend) should explicitly add `DYLD_INSERT_LIBRARIES` and `ANIMUS_DOCK_SUPPRESS_ADDON` to a cortex config `envOverrides` field that gets merged into ALL subprocess environments, bypassing the security blocklist for these specific vars. Add `envOverrides?: Record<string, string>` to `CortexAgentConfig`.

### Implementation Phase

Add `envOverrides` config field in Phase 1A (types), implement in Phase 1C (Bash tool) and Phase 3 (MCP client).

## Docker Shutdown Grace Period (MEDIUM)

### Problem

Docker's default `stop_grace_period` is 10 seconds. Cortex's `destroy()` sequence could exceed this if tools don't check the AbortSignal (a long-running bash command blocks `waitForIdle()`).

### Solution

Add a configurable timeout to `destroy()`:

```typescript
async destroy(timeoutMs: number = 8000): Promise<void> {
  const deadline = setTimeout(() => {
    // Force-kill remaining processes synchronously
    this.forceKillAll();
  }, timeoutMs);

  try {
    // Normal ordered cleanup...
  } finally {
    clearTimeout(deadline);
  }
}
```

Document that Docker users should set `stop_grace_period: 15s` in `docker-compose.yml` if they experience orphaned processes.

### Implementation Phase

Add to Phase 1B (CortexAgent lifecycle). Update `cortex-architecture.md` Lifecycle section.

## Custom Endpoint Docker Networking (MEDIUM)

### Problem

Docker users running local LLM servers (Ollama, vLLM) on the host need `host.docker.internal` instead of `localhost`.

### Solution

Add help text in the custom endpoint UI: "Running in Docker? Use `http://host.docker.internal:PORT` instead of `localhost`."

Optionally: detect Docker in the backend (`isHeadless()` already has this) and auto-suggest the correct hostname in the placeholder.

### Implementation Phase

Add to Phase 2B (frontend auth UX). Small UX addition to the custom endpoint form.

## Windows Path Length Limits (MEDIUM)

### Problem

Windows has a 260-character MAX_PATH limit by default. Deeply nested paths in the workspace could hit this limit.

### Solution

1. Document in tool docs that Windows users may need to enable long paths via registry (`LongPathsEnabled = 1`)
2. Consider using `\\?\` prefix on paths when running on Windows (Node.js supports this via `path.toNamespacedPath()`)
3. Use a shorter data directory path on Windows if possible

### Implementation Phase

Documentation only. Add notes to `bash.md` and `tools/README.md`.

## Concurrent MCP Connections and File Descriptors (MEDIUM)

### Problem

Each persistent MCP stdio connection holds 2 file descriptors. With many plugins, the default Docker `ulimit -n 1024` could be approached.

### Solution

1. Document recommended `ulimit` settings for Docker deployment
2. The persistent vs per-tick connection decision (resolved as persistent in the plans) means FD usage scales with plugin count. Note this as a scaling consideration.
3. If FD limits become a real issue, consider connection pooling or lazy connection (connect on first tool call, disconnect after idle timeout).

### Implementation Phase

Documentation only. Add to deployment guide.

## Low-Priority Items

### Cortex in workspace config
Phase 1A already handles adding to workspace `package.json`. Verify CLAUDE.md is updated when the package is added.

### pi-agent-core/pi-ai native deps
Verify during Phase 1A `npm install` that these are pure JS with no native bindings. If they have native deps, document the build requirements.

### Tauri CSP
All API calls go through the Node sidecar, not the webview. CSP doesn't apply. No action needed unless the architecture changes.

### conversation_history column size
SQLite handles large TEXT columns well, especially with WAL mode (already enabled in Animus). No action needed.

### Sub-agent process count
Document in `tools/sub-agent.md` that `maxConcurrentSubAgents: 4` means up to 4 additional process trees. With Bash commands in each sub-agent, the total process count can grow significantly.
