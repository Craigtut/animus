/**
 * McpClientManager: connects to MCP servers and wraps discovered tools
 * as AgentTool objects for registration with pi-agent-core.
 *
 * Handles two transport types:
 * - Stdio: spawns a subprocess, communicates via stdin/stdout
 * - HTTP: connects to an already-running Streamable HTTP server
 *
 * Tool discovery via tools/list, tool execution via tools/call.
 * Connections are persistent (kept alive between ticks) with health monitoring.
 * Reconnect on subprocess crash (3 attempts before deregistering).
 *
 * References:
 *   - docs/cortex/mcp-integration.md
 *   - docs/cortex/plans/phase-3-plugin-tools.md
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { Type } from '@sinclair/typebox';
import type { McpTransportConfig, McpConnectionState, McpStdioConfig, McpHttpConfig } from './types.js';
import { buildSafeEnv } from './tools/shared/safe-env.js';

// ---------------------------------------------------------------------------
// AgentTool interface (pi-agent-core minimal contract)
// ---------------------------------------------------------------------------

/**
 * Minimal AgentTool interface matching pi-agent-core's tool registration.
 * Defined inline to avoid a hard runtime dependency on pi-agent-core types.
 */
export interface AgentTool {
  name: string;
  description: string;
  parameters: unknown;
  execute: (args: unknown) => Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Internal connection record
// ---------------------------------------------------------------------------

interface McpConnection {
  serverName: string;
  config: McpTransportConfig;
  client: Client;
  transport: StdioClientTransport | StreamableHTTPClientTransport;
  tools: AgentTool[];
  connected: boolean;
  reconnectAttempts: number;
  /** Subprocess PID for stdio transports (used for process cleanup). */
  pid: number | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RECONNECT_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// McpClientManager
// ---------------------------------------------------------------------------

export class McpClientManager {
  private connections = new Map<string, McpConnection>();

  /**
   * Callback invoked whenever the aggregate tool set changes.
   * CortexAgent uses this to resync live tools after connect/disconnect/reconnect.
   */
  onToolsChanged?: () => void;

  /**
   * Callback invoked when a subprocess is spawned (for PID tracking).
   * The consumer (CortexAgent) uses this to track PIDs for exit cleanup.
   */
  onSubprocessSpawned?: (pid: number) => void;

  /**
   * Callback invoked when a subprocess exits (for PID tracking).
   */
  onSubprocessExited?: (pid: number) => void;

  /**
   * Consumer-set environment variable overrides that bypass the security blocklist.
   * Merged ON TOP of the sanitized environment for all stdio subprocesses.
   * Used for macOS dock icon suppression vars (DYLD_INSERT_LIBRARIES, etc.).
   */
  envOverrides?: Record<string, string>;

  /**
   * Optional logging callbacks. If not provided, messages are silently ignored.
   */
  log?: {
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string, err?: unknown) => void;
    debug: (message: string) => void;
  };

  /**
   * Connect to an MCP server and discover its tools.
   *
   * Spawns a subprocess (stdio) or connects to a URL (http), performs
   * the MCP handshake, calls tools/list, and wraps each discovered
   * tool as an AgentTool with namespaced name.
   *
   * @param serverName - Unique name for this server (used for tool namespacing)
   * @param config - Transport configuration
   * @throws Error if connection or tool discovery fails
   */
  async connect(serverName: string, config: McpTransportConfig): Promise<void> {
    // Disconnect existing connection with this name first
    if (this.connections.has(serverName)) {
      await this.disconnect(serverName);
    }

    this.log?.info(`Connecting to MCP server: ${serverName} (${config.transport})`);

    const transport = this.createTransport(config);
    const client = new Client(
      { name: `cortex-${serverName}`, version: '1.0.0' },
      { capabilities: {} },
    );

    try {
      await client.connect(transport as Transport);
    } catch (err) {
      this.log?.error(`Failed to connect to MCP server ${serverName}`, err);
      throw new Error(`MCP connection failed for "${serverName}": ${err instanceof Error ? err.message : String(err)}`);
    }

    // Track subprocess PID for stdio transports
    let pid: number | null = null;
    if (transport instanceof StdioClientTransport) {
      pid = transport.pid;
      if (pid != null) {
        this.onSubprocessSpawned?.(pid);
      }
    }

    // Discover tools
    let tools: AgentTool[];
    try {
      tools = await this.discoverTools(serverName, client);
    } catch (err) {
      this.log?.error(`Failed to discover tools from MCP server ${serverName}`, err);
      // Close the connection since tool discovery failed
      try {
        await client.close();
      } catch {
        // Best-effort cleanup
      }
      if (pid != null) {
        this.onSubprocessExited?.(pid);
      }
      throw new Error(`MCP tool discovery failed for "${serverName}": ${err instanceof Error ? err.message : String(err)}`);
    }

    const connection: McpConnection = {
      serverName,
      config,
      client,
      transport,
      tools,
      connected: true,
      reconnectAttempts: 0,
      pid,
    };

    // Wire close handler for reconnect on unexpected disconnect
    transport.onclose = () => {
      this.handleDisconnect(serverName);
    };

    this.connections.set(serverName, connection);
    this.log?.info(`Connected to MCP server ${serverName}: ${tools.length} tools discovered [${tools.map(t => t.name).join(', ')}]`);
    this.onToolsChanged?.();
  }

