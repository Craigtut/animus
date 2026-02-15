/**
 * Observational Memory Configuration
 *
 * All thresholds for the observation/reflection pipeline.
 * Token budgets are absolute counts, independent of model context window size.
 *
 * See docs/architecture/observational-memory.md for full design.
 */
export const OBSERVATIONAL_MEMORY_CONFIG = {
  /**
   * Model used for Observer and Reflector agents.
   * Haiku-tier recommended — compression tasks don't need the primary mind's model.
   */
  model: 'haiku' as const,

  /**
   * Observer agent settings
   */
  observer: {
    temperature: 0.3,
    maxOutputTokens: 8000,
  },

  /**
   * Reflector agent settings
   */
  reflector: {
    temperature: 0,
    maxOutputTokens: 8000,
  },

  /**
   * Per-stream token budgets.
   *
   * Each stream has two thresholds:
   * - rawTokens: Maximum tokens of raw items to include in context.
   *   Items beyond this accumulate until the batch threshold triggers observation.
   * - observationTokens: Maximum tokens for the observation block.
   *   When exceeded, the Reflector consolidates observations.
   */
  streams: {
    messages: {
      rawTokens: 4000,
      observationTokens: 6000,
    },
    thoughts: {
      rawTokens: 2000,
      observationTokens: 3000,
    },
    experiences: {
      rawTokens: 1500,
      observationTokens: 2000,
    },
  },

  /**
   * Observation batch threshold — fraction of rawTokens.
   * Observation only triggers when overflow exceeds rawTokens * observeBatchThreshold.
   * Prevents observing a single item at a time.
   *
   * Example: with rawTokens=4000 and threshold=0.25, observation triggers
   * when raw items reach 5,000 tokens (1,000 overflow).
   *
   * @default 0.25 (25% of raw budget)
   */
  observeBatchThreshold: 0.25,

  /**
   * Observation batch size — fraction of rawTokens.
   * When observation triggers, this fraction of the oldest raw items is sent
   * to the Observer. Taking more than just the overflow creates headroom.
   *
   * Example: with rawTokens=4000 and batchSize=0.5, the Observer receives
   * ~2,000 tokens of the oldest items.
   *
   * @default 0.5 (50% of raw budget)
   */
  observeBatchSize: 0.5,

  /**
   * Maximum compression retries before accepting the Reflector's output as-is.
   */
  maxCompressionRetries: 2,
} as const;

export type StreamType = keyof typeof OBSERVATIONAL_MEMORY_CONFIG.streams;
