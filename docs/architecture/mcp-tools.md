# Animus: Cross-Provider MCP Tool Architecture

How Animus defines custom tools once and delivers them to any agent SDK provider, with per-contact permission filtering and extensibility for user-defined tools.

## Research Summary

### MCP Protocol Fundamentals

The [Model Context Protocol](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports) defines two official transports:

1. **stdio** — Client launches server as subprocess, communicates via stdin/stdout with newline-delimited JSON-RPC messages
2. **Streamable HTTP** — Server is an independent process, client sends POST requests, server responds with JSON or SSE streams

SSE-only transport is deprecated (March 2025). The protocol is transport-agnostic: messages are JSON-RPC 2.0, UTF-8 encoded. Tools are registered on the server and discovered by clients during initialization.

### How Each SDK Consumes MCP Servers

| Aspect | Claude Agent SDK | Codex SDK | OpenCode SDK |
|--------|-----------------|-----------|--------------|
| **Config location** | `mcpServers` in `query()` options or `.mcp.json` | `[mcp_servers.<id>]` in `config.toml` | `mcp` object in `opencode.json` |
| **stdio format** | `{ command, args, env }` | `command`, `args`, `env`, `cwd` | `{ type: "local", command: [...], environment }` |
| **HTTP format** | `{ type: "http"/"sse", url, headers }` | `url`, `bearer_token_env_var`, `http_headers` | `{ type: "remote", url, headers, oauth }` |
| **In-process tools** | `createSdkMcpServer()` + `tool()` | Not supported | `tool()` from `@opencode-ai/plugin` (not MCP) |
| **Tool naming** | `mcp__{server}__{tool}` | `{server}_{tool}` (convention) | `{server}_{tool}` (convention) |
| **Tool filtering** | `allowedTools` array with wildcards | `enabled_tools` / `disabled_tools` | `tools` config with glob patterns |
| **Approval model** | `permissionMode` or per-tool `allowedTools` | Approval policies (smart approvals default) | Per-tool permission controls |
| **Transport** | stdio, HTTP, SSE, in-process | stdio, Streamable HTTP | Local (stdio), Remote (HTTP) |

### Key Insight: Unified stdio Transport

All three SDKs support **stdio MCP servers**. A stdio server is just a child process that reads JSON-RPC from stdin and writes to stdout. While Claude also supports in-process MCP tools via `createSdkMcpServer()`, the latency difference is negligible (~1-3ms HTTP roundtrip vs ~0ms in-process) against 2-10 second LLM API calls.

---

## Decision: Unified stdio Bridge for All Providers

We use a **single architecture** for all providers: a lightweight stdio MCP subprocess that proxies tool calls back to the backend process via an internal HTTP bridge.

**Why unified stdio instead of hybrid (in-process for Claude, stdio for others)?**

- **Simplicity**: One code path for all providers eliminates provider-specific guards and branching
- **Negligible overhead**: The HTTP bridge adds ~1-3ms per tool call, invisible against LLM latency
- **Correctness**: Removing `provider === 'claude'` guards means all providers get tools and cognitive output (previously Codex and OpenCode got zero tools)
- **Testability**: The bridge is a plain HTTP server, easy to test without SDK dependencies

**Why HTTP bridge + stdio subprocess (not direct stdio)?**

Tool handlers need access to databases, the event bus, and other backend infrastructure that lives in the main Node.js process. The architecture uses two layers:

1. **HTTP bridge** (in the backend process): Receives tool calls via localhost HTTP, executes handlers in-process where DB connections live
2. **stdio subprocess** (spawned per MCP server entry): Translates MCP protocol (stdin/stdout) to HTTP bridge calls

This keeps handlers in the backend process while providing a clean stdio interface for all SDKs.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                        @animus-labs/shared                          │
│                                                                    │
│  ┌────────────────────────────────────────────────────────────────┐│
│  │  Tool Definitions (tool-definitions.ts)                       ││
│  │  • AnimusToolDef<TInput>: name, description, inputSchema      ││
│  │  • Zod schemas for each tool's input                          ││
│  │  • No handlers — pure declarations                            ││
│  │  • Exported as ANIMUS_TOOLS registry                          ││
│  └────────────────────────────────────────────────────────────────┘│
│                                                                    │
│  ┌────────────────────────────────────────────────────────────────┐│
│  │  Tool Permission Map (tool-permissions.ts)                    ││
│  │  • Maps PermissionTier → allowed tool names                   ││
│  │  • primary: send_message, update_progress, read_memory, ...   ││
│  │  • standard: send_message, read_memory, ...                   ││
│  └────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────┘
                              │
               ┌──────────────┼──────────────┐
               ▼              │              ▼
