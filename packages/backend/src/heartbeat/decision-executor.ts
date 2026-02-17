/**
 * Decision Executor
 *
 * Handles all decision execution logic from the EXECUTE stage of the
 * heartbeat pipeline. Extracted from heartbeat/index.ts as a pure
 * structural refactor with zero behavioral changes.
 *
 * Three categories of decisions are handled:
 * 1. Agent decisions (spawn_agent, update_agent, cancel_agent)
 * 2. Plugin decisions (non-built-in decision types)
 * 3. Goal/task decisions (seeds, goals, plans, tasks)
 *
 * See docs/architecture/heartbeat.md for the full pipeline design.
 */

import type Database from 'better-sqlite3';
import type { MindOutput, Contact, IEventBus, EmotionName, ScheduleType } from '@animus/shared';
import { builtInDecisionTypeSchema, now } from '@animus/shared';
import * as heartbeatStore from '../db/stores/heartbeat-store.js';
import * as taskStore from '../db/stores/task-store.js';
import { getPluginManager } from '../services/plugin-manager.js';
import { getTaskScheduler, getTaskRunner } from '../tasks/index.js';
import { createLogger } from '../lib/logger.js';
import type { AgentOrchestrator } from './agent-orchestrator.js';
import type { CompiledPersona } from './persona-compiler.js';
import type { SeedManager, GoalManager } from '../goals/index.js';

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
 * Handles agent, plugin, and goal/task decisions.
 */
export async function executeDecisions(
  hbDb: Database.Database,
  decisions: MindOutput['decisions'],
  tickNumber: number,
  contact: Contact | null,
  triggerChannel: string | undefined,
  deps: DecisionExecutorDeps,
  eventBus: IEventBus,
): Promise<void> {
  // 1. Handle agent decisions (involves async operations)
  await executeAgentDecisions(decisions, tickNumber, contact, triggerChannel, deps);

  // 2. Handle plugin decision types (subprocess execution)
  await executePluginDecisions(hbDb, decisions, tickNumber, contact);

  // 3. Handle goal/task decisions (async operations)
  await executeGoalTaskDecisions(
    hbDb, decisions, tickNumber, eventBus, deps.seedManager, deps.goalManager,
  );
}

// ============================================================================
// Agent Decision Dispatch
// ============================================================================

/**
 * Execute agent-related decisions: spawn_agent, update_agent, cancel_agent.
 */
async function executeAgentDecisions(
  decisions: MindOutput['decisions'],
  tickNumber: number,
  contact: Contact | null,
  triggerChannel: string | undefined,
  deps: DecisionExecutorDeps,
): Promise<void> {
  if (!deps.agentOrchestrator) return;

  for (const decision of decisions) {
    try {
      const params = decision.parameters as Record<string, unknown>;
      if (decision.type === 'spawn_agent') {
        await deps.agentOrchestrator.spawnAgent({
          taskType: String(params['taskType'] ?? 'general'),
          description: decision.description,
          instructions: String(params['instructions'] ?? decision.description),
          contactId: params['contactId'] ? String(params['contactId']) : (contact?.id ?? ''),
          channel: String(params['channel'] ?? triggerChannel ?? 'web'),
          tickNumber,
          systemPrompt: deps.compiledPersona
            ? deps.buildSystemPrompt(deps.compiledPersona)
            : '',
        });
      } else if (decision.type === 'update_agent') {
        await deps.agentOrchestrator.updateAgent({
          agentId: String(params['agentId'] ?? ''),
          context: String(params['context'] ?? decision.description),
        });
      } else if (decision.type === 'cancel_agent') {
        await deps.agentOrchestrator.cancelAgent({
          agentId: String(params['agentId'] ?? ''),
          reason: String(params['reason'] ?? decision.description),
        });
      }
    } catch (err) {
      log.error(`Failed to execute ${decision.type} decision:`, err);
    }
  }
}

// ============================================================================
// Plugin Decision Dispatch
// ============================================================================

/**
 * Execute plugin (non-built-in) decision types via the plugin manager.
 */
