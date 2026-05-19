import { arch as processArch, platform as processPlatform } from 'node:process';
import { machine } from 'node:os';
import { pathToFileURL } from 'node:url';

export function normalizeTtsNativeArch(value) {
  switch (value) {
    case 'amd64':
    case 'x64':
    case 'x86_64':
      return 'x64';
    case 'aarch64':
    case 'arm64':
      return 'arm64';
    default:
      return null;
  }
}

export function getExpectedTtsNativeBinary({
  platform = processPlatform,
  arch = processArch,
} = {}) {
  const cpu = normalizeTtsNativeArch(arch);
  if (!cpu) return null;

  switch (platform) {
    case 'darwin':
      return `tts-native.darwin-${cpu}.node`;
    case 'linux':
      return `tts-native.linux-${cpu}-gnu.node`;
    case 'win32':
      return `tts-native.win32-${cpu}-msvc.node`;
    default:
      return null;
  }
}

export function getLinuxTtsNativeBinaryForDocker({
  targetArch = process.env.TARGETARCH,
  machineArch = typeof machine === 'function' ? machine() : processArch,
} = {}) {
  const cpu = normalizeTtsNativeArch(targetArch) ?? normalizeTtsNativeArch(machineArch);
  if (!cpu) {
    throw new Error(`Unsupported Docker architecture: TARGETARCH=${targetArch ?? ''}, machine=${machineArch ?? ''}`);
  }
  return `tts-native.linux-${cpu}-gnu.node`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = process.argv[2];
  if (command === 'docker-linux-binary') {
    console.log(getLinuxTtsNativeBinaryForDocker());
  } else if (command === 'current-binary') {
    const binary = getExpectedTtsNativeBinary();
    if (!binary) {
      throw new Error(`Unsupported platform: ${processPlatform}/${processArch}`);
    }
    console.log(binary);
  } else {
    console.error('Usage: node scripts/tts-native-platform.mjs <docker-linux-binary|current-binary>');
    process.exit(1);
  }
}
