import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TriggerType, ChannelManifest } from '@animus/shared';

// ============================================================================
// Typing Indicator Tests
//
// The typing indicator logic lives inside executeTick() in heartbeat/index.ts.
// Rather than pulling in the full pipeline, we extract the condition-checking
// and timer behavior into standalone helpers and test them directly.
// ============================================================================

// ---------------------------------------------------------------------------
// Helper: mirrors the guard logic from executeTick()
// ---------------------------------------------------------------------------

interface TypingCheckInput {
  triggerType: TriggerType;
  channel?: string;
  metadata?: Record<string, unknown>;
}

interface ChannelManagerLike {
  getChannelManifest(channelType: string): ChannelManifest | undefined;
  performAction(channelType: string, action: { type: string; [key: string]: unknown }): Promise<boolean>;
}

/**
 * Determines whether the typing indicator should fire.
 * Matches the conditions in executeTick():
 *   1. trigger.type === 'message'
 *   2. trigger.channel is set
 *   3. manifest exists with 'typing-indicator' capability
 *   4. channelId present in metadata
 */
function shouldFireTyping(
  input: TypingCheckInput,
  cm: ChannelManagerLike,
): boolean {
  if (input.triggerType !== 'message') return false;
  if (!input.channel) return false;

  const manifest = cm.getChannelManifest(input.channel);
  const channelId = input.metadata?.['channelId'] as string | undefined;

  return !!(manifest?.capabilities.includes('typing-indicator') && channelId);
}

// ---------------------------------------------------------------------------
// Helpers: mock manifest factory
// ---------------------------------------------------------------------------

function makeManifest(capabilities: string[]): ChannelManifest {
  return {
    name: 'test-channel',
    type: 'test',
    displayName: 'Test Channel',
    description: 'A test channel',
    version: '1.0.0',
    entry: 'index.js',
    capabilities: capabilities as ChannelManifest['capabilities'],
    replyGuidance: 'Plain text reply',
  };
}

function makeMockChannelManager(manifest?: ChannelManifest): ChannelManagerLike {
  return {
    getChannelManifest: vi.fn().mockReturnValue(manifest),
    performAction: vi.fn().mockResolvedValue(true),
  };
}

// ============================================================================
// Tests: Condition Checking
// ============================================================================

