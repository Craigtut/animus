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

  describe('media attachments', () => {
    it('creates a media attachment for a message', () => {
      const conv = store.createConversation(db, { contactId: 'c1', channel: 'discord' });
      const msg = store.createMessage(db, {
        conversationId: conv.id,
        contactId: 'c1',
        direction: 'outbound',
        channel: 'discord',
        content: 'Here is an image',
      });

      const attachment = store.createMediaAttachment(db, {
        messageId: msg.id,
        type: 'image',
        mimeType: 'image/png',
        localPath: '/data/media/test.png',
        originalFilename: 'test.png',
        sizeBytes: 12345,
      });

      expect(attachment.id).toBeDefined();
      expect(attachment.messageId).toBe(msg.id);
      expect(attachment.type).toBe('image');
      expect(attachment.mimeType).toBe('image/png');
      expect(attachment.localPath).toBe('/data/media/test.png');
      expect(attachment.originalFilename).toBe('test.png');
      expect(attachment.sizeBytes).toBe(12345);
      expect(attachment.createdAt).toBeDefined();
    });

    it('creates multiple attachments for the same message', () => {
      const conv = store.createConversation(db, { contactId: 'c1', channel: 'discord' });
      const msg = store.createMessage(db, {
        conversationId: conv.id,
        contactId: 'c1',
        direction: 'outbound',
        channel: 'discord',
        content: 'Multiple files',
      });

      const att1 = store.createMediaAttachment(db, {
        messageId: msg.id,
        type: 'image',
        mimeType: 'image/jpeg',
        localPath: '/data/media/photo.jpg',
        originalFilename: 'photo.jpg',
        sizeBytes: 50000,
      });

      const att2 = store.createMediaAttachment(db, {
        messageId: msg.id,
        type: 'file',
        mimeType: 'application/pdf',
        localPath: '/data/media/doc.pdf',
        originalFilename: null,
        sizeBytes: 100000,
      });

      expect(att1.id).not.toBe(att2.id);
      expect(att1.type).toBe('image');
      expect(att2.type).toBe('file');
      expect(att2.originalFilename).toBeNull();
    });

    it('cascades deletion when parent message is deleted', () => {
      const conv = store.createConversation(db, { contactId: 'c1', channel: 'discord' });
      const msg = store.createMessage(db, {
        conversationId: conv.id,
        contactId: 'c1',
        direction: 'outbound',
        channel: 'discord',
        content: 'Will be deleted',
      });

      store.createMediaAttachment(db, {
        messageId: msg.id,
        type: 'image',
        mimeType: 'image/png',
        localPath: '/data/media/temp.png',
        originalFilename: 'temp.png',
        sizeBytes: 5000,
      });

      // Delete the message
      db.prepare('DELETE FROM messages WHERE id = ?').run(msg.id);

      // Attachment should be cascade-deleted
      const remaining = db.prepare('SELECT COUNT(*) as count FROM media_attachments WHERE message_id = ?').get(msg.id) as { count: number };
      expect(remaining.count).toBe(0);
    });
  });
});
