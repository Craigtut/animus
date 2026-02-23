/**
 * update_progress handler — reports progress back to the orchestrator.
 *
 * Updates the current_activity field so the mind knows
 * what the sub-agent is working on.
 */

import type { z } from 'zod';
import type { ToolHandler, ToolResult } from '../types.js';
import { updateProgressDef } from '@animus-labs/shared';

type UpdateProgressInput = z.infer<typeof updateProgressDef.inputSchema>;

export const updateProgressHandler: ToolHandler<UpdateProgressInput> = async (
  input,
  context
): Promise<ToolResult> => {
  // Update current_activity in agent_tasks (if store supports it)
  if (context.stores.heartbeat.updateAgentTaskProgress) {
    context.stores.heartbeat.updateAgentTaskProgress(
      context.agentTaskId,
      input.activity,
      input.percentComplete
    );
  }

  // Emit event for real-time UI updates
  context.eventBus.emit('agent:spawned', {
    taskId: context.agentTaskId,
    provider: input.activity,
  });

  return {
    content: [
      {
        type: 'text',
        text: 'Progress updated.',
      },
    ],
  };
};
