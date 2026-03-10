/**
 * Sandbox MCP Server — in-process MCP server with only `run_with_credentials`.
 *
 * Claude-only feature (in-process servers use the Claude SDK's tool()/createSdkMcpServer).
 * Follows the exact pattern from tools/servers/mcp-bridge.ts.
 *
 * Built once and cached — reused across session resets.
 */

import { runWithCredentialsDef } from '@animus-labs/shared';
import { runWithCredentialsHandler } from '../tools/handlers/run-with-credentials.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('SandboxMCP', 'agents');

let cached: {
  serverConfig: Record<string, unknown>;
  allowedTools: string[];
} | null = null;

/**
 * Build an in-process MCP server exposing only `run_with_credentials`.
 *
 * Uses the Claude Agent SDK's `tool()` + `createSdkMcpServer()` pattern.
 * The handler resolves credentials from the plugin manager singleton —
 * no tick context needed.
 */
export async function buildSandboxMcpServer(): Promise<{
  serverConfig: Record<string, unknown>;
  allowedTools: string[];
}> {
  if (cached) return cached;

  const sdk = await import('@anthropic-ai/claude-agent-sdk');

  const sdkTool = sdk.tool(
    'run_with_credentials',
    runWithCredentialsDef.description,
    (runWithCredentialsDef.inputSchema as any).shape, // eslint-disable-line @typescript-eslint/no-explicit-any -- Zod v3 compat shim
    async (args: Record<string, unknown>) => {
      log.info('Sandbox run_with_credentials call');
      // The handler's _context param is unused — it only needs getPluginManager() singleton
      const result = await runWithCredentialsHandler(args as any, null as any);
      return result as { [x: string]: unknown; content: Array<{ type: 'text'; text: string }> };
    },
  );

  const server = sdk.createSdkMcpServer({
    name: 'sandbox',
    version: '1.0.0',
    tools: [sdkTool],
  });

  cached = {
    serverConfig: server as unknown as Record<string, unknown>,
    allowedTools: ['mcp__sandbox__run_with_credentials'],
  };

  log.info('Sandbox MCP server built');
  return cached;
}
