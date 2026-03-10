// ---------------------------------------------------------------------------
// ParticleSystem — Core R3F component for the particle ring.
//
// Ported from the Animus Store hero particle system. All animation is
// computed in the vertex shader (curl noise, orbital rotation, tangential
// flow). Mouse interaction uses a CPU-side displacement grid that persists
// and decays over time, giving particles a fluid spring-back.
// ---------------------------------------------------------------------------

import { useRef, useMemo, useEffect, useCallback, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import {
  generateRingPositions,
  generateScatterPositions,
  generateRandomAttributes,
} from './ringShape';
import { PHYSICS, COLORS, RENDER, type DeviceTier } from './particleConfig';
import { particleVertexShader } from './shaders/particleVertex.glsl';
import { particleFragmentShader } from './shaders/particleFragment.glsl';

// ---------------------------------------------------------------------------
// Displacement grid
// ---------------------------------------------------------------------------

const GRID_SIZE = 64;
const WORLD_EXTENT = 6.0;

const MOUSE_GRID_RADIUS = 5;

function createDisplacementGrid() {
  const data = new Float32Array(GRID_SIZE * GRID_SIZE * 4);
  const texture = new THREE.DataTexture(
    data, GRID_SIZE, GRID_SIZE,
    THREE.RGBAFormat, THREE.FloatType,
  );
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return { data, texture };
}

function updateDisplacementGrid(
  data: Float32Array,
  texture: THREE.DataTexture,
  mouseWorldX: number,
  mouseWorldY: number,
  mouseVelX: number,
  mouseVelY: number,
  mouseActive: boolean,
  decayRate: number,
) {
  for (let i = 0; i < data.length; i += 4) {
    data[i]! *= decayRate;
    data[i + 1]! *= decayRate;
  }

  if (mouseActive) {
    const gx = (mouseWorldX + WORLD_EXTENT) / (2 * WORLD_EXTENT) * GRID_SIZE;
    const gy = (mouseWorldY + WORLD_EXTENT) / (2 * WORLD_EXTENT) * GRID_SIZE;

    const r = MOUSE_GRID_RADIUS;

    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const cx = Math.floor(gx) + dx;
        const cy = Math.floor(gy) + dy;
        if (cx < 0 || cx >= GRID_SIZE || cy < 0 || cy >= GRID_SIZE) continue;

        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > r) continue;

        const falloff = 1.0 - dist / r;
        const ff = falloff * falloff * falloff;

        const idx = (cy * GRID_SIZE + cx) * 4;

        if (dist > 0.01) {
          const ndx = dx / dist;
          const ndy = dy / dist;
          data[idx]     = data[idx]! + ndx * ff * 0.04;
          data[idx + 1] = data[idx + 1]! + ndy * ff * 0.04;
        }

        data[idx]     = data[idx]! + mouseVelX * ff * 0.45;
        data[idx + 1] = data[idx + 1]! + mouseVelY * ff * 0.45;
      }
    }
  }

  for (let i = 0; i < data.length; i += 4) {
    const dx = data[i]!;
    const dy = data[i + 1]!;
    const mag = Math.sqrt(dx * dx + dy * dy);
    if (mag > 1.0) {
      const scale = 1.0 / mag;
      data[i]     = dx * scale;
      data[i + 1] = dy * scale;
    }
  }

  texture.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// React component
// ---------------------------------------------------------------------------

interface ParticleSystemProps {
  tier: DeviceTier;
  introProgressRef: MutableRefObject<number>;
  visibleRef: MutableRefObject<boolean>;
  onReady?: () => void;
}

