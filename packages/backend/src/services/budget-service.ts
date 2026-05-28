/**
 * Budget Service -- business logic for weekly budget tracking and throttling.
 *
 * Reads budget configuration from system.db (settings-store) and current
 * spend from agent_logs.db (usage-store). Computes throttle factors,
 * effective intervals, and budget alerts.
 */

import type Database from 'better-sqlite3';
import type { BudgetConfig, BudgetStatus, BudgetAlert } from '@animus-labs/shared';
import { createLogger } from '../lib/logger.js';
import * as settingsStore from '../db/stores/settings-store.js';
import * as usageStore from '../db/stores/usage-store.js';

const log = createLogger('BudgetService', 'heartbeat');

// ============================================================================
// Types
// ============================================================================

export interface BudgetServiceDeps {
  getSystemDb: () => Database.Database;
  getAgentLogsDb: () => Database.Database;
}

// ============================================================================
// Service
// ============================================================================

class BudgetService {
  constructor(private deps: BudgetServiceDeps) {}

  /**
   * Optional provider for the live (in-flight) cost of running sub-agents.
   * Sub-agent cost is only written to agent_usage when a sub-agent completes,
   * so a long-running background sub-agent would otherwise be invisible to the
   * budget until it finishes. This lets a runaway be seen while it is still
   * burning. Set once at startup; null = no in-flight cost is counted.
   */
  private inflightSubAgentCostProvider: (() => number) | null = null;

  setInflightSubAgentCostProvider(provider: (() => number) | null): void {
    this.inflightSubAgentCostProvider = provider;
  }

  private getInflightSubAgentCost(): number {
    if (!this.inflightSubAgentCostProvider) return 0;
    try {
      const cost = this.inflightSubAgentCostProvider();
      return Number.isFinite(cost) && cost > 0 ? cost : 0;
    } catch {
      return 0;
    }
  }

  // --------------------------------------------------------------------------
  // Config
  // --------------------------------------------------------------------------

  getBudgetConfig(): BudgetConfig {
    const settings = settingsStore.getSystemSettings(this.deps.getSystemDb());
    return {
      weeklyBudgetUsd: settings.budgetWeeklyUsd,
      budgetStartDate: settings.budgetStartDate ?? null,
      throttleEnabled: settings.budgetThrottleEnabled,
    };
  }

  setBudgetConfig(config: {
    weeklyBudgetUsd?: number;
    throttleEnabled?: boolean;
  }): void {
    const updates: Record<string, unknown> = {};
    if (config.weeklyBudgetUsd !== undefined) {
      updates['budgetWeeklyUsd'] = config.weeklyBudgetUsd;

      // When setting budget for the first time, also set the start date
      const current = this.getBudgetConfig();
      if (!current.budgetStartDate && config.weeklyBudgetUsd > 0) {
        updates['budgetStartDate'] = new Date().toISOString();
        log.info('Budget start date initialized');
      }
    }
    if (config.throttleEnabled !== undefined) {
      updates['budgetThrottleEnabled'] = config.throttleEnabled;
    }
    settingsStore.updateSystemSettings(this.deps.getSystemDb(), updates);
  }

  // --------------------------------------------------------------------------
  // Budget Status
  // --------------------------------------------------------------------------

