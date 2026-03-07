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
  Task,
  LongTermMemory,
  StreamType,
  AgentEventType,
  ToolApprovalRequest,
  ToolPermissionMode,
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
  'reply:chunk': { content: string; accumulated: string; turnIndex: number; channel: string };
  'reply:turn_complete': { turnIndex: number; content: string; tickNumber: number; channel: string };
  'reply:complete': { content: string; tickNumber: number; totalTurns: number; channel: string };

  // Goals & Seeds
  'goal:created': Goal;
  'goal:updated': Goal;
  'seed:created': GoalSeed;
  'seed:updated': GoalSeed;

  // Tasks
  'task:created': Task;
  'task:updated': Task;
  'task:deleted': { taskId: string };

  // Memory
  'memory:working_updated': { contactId: string };
  'memory:core_updated': Record<string, never>;
  'memory:stored': LongTermMemory;
  'memory:pruned': { count: number };
  'memory:deleted': { id: string };

  // Agent tasks
  'agent:spawned': { taskId: string; provider: string };
  'agent:completed': { taskId: string; result: string | null };
  'agent:failed': { taskId: string; error: string };
  'agent:cancelled': { taskId: string; reason: string };
  'agent:rate_limited': { taskId: string; count: number; limit: number };

  // Tick inspector
  'tick:input_stored': {
    tickNumber: number;
    triggerType: string;
    sessionState: string;
  };
  'tick:context_stored': {
    tickNumber: number;
    triggerType: string;
    sessionState: string;
    durationMs: number | null;
    createdAt: string;
  };

  // Channels
  'channels:loaded': Record<string, never>;
  'channel:installed': { name: string; channelType: string };
  'channel:uninstalled': { name: string; channelType: string };
  'channel:status_changed': { name: string; channelType: string; status: string; lastError: string | null };

  // Plugins
  'plugin:changed': { pluginName: string; action: 'installed' | 'uninstalled' | 'enabled' | 'disabled' };
  'plugin:config_updated': { pluginName: string };

  // Observational Memory
  'observation:started': { stream: StreamType; contactId: string | null; batchTokens: number; cycleId: string };
  'observation:completed': { stream: StreamType; contactId: string | null; observedTokens: number; outputTokens: number; durationMs: number; cycleId: string };
  'observation:failed': { stream: StreamType; contactId: string | null; error: string; cycleId: string };
  'reflection:started': { stream: StreamType; contactId: string | null; inputTokens: number; compressionLevel: number; cycleId: string };
  'reflection:completed': { stream: StreamType; contactId: string | null; inputTokens: number; outputTokens: number; generation: number; durationMs: number; cycleId: string };
  'reflection:failed': { stream: StreamType; contactId: string | null; error: string; cycleId: string };

  // Agent event logging (for timeline)
  'agent:event:logged': {
    id: string;
    sessionId: string;
    eventType: AgentEventType;
    data: Record<string, unknown>;
    createdAt: string;
  };

  // Tool Permissions
  'tool:approval_requested': ToolApprovalRequest;
  'tool:approval_resolved': { id: string; toolName: string; status: 'approved' | 'denied'; scope: 'once' | null };
  'tool:approval_expired': { id: string; toolName: string };
  'tool:permission_changed': { toolName: string; mode: ToolPermissionMode };

  // Downloads
  'download:started': { assetId: string; label: string; category: string };
  'download:progress': { assetId: string; label: string; category: string; bytesDownloaded: number; totalBytes: number; percent: number; phase: 'downloading' | 'extracting' };
  'download:completed': { assetId: string; label: string; category: string };
  'download:failed': { assetId: string; label: string; category: string; error: string; retriesRemaining: number };

  // SDK Installation
  'sdk:install_progress': {
    sdk: string;
    phase: 'starting' | 'downloading' | 'installing' | 'complete' | 'error';
    message: string;
    error?: string;
  };

  // System
  'system:settings_updated': Record<string, unknown>;
  'system:shutdown': void;
  'system:error': {
    category: 'authentication' | 'configuration' | 'provider' | 'unknown';
    message: string;
    provider?: string;
    recoverable: boolean;
    suggestedAction?: string;
  };
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
