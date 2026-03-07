#!/usr/bin/env node

/**
 * prepare-tauri-dev.mjs
 *
 * Creates stub binaries in packages/tauri/binaries/ so that
 * `cargo tauri dev` can compile. In dev mode the Rust code never
 * executes these binaries (it just opens a webview to localhost),
 * but Tauri's build script validates that externalBin paths exist.
 */

import fs from 'node:fs';
import path from 'node:path';

const BINARIES_DIR = path.resolve(import.meta.dirname, '..', 'packages', 'tauri', 'binaries');

const platform = process.platform;
const arch = process.arch;

const triples = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'win32-x64': 'x86_64-pc-windows-msvc',
};

const triple = triples[`${platform}-${arch}`];
if (!triple) {
  console.error(`Unsupported platform/arch: ${platform}-${arch}`);
  process.exit(1);
}

const ext = platform === 'win32' ? '.exe' : '';
const stubs = [
  `node-${triple}${ext}`,
  `ffmpeg-${triple}${ext}`,
];

fs.mkdirSync(BINARIES_DIR, { recursive: true });

for (const name of stubs) {
  const dest = path.join(BINARIES_DIR, name);
  if (!fs.existsSync(dest)) {
    fs.writeFileSync(dest, '');
    console.log(`Created stub: binaries/${name}`);
  }
}
