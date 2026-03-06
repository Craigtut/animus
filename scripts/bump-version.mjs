#!/usr/bin/env node

/**
 * bump-version.mjs
 *
 * Bump the version across all lockstep packages in the Animus monorepo.
 *
 * Usage:
 *   node scripts/bump-version.mjs patch          # 0.1.0 -> 0.1.1
 *   node scripts/bump-version.mjs minor          # 0.1.0 -> 0.2.0
 *   node scripts/bump-version.mjs major          # 0.1.0 -> 1.0.0
 *   node scripts/bump-version.mjs 0.3.0          # explicit version
 *   node scripts/bump-version.mjs --dry-run patch
 *
 * Lockstep files (all bumped together):
 *   - package.json (root)
 *   - packages/tauri/tauri.conf.json
 *   - packages/tauri/Cargo.toml
 *   - packages/tts-native/Cargo.toml
 *   - packages/backend/package.json
 *   - packages/frontend/package.json
 *   - packages/agents/package.json
 *   - packages/tts-native/package.json
 *
 * NOT touched (independent versions):
 *   - packages/shared/package.json
 *   - packages/channel-sdk/package.json
 *   - packages/anipack/package.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');

// ---- Lockstep file definitions ----

const JSON_FILES = [
  'package.json',
  'packages/backend/package.json',
  'packages/frontend/package.json',
  'packages/agents/package.json',
  'packages/tts-native/package.json',
];

const TAURI_CONF = 'packages/tauri/tauri.conf.json';

const CARGO_TOML_FILES = [
  'packages/tauri/Cargo.toml',
  'packages/tts-native/Cargo.toml',
];

// ---- Helpers ----

function readCurrentVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  return pkg.version;
}

function parseVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return { major: parseInt(match[1]), minor: parseInt(match[2]), patch: parseInt(match[3]) };
}

function incrementVersion(current, increment) {
  const v = parseVersion(current);
  if (!v) {
    console.error(`Cannot parse current version: ${current}`);
    process.exit(1);
  }

  switch (increment) {
    case 'major':
      return `${v.major + 1}.0.0`;
    case 'minor':
      return `${v.major}.${v.minor + 1}.0`;
    case 'patch':
      return `${v.major}.${v.minor}.${v.patch + 1}`;
    default:
      console.error(`Unknown increment: ${increment}`);
      process.exit(1);
  }
}

function updateJsonFile(relPath, newVersion, dryRun) {
  const absPath = path.join(ROOT, relPath);
  const content = JSON.parse(fs.readFileSync(absPath, 'utf-8'));
  const oldVersion = content.version;

  if (!dryRun) {
    content.version = newVersion;
    fs.writeFileSync(absPath, JSON.stringify(content, null, 2) + '\n');
  }

  return oldVersion;
}

function updateCargoToml(relPath, newVersion, dryRun) {
  const absPath = path.join(ROOT, relPath);
  const content = fs.readFileSync(absPath, 'utf-8');

  // Match the version field in [package] section
  const regex = /^(version\s*=\s*)"[^"]*"/m;
  const match = content.match(regex);
  if (!match) {
    console.error(`Could not find version field in ${relPath}`);
    process.exit(1);
  }

  // Extract old version
  const oldMatch = content.match(/^version\s*=\s*"([^"]*)"/m);
  const oldVersion = oldMatch ? oldMatch[1] : 'unknown';

  if (!dryRun) {
    const updated = content.replace(regex, `$1"${newVersion}"`);
    fs.writeFileSync(absPath, updated);
  }

  return oldVersion;
}

function updateCargoLocks(dryRun) {
  if (dryRun) return;

  // Update Cargo.lock files to reflect new versions
  const cargoDirs = [
    path.join(ROOT, 'packages', 'tauri'),
    path.join(ROOT, 'packages', 'tts-native'),
  ];

  for (const dir of cargoDirs) {
    const lockFile = path.join(dir, 'Cargo.lock');
    if (fs.existsSync(lockFile)) {
      try {
        execSync('cargo generate-lockfile', { cwd: dir, stdio: 'pipe' });
      } catch {
        // Non-fatal: lock file update may fail if Rust toolchain isn't installed
        console.log(`  WARN: Could not update ${path.relative(ROOT, lockFile)}`);
      }
    }
  }
}

// ---- Main ----

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const filtered = args.filter(a => a !== '--dry-run');

  if (filtered.length !== 1) {
    console.error('Usage: bump-version.mjs [--dry-run] <patch|minor|major|X.Y.Z>');
    process.exit(1);
  }

  const input = filtered[0];
  const currentVersion = readCurrentVersion();

  // Determine new version
  let newVersion;
  if (['patch', 'minor', 'major'].includes(input)) {
    newVersion = incrementVersion(currentVersion, input);
  } else if (parseVersion(input)) {
    newVersion = input;
  } else {
    console.error(`Invalid version or increment: ${input}`);
    process.exit(1);
  }

  if (dryRun) {
    console.log(`[DRY RUN] Would bump ${currentVersion} -> ${newVersion}\n`);
  } else {
    console.log(`Bumping ${currentVersion} -> ${newVersion}\n`);
  }

  // Track changes for summary
  const changes = [];

  // Update JSON files (package.json)
  for (const relPath of JSON_FILES) {
    const oldVersion = updateJsonFile(relPath, newVersion, dryRun);
    changes.push({ file: relPath, from: oldVersion, to: newVersion });
  }

  // Update tauri.conf.json
  const oldTauriVersion = updateJsonFile(TAURI_CONF, newVersion, dryRun);
  changes.push({ file: TAURI_CONF, from: oldTauriVersion, to: newVersion });

  // Update Cargo.toml files
  for (const relPath of CARGO_TOML_FILES) {
    const oldVersion = updateCargoToml(relPath, newVersion, dryRun);
    changes.push({ file: relPath, from: oldVersion, to: newVersion });
  }

  // Update Cargo.lock files
  if (!dryRun) {
    updateCargoLocks(dryRun);
  }

  // Print summary
  console.log('File                                  Old       New');
  console.log('----                                  ---       ---');
  for (const c of changes) {
    const file = c.file.padEnd(38);
    console.log(`${file}${c.from.padEnd(10)}${c.to}`);
  }

  if (dryRun) {
    console.log('\n[DRY RUN] No files were modified.');
  } else {
    console.log(`\nVersion bumped to ${newVersion}`);
  }

  return newVersion;
}

// Export for use by release.mjs
export { main as bumpVersion };

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
