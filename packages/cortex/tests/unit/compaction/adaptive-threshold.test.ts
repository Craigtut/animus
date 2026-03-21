import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CompactionManager,
  buildCompactionConfig,
  DEFAULT_COMPACTION_CONFIG,
  ADAPTIVE_DEFAULTS,
  computeAdaptiveThreshold,
} from '../../../src/compaction/index.js';
import type { AgentMessage } from '../../../src/context-manager.js';
import type { AdaptiveThresholdConfig, CortexCompactionConfig } from '../../../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUserMsg(content: string): AgentMessage {
  return { role: 'user', content };
}

function makeAssistantMsg(content: string): AgentMessage {
  return { role: 'assistant', content };
}

function buildHistory(turnCount: number): AgentMessage[] {
  const history: AgentMessage[] = [];
  for (let i = 0; i < turnCount; i++) {
    history.push(makeUserMsg(`User message ${i}`));
    history.push(makeAssistantMsg(`Assistant response ${i}`));
  }
  return history;
}

// ---------------------------------------------------------------------------
// Tests: computeAdaptiveThreshold (pure function)
// ---------------------------------------------------------------------------

describe('computeAdaptiveThreshold', () => {
  const base = 0.70;
  const config = ADAPTIVE_DEFAULTS;

  it('returns base threshold when adaptive is disabled', () => {
    const disabledConfig: AdaptiveThresholdConfig = { ...config, enabled: false };
    const result = computeAdaptiveThreshold(base, disabledConfig, null);
    expect(result).toBe(0.70);
  });

  it('returns base threshold minus idleReduction when no interaction recorded (null)', () => {
    const result = computeAdaptiveThreshold(base, config, null);
    // 0.70 - 0.20 = 0.50
    expect(result).toBeCloseTo(0.50);
  });

  it('returns base threshold with no reduction for recent interaction', () => {
    const now = 1000000;
    const recent = now - 60_000; // 1 minute ago (< 5 min recentWindowMs)
    const result = computeAdaptiveThreshold(base, config, recent, now);
    // recentReduction is 0.0 by default
    expect(result).toBe(0.70);
  });

  it('returns base threshold minus moderateReduction for moderate idle', () => {
    const now = 1000000;
    const moderate = now - 600_000; // 10 minutes ago (between 5 min and 30 min)
    const result = computeAdaptiveThreshold(base, config, moderate, now);
    // 0.70 - 0.10 = 0.60
    expect(result).toBeCloseTo(0.60);
  });

  it('returns base threshold minus idleReduction for fully idle interaction', () => {
    const now = 1000000;
    const idle = now - 2_400_000; // 40 minutes ago (> 30 min idleWindowMs)
    const result = computeAdaptiveThreshold(base, config, idle, now);
    // 0.70 - 0.20 = 0.50
    expect(result).toBeCloseTo(0.50);
  });

  it('clamps to 0 when reduction exceeds base threshold', () => {
    const extremeConfig: AdaptiveThresholdConfig = {
      ...config,
      idleReduction: 0.90,
    };
    const result = computeAdaptiveThreshold(0.30, extremeConfig, null);
    // 0.30 - 0.90 would be -0.60, clamped to 0
    expect(result).toBe(0);
  });

  it('respects custom window boundaries', () => {
    const customConfig: AdaptiveThresholdConfig = {
      enabled: true,
      recentWindowMs: 60_000,      // 1 minute
      idleWindowMs: 120_000,       // 2 minutes
      recentReduction: 0.05,
      moderateReduction: 0.15,
      idleReduction: 0.25,
    };

    const now = 1000000;

    // 30 seconds ago: recent
    expect(computeAdaptiveThreshold(base, customConfig, now - 30_000, now)).toBeCloseTo(0.65);

    // 90 seconds ago: moderate
    expect(computeAdaptiveThreshold(base, customConfig, now - 90_000, now)).toBeCloseTo(0.55);

    // 3 minutes ago: idle
    expect(computeAdaptiveThreshold(base, customConfig, now - 180_000, now)).toBeCloseTo(0.45);
  });

  it('handles exact boundary at recentWindowMs', () => {
    const now = 1000000;
    // Exactly at the recentWindowMs boundary (5 min = 300000ms)
    // elapsed === recentWindowMs: NOT < recentWindowMs, so falls to moderate
    const result = computeAdaptiveThreshold(base, config, now - 300_000, now);
    expect(result).toBeCloseTo(0.60);
  });

  it('handles exact boundary at idleWindowMs', () => {
    const now = 1000000;
    // Exactly at the idleWindowMs boundary (30 min = 1800000ms)
    // elapsed === idleWindowMs: NOT < idleWindowMs, so falls to idle
    const result = computeAdaptiveThreshold(base, config, now - 1_800_000, now);
    expect(result).toBeCloseTo(0.50);
  });
});

