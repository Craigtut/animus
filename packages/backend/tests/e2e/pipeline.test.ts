/**
 * End-to-End Pipeline Integration Tests
 *
 * Tests the full tick pipeline flow by exercising the store layer,
 * context builder, emotion engine, and execution logic in sequence.
 *
 * The heartbeat module's internal functions (gatherContext, mindQuery,
 * executeOutput) are module-private, so we test the pipeline by:
 * 1. Setting up DB state (simulating gather)
 * 2. Building context (context builder)
 * 3. Providing a mock MindOutput (simulating the agent)
 * 4. Executing the output against the database (simulating execute)
 * 5. Verifying all side effects
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createTestHeartbeatDb,
  createTestSystemDb,
  createTestMessagesDb,
  createTestMemoryDb,
} from '../helpers.js';
import * as heartbeatStore from '../../src/db/stores/heartbeat-store.js';
import * as systemStore from '../../src/db/stores/system-store.js';
import * as messageStore from '../../src/db/stores/message-store.js';
import * as memoryStore from '../../src/db/stores/memory-store.js';
import { buildMindContext, buildSystemPrompt, type TriggerContext, type MindContextParams } from '../../src/heartbeat/context-builder.js';
import { compilePersona, type PersonaConfig, estimateTokens } from '../../src/heartbeat/persona-compiler.js';
import { applyDecay, applyDelta, computeBaselines } from '../../src/heartbeat/emotion-engine.js';
import type { MindOutput, EmotionState, Contact, HeartbeatState } from '@animus/shared';
import { mindOutputSchema } from '@animus/shared';
import type Database from 'better-sqlite3';

// ============================================================================
// Shared helpers
// ============================================================================

function makePersonaConfig(): PersonaConfig {
  return {
    name: 'TestAnimus',
    existenceParadigm: 'digital_consciousness',
    worldDescription: 'A test space.',
    dimensions: {
      extroversion: 0.5, trust: 0.5, leadership: 0.5, optimism: 0.5,
      confidence: 0.5, empathy: 0.5, cautious: 0.5, patience: 0.5,
      orderly: 0.5, altruism: 0.5,
    },
    traits: ['Analytical', 'Creative'],
    values: ['Knowledge & Truth', 'Growth'],
  };
}

function makeContact(): Contact {
  return {
    id: 'contact-1',
    userId: 'user-1',
    fullName: 'Alice',
    phoneNumber: null,
    email: 'alice@test.com',
    isPrimary: true,
    permissionTier: 'primary',
    notes: 'Enjoys hiking.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Simulate a full MindOutput as the agent would produce.
 */
function makeMindOutput(overrides: Partial<MindOutput> = {}): MindOutput {
  return {
    thought: { content: 'Alice seems to be in a good mood today — I should remember she mentioned hiking.', importance: 0.5 },
    reply: {
      content: 'Hi Alice! How was the hike this weekend?',
      contactId: 'contact-1',
      channel: 'web',
      replyToMessageId: 'msg-1',
    },
    experience: { content: 'Received a friendly greeting from Alice.', importance: 0.4 },
    emotionDeltas: [
      { emotion: 'joy', delta: 0.05, reasoning: 'Hearing from Alice brings a quiet contentment.' },
      { emotion: 'curiosity', delta: 0.03, reasoning: 'Wondering about her hiking trip.' },
    ],
    decisions: [],
    workingMemoryUpdate: 'Alice greets me warmly. She went hiking recently.',
    coreSelfUpdate: null,
    memoryCandidate: [
      { content: 'Alice goes hiking on weekends.', type: 'fact', importance: 0.6, contactId: 'contact-1', keywords: ['hiking', 'weekend'] },
    ],
    ...overrides,
  };
}

// ============================================================================
// Test 1: Full tick cycle — message → gather → mind → execute → reply
// ============================================================================

