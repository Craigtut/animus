/**
 * MCP Tool System — exports
 *
 * See docs/architecture/mcp-tools.md
 */

export { getToolsForTier, getTool, getToolNames, getMindToolRegistry, executeTool } from './registry.js';
export type { ToolHandlerContext, ToolResult, ToolHandler, AnimusTool } from './types.js';
export { buildMindMcpServer, buildSubAgentMcpServer, type MutableToolContext, type ToolPermissionLookup } from './servers/claude-mcp.js';
