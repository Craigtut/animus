/**
 * Observation Processor — Main orchestrator for observational memory.
 *
 * This module is the entry point called by the heartbeat pipeline.
 * It checks token thresholds, triggers Observer/Reflector agents when
 * overflow exceeds batch thresholds, and manages concurrency.
 *
 * See docs/architecture/observational-memory.md — Pipeline Integration.
 */

import type Database from 'better-sqlite3';
import type { AgentManager } from '@animus-labs/agents';
import type { IEventBus, StreamType, Observation } from '@animus-labs/shared';
import { estimateTokens, generateUUID } from '@animus-labs/shared';
import { OBSERVATIONAL_MEMORY_CONFIG } from '../../config/observational-memory.config.js';
import * as memoryStore from '../../db/stores/memory-store.js';
import { runObserver } from './observer.js';
import { runReflector } from './reflector.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('ObservationProcessor', 'memory');

/**
 * Format an ISO timestamp in the configured timezone for observer batch items.
 * Produces "Feb 14, 2026, 3:30 PM" style output so the observer can extract
 * the correct local date and time.
 */
function formatItemTimestamp(isoString: string, timezone?: string): string {
  if (!timezone) return isoString;
  try {
    return new Date(isoString).toLocaleString('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return isoString;
  }
}

// ============================================================================
// Concurrency Protection
// ============================================================================

/**
 * Tracks active observation/reflection operations.
 * Key: `${contactId ?? 'global'}:${stream}`
 * Prevents concurrent observer/reflector for the same stream.
 */
const activeOps = new Map<string, boolean>();

function opsKey(stream: StreamType, contactId: string | null): string {
  return `${contactId ?? 'global'}:${stream}`;
}

// Exported for testing
export { activeOps };

/**
 * Wait for all active observation/reflection operations to complete.
 * Used during graceful shutdown to avoid cutting off in-flight work.
 */
export async function waitForActiveOps(timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (activeOps.size > 0) {
    if (Date.now() - start > timeoutMs) {
      log.warn(`Timed out waiting for ${activeOps.size} active operations to complete, force-clearing`);
      activeOps.clear();
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

// ============================================================================
// Types
// ============================================================================

export interface ObservationProcessorDeps {
  agentManager: AgentManager;
  memoryDb: Database.Database;
  compiledPersona: string;
  eventBus: IEventBus;
}

export interface RawItem {
  id: string;
  content: string;
  createdAt: string;
}

export interface StreamContext {
  observations: Observation | null;
  rawItems: RawItem[];            // budget-trimmed (for mind context window)
  allFilteredItems: RawItem[];    // watermark-filtered, NOT budget-trimmed (for processStream)
  rawTokenCount: number;
}

// ============================================================================
// Load Stream Context (used by GATHER)
// ============================================================================

/**
 * Load observations + raw items for a stream.
 * Replaces the old hard item-count limit with token-based loading.
 *
 * @param stream - Which stream to load
 * @param contactId - Contact ID for messages stream (null for thoughts/experiences)
 * @param memoryDb - Memory database handle
 * @param rawItems - Pre-loaded raw items (newest-first), unfiltered
 * @param rawTokenBudget - Maximum tokens for the raw window
 */
export function loadStreamContext(params: {
  stream: StreamType;
  contactId: string | null;
  memoryDb: Database.Database;
  rawItems: RawItem[];
  rawTokenBudget: number;
}): StreamContext {
  const { stream, contactId, memoryDb, rawItems, rawTokenBudget } = params;

  // Load existing observation
  const observation = memoryStore.getObservation(memoryDb, stream, contactId);
  const watermark = observation?.lastRawTimestamp ?? null;

  // Filter raw items: only those newer than the watermark
  let filteredItems = rawItems;
  if (watermark) {
    filteredItems = rawItems.filter(item => item.createdAt > watermark);
  }

  // Fill up to token budget (items are newest-first, so we take from the end for oldest-first,
  // but we want to keep newest items, so we iterate from newest and accumulate)
  let tokenCount = 0;
  const budgetedItems: RawItem[] = [];
  for (const item of filteredItems) {
    const itemTokens = estimateTokens(item.content);
    // Always include at least 1 item even if it exceeds budget
    if (tokenCount + itemTokens > rawTokenBudget && budgetedItems.length > 0) {
      break;
    }
    budgetedItems.push(item);
    tokenCount += itemTokens;
  }

  return {
    observations: observation,
    rawItems: budgetedItems,
    allFilteredItems: filteredItems,
    rawTokenCount: tokenCount,
  };
}

// ============================================================================
// Process a Single Stream
// ============================================================================

/**
 * Check thresholds and run observation/reflection for a single stream.
 * This is the core processing logic.
 */
export async function processStream(params: {
  deps: ObservationProcessorDeps;
  stream: StreamType;
  contactId: string | null;
  rawItems: RawItem[];
  config: typeof OBSERVATIONAL_MEMORY_CONFIG;
  timezone?: string;
}): Promise<void> {
  const { deps, stream, contactId, rawItems, config, timezone } = params;
  const key = opsKey(stream, contactId);

  // Concurrency guard — set immediately to prevent race conditions
  if (activeOps.get(key)) {
    log.debug(`Skipping ${stream} observation — already in progress for ${contactId ?? 'global'}`);
    return;
  }

  const streamConfig = config.streams[stream];

  // Count all raw items' tokens
  let totalRawTokens = 0;
  for (const item of rawItems) {
    totalRawTokens += estimateTokens(item.content);
  }

  // Check if overflow exceeds batch threshold
  const overflow = totalRawTokens - streamConfig.rawTokens;
  const batchThreshold = streamConfig.rawTokens * config.observeBatchThreshold;

  if (overflow <= batchThreshold) {
    return; // Not enough overflow to trigger observation
  }

  const cycleId = generateUUID();
  // Lock before any async work to prevent concurrent operations
  activeOps.set(key, true);

  try {
    // Calculate batch size from oldest items
    const batchTokenTarget = streamConfig.rawTokens * config.observeBatchSize;

    // Items come in newest-first order — we want the oldest items for the batch.
    // Reverse to get oldest-first, accumulate up to batch token target.
    const oldestFirst = [...rawItems].reverse();
    const batchItems: string[] = [];
    let batchTokens = 0;
    let lastBatchItem: RawItem | null = null;

    // DEBUG: log timezone and sample timestamp to diagnose observer time issues
    if (oldestFirst.length > 0) {
      const sample = oldestFirst[0]!;
      log.debug(`Observer batch timezone=${timezone ?? 'UNDEFINED'}, sample raw=${sample.createdAt}, formatted=${formatItemTimestamp(sample.createdAt, timezone)}`);
    }

    for (const item of oldestFirst) {
      const itemTokens = estimateTokens(item.content);
      if (batchTokens + itemTokens > batchTokenTarget && batchItems.length > 0) {
        break;
      }
      batchItems.push(`[${formatItemTimestamp(item.createdAt, timezone)}] ${item.content}`);
      batchTokens += itemTokens;
      lastBatchItem = item;
    }

    if (batchItems.length === 0) return;

    // Load existing observation
    const existingObs = memoryStore.getObservation(deps.memoryDb, stream, contactId);

    // Emit start event
    deps.eventBus.emit('observation:started', {
      stream,
      contactId,
      batchTokens,
      cycleId,
    });

    const startTime = Date.now();

    // Run observer
    const observerResult = await runObserver({
      agentManager: deps.agentManager,
      streamType: stream,
      compiledPersona: deps.compiledPersona,
      batchItems,
      existingObservations: existingObs?.content ?? null,
      config,
    });

    // Guard: don't advance watermark if observer produced empty output
    if (!observerResult.observations.trim()) {
      log.warn(`Observer produced empty output for ${stream} (${contactId ?? 'global'}), skipping watermark advancement`);
      deps.eventBus.emit('observation:completed', {
        stream,
        contactId,
        observedTokens: batchTokens,
        outputTokens: 0,
        durationMs: Date.now() - startTime,
        cycleId,
      });
      return;
    }

    // Combine new observations with existing
    const newContent = existingObs?.content
      ? `${existingObs.content}\n\n${observerResult.observations}`
      : observerResult.observations;
    const newTokenCount = estimateTokens(newContent);

    // Upsert observation with new watermark
    memoryStore.upsertObservation(deps.memoryDb, {
      stream,
      contactId,
      content: newContent,
      tokenCount: newTokenCount,
      lastRawId: lastBatchItem!.id,
      lastRawTimestamp: lastBatchItem!.createdAt,
    });

    const durationMs = Date.now() - startTime;
    deps.eventBus.emit('observation:completed', {
      stream,
      contactId,
      observedTokens: batchTokens,
      outputTokens: observerResult.tokenCount,
      durationMs,
      cycleId,
    });

    log.info(`Observed ${batchTokens} tokens → ${observerResult.tokenCount} tokens for ${stream} (${contactId ?? 'global'})`);

    // Check if observations now exceed their budget → trigger reflector
    if (newTokenCount > streamConfig.observationTokens) {
      await runReflection({
        deps,
        stream,
        contactId,
        observationId: memoryStore.getObservation(deps.memoryDb, stream, contactId)!.id,
        observationContent: newContent,
        observationGeneration: existingObs?.generation ?? 1,
        targetThreshold: streamConfig.observationTokens,
        config,
        cycleId,
      });
    }
  } catch (err) {
    deps.eventBus.emit('observation:failed', {
      stream,
      contactId,
      error: err instanceof Error ? err.message : String(err),
      cycleId,
    });
    log.warn(`Observation failed for ${stream} (${contactId ?? 'global'}):`, err);
  } finally {
    activeOps.delete(key);
  }
}

// ============================================================================
// Reflection Helper
// ============================================================================

async function runReflection(params: {
  deps: ObservationProcessorDeps;
  stream: StreamType;
  contactId: string | null;
  observationId: string;
  observationContent: string;
  observationGeneration: number;
  targetThreshold: number;
  config: typeof OBSERVATIONAL_MEMORY_CONFIG;
  cycleId: string;
}): Promise<void> {
  const { deps, stream, contactId, observationId, observationContent, observationGeneration, targetThreshold, config, cycleId } = params;

  const inputTokens = estimateTokens(observationContent);

  deps.eventBus.emit('reflection:started', {
    stream,
    contactId,
    inputTokens,
    compressionLevel: 0,
    cycleId,
  });

  const startTime = Date.now();

  try {
    const reflectorResult = await runReflector({
      agentManager: deps.agentManager,
      streamType: stream,
      compiledPersona: deps.compiledPersona,
      observations: observationContent,
      targetThreshold,
      config,
    });

    // Update the observation with reflected content
    const newGeneration = observationGeneration + reflectorResult.generation;
    memoryStore.updateObservationContent(
      deps.memoryDb,
      observationId,
      reflectorResult.observations,
      reflectorResult.tokenCount,
      newGeneration,
    );

    const durationMs = Date.now() - startTime;
    deps.eventBus.emit('reflection:completed', {
      stream,
      contactId,
      inputTokens,
      outputTokens: reflectorResult.tokenCount,
      generation: newGeneration,
      durationMs,
      cycleId,
    });

    log.info(`Reflected ${inputTokens} → ${reflectorResult.tokenCount} tokens for ${stream} (generation ${newGeneration})`);
  } catch (err) {
    deps.eventBus.emit('reflection:failed', {
      stream,
      contactId,
      error: err instanceof Error ? err.message : String(err),
      cycleId,
    });
    log.warn(`Reflection failed for ${stream} (${contactId ?? 'global'}):`, err);
  }
}

// ============================================================================
// Process All Streams (called from EXECUTE)
// ============================================================================

/**
 * Process all three streams. Called from the EXECUTE phase.
 * Runs sequentially to avoid overwhelming the agent provider.
 */
export async function processAllStreams(params: {
  deps: ObservationProcessorDeps;
  thoughts: RawItem[];
  experiences: RawItem[];
  messages: RawItem[];
  contactId: string | null;
  config: typeof OBSERVATIONAL_MEMORY_CONFIG;
  timezone?: string;
}): Promise<void> {
  const { deps, thoughts, experiences, messages, contactId, config, timezone } = params;

  // Process each stream sequentially
  await processStream({ deps, stream: 'thoughts', contactId: null, rawItems: thoughts, config, ...(timezone !== undefined && { timezone }) });
  await processStream({ deps, stream: 'experiences', contactId: null, rawItems: experiences, config, ...(timezone !== undefined && { timezone }) });

  if (contactId && messages.length > 0) {
    await processStream({ deps, stream: 'messages', contactId, rawItems: messages, config, ...(timezone !== undefined && { timezone }) });
  }
}
