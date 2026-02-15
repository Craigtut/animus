/**
 * Observational Memory — TypeScript types derived from Zod schemas via z.infer<>.
 *
 * DO NOT define types manually here — derive them from schemas.
 */

import { z } from 'zod';
import type {
  streamTypeSchema,
  observationSchema,
  observationStartedEventSchema,
  observationCompletedEventSchema,
  observationFailedEventSchema,
  reflectionStartedEventSchema,
  reflectionCompletedEventSchema,
  reflectionFailedEventSchema,
} from '../schemas/observational-memory.js';

// ============================================================================
// Observational Memory (memory.db)
// ============================================================================

export type StreamType = z.infer<typeof streamTypeSchema>;
export type Observation = z.infer<typeof observationSchema>;

// ============================================================================
// Event Payloads
// ============================================================================

export type ObservationStartedEvent = z.infer<typeof observationStartedEventSchema>;
export type ObservationCompletedEvent = z.infer<typeof observationCompletedEventSchema>;
export type ObservationFailedEvent = z.infer<typeof observationFailedEventSchema>;
export type ReflectionStartedEvent = z.infer<typeof reflectionStartedEventSchema>;
export type ReflectionCompletedEvent = z.infer<typeof reflectionCompletedEventSchema>;
export type ReflectionFailedEvent = z.infer<typeof reflectionFailedEventSchema>;
