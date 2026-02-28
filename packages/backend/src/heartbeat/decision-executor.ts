/**
 * Decision Executor
 *
 * Handles all decision execution logic from the EXECUTE stage of the
 * heartbeat pipeline. Uses a registry-based dispatch where each domain
 * module registers its own handlers.
 *
 * Three categories of decisions are handled:
 * 1. Built-in decisions (agent, goal, task, channel) via the handler registry
 * 2. Plugin decisions (non-built-in) via pluginManager.executeDecision()
 *
 * See docs/architecture/heartbeat.md for the full pipeline design.
 * See docs/architecture/backend-architecture.md for the registry pattern.
 */

import type Database from 'better-sqlite3';
import type { MindOutput, Contact, IEventBus } from '@animus-labs/shared';
import { builtInDecisionTypeSchema } from '@animus-labs/shared';
import * as heartbeatStore from '../db/stores/heartbeat-store.js';
import type { PluginManager } from '../plugins/index.js';
import type { TaskScheduler, TaskRunner } from '../tasks/index.js';
import type { ChannelManager } from '../channels/channel-manager.js';
import { createLogger } from '../lib/logger.js';
import type { AgentOrchestrator } from './agent-orchestrator.js';
import type { CompiledPersona } from './persona-compiler.js';
import type { SeedManager, GoalManager } from '../goals/index.js';
import { getDecisionHandler, type DecisionHandlerContext } from './decision-registry.js';

// Side-effect imports: register domain decision handlers
import './agent-decision-handlers.js';
import '../goals/decision-handlers.js';
import '../tasks/decision-handlers.js';
import '../channels/decision-handlers.js';

const log = createLogger('DecisionExecutor', 'heartbeat');

// ============================================================================
// Types
// ============================================================================

export interface DecisionExecutorDeps {
  agentOrchestrator: AgentOrchestrator | null;
  compiledPersona: CompiledPersona | null;
  seedManager: SeedManager | null;
  goalManager: GoalManager | null;
  buildSystemPrompt: (persona: CompiledPersona) => string;
  pluginManager: PluginManager;
  taskScheduler: TaskScheduler;
  taskRunner: TaskRunner;
  channelManager: ChannelManager;
}

// ============================================================================
// Permission Checking & Decision Logging (inside DB transaction)
// ============================================================================

/**
 * Restricted decision types that only primary contacts may trigger.
 */
const restrictedDecisionTypes = [
  'spawn_agent', 'update_agent', 'cancel_agent',
  'propose_goal', 'create_seed', 'schedule_task',
];

/**
 * Log all decisions in the heartbeat DB transaction.
 * Checks permissions and marks restricted decisions as 'dropped' for non-primary contacts.
 * Returns void -- decisions are logged directly to the DB.
 */
export function logDecisionsInTransaction(
  hbDb: Database.Database,
  decisions: MindOutput['decisions'],
  tickNumber: number,
  contact: Contact | null,
  eventBus: IEventBus,
): void {
  for (const decision of decisions) {
    // Permission check: restricted operations only for primary contacts
    if (
      restrictedDecisionTypes.includes(decision.type) &&
      contact &&
      contact.permissionTier !== 'primary'
    ) {
      heartbeatStore.insertTickDecision(hbDb, {
        tickNumber,
        type: decision.type,
        description: decision.description,
        parameters: decision.parameters,
        outcome: 'dropped',
        outcomeDetail: `${decision.type} not allowed for ${contact.permissionTier} tier`,
      });
      continue;
    }

    const d = heartbeatStore.insertTickDecision(hbDb, {
      tickNumber,
      type: decision.type,
      description: decision.description,
      parameters: decision.parameters,
      outcome: 'executed',
    });
    eventBus.emit('decision:made', d);
  }
}

// ============================================================================
// Decision Execution (outside DB transaction)
// ============================================================================

/**
 * Execute all decisions from a mind output.
 * Called AFTER the DB transaction that logs decisions.
 *
 * Built-in decisions are dispatched through the handler registry.
 * Plugin (non-built-in) decisions are routed through pluginManager.executeDecision().
 */
export async function executeDecisions(
  hbDb: Database.Database,
  decisions: MindOutput['decisions'],
  tickNumber: number,
  contact: Contact | null,
  triggerChannel: string | undefined,
  triggerMetadata: Record<string, unknown> | undefined,
  deps: DecisionExecutorDeps,
  eventBus: IEventBus,
): Promise<void> {
  // Build handler context once from deps
  const handlerCtx: DecisionHandlerContext = {
    hbDb,
    tickNumber,
    contact,
    triggerChannel,
    triggerMetadata,
    eventBus,
    agentOrchestrator: deps.agentOrchestrator,
    compiledPersona: deps.compiledPersona,
    seedManager: deps.seedManager,
    goalManager: deps.goalManager,
    taskScheduler: deps.taskScheduler,
    taskRunner: deps.taskRunner,
    channelManager: deps.channelManager,
    buildSystemPrompt: deps.buildSystemPrompt,
  };

  for (const decision of decisions) {
    // Plugin decisions (non-built-in) are routed through the plugin manager
    const isBuiltIn = builtInDecisionTypeSchema.safeParse(decision.type).success;
    if (!isBuiltIn) {
      try {
        const result = await deps.pluginManager.executeDecision(
          decision.type,
          decision.parameters,
          contact?.permissionTier ?? 'unknown'
        );
        heartbeatStore.insertTickDecision(hbDb, {
          tickNumber,
          type: decision.type,
          description: decision.description,
          parameters: decision.parameters,
          outcome: result.success ? 'executed' : 'failed',
          ...(result.error ? { outcomeDetail: result.error } : {}),
        });
      } catch (err) {
        log.error(`Failed to execute plugin decision ${decision.type}:`, err);
        heartbeatStore.insertTickDecision(hbDb, {
          tickNumber,
          type: decision.type,
          description: decision.description,
          parameters: decision.parameters,
          outcome: 'failed',
          outcomeDetail: String(err),
        });
      }
      continue;
    }

    // Built-in decision: look up handler in registry
    const handler = getDecisionHandler(decision.type);
    if (!handler) {
      log.warn(`No handler registered for decision type "${decision.type}"`);
      continue;
    }

    try {
      await handler(
        decision.parameters as Record<string, unknown>,
        decision,
        handlerCtx,
      );
    } catch (err) {
      log.error(`Failed to execute ${decision.type} decision:`, err);
      heartbeatStore.insertTickDecision(hbDb, {
        tickNumber,
        type: decision.type,
        description: decision.description,
        parameters: decision.parameters,
        outcome: 'failed',
        outcomeDetail: String(err),
      });
    }
  }
}
