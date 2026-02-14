/**
 * Memory Manager — coordinates all 4 memory layers.
 *
 * - Short-term: loaded from heartbeat.db (thoughts, experiences, messages)
 * - Working memory: per-contact notepad (memory.db)
 * - Core self: singleton agent self-knowledge (memory.db)
 * - Long-term: extracted knowledge with vector search (memory.db + LanceDB)
 *
 * See docs/architecture/memory.md
 */

import type Database from 'better-sqlite3';
import { DecayEngine } from '@animus/shared';
import type { IEmbeddingProvider, LongTermMemory, MemoryType, MemorySourceType } from '@animus/shared';
import * as memoryStore from '../db/stores/memory-store.js';
import type { VectorStore, SearchResult } from './vector-store.js';
import { getEventBus } from '../lib/event-bus.js';

// ============================================================================
// Constants (from docs/architecture/memory.md)
// ============================================================================

export const MEMORY_DEDUP_THRESHOLD = 0.9;
export const MEMORY_SKIP_THRESHOLD = 0.95;
export const MEMORY_RETRIEVAL_LIMIT = 10;
export const MEMORY_RELEVANCE_THRESHOLD = 0.3;
export const BASE_MEMORY_HALF_LIFE = 720;
export const MEMORY_PRUNE_RETENTION_THRESHOLD = 0.1;
export const MEMORY_PRUNE_IMPORTANCE_FLOOR = 0.3;
export const MEMORY_CORE_IMPORTANCE_FLOOR = 0.7;
export const AUTO_PROMOTE_IMPORTANCE_THRESHOLD = 0.7;
export const WORKING_MEMORY_TOKEN_CAP = 2000;
export const CORE_SELF_TOKEN_CAP = 2000;

// ============================================================================
// Types
// ============================================================================

export interface MemoryCandidate {
  content: string;
  memoryType: MemoryType;
  importance: number;
  sourceType?: MemorySourceType;
  sourceId?: string;
  contactId?: string;
  keywords?: string[];
}

export interface ScoredMemory extends LongTermMemory {
  relevance: number;
  recency: number;
  score: number;
}

// ============================================================================
// Memory Manager
// ============================================================================

export class MemoryManager {
  constructor(
    private readonly memoryDb: Database.Database,
    private readonly vectorStore: VectorStore,
    private readonly embeddingProvider: IEmbeddingProvider,
  ) {}

  // --------------------------------------------------------------------------
  // Working Memory
  // --------------------------------------------------------------------------

  getWorkingMemory(contactId: string) {
    return memoryStore.getWorkingMemory(this.memoryDb, contactId);
  }

  updateWorkingMemory(contactId: string, content: string): void {
    const tokenCount = Math.ceil(content.split(/\s+/).filter(Boolean).length * 1.3);
    const cappedContent = tokenCount > WORKING_MEMORY_TOKEN_CAP
      ? content.slice(0, Math.floor(content.length * (WORKING_MEMORY_TOKEN_CAP / tokenCount)))
      : content;
    const cappedTokens = Math.min(tokenCount, WORKING_MEMORY_TOKEN_CAP);
    memoryStore.upsertWorkingMemory(this.memoryDb, contactId, cappedContent, cappedTokens);
    getEventBus().emit('memory:working_updated', { contactId });
  }

  // --------------------------------------------------------------------------
  // Core Self
  // --------------------------------------------------------------------------

  getCoreSelf() {
    return memoryStore.getCoreSelf(this.memoryDb);
  }

  updateCoreSelf(content: string): void {
    const tokenCount = Math.ceil(content.split(/\s+/).filter(Boolean).length * 1.3);
    const cappedContent = tokenCount > CORE_SELF_TOKEN_CAP
      ? content.slice(0, Math.floor(content.length * (CORE_SELF_TOKEN_CAP / tokenCount)))
      : content;
    const cappedTokens = Math.min(tokenCount, CORE_SELF_TOKEN_CAP);
    memoryStore.upsertCoreSelf(this.memoryDb, cappedContent, cappedTokens);
    getEventBus().emit('memory:core_updated', {} as Record<string, never>);
  }

  // --------------------------------------------------------------------------
  // Long-Term Memory: Write Pipeline
  // --------------------------------------------------------------------------

