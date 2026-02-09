import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestMessagesDb } from '../../helpers.js';
import * as store from '../../../src/db/stores/message-store.js';

describe('message-store', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestMessagesDb();
  });

  describe('conversations', () => {
    it('creates and retrieves a conversation', () => {
      const conv = store.createConversation(db, {
        contactId: 'contact-1',
        channel: 'web',
      });
      expect(conv.id).toBeDefined();
      expect(conv.isActive).toBe(true);

      const found = store.getConversation(db, conv.id);
      expect(found).not.toBeNull();
      expect(found!.contactId).toBe('contact-1');
    });

    it('finds active conversation by contact and channel', () => {
      store.createConversation(db, { contactId: 'c1', channel: 'web' });
      const found = store.getConversationByContactAndChannel(db, 'c1', 'web');
      expect(found).not.toBeNull();
    });

    it('returns null for no matching conversation', () => {
      expect(store.getActiveConversation(db, 'nonexistent', 'web')).toBeNull();
    });
  });

  describe('messages', () => {
    it('creates messages and updates conversation', () => {
      const conv = store.createConversation(db, { contactId: 'c1', channel: 'web' });
      const msg = store.createMessage(db, {
        conversationId: conv.id,
        contactId: 'c1',
        direction: 'inbound',
        channel: 'web',
        content: 'Hello!',
      });
      expect(msg.id).toBeDefined();
      expect(msg.content).toBe('Hello!');

      // Conversation last_message_at should be updated
      const updated = store.getConversation(db, conv.id);
      expect(updated!.lastMessageAt).toBeDefined();
    });

    it('retrieves recent messages', () => {
      const conv = store.createConversation(db, { contactId: 'c1', channel: 'web' });
      store.createMessage(db, {
        conversationId: conv.id,
        contactId: 'c1',
        direction: 'inbound',
        channel: 'web',
        content: 'First',
      });
      store.createMessage(db, {
        conversationId: conv.id,
        contactId: 'c1',
        direction: 'outbound',
        channel: 'web',
        content: 'Second',
      });

      const recent = store.getRecentMessages(db, conv.id, 10);
      expect(recent).toHaveLength(2);
    });

    it('supports pagination', () => {
      const conv = store.createConversation(db, { contactId: 'c1', channel: 'web' });
      for (let i = 0; i < 5; i++) {
        store.createMessage(db, {
          conversationId: conv.id,
          contactId: 'c1',
          direction: 'inbound',
          channel: 'web',
          content: `Message ${i}`,
        });
      }

      const page1 = store.getMessages(db, conv.id, { page: 1, pageSize: 2 });
      expect(page1.items).toHaveLength(2);
      expect(page1.total).toBe(5);

      const page3 = store.getMessages(db, conv.id, { page: 3, pageSize: 2 });
      expect(page3.items).toHaveLength(1);
    });

    it('handles metadata as JSON', () => {
      const conv = store.createConversation(db, { contactId: 'c1', channel: 'web' });
      const msg = store.createMessage(db, {
        conversationId: conv.id,
        contactId: 'c1',
        direction: 'inbound',
        channel: 'web',
        content: 'Test',
        metadata: { source: 'web-ui', priority: 1 },
      });
      expect(msg.metadata).toEqual({ source: 'web-ui', priority: 1 });

      const recent = store.getRecentMessages(db, conv.id, 1);
      expect(recent[0]!.metadata).toEqual({ source: 'web-ui', priority: 1 });
    });
  });
});
