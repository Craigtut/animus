/**
 * FluidBackground — WebGL2 flowing gradient with cursor reactivity.
 *
 * Renders a Perlin-noise flow field that warps warm gradient patches,
 * creating organic, fluid motion via iterative noise-based UV displacement
 * with cursor tracking.
 *
 * Renders at low resolution (~512px) and lets the browser upscale smoothly.
 * This keeps GPU cost negligible while producing beautiful soft gradients.
 */
import { useRef, useEffect } from 'react';

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const VERTEX_SHADER = /* glsl */ `#version 300 es
precision mediump float;
in vec2 aPosition;
out vec2 vUV;
void main() {
  vUV = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUV;
out vec4 fragColor;

uniform float uTime;
uniform vec2 uMouse;
uniform vec2 uResolution;
uniform float uDark;       // 0.0 = light mode, 1.0 = dark mode
uniform float uExcitement; // 0.0 = idle, 1.0 = fully excited (button hover)

// --- Perlin noise (3D) ---------------------------------------------------

vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.11369, 0.13787));
  p3 += dot(p3, p3.yxz + 19.19);
  return -1.0 + 2.0 * fract(vec3(
    (p3.x + p3.y) * p3.z,
    (p3.x + p3.z) * p3.y,
    (p3.y + p3.z) * p3.x
  ));
}

float perlin(vec3 p) {
  vec3 pi = floor(p);
  vec3 pf = p - pi;
  vec3 w = pf * pf * (3.0 - 2.0 * pf);

  float n000 = dot(pf - vec3(0,0,0), hash33(pi + vec3(0,0,0)));
  float n100 = dot(pf - vec3(1,0,0), hash33(pi + vec3(1,0,0)));
  float n010 = dot(pf - vec3(0,1,0), hash33(pi + vec3(0,1,0)));
  float n110 = dot(pf - vec3(1,1,0), hash33(pi + vec3(1,1,0)));
  float n001 = dot(pf - vec3(0,0,1), hash33(pi + vec3(0,0,1)));
  float n101 = dot(pf - vec3(1,0,1), hash33(pi + vec3(1,0,1)));
  float n011 = dot(pf - vec3(0,1,1), hash33(pi + vec3(0,1,1)));
  float n111 = dot(pf - vec3(1,1,1), hash33(pi + vec3(1,1,1)));

  return mix(
    mix(mix(n000, n100, w.x), mix(n010, n110, w.x), w.y),
    mix(mix(n001, n101, w.x), mix(n011, n111, w.x), w.y),
    w.z
  );
}

// --- Flow field -----------------------------------------------------------

const float PI = 3.14159265359;
const int FLOW_ITER = 6;

vec2 flow(vec2 st) {
  float aspect = uResolution.x / max(uResolution.y, 0.001);
  vec2 aspectVec = vec2(aspect, 1.0);

  // Mouse gently shifts the noise field sampling origin —
  // the whole gradient responds subtly to cursor movement.
  vec2 invPos = 0.5 + (0.5 - uMouse) * 0.15;

  // Subtle breathing when excited
  float breath = 1.0 + sin(uTime * 0.08 * 6.2832) * 0.12 * uExcitement;

  float spread = 0.16 / ((aspect + 1.0) * 0.5);
  float amount = 0.014 * breath;

  float freq = 5.0 * spread;
  float t = uTime * (0.018 + uExcitement * 0.003);
  float rad = 360.0 * 5.4 * PI / 180.0;

  for (int i = 0; i < FLOW_ITER; i++) {
    vec2 scaled = (clamp(st, -1.0, 2.0) - 0.5) * aspectVec + invPos;
    float p = perlin(vec3((scaled - 0.5) * freq, t)) - 0.5;
    float ang = p * rad;
    st += vec2(cos(ang), sin(ang)) * amount;
  }

  return clamp(st, 0.0, 1.0);
}

// --- Gradient generation --------------------------------------------------

vec3 warmGradient(vec2 uv) {
  // Light mode palette
  vec3 lBase  = vec3(0.980, 0.976, 0.957);  // #FAF9F4 warm white
  vec3 lPeach = vec3(0.955, 0.875, 0.790);  // soft peach
  vec3 lGold  = vec3(0.955, 0.912, 0.810);  // soft gold
  vec3 lRose  = vec3(0.940, 0.825, 0.810);  // soft rose
  vec3 lBlush = vec3(0.950, 0.870, 0.830);  // light blush

  // Dark mode palette
  vec3 dBase  = vec3(0.110, 0.102, 0.094);  // #1C1A18 warm dark
  vec3 dAmber = vec3(0.180, 0.135, 0.090);  // warm amber
  vec3 dRust  = vec3(0.165, 0.110, 0.090);  // warm rust
  vec3 dBrown = vec3(0.150, 0.120, 0.100);  // warm brown
  vec3 dWarm  = vec3(0.160, 0.128, 0.095);  // warm glow

  // Select palette based on mode
  vec3 base  = mix(lBase,  dBase,  uDark);
  vec3 col1  = mix(lPeach, dAmber, uDark);
  vec3 col2  = mix(lGold,  dRust,  uDark);
  vec3 col3  = mix(lRose,  dBrown, uDark);
  vec3 col4  = mix(lBlush, dWarm,  uDark);

  // Animated blob positions
  float st = uTime * 0.004;
  vec2 p1 = vec2(0.30 + sin(st * 0.7) * 0.08, 0.35 + cos(st * 0.5) * 0.08);
  vec2 p2 = vec2(0.72 + cos(st * 0.6) * 0.06, 0.28 + sin(st * 0.8) * 0.06);
  vec2 p3 = vec2(0.48 + sin(st * 0.4) * 0.10, 0.68 + cos(st * 0.3) * 0.08);
  vec2 p4 = vec2(0.62 + cos(st * 0.5) * 0.05, 0.50 + sin(st * 0.7) * 0.07);

  float d1 = length(uv - p1);
  float d2 = length(uv - p2);
  float d3 = length(uv - p3);
  float d4 = length(uv - p4);

  // Excitement gently warms the gradient
  float boost = 1.0 + uExcitement * 0.55;
  float gBreath = 1.0 + sin(uTime * 0.08 * 6.2832) * 0.06 * uExcitement;
  float reach = boost * gBreath;

  vec3 col = base;
  col = mix(col, col1, smoothstep(0.55, 0.0, d1) * 0.66 * reach);
  col = mix(col, col2, smoothstep(0.50, 0.0, d2) * 0.54 * reach);
  col = mix(col, col3, smoothstep(0.50, 0.0, d3) * 0.60 * reach);
  col = mix(col, col4, smoothstep(0.45, 0.0, d4) * 0.48 * reach);

  // Subtle noise texture
  float noise = perlin(vec3(uv * 3.5, st * 0.5)) * 0.012;
  col += noise;

  return col;
}

// --- Main -----------------------------------------------------------------

void main() {
  vec2 uv = vUV;
  vec2 flowedUV = flow(uv);

  // Blend original and flowed UVs — controls distortion intensity
  vec2 finalUV = mix(uv, flowedUV, 0.55);

  vec3 color = warmGradient(finalUV);
  fragColor = vec4(color, 1.0);
}`;