  /**
   * Store a memory through the write pipeline: embed → dedup → store.
   */
  async storeMemory(candidate: MemoryCandidate): Promise<LongTermMemory | null> {
    // 1. Generate embedding
    const embedding = await this.embeddingProvider.embedSingle(candidate.content);

    // 2. Search for similar existing memories (dedup check)
    const similar = await this.vectorStore.search(embedding, 5);

    for (const match of similar) {
      if (match.score > MEMORY_SKIP_THRESHOLD) {
        // Near-duplicate — skip
        return null;
      }
      if (match.score > MEMORY_DEDUP_THRESHOLD) {
        // Similar — update existing memory (bump strength, update timestamp)
        memoryStore.updateMemoryAccess(this.memoryDb, match.id);
        return memoryStore.getLongTermMemory(this.memoryDb, match.id);
      }
    }

    // 3. Genuinely new memory — store in both SQLite and LanceDB
    const memory = memoryStore.insertLongTermMemory(this.memoryDb, {
      content: candidate.content,
      importance: candidate.importance,
      memoryType: candidate.memoryType,
      sourceType: candidate.sourceType ?? null,
      sourceId: candidate.sourceId ?? null,
      contactId: candidate.contactId ?? null,
      ...(candidate.keywords ? { keywords: candidate.keywords } : {}),
    });

    await this.vectorStore.addMemory(memory.id, embedding);
    getEventBus().emit('memory:stored', memory);
    return memory;
  }

  // --------------------------------------------------------------------------
  // Long-Term Memory: Retrieval
  // --------------------------------------------------------------------------

  /**
   * Retrieve relevant long-term memories for a given query.
   * Score formula: 0.4 * relevance + 0.3 * importance + 0.3 * recency
   */
  async retrieveRelevant(query: string, limit: number = MEMORY_RETRIEVAL_LIMIT): Promise<ScoredMemory[]> {
    // 1. Embed the query
    const queryEmbedding = await this.embeddingProvider.embedSingle(query);

    // 2. Vector search
    const searchResults = await this.vectorStore.search(queryEmbedding, limit * 2);

    // 3. Load full memory records and score
    const scored: ScoredMemory[] = [];

    for (const result of searchResults) {
      const memory = memoryStore.getLongTermMemory(this.memoryDb, result.id);
      if (!memory) continue;

      const relevance = Math.max(0, result.score);
      const recency = Math.pow(0.995, DecayEngine.hoursSince(memory.lastAccessedAt));
      const score = 0.4 * relevance + 0.3 * memory.importance + 0.3 * recency;

      if (score < MEMORY_RELEVANCE_THRESHOLD) continue;

      scored.push({ ...memory, relevance, recency, score });
    }

    // 4. Sort by score, take top N
    scored.sort((a, b) => b.score - a.score);
    const topMemories = scored.slice(0, limit);

    // 5. Update access tracking for retrieved memories
    for (const mem of topMemories) {
      memoryStore.updateMemoryAccess(this.memoryDb, mem.id);
    }

    return topMemories;
  }

  // --------------------------------------------------------------------------
  // Long-Term Memory: Forgetting
  // --------------------------------------------------------------------------

  /**
   * Prune decayed memories.
   * retention = e^(-hours / (strength * 720))
   * Prune when retention < 0.1 AND importance < 0.3
   */
  async pruneDecayed(): Promise<number> {
    const allMemories = memoryStore.searchLongTermMemories(this.memoryDb, { limit: 1000 });
    let pruned = 0;

    for (const memory of allMemories) {
      // Never auto-delete core memories
      if (memory.importance >= MEMORY_CORE_IMPORTANCE_FLOOR) continue;

      const elapsedHours = DecayEngine.hoursSince(memory.lastAccessedAt);
      const retention = DecayEngine.computeRetention(memory.strength, elapsedHours);

      if (DecayEngine.shouldPrune(retention, memory.importance)) {
        // Delete from both SQLite and LanceDB
        this.memoryDb.prepare('DELETE FROM long_term_memories WHERE id = ?').run(memory.id);
        await this.vectorStore.deleteMemory(memory.id);
        pruned++;
      }
    }

    if (pruned > 0) getEventBus().emit('memory:pruned', { count: pruned });
    return pruned;
  }

  // --------------------------------------------------------------------------
  // Long-Term Memory: Consolidation (basic dedup)
  // --------------------------------------------------------------------------

  /**
   * Basic consolidation: find near-duplicate memories and merge them.
   * Full LLM-based consolidation is deferred to later.
   */
  async consolidate(): Promise<number> {
    // For now, just run dedup pass by checking all memories
    // A more sophisticated approach would use LLM-based merging
    return 0; // Placeholder — basic dedup happens at write time
  }
}
