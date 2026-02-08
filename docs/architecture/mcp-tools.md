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
│                        @animus/shared                                │
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
│  │  • primary: all tools                                        │  │
│  │  • standard: send_message, read_memory                       │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
                              │
               ┌──────────────┼──────────────┐
               ▼              │              ▼
┌──────────────────────┐      │    ┌──────────────────────────────────┐
│   @animus/backend    │      │    │       @animus/agents             │
│                      │      │    │                                  │
│ ┌──────────────────┐ │      │    │ ┌──────────────────────────────┐ │
│ │  Tool Handlers   │ │      │    │ │  McpServerConfig in session  │ │
│ │  (tool-handlers/)│ │      │    │ │  options — pass-through to   │ │
│ │                  │ │      │    │ │  each SDK's native MCP config│ │
│ │ send_message()   │◄┼──────┘    │ └──────────────────────────────┘ │
│ │ read_memory()    │ │           └──────────────────────────────────┘
│ │ update_progress()│ │
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

## Layer 1: Tool Definitions (`@animus/shared`)

Tool definitions are pure data structures — no handlers, no side effects, no dependencies on backend infrastructure. They live in `@animus/shared` because both the backend (which implements handlers) and the frontend (which may display available tools in the UI) need access to them.

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

### Tool Definitions

```typescript
// packages/shared/src/tools/definitions.ts

import { z } from 'zod';
import type { AnimusToolDef } from '../types/tools.js';

/**
 * send_message — Send a message to the triggering contact via the originating channel.
 *
 * Used by sub-agents for progress updates, clarifying questions, or intermediate findings.
 * The sub-agent speaks as Animus. Messages are scoped to the contact that initiated the task.
 */
export const sendMessageDef: AnimusToolDef = {
  name: 'send_message',
  description: 'Send a message to the user who triggered this task. The message will be delivered through the same channel they used (SMS, Discord, web, etc.). Use this for progress updates, clarifying questions, or sharing intermediate findings. You speak as Animus.',
  inputSchema: z.object({
    content: z.string().describe('The message content to send to the user'),
    priority: z.enum(['normal', 'urgent']).default('normal')
      .describe('Message priority. Use "urgent" only for time-sensitive information'),
  }),
  category: 'messaging',
};

/**
 * update_progress — Report progress back to the orchestrator.
 *
 * Updates the current_activity field in SQLite so the mind knows
 * what the sub-agent is working on.
 */
export const updateProgressDef: AnimusToolDef = {
  name: 'update_progress',
  description: 'Report your current progress on the task. This helps Animus track what you are working on and can inform the user if they ask about task status. Call this periodically during long tasks.',
  inputSchema: z.object({
    activity: z.string().describe('Brief description of what you are currently doing'),
    percentComplete: z.number().min(0).max(100).optional()
      .describe('Estimated percentage complete (0-100), if estimable'),
  }),
  category: 'progress',
};

/**
 * read_memory — Access Animus's long-term memory (LanceDB). Read-only.
 *
 * Sub-agents can query memories but cannot write them.
 * Only the mind writes memories.
 */
export const readMemoryDef: AnimusToolDef = {
  name: 'read_memory',
  description: 'Search Animus\'s long-term memory for relevant information. Returns memories ranked by relevance to your query. Use this to recall facts, past experiences, procedures, or outcomes that might help with the current task.',
  inputSchema: z.object({
    query: z.string().describe('Natural language search query describing what you want to recall'),
    limit: z.number().min(1).max(20).default(5)
      .describe('Maximum number of memories to return'),
    types: z.array(z.enum(['fact', 'experience', 'procedure', 'outcome'])).optional()
      .describe('Filter by memory type. Omit to search all types'),
  }),
  category: 'memory',
};

/**
 * Central registry of all Animus tool definitions.
 *
 * This is the single source of truth for what tools exist.
 * Handlers are attached separately in the backend.
 */
export const ANIMUS_TOOL_DEFS = {
  send_message: sendMessageDef,
  update_progress: updateProgressDef,
  read_memory: readMemoryDef,
} as const;

export type AnimusToolName = keyof typeof ANIMUS_TOOL_DEFS;
```

### Permission Map