┌──────────────────────────┐  │   ┌──────────────────────────────────┐
│  @animus-labs/backend    │  │   │     @animus-labs/agents          │
│                          │  │   │                                  │
│ ┌──────────────────────┐ │  │   │ ┌──────────────────────────────┐ │
│ │  Tool Handlers       │ │  │   │ │  McpServerConfig in session  │ │
│ │  (tool-handlers/)    │ │  │   │ │  options — pass-through to   │ │
│ │  send_message()      │◄┼──┘   │ │  each SDK's native MCP config│ │
│ │  update_progress()   │ │      │ └──────────────────────────────┘ │
│ │  read_memory()       │ │      └──────────────────────────────────┘
│ │  lookup_contacts()   │ │
│ │  send_proactive()    │ │
│ │  send_media()        │ │
│ │  run_with_creds()    │ │
│ │  Has DB access,      │ │
│ │  event bus, etc.     │ │
│ └──────────┬───────────┘ │
│            │             │
│ ┌──────────▼───────────┐ │
│ │  Tool Registry       │ │
│ │  (registry.ts)       │ │
│ │  Combines defs +     │ │
│ │  handlers, filters   │ │
│ │  by permission tier  │ │
│ └──────────┬───────────┘ │
│            │             │
│ ┌──────────▼───────────┐ │
│ │  HTTP Bridge         │ │    ┌────────────────────────────┐
│ │  (mcp-bridge.ts)     │ │    │  stdio MCP Subprocess      │
│ │                      │◄┼────│  (animus-mcp-server.ts)    │
│ │  127.0.0.1:ephemeral │ │    │                            │
│ │  Context registry    │ │    │  Reads BRIDGE_PORT,        │
│ │  Tool list endpoint  │ │    │  TOOL_SET, TASK_ID from env│
│ │  Execute endpoint    │ │    │  Translates MCP protocol   │
│ │  Cognitive endpoints │ │    │  to HTTP bridge calls      │
│ └──────────────────────┘ │    └────────────┬───────────────┘
└──────────────────────────┘                 │
                                             │ stdio (MCP protocol)
                                             ▼
                                    Any Agent SDK
                                    (Claude, Codex, OpenCode)
```

---

## Layer 1: Tool Definitions (`@animus-labs/shared`)

Tool definitions are pure data structures — no handlers, no side effects, no dependencies on backend infrastructure. They live in `@animus-labs/shared` because both the backend (which implements handlers) and the frontend (which may display available tools in the UI) need access to them.

### Type Definitions

```typescript
// packages/shared/src/types/tools.ts

import type { z } from 'zod';

/**
 * A tool definition without a handler.
 * Pure declaration of what the tool does and what input it expects.
 */
export interface AnimusToolDef<TInput extends z.ZodTypeAny = z.ZodTypeAny> {
  /** Unique tool name (e.g., 'send_message') */
  name: string;

  /** Human-readable description for the LLM */
  description: string;

  /** Zod schema for input validation */
  inputSchema: TInput;