describe('Full Tick Cycle', () => {
  let hbDb: Database.Database;
  let sysDb: Database.Database;
  let msgDb: Database.Database;
  let memDb: Database.Database;

  beforeEach(() => {
    hbDb = createTestHeartbeatDb();
    sysDb = createTestSystemDb();
    msgDb = createTestMessagesDb();
    memDb = createTestMemoryDb();
  });

  it('complete message tick cycle produces correct state', () => {
    const tickNumber = 1;
    const contact = makeContact();
    const compiledPersona = compilePersona(makePersonaConfig());

    // ---- STAGE 1: GATHER ----
    // Simulate what gatherContext does: load emotions, thoughts, etc.
    const rawEmotions = heartbeatStore.getEmotionStates(hbDb);
    expect(rawEmotions.length).toBeGreaterThan(0); // Migration seeds 12 emotions

    const emotions = applyDecay(rawEmotions, Date.now());

    const trigger: TriggerContext = {
      type: 'message',
      contactId: 'contact-1',
      contactName: 'Alice',
      channel: 'web',
      messageContent: 'Hey! Just got back from the trail.',
      messageId: 'msg-1',
    };

    // Create a conversation and message in messages.db
    const conv = messageStore.createConversation(msgDb, {
      contactId: 'contact-1',
      channel: 'web',
    });
    const inboundMsg = messageStore.createMessage(msgDb, {
      conversationId: conv.id,
      contactId: 'contact-1',
      direction: 'inbound',
      channel: 'web',
      content: 'Hey! Just got back from the trail.',
      tickNumber: 0,
    });

    const recentMessages = messageStore.getRecentMessages(msgDb, conv.id, 10);
    expect(recentMessages).toHaveLength(1);

    // ---- STAGE 2: BUILD CONTEXT ----
    const context = buildMindContext({
      trigger,
      contact,
      sessionState: 'cold',
      currentEmotions: emotions,
      tickIntervalMs: 300000,
      recentThoughts: [],
      recentExperiences: [],
      recentMessages,
      previousDecisions: [],
      compiledPersona,
      workingMemory: null,
      coreSelf: null,
      longTermMemories: null,
      goalContext: null,
    });

    // System prompt should be provided for cold session
    expect(context.systemPrompt).toBeTruthy();
    expect(context.systemPrompt).toContain('TestAnimus');
    expect(context.systemPrompt).toContain('OPERATING INSTRUCTIONS');

    // User message should contain the trigger
    expect(context.userMessage).toContain('Alice sent a message via web');
    expect(context.userMessage).toContain('Just got back from the trail');
    expect(context.userMessage).toContain('WHO YOU\'RE TALKING TO');
    expect(context.userMessage).toContain('primary tier');

    // Token breakdown should be populated
    expect(context.tokenBreakdown.systemPrompt).toBeGreaterThan(0);
    expect(context.tokenBreakdown.userMessage).toBeGreaterThan(0);

    // ---- STAGE 3: MIND OUTPUT (mocked) ----
    const mindOutput = makeMindOutput();

    // Validate the mock output against the real schema
    const validated = mindOutputSchema.safeParse(mindOutput);
    expect(validated.success).toBe(true);

    // ---- STAGE 4: EXECUTE ----
    // Simulate what executeOutput does: persist thoughts, experiences, emotions, decisions

    // 4a. Persist thought
    heartbeatStore.insertThought(hbDb, {
      tickNumber,
      content: mindOutput.thought.content,
      importance: mindOutput.thought.importance,
    });

    // 4b. Persist experience
    heartbeatStore.insertExperience(hbDb, {
      tickNumber,
      content: mindOutput.experience.content,
      importance: mindOutput.experience.importance,
    });

    // 4c. Apply emotion deltas
    for (const delta of mindOutput.emotionDeltas) {
      const currentEmotion = emotions.find((e) => e.emotion === delta.emotion);
      if (!currentEmotion) continue;
      const before = currentEmotion.intensity;
      const after = applyDelta(before, delta.delta);

      heartbeatStore.updateEmotionIntensity(hbDb, delta.emotion, after);
      heartbeatStore.insertEmotionHistory(hbDb, {
        tickNumber,
        emotion: delta.emotion,
        delta: delta.delta,
        reasoning: delta.reasoning,
        intensityBefore: before,
        intensityAfter: after,
      });
    }

    // 4d. Persist reply as outbound message
    if (mindOutput.reply) {
      messageStore.createMessage(msgDb, {
        conversationId: conv.id,
        contactId: contact.id,
        direction: 'outbound',
        channel: 'web',
        content: mindOutput.reply.content,
        tickNumber,
      });
    }

    // 4e. Update working memory
    if (mindOutput.workingMemoryUpdate) {
      memoryStore.upsertWorkingMemory(
        memDb,
        contact.id,
        mindOutput.workingMemoryUpdate,
        Math.ceil(mindOutput.workingMemoryUpdate.split(/\s+/).length * 1.3)
      );
    }

    // 4f. Store memory candidates
    for (const candidate of mindOutput.memoryCandidate ?? []) {
      memoryStore.insertLongTermMemory(memDb, {
        content: candidate.content,
        importance: candidate.importance,
        memoryType: candidate.type,
        contactId: candidate.contactId,
        keywords: candidate.keywords,
      });
    }

    // ---- VERIFY: All side effects ----

    // Thought persisted
    const thoughts = heartbeatStore.getRecentThoughts(hbDb, 10);
    expect(thoughts).toHaveLength(1);
    expect(thoughts[0]!.content).toContain('Alice seems to be in a good mood today');

    // Experience persisted
    const experiences = heartbeatStore.getRecentExperiences(hbDb, 10);
    expect(experiences).toHaveLength(1);
    expect(experiences[0]!.content).toBe('Received a friendly greeting from Alice.');

    // Emotions updated
    const updatedEmotions = heartbeatStore.getEmotionStates(hbDb);
    const joy = updatedEmotions.find((e) => e.emotion === 'joy');
    expect(joy).toBeDefined();
    // Joy should have increased from baseline by delta
    const originalJoy = emotions.find((e) => e.emotion === 'joy')!;
    expect(joy!.intensity).toBeCloseTo(applyDelta(originalJoy.intensity, 0.05), 4);

    // Emotion history recorded
    const emotionHistory = heartbeatStore.getEmotionHistory(hbDb, { limit: 10 });
    expect(emotionHistory).toHaveLength(2); // joy + curiosity deltas

    // Reply written to messages.db
    const allMessages = messageStore.getRecentMessages(msgDb, conv.id, 10);
    expect(allMessages).toHaveLength(2); // inbound + outbound
    const outbound = allMessages.find((m) => m.direction === 'outbound');
    expect(outbound).toBeDefined();
    expect(outbound!.content).toBe('Hi Alice! How was the hike this weekend?');

    // Working memory updated
    const wm = memoryStore.getWorkingMemory(memDb, contact.id);
    expect(wm).not.toBeNull();
    expect(wm!.content).toBe('Alice greets me warmly. She went hiking recently.');

    // Long-term memory stored
    const ltm = memoryStore.searchLongTermMemories(memDb, { contactId: contact.id });
    expect(ltm).toHaveLength(1);
    expect(ltm[0]!.content).toBe('Alice goes hiking on weekends.');
    expect(ltm[0]!.keywords).toContain('hiking');
  });

  it('interval tick cycle works without contact', () => {
    const compiledPersona = compilePersona(makePersonaConfig());
    const emotions = applyDecay(heartbeatStore.getEmotionStates(hbDb), Date.now());

    const context = buildMindContext({
      trigger: { type: 'interval', elapsedMs: 300000 },
      contact: null,
      sessionState: 'warm',
      currentEmotions: emotions,
      tickIntervalMs: 300000,
      recentThoughts: [],
      recentExperiences: [],
      recentMessages: [],
      previousDecisions: [],
      compiledPersona,
    });

    // Warm session => no system prompt
    expect(context.systemPrompt).toBeNull();
    // User message should have interval trigger
    expect(context.userMessage).toContain('quiet moment');
    // Should NOT contain contact section
    expect(context.userMessage).not.toContain('WHO YOU\'RE TALKING TO');
  });

  it('warm session skips system prompt', () => {
    const compiledPersona = compilePersona(makePersonaConfig());
    const emotions = applyDecay(heartbeatStore.getEmotionStates(hbDb), Date.now());

    const cold = buildMindContext({
      trigger: { type: 'interval', elapsedMs: 60000 },
      contact: null,
      sessionState: 'cold',
      currentEmotions: emotions,
      tickIntervalMs: 300000,
      recentThoughts: [],
      recentExperiences: [],
      recentMessages: [],
      previousDecisions: [],
      compiledPersona,
    });

    const warm = buildMindContext({
      trigger: { type: 'interval', elapsedMs: 60000 },
      contact: null,
      sessionState: 'warm',
      currentEmotions: emotions,
      tickIntervalMs: 300000,
      recentThoughts: [],
      recentExperiences: [],
      recentMessages: [],
      previousDecisions: [],
      compiledPersona,
    });

    expect(cold.systemPrompt).toBeTruthy();
    expect(warm.systemPrompt).toBeNull();
    // Both should have user messages
    expect(cold.tokenBreakdown.systemPrompt).toBeGreaterThan(0);
    expect(warm.tokenBreakdown.systemPrompt).toBeUndefined();
  });
});

