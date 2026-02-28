/**
 * Memory Subsystem
 *
 * Wraps the initialization of the memory system (embedding provider, vector
 * store, memory manager) into a SubsystemLifecycle so the LifecycleManager
 * can start/stop it independently of the heartbeat.
 */

import type { SubsystemLifecycle, SubsystemHealth } from '../lib/lifecycle.js';
import { createLogger } from '../lib/logger.js';
import { getMemoryDb } from '../db/index.js';
import { LANCEDB_PATH } from '../utils/env.js';
import { LocalEmbeddingProvider } from './embedding-provider.js';
import { VectorStore } from './vector-store.js';
import { MemoryManager } from './memory-manager.js';

const log = createLogger('MemorySubsystem', 'heartbeat');

export class MemorySubsystem implements SubsystemLifecycle {
  readonly name = 'memory';
  embeddingProvider: LocalEmbeddingProvider | null = null;
  vectorStore: VectorStore | null = null;
  memoryManager: MemoryManager | null = null;

  async start(): Promise<void> {
    const memDb = getMemoryDb();
    this.embeddingProvider = new LocalEmbeddingProvider();
    this.vectorStore = new VectorStore(LANCEDB_PATH, this.embeddingProvider.dimensions);
    await this.vectorStore.initialize();
    this.memoryManager = new MemoryManager(memDb, this.vectorStore, this.embeddingProvider);
    log.debug('Memory system initialized');
  }

  async stop(): Promise<void> {
    this.memoryManager = null;
    this.vectorStore = null;
    this.embeddingProvider = null;
  }

  healthCheck(): SubsystemHealth {
    return {
      status: this.memoryManager ? 'running' : 'failed',
      detail: this.memoryManager ? 'Memory system active' : 'Memory system not available',
    };
  }
}
