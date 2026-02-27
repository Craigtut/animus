#!/usr/bin/env node

/**
 * prepare-tauri.mjs
 *
 * Automates the two manual steps needed before `cargo tauri build`:
 *   A) Download a standalone Node.js binary for the current platform
 *   B) Populate packages/tauri/resources/ with the sidecar payload
 *
 * Run after `npm run build:prod`.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const ROOT = path.resolve(import.meta.dirname, '..');
const TAURI_DIR = path.join(ROOT, 'packages', 'tauri');
const BINARIES_DIR = path.join(TAURI_DIR, 'binaries');
const RESOURCES_DIR = path.join(TAURI_DIR, 'resources');

// ---------------------------------------------------------------------------
// Platform mapping
// ---------------------------------------------------------------------------

/**
 * Map process.platform + process.arch to:
 *   - targetTriple: Tauri binary naming convention
 *   - nodePlatform: Node.js download archive naming
 *   - ext: archive extension
 */
function getPlatformInfo() {
  const { platform, arch } = process;

  const map = {
    'darwin-arm64': {
      targetTriple: 'node-aarch64-apple-darwin',
      nodePlatform: 'darwin-arm64',
      ext: '.tar.gz',
    },
    'darwin-x64': {
      targetTriple: 'node-x86_64-apple-darwin',
      nodePlatform: 'darwin-x64',
      ext: '.tar.gz',
    },
    'linux-x64': {
      targetTriple: 'node-x86_64-unknown-linux-gnu',
      nodePlatform: 'linux-x64',
      ext: '.tar.xz',
    },
    'linux-arm64': {
      targetTriple: 'node-aarch64-unknown-linux-gnu',
      nodePlatform: 'linux-arm64',
      ext: '.tar.xz',
    },
    'win32-x64': {
      targetTriple: 'node-x86_64-pc-windows-msvc.exe',
      nodePlatform: 'win-x64',
      ext: '.zip',
    },
  };

  const key = `${platform}-${arch}`;
  const info = map[key];
  if (!info) {
    console.error(`Unsupported platform/arch: ${key}`);
    process.exit(1);
  }
  return info;
}

// ---------------------------------------------------------------------------
// Step A: Download Node.js binary
// ---------------------------------------------------------------------------

async function downloadNodeBinary() {
  const { targetTriple, nodePlatform, ext } = getPlatformInfo();
  const destPath = path.join(BINARIES_DIR, targetTriple);

  if (fs.existsSync(destPath)) {
    console.log(`[1/7] Node.js binary already exists at ${destPath}, skipping download`);
    return;
  }

  const nodeVersion = `v${process.versions.node}`;
  const archiveName = `node-${nodeVersion}-${nodePlatform}`;
  const url = `https://nodejs.org/dist/${nodeVersion}/${archiveName}${ext}`;

  console.log(`[1/7] Downloading Node.js ${nodeVersion} for ${nodePlatform}...`);
  console.log(`      URL: ${url}`);

  fs.mkdirSync(BINARIES_DIR, { recursive: true });

  const tmpArchive = path.join(BINARIES_DIR, `node-download${ext}`);

  try {
    // Download the archive
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    const fileStream = fs.createWriteStream(tmpArchive);
    await pipeline(Readable.fromWeb(response.body), fileStream);

    // Extract just the node binary
    if (ext === '.tar.gz' || ext === '.tar.xz') {
      // Extract to a temp dir first, then move the binary.
      // macOS bsdtar doesn't handle --strip-components with specific paths well.
      const tmpExtract = path.join(BINARIES_DIR, '_extract_tmp');
      fs.mkdirSync(tmpExtract, { recursive: true });
      execSync(
        `tar -xf "${tmpArchive}" -C "${tmpExtract}" "${archiveName}/bin/node"`,
        { stdio: 'inherit' }
      );
      fs.renameSync(path.join(tmpExtract, archiveName, 'bin', 'node'), destPath);
      fs.rmSync(tmpExtract, { recursive: true, force: true });
    } else if (ext === '.zip') {
      // Windows: extract node.exe from the zip using a temp PowerShell script
      // to avoid path injection issues with inline commands
      const binaryPath = `${archiveName}/node.exe`;
      const ps1Path = path.join(BINARIES_DIR, '_extract.ps1');
      const ps1Content = [
        'Add-Type -AssemblyName System.IO.Compression.FileSystem',
        `$zip = [System.IO.Compression.ZipFile]::OpenRead("${tmpArchive.replace(/\\/g, '\\\\')}")`,
        `$entry = $zip.Entries | Where-Object { $_.FullName -eq "${binaryPath}" }`,
        `[System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, "${destPath.replace(/\\/g, '\\\\')}", $true)`,
        '$zip.Dispose()',
      ].join('\n');
      fs.writeFileSync(ps1Path, ps1Content);
      try {
        execSync(`powershell -ExecutionPolicy Bypass -File "${ps1Path}"`, { stdio: 'inherit' });
      } finally {
        fs.unlinkSync(ps1Path);
      }
    }

    if (process.platform !== 'win32') {
      fs.chmodSync(destPath, 0o755);
    }
    console.log(`      Saved to ${destPath}`);
  } finally {
    // Clean up temp archive
    if (fs.existsSync(tmpArchive)) {
      fs.unlinkSync(tmpArchive);
    }
  }
}

