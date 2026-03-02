/**
 * Tool Handler Types
 *
 * Handler interface for Animus MCP tools. Handlers live in the backend
 * because they need access to databases, event bus, and other infrastructure.
 *
 * See docs/architecture/mcp-tools.md
 */

import type { AnimusToolName, ChannelType, Contact, ContactChannel } from '@animus-labs/shared';
import type { IEventBus } from '@animus-labs/shared';

/**
 * Context provided to every tool handler invocation.
 * Populated by the orchestrator when setting up MCP servers for a session.
 */
export interface ToolHandlerContext {
  /** The agent task ID that owns this session */
  agentTaskId: string;

  /** Contact who triggered the task */
  contactId: string;

  /** Channel the original message came from */
  sourceChannel: string;

  /** Conversation ID for message threading */
  conversationId: string;

  /** Database stores for reading/writing */
  stores: {
    messages: {
      createMessage(data: {
        conversationId: string;
        contactId: string;
        direction: 'outbound';
        channel: string;
        content: string;
        tickNumber?: number | null;
        deliveryStatus?: 'pending' | 'sent' | 'failed';
      }): { id: string };
    };
    heartbeat: {
      updateAgentTaskProgress?(
        taskId: string,
        activity: string,
        percentComplete?: number
      ): void;
    };
    memory: {
      retrieveRelevant(
        query: string,
        limit?: number
      ): Promise<
        Array<{
          content: string;
          memoryType: string;
          importance: number;
        }>
      >;
    };
    /** Contact store — only provided in mind context (not sub-agents). */
    contacts?: {
      getContact(id: string): Contact | null;
      listContacts(): Contact[];
      getContactChannels(contactId: string): ContactChannel[];
    };
    /** Channel router — only provided in mind context (not sub-agents). */
    channels?: {
      sendOutbound(params: {
        contactId: string;
        channel: ChannelType;
        content: string;
        media?: Array<{ type: 'image' | 'audio' | 'video' | 'file'; path: string; filename?: string }>;
        /** Override content sent to the channel adapter. DB always stores `content`. */
        channelContent?: string;
      }): Promise<{ id: string } | null>;
    };
  };

  /** Event bus for emitting real-time events */
  eventBus: IEventBus;
}

/**
 * MCP-compatible tool result.
 */
export interface ToolResult {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
}

/**
 * A tool handler function.
 */
export type ToolHandler<TInput = unknown> = (
  input: TInput,
  context: ToolHandlerContext
) => Promise<ToolResult>;

/**
 * A complete tool: definition + handler, ready for registration.
 */
export interface AnimusTool {
  name: AnimusToolName;
  description: string;
  inputSchema: unknown; // Zod schema
  category: 'messaging' | 'memory' | 'progress' | 'system' | 'speech';
  handler: ToolHandler;
}
