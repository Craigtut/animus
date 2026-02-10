import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestSystemDb, createTestMessagesDb } from '../helpers.js';
import * as systemStore from '../../src/db/stores/system-store.js';
import type { IChannelAdapter } from '../../src/channels/types.js';
import type { ChannelType } from '@animus/shared';

// Mock DB access
let mockSysDb: Database.Database;
let mockMsgDb: Database.Database;

vi.mock('../../src/db/index.js', () => ({
  getSystemDb: () => mockSysDb,
  getMessagesDb: () => mockMsgDb,
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

const { ChannelRouter } = await import('../../src/channels/channel-router.js');

function createMockAdapter(channelType: ChannelType): IChannelAdapter {
  return {
    channelType,
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    isEnabled: vi.fn(() => true),
    send: vi.fn(async () => {}),
  };
}

describe('channel-router', () => {
  let router: InstanceType<typeof ChannelRouter>;

  beforeEach(() => {
    mockSysDb = createTestSystemDb();
    mockMsgDb = createTestMessagesDb();
    router = new ChannelRouter();
  });

  describe('registerAdapter', () => {
    it('registers and retrieves an adapter', () => {
      const adapter = createMockAdapter('sms');
      router.registerAdapter(adapter);
      expect(router.getAdapter('sms')).toBe(adapter);
    });

    it('returns undefined for unregistered channel', () => {
      expect(router.getAdapter('discord')).toBeUndefined();
    });
  });

  describe('handleIncoming', () => {
    it('returns null for unknown callers', () => {
      const result = router.handleIncoming({
        channel: 'sms',
        identifier: '+15551234567',
        content: 'Hello',
      });
      expect(result).toBeNull();
    });

    it('stores message and returns it for known contacts', () => {
      // Create a known contact
      const contact = systemStore.createContact(mockSysDb, {
        fullName: 'Known User',
        isPrimary: true,
      });
      systemStore.createContactChannel(mockSysDb, {
        contactId: contact.id,
        channel: 'sms',
        identifier: '+15559999999',
      });

      const result = router.handleIncoming({
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
    it('returns null when no adapter is registered', async () => {
      const result = await router.sendOutbound({
        contactId: 'test',
        channel: 'sms',
        content: 'Hello',
      });
      expect(result).toBeNull();
    });

    it('sends via the adapter and stores the message', async () => {
      const adapter = createMockAdapter('web');
      router.registerAdapter(adapter);

      // Create a contact
      const contact = systemStore.createContact(mockSysDb, {
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
      expect(adapter.send).toHaveBeenCalledWith(contact.id, 'Reply to you', undefined);
    });

    it('returns null when adapter is disabled', async () => {
      const adapter = createMockAdapter('sms');
      (adapter.isEnabled as ReturnType<typeof vi.fn>).mockReturnValue(false);
      router.registerAdapter(adapter);

      const result = await router.sendOutbound({
        contactId: 'test',
        channel: 'sms',
        content: 'Hello',
      });
      expect(result).toBeNull();
    });
  });

  describe('startAll / stopAll', () => {
    it('starts all adapters', async () => {
      const sms = createMockAdapter('sms');
      const discord = createMockAdapter('discord');
      router.registerAdapter(sms);
      router.registerAdapter(discord);

      await router.startAll();
      expect(sms.start).toHaveBeenCalled();
      expect(discord.start).toHaveBeenCalled();
    });

    it('stops all adapters', async () => {
      const sms = createMockAdapter('sms');
      router.registerAdapter(sms);

      await router.stopAll();
      expect(sms.stop).toHaveBeenCalled();
    });

    it('continues if one adapter fails to start', async () => {
      const failing = createMockAdapter('sms');
      (failing.start as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('bad token'));
      const working = createMockAdapter('discord');
      router.registerAdapter(failing);
      router.registerAdapter(working);

      // Should not throw
      await router.startAll();
      expect(working.start).toHaveBeenCalled();
    });
  });
});