describe('typing indicator conditions', () => {
  it('should fire typing for message trigger on channel with typing-indicator capability and channelId', () => {
    const manifest = makeManifest(['text', 'typing-indicator']);
    const cm = makeMockChannelManager(manifest);

    const result = shouldFireTyping(
      { triggerType: 'message', channel: 'discord', metadata: { channelId: '123456' } },
      cm,
    );

    expect(result).toBe(true);
    expect(cm.getChannelManifest).toHaveBeenCalledWith('discord');
  });

  it('should NOT fire typing for interval triggers', () => {
    const manifest = makeManifest(['text', 'typing-indicator']);
    const cm = makeMockChannelManager(manifest);

    const result = shouldFireTyping(
      { triggerType: 'interval', channel: 'discord', metadata: { channelId: '123456' } },
      cm,
    );

    expect(result).toBe(false);
    // Should short-circuit before calling getChannelManifest
    expect(cm.getChannelManifest).not.toHaveBeenCalled();
  });

  it('should NOT fire typing for scheduled_task triggers', () => {
    const manifest = makeManifest(['text', 'typing-indicator']);
    const cm = makeMockChannelManager(manifest);

    const result = shouldFireTyping(
      { triggerType: 'scheduled_task', channel: 'discord', metadata: { channelId: '123456' } },
      cm,
    );

    expect(result).toBe(false);
    expect(cm.getChannelManifest).not.toHaveBeenCalled();
  });

  it('should NOT fire typing for agent_complete triggers', () => {
    const manifest = makeManifest(['text', 'typing-indicator']);
    const cm = makeMockChannelManager(manifest);

    const result = shouldFireTyping(
      { triggerType: 'agent_complete', channel: 'discord', metadata: { channelId: '123456' } },
      cm,
    );

    expect(result).toBe(false);
    expect(cm.getChannelManifest).not.toHaveBeenCalled();
  });

  it('should NOT fire typing for plugin_trigger triggers', () => {
    const manifest = makeManifest(['text', 'typing-indicator']);
    const cm = makeMockChannelManager(manifest);

    const result = shouldFireTyping(
      { triggerType: 'plugin_trigger', channel: 'discord', metadata: { channelId: '123456' } },
      cm,
    );

    expect(result).toBe(false);
    expect(cm.getChannelManifest).not.toHaveBeenCalled();
  });

  it('should NOT fire typing when channel is missing from trigger', () => {
    const manifest = makeManifest(['text', 'typing-indicator']);
    const cm = makeMockChannelManager(manifest);

    const result = shouldFireTyping(
      { triggerType: 'message', metadata: { channelId: '123456' } },
      cm,
    );

    expect(result).toBe(false);
    expect(cm.getChannelManifest).not.toHaveBeenCalled();
  });

  it('should NOT fire typing when channelId is missing from metadata', () => {
    const manifest = makeManifest(['text', 'typing-indicator']);
    const cm = makeMockChannelManager(manifest);

    const result = shouldFireTyping(
      { triggerType: 'message', channel: 'discord', metadata: {} },
      cm,
    );

    expect(result).toBe(false);
  });

  it('should NOT fire typing when metadata is undefined', () => {
    const manifest = makeManifest(['text', 'typing-indicator']);
    const cm = makeMockChannelManager(manifest);

    const result = shouldFireTyping(
      { triggerType: 'message', channel: 'discord' },
      cm,
    );

    expect(result).toBe(false);
  });

  it('should NOT fire typing when channel lacks typing-indicator capability', () => {
    const manifest = makeManifest(['text', 'markdown']);
    const cm = makeMockChannelManager(manifest);

    const result = shouldFireTyping(
      { triggerType: 'message', channel: 'sms', metadata: { channelId: '123456' } },
      cm,
    );

    expect(result).toBe(false);
  });

  it('should NOT fire typing when channel has no capabilities at all', () => {
    const manifest = makeManifest([]);
    const cm = makeMockChannelManager(manifest);

    const result = shouldFireTyping(
      { triggerType: 'message', channel: 'minimal', metadata: { channelId: '123456' } },
      cm,
    );

    expect(result).toBe(false);
  });

  it('should NOT fire typing when channel manifest is not found', () => {
    const cm = makeMockChannelManager(undefined);

    const result = shouldFireTyping(
      { triggerType: 'message', channel: 'unknown-channel', metadata: { channelId: '123456' } },
      cm,
    );

    expect(result).toBe(false);
  });

  it('should NOT fire typing when channelId is empty string', () => {
    const manifest = makeManifest(['text', 'typing-indicator']);
    const cm = makeMockChannelManager(manifest);

    const result = shouldFireTyping(
      { triggerType: 'message', channel: 'discord', metadata: { channelId: '' } },
      cm,
    );

    // Empty string is falsy, so typing should not fire
    expect(result).toBe(false);
  });
});

// ============================================================================
// Tests: Timer Behavior
// ============================================================================