// ---------------------------------------------------------------------------
// Max render resolution (pixels on the longer axis).
// Low resolution is intentional — the output is soft gradients that benefit
// from the browser's bilinear upscaling, and GPU cost stays negligible.
// ---------------------------------------------------------------------------
const MAX_RES = 512;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface FluidBackgroundProps {
  /** 'light' or 'dark' — drives the shader color palette */
  mode?: 'light' | 'dark';
  /** 0–1 excitement level (e.g. button hover). Boosts saturation + breathing. */
  excitement?: number;
}

export function FluidBackground({ mode = 'light', excitement = 0 }: FluidBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const excitementRef = useRef(0);
  const stateRef = useRef({
    raf: 0,
    mouseX: 0.5,
    mouseY: 0.5,
    targetX: 0.5,
    targetY: 0.5,
    startTime: Date.now(),
  });

  // Keep target excitement in sync without triggering re-renders
  excitementRef.current = excitement;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Check for reduced motion preference
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false });
    if (!gl) return;

    // --- Compile shaders ---
    function compile(src: string, type: number) {
      const s = gl!.createShader(type)!;
      gl!.shaderSource(s, src);
      gl!.compileShader(s);
      if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) {
        console.error('[FluidBackground] Shader error:', gl!.getShaderInfoLog(s));
        return null;
      }
      return s;
    }

    const vs = compile(VERTEX_SHADER, gl.VERTEX_SHADER);
    const fs = compile(FRAGMENT_SHADER, gl.FRAGMENT_SHADER);
    if (!vs || !fs) return;

    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[FluidBackground] Link error:', gl.getProgramInfoLog(program));
      return;
    }

    gl.useProgram(program);

    // --- Full-screen quad ---
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    const aPos = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    // --- Uniforms ---
    const uTime = gl.getUniformLocation(program, 'uTime');
    const uMouse = gl.getUniformLocation(program, 'uMouse');
    const uResolution = gl.getUniformLocation(program, 'uResolution');
    const uDark = gl.getUniformLocation(program, 'uDark');
    const uExcitement = gl.getUniformLocation(program, 'uExcitement');

    // --- Clear color matches background so resizes never flash black ---
    const isDark = mode === 'dark' ? 1.0 : 0.0;
    if (mode === 'dark') {
      gl.clearColor(0.110, 0.102, 0.094, 1.0); // #1C1A18
    } else {
      gl.clearColor(0.980, 0.976, 0.957, 1.0); // #FAF9F4
    }
    gl.clear(gl.COLOR_BUFFER_BIT);

    // --- Mouse tracking ---
    function onMouseMove(e: MouseEvent) {
      stateRef.current.targetX = e.clientX / window.innerWidth;
      stateRef.current.targetY = 1.0 - e.clientY / window.innerHeight;
    }
    window.addEventListener('mousemove', onMouseMove, { passive: true });

    // --- Shared render state ---
    const st = stateRef.current;
    let smoothExcitement = 0;
    let frameCount = 0;

    // Start hidden — fade in after the canvas has settled at correct size
    canvas.style.opacity = '0';

    // --- Draw a single frame (called from both render loop and resize) ---
    function drawFrame() {
      const elapsed = (Date.now() - st.startTime) * 0.001;

      gl!.uniform1f(uTime, prefersReduced ? 0.0 : elapsed);
      gl!.uniform2f(uMouse, st.mouseX, st.mouseY);
      gl!.uniform2f(uResolution, canvas!.width, canvas!.height);
      gl!.uniform1f(uDark, isDark);
      gl!.uniform1f(uExcitement, smoothExcitement);

      gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
    }

    // --- Resize — immediately re-renders so the cleared buffer is never visible ---
    function resize() {
      const cw = canvas!.clientWidth;
      const ch = canvas!.clientHeight;
      if (cw === 0 || ch === 0) return;
      const aspect = cw / ch;

      let w: number, h: number;
      if (aspect >= 1) {
        w = MAX_RES;
        h = Math.round(MAX_RES / aspect);
      } else {
        h = MAX_RES;
        w = Math.round(MAX_RES * aspect);
      }

      canvas!.width = w;
      canvas!.height = h;
      gl!.viewport(0, 0, w, h);

      // Render immediately — prevents any cleared-buffer flash
      drawFrame();
    }
    resize();

    const resizeObs = new ResizeObserver(resize);
    resizeObs.observe(canvas);

    // --- Render loop ---
    function render() {
      // Smooth mouse position (momentum)
      st.mouseX += (st.targetX - st.mouseX) * 0.02;
      st.mouseY += (st.targetY - st.mouseY) * 0.02;

      // Smooth excitement — gradual ramp
      const target = excitementRef.current;
      const rate = target > smoothExcitement ? 0.02 : 0.018;
      smoothExcitement += (target - smoothExcitement) * rate;

      drawFrame();

      // Wait a few frames for resize + render to settle, then fade in
      frameCount++;
      if (frameCount === 3) {
        canvas!.style.transition = 'opacity 1s ease-out';
        canvas!.style.opacity = '1';
      }

      st.raf = requestAnimationFrame(render);
    }

    st.raf = requestAnimationFrame(render);

    // --- Cleanup ---
    return () => {
      cancelAnimationFrame(st.raf);
      window.removeEventListener('mousemove', onMouseMove);
      resizeObs.disconnect();
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buf);
    };
  }, [mode]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  );
}