  /**
   * Tool category for UI grouping and permission logic.
   * - messaging: Tools that send messages to contacts
   * - memory: Tools that read/write Animus's memory
   * - progress: Tools that report agent progress
   * - system: Tools that interact with system state
   */
  category: 'messaging' | 'memory' | 'progress' | 'system';
}
```

### Tool Inventory

There are two categories of tools: **sub-agent tools** (available to sub-agents, filtered by contact permission tier) and **mind-only tools** (available only to the mind session during heartbeat ticks).

#### Sub-Agent Tools

These are provided to sub-agent sessions via MCP, filtered by the triggering contact's permission tier.

| Tool | Category | Description |
|------|----------|-------------|
| `send_message` | messaging | Send a message (with optional media) to the triggering contact via the originating channel. Used for progress updates, intermediate findings, clarifying questions. |
| `update_progress` | progress | Report current activity and percentage complete back to the orchestrator. Updates `current_activity` in SQLite so the mind knows what the sub-agent is doing. |
| `read_memory` | memory | Search Animus's long-term memory (LanceDB) for relevant information. Read-only — only the mind writes memories. |
| `run_with_credentials` | system | Execute a command with a credential (plugin or vault) injected as an environment variable. The credential is resolved from encrypted storage and never exposed to the LLM. Output is scanned for injected values and redacted. |
| `list_vault_entries` | system | List password vault entries (metadata only: label, service, identity, hint). Returns `vault:<id>` refs for use with `run_with_credentials`. Supports optional `service` filter. |

#### Mind-Only Tools

These are available only to the mind session. They are served via a separate MCP server (`tools`) alongside the cognitive tools MCP server (`cognitive`), both delivered through the stdio bridge. Not filtered by permission tier; the mind always has all of them.

| Tool | Category | Description |
|------|----------|-------------|
| `read_memory` | memory | Same as above — search long-term memory. |
| `lookup_contacts` | system | Discover contacts and their available communication channels. Used before `send_proactive_message` to find valid contactId/channel pairs. |
| `send_proactive_message` | messaging | Send a message (with optional media) to **any** contact on **any** of their channels. Goes through `ChannelRouter.sendOutbound()` for full delivery. Used for unprompted outreach (interval ticks, reminders, etc.). |
| `send_media` | messaging | Send media files (images, audio, video, documents) to the **triggering contact** on the trigger channel. Files must already exist on disk (from plugin tools, sub-agents, etc.). Delivered immediately during the mind query, before the text reply. |
| `run_with_credentials` | system | Same as above — execute a command with injected credentials (plugin or vault refs). |
| `list_vault_entries` | system | Same as above — list password vault entries with metadata and vault refs. |

**Note:** The mind also has two **cognitive tools** (`record_thought`, `record_cognitive_state`) served by a separate `cognitive` MCP server. These are not part of the Animus tool registry; they're defined in `heartbeat/cognitive-tools.ts` and manage the phase-based streaming pipeline. The cognitive state (`CognitiveSnapshot`) accumulates in-process via module-level singleton in `cognitive-tools.ts`, while the tools themselves are exposed via the same stdio bridge pattern as all other tools. See `docs/architecture/heartbeat.md`.

#### Tool Definitions Source

All tool definitions live in `packages/shared/src/tools/definitions.ts`. Each is an `AnimusToolDef` with name, description, Zod input schema, and category. The central registry:

```typescript
export const ANIMUS_TOOL_DEFS = {
  send_message: sendMessageDef,
  update_progress: updateProgressDef,
  read_memory: readMemoryDef,
  lookup_contacts: lookupContactsDef,
  send_proactive_message: sendProactiveMessageDef,
  send_media: sendMediaDef,
  run_with_credentials: runWithCredentialsDef,
  list_vault_entries: listVaultEntriesDef,
} as const;

export type AnimusToolName = keyof typeof ANIMUS_TOOL_DEFS;

// Mind-only tools (not given to sub-agents)
export const MIND_TOOL_NAMES: readonly AnimusToolName[] = [
  'read_memory', 'lookup_contacts', 'send_proactive_message', 'send_media',
  'run_with_credentials', 'list_vault_entries'
] as const;
```

### Permission Map (Sub-Agent Tools Only)

Permission filtering applies to **sub-agent tools only**. Mind tools are not filtered — the mind always has its full toolset.

```typescript
// packages/shared/src/tools/permissions.ts

export const TOOL_PERMISSIONS: Record<PermissionTier, readonly AnimusToolName[]> = {
  primary: ['send_message', 'update_progress', 'read_memory', 'run_with_credentials', 'list_vault_entries'],
  standard: ['send_message', 'read_memory', 'run_with_credentials', 'list_vault_entries'],
} as const;
```

Standard contacts don't trigger sub-agent spawning (enforced in EXECUTE), so these permissions primarily guard against edge cases. `getMindTools()` returns definitions for all `MIND_TOOL_NAMES` without tier filtering.

---

## Layer 2: Tool Handlers (`@animus-labs/backend`)

Handlers live in the backend because they need access to databases, the event bus, channel adapters, and other infrastructure. Each handler is a pure async function that receives typed input and a context object, and returns an MCP-compatible result.

### Handler Interface

```typescript
// packages/backend/src/tools/types.ts

import type { AnimusToolName } from '@animus-labs/shared';

/**
 * Context provided to every tool handler invocation.
 *
 * Contains everything the handler needs to interact with Animus systems.
 * Populated by the orchestrator when setting up MCP servers for a session.
 */
export interface ToolHandlerContext {
  /** The agent task ID that owns this session */
  agentTaskId: string;

  /** Contact who triggered the task */
  contactId: string;

  /** Channel the original message came from */
  sourceChannel: string;

  /** Conversation ID for message threading */
  conversationId: string;

