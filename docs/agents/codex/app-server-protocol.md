# Codex App Server Protocol Reference

> **Protocol**: JSON-RPC 2.0 over stdio (JSONL)
> **Process**: `codex app-server` (long-lived)
> **Status**: Stable (non-experimental), used by VS Code extension and CLI TUI

## Overview

The App Server Protocol provides a long-lived, bidirectional JSON-RPC 2.0 interface to the Codex agent runtime. Unlike the SDK's `codex exec` approach (which spawns a disposable process per turn and closes stdin immediately), the app-server maintains a persistent process with full request/response and notification capabilities.

This enables features impossible with the per-turn SDK approach:
- **Mid-turn injection** via `turn/steer` (cancel current response, preserve context, append message, create new response)
- **Cancellation** via `turn/interrupt`
- **Approval flow** for tool execution (accept/decline before execution)
- **Session forking** via `thread/fork`

## Initialization Handshake

```
Client                              Server
  |                                   |
  |--- initialize (request) --------->|
  |<-- initialize (response) ---------|
  |--- initialized (notification) --->|
  |                                   |
  |   (ready for thread/turn ops)     |
```

### Initialize Request

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2.0",
    "clientInfo": {
      "name": "animus-agents",
      "version": "1.0.0"
    }
  }
}
```

### Initialize Response

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2.0",
    "serverInfo": {
      "name": "codex",
      "version": "1.0.0"
    }
  }
}
```

### Initialized Notification

```json
{
  "jsonrpc": "2.0",
  "method": "initialized"
}
```

## Method Inventory

### Requests (Client to Server)

| Method | Description | Returns |
|--------|-------------|---------|
| `initialize` | Protocol handshake | `InitializeResult` |
| `thread/start` | Start a new thread | `{ threadId }` |
| `thread/resume` | Resume existing thread | `{ threadId }` |
| `thread/fork` | Fork a thread | `{ threadId }` |
| `turn/start` | Start a new turn with user input | `{ turnId }` |
| `turn/steer` | Inject message mid-turn | `{ turnId }` |
| `turn/interrupt` | Cancel active turn | void |

### Notifications (Client to Server)

| Method | Description |
|--------|-------------|
| `initialized` | Sent after receiving initialize response |
| `item/approvalResponse` | Accept/decline a tool execution |

### Notifications (Server to Client)

| Method | Description |
|--------|-------------|
| `turn/started` | Turn has begun |
| `turn/completed` | Turn finished (completed/interrupted/failed) |
| `item/started` | Work item started (tool, reasoning, message) |
| `item/completed` | Work item completed |
| `item/agentMessage/delta` | Streaming text delta |
| `item/reasoning/textDelta` | Streaming reasoning delta |
| `thread/tokenUsage/updated` | Token usage update |
| `item/requestApproval` | Tool execution requires approval |
| `error` | General error notification |

## Thread Lifecycle

### thread/start

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "thread/start",
  "params": {
    "model": "codex-mini-latest",
    "instructions": "You are a helpful assistant.",
    "cwd": "/path/to/project",
    "approvalPolicy": "on-request",
    "mcpServers": { ... }
  }
}
```

Response: `{ "threadId": "thread_abc123" }`

### thread/resume

```json
{
  "method": "thread/resume",
  "params": { "threadId": "thread_abc123" }
}
```

### thread/fork

Creates a copy of an existing thread with independent conversation history.

```json
{
  "method": "thread/fork",
  "params": { "threadId": "thread_abc123" }
}
```

Response: `{ "threadId": "thread_def456" }`

## Turn Lifecycle

### turn/start

```json
{
  "method": "turn/start",
  "params": {
    "threadId": "thread_abc123",
    "input": [
      { "type": "text", "text": "What files are in this directory?" }
    ]
  }
}
```

Response: `{ "turnId": "turn_xyz789" }`

### Notification Flow

After `turn/start`, the server emits a sequence of notifications:

```
turn/started              -> Turn begins
item/started (reasoning)  -> Agent thinking (optional)
item/reasoning/textDelta  -> Streaming reasoning content
item/completed (reasoning)-> Reasoning done
item/agentMessage/delta   -> Streaming response text
item/started (command)    -> Tool execution starting
item/requestApproval      -> Approval needed (if policy != never)
item/completed (command)  -> Tool execution done
item/agentMessage/delta   -> More response text
thread/tokenUsage/updated -> Usage stats
turn/completed            -> Turn finished
```

### turn/completed Notification

```json
{
  "jsonrpc": "2.0",
  "method": "turn/completed",
  "params": {
    "threadId": "thread_abc123",
    "turnId": "turn_xyz789",
    "status": "completed",
    "finalResponse": "The directory contains..."
  }
}
```

Status values: `completed`, `interrupted`, `failed`

On failure:
```json
{
  "params": {
    "status": "failed",
    "error": {
      "code": "RATE_LIMIT",
      "message": "Rate limit exceeded"
    }
  }
}
```

## Mid-Turn Steering

### turn/steer

Injects a new user message into an active turn. Under the hood, the server:
1. Cancels the current Responses API response
2. Preserves all context (conversation history, tool results)
3. Appends the steer message
4. Creates a new response

```json
{
  "method": "turn/steer",
  "params": {
    "threadId": "thread_abc123",
    "input": [
      { "type": "text", "text": "Actually, focus on the Python files only." }
    ],
    "expectedTurnId": "turn_xyz789"
  }
}
```

The `expectedTurnId` is optional but recommended. If the turn has already completed or been replaced, the steer is rejected cleanly.

```
Client                              Server
  |                                   |
  |--- turn/start ------------------->|
  |<-- turn/started ------------------|
  |<-- item/agentMessage/delta -------|  (streaming)
  |                                   |
  |--- turn/steer ------------------->|  (user injects message)
  |                                   |
  |    (server cancels current        |
  |     response, preserves context,  |
  |     appends steer message)        |
  |                                   |
  |<-- turn/started ------------------|  (new turn begins)
  |<-- item/agentMessage/delta -------|  (new response)
  |<-- turn/completed ----------------|
