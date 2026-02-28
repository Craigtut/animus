/**
 * Subsystem Lifecycle Manager
 *
 * Provides consistent startup/shutdown/health-check hooks for all backend
 * subsystems. The LifecycleManager handles ordered startup (topological sort
 * on dependsOn), reverse shutdown, and health aggregation.
 *
 * See docs/architecture/backend-architecture.md for design context.
 */

import { createLogger } from './logger.js';

const log = createLogger('LifecycleManager', 'server');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SubsystemStatus = 'pending' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';

export interface SubsystemHealth {
  status: SubsystemStatus;
  error?: string;
  detail?: string;
}

export interface SubsystemLifecycle {
  /** Unique name for logging and health reporting */
  readonly name: string;
  /** Names of subsystems that must be running before this one starts */
  readonly dependsOn?: readonly string[];
  /** Initialize resources. Throw to signal failure (does not abort other subsystems). */
  start(): Promise<void>;
  /** Release resources. Should not throw. */
  stop(): Promise<void>;
  /** Optional health snapshot */
  healthCheck?(): SubsystemHealth;
}

// ---------------------------------------------------------------------------
// Topological Sort
// ---------------------------------------------------------------------------

/**
 * Perform a topological sort on subsystems respecting dependsOn ordering.
 * Returns the sorted array. Subsystems with unknown dependencies are included
 * but will be handled (marked failed) during startup.
 */
function topologicalSort(subsystems: SubsystemLifecycle[]): SubsystemLifecycle[] {
  const nameToIndex = new Map<string, number>();
  for (let i = 0; i < subsystems.length; i++) {
    nameToIndex.set(subsystems[i]!.name, i);
  }

  // Build adjacency: edge from dependency to dependent
  const inDegree = new Array<number>(subsystems.length).fill(0);
  const adjacency = new Array<number[]>(subsystems.length);
  for (let i = 0; i < subsystems.length; i++) {
    adjacency[i] = [];
  }

  for (let i = 0; i < subsystems.length; i++) {
    const deps = subsystems[i]!.dependsOn;
    if (!deps) continue;
    for (const dep of deps) {
      const depIdx = nameToIndex.get(dep);
      if (depIdx !== undefined) {
        adjacency[depIdx]!.push(i);
        inDegree[i]!++;
      }
      // Unknown deps are handled during startAll(), not here
    }
  }

  // Kahn's algorithm
  const queue: number[] = [];
  for (let i = 0; i < subsystems.length; i++) {
    if (inDegree[i] === 0) {
      queue.push(i);
    }
  }

  const sorted: SubsystemLifecycle[] = [];
  while (queue.length > 0) {
    const idx = queue.shift()!;
    sorted.push(subsystems[idx]!);
    for (const neighbor of adjacency[idx]!) {
      inDegree[neighbor]!--;
      if (inDegree[neighbor]! === 0) {
        queue.push(neighbor);
      }
    }
  }

  // If there is a cycle, some nodes will not have been visited.
  // Append any unvisited subsystems at the end so they still get a chance
  // to start (they will likely fail due to missing deps).
  if (sorted.length < subsystems.length) {
    const sortedNames = new Set(sorted.map(s => s.name));
    for (const sub of subsystems) {
      if (!sortedNames.has(sub.name)) {
        sorted.push(sub);
      }
    }
  }

  return sorted;
}

// ---------------------------------------------------------------------------
// LifecycleManager
// ---------------------------------------------------------------------------

export class LifecycleManager {
  private subsystems: SubsystemLifecycle[] = [];
  private statuses = new Map<string, SubsystemStatus>();

  /**
   * Register a subsystem. Its status is initialized to 'pending'.
   * Throws if a subsystem with the same name is already registered.
   * Returns `this` for chaining.
   */
  register(subsystem: SubsystemLifecycle): this {
    if (this.statuses.has(subsystem.name)) {
      throw new Error(`Subsystem "${subsystem.name}" is already registered`);
    }
    this.subsystems.push(subsystem);
    this.statuses.set(subsystem.name, 'pending');
    log.debug(`Registered subsystem: ${subsystem.name}`);
    return this;
  }

  /**
   * Start all registered subsystems in dependency order.
   *
   * Uses topological sort respecting dependsOn. For each subsystem:
   * - If any dependency is not 'running', the subsystem is marked 'failed' and skipped.
   * - Otherwise, start() is called. Success sets status to 'running'; failure sets 'failed'.
   * - Failures are logged but do not prevent other subsystems from starting.
   */
  async startAll(): Promise<void> {
    const sorted = topologicalSort(this.subsystems);
    const registeredNames = new Set(this.subsystems.map(s => s.name));

    for (const subsystem of sorted) {
      // Check for unknown or unmet dependencies
      const deps = subsystem.dependsOn ?? [];
      let depsOk = true;

      for (const dep of deps) {
        if (!registeredNames.has(dep)) {
          log.warn(`Subsystem "${subsystem.name}" depends on unknown subsystem "${dep}"; marking as failed`);
          this.statuses.set(subsystem.name, 'failed');
          depsOk = false;
          break;
        }
        const depStatus = this.statuses.get(dep);
        if (depStatus !== 'running') {
          log.warn(`Subsystem "${subsystem.name}" depends on "${dep}" which is "${depStatus}"; marking as failed`);
          this.statuses.set(subsystem.name, 'failed');
          depsOk = false;
          break;
        }
      }

      if (!depsOk) continue;

      this.statuses.set(subsystem.name, 'starting');
      try {
        await subsystem.start();
        this.statuses.set(subsystem.name, 'running');
        log.info(`Started subsystem: ${subsystem.name}`);
      } catch (err) {
        this.statuses.set(subsystem.name, 'failed');
        log.error(`Failed to start subsystem "${subsystem.name}":`, err);
      }
    }
  }

  /**
   * Stop all registered subsystems in reverse registration order.
   *
   * Only subsystems in 'running' state are stopped. Failures are caught
   * and logged, never propagated, ensuring every subsystem gets a chance
   * to shut down.
   */
  async stopAll(): Promise<void> {
    const reversed = [...this.subsystems].reverse();

    for (const subsystem of reversed) {
      const status = this.statuses.get(subsystem.name);
      if (status !== 'running') {
        continue;
      }

      this.statuses.set(subsystem.name, 'stopping');
      try {
        await subsystem.stop();
        this.statuses.set(subsystem.name, 'stopped');
        log.info(`Stopped subsystem: ${subsystem.name}`);
      } catch (err) {
        this.statuses.set(subsystem.name, 'failed');
        log.error(`Failed to stop subsystem "${subsystem.name}":`, err);
      }
    }
  }

  /**
   * Return a health snapshot for all registered subsystems.
   *
   * If a subsystem implements healthCheck(), its result is used.
   * Otherwise, the current status is returned as-is.
   */
  health(): Record<string, SubsystemHealth> {
    const result: Record<string, SubsystemHealth> = {};

    for (const subsystem of this.subsystems) {
      if (subsystem.healthCheck) {
        result[subsystem.name] = subsystem.healthCheck();
      } else {
        result[subsystem.name] = { status: this.statuses.get(subsystem.name) ?? 'pending' };
      }
    }

    return result;
  }

  /**
   * Get the current status of a subsystem by name.
   * Returns undefined if the subsystem is not registered.
   */
  getStatus(name: string): SubsystemStatus | undefined {
    return this.statuses.get(name);
  }
}