describe('typing indicator timer behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should fire typing immediately and then every 8 seconds', () => {
    const cm = makeMockChannelManager(makeManifest(['text', 'typing-indicator']));
    const channelType = 'discord';
    const channelId = '123456';

    // Replicate the timer setup from executeTick()
    const fireTyping = () => {
      cm.performAction(channelType, { type: 'typing_indicator', channelId });
    };

    fireTyping();
    const typingTimer = setInterval(fireTyping, 8_000);

    // First call: immediate
    expect(cm.performAction).toHaveBeenCalledTimes(1);
    expect(cm.performAction).toHaveBeenCalledWith('discord', {
      type: 'typing_indicator',
      channelId: '123456',
    });

    // After 8 seconds: second call
    vi.advanceTimersByTime(8_000);
    expect(cm.performAction).toHaveBeenCalledTimes(2);

    // After 16 seconds: third call
    vi.advanceTimersByTime(8_000);
    expect(cm.performAction).toHaveBeenCalledTimes(3);

    // After 24 seconds: fourth call
    vi.advanceTimersByTime(8_000);
    expect(cm.performAction).toHaveBeenCalledTimes(4);

    clearInterval(typingTimer);
  });

  it('should stop firing after clearInterval', () => {
    const cm = makeMockChannelManager(makeManifest(['text', 'typing-indicator']));
    const channelType = 'discord';
    const channelId = '999';

    const fireTyping = () => {
      cm.performAction(channelType, { type: 'typing_indicator', channelId });
    };

    fireTyping();
    let typingTimer: ReturnType<typeof setInterval> | null = setInterval(fireTyping, 8_000);

    expect(cm.performAction).toHaveBeenCalledTimes(1);

    // Advance to second fire
    vi.advanceTimersByTime(8_000);
    expect(cm.performAction).toHaveBeenCalledTimes(2);

    // Clear the timer (simulates post-mind-query cleanup)
    clearInterval(typingTimer);
    typingTimer = null;

    // Advance 24 more seconds — no more calls should happen
    vi.advanceTimersByTime(24_000);
    expect(cm.performAction).toHaveBeenCalledTimes(2);
    expect(typingTimer).toBeNull();
  });

  it('should clear timer on error (simulated catch block)', () => {
    const cm = makeMockChannelManager(makeManifest(['text', 'typing-indicator']));
    const channelType = 'discord';
    const channelId = 'abc';

    const fireTyping = () => {
      cm.performAction(channelType, { type: 'typing_indicator', channelId });
    };

    fireTyping();
    let typingTimer: ReturnType<typeof setInterval> | null = setInterval(fireTyping, 8_000);

    expect(cm.performAction).toHaveBeenCalledTimes(1);

    // Simulate error path: clear timer just like the catch block does
    if (typingTimer) {
      clearInterval(typingTimer);
      typingTimer = null;
    }

    // No more calls after clearing
    vi.advanceTimersByTime(40_000);
    expect(cm.performAction).toHaveBeenCalledTimes(1);
    expect(typingTimer).toBeNull();
  });

  it('should not accumulate calls during long mind queries', () => {
    const cm = makeMockChannelManager(makeManifest(['text', 'typing-indicator']));
    const channelType = 'discord';
    const channelId = 'long-query';

    const fireTyping = () => {
      cm.performAction(channelType, { type: 'typing_indicator', channelId });
    };

    fireTyping();
    const typingTimer = setInterval(fireTyping, 8_000);

    // Simulate a 30-second mind query
    vi.advanceTimersByTime(30_000);

    // Immediate (1) + 3 intervals at 8s, 16s, 24s = 4 total
    expect(cm.performAction).toHaveBeenCalledTimes(4);

    clearInterval(typingTimer);

    // No more after clearing
    vi.advanceTimersByTime(16_000);
    expect(cm.performAction).toHaveBeenCalledTimes(4);
  });

  it('should handle performAction rejection gracefully (matching .catch(() => {}) pattern)', async () => {
    const cm = makeMockChannelManager(makeManifest(['text', 'typing-indicator']));
    // Make performAction reject
    (cm.performAction as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Channel disconnected'));

    const channelType = 'discord';
    const channelId = 'flaky';

    const fireTyping = () => {
      cm.performAction(channelType, { type: 'typing_indicator', channelId }).catch(() => {});
    };

    // Should not throw even when performAction rejects
    expect(() => fireTyping()).not.toThrow();

    const typingTimer = setInterval(fireTyping, 8_000);

    // Advance past one interval
    vi.advanceTimersByTime(8_000);

    // Flush microtask queue so rejected promises settle
    await Promise.resolve();

    // performAction was called: 1 immediate + 1 interval
    expect(cm.performAction).toHaveBeenCalledTimes(2);

    clearInterval(typingTimer);
  });
});

// ============================================================================
// Tests: Full Flow Simulation
// ============================================================================

