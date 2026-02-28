import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before dynamic import of the subsystem
// ---------------------------------------------------------------------------

const mockDb = {} as any;

vi.mock('../../src/db/index.js', () => ({
  getHeartbeatDb: () => mockDb,
}));

const mockGetGoal = vi.fn();
const mockGetPlan = vi.fn();

vi.mock('../../src/db/stores/heartbeat-store.js', () => ({
  getGoal: (...args: any[]) => mockGetGoal(...args),
  getPlan: (...args: any[]) => mockGetPlan(...args),
}));

const mockSetTaskDueHandler = vi.fn();
const mockStart = vi.fn();
const mockStop = vi.fn();

vi.mock('../../src/tasks/task-scheduler.js', () => ({
  getTaskScheduler: () => ({
    setTaskDueHandler: mockSetTaskDueHandler,
    start: mockStart,
    stop: mockStop,
  }),
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
const { TaskSubsystem } = await import('../../src/tasks/task-subsystem.js');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TaskSubsystem', () => {
  let subsystem: InstanceType<typeof TaskSubsystem>;
  const onScheduledTask = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    subsystem = new TaskSubsystem(onScheduledTask);
  });

  it('has name "tasks" and no dependsOn', () => {
    expect(subsystem.name).toBe('tasks');
    expect(subsystem.dependsOn).toBeUndefined();
  });

  describe('start()', () => {
    it('calls setTaskDueHandler on the scheduler', async () => {
      await subsystem.start();

      expect(mockSetTaskDueHandler).toHaveBeenCalledOnce();
      expect(typeof mockSetTaskDueHandler.mock.calls[0][0]).toBe('function');
    });

    it('calls start on the scheduler', async () => {
      await subsystem.start();

      expect(mockStart).toHaveBeenCalledOnce();
    });

    it('registers a handler that calls onScheduledTask with basic task params', async () => {
      await subsystem.start();

      const handler = mockSetTaskDueHandler.mock.calls[0][0];

      mockGetGoal.mockReturnValue(null);
      mockGetPlan.mockReturnValue(null);

      handler({
        id: 'task-1',
        title: 'Do something',
        scheduleType: 'one_shot',
        instructions: 'Step by step',
        goalId: null,
        planId: null,
        milestoneIndex: null,
      });

      expect(onScheduledTask).toHaveBeenCalledWith({
        taskId: 'task-1',
        taskTitle: 'Do something',
        taskType: 'one_shot',
        taskInstructions: 'Step by step',
      });
    });

    it('enriches params with goalTitle when goalId is present', async () => {
      await subsystem.start();

      const handler = mockSetTaskDueHandler.mock.calls[0][0];

      mockGetGoal.mockReturnValue({ title: 'Learn music' });
      mockGetPlan.mockReturnValue(null);

      handler({
        id: 'task-2',
        title: 'Practice scales',
        scheduleType: 'recurring',
        instructions: '',
        goalId: 'goal-1',
        planId: null,
        milestoneIndex: null,
      });

      expect(mockGetGoal).toHaveBeenCalledWith(mockDb, 'goal-1');
      expect(onScheduledTask).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-2',
          goalTitle: 'Learn music',
        }),
      );
    });

    it('enriches params with planTitle when planId is present', async () => {
      await subsystem.start();

      const handler = mockSetTaskDueHandler.mock.calls[0][0];

      mockGetGoal.mockReturnValue(null);
      mockGetPlan.mockReturnValue({ strategy: 'Incremental practice' });

      handler({
        id: 'task-3',
        title: 'Run drill',
        scheduleType: 'one_shot',
        instructions: '',
        goalId: null,
        planId: 'plan-1',
        milestoneIndex: null,
      });

      expect(mockGetPlan).toHaveBeenCalledWith(mockDb, 'plan-1');
      expect(onScheduledTask).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-3',
          planTitle: 'Incremental practice',
        }),
      );
    });

    it('enriches params with currentMilestone when plan and milestoneIndex are present', async () => {
      await subsystem.start();

      const handler = mockSetTaskDueHandler.mock.calls[0][0];

      mockGetGoal.mockReturnValue({ title: 'Fitness' });
      mockGetPlan.mockReturnValue({
        strategy: 'Progressive overload',
        milestones: [
          { title: 'Week 1' },
          { title: 'Week 2' },
          { title: 'Week 3' },
        ],
      });

      handler({
        id: 'task-4',
        title: 'Workout session',
        scheduleType: 'recurring',
        instructions: 'Follow plan',
        goalId: 'goal-2',
        planId: 'plan-2',
        milestoneIndex: 1,
      });

      expect(onScheduledTask).toHaveBeenCalledWith({
        taskId: 'task-4',
        taskTitle: 'Workout session',
        taskType: 'recurring',
        taskInstructions: 'Follow plan',
        goalTitle: 'Fitness',
        planTitle: 'Progressive overload',
        currentMilestone: 'Week 2',
      });
    });

    it('omits currentMilestone when milestoneIndex is null', async () => {
      await subsystem.start();

      const handler = mockSetTaskDueHandler.mock.calls[0][0];

      mockGetGoal.mockReturnValue(null);
      mockGetPlan.mockReturnValue({
        strategy: 'Some plan',
        milestones: [{ title: 'M1' }],
      });

      handler({
        id: 'task-5',
        title: 'Generic task',
        scheduleType: 'one_shot',
        instructions: '',
        goalId: null,
        planId: 'plan-3',
        milestoneIndex: null,
      });

      const callArgs = onScheduledTask.mock.calls[0][0];
      expect(callArgs).not.toHaveProperty('currentMilestone');
    });

    it('uses empty string for taskInstructions when instructions is falsy', async () => {
      await subsystem.start();

      const handler = mockSetTaskDueHandler.mock.calls[0][0];

      mockGetGoal.mockReturnValue(null);
      mockGetPlan.mockReturnValue(null);

      handler({
        id: 'task-6',
        title: 'No instructions',
        scheduleType: 'one_shot',
        instructions: undefined,
        goalId: null,
        planId: null,
        milestoneIndex: null,
      });

      expect(onScheduledTask).toHaveBeenCalledWith(
        expect.objectContaining({
          taskInstructions: '',
        }),
      );
    });
  });

  describe('stop()', () => {
    it('calls stop on the scheduler', async () => {
      await subsystem.stop();

      expect(mockStop).toHaveBeenCalledOnce();
    });

    it('does not throw if scheduler stop fails', async () => {
      mockStop.mockImplementationOnce(() => {
        throw new Error('scheduler stop failed');
      });

      await expect(subsystem.stop()).resolves.toBeUndefined();
    });
  });
});
