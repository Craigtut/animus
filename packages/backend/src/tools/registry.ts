/**
 * Tool Registry — combines definitions with handlers.
 *
 * The registry is the single place where tool definitions (from @animus/shared)
 * are married to their handler implementations (from the backend).
 *
 * See docs/architecture/mcp-tools.md
 */

import {
  ANIMUS_TOOL_DEFS,
  MIND_TOOL_NAMES,
  getAllowedTools,
  type AnimusToolName,
  type PermissionTier,
} from '@animus/shared';
import type { AnimusTool, ToolHandlerContext, ToolResult } from './types.js';
import { sendMessageHandler } from './handlers/send-message.js';
import { updateProgressHandler } from './handlers/update-progress.js';
import { readMemoryHandler } from './handlers/read-memory.js';
import { lookupContactsHandler } from './handlers/lookup-contacts.js';
import { sendProactiveMessageHandler } from './handlers/send-proactive-message.js';
import { sendMediaHandler } from './handlers/send-media.js';
import { runWithCredentialsHandler } from './handlers/run-with-credentials.js';

/**
 * The complete tool registry: definitions + handlers.
 */
const TOOL_REGISTRY: Record<AnimusToolName, AnimusTool> = {
  send_message: {
    name: 'send_message',
    description: ANIMUS_TOOL_DEFS.send_message.description,
    inputSchema: ANIMUS_TOOL_DEFS.send_message.inputSchema,
    category: ANIMUS_TOOL_DEFS.send_message.category,
    handler: sendMessageHandler,
  },
  update_progress: {
    name: 'update_progress',
    description: ANIMUS_TOOL_DEFS.update_progress.description,
    inputSchema: ANIMUS_TOOL_DEFS.update_progress.inputSchema,
    category: ANIMUS_TOOL_DEFS.update_progress.category,
    handler: updateProgressHandler,
  },
  read_memory: {
    name: 'read_memory',
    description: ANIMUS_TOOL_DEFS.read_memory.description,
    inputSchema: ANIMUS_TOOL_DEFS.read_memory.inputSchema,
    category: ANIMUS_TOOL_DEFS.read_memory.category,
    handler: readMemoryHandler,
  },
  lookup_contacts: {
    name: 'lookup_contacts',
    description: ANIMUS_TOOL_DEFS.lookup_contacts.description,
    inputSchema: ANIMUS_TOOL_DEFS.lookup_contacts.inputSchema,
    category: ANIMUS_TOOL_DEFS.lookup_contacts.category,
    handler: lookupContactsHandler,
  },
  send_proactive_message: {
    name: 'send_proactive_message',
    description: ANIMUS_TOOL_DEFS.send_proactive_message.description,
    inputSchema: ANIMUS_TOOL_DEFS.send_proactive_message.inputSchema,
    category: ANIMUS_TOOL_DEFS.send_proactive_message.category,
    handler: sendProactiveMessageHandler,
  },
  send_media: {
    name: 'send_media',
    description: ANIMUS_TOOL_DEFS.send_media.description,
    inputSchema: ANIMUS_TOOL_DEFS.send_media.inputSchema,
    category: ANIMUS_TOOL_DEFS.send_media.category,
    handler: sendMediaHandler,
  },
  run_with_credentials: {
    name: 'run_with_credentials',
    description: ANIMUS_TOOL_DEFS.run_with_credentials.description,
    inputSchema: ANIMUS_TOOL_DEFS.run_with_credentials.inputSchema,
    category: ANIMUS_TOOL_DEFS.run_with_credentials.category,
    handler: runWithCredentialsHandler,
  },
};

/**
 * Get tools filtered by contact permission tier.
 */
export function getToolsForTier(tier: PermissionTier): AnimusTool[] {
  const allowedNames = getAllowedTools(tier);
  return allowedNames.map((name) => TOOL_REGISTRY[name]);
}

/**
 * Get a specific tool by name.
 */
export function getTool(name: AnimusToolName): AnimusTool | undefined {
  return TOOL_REGISTRY[name];
}

/**
 * Get all registered tool names.
 */
export function getToolNames(): AnimusToolName[] {
  return Object.keys(TOOL_REGISTRY) as AnimusToolName[];
}

/**
 * Get the tools available to the mind session.
 */
export function getMindToolRegistry(): AnimusTool[] {
  return MIND_TOOL_NAMES.map((name) => TOOL_REGISTRY[name]);
}

/**
 * Execute a tool by name with the given input and context.
 * Validates input against the tool's Zod schema before execution.
 */
export async function executeTool(
  name: AnimusToolName,
  input: unknown,
  context: ToolHandlerContext
): Promise<ToolResult> {
  const tool = TOOL_REGISTRY[name];
  if (!tool) {
    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  try {
    // Validate input against schema
    const schema = tool.inputSchema as import('zod').ZodTypeAny;
    const validated = schema.parse(input);

    // Execute handler with validated input
    return await tool.handler(validated, context);
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Tool error: ${String(error)}` }],
      isError: true,
    };
  }
}