  /** Database stores for reading/writing */
  stores: {
    messages: MessageStore;
    heartbeat: HeartbeatStore;
    memory: MemoryStore;
    /** Contact store — only provided in mind context (not sub-agents). */
    contacts?: ContactStore;
    /** Channel router — only provided in mind context (not sub-agents). */
    channels?: ChannelRouter;
  };

  /** Event bus for emitting real-time events */
  eventBus: IEventBus;
}

/**
 * MCP-compatible tool result.
 *
 * Matches the MCP protocol's expected return format.
 */
export interface ToolResult {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
}

/**
 * A tool handler function.
 */
export type ToolHandler<TInput = unknown> = (
  input: TInput,
  context: ToolHandlerContext,
) => Promise<ToolResult>;

/**
 * A complete tool: definition + handler, ready for registration.
 */
export interface AnimusTool<TInput = unknown> {
  name: AnimusToolName;
  description: string;
  inputSchema: unknown; // Zod schema
  handler: ToolHandler<TInput>;
}
```

### Handler Implementations

Each handler file follows the same pattern: typed input from the tool's Zod schema, `ToolHandlerContext` for infrastructure access, and an MCP-compatible `ToolResult` return.

| Handler File | Key Behavior |
|---|---|
| `handlers/send-message.ts` | Writes outbound message to `messages.db`, emits `message:sent` event for frontend. If `media` is provided, routes through `ChannelRouter.sendOutbound()` for full delivery pipeline. |
| `handlers/update-progress.ts` | Updates `current_activity` in `agent_tasks` table, emits `agent:progress` event. |
| `handlers/read-memory.ts` | Calls `MemoryManager.retrieveRelevant()` which embeds the query and searches LanceDB. Returns formatted results. |
| `handlers/lookup-contacts.ts` | Reads contacts from `contacts.db` with optional name/channel filtering. Returns contact names, IDs, tiers, and available channels. |
| `handlers/send-proactive-message.ts` | Validates contact exists and has the specified channel, then calls `ChannelRouter.sendOutbound()` for full delivery (message storage, media attachments, IPC to channel adapters). |
| `handlers/send-media.ts` | Validates files exist on disk, auto-detects media type from extension, then calls `ChannelRouter.sendOutbound()` using the trigger contact/channel from context. Supports multiple files per call. |
| `handlers/run-with-credentials.ts` | Resolves a credential from encrypted storage, injects it as an environment variable into a subprocess, executes the command, and returns stdout/stderr. The LLM never sees the credential value. |

**Mind tool context differences:** Mind-only tools receive `context.stores.contacts` and `context.stores.channels` (which sub-agent contexts do not). This is what enables `lookup_contacts`, `send_proactive_message`, and `send_media` to access the contact store and channel router directly.

#### `send_media` — Media Delivery During Mind Query

`send_media` is notable because it delivers media **immediately during the mind query**, before the text reply is sent. The flow:

1. Agent calls a plugin tool that generates/fetches media → gets a local file path
2. Agent calls `send_media(files: [{ path: "..." }], caption: "Here's the image!")`
3. Handler awaits `ChannelRouter.sendOutbound()` → media delivered immediately
4. Agent continues writing its natural language reply (streamed to frontend)
5. After `record_cognitive_state`, the text reply is sent via the optimistic early send

This means media arrives before the text reply — a natural ordering for chat platforms (image → follow-up text). The handler supports multiple files per call to avoid sequential tool-call latency.

---

## Layer 3: Tool Registry (`@animus-labs/backend`)

The registry combines definitions (from `@animus-labs/shared`) with handlers (from the backend) and provides methods to create provider-specific MCP server configurations.

The registry (`packages/backend/src/tools/registry.ts`) maps every `AnimusToolName` to its definition + handler. Key functions:

- `getToolsForTier(tier)` — returns tools filtered by contact permission tier (sub-agent use)
- `getMindToolRegistry()` — returns all mind-only tools (from `MIND_TOOL_NAMES`)
- `getTool(name)` — get a specific tool by name
- `executeTool(name, input, context)` — validate input against Zod schema, execute handler

All 7 tools are registered in the single `TOOL_REGISTRY` record. The distinction between sub-agent and mind tools is handled by which function is used to query the registry.

---

## Layer 4: MCP Bridge & stdio Server (`@animus-labs/backend`)

All providers use the same two-component architecture: an HTTP bridge in the backend process and a stdio MCP subprocess that proxies tool calls to it.

### HTTP Bridge (`mcp-bridge.ts`)

A singleton HTTP server running in the backend Node.js process. Started lazily on the first session, reused by all subsequent sessions (mind + sub-agents).

```typescript
// packages/backend/src/tools/servers/mcp-bridge.ts (key exports)

