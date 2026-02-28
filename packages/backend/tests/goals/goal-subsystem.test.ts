import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before dynamic import of the subsystem
// ---------------------------------------------------------------------------

const mockDb = {} as any;

vi.mock('../../src/db/index.js', () => ({
  getHeartbeatDb: () => mockDb,
}));

vi.mock('../../src/goals/goal-manager.js', () => ({
  GoalManager: class MockGoalManager {
    constructor(public db: any) {}
  },
}));

vi.mock('../../src/goals/seed-manager.js', () => ({
  SeedManager: class MockSeedManager {
    constructor(public db: any, public embeddingProvider: any) {}
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
const { GoalSubsystem } = await import('../../src/goals/goal-subsystem.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockMemorySubsystem(embeddingProvider: any = null) {
  return {
    name: 'memory' as const,
    embeddingProvider,
    vectorStore: null,
    memoryManager: null,
    async start() {},
    async stop() {},
    healthCheck() {
      return { status: 'running' as const };
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GoalSubsystem', () => {
  let subsystem: InstanceType<typeof GoalSubsystem>;
  let memorySubsystem: ReturnType<typeof createMockMemorySubsystem>;

  beforeEach(() => {
    vi.clearAllMocks();
    memorySubsystem = createMockMemorySubsystem();
    subsystem = new GoalSubsystem(memorySubsystem as any);
  });

  it('has name "goals" and dependsOn ["memory"]', () => {
    expect(subsystem.name).toBe('goals');
    expect(subsystem.dependsOn).toEqual(['memory']);
  });

  it('starts with null references', () => {
    expect(subsystem.goalManager).toBeNull();
    expect(subsystem.seedManager).toBeNull();
  });

  describe('start()', () => {
    it('creates GoalManager with heartbeat db', async () => {
      await subsystem.start();

      expect(subsystem.goalManager).not.toBeNull();
      expect((subsystem.goalManager as any).db).toBe(mockDb);
    });

    it('creates SeedManager when memorySubsystem has embeddingProvider', async () => {
      const mockEmbeddingProvider = { dimensions: 384 };
      memorySubsystem.embeddingProvider = mockEmbeddingProvider;
      subsystem = new GoalSubsystem(memorySubsystem as any);

      await subsystem.start();

      expect(subsystem.seedManager).not.toBeNull();
      expect((subsystem.seedManager as any).db).toBe(mockDb);
      expect((subsystem.seedManager as any).embeddingProvider).toBe(mockEmbeddingProvider);
    });

    it('skips SeedManager when embeddingProvider is null', async () => {
      memorySubsystem.embeddingProvider = null;

      await subsystem.start();

      expect(subsystem.goalManager).not.toBeNull();
      expect(subsystem.seedManager).toBeNull();
    });
  });

  describe('stop()', () => {
    it('nulls out goalManager and seedManager', async () => {
      memorySubsystem.embeddingProvider = { dimensions: 384 };
      subsystem = new GoalSubsystem(memorySubsystem as any);

      await subsystem.start();
      expect(subsystem.goalManager).not.toBeNull();
      expect(subsystem.seedManager).not.toBeNull();

      await subsystem.stop();

      expect(subsystem.goalManager).toBeNull();
      expect(subsystem.seedManager).toBeNull();
    });

    it('is safe to call even if start was never called', async () => {
      await expect(subsystem.stop()).resolves.toBeUndefined();

      expect(subsystem.goalManager).toBeNull();
      expect(subsystem.seedManager).toBeNull();
    });
  });
});
