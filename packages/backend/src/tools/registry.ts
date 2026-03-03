/**
 * Tool Registry — combines definitions with handlers.
 *
 * The registry is the single place where tool definitions (from @animus-labs/shared)
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
} from '@animus-labs/shared';
import type { AnimusTool, ToolHandlerContext, ToolResult } from './types.js';
import { sendMessageHandler } from './handlers/send-message.js';
import { updateProgressHandler } from './handlers/update-progress.js';
import { readMemoryHandler } from './handlers/read-memory.js';
import { lookupContactsHandler } from './handlers/lookup-contacts.js';
import { sendProactiveMessageHandler } from './handlers/send-proactive-message.js';
import { sendMediaHandler } from './handlers/send-media.js';
import { runWithCredentialsHandler } from './handlers/run-with-credentials.js';
import { listVaultEntriesHandler } from './handlers/list-vault-entries.js';
import { resolveToolApprovalHandler } from './handlers/resolve-tool-approval.js';
import { transcribeAudioHandler } from './handlers/transcribe-audio.js';
import { generateSpeechHandler } from './handlers/generate-speech.js';
import { sendVoiceReplyHandler } from './handlers/send-voice-reply.js';
import { getSystemDb, getHeartbeatDb } from '../db/index.js';
import {
  getToolPermission,
  incrementToolUsage,
} from '../db/stores/system-store.js';
import {
  getActiveApproval,
  getPendingApprovals,
  createApprovalRequest,
  consumeApproval,
} from '../db/stores/heartbeat-store.js';
import { getHeartbeatState } from '../db/stores/heartbeat-store.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('ToolRegistry', 'heartbeat');

/**
 * Tools that bypass the permission gate entirely.
 * - resolve_tool_approval: must always work so the user can respond to approval requests
 * - send_message: primary communication channel, blocking it would break agent UX
 * - Cognitive tools (record_thought, record_cognitive_state) would also go here
 *   if/when they are registered as Animus tools.
 */
