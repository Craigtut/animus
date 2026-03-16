# Phase 3: Plugin Tools via MCP Client

> **Scope:** Implement the MCP client adapter so plugin-provided tools work with cortex. Dynamic tool registration/deregistration as plugins install/uninstall.

## Dependencies

- Phase 2A complete (CortexAgent wired into heartbeat)

## Tasks

### 3.1: MCP Client Manager (`mcp-client.ts`)

**Reference:** `mcp-integration.md`

```typescript
class McpClientManager {
  connect(serverName: string, config: McpTransportConfig): Promise<void>;
  disconnect(serverName: string): Promise<void>;
  closeAll(): Promise<void>;
  getTools(): AgentTool[];
}
```

- Stdio transport: spawn subprocess, communicate via `@modelcontextprotocol/sdk` `Client` + `StdioClientTransport`
- HTTP transport: `StreamableHTTPClientTransport`
- Tool discovery: `tools/list` on connection, wrap each as `AgentTool` with namespace prefix (`serverName__toolName`, 2-part convention per `mcp-integration.md`)
- Schema conversion: MCP JSON Schema -> TypeBox `Type.Unsafe()`
- Connection persistence: connections are kept alive between ticks (persistent mode). Health monitoring via periodic ping. On connection drop: attempt reconnect; if reconnect fails within 3 attempts, deregister tools and log warning.
- Explicitly out of scope: MCP resources and prompts (only `tools/list` + `tools/call` used)

### 3.2: Animus Tool Server Connection

Connect to the existing `animus-mcp-server.ts` subprocess via MCP client:

- Cortex spawns the subprocess with `BRIDGE_PORT`, `TOOL_SET=mind`, `TASK_ID=mind` env vars
- Discovers Animus tools via `tools/list`
- Wraps each as an `AgentTool`
- This replaces the current direct SDK `mcpServers` config with a cortex-owned MCP client connection

### 3.3: Plugin MCP Server Connections

Connect to each plugin's MCP server:

- Backend's `pluginManager.getPluginMcpServersForSdk()` provides per-plugin configs
- Cortex opens MCP client connections per plugin server
- Tools namespaced as `pluginName__serverName__toolName`
- Permission filtering via `beforeToolCall` hook (same `resolveToolGate` as built-in tools)

### 3.4: Dynamic Plugin Lifecycle

Wire plugin install/uninstall/update events to MCP client lifecycle:

- `plugin:installed` -> `mcpClientManager.connect(pluginConfig)`
- `plugin:removed` -> `mcpClientManager.disconnect(pluginName)`
- `plugin:updated` -> `mcpClientManager.disconnect(old)` then `mcpClientManager.connect(new)`
- Tool set on the CortexAgent is updated dynamically (pi-agent-core's `agent.setTools()`)
- System prompt rebuild triggered (installed plugins section)

### 3.5: Cleanup in CortexAgent.destroy()

Wire MCP client cleanup into the destroy sequence:
- `mcpClientManager.closeAll()` kills all stdio subprocesses and closes HTTP connections
- Happens after sub-agent cancellation, before event listener cleanup

## Completion Criteria

- Plugin MCP tools are discoverable and callable through the cortex agent
- Plugin install/uninstall dynamically adds/removes tools
- MCP subprocess cleanup happens on agent destroy
- Permission gate works for plugin tools

## Files Created/Modified

| File | Change |
|------|--------|
| `packages/cortex/src/mcp-client.ts` | New |
| `packages/cortex/src/cortex-agent.ts` | Wire MCP client, tool set updates |
| `packages/backend/src/heartbeat/mind-session.ts` | Pass plugin configs to cortex |
