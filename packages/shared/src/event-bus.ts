/**
 * Event Bus — type definitions and interface.
 *
 * Types live in @animus/shared. The concrete implementation
 * (using Node.js EventEmitter) lives in the backend package.
 */

import type {
  HeartbeatState,
  EmotionState,
  EnergyBand,
  Thought,
  Experience,
  Message,
  TickDecision,
  Goal,
  GoalSeed,
  LongTermMemory,
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

  // Energy
  'energy:updated': { energyLevel: number; band: EnergyBand };

  // Thoughts & Experiences
  'thought:created': Thought;
  'experience:created': Experience;

  // Messages
  'message:received': Message;
  'message:sent': Message;

  // Decisions
  'decision:made': TickDecision;

  // Reply streaming
  'reply:chunk': { content: string; accumulated: string };
  'reply:complete': { content: string; tickNumber: number };

  // Goals & Seeds
  'goal:created': Goal;
  'goal:updated': Goal;
  'seed:created': GoalSeed;
  'seed:updated': GoalSeed;

  // Memory
  'memory:working_updated': { contactId: string };
  'memory:core_updated': Record<string, never>;
  'memory:stored': LongTermMemory;
  'memory:pruned': { count: number };

  // Agent tasks
  'agent:spawned': { taskId: string; provider: string };
  'agent:completed': { taskId: string; result: string | null };
  'agent:failed': { taskId: string; error: string };
  'agent:cancelled': { taskId: string; reason: string };
  'agent:rate_limited': { taskId: string; count: number; limit: number };

  // Tick inspector
  'tick:context_stored': {
    tickNumber: number;
    triggerType: string;
    sessionState: string;
    durationMs: number | null;
    createdAt: string;
  };

  // Plugins
  'plugin:changed': { pluginName: string; action: 'installed' | 'uninstalled' | 'enabled' | 'disabled' };
  'plugin:config_updated': { pluginName: string };

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
