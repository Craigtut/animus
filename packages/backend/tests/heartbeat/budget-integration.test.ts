/**
 * Tests for the budget-aware heartbeat integration.
 *
 * Covers:
 * - Budget context formatting in context-builder
 * - Budget status appearing in user message manifest
 * - Budget alert context injection
 * - Grace message context for hard-stopped budgets
 */

import { describe, it, expect } from 'vitest';
import {
  buildMindContext,
  buildUserMessage,
  type MindContextParams,
} from '../../src/heartbeat/context-builder.js';
import { compilePersona, type PersonaConfig } from '../../src/heartbeat/persona-compiler.js';
import type { EmotionState } from '@animus/shared';

// ============================================================================
// Helpers
// ============================================================================

function makePersonaConfig(): PersonaConfig {
  return {
    name: 'Test',
    existenceParadigm: 'digital_consciousness',
    dimensions: {
      extroversion: 0.5, trust: 0.5, leadership: 0.5, optimism: 0.5,
      confidence: 0.5, empathy: 0.5, cautious: 0.5, patience: 0.5,
      orderly: 0.5, altruism: 0.5,
    },
    traits: ['Analytical'],
    values: ['Knowledge'],
  };
}

function makeEmotion(emotion: string, intensity: number): EmotionState {
  return {
    emotion: emotion as EmotionState['emotion'],
    category: 'positive',
    intensity,
    baseline: 0,
    lastUpdatedAt: new Date().toISOString(),
  };
}

function makeParams(overrides: Partial<MindContextParams> = {}): MindContextParams {
  return {
    trigger: { type: 'interval', elapsedMs: 300000 },
    contact: null,
    sessionState: 'cold',
    currentEmotions: [makeEmotion('joy', 0.3)],
    tickIntervalMs: 300000,
    recentThoughts: [],
    recentExperiences: [],
    recentMessages: [],
    previousDecisions: [],
    compiledPersona: compilePersona(makePersonaConfig()),
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('budget context integration', () => {
  describe('budget status in user message', () => {
    it('excludes budget section when budgetStatus is null', () => {
      const msg = buildUserMessage(makeParams({ budgetStatus: null }));
      expect(msg).not.toContain('BUDGET STATUS');
    });

    it('excludes budget section when percentUsed is 0', () => {
      const msg = buildUserMessage(makeParams({
        budgetStatus: {
          percentUsed: 0,
          remainingUsd: 10.00,
          isThrottled: false,
          isHardStopped: false,
        },
      }));
      expect(msg).not.toContain('BUDGET STATUS');
    });

    it('includes budget section when budget has been used', () => {
      const msg = buildUserMessage(makeParams({
        budgetStatus: {
          percentUsed: 45,
          remainingUsd: 5.50,
          isThrottled: false,
          isHardStopped: false,
        },
      }));
      expect(msg).toContain('BUDGET STATUS');
      expect(msg).toContain('45%');
      expect(msg).toContain('$5.50');
    });

    it('includes throttle note when isThrottled is true', () => {
      const msg = buildUserMessage(makeParams({
        budgetStatus: {
          percentUsed: 85,
          remainingUsd: 1.50,
          isThrottled: true,
          isHardStopped: false,
        },
      }));
      expect(msg).toContain('BUDGET STATUS');
      expect(msg).toContain('throttled');
    });

    it('includes hard stop warning when isHardStopped is true', () => {
      const msg = buildUserMessage(makeParams({
        budgetStatus: {
          percentUsed: 100,
          remainingUsd: 0,
          isThrottled: true,
          isHardStopped: true,
        },
      }));
      expect(msg).toContain('BUDGET STATUS');
      expect(msg).toContain('grace response');
      expect(msg).toContain('Budget is exceeded');
    });
  });

  describe('budget alert in user message', () => {
    it('includes budget alert when threshold is crossed', () => {
      const msg = buildUserMessage(makeParams({
        budgetStatus: {
          percentUsed: 80,
          remainingUsd: 2.00,
          isThrottled: false,
          isHardStopped: false,
        },
        budgetAlert: {
          threshold: 0.8,
          spentUsd: 8.00,
          limitUsd: 10.00,
          percentUsed: 80,
          message: 'Budget 80% used',
        },
      }));
      expect(msg).toContain('BUDGET ALERT');
      expect(msg).toContain('80%');
      expect(msg).toContain('$8.00');
      expect(msg).toContain('$10.00');
    });

    it('does not include alert when budgetAlert is null', () => {
      const msg = buildUserMessage(makeParams({
        budgetStatus: {
          percentUsed: 50,
          remainingUsd: 5.00,
          isThrottled: false,
          isHardStopped: false,
        },
        budgetAlert: null,
      }));
      expect(msg).not.toContain('BUDGET ALERT');
    });
  });

  describe('budget context in compiled manifest', () => {
    it('budget_status section appears in manifest when active', () => {
      const ctx = buildMindContext(makeParams({
        budgetStatus: {
          percentUsed: 60,
          remainingUsd: 4.00,
          isThrottled: false,
          isHardStopped: false,
        },
      }));
      const section = ctx.userMessageManifest.find(s => s.id === 'budget_status');
      expect(section).toBeDefined();
      expect(section!.included).toBe(true);
      expect(section!.content).toContain('60%');
    });

    it('budget_status section is excluded when not active', () => {
      const ctx = buildMindContext(makeParams({
        budgetStatus: null,
      }));
      const section = ctx.userMessageManifest.find(s => s.id === 'budget_status');
      expect(section).toBeDefined();
      expect(section!.included).toBe(false);
    });

    it('budget_status section is excluded when percentUsed is 0', () => {
      const ctx = buildMindContext(makeParams({
        budgetStatus: {
          percentUsed: 0,
          remainingUsd: 10.00,
          isThrottled: false,
          isHardStopped: false,
        },
      }));
      const section = ctx.userMessageManifest.find(s => s.id === 'budget_status');
      expect(section).toBeDefined();
      expect(section!.included).toBe(false);
    });
  });

  describe('grace message context', () => {
    it('includes grace flag note in budget context when hard stopped', () => {
      const msg = buildUserMessage(makeParams({
        trigger: {
          type: 'message',
          contactId: 'c1',
          contactName: 'Alice',
          channel: 'web',
          messageContent: 'Hello',
          isBudgetGraceMessage: true,
        },
        budgetStatus: {
          percentUsed: 102,
          remainingUsd: -0.20,
          isThrottled: true,
          isHardStopped: true,
        },
      }));
      expect(msg).toContain('grace response');
      expect(msg).toContain('budget has been reached');
    });
  });
});