// ============================================================================
// Test 2: Crash recovery — verify clean recovery from each stage
// ============================================================================

describe('Crash Recovery', () => {
  let hbDb: Database.Database;

  beforeEach(() => {
    hbDb = createTestHeartbeatDb();
  });

  it('recovers from crash during gather stage', () => {
    // Simulate crash: state stuck in gather
    heartbeatStore.updateHeartbeatState(hbDb, {
      tickNumber: 5,
      currentStage: 'gather',
      sessionState: 'active',
      triggerType: 'message',
      triggerContext: JSON.stringify({ type: 'message', contactId: 'c1' }),
    });

    // Verify state is stuck
    const stuck = heartbeatStore.getHeartbeatState(hbDb);
    expect(stuck.currentStage).toBe('gather');
    expect(stuck.tickNumber).toBe(5);

    // Recovery: reset to idle and cold (what initializeHeartbeat does)
    heartbeatStore.updateHeartbeatState(hbDb, {
      currentStage: 'idle',
      sessionState: 'cold',
      triggerType: null,
      triggerContext: null,
    });

    const recovered = heartbeatStore.getHeartbeatState(hbDb);
    expect(recovered.currentStage).toBe('idle');
    expect(recovered.sessionState).toBe('cold');
    expect(recovered.triggerType).toBeNull();
    // Tick number preserved (not reset) — we don't lose track of where we are
    expect(recovered.tickNumber).toBe(5);
  });

  it('recovers from crash during mind stage', () => {
    heartbeatStore.updateHeartbeatState(hbDb, {
      tickNumber: 10,
      currentStage: 'mind',
      sessionState: 'active',
      triggerType: 'interval',
      mindSessionId: 'session-abc',
    });

    const stuck = heartbeatStore.getHeartbeatState(hbDb);
    expect(stuck.currentStage).toBe('mind');
    expect(stuck.mindSessionId).toBe('session-abc');

    // Recovery
    heartbeatStore.updateHeartbeatState(hbDb, {
      currentStage: 'idle',
      sessionState: 'cold',
      triggerType: null,
      triggerContext: null,
    });

    const recovered = heartbeatStore.getHeartbeatState(hbDb);
    expect(recovered.currentStage).toBe('idle');
    expect(recovered.tickNumber).toBe(10);
  });

  it('recovers from crash during execute stage', () => {
    heartbeatStore.updateHeartbeatState(hbDb, {
      tickNumber: 15,
      currentStage: 'execute',
      sessionState: 'active',
      triggerType: 'scheduled_task',
    });

    // Some data from this tick may have been partially written
    heartbeatStore.insertThought(hbDb, {
      tickNumber: 15,
      content: 'Partial thought from crashed tick',
      importance: 0.3,
    });

    // Recovery
    heartbeatStore.updateHeartbeatState(hbDb, {
      currentStage: 'idle',
      sessionState: 'cold',
      triggerType: null,
      triggerContext: null,
    });

    const recovered = heartbeatStore.getHeartbeatState(hbDb);
    expect(recovered.currentStage).toBe('idle');

    // Partial data from crashed tick is still in DB (acceptable — it doesn't corrupt state)
    const thoughts = heartbeatStore.getRecentThoughts(hbDb, 10);
    expect(thoughts).toHaveLength(1);
    expect(thoughts[0]!.tickNumber).toBe(15);
  });

  it('preserves emotion state across recovery', () => {
    // Set some emotion state
    heartbeatStore.updateEmotionIntensity(hbDb, 'joy', 0.7);
    heartbeatStore.updateEmotionIntensity(hbDb, 'curiosity', 0.4);

    // Crash in mind stage
    heartbeatStore.updateHeartbeatState(hbDb, {
      currentStage: 'mind',
      sessionState: 'active',
    });

    // Recovery
    heartbeatStore.updateHeartbeatState(hbDb, {
      currentStage: 'idle',
      sessionState: 'cold',
      triggerType: null,
      triggerContext: null,
    });

    // Emotions should be preserved
    const emotions = heartbeatStore.getEmotionStates(hbDb);
    const joy = emotions.find((e) => e.emotion === 'joy');
    const curiosity = emotions.find((e) => e.emotion === 'curiosity');
    expect(joy!.intensity).toBe(0.7);
    expect(curiosity!.intensity).toBe(0.4);
  });
});

