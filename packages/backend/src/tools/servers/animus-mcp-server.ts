#!/usr/bin/env node
/**
 * Animus MCP Server — Stdio subprocess
 *
 * Stateless proxy that exposes Animus tools (or cognitive tools) over
 * the standard MCP stdio protocol. Each instance is spawned by an agent
 * SDK and communicates with the backend's HTTP bridge.
 *
 * Environment variables (set by buildMcpServerConfig):
 *   BRIDGE_PORT — localhost port of the HTTP bridge
 *   TOOL_SET   — 'mind' | 'cognitive' | 'subagent'
 *   TASK_ID    — task ID for context lookup in the bridge
 *
 * Dependencies: @modelcontextprotocol/sdk (for Server + StdioServerTransport)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { request as httpRequest } from 'node:http';

// ============================================================================
// Configuration from environment
// ============================================================================

const BRIDGE_PORT = parseInt(process.env['BRIDGE_PORT'] ?? '', 10);
const TOOL_SET = process.env['TOOL_SET'] ?? 'mind';
const TASK_ID = process.env['TASK_ID'] ?? 'mind';

if (!BRIDGE_PORT || isNaN(BRIDGE_PORT)) {
  process.stderr.write('FATAL: BRIDGE_PORT environment variable is required\n');
  process.exit(1);
}

// ============================================================================
// HTTP helpers — communicate with the bridge
// ============================================================================

interface BridgeToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

function bridgeGet(path: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port: BRIDGE_PORT,
        path,
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
          } catch (err) {
            reject(new Error(`Failed to parse bridge response: ${err}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function bridgePost(path: string, body: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port: BRIDGE_PORT,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
          } catch (err) {
            reject(new Error(`Failed to parse bridge response: ${err}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ============================================================================
// MCP Server Setup
// ============================================================================

async function main(): Promise<void> {
  // Fetch tool definitions from bridge at startup
  const toolsResponse = (await bridgeGet(`/tools?set=${TOOL_SET}`)) as {
    tools: BridgeToolDef[];
  };
  const toolDefs = toolsResponse.tools;

  // Build a lookup for tool routing
  const toolMap = new Map<string, BridgeToolDef>();
  for (const def of toolDefs) {
    toolMap.set(def.name, def);
  }

  // Determine server name based on tool set
  const serverName = TOOL_SET === 'cognitive' ? 'cognitive' : 'tools';

  // Create the MCP server
  const mcpServer = new Server(
    { name: serverName, version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  // Handle tools/list
  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: toolDefs.map((def) => ({
        name: def.name,
        description: def.description,
        inputSchema: def.inputSchema,
      })),
    };
  });

  // Handle tools/call
  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Route cognitive tools to dedicated bridge endpoints
    if (TOOL_SET === 'cognitive') {
      if (name === 'record_thought') {
        return (await bridgePost('/cognitive/thought', args ?? {})) as {
          content: Array<{ type: string; text: string }>;
          isError?: boolean;
        };
      }
      if (name === 'record_cognitive_state') {
        return (await bridgePost('/cognitive/state', args ?? {})) as {
          content: Array<{ type: string; text: string }>;
          isError?: boolean;
        };
      }
      return {
        content: [{ type: 'text', text: `Unknown cognitive tool: ${name}` }],
        isError: true,
      };
    }

    // Route regular Animus tools through the execute endpoint
    const result = (await bridgePost('/execute', {
      taskId: TASK_ID,
      toolName: name,
      args: args ?? {},
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    return result;
  });

  // Connect via stdio
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`animus-mcp-server fatal: ${err}\n`);
  process.exit(1);
});
