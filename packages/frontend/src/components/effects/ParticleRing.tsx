// ---------------------------------------------------------------------------
// ParticleRing — Outer wrapper
//
// Manages the intro phase state machine, renders the R3F Canvas,
// and provides a gradient fallback for devices without WebGL2.
//
// Ported from AnimusParticleHero in the Animus Store.
// ---------------------------------------------------------------------------

import { useState, useRef, useCallback, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';

import { ParticleSystem } from './particle-ring/ParticleSystem';
import { detectDeviceTier, INTRO, RENDER } from './particle-ring/particleConfig';

type Phase = 'loading' | 'forming' | 'holding' | 'idle';

interface ParticleRingProps {
  mode?: 'light' | 'dark';
  onIntroComplete?: () => void;
}

export function ParticleRing({ mode = 'light', onIntroComplete }: ParticleRingProps) {
  const [tier] = useState(() => detectDeviceTier());
  const [gpuFailed, setGpuFailed] = useState(false);
  const [cameraZ] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < 768 ? 13 : 8,
  );

  const introProgressRef = useRef(0);
  const phaseRef = useRef<Phase>('loading');
  const startTimeRef = useRef(0);
  const rafRef = useRef<number>(0);
  const introCompleteCalledRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const visibleRef = useRef(true);

  // ---------------------------------------------------------------------------
  // Visibility: pause canvas when off-screen
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => { if (entry) visibleRef.current = entry.isIntersecting; },
      { threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ---------------------------------------------------------------------------
  // Phase state machine (driven by rAF)
  // ---------------------------------------------------------------------------

  const tick = useCallback(() => {
    const elapsed = (performance.now() - startTimeRef.current) / 1000;
    const currentPhase = phaseRef.current;

    if (currentPhase === 'forming') {
      const progress = Math.min(elapsed / INTRO.formDuration, 1);
      introProgressRef.current = progress;

      if (progress >= 1) {
        phaseRef.current = 'holding';
        startTimeRef.current = performance.now();
      }
    } else if (currentPhase === 'holding') {
      introProgressRef.current = 1;

      if (elapsed >= INTRO.holdDuration) {
        phaseRef.current = 'idle';

        if (!introCompleteCalledRef.current) {
          introCompleteCalledRef.current = true;
          onIntroComplete?.();
        }
        return;
      }
    } else {
      return;
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [onIntroComplete]);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // GPU ready callback — starts the forming phase
  // ---------------------------------------------------------------------------

  const handleReady = useCallback(() => {
    phaseRef.current = 'forming';
    startTimeRef.current = performance.now();
    rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  // ---------------------------------------------------------------------------
  // WebGL error handling
  // ---------------------------------------------------------------------------

  const handleCreated = useCallback(({ gl }: { gl: THREE.WebGLRenderer }) => {
    if (!gl.capabilities.isWebGL2) {
      setGpuFailed(true);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Background color matching the theme
  // ---------------------------------------------------------------------------

  const bgColor = mode === 'dark' ? '#1C1A18' : '#FAF9F4';

  // ---------------------------------------------------------------------------
  // Fallback gradient
  // ---------------------------------------------------------------------------

  if (gpuFailed) {
    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(ellipse at center, rgba(196,149,106,0.2) 0%, transparent 70%)',
          }}
        />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
      }}
    >
      <Canvas
        camera={{ position: [0, 0, cameraZ], fov: 50, near: 0.1, far: 50 }}
        dpr={[1, RENDER.maxDpr]}
        gl={{
          antialias: RENDER.antialias,
          alpha: RENDER.alpha,
          powerPreference: 'high-performance',
        }}
        style={{ background: bgColor }}
        onCreated={handleCreated}
      >
        <ParticleSystem
          tier={tier}
          introProgressRef={introProgressRef}
          visibleRef={visibleRef}
          onReady={handleReady}
        />
      </Canvas>

      {/* Vignette overlay to blend ring edges into the background */}
      <div
        style={{
          pointerEvents: 'none',
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(ellipse at center, transparent 35%, ${bgColor} 75%)`,
        }}
      />
    </div>
  );
}
