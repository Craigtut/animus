/**
 * Heartbeat System
 *
 * The heartbeat is the core tick system that drives Animus's inner life.
 * Each tick triggers a cascade of cognition: thoughts form, experiences emerge,
 * emotions shift, memories consolidate, and agency considers action.
 */

import { getHeartbeatDb, getSystemDb } from '../db/index.js';
import { env } from '../utils/env.js';
import type { HeartbeatPhase, HeartbeatState } from '@animus/shared';

// The sequential phases of each heartbeat tick
const HEARTBEAT_PHASES: HeartbeatPhase[] = [
  'perceive',  // Gather inputs, check for messages, observe environment
  'think',     // Process information, generate thoughts
  'feel',      // Evaluate emotional responses
  'decide',    // Determine if action is needed
  'act',       // Execute any decided actions
  'reflect',   // Review what happened this tick
  'consolidate', // Update memories, clean up
];

let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Get the current heartbeat state
 */
export function getHeartbeatState(): HeartbeatState {
  const db = getHeartbeatDb();
  const row = db.prepare(`
    SELECT tick_number, current_phase, pipeline_progress, started_at, last_tick_at, is_running
    FROM heartbeat_state
    WHERE id = 1
  `).get() as {
    tick_number: number;
    current_phase: string;
    pipeline_progress: string;
    started_at: string;
    last_tick_at: string | null;
    is_running: number;
  };

  return {
    tickNumber: row.tick_number,
    currentPhase: row.current_phase as HeartbeatPhase,
    pipelineProgress: JSON.parse(row.pipeline_progress) as HeartbeatPhase[],
    startedAt: row.started_at,
    lastTickAt: row.last_tick_at,
    isRunning: row.is_running === 1,
  };
}

/**
 * Update heartbeat state
 */
function updateHeartbeatState(updates: Partial<{
  tickNumber: number;
  currentPhase: HeartbeatPhase;
  pipelineProgress: HeartbeatPhase[];
  lastTickAt: string;
  isRunning: boolean;
}>): void {
  const db = getHeartbeatDb();
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.tickNumber !== undefined) {
    sets.push('tick_number = ?');
    values.push(updates.tickNumber);
  }
  if (updates.currentPhase !== undefined) {
    sets.push('current_phase = ?');
    values.push(updates.currentPhase);
  }
  if (updates.pipelineProgress !== undefined) {
    sets.push('pipeline_progress = ?');
    values.push(JSON.stringify(updates.pipelineProgress));
  }
  if (updates.lastTickAt !== undefined) {
    sets.push('last_tick_at = ?');
    values.push(updates.lastTickAt);
  }
  if (updates.isRunning !== undefined) {
    sets.push('is_running = ?');
    values.push(updates.isRunning ? 1 : 0);
  }

  if (sets.length > 0) {
    db.prepare(`UPDATE heartbeat_state SET ${sets.join(', ')} WHERE id = 1`).run(...values);
  }
}

/**
 * Execute a single heartbeat tick
 */
async function executeTick(): Promise<void> {
  const state = getHeartbeatState();
  const newTickNumber = state.tickNumber + 1;

  console.log(`[Heartbeat] Starting tick #${newTickNumber}`);

  // Check if we need to resume from an interrupted tick
  const startPhaseIndex = state.pipelineProgress.length > 0
    ? HEARTBEAT_PHASES.indexOf(state.pipelineProgress[state.pipelineProgress.length - 1]!) + 1
    : 0;

  // Execute each phase in sequence
  for (let i = startPhaseIndex; i < HEARTBEAT_PHASES.length; i++) {
    const phase = HEARTBEAT_PHASES[i]!;

    // Update state before executing phase (for crash recovery)
    updateHeartbeatState({
      tickNumber: newTickNumber,
      currentPhase: phase,
      pipelineProgress: HEARTBEAT_PHASES.slice(0, i),
    });

    console.log(`[Heartbeat] Executing phase: ${phase}`);

    try {
      await executePhase(phase, newTickNumber);
    } catch (error) {
      console.error(`[Heartbeat] Error in phase ${phase}:`, error);
      // Continue to next phase even if one fails
    }

    // Update progress after completing phase
    updateHeartbeatState({
      pipelineProgress: HEARTBEAT_PHASES.slice(0, i + 1),
    });
  }

  // Tick complete
  updateHeartbeatState({
    currentPhase: 'idle',
    pipelineProgress: [],
    lastTickAt: new Date().toISOString(),
  });

  console.log(`[Heartbeat] Completed tick #${newTickNumber}`);
}

/**
 * Execute a specific heartbeat phase
 */
async function executePhase(phase: HeartbeatPhase, tickNumber: number): Promise<void> {
  // TODO: Implement each phase
  // For now, these are placeholders that will be filled in as we build out the system

  switch (phase) {
    case 'perceive':
      // Check for new messages, observe environment
      break;

    case 'think':
      // Generate thoughts based on current context
      // This is where the agent SDK will be called
      break;

    case 'feel':
      // Evaluate emotional state based on thoughts and experiences
      break;

    case 'decide':
      // Determine if any action should be taken
      break;

    case 'act':
      // Execute decided actions
      break;

    case 'reflect':
      // Review what happened this tick
      break;

    case 'consolidate':
      // Update memories, clean up expired entries
      await cleanupExpiredEntries();
      break;
  }
}

/**
 * Clean up expired thoughts, experiences, emotions, and logs
 */
async function cleanupExpiredEntries(): Promise<void> {
  const heartbeatDb = getHeartbeatDb();
  const now = new Date().toISOString();

  // Clean up expired thoughts
  heartbeatDb.prepare(`
    DELETE FROM thoughts WHERE expires_at IS NOT NULL AND expires_at < ?
  `).run(now);

  // Clean up expired experiences
  heartbeatDb.prepare(`
    DELETE FROM experiences WHERE expires_at IS NOT NULL AND expires_at < ?
  `).run(now);

  // Clean up expired emotions
  heartbeatDb.prepare(`
    DELETE FROM emotions WHERE expires_at IS NOT NULL AND expires_at < ?
  `).run(now);

  // TODO: Clean up agent logs based on retention settings
}

/**
 * Initialize and start the heartbeat system
 */
export async function initializeHeartbeat(): Promise<void> {
  const state = getHeartbeatState();

  // Check if we need to resume an interrupted tick
  if (state.pipelineProgress.length > 0 && state.currentPhase !== 'idle') {
    console.log('[Heartbeat] Resuming interrupted tick...');
    await executeTick();
  }

  // Start the heartbeat interval
  startHeartbeat();
}

/**
 * Start the heartbeat interval
 */
export function startHeartbeat(): void {
  if (heartbeatInterval) {
    console.log('[Heartbeat] Already running');
    return;
  }

  updateHeartbeatState({ isRunning: true });

  // Execute first tick immediately, then schedule subsequent ticks
  executeTick().catch(console.error);

  heartbeatInterval = setInterval(() => {
    executeTick().catch(console.error);
  }, env.HEARTBEAT_INTERVAL_MS);

  console.log(`[Heartbeat] Started with interval of ${env.HEARTBEAT_INTERVAL_MS}ms`);
}

/**
 * Stop the heartbeat
 */
export function stopHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
    updateHeartbeatState({ isRunning: false });
    console.log('[Heartbeat] Stopped');
  }
}

/**
 * Manually trigger a heartbeat tick
 */
export async function triggerTick(): Promise<void> {
  await executeTick();
}
