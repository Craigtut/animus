import { describe, expect, it } from 'vitest';
import {
  getExpectedTtsNativeBinary,
  getLinuxTtsNativeBinaryForDocker,
  normalizeTtsNativeArch,
} from '../../../../scripts/tts-native-platform.mjs';

describe('tts-native platform helpers', () => {
  it('normalizes Node, Docker, and uname architecture names', () => {
    expect(normalizeTtsNativeArch('x64')).toBe('x64');
    expect(normalizeTtsNativeArch('amd64')).toBe('x64');
    expect(normalizeTtsNativeArch('x86_64')).toBe('x64');
    expect(normalizeTtsNativeArch('arm64')).toBe('arm64');
    expect(normalizeTtsNativeArch('aarch64')).toBe('arm64');
    expect(normalizeTtsNativeArch('armv7l')).toBeNull();
  });

  it('resolves the expected native binary for supported host platforms', () => {
    expect(getExpectedTtsNativeBinary({ platform: 'linux', arch: 'x64' }))
      .toBe('tts-native.linux-x64-gnu.node');
    expect(getExpectedTtsNativeBinary({ platform: 'linux', arch: 'arm64' }))
      .toBe('tts-native.linux-arm64-gnu.node');
    expect(getExpectedTtsNativeBinary({ platform: 'darwin', arch: 'arm64' }))
      .toBe('tts-native.darwin-arm64.node');
    expect(getExpectedTtsNativeBinary({ platform: 'win32', arch: 'x64' }))
      .toBe('tts-native.win32-x64-msvc.node');
  });

  it('uses TARGETARCH when Docker buildx provides it', () => {
    expect(getLinuxTtsNativeBinaryForDocker({ targetArch: 'amd64', machineArch: 'aarch64' }))
      .toBe('tts-native.linux-x64-gnu.node');
    expect(getLinuxTtsNativeBinaryForDocker({ targetArch: 'arm64', machineArch: 'x86_64' }))
      .toBe('tts-native.linux-arm64-gnu.node');
  });

  it('falls back to the build container architecture when TARGETARCH is unavailable', () => {
    expect(getLinuxTtsNativeBinaryForDocker({ targetArch: '', machineArch: 'aarch64' }))
      .toBe('tts-native.linux-arm64-gnu.node');
    expect(getLinuxTtsNativeBinaryForDocker({ targetArch: undefined, machineArch: 'x86_64' }))
      .toBe('tts-native.linux-x64-gnu.node');
  });

  it('rejects unsupported Docker architectures', () => {
    expect(() => getLinuxTtsNativeBinaryForDocker({ targetArch: '', machineArch: 'armv7l' }))
      .toThrow('Unsupported Docker architecture');
  });
});
