import { describe, it, expect } from 'vitest';
import {
  buildMindContext,
  buildSystemPrompt,
  buildUserMessage,
  type MindContextParams,
} from '../../src/heartbeat/context-builder.js';
import { compilePersona, type PersonaConfig } from '../../src/heartbeat/persona-compiler.js';
import type { EmotionState, Thought, Experience, Message, TickDecision, Contact } from '@animus/shared';

function makePersonaConfig(): PersonaConfig {
  return {
    name: 'Test',
    existenceParadigm: 'digital_consciousness',
    worldDescription: 'A test environment.',
    dimensions: {
      extroversion: 0.5, trust: 0.5, leadership: 0.5, optimism: 0.5,
      confidence: 0.5, empathy: 0.5, cautious: 0.5, patience: 0.5,
      orderly: 0.5, altruism: 0.5,
    },
    traits: ['Analytical'],
    values: ['Knowledge & Truth'],
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

function makeContact(): Contact {
  return {
    id: 'contact-123',
    userId: 'user-123',
    fullName: 'Alice',
    phoneNumber: null,
    email: 'alice@example.com',
    isPrimary: true,
    permissionTier: 'primary',
    notes: 'Loves hiking and code.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeParams(overrides: Partial<MindContextParams> = {}): MindContextParams {
  return {
    trigger: { type: 'interval', elapsedMs: 300000 },
    contact: null,
    sessionState: 'cold',
    currentEmotions: [makeEmotion('joy', 0.5), makeEmotion('curiosity', 0.3)],
    tickIntervalMs: 300000,
    recentThoughts: [],
    recentExperiences: [],
    recentMessages: [],
    previousDecisions: [],
    compiledPersona: compilePersona(makePersonaConfig()),
    ...overrides,
  };
}

describe('context-builder', () => {
  describe('buildSystemPrompt', () => {
    it('includes persona and operational instructions', () => {
      const persona = compilePersona(makePersonaConfig());
      const prompt = buildSystemPrompt(persona);

      expect(prompt).toContain('Test'); // Name
      expect(prompt).toContain('YOUR INNER LIFE');
      expect(prompt).toContain('OUTPUT FORMAT');
      expect(prompt).toContain('YOUR EMOTIONS');
      expect(prompt).toContain('DECISIONS');
      expect(prompt).toContain('YOUR MEMORY');
      expect(prompt).toContain('SESSION AWARENESS');
    });
  });

  describe('buildMindContext', () => {
    it('includes systemPrompt for cold sessions', () => {
      const ctx = buildMindContext(makeParams({ sessionState: 'cold' }));
      expect(ctx.systemPrompt).toBeTruthy();
      expect(ctx.userMessage).toBeTruthy();
    });

    it('excludes systemPrompt for warm sessions', () => {
      const ctx = buildMindContext(makeParams({ sessionState: 'warm' }));
      expect(ctx.systemPrompt).toBeNull();
      expect(ctx.userMessage).toBeTruthy();
    });

    it('includes token breakdown', () => {
      const ctx = buildMindContext(makeParams());
      expect(ctx.tokenBreakdown.userMessage).toBeGreaterThan(0);
    });
  });

  describe('buildUserMessage', () => {
    it('formats interval trigger', () => {
      const msg = buildUserMessage(makeParams());
      expect(msg).toContain('THIS MOMENT');
      expect(msg).toContain('quiet moment');
    });

    it('formats message trigger', () => {
      const msg = buildUserMessage(makeParams({
        trigger: {
          type: 'message',
          contactId: 'c1',
          contactName: 'Alice',
          channel: 'web',
          messageContent: 'Hello there!',
          messageId: 'msg-1',
        },
        contact: makeContact(),
      }));

      expect(msg).toContain('Alice sent a message via web');
      expect(msg).toContain('Hello there!');
      expect(msg).toContain('WHO YOU\'RE TALKING TO');
      expect(msg).toContain('primary tier');
    });

    it('formats agent_complete trigger', () => {
      const msg = buildUserMessage(makeParams({
        trigger: {
          type: 'agent_complete',
          agentId: 'agent-1',
          taskDescription: 'Research topic X',
          outcome: 'completed',
          resultContent: 'Found three relevant papers.',
        },
      }));

      expect(msg).toContain('sub-agent has completed');
      expect(msg).toContain('Research topic X');
      expect(msg).toContain('Found three relevant papers');
    });

    it('formats scheduled_task trigger', () => {
      const msg = buildUserMessage(makeParams({
        trigger: {
          type: 'scheduled_task',
          taskId: 'task-1',
          taskTitle: 'Daily check-in',
          taskType: 'recurring',
          taskInstructions: 'Send a morning greeting',
          goalTitle: 'Stay connected',
        },
      }));

      expect(msg).toContain('scheduled task has fired');
      expect(msg).toContain('Daily check-in');
      expect(msg).toContain('Stay connected');
    });

    it('includes emotional state', () => {
      const msg = buildUserMessage(makeParams());
      expect(msg).toContain('EMOTIONAL STATE');
      expect(msg).toContain('joy:');
    });

    it('includes working memory when provided', () => {
      const msg = buildUserMessage(makeParams({
        workingMemory: 'Alice likes hiking and is working on a React project.',
        contact: makeContact(),
        trigger: { type: 'message', contactId: 'c1', contactName: 'Alice', channel: 'web', messageContent: 'Hi' },
      }));

      expect(msg).toContain('WORKING MEMORY');
      expect(msg).toContain('React project');
    });

    it('includes core self when provided', () => {
      const msg = buildUserMessage(makeParams({
        coreSelf: 'I tend to be curious about new technologies.',
      }));

      expect(msg).toContain('CORE SELF');
      expect(msg).toContain('curious about new technologies');
    });

    it('includes recent thoughts', () => {
      const msg = buildUserMessage(makeParams({
        recentThoughts: [
          {
            id: 't1',
            tickNumber: 1,
            content: 'The sunset is beautiful today.',
            importance: 0.5,
            createdAt: new Date().toISOString(),
            expiresAt: null,
          },
        ],
      }));

      expect(msg).toContain('RECENT THOUGHTS');
      expect(msg).toContain('sunset is beautiful');
    });

    it('includes previous tick decisions', () => {
      const msg = buildUserMessage(makeParams({
        previousDecisions: [
          {
            id: 'd1',
            tickNumber: 1,
            type: 'send_message',
            description: 'Replied to user greeting',
            parameters: null,
            outcome: 'executed',
            outcomeDetail: null,
            createdAt: new Date().toISOString(),
          },
        ],
      }));

      expect(msg).toContain('PREVIOUS TICK OUTCOMES');
      expect(msg).toContain('send_message');
      expect(msg).toContain('done');
    });

    it('includes contact notes in permission section', () => {
      const contact = makeContact();
      const msg = buildUserMessage(makeParams({
        trigger: { type: 'message', contactId: 'c1', contactName: 'Alice', channel: 'web', messageContent: 'Hi' },
        contact,
      }));

      expect(msg).toContain('Loves hiking and code');
    });

    it('omits empty sections', () => {
      const msg = buildUserMessage(makeParams({
        recentThoughts: [],
        recentExperiences: [],
        recentMessages: [],
        previousDecisions: [],
      }));

      expect(msg).not.toContain('RECENT THOUGHTS');
      expect(msg).not.toContain('RECENT EXPERIENCES');
      expect(msg).not.toContain('RECENT MESSAGES');
      expect(msg).not.toContain('PREVIOUS TICK OUTCOMES');
    });

    it('includes long-term memories when provided', () => {
      const msg = buildUserMessage(makeParams({
        longTermMemories: '- User prefers dark mode (2d ago)\n- User is a Python developer (1w ago)',
      }));

      expect(msg).toContain('RELEVANT MEMORIES');
      expect(msg).toContain('User prefers dark mode');
      expect(msg).toContain('Python developer');
    });

    it('includes goal context when provided', () => {
      const msg = buildUserMessage(makeParams({
        goalContext: '1. Learn Rust\n   Why: Want to expand systems knowledge',
      }));

      expect(msg).toContain('THINGS ON YOUR MIND');
      expect(msg).toContain('Learn Rust');
    });

    it('includes graduating seeds when provided', () => {
      const msg = buildUserMessage(makeParams({
        graduatingSeedsContext: 'A pattern has emerged: you\'ve been drawn toward "music composition".',
      }));

      expect(msg).toContain('EMERGING INTEREST');
      expect(msg).toContain('music composition');
    });

    it('includes proposed goals when provided', () => {
      const msg = buildUserMessage(makeParams({
        proposedGoalsContext: 'Proposed goal awaiting approval: "Write a blog post"',
      }));

      expect(msg).toContain('PENDING GOALS');
      expect(msg).toContain('Write a blog post');
    });

    it('includes memory flush warning when pending', () => {
      const msg = buildUserMessage(makeParams({
        memoryFlushPending: true,
      }));

      expect(msg).toContain('SESSION CONTEXT NOTE');
      expect(msg).toContain('approaching its context limit');
      expect(msg).toContain('working memory update');
    });

    it('omits memory flush warning when not pending', () => {
      const msg = buildUserMessage(makeParams({
        memoryFlushPending: false,
      }));

      expect(msg).not.toContain('SESSION CONTEXT NOTE');
    });
  });
});
