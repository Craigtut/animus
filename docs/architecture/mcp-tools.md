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

### Key Insight: In-Process vs External

**Claude** is the only SDK that supports truly in-process MCP tools via `createSdkMcpServer()`. This means zero IPC overhead — the tool handler runs in the same Node.js process as the SDK.

**Codex** and **OpenCode** require external MCP servers (stdio subprocess or HTTP endpoint). They cannot run tool handlers in the host process directly.

However, all three SDKs support **stdio MCP servers**. A stdio server is just a child process that reads JSON-RPC from stdin and writes to stdout. The key realization: **we can build a single MCP server binary that all three SDKs connect to via stdio**, while Claude can additionally use in-process mode for zero overhead.

---

## Decision: Hybrid Approach — In-Process for Claude, Shared stdio Server for Others

We use a **hybrid architecture** that optimizes for each provider:

1. **Claude**: In-process MCP server via `createSdkMcpServer()` + `tool()` — zero IPC, lowest latency, native Zod schemas
2. **Codex & OpenCode**: Shared stdio MCP server process — the backend spawns a lightweight Node.js subprocess that serves the same tools over stdio transport

**Why not a single approach for all three?**

- **All-stdio** would force Claude to pay subprocess IPC costs unnecessarily. Claude is the primary (and most mature) provider — optimizing its path matters.
- **All-in-process** is impossible — Codex and OpenCode don't support it.
- **HTTP server** adds network stack overhead and complexity (auth, CORS, port management) for tools that are inherently local to the Animus instance.

**Why not HTTP?** All Animus tools are local to the host machine (they access SQLite databases on disk). stdio is the natural transport for local tools — no port management, no auth, no network exposure.

**The hybrid approach gives us:**
- Best performance for the primary provider (Claude)
- Universal compatibility via stdio for all others
- Single tool definition source — both paths consume the same registry

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                        @animus-labs/shared                                │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  Tool Definitions (tool-definitions.ts)                       │  │
│  │                                                               │  │
│  │  • AnimusToolDef<TInput>: name, description, inputSchema     │  │
│  │  • Zod schemas for each tool's input                         │  │
│  │  • No handlers — pure declarations                           │  │
│  │  • Exported as ANIMUS_TOOLS registry                         │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  Tool Permission Map (tool-permissions.ts)                    │  │
│  │                                                               │  │
│  │  • Maps PermissionTier → allowed tool names                  │  │
│  │  • primary: send_message, update_progress, read_memory,     │  │
│  │           run_with_credentials                               │  │
│  │  • standard: send_message, read_memory, run_with_credentials│  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
                              │
               ┌──────────────┼──────────────┐
               ▼              │              ▼
┌──────────────────────┐      │    ┌──────────────────────────────────┐
│   @animus-labs/backend    │      │    │       @animus-labs/agents             │
│                      │      │    │                                  │
│ ┌──────────────────┐ │      │    │ ┌──────────────────────────────┐ │
│ │  Tool Handlers   │ │      │    │ │  McpServerConfig in session  │ │
│ │  (tool-handlers/)│ │      │    │ │  options — pass-through to   │ │
│ │                  │ │      │    │ │  each SDK's native MCP config│ │
│ │ Sub-agent tools: │◄┼──────┘    │ └──────────────────────────────┘ │
│ │  send_message()  │ │           └──────────────────────────────────┘
│ │  update_progress │ │
│ │  read_memory()   │ │
│ │  run_with_creds  │ │
│ │ Mind-only tools: │ │
│ │  lookup_contacts │ │
│ │  send_proactive  │ │
│ │  send_media()    │ │
│ │  read_memory()   │ │
│ │  run_with_creds  │ │
│ │                  │ │
│ │ Has DB access,   │ │
│ │ event bus, etc.  │ │
│ └────────┬─────────┘ │
│          │           │
│ ┌────────▼─────────┐ │
│ │  Tool Registry   │ │
│ │  (tool-registry) │ │
│ │                  │ │
│ │ Combines defs +  │ │
│ │ handlers into    │ │
│ │ complete tools   │ │
│ │                  │ │
│ │ Filters by       │ │
│ │ permission tier  │ │
│ └────────┬─────────┘ │
│          │           │
│  ┌───────┴────────┐  │
│  │                │  │
│  ▼                ▼  │
│ ┌──────┐  ┌────────┐ │
│ │Claude│  │ stdio  │ │
│ │ In-  │  │ MCP    │ │
│ │Proc  │  │Server  │ │
│ │Server│  │Process │ │
│ └──┬───┘  └───┬────┘ │
└────┼──────────┼──────┘
     │          │
     ▼          ▼
  Claude     Codex /
  Agent      OpenCode
  SDK        SDKs
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
| `run_with_credentials` | system | Execute a command with a plugin credential injected as an environment variable. The credential is resolved from encrypted storage and never exposed to the LLM. |

