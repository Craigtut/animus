/**
 * MCP Tool System — exports
 *
 * See docs/architecture/mcp-tools.md
 */

export { getToolsForTier, getTool, getToolNames, executeTool } from './registry.js';
export type { ToolHandlerContext, ToolResult, ToolHandler, AnimusTool } from './types.js';