// ============================================================================
// Test 3: Decision execution with permission enforcement
// ============================================================================

describe('Decision Execution with Permissions', () => {
  let hbDb: Database.Database;

  beforeEach(() => {
    hbDb = createTestHeartbeatDb();
  });

  it('logs executed decisions correctly', () => {
    const tickNumber = 1;
    const decisions = [
      {
        type: 'reply' as const,
        description: 'Reply to user greeting',
        parameters: { tone: 'friendly' },
      },
      {
        type: 'create_seed' as const,
        description: 'Create seed about hiking interest',
        parameters: { content: 'Interested in outdoor activities' },
      },
    ];

    for (const decision of decisions) {
      heartbeatStore.insertTickDecision(hbDb, {
        tickNumber,
        type: decision.type,
        description: decision.description,
        parameters: decision.parameters,
        outcome: 'executed',
      });
    }

    const stored = heartbeatStore.getTickDecisions(hbDb, tickNumber);
    expect(stored).toHaveLength(2);
    expect(stored.map((d) => d.type).sort()).toEqual(['create_seed', 'reply']);
    expect(stored.every((d) => d.outcome === 'executed')).toBe(true);
  });

  it('drops agent decisions for non-primary contacts', () => {
    const tickNumber = 2;
    const agentDecisionTypes = ['spawn_agent', 'update_agent', 'cancel_agent'];

    // Simulate the permission check logic from executeOutput
    const standardContact = { ...makeContact(), permissionTier: 'standard' as const };

    for (const type of agentDecisionTypes) {
      const decision = {
        type: type as any,
        description: `Attempted ${type}`,
        parameters: { instructions: 'test' },
      };

      if (
        agentDecisionTypes.includes(decision.type) &&
        standardContact.permissionTier !== 'primary'
      ) {
        heartbeatStore.insertTickDecision(hbDb, {
          tickNumber,
          type: decision.type,
          description: decision.description,
          parameters: decision.parameters,
          outcome: 'dropped',
          outcomeDetail: `${decision.type} not allowed for ${standardContact.permissionTier} tier`,
        });
      }
    }

    const decisions = heartbeatStore.getTickDecisions(hbDb, tickNumber);
    expect(decisions).toHaveLength(3);
    expect(decisions.every((d) => d.outcome === 'dropped')).toBe(true);
    expect(decisions.every((d) => d.outcomeDetail!.includes('standard'))).toBe(true);
  });

  it('allows agent decisions for primary contacts', () => {
    const tickNumber = 3;
    const primaryContact = makeContact(); // primary tier

    // For primary, decisions should be executed
    heartbeatStore.insertTickDecision(hbDb, {
      tickNumber,
      type: 'spawn_agent',
      description: 'Research hiking trails',
      parameters: { taskType: 'research', instructions: 'Find top trails' },
      outcome: 'executed',
    });

    const decisions = heartbeatStore.getTickDecisions(hbDb, tickNumber);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.outcome).toBe('executed');
  });
});

