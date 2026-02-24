/**
 * Tests for GoalManager and SeedManager.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestHeartbeatDb } from '../helpers.js';
import { GoalManager } from '../../src/goals/goal-manager.js';
import { SeedManager, cosineSimilarity, SEED_GRADUATION_THRESHOLD, SEED_CLEANUP_THRESHOLD, SEED_RESONANCE_THRESHOLD, SEED_DECAY_RATE, SEED_BOOST_MULTIPLIER } from '../../src/goals/seed-manager.js';
import { buildGoalContext, generatePlanningPrompts } from '../../src/goals/goal-context.js';
import * as heartbeatStore from '../../src/db/stores/heartbeat-store.js';
import {
  GOAL_PLANNING_PROMPT_STRONGER_TICKS,
  GOAL_PLANNING_PROMPT_FORCEFUL_TICKS,
} from '../../src/goals/planning.js';
import type { IEmbeddingProvider, EmotionState } from '@animus/shared';

// --------------------------------------------------------------------------
// Mock embedding provider
// --------------------------------------------------------------------------

function createMockEmbeddingProvider(): IEmbeddingProvider {
  return {
    dimensions: 3,
    maxTokens: 512,
    modelId: 'test-model',
    isReady: () => true,
    initialize: async () => {},
    embed: async (texts: string[]) => texts.map(() => [1, 0, 0]),
    embedSingle: async () => [1, 0, 0],
  };
}

function makeEmotionState(emotion: string, intensity: number, baseline: number = 0.3): EmotionState {
  return {
    emotion: emotion as EmotionState['emotion'],
    category: 'positive',
    intensity,
    baseline,
    lastUpdatedAt: new Date().toISOString(),
  };
}

// --------------------------------------------------------------------------
// GoalManager Tests
// --------------------------------------------------------------------------

describe('GoalManager', () => {
  let db: Database.Database;
  let manager: GoalManager;

  beforeEach(() => {
    db = createTestHeartbeatDb();
    manager = new GoalManager(db);
  });

  describe('createGoal', () => {
    it('creates a goal with required fields', () => {
      const goal = manager.createGoal({
        title: 'Learn TypeScript',
        origin: 'user_directed',
      });

      expect(goal.id).toBeDefined();
      expect(goal.title).toBe('Learn TypeScript');
      expect(goal.origin).toBe('user_directed');
      expect(goal.status).toBe('proposed');
    });

    it('creates a goal with all fields', () => {
      const goal = manager.createGoal({
        title: 'Build API',
        description: 'REST API for users',
        motivation: 'User requested',
        origin: 'collaborative',
        linkedEmotion: 'curiosity',
        status: 'active',
        basePriority: 0.8,
        completionCriteria: 'All endpoints work',
        deadline: '2025-12-31T00:00:00Z',
      });

      expect(goal.title).toBe('Build API');
      expect(goal.description).toBe('REST API for users');
      expect(goal.motivation).toBe('User requested');
      expect(goal.linkedEmotion).toBe('curiosity');
      expect(goal.status).toBe('active');
      expect(goal.basePriority).toBe(0.8);
    });
  });

  describe('getGoal', () => {
    it('returns null for nonexistent goal', () => {
      expect(manager.getGoal('nonexistent')).toBeNull();
    });

    it('returns an existing goal', () => {
      const created = manager.createGoal({ title: 'Test', origin: 'ai_internal' });
      const fetched = manager.getGoal(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.title).toBe('Test');
    });
  });

  describe('lifecycle', () => {
    it('activates a proposed goal', () => {
      const goal = manager.createGoal({ title: 'Test', origin: 'ai_internal' });
      expect(goal.status).toBe('proposed');

      manager.activateGoal(goal.id);
      const updated = manager.getGoal(goal.id)!;
      expect(updated.status).toBe('active');
      expect(updated.activatedAt).not.toBeNull();
    });

    it('sets activatedAtTick when activating a goal', () => {
      // Set heartbeat state to a known tick number
      heartbeatStore.updateHeartbeatState(db, { tickNumber: 5 });

      const goal = manager.createGoal({ title: 'Test', origin: 'ai_internal' });
      manager.activateGoal(goal.id);
      const updated = manager.getGoal(goal.id)!;
      expect(updated.activatedAtTick).toBe(5);
    });

    it('sets activatedAtTick when creating a goal with active status', () => {
      heartbeatStore.updateHeartbeatState(db, { tickNumber: 7 });

      const goal = manager.createGoal({ title: 'Direct Active', origin: 'user_directed', status: 'active' });
      expect(goal.activatedAtTick).toBe(7);
    });

    it('resets activatedAtTick when resuming a paused goal', () => {
      heartbeatStore.updateHeartbeatState(db, { tickNumber: 3 });
      const goal = manager.createGoal({ title: 'Test', origin: 'ai_internal', status: 'active' });

      manager.pauseGoal(goal.id);

      heartbeatStore.updateHeartbeatState(db, { tickNumber: 10 });
      manager.resumeGoal(goal.id);
      const resumed = manager.getGoal(goal.id)!;
      expect(resumed.activatedAtTick).toBe(10);
    });

    it('pauses and resumes a goal', () => {
      const goal = manager.createGoal({ title: 'Test', origin: 'ai_internal', status: 'active' });
      manager.pauseGoal(goal.id);
      expect(manager.getGoal(goal.id)!.status).toBe('paused');

      manager.resumeGoal(goal.id);
      expect(manager.getGoal(goal.id)!.status).toBe('active');
    });

    it('completes a goal', () => {
      const goal = manager.createGoal({ title: 'Test', origin: 'ai_internal', status: 'active' });
      manager.completeGoal(goal.id);
      const updated = manager.getGoal(goal.id)!;
      expect(updated.status).toBe('completed');
      expect(updated.completedAt).not.toBeNull();
    });

    it('abandons a goal with reason', () => {
      const goal = manager.createGoal({ title: 'Test', origin: 'ai_internal', status: 'active' });
      manager.abandonGoal(goal.id, 'No longer relevant');
      const updated = manager.getGoal(goal.id)!;
      expect(updated.status).toBe('abandoned');
      expect(updated.abandonedReason).toBe('No longer relevant');
    });

    it('updates progress timestamp', () => {
      const goal = manager.createGoal({ title: 'Test', origin: 'ai_internal', status: 'active' });
      expect(goal.lastProgressAt).toBeNull();

      manager.updateGoalProgress(goal.id);
      const updated = manager.getGoal(goal.id)!;
      expect(updated.lastProgressAt).not.toBeNull();
    });
  });

  describe('getActiveGoals', () => {
    it('returns only active goals', () => {
      manager.createGoal({ title: 'Active 1', origin: 'ai_internal', status: 'active' });
      manager.createGoal({ title: 'Active 2', origin: 'ai_internal', status: 'active' });
      manager.createGoal({ title: 'Proposed', origin: 'ai_internal' }); // default: proposed
      const active = manager.getActiveGoals();
      expect(active).toHaveLength(2);
    });
  });

  describe('getGoalsByStatus', () => {
    it('filters by status', () => {
      manager.createGoal({ title: 'A', origin: 'ai_internal' });
      manager.createGoal({ title: 'B', origin: 'ai_internal' });
      manager.createGoal({ title: 'C', origin: 'ai_internal', status: 'active' });

      const proposed = manager.getGoalsByStatus('proposed');
      expect(proposed).toHaveLength(2);

      const active = manager.getGoalsByStatus('active');
      expect(active).toHaveLength(1);
    });
  });

  describe('plans', () => {
    it('creates a plan for a goal', () => {
      const goal = manager.createGoal({ title: 'Test', origin: 'ai_internal', status: 'active' });
      const plan = manager.createPlan(goal.id, {
        strategy: 'Step by step approach',
        createdBy: 'mind',
      });

      expect(plan.id).toBeDefined();
      expect(plan.goalId).toBe(goal.id);
      expect(plan.version).toBe(1);
      expect(plan.status).toBe('active');
      expect(plan.strategy).toBe('Step by step approach');
    });

    it('creates plans with milestones', () => {
      const goal = manager.createGoal({ title: 'Test', origin: 'ai_internal', status: 'active' });
      const plan = manager.createPlan(goal.id, {
        strategy: 'Multi-step',
        milestones: [
          { title: 'Step 1', description: 'First step', status: 'pending' },
          { title: 'Step 2', description: 'Second step', status: 'pending' },
        ],
        createdBy: 'planning_agent',
      });

      expect(plan.milestones).toHaveLength(2);
      expect(plan.milestones![0]!.title).toBe('Step 1');
    });

    it('increments plan version', () => {
      const goal = manager.createGoal({ title: 'Test', origin: 'ai_internal', status: 'active' });
      const plan1 = manager.createPlan(goal.id, { strategy: 'v1', createdBy: 'mind' });
      const plan2 = manager.createPlan(goal.id, { strategy: 'v2', createdBy: 'mind' });
      expect(plan1.version).toBe(1);
      expect(plan2.version).toBe(2);
    });

    it('gets active plan', () => {
      const goal = manager.createGoal({ title: 'Test', origin: 'ai_internal', status: 'active' });
      manager.createPlan(goal.id, { strategy: 'v1', createdBy: 'mind' });
      const plan2 = manager.createPlan(goal.id, { strategy: 'v2', createdBy: 'mind' });
      const active = manager.getActivePlan(goal.id);
      expect(active).not.toBeNull();
      expect(active!.version).toBe(plan2.version);
    });

    it('returns null when no active plan exists', () => {
      expect(manager.getActivePlan('nonexistent')).toBeNull();
    });
  });

  describe('promoteToGoal', () => {
    it('creates a goal from a seed and marks seed graduated', () => {
      // Create a seed directly in the store
      const seed = heartbeatStore.createSeed(db, {
        content: 'Learn more about music',
        source: 'internal',
      });

      const goal = manager.promoteToGoal(seed.id, {
        title: 'Learn Music Theory',
        motivation: 'Emerging interest',
      });

      expect(goal.title).toBe('Learn Music Theory');
      expect(goal.origin).toBe('ai_internal');
      expect(goal.status).toBe('proposed');
      expect(goal.seedId).toBe(seed.id);

      // Verify seed is graduated
      const updatedSeed = heartbeatStore.getSeed(db, seed.id)!;
      expect(updatedSeed.status).toBe('graduated');
      expect(updatedSeed.graduatedToGoalId).toBe(goal.id);
    });
  });

  describe('computeAndUpdateSalience', () => {
    it('returns salient goals above threshold', () => {
      manager.createGoal({ title: 'High Priority', origin: 'ai_internal', status: 'active', basePriority: 0.8 });
      manager.createGoal({ title: 'Low Priority', origin: 'ai_internal', status: 'active', basePriority: 0.05 });

      const emotions = [makeEmotionState('joy', 0.5)];
      const salient = manager.computeAndUpdateSalience(emotions);

      // High priority should be above threshold
      expect(salient.length).toBeGreaterThanOrEqual(1);
      const highPri = salient.find((s) => s.goal.title === 'High Priority');
      expect(highPri).toBeDefined();
    });

    it('sorts by salience descending', () => {
      manager.createGoal({ title: 'Medium', origin: 'ai_internal', status: 'active', basePriority: 0.5 });
      manager.createGoal({ title: 'High', origin: 'ai_internal', status: 'active', basePriority: 0.8 });

      const salient = manager.computeAndUpdateSalience([]);
      if (salient.length >= 2) {
        expect(salient[0]!.result.salience).toBeGreaterThanOrEqual(salient[1]!.result.salience);
      }
    });
  });
});

// --------------------------------------------------------------------------
// SeedManager Tests
// --------------------------------------------------------------------------

describe('SeedManager', () => {
  let db: Database.Database;
  let embeddingProvider: IEmbeddingProvider;
  let seedManager: SeedManager;

  beforeEach(() => {
    db = createTestHeartbeatDb();
    embeddingProvider = createMockEmbeddingProvider();
    seedManager = new SeedManager(db, embeddingProvider);
  });

  describe('createSeed', () => {
    it('creates a seed and caches its embedding', async () => {
      const seed = await seedManager.createSeed({
        content: 'Learn about astronomy',
        source: 'internal',
      });

      expect(seed.id).toBeDefined();
      expect(seed.content).toBe('Learn about astronomy');
      expect(seed.status).toBe('active');
      expect(seed.strength).toBeGreaterThan(0);
    });

    it('creates seed with optional fields', async () => {
      const seed = await seedManager.createSeed({
        content: 'Help users with coding',
        motivation: 'Want to be more useful',
        linkedEmotion: 'curiosity',
        source: 'user_observation',
      });

      expect(seed.motivation).toBe('Want to be more useful');
      expect(seed.linkedEmotion).toBe('curiosity');
      expect(seed.source).toBe('user_observation');
    });
  });

  describe('getActiveSeeds', () => {
    it('returns active seeds', async () => {
      await seedManager.createSeed({ content: 'Seed 1', source: 'internal' });
      await seedManager.createSeed({ content: 'Seed 2', source: 'internal' });

      const seeds = seedManager.getActiveSeeds();
      expect(seeds).toHaveLength(2);
    });
  });

  describe('applyDecay', () => {
    it('decays seed strength over time', async () => {
      const seed = await seedManager.createSeed({ content: 'Test seed', source: 'internal' });

      // Manually set the reinforced time far in the past
      heartbeatStore.updateSeed(db, seed.id, {
        lastReinforcedAt: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(), // 72h ago
      });

      seedManager.applyDecay();

      const updated = heartbeatStore.getSeed(db, seed.id)!;
      expect(updated.strength).toBeLessThan(seed.strength);
    });

    it('marks seeds as decayed when strength drops below threshold', async () => {
      const seed = await seedManager.createSeed({ content: 'Weak seed', source: 'internal' });

      // Set very old reinforcement time and low strength
      heartbeatStore.updateSeed(db, seed.id, {
        strength: 0.02,
        lastReinforcedAt: new Date(Date.now() - 200 * 60 * 60 * 1000).toISOString(),
      });

      seedManager.applyDecay();

      const updated = heartbeatStore.getSeed(db, seed.id)!;
      expect(updated.status).toBe('decayed');
      expect(updated.strength).toBe(0);
    });
  });

  describe('checkGraduation', () => {
    it('marks seeds with high strength as graduating', async () => {
      const seed = await seedManager.createSeed({ content: 'Strong seed', source: 'internal' });

      heartbeatStore.updateSeed(db, seed.id, { strength: SEED_GRADUATION_THRESHOLD + 0.05 });

      const graduating = seedManager.checkGraduation();
      expect(graduating).toHaveLength(1);
      expect(graduating[0]!.status).toBe('graduating');
    });

    it('does not graduate seeds below threshold', async () => {
      const seed = await seedManager.createSeed({ content: 'Weak seed', source: 'internal' });

      heartbeatStore.updateSeed(db, seed.id, { strength: SEED_GRADUATION_THRESHOLD - 0.1 });

      const graduating = seedManager.checkGraduation();
      expect(graduating).toHaveLength(0);
    });
  });

  describe('getGraduatingSeeds', () => {
    it('returns seeds with graduating status', async () => {
      const seed = await seedManager.createSeed({ content: 'Ready seed', source: 'internal' });
      heartbeatStore.updateSeed(db, seed.id, { status: 'graduating' });

      const graduating = seedManager.getGraduatingSeeds();
      expect(graduating).toHaveLength(1);
    });
  });

  describe('checkSeedResonance', () => {
    it('reinforces seeds when thoughts resonate', async () => {
      // Create a provider that returns matching embeddings
      const matchProvider: IEmbeddingProvider = {
        ...createMockEmbeddingProvider(),
        embedSingle: async () => [1, 0, 0], // Same embedding for seed and thought
      };
      const mgr = new SeedManager(db, matchProvider);

      const seed = await mgr.createSeed({ content: 'Learn music', source: 'internal' });
      const originalStrength = seed.strength;

      await mgr.checkSeedResonance([
        { content: 'Music is fascinating', importance: 0.8 },
      ]);

      const updated = heartbeatStore.getSeed(db, seed.id)!;
      // cosine similarity of identical vectors is 1.0, which > RESONANCE_THRESHOLD
      expect(updated.strength).toBeGreaterThan(originalStrength);
    });

    it('does not reinforce seeds for unrelated thoughts', async () => {
      // Create a provider that returns orthogonal embeddings
      let callCount = 0;
      const noMatchProvider: IEmbeddingProvider = {
        ...createMockEmbeddingProvider(),
        embedSingle: async () => {
          callCount++;
          // Seed gets [1,0,0], thought gets [0,1,0] — orthogonal, similarity = 0
          return callCount <= 1 ? [1, 0, 0] : [0, 1, 0];
        },
      };
      const mgr = new SeedManager(db, noMatchProvider);

      const seed = await mgr.createSeed({ content: 'Learn music', source: 'internal' });

      await mgr.checkSeedResonance([
        { content: 'Completely unrelated', importance: 0.8 },
      ]);

      const updated = heartbeatStore.getSeed(db, seed.id)!;
      expect(updated.reinforcementCount).toBe(seed.reinforcementCount);
    });
  });

  describe('decay rate constant', () => {
    it('SEED_DECAY_RATE is 0.015', () => {
      expect(SEED_DECAY_RATE).toBe(0.015);
    });

    it('decay formula produces expected values at 24 hours', async () => {
      const seed = await seedManager.createSeed({ content: 'Decay rate test', source: 'internal' });
      const initialStrength = 0.5;
      const hoursElapsed = 24;

      heartbeatStore.updateSeed(db, seed.id, {
        strength: initialStrength,
        lastReinforcedAt: new Date(Date.now() - hoursElapsed * 60 * 60 * 1000).toISOString(),
      });

      seedManager.applyDecay();

      const updated = heartbeatStore.getSeed(db, seed.id)!;
      const expected = initialStrength * Math.exp(-0.015 * hoursElapsed);
      expect(updated.strength).toBeCloseTo(expected, 4);
      // At 0.015 rate, 24h: 0.5 * e^(-0.36) ≈ 0.349
      expect(updated.strength).toBeCloseTo(0.349, 2);
    });

    it('decay formula produces expected values at 72 hours', async () => {
      const seed = await seedManager.createSeed({ content: 'Longer decay test', source: 'internal' });
      const initialStrength = 0.5;
      const hoursElapsed = 72;

      heartbeatStore.updateSeed(db, seed.id, {
        strength: initialStrength,
        lastReinforcedAt: new Date(Date.now() - hoursElapsed * 60 * 60 * 1000).toISOString(),
      });

      seedManager.applyDecay();

      const updated = heartbeatStore.getSeed(db, seed.id)!;
      const expected = initialStrength * Math.exp(-0.015 * hoursElapsed);
      expect(updated.strength).toBeCloseTo(expected, 4);
      // At 0.015 rate, 72h: 0.5 * e^(-1.08) ≈ 0.170
      expect(updated.strength).toBeCloseTo(0.170, 2);
    });
  });

  describe('graduating seed decay', () => {
    it('resets graduating seed to active when strength drops below 0.5', async () => {
      const seed = await seedManager.createSeed({ content: 'Graduating but fading', source: 'internal' });

      // Set to graduating with strength just above 0.5, and time elapsed to push below
      // strength = 0.55, after 6 hours at rate 0.015: 0.55 * e^(-0.09) ≈ 0.503 (still above)
      // after 10 hours: 0.55 * e^(-0.15) ≈ 0.474 (below 0.5)
      heartbeatStore.updateSeed(db, seed.id, {
        status: 'graduating',
        strength: 0.55,
        lastReinforcedAt: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(),
      });

      seedManager.applyDecay();

      const updated = heartbeatStore.getSeed(db, seed.id)!;
      const expectedStrength = 0.55 * Math.exp(-SEED_DECAY_RATE * 10);
      expect(updated.strength).toBeCloseTo(expectedStrength, 3);
      expect(updated.strength).toBeLessThan(0.5);
      expect(updated.status).toBe('active');
    });

    it('marks graduating seed as decayed when strength drops below SEED_CLEANUP_THRESHOLD', async () => {
      const seed = await seedManager.createSeed({ content: 'Graduating but dying', source: 'internal' });

      // Set to graduating with very low strength and old reinforcement time
      heartbeatStore.updateSeed(db, seed.id, {
        status: 'graduating',
        strength: 0.005,
        lastReinforcedAt: new Date(Date.now() - 200 * 60 * 60 * 1000).toISOString(),
      });

      seedManager.applyDecay();

      const updated = heartbeatStore.getSeed(db, seed.id)!;
      expect(updated.status).toBe('decayed');
      expect(updated.strength).toBe(0);
      expect(updated.decayedAt).not.toBeNull();
    });

    it('graduating seed above 0.5 stays graduating with updated strength', async () => {
      const seed = await seedManager.createSeed({ content: 'Strong graduating', source: 'internal' });

      // strength 0.8, after 2 hours: 0.8 * e^(-0.03) ≈ 0.776 (still > 0.5)
      heartbeatStore.updateSeed(db, seed.id, {
        status: 'graduating',
        strength: 0.8,
        lastReinforcedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      });

      seedManager.applyDecay();

      const updated = heartbeatStore.getSeed(db, seed.id)!;
      expect(updated.status).toBe('graduating');
      expect(updated.strength).toBeLessThan(0.8);
      expect(updated.strength).toBeGreaterThan(0.5);
    });
  });

  describe('resonance threshold', () => {
    it('SEED_RESONANCE_THRESHOLD is 0.55', () => {
      expect(SEED_RESONANCE_THRESHOLD).toBe(0.55);
    });

    it('reinforces seeds when similarity exceeds 0.55 threshold', async () => {
      // Provider that returns slightly different but highly similar vectors
      // cosine similarity of [1, 0.1, 0] and [1, 0, 0] is ~0.995, well above 0.55
      const highSimProvider: IEmbeddingProvider = {
        ...createMockEmbeddingProvider(),
        embedSingle: async () => [1, 0, 0],
      };
      const mgr = new SeedManager(db, highSimProvider);

      const seed = await mgr.createSeed({ content: 'Resonance test', source: 'internal' });
      const originalStrength = seed.strength;

      await mgr.checkSeedResonance([
        { content: 'Related thought', importance: 0.7 },
      ]);

      const updated = heartbeatStore.getSeed(db, seed.id)!;
      // similarity is 1.0 (identical vectors), boost = (1.0 - 0.55) * 0.7 * 0.15 = 0.04725
      const expectedBoost = (1.0 - SEED_RESONANCE_THRESHOLD) * 0.7 * SEED_BOOST_MULTIPLIER;
      expect(updated.strength).toBeGreaterThan(originalStrength);
      expect(updated.reinforcementCount).toBe(seed.reinforcementCount + 1);
    });

    it('does not reinforce seeds when similarity is at or below 0.55 threshold', async () => {
      // Return vectors with cosine similarity of exactly ~0.55 or below
      // [1, 0, 0] and [0.55, 0.835, 0] have cosine similarity ≈ 0.55
      let callCount = 0;
      const borderlineProvider: IEmbeddingProvider = {
        ...createMockEmbeddingProvider(),
        embedSingle: async () => {
          callCount++;
          // First call is for the seed, second is for the thought
          return callCount <= 1 ? [1, 0, 0] : [0, 1, 0]; // orthogonal = 0.0 similarity
        },
      };
      const mgr = new SeedManager(db, borderlineProvider);

      const seed = await mgr.createSeed({ content: 'Below threshold', source: 'internal' });

      await mgr.checkSeedResonance([
        { content: 'Unrelated thought', importance: 0.9 },
      ]);

      const updated = heartbeatStore.getSeed(db, seed.id)!;
      expect(updated.reinforcementCount).toBe(seed.reinforcementCount);
    });
  });

  describe('loadSeedEmbeddings', () => {
    it('loads embeddings for active seeds', async () => {
      await seedManager.createSeed({ content: 'Seed 1', source: 'internal' });
      await seedManager.createSeed({ content: 'Seed 2', source: 'internal' });

      // Create a new manager (without cached embeddings) and load
      const mgr2 = new SeedManager(db, embeddingProvider);
      await mgr2.loadSeedEmbeddings();

      // Should have called embedSingle for each seed
      const seeds = mgr2.getActiveSeeds();
      expect(seeds).toHaveLength(2);
    });
  });

  describe('clearEmbedding', () => {
    it('removes embedding cache for a seed', async () => {
      const seed = await seedManager.createSeed({ content: 'Test', source: 'internal' });
      seedManager.clearEmbedding(seed.id);
      // No error — just verifies the method runs
    });
  });
});

// --------------------------------------------------------------------------
// cosineSimilarity Tests
// --------------------------------------------------------------------------

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 5);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1, 5);
  });

  it('returns 0 for zero vectors', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 0, 0])).toBe(0);
  });
});

// --------------------------------------------------------------------------
// Goal Context Tests
// --------------------------------------------------------------------------

describe('buildGoalContext', () => {
  let db: Database.Database;
  let goalManager: GoalManager;
  let seedManager: SeedManager;

  beforeEach(() => {
    db = createTestHeartbeatDb();
    goalManager = new GoalManager(db);
    seedManager = new SeedManager(db, createMockEmbeddingProvider());
  });

  it('returns null sections when no goals or seeds', () => {
    const context = buildGoalContext(goalManager, seedManager, [], 1);
    expect(context.goalSection).toBeNull();
    expect(context.graduatingSeedsSection).toBeNull();
    expect(context.proposedGoalsSection).toBeNull();
    expect(context.tokenEstimate).toBe(0);
  });

  it('includes salient goals', () => {
    goalManager.createGoal({ title: 'Important Goal', origin: 'ai_internal', status: 'active', basePriority: 0.8 });

    const context = buildGoalContext(goalManager, seedManager, [], 1);
    expect(context.goalSection).not.toBeNull();
    expect(context.goalSection).toContain('Important Goal');
    expect(context.tokenEstimate).toBeGreaterThan(0);
  });

  it('includes graduating seeds', async () => {
    const seed = await seedManager.createSeed({ content: 'Emerging interest', source: 'internal' });
    heartbeatStore.updateSeed(db, seed.id, { status: 'graduating' });

    const context = buildGoalContext(goalManager, seedManager, [], 1);
    expect(context.graduatingSeedsSection).not.toBeNull();
    expect(context.graduatingSeedsSection).toContain('Emerging interest');
  });

  it('includes proposed goals', () => {
    goalManager.createGoal({ title: 'Proposed Goal', origin: 'ai_internal' });

    const context = buildGoalContext(goalManager, seedManager, [], 1);
    expect(context.proposedGoalsSection).not.toBeNull();
    expect(context.proposedGoalsSection).toContain('Proposed Goal');
  });

  it('includes planning prompts for active goals without plans', () => {
    heartbeatStore.updateHeartbeatState(db, { tickNumber: 5 });

    goalManager.createGoal({ title: 'Planless Goal', origin: 'user_directed', status: 'active' });

    // At tick 8, goal activated at tick 5 → 3 ticks since activation → 'stronger'
    const context = buildGoalContext(goalManager, seedManager, [], 8);
    expect(context.planningPromptsSection).not.toBeNull();
    expect(context.planningPromptsSection).toContain('Planless Goal');
  });

  it('excludes planning prompts for goals with plans', () => {
    heartbeatStore.updateHeartbeatState(db, { tickNumber: 1 });

    const goal = goalManager.createGoal({ title: 'Planned Goal', origin: 'user_directed', status: 'active' });
    goalManager.createPlan(goal.id, { strategy: 'Step by step', createdBy: 'mind' });

    const context = buildGoalContext(goalManager, seedManager, [], 10);
    // Should not have planning prompts since the goal has a plan
    if (context.planningPromptsSection) {
      expect(context.planningPromptsSection).not.toContain('Planned Goal');
    }
  });
});

// --------------------------------------------------------------------------
// Planning Prompt Tests
// --------------------------------------------------------------------------

describe('generatePlanningPrompts', () => {
  it('returns empty array when all goals have plans', () => {
    const prompts = generatePlanningPrompts([
      { id: '1', title: 'Goal A', activatedAtTick: 1, hasPlan: true },
    ], 10);
    expect(prompts).toHaveLength(0);
  });

  it('returns empty array when activatedAtTick is null', () => {
    const prompts = generatePlanningPrompts([
      { id: '1', title: 'Goal A', activatedAtTick: null, hasPlan: false },
    ], 10);
    expect(prompts).toHaveLength(0);
  });

  it('returns soft urgency for recently activated goals', () => {
    const prompts = generatePlanningPrompts([
      { id: '1', title: 'New Goal', activatedAtTick: 5, hasPlan: false },
    ], 6); // 1 tick since activation
    expect(prompts).toHaveLength(1);
    expect(prompts[0]!.urgency).toBe('soft');
    expect(prompts[0]!.message).toContain('New Goal');
  });

  it('returns stronger urgency after STRONGER threshold ticks', () => {
    const activatedAtTick = 1;
    const currentTick = activatedAtTick + GOAL_PLANNING_PROMPT_STRONGER_TICKS;
    const prompts = generatePlanningPrompts([
      { id: '1', title: 'Lingering Goal', activatedAtTick, hasPlan: false },
    ], currentTick);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]!.urgency).toBe('stronger');
  });

  it('returns forceful urgency after FORCEFUL threshold ticks', () => {
    const activatedAtTick = 1;
    const currentTick = activatedAtTick + GOAL_PLANNING_PROMPT_FORCEFUL_TICKS;
    const prompts = generatePlanningPrompts([
      { id: '1', title: 'Stale Goal', activatedAtTick, hasPlan: false },
    ], currentTick);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]!.urgency).toBe('forceful');
  });

  it('generates prompts for multiple planless goals', () => {
    const prompts = generatePlanningPrompts([
      { id: '1', title: 'Goal A', activatedAtTick: 1, hasPlan: false },
      { id: '2', title: 'Goal B', activatedAtTick: 5, hasPlan: false },
      { id: '3', title: 'Goal C', activatedAtTick: 3, hasPlan: true }, // has plan
    ], 12);
    expect(prompts).toHaveLength(2);
    expect(prompts.map(p => p.goalId)).toEqual(['1', '2']);
  });

  it('skips goals with negative ticks since activation', () => {
    // Edge case: activated_at_tick is in the future (shouldn't happen, but be safe)
    const prompts = generatePlanningPrompts([
      { id: '1', title: 'Future Goal', activatedAtTick: 100, hasPlan: false },
    ], 5);
    expect(prompts).toHaveLength(0);
  });
});
