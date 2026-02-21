#!/usr/bin/env node
/**
 * Remotion Video Render Script
 * Renders a composition to video using npx remotion render
 */

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    project: null,
    composition: null,
    output: null,
    width: null,
    height: null,
    fps: null,
    codec: 'h264',
    props: '{}',
    crf: null
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = args[i + 1];

    switch (arg) {
      case '--project':
        result.project = value;
        i++;
        break;
      case '--composition':
        result.composition = value;
        i++;
        break;
      case '--output':
        result.output = value;
        i++;
        break;
      case '--width':
        result.width = parseInt(value, 10);
        i++;
        break;
      case '--height':
        result.height = parseInt(value, 10);
        i++;
        break;
      case '--fps':
        result.fps = parseInt(value, 10);
        i++;
        break;
      case '--codec':
        result.codec = value;
        i++;
        break;
      case '--props':
        result.props = value;
        i++;
        break;
      case '--crf':
        result.crf = parseInt(value, 10);
        i++;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  return result;
}

function printHelp() {
  console.log(`
Remotion Render Script

Usage:
  node render.js --project PATH --composition ID --output PATH [options]

Required:
  --project PATH       Path to Remotion project directory
  --composition ID     Composition ID to render
  --output PATH        Output file path (e.g., ./video.mp4)

Options:
  --width N            Output width in pixels
  --height N           Output height in pixels
  --fps N              Frames per second
  --codec CODEC        Video codec (h264, h265, vp8, vp9, prores, gif)
  --props JSON         Input props as JSON string
  --crf N              Quality (0-51, lower = better quality)
  --help, -h           Show this help

Examples:
  node render.js --project ./my-video --composition HelloWorld --output ./hello.mp4
  node render.js --project ./my-video --composition Intro --output ./intro.mp4 --width 1920 --height 1080 --fps 60
  node render.js --project ./my-video --composition Title --output ./title.mp4 --props '{"title": "Hello"}'
`);
}

function findEntryPoint(projectPath) {
  // Common entry point locations
  const candidates = [
    'src/index.ts',
    'src/index.tsx',
    'src/index.js',
    'index.ts',
    'index.tsx',
    'index.js'
  ];

  for (const candidate of candidates) {
    const fullPath = path.join(projectPath, candidate);
    if (fs.existsSync(fullPath)) {
      return candidate;
    }
  }

  return null;
}

function validateArgs(args) {
  const errors = [];

  if (!args.project) {
    errors.push('--project is required');
  } else if (!fs.existsSync(args.project)) {
    errors.push(`Project directory not found: ${args.project}`);
  }

  if (!args.composition) {
    errors.push('--composition is required');
  }

  if (!args.output) {
    errors.push('--output is required');
  }

  // Validate props JSON
  if (args.props) {
    try {
      JSON.parse(args.props);
    } catch {
      errors.push('--props must be valid JSON');
    }
  }

  // Validate codec
  const validCodecs = ['h264', 'h265', 'vp8', 'vp9', 'prores', 'gif', 'png', 'mp3', 'aac', 'wav'];
  if (args.codec && !validCodecs.includes(args.codec)) {
    errors.push(`Invalid codec "${args.codec}". Valid options: ${validCodecs.join(', ')}`);
  }

  return errors;
}

function buildCommand(args, entryPoint) {
  const cmdParts = [
    'npx',
    'remotion',
    'render',
    entryPoint,
    args.composition,
    args.output
  ];

  if (args.width) cmdParts.push(`--width=${args.width}`);
  if (args.height) cmdParts.push(`--height=${args.height}`);
  if (args.fps) cmdParts.push(`--fps=${args.fps}`);
  if (args.codec) cmdParts.push(`--codec=${args.codec}`);
  if (args.crf !== null) cmdParts.push(`--crf=${args.crf}`);
  if (args.props && args.props !== '{}') {
    // Escape single quotes in props for shell
    cmdParts.push(`--props='${args.props}'`);
  }

  // Always overwrite
  cmdParts.push('--overwrite');

  return cmdParts.join(' ');
}

async function main() {
  const args = parseArgs();

  // Validate arguments
  const errors = validateArgs(args);
  if (errors.length > 0) {
    console.error('Error:');
    errors.forEach(e => console.error(`  - ${e}`));
    console.error('\nRun with --help for usage information.');
    process.exit(1);
  }

  // Resolve project path
  const projectPath = path.resolve(args.project);

  // Find entry point
  const entryPoint = findEntryPoint(projectPath);
  if (!entryPoint) {
    console.error(`Error: No entry point found in ${projectPath}`);
    console.error('Expected one of: src/index.ts, src/index.tsx, src/index.js');
    process.exit(1);
  }

  // Ensure output directory exists
  const outputDir = path.dirname(path.resolve(args.output));
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Build and execute command
  const command = buildCommand(args, entryPoint);

  console.log(`Rendering composition "${args.composition}"...`);
  console.log(`Project: ${projectPath}`);
  console.log(`Output: ${path.resolve(args.output)}`);
  console.log('');

  try {
    // Run in the project directory
    execSync(command, {
      cwd: projectPath,
      stdio: 'inherit'
    });

    console.log('');
    console.log(`Video rendered to: ${path.resolve(args.output)}`);
  } catch (error) {
    console.error('');
    console.error('Render failed. See error above.');
    process.exit(1);
  }
}

main();
