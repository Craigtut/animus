/**
 * Tests for the send_reaction decision execution path in the decision executor.
 *
 * Verifies that executeDecisions correctly processes send_reaction decisions
 * by calling the channel manager's performAction with the right parameters,
 * and gracefully handles missing metadata, empty emoji, and undefined channels.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MindOutput, IEventBus } from '@animus/shared';
import { executeDecisions, type DecisionExecutorDeps } from '../../src/heartbeat/decision-executor.js';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('../../src/lib/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const mockPerformAction = vi.fn();

vi.mock('../../src/db/stores/heartbeat-store.js', () => ({
  insertTickDecision: vi.fn(),
}));

// ============================================================================
// Helpers
// ============================================================================

type Decision = MindOutput['decisions'][number];

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    type: 'send_reaction',
    description: 'React with a thumbs up',
    parameters: { emoji: '👍' },
    ...overrides,
  };
}

const deps: DecisionExecutorDeps = {
  agentOrchestrator: null,
  compiledPersona: null,
  seedManager: null,
  goalManager: null,
  buildSystemPrompt: () => '',
  pluginManager: {
    executeDecision: vi.fn(async () => ({ success: true })),
  } as any,
  taskScheduler: {
    registerTask: vi.fn(),
    unregisterTask: vi.fn(),
  } as any,
  taskRunner: {
    completeTask: vi.fn(),
    cancelTask: vi.fn(),
  } as any,
  channelManager: {
    performAction: mockPerformAction,
  } as any,
};

const mockEventBus = {
  emit: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  once: vi.fn(),
} as unknown as IEventBus;

// ============================================================================
// Tests
// ============================================================================

describe('send_reaction decision execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPerformAction.mockResolvedValue(true);
  });

  it('calls performAction with correct add_reaction params', async () => {
    const decisions: Decision[] = [makeDecision()];
    const triggerChannel = 'discord';
    const triggerMetadata = { channelId: 'ch-123', messageId: 'msg-456' };

    await executeDecisions(
      null as any,
      decisions,
      1,
      null,
      triggerChannel,
      triggerMetadata,
      deps,
      mockEventBus,
    );

    expect(mockPerformAction).toHaveBeenCalledOnce();
    expect(mockPerformAction).toHaveBeenCalledWith('discord', {
      type: 'add_reaction',
      channelId: 'ch-123',
      messageId: 'msg-456',
      emoji: '👍',
    });
  });

  it('extracts emoji, channelId, and messageId correctly from params and metadata', async () => {
    const decisions: Decision[] = [
      makeDecision({
        parameters: { emoji: '🎉' },
      }),
    ];
    const triggerChannel = 'sms';
    const triggerMetadata = { channelId: 'sms-ch-1', messageId: 'sms-msg-99' };

    await executeDecisions(
      null as any,
      decisions,
      5,
      null,
      triggerChannel,
      triggerMetadata,
      deps,
      mockEventBus,
    );

    expect(mockPerformAction).toHaveBeenCalledWith('sms', {
      type: 'add_reaction',
      channelId: 'sms-ch-1',
      messageId: 'sms-msg-99',
      emoji: '🎉',
    });
  });

  it('skips when triggerChannel is undefined', async () => {
    const decisions: Decision[] = [makeDecision()];
    const triggerMetadata = { channelId: 'ch-1', messageId: 'msg-1' };

    await executeDecisions(
      null as any,
      decisions,
      2,
      null,
      undefined,
      triggerMetadata,
      deps,
      mockEventBus,
    );

    expect(mockPerformAction).not.toHaveBeenCalled();
  });

  it('skips when emoji is empty', async () => {
    const decisions: Decision[] = [
      makeDecision({ parameters: { emoji: '' } }),
    ];
    const triggerChannel = 'discord';
    const triggerMetadata = { channelId: 'ch-1', messageId: 'msg-1' };

    await executeDecisions(
      null as any,
      decisions,
      3,
      null,
      triggerChannel,
      triggerMetadata,
      deps,
      mockEventBus,
    );

    expect(mockPerformAction).not.toHaveBeenCalled();
  });

  it('skips when emoji parameter is missing (undefined coerces to empty)', async () => {
    const decisions: Decision[] = [
      makeDecision({ parameters: {} }),
    ];
    const triggerChannel = 'discord';
    const triggerMetadata = { channelId: 'ch-1', messageId: 'msg-1' };

    await executeDecisions(
      null as any,
      decisions,
      3,
      null,
      triggerChannel,
      triggerMetadata,
      deps,
      mockEventBus,
    );

    expect(mockPerformAction).not.toHaveBeenCalled();
  });

  it('skips when triggerMetadata is missing channelId', async () => {
    const decisions: Decision[] = [makeDecision()];
    const triggerChannel = 'discord';
    const triggerMetadata = { messageId: 'msg-1' };

    await executeDecisions(
      null as any,
      decisions,
      4,
      null,
      triggerChannel,
      triggerMetadata,
      deps,
      mockEventBus,
    );

    expect(mockPerformAction).not.toHaveBeenCalled();
  });

  it('skips when triggerMetadata is missing messageId', async () => {
    const decisions: Decision[] = [makeDecision()];
    const triggerChannel = 'discord';
    const triggerMetadata = { channelId: 'ch-1' };

    await executeDecisions(
      null as any,
      decisions,
      4,
      null,
      triggerChannel,
      triggerMetadata,
      deps,
      mockEventBus,
    );

    expect(mockPerformAction).not.toHaveBeenCalled();
  });

  it('skips when triggerMetadata is undefined', async () => {
    const decisions: Decision[] = [makeDecision()];
    const triggerChannel = 'discord';

    await executeDecisions(
      null as any,
      decisions,
      4,
      null,
      triggerChannel,
      undefined,
      deps,
      mockEventBus,
    );

    expect(mockPerformAction).not.toHaveBeenCalled();
  });

  it('does not call performAction for non-send_reaction decisions', async () => {
    const decisions: Decision[] = [
      {
        type: 'no_action',
        description: 'Nothing to do',
        parameters: {},
      },
      {
        type: 'send_message',
        description: 'Reply to user',
        parameters: { content: 'Hello!' },
      },
      {
        type: 'propose_goal',
        description: 'Create a goal',
        parameters: { title: 'Test' },
      },
    ];
    const triggerChannel = 'discord';
    const triggerMetadata = { channelId: 'ch-1', messageId: 'msg-1' };

    await executeDecisions(
      null as any,
      decisions,
      6,
      null,
      triggerChannel,
      triggerMetadata,
      deps,
      mockEventBus,
    );

    expect(mockPerformAction).not.toHaveBeenCalled();
  });

  it('processes multiple send_reaction decisions in sequence', async () => {
    const decisions: Decision[] = [
      makeDecision({ parameters: { emoji: '👍' } }),
      makeDecision({ parameters: { emoji: '❤️' }, description: 'Heart reaction' }),
    ];
    const triggerChannel = 'discord';
    const triggerMetadata = { channelId: 'ch-1', messageId: 'msg-1' };

    await executeDecisions(
      null as any,
      decisions,
      7,
      null,
      triggerChannel,
      triggerMetadata,
      deps,
      mockEventBus,
    );

    expect(mockPerformAction).toHaveBeenCalledTimes(2);
    expect(mockPerformAction).toHaveBeenNthCalledWith(1, 'discord', {
      type: 'add_reaction',
      channelId: 'ch-1',
      messageId: 'msg-1',
      emoji: '👍',
    });
    expect(mockPerformAction).toHaveBeenNthCalledWith(2, 'discord', {
      type: 'add_reaction',
      channelId: 'ch-1',
      messageId: 'msg-1',
      emoji: '❤️',
    });
  });

  it('logs a failed tick decision when performAction throws', async () => {
    const { insertTickDecision } = await import('../../src/db/stores/heartbeat-store.js');
    mockPerformAction.mockRejectedValueOnce(new Error('Channel unavailable'));

    const decisions: Decision[] = [makeDecision()];
    const triggerChannel = 'discord';
    const triggerMetadata = { channelId: 'ch-1', messageId: 'msg-1' };

    await executeDecisions(
      null as any,
      decisions,
      8,
      null,
      triggerChannel,
      triggerMetadata,
      deps,
      mockEventBus,
    );

    expect(insertTickDecision).toHaveBeenCalledWith(null, {
      tickNumber: 8,
      type: 'send_reaction',
      description: 'React with a thumbs up',
      parameters: { emoji: '👍' },
      outcome: 'failed',
      outcomeDetail: 'Error: Channel unavailable',
    });
  });
});
