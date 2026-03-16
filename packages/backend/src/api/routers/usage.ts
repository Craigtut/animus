/**
 * Usage Router -- tRPC procedures for usage analytics and budget management.
 */

import { z } from 'zod/v3';
import {
  timeWindowSchema,
  breakdownDimensionSchema,
} from '@animus-labs/shared';
import type { TimeWindow } from '@animus-labs/shared';
import { router, protectedProcedure } from '../trpc.js';
import { getAgentLogsDb, getSystemDb } from '../../db/index.js';
import * as usageStore from '../../db/stores/usage-store.js';
import * as settingsStore from '../../db/stores/settings-store.js';
import { getBudgetService } from '../../services/budget-service.js';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Convert a TimeWindow enum to concrete start/end ISO strings and bucket size.
 */
function resolveTimeWindow(tw: TimeWindow): {
  start: string;
  end: string;
  bucketMinutes: number;
} {
  const nowMs = Date.now();
  const map: Record<TimeWindow, { hours: number; bucketMinutes: number }> = {
    '1h': { hours: 1, bucketMinutes: 5 },
    '12h': { hours: 12, bucketMinutes: 30 },
    '24h': { hours: 24, bucketMinutes: 60 },
    '7d': { hours: 168, bucketMinutes: 360 },
    '30d': { hours: 720, bucketMinutes: 1440 },
    '90d': { hours: 2160, bucketMinutes: 1440 },
  };
  const { hours, bucketMinutes } = map[tw]!;
  const start = new Date(nowMs - hours * 60 * 60 * 1000);
  return {
    start: start.toISOString(),
    end: new Date(nowMs).toISOString(),
    bucketMinutes,
  };
}

// ============================================================================
// Router
// ============================================================================

export const usageRouter = router({
  /**
   * Time-series token/cost data for charts.
   */
  getTimeSeries: protectedProcedure
    .input(
      z.object({
        timeWindow: timeWindowSchema,
        tickType: z.string().optional(),
        model: z.string().optional(),
      }),
    )
    .query(({ input }) => {
      const { start, end, bucketMinutes } = resolveTimeWindow(input.timeWindow);
      const db = getAgentLogsDb();
      return usageStore.getUsageTimeSeries(db, {
        start,
        end,
        bucketMinutes,
        tickType: input.tickType,
        model: input.model,
      });
    }),

  /**
   * Breakdown by dimension (tick_type, model, pipeline_phase, contact).
   */
  getBreakdown: protectedProcedure
    .input(
      z.object({
        timeWindow: timeWindowSchema,
        dimension: breakdownDimensionSchema,
      }),
    )
    .query(({ input }) => {
      const { start, end } = resolveTimeWindow(input.timeWindow);
      const db = getAgentLogsDb();
      return usageStore.getUsageBreakdown(db, {
        start,
        end,
        dimension: input.dimension,
      });
    }),

  /**
   * Cache efficiency statistics.
   */
  getCacheStats: protectedProcedure
    .input(z.object({ timeWindow: timeWindowSchema }))
    .query(({ input }) => {
      const { start, end } = resolveTimeWindow(input.timeWindow);
      const db = getAgentLogsDb();
      return usageStore.getCacheStats(db, { start, end });
    }),

  /**
   * Get full budget status (spend, throttle factor, effective interval, etc.).
   */
  getBudgetStatus: protectedProcedure.query(() => {
    const settings = settingsStore.getSystemSettings(getSystemDb());
    const service = getBudgetService({
      getSystemDb,
      getAgentLogsDb,
    });
    return service.getBudgetStatus(settings.heartbeatIntervalMs);
  }),

  /**
   * Estimated hours until budget limit at current burn rate.
   */
  getEstimatedTimeToLimit: protectedProcedure.query(() => {
    const service = getBudgetService({
      getSystemDb,
      getAgentLogsDb,
    });
    const burnRate = usageStore.getRecentBurnRate(getAgentLogsDb(), { hours: 6 });
    const status = service.getBudgetStatus(0);
    if (burnRate <= 0 || status.remainingUsd <= 0) return null;
    return status.remainingUsd / burnRate;
  }),

  /**
   * Set weekly budget amount.
   */
  setBudget: protectedProcedure
    .input(z.object({ weeklyBudgetUsd: z.number().min(0) }))
    .mutation(({ input }) => {
      const service = getBudgetService({
        getSystemDb,
        getAgentLogsDb,
      });
      service.setBudgetConfig({ weeklyBudgetUsd: input.weeklyBudgetUsd });
      const settings = settingsStore.getSystemSettings(getSystemDb());
      return service.getBudgetStatus(settings.heartbeatIntervalMs);
    }),

  /**
   * Enable or disable budget throttling.
   */
  setThrottleEnabled: protectedProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(({ input }) => {
      const service = getBudgetService({
        getSystemDb,
        getAgentLogsDb,
      });
      service.setBudgetConfig({ throttleEnabled: input.enabled });
      const settings = settingsStore.getSystemSettings(getSystemDb());
      return service.getBudgetStatus(settings.heartbeatIntervalMs);
    }),

  /**
   * Reset the budget cycle (start date, alert threshold).
   */
  resetBudgetCycle: protectedProcedure.mutation(() => {
    const service = getBudgetService({
      getSystemDb,
      getAgentLogsDb,
    });
    service.resetBudgetCycle();
    const settings = settingsStore.getSystemSettings(getSystemDb());
    return service.getBudgetStatus(settings.heartbeatIntervalMs);
  }),

  /**
   * Export usage records as JSON or CSV string.
   */
  exportUsage: protectedProcedure
    .input(
      z.object({
        timeWindow: timeWindowSchema,
        format: z.enum(['csv', 'json']),
      }),
    )
    .query(({ input }) => {
      const { start, end } = resolveTimeWindow(input.timeWindow);
      const records = usageStore.exportUsageRecords(getAgentLogsDb(), {
        start,
        end,
      });

      if (input.format === 'json') {
        return JSON.stringify(records, null, 2);
      }

      // CSV conversion
      if (records.length === 0) return '';
      const first = records[0]!;
      const headers = Object.keys(first);
      const rows = records.map((r) =>
        headers
          .map((h) => {
            const val = (r as Record<string, unknown>)[h];
            return String(val ?? '');
          })
          .join(','),
      );
      return [headers.join(','), ...rows].join('\n');
    }),
});
