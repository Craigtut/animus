// ---------------------------------------------------------------------------
// Particle ring constants and tuning parameters
//
// Adapted from the Animus Store hero crescent for a full-ring formation
// used on the setup/loading screen.
// ---------------------------------------------------------------------------

export interface DeviceTier {
  label: 'high' | 'medium' | 'low';
  particleCount: number;
}

export const TIERS: Record<DeviceTier['label'], DeviceTier> = {
  high:   { label: 'high',   particleCount: 163_840 },
  medium: { label: 'medium', particleCount: 81_920 },
  low:    { label: 'low',    particleCount: 30_720 },
};

// Ring shape
//
// Camera at z=8, FOV 50. Visible height at z=0 ≈ 7.5 world units.
// Radius 2.8 -> diameter 5.6 -> ~450px on a 600px canvas (75%).
export const RING = {
  radius: 2.8,
  maxWidth: 0.4,         // perpendicular width of the ring band
  zScatter: 0.04,
} as const;

// Physics / animation
export const PHYSICS = {
  orbitalSpeed: 0.06,
  breathAmplitude: 0.03,
  breathFrequency: 0.3,
  curlScale: 0.4,
  curlStrength: 0.06,
  flowSpeed: 0.12,
  mouseRadius: 1.2,
  mouseStrength: 1.5,
} as const;

// Intro timing (seconds)
export const INTRO = {
  formDuration: 1.4,
  holdDuration: 0.0,
} as const;

// Colors (linear-space RGB) — gradient follows arc position
export const COLORS = {
  dark:   [0.22, 0.10, 0.04] as const,   // deep brown
  mid:    [0.60, 0.35, 0.18] as const,   // warm amber
  bright: [0.85, 0.60, 0.32] as const,   // bright gold
};

// Render settings
export const RENDER = {
  pointSizeMin: 1.0,
  pointSizeMax: 3.5,
  softEdge: 0.4,
  baseAlpha: 0.18,
  antialias: false,
  maxDpr: 2,
  alpha: true,
} as const;

// ---------------------------------------------------------------------------
// Device capability detection
// ---------------------------------------------------------------------------

export function detectDeviceTier(): DeviceTier {
  if (typeof window === 'undefined') return TIERS.low;

  const width = window.innerWidth;
  const cores = navigator.hardwareConcurrency ?? 2;

  if (width < 768 || cores <= 2) return TIERS.low;

  return TIERS.high;
}
