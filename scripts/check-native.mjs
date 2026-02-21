#!/usr/bin/env node
/**
 * check-native.mjs — Ensures the @animus/tts-native addon is built.
 *
 * Runs as part of `npm run dev`. If the .node binary exists, exits
 * immediately (zero overhead). If missing, checks for Rust and builds
 * automatically. If Rust isn't installed, prints a warning and exits
 * cleanly — the backend still starts, TTS just won't be available.
 */

import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform, arch } from 'node:process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const ttsNativeDir = join(root, 'packages', 'tts-native');

// Determine expected .node filename based on platform
function getExpectedBinary() {
  const os = platform === 'darwin' ? 'darwin' : platform === 'linux' ? 'linux' : null;
  const cpu = arch === 'arm64' ? 'arm64' : arch === 'x64' ? 'x64' : null;

  if (!os || !cpu) return null;

  if (os === 'darwin') return `tts-native.darwin-${cpu}.node`;
  // Linux uses -gnu suffix
  return `tts-native.linux-${cpu}-gnu.node`;
}

const binaryName = getExpectedBinary();
if (!binaryName) {
  console.log(`\x1b[33m[tts-native]\x1b[0m Unsupported platform (${platform}/${arch}), skipping native TTS build`);
  process.exit(0);
}

const binaryPath = join(ttsNativeDir, binaryName);

// Fast path: binary already exists
if (existsSync(binaryPath)) {
  process.exit(0);
}

// Check for Rust toolchain
try {
  execSync('cargo --version', { stdio: 'ignore' });
} catch {
  console.log(`\x1b[33m[tts-native]\x1b[0m Native TTS addon not built and Rust not installed.`);
  console.log(`\x1b[33m[tts-native]\x1b[0m TTS will be unavailable. To enable:`);
  console.log(`\x1b[33m[tts-native]\x1b[0m   1. Install Rust: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`);
  console.log(`\x1b[33m[tts-native]\x1b[0m   2. Run: npm run build -w @animus/tts-native`);
  process.exit(0);
}

// Build the addon
console.log(`\x1b[36m[tts-native]\x1b[0m Native TTS addon not found, building... (first time only, ~2 min)`);

try {
  execSync('npx napi build --release --platform', {
    cwd: ttsNativeDir,
    stdio: 'inherit',
  });
  console.log(`\x1b[32m[tts-native]\x1b[0m Build complete!`);
} catch (err) {
  console.error(`\x1b[33m[tts-native]\x1b[0m Build failed. TTS will be unavailable.`);
  console.error(`\x1b[33m[tts-native]\x1b[0m You can retry manually: npm run build -w @animus/tts-native`);
  // Don't block backend startup
  process.exit(0);
}