async function executePluginDecisions(
  hbDb: Database.Database,
  decisions: MindOutput['decisions'],
  tickNumber: number,
  contact: Contact | null,
): Promise<void> {
  const pluginManager = getPluginManager();
  for (const decision of decisions) {
    const isBuiltIn = builtInDecisionTypeSchema.safeParse(decision.type).success;
    if (isBuiltIn) continue;

    try {
      const result = await pluginManager.executeDecision(
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
  }
}

// ============================================================================
// Goal/Task Decision Dispatch
// ============================================================================

/**
 * Goal and task decision type set.
 */
const goalTaskTypes = new Set([
  'create_seed', 'propose_goal', 'update_goal', 'create_plan', 'revise_plan',
  'schedule_task', 'start_task', 'complete_task', 'cancel_task', 'skip_task',
]);

/**
 * Handle goal and task decisions from the mind's output.
 * Runs outside the DB transaction because some operations are async.
 * Failures are logged as 'failed' outcomes in tick_decisions.
 */
async function executeGoalTaskDecisions(
  hbDb: Database.Database,
  decisions: MindOutput['decisions'],
  tickNumber: number,
  eventBus: IEventBus,
  seedManager: SeedManager | null,
  goalManager: GoalManager | null,
): Promise<void> {
  for (const decision of decisions) {
    if (!goalTaskTypes.has(decision.type)) continue;

    const params = decision.parameters as Record<string, unknown>;
    try {
      switch (decision.type) {
        case 'create_seed': {
          if (!seedManager) break;
          await seedManager.createSeed({
            content: String(params['content'] ?? ''),
            ...(params['motivation'] ? { motivation: String(params['motivation']) } : {}),
            ...(params['linkedEmotion'] ? { linkedEmotion: params['linkedEmotion'] as EmotionName } : {}),
            source: (params['source'] as 'internal' | 'user_observation' | 'experience') ?? 'internal',
          });
          break;
        }

        case 'propose_goal': {
          if (!goalManager) break;
          goalManager.createGoal({
            title: String(params['title'] ?? decision.description),
            ...(params['description'] ? { description: String(params['description']) } : {}),
            ...(params['motivation'] ? { motivation: String(params['motivation']) } : {}),
            origin: (params['origin'] as 'user_directed' | 'ai_internal' | 'collaborative') ?? 'ai_internal',
            ...(params['linkedEmotion'] ? { linkedEmotion: params['linkedEmotion'] as EmotionName } : {}),
            status: 'proposed',
            ...(typeof params['basePriority'] === 'number' ? { basePriority: params['basePriority'] } : {}),
            ...(params['completionCriteria'] ? { completionCriteria: String(params['completionCriteria']) } : {}),
          });
          break;
        }

        case 'update_goal': {
          if (!goalManager) break;
          const goalId = String(params['goalId'] ?? '');
          const newStatus = String(params['status'] ?? '');

          switch (newStatus) {
            case 'active':
              goalManager.activateGoal(goalId);
              break;
            case 'paused':
              goalManager.pauseGoal(goalId);
              taskStore.pauseTasksByGoalId(hbDb, goalId);
              break;
            case 'completed':
              goalManager.completeGoal(goalId);
              taskStore.cancelTasksByGoalId(hbDb, goalId);
              break;
            case 'abandoned':
              goalManager.abandonGoal(goalId, params['reason'] ? String(params['reason']) : undefined);
              taskStore.cancelTasksByGoalId(hbDb, goalId);
              break;
            case 'resumed':
              goalManager.resumeGoal(goalId);
              break;
            default:
              log.warn(`Unknown goal status: ${newStatus}`);
          }
          break;
        }

        case 'create_plan': {
          if (!goalManager) break;
          const goalId = String(params['goalId'] ?? '');
          const milestones = Array.isArray(params['milestones'])
            ? params['milestones'] as Array<{ title: string; description: string; status: 'pending' | 'in_progress' | 'completed' | 'skipped' }>
            : undefined;
          goalManager.createPlan(goalId, {
            strategy: String(params['strategy'] ?? ''),
            ...(milestones ? { milestones } : {}),
            createdBy: 'mind',
          });
          break;
        }

        case 'revise_plan': {
          if (!goalManager) break;
          const goalId = String(params['goalId'] ?? '');
          const revisedMilestones = Array.isArray(params['milestones'])
            ? params['milestones'] as Array<{ title: string; description: string; status: 'pending' | 'in_progress' | 'completed' | 'skipped' }>
            : undefined;
          goalManager.createPlan(goalId, {
            strategy: String(params['strategy'] ?? ''),
            ...(revisedMilestones ? { milestones: revisedMilestones } : {}),
            createdBy: 'mind',
          });
          break;
        }

        case 'schedule_task': {
          const scheduleType = (params['scheduleType'] as ScheduleType) ?? 'deferred';
          const task = taskStore.createTask(hbDb, {
            title: String(params['title'] ?? decision.description),
            ...(params['description'] ? { description: String(params['description']) } : {}),
            ...(params['instructions'] ? { instructions: String(params['instructions']) } : {}),
            scheduleType,
            ...(params['cronExpression'] ? { cronExpression: String(params['cronExpression']) } : {}),
            ...(params['scheduledAt'] ? { scheduledAt: String(params['scheduledAt']) } : {}),
            ...(params['nextRunAt'] ? { nextRunAt: String(params['nextRunAt']) } : {}),
            ...(params['goalId'] ? { goalId: String(params['goalId']) } : {}),
            ...(params['planId'] ? { planId: String(params['planId']) } : {}),
            ...(typeof params['priority'] === 'number' ? { priority: params['priority'] } : {}),
            createdBy: 'mind',
            ...(params['contactId'] ? { contactId: String(params['contactId']) } : {}),
            status: 'scheduled',
          });
          eventBus.emit('task:created', task);

          // Register with scheduler if it's a timed task
          if (scheduleType !== 'deferred') {
            try {
              getTaskScheduler().registerTask(task);
            } catch (err) {
              log.warn(`Failed to register task ${task.id} with scheduler:`, err);
            }
          }
          break;
        }

        case 'start_task': {
          const taskId = String(params['taskId'] ?? '');
          taskStore.updateTask(hbDb, taskId, {
            status: 'in_progress',
            startedAt: now(),
          });
          const updated = taskStore.getTask(hbDb, taskId);
          if (updated) eventBus.emit('task:updated', updated);
          break;
        }

        case 'complete_task': {
          const taskId = String(params['taskId'] ?? '');
          const result = params['result'] ? String(params['result']) : undefined;
          getTaskRunner().completeTask(taskId, result);
          const updated = taskStore.getTask(hbDb, taskId);
          if (updated) eventBus.emit('task:updated', updated);
          break;
        }

        case 'cancel_task': {
          const taskId = String(params['taskId'] ?? '');
          getTaskRunner().cancelTask(taskId);
          try {
            getTaskScheduler().unregisterTask(taskId);
          } catch {
            // Scheduler may not be running
          }
          const updated = taskStore.getTask(hbDb, taskId);
          if (updated) eventBus.emit('task:updated', updated);
          break;
        }

        case 'skip_task': {
          const taskId = String(params['taskId'] ?? '');
          const task = taskStore.getTask(hbDb, taskId);
          if (!task) break;

          if (task.scheduleType === 'recurring' && task.cronExpression) {
            // Advance to next run time
            const { computeNextRunAt } = await import('../tasks/task-scheduler.js');
            const nextRunAt = computeNextRunAt(task.cronExpression);
            if (nextRunAt) {
              taskStore.updateTask(hbDb, taskId, { nextRunAt });
            }
          } else {
            // One-shot or deferred: mark as completed with skip note
            taskStore.updateTask(hbDb, taskId, {
              status: 'completed',
              result: 'Skipped by mind decision',
              completedAt: now(),
            });
          }
          const updated = taskStore.getTask(hbDb, taskId);
          if (updated) eventBus.emit('task:updated', updated);
          break;
        }

        default:
          continue;
      }
    } catch (err) {
      log.error(`Failed to execute ${decision.type} decision:`, err);
      // Log failure to tick_decisions
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
