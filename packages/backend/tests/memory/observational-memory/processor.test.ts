import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock env before importing modules that depend on logger -> env
vi.mock('../../../src/utils/env.js', () => ({
  env: { ANIMUS_ENCRYPTION_KEY: 'test-key', NODE_ENV: 'test', LOG_LEVEL: 'error' },
  PROJECT_ROOT: '/tmp/animus-test',
  DATA_DIR: '/tmp/animus-test/data',
}));

// Mock the observer and reflector so we don't need real agent sessions
vi.mock('../../../src/memory/observational-memory/observer.js', () => ({
  runObserver: vi.fn(),
}));

vi.mock('../../../src/memory/observational-memory/reflector.js', () => ({
  runReflector: vi.fn(),
}));

// Mock memory store
vi.mock('../../../src/db/stores/memory-store.js', () => ({
  getObservation: vi.fn(),
  upsertObservation: vi.fn(),
  updateObservationContent: vi.fn(),
}));

import {
  loadStreamContext,
  processStream,
  activeOps,
  type RawItem,
} from '../../../src/memory/observational-memory/index.js';
import { runObserver } from '../../../src/memory/observational-memory/observer.js';
import { runReflector } from '../../../src/memory/observational-memory/reflector.js';
import * as memoryStore from '../../../src/db/stores/memory-store.js';
import { OBSERVATIONAL_MEMORY_CONFIG } from '../../../src/config/observational-memory.config.js';

// Helpers
function makeItem(id: string, content: string, createdAt: string): RawItem {
  return { id, content, createdAt };
}

// Generate items with enough tokens to exceed a budget
function makeItemsWithTokens(count: number, tokensEach: number): RawItem[] {
  // estimateTokens = ceil(words * 1.3), so for N tokens we need ~N/1.3 words
  const wordsNeeded = Math.ceil(tokensEach / 1.3);
  const content = Array(wordsNeeded).fill('word').join(' ');
  return Array.from({ length: count }, (_, i) => ({
    id: `item-${i}`,
    content,
    createdAt: `2026-02-14T${String(10 + i).padStart(2, '0')}:00:00Z`,
  }));
}

function mockEventBus() {
  return {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  };
}

function mockDeps(eventBus = mockEventBus()) {
  return {
    agentManager: {
      getConfiguredProviders: vi.fn().mockReturnValue(['claude']),
      createSession: vi.fn(),
      isConfigured: vi.fn().mockReturnValue(true),
    } as any,
    memoryDb: {} as any,
    compiledPersona: 'Test persona',
    eventBus,
  };
}