const PERMISSION_EXEMPT_TOOLS = new Set<string>([
  'resolve_tool_approval',
  'send_message',
]);

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
  list_vault_entries: {
    name: 'list_vault_entries',
    description: ANIMUS_TOOL_DEFS.list_vault_entries.description,
    inputSchema: ANIMUS_TOOL_DEFS.list_vault_entries.inputSchema,
    category: ANIMUS_TOOL_DEFS.list_vault_entries.category,
    handler: listVaultEntriesHandler,
  },
  resolve_tool_approval: {
    name: 'resolve_tool_approval',
    description: ANIMUS_TOOL_DEFS.resolve_tool_approval.description,
    inputSchema: ANIMUS_TOOL_DEFS.resolve_tool_approval.inputSchema,
    category: ANIMUS_TOOL_DEFS.resolve_tool_approval.category,
    handler: resolveToolApprovalHandler,
  },
  transcribe_audio: {
    name: 'transcribe_audio',
    description: ANIMUS_TOOL_DEFS.transcribe_audio.description,
    inputSchema: ANIMUS_TOOL_DEFS.transcribe_audio.inputSchema,
    category: ANIMUS_TOOL_DEFS.transcribe_audio.category,
    handler: transcribeAudioHandler,
  },
  generate_speech: {
    name: 'generate_speech',
    description: ANIMUS_TOOL_DEFS.generate_speech.description,
    inputSchema: ANIMUS_TOOL_DEFS.generate_speech.inputSchema,
    category: ANIMUS_TOOL_DEFS.generate_speech.category,
    handler: generateSpeechHandler,
  },
  send_voice_reply: {
    name: 'send_voice_reply',
    description: ANIMUS_TOOL_DEFS.send_voice_reply.description,
    inputSchema: ANIMUS_TOOL_DEFS.send_voice_reply.inputSchema,
    category: ANIMUS_TOOL_DEFS.send_voice_reply.category,
    handler: sendVoiceReplyHandler,
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
 * Check tool permission before execution.
 *
 * Returns null if the tool is allowed to proceed, or a ToolResult
 * error if it should be blocked (disabled or pending approval).
 */
async function checkToolPermission(
  name: AnimusToolName,
  input: unknown,
  context: ToolHandlerContext
): Promise<ToolResult | null> {
  // Exempt tools always pass
  if (PERMISSION_EXEMPT_TOOLS.has(name)) {
    return null;
  }

  let systemDb: ReturnType<typeof getSystemDb>;
  try {
    systemDb = getSystemDb();
  } catch {
    // DB not initialized (e.g. in tests) — allow through
    return null;
  }
  const permission = getToolPermission(systemDb, name);

  // No permission record means the tool hasn't been registered in the
  // permissions table yet — allow it to proceed (seeder will catch up).
  if (!permission) {
    return null;
  }

  // Off = disabled entirely
  if (permission.mode === 'off') {
    return {
      content: [{ type: 'text', text: 'This tool is disabled by the user.' }],
      isError: true,
    };
  }

  // Always allow = no gate
  if (permission.mode === 'always_allow') {
    return null;
  }

  // Mode is 'ask' — check for existing approvals
  const heartbeatDb = getHeartbeatDb();
  const contactId = context.contactId;

  // Check for an active approved record
  const activeApproval = getActiveApproval(heartbeatDb, name, contactId);
  if (activeApproval) {
    // Consume the one-time approval
    consumeApproval(heartbeatDb, activeApproval.id);
    log.info(`Consumed one-time approval ${activeApproval.id} for tool "${name}"`);
    return null;
  }

  // Check if there's already a pending request for this tool + contact
  const pendingRequests = getPendingApprovals(heartbeatDb, contactId);
  const existingPending = pendingRequests.find((r) => r.toolName === name);
  if (existingPending) {
    // Don't create a duplicate — just return the blocking message
    return {
      content: [{
        type: 'text',
        text: `Tool "${permission.displayName}" requires user approval before it can run.\n` +
          'Please explain to the user what you want to do with this tool and why.\n' +
          'The system will present them with an approval request.\n' +
          'Do NOT attempt to call this tool again until the user has responded.',
      }],
      isError: true,
    };
  }

  // No active approval and no pending request — create one
  const heartbeatState = getHeartbeatState(heartbeatDb);
  const approvalRequest = createApprovalRequest(heartbeatDb, {
    toolName: name,
    toolSource: permission.toolSource,
    contactId,
    channel: context.sourceChannel,
    tickNumber: heartbeatState.tickNumber,
    agentContext: {
      taskDescription: `Tool "${name}" invoked during tick ${heartbeatState.tickNumber}`,
      conversationSummary: `Conversation ${context.conversationId}`,
      pendingAction: `Execute tool "${name}" with provided input`,
    },
    toolInput: input as Record<string, unknown> | null,
    triggerSummary: `Agent wants to use "${permission.displayName}"`,
    conversationId: context.conversationId,
    originatingAgent: 'mind',
  });

  // Emit event for real-time UI updates
  context.eventBus.emit('tool:approval_requested', approvalRequest);

  log.info(`Created approval request ${approvalRequest.id} for tool "${name}"`);

  return {
    content: [{
      type: 'text',
      text: `Tool "${permission.displayName}" requires user approval before it can run.\n` +
        'Please explain to the user what you want to do with this tool and why.\n' +
        'The system will present them with an approval request.\n' +
        'Do NOT attempt to call this tool again until the user has responded.',
    }],
    isError: true,
  };
}

/**
 * Execute a tool by name with the given input and context.
 * Validates input against the tool's Zod schema before execution.
 * Checks tool permissions before allowing execution.
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
    // Check permission gate
    const permissionResult = await checkToolPermission(name, input, context);
    if (permissionResult) {
      return permissionResult;
    }

    // Validate input against schema
    const schema = tool.inputSchema as import('zod').ZodTypeAny;
    const validated = schema.parse(input);

    // Execute handler with validated input
    const result = await tool.handler(validated, context);

    // Track usage on successful execution (non-error result)
    if (!result.isError && !PERMISSION_EXEMPT_TOOLS.has(name)) {
      try {
        incrementToolUsage(getSystemDb(), name);
      } catch (err) {
        // Non-critical — don't fail the tool over usage tracking
        log.warn(`Failed to increment usage for tool "${name}":`, err);
      }
    }

    return result;
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Tool error: ${String(error)}` }],
      isError: true,
    };
  }
}
