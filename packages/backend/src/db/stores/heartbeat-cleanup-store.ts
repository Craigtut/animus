/**
 * Heartbeat Cleanup Store — cross-table cleanup wrapper
 */

import type Database from 'better-sqlite3';
import { cleanupExpiredThoughts } from './thought-store.js';
import { cleanupExpiredExperiences } from './experience-store.js';

export function cleanupExpiredEntries(db: Database.Database): {
  thoughts: number;
  experiences: number;
} {
  return {
    thoughts: cleanupExpiredThoughts(db),
    experiences: cleanupExpiredExperiences(db),
  };
}
