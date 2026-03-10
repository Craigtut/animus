# Claude Agent SDK: Binary Architecture & Auth Flow

> STATUS: Reference documentation. Findings verified against `@anthropic-ai/claude-agent-sdk@0.1.77`.

## Overview

The Claude Agent SDK ships two distinct executable artifacts that serve different purposes. Understanding this split is critical for Animus's SDK lifecycle management.

## The Two Executables

### 1. `cli.js` (11 MB, Node.js script)

The SDK-bundled Claude Code application, minified into a single JavaScript file.

- **Location**: `node_modules/@anthropic-ai/claude-agent-sdk/cli.js`
- **Runs via**: `node cli.js [args]` (or Bun)
- **Version**: Matches Claude Code release version (e.g., `v2.0.77`)
- **What it is**: The full Claude Code codebase compiled to a single JS file. It IS Claude Code, not a wrapper around it.

**Subcommands available in `cli.js`:**

| Command | Purpose |
|---------|---------|
| `setup-token` | OAuth browser flow; returns a long-lived token. **Requires TTY (Ink TUI).** |
| `install` | Downloads and installs the native Claude Code binary |
| `mcp` | Configure MCP servers |
| `plugin` | Manage plugins |
| `doctor` | Health check |
| `update` | Check for updates |

**Subcommands NOT available in `cli.js`:**

| Command | Notes |
|---------|-------|
| `auth login` | Only in the native binary |
| `auth logout` | Only in the native binary |
| `auth status` | Only in the native binary |

**How the SDK uses it:** When `sdk.query()` or `sdk.unstable_v2_createSession()` is called, the SDK spawns `node cli.js` as a subprocess with JSON-line streaming over stdin/stdout. The `pathToClaudeCodeExecutable` option defaults to `cli.js` relative to the SDK module:

```typescript
// From sdk.mjs (decompiled)
let pathToClaudeCodeExecutable = options.pathToClaudeCodeExecutable;
if (!pathToClaudeCodeExecutable) {
  const dirname = join(fileURLToPath(import.meta.url), '..');
  pathToClaudeCodeExecutable = join(dirname, 'cli.js');
}
```

### 2. Native Binary (approximately 190 MB, Bun-compiled)

The full Claude Code CLI compiled to a platform-specific native executable.

- **Location after install**: `$XDG_DATA_HOME/claude/versions/<version>/` (default: `~/.local/share/claude/versions/`)
- **Symlink**: `~/.local/bin/claude` (Unix), equivalent on Windows
- **What it is**: The same Claude Code codebase, compiled with Bun into a standalone binary

**How to install it**: Run `node cli.js install` (the SDK's `install` subcommand downloads it).

**Key difference**: The native binary includes `auth login`, `auth logout`, and `auth status` subcommands that the `cli.js` version strips out. The `auth login` flow spawns a browser and does not require TTY raw mode, making it suitable for headless orchestration.

## The `isNativeBinary` Check

The SDK determines which spawn strategy to use based on file extension:

```typescript
// From sdk.mjs
function isNativeBinary(executablePath) {
  const jsExtensions = ['.js', '.mjs', '.tsx', '.ts', '.jsx'];
  return !jsExtensions.some(ext => executablePath.endsWith(ext));
}
```

- `.js` file: spawned as `node cli.js [args]`
- Native binary: spawned directly as `./claude [args]`

## Install Path Control

The `cli.js install` subcommand uses XDG directory conventions:

| Directory | Default | Environment Override |
|-----------|---------|---------------------|
| Binary versions | `~/.local/share/claude/versions/` | `XDG_DATA_HOME` |
| Staging (downloads) | `~/.cache/claude/staging/` | `XDG_CACHE_HOME` |
| Lock files | System temp or cache | `XDG_CACHE_HOME` |
| Symlink | `~/.local/bin/claude` | Hardcoded relative to `$HOME` |

By setting `XDG_DATA_HOME` before running `node cli.js install`, we can control where the native binary is placed:

```typescript
// Install native binary into our data directory
execFile('node', [cliJsPath, 'install'], {
  env: { ...process.env, XDG_DATA_HOME: join(DATA_DIR, 'sdks', 'claude') }
});
// Binary lands at: DATA_DIR/sdks/claude/claude/versions/<version>/claude
```

## Auth Flow Architecture

### Why we need the native binary for auth

| Method | Works in `cli.js`? | Works in native binary? | Requires TTY? |
|--------|-------------------|------------------------|---------------|
| `setup-token` | Yes | Yes | **Yes** (Ink TUI needs raw mode) |
| `auth login` | **No** (not registered) | Yes | **No** (opens browser, waits for callback) |
| `auth status --json` | **No** (not registered) | Yes | No |
| `auth logout` | **No** (not registered) | Yes | No |

The `setup-token` command uses Ink (React for terminals) which requires `process.stdin` in raw mode. When spawned as a child process from our backend, raw mode is unavailable, causing an immediate crash:

```
ERROR Raw mode is not supported on the current process.stdin, which Ink uses as input stream by default.
```

The native binary's `auth login` command opens a browser window for OAuth and waits for a callback without requiring terminal input. This is the correct path for our headless backend.

### SDK Auth Status Events

When running agent sessions, the SDK can emit `auth_status` events (type `SDKAuthStatusMessage`):

```typescript
type SDKAuthStatusMessage = {
  type: 'auth_status';
  isAuthenticating: boolean;
  output: string[];    // URLs, instructions
  error?: string;
  uuid: string;
  session_id: string;
};
```

These are emitted when `--enable-auth-status` is passed to `cli.js`. The SDK has an internal `AuthenticatingTracker` that fires these events if authentication is needed mid-session. This provides a potential future path for inline auth handling during agent execution.

## Implications for Animus

### Current approach (problematic)
- Backend searches for a system-installed `claude` binary via well-known paths and `which`/`where`
- If the user has Claude Code installed globally, it works; otherwise auth fails
- Makes testing unreliable (system binary may mask issues with our own installation)

### Target approach
1. `npm install @anthropic-ai/claude-agent-sdk` gives us `cli.js` (SDK + agent execution)
2. Run `node cli.js install` with `XDG_DATA_HOME` pointed at our `data/sdks/claude/` directory
3. Use the installed native binary exclusively for auth operations
4. Never search system paths, never use `which`/`where`
5. The agents package owns all binary resolution, installation, and auth flow logic
6. The backend provides thin tRPC routes and credential persistence callbacks

### Binary resolution priority (target)
1. Check `data/sdks/claude/claude/versions/*/claude` for the native binary (auth)
2. Check `node_modules/@anthropic-ai/claude-agent-sdk/cli.js` for the SDK CLI (execution)
3. Check `data/sdks/claude/node_modules/@anthropic-ai/claude-agent-sdk/cli.js` for runtime-installed SDK CLI (Tauri)
4. No system path fallbacks

## Related Documents

- `runtime-sdk-installation.md`: Architecture for runtime SDK installation in Tauri
- `sdk-research.md`: Deep dive into SDK capabilities and API surface
- `../architecture-overview.md`: Unified abstraction layer design
- `../sdk-comparison.md`: Cross-provider comparison
