/**
 * Event Bus — type definitions and interface.
 *
 * Types live in @animus/shared. The concrete implementation
 * (using Node.js EventEmitter) lives in the backend package.
 */

import type {
  HeartbeatState,
  EmotionState,
  Thought,
  Experience,
  Message,
  TickDecision,
} from './types/index.js';

/**
 * Map of all Animus event types and their payloads.
 */
export interface AnimusEventMap {
  // Heartbeat lifecycle
  'heartbeat:tick_start': { tickNumber: number; triggerType: string };
  'heartbeat:tick_end': { tickNumber: number };
  'heartbeat:stage_change': { stage: HeartbeatState['currentStage'] };
  'heartbeat:state_change': HeartbeatState;

  // Emotions
  'emotion:updated': EmotionState;

  // Thoughts & Experiences
  'thought:created': Thought;
  'experience:created': Experience;

  // Messages
  'message:received': Message;
  'message:sent': Message;

  // Decisions
  'decision:made': TickDecision;

  // Agent tasks
  'agent:spawned': { taskId: string; provider: string };
  'agent:completed': { taskId: string; result: string | null };
  'agent:failed': { taskId: string; error: string };

  // System
  'system:settings_updated': Record<string, unknown>;
  'system:shutdown': void;
}

/**
 * Type-safe event bus interface.
 */
export interface IEventBus {
  on<K extends keyof AnimusEventMap>(
    event: K,
    listener: (payload: AnimusEventMap[K]) => void
  ): void;

  off<K extends keyof AnimusEventMap>(
    event: K,
    listener: (payload: AnimusEventMap[K]) => void
  ): void;

  emit<K extends keyof AnimusEventMap>(event: K, payload: AnimusEventMap[K]): void;

  once<K extends keyof AnimusEventMap>(
    event: K,
    listener: (payload: AnimusEventMap[K]) => void
  ): void;
}
