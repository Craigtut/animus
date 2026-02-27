/**
 * MCP Tool System — exports
 *
 * See docs/architecture/mcp-tools.md
 */

export { getToolsForTier, getTool, getToolNames, getMindToolRegistry, executeTool } from './registry.js';
export type { ToolHandlerContext, ToolResult, ToolHandler, AnimusTool } from './types.js';
export {
  startBridge,
  stopBridge,
  getBridgePort,
  registerContext,
  unregisterContext,
  updatePermissions,
  updateSubagentTier,
  buildMcpServerConfig,
  getToolDefs,
  type MutableToolContext,
  type ToolPermissionLookup,
  type ToolSet,
  type BridgeToolDef,
} from './servers/mcp-bridge.js';