/** Start the bridge server (idempotent, returns port) */
export async function startBridge(): Promise<number>;

/** Stop the bridge server */
export async function stopBridge(): Promise<void>;

/** Get current bridge port (null if not started) */
export function getBridgePort(): number | null;

/** Register a tool context for a session */
export function registerContext(taskId: string, ctx: MutableToolContext): void;

/** Unregister a tool context when session ends */
export function unregisterContext(taskId: string): void;

/** Update permission lookup (mind session refreshes each tick) */
export function updatePermissions(perms: ToolPermissionLookup): void;

/** Update sub-agent tier (for permission filtering) */
export function updateSubagentTier(tier: PermissionTier): void;

/** Get tool definitions for a given set (used by tests and subprocess) */
export function getToolDefs(set: ToolSet): BridgeToolDef[];

/** Build a stdio MCP server config for any provider */
export function buildMcpServerConfig(
  bridgePort: number,
  toolSet: ToolSet,
  taskId: string,
): { command: string; args: string[]; env: Record<string, string> };
```

**Endpoints:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check (`{ ok: true }`) |
| `/tools?set=mind\|cognitive\|subagent` | GET | Returns tool definitions as JSON Schema |
| `/execute` | POST | Execute a tool: `{ taskId, toolName, args }` |
| `/cognitive/thought` | POST | Record a thought: `{ content, importance }` |
| `/cognitive/state` | POST | Record cognitive state (experience, emotions, decisions, etc.) |

**Context registry:** A `Map<taskId, MutableToolContext>` routes tool calls to the correct session context. The mind session registers as `taskId='mind'`, sub-agents register with their UUID task IDs. Contexts are unregistered on session cleanup.

**Permission filtering:** Applied when returning tool lists via `/tools`:
- `mind` set: Excludes tools with permission `'off'`
- `subagent` set: Excludes tools with permission `'off'` or `'ask'` (sub-agents can't do interactive approvals)
- `cognitive` set: Always returns both cognitive tools (never filtered)

**Security:** Binds to `127.0.0.1` only (localhost), ephemeral port. No external network exposure.

### stdio MCP Subprocess (`animus-mcp-server.ts`)

A stateless proxy process. One instance is spawned per MCP server entry in the session config (typically two per mind session: `tools` + `cognitive`, one per sub-agent: `tools`).

```typescript
// packages/backend/src/tools/servers/animus-mcp-server.ts (standalone entry point)

// Reads from environment:
//   BRIDGE_PORT  — port of the HTTP bridge
//   TOOL_SET     — 'mind' | 'cognitive' | 'subagent'
//   TASK_ID      — 'mind' or sub-agent UUID

// On startup:
//   GET /tools?set=<TOOL_SET> from bridge → cache tool definitions

// MCP protocol handlers:
//   tools/list  → return cached tool definitions
//   tools/call  → POST /execute (or /cognitive/*) to bridge → return result
```

The subprocess uses `@modelcontextprotocol/sdk` (`Server` + `StdioServerTransport`) to implement the MCP protocol. It has NO direct access to databases or the event bus. All handler logic runs in the backend process via the bridge.

**Dev/prod entry point resolution:** `buildMcpServerConfig()` detects whether the backend is running in dev mode (via `import.meta.url.endsWith('.ts')`) and uses `tsx` for TypeScript or `node` for compiled JavaScript accordingly.

### Config Builder

`buildMcpServerConfig()` produces standard `{ command, args, env }` configs that all SDKs understand:

```typescript
// For mind session Animus tools
buildMcpServerConfig(bridgePort, 'mind', 'mind')
// → { command: 'node', args: ['animus-mcp-server.js'], env: { BRIDGE_PORT, TOOL_SET: 'mind', TASK_ID: 'mind' } }

// For mind session cognitive tools
buildMcpServerConfig(bridgePort, 'cognitive', 'mind')

// For sub-agent Animus tools
buildMcpServerConfig(bridgePort, 'subagent', taskId)
```

---

## Layer 5: Orchestrator Integration

The Agent Orchestrator and Mind Session assemble the MCP server configuration using the bridge. This is provider-agnostic: the same code path runs for Claude, Codex, and OpenCode.

### Mind Session Setup

```typescript
// packages/backend/src/heartbeat/mind-session.ts (relevant section)

