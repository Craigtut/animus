import type { PhaseUsage } from '@animus-labs/shared';
import type {
  TimelineEvent,
  PhaseGroup,
  PhaseName,
  AgenticTurn,
  MergedEvent,
} from './types';
import { PHASE_LABELS } from './types';

// ============================================================================
// Phase boundary event types
// ============================================================================

const PHASE_START_EVENTS: Record<string, PhaseName> = {
  gather_start: 'gather',
  thought_start: 'thought',
  agentic_start: 'agentic_loop',
  reflect_start: 'reflect',
  execute_start: 'execute',
};

const PHASE_END_EVENTS: Record<string, PhaseName> = {
  gather_end: 'gather',
  thought_end: 'thought',
  agentic_end: 'agentic_loop',
  reflect_end: 'reflect',
  execute_complete: 'execute',
};

// Events to exclude from the agentic loop's turn display
const AGENTIC_BOUNDARY_EVENTS = new Set([
  'agentic_start',
  'agentic_end',
]);

// ============================================================================
// groupEventsIntoPhases
// ============================================================================

/**
 * Groups a flat chronological event array into 5 pipeline phases.
 * Falls back to a single "gather" phase if no phase boundary events exist.
 */
export function groupEventsIntoPhases(
  events: TimelineEvent[],
  phaseUsage: PhaseUsage[],
): PhaseGroup[] {
  const phases: Record<PhaseName, PhaseGroup> = {
    gather: createPhase('gather'),
    thought: createPhase('thought'),
    agentic_loop: createPhase('agentic_loop'),
    reflect: createPhase('reflect'),
    execute: createPhase('execute'),
  };

  // Build a map of phase usage by phase name
  const usageMap = new Map<string, PhaseUsage>();
  for (const u of phaseUsage) {
    usageMap.set(u.phase, u);
  }
  const thoughtUsage = usageMap.get('thought');
  if (thoughtUsage) phases.thought.usage = thoughtUsage;
  const agenticUsage = usageMap.get('agentic_loop');
  if (agenticUsage) phases.agentic_loop.usage = agenticUsage;
  const reflectUsage = usageMap.get('reflect');
  if (reflectUsage) phases.reflect.usage = reflectUsage;

  // Check if we have any phase boundary events
  const hasPhaseBoundaries = events.some(
    (e) => e.eventType in PHASE_START_EVENTS || e.eventType in PHASE_END_EVENTS,
  );

  if (!hasPhaseBoundaries) {
    // Legacy tick or no phases: put everything in gather
    phases.gather.events = events;
    phases.gather.status = 'complete';
    if (events.length > 0) {
      phases.gather.startMs = events[0]!.relativeMs;
      phases.gather.endMs = events[events.length - 1]!.relativeMs;
      phases.gather.durationMs = phases.gather.endMs - phases.gather.startMs;
    }
    return [phases.gather];
  }

  // Walk events and assign to phases
  let currentPhase: PhaseName = 'gather';

  for (const event of events) {
    const startPhase = PHASE_START_EVENTS[event.eventType];
    const endPhase = PHASE_END_EVENTS[event.eventType];

    if (startPhase) {
      currentPhase = startPhase;
      const phase = phases[startPhase]!;
      phase.startMs = event.relativeMs;
      phase.status = 'running';
      phase.events.push(event);
      continue;
    }

    if (endPhase) {
      const phase = phases[endPhase]!;
      phase.endMs = event.relativeMs;
      if (phase.startMs != null) {
        phase.durationMs = phase.endMs - phase.startMs;
      }
      // Check for failure
      const failed = event.data['failed'] === true;
      phase.status = failed ? 'failed' : 'complete';
      phase.events.push(event);

      // After a phase end, we're in a gap until the next phase starts.
      // Assign gap events to the just-closed phase.
      continue;
    }

    // Regular event: assign to current phase
    phases[currentPhase]!.events.push(event);
  }

  // Infer gather phase timing (fallback for ticks without explicit gather_start/gather_end)
  if (phases.gather.status === 'pending' || phases.gather.status === 'running') {
    if (phases.gather.events.length > 0) {
      phases.gather.startMs = phases.gather.events[0]!.relativeMs;
      const gatherEnd = phases.thought.startMs ?? phases.gather.events[phases.gather.events.length - 1]!.relativeMs;
      phases.gather.endMs = gatherEnd;
      phases.gather.durationMs = gatherEnd - phases.gather.startMs;
      phases.gather.status = 'complete';
    } else {
      phases.gather.status = 'skipped';
    }
  }

  // Mark phases that never started as skipped
  for (const phase of Object.values(phases)) {
    if (phase.status === 'pending' && phase.events.length === 0) {
      phase.status = 'skipped';
    }
  }

  // Group turns within the agentic loop
  if (phases.agentic_loop.status !== 'skipped') {
    phases.agentic_loop.turns = groupTurns(phases.agentic_loop.events);
  }

  return [phases.gather, phases.thought, phases.agentic_loop, phases.reflect, phases.execute];
}

