/**
 * Heartbeat Router — tRPC procedures for heartbeat state, emotions, and control.
 */

import { z } from 'zod';
import { observable } from '@trpc/server/observable';
import { router, protectedProcedure } from '../trpc.js';
import { getHeartbeatDb, getAgentLogsDb } from '../../db/index.js';
import * as heartbeatStore from '../../db/stores/heartbeat-store.js';
import * as agentLogStore from '../../db/stores/agent-log-store.js';
import {
  startHeartbeat,
  stopHeartbeat,
  getHeartbeatStatus,
  triggerTick,
  updateHeartbeatInterval,
  recompilePersona,
} from '../../heartbeat/index.js';
import { getEventBus } from '../../lib/event-bus.js';
import type { HeartbeatState, EmotionState, Thought, Experience, TickDecision, EnergyBand, EnergyHistoryEntry, AgentEventType } from '@animus/shared';
import * as systemStore from '../../db/stores/system-store.js';
import { getSystemDb } from '../../db/index.js';
import { getEnergyBand, computeCircadianBaseline } from '../../heartbeat/energy-engine.js';
import { snakeToCamel } from '../../db/utils.js';

export const heartbeatRouter = router({
  /**
   * Get current heartbeat state.
   */
  getState: protectedProcedure.query(() => {
    return getHeartbeatStatus();
  }),

  /**
   * Get current emotion states.
   */
  getEmotions: protectedProcedure.query(() => {
    const db = getHeartbeatDb();
    return heartbeatStore.getEmotionStates(db);
  }),

  /**
   * Get recent thoughts.
   */
  getRecentThoughts: protectedProcedure
    .input(z.object({ limit: z.number().int().positive().max(50).default(20) }).optional())
    .query(({ input }) => {
      const db = getHeartbeatDb();
      return heartbeatStore.getRecentThoughts(db, input?.limit ?? 20);
    }),

  /**
   * Get recent experiences.
   */
  getRecentExperiences: protectedProcedure
    .input(z.object({ limit: z.number().int().positive().max(50).default(20) }).optional())
    .query(({ input }) => {
      const db = getHeartbeatDb();
      return heartbeatStore.getRecentExperiences(db, input?.limit ?? 20);
    }),

  /**
   * Paginated thoughts for the journal.
   */
  getThoughtsPaginated: protectedProcedure
    .input(z.object({
      limit: z.number().int().positive().max(50).default(20),
      cursor: z.string().optional(),
      importantOnly: z.boolean().optional(),
    }))
    .query(({ input }) => {
      const db = getHeartbeatDb();
      const items = heartbeatStore.getThoughtsPaginated(db, input.limit + 1, input.cursor, input.importantOnly);
      const hasMore = items.length > input.limit;
      const results = hasMore ? items.slice(0, input.limit) : items;
      return {
        items: results,
        nextCursor: hasMore ? results[results.length - 1]?.createdAt : undefined,
      };
    }),

  /**
   * Paginated experiences for the journal.
   */
  getExperiencesPaginated: protectedProcedure
    .input(z.object({
      limit: z.number().int().positive().max(50).default(20),
      cursor: z.string().optional(),
      importantOnly: z.boolean().optional(),
    }))
    .query(({ input }) => {
      const db = getHeartbeatDb();
      const items = heartbeatStore.getExperiencesPaginated(db, input.limit + 1, input.cursor, input.importantOnly);
      const hasMore = items.length > input.limit;
      const results = hasMore ? items.slice(0, input.limit) : items;
      return {
        items: results,
        nextCursor: hasMore ? results[results.length - 1]?.createdAt : undefined,
      };
    }),

  /**
   * Get tick decisions for a specific tick.
   */
  getTickDecisions: protectedProcedure
    .input(z.object({ tickNumber: z.number().int().nonnegative() }))
    .query(({ input }) => {
      const db = getHeartbeatDb();
      return heartbeatStore.getTickDecisions(db, input.tickNumber);
    }),

  /**
   * Get recent decisions across all ticks (for the Mind page).
   */
  getRecentDecisions: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().positive().max(100).default(50),
        since: z.string().optional(),
      }).optional()
    )
    .query(({ input }) => {
      const db = getHeartbeatDb();
      return heartbeatStore.getRecentDecisions(db, {
        limit: input?.limit ?? 50,
        ...(input?.since !== undefined && { since: input.since }),
      });
    }),

  /**
   * Start the heartbeat system.
   */
  start: protectedProcedure.mutation(() => {
    startHeartbeat();
    return getHeartbeatStatus();
  }),

  /**
   * Stop the heartbeat system.
   */
  stop: protectedProcedure.mutation(async () => {
    await stopHeartbeat();
    return getHeartbeatStatus();
  }),

  /**
   * Manually trigger a heartbeat tick (for testing).
   */
  triggerTick: protectedProcedure.mutation(async () => {
    await triggerTick();
    return getHeartbeatStatus();
  }),

  /**
   * Update heartbeat interval.
   */
  updateInterval: protectedProcedure
    .input(z.object({ intervalMs: z.number().int().positive().min(30000).max(3600000) }))
    .mutation(({ input }) => {
      updateHeartbeatInterval(input.intervalMs);
      return { intervalMs: input.intervalMs };
    }),

  /**
   * Subscribe to heartbeat state changes (real-time updates).
   */
  onStateChange: protectedProcedure.subscription(() => {
    return observable<HeartbeatState>((emit) => {
      const eventBus = getEventBus();
      const handler = (state: HeartbeatState) => {
        emit.next(state);
      };
      eventBus.on('heartbeat:state_change', handler);

      // Emit current state immediately
      emit.next(getHeartbeatStatus());

      return () => {
        eventBus.off('heartbeat:state_change', handler);
      };
    });
  }),

  /**
   * Subscribe to emotion state updates.
   */
  onEmotionChange: protectedProcedure.subscription(() => {
    return observable<EmotionState>((emit) => {
      const eventBus = getEventBus();
      const handler = (emotion: EmotionState) => {
        emit.next(emotion);
      };
      eventBus.on('emotion:updated', handler);

      return () => {
        eventBus.off('emotion:updated', handler);
      };
    });
  }),

  /**
   * Subscribe to new thoughts.
   */
  onThoughts: protectedProcedure.subscription(() => {
    return observable<Thought>((emit) => {
      const eventBus = getEventBus();
      const handler = (thought: Thought) => {
        emit.next(thought);
      };
      eventBus.on('thought:created', handler);

      return () => {
        eventBus.off('thought:created', handler);
      };
    });
  }),

  /**
   * Subscribe to new experiences.
   */
  onExperience: protectedProcedure.subscription(() => {
    return observable<Experience>((emit) => {
      const eventBus = getEventBus();
      const handler = (experience: Experience) => {
        emit.next(experience);
      };
      eventBus.on('experience:created', handler);

      return () => {
        eventBus.off('experience:created', handler);
      };
    });
  }),

  /**
   * Subscribe to agent lifecycle events.
   */
  onAgentStatus: protectedProcedure.subscription(() => {
    return observable<{
      type: 'spawned' | 'completed' | 'failed' | 'cancelled' | 'rate_limited';
      taskId: string;
      detail?: string;
    }>((emit) => {
      const eventBus = getEventBus();

      const onSpawned = (data: { taskId: string; provider: string }) => {
        emit.next({ type: 'spawned', taskId: data.taskId, detail: data.provider });
      };
      const onCompleted = (data: { taskId: string; result: string | null }) => {
        const event: { type: 'completed'; taskId: string; detail?: string } = {
          type: 'completed',
          taskId: data.taskId,
        };
        if (data.result !== null) event.detail = data.result;
        emit.next(event);
      };
      const onFailed = (data: { taskId: string; error: string }) => {
        emit.next({ type: 'failed', taskId: data.taskId, detail: data.error });
      };
      const onCancelled = (data: { taskId: string; reason: string }) => {
        emit.next({ type: 'cancelled', taskId: data.taskId, detail: data.reason });
      };
      const onRateLimited = (data: { taskId: string; count: number; limit: number }) => {
        emit.next({ type: 'rate_limited', taskId: data.taskId, detail: `${data.count}/${data.limit}` });
      };

      eventBus.on('agent:spawned', onSpawned);
      eventBus.on('agent:completed', onCompleted);
      eventBus.on('agent:failed', onFailed);
      eventBus.on('agent:cancelled', onCancelled);
      eventBus.on('agent:rate_limited', onRateLimited);

      return () => {
        eventBus.off('agent:spawned', onSpawned);
        eventBus.off('agent:completed', onCompleted);
        eventBus.off('agent:failed', onFailed);
        eventBus.off('agent:cancelled', onCancelled);
        eventBus.off('agent:rate_limited', onRateLimited);
      };
    });
  }),

  /**
   * Subscribe to tick decisions in real time.
   */
  onDecision: protectedProcedure.subscription(() => {
    return observable<TickDecision>((emit) => {
      const eventBus = getEventBus();
      const handler = (decision: TickDecision) => emit.next(decision);
      eventBus.on('decision:made', handler);
      return () => eventBus.off('decision:made', handler);
    });
  }),

  /**
   * Get emotion history for sparklines/charts.
   */
  getEmotionHistory: protectedProcedure
    .input(
      z.object({
        emotion: z.string().optional(),
        since: z.string().optional(),
        limit: z.number().int().positive().max(500).default(100),
      }).optional()
    )
    .query(({ input }) => {
      const db = getHeartbeatDb();
      const opts: { emotion?: import('@animus/shared').EmotionName; since?: string; limit?: number } = {};
      if (input?.emotion) opts.emotion = input.emotion as import('@animus/shared').EmotionName;
      if (input?.since) opts.since = input.since;
      opts.limit = input?.limit ?? 100;
      return heartbeatStore.getEmotionHistory(db, opts);
    }),

  /**
   * Subscribe to real-time reply streaming from the mind.
   * Emits reply chunks as the agent generates them, turn_complete when a turn's
   * text has been persisted as a message, and complete when the full reply is done.
   */
  onReply: protectedProcedure.subscription(() => {
    return observable<{
      type: 'chunk' | 'turn_complete' | 'complete';
      content: string;
      turnIndex?: number;
      tickNumber?: number;
      totalTurns?: number;
    }>((emit) => {
      const eventBus = getEventBus();

      const chunkHandler = (data: { content: string; accumulated: string; turnIndex: number }) => {
        emit.next({ type: 'chunk', content: data.content, turnIndex: data.turnIndex });
      };

      const turnCompleteHandler = (data: { turnIndex: number; content: string; tickNumber: number }) => {
        emit.next({ type: 'turn_complete', content: data.content, turnIndex: data.turnIndex, tickNumber: data.tickNumber });
      };

      const completeHandler = (data: { content: string; tickNumber: number; totalTurns: number }) => {
        emit.next({ type: 'complete', content: data.content, tickNumber: data.tickNumber, totalTurns: data.totalTurns });
      };

      eventBus.on('reply:chunk', chunkHandler);
      eventBus.on('reply:turn_complete', turnCompleteHandler);
      eventBus.on('reply:complete', completeHandler);

      return () => {
        eventBus.off('reply:chunk', chunkHandler);
        eventBus.off('reply:turn_complete', turnCompleteHandler);
        eventBus.off('reply:complete', completeHandler);
      };
    });
  }),

  // ========================================================================
  // Energy
  // ========================================================================

  /**
   * Get current energy state.
   */
  getEnergyState: protectedProcedure.query(() => {
    const hbDb = getHeartbeatDb();
    const sysDb = getSystemDb();
    const settings = systemStore.getSystemSettings(sysDb);

    if (!settings.energySystemEnabled) {
      return { energyLevel: null, energyBand: null, circadianBaseline: null, enabled: false };
    }

    const { energyLevel } = heartbeatStore.getEnergyLevel(hbDb);
    const circadianBaseline = computeCircadianBaseline(
      new Date(),
      settings.sleepStartHour,
      settings.sleepEndHour,
      settings.timezone || 'UTC'
    );

    return {
      energyLevel,
      energyBand: getEnergyBand(energyLevel),
      circadianBaseline,
      enabled: true,
    };
  }),

  /**
   * Get energy history for visualization.
   */
  getEnergyHistory: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().positive().max(500).default(100),
      }).optional()
    )
    .query(({ input }) => {
      const db = getHeartbeatDb();
      return heartbeatStore.getEnergyHistory(db, { limit: input?.limit ?? 100 });
    }),

  /**
   * Subscribe to energy state changes.
   */
  onEnergyChange: protectedProcedure.subscription(() => {
    return observable<{ energyLevel: number; band: EnergyBand }>((emit) => {
      const eventBus = getEventBus();
      const handler = (data: { energyLevel: number; band: EnergyBand }) => {
        emit.next(data);
      };
      eventBus.on('energy:updated', handler);

      return () => {
        eventBus.off('energy:updated', handler);
      };
    });
  }),

  // ========================================================================
  // Tick Inspector (Heartbeats tab)
  // ========================================================================

  /**
   * List ticks with summary info, paginated.
   */
  listTicks: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().positive().max(50).default(20),
        offset: z.number().int().nonnegative().default(0),
      }).optional()
    )
    .query(({ input }) => {
      const agentLogsDb = getAgentLogsDb();
      const hbDb = getHeartbeatDb();
      const limit = input?.limit ?? 20;
      const offset = input?.offset ?? 0;

      const { events, total } = agentLogStore.listTickEvents(agentLogsDb, { limit, offset });

      interface TickInputData {
        tickNumber: number;
        triggerType: string;
        sessionState: string;
        tokenBreakdown?: Record<string, number>;
      }

      interface TickOutputData {
        durationMs?: number | null;
      }

      const ticks = events.map((event) => {
        const data = event.data as unknown as TickInputData;

        // Get thought preview from heartbeat.db
        const thought = hbDb
          .prepare('SELECT content FROM thoughts WHERE tick_number = ? LIMIT 1')
          .get(data.tickNumber) as { content: string } | undefined;

        // Get duration from tick_output event
        const { output } = agentLogStore.getTickEvents(agentLogsDb, data.tickNumber);
        const outData = output ? (output.data as unknown as TickOutputData) : null;

        return {
          tickNumber: data.tickNumber,
          triggerType: data.triggerType,
          sessionState: data.sessionState,
          tokenBreakdown: data.tokenBreakdown,
          thoughtPreview: thought?.content?.slice(0, 100) ?? null,
          durationMs: outData?.durationMs ?? null,
          createdAt: event.createdAt,
        };
      });

      return { ticks, total };
    }),

  /**
   * Get full tick detail for inspection.
   */
  getTickDetail: protectedProcedure
    .input(z.object({ tickNumber: z.number().int().positive() }))
    .query(({ input }) => {
      const agentLogsDb = getAgentLogsDb();
      const hbDb = getHeartbeatDb();
      const { tickNumber } = input;

      const { input: tickInput, output: tickOutput } = agentLogStore.getTickEvents(
        agentLogsDb,
        tickNumber
      );

      if (!tickInput) {
        return null;
      }

      interface TickInputData {
        tickNumber: number;
        triggerType: string;
        triggerContext: unknown;
        sessionState: string;
        systemPrompt: string | null;
        userMessage: string;
        tokenBreakdown?: Record<string, number>;
      }

      interface TickOutputData {
        rawOutput: unknown;
        durationMs: number | null;
      }

      const inputData = tickInput.data as unknown as TickInputData;
      const outputData = tickOutput
        ? (tickOutput.data as unknown as TickOutputData)
        : null;

      // For warm sessions, resolve the system prompt from the last cold session
      let systemPrompt = inputData.systemPrompt;
      if (!systemPrompt) {
        systemPrompt = agentLogStore.getLastColdSystemPrompt(agentLogsDb);
      }

      // Get related data from heartbeat.db
      const thoughts = hbDb
        .prepare('SELECT * FROM thoughts WHERE tick_number = ? ORDER BY created_at')
        .all(tickNumber) as Array<Record<string, unknown>>;

      const experiences = hbDb
        .prepare('SELECT * FROM experiences WHERE tick_number = ? ORDER BY created_at')
        .all(tickNumber) as Array<Record<string, unknown>>;

      const emotionHistory = hbDb
        .prepare('SELECT * FROM emotion_history WHERE tick_number = ? ORDER BY created_at')
        .all(tickNumber) as Array<Record<string, unknown>>;

      const decisions = heartbeatStore.getTickDecisions(hbDb, tickNumber);

      // Get usage from agent_usage for this session
      let usage = null;
      if (tickInput.sessionId) {
        const usages = agentLogStore.getSessionUsage(agentLogsDb, tickInput.sessionId);
        if (usages.length > 0) {
          usage = usages[usages.length - 1]!;
        }
      }

      return {
        tickNumber,
        triggerType: inputData.triggerType,
        triggerContext: inputData.triggerContext,
        sessionState: inputData.sessionState,
        systemPrompt,
        userMessage: inputData.userMessage,
        tokenBreakdown: inputData.tokenBreakdown,
        rawOutput: outputData?.rawOutput ?? null,
        durationMs: outputData?.durationMs ?? null,
        thoughts,
        experiences,
        emotionHistory,
        decisions,
        usage,
        createdAt: tickInput.createdAt,
      };
    }),

  /**
   * Subscribe to tick input stored events (fires early, before LLM prompting).
   */
  onTickInputStored: protectedProcedure.subscription(() => {
    return observable<{ tickNumber: number; triggerType: string; sessionState: string }>((emit) => {
      const eventBus = getEventBus();
      const handler = (data: { tickNumber: number; triggerType: string; sessionState: string }) => {
        emit.next(data);
      };
      eventBus.on('tick:input_stored', handler);
      return () => {
        eventBus.off('tick:input_stored', handler);
      };
    });
  }),

  /**
   * Subscribe to tick context stored events (real-time).
   */
  onTickStored: protectedProcedure.subscription(() => {
    type TickStoredPayload = {
      tickNumber: number;
      triggerType: string;
      sessionState: string;
      durationMs: number | null;
      createdAt: string;
    };

    return observable<TickStoredPayload>((emit) => {
      const eventBus = getEventBus();
      const handler = (data: TickStoredPayload) => {
        emit.next(data);
      };
      eventBus.on('tick:context_stored', handler);
      return () => {
        eventBus.off('tick:context_stored', handler);
      };
    });
  }),

  // ========================================================================
  // Agent Timeline
  // ========================================================================

  /**
   * Get full timeline for a specific tick: events, results, and usage.
   */
  getTickTimeline: protectedProcedure
    .input(z.object({ tickNumber: z.number().int().positive() }))
    .query(({ input }) => {
      const agentLogsDb = getAgentLogsDb();
      const hbDb = getHeartbeatDb();
      const { tickNumber } = input;

      // Get timeline events from agent_logs.db
      const events = agentLogStore.getTimelineForTick(agentLogsDb, tickNumber);
      if (!events) return null;

      // Extract triggerType and sessionState from tick_input event data
      const tickInputEvent = events.find((e) => e.eventType === 'tick_input');
      const tickInputData = tickInputEvent?.data as Record<string, unknown> | undefined;
      const triggerType = (tickInputData?.['triggerType'] as string) ?? 'unknown';
      const sessionState = (tickInputData?.['sessionState'] as string) ?? 'unknown';
      const sessionId = tickInputEvent?.sessionId ?? '';

      // Check if tick is complete (has tick_output)
      const tickOutputEvent = events.find((e) => e.eventType === 'tick_output');
      const isComplete = !!tickOutputEvent;
      const tickOutputData = tickOutputEvent?.data as Record<string, unknown> | undefined;
      const durationMs = (tickOutputData?.['durationMs'] as number) ?? null;

      // Get tick results from heartbeat.db
      const thoughts = (hbDb
        .prepare('SELECT * FROM thoughts WHERE tick_number = ? ORDER BY created_at')
        .all(tickNumber) as Array<Record<string, unknown>>)
        .map((row) => snakeToCamel<Thought>(row));

      const experiences = (hbDb
        .prepare('SELECT * FROM experiences WHERE tick_number = ? ORDER BY created_at')
        .all(tickNumber) as Array<Record<string, unknown>>)
        .map((row) => snakeToCamel<Experience>(row));

      const emotionHistory = (hbDb
        .prepare('SELECT * FROM emotion_history WHERE tick_number = ? ORDER BY created_at')
        .all(tickNumber) as Array<Record<string, unknown>>)
        .map((row) => snakeToCamel<Record<string, unknown>>(row));

      const decisions = heartbeatStore.getTickDecisions(hbDb, tickNumber);

      // Extract reply from the tick_output rawOutput (the full MindOutput)
      const rawOutput = tickOutputData?.['rawOutput'] as Record<string, unknown> | undefined;
      const reply = (rawOutput?.['reply'] as { content: string; contactId: string; channel: string; replyToMessageId?: string; tone?: string } | null) ?? null;

      // Get usage from agent_usage for this session
      let usage = null;
      if (sessionId) {
        const usages = agentLogStore.getSessionUsage(agentLogsDb, sessionId);
        if (usages.length > 0) {
          usage = usages[usages.length - 1]!;
        }
      }

      return {
        tickNumber,
        sessionId,
        triggerType,
        sessionState,
        isComplete,
        durationMs,
        createdAt: tickInputEvent?.createdAt ?? '',
        events,
        results: {
          thoughts,
          experiences,
          emotionHistory,
          decisions,
          reply,
        },
        usage,
      };
    }),

  /**
   * Subscribe to agent events in real-time (for live timeline updates).
   */
  onAgentEvent: protectedProcedure.subscription(() => {
    return observable<{
      id: string;
      sessionId: string;
      eventType: AgentEventType;
      data: Record<string, unknown>;
      createdAt: string;
    }>((emit) => {
      const eventBus = getEventBus();
      const handler = (data: {
        id: string;
        sessionId: string;
        eventType: AgentEventType;
        data: Record<string, unknown>;
        createdAt: string;
      }) => {
        emit.next(data);
      };
      eventBus.on('agent:event:logged', handler);
      return () => {
        eventBus.off('agent:event:logged', handler);
      };
    });
  }),
});
