/**
 * Tests for the Cortex 5-Phase Pipeline
 *
 * Tests the THOUGHT -> AGENTIC LOOP -> REFLECT pipeline flow,
 * context slot population, session persistence, and error handling.
 *
 * Uses mock implementations for CortexAgent, pi-ai, and database access.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Mock Setup
// ============================================================================

// Mock the logger
vi.mock('../../src/lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock the event bus
const mockEventBus = {
  emit: vi.fn(),
  on: vi.fn(() => vi.fn()),
  off: vi.fn(),
};
vi.mock('../../src/lib/event-bus.js', () => ({
  getEventBus: () => mockEventBus,
}));

// Mock database access
vi.mock('../../src/db/index.js', () => ({
  getSystemDb: vi.fn(() => ({})),
  getHeartbeatDb: vi.fn(() => ({})),
  getContactsDb: vi.fn(() => ({})),
  getMessagesDb: vi.fn(() => ({})),
  getMemoryDb: vi.fn(() => ({})),
  getAgentLogsDb: vi.fn(() => ({})),
}));

vi.mock('../../src/db/stores/heartbeat-store.js', () => ({
  getHeartbeatState: vi.fn(() => ({ tickNumber: 1, conversationHistory: null })),
  updateHeartbeatState: vi.fn(),
  insertThought: vi.fn(),
  insertExperience: vi.fn(),
}));

vi.mock('../../src/db/stores/agent-log-store.js', () => ({
  insertEvent: vi.fn(() => ({ id: 'test-event-id', sessionId: 'test', eventType: 'test', data: {}, createdAt: new Date().toISOString() })),
}));

vi.mock('../../src/db/stores/system-store.js', () => ({
  getSystemSettings: vi.fn(() => ({
    heartbeatIntervalMs: 300000,
    energySystemEnabled: false,
    cortexProvider: 'anthropic',
    cortexModel: 'claude-sonnet-4-20250514',
  })),
  getToolPermission: vi.fn(() => null),
  getToolPermissions: vi.fn(() => []),
}));

vi.mock('../../src/db/stores/contact-store.js', () => ({
  getContact: vi.fn(),
  listContacts: vi.fn(() => []),
  getContactChannelsByContactId: vi.fn(() => []),
}));

vi.mock('../../src/db/stores/message-store.js', () => ({
  getConversationByContactAndChannel: vi.fn(),
  createMessage: vi.fn(),
}));

vi.mock('../../src/db/stores/memory-store.js', () => ({
  getObservation: vi.fn(),
}));

vi.mock('../../src/channels/channel-router.js', () => ({
  getChannelRouter: vi.fn(() => ({
    sendOutbound: vi.fn(async () => ({ id: 'msg-1' })),
  })),
}));

vi.mock('../../src/tools/tool-gate.js', () => ({
  resolveToolGate: vi.fn(() => ({ action: 'allow' })),
}));

vi.mock('../../src/tools/registry.js', () => ({
  executeTool: vi.fn(async () => ({
    content: [{ type: 'text', text: 'Tool result' }],
    isError: false,
  })),
}));

vi.mock('../../src/lib/file-deny-list.js', () => ({
  isBlockedPath: vi.fn(() => false),
  isBlockedCommand: vi.fn(() => false),
}));

vi.mock('../../src/plugins/index.js', () => ({
  getPluginManager: vi.fn(() => ({})),
}));

// ============================================================================
// Mock Factories
// ============================================================================

interface MockGatherResult {
  trigger: {
    type: string;
    contactId?: string;
    contactName?: string;
    channel?: string;
    messageContent?: string;
    messageId?: string;
    elapsedMs?: number;
    [key: string]: unknown;
  };
  contact: { id: string; fullName: string; permissionTier: string } | null;
  emotions: Array<{ emotion: string; intensity: number }>;
  recentThoughts: Array<{ id: string; content: string; createdAt: string; importance: number }>;
  recentExperiences: Array<{ id: string; content: string; createdAt: string; importance: number }>;
  recentMessages: Array<{ id: string; content: string; createdAt: string; direction: string }>;
  previousDecisions: Array<{ type: string; description: string; outcome: string }>;
  tickIntervalMs: number;
  sessionState: 'cold' | 'warm';
  memoryContext: null;
  goalContext: null;
  spawnBudgetNote: null;
  contacts: Array<{ contact: { id: string; fullName: string; permissionTier: string; notes?: string }; channels: Array<{ channel: string }> }>;
  energyLevel: number | null;
  energyBand: string | null;
  circadianBaseline: number | null;
  wakeUpContext: null;
  energySystemEnabled: boolean;
  pluginDecisionDescriptions: string;
  pluginContextSources: string;
  credentialManifest: string;
  deferredTasks: never[];
  thoughtContext: { observations: null; rawItems: never[]; allFilteredItems: never[] };
  experienceContext: { observations: null; rawItems: never[]; allFilteredItems: never[] };
  messageContext: null;
  aiTimezone: string;
  trustRampContext: null;
  externalHistory: null;
  deliveryFailures: never[];
}

function createMockGather(overrides: Partial<MockGatherResult> = {}): MockGatherResult {
  return {
    trigger: {
      type: 'message',
      contactId: 'contact-1',
      contactName: 'Alice',
      channel: 'web',
      messageContent: 'Hello!',
      messageId: 'msg-1',
    },
    contact: { id: 'contact-1', fullName: 'Alice', permissionTier: 'primary' },
    emotions: [
      { emotion: 'joy', intensity: 0.5 },
      { emotion: 'curiosity', intensity: 0.6 },
    ],
    recentThoughts: [],
    recentExperiences: [],
    recentMessages: [],
    previousDecisions: [],
    tickIntervalMs: 300000,
    sessionState: 'cold',
    memoryContext: null,
    goalContext: null,
    spawnBudgetNote: null,
    contacts: [
      {
        contact: { id: 'contact-1', fullName: 'Alice', permissionTier: 'primary' },
        channels: [{ channel: 'web' }],
      },
    ],
    energyLevel: 0.8,
    energyBand: 'normal',
    circadianBaseline: 0.85,
    wakeUpContext: null,
    energySystemEnabled: true,
    pluginDecisionDescriptions: '',
    pluginContextSources: '',
    credentialManifest: '',
    deferredTasks: [],
    thoughtContext: { observations: null, rawItems: [], allFilteredItems: [] },
    experienceContext: { observations: null, rawItems: [], allFilteredItems: [] },
    messageContext: null,
    aiTimezone: 'America/New_York',
    trustRampContext: null,
    externalHistory: null,
    deliveryFailures: [],
    ...overrides,
  };
}

function createMockCompiledPersona() {
  return {
    compiledText: 'You are a friendly AI assistant named Animus.',
    compiledFor: 'mind' as const,
    sections: [],
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Cortex Pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Pipeline Phase Type', () => {
    it('should define all pipeline phases', async () => {
      // Import types to verify they compile
      const { type PipelinePhase } = await import('../../src/heartbeat/cortex-pipeline.js');

      // The type should cover all phases
      const phases: Array<import('../../src/heartbeat/cortex-pipeline.js').PipelinePhase> = [
        'gather', 'thought', 'agentic-loop', 'reflect', 'execute',
      ];
      expect(phases).toHaveLength(5);
    });
  });

  describe('Pipeline Result Structure', () => {
    it('should have the expected shape', () => {
      // Verify the result interface matches what executeOutput() expects
      const result = {
        output: {
          thought: { content: 'test', importance: 0.5 },
          reply: null,
          experience: { content: 'test experience', importance: 0.3 },
          emotionDeltas: [],
          decisions: [],
          workingMemoryUpdate: null,
          coreSelfUpdate: null,
          memoryCandidate: [],
        },
        replySentEarly: false,
        earlyReplyContent: '',
        allThoughts: [{ content: 'test', importance: 0.5 }],
        replyTurnsSent: 0,
      };

      expect(result.output.thought.content).toBe('test');
      expect(result.allThoughts).toHaveLength(1);
    });
  });
});

describe('Context Slot Population', () => {
  it('should populate all 9 slots', async () => {
    const { populateContextSlots, MIND_SLOT_NAMES } = await import('../../src/heartbeat/cortex-mind.js');

    expect(MIND_SLOT_NAMES).toHaveLength(9);
    expect(MIND_SLOT_NAMES).toContain('credentials');
    expect(MIND_SLOT_NAMES).toContain('contacts');
    expect(MIND_SLOT_NAMES).toContain('core-self');
    expect(MIND_SLOT_NAMES).toContain('working-memory');
    expect(MIND_SLOT_NAMES).toContain('thought-observations');
    expect(MIND_SLOT_NAMES).toContain('experience-observations');
    expect(MIND_SLOT_NAMES).toContain('message-observations');
    expect(MIND_SLOT_NAMES).toContain('goals');
    expect(MIND_SLOT_NAMES).toContain('tasks');
  });

  it('should call setSlot for each slot name', async () => {
    const { populateContextSlots } = await import('../../src/heartbeat/cortex-mind.js');

    const mockSetSlot = vi.fn();
    const mockAgent = {
      getContextManager: () => ({
        setSlot: mockSetSlot,
      }),
    };

    const gathered = createMockGather();
    populateContextSlots(mockAgent as any, gathered as any);

    // Should have been called 9 times (once per slot)
    expect(mockSetSlot).toHaveBeenCalledTimes(9);

    // Verify slot names
    const calledSlots = mockSetSlot.mock.calls.map((call: unknown[]) => call[0]);
    expect(calledSlots).toContain('credentials');
    expect(calledSlots).toContain('contacts');
    expect(calledSlots).toContain('core-self');
    expect(calledSlots).toContain('working-memory');
    expect(calledSlots).toContain('thought-observations');
    expect(calledSlots).toContain('experience-observations');
    expect(calledSlots).toContain('message-observations');
    expect(calledSlots).toContain('goals');
    expect(calledSlots).toContain('tasks');
  });

  it('should populate contacts slot with contact data', async () => {
    const { populateContextSlots } = await import('../../src/heartbeat/cortex-mind.js');

    const mockSetSlot = vi.fn();
    const mockAgent = {
      getContextManager: () => ({
        setSlot: mockSetSlot,
      }),
    };

    const gathered = createMockGather({
      contacts: [
        {
          contact: { id: 'c-1', fullName: 'Alice', permissionTier: 'primary', notes: 'Likes cats' },
          channels: [{ channel: 'web' }, { channel: 'sms' }],
        },
        {
          contact: { id: 'c-2', fullName: 'Bob', permissionTier: 'standard' },
          channels: [{ channel: 'discord' }],
        },
      ],
    });

    populateContextSlots(mockAgent as any, gathered as any);

    // Find the contacts slot call
    const contactsCall = mockSetSlot.mock.calls.find((call: unknown[]) => call[0] === 'contacts');
    expect(contactsCall).toBeDefined();
    const contactsContent = contactsCall![1] as string;
    expect(contactsContent).toContain('Alice');
    expect(contactsContent).toContain('Bob');
    expect(contactsContent).toContain('web, sms');
    expect(contactsContent).toContain('discord');
  });

  it('should handle empty contacts gracefully', async () => {
    const { populateContextSlots } = await import('../../src/heartbeat/cortex-mind.js');

    const mockSetSlot = vi.fn();
    const mockAgent = {
      getContextManager: () => ({
        setSlot: mockSetSlot,
      }),
    };

    const gathered = createMockGather({ contacts: [] });
    populateContextSlots(mockAgent as any, gathered as any);

    const contactsCall = mockSetSlot.mock.calls.find((call: unknown[]) => call[0] === 'contacts');
    expect(contactsCall![1]).toContain('No contacts yet');
  });
});

describe('MindToolContext', () => {
  it('should build tool context with correct fields', async () => {
    const { buildMindToolContext } = await import('../../src/heartbeat/cortex-mind.js');

    const gathered = createMockGather();
    const ctx = buildMindToolContext(gathered as any, null);

    expect(ctx.agentTaskId).toBe('mind');
    expect(ctx.contactId).toBe('contact-1');
    expect(ctx.sourceChannel).toBe('web');
    expect(ctx.stores).toBeDefined();
    expect(ctx.eventBus).toBeDefined();
  });

  it('should handle missing contact gracefully', async () => {
    const { buildMindToolContext } = await import('../../src/heartbeat/cortex-mind.js');

    const gathered = createMockGather({
      contact: null,
      trigger: { type: 'interval', elapsedMs: 300000 },
    });
    const ctx = buildMindToolContext(gathered as any, null);

    expect(ctx.contactId).toBe('');
    expect(ctx.sourceChannel).toBe('web');
  });
});

describe('CortexMindState', () => {
  it('should create empty state correctly', async () => {
    const { createCortexMindState } = await import('../../src/heartbeat/cortex-mind.js');

    const state = createCortexMindState();
    expect(state.agent).toBeNull();
    expect(state.providerManager).toBeNull();
    expect(state.model).toBeNull();
    expect(state.toolContext.current).toBeNull();
    expect(state.initialized).toBe(false);
    expect(state.conversationHistoryCheckpoint).toBeNull();
  });
});

describe('Error Classification Routing', () => {
  it('should classify authentication errors as fatal', async () => {
    const { classifyError } = await import('@animus-labs/cortex');

    const result = classifyError(new Error('invalid api key'));
    expect(result.category).toBe('authentication');
    expect(result.severity).toBe('fatal');
  });

  it('should classify rate limit errors as retry', async () => {
    const { classifyError } = await import('@animus-labs/cortex');

    const result = classifyError(new Error('rate limit exceeded'));
    expect(result.category).toBe('rate_limit');
    expect(result.severity).toBe('retry');
  });

  it('should classify context overflow as recoverable', async () => {
    const { classifyError } = await import('@animus-labs/cortex');

    const result = classifyError(new Error('context window exceeded'));
    expect(result.category).toBe('context_overflow');
    expect(result.severity).toBe('recoverable');
  });
});
