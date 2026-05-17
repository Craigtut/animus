# Animus MCP Tool Architecture

> **Status**: Implemented

Animus exposes tools to the Cortex-backed mind through MCP. Tool definitions live in `@animus-labs/shared`, handlers live in the backend, and Cortex connects MCP servers during agent startup and plugin lifecycle changes.

## Current Runtime

The active agent runtime is `@animus-labs/cortex`. The retired `@animus-labs/agents` subprocess SDK stack is not part of backend production runtime, Docker runtime, or desktop bundles.

```
@animus-labs/shared
  tool definitions, Zod input schemas, permission metadata
        |
        v
packages/backend/src/tools
  handler registry, permission filtering, HTTP bridge, stdio MCP server
        |
        v
@animus-labs/cortex
  McpClientManager connects built-in and plugin MCP servers
        |
        v
CortexAgent
  agentic loop calls tools through MCP
```

## Tool Definitions

Shared tool definitions are declared once in `packages/shared/src/tools/definitions.ts`. Each definition includes:

- `name`
- `description`
- `inputSchema`
- risk and permission metadata

The schemas must produce a JSON Schema root of `{ type: "object" }`. The tests in `packages/shared/tests/tool-definitions.test.ts` enforce this because MCP clients can reject tools with incompatible root schemas.

## Backend Handlers

Handlers live under `packages/backend/src/tools/handlers/` and are registered by the backend tool registry. Handlers run in the main backend process so they can use SQLite handles, the event bus, memory services, contact permissions, and channel routing without duplicating state in a child process.

The stdio MCP server in `packages/backend/src/tools/servers/animus-mcp-server.ts` translates MCP requests to the backend HTTP bridge. The bridge keeps the MCP protocol boundary clean while preserving backend-local handler execution.

## Cortex Wiring

Cortex integration happens in `packages/backend/src/heartbeat/cortex-mind.ts`.

- Built-in MCP servers are connected when the Cortex agent is created.
- Plugin MCP servers are connected, disconnected, or reconnected on plugin lifecycle events.
- Plugin MCP config is read from `PluginManager.getMcpConfigs()`.
- MCP transport configs are converted to Cortex `McpTransportConfig` objects before calling `cortexAgent.connectMcpServer()`.

There is no provider-specific MCP adapter path in Animus anymore. Cortex owns the active client connection layer.

## Permission Filtering

Tool access is filtered before the mind sees the tool list. The permission system combines:

- contact permission tier
- tool risk tier
- user-configured mode (`off`, `ask`, `always_allow`)
- deterministic approval flow for `ask`

See `docs/architecture/tool-permissions.md` for the approval flow and policy rules.

## Plugin MCP Servers

Plugins declare MCP servers in their manifest component path. `PluginManager.getMcpConfigs()` resolves those definitions, substitutes `${PLUGIN_ROOT}` and `${config.*}` placeholders, and returns namespaced server configs.

The Cortex lifecycle listener handles:

- `plugin:changed` with `installed` or `enabled`: connect matching plugin MCP servers
- `plugin:changed` with `disabled` or `uninstalled`: disconnect matching plugin MCP servers
- `plugin:config_updated`: reconnect the plugin's MCP servers with updated credentials or config

## `run_with_credentials`

When a plugin skill or tool needs a secret, the agent references a credential by manifest ref. The backend resolves the secret and injects it into only that subprocess environment. Provider keys and encryption keys are stripped from child environments so plugin scripts cannot inherit global credentials.

## Key Files

| File | Purpose |
|------|---------|
| `packages/shared/src/tools/definitions.ts` | Shared tool declarations and input schemas |
| `packages/backend/src/tools/registry.ts` | Backend handler registry |
| `packages/backend/src/tools/servers/mcp-bridge.ts` | HTTP bridge lifecycle and stdio server config |
| `packages/backend/src/tools/servers/animus-mcp-server.ts` | MCP stdio server process |
| `packages/backend/src/heartbeat/cortex-mind.ts` | Cortex MCP connection lifecycle |
| `packages/backend/src/plugins/plugin-manager.ts` | Plugin MCP config resolution |
