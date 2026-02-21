#!/usr/bin/env node
/**
 * Check Remotion dependencies
 * Verifies Node version and reports Remotion installation status
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const MIN_NODE_VERSION = 18;

function checkNodeVersion() {
  const version = process.versions.node;
  const major = parseInt(version.split('.')[0], 10);

  if (major < MIN_NODE_VERSION) {
    console.error(`❌ Node.js ${MIN_NODE_VERSION}+ required (found v${version})`);
    console.error(`   Install: https://nodejs.org/`);
    return false;
  }

  console.log(`✅ Node.js v${version}`);
  return true;
}

function checkNpxAvailable() {
  try {
    execSync('npx --version', { stdio: 'pipe' });
    console.log('✅ npx available');
    return true;
  } catch {
    console.error('❌ npx not found');
    console.error('   Install Node.js from https://nodejs.org/');
    return false;
  }
}

function checkRemotionInProject(projectPath) {
  if (!projectPath) {
    console.log('ℹ️  No project path provided — skipping Remotion package check');
    console.log('   Provide --project PATH to check a specific project');
    return true;
  }

  const pkgPath = path.join(projectPath, 'package.json');

  if (!fs.existsSync(pkgPath)) {
    console.error(`❌ No package.json found at ${projectPath}`);
    return false;
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    const required = ['remotion', '@remotion/cli'];
    const missing = required.filter(dep => !deps[dep]);

    if (missing.length > 0) {
      console.error(`❌ Missing Remotion packages in project: ${missing.join(', ')}`);
      console.error(`   Install: cd ${projectPath} && npm install --save-exact ${missing.join(' ')}`);
      return false;
    }

    console.log(`✅ Remotion packages found in ${projectPath}`);
    return true;
  } catch (err) {
    console.error(`❌ Error reading package.json: ${err.message}`);
    return false;
  }
}

function checkBrowser() {
  console.log('ℹ️  Chrome Headless Shell auto-downloads when needed');
  console.log('   Run "npx remotion browser ensure" in your project to pre-download');
  return true;
}

function main() {
  console.log('Remotion Dependency Check\n');

  // Parse --project argument
  const projectIdx = process.argv.indexOf('--project');
  const projectPath = projectIdx !== -1 ? process.argv[projectIdx + 1] : null;

  const checks = [
    checkNodeVersion(),
    checkNpxAvailable(),
    checkRemotionInProject(projectPath),
    checkBrowser()
  ];

  console.log('');

  if (checks.every(Boolean)) {
    console.log('All checks passed! Ready to render.');
    process.exit(0);
  } else {
    console.error('Some checks failed. See above for details.');
    process.exit(1);
  }
}

main();
