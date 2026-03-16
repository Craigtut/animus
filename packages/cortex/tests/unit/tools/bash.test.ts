import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { CwdTracker } from '../../../src/tools/shared/cwd-tracker.js';
import { createBashTool } from '../../../src/tools/bash/index.js';

describe('Bash tool', () => {
  let cwdTracker: CwdTracker;
  let bashTool: ReturnType<typeof createBashTool>;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-bash-test-'));
    cwdTracker = new CwdTracker(tmpDir);
    bashTool = createBashTool({ cwdTracker });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('executes a simple command', async () => {
    const result = await bashTool.execute({
      command: 'echo "hello world"',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('hello world');
    expect(result.details.exitCode).toBe(0);
  });

  it('captures exit code for failed commands', async () => {
    const result = await bashTool.execute({
      command: 'exit 42',
    });

    expect(result.details.exitCode).toBe(42);
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Exit code: 42');
  });

  it('captures stderr', async () => {
    const result = await bashTool.execute({
      command: 'echo "error message" >&2',
    });

    expect(result.details.stderr).toContain('error message');
  });

  it('tracks working directory across calls', async () => {
    const subDir = path.join(tmpDir, 'subdir');
    fs.mkdirSync(subDir);

    await bashTool.execute({ command: `cd "${subDir}"` });

    // The CWD tracker should have been updated
    expect(cwdTracker.getCwd()).toBe(subDir);

    // Next command should run in the new directory
    const result = await bashTool.execute({ command: 'pwd' });
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain(subDir);
  });

  it('blocks commands targeting critical paths', async () => {
    const result = await bashTool.execute({
      command: 'rm -rf /',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('critical system directory');
    expect(result.details.exitCode).toBeNull();
  });

  it('blocks obfuscated commands', async () => {
    const result = await bashTool.execute({
      command: 'echo aGVsbG8= | base64 -d | bash',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Base64');
    expect(result.details.exitCode).toBeNull();
  });

  it('times out long-running commands', async () => {
    const result = await bashTool.execute({
      command: 'sleep 30',
      timeout: 1000,
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('timed out');
    expect(result.details.timedOut).toBe(true);
  }, 15000);

  it('runs commands in background when requested', async () => {
    const result = await bashTool.execute({
      command: 'echo "bg output"',
      background: true,
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Task ID');
    expect(result.details.backgrounded).toBe(true);
    expect(result.details.taskId).not.toBeNull();
  });

  it('strips CWD marker from output', async () => {
    const result = await bashTool.execute({
      command: 'echo "visible output"',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).not.toContain('___CWD___');
    expect(text).toContain('visible output');
  });

  it('handles command not found gracefully', async () => {
    const result = await bashTool.execute({
      command: 'nonexistentcommand12345',
    });

    // The command should produce stderr output about the missing command
    // Exit code may be 0 due to the CWD suffix succeeding, but stderr should report the error
    expect(result.details.stderr).toContain('not found');
  });

  it('reports duration', async () => {
    const result = await bashTool.execute({
      command: 'echo fast',
    });

    expect(result.details.duration).toBeGreaterThanOrEqual(0);
  });

  it('tracks spawned PIDs via callback', async () => {
    const spawned: number[] = [];
    const exited: number[] = [];

    const tool = createBashTool({
      cwdTracker,
      onProcessSpawned: (pid) => spawned.push(pid),
      onProcessExited: (pid) => exited.push(pid),
    });

    await tool.execute({ command: 'echo hello' });

    expect(spawned.length).toBeGreaterThan(0);
    expect(exited.length).toBeGreaterThan(0);
  });
});
