#!/usr/bin/env node

/**
 * prepare-tauri.mjs
 *
 * Automates the steps needed before `cargo tauri build`:
 *   A) Download a standalone Node.js binary for the current platform
 *   B) Populate packages/tauri/resources/ with the sidecar payload
 *   C) Prune foreign-platform binaries and non-essential files to reduce bundle size
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
const NATIVE_DIR = path.join(TAURI_DIR, 'native');

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
  // Allow CI to override for cross-compilation (e.g. building x64 on ARM runner)
  const platform = process.env.TAURI_TARGET_PLATFORM || process.platform;
  const arch = process.env.TAURI_TARGET_ARCH || process.arch;

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
    console.log(`[1/10] Node.js binary already exists at ${destPath}, skipping download`);
    return;
  }

  const nodeVersion = `v${process.versions.node}`;
  const archiveName = `node-${nodeVersion}-${nodePlatform}`;
  const url = `https://nodejs.org/dist/${nodeVersion}/${archiveName}${ext}`;

  console.log(`[1/10] Downloading Node.js ${nodeVersion} for ${nodePlatform}...`);
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
  console.log('[2/10] Cleaning resources/ directory...');

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

/**
 * On macOS, compile the native addon that suppresses dock icons for child
 * Node.js processes, then copy both the addon and its preload script into
 * resources/. On other platforms this is a no-op.
 */
function prepareMacOSBgPolicy() {
  if (process.platform !== 'darwin') {
    console.log('[3/10] macOS background policy addon: skipped (not macOS)');
    return;
  }

  console.log('[3/10] Compiling macOS background policy addon...');

  const srcFile = path.join(NATIVE_DIR, 'macos_bg_policy.m');
  const preloadSrc = path.join(NATIVE_DIR, 'preload-bg-policy.js');
  const addonDest = path.join(RESOURCES_DIR, 'macos_bg_policy.node');
  const preloadDest = path.join(RESOURCES_DIR, 'preload-bg-policy.js');

  if (!fs.existsSync(srcFile)) {
    console.log('      WARN: native/macos_bg_policy.m not found, skipping');
    return;
  }

  // Compile universal binary (arm64 + x86_64)
  // AppKit: NSApplication setActivationPolicy (primary dock icon suppression)
  // ApplicationServices: Carbon TransformProcessType (fallback for non-Cocoa binaries)
  execSync(
    `clang -shared -undefined dynamic_lookup ` +
    `-framework AppKit -framework ApplicationServices ` +
    `-arch arm64 -arch x86_64 ` +
    `-o "${addonDest}" "${srcFile}"`,
    { stdio: 'inherit' }
  );
  console.log(`      Compiled ${addonDest}`);

  // Copy preload script
  if (fs.existsSync(preloadSrc)) {
    fs.cpSync(preloadSrc, preloadDest);
    console.log(`      Copied preload-bg-policy.js`);
  } else {
    console.log('      WARN: native/preload-bg-policy.js not found');
  }
}

function copyBackendDist() {
  console.log('[4/10] Copying backend dist to resources/backend/...');

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
  console.log('[9/10] Copying workspace packages (@animus-labs/shared, @animus-labs/agents, @animus-labs/tts-native)...');

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
  console.log('[5/10] Generating resources/package.json...');

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
  console.log('[6/10] Installing production dependencies in resources/...');

  execSync('npm install --omit=dev', {
    cwd: RESOURCES_DIR,
    stdio: 'inherit',
  });

  console.log('      Done');
}

// ---------------------------------------------------------------------------
// Step C: Prune foreign-platform binaries and non-essential files
// ---------------------------------------------------------------------------

/** Recursively compute total size in bytes of a path. */
function dirSize(dirPath) {
  if (!fs.existsSync(dirPath)) return 0;
  const stat = fs.statSync(dirPath);
  if (stat.isFile()) return stat.size;
  let total = 0;
  for (const entry of fs.readdirSync(dirPath)) {
    total += dirSize(path.join(dirPath, entry));
  }
  return total;
}

function formatMB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Remove foreign-platform binaries from packages that bundle all platforms
 * in a single npm package (rather than using the optionalDependencies pattern).
 *
 * Three packages are affected:
 *   - @openai/codex-sdk: vendor/{target-triple}/
 *   - onnxruntime-node: bin/napi-v3/{os}/{arch}/
 *   - @anthropic-ai/claude-agent-sdk: vendor/ripgrep/{arch}-{os}/
 */
