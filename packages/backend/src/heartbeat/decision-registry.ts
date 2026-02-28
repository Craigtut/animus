/**
 * Decision Handler Registry
 *
 * Registry-based dispatch for decision execution. Each domain module
 * registers its own handlers, eliminating the need for a central switch-case.
 *
 * See docs/architecture/backend-architecture.md for the pattern.
 */

import type Database from 'better-sqlite3';
import type { Contact, IEventBus } from '@animus-labs/shared';
import type { AgentOrchestrator } from './agent-orchestrator.js';
import type { CompiledPersona } from './persona-compiler.js';
import type { SeedManager, GoalManager } from '../goals/index.js';
import type { TaskScheduler, TaskRunner } from '../tasks/index.js';
import type { ChannelManager } from '../channels/channel-manager.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('DecisionRegistry', 'heartbeat');

/**
 * Context available to all decision handlers.
 */
export interface DecisionHandlerContext {
  hbDb: Database.Database;
  tickNumber: number;
  contact: Contact | null;
  triggerChannel: string | undefined;
  triggerMetadata: Record<string, unknown> | undefined;
  eventBus: IEventBus;
  agentOrchestrator: AgentOrchestrator | null;
  compiledPersona: CompiledPersona | null;
  seedManager: SeedManager | null;
  goalManager: GoalManager | null;
  taskScheduler: TaskScheduler;
  taskRunner: TaskRunner;
  channelManager: ChannelManager;
  buildSystemPrompt: (persona: CompiledPersona) => string;
}

/**
 * A single decision in the format produced by the mind.
 */
export interface DecisionRecord {
  type: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * Handler function for a decision type.
 */
export type DecisionHandler = (
  params: Record<string, unknown>,
  decision: DecisionRecord,
  ctx: DecisionHandlerContext,
) => Promise<void>;

const handlers = new Map<string, DecisionHandler>();

/**
 * Register a handler for a decision type.
 * Called at module load time by domain modules.
 */
export function registerDecisionHandler(type: string, handler: DecisionHandler): void {
  if (handlers.has(type)) {
    log.warn(`Overwriting existing handler for decision type "${type}"`);
  }
  handlers.set(type, handler);
}

/**
 * Get the handler for a decision type, if registered.
 */
export function getDecisionHandler(type: string): DecisionHandler | undefined {
  return handlers.get(type);
}

/**
 * Check if a handler is registered for a decision type.
 */
export function hasDecisionHandler(type: string): boolean {
  return handlers.has(type);
}