```typescript
// packages/shared/src/tools/permissions.ts

import type { PermissionTier } from '../types/index.js';
import type { AnimusToolName } from './definitions.js';

/**
 * Maps contact permission tiers to allowed tool sets.
 *
 * This is a compile-time constant. The backend uses it to filter
 * tool lists before session creation.
 *
 * Permission tiers (from contacts.md):
 * - primary: Full permissions — sub-agents, tasks, goals, tools
 * - standard: Can message and get replies. No sub-agents, tasks, goals, or personal tools.
 *
 * Note: Standard contacts don't trigger sub-agent spawning (enforced in EXECUTE),
 * so these permissions primarily guard against edge cases where a sub-agent
 * running for the primary contact might interact with a standard contact's data.
 */
export const TOOL_PERMISSIONS: Record<PermissionTier, readonly AnimusToolName[]> = {
  primary: ['send_message', 'update_progress', 'read_memory'],
  standard: ['send_message', 'read_memory'],
} as const;

/**
 * Check if a tool is allowed for a given permission tier.
 */
export function isToolAllowed(tool: AnimusToolName, tier: PermissionTier): boolean {
  return TOOL_PERMISSIONS[tier].includes(tool);
}

/**
 * Get the list of allowed tools for a permission tier.
 */
export function getAllowedTools(tier: PermissionTier): readonly AnimusToolName[] {
  return TOOL_PERMISSIONS[tier];
}
```

---

## Layer 2: Tool Handlers (`@animus/backend`)

Handlers live in the backend because they need access to databases, the event bus, channel adapters, and other infrastructure. Each handler is a pure async function that receives typed input and a context object, and returns an MCP-compatible result.

### Handler Interface

```typescript
// packages/backend/src/tools/types.ts

import type { AnimusToolName } from '@animus/shared';

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
  };

  /** Event bus for emitting real-time events */
  eventBus: IEventBus;

  /** Embedding provider for memory search */
  embeddingProvider: IEmbeddingProvider;
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

```typescript
// packages/backend/src/tools/handlers/send-message.ts

import type { z } from 'zod';
import type { ToolHandler, ToolResult } from '../types.js';
import { sendMessageDef } from '@animus/shared';

type SendMessageInput = z.infer<typeof sendMessageDef.inputSchema>;

export const sendMessageHandler: ToolHandler<SendMessageInput> = async (
  input,
  context,
): Promise<ToolResult> => {
  // 1. Write message to messages.db
  const messageId = await context.stores.messages.createMessage({
    conversationId: context.conversationId,
    direction: 'outbound',
    sender: 'sub_agent',
    content: input.content,
    channelType: context.sourceChannel,
    agentTaskId: context.agentTaskId,
  });

  // 2. Emit real-time event for frontend (tRPC subscription)
  context.eventBus.emit('message:sent', {
    messageId,
    contactId: context.contactId,
    channel: context.sourceChannel,
    content: input.content,
    sender: 'sub_agent',
    agentTaskId: context.agentTaskId,
  });

  // 3. Route to channel adapter for delivery
  // (The outbound router picks up the event and delivers via the right channel)

  return {
    content: [{
      type: 'text',
      text: `Message sent successfully to ${context.sourceChannel} channel.`,
    }],
  };
};
```

```typescript
// packages/backend/src/tools/handlers/update-progress.ts

import type { z } from 'zod';
import type { ToolHandler, ToolResult } from '../types.js';
import { updateProgressDef } from '@animus/shared';

type UpdateProgressInput = z.infer<typeof updateProgressDef.inputSchema>;

export const updateProgressHandler: ToolHandler<UpdateProgressInput> = async (
  input,
  context,
): Promise<ToolResult> => {
  // Update current_activity in agent_tasks table
  await context.stores.heartbeat.updateAgentTaskProgress(
    context.agentTaskId,
    input.activity,
    input.percentComplete,
  );

  // Emit event for real-time UI updates
  context.eventBus.emit('agent:progress', {
    agentTaskId: context.agentTaskId,
    activity: input.activity,
    percentComplete: input.percentComplete,
  });

  return {
    content: [{
      type: 'text',
      text: 'Progress updated.',
    }],
  };
};
```

```typescript
// packages/backend/src/tools/handlers/read-memory.ts