  getBudgetStatus(baseIntervalMs: number): BudgetStatus {
    const config = this.getBudgetConfig();

    // Disabled: no budget set
    if (config.weeklyBudgetUsd <= 0) {
      return {
        config,
        currentSpendUsd: 0,
        remainingUsd: 0,
        percentUsed: 0,
        throttleFactor: 0,
        effectiveIntervalMs: baseIntervalMs,
        estimatedHoursRemaining: null,
        isHardStopped: false,
        currentWindowStart: new Date().toISOString(),
        currentWindowEnd: new Date().toISOString(),
      };
    }

    // Advance the 7-day window if needed (resets alert threshold)
    this.advanceWindowIfNeeded();

    // Compute the rolling window
    const { windowStart, windowEnd } = this.getCurrentWindow();

    // Query total spend in window, plus any in-flight sub-agent cost not yet
    // written to agent_usage.
    const currentSpendUsd = usageStore.getTotalSpend(this.deps.getAgentLogsDb(), {
      start: windowStart,
      end: windowEnd,
    }) + this.getInflightSubAgentCost();

    const remainingUsd = Math.max(0, config.weeklyBudgetUsd - currentSpendUsd);
    const percentUsed =
      config.weeklyBudgetUsd > 0 ? currentSpendUsd / config.weeklyBudgetUsd : 0;

    // Throttle factor
    const throttleFactor = config.throttleEnabled
      ? this.computeThrottleFactor(percentUsed)
      : 0;

    // Effective interval
    const effectiveIntervalMs = this.computeEffectiveInterval(
      baseIntervalMs,
      throttleFactor,
    );

    // Estimated hours remaining based on recent burn rate
    let estimatedHoursRemaining: number | null = null;
    if (remainingUsd > 0) {
      const burnRate = usageStore.getRecentBurnRate(this.deps.getAgentLogsDb(), {
        hours: 6,
      });
      if (burnRate > 0) {
        estimatedHoursRemaining = remainingUsd / burnRate;
      }
    }

    // Hard stop at 95% or above
    const isHardStopped = percentUsed >= 0.95;

    return {
      config,
      currentSpendUsd,
      remainingUsd,
      percentUsed,
      throttleFactor,
      effectiveIntervalMs,
      estimatedHoursRemaining,
      isHardStopped,
      currentWindowStart: windowStart,
      currentWindowEnd: windowEnd,
    };
  }

  // --------------------------------------------------------------------------
  // Throttle
  // --------------------------------------------------------------------------

  /**
   * Throttle factor: 0.0 below 80%, linear 0.0 to 1.0 from 80% to 95%, 1.0 at 95%+.
   */
  private computeThrottleFactor(percentUsed: number): number {
    if (percentUsed < 0.8) return 0;
    if (percentUsed >= 0.95) return 1;
    return (percentUsed - 0.8) / 0.15;
  }

  /**
   * Effective interval with throttle applied.
   * At 80%: base * 1 (no change)
   * At 87.5%: base * 1.5x
   * At 95%+: base * 6x (e.g. 5 min -> 30 min)
   */
  private computeEffectiveInterval(
    baseIntervalMs: number,
    throttleFactor: number,
  ): number {
    return Math.round(baseIntervalMs * (1 + throttleFactor * 5));
  }

  /**
   * Get current throttle factor based on live spend.
   */
  getThrottleFactor(): number {
    const config = this.getBudgetConfig();
    if (config.weeklyBudgetUsd <= 0 || !config.throttleEnabled) return 0;
    const percentUsed = this.getPercentUsed();
    return this.computeThrottleFactor(percentUsed);
  }

  /**
   * Get effective interval for the heartbeat, incorporating throttle.
   */
  getEffectiveInterval(baseIntervalMs: number): number {
    const factor = this.getThrottleFactor();
    return this.computeEffectiveInterval(baseIntervalMs, factor);
  }

  // --------------------------------------------------------------------------
  // Tick gating
  // --------------------------------------------------------------------------

  /**
   * Whether the weekly budget is hard-stopped (>=95% used, including in-flight
   * sub-agent cost). Used to gate new sub-agent spawns. Returns false when no
   * budget is configured.
   */
  isHardStopped(): boolean {
    const config = this.getBudgetConfig();
    if (config.weeklyBudgetUsd <= 0) return false;
    return this.getPercentUsed() >= 0.95;
  }

  shouldAllowTick(triggerType: string): {
    allowed: boolean;
    reason?: string;
    isGraceMessage?: boolean;
  } {
    const config = this.getBudgetConfig();
    if (config.weeklyBudgetUsd <= 0) return { allowed: true };

    const percentUsed = this.getPercentUsed();
    const isHardStopped = percentUsed >= 0.95;

    if (!isHardStopped) return { allowed: true };

    // Messages get one grace response
    if (triggerType === 'message') {
      return { allowed: true, isGraceMessage: true };
    }

    // Everything else blocked
    return {
      allowed: false,
      reason: `Weekly budget exceeded ($${this.getCurrentSpend().toFixed(2)} / $${config.weeklyBudgetUsd.toFixed(2)})`,
    };
  }

  // --------------------------------------------------------------------------
  // Alerts
  // --------------------------------------------------------------------------