#### Mind-Only Tools

These are available only to the mind session. They are served via a separate in-process MCP server (`animus-tools`) alongside the cognitive tools MCP server (`cognitive`). Not filtered by permission tier — the mind always has all of them.

| Tool | Category | Description |
|------|----------|-------------|
| `read_memory` | memory | Same as above — search long-term memory. |
| `lookup_contacts` | system | Discover contacts and their available communication channels. Used before `send_proactive_message` to find valid contactId/channel pairs. |
| `send_proactive_message` | messaging | Send a message (with optional media) to **any** contact on **any** of their channels. Goes through `ChannelRouter.sendOutbound()` for full delivery. Used for unprompted outreach (interval ticks, reminders, etc.). |
| `send_media` | messaging | Send media files (images, audio, video, documents) to the **triggering contact** on the trigger channel. Files must already exist on disk (from plugin tools, sub-agents, etc.). Delivered immediately during the mind query, before the text reply. |
| `run_with_credentials` | system | Same as above — execute a command with injected credentials. |

**Note:** The mind also has two **cognitive tools** (`record_thought`, `record_cognitive_state`) served by a separate `cognitive` MCP server. These are not part of the Animus tool registry — they're defined in `heartbeat/cognitive-tools.ts` and manage the phase-based streaming pipeline. See `docs/architecture/heartbeat.md`.

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
} as const;

export type AnimusToolName = keyof typeof ANIMUS_TOOL_DEFS;

// Mind-only tools (not given to sub-agents)
export const MIND_TOOL_NAMES: readonly AnimusToolName[] = [
  'read_memory', 'lookup_contacts', 'send_proactive_message', 'send_media', 'run_with_credentials'
] as const;
```

### Permission Map (Sub-Agent Tools Only)

Permission filtering applies to **sub-agent tools only**. Mind tools are not filtered — the mind always has its full toolset.

```typescript
// packages/shared/src/tools/permissions.ts

