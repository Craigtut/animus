// ---------------------------------------------------------------------------
// Particle Vertex Shader (ring variant)
//
// Identical to the store's crescent shader except edge/body factors are
// uniform (no tapered tips in a full ring).
// ---------------------------------------------------------------------------

export const particleVertexShader = /* glsl */ `

// --- Attributes ---
attribute vec3 aTarget;
attribute vec3 aScatter;
attribute float aArcT;
attribute vec4 aRandom;     // x=size, y=phase, z=speed, w=drift

// --- Uniforms ---
uniform float uTime;
uniform float uIntroProgress;
uniform float uOrbitalSpeed;
uniform float uBreathAmplitude;
uniform float uBreathFrequency;
uniform float uCurlScale;
uniform float uCurlStrength;
uniform float uFlowSpeed;
uniform sampler2D uDisplacementGrid;
uniform float uGridExtent;
uniform float uPointSizeMin;
uniform float uPointSizeMax;
uniform float uPixelRatio;

// --- Varyings ---
varying float vArcT;
varying float vEdgeFactor;
varying float vOpacity;
varying float vDispMag;

// ============================================================================
// 3D Simplex Noise (Ashima Arts / Ian McEwan)
// ============================================================================

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(
    i.z + vec4(0.0, i1.z, i2.z, 1.0))
  + i.y + vec4(0.0, i1.y, i2.y, 1.0))
  + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

// ============================================================================
// 2D Curl Noise (from 3D simplex via finite differences)
// ============================================================================

vec2 curlNoise(vec2 p, float time) {
  float eps = 0.1;
  vec3 pp = vec3(p, time);

  float n1 = snoise(pp + vec3(0.0, eps, 0.0));
  float n2 = snoise(pp - vec3(0.0, eps, 0.0));
  float n3 = snoise(pp + vec3(eps, 0.0, 0.0));
  float n4 = snoise(pp - vec3(eps, 0.0, 0.0));

  return vec2((n1 - n2), -(n3 - n4)) / (2.0 * eps);
}

// ============================================================================
// Main
// ============================================================================

void main() {
  float t = aArcT;
  float phase = aRandom.y;
  float speedVar = aRandom.z;
  float driftVar = aRandom.w;

  // Full ring: no tips, so edge/body factors are uniform
  float edgeFactor = 0.0;
  float bodyFactor = 1.0;

  // --- Orbital rotation: ALL particles rotate at same base speed ---
  float angle = -uTime * uOrbitalSpeed;
  float ca = cos(angle);
  float sa = sin(angle);

  vec3 target = aTarget;
  target.xy = vec2(
    target.x * ca - target.y * sa,
    target.x * sa + target.y * ca
  );

  // --- Tangential oscillation: particles race along the arc ---
  float driftFreq = 0.3 + driftVar * 0.4;
  float driftPhase = phase * 6.28 + speedVar * 3.14;
  float driftAmount = sin(uTime * driftFreq + driftPhase) * 0.08 * bodyFactor;
  float dca = cos(driftAmount);
  float dsa = sin(driftAmount);
  target.xy = vec2(
    target.x * dca - target.y * dsa,
    target.x * dsa + target.y * dca
  );

  // --- Breathing: scale from origin ---
  float breath = 1.0 + uBreathAmplitude * sin(uTime * uBreathFrequency + phase * 3.0);
  target *= breath;

  // --- Mouse displacement from grid ---
  vec2 gridUV = (target.xy + uGridExtent) / (2.0 * uGridExtent);
  gridUV = clamp(gridUV, 0.0, 1.0);
  vec2 displacement = texture2D(uDisplacementGrid, gridUV).xy;
  float dispMag = length(displacement);

  // --- Curl noise turbulence ---
  float curlSuppression = 1.0 / (1.0 + dispMag * 8.0);
  vec2 noiseInput = aTarget.xy * uCurlScale + vec2(phase * 5.0, phase * 11.0);
  float noiseTime = uTime * 0.12 + phase * 2.0;
  vec2 curl = curlNoise(noiseInput, noiseTime);

  target.xy += curl * uCurlStrength * bodyFactor * curlSuppression;
  target.z += snoise(vec3(noiseInput * 0.5, noiseTime * 0.5)) * 0.03 * bodyFactor * curlSuppression;

  // Flatten z near displacement
  target.z *= exp(-dispMag * 20.0);

  // Apply mouse displacement after curl noise
  target.xy += displacement;

  vDispMag = dispMag;

  // --- Intro: lerp from scatter to animated target ---
  float intro = smoothstep(0.0, 1.0, uIntroProgress);
  // Stagger from random positions around the ring
  float stagger = abs(t - 0.5) * 0.6;
  float particleIntro = smoothstep(stagger, stagger + 0.4, intro);
  vec3 pos = mix(aScatter, target, particleIntro);

  // --- Point size ---
  float randomSize = mix(uPointSizeMin, uPointSizeMax, aRandom.x);
  gl_PointSize = randomSize * uPixelRatio;
  gl_PointSize = max(gl_PointSize, 0.5);

  // --- Opacity ---
  vOpacity = 1.0;

  // --- Project ---
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  vArcT = t;
  vEdgeFactor = edgeFactor;
}
`;