export function ParticleSystem({ tier, introProgressRef, visibleRef, onReady }: ParticleSystemProps) {
  const { gl, camera } = useThree();
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  const readyFiredRef = useRef(false);

  const mouseRef = useRef({ x: 0, y: 0, accVelX: 0, accVelY: 0, active: false });

  const handlePointerMove = useCallback((e: PointerEvent) => {
    const rect = gl.domElement.getBoundingClientRect();
    const m = mouseRef.current;
    const newX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const newY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    m.accVelX += newX - m.x;
    m.accVelY += newY - m.y;
    m.x = newX;
    m.y = newY;
    m.active = true;
  }, [gl.domElement]);

  const handlePointerLeave = useCallback(() => {
    mouseRef.current.active = false;
  }, []);

  useEffect(() => {
    const el = gl.domElement;
    el.addEventListener('pointermove', handlePointerMove);
    el.addEventListener('pointerleave', handlePointerLeave);
    return () => {
      el.removeEventListener('pointermove', handlePointerMove);
      el.removeEventListener('pointerleave', handlePointerLeave);
    };
  }, [gl.domElement, handlePointerMove, handlePointerLeave]);

  // ---------------------------------------------------------------------------
  // Displacement grid
  // ---------------------------------------------------------------------------

  const gridRef = useRef<{ data: Float32Array; texture: THREE.DataTexture } | null>(null);

  if (!gridRef.current) {
    gridRef.current = createDisplacementGrid();
  }

  // ---------------------------------------------------------------------------
  // Geometry + Material
  // ---------------------------------------------------------------------------

  const geometry = useMemo(() => {
    const count = tier.particleCount;

    const ringData = generateRingPositions(count);
    const scatterData = generateScatterPositions(count);
    const randomData = generateRandomAttributes(count);

    const geo = new THREE.BufferGeometry();

    const targets = new Float32Array(count * 3);
    const scatters = new Float32Array(count * 3);
    const arcTs = new Float32Array(count);
    const dummyPositions = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const i4 = i * 4;
      const i3 = i * 3;

      targets[i3]     = ringData[i4]!;
      targets[i3 + 1] = ringData[i4 + 1]!;
      targets[i3 + 2] = ringData[i4 + 2]!;

      scatters[i3]     = scatterData[i4]!;
      scatters[i3 + 1] = scatterData[i4 + 1]!;
      scatters[i3 + 2] = scatterData[i4 + 2]!;

      arcTs[i] = ringData[i4 + 3]!;

      dummyPositions[i3]     = scatterData[i4]!;
      dummyPositions[i3 + 1] = scatterData[i4 + 1]!;
      dummyPositions[i3 + 2] = scatterData[i4 + 2]!;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(dummyPositions, 3));
    geo.setAttribute('aTarget', new THREE.BufferAttribute(targets, 3));
    geo.setAttribute('aScatter', new THREE.BufferAttribute(scatters, 3));
    geo.setAttribute('aArcT', new THREE.BufferAttribute(arcTs, 1));
    geo.setAttribute('aRandom', new THREE.BufferAttribute(randomData, 4));

    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 50);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:            { value: 0 },
        uIntroProgress:   { value: 0 },
        uOrbitalSpeed:    { value: PHYSICS.orbitalSpeed },
        uBreathAmplitude: { value: PHYSICS.breathAmplitude },
        uBreathFrequency: { value: PHYSICS.breathFrequency },
        uCurlScale:       { value: PHYSICS.curlScale },
        uCurlStrength:    { value: PHYSICS.curlStrength },
        uFlowSpeed:       { value: PHYSICS.flowSpeed },
        uDisplacementGrid:{ value: gridRef.current!.texture },
        uGridExtent:      { value: WORLD_EXTENT },
        uPointSizeMin:    { value: RENDER.pointSizeMin },
        uPointSizeMax:    { value: RENDER.pointSizeMax },
        uPixelRatio:      { value: Math.min(window.devicePixelRatio, RENDER.maxDpr) },
        uColorDark:       { value: new THREE.Vector3(...COLORS.dark) },
        uColorMid:        { value: new THREE.Vector3(...COLORS.mid) },
        uColorBright:     { value: new THREE.Vector3(...COLORS.bright) },
        uSoftEdge:        { value: RENDER.softEdge },
        uBaseAlpha:       { value: RENDER.baseAlpha },
      },
      vertexShader: particleVertexShader,
      fragmentShader: particleFragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    materialRef.current = mat;
    return geo;
  }, [gl, tier]);

  // ---------------------------------------------------------------------------
  // Frame Loop
  // ---------------------------------------------------------------------------

  useFrame(() => {
    const mat = materialRef.current;
    const grid = gridRef.current;
    if (!mat || !grid) return;

    if (!readyFiredRef.current) {
      readyFiredRef.current = true;
      onReady?.();
    }

    if (!visibleRef.current) return;

    const time = performance.now() / 1000;
    const m = mouseRef.current;

    const cam = camera as THREE.PerspectiveCamera;
    const halfH = Math.tan((cam.fov / 2) * Math.PI / 180) * cam.position.z;
    const halfW = halfH * cam.aspect;
    const mouseWorldX = m.x * halfW;
    const mouseWorldY = m.y * halfH;
    const mouseVelX = m.accVelX * halfW;
    const mouseVelY = m.accVelY * halfH;

    updateDisplacementGrid(
      grid.data, grid.texture,
      mouseWorldX, mouseWorldY,
      mouseVelX, mouseVelY,
      m.active,
      0.98,
    );

    m.accVelX = 0;
    m.accVelY = 0;

    mat.uniforms['uTime']!.value = time;
    mat.uniforms['uIntroProgress']!.value = introProgressRef.current;
  });

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  useEffect(() => {
    return () => {
      geometry?.dispose();
      materialRef.current?.dispose();
      gridRef.current?.texture.dispose();
    };
  }, [geometry]);

  if (!geometry || !materialRef.current) return null;

  return <points ref={pointsRef} geometry={geometry} material={materialRef.current} />;
}