function prunePlatformBinaries() {
  console.log('[7/10] Pruning foreign-platform binaries...');

  // Use target platform/arch (may differ from host when cross-compiling in CI)
  const platform = process.env.TAURI_TARGET_PLATFORM || process.platform;
  const arch = process.env.TAURI_TARGET_ARCH || process.arch;
  const nodeModules = path.join(RESOURCES_DIR, 'node_modules');
  let totalSaved = 0;

  // --- @openai/codex-sdk ---
  // Uses Rust target triples: aarch64-apple-darwin, x86_64-pc-windows-msvc, etc.
  const codexVendor = path.join(nodeModules, '@openai', 'codex-sdk', 'vendor');
  if (fs.existsSync(codexVendor)) {
    const keepTriple = {
      'darwin-arm64': 'aarch64-apple-darwin',
      'darwin-x64': 'x86_64-apple-darwin',
      'linux-arm64': 'aarch64-unknown-linux-musl',
      'linux-x64': 'x86_64-unknown-linux-musl',
      'win32-arm64': 'aarch64-pc-windows-msvc',
      'win32-x64': 'x86_64-pc-windows-msvc',
    }[`${platform}-${arch}`];

    if (keepTriple) {
      for (const entry of fs.readdirSync(codexVendor)) {
        if (entry === keepTriple) continue;
        const entryPath = path.join(codexVendor, entry);
        if (fs.statSync(entryPath).isDirectory()) {
          const size = dirSize(entryPath);
          fs.rmSync(entryPath, { recursive: true, force: true });
          totalSaved += size;
          console.log(`      Removed codex-sdk vendor/${entry} (${formatMB(size)})`);
        }
      }
    } else {
      console.log(`      WARN: No codex-sdk platform mapping for ${platform}-${arch}, skipping`);
    }
  }

  // --- onnxruntime-node ---
  // Uses {os}/{arch} directories: darwin/arm64, linux/x64, win32/x64, etc.
  const ortBin = path.join(nodeModules, 'onnxruntime-node', 'bin', 'napi-v3');
  if (fs.existsSync(ortBin)) {
    for (const osDir of fs.readdirSync(ortBin)) {
      const osPath = path.join(ortBin, osDir);
      if (!fs.statSync(osPath).isDirectory()) continue;

      if (osDir !== platform) {
        // Remove the entire OS directory
        const size = dirSize(osPath);
        fs.rmSync(osPath, { recursive: true, force: true });
        totalSaved += size;
        console.log(`      Removed onnxruntime-node bin/napi-v3/${osDir}/ (${formatMB(size)})`);
      } else {
        // Same OS, remove non-matching architectures
        for (const archDir of fs.readdirSync(osPath)) {
          if (archDir === arch) continue;
          const archPath = path.join(osPath, archDir);
          if (fs.statSync(archPath).isDirectory()) {
            const size = dirSize(archPath);
            fs.rmSync(archPath, { recursive: true, force: true });
            totalSaved += size;
            console.log(`      Removed onnxruntime-node bin/napi-v3/${osDir}/${archDir}/ (${formatMB(size)})`);
          }
        }
      }
    }
  }

  // --- @anthropic-ai/claude-agent-sdk ---
  // Uses {arch}-{os} directories: arm64-darwin, x64-linux, x64-win32, etc.
  const rgVendor = path.join(nodeModules, '@anthropic-ai', 'claude-agent-sdk', 'vendor', 'ripgrep');
  if (fs.existsSync(rgVendor)) {
    const keepDir = `${arch}-${platform}`;

    for (const entry of fs.readdirSync(rgVendor)) {
      if (entry === keepDir) continue;
      const entryPath = path.join(rgVendor, entry);
      if (fs.statSync(entryPath).isDirectory()) {
        const size = dirSize(entryPath);
        fs.rmSync(entryPath, { recursive: true, force: true });
        totalSaved += size;
        console.log(`      Removed claude-agent-sdk vendor/ripgrep/${entry} (${formatMB(size)})`);
      }
    }
  }

  // --- onnxruntime-web ---
  // WASM runtime pulled in by @huggingface/transformers but unused in Node.js.
  // The backend uses onnxruntime-node for native inference.
  const ortWeb = path.join(nodeModules, 'onnxruntime-web');
  if (fs.existsSync(ortWeb)) {
    const size = dirSize(ortWeb);
    fs.rmSync(ortWeb, { recursive: true, force: true });
    totalSaved += size;
    console.log(`      Removed onnxruntime-web entirely (${formatMB(size)})`);
  }

  console.log(`      Platform pruning saved ${formatMB(totalSaved)}`);
}

