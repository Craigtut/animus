import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before dynamic import of the subsystem
// ---------------------------------------------------------------------------

const mockDb = {} as any;

vi.mock('../../src/db/index.js', () => ({
  getMemoryDb: () => mockDb,
}));

vi.mock('../../src/utils/env.js', () => ({
  LANCEDB_PATH: '/tmp/test-lance',
}));

const mockInitialize = vi.fn();
vi.mock('../../src/memory/embedding-provider.js', () => ({
  LocalEmbeddingProvider: class MockLocalEmbeddingProvider {
    dimensions = 384;
  },
}));

vi.mock('../../src/memory/vector-store.js', () => ({
  VectorStore: class MockVectorStore {
    initialize = mockInitialize;
    constructor(public path: string, public dims: number) {}
  },
}));

vi.mock('../../src/memory/memory-manager.js', () => ({
  MemoryManager: class MockMemoryManager {
    constructor(public db: any, public vs: any, public ep: any) {}
  },
}));

vi.mock('../../src/lib/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Dynamic import after mocks are in place
const { MemorySubsystem } = await import('../../src/memory/memory-subsystem.js');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MemorySubsystem', () => {
  let subsystem: InstanceType<typeof MemorySubsystem>;

  beforeEach(() => {
    vi.clearAllMocks();
    subsystem = new MemorySubsystem();
  });

  it('has name "memory" and no dependsOn', () => {
    expect(subsystem.name).toBe('memory');
    expect(subsystem.dependsOn).toBeUndefined();
  });

  it('starts with null references', () => {
    expect(subsystem.embeddingProvider).toBeNull();
    expect(subsystem.vectorStore).toBeNull();
    expect(subsystem.memoryManager).toBeNull();
  });

  describe('start()', () => {
    it('creates embeddingProvider, vectorStore, and memoryManager', async () => {
      await subsystem.start();

      expect(subsystem.embeddingProvider).not.toBeNull();
      expect(subsystem.vectorStore).not.toBeNull();
      expect(subsystem.memoryManager).not.toBeNull();
    });

    it('calls vectorStore.initialize()', async () => {
      await subsystem.start();

      expect(mockInitialize).toHaveBeenCalledOnce();
    });

    it('creates VectorStore with LANCEDB_PATH and embedding dimensions', async () => {
      await subsystem.start();

      expect(subsystem.vectorStore).toHaveProperty('path', '/tmp/test-lance');
      expect(subsystem.vectorStore).toHaveProperty('dims', 384);
    });

    it('creates MemoryManager with the correct dependencies', async () => {
      await subsystem.start();

      // The mock MemoryManager stores constructor args as properties
      const mm = subsystem.memoryManager as any;
      expect(mm.db).toBe(mockDb);
      expect(mm.vs).toBe(subsystem.vectorStore);
      expect(mm.ep).toBe(subsystem.embeddingProvider);
    });
  });

  describe('stop()', () => {
    it('nulls out all references', async () => {
      await subsystem.start();
      expect(subsystem.embeddingProvider).not.toBeNull();

      await subsystem.stop();

      expect(subsystem.embeddingProvider).toBeNull();
      expect(subsystem.vectorStore).toBeNull();
      expect(subsystem.memoryManager).toBeNull();
    });
  });

  describe('healthCheck()', () => {
    it('returns "failed" before start', () => {
      const health = subsystem.healthCheck();

      expect(health.status).toBe('failed');
      expect(health.detail).toBe('Memory system not available');
    });

    it('returns "running" after start', async () => {
      await subsystem.start();

      const health = subsystem.healthCheck();

      expect(health.status).toBe('running');
      expect(health.detail).toBe('Memory system active');
    });

    it('returns "failed" after stop', async () => {
      await subsystem.start();
      await subsystem.stop();

      const health = subsystem.healthCheck();

      expect(health.status).toBe('failed');
      expect(health.detail).toBe('Memory system not available');
    });
  });
});
