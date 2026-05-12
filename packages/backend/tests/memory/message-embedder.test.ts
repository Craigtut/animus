import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IEmbeddingProvider, Message } from '@animus-labs/shared';
import { MessageEmbedder } from '../../src/memory/message-embedder.js';

const mocks = vi.hoisted(() => {
  const messagesById = new Map<string, Message>();
  const messagesDb = { name: 'messages-db' };

  return {
    messagesById,
    getMessagesDb: vi.fn(() => messagesDb),
    getMessageById: vi.fn((db: unknown, id: string) => {
      if (db !== messagesDb) return null;
      return messagesById.get(id) ?? null;
    }),
  };
});

vi.mock('../../src/db/index.js', () => ({
  getMessagesDb: mocks.getMessagesDb,
}));

vi.mock('../../src/db/stores/message-store.js', () => ({
  getMessageById: mocks.getMessageById,
}));

function createMockEmbeddingProvider(): IEmbeddingProvider {
  return {
    dimensions: 3,
    maxTokens: 512,
    modelId: 'test-embedder',
    isReady: () => true,
    initialize: async () => {},
    embed: async (texts: string[]) => texts.map(() => [1, 0, 0]),
    embedSingle: vi.fn(async () => [1, 0, 0]),
  };
}

function createMessage(overrides: Pick<Message, 'id' | 'contactId' | 'channel' | 'content'> & Partial<Message>): Message {
  return {
    conversationId: 'conv-1',
    direction: 'inbound',
    metadata: null,
    tickNumber: null,
    createdAt: '2026-05-06T12:00:00.000Z',
    deliveryStatus: null,
    externalId: null,
    deliveryError: null,
    mindNotified: null,
    ...overrides,
  };
}

function createSearchTable(rows: Array<{ id: string }>) {
  const builder = {
    limit: vi.fn((_: number) => builder),
    where: vi.fn((_: string) => builder),
    toArray: vi.fn(async () => rows),
  };

  return {
    table: {
      countRows: vi.fn(async () => rows.length),
      search: vi.fn(() => builder),
    },
    builder,
  };
}

function createReadyEmbedder(rows: Array<{ id: string }>) {
  const { table, builder } = createSearchTable(rows);
  const embedder = new MessageEmbedder({} as never, createMockEmbeddingProvider());
  (embedder as unknown as { table: unknown }).table = table;
  return { embedder, builder };
}

describe('MessageEmbedder', () => {
  beforeEach(() => {
    mocks.messagesById.clear();
    mocks.getMessagesDb.mockClear();
    mocks.getMessageById.mockClear();
  });

  it('post-filters scoped recall results by contact and channel', async () => {
    mocks.messagesById.set('m1', createMessage({
      id: 'm1',
      contactId: 'contact-1',
      channel: 'web',
      content: 'Alice asked about the greenhouse.',
    }));
    mocks.messagesById.set('m2', createMessage({
      id: 'm2',
      contactId: 'contact-2',
      channel: 'web',
      content: 'Bob discussed unrelated travel plans.',
    }));
    mocks.messagesById.set('m3', createMessage({
      id: 'm3',
      contactId: 'contact-1',
      channel: 'sms',
      content: 'Alice texted on another channel.',
    }));
    mocks.messagesById.set('m4', createMessage({
      id: 'm4',
      contactId: 'contact-1',
      channel: 'web',
      content: 'Alice confirmed greenhouse dimensions.',
    }));

    const { embedder, builder } = createReadyEmbedder([
      { id: 'm1' },
      { id: 'm2' },
      { id: 'missing' },
      { id: 'm3' },
      { id: 'm4' },
    ]);

    const results = await embedder.search('greenhouse', {
      contactId: 'contact-1',
      channel: 'web',
    });

    expect(builder.limit).toHaveBeenCalledWith(50);
    expect(results.map((result) => result.content)).toEqual([
      'Alice asked about the greenhouse.',
      'Alice confirmed greenhouse dimensions.',
    ]);
  });

  it('uses the default vector candidate limit for unscoped recall', async () => {
    mocks.messagesById.set('m1', createMessage({
      id: 'm1',
      contactId: 'contact-1',
      channel: 'web',
      content: 'First message.',
    }));
    mocks.messagesById.set('m2', createMessage({
      id: 'm2',
      contactId: 'contact-2',
      channel: 'sms',
      content: 'Second message.',
    }));

    const { embedder, builder } = createReadyEmbedder([{ id: 'm1' }, { id: 'm2' }]);

    const results = await embedder.search('message');

    expect(builder.limit).toHaveBeenCalledWith(10);
    expect(results.map((result) => result.content)).toEqual([
      'First message.',
      'Second message.',
    ]);
  });
});