  /**
   * Check if a new budget threshold was crossed.
   * Thresholds: 50%, 80%, 95%, 100%
   */
  checkAlerts(): BudgetAlert | null {
    const config = this.getBudgetConfig();
    if (config.weeklyBudgetUsd <= 0) return null;

    const settings = settingsStore.getSystemSettings(this.deps.getSystemDb());
    const lastThreshold = settings.budgetLastAlertedThreshold ?? 0;
    const currentPct = this.getPercentUsed();
    const spentUsd = this.getCurrentSpend();

    const thresholds = [0.5, 0.8, 0.95, 1.0];
    const crossed = thresholds.find((t) => currentPct >= t && lastThreshold < t);

    if (!crossed) return null;

    const pctLabel = Math.round(crossed * 100);
    return {
      threshold: crossed,
      spentUsd,
      limitUsd: config.weeklyBudgetUsd,
      percentUsed: currentPct,
      message: `Budget ${pctLabel}% reached: $${spentUsd.toFixed(2)} of $${config.weeklyBudgetUsd.toFixed(2)} weekly limit used.`,
    };
  }

  /**
   * Record that an alert was sent (prevents re-alerting at the same threshold).
   */
  recordAlertSent(threshold: number): void {
    settingsStore.updateSystemSettings(this.deps.getSystemDb(), {
      budgetLastAlertedThreshold: threshold,
    });
  }

  // --------------------------------------------------------------------------
  // Budget Cycle
  // --------------------------------------------------------------------------

  /**
   * Reset the budget cycle manually. Resets start date to now and clears
   * the last alerted threshold.
   */
  resetBudgetCycle(): void {
    settingsStore.updateSystemSettings(this.deps.getSystemDb(), {
      budgetStartDate: new Date().toISOString(),
      budgetLastAlertedThreshold: 0,
    });
    log.info('Budget cycle reset');
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private getPercentUsed(): number {
    const config = this.getBudgetConfig();
    if (config.weeklyBudgetUsd <= 0) return 0;
    const spend = this.getCurrentSpend();
    return spend / config.weeklyBudgetUsd;
  }

  private getCurrentSpend(): number {
    const { windowStart, windowEnd } = this.getCurrentWindow();
    return usageStore.getTotalSpend(this.deps.getAgentLogsDb(), {
      start: windowStart,
      end: windowEnd,
    }) + this.getInflightSubAgentCost();
  }

  private getCurrentWindow(): { windowStart: string; windowEnd: string } {
    const config = this.getBudgetConfig();
    const nowDate = new Date();

    if (!config.budgetStartDate) {
      return {
        windowStart: nowDate.toISOString(),
        windowEnd: nowDate.toISOString(),
      };
    }

    let windowStart = new Date(config.budgetStartDate);

    // Advance by 7-day increments until the window contains now
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    while (nowDate.getTime() >= windowStart.getTime() + sevenDaysMs) {
      windowStart = new Date(windowStart.getTime() + sevenDaysMs);
    }

    const windowEnd = new Date(windowStart.getTime() + sevenDaysMs);

    return {
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
    };
  }

  /**
   * Advance the budget window when 7 days have passed.
   * Also resets lastAlertedThreshold to 0 for the new cycle.
   */
  private advanceWindowIfNeeded(): void {
    const config = this.getBudgetConfig();
    if (!config.budgetStartDate) return;

    const nowDate = new Date();
    const startDate = new Date(config.budgetStartDate);
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    if (nowDate.getTime() >= startDate.getTime() + sevenDaysMs) {
      // Find the latest window start that contains now
      let newStart = new Date(startDate);
      while (nowDate.getTime() >= newStart.getTime() + sevenDaysMs) {
        newStart = new Date(newStart.getTime() + sevenDaysMs);
      }

      settingsStore.updateSystemSettings(this.deps.getSystemDb(), {
        budgetStartDate: newStart.toISOString(),
        budgetLastAlertedThreshold: 0,
      });

      log.info(
        `Budget window advanced to ${newStart.toISOString()}`,
      );
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: BudgetService | null = null;

export function getBudgetService(deps: BudgetServiceDeps): BudgetService {
  if (!instance) instance = new BudgetService(deps);
  return instance;
}

/**
 * Reset the singleton instance (useful for tests).
 */
export function resetBudgetService(): void {
  instance = null;
}