import type { z } from 'zod';
import type { ToolHandler, ToolResult } from '../types.js';
import { readMemoryDef } from '@animus/shared';

type ReadMemoryInput = z.infer<typeof readMemoryDef.inputSchema>;

export const readMemoryHandler: ToolHandler<ReadMemoryInput> = async (
  input,
  context,
): Promise<ToolResult> => {
  // 1. Embed the query
  const queryEmbedding = await context.embeddingProvider.embed(input.query);

  // 2. Search LanceDB for relevant memories
  const memories = await context.stores.memory.searchLongTermMemories({
    embedding: queryEmbedding,
    limit: input.limit,
    types: input.types,
  });

  // 3. Format results
  if (memories.length === 0) {
    return {
      content: [{
        type: 'text',
        text: 'No relevant memories found for this query.',
      }],
    };
  }

  const formatted = memories.map((m, i) =>
    `[${i + 1}] (${m.type}, importance: ${m.importance.toFixed(2)}) ${m.content}`
  ).join('\n\n');

  return {
    content: [{
      type: 'text',
      text: `Found ${memories.length} relevant memories:\n\n${formatted}`,
    }],
  };
};
```

---

## Layer 3: Tool Registry (`@animus/backend`)

The registry combines definitions (from `@animus/shared`) with handlers (from the backend) and provides methods to create provider-specific MCP server configurations.

```typescript
// packages/backend/src/tools/registry.ts

import {
  ANIMUS_TOOL_DEFS,
  getAllowedTools,
  type AnimusToolName,
  type PermissionTier,
} from '@animus/shared';
import type { AnimusTool, ToolHandlerContext } from './types.js';
import { sendMessageHandler } from './handlers/send-message.js';
import { updateProgressHandler } from './handlers/update-progress.js';
import { readMemoryHandler } from './handlers/read-memory.js';

/**
 * The complete tool registry: definitions + handlers.
 */
const TOOL_REGISTRY: Record<AnimusToolName, AnimusTool> = {
  send_message: {
    name: 'send_message',
    description: ANIMUS_TOOL_DEFS.send_message.description,
    inputSchema: ANIMUS_TOOL_DEFS.send_message.inputSchema,
    handler: sendMessageHandler,
  },
  update_progress: {
    name: 'update_progress',
    description: ANIMUS_TOOL_DEFS.update_progress.description,
    inputSchema: ANIMUS_TOOL_DEFS.update_progress.inputSchema,
    handler: updateProgressHandler,
  },
  read_memory: {
    name: 'read_memory',
    description: ANIMUS_TOOL_DEFS.read_memory.description,
    inputSchema: ANIMUS_TOOL_DEFS.read_memory.inputSchema,
    handler: readMemoryHandler,
  },
};

/**
 * Get tools filtered by contact permission tier.
 */
export function getToolsForTier(tier: PermissionTier): AnimusTool[] {
  const allowedNames = getAllowedTools(tier);
  return allowedNames.map(name => TOOL_REGISTRY[name]);
}

/**
 * Get a specific tool by name.
 */
export function getTool(name: AnimusToolName): AnimusTool | undefined {
  return TOOL_REGISTRY[name];
}

/**
 * Get all registered tool names.
 */
export function getToolNames(): AnimusToolName[] {
  return Object.keys(TOOL_REGISTRY) as AnimusToolName[];
}
```

---

## Layer 4: MCP Server Factories (`@animus/backend`)

Two factory functions produce MCP servers for different providers, both consuming the same registry.

### Claude: In-Process Server

```typescript
// packages/backend/src/tools/servers/claude-mcp.ts

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { PermissionTier } from '@animus/shared';
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
import type { PermissionTier } from '@animus/shared';
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

The Agent Orchestrator (in `@animus/backend`) assembles the MCP server configuration when spawning sub-agents. This is where the per-contact permission filtering happens.