function createPhase(name: PhaseName): PhaseGroup {
  return {
    name,
    label: PHASE_LABELS[name],
    startMs: null,
    endMs: null,
    durationMs: null,
    status: 'pending',
    events: [],
  };
}

// ============================================================================
// groupTurns
// ============================================================================

/**
 * Groups agentic loop events into turns, splitting on turn_end events.
 * Extracts per-turn token usage from turn_end data.
 * Compaction events between turns go into the preceding turn's compactionAfter.
 */
export function groupTurns(agenticEvents: TimelineEvent[]): AgenticTurn[] {
  const turns: AgenticTurn[] = [];
  let currentTurnEvents: TimelineEvent[] = [];
  let turnNumber = 1;
  let turnStartMs: number | null = null;

  for (const event of agenticEvents) {
    // Skip phase boundary events
    if (AGENTIC_BOUNDARY_EVENTS.has(event.eventType)) continue;

    if (turnStartMs === null) {
      turnStartMs = event.relativeMs;
    }

    if (event.eventType === 'turn_end') {
      // Close the current turn
      const usage = event.data;
      turns.push({
        turnNumber,
        startMs: turnStartMs ?? event.relativeMs,
        endMs: event.relativeMs,
        durationMs: turnStartMs != null ? event.relativeMs - turnStartMs : null,
        inputTokens: (usage['inputTokens'] as number) ?? null,
        outputTokens: (usage['outputTokens'] as number) ?? null,
        cacheReadTokens: (usage['cacheReadTokens'] as number) ?? null,
        cacheWriteTokens: (usage['cacheWriteTokens'] as number) ?? null,
        totalTokens: (usage['totalTokens'] as number) ?? null,
        cost: (usage['cost'] as number) ?? null,
        model: (usage['model'] as string) ?? null,
        stopReason: (usage['stopReason'] as string) ?? null,
        mergedEvents: mergeEventPairs(currentTurnEvents),
        compactionAfter: [],
      });

      currentTurnEvents = [];
      turnStartMs = null;
      turnNumber++;
      continue;
    }

    // Check if this is a compaction event that belongs after the last turn
    if (isCompactionEvent(event.eventType) && turns.length > 0 && currentTurnEvents.length === 0) {
      // Compaction between turns: attach to preceding turn
      const lastTurn = turns[turns.length - 1]!;
      lastTurn.compactionAfter.push(createCompactionMergedEvent(event));
      continue;
    }

    currentTurnEvents.push(event);
  }

  // Handle any remaining events (incomplete turn during live tick)
  if (currentTurnEvents.length > 0) {
    turns.push({
      turnNumber,
      startMs: turnStartMs ?? (currentTurnEvents[0]?.relativeMs ?? 0),
      endMs: null,
      durationMs: null,
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      totalTokens: null,
      cost: null,
      model: null,
      stopReason: null,
      mergedEvents: mergeEventPairs(currentTurnEvents),
      compactionAfter: [],
    });
  }

  return turns;
}

function isCompactionEvent(eventType: string): boolean {
  return [
    'compaction_start', 'compaction_complete', 'compaction_error',
    'microcompaction', 'emergency_truncation',
  ].includes(eventType);
}

// ============================================================================
// mergeEventPairs
// ============================================================================

/**
 * Collapses raw event pairs into semantic MergedEvents:
 * - tool_call_start + tool_call_end -> one 'tool_use' MergedEvent
 * - response_start + response_end -> one 'response' MergedEvent (hidden if content is [toolUse])
 * - Compaction events -> 'compaction' MergedEvent
 * - Everything else -> 'event' MergedEvent
 */
