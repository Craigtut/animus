/**
 * read_memory handler — searches Animus's long-term memory.
 *
 * Sub-agents can query memories but cannot write them.
 * Only the mind writes memories.
 */

import type { z } from 'zod';
import type { ToolHandler, ToolResult } from '../types.js';
import { readMemoryDef } from '@animus-labs/shared';

type ReadMemoryInput = z.infer<typeof readMemoryDef.inputSchema>;

export const readMemoryHandler: ToolHandler<ReadMemoryInput> = async (
  input,
  context
): Promise<ToolResult> => {
  // Search long-term memories via the memory manager
  const memories = await context.stores.memory.retrieveRelevant(
    input.query,
    input.limit
  );

  // Filter by type if specified
  const filtered = input.types
    ? memories.filter((m) => input.types!.includes(m.memoryType as 'fact' | 'experience' | 'procedure' | 'outcome'))
    : memories;

  if (filtered.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'No relevant memories found for this query.',
        },
      ],
    };
  }

  const formatted = filtered
    .map(
      (m, i) =>
        `[${i + 1}] (${m.memoryType}, importance: ${m.importance.toFixed(2)}) ${m.content}`
    )
    .join('\n\n');

  return {
    content: [
      {
        type: 'text',
        text: `Found ${filtered.length} relevant memories:\n\n${formatted}`,
      },
    ],
  };
};