// ---------------------------------------------------------------------------
// Step B: Populate resources/ with sidecar payload
// ---------------------------------------------------------------------------

function cleanResources() {
  console.log('[2/7] Cleaning resources/ directory...');

  if (!fs.existsSync(RESOURCES_DIR)) {
    fs.mkdirSync(RESOURCES_DIR, { recursive: true });
    return;
  }

  const entries = fs.readdirSync(RESOURCES_DIR);
  for (const entry of entries) {
    if (entry === '.gitkeep') continue;
    const fullPath = path.join(RESOURCES_DIR, entry);
    fs.rmSync(fullPath, { recursive: true, force: true });
  }
}

function copyBackendDist() {
  console.log('[3/7] Copying backend dist to resources/backend/...');

  const src = path.join(ROOT, 'packages', 'backend', 'dist');
  const dest = path.join(RESOURCES_DIR, 'backend');

  if (!fs.existsSync(src)) {
    console.error('      ERROR: packages/backend/dist/ does not exist. Run npm run build:prod first.');
    process.exit(1);
  }

  fs.cpSync(src, dest, { recursive: true });
  console.log('      Done');
}

function copyWorkspacePackages() {
  console.log('[6/7] Copying workspace packages (@animus-labs/shared, @animus-labs/agents, @animus-labs/tts-native)...');

  const packages = ['shared', 'agents', 'tts-native'];

  for (const pkg of packages) {
    const pkgRoot = path.join(ROOT, 'packages', pkg);
    const destRoot = path.join(RESOURCES_DIR, 'node_modules', '@animus-labs', pkg);

    // Copy package.json
    fs.mkdirSync(destRoot, { recursive: true });
    fs.cpSync(path.join(pkgRoot, 'package.json'), path.join(destRoot, 'package.json'));

    // Copy dist/ (or native build artifacts for tts-native)
    const distSrc = path.join(pkgRoot, 'dist');
    if (fs.existsSync(distSrc)) {
      fs.cpSync(distSrc, path.join(destRoot, 'dist'), { recursive: true });
    }

    // Copy native addon files (.node binaries, index.js, index.d.ts) for tts-native
    if (pkg === 'tts-native') {
      for (const file of fs.readdirSync(pkgRoot)) {
        if (file.endsWith('.node') || file === 'index.js' || file === 'index.d.ts') {
          fs.cpSync(path.join(pkgRoot, file), path.join(destRoot, file));
        }
      }
    } else if (!fs.existsSync(distSrc)) {
      console.error(`      ERROR: packages/${pkg}/dist/ does not exist. Run npm run build:prod first.`);
      process.exit(1);
    }

    console.log(`      Copied @animus-labs/${pkg}`);
  }
}

function generatePackageJson() {
  console.log('[4/7] Generating resources/package.json...');

  const backendPkgPath = path.join(ROOT, 'packages', 'backend', 'package.json');
  const backendPkg = JSON.parse(fs.readFileSync(backendPkgPath, 'utf-8'));

  // Filter out workspace references (local packages copied separately)
  const deps = { ...backendPkg.dependencies };
  delete deps['@animus-labs/shared'];
  delete deps['@animus-labs/agents'];
  delete deps['@animus-labs/tts-native'];

  const resourcePkg = {
    private: true,
    type: 'module',
    dependencies: deps,
  };

  fs.writeFileSync(
    path.join(RESOURCES_DIR, 'package.json'),
    JSON.stringify(resourcePkg, null, 2) + '\n'
  );

  console.log('      Done');
}

function installDependencies() {
  console.log('[5/7] Installing production dependencies in resources/...');

  execSync('npm install --omit=dev', {
    cwd: RESOURCES_DIR,
    stdio: 'inherit',
  });

  console.log('      Done');
}

function verify() {
  console.log('[7/7] Verifying sidecar payload...');

  const checks = [
    { path: path.join(RESOURCES_DIR, 'backend', 'index.js'), label: 'resources/backend/index.js' },
    { path: path.join(RESOURCES_DIR, 'node_modules', 'fastify'), label: 'resources/node_modules/fastify' },
    { path: path.join(RESOURCES_DIR, 'node_modules', '@animus-labs', 'shared', 'dist'), label: 'resources/node_modules/@animus-labs/shared/dist' },
    { path: path.join(RESOURCES_DIR, 'node_modules', '@animus-labs', 'agents', 'dist'), label: 'resources/node_modules/@animus-labs/agents/dist' },
  ];

  let allOk = true;
  for (const check of checks) {
    if (fs.existsSync(check.path)) {
      console.log(`      OK: ${check.label}`);
    } else {
      console.error(`      MISSING: ${check.label}`);
      allOk = false;
    }
  }

  if (!allOk) {
    console.error('\nVerification failed. Some required files are missing.');
    process.exit(1);
  }

  console.log('\nTauri build preparation complete.');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== Tauri Build Preparation ===\n');

  try {
    await downloadNodeBinary();
    cleanResources();
    copyBackendDist();
    generatePackageJson();
    installDependencies();
    // Copy workspace packages AFTER npm install, otherwise npm removes them
    copyWorkspacePackages();
    verify();
  } catch (err) {
    console.error('\nFatal error during Tauri build preparation:');
    console.error(err);
    process.exit(1);
  }
}

main();
