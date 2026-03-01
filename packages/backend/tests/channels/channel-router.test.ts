import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestSystemDb, createTestMessagesDb, createTestContactsDb } from '../helpers.js';
import * as contactStore from '../../src/db/stores/contact-store.js';

// Mock DB access
let mockSysDb: Database.Database;
let mockMsgDb: Database.Database;
let mockContactsDb: Database.Database;

vi.mock('../../src/db/index.js', () => ({
  getSystemDb: () => mockSysDb,
  getMessagesDb: () => mockMsgDb,
  getContactsDb: () => mockContactsDb,
  getHeartbeatDb: vi.fn(),
}));

// Mock heartbeat handleIncomingMessage
vi.mock('../../src/heartbeat/index.js', () => ({
  handleIncomingMessage: vi.fn(),
}));

// Mock event bus
vi.mock('../../src/lib/event-bus.js', () => ({
  getEventBus: () => ({
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  }),
}));

// Mock channel manager
const mockSendToChannel = vi.fn(async () => true);
vi.mock('../../src/channels/channel-manager.js', () => ({
  getChannelManager: () => ({
    sendToChannel: mockSendToChannel,
  }),
}));

const { ChannelRouter } = await import('../../src/channels/channel-router.js');

describe('channel-router', () => {
  let router: InstanceType<typeof ChannelRouter>;

  beforeEach(() => {
    mockSysDb = createTestSystemDb();
    mockMsgDb = createTestMessagesDb();
    mockContactsDb = createTestContactsDb();
    router = new ChannelRouter();
    mockSendToChannel.mockClear();
  });

  describe('handleIncoming', () => {
    it('returns null for unknown callers', async () => {
      const result = await router.handleIncoming({
        channel: 'sms',
        identifier: '+15551234567',
        content: 'Hello',
      });
      expect(result).toBeNull();
    });

    it('stores message and returns it for known contacts', async () => {
      // Create a known contact
      const contact = contactStore.createContact(mockContactsDb, {
        fullName: 'Known User',
        isPrimary: true,
      });
      contactStore.createContactChannel(mockContactsDb, {
        contactId: contact.id,
        channel: 'sms',
        identifier: '+15559999999',
      });

      const result = await router.handleIncoming({
        channel: 'sms',
        identifier: '+15559999999',
        content: 'Hi there',
      });

      expect(result).not.toBeNull();
      expect(result!.content).toBe('Hi there');
      expect(result!.contactId).toBe(contact.id);
      expect(result!.direction).toBe('inbound');
      expect(result!.channel).toBe('sms');
    });
  });

  describe('sendOutbound', () => {
    it('stores message and delivers via ChannelManager', async () => {
      // Create a contact
      const contact = contactStore.createContact(mockContactsDb, {
        fullName: 'Test',
        isPrimary: true,
      });

      const result = await router.sendOutbound({
        contactId: contact.id,
        channel: 'web',
        content: 'Reply to you',
      });

      expect(result).not.toBeNull();
      expect(result!.content).toBe('Reply to you');
      expect(result!.direction).toBe('outbound');
      expect(mockSendToChannel).toHaveBeenCalledWith('web', contact.id, 'Reply to you', undefined, undefined);
    });

    it('still stores message when delivery fails', async () => {
      mockSendToChannel.mockResolvedValueOnce(false);

      const contact = contactStore.createContact(mockContactsDb, {
        fullName: 'Test',
        isPrimary: true,
      });

      const result = await router.sendOutbound({
        contactId: contact.id,
        channel: 'sms',
        content: 'Hello',
      });

      // Message should still be stored even though delivery failed
      expect(result).not.toBeNull();
      expect(result!.content).toBe('Hello');
    });
  });
});
