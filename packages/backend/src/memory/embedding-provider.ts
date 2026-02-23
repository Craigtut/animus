/**
 * Embedding Provider — local implementation using Transformers.js + BGE-small-en-v1.5
 *
 * Implements IEmbeddingProvider from @animus-labs/shared.
 * Lazy-loads the model on first use to avoid startup delay.
 */

import type { IEmbeddingProvider } from '@animus-labs/shared';

const MODEL_ID = 'Xenova/bge-small-en-v1.5';
const DIMENSIONS = 384;
const MAX_TOKENS = 512;

export class LocalEmbeddingProvider implements IEmbeddingProvider {
  readonly dimensions = DIMENSIONS;
  readonly maxTokens = MAX_TOKENS;
  readonly modelId = MODEL_ID;

  private pipeline: unknown = null;
  private initPromise: Promise<void> | null = null;

  isReady(): boolean {
    return this.pipeline !== null;
  }

  async initialize(): Promise<void> {
    if (this.pipeline) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._load();
    return this.initPromise;
  }

  private async _load(): Promise<void> {
    // Dynamic import to avoid loading the heavy module at startup
    const { pipeline } = await import('@huggingface/transformers');
    this.pipeline = await pipeline('feature-extraction', MODEL_ID, {
      dtype: 'fp32',
    });
  }

  async embed(texts: string[]): Promise<number[][]> {
    await this.initialize();
    const extractor = this.pipeline as (input: string[], options: Record<string, unknown>) => Promise<{ tolist(): number[][] }>;
    const output = await extractor(texts, { pooling: 'mean', normalize: true });
    return output.tolist();
  }

  async embedSingle(text: string): Promise<number[]> {
    const results = await this.embed([text]);
    return results[0]!;
  }
}
