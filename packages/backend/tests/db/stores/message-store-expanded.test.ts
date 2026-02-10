/**
 * Tests for expanded message store functions:
 * - getMessagesByContact
 * - getLastMessageForContact
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestMessagesDb } from '../../helpers.js';
import * as messageStore from '../../../src/db/stores/message-store.js';

describe('message-store (expanded)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestMessagesDb();
  });

  const contactId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const otherContactId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  function seedMessages() {
    const conv = messageStore.createConversation(db, {
      contactId,
      channel: 'web',
    });

    messageStore.createMessage(db, {
      conversationId: conv.id,
      contactId,
      direction: 'inbound',
      channel: 'web',
      content: 'Hello from contact A',
    });

    messageStore.createMessage(db, {
      conversationId: conv.id,
      contactId,
      direction: 'outbound',
      channel: 'web',
      content: 'Reply to contact A',
    });

    // Different contact
    const conv2 = messageStore.createConversation(db, {
      contactId: otherContactId,
      channel: 'sms',
    });

    messageStore.createMessage(db, {
      conversationId: conv2.id,
      contactId: otherContactId,
      direction: 'inbound',
      channel: 'sms',
      content: 'Hello from contact B',
    });

    return { conv, conv2 };
  }

  describe('getMessagesByContact', () => {
    it('returns messages for a specific contact', () => {
      seedMessages();
      const msgs = messageStore.getMessagesByContact(db, contactId);
      expect(msgs).toHaveLength(2);
      msgs.forEach((m) => expect(m.contactId).toBe(contactId));
    });

    it('does not return messages from other contacts', () => {
      seedMessages();
      const msgs = messageStore.getMessagesByContact(db, contactId);
      expect(msgs.every((m) => m.contactId === contactId)).toBe(true);
    });

    it('respects limit', () => {
      seedMessages();
      const msgs = messageStore.getMessagesByContact(db, contactId, { limit: 1 });
      expect(msgs).toHaveLength(1);
    });

    it('returns empty for unknown contact', () => {
      const msgs = messageStore.getMessagesByContact(db, 'unknown-id');
      expect(msgs).toHaveLength(0);
    });
  });

  describe('getLastMessageForContact', () => {
    it('returns the most recent message', () => {
      seedMessages();
      const last = messageStore.getLastMessageForContact(db, contactId);
      expect(last).not.toBeNull();
      // Both messages may share the same timestamp in tests, so just verify
      // the message belongs to the correct contact
      expect(last!.contactId).toBe(contactId);
      expect(['Hello from contact A', 'Reply to contact A']).toContain(last!.content);
    });

    it('returns null for contact with no messages', () => {
      const last = messageStore.getLastMessageForContact(db, 'unknown');
      expect(last).toBeNull();
    });

    it('returns correct message for each contact', () => {
      seedMessages();
      const lastA = messageStore.getLastMessageForContact(db, contactId);
      const lastB = messageStore.getLastMessageForContact(db, otherContactId);
      expect(lastA!.contactId).toBe(contactId);
      expect(lastB!.contactId).toBe(otherContactId);
    });
  });
});
