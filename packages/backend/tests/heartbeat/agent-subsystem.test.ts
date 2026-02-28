import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before dynamic import of the subsystem
// ---------------------------------------------------------------------------

const mockHbDb = {} as any;
const mockSystemDb = {} as any;
const mockAgentLogsDb = {} as any;

vi.mock('../../src/db/index.js', () => ({
  getHeartbeatDb: () => mockHbDb,
  getSystemDb: () => mockSystemDb,
  getAgentLogsDb: () => mockAgentLogsDb,
}));

const mockMarkOrphanedAgentTasks = vi.fn().mockReturnValue(0);
const mockInsertAgentTask = vi.fn();
const mockUpdateAgentTask = vi.fn();
const mockGetAgentTask = vi.fn();
const mockGetRunningAgentTasks = vi.fn().mockReturnValue([]);

vi.mock('../../src/db/stores/heartbeat-store.js', () => ({
  markOrphanedAgentTasks: (...args: any[]) => mockMarkOrphanedAgentTasks(...args),
  insertAgentTask: (...args: any[]) => mockInsertAgentTask(...args),
  updateAgentTask: (...args: any[]) => mockUpdateAgentTask(...args),
  getAgentTask: (...args: any[]) => mockGetAgentTask(...args),
  getRunningAgentTasks: (...args: any[]) => mockGetRunningAgentTasks(...args),
}));

const mockMarkOrphanedSessions = vi.fn().mockReturnValue(0);

vi.mock('../../src/db/stores/agent-log-store.js', () => ({
  markOrphanedSessions: (...args: any[]) => mockMarkOrphanedSessions(...args),
}));

const mockGetSystemSettings = vi.fn().mockReturnValue({});

vi.mock('../../src/db/stores/system-store.js', () => ({
  getSystemSettings: (...args: any[]) => mockGetSystemSettings(...args),
}));

const mockEventBus = {
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
};

vi.mock('../../src/lib/event-bus.js', () => ({
  getEventBus: () => mockEventBus,
}));

const mockCleanupManager = vi.fn().mockResolvedValue(undefined);
const mockGetConfiguredProviders = vi.fn().mockReturnValue(['claude']);
const mockAgentManager = {
  getConfiguredProviders: mockGetConfiguredProviders,
  cleanup: mockCleanupManager,
};

vi.mock('@animus-labs/agents', () => ({
  createAgentManager: vi.fn().mockReturnValue(mockAgentManager),
  attachSessionLogging: vi.fn(),
}));

const mockLogStoreAdapter = {
  createSession: vi.fn(),
  endSession: vi.fn(),
  insertEvent: vi.fn(),
  insertUsage: vi.fn(),
};

vi.mock('../../src/heartbeat/agent-log-adapter.js', () => ({
  createAgentLogStoreAdapter: vi.fn().mockReturnValue(mockLogStoreAdapter),
}));

const mockCleanupOrchestrator = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/heartbeat/agent-orchestrator.js', () => ({
  AgentOrchestrator: class MockAgentOrchestrator {
    cleanup = mockCleanupOrchestrator;
    constructor(public config: any) {}
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
const { AgentSubsystem } = await import('../../src/heartbeat/agent-subsystem.js');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentSubsystem', () => {
  let subsystem: InstanceType<typeof AgentSubsystem>;
  const onAgentComplete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    subsystem = new AgentSubsystem(onAgentComplete);
  });

  it('has name "agents" and no dependsOn', () => {
    expect(subsystem.name).toBe('agents');
    expect(subsystem.dependsOn).toBeUndefined();
  });

  it('starts with null references', () => {
    expect(subsystem.agentManager).toBeNull();
    expect(subsystem.agentLogStoreAdapter).toBeNull();
    expect(subsystem.agentOrchestrator).toBeNull();
  });

  describe('start()', () => {
    it('calls markOrphanedAgentTasks on heartbeat db', async () => {
      await subsystem.start();

      expect(mockMarkOrphanedAgentTasks).toHaveBeenCalledWith(mockHbDb);
    });

    it('creates agentManager via createAgentManager', async () => {
      await subsystem.start();

      expect(subsystem.agentManager).not.toBeNull();
      expect(subsystem.agentManager).toBe(mockAgentManager);
    });

    it('queries configured providers from agentManager', async () => {
      await subsystem.start();

      expect(mockGetConfiguredProviders).toHaveBeenCalled();
    });

    it('creates agentLogStoreAdapter', async () => {
      await subsystem.start();

      expect(subsystem.agentLogStoreAdapter).not.toBeNull();
      expect(subsystem.agentLogStoreAdapter).toBe(mockLogStoreAdapter);
    });

    it('marks orphaned agent log sessions', async () => {
      await subsystem.start();

      expect(mockMarkOrphanedSessions).toHaveBeenCalledWith(mockAgentLogsDb);
    });

    it('creates agentOrchestrator when manager and logStore are available', async () => {
      await subsystem.start();

      expect(subsystem.agentOrchestrator).not.toBeNull();
    });

    it('passes onAgentComplete callback to orchestrator config', async () => {
      await subsystem.start();

      const orchestratorConfig = (subsystem.agentOrchestrator as any).config;
      expect(orchestratorConfig.onAgentComplete).toBe(onAgentComplete);
    });

    it('passes event bus to orchestrator config', async () => {
      await subsystem.start();

      const orchestratorConfig = (subsystem.agentOrchestrator as any).config;
      expect(orchestratorConfig.eventBus).toBe(mockEventBus);
    });

    it('logs orphaned task count when greater than zero', async () => {
      mockMarkOrphanedAgentTasks.mockReturnValueOnce(3);

      await subsystem.start();

      expect(mockMarkOrphanedAgentTasks).toHaveBeenCalledWith(mockHbDb);
    });
  });

  describe('stop()', () => {
    it('calls orchestrator.cleanup() and agentManager.cleanup()', async () => {
      await subsystem.start();

      await subsystem.stop();

      expect(mockCleanupOrchestrator).toHaveBeenCalledOnce();
      expect(mockCleanupManager).toHaveBeenCalledOnce();
    });

    it('nulls all references after stop', async () => {
      await subsystem.start();
      expect(subsystem.agentManager).not.toBeNull();
      expect(subsystem.agentLogStoreAdapter).not.toBeNull();
      expect(subsystem.agentOrchestrator).not.toBeNull();

      await subsystem.stop();

      expect(subsystem.agentManager).toBeNull();
      expect(subsystem.agentLogStoreAdapter).toBeNull();
      expect(subsystem.agentOrchestrator).toBeNull();
    });

    it('is safe to call when nothing was started', async () => {
      await expect(subsystem.stop()).resolves.toBeUndefined();
    });
  });
});
