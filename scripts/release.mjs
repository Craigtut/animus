#!/usr/bin/env node

/**
 * release.mjs
 *
 * Orchestrate a release: bump version, generate changelog, commit, tag.
 *
 * Usage:
 *   node scripts/release.mjs patch
 *   node scripts/release.mjs minor
 *   node scripts/release.mjs major
 *   node scripts/release.mjs 1.0.0
 *   node scripts/release.mjs --dry-run patch
 *
 * Steps:
 *   1. Verify clean working directory and on main branch
 *   2. Bump version across all lockstep packages
 *   3. Generate changelog entry from conventional commits
 *   4. Stage all changed files
 *   5. Commit with chore(release): vX.Y.Z
 *   6. Create annotated git tag
 *   7. Print push instructions (does NOT auto-push)
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import conventionalChangelog from 'conventional-changelog';

const ROOT = path.resolve(import.meta.dirname, '..');

function exec(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', ...opts }).trim();
}

/**
 * Generate changelog entry from conventional commits and prepend to CHANGELOG.md.
 */
async function generateChangelog() {
  const changelogPath = path.join(ROOT, 'CHANGELOG.md');
  const existing = fs.existsSync(changelogPath)
    ? fs.readFileSync(changelogPath, 'utf-8')
    : '';

  // Collect the stream output into a string
  const newEntry = await new Promise((resolve, reject) => {
    let data = '';
    conventionalChangelog({ preset: 'conventionalcommits', releaseCount: 1 })
      .on('data', (chunk) => { data += chunk.toString(); })
      .on('end', () => resolve(data))
      .on('error', reject);
  });

  if (newEntry.trim()) {
    // Insert new entry after the header block, not before it
    const headerMatch = existing.match(/^(# Changelog\n(?:.*\n)*?\n)/);
    if (headerMatch) {
      const header = headerMatch[1];
      const rest = existing.slice(header.length);
      fs.writeFileSync(changelogPath, header + newEntry + '\n' + rest);
    } else {
      fs.writeFileSync(changelogPath, newEntry + '\n' + existing);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const filtered = args.filter(a => a !== '--dry-run');

  if (filtered.length !== 1) {
    console.error('Usage: release.mjs [--dry-run] <patch|minor|major|X.Y.Z>');
    process.exit(1);
  }

  const input = filtered[0];

  // ---- Step 1: Pre-flight checks ----

  console.log('Pre-flight checks...\n');

  // Check for clean working directory
  const status = exec('git status --porcelain');
  if (status) {
    console.error('Working directory is not clean. Commit or stash changes first.\n');
    console.error(status);
    process.exit(1);
  }

  // Check we're on main
  const branch = exec('git rev-parse --abbrev-ref HEAD');
  if (branch !== 'main') {
    console.error(`Must be on 'main' branch to release. Currently on '${branch}'.`);
    process.exit(1);
  }

  // ---- Step 2: Bump version ----

  console.log('Bumping version...\n');

  if (dryRun) {
    execSync(`node scripts/bump-version.mjs --dry-run ${input}`, { cwd: ROOT, stdio: 'inherit' });

    // Read what the version would be for display
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
    const currentVersion = pkg.version;
    const v = currentVersion.match(/^(\d+)\.(\d+)\.(\d+)$/);
    let newVersion = input;
    if (v && ['patch', 'minor', 'major'].includes(input)) {
      const parts = { major: parseInt(v[1]), minor: parseInt(v[2]), patch: parseInt(v[3]) };
      if (input === 'patch') newVersion = `${parts.major}.${parts.minor}.${parts.patch + 1}`;
      else if (input === 'minor') newVersion = `${parts.major}.${parts.minor + 1}.0`;
      else newVersion = `${parts.major + 1}.0.0`;
    }

    console.log(`\n[DRY RUN] Would generate changelog for v${newVersion}`);
    console.log(`[DRY RUN] Would commit: chore(release): v${newVersion}`);
    console.log(`[DRY RUN] Would tag: v${newVersion}`);
    console.log(`[DRY RUN] No changes made.`);
    return;
  }

  execSync(`node scripts/bump-version.mjs ${input}`, { cwd: ROOT, stdio: 'inherit' });

  // Read the new version
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  const newVersion = pkg.version;

  // ---- Step 3: Generate changelog ----

  console.log('\nGenerating changelog...\n');

  try {
    await generateChangelog();
    console.log('Changelog updated.');
  } catch (err) {
    console.log('WARN: Changelog generation failed:', err.message);
    console.log('      Continuing without changelog update...');
  }

  // ---- Step 4: Stage files ----

  console.log('\nStaging files...\n');

  const filesToStage = [
    'package.json',
    'CHANGELOG.md',
    'packages/backend/package.json',
    'packages/frontend/package.json',
    'packages/agents/package.json',
    'packages/tts-native/package.json',
    'packages/tauri/tauri.conf.json',
    'packages/tauri/Cargo.toml',
    'packages/tauri/Cargo.lock',
    'packages/tts-native/Cargo.toml',
    'packages/tts-native/Cargo.lock',
  ];

  // Only stage files that exist and have changes
  for (const file of filesToStage) {
    const absPath = path.join(ROOT, file);
    if (fs.existsSync(absPath)) {
      try {
        exec(`git add "${file}"`);
      } catch {
        // File may not have changes
      }
    }
  }

  // ---- Step 5: Commit ----

  console.log('Committing...\n');

  exec(`git commit -m "chore(release): v${newVersion}"`);

  // ---- Step 6: Tag ----

  console.log('Tagging...\n');

  exec(`git tag -a v${newVersion} -m "Release v${newVersion}"`);

  // ---- Step 7: Instructions ----

  console.log('='.repeat(60));
  console.log(`\n  Release v${newVersion} prepared successfully!\n`);
  console.log('  Push with:\n');
  console.log(`    git push && git push origin v${newVersion}\n`);
  console.log('  This will trigger the GitHub Actions release workflow');
  console.log('  which builds Tauri desktop apps for macOS and Windows.\n');
  console.log('='.repeat(60));
}

main().catch((err) => {
  console.error('Release failed:', err);
  process.exit(1);
});