import { startBridge, registerContext, updatePermissions, buildMcpServerConfig } from '../tools/index.js';
import { getSnapshot, resetSnapshot, getPhase } from './cognitive-tools.js';

// During mind session initialization:
const bridgePort = await startBridge();
registerContext('mind', state.toolContext);
updatePermissions(currentPermissions);

// Build stdio MCP configs (same for all providers)
const toolsConfig = buildMcpServerConfig(bridgePort, 'mind', 'mind');
const cognitiveConfig = buildMcpServerConfig(bridgePort, 'cognitive', 'mind');

// Cognitive state access remains in-process (direct imports)
state.cognitiveServer = {
  serverConfig: cognitiveConfig,
  getSnapshot,
  resetSnapshot,
  getPhase,
};

// Merge with plugin MCP servers
const mergedMcpServers = {
  tools: toolsConfig,
  cognitive: cognitiveConfig,
  ...pluginMcpServers,
};
```

### Sub-Agent Setup

```typescript
// packages/backend/src/heartbeat/agent-orchestrator.ts (relevant section)

import { startBridge, registerContext, unregisterContext, buildMcpServerConfig } from '../tools/index.js';

// When spawning a sub-agent:
const bridgePort = await startBridge();
registerContext(taskId, subAgentToolContext);
const mcpConfig = buildMcpServerConfig(bridgePort, 'subagent', taskId);

// Cleanup in ALL exit paths (success, error, timeout, cancel):
unregisterContext(taskId);
```

No provider switching, no handle tracking, no subprocess management. The bridge and stdio subprocess handle everything uniformly.

---

## MCP Server Configuration Mapping

All SDKs receive the same stdio `{ command, args, env }` config format. The adapters in `@animus-labs/agents` pass these through to the SDKs unchanged.

### Mind Session (all providers)

The mind session receives two MCP servers: `tools` (mind tools) and `cognitive` (phase-tracking tools), plus any plugin MCP servers:

```typescript
// Mind session MCP config (identical for Claude, Codex, OpenCode)
{
  mcpServers: {
    'animus': {
      command: 'node',  // or tsx in dev mode
      args: ['/path/to/animus-mcp-server.js'],
      env: { BRIDGE_PORT: '54321', TOOL_SET: 'mind', TASK_ID: 'mind' },
    },
    'cognitive': {
      command: 'node',
      args: ['/path/to/animus-mcp-server.js'],
      env: { BRIDGE_PORT: '54321', TOOL_SET: 'cognitive', TASK_ID: 'mind' },
    },
    // ...plus any plugin MCP servers
  },
  allowedTools: [
    'mcp__animus__read_memory',
    'mcp__animus__lookup_contacts',
    'mcp__animus__send_proactive_message',
    'mcp__animus__send_media',
    'mcp__animus__run_with_credentials',
    'mcp__cognitive__record_thought',
    'mcp__cognitive__record_cognitive_state',
  ],
}
```

### Sub-Agent Session (all providers)

Sub-agents receive a single `animus` MCP server with tier-filtered tools:

```typescript
// Sub-agent MCP config (primary tier example)
{
  mcpServers: {
    'animus': {
      command: 'node',
      args: ['/path/to/animus-mcp-server.js'],
      env: { BRIDGE_PORT: '54321', TOOL_SET: 'subagent', TASK_ID: 'task-uuid-123' },
    },
  },
  allowedTools: [
    'mcp__animus__send_message',
    'mcp__animus__update_progress',
    'mcp__animus__read_memory',
    'mcp__animus__run_with_credentials',
  ],
}
```

---

## Permission Filtering Flow

### Mind Session (no filtering)

The mind session always gets all mind tools + cognitive tools. Tool context is refreshed each tick via `buildMindToolContext()` which populates `contactId`, `sourceChannel`, `conversationId`, and store references from the gathered trigger data.

### Sub-Agent Sessions (tier-filtered)

```
User sends message
    │
    ▼
Channel adapter resolves contact → { contactId, permissionTier }
    │
    ▼
Heartbeat pipeline: GATHER CONTEXT → MIND QUERY → EXECUTE
    │
    ▼ (mind produces spawn_agent decision)
    │
