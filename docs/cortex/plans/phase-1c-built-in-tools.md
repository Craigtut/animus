# Phase 1C: Built-in Tools

> **Scope:** Implement all 7 P0 built-in tools plus the TaskOutput companion tool. After this phase, the agent can do real work (file operations, shell commands, web fetching).

## Dependencies

- Phase 1B complete (CortexAgent exists, tools can be registered)

## Shared Infrastructure

### Read Registry (`tools/read-registry.ts`)

Session-scoped tracking of which files have been read. Shared by Read, Write, and Edit tools to enforce the read-before-write/edit contract.

```typescript
class ReadRegistry {
  markRead(path: string): void;
  hasBeenRead(path: string): boolean;
  clear(): void;  // called on loop start
}
```

Created once per CortexAgent, passed to Read/Write/Edit tools at registration. Cleared at the start of each agentic loop.

### CWD Tracker (`tools/cwd-tracker.ts`)

Tracks the working directory across Bash calls within a single agentic loop.

```typescript
class CwdTracker {
  constructor(defaultDir: string);
  getCwd(): string;
  updateCwd(newDir: string): void;
  reset(): void;  // called on loop start, resets to default
}
```

### Tool Registration Pattern

All built-in tools follow the same pattern:

```typescript
export function createBashTool(config: BashToolConfig): AgentTool {
  return {
    name: 'Bash',
    label: 'Execute shell command',
    description: '...',
    parameters: Type.Object({ ... }),
    execute: async (toolCallId, params, signal, onUpdate) => {
      // implementation
      return { content: [...], details: { ... } };
    },
  };
}
```

Each tool is a factory function that returns an `AgentTool` object. The factory accepts config (working directory, registry references, etc.) so the tool has access to shared state.

**Utility model access:** Tools that need the utility model (WebFetch for summarization, Bash Layer 7 for auto-mode classifier) receive a `utilityComplete` function reference in their config. This is a bound method from `CortexAgent` passed at tool creation time:

```typescript
const webFetch = createWebFetchTool({
  utilityComplete: cortexAgent.utilityComplete.bind(cortexAgent),
  maxPerLoop: config.webFetch?.maxPerLoop ?? 20,
});
```

**Registration in CortexAgent:** The consumer passes a list of enabled tool names in `CortexAgentConfig`. `CortexAgent` maps names to factory functions, creates each tool with the appropriate config (shared ReadRegistry, CwdTracker, utilityComplete reference), and registers them on the pi-agent-core `Agent` via `agent.setTools()`. The mapping lives in `tools/index.ts`.

**Session-scoped reset:** `CortexAgent.prompt()` calls `readRegistry.clear()` and `cwdTracker.reset()` before starting the agentic loop (keyed to `agent_start` event from the event bridge).

## Tasks

### 1C.1: Read Tool (`tools/read.ts`)

**Reference:** `tools/read.md`

Parameters: `path`, `offset`, `limit`, `pages` (PDF only, e.g., "1-5")
Returns: `content` (line-numbered text), `details` (full metadata)