// ---------------------------------------------------------------------------
// Tests: CompactionManager.setLastInteractionTime
// ---------------------------------------------------------------------------

describe('CompactionManager adaptive threshold', () => {
  let manager: CompactionManager;

  beforeEach(() => {
    manager = new CompactionManager(DEFAULT_COMPACTION_CONFIG, 2);
    manager.setContextWindow(200_000);
  });

  it('tracks last interaction time', () => {
    expect(manager.lastInteractionTime).toBeNull();

    manager.setLastInteractionTime(1000000);
    expect(manager.lastInteractionTime).toBe(1000000);
  });

  it('returns normal threshold when interaction is recent', () => {
    const now = Date.now();
    manager.setLastInteractionTime(now - 60_000); // 1 minute ago

    // Should return the base threshold (0.70) since recentReduction = 0.0
    expect(manager.getEffectiveThreshold(now)).toBe(0.70);
  });

  it('returns lowered threshold when interaction is moderately stale', () => {
    const now = Date.now();
    manager.setLastInteractionTime(now - 600_000); // 10 minutes ago

    // Should return 0.60 (0.70 - 0.10)
    expect(manager.getEffectiveThreshold(now)).toBeCloseTo(0.60);
  });

  it('returns further lowered threshold when interaction is fully idle', () => {
    const now = Date.now();
    manager.setLastInteractionTime(now - 2_400_000); // 40 minutes ago

    // Should return 0.50 (0.70 - 0.20)
    expect(manager.getEffectiveThreshold(now)).toBeCloseTo(0.50);
  });

  it('returns idle threshold when no interaction was ever recorded', () => {
    const now = Date.now();
    // Never called setLastInteractionTime, so it's null
    expect(manager.getEffectiveThreshold(now)).toBeCloseTo(0.50);
  });

  it('resets last interaction time on destroy', () => {
    manager.setLastInteractionTime(1000000);
    manager.destroy();
    expect(manager.lastInteractionTime).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: Adaptive threshold disabled
// ---------------------------------------------------------------------------

describe('CompactionManager with adaptive disabled', () => {
  it('uses static threshold when adaptive is disabled', () => {
    const config = buildCompactionConfig({
      adaptive: { ...ADAPTIVE_DEFAULTS, enabled: false },
    });
    const manager = new CompactionManager(config, 2);
    manager.setContextWindow(200_000);

    // Even with no interaction, threshold stays at 0.70
    expect(manager.getEffectiveThreshold()).toBe(0.70);
  });
});

// ---------------------------------------------------------------------------
// Tests: Custom adaptive configuration
// ---------------------------------------------------------------------------

describe('CompactionManager with custom adaptive config', () => {
  it('applies custom reduction values', () => {
    const config = buildCompactionConfig({
      adaptive: {
        enabled: true,
        recentWindowMs: 60_000,
        idleWindowMs: 300_000,
        recentReduction: 0.05,
        moderateReduction: 0.12,
        idleReduction: 0.18,
      },
    });
    const manager = new CompactionManager(config, 2);
    manager.setContextWindow(200_000);

    const now = Date.now();

    // Recent: 30s ago
    manager.setLastInteractionTime(now - 30_000);
    expect(manager.getEffectiveThreshold(now)).toBeCloseTo(0.65);

    // Moderate: 2 min ago
    manager.setLastInteractionTime(now - 120_000);
    expect(manager.getEffectiveThreshold(now)).toBeCloseTo(0.58);

    // Idle: 10 min ago
    manager.setLastInteractionTime(now - 600_000);
    expect(manager.getEffectiveThreshold(now)).toBeCloseTo(0.52);
  });
});

// ---------------------------------------------------------------------------
// Tests: buildCompactionConfig with adaptive overrides
// ---------------------------------------------------------------------------

describe('buildCompactionConfig adaptive', () => {
  it('uses ADAPTIVE_DEFAULTS when no adaptive override provided', () => {
    const config = buildCompactionConfig();
    expect(config.adaptive).toEqual(ADAPTIVE_DEFAULTS);
  });

  it('applies partial adaptive overrides', () => {
    const config = buildCompactionConfig({
      adaptive: { enabled: false } as AdaptiveThresholdConfig,
    });
    expect(config.adaptive.enabled).toBe(false);
    // Other fields should keep defaults
    expect(config.adaptive.recentWindowMs).toBe(300_000);
    expect(config.adaptive.idleReduction).toBe(0.20);
  });

  it('applies full adaptive overrides', () => {
    const config = buildCompactionConfig({
      adaptive: {
        enabled: true,
        recentWindowMs: 10_000,
        idleWindowMs: 60_000,
        recentReduction: 0.02,
        moderateReduction: 0.08,
        idleReduction: 0.15,
      },
    });
    expect(config.adaptive.recentWindowMs).toBe(10_000);
    expect(config.adaptive.idleWindowMs).toBe(60_000);
    expect(config.adaptive.moderateReduction).toBe(0.08);
  });
});

// ---------------------------------------------------------------------------
// Tests: Integration with checkAndRunCompaction
// ---------------------------------------------------------------------------

describe('checkAndRunCompaction with adaptive threshold', () => {
  it('triggers compaction at lower threshold when idle', async () => {
    // Configure with a 0.70 base threshold.
    // When idle (no interaction), adaptive lowers it to 0.50.
    const config = buildCompactionConfig();
    const manager = new CompactionManager(config, 2);
    manager.setContextWindow(200_000);

    // 60% usage: below static 0.70 but above adaptive idle 0.50
    manager.updateTokenCount(120_000);

    const mockComplete = vi.fn().mockResolvedValue('Summary of conversation');
    manager.setCompleteFn(mockComplete);

    const history = buildHistory(10);
    let replacedHistory: AgentMessage[] | null = null;

    // No interaction set (null): fully idle -> threshold is 0.50
    const result = await manager.checkAndRunCompaction(
      () => history,
      (h) => { replacedHistory = h; },
    );

    // Should trigger because 0.60 > 0.50 (adaptive threshold)
    expect(result).not.toBeNull();
    expect(mockComplete).toHaveBeenCalled();
    expect(replacedHistory).not.toBeNull();
  });

  it('does not trigger compaction at same usage when interaction is recent', async () => {
    const config = buildCompactionConfig();
    const manager = new CompactionManager(config, 2);
    manager.setContextWindow(200_000);

    // 60% usage: below static 0.70
    manager.updateTokenCount(120_000);

    // Recent interaction: threshold stays at 0.70
    manager.setLastInteractionTime(Date.now() - 30_000); // 30 seconds ago

    const mockComplete = vi.fn().mockResolvedValue('Summary');
    manager.setCompleteFn(mockComplete);

    const history = buildHistory(10);

    const result = await manager.checkAndRunCompaction(
      () => history,
      () => {},
    );

    // Should NOT trigger because 0.60 < 0.70 (normal threshold)
    expect(result).toBeNull();
    expect(mockComplete).not.toHaveBeenCalled();
  });
});