  /**
   * Disconnect from a specific MCP server.
   * Closes the transport and removes all tools from that server.
   *
   * @param serverName - The server name to disconnect
   */
  async disconnect(serverName: string): Promise<void> {
    const conn = this.connections.get(serverName);
    if (!conn) return;

    this.log?.info(`Disconnecting from MCP server: ${serverName}`);
    conn.connected = false;

    try {
      await conn.client.close();
    } catch (err) {
      this.log?.warn(`Error closing MCP client for ${serverName}: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (conn.pid != null) {
      this.onSubprocessExited?.(conn.pid);
    }

    this.connections.delete(serverName);
    this.onToolsChanged?.();
  }

  /**
   * Close all MCP connections.
   * Kills all stdio subprocesses and closes HTTP connections.
   */
  async closeAll(): Promise<void> {
    const names = [...this.connections.keys()];
    const results = await Promise.allSettled(
      names.map(name => this.disconnect(name)),
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      if (result.status === 'rejected') {
        this.log?.warn(`Failed to disconnect ${names[i]}: ${(result as PromiseRejectedResult).reason}`);
      }
    }
  }

  /**
   * Get all AgentTool objects from all connected MCP servers.
   * Returns tools namespaced as serverName__toolName.
   */
  getTools(): AgentTool[] {
    const allTools: AgentTool[] = [];
    for (const conn of this.connections.values()) {
      if (conn.connected) {
        allTools.push(...conn.tools);
      }
    }
    return allTools;
  }

  /**
   * Get tool names from a specific server.
   */
  getServerToolNames(serverName: string): string[] {
    const conn = this.connections.get(serverName);
    if (!conn || !conn.connected) return [];
    return conn.tools.map(t => t.name);
  }

  /**
   * Get the connection state for all servers.
   */
  getConnectionStates(): McpConnectionState[] {
    const states: McpConnectionState[] = [];
    for (const conn of this.connections.values()) {
      states.push({
        serverName: conn.serverName,
        config: conn.config,
        connected: conn.connected,
        reconnectAttempts: conn.reconnectAttempts,
        toolNames: conn.tools.map(t => t.name),
      });
    }
    return states;
  }

  /**
   * Check if a specific server is connected.
   */
  isConnected(serverName: string): boolean {
    const conn = this.connections.get(serverName);
    return conn?.connected ?? false;
  }

  /**
   * Get the number of active connections.
   */
  get connectionCount(): number {
    let count = 0;
    for (const conn of this.connections.values()) {
      if (conn.connected) count++;
    }
    return count;
  }

  // -----------------------------------------------------------------------
  // Private: Transport creation
  // -----------------------------------------------------------------------

  private createTransport(config: McpTransportConfig): StdioClientTransport | StreamableHTTPClientTransport {
    if (config.transport === 'stdio') {
      return this.createStdioTransport(config);
    }
    return this.createHttpTransport(config);
  }

  private createStdioTransport(config: McpStdioConfig): StdioClientTransport {
    // Sanitize environment variables for the subprocess.
    // Strip dangerous vars (LD_PRELOAD, NODE_OPTIONS, etc.) to prevent
    // injection via environment. Uses the same blocklist as the Bash tool.
    // envOverrides are merged ON TOP, bypassing the blocklist for
    // consumer-specified variables (e.g., macOS dock icon suppression).
    const baseEnv = config.env ?? process.env;
    const safeEnv = buildSafeEnv(baseEnv, undefined, this.envOverrides);

    // Build params object, only including defined optional fields to satisfy
    // exactOptionalPropertyTypes
    const params: {
      command: string;
      args: string[];
      env: Record<string, string>;
      cwd?: string;
      stderr: 'pipe';
    } = {
      command: config.command,
      args: config.args ?? [],
      env: safeEnv,
      stderr: 'pipe',
    };
    if (config.cwd !== undefined) params.cwd = config.cwd;

    return new StdioClientTransport(params);
  }

  private createHttpTransport(config: McpHttpConfig): StreamableHTTPClientTransport {
    const url = new URL(config.url);

    if (config.headers && Object.keys(config.headers).length > 0) {
      return new StreamableHTTPClientTransport(url, {
        requestInit: {
          headers: config.headers,
        },
      });
    }

    return new StreamableHTTPClientTransport(url);
  }

  // -----------------------------------------------------------------------
  // Private: Tool discovery and wrapping
  // -----------------------------------------------------------------------

  /**
   * Discover tools from a connected MCP server and wrap them as AgentTools.
   */
  private async discoverTools(serverName: string, client: Client): Promise<AgentTool[]> {
    const response = await client.listTools();
    const tools: AgentTool[] = [];

    for (const mcpTool of response.tools) {
      tools.push(this.wrapMcpTool(
        serverName,
        {
          name: mcpTool.name,
          description: mcpTool.description,
          inputSchema: mcpTool.inputSchema as Record<string, unknown> | undefined,
        },
        client,
      ));
    }

    return tools;
  }

  /**
   * Wrap a single MCP tool definition as an AgentTool.
   *
   * Key details:
   * - Name is prefixed with serverName__ for namespacing
   * - JSON Schema from MCP is wrapped via Type.Unsafe() for TypeBox/AJV
   * - execute() calls tools/call on the MCP connection using the original name
   * - Errors are caught and returned as error results (not thrown)
   */
  private wrapMcpTool(
    serverName: string,
    mcpTool: { name: string; description?: string | undefined; inputSchema?: Record<string, unknown> | undefined },
    client: Client,
  ): AgentTool {
    const namespacedName = `${serverName}__${mcpTool.name}`;

    // Wrap the MCP JSON Schema as a TypeBox type via Type.Unsafe()
    const inputSchema = mcpTool.inputSchema ?? { type: 'object', properties: {} };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parameters = Type.Unsafe(inputSchema as any);

    return {
      name: namespacedName,
      description: mcpTool.description ?? '',
      parameters,
      execute: async (args: unknown): Promise<unknown> => {
        try {
          const result = await client.callTool({
            name: mcpTool.name,  // Original name (no prefix)
            arguments: (args ?? {}) as Record<string, unknown>,
          });

          // Return text content from MCP result
          if (result.isError) {
            const errorText = Array.isArray(result.content)
              ? result.content
                  .filter((c): c is { type: 'text'; text: string } =>
                    typeof c === 'object' && c !== null && 'type' in c && c.type === 'text')
                  .map(c => c.text)
                  .join('\n')
              : String(result.content);
            throw new Error(errorText || 'MCP tool call failed');
          }

          const normalizedContent: Array<
            | { type: 'text'; text: string }
            | { type: 'image'; data: string; mimeType: string }
          > = [];

          if (Array.isArray(result.content)) {
            for (const item of result.content) {
              if (!item || typeof item !== 'object') {
                normalizedContent.push({ type: 'text', text: String(item) });
                continue;
              }

              const block = item as Record<string, unknown>;
              const type = block['type'];

              if (type === 'text' && typeof block['text'] === 'string') {
                normalizedContent.push({ type: 'text', text: block['text'] });
                continue;
              }

              if (type === 'image' &&
                  typeof block['data'] === 'string' &&
                  typeof block['mimeType'] === 'string') {
                normalizedContent.push({
                  type: 'image',
                  data: block['data'],
                  mimeType: block['mimeType'],
                });
                continue;
              }

              normalizedContent.push({
                type: 'text',
                text: JSON.stringify(block, null, 2),
              });
            }
          }

          if (normalizedContent.length === 0) {
            const structuredContent = (result as Record<string, unknown>)['structuredContent'];
            if (structuredContent !== undefined) {
              normalizedContent.push({
                type: 'text',
                text: JSON.stringify(structuredContent, null, 2),
              });
            } else {
              normalizedContent.push({
                type: 'text',
                text: String(result.content ?? ''),
              });
            }
          }

          return {
            content: normalizedContent,
            details: {
              structuredContent: (result as Record<string, unknown>)['structuredContent'] ?? null,
              rawContent: result.content ?? null,
            },
          };
        } catch (err) {
          // Re-throw as a standard error for pi-agent-core to handle
          if (err instanceof Error) throw err;
          throw new Error(`MCP tool call "${mcpTool.name}" failed: ${String(err)}`);
        }
      },
    };
  }

  // -----------------------------------------------------------------------
  // Private: Reconnect handling
  // -----------------------------------------------------------------------

  /**
   * Handle unexpected disconnection from an MCP server.
   * Attempts reconnection up to MAX_RECONNECT_ATTEMPTS times.
   */
  private handleDisconnect(serverName: string): void {
    const conn = this.connections.get(serverName);
    if (!conn) return;

    // Already disconnected intentionally
    if (!conn.connected) return;

    conn.connected = false;
    conn.reconnectAttempts++;

    if (conn.pid != null) {
      this.onSubprocessExited?.(conn.pid);
      conn.pid = null;
    }

    this.log?.warn(`MCP server ${serverName} disconnected unexpectedly (attempt ${conn.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);

    if (conn.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.log?.error(`MCP server ${serverName} failed to reconnect after ${MAX_RECONNECT_ATTEMPTS} attempts; deregistering tools`);
      this.connections.delete(serverName);
      this.onToolsChanged?.();
      return;
    }

    // Attempt reconnect asynchronously
    this.attemptReconnect(serverName, conn.config).catch((err) => {
      this.log?.error(`Reconnect attempt for ${serverName} failed`, err);
    });
  }

  /**
   * Attempt to reconnect to an MCP server.
   */
  private async attemptReconnect(serverName: string, config: McpTransportConfig): Promise<void> {
    // Brief delay before reconnect
    await new Promise(resolve => setTimeout(resolve, 1000));

    const existing = this.connections.get(serverName);
    if (!existing) return; // Was deregistered during delay

    let client: Client | null = null;
    let pid: number | null = null;

    try {
      // Attempt fresh connection
      const transport = this.createTransport(config);
      client = new Client(
        { name: `cortex-${serverName}`, version: '1.0.0' },
        { capabilities: {} },
      );

      await client.connect(transport as Transport);

      // Track subprocess PID
      if (transport instanceof StdioClientTransport) {
        pid = transport.pid;
        if (pid != null) {
          this.onSubprocessSpawned?.(pid);
        }
      }

      // Rediscover tools
      const tools = await this.discoverTools(serverName, client);

      // Wire close handler
      transport.onclose = () => {
        this.handleDisconnect(serverName);
      };

      // Update connection record
      existing.client = client;
      existing.transport = transport;
      existing.tools = tools;
      existing.connected = true;
      existing.pid = pid;
      // Keep reconnectAttempts as-is (reset only on fresh connect)

      this.log?.info(`Reconnected to MCP server ${serverName}: ${tools.length} tools`);
      this.onToolsChanged?.();
    } catch (err) {
      // Clean up resources from partial connection
      if (client) {
        try { await client.close(); } catch { /* best-effort */ }
      }
      if (pid != null) {
        this.onSubprocessExited?.(pid);
      }

      this.log?.warn(`Reconnect to ${serverName} failed: ${err instanceof Error ? err.message : String(err)}`);
      existing.reconnectAttempts++;
      if (existing.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        this.log?.error(`MCP server ${serverName} exceeded max reconnect attempts; deregistering`);
        this.connections.delete(serverName);
        this.onToolsChanged?.();
      } else {
        // Schedule another attempt since transport.onclose may not fire
        this.attemptReconnect(serverName, config).catch((retryErr) => {
          this.log?.error(`Subsequent reconnect for ${serverName} failed`, retryErr);
        });
      }
    }
  }
}