describe('observation processor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeOps.clear();
  });

  describe('loadStreamContext', () => {
    it('returns all items when under budget and no observation exists', () => {
      vi.mocked(memoryStore.getObservation).mockReturnValue(null);

      const items = [
        makeItem('1', 'Hello world', '2026-02-14T10:00:00Z'),
        makeItem('2', 'How are you', '2026-02-14T10:01:00Z'),
      ];

      const result = loadStreamContext({
        stream: 'messages',
        contactId: 'contact-1',
        memoryDb: {} as any,
        rawItems: items,
        rawTokenBudget: 4000,
      });

      expect(result.observations).toBeNull();
      expect(result.rawItems).toHaveLength(2);
      expect(result.allFilteredItems).toHaveLength(2);
      expect(result.rawTokenCount).toBeGreaterThan(0);
    });

    it('filters items newer than watermark', () => {
      vi.mocked(memoryStore.getObservation).mockReturnValue({
        id: 'obs-1',
        contactId: 'contact-1',
        stream: 'messages',
        content: 'existing observations',
        tokenCount: 100,
        generation: 1,
        lastRawId: 'old-item',
        lastRawTimestamp: '2026-02-14T10:00:00Z',
        createdAt: '2026-02-14T09:00:00Z',
        updatedAt: '2026-02-14T10:00:00Z',
      });

      const items = [
        makeItem('3', 'New message', '2026-02-14T10:02:00Z'),
        makeItem('2', 'At watermark', '2026-02-14T10:00:00Z'),
        makeItem('1', 'Before watermark', '2026-02-14T09:55:00Z'),
      ];

      const result = loadStreamContext({
        stream: 'messages',
        contactId: 'contact-1',
        memoryDb: {} as any,
        rawItems: items,
        rawTokenBudget: 4000,
      });

      // Only items strictly after watermark
      expect(result.rawItems).toHaveLength(1);
      expect(result.rawItems[0]!.id).toBe('3');
      // allFilteredItems should also only contain watermark-filtered items
      expect(result.allFilteredItems).toHaveLength(1);
      expect(result.allFilteredItems[0]!.id).toBe('3');
    });

    it('respects token budget', () => {
      vi.mocked(memoryStore.getObservation).mockReturnValue(null);

      // Create items with many tokens each
      const items = makeItemsWithTokens(20, 500);

      const result = loadStreamContext({
        stream: 'thoughts',
        contactId: null,
        memoryDb: {} as any,
        rawItems: items,
        rawTokenBudget: 1000,
      });

      // Should only include items up to ~1000 tokens
      expect(result.rawTokenCount).toBeLessThanOrEqual(1500); // Some overshoot from first item
      expect(result.rawItems.length).toBeLessThan(items.length);
      // allFilteredItems should contain ALL items (no budget trimming, no watermark)
      expect(result.allFilteredItems).toHaveLength(items.length);
    });

    it('always includes at least one item even if it exceeds budget', () => {
      vi.mocked(memoryStore.getObservation).mockReturnValue(null);

      const items = [makeItem('1', Array(1000).fill('word').join(' '), '2026-02-14T10:00:00Z')];

      const result = loadStreamContext({
        stream: 'thoughts',
        contactId: null,
        memoryDb: {} as any,
        rawItems: items,
        rawTokenBudget: 10,
      });

      expect(result.rawItems).toHaveLength(1);
    });
  });

  describe('processStream — threshold logic', () => {
    it('does nothing when raw tokens are under budget', async () => {
      const items = [makeItem('1', 'Short message', '2026-02-14T10:00:00Z')];
      const deps = mockDeps();

      await processStream({
        deps,
        stream: 'messages',
        contactId: null,
        rawItems: items,
        config: OBSERVATIONAL_MEMORY_CONFIG,
      });

      // Observer should not have been called
      expect(runObserver).not.toHaveBeenCalled();
      expect(deps.eventBus.emit).not.toHaveBeenCalled();
    });

    it('does nothing when overflow is below batch threshold', async () => {
      // messages rawTokens = 4000, batchThreshold = 0.25 → need 1000+ overflow
      // Create items totaling ~4500 tokens (500 overflow, below 1000 threshold)
      const items = makeItemsWithTokens(9, 500);
      const deps = mockDeps();

      await processStream({
        deps,
        stream: 'messages',
        contactId: null,
        rawItems: items,
        config: OBSERVATIONAL_MEMORY_CONFIG,
      });

      expect(runObserver).not.toHaveBeenCalled();
    });

    it('triggers observer when overflow exceeds batch threshold', async () => {
      // messages rawTokens = 4000, batchThreshold = 0.25 → trigger at 5000+
      // Create items totaling ~6000 tokens
      const items = makeItemsWithTokens(12, 500);
      const deps = mockDeps();

      vi.mocked(memoryStore.getObservation).mockReturnValue(null);
      vi.mocked(runObserver).mockResolvedValue({
        observations: 'Date: Feb 14, 2026\n* HIGH (10:00) Test observation',
        tokenCount: 50,
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      });

      await processStream({
        deps,
        stream: 'messages',
        contactId: 'contact-1',
        rawItems: items,
        config: OBSERVATIONAL_MEMORY_CONFIG,
      });

      expect(runObserver).toHaveBeenCalled();
      expect(deps.eventBus.emit).toHaveBeenCalledWith('observation:started', expect.any(Object));
      expect(deps.eventBus.emit).toHaveBeenCalledWith('observation:completed', expect.any(Object));
    });
  });

  describe('processStream — concurrency', () => {
    it('skips when an operation is already active for the same stream', async () => {
      activeOps.set('global:thoughts', true);

      const items = makeItemsWithTokens(20, 500);
      const deps = mockDeps();

      await processStream({
        deps,
        stream: 'thoughts',
        contactId: null,
        rawItems: items,
        config: OBSERVATIONAL_MEMORY_CONFIG,
      });

      expect(runObserver).not.toHaveBeenCalled();
    });

    it('allows concurrent operations on different streams', async () => {
      activeOps.set('global:thoughts', true);

      const items = makeItemsWithTokens(12, 500);
      const deps = mockDeps();

      vi.mocked(memoryStore.getObservation).mockReturnValue(null);
      vi.mocked(runObserver).mockResolvedValue({
        observations: 'Date: Feb 14, 2026\n* HIGH (10:00) Test',
        tokenCount: 50,
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      });

      await processStream({
        deps,
        stream: 'experiences',
        contactId: null,
        rawItems: items,
        config: OBSERVATIONAL_MEMORY_CONFIG,
      });

      // experiences should still run even though thoughts is active
      expect(runObserver).toHaveBeenCalled();
    });

    it('clears the active flag after completion', async () => {
      const items = makeItemsWithTokens(12, 500);
      const deps = mockDeps();

      vi.mocked(memoryStore.getObservation).mockReturnValue(null);
      vi.mocked(runObserver).mockResolvedValue({
        observations: 'Date: Feb 14, 2026\n* HIGH (10:00) Test',
        tokenCount: 50,
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      });

      await processStream({
        deps,
        stream: 'messages',
        contactId: 'contact-1',
        rawItems: items,
        config: OBSERVATIONAL_MEMORY_CONFIG,
      });

      expect(activeOps.has('contact-1:messages')).toBe(false);
    });

    it('clears the active flag even on error', async () => {
      const items = makeItemsWithTokens(12, 500);
      const deps = mockDeps();

      vi.mocked(memoryStore.getObservation).mockReturnValue(null);
      vi.mocked(runObserver).mockRejectedValue(new Error('Agent failed'));

      await processStream({
        deps,
        stream: 'messages',
        contactId: 'contact-1',
        rawItems: items,
        config: OBSERVATIONAL_MEMORY_CONFIG,
      });

      expect(activeOps.has('contact-1:messages')).toBe(false);
      expect(deps.eventBus.emit).toHaveBeenCalledWith('observation:failed', expect.objectContaining({
        error: 'Agent failed',
      }));
    });
  });

  describe('processStream — observation storage', () => {
    it('appends new observations to existing ones', async () => {
      const items = makeItemsWithTokens(12, 500);
      const deps = mockDeps();

      vi.mocked(memoryStore.getObservation).mockReturnValue({
        id: 'obs-1',
        contactId: null,
        stream: 'thoughts',
        content: 'Date: Feb 13, 2026\n* HIGH (09:00) Existing observation',
        tokenCount: 50,
        generation: 1,
        lastRawId: 'old-item',
        lastRawTimestamp: '2026-02-13T09:00:00Z',
        createdAt: '2026-02-13T09:00:00Z',
        updatedAt: '2026-02-13T09:00:00Z',
      });

      vi.mocked(runObserver).mockResolvedValue({
        observations: 'Date: Feb 14, 2026\n* MEDIUM (10:00) New observation',
        tokenCount: 50,
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      });

      await processStream({
        deps,
        stream: 'thoughts',
        contactId: null,
        rawItems: items,
        config: OBSERVATIONAL_MEMORY_CONFIG,
      });

      // Should have been called with combined content
      expect(memoryStore.upsertObservation).toHaveBeenCalledWith(
        deps.memoryDb,
        expect.objectContaining({
          content: expect.stringContaining('Existing observation'),
        }),
      );
      expect(memoryStore.upsertObservation).toHaveBeenCalledWith(
        deps.memoryDb,
        expect.objectContaining({
          content: expect.stringContaining('New observation'),
        }),
      );
    });
  });

  describe('processStream — reflection trigger', () => {
    it('triggers reflector when observation tokens exceed budget', async () => {
      const items = makeItemsWithTokens(12, 500);
      const deps = mockDeps();

      // Generate content large enough that estimateTokens > 3000 (thoughts observationTokens)
      // Need ~2400 words to get > 3000 tokens (words * 1.3)
      const largeObservations = Array(2500).fill('observation').join(' ');

      vi.mocked(memoryStore.getObservation)
        .mockReturnValueOnce(null) // First call in processStream before observer
        .mockReturnValueOnce({     // Second call in runReflection to get observation ID
          id: 'obs-1',
          contactId: null,
          stream: 'thoughts',
          content: largeObservations,
          tokenCount: 3250,
          generation: 1,
          lastRawId: 'item-5',
          lastRawTimestamp: '2026-02-14T15:00:00Z',
          createdAt: '2026-02-14T10:00:00Z',
          updatedAt: '2026-02-14T15:00:00Z',
        });

      // Observer produces content that exceeds the threshold when estimated
      vi.mocked(runObserver).mockResolvedValue({
        observations: largeObservations,
        tokenCount: 3250,
        usage: { inputTokens: 200, outputTokens: 500, totalTokens: 700 },
      });

      vi.mocked(runReflector).mockResolvedValue({
        observations: 'Compressed observations',
        tokenCount: 500,
        generation: 1,
        usage: { inputTokens: 500, outputTokens: 100, totalTokens: 600 },
      });

      await processStream({
        deps,
        stream: 'thoughts',
        contactId: null,
        rawItems: items,
        config: OBSERVATIONAL_MEMORY_CONFIG,
      });

      expect(runReflector).toHaveBeenCalled();
      expect(deps.eventBus.emit).toHaveBeenCalledWith('reflection:started', expect.any(Object));
      expect(deps.eventBus.emit).toHaveBeenCalledWith('reflection:completed', expect.any(Object));
    });
  });
});
