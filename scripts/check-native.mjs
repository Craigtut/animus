#!/usr/bin/env node
/**
 * check-native.mjs — Ensures the @animus-labs/tts-native addon is available.
 *
 * Runs as part of `npm run dev`. Resolution order:
 *   1. Binary already exists on disk → exit immediately (zero overhead)
 *   2. Download prebuilt binary from GitHub Releases → fast, no toolchain needed
 *   3. Build from source if Rust is installed → fallback for contributors
 *   4. Print a warning and continue → TTS unavailable, everything else works
 */

import { existsSync, readFileSync, unlinkSync, createWriteStream } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform, arch } from 'node:process';
import { get as httpsGet } from 'node:https';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const ttsNativeDir = join(root, 'packages', 'tts-native');

const GITHUB_REPO = 'Craigtut/animus';

const PREFIX = '\x1b[33m[tts-native]\x1b[0m';
const PREFIX_INFO = '\x1b[36m[tts-native]\x1b[0m';
const PREFIX_OK = '\x1b[32m[tts-native]\x1b[0m';

// ---------------------------------------------------------------------------
// 1. Determine expected binary name
// ---------------------------------------------------------------------------

function getExpectedBinary() {
  const cpu = arch === 'arm64' ? 'arm64' : arch === 'x64' ? 'x64' : null;
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

const binaryName = getExpectedBinary();
if (!binaryName) {
  console.log(`${PREFIX} Unsupported platform (${platform}/${arch}), skipping native TTS`);
  process.exit(0);
}

const binaryPath = join(ttsNativeDir, binaryName);

// Fast path: binary already exists
if (existsSync(binaryPath)) {
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 2. Try downloading a prebuilt binary from GitHub Releases
// ---------------------------------------------------------------------------

/**
 * Follow redirects and download a file. Returns true on success.
 */
function download(url, dest, maxRedirects = 5) {
  return new Promise((resolve) => {
    if (maxRedirects <= 0) return resolve(false);

    httpsGet(url, { headers: { 'User-Agent': 'animus-check-native' } }, (res) => {
      // GitHub Releases returns 302 → follow it
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        res.resume(); // drain response
        return resolve(download(res.headers.location, dest, maxRedirects - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return resolve(false);
      }
      const file = createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(true); });
      file.on('error', () => resolve(false));
    }).on('error', () => resolve(false));
  });
}

async function tryDownloadPrebuilt() {
  const tag = 'tts-native-latest';
  const url = `https://github.com/${GITHUB_REPO}/releases/download/${tag}/${binaryName}`;

  console.log(`${PREFIX_INFO} Downloading prebuilt binary for ${platform}/${arch}...`);

  const ok = await download(url, binaryPath);
  if (ok && existsSync(binaryPath)) {
    console.log(`${PREFIX_OK} Downloaded ${binaryName} successfully`);
    return true;
  }

  // Clean up partial download
  try {
    if (existsSync(binaryPath)) unlinkSync(binaryPath);
  } catch { /* ignore */ }

  console.log(`${PREFIX} Prebuilt binary not available yet (${platform}/${arch})`);
  return false;
}

if (await tryDownloadPrebuilt()) {
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 3. Fall back to building from source if Rust is available
// ---------------------------------------------------------------------------

let hasRust = false;
try {
  execSync('cargo --version', { stdio: 'ignore' });
  hasRust = true;
} catch { /* Rust not installed */ }

if (!hasRust) {
  console.log(`${PREFIX} No prebuilt binary and Rust not installed.`);
  console.log(`${PREFIX} TTS will be unavailable. The rest of Animus works normally.`);
  console.log(`${PREFIX} To enable TTS, either:`);
  console.log(`${PREFIX}   - Wait for CI to publish prebuilt binaries (push to main)`);
  console.log(`${PREFIX}   - Install Rust (https://rustup.rs) and re-run npm run dev`);
  process.exit(0);
}

console.log(`${PREFIX_INFO} Building native TTS addon from source... (first time only, ~2 min)`);

try {
  execSync('npx napi build --release --platform', {
    cwd: ttsNativeDir,
    stdio: 'inherit',
  });
  console.log(`${PREFIX_OK} Build complete!`);
} catch {
  console.error(`${PREFIX} Build failed. TTS will be unavailable.`);
  console.error(`${PREFIX} You can retry manually: npm run build -w @animus-labs/tts-native`);
  process.exit(0);
}