Key implementation:
- `cat -n` format output (spaces + line_number + tab + content)
- Line truncation at 2000 characters
- Default 2000 line limit
- Read registry: `markRead(path)` after successful read
- Image detection: return base64 `ImageContent` for PNG/JPG/GIF/WebP
- PDF text extraction (use `pdf-parse` or similar). For PDFs >10 pages, require `pages` parameter. Max 20 pages per request.
- Binary file detection (not image/PDF): return error "Binary file detected."
- Error handling table from `tools/read.md`
- Cross-platform: accept both `/` and `\` paths, normalize internally. Case sensitivity follows filesystem.

**Tests:** Read a text file, read with offset/limit, read nonexistent file, read an image, read a PDF, read a large PDF without pages param (error), read a binary file (error), read a directory (error), line truncation, UTF-8/UTF-16/Latin-1 encoding handling, read-before-edit violation in Edit tool.

### 1C.2: Write Tool (`tools/write.ts`)

**Reference:** `tools/write.md`

Parameters: `path`, `content`
Returns: `content` (confirmation), `details` (diff, original content)

Key implementation:
- Read-before-write enforcement via ReadRegistry
- Atomic write (temp file + rename)
- Parent directory creation
- Structured diff computation in `details` (for UI)
- Create vs update detection

**Tests:** Write new file, overwrite existing (with prior read), write without read (error), parent dir creation, atomic write behavior.

### 1C.3: Edit Tool (`tools/edit.ts`)

**Reference:** `tools/edit.md`

Parameters: `path`, `oldString`, `newString`, `replaceAll`
Returns: `content` (replacement count), `details` (diff, original)

Key implementation:
- Exact string matching (not regex)
- Uniqueness constraint when `replaceAll: false`
- Read-before-edit enforcement
- Line ending normalization (`\r\n` -> `\n` before matching, preserve original on output)
- Multi-line support

**Tests:** Single replacement, replaceAll, non-unique match (error), oldString not found (error), identical strings (error), line ending normalization, multi-line edit.

### 1C.4: Glob Tool (`tools/glob.ts`)

**Reference:** `tools/glob.md`

Parameters: `pattern`, `path`
Returns: `content` (file paths, max 100), `details` (full count, duration)

Key implementation:
- Use `fast-glob` npm package
- Sort by modification time (newest first)
- 100-file truncation with `truncated` flag
- `.gitignore` respect (use `ignore` npm package); default ignore patterns if no `.gitignore`
- Path separator normalization (always forward slash in output)

**New dependencies:** `fast-glob`, `ignore`

**Tests:** Basic glob, recursive glob, gitignore respect, truncation at 100, no matches (empty array), invalid pattern (error), path normalization.

### 1C.5: Grep Tool (`tools/grep.ts`)

**Reference:** `tools/grep.md`

Parameters: `pattern`, `path`, `glob`, `type`, `outputMode`, `contextLines`, `caseSensitive`, `maxResults`, `offset`, `multiline`
Returns: varies by `outputMode`

Key implementation:
- Bundled ripgrep binaries (6 platforms) as optional npm dependencies
- Runtime binary path resolution
- Node.js regex fallback (`tools/grep-fallback.ts`) if ripgrep unavailable
- Three output modes: `files_with_matches` (default), `content`, `count`
- Pagination via `offset` + `maxResults`
- `.gitignore` respect

**Ripgrep distribution:** Bundle platform-specific binaries as optional npm dependencies, one per platform (arm64-darwin, x64-darwin, x64-linux, arm64-linux, x64-win32, arm64-win32). At install time, npm installs only the matching platform binary. At runtime, resolve the binary path from the package install location. This follows the same pattern Claude Code uses. See `tools/grep.md` Ripgrep Distribution section.

**Tests:** Each output mode, case sensitivity, multiline, pagination, gitignore respect, ripgrep fallback path (Node.js regex search when rg unavailable), invalid regex (error), permission denied on files (skip silently).

### 1C.6: Bash Tool (`tools/bash.ts` + `tools/bash-safety.ts`)

**Reference:** `tools/bash.md` (extensive)

Parameters: `command`, `timeout`, `description`, `background`
Returns: `content` (truncated output), `details` (full output, CWD)

This is the most complex tool. Split into:
- `bash.ts`: execution logic, CWD tracking, output handling, background/auto-yield
- `bash-safety.ts`: all 7 safety layers

Key implementation:
- Platform-native shell selection (bash/zsh on Unix, PowerShell on Windows)
- Shell trust validation against `/etc/shells`
- CWD tracking via `___CWD___` marker
- Output truncation (first 15K + last 15K, middle elided)
- UTF-8 encoding enforcement (PowerShell prefix on Windows)
- Process tree cleanup (SIGKILL on Unix, taskkill on Windows)
- Background execution with auto-yield (default 10s threshold)
- `CORTEX_SHELL=exec` env marker

Safety layers (all in `bash-safety.ts`):
1. Environment variable stripping
2. Critical path protection (Unix + Windows paths)
3. Command classification (read/write/create/network/safe-stdin/unknown) with PowerShell equivalents
4. Path validation for write commands
5. Obfuscation/injection detection (20+ Unix patterns, 6+ PowerShell patterns, invisible Unicode stripping)
6. Script preflight (shell syntax in Python/JS files)
7. Auto-mode classifier (utility model LLM call, two-stage)

Safe URL allowlist for curl|bash: brew.sh, get.pnpm.io, bun.sh, sh.rustup.rs, get.docker.com, install.python-poetry.org, raw.githubusercontent.com/Homebrew, raw.githubusercontent.com/nvm-sh/nvm

**Tests:** This needs the most extensive test suite of any tool:
- Shell selection per platform
- CWD tracking across calls
- Output truncation
- Background execution
- Auto-yield
- Process tree cleanup
- Each safety layer independently
- Command classification (both bash and PowerShell)
- Safe-stdin denied flags per binary
- Obfuscation pattern detection
- Critical path blocking
- Env var stripping
- Safe URL allowlist
- Error handling table

### 1C.7: TaskOutput Tool (`tools/task-output.ts`)

Companion tool for polling backgrounded Bash and SubAgent processes.

Parameters: `taskId`, `action` (`poll` | `send` | `kill`), `input` (for `send` action), `signal` (for `kill` action)
Returns: `content` (latest output, status), `details` (full output)

Auto-registered alongside Bash tool.

**Tests:** Poll a running background task, send input, kill a process, poll completed task.

### 1C.8: WebFetch Tool (`tools/web-fetch.ts` + `tools/web-fetch-cache.ts`)

**Reference:** `tools/web-fetch.md`

Parameters: `url`, `prompt`
Returns: `content` (summarized answer from utility model), `details` (URL, status, cache hit, sizes)

Key implementation:
- HTTP fetch via `undici` or Node built-in `fetch`
- HTML to markdown via `turndown`
- Element stripping before Turndown (`script`, `style`, `nav`, `footer`, `header`)
- Secondary LLM call using cortex utility model
- 15-minute in-memory cache (TTL-based, keyed by URL)
- Per-loop rate limit (default 20, configurable)
- URL validation (reject file://, data://, private IPs)
- Cross-origin redirect handling
- Content truncation at ~25,000 tokens before summarization

**New dependencies:** `turndown`

**Tests:** Fetch a page (mock HTTP), cache hit behavior, redirect handling, URL rejection, rate limit enforcement, JavaScript-only page (error), each error condition.

## Completion Criteria

- All 7 P0 tools + TaskOutput tool implemented and registered with CortexAgent
- Each tool has comprehensive unit tests covering parameters, returns, error cases
- Read/Write/Edit share a session-scoped ReadRegistry
- Bash CWD tracking works across calls within a loop
- Bash safety layers all pass their test suites
- WebFetch uses the utility model for summarization
- Tools use pi-agent-core's `AgentToolResult<T>` content/details split

## Files Created

| File | Purpose |
|------|---------|
| `src/tools/index.ts` | Tool barrel export + registration |
| `src/tools/read-registry.ts` | Shared read tracking |
| `src/tools/cwd-tracker.ts` | Bash CWD tracking |
| `src/tools/read.ts` | Read tool |
| `src/tools/write.ts` | Write tool |
| `src/tools/edit.ts` | Edit tool |
| `src/tools/glob.ts` | Glob tool |
| `src/tools/grep.ts` | Grep tool |
| `src/tools/grep-fallback.ts` | Node.js regex fallback |
| `src/tools/bash.ts` | Bash execution |
| `src/tools/bash-safety.ts` | Bash 7 safety layers |
| `src/tools/task-output.ts` | Background task companion |
| `src/tools/web-fetch.ts` | WebFetch tool |
| `src/tools/web-fetch-cache.ts` | URL cache |
| `tests/unit/tools/*.test.ts` | Tests for each tool |

## New External Dependencies

| Package | Used By |
|---------|--------|
| `fast-glob` | Glob tool |
| `ignore` | Glob tool (.gitignore) |
| `turndown` | WebFetch tool |
| Platform-specific ripgrep packages | Grep tool |
