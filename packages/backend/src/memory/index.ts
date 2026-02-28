/**
 * Memory System — exports
 */

export { LocalEmbeddingProvider } from './embedding-provider.js';
export { VectorStore } from './vector-store.js';
export type { VectorRecord, SearchResult } from './vector-store.js';
export { MemoryManager, MEMORY_DEDUP_THRESHOLD, MEMORY_SKIP_THRESHOLD, MEMORY_RETRIEVAL_LIMIT, MEMORY_RELEVANCE_THRESHOLD, BASE_MEMORY_HALF_LIFE, MEMORY_PRUNE_RETENTION_THRESHOLD, MEMORY_PRUNE_IMPORTANCE_FLOOR, MEMORY_CORE_IMPORTANCE_FLOOR, AUTO_PROMOTE_IMPORTANCE_THRESHOLD, WORKING_MEMORY_TOKEN_CAP, CORE_SELF_TOKEN_CAP } from './memory-manager.js';
export type { MemoryCandidate, ScoredMemory } from './memory-manager.js';
export { buildMemoryContext } from './memory-context.js';
export type { MemoryContext } from './memory-context.js';
export { MemorySubsystem } from './memory-subsystem.js';
