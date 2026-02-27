# SDK CLI Architecture

Both the Claude Agent SDK and Codex SDK are subprocess wrappers, not direct API clients. They spawn CLI binaries and communicate via JSON-lines IPC over stdin/stdout. This document covers the subprocess architecture, binary resolution strategy, and deployment considerations.

## Overview

| SDK | Binary Type | Auth Support | Located Via |
|-----|-------------|-------------|-------------|
| Claude Agent SDK | Bundled `cli.js` (Node.js script) | Agent execution only (no auth commands) | `createRequire` |
| Claude Code (native) | Separately-installed native binary | Full auth (login, logout, status) | Well-known paths + `which` |
| Codex SDK | Bundled native binary per platform | Full CLI with all subcommands | `createRequire` + platform mapping |

## Claude Agent SDK

### Bundled `cli.js`

The Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) bundles a `cli.js` file at the package root. This is the agent execution engine: it handles prompt processing, tool execution, streaming, and MCP server management. The SDK's `ProcessTransport` class spawns this as a Node.js child process.

**What `cli.js` can do:**
- Execute agent queries (the core SDK functionality)
- Handle tool calls, streaming, hooks
- Manage MCP server connections

**What `cli.js` cannot do:**
- `auth login` / `auth logout` / `auth status` (these are exclusive to the native binary)
- Any authentication management commands

### Native Claude Code Binary

Authentication operations require the separately-installed Claude Code binary. This binary has the full command set including `auth login`, `auth logout`, `auth status --json`, etc.

**Common install locations:**
- `~/.local/bin/claude` (npm global install)
- `/usr/local/bin/claude` (Homebrew or system-wide)
- `/opt/homebrew/bin/claude` (Homebrew on Apple Silicon)

The distinction matters because:
1. The SDK is always available as an npm dependency (bundled with the app)
2. The native binary may or may not be installed by the user
3. Auth flows need the native binary; agent execution needs the SDK

## Codex SDK

### Bundled Native Binary

The Codex SDK (`@openai/codex-sdk`) bundles complete native binaries for each platform under `vendor/{targetTriple}/codex/codex`. These binaries include ALL subcommands: `login`, `logout`, `login status`, and the full agent execution engine.

**Platform mapping (target triples):**
- `aarch64-apple-darwin` (macOS ARM)
- `x86_64-apple-darwin` (macOS Intel)
- `aarch64-unknown-linux-musl` (Linux ARM)
- `x86_64-unknown-linux-musl` (Linux x64)
- `aarch64-pc-windows-msvc` (Windows ARM)
- `x86_64-pc-windows-msvc` (Windows x64)

The SDK's internal `findCodexPath()` function resolves the correct binary for the current platform. Our `cli-paths.ts` module replicates this logic.

## Path Resolution: `cli-paths.ts`

The `packages/backend/src/lib/cli-paths.ts` module provides a single source of truth for locating CLI binaries, replacing the old `checkBinaryExists()` approach that relied on the system PATH.

### Why not PATH?

When Tauri launches the app from Finder, Spotlight, or the Dock (not a terminal), macOS provides a minimal PATH: `/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`. User-installed CLIs (typically at `~/.local/bin/` or in Homebrew paths) are not on this PATH, causing "CLI not installed" errors even when the CLIs are present.

### Resolution Strategy

**For SDK packages (Claude SDK `cli.js`, Codex bundled binary):**
- Uses `createRequire(import.meta.url).resolve('@package/package.json')` to locate the package
- Builds the binary path relative to the package directory
- Works in all deployment modes (dev monorepo, Tauri production, Docker)

**For Claude native binary (auth operations):**
1. Synchronous: check well-known paths with `existsSync`
2. Async fallback: `which claude` for non-standard locations
3. Results are cached in module-level variables

### Exported API

```typescript
// Claude
resolveClaudeCliPaths(): { bundledCliJs: string | null; nativeBinary: string | null }
getClaudeNativeBinary(): string | null          // Sync, well-known paths only
getClaudeNativeBinaryAsync(): Promise<string | null>  // Async, with `which` fallback

// Codex
resolveCodexCliPaths(): { bundledBinary: string | null }
getCodexBundledBinary(): string | null

// SDK availability (replaces old checkBinaryExists)
checkSdkAvailable(provider: 'claude' | 'codex'): boolean

// Testing
_resetCache(): void
```

## Deployment Modes

| Mode | Claude SDK `cli.js` | Claude Native Binary | Codex Bundled Binary |
|------|--------------------|--------------------|---------------------|
| **Dev** (monorepo) | `node_modules/@anthropic-ai/...` | User-installed (`~/.local/bin/` etc.) | `node_modules/@openai/...` |
| **Tauri** (production) | `resources/node_modules/@anthropic-ai/...` | User-installed (if present) | `resources/node_modules/@openai/...` |
| **Docker** | `node_modules/@anthropic-ai/...` | Not typically available | `node_modules/@openai/...` |

In Docker, API keys are the expected auth method. The native Claude binary and CLI auth flows are for desktop users.

## Auth Flow Differences

### Codex: Uses Bundled Binary

All Codex auth operations use the SDK-bundled binary directly:
- `initiateCodexCliAuth()`: spawns bundled binary with `login`
- `logoutCodex()`: calls bundled binary with `logout`
- `checkCodexCliAuth()`: calls bundled binary with `login status`

No separate installation required.

### Claude: Needs Native Binary or API Keys

Claude auth has two paths:
1. **Native binary available**: use `claude auth login` / `claude auth logout` / `claude auth status --json`
2. **No native binary**: fall back to API keys or filesystem credential detection (`~/.claude/.credentials`)

The agent execution itself uses the SDK-bundled `cli.js`, which does NOT need the native binary.

## Tauri Build Verification

The `scripts/prepare-tauri.mjs` verification step confirms SDK CLIs are present in the production bundle:
- `resources/node_modules/@anthropic-ai/claude-agent-sdk/cli.js`
- `resources/node_modules/@openai/codex-sdk/vendor/`

---

*Created: 2026-02-26*
