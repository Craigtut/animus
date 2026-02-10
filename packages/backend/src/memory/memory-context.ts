/**
 * Memory Context — builds memory sections for the mind's context.
 *
 * Formats working memory, core self, and relevant long-term memories
 * into prompt sections.
 */

import type { MemoryManager, ScoredMemory } from './memory-manager.js';
import { DecayEngine } from '@animus/shared';

export interface MemoryContext {
  workingMemorySection: string | null;
  coreSelfSection: string | null;
  longTermMemorySection: string | null;
  tokenEstimate: number;
}

/**
 * Build memory context for a tick.
 */
export async function buildMemoryContext(
  manager: MemoryManager,
  contactId: string | null,
  query: string | null,
  tokenBudget: number = 2000,
): Promise<MemoryContext> {
  let tokenEstimate = 0;

  // 1. Working memory for current contact
  let workingMemorySection: string | null = null;
  if (contactId) {
    const wm = manager.getWorkingMemory(contactId);
    if (wm && wm.content.trim()) {
      workingMemorySection = wm.content;
      tokenEstimate += wm.tokenCount;
    }
  }

  // 2. Core self
  let coreSelfSection: string | null = null;
  const coreSelf = manager.getCoreSelf();
  if (coreSelf && coreSelf.content.trim()) {
    coreSelfSection = coreSelf.content;
    tokenEstimate += coreSelf.tokenCount;
  }

  // 3. Long-term memories (retrieved via semantic search)
  let longTermMemorySection: string | null = null;
  if (query && tokenEstimate < tokenBudget) {
    const remainingBudget = tokenBudget - tokenEstimate;
    const maxMemories = Math.min(10, Math.floor(remainingBudget / 50)); // ~50 tokens per memory

    if (maxMemories > 0) {
      const memories = await manager.retrieveRelevant(query, maxMemories);
      if (memories.length > 0) {
        longTermMemorySection = formatLongTermMemories(memories);
        tokenEstimate += Math.ceil(longTermMemorySection.split(/\s+/).length * 1.3);
      }
    }
  }

  return { workingMemorySection, coreSelfSection, longTermMemorySection, tokenEstimate };
}

function formatLongTermMemories(memories: ScoredMemory[]): string {
  const lines = memories.map((m) => {
    const age = formatAge(m.lastAccessedAt);
    return `- ${m.content} (${age})`;
  });
  return lines.join('\n');
}

function formatAge(timestamp: string): string {
  const hours = DecayEngine.hoursSince(timestamp);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}
