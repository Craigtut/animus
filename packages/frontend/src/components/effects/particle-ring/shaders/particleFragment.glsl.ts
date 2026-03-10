// ---------------------------------------------------------------------------
// Particle Fragment Shader
//
// Soft radial circle with arc-position color gradient.
// Identical to the store version.
// ---------------------------------------------------------------------------

export const particleFragmentShader = /* glsl */ `
uniform vec3  uColorDark;
uniform vec3  uColorMid;
uniform vec3  uColorBright;
uniform float uSoftEdge;
uniform float uBaseAlpha;
uniform float uIntroProgress;

varying float vArcT;
varying float vEdgeFactor;
varying float vOpacity;
varying float vDispMag;

void main() {
  // Soft circle from gl_PointCoord
  vec2 center = gl_PointCoord - 0.5;
  float dist = length(center) * 2.0;

  float circle = 1.0 - smoothstep(1.0 - uSoftEdge, 1.0, dist);
  if (circle < 0.01) discard;

  // Color gradient follows arc position (t=0 bright/gold, t=1 dark/brown)
  vec3 color;
  if (vArcT < 0.5) {
    color = mix(uColorBright, uColorMid, vArcT * 2.0);
  } else {
    color = mix(uColorMid, uColorDark, (vArcT - 0.5) * 2.0);
  }

  // Intro fade
  float introAlpha = smoothstep(0.0, 0.3, uIntroProgress);

  // Per-particle alpha
  float edgeAlpha = mix(1.0, 0.4, vEdgeFactor);

  // Fade out displaced particles
  float dispAlpha = exp(-vDispMag * 3.0);

  float alpha = uBaseAlpha * circle * introAlpha * vOpacity * edgeAlpha * dispAlpha;

  gl_FragColor = vec4(color, alpha);
}
`;
