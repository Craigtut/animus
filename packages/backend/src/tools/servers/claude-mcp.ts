/**
 * Claude In-Process MCP Server Factory
 *
 * Creates an in-process MCP server using the Claude Agent SDK's
 * `tool()` + `createSdkMcpServer()`. This server runs in the same
 * Node.js process as the backend — no subprocess, no stdio.
 *
 * Uses a mutable context reference so the warm mind session can
 * reuse the same MCP server across ticks. The context is updated
 * before each `promptStreaming()` call with the current tick's
 * contact/channel/conversation.
 *
 * See docs/architecture/mcp-tools.md
 */

import { getMindTools, getAllowedTools, ANIMUS_TOOL_DEFS, type AnimusToolName, type PermissionTier } from '@animus/shared';
import type { ToolHandlerContext, ToolResult } from '../types.js';
import { executeTool } from '../registry.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('MindMCP', 'heartbeat');

/**
 * Mutable reference to the current tick's tool context.
 * Updated before each mind prompt; handlers read at call time.
 */
export interface MutableToolContext {
  current: ToolHandlerContext | null;
}

/**
 * Build an in-process MCP server for the mind session.
 *
 * Returns the opaque config object to pass as an `mcpServers` entry,
 * plus the list of tool names for `allowedTools`.
 */
export async function buildMindMcpServer(contextRef: MutableToolContext): Promise<{
  /** Pass as `mcpServers['animus']` in session config */
  serverConfig: Record<string, unknown>;
  /** Tool names to add to `allowedTools` (prefixed with `mcp__animus__`) */
  allowedTools: string[];
}> {
  // Dynamically import the Claude Agent SDK (same as the adapter does)
  const sdk = await import('@anthropic-ai/claude-agent-sdk');

  const mindTools = getMindTools();
  const sdkTools: Array<ReturnType<typeof sdk.tool>> = [];
  const allowedTools: string[] = [];

  for (const def of mindTools) {
    const toolName = def.name as AnimusToolName;

    // Build the SDK tool using the Claude SDK's `tool()` helper.
    // The handler reads from contextRef.current at call time so
    // the same server works across warm-session ticks.
    const sdkTool = sdk.tool(
      toolName,
      def.description,
      // The SDK's `tool()` expects a Zod raw shape (object fields),
      // not a full ZodObject. Extract `.shape` from our ZodObject.
      (def.inputSchema as import('zod').ZodObject<any>).shape,
      async (args: Record<string, unknown>) => {
        const ctx = contextRef.current;
        if (!ctx) {
          log.warn(`Tool ${toolName} called with no context — tick not active`);
          return {
            content: [{ type: 'text' as const, text: 'Tool unavailable: no active tick context.' }],
            isError: true,
          };
        }

        log.info(`Mind tool call: ${toolName}`);
        const result: ToolResult = await executeTool(toolName, args, ctx);
        return result;
      },
    );

    sdkTools.push(sdkTool);
    // Claude SDK prefixes MCP tool names as "mcp__<server>__<tool>"
    allowedTools.push(`mcp__animus__${toolName}`);
  }

  const server = sdk.createSdkMcpServer({
    name: 'animus',
    version: '1.0.0',
    tools: sdkTools,
  });

  return {
    serverConfig: server as unknown as Record<string, unknown>,
    allowedTools,
  };
}

/**
 * Build an in-process MCP server for sub-agent sessions.
 *
 * Uses the sub-agent tool set (filtered by contact permission tier).
 * Tools like `run_with_credentials` resolve credentials directly from the
 * plugin manager singleton, so they don't need the mutable tick context.
 *
 * A minimal stub context is provided for tools that require one (e.g.,
 * send_message, read_memory). The caller should populate contactId,
 * sourceChannel, etc. before spawning.
 */
export async function buildSubAgentMcpServer(
  tier: PermissionTier,
  contextRef: MutableToolContext,
): Promise<{
  serverConfig: Record<string, unknown>;
  allowedTools: string[];
}> {
  const sdk = await import('@anthropic-ai/claude-agent-sdk');

  const toolNames = getAllowedTools(tier);
  const sdkTools: Array<ReturnType<typeof sdk.tool>> = [];
  const allowedTools: string[] = [];

  for (const toolName of toolNames) {
    const def = ANIMUS_TOOL_DEFS[toolName];

    const sdkTool = sdk.tool(
      toolName,
      def.description,
      (def.inputSchema as import('zod').ZodObject<any>).shape,
      async (args: Record<string, unknown>) => {
        const ctx = contextRef.current;
        if (!ctx) {
          log.warn(`Sub-agent tool ${toolName} called with no context`);
          return {
            content: [{ type: 'text' as const, text: 'Tool unavailable: no active context.' }],
            isError: true,
          };
        }

        log.info(`Sub-agent tool call: ${toolName}`);
        const result: ToolResult = await executeTool(toolName, args, ctx);
        return result;
      },
    );

    sdkTools.push(sdkTool);
    allowedTools.push(`mcp__animus__${toolName}`);
  }

  const server = sdk.createSdkMcpServer({
    name: 'animus',
    version: '1.0.0',
    tools: sdkTools,
  });

  return {
    serverConfig: server as unknown as Record<string, unknown>,
    allowedTools,
  };
}
