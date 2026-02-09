/**
 * Decay Engine — pure math for exponential decay.
 *
 * Used for emotion decay toward baseline and memory retention.
 */

/**
 * Exponential decay toward a baseline.
 * Returns: baseline + (current - baseline) * e^(-rate * hours)
 */
export function compute(
  current: number,
  baseline: number,
  rate: number,
  elapsedHours: number
): number {
  return baseline + (current - baseline) * Math.exp(-rate * elapsedHours);
}

/**
 * Compute memory retention score.
 * retention = e^(-hours / (strength * 720))
 */
export function computeRetention(
  strength: number,
  elapsedHours: number
): number {
  return Math.exp(-elapsedHours / (strength * 720));
}

/**
 * Determine if a memory should be pruned.
 * Prune when retention < 0.1 AND importance < 0.3
 */
export function shouldPrune(retention: number, importance: number): boolean {
  return retention < 0.1 && importance < 0.3;
}

/**
 * Calculate hours elapsed since a timestamp.
 */
export function hoursSince(timestamp: string): number {
  const diff = Date.now() - new Date(timestamp).getTime();
  return diff / (1000 * 60 * 60);
}