```

## Turn Interruption

### turn/interrupt

Cancels an active turn. The server cancels the current operation and emits `turn/completed` with `status: "interrupted"`.

```json
{
  "method": "turn/interrupt",
  "params": {
    "threadId": "thread_abc123",
    "turnId": "turn_xyz789"
  }
}
```

```
Client                              Server
  |                                   |
  |--- turn/interrupt --------------->|
  |                                   |
  |<-- turn/completed (interrupted) --|
```

## Approval Flow

When the approval policy is not `never`, the server requests approval before executing tools.

### item/requestApproval Notification

```json
{
  "jsonrpc": "2.0",
  "method": "item/requestApproval",
  "params": {
    "requestId": "approval_123",
    "turnId": "turn_xyz789",
    "itemId": "item_456",
    "itemType": "commandExecution",
    "data": {
      "command": "rm -rf node_modules",
      "cwd": "/project"
    }
  }
}
```

Item types that may request approval:
- `commandExecution`: Shell command execution
- `fileChange`: File create/modify/delete
- `mcpToolCall`: MCP tool invocation

### item/approvalResponse Notification

```json
{
  "jsonrpc": "2.0",
  "method": "item/approvalResponse",
  "params": {
    "requestId": "approval_123",
    "decision": "approve"
  }
}
```

Decision values: `approve`, `decline`

```
Client                              Server
  |                                   |
  |<-- item/requestApproval ----------|
  |                                   |
  |    (evaluate: canUseTool,         |
  |     onPreToolUse, policy)         |
  |                                   |
  |--- item/approvalResponse -------->|
  |                                   |
  |<-- item/completed ----------------|  (if approved)
```

## Item Types

### commandExecution

```json
{
  "itemType": "commandExecution",
  "data": {
    "command": "ls -la",
    "cwd": "/project",
    "exitCode": 0,
    "output": "total 42\n...",
    "durationMs": 150
  }
}
```

### mcpToolCall

```json
{
  "itemType": "mcpToolCall",
  "data": {
    "server": "my-mcp-server",
    "tool": "search_files",
    "args": { "query": "*.ts" },
    "result": "Found 15 files",
    "durationMs": 200
  }
}
```

### fileChange

```json
{
  "itemType": "fileChange",
  "data": {
    "path": "src/index.ts",
    "changeType": "modify",
    "diff": "@@ -1,3 +1,5 @@\n+import { foo } from './foo';\n..."
  }
}
```

### reasoning

```json
{
  "itemType": "reasoning",
  "data": {
    "content": "Let me think about this...",
    "summary": "Analyzing the codebase structure"
  }
}
```

## Token Usage

```json
{
  "jsonrpc": "2.0",
  "method": "thread/tokenUsage/updated",
  "params": {
    "threadId": "thread_abc123",
    "usage": {
      "inputTokens": 1500,
      "outputTokens": 350,
      "totalTokens": 1850
    }
  }
}
```

## Approval Policies

| Policy | Behavior |
|--------|----------|
| `never` | All tools auto-approved, no `requestApproval` notifications |
| `on-request` | Model decides when approval is needed (default) |
| `on-failure` | Auto-approve with sandbox, prompt on failure |
| `untrusted` | Only known-safe read-only operations auto-approved |

## Type Generation

To regenerate the full TypeScript type definitions from the protocol schema:

```bash
codex app-server generate-ts
```

The Animus adapter uses a manually curated subset (~150 lines) in `codex-protocol-types.ts` for maintainability.

## Comparison: SDK vs App Server

| Aspect | SDK (`codex exec`) | App Server |
|--------|-------------------|------------|
| Process lifecycle | Disposable per turn | Long-lived |
| Communication | Write-once stdin, read stdout | Bidirectional JSON-RPC |
| Cancel | Not possible | `turn/interrupt` |
| Mid-turn injection | Not possible | `turn/steer` |
| Tool approval | Policy-based only | Interactive request/response |
| Session forking | Not available | `thread/fork` |
| Multi-session | Separate process each | Shared process |

## References

- [Codex App Server Protocol Schema](https://github.com/openai/codex/tree/main/codex-rs/app-server-protocol)
- [Codex SDK Documentation](https://developers.openai.com/codex/sdk/)
- [VS Code Extension (uses this protocol)](https://marketplace.visualstudio.com/items?itemName=OpenAI.openai-codex)