/**
 * Remove non-essential files from node_modules: source maps, TypeScript
 * declarations, test directories, C/C++ source, documentation, etc.
 */
function pruneNonEssentialFiles() {
  console.log('[8/10] Pruning non-essential files from node_modules...');

  const nodeModules = path.join(RESOURCES_DIR, 'node_modules');
  if (!fs.existsSync(nodeModules)) return;

  let totalSaved = 0;

  // Directories to remove by name (case-insensitive match)
  const pruneDirNames = new Set([
    'test', 'tests', '__tests__', '__test__',
    'example', 'examples',
    'docs', 'doc',
    '.github',
  ]);

  // File extensions to remove
  const pruneExtensions = new Set([
    '.map',       // Source maps
    '.ts',        // TypeScript source (but not .d.ts, handled separately)
    '.o',         // Object files from native builds
    '.c',         // C source from native builds
    '.cc',        // C++ source
    '.cpp',       // C++ source
    '.h',         // C/C++ headers
    '.gyp',       // node-gyp build files
    '.gypi',      // node-gyp include files
    '.md',        // Markdown documentation
    '.markdown',  // Markdown documentation
  ]);

  // Files to remove by exact name
  const pruneFileNames = new Set([
    'CHANGELOG', 'CHANGELOG.md', 'CHANGELOG.txt',
    'CHANGES', 'CHANGES.md',
    'HISTORY', 'HISTORY.md',
    'README', 'README.md', 'README.txt', 'readme.md',
    // Note: LICENSE files are intentionally kept for legal compliance
    'CONTRIBUTING', 'CONTRIBUTING.md',
    'AUTHORS', 'AUTHORS.md',
    'Makefile', 'Makefile.am',
    'binding.gyp',
    '.eslintrc', '.eslintrc.js', '.eslintrc.json', '.eslintrc.yml',
    '.prettierrc', '.prettierrc.js', '.prettierrc.json',
    'tsconfig.json', 'tsconfig.build.json',
    '.npmignore', '.gitignore', '.editorconfig',
  ]);

  function pruneDir(dirPath, depth) {
    let entries;
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return; // Permission error or deleted concurrently
    }

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // Don't descend into .bin or @-scoped directories at wrong levels
        if (entry.name === '.bin' || entry.name === '.package-lock.json') continue;

        if (pruneDirNames.has(entry.name.toLowerCase())) {
          const size = dirSize(fullPath);
          fs.rmSync(fullPath, { recursive: true, force: true });
          totalSaved += size;
          continue;
        }

        // Recurse into subdirectories
        pruneDir(fullPath, depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        const shouldPrune =
          pruneExtensions.has(ext) ||
          pruneFileNames.has(entry.name);

        // Don't prune .ts files that are actually .d.ts declaration files
        // we want to remove, but DO keep .js files with .ts extension
        // Actually, skip .ts pruning to be safe (some packages ship .ts source as main)
        if (ext === '.ts' && !entry.name.endsWith('.d.ts')) continue;

        if (shouldPrune) {
          try {
            const size = fs.statSync(fullPath).size;
            fs.unlinkSync(fullPath);
            totalSaved += size;
          } catch {
            // File may have been removed by directory pruning
          }
        }
      }
    }
  }

  pruneDir(nodeModules, 0);

  // Remove typescript package if present (dev tool, not needed at runtime)
  const tsDir = path.join(nodeModules, 'typescript');
  if (fs.existsSync(tsDir)) {
    const size = dirSize(tsDir);
    fs.rmSync(tsDir, { recursive: true, force: true });
    totalSaved += size;
    console.log(`      Removed typescript package (${formatMB(size)})`);
  }

  // Clean up dangling symlinks in .bin/ (e.g. from removed typescript package).
  // Tauri's build script enumerates all resource files and fails on broken symlinks.
  const binDir = path.join(nodeModules, '.bin');
  if (fs.existsSync(binDir)) {
    for (const entry of fs.readdirSync(binDir)) {
      const linkPath = path.join(binDir, entry);
      try {
        // fs.statSync follows symlinks — if it throws, the target is gone
        fs.statSync(linkPath);
      } catch {
        fs.unlinkSync(linkPath);
        console.log(`      Removed dangling symlink .bin/${entry}`);
      }
    }
  }

  console.log(`      Non-essential file pruning saved ${formatMB(totalSaved)}`);
}