Orchestrator receives spawn_agent
    │
    ├── 1. Check: Is contact primary? (if not, drop decision — hard enforcement)
    │
    ├── 2. Build ToolHandlerContext with contactId, channel, conversationId, DB stores
    │
    ├── 3. Call buildMcpConfig(provider, tier, context)
    │       │
    │       ├── getToolsForTier(tier) → filters TOOL_REGISTRY
    │       │   primary → [send_message, update_progress, read_memory, run_with_credentials]
    │       │   standard → [send_message, read_memory, run_with_credentials]
    │       │
    │       └── Creates provider-specific MCP server with filtered tools
    │
    ├── 4. Build AgentSessionConfig with mcpServers, systemPrompt, etc.
    │
    └── 5. manager.createSession(config) → sub-agent runs with filtered tools
```

---

## Extensibility: User-Defined Tools

The architecture supports future user-defined tools through the same registry pattern:

### Registration API

```typescript
// Future: packages/backend/src/tools/custom-tools.ts

import type { AnimusTool } from './types.js';
import { z } from 'zod';

/**
 * Register a custom tool at runtime.
 *
 * Custom tools are stored in system.db and loaded at startup.
 * They use the same handler interface as built-in tools.
 */
export function registerCustomTool(tool: AnimusTool): void {
  // Validate the tool definition
  // Add to a dynamic extension of the registry
  // Rebuild MCP servers for active sessions (if supported)
}
```

### MCP Server Passthrough

Users can also add external MCP servers (GitHub, Postgres, Slack, etc.) via configuration. These are passed through to the SDK unchanged:

```typescript
// In AgentSessionConfig
{
  mcpServers: {
    // Built-in Animus tools (injected by orchestrator)
    'animus-tools': { ... },

    // User-configured external MCP servers (passed through)
    'github': {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_TOKEN: '...' },
    },
    'postgres': {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-postgres', connectionString],
    },
  },
}
```

This is already supported by the existing `McpServerConfig` type in `@animus-labs/agents`. The orchestrator merges built-in tools with any user-configured MCP servers.

---

## Transport Architecture & Tradeoffs

### Why HTTP Bridge + stdio (not direct stdio IPC)?

The architecture uses an internal HTTP bridge (localhost-only, ephemeral port) between the stdio subprocess and the backend process. This is different from the common pattern of direct IPC via `child_process.fork()`:

| Aspect | HTTP Bridge (current) | Direct IPC (fork) |
|--------|----------------------|-------------------|
| **Context routing** | `taskId` in request body routes to correct session | Would need per-subprocess handler wiring |
| **Multiple MCP servers** | Share one bridge (mind tools, cognitive, sub-agents) | Each subprocess needs its own IPC channel |
| **Testability** | Plain HTTP endpoints, easy to test with `curl` | Requires process spawning in tests |
| **Overhead** | ~1-3ms per HTTP roundtrip | ~0.5-1ms per IPC message |
| **Complexity** | Single server, simple endpoints | Per-process message handlers, pending call maps |

The HTTP roundtrip overhead is negligible against 2-10 second LLM API calls. The testability and simplicity gains are significant.

### Why not expose tools as a persistent HTTP MCP server?

The bridge is an **internal** HTTP server for subprocess-to-backend communication, not an MCP-over-HTTP server. The SDKs still connect via **stdio** to the subprocess. This avoids:

1. **Port management for SDK connections** - stdio has no port conflicts
2. **Authentication** - stdio subprocess inherits parent process trust
3. **Additional attack surface** - the bridge binds to 127.0.0.1 only and is not directly exposed to SDKs

### Cognitive State: In-Process Access

While tool execution goes through the bridge, the cognitive state (`CognitiveSnapshot`) is accessed directly via in-process imports. The mind session calls `getSnapshot()`, `resetSnapshot()`, and `getPhase()` from `cognitive-tools.ts` without any HTTP overhead. The bridge's `/cognitive/*` endpoints only handle writes from the subprocess; reads are always in-process.

---

## Implementation Status

### Phase 1: Tool Definitions & Registry — COMPLETE

- `packages/shared/src/tools/definitions.ts` — 7 tool definitions with Zod schemas
- `packages/shared/src/tools/permissions.ts` — permission map + `getMindTools()`
- `packages/backend/src/tools/types.ts` — handler interface with `ToolHandlerContext`
- `packages/backend/src/tools/registry.ts` — full registry with all handlers
- `packages/backend/src/tools/handlers/` — 7 handler implementations

### Phase 2: MCP Bridge & stdio Server — COMPLETE

- `packages/backend/src/tools/servers/mcp-bridge.ts` — HTTP bridge server (singleton, context registry, tool list/execute/cognitive endpoints)
- `packages/backend/src/tools/servers/animus-mcp-server.ts` — stdio MCP subprocess (stateless proxy using `@modelcontextprotocol/sdk`)
- `packages/backend/src/heartbeat/mind-session.ts` — mind session assembles `tools` + `cognitive` + plugin MCP servers via bridge
- `packages/backend/src/heartbeat/cognitive-tools.ts` — cognitive tool handlers with exported standalone functions + in-process snapshot access
- `packages/backend/src/heartbeat/agent-orchestrator.ts` — sub-agent MCP setup via bridge with proper context cleanup
- `packages/backend/tests/tools/mcp-bridge.test.ts` — 21 tests covering bridge lifecycle, endpoints, permission filtering, context registry
- All tools work for all providers (Claude, Codex, OpenCode) via unified stdio pattern

### Phase 3: Plugin MCP Servers — COMPLETE

Plugin-defined MCP servers are loaded via the plugin system and merged into the mind session's MCP config alongside built-in tools. See `docs/architecture/plugin-system.md`.

---

## Dependencies

| Package | Used By | Purpose |
|---------|---------|---------|
| `zod` | `@animus-labs/shared` | Tool input schema definitions |
| `zod-to-json-schema` | `@animus-labs/backend` | Convert Zod schemas to JSON Schema for bridge tool list endpoint |
| `@modelcontextprotocol/sdk` | `@animus-labs/backend` | `Server`, `StdioServerTransport` for stdio MCP subprocess |

### Package Boundary Summary

| What | Where | Why |
|------|-------|-----|
| Tool definitions (name, description, schema) | `@animus-labs/shared` | Reusable across frontend and backend |
| Permission map | `@animus-labs/shared` | Shared knowledge of who can use what |
| Tool handlers (implementation) | `@animus-labs/backend` | Need DB access, event bus, embeddings |
| Tool registry (defs + handlers) | `@animus-labs/backend` | Combines shared defs with backend handlers |
| MCP bridge + stdio server | `@animus-labs/backend` | Unified tool delivery for all providers |
| MCP config passthrough | `@animus-labs/agents` | Passes mcpServers to SDK unchanged |

---

## Open Questions Resolved

This document resolves **Open Question #3: MCP Tool Design for Sub-Agents** from `docs/architecture/open-questions.md`:

- **`send_message` channel context**: The handler receives `sourceChannel` and `conversationId` via `ToolHandlerContext`, populated by the orchestrator from the triggering message.
- **`update_progress` schema**: `{ activity: string, percentComplete?: number }` — simple and focused.
- **`read_memory` interface**: Uses `MemoryManager.retrieveRelevant()` which embeds the query and searches LanceDB, same retrieval as GATHER CONTEXT but available on-demand.
- **Tool permissions**: Sub-agent tools filtered at session creation time via `getToolsForTier()`. Mind tools are unfiltered.
- **Custom user-defined tools**: Supported via plugin MCP servers (see `docs/architecture/plugin-system.md`).
- **Tool call result flow**: All providers use the same path: stdio subprocess sends HTTP request to bridge, bridge executes handler in-process, result flows back through the subprocess to the SDK.
- **Mind media delivery**: The `send_media` tool allows the mind to send media files to the triggering contact during the mind query, before the text reply. This replaces the removed `reply.media` structured output path. Media-producing tools (plugins) return file paths; the mind calls `send_media` to deliver them through the channel router.

---

## References

- [MCP Specification — Transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [Claude Agent SDK — MCP](https://platform.claude.com/docs/en/agent-sdk/mcp)
- [Claude Agent SDK — Custom Tools](https://platform.claude.com/docs/en/agent-sdk/custom-tools)
- [Codex SDK — MCP Configuration](https://developers.openai.com/codex/mcp/)
- [Codex SDK — Config Reference](https://developers.openai.com/codex/config-reference/)
- [OpenCode — MCP Servers](https://opencode.ai/docs/mcp-servers/)
- [OpenCode — Custom Tools](https://opencode.ai/docs/custom-tools/)
- [OpenCode — Plugins](https://opencode.ai/docs/plugins/)
- [MCP TypeScript SDK — Server](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md)
- Internal: `docs/architecture/agent-orchestration.md` (sub-agent lifecycle, MCP tools list)
- Internal: `docs/architecture/contacts.md` (permission tiers)
- Internal: `docs/architecture/memory.md` (read_memory retrieval)
- Internal: `docs/agents/architecture-overview.md` (adapter design, MCP passthrough decision)
