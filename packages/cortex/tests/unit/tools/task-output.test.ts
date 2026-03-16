import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { CwdTracker } from '../../../src/tools/shared/cwd-tracker.js';
import { createBashTool, getBackgroundTask } from '../../../src/tools/bash/index.js';
import { createTaskOutputTool } from '../../../src/tools/task-output.js';

describe('TaskOutput tool', () => {
  let cwdTracker: CwdTracker;
  let bashTool: ReturnType<typeof createBashTool>;
  let taskOutputTool: ReturnType<typeof createTaskOutputTool>;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-task-test-'));
    cwdTracker = new CwdTracker(tmpDir);
    bashTool = createBashTool({ cwdTracker });
    taskOutputTool = createTaskOutputTool();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns not_found for unknown task ID', async () => {
    const result = await taskOutputTool.execute({
      task_id: 'nonexistent',
      action: 'poll',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Task not found');
    expect(result.details.status).toBe('not_found');
  });

  it('polls a background task', async () => {
    // Start a background command
    const bashResult = await bashTool.execute({
      command: 'echo "bg output"; sleep 0.5',
      background: true,
    });

    const taskId = bashResult.details.taskId!;
    expect(taskId).toBeTruthy();

    // Poll it
    const result = await taskOutputTool.execute({
      task_id: taskId,
      action: 'poll',
    });

    expect(result.details.status).toMatch(/running|completed/);
  });

  it('polls a completed task', async () => {
    // Start a quick background command
    const bashResult = await bashTool.execute({
      command: 'echo "done"',
      background: true,
    });

    const taskId = bashResult.details.taskId!;

    // Wait for completion
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const result = await taskOutputTool.execute({
      task_id: taskId,
      action: 'poll',
    });

    expect(result.details.status).toBe('completed');
  }, 10000);

  it('kills a running task', async () => {
    // Start a long-running background command
    const bashResult = await bashTool.execute({
      command: 'sleep 30',
      background: true,
    });

    const taskId = bashResult.details.taskId!;

    // Kill it
    const result = await taskOutputTool.execute({
      task_id: taskId,
      action: 'kill',
      signal: 'SIGKILL',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('SIGKILL');

    // Wait for cleanup
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Verify it completed (with non-zero exit)
    const task = getBackgroundTask(taskId);
    expect(task?.completed).toBe(true);
  }, 10000);

  it('refuses to send input to completed task', async () => {
    const bashResult = await bashTool.execute({
      command: 'echo "quick"',
      background: true,
    });

    const taskId = bashResult.details.taskId!;
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const result = await taskOutputTool.execute({
      task_id: taskId,
      action: 'send',
      input: 'too late',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('already completed');
  }, 10000);
});