/**
 * Sign all native binaries in resources/ for macOS notarization.
 * Apple requires every binary in the app bundle to be signed with a
 * Developer ID certificate. Uses APPLE_SIGNING_IDENTITY env var in CI,
 * falls back to ad-hoc signing locally.
 */
function signNativeBinaries() {
  if (process.platform !== 'darwin') {
    console.log('[10/11] Signing native binaries: skipped (not macOS)');
    return;
  }

  console.log('[10/11] Signing native binaries for macOS notarization...');

  const identity = process.env.APPLE_SIGNING_IDENTITY || '-';
  const isAdHoc = identity === '-';
  console.log(`      Signing identity: ${isAdHoc ? 'ad-hoc (local dev)' : identity}`);

  // Find all native binaries (.node, .bare, and known executables)
  const nativeBinaries = [];

  function findBinaries(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        findBinaries(fullPath);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        const ext = path.extname(entry.name).toLowerCase();
        // Sign .node, .bare, .dylib, .so files and known native executables
        if (ext === '.node' || ext === '.bare' || ext === '.dylib' || ext === '.so' || entry.name === 'rg') {
          nativeBinaries.push(fullPath);
        }
      }
    }
  }

  findBinaries(RESOURCES_DIR);

  if (nativeBinaries.length === 0) {
    console.log('      No native binaries found to sign');
    return;
  }

  let signed = 0;
  for (const binPath of nativeBinaries) {
    const relPath = path.relative(RESOURCES_DIR, binPath);
    try {
      execSync(
        `codesign --sign "${identity}" --force --options runtime --timestamp "${binPath}"`,
        { stdio: 'pipe' }
      );
      signed++;
      console.log(`      Signed: ${relPath}`);
    } catch (e) {
      console.log(`      WARN: Failed to sign ${relPath}: ${e.message}`);
    }
  }

  console.log(`      Signed ${signed}/${nativeBinaries.length} native binaries`);
}

function verify() {
  console.log('[11/11] Verifying sidecar payload...');

  const checks = [
    { path: path.join(RESOURCES_DIR, 'backend', 'index.js'), label: 'resources/backend/index.js' },
    { path: path.join(RESOURCES_DIR, 'node_modules', 'fastify'), label: 'resources/node_modules/fastify' },
    { path: path.join(RESOURCES_DIR, 'node_modules', '@animus-labs', 'shared', 'dist'), label: 'resources/node_modules/@animus-labs/shared/dist' },
    { path: path.join(RESOURCES_DIR, 'node_modules', '@animus-labs', 'agents', 'dist'), label: 'resources/node_modules/@animus-labs/agents/dist' },
    { path: path.join(RESOURCES_DIR, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js'), label: 'Claude SDK cli.js' },
    { path: path.join(RESOURCES_DIR, 'node_modules', '@openai', 'codex-sdk', 'vendor'), label: 'Codex SDK vendor/' },
  ];

  // On macOS, verify the dock icon suppression files
  if (process.platform === 'darwin') {
    checks.push(
      { path: path.join(RESOURCES_DIR, 'macos_bg_policy.node'), label: 'resources/macos_bg_policy.node (dock icon suppression)' },
      { path: path.join(RESOURCES_DIR, 'preload-bg-policy.js'), label: 'resources/preload-bg-policy.js (dock icon preload)' },
    );
  }

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
    prepareMacOSBgPolicy();
    copyBackendDist();
    generatePackageJson();
    installDependencies();
    prunePlatformBinaries();
    pruneNonEssentialFiles();
    // Copy workspace packages AFTER npm install, otherwise npm removes them
    copyWorkspacePackages();
    signNativeBinaries();
    verify();
  } catch (err) {
    console.error('\nFatal error during Tauri build preparation:');
    console.error(err);
    process.exit(1);
  }
}

main();
