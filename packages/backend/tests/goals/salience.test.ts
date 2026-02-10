/**
 * Tests for goal salience scoring.
 */

import { describe, it, expect } from 'vitest';
import {
  computeSalience,
  GOAL_VISIBILITY_THRESHOLD,
  MAX_GOALS_IN_CONTEXT,
  RESONANCE_WEIGHT,
} from '../../src/goals/salience.js';
import type { Goal, EmotionState } from '@animus/shared';

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'goal-1',
    title: 'Test Goal',
    description: null,
    motivation: null,
    origin: 'ai_internal',
    seedId: null,
    linkedEmotion: null,
    createdByContactId: null,
    status: 'active',
    basePriority: 0.5,
    currentSalience: 0.5,
    completionCriteria: null,
    deadline: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    activatedAt: new Date().toISOString(),
    completedAt: null,
    abandonedAt: null,
    abandonedReason: null,
    lastProgressAt: null,
    lastUserMentionAt: null,
    ...overrides,
  };
}

function makeEmotionState(overrides: Partial<EmotionState> = {}): EmotionState {
  return {
    emotion: 'joy',
    category: 'positive',
    intensity: 0.5,
    baseline: 0.3,
    lastUpdatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('salience scoring', () => {
  describe('constants', () => {
    it('has expected visibility threshold', () => {
      expect(GOAL_VISIBILITY_THRESHOLD).toBe(0.3);
    });

    it('limits goals in context', () => {
      expect(MAX_GOALS_IN_CONTEXT).toBe(5);
    });

    it('has resonance weight', () => {
      expect(RESONANCE_WEIGHT).toBe(0.4);
    });
  });

  describe('computeSalience', () => {
    it('returns base priority when no modifiers apply', () => {
      const goal = makeGoal({ basePriority: 0.5, linkedEmotion: null });
      const result = computeSalience(goal, []);

      expect(result.salience).toBeGreaterThanOrEqual(0);
      expect(result.salience).toBeLessThanOrEqual(1);
      expect(result.components.basePriority).toBe(0.5);
      expect(result.components.emotionalResonance).toBe(0);
      expect(result.components.userEngagement).toBe(0);
      expect(result.components.progressMomentum).toBe(0);
      expect(result.components.urgency).toBe(0);
    });

    it('clamps salience to [0, 1]', () => {
      const goal = makeGoal({ basePriority: 1.0 });
      const result = computeSalience(goal, []);
      expect(result.salience).toBeLessThanOrEqual(1);
      expect(result.salience).toBeGreaterThanOrEqual(0);
    });

    it('includes emotional resonance for linked emotion', () => {
      const goal = makeGoal({
        basePriority: 0.5,
        linkedEmotion: 'joy',
      });
      const emotions = [
        makeEmotionState({ emotion: 'joy', intensity: 0.8, baseline: 0.3 }),
      ];
      const result = computeSalience(goal, emotions);

      // resonance = (0.8 - 0.3) * 0.4 = 0.2, clamped to [-0.2, 0.2]
      expect(result.components.emotionalResonance).toBe(0.2);
    });

    it('emotional resonance is negative when intensity below baseline', () => {
      const goal = makeGoal({
        basePriority: 0.5,
        linkedEmotion: 'joy',
      });
      const emotions = [
        makeEmotionState({ emotion: 'joy', intensity: 0.1, baseline: 0.5 }),
      ];
      const result = computeSalience(goal, emotions);

      // resonance = (0.1 - 0.5) * 0.4 = -0.16
      expect(result.components.emotionalResonance).toBeCloseTo(-0.16, 2);
    });

    it('clamps emotional resonance to [-0.2, 0.2]', () => {
      const goal = makeGoal({
        basePriority: 0.5,
        linkedEmotion: 'joy',
      });
      const emotions = [
        makeEmotionState({ emotion: 'joy', intensity: 1.0, baseline: 0.0 }),
      ];
      const result = computeSalience(goal, emotions);

      // resonance = (1.0 - 0.0) * 0.4 = 0.4, clamped to 0.2
      expect(result.components.emotionalResonance).toBe(0.2);
    });

    it('returns zero emotional resonance when no linked emotion', () => {
      const goal = makeGoal({ linkedEmotion: null });
      const result = computeSalience(goal, [makeEmotionState()]);
      expect(result.components.emotionalResonance).toBe(0);
    });

    it('boosts user engagement for recent mentions', () => {
      const goal = makeGoal({
        lastUserMentionAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 min ago
      });
      const result = computeSalience(goal, []);
      expect(result.components.userEngagement).toBe(0.2);
    });

    it('penalizes user engagement for old mentions', () => {
      const goal = makeGoal({
        lastUserMentionAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(), // 15 days ago
      });
      const result = computeSalience(goal, []);
      expect(result.components.userEngagement).toBe(-0.1);
    });

    it('boosts progress momentum for recent progress', () => {
      const goal = makeGoal({
        lastProgressAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(), // 12 hours ago
      });
      const result = computeSalience(goal, []);
      expect(result.components.progressMomentum).toBe(0.1);
    });

    it('penalizes stalled goals', () => {
      const goal = makeGoal({
        lastProgressAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(), // 15 days ago
      });
      const result = computeSalience(goal, []);
      expect(result.components.progressMomentum).toBe(-0.1);
    });

    it('boosts urgency for approaching deadline', () => {
      const goal = makeGoal({
        deadline: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(), // 12 hours from now
      });
      const result = computeSalience(goal, []);
      expect(result.components.urgency).toBe(0.25);
    });

    it('max urgency for overdue deadline', () => {
      const goal = makeGoal({
        deadline: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1 hour ago
      });
      const result = computeSalience(goal, []);
      expect(result.components.urgency).toBe(0.3);
    });

    it('no urgency when no deadline', () => {
      const goal = makeGoal({ deadline: null });
      const result = computeSalience(goal, []);
      expect(result.components.urgency).toBe(0);
    });

    it('boosts novelty for new goals', () => {
      const goal = makeGoal({
        createdAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(), // 6 hours ago
      });
      const result = computeSalience(goal, []);
      expect(result.components.novelty).toBe(0.1);
    });

    it('no novelty for old goals', () => {
      const goal = makeGoal({
        createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(), // 4 days ago
      });
      const result = computeSalience(goal, []);
      expect(result.components.novelty).toBe(0);
    });

    it('staleness penalty for inactive goals', () => {
      const goal = makeGoal({
        lastProgressAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days ago
        lastUserMentionAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      });
      const result = computeSalience(goal, []);
      expect(result.components.stalenessPenalty).toBe(-0.05);
    });

    it('returns all component values', () => {
      const result = computeSalience(makeGoal(), []);
      expect(result).toHaveProperty('salience');
      expect(result).toHaveProperty('components');
      expect(result.components).toHaveProperty('basePriority');
      expect(result.components).toHaveProperty('emotionalResonance');
      expect(result.components).toHaveProperty('userEngagement');
      expect(result.components).toHaveProperty('progressMomentum');
      expect(result.components).toHaveProperty('urgency');
      expect(result.components).toHaveProperty('stalenessPenalty');
      expect(result.components).toHaveProperty('novelty');
    });
  });
});