export const TOOL_PERMISSIONS: Record<PermissionTier, readonly AnimusToolName[]> = {
  primary: ['send_message', 'update_progress', 'read_memory', 'run_with_credentials'],
  standard: ['send_message', 'read_memory', 'run_with_credentials'],
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
| `handlers/lookup-contacts.ts` | Reads contacts from `system.db` with optional name/channel filtering. Returns contact names, IDs, tiers, and available channels. |
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

## Layer 4: MCP Server Factories (`@animus-labs/backend`)

Two factory functions produce MCP servers for different providers, both consuming the same registry.

### Claude: In-Process Server

```typescript
// packages/backend/src/tools/servers/claude-mcp.ts

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { PermissionTier } from '@animus-labs/shared';
import type { ToolHandlerContext } from '../types.js';
import { getToolsForTier } from '../registry.js';

/**
 * Create an in-process MCP server for Claude Agent SDK.
 *
 * This runs in the same Node.js process as the backend — zero IPC overhead.
 * Tool handlers are wrapped with the provided context and executed directly.
 *
 * @param tier - Contact permission tier (filters available tools)
 * @param context - Handler context (DB access, event bus, etc.)
 * @returns MCP server config ready to pass to Claude's mcpServers option
 */
export function createClaudeMcpServer(
  tier: PermissionTier,
  context: ToolHandlerContext,
) {
  const tools = getToolsForTier(tier);

  const sdkTools = tools.map(t =>
    tool(
      t.name,
      t.description,
      // The Zod schema shape object (Claude's tool() expects the inner shape)
      t.inputSchema.shape ?? t.inputSchema,
      async (args: unknown) => {
        // Validate input against schema
        const validated = t.inputSchema.parse(args);
        // Execute handler with context
        return await t.handler(validated, context);
      },
    )
  );

  return createSdkMcpServer({
    name: 'animus-tools',
    version: '1.0.0',
    tools: sdkTools,
  });
}

/**
 * Build the mcpServers config object for a Claude session.
 *
 * Returns the object to merge into AgentSessionConfig.mcpServers.
 */
export function buildClaudeMcpConfig(
  tier: PermissionTier,
  context: ToolHandlerContext,
): Record<string, unknown> {
  return {
    'animus-tools': createClaudeMcpServer(tier, context),
  };
}

/**
 * Build the allowedTools list for a Claude session.
 *
 * Claude requires explicit tool permissions via allowedTools.
 * Format: mcp__{server}__{tool}
 */
export function buildClaudeAllowedTools(tier: PermissionTier): string[] {
  const tools = getToolsForTier(tier);
  return tools.map(t => `mcp__animus-tools__${t.name}`);
}
```

### Codex/OpenCode: stdio MCP Server

For Codex and OpenCode, we run a lightweight Node.js subprocess that serves tools over stdio. The subprocess receives the handler context via environment variables (serialized) and communicates with the parent process for handler execution via IPC.

```typescript
// packages/backend/src/tools/servers/stdio-mcp.ts

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { PermissionTier } from '@animus-labs/shared';
import type { ToolHandlerContext } from '../types.js';
import { getToolsForTier } from '../registry.js';

/**
 * Strategy: Rather than running a separate subprocess, we use the
 * @modelcontextprotocol/sdk to create an MCP server that the backend
 * can spawn as a child process. The child process communicates with
 * the parent via IPC (Node.js child_process.fork) for handler execution.
 *
 * The architecture:
 * 1. Backend forks a child process running stdio-mcp-process.ts
 * 2. Child process creates an MCP server with stdio transport
 * 3. When a tool is called, child sends IPC message to parent
 * 4. Parent executes the handler (which has DB access)
 * 5. Parent sends result back via IPC
 * 6. Child returns the result to the SDK
 *
 * This keeps handlers in the parent process (where DB connections live)
 * while providing a clean stdio interface for Codex and OpenCode.
 */

/**
 * Fork a stdio MCP server subprocess.
 *
 * Returns the config object to pass to the SDK's MCP server configuration.
 * The subprocess is managed by the orchestrator and terminated when the
 * agent session ends.
 */
export function createStdioMcpConfig(
  tier: PermissionTier,
  context: ToolHandlerContext,
): StdioMcpHandle {
  const tools = getToolsForTier(tier);

  // Serialize tool metadata (NOT handlers) for the child process
  const toolMeta = tools.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: JSON.parse(JSON.stringify(t.inputSchema)), // JSON Schema from Zod
  }));

  // Fork the MCP server subprocess
  const child = fork(
    resolve(__dirname, 'stdio-mcp-process.js'),
    [],
    {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        ANIMUS_MCP_TOOLS: JSON.stringify(toolMeta),
      },
    },
  );

  // Handle IPC messages from the child (tool call requests)
  child.on('message', async (msg: IpcToolCallRequest) => {
    if (msg.type === 'tool_call') {
      const tool = tools.find(t => t.name === msg.toolName);
      if (!tool) {
        child.send({
          type: 'tool_result',
          callId: msg.callId,
          result: {
            content: [{ type: 'text', text: `Unknown tool: ${msg.toolName}` }],
            isError: true,
          },
        });
        return;
      }

      try {
        const validated = tool.inputSchema.parse(msg.input);
        const result = await tool.handler(validated, context);
        child.send({ type: 'tool_result', callId: msg.callId, result });
      } catch (error) {
        child.send({
          type: 'tool_result',
          callId: msg.callId,
          result: {
            content: [{ type: 'text', text: `Tool error: ${String(error)}` }],
            isError: true,
          },
        });
      }
    }
  });

  return {
    child,
    // Config for the SDK — point to our subprocess
    config: {
      command: process.execPath,
      args: [resolve(__dirname, 'stdio-mcp-process.js')],
      env: {
        ANIMUS_MCP_TOOLS: JSON.stringify(toolMeta),
      },
    },
    kill: () => {
      child.kill('SIGTERM');
    },
  };
}

interface StdioMcpHandle {
  child: ChildProcess;
  config: { command: string; args: string[]; env: Record<string, string> };
  kill: () => void;
}
```

```typescript
// packages/backend/src/tools/servers/stdio-mcp-process.ts

/**
 * Stdio MCP server subprocess.
 *
 * This file runs as a forked child process. It:
 * 1. Reads tool definitions from ANIMUS_MCP_TOOLS env var
 * 2. Creates an MCP server with stdio transport
 * 3. When tools are called, sends IPC messages to parent for execution
 * 4. Returns results from parent back to the SDK
 *
 * This process has NO direct access to databases or the event bus.
 * All handler logic runs in the parent process.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const toolMeta = JSON.parse(process.env.ANIMUS_MCP_TOOLS ?? '[]');

const server = new McpServer({
  name: 'animus-tools',
  version: '1.0.0',
});

// Pending tool calls waiting for parent response
const pendingCalls = new Map<string, {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}>();

let callIdCounter = 0;

// Register each tool
for (const tool of toolMeta) {
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.inputSchema, // Already JSON Schema
    },
    async (args: Record<string, unknown>) => {
      // Send to parent for execution
      const callId = String(++callIdCounter);

      const result = await new Promise<unknown>((resolve, reject) => {
        pendingCalls.set(callId, { resolve, reject });

        process.send!({
          type: 'tool_call',
          callId,
          toolName: tool.name,
          input: args,
        });

        // Timeout after 60 seconds
        setTimeout(() => {
          if (pendingCalls.has(callId)) {
            pendingCalls.delete(callId);
            reject(new Error('Tool call timed out'));
          }
        }, 60_000);
      });

      return result;
    },
  );
}

// Handle results from parent
process.on('message', (msg: { type: string; callId: string; result: unknown }) => {
  if (msg.type === 'tool_result') {
    const pending = pendingCalls.get(msg.callId);
    if (pending) {
      pendingCalls.delete(msg.callId);
      pending.resolve(msg.result);
    }
  }
});

// Start the server with stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
```

---

## Layer 5: Orchestrator Integration

The Agent Orchestrator (in `@animus-labs/backend`) assembles the MCP server configuration when spawning sub-agents. This is where the per-contact permission filtering happens.

```typescript
// packages/backend/src/heartbeat/orchestrator.ts (relevant section)

import type { AgentProvider, PermissionTier } from '@animus-labs/shared';
import type { AgentSessionConfig } from '@animus-labs/agents';
import type { ToolHandlerContext } from '../tools/types.js';
import { buildClaudeMcpConfig, buildClaudeAllowedTools } from '../tools/servers/claude-mcp.js';
import { createStdioMcpConfig } from '../tools/servers/stdio-mcp.js';

/**
 * Build the MCP server configuration for a sub-agent session.
 *
 * Selects the appropriate MCP server strategy based on provider:
 * - Claude: In-process MCP server (zero IPC overhead)
 * - Codex/OpenCode: stdio subprocess MCP server
 *
 * Tools are filtered by the triggering contact's permission tier.
 */
function buildMcpConfig(
  provider: AgentProvider,
  tier: PermissionTier,
  handlerContext: ToolHandlerContext,
): Partial<AgentSessionConfig> {
  switch (provider) {
    case 'claude': {
      return {
        mcpServers: buildClaudeMcpConfig(tier, handlerContext),
        allowedTools: buildClaudeAllowedTools(tier),
      };
    }

    case 'codex': {
      const handle = createStdioMcpConfig(tier, handlerContext);
      // Track the handle for cleanup when session ends
      this.mcpHandles.set(handlerContext.agentTaskId, handle);

      return {
        mcpServers: {
          'animus-tools': handle.config,
        },
      };
    }

    case 'opencode': {
      const handle = createStdioMcpConfig(tier, handlerContext);
      this.mcpHandles.set(handlerContext.agentTaskId, handle);

      // OpenCode uses slightly different config format
      return {
        mcpServers: {
          'animus-tools': {
            command: handle.config.command,
            args: handle.config.args,
            env: handle.config.env,
          },
        },
      };
    }
  }
}
```

---

## MCP Server Configuration Mapping

Each SDK receives the same tools but through different configuration formats. The adapters in `@animus-labs/agents` pass these through to the SDKs unchanged.

### Claude Agent SDK

**Sub-agent sessions** receive tier-filtered tools:

```typescript
// Sub-agent MCP config (primary tier example)
{
  mcpServers: {
    'animus-tools': createSdkMcpServer({
      name: 'animus-tools',
      version: '1.0.0',
      tools: [
        tool('send_message', '...', schema, handler),
        tool('update_progress', '...', schema, handler),
        tool('read_memory', '...', schema, handler),
        tool('run_with_credentials', '...', schema, handler),
      ],
    }),
  },
  allowedTools: [
    'mcp__animus-tools__send_message',
    'mcp__animus-tools__update_progress',
    'mcp__animus-tools__read_memory',
    'mcp__animus-tools__run_with_credentials',
  ],
}
```

**Mind session** receives two MCP servers — `animus-tools` (mind tools) and `cognitive` (phase-tracking tools):

```typescript
// Mind session MCP config
{
  mcpServers: {
    'tools': createSdkMcpServer({ tools: [
      tool('read_memory', '...', schema, handler),
      tool('lookup_contacts', '...', schema, handler),
      tool('send_proactive_message', '...', schema, handler),
      tool('send_media', '...', schema, handler),
      tool('run_with_credentials', '...', schema, handler),
    ]}),
    'cognitive': createSdkMcpServer({ tools: [
      tool('record_thought', '...', schema, handler),
      tool('record_cognitive_state', '...', schema, handler),
    ]}),
    // ...plus any plugin MCP servers
  },
  allowedTools: [
    'mcp__tools__read_memory',
    'mcp__tools__lookup_contacts',
    'mcp__tools__send_proactive_message',
    'mcp__tools__send_media',
    'mcp__tools__run_with_credentials',
    'mcp__cognitive__record_thought',
    'mcp__cognitive__record_cognitive_state',
  ],
}
```

### Codex SDK

```typescript
// Mapped to Codex config.toml format (or programmatic equivalent)
{
  mcpServers: {
    'animus-tools': {
      command: '/usr/bin/node',
      args: ['/path/to/stdio-mcp-process.js'],
      env: {
        ANIMUS_MCP_TOOLS: '...',  // Serialized tool metadata
      },
    },
  },
}
```

### OpenCode SDK

```typescript
// Mapped to OpenCode's mcp config format
{
  mcpServers: {
    'animus-tools': {
      command: '/usr/bin/node',
      args: ['/path/to/stdio-mcp-process.js'],
      env: {
        ANIMUS_MCP_TOOLS: '...',
      },
    },
  },
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

## Transport Comparison & Tradeoffs

| Aspect | In-Process (Claude) | stdio Subprocess (Codex/OpenCode) |
|--------|--------------------|---------------------------------|
| **Latency** | ~0ms (function call) | ~1-5ms (IPC serialization) |
| **Memory** | Shared with backend | Separate V8 isolate (~30-50MB) |
| **Reliability** | Same as host process | Subprocess can crash independently |
| **Debugging** | Same debugger session | Requires separate log inspection |
| **Compatibility** | Claude SDK only | All SDKs via MCP stdio transport |
| **Handler access** | Direct DB access | IPC to parent for handler execution |
| **Lifecycle** | Tied to query() call | Must be explicitly killed on session end |

### Why not a persistent HTTP MCP server?

A persistent HTTP MCP server running on localhost would work for all three SDKs, but introduces unnecessary complexity for a single-user, self-hosted application:

1. **Port management** — Need to pick a port, handle conflicts, manage lifecycle
2. **Authentication** — Even on localhost, should validate requests come from our sessions
3. **Additional attack surface** — A listening HTTP port is a security risk, even on localhost
4. **No benefit over stdio** — stdio provides the same functionality with zero configuration
5. **Connection lifecycle** — Must handle server startup, health checks, graceful shutdown

stdio is the right choice for local tools. HTTP/Streamable HTTP is for **remote** MCP servers (which we support via passthrough for user-configured servers).

---

## Implementation Status

### Phase 1: Tool Definitions & Registry — COMPLETE

- `packages/shared/src/tools/definitions.ts` — 7 tool definitions with Zod schemas
- `packages/shared/src/tools/permissions.ts` — permission map + `getMindTools()`
- `packages/backend/src/tools/types.ts` — handler interface with `ToolHandlerContext`
- `packages/backend/src/tools/registry.ts` — full registry with all handlers
- `packages/backend/src/tools/handlers/` — 7 handler implementations

### Phase 2: Claude In-Process Server — COMPLETE

- `packages/backend/src/tools/servers/claude-mcp.ts` — in-process MCP server factory
- `packages/backend/src/heartbeat/mind-session.ts` — mind session assembles `tools` + `cognitive` + plugin MCP servers
- `packages/backend/src/heartbeat/cognitive-tools.ts` — cognitive MCP server (record_thought + record_cognitive_state)
- All tools tested end-to-end with Claude Agent SDK

### Phase 3: stdio MCP Server (when implementing Codex/OpenCode adapters)

Not yet started. Will be needed when Codex/OpenCode adapters are implemented.

### Phase 4: Plugin MCP Servers — COMPLETE

Plugin-defined MCP servers are loaded via the plugin system and merged into the mind session's MCP config alongside built-in tools. See `docs/architecture/plugin-system.md`.

---

## Dependencies

| Package | Used By | Purpose |
|---------|---------|---------|
| `zod` | `@animus-labs/shared` | Tool input schema definitions |
| `@anthropic-ai/claude-agent-sdk` | `@animus-labs/backend` | `createSdkMcpServer()`, `tool()` for in-process server |
| `@modelcontextprotocol/sdk` | `@animus-labs/backend` | `McpServer`, `StdioServerTransport` for stdio subprocess |

### Package Boundary Summary

| What | Where | Why |
|------|-------|-----|
| Tool definitions (name, description, schema) | `@animus-labs/shared` | Reusable across frontend and backend |
| Permission map | `@animus-labs/shared` | Shared knowledge of who can use what |
| Tool handlers (implementation) | `@animus-labs/backend` | Need DB access, event bus, embeddings |
| Tool registry (defs + handlers) | `@animus-labs/backend` | Combines shared defs with backend handlers |
| MCP server factories | `@animus-labs/backend` | Creates provider-specific MCP configs |
| MCP config passthrough | `@animus-labs/agents` | Passes mcpServers to SDK unchanged |

---

## Open Questions Resolved

This document resolves **Open Question #3: MCP Tool Design for Sub-Agents** from `docs/architecture/open-questions.md`:

- **`send_message` channel context**: The handler receives `sourceChannel` and `conversationId` via `ToolHandlerContext`, populated by the orchestrator from the triggering message.
- **`update_progress` schema**: `{ activity: string, percentComplete?: number }` — simple and focused.
- **`read_memory` interface**: Uses `MemoryManager.retrieveRelevant()` which embeds the query and searches LanceDB, same retrieval as GATHER CONTEXT but available on-demand.
- **Tool permissions**: Sub-agent tools filtered at session creation time via `getToolsForTier()`. Mind tools are unfiltered.
- **Custom user-defined tools**: Supported via plugin MCP servers (see `docs/architecture/plugin-system.md`).
- **Tool call result flow**: For Claude, results return in-process. For Codex/OpenCode, results will flow via IPC (stdio transport, not yet implemented).
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
