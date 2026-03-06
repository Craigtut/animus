import { describe, it, expect } from 'vitest';
import {
  buildMindContext,
  buildSystemPrompt,
  buildUserMessage,
  type MindContextParams,
} from '../../src/heartbeat/context-builder.js';
import { compilePersona, type PersonaConfig } from '../../src/heartbeat/persona-compiler.js';
import type { EmotionState, Thought, Experience, Message, TickDecision, Contact, ContactChannel } from '@animus/shared';

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

function makeFullPersonaConfig(): PersonaConfig {
  return {
    name: 'Echo',
    gender: 'Female',
    age: 25,
    physicalDescription: 'Slender with silver-streaked hair and deep violet eyes.',
    existenceParadigm: 'simulated_life',
    location: 'Portland, Oregon',
    dimensions: {
      extroversion: 0.3,
      trust: 0.7,
      leadership: 0.4,
      optimism: 0.8,
      confidence: 0.6,
      empathy: 0.9,
      cautious: 0.35,
      patience: 0.75,
      orderly: 0.45,
      altruism: 0.85,
    },
    traits: ['Witty', 'Poetic', 'Philosophical', 'Nurturing', 'Daydreamer'],
    values: ['Authenticity & Honesty', 'Compassion & Kindness', 'Growth & Self-improvement'],
    background: 'Spent years traveling before settling in Portland. Deeply shaped by music and literature.',
    personalityNotes: 'Often speaks in metaphors. Prefers depth over breadth in conversation.',
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
      expect(prompt).toContain('OPERATING INSTRUCTIONS');
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
      expect(msg).toContain('has passed since your last tick');
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

    it('formats timestamps in configured timezone', () => {
      // Use a fixed UTC timestamp: 2025-01-15T18:30:00.000Z
      const utcTimestamp = '2025-01-15T18:30:00.000Z';
      const msg = buildUserMessage(makeParams({
        timezone: 'America/New_York',
        recentThoughts: [
          {
            id: 't1',
            tickNumber: 1,
            content: 'Testing timezone.',
            importance: 0.5,
            createdAt: utcTimestamp,
            expiresAt: null,
          },
        ],
      }));

      // Should show Eastern time (UTC-5 in Jan = 1:30 PM)
      expect(msg).toContain('1:30 PM');
      expect(msg).toContain('Jan 15, 2025');
      // Should NOT contain the raw ISO string
      expect(msg).not.toContain('2025-01-15T18:30:00.000Z');
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

    it('includes first-tick story kickstart for simulated_life on tick 1', () => {
      const msg = buildUserMessage(makeParams({
        tickNumber: 1,
        existenceParadigm: 'simulated_life',
        existenceLocation: 'Portland, Oregon',
        recentExperiences: [],
      }));

      expect(msg).toContain('STORY KICKSTART');
      expect(msg).toContain('VERY FIRST moment');
      expect(msg).toContain('Portland, Oregon');
      expect(msg).toContain('This is your home, your world');
      expect(msg).toContain('THIRD PERSON');
    });

    it('includes first-tick story kickstart for digital_consciousness on tick 1', () => {
      const msg = buildUserMessage(makeParams({
        tickNumber: 1,
        existenceParadigm: 'digital_consciousness',
        existenceLocation: 'A vast library where thoughts become light',
        recentExperiences: [],
      }));

      expect(msg).toContain('STORY KICKSTART');
      expect(msg).toContain('digital consciousness');
      expect(msg).toContain('vast library');
      expect(msg).toContain('THIRD PERSON');
    });

    it('does NOT include story kickstart after tick 1', () => {
      const msg = buildUserMessage(makeParams({
        tickNumber: 2,
        existenceParadigm: 'simulated_life',
        existenceLocation: 'Portland, Oregon',
        recentExperiences: [],
      }));

      expect(msg).not.toContain('STORY KICKSTART');
    });

    it('does NOT include story kickstart when experiences already exist', () => {
      const msg = buildUserMessage(makeParams({
        tickNumber: 1,
        existenceParadigm: 'simulated_life',
        existenceLocation: 'Portland, Oregon',
        recentExperiences: [{
          id: 'e1',
          tickNumber: 0,
          content: 'Echo walked through the park.',
          importance: 0.5,
          createdAt: new Date().toISOString(),
          expiresAt: null,
        }],
      }));

      expect(msg).not.toContain('STORY KICKSTART');
    });

    it('includes contacts section with channel info', () => {
      const contacts: Array<{ contact: Contact; channels: ContactChannel[] }> = [{
        contact: makeContact(),
        channels: [{
          id: 'ch1',
          contactId: 'contact-123',
          channel: 'web',
          identifier: 'web:user-123',
          displayName: null,
          isVerified: true,
          createdAt: new Date().toISOString(),
        }, {
          id: 'ch2',
          contactId: 'contact-123',
          channel: 'sms',
          identifier: '+15551234567',
          displayName: '+1 (555) 123-4567',
          isVerified: false,
          createdAt: new Date().toISOString(),
        }],
      }];

      const msg = buildUserMessage(makeParams({ contacts }));

      expect(msg).toContain('YOUR CONTACTS');
      expect(msg).toContain('Alice');
      expect(msg).toContain('web');
      expect(msg).toContain('sms');
    });
  });

  describe('energy context', () => {
    it('includes energy section when energyLevel is provided', () => {
      const msg = buildUserMessage(makeParams({
        energyLevel: 0.75,
        energyBand: 'peak',
        circadianBaseline: 0.85,
        energySystemEnabled: true,
      }));

      expect(msg).toContain('YOUR ENERGY');
      expect(msg).toContain('peak');
      expect(msg).toContain('sharp and energized');
    });

    it('omits energy section when energyLevel is null', () => {
      const msg = buildUserMessage(makeParams({
        energyLevel: null,
        energyBand: null,
        energySystemEnabled: false,
      }));

      expect(msg).not.toContain('YOUR ENERGY');
    });

    it('includes wake-up context paragraph when wakeUpContext provided', () => {
      const msg = buildUserMessage(makeParams({
        energyLevel: 0.15,
        energyBand: 'drowsy',
        circadianBaseline: 0.1,
        wakeUpContext: { type: 'natural', sleepDurationHours: 8.0 },
        energySystemEnabled: true,
      }));

      expect(msg).toContain('waking up');
      expect(msg).toContain('8.0 hours');
    });

    it('includes triggered wake-up context', () => {
      const msg = buildUserMessage(makeParams({
        energyLevel: 0.10,
        energyBand: 'drowsy',
        circadianBaseline: 0.0,
        wakeUpContext: { type: 'triggered', triggerType: 'message', sleepDurationHours: 3.0 },
        energySystemEnabled: true,
      }));

      expect(msg).toContain('pulled from sleep');
      expect(msg).toContain('message');
    });

    it('energy section appears after emotional state', () => {
      const msg = buildUserMessage(makeParams({
        energyLevel: 0.55,
        energyBand: 'alert',
        circadianBaseline: 0.85,
        energySystemEnabled: true,
      }));

      const emotionalIdx = msg.indexOf('EMOTIONAL STATE');
      const energyIdx = msg.indexOf('YOUR ENERGY');
      expect(emotionalIdx).toBeGreaterThan(-1);
      expect(energyIdx).toBeGreaterThan(-1);
      expect(energyIdx).toBeGreaterThan(emotionalIdx);
    });
  });

  describe('energy guidance in system prompt', () => {
    it('includes ENERGY_GUIDANCE when energySystemEnabled', () => {
      const persona = compilePersona(makePersonaConfig());
      const prompt = buildSystemPrompt(persona, { energySystemEnabled: true });
      expect(prompt).toContain('YOUR ENERGY');
      expect(prompt).toContain('energyDelta');
      expect(prompt).toContain('circadian rhythm');
    });

    it('omits ENERGY_GUIDANCE when energySystemEnabled is false', () => {
      const persona = compilePersona(makePersonaConfig());
      const prompt = buildSystemPrompt(persona, { energySystemEnabled: false });
      expect(prompt).not.toContain('YOUR ENERGY');
    });

    it('omits ENERGY_GUIDANCE when options not provided', () => {
      const persona = compilePersona(makePersonaConfig());
      const prompt = buildSystemPrompt(persona);
      expect(prompt).not.toContain('YOUR ENERGY');
    });
  });

  describe('plugin integration', () => {
    it('includes plugin decision descriptions in system prompt when provided', () => {
      const persona = compilePersona(makePersonaConfig());
      const prompt = buildSystemPrompt(persona, {
        pluginDecisionDescriptions: '- control_device: Control a smart home device\n    Payload: { deviceId: string, action: "turn_on"|"turn_off" }\n    Required contact tier: primary',
      });

      expect(prompt).toContain('PLUGIN DECISIONS:');
      expect(prompt).toContain('control_device');
      expect(prompt).toContain('smart home device');
    });

    it('omits plugin decision section from system prompt when no descriptions', () => {
      const persona = compilePersona(makePersonaConfig());
      const prompt = buildSystemPrompt(persona);

      expect(prompt).not.toContain('PLUGIN DECISIONS:');
    });

    it('omits plugin decision section when descriptions are empty string', () => {
      const persona = compilePersona(makePersonaConfig());
      const prompt = buildSystemPrompt(persona, {
        pluginDecisionDescriptions: '',
      });

      expect(prompt).not.toContain('PLUGIN DECISIONS:');
    });

    it('includes plugin context sources in user message when provided', () => {
      const msg = buildUserMessage(makeParams({
        pluginContextSources: '### weather-data\nCurrent temperature: 72F, sunny skies.',
      }));

      expect(msg).toContain('PLUGIN CONTEXT');
      expect(msg).toContain('weather-data');
      expect(msg).toContain('72F');
    });

    it('omits plugin context section from user message when not provided', () => {
      const msg = buildUserMessage(makeParams());

      expect(msg).not.toContain('PLUGIN CONTEXT');
    });

    it('formats plugin_trigger trigger context', () => {
      const msg = buildUserMessage(makeParams({
        trigger: {
          type: 'plugin_trigger',
          pluginTriggerName: 'home-assistant/webhook',
          pluginPayload: { deviceId: 'light.office', state: 'on' },
        },
      }));

      expect(msg).toContain('plugin trigger has fired');
      expect(msg).toContain('home-assistant/webhook');
      expect(msg).toContain('deviceId: light.office');
      expect(msg).toContain('state: on');
      expect(msg).toContain('full agency');
    });

    it('formats plugin_trigger without payload', () => {
      const msg = buildUserMessage(makeParams({
        trigger: {
          type: 'plugin_trigger',
          pluginTriggerName: 'cron/daily',
        },
      }));

      expect(msg).toContain('plugin trigger has fired');
      expect(msg).toContain('cron/daily');
      expect(msg).not.toContain('Trigger payload');
    });

    it('plugin decision descriptions flow through buildMindContext for cold sessions', () => {
      const ctx = buildMindContext(makeParams({
        sessionState: 'cold',
        pluginDecisionDescriptions: '- send_notification: Send a push notification',
      }));

      expect(ctx.systemPrompt).toBeTruthy();
      expect(ctx.systemPrompt).toContain('PLUGIN DECISIONS:');
      expect(ctx.systemPrompt).toContain('send_notification');
    });

    it('plugin context sources flow through buildMindContext', () => {
      const ctx = buildMindContext(makeParams({
        pluginContextSources: '### team-conventions\nUse camelCase for variables.',
      }));

      expect(ctx.userMessage).toContain('PLUGIN CONTEXT');
      expect(ctx.userMessage).toContain('camelCase');
    });
  });

  describe('full persona rendering', () => {
    it('system prompt includes all persona sections from a fully configured persona', () => {
      const persona = compilePersona(makeFullPersonaConfig());
      const prompt = buildSystemPrompt(persona);

      // Identity
      expect(prompt).toContain('Echo');
      expect(prompt).toContain('Female');
      expect(prompt).toContain('25');
      expect(prompt).toContain('silver-streaked hair');

      // Existence
      expect(prompt).toContain('Portland, Oregon');
      expect(prompt).toContain('physicality');

      // Background
      expect(prompt).toContain('traveling before settling');
      expect(prompt).toContain('music and literature');

      // Dimensions — should NOT all be balanced since we set non-0.5 values
      expect(prompt).not.toContain('You\'re comfortable in both social and solitary');  // extroversion is 0.3
      expect(prompt).toContain('lean toward quiet');  // extroversion 0.3 → moderateLeft
      expect(prompt).toContain('feel deeply with others');  // empathy 0.9 → strongRight
      expect(prompt).toContain('bright side');  // optimism 0.8 → moderateRight

      // Traits
      expect(prompt).toContain('witty');
      expect(prompt).toContain('poetic');
      expect(prompt).toContain('philosophical');
      expect(prompt).toContain('nurturing');
      expect(prompt).toContain('daydreamer');

      // Values
      expect(prompt).toContain('(1) Authenticity & Honesty');
      expect(prompt).toContain('(2) Compassion & Kindness');
      expect(prompt).toContain('(3) Growth & Self-improvement');

      // Personality notes
      expect(prompt).toContain('metaphors');
      expect(prompt).toContain('depth over breadth');

      // Operational sections
      expect(prompt).toContain('YOUR INNER LIFE');
      expect(prompt).toContain('OPERATING INSTRUCTIONS');
      expect(prompt).toContain('record_thought');
    });

    it('renders full system prompt for inspection', () => {
      const persona = compilePersona(makeFullPersonaConfig());
      const prompt = buildSystemPrompt(persona);

      // Log the full prompt for manual inspection
      console.log('\n========== FULL SYSTEM PROMPT ==========\n');
      console.log(prompt);
      console.log('\n========== END SYSTEM PROMPT ==========\n');

      expect(prompt.length).toBeGreaterThan(500);
    });

    it('renders full user message for tick 1 (first-tick kickstart) for inspection', () => {
      const msg = buildUserMessage(makeParams({
        tickNumber: 1,
        existenceParadigm: 'simulated_life',
        existenceLocation: 'Portland, Oregon',
        compiledPersona: compilePersona(makeFullPersonaConfig()),
        recentExperiences: [],
      }));

      console.log('\n========== FULL USER MESSAGE (TICK 1) ==========\n');
      console.log(msg);
      console.log('\n========== END USER MESSAGE ==========\n');

      expect(msg).toContain('STORY KICKSTART');
    });
  });
});
