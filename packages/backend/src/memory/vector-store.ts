/**
 * Vector Store — LanceDB integration for long-term memory embeddings.
 *
 * Stores and searches vector embeddings for long-term memories.
 * LanceDB is the search index; memory.db (SQLite) is the source of truth.
 */

import * as lancedb from '@lancedb/lancedb';

export interface VectorRecord {
  id: string;
  vector: number[];
}

export interface SearchResult {
  id: string;
  score: number;
}

export class VectorStore {
  private db: lancedb.Connection | null = null;
  private table: lancedb.Table | null = null;
  private readonly dbPath: string;
  private readonly tableName = 'long_term_memories';
  private readonly dimensions: number;

  constructor(dbPath: string, dimensions: number) {
    this.dbPath = dbPath;
    this.dimensions = dimensions;
  }

  async initialize(): Promise<void> {
    this.db = await lancedb.connect(this.dbPath);
    try {
      this.table = await this.db.openTable(this.tableName);
    } catch {
      // Table doesn't exist yet — create it with an empty schema
      this.table = await this.db.createTable(this.tableName, [
        { id: '__init__', vector: new Array(this.dimensions).fill(0) },
      ]);
      // Remove the init row
      await this.table.delete('id = "__init__"');
    }
  }

  isReady(): boolean {
    return this.table !== null;
  }

  async addMemory(id: string, embedding: number[]): Promise<void> {
    if (!this.table) throw new Error('VectorStore not initialized');
    await this.table.add([{ id, vector: embedding }]);
  }

  async search(embedding: number[], limit: number = 10): Promise<SearchResult[]> {
    if (!this.table) throw new Error('VectorStore not initialized');

    // Check if table has any records
    const count = await this.table.countRows();
    if (count === 0) return [];

    const results = await this.table
      .search(embedding)
      .limit(limit)
      .toArray();

    return results.map((r) => ({
      id: r.id as string,
      // LanceDB returns _distance (L2 distance). Convert to cosine similarity score.
      // For normalized vectors, cosine_similarity = 1 - (L2_distance^2 / 2)
      score: 1 - (Math.pow(r._distance as number, 2) / 2),
    }));
  }

  async deleteMemory(id: string): Promise<void> {
    if (!this.table) throw new Error('VectorStore not initialized');
    await this.table.delete(`id = "${id}"`);
  }

  async deleteAll(): Promise<void> {
    if (!this.table) throw new Error('VectorStore not initialized');
    await this.table.delete('id IS NOT NULL');
  }
}
