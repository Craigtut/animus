// ---------------------------------------------------------------------------
// Ring shape: parametric full-circle particle distribution
//
// Adapted from crescentShape.ts but generates a uniform full ring
// instead of a tapered crescent arc.
// ---------------------------------------------------------------------------

import { RING } from './particleConfig';

const TAU = Math.PI * 2;

/**
 * Seeded pseudo-random (mulberry32) for deterministic particle placement.
 */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussianRandom(rng: () => number): number {
  const u1 = rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(TAU * u2);
}

/**
 * Generate ring target positions.
 * Returns Float32Array of [x, y, z, t] * count.
 * t is the normalized position around the ring (0..1).
 */
export function generateRingPositions(count: number): Float32Array {
  const data = new Float32Array(count * 4);
  const rng = mulberry32(42);

  for (let i = 0; i < count; i++) {
    // Uniform distribution around the full ring
    const t = rng();
    const angle = t * TAU;

    // Gaussian perpendicular offset (denser at centerline)
    const rawOffset = gaussianRandom(rng);
    const clampedOffset = Math.max(-2.0, Math.min(2.0, rawOffset));
    const perpOffset = clampedOffset * RING.maxWidth * 0.25;
    const r = RING.radius + perpOffset;

    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    const z = gaussianRandom(rng) * RING.zScatter;

    const idx = i * 4;
    data[idx]     = x;
    data[idx + 1] = y;
    data[idx + 2] = z;
    data[idx + 3] = t;
  }

  return data;
}

/**
 * Generate random scatter positions for the intro animation.
 */
export function generateScatterPositions(count: number): Float32Array {
  const data = new Float32Array(count * 4);
  const rng = mulberry32(137);

  for (let i = 0; i < count; i++) {
    const angle = rng() * TAU;
    const dist = 4.0 + rng() * 8.0;
    const idx = i * 4;
    data[idx]     = Math.cos(angle) * dist;
    data[idx + 1] = Math.sin(angle) * dist;
    data[idx + 2] = (rng() - 0.5) * 3.0;
    data[idx + 3] = rng();
  }

  return data;
}

/**
 * Generate per-particle random attributes.
 * Returns Float32Array of [size, phase, speed, drift] * count.
 */
export function generateRandomAttributes(count: number): Float32Array {
  const data = new Float32Array(count * 4);
  const rng = mulberry32(293);

  for (let i = 0; i < count; i++) {
    const idx = i * 4;
    data[idx]     = rng();   // size
    data[idx + 1] = rng();   // phase
    data[idx + 2] = rng();   // speed
    data[idx + 3] = rng();   // drift
  }

  return data;
}
