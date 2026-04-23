/**
 * Message Embedder
 *
 * Embeds user-facing messages (from messages.db) into a dedicated LanceDB
 * table for semantic recall. Used by Cortex's observational memory recall
 * tool to search past conversation history by meaning.
 *
 * Embedding happens asynchronously on message:received / message:sent
 * events so it never blocks message delivery.
 */

import type * as lancedb from '@lancedb/lancedb';
import type { IEmbeddingProvider, Message } from '@animus-labs/shared';
import type { RecallResult } from '@animus-labs/cortex';
import { getMessagesDb } from '../db/index.js';
import * as messageStore from '../db/stores/message-store.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('MessageEmbedder', 'heartbeat');

const TABLE_NAME = 'message_embeddings';

export class MessageEmbedder {
  private table: lancedb.Table | null = null;
  private readonly db: lancedb.Connection;
  private readonly embedder: IEmbeddingProvider;

  constructor(db: lancedb.Connection, embedder: IEmbeddingProvider) {
    this.db = db;
    this.embedder = embedder;
  }

  async initialize(): Promise<void> {
    try {
      this.table = await this.db.openTable(TABLE_NAME);
    } catch {
      this.table = await this.db.createTable(TABLE_NAME, [
        { id: '__init__', vector: new Array(this.embedder.dimensions).fill(0), timestamp: '' },
      ]);
      await this.table.delete('id = "__init__"');
    }
    log.debug('Message embeddings table ready');
  }

  isReady(): boolean {
    return this.table !== null;
  }

  async embedMessage(msg: Pick<Message, 'id' | 'content' | 'createdAt'>): Promise<void> {
    if (!this.table) return;
    const text = msg.content?.trim();
    if (!text) return;

    try {
      const vector = await this.embedder.embedSingle(text);
      await this.table.add([{ id: msg.id, vector, timestamp: msg.createdAt }]);
    } catch (err) {
      log.warn(`Failed to embed message ${msg.id}:`, err);
    }
  }

  async search(
    query: string,
    options?: { timeRange?: { start?: Date; end?: Date } },
  ): Promise<RecallResult[]> {
    if (!this.table) return [];

    const count = await this.table.countRows();
    if (count === 0) return [];

    const queryVector = await this.embedder.embedSingle(query);
    let builder = this.table.search(queryVector).limit(10);

    if (options?.timeRange) {
      const filters: string[] = [];
      if (options.timeRange.start) {
        filters.push(`timestamp >= '${options.timeRange.start.toISOString()}'`);
      }
      if (options.timeRange.end) {
        filters.push(`timestamp <= '${options.timeRange.end.toISOString()}'`);
      }
      if (filters.length > 0) {
        builder = builder.where(filters.join(' AND '));
      }
    }

    const results = await builder.toArray();

    const msgDb = getMessagesDb();
    const recallResults: RecallResult[] = [];

    for (const r of results) {
      const msg = messageStore.getMessageById(msgDb, r.id as string);
      if (!msg) continue;

      recallResults.push({
        content: msg.content,
        timestamp: new Date(msg.createdAt),
        type: 'message',
        role: msg.direction === 'inbound' ? 'user' : 'assistant',
      });
    }

    return recallResults;
  }

  async deleteAll(): Promise<void> {
    if (!this.table) return;
    await this.table.delete('id IS NOT NULL');
  }
}
