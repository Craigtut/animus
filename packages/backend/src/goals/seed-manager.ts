/**
 * Seed Manager — manages goal seeds (emergent desires).
 *
 * Seeds are proto-goals with transient in-memory embeddings.
 * They decay if not reinforced and graduate to goals when strong enough.
 *
 * See docs/architecture/goals.md — "Seeds: Emergent Goals"
 */

import type Database from 'better-sqlite3';
import { DecayEngine, now } from '@animus/shared';
import type { IEmbeddingProvider, GoalSeed, EmotionName } from '@animus/shared';
import * as heartbeatStore from '../db/stores/heartbeat-store.js';

// ============================================================================
// Constants
// ============================================================================

export const SEED_RESONANCE_THRESHOLD = 0.7;
export const SEED_BOOST_MULTIPLIER = 0.15;
export const SEED_DECAY_RATE = 0.027;
export const SEED_GRADUATION_THRESHOLD = 0.7;
export const SEED_CLEANUP_THRESHOLD = 0.01;

// ============================================================================
// Types
// ============================================================================

/** In-memory seed with its embedding cached */
export interface SeedWithEmbedding {
  seed: GoalSeed;
  embedding: number[];
}

// ============================================================================
// Seed Manager
// ============================================================================

export class SeedManager {
  /** Transient in-memory cache of seed embeddings */
  private seedEmbeddings: Map<string, number[]> = new Map();

  constructor(
    private readonly db: Database.Database,
    private readonly embeddingProvider: IEmbeddingProvider,
  ) {}

  /**
   * Create a new seed and compute its embedding.
   */
  async createSeed(data: {
    content: string;
    motivation?: string;
    linkedEmotion?: EmotionName;
    source: 'internal' | 'user_observation' | 'experience';
  }): Promise<GoalSeed> {
    const seed = heartbeatStore.createSeed(this.db, {
      content: data.content,
      motivation: data.motivation ?? null,
      linkedEmotion: data.linkedEmotion ?? null,
      source: data.source,
    });

    // Embed and cache (transient — not persisted to disk)
    const embedding = await this.embeddingProvider.embedSingle(data.content);
    this.seedEmbeddings.set(seed.id, embedding);

    return seed;
  }

  /**
   * Load active seed embeddings into memory cache.
   * Call this on startup or when seeds may have been modified externally.
   */
  async loadSeedEmbeddings(): Promise<void> {
    const activeSeeds = heartbeatStore.getActiveSeeds(this.db);
    for (const seed of activeSeeds) {
      if (!this.seedEmbeddings.has(seed.id)) {
        const embedding = await this.embeddingProvider.embedSingle(seed.content);
        this.seedEmbeddings.set(seed.id, embedding);
      }
    }
  }

  /**
   * Check thought embeddings against active seeds for resonance.
   * Called during EXECUTE after new thoughts are persisted.
   */
  async checkSeedResonance(
    thoughtTexts: Array<{ content: string; importance: number }>
  ): Promise<void> {
    const activeSeeds = heartbeatStore.getActiveSeeds(this.db);
    if (activeSeeds.length === 0) return;

    // Ensure all seeds have embeddings
    for (const seed of activeSeeds) {
      if (!this.seedEmbeddings.has(seed.id)) {
        const emb = await this.embeddingProvider.embedSingle(seed.content);
        this.seedEmbeddings.set(seed.id, emb);
      }
    }

    for (const thought of thoughtTexts) {
      // Embed thought transiently
      const thoughtEmbedding = await this.embeddingProvider.embedSingle(thought.content);

      for (const seed of activeSeeds) {
        const seedEmbedding = this.seedEmbeddings.get(seed.id);
        if (!seedEmbedding) continue;

        const similarity = cosineSimilarity(thoughtEmbedding, seedEmbedding);

        if (similarity > SEED_RESONANCE_THRESHOLD) {
          const boost = (similarity - SEED_RESONANCE_THRESHOLD) *
            thought.importance * SEED_BOOST_MULTIPLIER;
          heartbeatStore.reinforceSeed(this.db, seed.id, boost);
        }
      }
    }
  }

  /**
   * Apply time-based decay to all active seeds.
   */
  applyDecay(): void {
    const activeSeeds = heartbeatStore.getActiveSeeds(this.db);

    for (const seed of activeSeeds) {
      const elapsedHours = DecayEngine.hoursSince(seed.lastReinforcedAt);
      const decayedStrength = seed.strength * Math.exp(-SEED_DECAY_RATE * elapsedHours);

      if (decayedStrength < SEED_CLEANUP_THRESHOLD) {
        heartbeatStore.updateSeed(this.db, seed.id, {
          strength: 0,
          status: 'decayed',
          decayedAt: now(),
        });
        this.seedEmbeddings.delete(seed.id);
      } else if (Math.abs(decayedStrength - seed.strength) > 0.001) {
        heartbeatStore.updateSeed(this.db, seed.id, {
          strength: decayedStrength,
        });
      }
    }
  }

  /**
   * Check for seeds that should graduate.
   * Returns seeds that crossed the graduation threshold.
   */
  checkGraduation(): GoalSeed[] {
    const activeSeeds = heartbeatStore.getActiveSeeds(this.db);
    const graduating: GoalSeed[] = [];

    for (const seed of activeSeeds) {
      if (seed.strength >= SEED_GRADUATION_THRESHOLD) {
        heartbeatStore.updateSeed(this.db, seed.id, { status: 'graduating' });
        graduating.push({ ...seed, status: 'graduating' });
      }
    }

    return graduating;
  }

  /**
   * Get all active seeds.
   */
  getActiveSeeds(): GoalSeed[] {
    return heartbeatStore.getActiveSeeds(this.db);
  }

  /**
   * Get graduating seeds.
   */
  getGraduatingSeeds(): GoalSeed[] {
    return heartbeatStore.getSeedsByStatus(this.db, 'graduating');
  }

  /**
   * Clear the embedding cache for a seed.
   */
  clearEmbedding(seedId: string): void {
    this.seedEmbeddings.delete(seedId);
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dotProduct / denom;
}