describe('typing indicator full flow simulation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('simulates the complete executeTick typing indicator lifecycle', () => {
    // Setup: message trigger with Discord channel that has typing-indicator
    const triggerType: TriggerType = 'message';
    const channel = 'discord';
    const metadata: Record<string, unknown> = { channelId: '12345' };

    const manifest = makeManifest(['text', 'typing-indicator', 'markdown', 'embeds', 'reactions']);
    const cm = makeMockChannelManager(manifest);

    // --- executeTick typing indicator setup ---
    let typingTimer: ReturnType<typeof setInterval> | null = null;

    if (triggerType === 'message' && channel) {
      const triggerChannel = channel;
      const channelId = metadata?.['channelId'] as string | undefined;
      const manifestResult = cm.getChannelManifest(triggerChannel);

      if (manifestResult?.capabilities.includes('typing-indicator') && channelId) {
        const fireTyping = () => {
          cm.performAction(triggerChannel, { type: 'typing_indicator', channelId }).catch(() => {});
        };
        fireTyping();
        typingTimer = setInterval(fireTyping, 8_000);
      }
    }

    // Timer should be active
    expect(typingTimer).not.toBeNull();
    expect(cm.performAction).toHaveBeenCalledTimes(1);

    // Simulate mind query taking ~12 seconds
    vi.advanceTimersByTime(12_000);
    // 1 immediate + 1 at 8s = 2
    expect(cm.performAction).toHaveBeenCalledTimes(2);

    // --- Post mind query: clear typing ---
    if (typingTimer) { clearInterval(typingTimer); typingTimer = null; }

    expect(typingTimer).toBeNull();

    // No more fires
    vi.advanceTimersByTime(16_000);
    expect(cm.performAction).toHaveBeenCalledTimes(2);
  });

  it('simulates executeTick with non-message trigger (no typing)', () => {
    const triggerType: TriggerType = 'interval';
    const channel = undefined;
    const metadata = undefined;

    const manifest = makeManifest(['text', 'typing-indicator']);
    const cm = makeMockChannelManager(manifest);

    let typingTimer: ReturnType<typeof setInterval> | null = null;

    if (triggerType === 'message' && channel) {
      // This block should NOT execute for interval triggers
      const triggerChannel = channel;
      const channelId = metadata?.['channelId'] as string | undefined;
      const manifestResult = cm.getChannelManifest(triggerChannel);

      if (manifestResult?.capabilities.includes('typing-indicator') && channelId) {
        const fireTyping = () => {
          cm.performAction(triggerChannel, { type: 'typing_indicator', channelId }).catch(() => {});
        };
        fireTyping();
        typingTimer = setInterval(fireTyping, 8_000);
      }
    }

    expect(typingTimer).toBeNull();
    expect(cm.getChannelManifest).not.toHaveBeenCalled();
    expect(cm.performAction).not.toHaveBeenCalled();

    vi.advanceTimersByTime(30_000);
    expect(cm.performAction).not.toHaveBeenCalled();
  });

  it('simulates executeTick error path clearing the timer', () => {
    const triggerType: TriggerType = 'message';
    const channel = 'discord';
    const metadata: Record<string, unknown> = { channelId: '99999' };

    const manifest = makeManifest(['text', 'typing-indicator']);
    const cm = makeMockChannelManager(manifest);

    let typingTimer: ReturnType<typeof setInterval> | null = null;

    if (triggerType === 'message' && channel) {
      const triggerChannel = channel;
      const channelId = metadata?.['channelId'] as string | undefined;
      const manifestResult = cm.getChannelManifest(triggerChannel);

      if (manifestResult?.capabilities.includes('typing-indicator') && channelId) {
        const fireTyping = () => {
          cm.performAction(triggerChannel, { type: 'typing_indicator', channelId }).catch(() => {});
        };
        fireTyping();
        typingTimer = setInterval(fireTyping, 8_000);
      }
    }

    expect(typingTimer).not.toBeNull();
    expect(cm.performAction).toHaveBeenCalledTimes(1);

    // Simulate error occurring after 4 seconds (before next interval)
    vi.advanceTimersByTime(4_000);
    expect(cm.performAction).toHaveBeenCalledTimes(1);

    // Error catch block
    if (typingTimer) { clearInterval(typingTimer); typingTimer = null; }

    expect(typingTimer).toBeNull();

    // Verify no more fires happen
    vi.advanceTimersByTime(30_000);
    expect(cm.performAction).toHaveBeenCalledTimes(1);
  });
});
