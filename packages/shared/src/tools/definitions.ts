/**
 * Tool Definitions — pure data structures for Animus tools.
 *
 * No handlers, no side effects, no dependencies on backend infrastructure.
 * Both the backend (which implements handlers) and the frontend
 * (which may display available tools in the UI) need access to these.
 *
 * See docs/architecture/mcp-tools.md
 */

import { z } from 'zod';

/**
 * A tool definition without a handler.
 * Pure declaration of what the tool does and what input it expects.
 */
export interface AnimusToolDef<TInput extends z.ZodTypeAny = z.ZodTypeAny> {
  /** Unique tool name (e.g., 'send_message') */
  name: string;

  /** Human-readable description for the LLM */
  description: string;

  /** Zod schema for input validation */
  inputSchema: TInput;

  /**
   * Tool category for UI grouping and permission logic.
   */
  category: 'messaging' | 'memory' | 'progress' | 'system';
}

/**
 * send_message - Send a message to the triggering contact via the originating channel.
 */
export const sendMessageDef: AnimusToolDef = {
  name: 'send_message',
  description:
    'Send a message to the user who triggered this task. The message will be delivered through the same channel they used (SMS, Discord, web, etc.). Use this for progress updates, clarifying questions, or sharing intermediate findings. You speak as Animus.',
  inputSchema: z.object({
    content: z.string().describe('The message content to send to the user'),
    priority: z
      .enum(['normal', 'urgent'])
      .default('normal')
      .describe(
        'Message priority. Use "urgent" only for time-sensitive information'
      ),
  }),
  category: 'messaging',
};

/**
 * update_progress - Report progress back to the orchestrator.
 */
export const updateProgressDef: AnimusToolDef = {
  name: 'update_progress',
  description:
    'Report your current progress on the task. This helps Animus track what you are working on and can inform the user if they ask about task status. Call this periodically during long tasks.',
  inputSchema: z.object({
    activity: z
      .string()
      .describe('Brief description of what you are currently doing'),
    percentComplete: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .describe('Estimated percentage complete (0-100), if estimable'),
  }),
  category: 'progress',
};

/**
 * read_memory - Access Animus's long-term memory (LanceDB). Read-only.
 */
export const readMemoryDef: AnimusToolDef = {
  name: 'read_memory',
  description:
    "Search Animus's long-term memory for relevant information. Returns memories ranked by relevance to your query. Use this to recall facts, past experiences, procedures, or outcomes that might help with the current task.",
  inputSchema: z.object({
    query: z
      .string()
      .describe(
        'Natural language search query describing what you want to recall'
      ),
    limit: z
      .number()
      .min(1)
      .max(20)
      .default(5)
      .describe('Maximum number of memories to return'),
    types: z
      .array(z.enum(['fact', 'experience', 'procedure', 'outcome']))
      .optional()
      .describe('Filter by memory type. Omit to search all types'),
  }),
  category: 'memory',
};

/**
 * Central registry of all Animus tool definitions.
 * This is the single source of truth for what tools exist.
 * Handlers are attached separately in the backend.
 */
export const ANIMUS_TOOL_DEFS = {
  send_message: sendMessageDef,
  update_progress: updateProgressDef,
  read_memory: readMemoryDef,
} as const;

export type AnimusToolName = keyof typeof ANIMUS_TOOL_DEFS;
