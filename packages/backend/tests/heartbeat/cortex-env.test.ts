import { describe, expect, it } from 'vitest';
import { buildCortexEnvOverrides } from '../../src/heartbeat/cortex-env.js';

describe('buildCortexEnvOverrides', () => {
  it('returns undefined when no Tauri dock-suppression env is present', () => {
    expect(buildCortexEnvOverrides({})).toBeUndefined();
  });

  it('propagates the Tauri dock-suppression addon through sanitized Cortex envs', () => {
    const overrides = buildCortexEnvOverrides({
      ANIMUS_DOCK_SUPPRESS_ADDON: '/app/resources/macos_bg_policy.node',
      DYLD_INSERT_LIBRARIES: '/malicious/ignored.dylib',
    });

    expect(overrides).toEqual({
      ANIMUS_DOCK_SUPPRESS_ADDON: '/app/resources/macos_bg_policy.node',
      DYLD_INSERT_LIBRARIES: '/app/resources/macos_bg_policy.node',
    });
  });

  it('only propagates NODE_OPTIONS for the Tauri preload script', () => {
    expect(buildCortexEnvOverrides({
      NODE_OPTIONS: '--require=/app/resources/preload-bg-policy.js',
    })).toEqual({
      NODE_OPTIONS: '--require=/app/resources/preload-bg-policy.js',
    });

    expect(buildCortexEnvOverrides({
      NODE_OPTIONS: '--require=/tmp/unrelated.js',
    })).toBeUndefined();
  });
});