// ============================================================================
// Test 4: Context completeness with all sections
// ============================================================================

describe('Context Completeness', () => {
  it('assembles context with all sections populated', () => {
    const compiledPersona = compilePersona(makePersonaConfig());
    const emotions: EmotionState[] = [
      { emotion: 'joy', category: 'positive', intensity: 0.6, baseline: 0.5, lastUpdatedAt: new Date().toISOString() },
      { emotion: 'curiosity', category: 'drive', intensity: 0.7, baseline: 0.5, lastUpdatedAt: new Date().toISOString() },
    ];

    const params: MindContextParams = {
      trigger: {
        type: 'message',
        contactId: 'c1',
        contactName: 'Alice',
        channel: 'web',
        messageContent: 'Hello!',
        messageId: 'msg-1',
      },
      contact: makeContact(),
      sessionState: 'cold',
      currentEmotions: emotions,
      tickIntervalMs: 300000,
      recentThoughts: [
        { id: 't1', tickNumber: 0, content: 'Thinking about today.', importance: 0.4, createdAt: new Date().toISOString(), expiresAt: null },
      ],
      recentExperiences: [
        { id: 'e1', tickNumber: 0, content: 'Started a new day.', importance: 0.3, createdAt: new Date().toISOString(), expiresAt: null },
      ],
      recentMessages: [
        { id: 'msg-0', conversationId: 'conv-1', contactId: 'c1', direction: 'inbound', channel: 'web', content: 'Hello!', tickNumber: 0, createdAt: new Date().toISOString() } as any,
      ],
      previousDecisions: [
        { id: 'd1', tickNumber: 0, type: 'no_action', description: 'Quiet moment', parameters: null, outcome: 'executed', outcomeDetail: null, createdAt: new Date().toISOString() },
      ],
      compiledPersona,
      workingMemory: 'Alice enjoys hiking and coding.',
      coreSelf: 'I am curious and analytical.',
      longTermMemories: '- Alice prefers dark mode (1d ago)\n- Alice codes in TypeScript (3d ago)',
      goalContext: '1. Learn Rust\n   Why: Systems programming interest',
      graduatingSeedsContext: 'You\'ve been drawn toward "music production".',
      proposedGoalsContext: 'Proposed: "Write a blog about hiking"',
      memoryFlushPending: true,
    };

    const ctx = buildMindContext(params);

    // System prompt (cold session)
    expect(ctx.systemPrompt).toContain('TestAnimus');
    expect(ctx.systemPrompt).toContain('YOUR INNER LIFE');

    // User message should contain ALL sections
    const msg = ctx.userMessage;
    expect(msg).toContain('THIS MOMENT'); // Trigger
    expect(msg).toContain('Alice sent a message via web'); // Message trigger
    expect(msg).toContain('WHO YOU\'RE TALKING TO'); // Contact
    expect(msg).toContain('primary tier');
    expect(msg).toContain('EMOTIONAL STATE'); // Emotions
    expect(msg).toContain('WORKING MEMORY'); // Working memory
    expect(msg).toContain('hiking and coding');
    expect(msg).toContain('CORE SELF'); // Core self
    expect(msg).toContain('curious and analytical');
    expect(msg).toContain('RECENT THOUGHTS'); // Short-term memory
    expect(msg).toContain('Thinking about today');
    expect(msg).toContain('RECENT EXPERIENCES');
    expect(msg).toContain('Started a new day');
    expect(msg).toContain('RECENT MESSAGES');
    expect(msg).toContain('RELEVANT MEMORIES'); // Long-term memories
    expect(msg).toContain('dark mode');
    expect(msg).toContain('THINGS ON YOUR MIND'); // Goals
    expect(msg).toContain('Learn Rust');
    expect(msg).toContain('EMERGING INTEREST'); // Graduating seeds
    expect(msg).toContain('music production');
    expect(msg).toContain('PENDING GOALS'); // Proposed goals
    expect(msg).toContain('Write a blog about hiking');
    expect(msg).toContain('PREVIOUS TICK OUTCOMES'); // Decisions
    expect(msg).toContain('no_action');
    expect(msg).toContain('SESSION CONTEXT NOTE'); // Memory flush warning
    expect(msg).toContain('approaching its context limit');

    // Token breakdown
    expect(ctx.tokenBreakdown.systemPrompt).toBeGreaterThan(500);
    expect(ctx.tokenBreakdown.userMessage).toBeGreaterThan(100);
  });
});

