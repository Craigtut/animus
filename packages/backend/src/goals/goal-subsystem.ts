/**
 * Goal Subsystem
 *
 * Wraps the initialization of the goal system (GoalManager, SeedManager) into
 * a SubsystemLifecycle. Depends on the memory subsystem for the embedding
 * provider used by SeedManager.
 */

import type { SubsystemLifecycle } from '../lib/lifecycle.js';
import { createLogger } from '../lib/logger.js';
import { getHeartbeatDb } from '../db/index.js';
import { GoalManager } from './goal-manager.js';
import { SeedManager } from './seed-manager.js';
import type { MemorySubsystem } from '../memory/memory-subsystem.js';

const log = createLogger('GoalSubsystem', 'heartbeat');

export class GoalSubsystem implements SubsystemLifecycle {
  readonly name = 'goals';
  readonly dependsOn = ['memory'] as const;
  goalManager: GoalManager | null = null;
  seedManager: SeedManager | null = null;

  constructor(private memorySubsystem: MemorySubsystem) {}

  async start(): Promise<void> {
    const hbDb = getHeartbeatDb();
    this.goalManager = new GoalManager(hbDb);
    if (this.memorySubsystem.embeddingProvider) {
      this.seedManager = new SeedManager(hbDb, this.memorySubsystem.embeddingProvider);
    }
    log.debug('Goal system initialized');
  }

  async stop(): Promise<void> {
    this.goalManager = null;
    this.seedManager = null;
  }
}