export function mergeEventPairs(events: TimelineEvent[]): MergedEvent[] {
  const merged: MergedEvent[] = [];

  // Index tool_call_end events by toolCallId or toolName for pairing
  const toolEndMap = new Map<string, TimelineEvent>();
  for (const e of events) {
    if (e.eventType === 'tool_call_end') {
      const key = (e.data['toolCallId'] as string) ?? (e.data['toolName'] as string) ?? e.id;
      toolEndMap.set(key, e);
    }
  }
  const usedToolEnds = new Set<string>();

  // Index response_end events for pairing
  const responseEnds: TimelineEvent[] = events.filter((e) => e.eventType === 'response_end');
  let responseEndIdx = 0;
  const usedResponseEnds = new Set<string>();

  for (const event of events) {
    switch (event.eventType) {
      case 'tool_call_start': {
        const key = (event.data['toolCallId'] as string) ?? (event.data['toolName'] as string) ?? event.id;
        const endEvent = toolEndMap.get(key);

        if (endEvent) {
          usedToolEnds.add(endEvent.id);
          const durationMs = (endEvent.data['durationMs'] as number)
            ?? (endEvent.relativeMs - event.relativeMs);

          merged.push({
            kind: 'tool_use',
            startMs: event.relativeMs,
            endMs: endEvent.relativeMs,
            durationMs,
            toolName: (event.data['toolName'] as string) ?? undefined,
            toolInput: (event.data['toolInput'] ?? event.data['input']) as Record<string, unknown> | undefined,
            toolOutput: endEvent.data['output'],
            isError: (endEvent.data['isError'] as boolean) ?? false,
            rawEvents: [event, endEvent],
          });
        } else {
          // No matching end yet (live tick): show as in-progress tool use
          merged.push({
            kind: 'tool_use',
            startMs: event.relativeMs,
            endMs: null,
            durationMs: null,
            toolName: (event.data['toolName'] as string) ?? undefined,
            toolInput: (event.data['toolInput'] ?? event.data['input']) as Record<string, unknown> | undefined,
            rawEvents: [event],
          });
        }
        break;
      }

      case 'tool_call_end': {
        // Already consumed by a tool_call_start pairing
        if (usedToolEnds.has(event.id)) break;
        // Orphaned tool_call_end (start was in a previous turn or missing)
        merged.push({
          kind: 'tool_use',
          startMs: event.relativeMs,
          endMs: event.relativeMs,
          durationMs: (event.data['durationMs'] as number) ?? null,
          toolName: (event.data['toolName'] as string) ?? undefined,
          toolOutput: event.data['output'],
          isError: (event.data['isError'] as boolean) ?? false,
          rawEvents: [event],
        });
        break;
      }

      case 'response_start': {
        // Pair with next response_end
        const endEvent = responseEnds[responseEndIdx];
        if (endEvent) {
          responseEndIdx++;
          usedResponseEnds.add(endEvent.id);
          const content = (endEvent.data['content'] as string) ?? '';
          const finishReason = (endEvent.data['finishReason'] as string) ?? undefined;

          // Skip responses that are just [toolUse] markers
          if (content === '[toolUse]' || content.trim() === '') break;

          merged.push({
            kind: 'response',
            startMs: event.relativeMs,
            endMs: endEvent.relativeMs,
            durationMs: endEvent.relativeMs - event.relativeMs,
            content,
            finishReason,
            rawEvents: [event, endEvent],
          });
        }
        // If no end yet (live), skip -- the response isn't complete
        break;
      }

      case 'response_end': {
        // Already consumed by response_start pairing
        if (usedResponseEnds.has(event.id)) break;
        // Orphaned response_end
        const content = (event.data['content'] as string) ?? '';
        if (content === '[toolUse]' || content.trim() === '') break;
        merged.push({
          kind: 'response',
          startMs: event.relativeMs,
          endMs: event.relativeMs,
          durationMs: null,
          content,
          finishReason: (event.data['finishReason'] as string) ?? undefined,
          rawEvents: [event],
        });
        break;
      }

      case 'turn_end':
        // Excluded -- data goes into turn header
        break;

      default: {
        if (isCompactionEvent(event.eventType)) {
          merged.push(createCompactionMergedEvent(event));
        } else {
          merged.push({
            kind: 'event',
            startMs: event.relativeMs,
            endMs: event.relativeMs,
            durationMs: null,
            rawEvents: [event],
          });
        }
      }
    }
  }

  return merged;
}

function createCompactionMergedEvent(event: TimelineEvent): MergedEvent {
  const d = event.data;

  let compactionType: MergedEvent['compactionType'];
  if (event.eventType === 'microcompaction') compactionType = 'microcompaction';
  else if (event.eventType === 'emergency_truncation') compactionType = 'emergency_truncation';
  else compactionType = 'compaction';

  return {
    kind: 'compaction',
    startMs: event.relativeMs,
    endMs: event.relativeMs,
    durationMs: null,
    tokensBefore: (d['tokensBefore'] as number) ?? undefined,
    tokensAfter: (d['tokensAfter'] as number) ?? undefined,
    turnsCompacted: (d['turnsCompacted'] as number) ?? (d['turnsRemoved'] as number) ?? undefined,
    compactionType,
    rawEvents: [event],
  };
}