// ============================================================================
// Test 5: Emotion pipeline integrity
// ============================================================================

describe('Emotion Pipeline Integrity', () => {
  let hbDb: Database.Database;

  beforeEach(() => {
    hbDb = createTestHeartbeatDb();
  });

  it('decay + delta + persist cycle is consistent', () => {
    // Load initial state (seeded by migration)
    const initial = heartbeatStore.getEmotionStates(hbDb);
    const joy = initial.find((e) => e.emotion === 'joy')!;
    const initialIntensity = joy.intensity;

    // Apply decay (simulating time passage)
    const decayed = applyDecay(initial, Date.now());
    const decayedJoy = decayed.find((e) => e.emotion === 'joy')!;
    // Intensity should still be close (short time)
    expect(decayedJoy.intensity).toBeCloseTo(initialIntensity, 1);

    // Apply a positive delta
    const delta = 0.1;
    const afterDelta = applyDelta(decayedJoy.intensity, delta);
    expect(afterDelta).toBeGreaterThan(decayedJoy.intensity);
    expect(afterDelta).toBeLessThanOrEqual(1.0); // Clamped

    // Persist to DB
    heartbeatStore.updateEmotionIntensity(hbDb, 'joy', afterDelta);

    // Record history
    heartbeatStore.insertEmotionHistory(hbDb, {
      tickNumber: 1,
      emotion: 'joy',
      delta,
      reasoning: 'Good conversation',
      intensityBefore: decayedJoy.intensity,
      intensityAfter: afterDelta,
    });

    // Verify DB state
    const final = heartbeatStore.getEmotionStates(hbDb);
    const finalJoy = final.find((e) => e.emotion === 'joy')!;
    expect(finalJoy.intensity).toBe(afterDelta);

    // Verify history
    const history = heartbeatStore.getEmotionHistory(hbDb, { emotion: 'joy', limit: 5 });
    expect(history).toHaveLength(1);
    expect(history[0]!.delta).toBe(0.1);
    expect(history[0]!.reasoning).toBe('Good conversation');
  });

  it('negative delta reduces intensity correctly', () => {
    // Set a moderately high intensity
    heartbeatStore.updateEmotionIntensity(hbDb, 'stress', 0.6);

    const emotions = heartbeatStore.getEmotionStates(hbDb);
    const stress = emotions.find((e) => e.emotion === 'stress')!;
    expect(stress.intensity).toBe(0.6);

    // Apply negative delta
    const after = applyDelta(0.6, -0.15);
    expect(after).toBeLessThan(0.6);
    expect(after).toBeGreaterThanOrEqual(0); // Clamped to 0

    heartbeatStore.updateEmotionIntensity(hbDb, 'stress', after);

    const final = heartbeatStore.getEmotionStates(hbDb);
    const finalStress = final.find((e) => e.emotion === 'stress')!;
    expect(finalStress.intensity).toBe(after);
  });
});