```typescript
// packages/backend/src/heartbeat/orchestrator.ts (relevant section)

import type { AgentProvider, PermissionTier } from '@animus/shared';
import type { AgentSessionConfig } from '@animus/agents';
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

Each SDK receives the same tools but through different configuration formats. The adapters in `@animus/agents` pass these through to the SDKs unchanged.

### Claude Agent SDK

```typescript
// What gets passed to Claude's query() options
{
  mcpServers: {
    'animus-tools': createSdkMcpServer({
      name: 'animus-tools',
      version: '1.0.0',
      tools: [
        tool('send_message', 'Send a message...', { content: z.string(), ... }, handler),
        tool('read_memory', 'Search memories...', { query: z.string(), ... }, handler),
        tool('update_progress', 'Report progress...', { activity: z.string(), ... }, handler),
      ],
    }),
  },
  allowedTools: [
    'mcp__animus-tools__send_message',
    'mcp__animus-tools__read_memory',
    'mcp__animus-tools__update_progress',
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
    │       │   primary → [send_message, update_progress, read_memory]
    │       │   standard → [send_message, read_memory]
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

This is already supported by the existing `McpServerConfig` type in `@animus/agents`. The orchestrator merges built-in tools with any user-configured MCP servers.

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

## Implementation Plan

### Phase 1: Tool Definitions & Registry (in parallel with Claude adapter)

1. Create `packages/shared/src/tools/definitions.ts` — tool definitions with Zod schemas
2. Create `packages/shared/src/tools/permissions.ts` — permission map
3. Create `packages/backend/src/tools/types.ts` — handler interface
4. Create `packages/backend/src/tools/registry.ts` — registry combining defs + handlers
5. Stub out handler implementations (return placeholder results)

### Phase 2: Claude In-Process Server

1. Create `packages/backend/src/tools/servers/claude-mcp.ts`
2. Integrate with Agent Orchestrator — inject MCP config during `spawn_agent`
3. Test tool calls end-to-end with Claude Agent SDK
4. Implement real handler logic (send_message, read_memory, update_progress)

### Phase 3: stdio MCP Server (when implementing Codex/OpenCode adapters)

1. Create `packages/backend/src/tools/servers/stdio-mcp-process.ts` — the subprocess
2. Create `packages/backend/src/tools/servers/stdio-mcp.ts` — the fork/IPC manager
3. Integrate with Codex adapter in orchestrator
4. Integrate with OpenCode adapter in orchestrator
5. Test tool calls through stdio transport

### Phase 4: User-Defined Tools & External MCP Servers

1. Add UI for configuring external MCP servers (GitHub, Postgres, etc.)
2. Merge user MCP config with built-in tools in orchestrator
3. Design custom tool registration API (deferred — needs requirements)

---

## Dependencies

| Package | Used By | Purpose |
|---------|---------|---------|
| `zod` | `@animus/shared` | Tool input schema definitions |
| `@anthropic-ai/claude-agent-sdk` | `@animus/backend` | `createSdkMcpServer()`, `tool()` for in-process server |
| `@modelcontextprotocol/sdk` | `@animus/backend` | `McpServer`, `StdioServerTransport` for stdio subprocess |

### Package Boundary Summary

| What | Where | Why |
|------|-------|-----|
| Tool definitions (name, description, schema) | `@animus/shared` | Reusable across frontend and backend |
| Permission map | `@animus/shared` | Shared knowledge of who can use what |
| Tool handlers (implementation) | `@animus/backend` | Need DB access, event bus, embeddings |
| Tool registry (defs + handlers) | `@animus/backend` | Combines shared defs with backend handlers |
| MCP server factories | `@animus/backend` | Creates provider-specific MCP configs |
| MCP config passthrough | `@animus/agents` | Passes mcpServers to SDK unchanged |

---

## Open Questions Resolved

This document resolves **Open Question #3: MCP Tool Design for Sub-Agents** from `docs/architecture/open-questions.md`:

- **`send_message` channel context**: The handler receives `sourceChannel` and `conversationId` via `ToolHandlerContext`, populated by the orchestrator from the triggering message.
- **`update_progress` schema**: `{ activity: string, percentComplete?: number }` — simple and focused.
- **`read_memory` interface**: Uses the same embedding provider and LanceDB search as the mind's GATHER CONTEXT, but exposed as a tool call.
- **Tool permissions**: Filtered at session creation time via `getToolsForTier()`. The MCP server only exposes tools the contact is allowed to use.
- **Custom user-defined tools**: Supported via registry extension and external MCP server passthrough.
- **Tool call result flow**: For Claude, results return in-process. For Codex/OpenCode, results flow via IPC (child→parent→child→SDK).

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
