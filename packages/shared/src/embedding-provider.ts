/**
 * Embedding Provider — interface only.
 *
 * Implementation deferred to Sprint 2 (Transformers.js + BGE-small-en-v1.5).
 */

export interface IEmbeddingProvider {
  /** Generate embeddings for multiple texts. */
  embed(texts: string[]): Promise<number[][]>;

  /** Generate embedding for a single text. */
  embedSingle(text: string): Promise<number[]>;

  /** Whether the provider is ready for use. */
  isReady(): boolean;

  /** Initialize the provider (load model, etc). */
  initialize(): Promise<void>;

  /** Embedding dimension count. */
  readonly dimensions: number;

  /** Max input tokens per text. */
  readonly maxTokens: number;

  /** Model identifier. */
  readonly modelId: string;
}
